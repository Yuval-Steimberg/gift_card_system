import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'
import { getSettings } from '@/lib/gift-cards/service'

export default async function TermsPage() {
  const s = await getSettings()
  return (
    <>
      <SiteHeader />
      <main className="container max-w-2xl py-12">
        <h1 className="text-3xl">תנאי שימוש — שוברי מתנה</h1>
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            שובר המתנה תקף ל-{s.expiryMonths} חודשים ממועד ההנפקה וניתן לפדיון בחנות {s.businessName} בכתובת{' '}
            {s.storeAddress}. ניתן לממש את השובר במלואו או בחלקו; יתרה נשמרת עד לתום התוקף.
          </p>
          <p>השובר אינו ניתן להמרה למזומן. אובדן קוד השובר — יש לפנות לחנות לחסימה והנפקה מחדש.</p>
          <p>
            הנוסח המשפטי המלא, מדיניות הפרטיות ומדיניות ההחזרות טעונים אישור יועץ/ת משפטי/ת. מסמך זה
            הוא תבנית ואינו מהווה ייעוץ משפטי.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
