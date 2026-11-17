import { ImageResponse } from "next/og";
import { AppIconArt } from "@/components/app-icon-art";

// Served at /icon/192 and /icon/512; app/manifest.ts points at them.
export function generateImageMetadata() {
  return [192, 512].map((px) => ({
    id: String(px),
    size: { width: px, height: px },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const px = Number(await id);
  return new ImageResponse(<AppIconArt size={px} />, { width: px, height: px });
}
