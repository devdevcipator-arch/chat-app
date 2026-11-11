import type { Metadata } from "next";
import { CallProvider } from "../chat/call/call-provider";

export const metadata: Metadata = { title: "Profile & Settings · Chat App" };

// Calls keep ringing while you're in settings.
export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return <CallProvider>{children}</CallProvider>;
}
