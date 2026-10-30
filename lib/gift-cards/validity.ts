/**
 * A card's validity in words, for customer-facing copy: "5 שנים", "שנה",
 * "שנתיים", "18 חודשים", or "ללא הגבלת זמן" when cards don't expire.
 * Read from settings.expiryMonths so the copy always matches what is issued.
 */
export function formatValidity(expiryMonths: number | null): string {
  if (expiryMonths == null) return 'ללא הגבלת זמן'
  if (expiryMonths % 12 === 0) {
    const years = expiryMonths / 12
    return years === 1 ? 'שנה' : years === 2 ? 'שנתיים' : `${years} שנים`
  }
  return expiryMonths === 1 ? 'חודש אחד' : `${expiryMonths} חודשים`
}
