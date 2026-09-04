import type { ReactNode } from "react";

// The same header/row/cell recipe was hand-retyped independently in 10
// pages (px-4 py-2 text-sm, border-b border-border, the uppercase muted
// header row) -- already visibly drifted in two places before this existed
// (one page ran a smaller type scale, another ran two different row
// densities in the same page). One shared set of primitives, modeled on
// Card/Button's own minimal-footprint style: purely presentational, no
// bundled sorting/filtering state, since that already varies per page.
export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <table className={`w-full text-sm ${className}`}>{children}</table>;
}

export function TableHead({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <thead className={className}>
      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">{children}</tr>
    </thead>
  );
}

export function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <th className={`px-4 py-2 ${className}`}>{children}</th>;
}

export function Tr({
  children,
  onClick,
  selected = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}) {
  // Zebra striping (even:) only applies when the row isn't selected -- kept
  // as an explicit branch rather than layering both classes and trusting
  // Tailwind's cascade order, so a selected+even row never has to rely on
  // which utility happens to win. Hover uses surface3 (one step darker than
  // the surface2 zebra tint) so hover still reads clearly on striped rows,
  // not just odd ones.
  return (
    <tr
      onClick={onClick}
      className={`border-b border-border last:border-0 ${selected ? "bg-nav-active" : "even:bg-surface2"} ${
        onClick ? "cursor-pointer hover:bg-surface3" : ""
      } ${className}`}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  className = "",
  colSpan,
  onClick,
  style,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}) {
  return (
    <td className={`px-4 py-2 ${className}`} colSpan={colSpan} onClick={onClick} style={style}>
      {children}
    </td>
  );
}

export function TableEmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-6 text-center text-text-dim">
        {message}
      </td>
    </tr>
  );
}
