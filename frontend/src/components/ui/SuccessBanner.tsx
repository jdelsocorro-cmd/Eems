// Mirrors ErrorBanner's shape -- same success/success-soft tokens already
// used for the "done" task-status badge and score displays, just promoted
// to a shared banner instead of being redefined per page.
export function SuccessBanner({ message, className = "" }: { message: string; className?: string }) {
  return <p className={`rounded-edge-sm bg-success-soft px-3 py-2 text-sm text-success ${className}`}>{message}</p>;
}
