// Was redefined identically (with drifting padding/size) in 8 separate
// pages -- OrgAdmin used text-xs/px-2/py-1/mt-1, UserManagement used
// text-sm/px-3/py-2/mt-2, etc. One definition, spacing left to the caller.
export function ErrorBanner({ message, className = "" }: { message: string; className?: string }) {
  return <p className={`rounded-edge-sm bg-danger/10 px-3 py-2 text-sm text-danger ${className}`}>{message}</p>;
}
