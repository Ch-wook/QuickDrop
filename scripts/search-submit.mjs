import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';

// This notifies Naver of a changed public home page; it does not guarantee
// indexing. Never submit temporary /join URLs or transferred content.
try {
  const base = new URL(process.argv[2] || 'https://dropgo.up.railway.app');
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Provide a plain HTTPS origin.');
  const files = (await readdir('public')).filter(name => /^[a-f0-9]{32}\.txt$/.test(name));
  if (files.length !== 1) throw new Error('Expected exactly one public IndexNow verification file.');
  const key = (await readFile(`public/${files[0]}`, 'utf8')).trim();
  if (`${key}.txt` !== files[0]) throw new Error('IndexNow key content does not match its filename.');
  const keyLocation = new URL(files[0], base).href;
  const proof = await fetch(keyLocation, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!proof.ok || (await proof.text()).trim() !== key) throw new Error('Deploy the verification file to the target website before submitting.');
  const home = await fetch(base, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!home.ok || home.headers.get('x-robots-tag')?.includes('noindex')) throw new Error('The home page is not available for indexing.');
  const response = await fetch('https://searchadvisor.naver.com/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: base.host, key, keyLocation, urlList: [base.href] }),
    signal: AbortSignal.timeout(30000),
  });
  if (![200, 202].includes(response.status)) throw new Error(`Naver IndexNow returned HTTP ${response.status}.`);
  const report = { submittedAt: new Date().toISOString(), endpoint: 'https://searchadvisor.naver.com/indexnow', url: base.href, status: response.status, result: response.status === 200 ? 'received' : 'received; key validation pending', indexingConfirmed: false };
  await mkdir('.quickdrop', { recursive: true });
  await writeFile('.quickdrop/search-submission.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`Naver IndexNow HTTP ${report.status}: ${report.result}. Search visibility is not guaranteed or confirmed.`);
} catch (error) {
  console.error(`Search submission failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
