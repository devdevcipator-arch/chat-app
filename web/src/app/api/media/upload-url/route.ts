import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse, type NextRequest } from "next/server";
import { UUID_PATTERN } from "@/lib/chat";
import { chatUploadRule, formatLimit } from "@/lib/chat-upload";
import {
  mediaPublicUrl,
  type UploadUrlError,
  type UploadUrlRequest,
  type UploadUrlResponse,
} from "@/lib/media";
import { getR2 } from "@/lib/r2";
import { getApiAuth } from "@/lib/supabase/server";

const URL_TTL_SECONDS = 300;

const fail = (status: number, error: string) =>
  NextResponse.json<UploadUrlError>({ error }, { status, headers: { "Cache-Control": "no-store" } });

function parseBody(body: unknown): UploadUrlRequest | string {
  if (typeof body !== "object" || body === null) return "Invalid request body.";
  const { chatId, fileName, fileType, fileSize } = body as Record<string, unknown>;
  if (typeof chatId !== "string" || !UUID_PATTERN.test(chatId)) return "Invalid chat.";
  if (typeof fileName !== "string" || fileName.length === 0 || fileName.length > 255) {
    return "Invalid file name.";
  }
  if (typeof fileType !== "string") return "Invalid file type.";
  if (typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize <= 0) {
    return "Invalid file size.";
  }
  return { chatId, fileName, fileType, fileSize };
}

/**
 * POST /api/media/upload-url
 * Body: { chatId, fileName, fileType, fileSize }
 * Returns a short-lived presigned PUT URL for Cloudflare R2. The signature
 * covers Content-Type and Content-Length, so the client cannot upload a
 * different type or a larger file than it declared.
 */
export async function POST(request: NextRequest) {
  // 1. Authenticated users only.
  const auth = await getApiAuth();
  if (!auth) return fail(401, "Please sign in again.");
  const { supabase, userId } = auth;

  // 2. Validate input.
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "Invalid request body.");
  }
  const parsed = parseBody(json);
  if (typeof parsed === "string") return fail(400, parsed);
  const { chatId, fileType, fileSize } = parsed;

  // Images (already re-encoded), audio, videos and documents.
  const rule = chatUploadRule(fileType);
  if (!rule) return fail(415, "That file type isn't supported.");
  if (fileSize > rule.maxBytes) return fail(413, `Files like this must be ${formatLimit(rule.maxBytes)} or smaller.`);

  // 3. Only participants may upload into a chat (RLS-scoped read).
  const { data: membership, error: membershipError } = await supabase
    .from("chat_participants")
    .select("chat_id")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) return fail(500, "Something went wrong. Please try again.");
  if (!membership) return fail(403, "You're not part of this chat.");

  // 4. Sign. The key is server-generated: the client's file name is never
  //    used in the path (no path injection, no leaking original names).
  const r2 = getR2();
  if (!r2) return fail(503, "Media uploads aren't configured yet.");

  const key = `chats/${chatId}/${userId}/${randomUUID()}.${rule.ext}`;
  const publicUrl = mediaPublicUrl(key);
  if (!publicUrl) return fail(503, "Media uploads aren't configured yet.");

  try {
    const uploadUrl = await getSignedUrl(
      r2.client,
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        ContentType: fileType,
        ContentLength: fileSize,
      }),
      {
        expiresIn: URL_TTL_SECONDS,
        // Sign Content-Type too (by default only host + content-length are),
        // so the URL cannot be reused to upload a different kind of file.
        signableHeaders: new Set(["content-type"]),
      },
    );

    return NextResponse.json<UploadUrlResponse>(
      {
        uploadUrl,
        publicUrl,
        key,
        headers: { "Content-Type": fileType },
        expiresIn: URL_TTL_SECONDS,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("R2 presign failed:", error instanceof Error ? error.message : error);
    return fail(500, "Couldn't prepare the upload. Please try again.");
  }
}
