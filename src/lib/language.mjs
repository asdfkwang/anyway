export const languageStorageKey = 'anyway.language';

/** @param {string | null} saved @param {readonly string[]} languages */
export function chooseLanguage(saved, languages) {
  if (saved === 'ko' || saved === 'en') return saved;
  for (const language of languages) {
    const primary = language.toLowerCase().split('-')[0];
    if (primary === 'ko' || primary === 'en') return primary;
  }
  return 'en';
}
