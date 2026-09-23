/** Check both the intended local session and its public route, not just a stale file. */
export async function inspectMobileSession(session, fetcher = fetch) {
  let local;
  let remote;
  try {
    local = new URL(session.localUrl);
    remote = new URL(session.publicUrl);
    if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1' || remote.protocol !== 'https:'
      || !remote.hostname.endsWith('.trycloudflare.com') || local.username || local.password || remote.username || remote.password) throw new Error('Invalid session URL');
  } catch {
    return { ok: false, status: 'invalid-state', message: '모바일 실행 정보가 올바르지 않습니다. npm run dev:mobile로 다시 실행하세요.' };
  }
  try {
    const response = await fetcher(new URL('/api/config', local), { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    if (config.publicUrl !== remote.origin) return { ok: false, status: 'stale', message: '저장된 주소가 현재 실행 중인 서버와 다릅니다. 이전 QR을 사용하지 마세요.' };
  } catch {
    return { ok: false, status: 'stopped', message: '모바일용 로컬 서버가 실행 중이 아닙니다. npm run dev:mobile로 다시 실행하세요.' };
  }
  try {
    const response = await fetcher(new URL('/api/health', remote), { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok || (await response.json()).ok !== true) throw new Error('Public health check failed');
    return { ok: true, status: 'ready', message: '로컬 서버와 공개 HTTPS 주소가 응답합니다. PC에서 이 주소를 열고 새 QR을 스캔하세요.' };
  } catch {
    return { ok: false, status: 'unreachable', message: '서버는 실행 중이지만 공개 HTTPS 주소에 접속할 수 없습니다. DNS/네트워크를 확인하고 계속 실패하면 모바일 실행을 다시 시작하세요.' };
  }
}
