import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { clientIceServers } from '../server/ice';
import { config } from '../server/config';

describe('temporary TURN credentials', () => {
  const secret = 'a-test-only-shared-secret-with-32-characters';
  const relay = { ...config, turnSecret: secret, turnCredentialTtl: 3600, iceServers: [
    { urls: 'stun:stun.example.com:3478' },
    { urls: ['turn:turn.example.com:3478', 'turns:turn.example.com:5349'], username: 'legacy', credential: 'legacy-password' },
  ] };
  it('issues coturn-compatible credentials expiring one hour after issuance', () => {
    const servers = clientIceServers(relay, 1700000000000);
    expect(servers[0]).toEqual(relay.iceServers[0]);
    const turn = servers[1];
    expect(turn.urls).toEqual(relay.iceServers[1].urls);
    expect(turn.username).toMatch(/^1700003600:[a-f0-9-]{36}$/);
    // Independent verification using the TURN server authentication formula.
    expect(turn.credential).toBe(createHmac('sha1', secret).update(turn.username!).digest('base64'));
    expect(JSON.stringify(servers)).not.toContain(secret);
    expect(JSON.stringify(servers)).not.toContain('legacy-password');
    expect(relay.iceServers[1].credential).toBe('legacy-password');
  });
  it('uses different credentials for separate requests even within the same second', () => {
    expect(clientIceServers(relay, 1700000000000)[1].credential).not.toBe(clientIceServers(relay, 1700000000000)[1].credential);
  });
  it('preserves explicitly configured test credentials without a shared secret', () => {
    const legacy = { ...relay, turnSecret: '' };
    expect(clientIceServers(legacy)).toEqual(legacy.iceServers);
  });
});
