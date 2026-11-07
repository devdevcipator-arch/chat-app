"use client";

import type { ICameraVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import { useEffect, useRef } from "react";

/**
 * Renders an Agora video track into a div. A track plays in one element at
 * a time, so mounting it somewhere else (minimizing, flipping the layout)
 * simply moves it; nothing is stopped on unmount. Capture is released by the
 * session when the camera is turned off or the call ends.
 */
export function VideoView({
  track,
  mirror = false,
  fit = "cover",
  className = "",
}: {
  track: ICameraVideoTrack | IRemoteVideoTrack;
  mirror?: boolean;
  fit?: "cover" | "contain";
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    if (el) track.play(el, { fit, mirror });
  }, [track, mirror, fit]);

  return <div ref={container} className={`overflow-hidden bg-black ${className}`} />;
}
