import { randomUUID } from "node:crypto";
import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";
import { UUID_PATTERN, type MessageRow } from "@/lib/chat";
import { getR2 } from "@/lib/r2";
import { MESSAGE_TYPE_FOR, VAULT_KEY_PATTERN, asVaultKind, extensionOfKey } from "@/lib/vault";
import { fail, loadOwnItem, ok, readJson } from "@/lib/vault-server";

/**
 * POST /api/gallery/:id/forward
 * Body: { chatId }
 * Copies the gallery object into chats/<chatId>/<me>/<uuid>.<ext> (the only
 * key shape the messages insert policy accepts) and posts it as a message,
 * as the signed-in user, so RLS still decides whether they may send there.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/gallery/[id]/forward">) {
  const { id } = await ctx.params;
  const body = await readJson(request);
  const chatId = body?.chatId;
  if (typeof chatId !== "string" || !UUID_PATTERN.test(chatId)) return fail(400, "Invalid chat.");

  const loaded = await loadOwnItem(id);
  if ("error" in loaded) return loaded.error;
  const { supabase, userId, item } = loaded;
  if (!VAULT_KEY_PATTERN.test(item.media_url)) return fail(500, "That item can't be forwarded.");

  // Check membership before copying, so we don't leave orphaned copies.
  const { data: membership, error: membershipError } = await supabase
    .from("chat_participants")
    .select("chat_id")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) return fail(500, "Something went wrong. Please try again.");
  if (!membership) return fail(403, "You're not part of that chat.");

  const r2 = getR2();
  if (!r2) return fail(503, "Media isn't configured yet.");

  const target = `chats/${chatId.toLowerCase()}/${userId}/${randomUUID()}.${extensionOfKey(item.media_url)}`;
  try {
    await r2.client.send(
      new CopyObjectCommand({
        Bucket: r2.bucket,
        Key: target,
        CopySource: `${r2.bucket}/${item.media_url}`,
        MetadataDirective: "COPY",
      }),
    );
  } catch (e) {
    console.error("R2 vault copy failed:", e instanceof Error ? e.message : e);
    return fail(500, "Couldn't forward that file. Please try again.");
  }

  const messageType = MESSAGE_TYPE_FOR[asVaultKind(item.file_type)];
  const { data, error } = await supabase
    .from("messages")
    .insert({
      chat_id: chatId.toLowerCase(),
      sender_id: userId,
      message_type: messageType,
      // Videos and files show their original name in the bubble.
      content: messageType === "video" || messageType === "file" ? item.file_name : null,
      media_url: target,
    })
    .select()
    .single();

  if (error || !data) {
    console.error("Forward insert failed:", error?.message);
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: target })).catch(() => {});
    return fail(500, "Couldn't send to that chat. Please try again.");
  }

  return ok<MessageRow>(data, 201);
}
