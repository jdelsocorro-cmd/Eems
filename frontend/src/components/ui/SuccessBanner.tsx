import { IconCircleCheck } from "@tabler/icons-react";

// Mirrors ErrorBanner's shape -- same success/success-soft tokens already
// used for the "done" task-status badge and score displays, just promoted
// to a shared banner instead of being redefined per page. The pop-in
// entrance (motion-safe: only, so prefers-reduced-motion gets the same
// banner with no animation) is the one place this session's UX-delight
// pass adds a "moment" -- a real event (task assigned, and any future
// success confirmation reusing this component) gets to feel like it landed,
// instead of the state just silently appearing.
export function SuccessBanner({ message, className = "" }: { message: string; className?: string }) {
  return (
    <p
      className={`flex items-center gap-1.5 rounded-edge-sm bg-success-soft px-3 py-2 text-sm text-success motion-safe:animate-pop-in ${className}`}
    >
      <IconCircleCheck size={16} className="shrink-0" />
      {message}
    </p>
  );
}
