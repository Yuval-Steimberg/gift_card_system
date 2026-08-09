import { Heart } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * Where the money goes. Shown quietly — a statement of purpose, not a sales
 * pitch: muted text, small heart, no exclamation mark, never a heading.
 *
 * ONE sentence, ONE place to edit it. If the commitment is a share of profits
 * rather than all of them, change the wording here (e.g. "חלק מהרווחים שלנו
 * מוקדש ל…") — the claim is a promise to the customer, so keep it accurate.
 */
export const IMPACT_NOTE = 'הרווחים שלנו מוקדשים לסיוע נפשי לכוחות הביטחון.'

export function ImpactNote({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-start gap-2 text-sm text-muted-foreground', className)}>
      <Heart className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>{IMPACT_NOTE}</span>
    </p>
  )
}
