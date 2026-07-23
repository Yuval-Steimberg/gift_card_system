import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getPublicView } from '@/lib/gift-cards/service'
import { getSettings } from '@/lib/gift-cards/service'
import { getStore } from '@/lib/data'
import { qrDataUrl } from '@/lib/gift-cards/qr'
import { formatMoney } from '@/lib/money'
import { GiftCardPreview } from '@/components/gift-card/gift-card-preview'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download } from '@/components/icons'
import { STATUS_LABEL_HE } from '@/lib/gift-cards/status'
import { ReportLost } from '@/components/gift-card/report-lost'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false } }

const VOID_STATUSES = new Set(['cancelled', 'refunded', 'reissued', 'failed'])

export default async function GiftPage({ params }: { params: { token: string } }) {
  const view = await getPublicView(params.token)
  if (!view) notFound()
  const [settings, template] = await Promise.all([getSettings(), getStore().getTemplate(view.templateId)])
  const tpl = template ?? { backgroundColor: '#333D36', textColor: '#FFFCF5', accentColor: '#E88225', name: '' }
  const qr = await qrDataUrl(view.qrUrl)
  const isVoid = VOID_STATUSES.has(view.status)
  const isLive = view.status === 'active' || view.status === 'partially_redeemed'

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto max-w-md space-y-6">
        <GiftCardPreview
          template={tpl}
          amountMinor={view.balanceMinor}
          recipientName={view.recipientName}
          senderName={view.senderName}
          greeting={view.greeting}
          code={view.code}
        />

        <div className="rounded-lg border border-border bg-card p-5 shadow-jas-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">סטטוס</span>
            <Badge variant={isLive ? 'success' : isVoid ? 'destructive' : 'warning'}>{STATUS_LABEL_HE[view.status]}</Badge>
          </div>

          {isVoid ? (
            <p className="mt-4 text-sm text-muted-foreground">
              השובר אינו פעיל עוד. אם זו טעות, פנו לחנות {settings.businessName}.
            </p>
          ) : (
            <>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">יתרה נוכחית</dt>
                  <dd className="text-lg font-bold" dir="ltr" style={{ unicodeBidi: 'embed' }}>
                    {formatMoney(view.balanceMinor, view.currency)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">ערך מקורי</dt>
                  <dd dir="ltr" style={{ unicodeBidi: 'embed' }}>
                    {formatMoney(view.initialAmountMinor, view.currency)}
                  </dd>
                </div>
                {view.expiresAt && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">בתוקף עד</dt>
                    <dd dir="ltr" style={{ unicodeBidi: 'embed' }}>
                      {view.expiresAt.slice(0, 10)}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="mt-5 flex flex-col items-center gap-3 rounded-md bg-background p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="קוד QR לפדיון השובר" width={176} height={176} className="rounded" />
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">קוד לפדיון ידני</div>
                  <div className="font-mono text-lg font-bold" dir="ltr" style={{ unicodeBidi: 'embed' }}>
                    {view.code}
                  </div>
                </div>
              </div>

              <Button asChild variant="outline" className="mt-4 w-full">
                <a href={`/gift/${view.publicToken}/pdf`} target="_blank" rel="noopener">
                  <Download className="h-4 w-4" />
                  הורדת PDF
                </a>
              </Button>
            </>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 text-sm shadow-jas-1">
          <h2 className="font-bold">מימוש בחנות</h2>
          <p className="mt-1 text-muted-foreground">
            הציגו את הקוד או ה-QR בקופה. {settings.businessName} · {settings.storeAddress} ·{' '}
            <span dir="ltr" style={{ unicodeBidi: 'embed' }}>
              {settings.businessPhone}
            </span>
          </p>
          <div className="mt-3 flex items-center justify-between">
            <a href="/terms" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
              תנאי השובר
            </a>
            <ReportLost token={view.publicToken} />
          </div>
        </div>
      </div>
    </main>
  )
}
