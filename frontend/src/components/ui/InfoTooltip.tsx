import type { ReactNode } from "react";

export function InfoTooltip({ content }: { content: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-surface3 text-[10px] font-semibold text-text-muted outline-none focus-visible:ring-1 focus-visible:ring-edge-teal"
      >
        i
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-edge-md bg-edge-navy p-3 text-xs leading-relaxed text-white opacity-0 shadow-edge-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        {content}
      </span>
    </span>
  );
}

export function FieldLabel({ children, tooltip }: { children: ReactNode; tooltip?: ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <label className="text-xs font-medium text-text-muted">{children}</label>
      {tooltip && <InfoTooltip content={tooltip} />}
    </div>
  );
}
