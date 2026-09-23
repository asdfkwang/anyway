import type { APIRoute } from 'astro';
import type { CollectionEntry } from 'astro:content';
import { publishedPosts, postPath } from '../../lib/blog';
import { absolute } from '../../lib/discovery';
import { uniqueTags } from '../../lib/tags';
export async function getStaticPaths() {
  const posts = await publishedPosts();
  return posts.filter(p => p.data.lang === 'en').map(post => ({
    params: { key: post.data.translationKey },
    props: { post, translations: posts.filter(p => p.data.translationKey === post.data.translationKey) },
  }));
}
export const GET: APIRoute = ({ props, site }) => {
  const post = props.post as CollectionEntry<'posts'>;
  const translations = props.translations as CollectionEntry<'posts'>[];
  const sources = translations.map(p => `- ${p.data.lang === 'en' ? 'English' : 'Korean'}: ${absolute(postPath(p), site)}`).join('\n');
  const text = `# ${post.data.title}\n\nPublished: ${post.data.publishedAt.toISOString().slice(0, 10)}\n\nTags: ${uniqueTags(post.data.tags).join(', ')}\n\n## Key facts\n\n${post.data.aiSummary ?? post.data.description}\n\n## Sources\n\n${sources}\n`;
  return new Response(text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
