// Inline icons for the call UI (stroke icons, 24×24 grid).

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function PhoneIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}

/** Hang-up: the handset turned down. */
export function PhoneDownIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.3 14.6c-.6-.6-.7-1.6-.1-2.3C5.6 9.6 8.6 8.3 12 8.3s6.4 1.3 8.8 4c.6.7.5 1.7-.1 2.3l-1.6 1.6a1.6 1.6 0 0 1-2 .2l-1.8-1.1a1.6 1.6 0 0 1-.7-1.6l.2-1.3a11 11 0 0 0-5.6 0l.2 1.3c.1.6-.2 1.3-.7 1.6l-1.8 1.1a1.6 1.6 0 0 1-2-.2z" />
    </svg>
  );
}

export function MicIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="9" y="2.5" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
    </svg>
  );
}

export function MicOffIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M15 9.3V5.5a3 3 0 0 0-5.7-1.3M9 9v2.5a3 3 0 0 0 5 2.2M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11.2 5.6M12 18v3.5M3 3l18 18" />
    </svg>
  );
}

export function SettingsIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

export function MinimizeIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ExpandIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

export function VideoIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="M15.5 10.5l6-3.5v10l-6-3.5" />
    </svg>
  );
}

export function VideoOffIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10.5 6h2.5a2.5 2.5 0 0 1 2.5 2.5v2M15.5 13.5V15.5A2.5 2.5 0 0 1 13 18H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 5 6M15.5 10.5l6-3.5v10l-4-2.3M3 3l18 18" />
    </svg>
  );
}

/** Swap the main and picture-in-picture videos. */
export function FlipIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7 4L3 8l4 4M3 8h13a5 5 0 0 1 0 10h-2M17 20l4-4-4-4M21 16H8" />
    </svg>
  );
}

/** Share screen: a monitor with an arrow out of it. */
export function ScreenShareIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4M12 13V7M9 10l3-3 3 3" />
    </svg>
  );
}

/** Stop sharing: the monitor, crossed out. */
export function ScreenShareOffIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 21h8M12 17v4M17 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 1-1.7M7 3h13a2 2 0 0 1 2 2v10a2 2 0 0 1-1.3 1.9M2 2l20 20" />
    </svg>
  );
}
