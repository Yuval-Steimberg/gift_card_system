import { test, expect } from '@playwright/test'

/**
 * Critical-path E2E across the whole system using the mock payment provider:
 * purchase -> verified webhook activation -> employee redeem.
 *
 * The store seeds NO sample cards (real numbers only — see lib/data/seed-data.ts),
 * so the redemption test redeems the card the purchase test just created. Hence
 * `describe.serial`: the second test depends on the first.
 */
test.describe.serial('purchase and redeem', () => {
  let purchasedCode = ''

  test('customer purchases a gift card and completes mock payment', async ({ page }) => {
    await page.goto('/gift-cards')

    // Step 1 — amount (pick a preset)
    await page.getByRole('button', { name: '₪250', exact: true }).click()
    await page.getByRole('button', { name: 'המשך' }).click()

    // Step 2 — design (default selected) -> continue
    await page.getByRole('button', { name: 'המשך' }).click()

    // Step 3 — buyer
    await page.getByLabel(/שם מלא/).fill('דנה כהן')
    await page.getByLabel(/^אימייל/).fill('dana@example.com')
    await page.getByLabel(/טלפון \(נייד ישראלי\)/).fill('0501234567')
    await page.getByRole('button', { name: 'המשך' }).click()

    // Step 4 — recipient
    await page.getByLabel(/שם הנמען/).fill('יעל לוי')
    await page.getByLabel(/אימייל הנמען/).fill('yael@example.com')
    await page.getByLabel(/טלפון נייד/).fill('0527654321')
    await page.getByRole('button', { name: 'המשך' }).click()

    // Step 5 — greeting (the timing step is hidden while SCHEDULING_ENABLED is false)
    await page.getByRole('button', { name: 'המשך' }).click()

    // Step 6 — review + accept terms
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'המשך לתשלום' }).click()

    // Mock hosted checkout -> approve
    await expect(page.getByText('אישור תשלום')).toBeVisible()
    await page.getByRole('button', { name: 'אישור ותשלום' }).click()

    // Confirmation -> paid
    await expect(page.getByText('התשלום אושר')).toBeVisible({ timeout: 15_000 })
    const code = page.getByText(/JAS-/)
    await expect(code).toBeVisible()
    purchasedCode = ((await code.textContent()) ?? '').trim()
    expect(purchasedCode).toMatch(/^JAS-/)
  })

  test('employee logs in and redeems the purchased card', async ({ page }) => {
    expect(purchasedCode, 'the purchase test must run first').toMatch(/^JAS-/)

    await page.goto('/employee/login')
    await page.getByLabel('אימייל').fill('employee1@justasecond.example')
    await page.getByLabel('סיסמה').fill('password')
    await page.getByRole('button', { name: 'התחברות' }).click()

    await expect(page.getByRole('heading', { name: 'מסך פדיון' })).toBeVisible()

    await page.getByLabel(/קוד שובר/).fill(purchasedCode)
    await page.getByRole('button', { name: 'חיפוש' }).click()

    await expect(page.getByText('יתרה')).toBeVisible()
    // Redeem a partial amount of the ₪250 card.
    await page.getByLabel('סכום לפדיון').fill('50')
    await page.getByRole('button', { name: 'אישור פדיון' }).click()
    await expect(page.getByText(/הפדיון בוצע בהצלחה|כבר עובדה/)).toBeVisible({ timeout: 10_000 })
  })
})

test('unauthorized visitor is redirected from admin to login', async ({ page }) => {
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/employee\/login/)
})
