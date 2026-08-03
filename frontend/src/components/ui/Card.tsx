import { forwardRef, type HTMLAttributes } from "react";

// Shadow-based elevation instead of a visible border on every card --
// `border border-border` wrapping every panel/row/box across the app
// (Org Admin, Goals, Users, RBAC Admin, ...) is what gave the app a
// spreadsheet/wireframe look rather than a premium one. One shared
// definition here so every page gets the same treatment automatically
// instead of re-deciding it per page. Forwards ref since a couple of
// call sites (Org Chart's viewport) need to measure their own DOM node.
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card({ className = "", ...props }, ref) {
  return <div ref={ref} className={`rounded-edge-lg bg-surface shadow-edge-sm ${className}`} {...props} />;
});
