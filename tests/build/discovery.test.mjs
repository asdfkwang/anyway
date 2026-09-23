import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import config from '../../astro.config.mjs';
const entries = JSON.parse(await readFile('dist/search-index.json', 'utf8'));
const base = config.base.replace(/\/$/, '') + '/';
const localFile = url => {
  const pathname = new URL(url, config.site).pathname;
  assert.ok(pathname.startsWith(base));
  return 'dist/' + decodeURIComponent(pathname.slice(base.length)) + (pathname.endsWith('/') ? 'index.html' : '');
};
test('every indexed translation has HTML, metadata, and a shared AI document', async () => {
  for (const entry of entries) {
    const html = await readFile(localFile(entry.url), 'utf8');
    assert.ok(html.includes('application/ld+json'));
    const structured = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.equal(structured.headline, entry.title);
    assert.equal(structured.inLanguage, entry.lang);
    assert.deepEqual(structured.keywords, entry.tags);
    if (!entry.ai) { assert.equal(entry.aiSummary, null); continue; }
    const markdown = await readFile(localFile(entry.ai), 'utf8');
    assert.ok(markdown.includes(entry.aiSummary));
    const english = entries.find(p => p.id === entry.id && p.lang === 'en');
    assert.ok(english);
    assert.ok(markdown.startsWith(`# ${english.title}`));
    if (entry.lang === 'ko') assert.ok(!markdown.includes(entry.title));
    if (entry.body !== entry.aiSummary) assert.ok(!markdown.includes(entry.body));
    assert.ok(markdown.includes(entry.url));
    assert.ok(!markdown.includes('<script'));
  }
});
test('AI discovery index includes each article once and sitemap URLs resolve', async () => {
  const index = await readFile('dist/llms.txt', 'utf8');
  for (const ai of new Set(entries.map(entry => entry.ai).filter(Boolean))) assert.equal(index.split(ai).length - 1, 1);
  const sitemap = await readFile('dist/sitemap.xml', 'utf8');
  for (const [,url] of sitemap.matchAll(/<loc>(.*?)<\/loc>/g)) await access(localFile(url.replaceAll('&amp;', '&')));
  for (const entry of entries) assert.ok(sitemap.includes(entry.url));
});
