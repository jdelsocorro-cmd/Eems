// Employee.avatar_url is fetched into the type (lib/types.ts) but no
// employee in real data has one set and nothing in the app renders it --
// building photo upload/storage is out of scope for an org chart redesign.
// Initials on a color swatch gives the same "who is this at a glance" value
// with zero new backend work. Color comes from the SAME department palette
// map the chart nodes and legend use (colorIndex), so an avatar always
// matches its person's department color everywhere it appears.
// 12 entries, evenly spaced 30 degrees apart around the hue wheel starting
// at the brand teal's own hue (165 degrees), computed once (not hand-picked)
// so every pair is guaranteed at least 30deg apart -- comfortably above the
// ~20-25deg threshold generally needed for adjacent categorical colors to
// read as clearly different, not just technically-different hex values.
//
// This replaces two earlier attempts that both failed for the same root
// cause -- "distinct enough" was never actually checked, just assumed:
// (1) a 5-color palette that wrapped for real 11-department data (three
// departments landed on the identical class), and (2) a 12-color fix built
// from hand-picked Tailwind default shades that turned out to contain three
// same-hue-family pairs (teal/green, orange/orange, blue/cyan) -- distinct
// classes, near-identical hues, confirmed by pulling getComputedStyle() RGB
// values live and finding same-hue pairs only ~40-50 RGB-units apart.
// Light bg / darker text at each hue, sized for legibility behind initials.
const AVATAR_PALETTE = [
  "bg-[#d7f4ed] text-[#238b71]",
  "bg-[#d7edf4] text-[#23718b]",
  "bg-[#d7def4] text-[#233d8b]",
  "bg-[#ded7f4] text-[#3d238b]",
  "bg-[#edd7f4] text-[#71238b]",
  "bg-[#f4d7ed] text-[#8b2371]",
  "bg-[#f4d7de] text-[#8b233d]",
  "bg-[#f4ded7] text-[#8b3d23]",
  "bg-[#f4edd7] text-[#8b7123]",
  "bg-[#edf4d7] text-[#718b23]",
  "bg-[#def4d7] text-[#3d8b23]",
  "bg-[#d7f4de] text-[#238b3d]",
];

// Solid version of the palette above, for contexts that want a filled
// department-colored circle with white text instead of the soft tinted
// swatch (Org Chart's node cards, to match the premium mockup's avatar
// treatment). Same 12 hex values as AVATAR_PALETTE/SWATCH_PALETTE
// (OrgChartLegend.tsx) -- must stay the same length/order, all three are
// indexed by the same colorIndex.
const SOLID_PALETTE = [
  "bg-[#2fc6a0]",
  "bg-[#2fa0c6]",
  "bg-[#2f54c6]",
  "bg-[#542fc6]",
  "bg-[#a02fc6]",
  "bg-[#c62fa0]",
  "bg-[#c62f54]",
  "bg-[#c6542f]",
  "bg-[#c6a02f]",
  "bg-[#a0c62f]",
  "bg-[#54c62f]",
  "bg-[#2fc654]",
];

const SIZE_CLASSES = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
};

export function avatarColorClass(colorIndex: number): string {
  return AVATAR_PALETTE[colorIndex % AVATAR_PALETTE.length];
}

export function solidAvatarColorClass(colorIndex: number): string {
  return SOLID_PALETTE[colorIndex % SOLID_PALETTE.length];
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
  variant = "soft",
  className = "",
}: {
  firstName: string;
  lastName: string;
  colorIndex: number;
  size?: keyof typeof SIZE_CLASSES;
  variant?: "soft" | "solid";
  className?: string;
}) {
  const colorClass = variant === "solid" ? `${solidAvatarColorClass(colorIndex)} text-white` : avatarColorClass(colorIndex);
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${SIZE_CLASSES[size]} ${colorClass} ${className}`}>
      {initials(firstName, lastName)}
    </span>
  );
}
