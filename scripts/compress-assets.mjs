import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const root = path.resolve(process.argv[2] || 'dist/client/assets');
let originalBytes = 0;
let brotliBytes = 0;
let gzipBytes = 0;

async function compressDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await compressDirectory(file);
    } else if (entry.isFile() && /\.(?:js|css)$/.test(entry.name)) {
      const source = await readFile(file);
      const [br, gz] = await Promise.all([
        brotli(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
        gzipAsync(source, { level: 9 }),
      ]);
      originalBytes += source.length;
      brotliBytes += Math.min(source.length, br.length);
      gzipBytes += Math.min(source.length, gz.length);
      for (const [suffix, compressed] of [['br', br], ['gz', gz]]) {
        const target = `${file}.${suffix}`;
        if (compressed.length < source.length) await writeFile(target, compressed);
        else await rm(target, { force: true });
      }
    }
  }
}

await compressDirectory(root);
console.log(`Assets: ${originalBytes} bytes; Brotli ${brotliBytes} bytes; gzip ${gzipBytes} bytes.`);
