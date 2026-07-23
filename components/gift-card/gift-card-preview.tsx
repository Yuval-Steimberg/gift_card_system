import { formatMoney, type Currency, type Minor } from '@/lib/money'
import { isRtlText } from '@/lib/security/text'
import type { GiftCardTemplate } from '@/lib/gift-cards/types'
import { cn } from '@/lib/utils'

interface Props {
  template: Pick<GiftCardTemplate, 'backgroundColor' | 'textColor' | 'accentColor' | 'name'>
  amountMinor: Minor
  currency?: Currency
  recipientName?: string
  senderName?: string | null
  greeting?: string
  code?: string
  className?: string
}

/**
 * Presentational gift-card artwork. Preserves greeting line breaks, renders all
 * user text as plain text nodes (no HTML injection), and keeps money/code LTR.
 */
export function GiftCardPreview({
  template,
  amountMinor,
  currency = 'ILS',
  recipientName,
  senderName,
  greeting,
  code,
  className,
}: Props) {
  const greetingRtl = greeting ? isRtlText(greeting) : true
  return (
    <div
      className={cn('relative aspect-[1.6/1] w-full overflow-hidden rounded-2xl p-6 shadow-jas-3', className)}
      style={{ backgroundColor: template.backgroundColor, color: template.textColor }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: template.accentColor }}>
          Just A Second
        </span>
        <span className="text-xs opacity-70">שובר מתנה</span>
      </div>

      <div className="mt-4">
        <div className="text-4xl font-extrabold" dir="ltr" style={{ unicodeBidi: 'embed' }}>
          {formatMoney(amountMinor, currency)}
        </div>
        {recipientName ? <div className="mt-1 text-sm opacity-90">אל: {recipientName}</div> : null}
      </div>

      {greeting ? (
        <p
          className="mt-3 max-h-[3.2em] overflow-hidden whitespace-pre-line text-sm leading-snug opacity-90"
          dir={greetingRtl ? 'rtl' : 'ltr'}
        >
          {greeting}
        </p>
      ) : null}

      <div className="absolute inset-x-6 bottom-5 flex items-end justify-between">
        {senderName ? <span className="text-xs opacity-80">מאת {senderName}</span> : <span />}
        {code ? (
          <span className="rounded-md bg-black/15 px-2 py-1 font-mono text-[11px]" dir="ltr" style={{ unicodeBidi: 'embed' }}>
            {code}
          </span>
        ) : null}
      </div>
    </div>
  )
}
