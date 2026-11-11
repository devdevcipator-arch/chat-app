"use client";

import { useState } from "react";
import type { GalleryItem } from "@/lib/vault";
import { FileIcon, MusicIcon, PlayIcon } from "./icons";

/** Square preview of a gallery item: the image, a video frame, or a type tile. */
export function Thumbnail({ item }: { item: GalleryItem }) {
  const [failed, setFailed] = useState(false);

  if (item.kind === "image" && item.url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="size-full object-cover transition duration-300 group-hover/card:scale-[1.03]"
      />
    );
  }

  if (item.kind === "video" && item.url && !failed) {
    return (
      <span className="relative block size-full bg-black">
        <video
          src={`${item.url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          onError={() => setFailed(true)}
          className="pointer-events-none size-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
            <PlayIcon className="ml-0.5 size-5" />
          </span>
        </span>
      </span>
    );
  }

  const ext = item.key.split(".").pop()?.toUpperCase() ?? "";
  const audio = item.kind === "audio";
  return (
    <span
      className={`flex size-full flex-col items-center justify-center gap-2 ${
        audio
          ? "bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white"
          : "bg-gradient-to-br from-zinc-100 to-zinc-200 text-zinc-600 dark:from-zinc-800 dark:to-zinc-900 dark:text-zinc-300"
      }`}
    >
      {audio ? <MusicIcon className="size-9" /> : <FileIcon className="size-9" />}
      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${audio ? "bg-white/20" : "bg-white/70 dark:bg-black/30"}`}>
        {ext}
      </span>
    </span>
  );
}
