import { defineConfig, devices } from '@playwright/test';
const externalUrl = process.env.E2E_BASE_URL;
const ports = { chromium: 3100, firefox: 3101, webkit: 3102 };
const baseURL = (name: keyof typeof ports) => externalUrl || `http://127.0.0.1:${ports[name]}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: externalUrl ? ['**/mobile.spec.ts', '**/stability.spec.ts'] : '**/*.spec.ts',
  testIgnore: externalUrl ? [] : ['**/mobile.spec.ts'],
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: externalUrl || 'http://127.0.0.1:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], baseURL: baseURL('chromium') } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], baseURL: baseURL('firefox') } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], baseURL: baseURL('webkit') } },
  ],
  // Each engine gets its own rate-limit budget; production protection stays on.
  webServer: externalUrl ? undefined : Object.values(ports).map(port => ({ command: process.env.E2E_PRODUCTION ? 'npm start' : 'npx tsx server/index.ts', url: `http://127.0.0.1:${port}/api/health`, reuseExistingServer: false, env: { PORT: String(port), STUN_URL: '', ROOM_TTL: '600000', JOIN_RATE_LIMIT: '100' }, timeout: 30000 })),
});
