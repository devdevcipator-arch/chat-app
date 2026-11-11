import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { NextRequest } from "next/server";
import { IMAGE_TYPES, type ImageMimeType } from "@/lib/media";
import { AVATAR_MAX_UPLOAD_BYTES, avatarKey, type AvatarUploadUrlResponse } from "@/lib/profile";
import { getR2 } from "@/lib/r2";
import { authed, fail, ok, readJson } from "@/lib/vault-server";

const URL_TTL_SECONDS = 300;

/**
 * POST /api/profile/avatar/upload-url
 * Body: { fileType, fileSize } for the already-resized image.
 * Returns a presigned R2 PUT for avatars/<userId>/<fileId>.<ext> (the
 * signature covers Content-Type and Content-Length). After the PUT, the
 * client calls PUT /api/profile/avatar with the fileId to make it current.
 */
export async function POST(request: NextRequest) {
  const auth = await authed();
  if (!auth) return fail(401, "Please sign in again.");

  const body = await readJson(request);
  if (!body) return fail(400, "Invalid request body.");
  const { fileType, fileSize } = body;
  if (typeof fileType !== "string" || !(fileType in IMAGE_TYPES)) {
    return fail(415, "Profile photos must be PNG, JPEG or WebP.");
  }
  if (typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize <= 0) {
    return fail(400, "Invalid file size.");
  }
  if (fileSize > AVATAR_MAX_UPLOAD_BYTES) return fail(413, "That photo is too large.");

  const r2 = getR2();
  if (!r2) return fail(503, "Photo uploads aren't configured yet.");

  const type = fileType as ImageMimeType;
  const fileId = randomUUID();
  try {
    const uploadUrl = await getSignedUrl(
      r2.client,
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: avatarKey(auth.userId, fileId, type),
        ContentType: type,
        ContentLength: fileSize,
      }),
      { expiresIn: URL_TTL_SECONDS, signableHeaders: new Set(["content-type"]) },
    );
    return ok<AvatarUploadUrlResponse>({
      fileId,
      fileType: type,
      uploadUrl,
      headers: { "Content-Type": type },
      expiresIn: URL_TTL_SECONDS,
    });
  } catch (error) {
    console.error("R2 avatar presign failed:", error instanceof Error ? error.message : error);
    return fail(500, "Couldn't prepare the upload. Please try again.");
  }
}
