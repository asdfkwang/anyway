import { localPath, type Language } from './blog';
export function normalizeTag(tag: string) { return tag.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '); }
// A reversible, collision-free URL segment supports Korean, C++, C#, and slashes.
export function tagSlug(tag: string) { const normalized = normalizeTag(tag); return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : `~${Array.from(normalized).map(c => c.codePointAt(0)!.toString(16)).join('-')}`; }
export function tagPath(lang: Language, tag: string) { return localPath(`${lang}/tags/${tagSlug(tag)}/`); }
export function uniqueTags(tags: string[]) { return [...new Set(tags.map(normalizeTag).filter(Boolean))].sort(); }
