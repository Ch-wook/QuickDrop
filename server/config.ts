import 'dotenv/config';
import { connectionAccess } from '../shared/connection-url';

function numberEnv(name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
const publicUrl = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).origin : '';
const turnSecret = process.env.TURN_SECRET || '';
const turnUrls = (process.env.TURN_URL || '').split(',').map(url => url.trim()).filter(Boolean);
if (turnUrls.some(url => !/^turns?:[^\s]+$/.test(url))) throw new Error('TURN_URL must contain turn: or turns: URLs');
if (turnSecret && (turnSecret.length < 32 || !turnUrls.length)) throw new Error('TURN_SECRET requires at least 32 characters and TURN_URL');
if (turnUrls.length && !turnSecret && (!process.env.TURN_USERNAME || !process.env.TURN_PASSWORD)) throw new Error('TURN_URL requires TURN_SECRET or TURN_USERNAME and TURN_PASSWORD');
if (publicUrl && !/^https?:\/\//.test(publicUrl)) throw new Error('PUBLIC_URL must use HTTP(S)');
if (publicUrl && connectionAccess(publicUrl) !== 'ready') throw new Error('PUBLIC_URL must be an HTTPS origin reachable from both devices, not localhost or an HTTP LAN address.');
export const config = {
  port: numberEnv('PORT', 3000, 0, 65535),
  host: process.env.HOST || '0.0.0.0',
  roomTtl: numberEnv('ROOM_TTL', 600000),
  trustProxy: numberEnv('TRUST_PROXY', 0, 0, 10),
  joinRateLimit: numberEnv('JOIN_RATE_LIMIT', 10, 1, 1000),
  publicUrl,
  turnSecret,
  turnCredentialTtl: numberEnv('TURN_CREDENTIAL_TTL', 3600, 600, 86400),
  maxFileSize: numberEnv('MAX_FILE_SIZE', 209715200, 1, 1073741824),
  maxSessionBytes: numberEnv('MAX_SESSION_BYTES', 209715200, 1, 2147483648),
  iceServers: [
    ...(process.env.STUN_URL === '' ? [] : [{ urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' }]),
    ...(turnUrls.length ? [{ urls: turnUrls, username: turnSecret ? undefined : process.env.TURN_USERNAME, credential: turnSecret ? undefined : process.env.TURN_PASSWORD }] : []),
  ],
};
export type Config = typeof config;
