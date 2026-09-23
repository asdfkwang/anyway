import type { APIRoute } from 'astro';
import { publishedPosts, localPath } from '../lib/blog';
import { absolute, aiPath } from '../lib/discovery';
import { uniqueTags } from '../lib/tags';
export const GET: APIRoute = async ({ site }) => {
  const posts = (await publishedPosts()).filter(p => p.data.lang === 'en');
  const keys = [...new Set(posts.map(p => p.data.translationKey))];
  const lines = keys.map(key => {
    const group = posts.filter(p => p.data.translationKey === key);
    return `- [${group.map(p => p.data.title).join(' / ')}](${absolute(aiPath(key), site)}): ${uniqueTags(group.flatMap(p => p.data.tags)).join(', ')}`;
  });
  return new Response(`# Anyway\n\n> AI can do it. I want to understand it anyway.\n\nEnglish summaries of technical notes on kernels, AI, and hardware. Human-readable articles are available in Korean and English. This is an optional discovery index, not a crawler access policy.\n\n## Indexes\n\n- [Full-text JSON index](${absolute(localPath('search-index.json'), site)})\n- [Sitemap](${absolute(localPath('sitemap.xml'), site)})\n\n## Articles\n\n${lines.join('\n')}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
