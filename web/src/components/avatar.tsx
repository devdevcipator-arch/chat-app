const sizes = {
  xs: "size-5 text-[9px]",
  sm: "size-9 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
  xl: "size-28 text-4xl",
} as const;

// Initials placeholder until avatar uploads (R2) land. Groups get their own
// colour so they're easy to tell apart from people in the list.
export function Avatar({
  name,
  size = "md",
  group = false,
}: {
  name: string;
  size?: keyof typeof sizes;
  group?: boolean;
}) {
  const initials = name.replace(/^@/, "").slice(0, 2) || "?";
  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white uppercase ${
        group ? "from-emerald-500 to-teal-600" : "from-indigo-500 to-violet-600"
      } ${sizes[size]}`}
    >
      {initials}
    </div>
  );
}
