const sizes = {
  sm: "size-9 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
  xl: "size-28 text-4xl",
} as const;

// Initials placeholder until avatar uploads (R2) land.
export function Avatar({ name, size = "md" }: { name: string; size?: keyof typeof sizes }) {
  const initials = name.replace(/^@/, "").slice(0, 2) || "?";
  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 font-semibold text-white uppercase ${sizes[size]}`}
    >
      {initials}
    </div>
  );
}
