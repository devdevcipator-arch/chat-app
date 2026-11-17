/**
 * The app icon artwork (orange tile, white chat bubble), rendered by
 * next/og's ImageResponse for the favicon, the Apple touch icon and the PWA
 * manifest icons. Square and full-bleed: iOS and Android apply their own
 * corner mask. Only inline styles: ImageResponse doesn't run Tailwind.
 */
export function AppIconArt({ size }: { size: number }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #ff6b35 0%, #ff5722 55%, #e64a19 100%)",
      }}
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3.5c-4.97 0-9 3.36-9 7.5 0 2.15 1.08 4.08 2.82 5.45-.2 1.42-.86 2.72-1.82 3.8 2.06-.13 3.88-.86 5.2-1.9.9.2 1.83.3 2.8.3 4.97 0 9-3.36 9-7.5S16.97 3.5 12 3.5Z"
          fill="#ffffff"
        />
        <circle cx="8.2" cy="11" r="1.25" fill="#ff5722" />
        <circle cx="12" cy="11" r="1.25" fill="#ff5722" />
        <circle cx="15.8" cy="11" r="1.25" fill="#ff5722" />
      </svg>
    </div>
  );
}
