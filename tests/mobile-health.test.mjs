import { expect, it, vi } from 'vitest';
import { inspectMobileSession } from '../scripts/mobile-health.mjs';

const session = { publicUrl: 'https://example-test.trycloudflare.com', localUrl: 'http://127.0.0.1:3001' };
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

it('does not call an old tunnel URL when its local server has stopped', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
  expect((await inspectMobileSession(session, fetcher)).status).toBe('stopped');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects a stale URL when a different mobile session occupies the same port', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ publicUrl: 'https://new-test.trycloudflare.com' }));
  expect((await inspectMobileSession(session, fetcher)).status).toBe('stale');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('reports DNS failure even if the local server is healthy', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ publicUrl: session.publicUrl })).mockRejectedValueOnce(new Error('ENOTFOUND'));
  expect(await inspectMobileSession(session, fetcher)).toMatchObject({ ok: false, status: 'unreachable' });
});
it('only reports ready after the local identity and public health checks pass', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ publicUrl: session.publicUrl })).mockResolvedValueOnce(response({ ok: true }));
  expect(await inspectMobileSession(session, fetcher)).toMatchObject({ ok: true, status: 'ready' });
  expect(String(fetcher.mock.calls[0][0])).toBe('http://127.0.0.1:3001/api/config');
  expect(String(fetcher.mock.calls[1][0])).toBe(`${session.publicUrl}/api/health`);
});
it('rejects invalid state without making network requests', async () => {
  const fetcher = vi.fn();
  expect((await inspectMobileSession({ ...session, localUrl: 'http://other.example' }, fetcher)).status).toBe('invalid-state');
  expect(fetcher).not.toHaveBeenCalled();
});
it('does not treat an error page or unrelated JSON response as healthy', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ publicUrl: session.publicUrl })).mockResolvedValueOnce(response({ ok: false }));
  expect((await inspectMobileSession(session, fetcher)).status).toBe('unreachable');
});
