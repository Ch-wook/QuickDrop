import { expect, it } from 'vitest';
import { connectionAccess } from '../shared/connection-url';

it.each(['http://localhost:3000', 'https://localhost', 'https://app.localhost', 'http://127.0.0.1:3000', 'https://127.0.0.2', 'http://[::1]:3000', 'http://0.0.0.0:3000', 'http://[::]:3000', 'https://localhost.'])('does not offer a phone QR for %s', origin => {
  expect(connectionAccess(origin)).toBe('local-only');
});
it.each(['http://192.168.0.10:3000', 'http://example.com', 'invalid'])('requires HTTPS for %s', origin => {
  expect(connectionAccess(origin)).toBe('https-required');
});
it.each(['https://drop.example.com', 'https://random.trycloudflare.com', 'https://192.168.0.10:3000'])('allows a non-loopback HTTPS QR for %s', origin => {
  expect(connectionAccess(origin)).toBe('ready');
});
it.each(['https://[::ffff:127.0.0.1]', 'https://[::ffff:127.255.1.2]', 'https://[::ffff:0.0.0.0]', 'https://[0:0:0:0:0:0:0:1]'])('rejects alternative loopback and wildcard addresses: %s', origin => {
  expect(connectionAccess(origin)).toBe('local-only');
});
