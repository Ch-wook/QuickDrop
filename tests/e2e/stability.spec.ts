import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function connected(page: Page) { await expect(page.getByText('두 기기가 연결되었습니다. 바로 보내보세요.')).toBeVisible(); }
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: '보낼 텍스트 또는 링크' }).fill(text);
  await page.getByRole('button', { name: '보내기', exact: true }).click();
}
async function pair(a: Page, b: Page) {
  const code = (await a.getByTestId('connection-code').innerText()).replace(/\D/g, '');
  await b.getByRole('textbox', { name: '6자리 연결 코드' }).fill(code);
  await b.getByRole('button', { name: '코드로 연결' }).click();
  await Promise.all([connected(a), connected(b)]);
}

test('desktop peers: file picker, signaling recovery, channel repair, durable pair history and deletion', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120000);
  const aContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const bContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  // Capture the application's own transport objects to inject real failures.
  for (const context of [aContext, bContext]) await context.addInitScript(() => {
    const state = window as unknown as { qdSockets: WebSocket[]; qdChannels: RTCDataChannel[] };
    state.qdSockets = []; state.qdChannels = [];
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); state.qdSockets.push(this); }
    };
    if (typeof RTCPeerConnection !== 'undefined') {
      const native = RTCPeerConnection.prototype.createDataChannel;
      RTCPeerConnection.prototype.createDataChannel = function(...args) { const channel = native.apply(this, args); state.qdChannels.push(channel); return channel; };
    }
  });
  const a = await aContext.newPage(); const b = await bContext.newPage();
  const errors: string[] = []; [a, b].forEach(page => page.on('pageerror', error => errors.push(error.message)));
  try {
    await a.goto(baseURL!);
    test.skip(!await a.evaluate(() => typeof RTCPeerConnection !== 'undefined'), 'Installed WebKit does not provide WebRTC.');
    await b.goto(baseURL!);
    await expect(a.getByTestId('connection-code')).toHaveText(/\d{3} \d{3}/);
    await expect(b.getByTestId('connection-code')).toHaveText(/\d{3} \d{3}/);
    await pair(a, b);
    await send(a, 'PC A에서 PC B로'); await expect(b.getByText('PC A에서 PC B로', { exact: true })).toBeVisible();
    await send(b, 'PC B에서 PC A로'); await expect(a.getByText('PC B에서 PC A로', { exact: true })).toBeVisible();

    const binary = Buffer.alloc(1024 * 1024 + 17); for (let i = 0; i < binary.length; i++) binary[i] = i % 251;
    const chooser = a.waitForEvent('filechooser'); await a.getByRole('button', { name: '파일 첨부' }).click();
    const picker = await chooser;
    await a.evaluate(() => { window.dispatchEvent(new Event('blur')); });
    await b.bringToFront(); await a.bringToFront();
    await picker.setFiles({ name: 'pc-transfer.bin', mimeType: 'application/octet-stream', buffer: binary });
    await expect(b.getByRole('link', { name: 'pc-transfer.bin 다운로드' })).toBeVisible();
    await Promise.all([connected(a), connected(b)]);

    // Signaling fails; the existing direct file channel should remain usable.
    await a.evaluate(() => (window as unknown as { qdSockets: WebSocket[] }).qdSockets.at(-1)!.close(4000, 'Test interruption'));
    await send(a, '서버 통신 중단 중에도 전송'); await expect(b.getByText('서버 통신 중단 중에도 전송', { exact: true })).toBeVisible();
    await expect.poll(() => a.evaluate(() => (window as unknown as { qdSockets: WebSocket[] }).qdSockets.length)).toBeGreaterThan(1);
    await expect.poll(() => a.evaluate(() => (window as unknown as { qdSockets: WebSocket[] }).qdSockets.at(-1)?.readyState)).toBe(WebSocket.OPEN);
    await Promise.all([connected(a), connected(b)]);

    // Close the actual SCTP channel; recover both ends without a new code.
    await a.evaluate(() => (window as unknown as { qdChannels: RTCDataChannel[] }).qdChannels.at(-1)!.close());
    await expect(a.getByText('연결을 자동 복구하고 있습니다. 잠시 기다려 주세요.')).toBeVisible();
    await Promise.all([connected(a), connected(b)]);
    await send(b, '자동 복구 후 양방향 전송'); await expect(a.getByText('자동 복구 후 양방향 전송', { exact: true })).toBeVisible();

    // Explicitly disconnect, reload both browsers, then create a new room.
    await b.getByRole('button', { name: '새 연결 시작' }).click();
    await expect(a.getByRole('alert')).toContainText('상대 기기가 나갔습니다.');
    await Promise.all([a.reload(), b.reload()]);
    await expect(a.getByTestId('connection-code')).toHaveText(/\d{3} \d{3}/);
    await expect(b.getByTestId('connection-code')).toHaveText(/\d{3} \d{3}/);
    await pair(a, b);
    await expect(a.getByText('PC A에서 PC B로', { exact: true })).toBeVisible();
    await expect(b.getByText('PC B에서 PC A로', { exact: true })).toBeVisible();
    const pending = b.waitForEvent('download'); await b.getByRole('link', { name: 'pc-transfer.bin 다운로드' }).click();
    expect(await readFile((await (await pending).path())!)).toEqual(binary);
    await a.screenshot({ path: `artifacts/${testInfo.project.name}-desktop-history.png`, fullPage: true });

    // Keep production checks below the default JOIN rate budget. Full pair
    // isolation and durable deletion are verified against the local build.
    if (process.env.E2E_BASE_URL) {
      await a.getByRole('button', { name: '기록 비우기' }).click();
      await b.getByRole('button', { name: '기록 비우기' }).click();
      await expect(a.locator('.transfer-card')).toHaveCount(0);
      await expect(b.locator('.transfer-card')).toHaveCount(0);
      expect(errors).toEqual([]); return;
    }

    // A different browser/device must not receive another pair's history.
    const cContext = await browser.newContext(); const c = await cContext.newPage();
    try {
      await b.getByRole('button', { name: '새 연결 시작' }).click();
      await expect(a.getByRole('alert')).toContainText('상대 기기가 나갔습니다.');
      await c.goto(baseURL!); await expect(c.getByTestId('connection-code')).toHaveText(/\d{3} \d{3}/);
      await pair(a, c);
      await expect(a.getByText('PC A에서 PC B로', { exact: true })).toHaveCount(0);
      await c.getByRole('button', { name: '새 연결 시작' }).click();
      await expect(a.getByRole('alert')).toContainText('상대 기기가 나갔습니다.');
    } finally { await cContext.close(); }
    await expect(b.getByTestId('connection-code')).toHaveText(/\d{3} \d{3}/);
    await pair(a, b);
    await expect(a.getByText('PC A에서 PC B로', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: '기록 비우기' }).click();
    await b.getByRole('button', { name: '기록 비우기' }).click();
    await b.getByRole('button', { name: '새 연결 시작' }).click();
    await Promise.all([a.reload(), b.reload()]);
    await expect(a.getByTestId('connection-code')).toHaveText(/\d{3} \d{3}/);
    await expect(b.getByTestId('connection-code')).toHaveText(/\d{3} \d{3}/);
    await pair(a, b);
    await expect(a.locator('.transfer-card')).toHaveCount(0);
    await expect(b.locator('.transfer-card')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await aContext.close(); await bContext.close(); }
});

for (const mode of ['disabled', 'quota'] as const) test(`local history fallback: ${mode}, transfer stays usable`, async ({ browser, baseURL }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Storage failure injection runs locally.');
  const aContext = await browser.newContext(); const bContext = await browser.newContext({ acceptDownloads: true });
  await bContext.addInitScript(mode => {
    if (mode === 'disabled') Object.defineProperty(window, 'indexedDB', { value: undefined });
    else {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) {
        if (value.items?.some((item: { blob?: Blob }) => item.blob)) throw new DOMException('Test storage quota', 'QuotaExceededError');
        return put.call(this, value, key);
      };
    }
  }, mode);
  const a = await aContext.newPage(); const b = await bContext.newPage(); const errors: string[] = [];
  b.on('pageerror', error => errors.push(error.message));
  try {
    await a.goto(baseURL!);
    test.skip(!await a.evaluate(() => typeof RTCPeerConnection !== 'undefined'), 'Installed WebKit does not provide WebRTC.');
    const link = a.getByRole('link', { name: '연결 링크', exact: true }); await expect(link).toBeVisible();
    const joinUrl = (await link.getAttribute('href'))!;
    await b.goto(joinUrl); await Promise.all([connected(a), connected(b)]);
    const bytes = Buffer.from('File transfer works without durable Blob storage');
    await a.locator('input[type=file]').setInputFiles({ name: 'fallback.txt', mimeType: 'text/plain', buffer: bytes });
    const download = b.waitForEvent('download'); await b.getByRole('link', { name: 'fallback.txt 다운로드' }).click();
    expect(await readFile((await (await download).path())!)).toEqual(bytes);
    await expect(b.getByRole('note')).toContainText(mode === 'disabled' ? '기록 저장 공간을 사용할 수 없습니다' : '전송 내역만 보관했습니다');
    await send(b, '저장 실패 중에도 전송 가능'); await expect(a.getByText('저장 실패 중에도 전송 가능', { exact: true })).toBeVisible();
    await b.getByRole('button', { name: '새 연결 시작' }).click();
    await expect(a.getByRole('alert')).toContainText('상대 기기가 나갔습니다.');
    await b.goto(joinUrl); await Promise.all([connected(a), connected(b)]);
    if (mode === 'disabled') await expect(b.locator('.transfer-card')).toHaveCount(0);
    else {
      await expect(b.getByText('fallback.txt', { exact: true })).toBeVisible();
      await expect(b.getByRole('link', { name: 'fallback.txt 다운로드' })).toHaveCount(0);
      await expect(b.getByText('저장 실패 중에도 전송 가능', { exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  } finally { await aContext.close(); await bContext.close(); }
});
