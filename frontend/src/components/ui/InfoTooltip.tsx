import type { ReactNode } from "react";

const SIDE_CLASSES = {
  top: "bottom-full mb-2",
  bottom: "top-full mt-2",
} as const;

export function InfoTooltip({ content, side = "top" }: { content: ReactNode; side?: "top" | "bottom" }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-surface3 text-[10px] font-semibold text-text-muted outline-none focus-visible:ring-1 focus-visible:ring-edge-teal"
      >
        i
      </span>
      <span
        className={`pointer-events-none absolute left-1/2 z-20 w-64 -translate-x-1/2 rounded-edge-md bg-edge-navy p-3 text-xs normal-case leading-relaxed text-white opacity-0 shadow-edge-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${SIDE_CLASSES[side]}`}
      >
        {content}
      </span>
    </span>
  );
}

export function FieldLabel({
  children,
  tooltip,
  tooltipSide = "top",
}: {
  children: ReactNode;
  tooltip?: ReactNode;
  tooltipSide?: "top" | "bottom";
}) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <label className="text-xs font-medium text-text-muted">{children}</label>
      {tooltip && <InfoTooltip content={tooltip} side={tooltipSide} />}
    </div>
  );
}
