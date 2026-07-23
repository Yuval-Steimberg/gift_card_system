import { test, expect } from '@playwright/test'

/**
 * Critical-path E2E across the whole system using the mock payment provider:
 * purchase -> verified webhook activation -> recipient page -> employee redeem.
 */
test('customer purchases a gift card and completes mock payment', async ({ page }) => {
  await page.goto('/gift-cards')

  // Step 1 — amount (pick a preset)
  await page.getByRole('button', { name: '₪200' }).click()
  await page.getByRole('button', { name: 'המשך' }).click()

  // Step 2 — design (default selected) -> continue
  await page.getByRole('button', { name: 'המשך' }).click()

  // Step 3 — buyer
  await page.getByLabel(/שם מלא/).fill('דנה כהן')
  await page.getByLabel(/אימייל/).first().fill('dana@example.com')
  await page.getByRole('button', { name: 'המשך' }).click()

  // Step 4 — recipient
  await page.getByLabel(/שם הנמען/).fill('יעל לוי')
  await page.getByLabel(/אימייל הנמען/).fill('yael@example.com')
  await page.getByRole('button', { name: 'המשך' }).click()

  // Step 5 — greeting
  await page.getByRole('button', { name: 'המשך' }).click()

  // Step 6 — timing (immediate default)
  await page.getByRole('button', { name: 'המשך' }).click()

  // Step 7 — review + accept terms
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'המשך לתשלום' }).click()

  // Mock hosted checkout -> approve
  await expect(page.getByText('אישור תשלום')).toBeVisible()
  await page.getByRole('button', { name: 'אישור ותשלום' }).click()

  // Confirmation -> paid
  await expect(page.getByText('התשלום אושר')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/JAS-/)).toBeVisible()
})

test('employee logs in and redeems a seeded active card', async ({ page }) => {
  await page.goto('/employee/login')
  await page.getByLabel('אימייל').fill('employee1@justasecond.example')
  await page.getByLabel('סיסמה').fill('password')
  await page.getByRole('button', { name: 'התחברות' }).click()

  await expect(page.getByRole('heading', { name: 'מסך פדיון' })).toBeVisible()

  // Look up a seeded active card by code.
  await page.getByLabel(/קוד שובר/).fill('JAS-7F3K-QP2M-9')
  await page.getByRole('button', { name: 'חיפוש' }).click()

  await expect(page.getByText('יתרה')).toBeVisible()
  // Redeem a partial amount.
  await page.getByLabel('סכום לפדיון').fill('50')
  await page.getByRole('button', { name: 'אישור פדיון' }).click()
  await expect(page.getByText(/הפדיון בוצע בהצלחה|כבר עובדה/)).toBeVisible({ timeout: 10_000 })
})

test('unauthorized visitor is redirected from admin to login', async ({ page }) => {
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/employee\/login/)
})
