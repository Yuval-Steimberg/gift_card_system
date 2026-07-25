/** Instant skeleton for the purchase funnel while templates/settings load. */
export default function GiftCardsLoading() {
  return (
    <div className="container py-10">
      <div className="animate-pulse space-y-6" aria-busy="true" aria-label="טוען…">
        <div className="h-9 w-64 rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full rounded bg-muted" />
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="min-h-[360px] rounded-lg border border-border bg-card p-6">
            <div className="mb-6 flex flex-wrap gap-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-7 w-16 rounded-full bg-muted" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 rounded-md bg-muted" />
              ))}
            </div>
          </div>
          <div className="hidden h-56 rounded-xl border border-border bg-card lg:block" />
        </div>
      </div>
    </div>
  )
}
