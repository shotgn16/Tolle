// Spot and remove repetition loops in AI answers – the same rules as server/core/ai/repetition.py.
const SEP = '[\\s—–\\-,;.:*]*';
const loopRe = (n) => new RegExp(`(.{12,300}?)(?:${SEP}\\1){${n},}`, 'gs');
const wordy = (phrase) => (phrase.match(/[A-Za-z]/g) || []).length >= 8;

export function hasLoop(text) {
  for (const m of (text || '').matchAll(loopRe(3))) if (wordy(m[1])) return true;
  return false;
}

function repeatedSentences(text) {
  let changed = false;
  const out = text.split('\n').map((para) => {
    const seen = {};
    return para.split(/(?<=[.!?])\s+/).filter((sent) => {
      const key = sent.toLowerCase().replace(/\W+/g, ' ').trim();
      if (key.length > 25) {
        seen[key] = (seen[key] || 0) + 1;
        if (seen[key] > 2) { changed = true; return false; }
      }
      return true;
    }).join(' ');
  }).join('\n');
  return [out, changed];
}

/** Collapse runs of a repeated phrase to one copy. Returns [text, changed]. */
export function clean(text) {
  if (!text) return [text, false];
  const collapsed = text.replace(loopRe(3), (whole, phrase) => (wordy(phrase) ? phrase : whole));
  const [out, changed2] = repeatedSentences(collapsed);
  return [out, collapsed !== text || changed2];
}

export const LOOP_NOTE = '\n\n*The model started repeating itself here, so Tolle stopped it. Try again, '
  + 'choose a lower depth, or use a larger model for a complete answer.*';
