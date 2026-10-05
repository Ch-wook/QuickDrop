import { createHmac, randomUUID } from 'node:crypto';
import type { Config } from './config';

// coturn TURN REST authentication: the shared secret never leaves the server.
export function clientIceServers(config: Config, now = Date.now()) {
  if (!config.turnSecret) return config.iceServers;
  const username = `${Math.floor(now / 1000) + config.turnCredentialTtl}:${randomUUID()}`;
  const credential = createHmac('sha1', config.turnSecret).update(username).digest('base64');
  return config.iceServers.map(server => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(url => /^turns?:/.test(url)) ? { urls: server.urls, username, credential } : server;
  });
}
