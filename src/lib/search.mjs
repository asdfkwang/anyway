const normalize = value => value.normalize('NFKC').toLowerCase();
/** All terms must match. Tags and titles rank above body-only matches. */
export function rankEntries(entries, query) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return entries.map(entry => {
    const tags = entry.tags.map(normalize);
    const title = normalize(entry.title);
    const description = normalize(entry.description);
    const body = normalize(entry.body);
    let score = 0;
    for (const term of terms) {
      const word = term.replace(/^#/, '');
      if (!word) return { entry, score: 0 };
      if (term.startsWith('#')) { if (!tags.includes(word)) return { entry, score: 0 }; score += 10; }
      else if (tags.some(tag => tag.includes(word))) score += 8;
      else if (title.includes(word)) score += 5;
      else if (description.includes(word)) score += 3;
      else if (body.includes(word)) score += 1;
      else return { entry, score: 0 };
    }
    return { entry, score };
  }).filter(result => result.score > 0).sort((a,b) => b.score - a.score).map(result => result.entry);
}
