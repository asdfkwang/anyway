import type { APIRoute } from 'astro';
import { publishedPosts, postPath } from '../../lib/blog';
import { absolute } from '../../lib/discovery';
import { uniqueTags } from '../../lib/tags';
export async function getStaticPaths() {
  const posts = await publishedPosts();
  return [...new Set(posts.map(p => p.data.translationKey))].map(key => ({
    params: { key }, props: { posts: posts.filter(p => p.data.translationKey === key) },
  }));
}
export const GET: APIRoute = async ({ props, site }) => {
  const posts = props.posts as Awaited<ReturnType<typeof publishedPosts>>;
  const sections = await Promise.all(posts.map(async post => `## ${post.data.lang === 'ko' ? '한국어' : 'English'}: ${post.data.title}\n\nSource: ${absolute(postPath(post), site)}\n\nPublished: ${post.data.publishedAt.toISOString().slice(0,10)}\n\nSummary: ${post.data.description}\n\n${post.data.aiSummary ?? post.data.description}`));
  const text = `# Anyway / ${posts[0].data.translationKey}\n\nTags: ${uniqueTags(posts.flatMap(p => p.data.tags)).join(', ')}\n\nConcise editorial summaries of one article. Observations, planned setup, and unverified steps are distinguished below. Follow the source links for the full experiment logs.\n\n${sections.join('\n\n---\n\n')}\n`;
  return new Response(text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
