import { test, expect, firefox } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('Chromium and Firefox exchange real data and a multi-chunk file', async ({ browser, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'Run the cross-engine test once, from the Chromium project.');
  const remoteBrowser = await firefox.launch();
  const a = await browser.newPage(); const b = await remoteBrowser.newPage();
  try {
    await a.goto(baseURL!);
    const link = a.getByRole('link', { name: '연결 링크', exact: true });
    await expect(link).toBeVisible(); await b.goto((await link.getAttribute('href'))!);
    for (const page of [a, b]) await expect(page.getByText('두 기기가 연결되었습니다. 바로 보내보세요.')).toBeVisible();
    await a.getByRole('textbox', { name: '보낼 텍스트 또는 링크' }).fill('Chromium → Firefox');
    await a.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(b.getByText('Chromium → Firefox', { exact: true })).toBeVisible();
    const bytes = Buffer.from('Firefox → Chromium\n'.repeat(5000));
    await b.locator('input[type=file]').setInputFiles({ name: 'interoperability.txt', mimeType: 'text/plain', buffer: bytes });
    const fileLink = a.getByRole('link', { name: 'interoperability.txt 다운로드' }); await expect(fileLink).toBeVisible();
    const pending = a.waitForEvent('download'); await fileLink.click();
    const download = await pending; expect(await readFile((await download.path())!)).toEqual(bytes);
  } finally { await a.close(); await remoteBrowser.close(); }
});
