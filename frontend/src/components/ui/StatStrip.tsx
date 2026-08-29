import type { ComponentType } from "react";
import type { IconProps } from "@tabler/icons-react";

export interface StatTile {
  label: string;
  value: string;
  sub?: string;
  icon?: ComponentType<IconProps>;
}

// Extracted from Org Chart's own StatStrip -- the sizing Jayson specifically
// picked out ("I like the size of the cards and the font size here") --
// after finding three other pages had each grown their own differently-sized
// version of the same "labeled stat tile" idea (PerformanceReviewCenter's
// own StatStrip, Tasks.tsx's PerformanceStat, BulkImportAdmin's SummaryStat --
// all text-xs/text-lg, none with icons or a sub-caption). One definition
// here instead of a fifth copy the next time a page needs this.
//
// A single slim band with dividers, not N separately-elevated cards -- these
// are orientation numbers a user checks in passing, not decisions made from
// the screen they sit on, so they don't need card-level visual weight. Icon
// and sub-caption are both optional since not every caller has either.
export function StatStrip({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className="flex flex-wrap items-stretch divide-x divide-border rounded-edge-md border border-border bg-surface">
      {tiles.map((t) => (
        <div key={t.label} className="flex min-w-[170px] flex-1 items-center gap-2 px-3.5 py-2">
          {t.icon && <t.icon size={15} className="shrink-0 text-text-dim" />}
          <div className="min-w-0">
            <p className="truncate text-[10px] font-medium uppercase tracking-wide text-text-muted">{t.label}</p>
            <p className="truncate text-sm font-semibold leading-tight text-text" title={t.sub ? `${t.value} — ${t.sub}` : t.value}>
              {t.value}
            </p>
            {t.sub && <p className="truncate text-[10.5px] leading-tight text-text-dim">{t.sub}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
