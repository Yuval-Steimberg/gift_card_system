'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Admin segment error boundary. Turns a raw server exception (most often an
 * un-initialized database) into a clear, actionable message instead of the
 * generic white-screen "Application error".
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[admin] render error:', error)
  }, [error])

  const looksLikeDb =
    /system_settings|relation|does not exist|not seeded|supabase|column|schema/i.test(error.message || '')

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-bold">לא הצלחנו לטעון את מערכת הניהול</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {looksLikeDb
          ? 'נראה שמסד הנתונים עדיין לא אותחל. יש להריץ את קובץ ההגדרה ב-Supabase.'
          : 'אירעה שגיאת שרת בעת טעינת הנתונים.'}
      </p>

      <div className="mt-6 rounded-lg border border-border bg-card p-4 text-start text-sm">
        <p className="font-semibold">איך לתקן:</p>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-muted-foreground">
          <li>
            הריצו את <code className="rounded bg-muted px-1">supabase/setup.sql</code> ב-Supabase → SQL Editor.
          </li>
          <li>
            בדקו את הסטטוס בכתובת{' '}
            <Link href="/api/health" className="text-primary underline" target="_blank">
              /api/health
            </Link>{' '}
            (צריך <code className="rounded bg-muted px-1">ok: true</code>).
          </li>
          <li>רעננו את העמוד.</li>
        </ol>
      </div>

      {error.digest && <p className="mt-4 text-xs text-muted-foreground">Digest: {error.digest}</p>}

      <div className="mt-6 flex justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground hover:bg-[#C96A17]"
        >
          נסו שוב
        </button>
        <Link
          href="/api/health"
          target="_blank"
          className="rounded-full border border-input px-6 py-2 text-sm font-semibold hover:bg-muted"
        >
          בדיקת מערכת
        </Link>
      </div>
    </div>
  )
}
