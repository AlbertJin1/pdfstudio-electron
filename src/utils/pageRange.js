/**
 * Parses "1-3, 5, 8-" into a sorted, de-duplicated list of 1-based page numbers.
 * Returns { pages } or { error }. An open end ("8-") means "to the last page".
 */
export function parsePageRange(text, max) {
  const source = String(text || '').trim();
  if (!source) return { error: 'Enter the pages to export, for example 1-3, 5, 8-10.' };
  const seen = new Set();
  for (const part of source.split(',').map((item) => item.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)\s*(-\s*(\d*))?$/);
    if (!match) return { error: `“${part}” isn’t a valid range. Use values such as 1-3, 5, 8-10.` };
    const start = Number(match[1]);
    const end = match[2] ? (match[3] ? Number(match[3]) : max) : start;
    if (start < 1 || end < start) return { error: `“${part}” isn’t a valid range.` };
    if (end > max) return { error: `Page ${end} is outside this document, which has ${max} page${max === 1 ? '' : 's'}.` };
    for (let page = start; page <= end; page += 1) seen.add(page);
  }
  return { pages: [...seen].sort((a, b) => a - b) };
}

/** Like parsePageRange, but keeps every range as its own group: "1-3, 5, 8-" → [{start:1,end:3},{start:5,end:5},{start:8,end:max}]. */
export function parseRangeGroups(text, max) {
  const source = String(text || '').trim();
  if (!source) return { error: 'Enter at least one range, for example 1-3, 4, 6-8.' };
  const groups = [];
  for (const part of source.split(',').map((item) => item.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)\s*(-\s*(\d*))?$/);
    if (!match) return { error: `“${part}” isn’t a valid range. Use values such as 1-3, 4, 6-8.` };
    const start = Number(match[1]);
    const end = match[2] ? (match[3] ? Number(match[3]) : max) : start;
    if (start < 1 || end < start) return { error: `“${part}” isn’t a valid range.` };
    if (end > max) return { error: `Page ${end} is outside this document, which has ${max} page${max === 1 ? '' : 's'}.` };
    groups.push({ start, end });
  }
  return { groups };
}
