'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GiftCardPreview } from '@/components/gift-card/gift-card-preview'
import { adminUpsertTemplate } from '@/app/admin/actions'
import { toMinor } from '@/lib/money'
import type { GiftCardTemplate } from '@/lib/gift-cards/types'

export function TemplateManager({ templates }: { templates: GiftCardTemplate[] }) {
  const [name, setName] = useState('')
  const [bg, setBg] = useState('#333D36')
  const [text, setText] = useState('#FFFCF5')
  const [accent, setAccent] = useState('#E88225')
  const [occasion, setOccasion] = useState<GiftCardTemplate['occasion']>('general')
  const [language, setLanguage] = useState<'he' | 'en'>('he')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function create() {
    if (name.trim().length < 2) {
      setMsg('נא להזין שם עיצוב')
      return
    }
    start(async () => {
      const res = await adminUpsertTemplate({
        name,
        occasion,
        language,
        backgroundColor: bg,
        textColor: text,
        accentColor: accent,
        isActive: true,
        isDefault: false,
      })
      setMsg(res.ok ? 'העיצוב נוסף' : res.message ?? 'שגיאה')
      if (res.ok) setName('')
    })
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <h2 className="mb-3 font-bold">עיצובים קיימים</h2>
        <div className="grid grid-cols-2 gap-4">
          {templates.map((t) => (
            <div key={t.id}>
              <div className="aspect-[1.6/1] w-full rounded-lg" style={{ backgroundColor: t.backgroundColor }} />
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="font-medium">{t.name}</span>
                <span className="text-muted-foreground">{t.isDefault ? 'ברירת מחדל' : t.isActive ? 'פעיל' : 'ארכיון'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-bold">עיצוב חדש</h2>
        <GiftCardPreview
          template={{ backgroundColor: bg, textColor: text, accentColor: accent, name }}
          amountMinor={toMinor(200)}
          recipientName="דוגמה"
          greeting="ברכה לדוגמה"
        />
        <div className="space-y-1.5">
          <Label>שם</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ColorField label="רקע" value={bg} onChange={setBg} />
          <ColorField label="טקסט" value={text} onChange={setText} />
          <ColorField label="הדגשה" value={accent} onChange={setAccent} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>אירוע</Label>
            <select value={occasion} onChange={(e) => setOccasion(e.target.value as GiftCardTemplate['occasion'])} className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm">
              <option value="general">כללי</option>
              <option value="birthday">יום הולדת</option>
              <option value="holiday">חג</option>
              <option value="celebration">חגיגה</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>שפה</Label>
            <select value={language} onChange={(e) => setLanguage(e.target.value as 'he' | 'en')} className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm">
              <option value="he">עברית</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        {msg && <p className="text-sm text-success">{msg}</p>}
        <Button onClick={create} disabled={pending}>
          הוספת עיצוב
        </Button>
      </div>
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-md border border-input bg-card" aria-label={label} />
    </div>
  )
}
