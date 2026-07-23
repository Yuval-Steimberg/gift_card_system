'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { GiftCardPreview } from '@/components/gift-card/gift-card-preview'
import { formatMoney, parseMajorToMinor } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Check, ChevronLeft, ChevronRight, Loader } from '@/components/icons'
import { startPurchase } from '@/app/actions/purchase'
import type { GiftCardTemplate } from '@/lib/gift-cards/types'
import type { SystemSettings } from '@/lib/data/store'

interface Props {
  templates: GiftCardTemplate[]
  settings: SystemSettings
}

const STEPS = ['סכום', 'עיצוב', 'הרוכש', 'הנמען', 'ברכה', 'מועד', 'סיכום'] as const

export function PurchaseWizard({ templates, settings }: Props) {
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // form state
  const [amountMinor, setAmountMinor] = useState<number>(settings.presetAmountsMinor[1] ?? settings.minAmountMinor)
  const [customAmount, setCustomAmount] = useState('')
  const [templateId, setTemplateId] = useState(templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? '')
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [wantsInvoice, setWantsInvoice] = useState(false)
  const [buyerCompany, setBuyerCompany] = useState('')
  const [buyerTaxId, setBuyerTaxId] = useState('')
  const [sendAnonymously, setSendAnonymously] = useState(false)
  const [showBuyerName, setShowBuyerName] = useState(true)
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [recipientLanguage, setRecipientLanguage] = useState<'he' | 'en'>(settings.defaultLanguage)
  const [greeting, setGreeting] = useState('')
  const [deliveryTiming, setDeliveryTiming] = useState<'immediate' | 'scheduled'>('immediate')
  const [scheduledLocal, setScheduledLocal] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)

  const template = useMemo(() => templates.find((t) => t.id === templateId) ?? templates[0], [templates, templateId])
  const senderTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || settings.timezone

  const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

  function stepValid(i: number): boolean {
    switch (i) {
      case 0:
        return amountMinor >= settings.minAmountMinor && amountMinor <= settings.maxAmountMinor
      case 1:
        return Boolean(templateId)
      case 2:
        return buyerName.trim().length >= 2 && emailOk(buyerEmail)
      case 3:
        return recipientName.trim().length >= 2 && emailOk(recipientEmail)
      case 4:
        return greeting.length <= settings.greetingMaxLength
      case 5:
        return deliveryTiming === 'immediate' || (Boolean(scheduledLocal) && new Date(scheduledLocal).getTime() > Date.now())
      case 6:
        return acceptedTerms
      default:
        return true
    }
  }

  const canNext = stepValid(step)

  function applyCustom(v: string) {
    setCustomAmount(v)
    const m = parseMajorToMinor(v)
    if (m != null) setAmountMinor(m)
  }

  async function submit() {
    setSubmitting(true)
    setServerError(null)
    const scheduledDeliveryAt =
      deliveryTiming === 'scheduled' && scheduledLocal ? new Date(scheduledLocal).toISOString() : null
    const res = await startPurchase({
      amountMinor,
      templateId,
      buyerName,
      buyerEmail,
      buyerPhone,
      buyerCompany,
      buyerTaxId,
      wantsInvoice,
      showBuyerName,
      sendAnonymously,
      recipientName,
      recipientEmail,
      recipientPhone,
      recipientLanguage,
      deliveryChannel: 'email',
      greeting,
      deliveryTiming,
      scheduledDeliveryAt,
      senderTimezone,
      acceptedTerms,
    })
    if (res.ok && res.redirectUrl) {
      window.location.href = res.redirectUrl
      return
    }
    setSubmitting(false)
    setServerError(res.message ?? 'אירעה שגיאה. נסו שוב.')
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        {/* progress */}
        <ol className="mb-8 flex flex-wrap gap-2" aria-label="שלבי רכישה">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => i <= step && setStep(i)}
                disabled={i > step}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  i === step && 'bg-primary text-primary-foreground',
                  i < step && 'bg-secondary text-secondary-foreground',
                  i > step && 'bg-muted text-muted-foreground',
                )}
                aria-current={i === step ? 'step' : undefined}
              >
                {i < step ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
                {label}
              </button>
            </li>
          ))}
        </ol>

        <div className="min-h-[320px] rounded-lg border border-border bg-card p-6 shadow-jas-1 animate-fade-up">
          {step === 0 && (
            <fieldset className="space-y-4">
              <legend className="text-lg font-bold">בחירת סכום</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {settings.presetAmountsMinor.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => {
                      setAmountMinor(a)
                      setCustomAmount('')
                    }}
                    className={cn(
                      'rounded-md border px-3 py-4 text-center text-lg font-bold transition-colors',
                      amountMinor === a && !customAmount ? 'border-primary bg-primary/10' : 'border-border bg-background hover:bg-muted',
                    )}
                    dir="ltr"
                  >
                    {formatMoney(a, settings.currency)}
                  </button>
                ))}
              </div>
              {settings.allowCustomAmount && (
                <div className="space-y-1.5">
                  <Label htmlFor="custom">סכום חופשי ({formatMoney(settings.minAmountMinor)}–{formatMoney(settings.maxAmountMinor)})</Label>
                  <Input
                    id="custom"
                    inputMode="decimal"
                    dir="ltr"
                    placeholder="₪ …"
                    value={customAmount}
                    onChange={(e) => applyCustom(e.target.value)}
                  />
                </div>
              )}
              {!stepValid(0) && <p className="text-sm text-destructive">הסכום מחוץ לטווח המותר.</p>}
            </fieldset>
          )}

          {step === 1 && (
            <fieldset className="space-y-4">
              <legend className="text-lg font-bold">בחירת עיצוב</legend>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      'overflow-hidden rounded-lg border-2 p-1 text-start transition',
                      templateId === t.id ? 'border-primary' : 'border-transparent hover:border-border',
                    )}
                    aria-pressed={templateId === t.id}
                  >
                    <div className="aspect-[1.6/1] w-full rounded-md" style={{ backgroundColor: t.backgroundColor }} />
                    <div className="px-1 py-1.5 text-xs font-medium">{t.name}</div>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset className="space-y-4">
              <legend className="text-lg font-bold">פרטי הרוכש/ת</legend>
              <Field label="שם מלא" value={buyerName} onChange={setBuyerName} required />
              <Field label="אימייל" type="email" dir="ltr" value={buyerEmail} onChange={setBuyerEmail} required />
              <Field label="טלפון (לא חובה)" type="tel" dir="ltr" value={buyerPhone} onChange={setBuyerPhone} />
              <Checkbox label="שליחה אנונימית (השם שלי לא יופיע על השובר)" checked={sendAnonymously} onChange={setSendAnonymously} />
              {!sendAnonymously && (
                <Checkbox label="הצגת שמי על השובר" checked={showBuyerName} onChange={setShowBuyerName} />
              )}
              <Checkbox label="אני צריך/ה חשבונית עסקית" checked={wantsInvoice} onChange={setWantsInvoice} />
              {wantsInvoice && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="שם חברה" value={buyerCompany} onChange={setBuyerCompany} />
                  <Field label="ח.פ / עוסק" dir="ltr" value={buyerTaxId} onChange={setBuyerTaxId} />
                </div>
              )}
            </fieldset>
          )}

          {step === 3 && (
            <fieldset className="space-y-4">
              <legend className="text-lg font-bold">פרטי הנמען/ת</legend>
              <Field label="שם הנמען/ת" value={recipientName} onChange={setRecipientName} required />
              <Field label="אימייל הנמען/ת" type="email" dir="ltr" value={recipientEmail} onChange={setRecipientEmail} required />
              <Field label="טלפון (לא חובה)" type="tel" dir="ltr" value={recipientPhone} onChange={setRecipientPhone} />
              <div className="space-y-1.5">
                <Label>שפת השובר</Label>
                <div className="flex gap-2">
                  {(['he', 'en'] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setRecipientLanguage(l)}
                      className={cn(
                        'rounded-full border px-4 py-1.5 text-sm',
                        recipientLanguage === l ? 'border-primary bg-primary/10' : 'border-border',
                      )}
                    >
                      {l === 'he' ? 'עברית' : 'English'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">משלוח באימייל (SMS/וואטסאפ יתווספו בהמשך).</p>
            </fieldset>
          )}

          {step === 4 && (
            <fieldset className="space-y-3">
              <legend className="text-lg font-bold">ברכה אישית</legend>
              <Textarea
                value={greeting}
                maxLength={settings.greetingMaxLength}
                onChange={(e) => setGreeting(e.target.value)}
                placeholder={'מזל טוב!\nמגיע לך משהו יפה מהחנות.'}
                dir="auto"
                rows={5}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>מעברי שורה נשמרים · טקסט בלבד</span>
                <span dir="ltr">
                  {greeting.length}/{settings.greetingMaxLength}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {['מזל טוב!', 'יום הולדת שמח', 'חג שמח', 'תודה רבה'].map((s) => (
                  <button key={s} type="button" className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted" onClick={() => setGreeting((g) => (g ? g : s))}>
                    {s}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {step === 5 && (
            <fieldset className="space-y-4">
              <legend className="text-lg font-bold">מועד משלוח</legend>
              <div className="flex gap-2">
                {(['immediate', 'scheduled'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDeliveryTiming(t)}
                    className={cn(
                      'flex-1 rounded-md border px-4 py-3 text-sm font-medium',
                      deliveryTiming === t ? 'border-primary bg-primary/10' : 'border-border',
                    )}
                  >
                    {t === 'immediate' ? 'מיידי (לאחר תשלום)' : 'מתוזמן'}
                  </button>
                ))}
              </div>
              {deliveryTiming === 'scheduled' && (
                <div className="space-y-1.5">
                  <Label htmlFor="sched">תאריך ושעה</Label>
                  <Input id="sched" type="datetime-local" dir="ltr" value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} />
                  <p className="text-xs text-muted-foreground">אזור זמן: {senderTimezone}. יישמר ב-UTC.</p>
                </div>
              )}
            </fieldset>
          )}

          {step === 6 && (
            <fieldset className="space-y-4">
              <legend className="text-lg font-bold">סיכום ואישור</legend>
              <dl className="divide-y divide-border rounded-md border border-border text-sm">
                <Row k="סכום" v={formatMoney(amountMinor, settings.currency)} ltr />
                <Row k="עיצוב" v={template?.name ?? ''} />
                <Row k="נמען/ת" v={recipientName} />
                <Row k="אימייל נמען/ת" v={recipientEmail} ltr />
                <Row k="מאת" v={sendAnonymously ? 'אנונימי' : buyerName} />
                <Row k="משלוח" v={deliveryTiming === 'immediate' ? 'מיידי' : new Date(scheduledLocal).toLocaleString('he-IL')} />
                {greeting ? <Row k="ברכה" v={greeting} /> : null}
              </dl>
              <Checkbox
                label="אני מאשר/ת את תנאי השובר (תוקף, פדיון בחנות, מדיניות החזרות)."
                checked={acceptedTerms}
                onChange={setAcceptedTerms}
              />
              {serverError && <p role="alert" className="text-sm text-destructive">{serverError}</p>}
            </fieldset>
          )}
        </div>

        {/* nav */}
        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || submitting}>
            <ChevronRight className="h-4 w-4" />
            הקודם
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext}>
              המשך
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={!canNext || submitting}>
              {submitting ? <Loader className="h-4 w-4" /> : null}
              המשך לתשלום
            </Button>
          )}
        </div>
      </div>

      {/* Live preview */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="eyebrow mb-3">תצוגה מקדימה</p>
        {template && (
          <GiftCardPreview
            template={template}
            amountMinor={amountMinor}
            recipientName={recipientName || undefined}
            senderName={sendAnonymously || !showBuyerName ? null : buyerName || undefined}
            greeting={greeting || undefined}
            code="JAS-••••-••••"
          />
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          השובר מונפק ונשלח רק לאחר אישור תשלום מאובטח.
        </p>
      </aside>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  dir,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  dir?: 'ltr' | 'rtl'
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label} {required && <span className="text-primary">*</span>}
      </Label>
      <Input type={type} dir={dir} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#E88225]" />
      <span>{label}</span>
    </label>
  )
}

function Row({ k, v, ltr }: { k: string; v: string; ltr?: boolean }) {
  return (
    <div className="flex justify-between gap-4 px-3 py-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn('font-medium', ltr && 'font-mono')} dir={ltr ? 'ltr' : undefined} style={ltr ? { unicodeBidi: 'embed' } : undefined}>
        {v}
      </dd>
    </div>
  )
}
