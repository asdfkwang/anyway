import type { APIRoute } from 'astro';
import { publishedPosts, localPath, postPath, languages } from '../lib/blog';
import { absolute } from '../lib/discovery';
import { uniqueTags, tagPath } from '../lib/tags';
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export const GET: APIRoute = async ({ site }) => {
  const posts = await publishedPosts();
  const paths = [localPath(), ...languages.flatMap(lang => [localPath(`${lang}/`), localPath(`${lang}/search/`), ...uniqueTags(posts.filter(p => p.data.lang === lang).flatMap(p => p.data.tags)).map(tag => tagPath(lang, tag))]), ...posts.map(postPath)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${escape(absolute(path, site))}</loc></url>`).join('')}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
