import type { Metadata } from "next";
import { CallProvider } from "../chat/call/call-provider";

export const metadata: Metadata = { title: "My Gallery · Chat App" };

// Calls keep ringing while you're in the gallery.
export default function GalleryLayout({ children }: LayoutProps<"/gallery">) {
  return <CallProvider>{children}</CallProvider>;
}
