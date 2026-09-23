export type ConnectionAccess = 'local-only' | 'https-required' | 'ready';

/** A QR pointing at loopback connects to the scanning phone itself, not the PC. */
export function connectionAccess(origin: string): ConnectionAccess {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host)
      || /^\[::ffff:7f[0-9a-f]{2}:/.test(host) || host === '[::ffff:0:0]'
      || ['[::1]', '[::]', '0.0.0.0'].includes(host)) return 'local-only';
    return url.protocol === 'https:' ? 'ready' : 'https-required';
  } catch { return 'https-required'; }
}
