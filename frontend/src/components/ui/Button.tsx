import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "toolbar";
export type ButtonSize = "sm" | "md";

// The single source of truth for button styling -- before this, every page
// duplicated the same "bg-edge-teal ... hover:bg-edge-teal-dark" string
// verbatim (21 occurrences across pages/*.tsx), which is how visual drift
// creeps in over time. Variants match what was already in use; "toolbar" is
// new, for grouped action rows (see Toolbar.tsx) where a bordered box per
// button read as 8 identical-weight buttons rather than one control bar.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-edge-teal text-edge-navy hover:bg-edge-teal-dark",
  secondary: "bg-surface2 text-text-muted hover:bg-surface3 hover:text-text",
  danger: "text-danger hover:bg-danger/10",
  ghost: "text-edge-teal hover:underline",
  toolbar: "text-text-muted hover:bg-surface hover:text-text",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
}

export function Button({ variant = "primary", size = "md", active = false, className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`rounded-edge-sm font-medium transition disabled:opacity-50 disabled:hover:bg-transparent ${SIZE_CLASSES[size]} ${
        active && variant === "toolbar" ? "bg-surface text-text shadow-edge-sm" : VARIANT_CLASSES[variant]
      } ${className}`}
      {...props}
    />
  );
}
