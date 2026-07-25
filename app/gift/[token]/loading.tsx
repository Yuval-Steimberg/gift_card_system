/** Instant skeleton for the recipient gift-card page while it loads. */
export default function GiftLoading() {
  return (
    <div className="container max-w-lg py-10">
      <div className="animate-pulse space-y-6" aria-busy="true" aria-label="טוען…">
        <div className="mx-auto h-6 w-40 rounded bg-muted" />
        <div className="aspect-[1.6/1] w-full rounded-2xl border border-border bg-card" />
        <div className="mx-auto h-24 w-24 rounded-lg bg-muted" />
        <div className="mx-auto h-5 w-48 rounded bg-muted" />
      </div>
    </div>
  )
}
