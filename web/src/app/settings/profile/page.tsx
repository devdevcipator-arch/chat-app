import { Suspense } from "react";
import { getOnboardedProfile } from "@/lib/auth";
import { ProfileSettings } from "./profile-settings";

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfileLoader />
    </Suspense>
  );
}

// Reads the session (server-side auth check), so it streams in.
async function ProfileLoader() {
  const me = await getOnboardedProfile();
  return <ProfileSettings me={me} />;
}

function ProfileSkeleton() {
  return (
    <div className="min-h-dvh animate-pulse">
      <div className="flex h-16 items-center gap-4 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <div className="h-4 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-5 w-44 rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="mx-auto max-w-2xl space-y-6 p-4">
        <div className="flex items-center gap-5 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
          <div className="size-28 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-3 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
        <div className="h-40 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </div>
  );
}
