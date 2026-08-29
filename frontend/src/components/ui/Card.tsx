import { forwardRef, type HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  // Opt-in navy->teal top edge, not a default -- Org Chart's own KPI strip
  // deliberately dropped a per-card accent hue for exactly this reason (see
  // its StatStrip comment): a repeating list of cards each carrying their
  // own color stripe competes for attention instead of signaling anything.
  // A single consistent two-color accent doesn't have that per-card-hue
  // problem, but it's still visual weight -- reserved for a page's primary
  // framing panel(s), not the ~15 repeating task/project/goal/KPI row-cards
  // in Employee 360 or any other list-of-cards pattern.
  accent?: boolean;
}

// Shadow-based elevation instead of a visible border on every card --
// `border border-border` wrapping every panel/row/box across the app
// (Org Admin, Goals, Users, RBAC Admin, ...) is what gave the app a
// spreadsheet/wireframe look rather than a premium one. One shared
// definition here so every page gets the same treatment automatically
// instead of re-deciding it per page. Forwards ref since a couple of
// call sites (Org Chart's viewport) need to measure their own DOM node.
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ className = "", accent = false, children, ...props }, ref) {
  return (
    <div ref={ref} className={`relative overflow-hidden rounded-edge-lg bg-surface shadow-edge-sm ${className}`} {...props}>
      {accent && <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-edge-navy to-edge-teal" />}
      {children}
    </div>
  );
});
