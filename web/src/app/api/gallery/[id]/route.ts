import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";
import { getR2 } from "@/lib/r2";
import { VAULT_KEY_PATTERN } from "@/lib/vault";
import { fail, loadOwnItem, ok } from "@/lib/vault-server";

/**
 * DELETE /api/gallery/:id
 * Permanently deletes the caller's item: the R2 object first, then the row.
 *
 * Order matters: if the R2 purge fails we stop with the row intact, so the
 * user can retry and storage is never orphaned. DeleteObject is idempotent,
 * so a retry after a later failure is safe too.
 *
 * Copies already forwarded to chats are unaffected: forwarding copies the
 * object to its own chats/<chat>/<sender>/<uuid> key (see ./forward).
 */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/gallery/[id]">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnItem(id); // 401 / 404 unless the caller owns it
  if ("error" in loaded) return loaded.error;
  const { supabase, userId, item } = loaded;

  // 1. Purge the file from R2. Only ever touch keys in the caller's own vault folder.
  if (!VAULT_KEY_PATTERN.test(item.media_url) || !item.media_url.startsWith(`vault/${userId}/`)) {
    console.error("Refusing to delete unexpected gallery key:", item.media_url);
    return fail(500, "Couldn't delete that item. Please try again.");
  }
  const r2 = getR2();
  if (!r2) return fail(503, "Storage isn't configured, so nothing was deleted.");
  try {
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: item.media_url }));
  } catch (e) {
    console.error("R2 vault delete failed:", item.media_url, e instanceof Error ? e.message : e);
    return fail(502, "Couldn't remove the file from storage. Nothing was deleted, please try again.");
  }

  // 2. Hard-delete the row (a real SQL DELETE; RLS also limits it to the owner).
  const { data, error } = await supabase
    .from("user_gallery")
    .delete()
    .eq("id", item.id)
    .eq("user_id", userId)
    .select("id");
  if (error) return fail(500, "Couldn't delete that item. Please try again.");
  if (!data?.length) return fail(404, "That item doesn't exist.");

  return ok({ deleted: item.id });
}
