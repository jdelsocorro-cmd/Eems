import { useEffect, useState, type RefObject } from "react";

import type { Position } from "@/lib/types";
import { legendSwatchClass } from "@/components/orgchart/OrgChartLegend";

interface MinimapNode {
  position: Position;
  colorIndex: number;
  children: MinimapNode[];
}

const MINIMAP_WIDTH = 176;
const MINIMAP_HEIGHT = 108;

// Non-interactive, structural-only preview -- not a scaled clone of the
// real interactive tree (that would duplicate all its click handlers at a
// size too small to use, and cloning a live DOM subtree cheaply isn't
// practical). Just colored blocks conveying "there's a tree, here's roughly
// its shape," plus the one genuinely useful part: a viewport rectangle
// tracking the real scroll position, and click-to-jump.
function MinimapBox({ node, depth }: { node: MinimapNode; depth: number }) {
  if (depth > 2) return null;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={`h-1.5 w-3 rounded-[1px] ${legendSwatchClass(node.colorIndex)} opacity-80`} />
      {node.children.length > 0 && depth < 2 && (
        <div className="flex gap-0.5">
          {node.children.slice(0, 6).map((child) => (
            <MinimapBox key={child.position.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function OrgChartMinimap({
  tree,
  viewportRef,
  contentSize,
  zoom,
}: {
  tree: MinimapNode[];
  viewportRef: RefObject<HTMLDivElement>;
  contentSize: { width: number; height: number };
  zoom: number;
}) {
  const [scroll, setScroll] = useState({ left: 0, top: 0, clientWidth: 0, clientHeight: 0 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function update() {
      if (!el) return;
      setScroll({ left: el.scrollLeft, top: el.scrollTop, clientWidth: el.clientWidth, clientHeight: el.clientHeight });
    }
    update();
    el.addEventListener("scroll", update);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [viewportRef, tree]);

  if (tree.length === 0 || contentSize.width === 0) return null;

  const totalWidth = contentSize.width * zoom;
  const totalHeight = contentSize.height * zoom;
  const rectLeft = (scroll.left / totalWidth) * 100;
  const rectTop = (scroll.top / totalHeight) * 100;
  const rectWidth = Math.min(100, (scroll.clientWidth / totalWidth) * 100);
  const rectHeight = Math.min(100, (scroll.clientHeight / totalHeight) * 100);

  function jumpTo(e: React.MouseEvent<HTMLDivElement>) {
    const el = viewportRef.current;
    if (!el) return;
    const box = e.currentTarget.getBoundingClientRect();
    const fracX = (e.clientX - box.left) / box.width;
    const fracY = (e.clientY - box.top) / box.height;
    el.scrollTo({
      left: Math.max(0, fracX * totalWidth - el.clientWidth / 2),
      top: Math.max(0, fracY * totalHeight - el.clientHeight / 2),
      behavior: "smooth",
    });
  }

  return (
    <div
      onClick={jumpTo}
      title="Click to jump"
      className="relative cursor-pointer overflow-hidden rounded-edge-sm border border-border bg-surface2 opacity-50 transition-opacity hover:opacity-100 focus-within:opacity-100"
      style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
    >
      <div className="flex h-full w-full items-start justify-center gap-2 overflow-hidden p-2">
        {tree.map((node) => (
          <MinimapBox key={node.position.id} node={node} depth={0} />
        ))}
      </div>
      <div
        className="pointer-events-none absolute rounded-[2px] border border-edge-teal bg-edge-teal/10"
        style={{
          left: `${rectLeft}%`,
          top: `${rectTop}%`,
          width: `${rectWidth}%`,
          height: `${rectHeight}%`,
        }}
      />
    </div>
  );
}

export type { MinimapNode };
