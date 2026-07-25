/**
 * Instant loading skeleton for every /admin page. Without this, App Router shows
 * the previous page frozen until the server responds (force-dynamic + Supabase
 * reads), which reads as "slow". This streams immediately on navigation so the
 * transition feels instant while data loads.
 */
export default function AdminLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="טוען…">
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border border-border bg-card" />
        ))}
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 rounded-md bg-muted" />
        ))}
      </div>
    </div>
  )
}
