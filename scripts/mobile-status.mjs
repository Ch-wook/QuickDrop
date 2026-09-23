import { readFile } from 'node:fs/promises';
import { inspectMobileSession } from './mobile-health.mjs';

try {
  const session = JSON.parse(await readFile(new URL('../.quickdrop/mobile.json', import.meta.url), 'utf8'));
  const result = await inspectMobileSession(session);
  console.log(`[${result.status}] ${result.message}`);
  if (result.ok) console.log(session.publicUrl);
  else process.exitCode = 1;
} catch {
  console.log('모바일 실행 정보가 없습니다. npm run dev:mobile을 실행하세요.');
  process.exitCode = 1;
}
