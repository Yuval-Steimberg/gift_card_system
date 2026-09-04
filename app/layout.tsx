import type { Metadata } from 'next'
import { Heebo } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-heebo',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Just A Second · שוברי מתנה',
  description: 'שובר מתנה דיגיטלי מבית Just A Second — נרכש אונליין, נשלח לנמען, נפדה בחנות.',
  robots: { index: false }, // gift links must not be indexed
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
