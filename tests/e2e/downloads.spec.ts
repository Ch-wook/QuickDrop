import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

test.use({ baseURL: 'http://127.0.0.1:3103' });

test('archived files: selected and all ZIP downloads, room isolation, cancellation and clearing', async ({ page, browserName, baseURL }, testInfo) => {
  test.skip(browserName === 'webkit', 'Installed Windows WebKit cannot persist IndexedDB Blobs.');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as unknown as { cspViolations: string[] }; state.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => state.cspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`));
  });
  await page.goto(`${baseURL}/api/health`);
  await page.evaluate(async () => {
    const local = crypto.randomUUID(); localStorage.setItem('quickdrop-device', local);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('quickdrop-history', 2);
      request.onupgradeneeded = () => { request.result.createObjectStore('pairs', { keyPath: 'id' }); request.result.createObjectStore('rooms', { keyPath: 'id' }); };
      request.onsuccess = () => {
        const db = request.result; const transaction = db.transaction(['pairs', 'rooms'], 'readwrite');
        const item = (name: string, body: string) => ({ id: crypto.randomUUID(), kind: 'file', direction: 'received', status: 'complete', time: Date.now(), size: new Blob([body]).size, bytes: new Blob([body]).size, name, blob: new Blob([body]) });
        for (let index = 0; index < 2; index++) {
          const id = `${local}:${crypto.randomUUID()}`;
          const items = index ? [item('other.txt', 'other room')] : [
            item('사진.txt', '첫 파일'), item('사진.txt', '둘째 파일'), item('empty.txt', ''),
            { ...item('sent.txt', 'sent'), direction: 'sent', blob: undefined },
            { ...item('gone.txt', 'gone'), blob: undefined },
            { ...item('failed.txt', 'failed'), status: 'error' },
            { ...item('message.txt', 'message'), kind: 'text', text: '텍스트 기록', blob: undefined },
          ];
          transaction.objectStore('pairs').put({ id, updatedAt: Date.now() - index, items });
          transaction.objectStore('rooms').put({ id, name: index ? '다른 PC' : '내 휴대폰', updatedAt: Date.now() - index, count: items.length, preview: '보관한 자료' });
        }
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.goto(baseURL!);
  await page.getByRole('button', { name: '내 휴대폰 기록 열기', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /다운로드 선택/ })).toHaveCount(3);
  await expect(page.getByRole('button', { name: '전체 다운로드 (3)', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '선택 다운로드 (0)', exact: true })).toBeDisabled();

  // Pause the lazy import to exercise cancellation. The installed Firefox
  // loses its CSP workaround after unroute/reload, so inject this in Chromium.
  if (browserName === 'chromium') {
    let unblock!: () => void;
    const paused = new Promise<void>(resolve => { unblock = resolve; });
    await page.route('**/download-zip*', async route => { await paused; await route.continue(); });
    try {
      await page.getByRole('button', { name: '전체 다운로드 (3)', exact: true }).click();
      await expect(page.getByRole('progressbar', { name: 'ZIP 준비 진행률' })).toBeVisible();
      await page.getByRole('button', { name: '취소', exact: true }).click(); unblock();
      await expect(page.getByRole('progressbar', { name: 'ZIP 준비 진행률' })).toHaveCount(0);
    } finally { unblock(); await page.unroute('**/download-zip*'); }
    await expect(page.getByRole('link', { name: 'ZIP 다시 저장' })).toHaveCount(0);
  }

  await page.getByRole('checkbox', { name: '사진.txt 다운로드 선택', exact: true }).nth(1).check();
  await page.getByRole('checkbox', { name: 'empty.txt 다운로드 선택', exact: true }).check();
  const selected = page.waitForEvent('download');
  await page.getByRole('button', { name: '선택 다운로드 (2)', exact: true }).click();
  const selectedFile = await selected;
  expect(selectedFile.suggestedFilename()).toMatch(/^quickdrop-.*\.zip$/);
  const partial = unzipSync(await readFile((await selectedFile.path())!));
  expect(Object.keys(partial)).toEqual(['사진.txt', 'empty.txt']);
  expect(new TextDecoder().decode(partial['사진.txt'])).toBe('둘째 파일'); expect(partial['empty.txt'].length).toBe(0);

  const all = page.waitForEvent('download');
  await page.getByRole('button', { name: '전체 다운로드 (3)', exact: true }).click();
  const archive = unzipSync(await readFile((await (await all).path())!));
  expect(Object.keys(archive)).toEqual(['사진.txt', '사진 (2).txt', 'empty.txt']);
  expect(new TextDecoder().decode(archive['사진.txt'])).toBe('첫 파일');
  expect(new TextDecoder().decode(archive['사진 (2).txt'])).toBe('둘째 파일');
  await page.getByRole('checkbox', { name: '전체 선택', exact: true }).check();
  await expect(page.getByRole('button', { name: '선택 다운로드 (3)', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 393, height: 852 });
  await page.locator('.download-toolbar').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-bulk-download-mobile.png`, fullPage: true });

  await page.getByRole('button', { name: '다른 PC 기록 열기', exact: true }).click();
  await expect(page.getByRole('button', { name: '선택 다운로드 (0)', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'ZIP 다시 저장' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '전체 다운로드 (1)', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '내 휴대폰 기록 열기', exact: true }).click();
  await expect(page.getByRole('button', { name: '선택 다운로드 (0)', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '기록 비우기', exact: true }).click();
  await expect(page.locator('.download-toolbar')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '내 휴대폰 기록 열기', exact: true }).click();
  await expect(page.locator('.transfer-card')).toHaveCount(0);
  await page.getByRole('button', { name: '다른 PC 기록 열기', exact: true }).click();
  await expect(page.getByRole('button', { name: '전체 다운로드 (1)', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)).toEqual([]);
});
