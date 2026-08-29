import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface ClusterBox {
  key: string;
  top: number;
  centerX: number;
}

interface RowConnector {
  busY: number;
  spanLeft: number;
  spanRight: number;
  stems: { key: string; centerX: number; top: number }[];
}

// The old connector technique (OrgChart.css's .org-tree rules -- two
// half-top-borders per <li> meeting at a shared boundary) is pure CSS: no
// layout math, but it only works because every child sits on ONE line. A
// manager with enough direct reports to need wrapping (9 across 5
// departments needs ~2500px on a single line -- measured live, not
// assumed) breaks that assumption outright: "first child" and "last
// child" stop being visually adjacent once they're on different rows.
//
// This measures real rendered positions after layout instead, groups
// children into whatever rows the browser's own flex-wrap produced, and
// draws a trunk down the center with one horizontal bus per row -- so it
// keeps working at 1, 2, 6, 9, or any other number of reports, however
// many rows that becomes at the viewport's actual width. Recomputes on
// resize/zoom (ResizeObserver) and whenever the item set changes (a new
// focus target, an expand/collapse toggle).
export function ChildrenConnectorLayout({
  items,
  layoutWidth,
}: {
  items: { key: string; content: ReactNode }[];
  // The chart canvas's own available width. Not read directly -- only
  // watched -- so that when it changes (the canvas settling into its real
  // bounded width after mount, a window resize, a zoom change) this
  // re-measures deterministically instead of hoping ResizeObserver notices
  // a reflow that may not change any single card's own size, only its row.
  layoutWidth: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [layout, setLayout] = useState<{ width: number; height: number; trunkBottom: number; rows: RowConnector[] } | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function measure() {
      const containerEl = containerRef.current;
      if (!containerEl) return;
      const containerRect = containerEl.getBoundingClientRect();

      const boxes: ClusterBox[] = [];
      itemRefs.current.forEach((el, key) => {
        const r = el.getBoundingClientRect();
        boxes.push({ key, top: r.top - containerRect.top, centerX: r.left - containerRect.left + r.width / 2 });
      });
      if (boxes.length === 0) {
        setLayout(null);
        return;
      }

      // Flex-wrap aligns every item in the same visual row to an identical
      // top (align-items: flex-start, the default) regardless of height
      // differences below -- e.g. a department cluster with more members
      // wrapping internally is taller than a single-card one, but both
      // still start at the row's own top. An 8px tolerance absorbs
      // sub-pixel rounding without merging genuinely different rows.
      const sorted = [...boxes].sort((a, b) => a.top - b.top);
      const rowGroups: ClusterBox[][] = [];
      for (const box of sorted) {
        const currentRow = rowGroups[rowGroups.length - 1];
        if (currentRow && Math.abs(currentRow[0].top - box.top) < 8) {
          currentRow.push(box);
        } else {
          rowGroups.push([box]);
        }
      }

      const trunkX = containerRect.width / 2;
      const stemLength = 20;
      const rows: RowConnector[] = rowGroups.map((row) => {
        const busY = row[0].top - stemLength;
        const xs = row.map((b) => b.centerX).concat(trunkX);
        return {
          busY,
          spanLeft: Math.min(...xs),
          spanRight: Math.max(...xs),
          stems: row.map((b) => ({ key: b.key, centerX: b.centerX, top: b.top })),
        };
      });

      setLayout({
        width: containerRect.width,
        // containerRect.height (normal-flow content height) rather than
        // scrollHeight: the SVG itself is an absolutely-positioned child of
        // this same container, so scrollHeight includes its own previous
        // footprint -- a stale oversized height would otherwise feed back
        // into the next measurement forever.
        height: containerRect.height,
        trunkBottom: rows[rows.length - 1]?.busY ?? 0,
        rows,
      });
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    itemRefs.current.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
    // itemRefs is a ref (stable identity); re-measuring keys off the actual
    // item list (a new focus target, an expand/collapse toggle) plus
    // layoutWidth (the canvas settling into its real bounded width after
    // mount, a window resize, a zoom change) -- both can change which row
    // an item wraps into without changing any single item's own size, which
    // ResizeObserver alone won't always catch in time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((item) => item.key).join("|"), layoutWidth]);

  return (
    <div ref={containerRef} className="relative pt-5">
      {layout && (
        <svg
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          <g className="text-text-dim" style={{ stroke: "color-mix(in srgb, currentColor 55%, transparent)" }} strokeWidth="1.5" fill="none">
            <line x1={layout.width / 2} y1={0} x2={layout.width / 2} y2={layout.trunkBottom} />
            {layout.rows.map((row, i) => (
              <g key={i}>
                <line x1={row.spanLeft} y1={row.busY} x2={row.spanRight} y2={row.busY} />
                {row.stems.map((stem) => (
                  <line key={stem.key} x1={stem.centerX} y1={row.busY} x2={stem.centerX} y2={stem.top} />
                ))}
              </g>
            ))}
          </g>
        </svg>
      )}
      <div className="flex flex-wrap justify-center gap-x-9 gap-y-8">
        {items.map((item) => (
          <div
            key={item.key}
            ref={(el) => {
              if (el) itemRefs.current.set(item.key, el);
              else itemRefs.current.delete(item.key);
            }}
          >
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
}
