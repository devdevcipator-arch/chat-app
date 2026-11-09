import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";
import { getR2 } from "@/lib/r2";
import { VAULT_KEY_PATTERN } from "@/lib/vault";
import { fail, loadOwnItem, ok } from "@/lib/vault-server";

/**
 * DELETE /api/gallery/:id
 * Removes the item and its R2 object. Copies already forwarded to chats are
 * separate objects and stay in those chats.
 */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/gallery/[id]">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnItem(id);
  if ("error" in loaded) return loaded.error;
  const { supabase, item } = loaded;

  const { error } = await supabase.from("user_gallery").delete().eq("id", item.id);
  if (error) return fail(500, "Couldn't delete that item. Please try again.");

  const r2 = getR2();
  if (r2 && VAULT_KEY_PATTERN.test(item.media_url)) {
    try {
      await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: item.media_url }));
    } catch (e) {
      // The row is gone, so the UI is right; the object is just orphaned.
      console.error("R2 vault delete failed:", item.media_url, e instanceof Error ? e.message : e);
    }
  }

  return ok({ deleted: item.id });
}
