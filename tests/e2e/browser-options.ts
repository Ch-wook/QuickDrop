import type { Browser } from '@playwright/test';

// Explicit test-environment workaround, never applied to the deployed service.
export function browserOptions(browser: Browser) {
  return { bypassCSP: process.env.E2E_FIREFOX_CSP_WORKAROUND === '1' && browser.browserType().name() === 'firefox' };
}
