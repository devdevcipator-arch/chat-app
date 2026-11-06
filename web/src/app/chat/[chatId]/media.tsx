"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

// --- Image bubble -----------------------------------------------------------

export function ImageMessage({
  src,
  progress,
  sending,
  onOpen,
}: {
  src: string | null;
  progress?: number;
  sending: boolean;
  onOpen: (src: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-32 w-48 items-center justify-center rounded-2xl bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-800">
        Image unavailable
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => loaded && onOpen(src)}
      disabled={!loaded}
      aria-label="Open image"
      className="group relative block overflow-hidden rounded-2xl bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-zinc-800"
    >
      {/* Remote R2 images are already compressed; next/image would only re-proxy them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Shared image"
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`block max-h-80 w-auto max-w-[min(18rem,70vw)] object-cover transition duration-300 group-hover:brightness-95 ${
          loaded ? "opacity-100" : "min-h-40 min-w-48 opacity-0"
        }`}
      />
      {!loaded && <div aria-hidden className="absolute inset-0 animate-pulse bg-zinc-200 dark:bg-zinc-700" />}
      {sending && <UploadOverlay progress={progress} />}
    </button>
  );
}

function UploadOverlay({ progress }: { progress?: number }) {
  const pct = Math.round((progress ?? 0) * 100);
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/35">
      <svg viewBox="0 0 40 40" className="size-11 -rotate-90" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Uploading">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - (progress ?? 0))}
          className="transition-[stroke-dashoffset] duration-200"
        />
      </svg>
      <span className="absolute text-[10px] font-semibold text-white">{pct}%</span>
    </div>
  );
}

// --- Audio bubble -----------------------------------------------------------

export function AudioMessage({ src, mine }: { src: string | null; mine: boolean }) {
  if (!src) {
    return <p className="rounded-2xl bg-zinc-100 px-3.5 py-2 text-xs text-zinc-500 dark:bg-zinc-800">Audio unavailable</p>;
  }
  return (
    <div className={`rounded-2xl p-1.5 ${mine ? "bg-indigo-600" : "bg-zinc-100 dark:bg-zinc-800"}`}>
      <audio controls preload="metadata" src={src} className="h-10 w-64 max-w-[70vw]">
        <track kind="captions" />
      </audio>
    </div>
  );
}

// --- Lightbox ---------------------------------------------------------------

export function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!src) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus();
    };
  }, [src, onClose]);

  return (
    <AnimatePresence>
      {src && (
        <motion.div
          key="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="relative"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="Shared image, full size" className="max-h-[85dvh] max-w-[92vw] rounded-lg object-contain shadow-2xl" />
          </motion.div>

          <div className="absolute top-3 right-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-white/10 px-3 py-2 text-sm text-white backdrop-blur transition hover:bg-white/20"
            >
              Open original
            </a>
            <button
              ref={closeButton}
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="rounded-full bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/20"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
