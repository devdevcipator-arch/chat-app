import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse, type NextRequest } from "next/server";
import { getR2 } from "@/lib/r2";
import { attachmentDisposition, fail, loadOwnItem } from "@/lib/vault-server";

/**
 * GET /api/gallery/:id/download
 * Redirects to a short-lived presigned GET that forces a download with the
 * original file name. (`<a download>` is ignored for cross-origin R2 URLs.)
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/gallery/[id]/download">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnItem(id);
  if ("error" in loaded) return loaded.error;
  const { item } = loaded;

  const r2 = getR2();
  if (!r2) return fail(503, "Media isn't configured yet.");

  try {
    const url = await getSignedUrl(
      r2.client,
      new GetObjectCommand({
        Bucket: r2.bucket,
        Key: item.media_url,
        ResponseContentDisposition: attachmentDisposition(item.file_name),
      }),
      { expiresIn: 60 },
    );
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("R2 vault download presign failed:", e instanceof Error ? e.message : e);
    return fail(500, "Couldn't prepare the download. Please try again.");
  }
}
