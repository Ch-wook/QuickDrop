import { test, expect } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';

test('public HTTPS QR opens through the tunnel and connects two peers with WSS and WebRTC', async ({ browser, baseURL }, testInfo) => {
  expect(baseURL).toMatch(/^https:\/\//);
  const a = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const b = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const sockets: string[] = [];
  for (const page of [a, b]) page.on('websocket', socket => { if (socket.url().endsWith('/ws')) sockets.push(socket.url()); });
  try {
    await a.goto(baseURL!);
    test.skip(!await a.evaluate(() => typeof RTCPeerConnection !== 'undefined'), 'This WebKit build has no WebRTC.');
    const link = a.getByRole('link', { name: '연결 링크', exact: true });
    await expect(link.locator('img')).toBeVisible();
    await expect(a.getByRole('note')).toHaveCount(0);
    const src = await link.locator('img').getAttribute('src');
    const png = PNG.sync.read(Buffer.from(src!.split(',')[1], 'base64'));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
    expect(decoded).toBe(await link.getAttribute('href'));
    expect(new URL(decoded!).origin).toBe(new URL(baseURL!).origin);
    await a.screenshot({ path: `artifacts/mobile-https-${testInfo.project.name}-qr.png`, fullPage: true });
    await b.goto(decoded!);
    for (const page of [a, b]) await expect(page.getByText('두 기기가 연결되었습니다. 바로 보내보세요.')).toBeVisible({ timeout: 35000 });
    expect(sockets).toHaveLength(2);
    expect(sockets.every(url => url.startsWith('wss://'))).toBe(true);
    await b.getByRole('textbox', { name: '보낼 텍스트 또는 링크' }).fill('휴대폰 HTTPS 연결 확인');
    await b.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(a.getByText('휴대폰 HTTPS 연결 확인', { exact: true })).toBeVisible();
    const bytes = Buffer.from('PC to phone over WebRTC\n'.repeat(3000));
    await a.locator('input[type=file]').setInputFiles({ name: 'mobile-check.txt', mimeType: 'text/plain', buffer: bytes });
    const downloadLink = b.getByRole('link', { name: 'mobile-check.txt 다운로드' });
    await expect(downloadLink).toBeVisible();
    const pending = b.waitForEvent('download'); await downloadLink.click();
    const download = await pending;
    expect(await readFile((await download.path())!)).toEqual(bytes);
    await b.screenshot({ path: `artifacts/mobile-https-${testInfo.project.name}-connected.png`, fullPage: true });
  } finally { await a.close(); await b.close(); }
});
