import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config. Builds + starts the app on port 3100 with the default offline
 * providers (mock payment, log email, memory store) so no credentials are
 * needed. Chromium is pre-provisioned in this environment.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npx next start -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      APP_BASE_URL: 'http://localhost:3100',
      PAYMENT_PROVIDER: 'mock',
      EMAIL_PROVIDER: 'log',
    },
  },
})
