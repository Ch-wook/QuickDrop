import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: '보낼 텍스트 또는 링크' }).fill(text);
  await page.getByRole('button', { name: '보내기', exact: true }).click();
}
async function connected(page: Page) { await expect(page.getByText('두 기기가 연결되었습니다. 바로 보내보세요.')).toBeVisible(); }
async function download(page: Page, name: string, expected: Buffer) {
  const pending = page.waitForEvent('download');
  await page.getByRole('link', { name: `${name} 다운로드`, exact: true }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe(name);
  expect(await readFile((await file.path())!)).toEqual(expected);
}

test('real WebRTC: ping/pong, links, images, binary files, paste/drop and peer departure', async ({ browser, baseURL }, testInfo) => {
  const aContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const bContext = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const a = await aContext.newPage(); const b = await bContext.newPage();
  const errors: string[] = [];
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  try {
    await a.goto(baseURL!);
    test.skip(!await a.evaluate(() => typeof RTCPeerConnection !== 'undefined'), 'This installed WebKit build does not expose RTCPeerConnection; real Safari/device testing is required.');
    const qrLink = a.getByRole('link', { name: '연결 링크', exact: true });
    await expect(qrLink).toBeVisible();
    await a.screenshot({ path: `artifacts/${testInfo.project.name}-desktop-waiting.png`, fullPage: true });
    const joinUrl = await qrLink.getAttribute('href');
    expect(joinUrl).toMatch(/\/join\/[\w-]{32}$/);
    if (new URL(baseURL!).protocol === 'https:') {
      const qrData = await qrLink.locator('img').getAttribute('src');
      const qrPng = PNG.sync.read(Buffer.from(qrData!.split(',')[1], 'base64'));
      expect(jsQR(new Uint8ClampedArray(qrPng.data), qrPng.width, qrPng.height)?.data).toBe(joinUrl);
    } else {
      await expect(qrLink.locator('img')).toHaveCount(0);
      await expect(a.getByRole('note')).toContainText('localhost는 현재 기기만 가리켜요.');
    }
    await b.goto(joinUrl!);
    await Promise.all([connected(a), connected(b)]);

    // Real data channel ping/pong, before exercising file transfer.
    await send(a, 'ping — Device A'); await expect(b.getByText('ping — Device A', { exact: true })).toBeVisible();
    await send(b, 'pong — Device B'); await expect(a.getByText('pong — Device B', { exact: true })).toBeVisible();
    await expect(a.locator('.transfer-status.complete')).toHaveCount(2);
    await expect(b.locator('.transfer-status.complete')).toHaveCount(2);

    await send(b, 'https://example.com');
    const link = a.getByRole('link', { name: 'https://example.com/' });
    await expect(link).toHaveAttribute('target', '_blank');
    await aContext.route('https://example.com/', route => route.fulfill({ body: '<title>Example destination</title>' }));
    const popupPromise = a.waitForEvent('popup'); await link.click(); const popup = await popupPromise;
    await expect(popup).toHaveURL('https://example.com/'); await popup.close();

    await send(a, '<img src=x onerror=alert(1)> 안전한 텍스트');
    await expect(b.getByText('<img src=x onerror=alert(1)> 안전한 텍스트', { exact: true })).toBeVisible();
    expect(await b.locator('.text-content img').count()).toBe(0);
    if (testInfo.project.name === 'chromium') {
      await bContext.grantPermissions(['clipboard-read', 'clipboard-write']);
      await b.locator('.transfer-card').last().getByRole('button', { name: '내용 복사' }).click();
      await expect(b.getByText('클립보드에 복사했습니다.')).toBeVisible();
      expect(await b.evaluate(() => navigator.clipboard.readText())).toBe('<img src=x onerror=alert(1)> 안전한 텍스트');
    }

    const sampleImage = new PNG({ width: 160, height: 100 });
    for (let y = 0; y < sampleImage.height; y++) for (let x = 0; x < sampleImage.width; x++) {
      const offset = (y * sampleImage.width + x) * 4;
      sampleImage.data.set([40 + x, 100 + y, 220, 255], offset);
    }
    const png = PNG.sync.write(sampleImage);
    await b.locator('input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    await expect(a.getByRole('img', { name: 'photo.png' })).toBeVisible();
    await expect.poll(() => a.getByRole('img', { name: 'photo.png' }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(160);
    await download(a, 'photo.png', png);

    const binary = Buffer.alloc(1024 * 1024 + 71); for (let i = 0; i < binary.length; i++) binary[i] = i % 251;
    await a.locator('input[type=file]').setInputFiles({ name: 'archive.zip', mimeType: 'application/zip', buffer: binary });
    await expect(b.getByRole('link', { name: 'archive.zip 다운로드' })).toBeVisible();
    await download(b, 'archive.zip', binary);

    const pdf = '%PDF-1.4\nQuickDrop drag and drop sample\n%%EOF';
    await a.evaluate(content => {
      const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File([content], 'report.pdf', { type: 'application/pdf' }));
      document.querySelector('.app-shell')!.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }));
      document.querySelector('.app-shell')!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
    }, pdf);
    await expect(b.getByRole('link', { name: 'report.pdf 다운로드' })).toBeVisible();
    await download(b, 'report.pdf', Buffer.from(pdf));

    await b.evaluate(bytes => {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'pasted.png', { type: 'image/png' }));
      const event = new Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'clipboardData', { value: data });
      document.querySelector('textarea')!.dispatchEvent(event);
    }, [...png]);
    await expect(a.getByRole('img', { name: 'pasted.png' })).toBeVisible();
    await expect.poll(() => a.getByRole('img', { name: 'pasted.png' }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(160);
    await download(a, 'pasted.png', png);
    await expect(a.locator('.transfer-status.complete')).toHaveCount(8);
    await a.screenshot({ path: `artifacts/${testInfo.project.name}-desktop-connected.png`, fullPage: true });
    await b.screenshot({ path: `artifacts/${testInfo.project.name}-mobile-connected.png`, fullPage: true });
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const c = await browser.newPage(); await c.goto(joinUrl!);
    await expect(c.getByRole('alert')).toContainText('이미 두 기기가 연결되어 있습니다.'); await c.close();
    // Explicit departure releases the slot immediately. An unexpected browser
    // shutdown now reserves it briefly for authenticated automatic recovery.
    await b.getByRole('button', { name: '새 연결 시작' }).click();
    await bContext.close();
    await expect(a.getByText('상대 기기가 나갔습니다.', { exact: false })).toBeVisible();
    const replacement = await browser.newPage();
    await replacement.goto(joinUrl!); await Promise.all([connected(a), connected(replacement)]);
    await send(replacement, '다시 연결한 기기'); await expect(a.getByText('다시 연결한 기기', { exact: true })).toBeVisible();
    await replacement.close();
    expect(errors).toEqual([]);
  } finally { await aContext.close(); await bContext.close(); }
});

test('manual code fallback, invalid rooms and mobile layout', async ({ browser, baseURL }, testInfo) => {
  const a = await browser.newPage(); const b = await browser.newPage({ viewport: { width: 375, height: 812 } });
  try {
    await a.goto(baseURL!);
    test.skip(!await a.evaluate(() => typeof RTCPeerConnection !== 'undefined'), 'This installed WebKit build does not expose RTCPeerConnection; real Safari/device testing is required.');
    await expect(a.getByRole('link', { name: '연결 링크', exact: true })).toBeVisible();
    const code = (await a.getByTestId('connection-code').innerText()).replace(/\D/g, '');
    await b.goto(baseURL!); await expect(b.getByRole('link', { name: '연결 링크', exact: true })).toBeVisible();
    await b.screenshot({ path: `artifacts/${testInfo.project.name}-mobile-waiting.png`, fullPage: true });
    await b.getByRole('textbox', { name: '6자리 연결 코드' }).fill(code);
    await b.getByRole('button', { name: '코드로 연결' }).click();
    await Promise.all([connected(a), connected(b)]);
    await send(b, '코드 연결 성공'); await expect(a.getByText('코드 연결 성공', { exact: true })).toBeVisible();
    await b.goto(`${baseURL}/join/${'a'.repeat(32)}`);
    await expect(b.getByRole('alert')).toContainText('세션이 없거나 만료되었습니다.');
    await b.getByRole('button', { name: '새 연결 시작' }).click();
    await expect(b.getByRole('link', { name: '연결 링크', exact: true })).toBeVisible();
    await b.getByRole('button', { name: '사용 방법' }).click();
    await expect(b.getByRole('dialog')).toBeVisible(); await b.keyboard.press('Escape');
    await expect(b.getByRole('dialog')).not.toBeVisible();
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await a.close(); await b.close(); }
});

test('browser capability detection, mobile shell and keyboard help dialog', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const capabilities = await page.evaluate(() => ({ rtc: typeof RTCPeerConnection, uuid: typeof crypto.randomUUID, secure: isSecureContext }));
  await testInfo.attach('browser-capabilities', { body: JSON.stringify(capabilities), contentType: 'application/json' });
  if (capabilities.rtc === 'undefined') await expect(page.getByRole('alert')).toContainText('이 브라우저에서는 연결을 시작할 수 없습니다.');
  else await expect(page.getByRole('link', { name: '연결 링크', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '사용 방법' }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '사용 방법' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-mobile-capabilities.png`, fullPage: true });
});
