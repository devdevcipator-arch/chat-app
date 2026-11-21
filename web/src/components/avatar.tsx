"use client";

import { useState } from "react";
import { avatarPublicUrl } from "@/lib/profile";

const sizes = {
  xs: "size-5 text-[9px]",
  sm: "size-9 text-xs",
  md: "size-9 text-xs sm:size-10 sm:text-sm",
  /** Conversation list rows: 48px on phones, the usual 40px on desktop. */
  row: "size-12 text-base md:size-10 md:text-sm",
  lg: "size-12 text-base sm:size-14 sm:text-lg",
  xl: "size-24 text-3xl sm:size-28 sm:text-4xl",
} as const;

// A profile photo (an R2 avatar key) or coloured initials. Groups get their
// own colour so they're easy to tell apart from people in the list.
export function Avatar({
  name,
  src,
  size = "md",
  group = false,
}: {
  name: string;
  /** avatars/<userId>/<id>.<ext> key from profiles.avatar_url, or a local preview URL. */
  src?: string | null;
  size?: keyof typeof sizes;
  group?: boolean;
}) {
  const url = src?.startsWith("blob:") ? src : avatarPublicUrl(src);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials = name.replace(/^@/, "").slice(0, 2) || "?";

  if (url && failedUrl !== url) {
    return (
      // Small, already-resized images from R2; next/image would only re-proxy them.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        aria-hidden
        // Square; CSS sets the real size (20–112 px). Long lists load avatars as they scroll in.
        width={48}
        height={48}
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(url)}
        className={`shrink-0 rounded-full bg-zinc-200 object-cover dark:bg-zinc-800 ${sizes[size]}`}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white uppercase ${
        group ? "from-emerald-500 to-teal-600" : "from-indigo-500 to-red-700"
      } ${sizes[size]}`}
    >
      {initials}
    </div>
  );
}
