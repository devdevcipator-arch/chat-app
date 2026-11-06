import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, Spinner } from "@/components/auth-card";
import { getSessionProfile } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Choose your username · Chat App" };

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <AuthCard>
          <div className="flex justify-center py-10 text-zinc-400">
            <Spinner />
          </div>
        </AuthCard>
      }
    >
      <OnboardingGate />
    </Suspense>
  );
}

// Server-side re-check (the proxy is only an optimistic guard).
async function OnboardingGate() {
  const profile = await getSessionProfile();
  if (profile.username) redirect("/chat");
  return <OnboardingForm userId={profile.id} />;
}
