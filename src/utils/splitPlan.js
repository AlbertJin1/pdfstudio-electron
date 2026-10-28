import { parseRangeGroups } from './pageRange.js';

export const MAX_SPLIT_FILES = 1000;

/**
 * Turns the split settings into a list of output files.
 *   mode: 'each' (one file per page) | 'every' (N pages per file) | 'ranges' (one file per range)
 * Returns { groups: [{ start, end }] } (1-based, inclusive) or { error }.
 */
export function buildSplitPlan({ mode, every, rangeText, total }) {
  if (!total || total < 1) return { groups: [] };
  let groups;
  if (mode === 'each') groups = Array.from({ length: total }, (_, index) => ({ start: index + 1, end: index + 1 }));
  else if (mode === 'every') {
    const size = Math.floor(Number(every));
    if (!Number.isFinite(size) || size < 1) return { error: 'Enter how many pages each file should contain (1 or more).' };
    groups = [];
    for (let start = 1; start <= total; start += size) groups.push({ start, end: Math.min(total, start + size - 1) });
  } else {
    const parsed = parseRangeGroups(rangeText, total);
    if (parsed.error) return { error: parsed.error };
    groups = parsed.groups;
  }
  if (groups.length > MAX_SPLIT_FILES) return { error: `That would create ${groups.length} files. Split into at most ${MAX_SPLIT_FILES} files at a time.` };
  return { groups };
}

/** Binder1-page-004.pdf  or  Binder1-pages-004-006.pdf (numbers padded to the document's page count). */
export function splitFileName(baseName, group, total) {
  const pad = Math.max(2, String(total).length);
  const n = (value) => String(value).padStart(pad, '0');
  return group.start === group.end ? `${baseName}-page-${n(group.start)}.pdf` : `${baseName}-pages-${n(group.start)}-${n(group.end)}.pdf`;
}
