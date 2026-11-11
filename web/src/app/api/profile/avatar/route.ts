import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";
import { UUID_PATTERN } from "@/lib/chat";
import { IMAGE_TYPES, type ImageMimeType } from "@/lib/media";
import { AVATAR_KEY_PATTERN, avatarKey } from "@/lib/profile";
import { getR2 } from "@/lib/r2";
import { authed, fail, ok, readJson } from "@/lib/vault-server";

type Auth = NonNullable<Awaited<ReturnType<typeof authed>>>;

async function currentAvatar({ supabase, userId }: Auth) {
  const { data, error } = await supabase.from("profiles").select("avatar_url").eq("id", userId).maybeSingle();
  if (error) return { error } as const;
  return { key: data?.avatar_url ?? null } as const;
}

/** Best effort: the profile no longer points at it, so it's just orphaned if this fails. */
async function deleteObject(key: string | null, userId: string) {
  const r2 = getR2();
  if (!r2 || !key || !AVATAR_KEY_PATTERN.test(key) || !key.startsWith(`avatars/${userId}/`)) return;
  try {
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
  } catch (e) {
    console.error("R2 avatar delete failed:", key, e instanceof Error ? e.message : e);
  }
}

/**
 * PUT /api/profile/avatar
 * Body: { fileId, fileType } from a finished upload-url + PUT.
 * Makes it the caller's avatar and deletes the previous photo.
 */
export async function PUT(request: NextRequest) {
  const auth = await authed();
  if (!auth) return fail(401, "Please sign in again.");

  const body = await readJson(request);
  const fileId = body?.fileId;
  const fileType = body?.fileType;
  if (typeof fileId !== "string" || !UUID_PATTERN.test(fileId)) return fail(400, "Invalid upload.");
  if (typeof fileType !== "string" || !(fileType in IMAGE_TYPES)) return fail(400, "Invalid upload.");
  const key = avatarKey(auth.userId, fileId.toLowerCase(), fileType as ImageMimeType);

  const r2 = getR2();
  if (!r2) return fail(503, "Photo uploads aren't configured yet.");
  try {
    await r2.client.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: key }));
  } catch {
    return fail(400, "The upload didn't finish. Please try again.");
  }

  const previous = await currentAvatar(auth);
  if ("error" in previous) return fail(500, "Couldn't update your photo. Please try again.");

  const { error } = await auth.supabase.from("profiles").update({ avatar_url: key }).eq("id", auth.userId);
  if (error) {
    await deleteObject(key, auth.userId);
    return fail(500, "Couldn't update your photo. Please try again.");
  }
  if (previous.key !== key) await deleteObject(previous.key, auth.userId);

  return ok({ avatarUrl: key });
}

/** DELETE /api/profile/avatar: back to initials; the photo is deleted from R2. */
export async function DELETE() {
  const auth = await authed();
  if (!auth) return fail(401, "Please sign in again.");

  const previous = await currentAvatar(auth);
  if ("error" in previous) return fail(500, "Couldn't remove your photo. Please try again.");

  const { error } = await auth.supabase.from("profiles").update({ avatar_url: null }).eq("id", auth.userId);
  if (error) return fail(500, "Couldn't remove your photo. Please try again.");
  await deleteObject(previous.key, auth.userId);

  return ok({ avatarUrl: null });
}
