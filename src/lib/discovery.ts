import { render, type CollectionEntry } from 'astro:content';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import mdxRenderer from '@astrojs/mdx/server.js';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { localPath, postPath, publishedPosts } from './blog';
import { uniqueTags } from './tags';
export function aiPath(key: string) { return localPath(`ai/${key}.md`); }
export function absolute(path: string, site: URL | undefined) {
  if (!site) throw new Error('Astro site must be configured');
  return new URL(path, site).href;
}
export async function readableBody(post: CollectionEntry<'posts'>, site: URL | undefined) {
  const { Content } = await render(post);
  const container = await AstroContainer.create();
  container.addServerRenderer({ name: 'astro:jsx', renderer: mdxRenderer });
  const html = await container.renderToString(Content, { request: new Request(absolute(postPath(post), site)) });
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  converter.use(gfm);
  converter.remove(['script', 'style', 'noscript']);
  converter.addRule('highlightedCode', {
    filter: 'pre',
    replacement: (_content, node) => {
      const code = node.textContent ?? '';
      const runs = code.match(/`+/g) ?? [];
      const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
      const language = node.getAttribute('data-language') ?? node.querySelector('code')?.className.match(/language-(\S+)/)?.[1] ?? '';
      return `\n\n${fence}${language}\n${code.replace(/\n$/, '')}\n${fence}\n\n`;
    },
  });
  converter.addRule('absoluteLinks', {
    filter: node => node.nodeName === 'A' && !!node.getAttribute('href'),
    replacement: (content, node) => `[${content}](${new URL(node.getAttribute('href')!, absolute(postPath(post), site)).href})`,
  });
  converter.addRule('absoluteImages', {
    filter: 'img',
    replacement: (_content, node) => `![${node.getAttribute('alt') ?? ''}](${new URL(node.getAttribute('src') ?? '', absolute(postPath(post), site)).href})`,
  });
  return converter.turndown(html);
}
export async function searchEntries(site: URL | undefined) {
  return Promise.all((await publishedPosts()).map(async post => ({
    id: post.data.translationKey,
    lang: post.data.lang,
    title: post.data.title,
    description: post.data.description,
    aiSummary: post.data.aiSummary ?? post.data.description,
    tags: uniqueTags(post.data.tags),
    publishedAt: post.data.publishedAt.toISOString(),
    url: absolute(postPath(post), site),
    path: postPath(post),
    ai: absolute(aiPath(post.data.translationKey), site),
    body: await readableBody(post, site),
  })));
}
