// Employee.avatar_url is fetched into the type (lib/types.ts) but no
// employee in real data has one set and nothing in the app renders it --
// building photo upload/storage is out of scope for an org chart redesign.
// Initials on a color swatch gives the same "who is this at a glance" value
// with zero new backend work. Color comes from the SAME department palette
// map the chart nodes and legend use (colorIndex), so an avatar always
// matches its person's department color everywhere it appears.
const AVATAR_PALETTE = [
  "bg-edge-teal/15 text-edge-teal",
  "bg-info/15 text-info",
  "bg-success/15 text-success",
  "bg-warning/15 text-warning",
  "bg-danger/15 text-danger",
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
