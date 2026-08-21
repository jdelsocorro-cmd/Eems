// Employee.avatar_url is fetched into the type (lib/types.ts) but no
// employee in real data has one set and nothing in the app renders it --
// building photo upload/storage is out of scope for an org chart redesign.
// Initials on a color swatch gives the same "who is this at a glance" value
// with zero new backend work. Color comes from the SAME department palette
// map the chart nodes and legend use (colorIndex), so an avatar always
// matches its person's department color everywhere it appears.
// 12 entries, not 5 -- with only 5, EDGE Tutor's real 11 departments wrapped
// the index and THREE different departments (Account Management, People &
// Culture, Workforce & BI) rendered as the identical color, confirmed live
// (the legend visibly repeated colors). The first 5 stay the existing
// design-system semantic tokens; the rest are Tailwind's default palette --
// available with zero new dependency since tailwind.config.ts uses `extend`,
// not a full override, so Tailwind's built-in colors were never removed.
const AVATAR_PALETTE = [
  "bg-edge-teal/15 text-edge-teal",
  "bg-info/15 text-info",
  "bg-success/15 text-success",
  "bg-warning/15 text-warning",
  "bg-danger/15 text-danger",
  "bg-purple-100 text-purple-600",
  "bg-pink-100 text-pink-600",
  "bg-indigo-100 text-indigo-600",
  "bg-cyan-100 text-cyan-600",
  "bg-lime-100 text-lime-700",
  "bg-orange-100 text-orange-600",
  "bg-violet-100 text-violet-600",
];

const SIZE_CLASSES = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
};

export function avatarColorClass(colorIndex: number): string {
  return AVATAR_PALETTE[colorIndex % AVATAR_PALETTE.length];
}

export function initials(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  return `${a}${b}`.toUpperCase() || "?";
}

export function EmployeeAvatar({
  firstName,
  lastName,
  colorIndex,
  size = "md",
  className = "",
}: {
  firstName: string;
  lastName: string;
  colorIndex: number;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${SIZE_CLASSES[size]} ${avatarColorClass(colorIndex)} ${className}`}
    >
      {initials(firstName, lastName)}
    </span>
  );
}
