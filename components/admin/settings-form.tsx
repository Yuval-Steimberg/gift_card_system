'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminUpdateSettings } from '@/app/admin/actions'
import { toMajor, toMinor } from '@/lib/money'
import type { SystemSettings } from '@/lib/data/store'

export function SettingsForm({ settings }: { settings: SystemSettings }) {
  const [businessName, setBusinessName] = useState(settings.businessName)
  const [businessEmail, setBusinessEmail] = useState(settings.businessEmail)
  const [businessPhone, setBusinessPhone] = useState(settings.businessPhone)
  const [storeAddress, setStoreAddress] = useState(settings.storeAddress)
  const [minAmount, setMinAmount] = useState(String(toMajor(settings.minAmountMinor)))
  const [maxAmount, setMaxAmount] = useState(String(toMajor(settings.maxAmountMinor)))
  const [expiryMonths, setExpiryMonths] = useState(settings.expiryMonths == null ? '' : String(settings.expiryMonths))
  const [allowCustom, setAllowCustom] = useState(settings.allowCustomAmount)
  const [allowPartial, setAllowPartial] = useState(settings.allowPartialRedemption)
  const [presets, setPresets] = useState(settings.presetAmountsMinor.map((m) => toMajor(m)).join(', '))
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function save() {
    setMsg(null)
    const presetAmountsMinor = presets
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => toMinor(n))
    start(async () => {
      const res = await adminUpdateSettings({
        businessName,
        businessEmail,
        businessPhone,
        storeAddress,
        minAmountMinor: toMinor(Number(minAmount) || 0),
        maxAmountMinor: toMinor(Number(maxAmount) || 0),
        expiryMonths: expiryMonths === '' ? null : Number(expiryMonths),
        allowCustomAmount: allowCustom,
        allowPartialRedemption: allowPartial,
        presetAmountsMinor,
      })
      setMsg(res.ok ? 'ההגדרות נשמרו' : res.message ?? 'שגיאה')
    })
  }

  return (
    <div className="max-w-lg space-y-4">
      <Field label="שם העסק" value={businessName} onChange={setBusinessName} />
      <Field label="אימייל" value={businessEmail} onChange={setBusinessEmail} dir="ltr" />
      <Field label="טלפון" value={businessPhone} onChange={setBusinessPhone} dir="ltr" />
      <Field label="כתובת החנות" value={storeAddress} onChange={setStoreAddress} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="סכום מינ׳ (₪)" value={minAmount} onChange={setMinAmount} dir="ltr" />
        <Field label="סכום מקס׳ (₪)" value={maxAmount} onChange={setMaxAmount} dir="ltr" />
      </div>
      <Field label="סכומים מוגדרים מראש (₪, מופרד בפסיקים)" value={presets} onChange={setPresets} dir="ltr" />
      <Field label="תוקף בחודשים (ריק = ללא)" value={expiryMonths} onChange={setExpiryMonths} dir="ltr" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allowCustom} onChange={(e) => setAllowCustom(e.target.checked)} className="h-4 w-4 accent-[#E88225]" />
        אפשר סכום חופשי
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} className="h-4 w-4 accent-[#E88225]" />
        אפשר פדיון חלקי
      </label>
      {msg && <p className="text-sm text-success">{msg}</p>}
      <Button onClick={save} disabled={pending}>
        שמירת הגדרות
      </Button>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  dir,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  dir?: 'ltr' | 'rtl'
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} dir={dir} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
