/** Instant skeleton for the employee redemption screen. */
export default function EmployeeLoading() {
  return (
    <div className="container max-w-xl py-10">
      <div className="animate-pulse space-y-6" aria-busy="true" aria-label="טוען…">
        <div className="h-8 w-40 rounded-md bg-muted" />
        <div className="h-4 w-72 max-w-full rounded bg-muted" />
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-11 rounded-md bg-muted" />
          <div className="h-11 rounded-md bg-muted" />
        </div>
      </div>
    </div>
  )
}
