import { defineConfig, devices } from '@playwright/test';
const externalUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: externalUrl ? '**/mobile.spec.ts' : '**/*.spec.ts',
  testIgnore: externalUrl ? [] : ['**/mobile.spec.ts'],
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: externalUrl || 'http://127.0.0.1:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: externalUrl ? undefined : { command: process.env.E2E_PRODUCTION ? 'npm start' : 'npx tsx server/index.ts', url: 'http://127.0.0.1:3100/api/health', reuseExistingServer: false, env: { PORT: '3100', STUN_URL: '', ROOM_TTL: '600000', JOIN_RATE_LIMIT: '100' }, timeout: 30000 },
});
