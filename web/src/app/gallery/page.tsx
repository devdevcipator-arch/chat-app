import { Suspense } from "react";
import { getOnboardedProfile } from "@/lib/auth";
import { getMyChats } from "@/lib/chat-data";
import { getMyGallery } from "@/lib/vault-data";
import { GalleryView } from "./gallery-view";

export default function GalleryPage() {
  return (
    <Suspense fallback={<GallerySkeleton />}>
      <GalleryLoader />
    </Suspense>
  );
}

// Reads the session (server-side auth check), so it streams in.
async function GalleryLoader() {
  await getOnboardedProfile();
  const [items, chats] = await Promise.all([getMyGallery(), getMyChats()]);
  return <GalleryView initialItems={items} initialChats={chats} />;
}

function GallerySkeleton() {
  return (
    <div className="min-h-dvh animate-pulse">
      <div className="flex h-16 items-center gap-4 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <div className="h-4 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-5 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="aspect-square rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        ))}
      </div>
    </div>
  );
}
