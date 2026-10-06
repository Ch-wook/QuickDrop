import type { Express, NextFunction, Request, Response } from 'express';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

type Variant = { encoding: 'br' | 'gzip' | 'identity'; file: string };
type StaticFile = { file: string; variants: Variant[]; negotiate: boolean; cache: string };

export function mountStatic(app: Express, directory = path.resolve('dist/client')) {
  const root = path.resolve(directory);
  const files = new Map<string, StaticFile>();
  function collect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { collect(file); continue; }
      if (!entry.isFile()) continue;
      const url = `/${path.relative(root, file).split(path.sep).join('/')}`;
      const asset = url.startsWith('/assets/');
      if (asset && /\.(?:br|gz)$/.test(entry.name)) continue;
      const negotiate = asset && /\.(?:js|css)$/.test(entry.name);
      const variants: Variant[] = [];
      if (negotiate && existsSync(`${file}.br`)) variants.push({ encoding: 'br', file: `${file}.br` });
      if (negotiate && existsSync(`${file}.gz`)) variants.push({ encoding: 'gzip', file: `${file}.gz` });
      variants.push({ encoding: 'identity', file });
      const immutable = asset && /^.+-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(entry.name);
      const cache = /\.html$/.test(entry.name) ? 'no-cache'
        : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
      files.set(url, { file, variants, negotiate, cache });
    }
  }
  collect(root);
  const index = files.get('/index.html');
  if (!index) throw new Error('Production index.html is missing. Run npm run build first.');

  function serve(resource: StaticFile, req: Request, res: Response, next: NextFunction) {
    if (resource.negotiate) res.vary('Accept-Encoding');
    const encoding = req.acceptsEncodings(...resource.variants.map(variant => variant.encoding));
    const variant = resource.variants.find(candidate => candidate.encoding === encoding);
    if (!variant) { res.set('Cache-Control', 'no-store').status(406).end(); return; }
    res.type(path.extname(resource.file));
    res.set('Cache-Control', resource.cache);
    if (variant.encoding !== 'identity') res.set('Content-Encoding', variant.encoding);
    res.sendFile(variant.file, { cacheControl: false, acceptRanges: false, dotfiles: 'deny' }, error => {
      if (error) {
        if (!res.headersSent) { res.removeHeader('Content-Encoding'); res.set('Cache-Control', 'no-store'); }
        next(error);
      }
    });
  }

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }
    let url: string;
    try { url = decodeURIComponent(req.path); }
    catch { res.set('Cache-Control', 'no-store').status(400).end(); return; }
    const resource = files.get(url);
    if (!resource) { next(); return; }
    serve(resource, req, res, next);
  });
  app.get(['/', '/join/:roomId'], (req, res, next) => serve(index, req, res, next));
}
