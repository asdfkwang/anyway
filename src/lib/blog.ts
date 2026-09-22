import { getCollection, type CollectionEntry } from 'astro:content';
export const languages = ['ko', 'en'] as const;
export type Language = typeof languages[number];
export const copy = {
  ko: { tagline: 'AI가 할 수 있어도, 나는 어쨌든 직접 이해하고 싶다.', intro: '커널부터 AI, 하드웨어까지. 직접 들여다보고 이해한 것들을 기록합니다.', posts: '기록', back: '모든 글', skip: '본문으로 이동', missing: '번역 준비 중 · English 목록으로', empty: '첫 번째 기록을 준비하고 있습니다.' },
  en: { tagline: 'AI can do it. I want to understand it anyway.', intro: 'Notes on kernels, AI, and hardware. Taking things apart to understand how they work.', posts: 'Writing', back: 'All posts', skip: 'Skip to content', missing: 'Translation coming soon · 한국어 목록으로', empty: 'The first entry is on its way.' },
};
export function localPath(path = '') {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}
export function postPath(post: CollectionEntry<'posts'>) {
  return localPath(`${post.data.lang}/posts/${post.data.translationKey}/`);
}
export async function publishedPosts() {
  const all = await getCollection('posts');
  const keys = new Set<string>();
  for (const post of all) {
    const key = `${post.data.lang}/${post.data.translationKey}`;
    if (keys.has(key)) throw new Error(`Duplicate translation: ${key}`);
    keys.add(key);
    if (!post.id.startsWith(`${post.data.lang}/`)) throw new Error(`Language folder mismatch: ${post.id}`);
  }
  return all.filter(post => !post.data.draft).sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf());
}
export function dateLabel(date: Date, lang: Language) {
  return new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}
