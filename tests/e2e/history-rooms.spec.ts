import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ baseURL: 'http://127.0.0.1:3103' });

test('legacy room migration preserves files and more than ten device rooms', async ({ browser, browserName, baseURL }, testInfo) => {
  // This installed Windows WebKit cannot persist IndexedDB Blobs; still check
  // migration of file metadata and room names there.
  const storedFile = browserName !== 'webkit';
  const context = await browser.newContext({ acceptDownloads: true });
  const otherContext = await browser.newContext();
  const page = await context.newPage(); const other = await otherContext.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    // Seed the previous release's database before the React application opens it.
    await page.goto(`${baseURL}/api/health`);
    await page.evaluate(async storedFile => {
      const local = crypto.randomUUID(); localStorage.setItem('quickdrop-device', local);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('quickdrop-history', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('pairs', { keyPath: 'id' });
        request.onsuccess = () => {
          const db = request.result; const transaction = db.transaction('pairs', 'readwrite');
          for (let i = 0; i < 12; i++) transaction.objectStore('pairs').put({
            id: `${local}:${String(i).padStart(6, '0')}-0000-4000-8000-000000000000`, updatedAt: Date.now() - i,
            items: [{ id: crypto.randomUUID(), direction: 'received', kind: 'file', time: Date.now() - i,
              status: 'complete', bytes: 18, size: 18, name: `legacy-${i}.txt`, mime: 'text/plain', ...(storedFile ? { blob: new Blob(['old room file data']) } : {}) }],
          });
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onabort = () => { db.close(); reject(transaction.error); };
        };
        request.onerror = () => reject(request.error);
      });
    }, storedFile);
    await page.goto(baseURL!);
    await expect(page.locator('.room-entry:not(.current-room)')).toHaveCount(12);
    await page.getByRole('button', { name: '기기 000000 기록 열기', exact: true }).click();
    if (storedFile) {
      const pending = page.waitForEvent('download'); await page.getByRole('link', { name: 'legacy-0.txt 다운로드' }).click();
      expect(await readFile((await (await pending).path())!)).toEqual(Buffer.from('old room file data'));
    } else await expect(page.getByText('legacy-0.txt', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: '대화방 이름' }).fill('예전 휴대폰');
    await page.getByRole('button', { name: '이름 저장', exact: true }).click();
    await expect(page.getByRole('button', { name: '예전 휴대폰 기록 열기', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.room-entry:not(.current-room)')).toHaveCount(12);
    await page.getByRole('button', { name: '예전 휴대폰 기록 열기', exact: true }).click();
    await expect(page.getByText('legacy-0.txt', { exact: true })).toBeVisible();
    await page.screenshot({ path: `artifacts/${testInfo.project.name}-room-list.png`, fullPage: true });
    if (await page.evaluate(() => typeof RTCPeerConnection !== 'undefined')) {
      await other.goto(baseURL!);
      await expect(page.getByTestId('connection-code')).toHaveText(/\d{3} \d{3}/);
      const code = (await page.getByTestId('connection-code').innerText()).replace(/\D/g, '');
      await other.getByRole('textbox', { name: '6자리 연결 코드' }).fill(code);
      await other.getByRole('button', { name: '코드로 연결' }).click();
      await expect(page.getByText('두 기기가 연결되었습니다. 바로 보내보세요.')).toBeVisible();
      await expect(page.locator('.room-entry:not(.current-room)')).toHaveCount(13);
      await page.getByRole('button', { name: '예전 휴대폰 기록 열기', exact: true }).click();
      await expect(page.getByRole('link', { name: 'legacy-0.txt 다운로드' })).toBeVisible();
    }
    expect(errors).toEqual([]);
  } finally { await context.close(); await otherContext.close(); }
});
