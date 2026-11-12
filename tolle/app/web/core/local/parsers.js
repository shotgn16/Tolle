// Make the most of big study pages – the same rules as server/core/source_parsers.py (the tests check both
// give the same result). Pages holding many works (StudyLight ~40 commentaries, Bible Hub ~15, Catena Bible's
// Church Fathers) are split into those works, each labelled with author, era and kind, and the space is
// shared out so every kind of voice is heard.

export const GROUPS = ['early church', 'reformation & puritan', 'language', 'pastoral', '1700s–1800s', 'modern', 'reference'];

const LANGUAGE = /word (pictures|studies)|greek|hebrew|gnom[eo]n|meyer|critical|exegetical|alford|cambridge|keil|vincent|robertson|expositor's greek|lexic|interlinear/i;
const PASTORAL = /illustrator|sermon|pulpit|homilet|horae|maclaren|expositions|wells of living water|treasury of david|practical observations|family bible|spurgeon|devotion|morning and evening|church pulpit|biblical illustrator/i;
const REFERENCE = /treasury of scripture knowledge|scofield|reference notes|topical|concordance|cross ref/i;
const REFORMATION = /calvin|geneva|trapp|poole|luther|beza|henry|bengel|burkitt|gill|wesley|haydock|lapide|jonathan edwards|owen|bunyan|baxter|coke/i;
const NINETEENTH = /ellicott|barnes|benson|jamieson|fausset|clarke|whedon|lange|schaff|godet|lightfoot|westcott|kelly|darby|abbott|simeon|nisbet|exell|hengstenberg|edersheim|keil|delitzsch|ryle|spurgeon|fourfold gospel|justin edwards|scott/i;
const YEAR = /\b(1[0-9]{3}|20[0-9]{2})\b/g;

export function classify(name, year = null) {
  if (REFERENCE.test(name)) return 'reference';
  if (LANGUAGE.test(name)) return 'language';
  if (PASTORAL.test(name)) return 'pastoral';
  if (year && year < 1000) return 'early church';
  if (REFORMATION.test(name) || (year && year < 1700)) return 'reformation & puritan';
  if ((year && year < 1900) || (!year && NINETEENTH.test(name))) return '1700s–1800s';
  return 'modern';
}

const lines = (text) => (text || '').split('\n').filter((l) => l.trim());
const STOP = new Set(['the', 'and', 'commentary', 'notes', 'bible', 'whole']);
const words = (s) => new Set((s.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w)));

// ---------------------------------------------------------------- StudyLight verse pages
const CITE_HEAD = /^.*?Commentary on\W*[^"”]*?\d+(:\d+)?["”]*\.?\s*/;

/** Clarke, Adam. "Commentary on John 3:16". "The Adam Clarke Commentary". 1832.  →  [author, work, year] */
export function citation(cite) {
  const author = cite.split('. ')[0].trim().replace(/\.+$/, '');
  const rest = cite.replace(CITE_HEAD, '');
  const quoted = [...rest.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1]);
  const work = quoted.length ? quoted[0].trim() : rest.split('. ')[0].trim().replace(/^["“”]+|["“”]+$/g, '').replace(/\.+$/, '');
  const years = rest.match(YEAR) || [];
  return [author, work || cite, years.length ? parseInt(years[0], 10) : null];
}

export function studylight(text) {
  const ls = lines(text);
  const sections = [];
  let body = [];
  for (let i = 0; i < ls.length; i += 1) {
    const ln = ls[i];
    if (ln === 'Bibliographical Information' && i + 1 < ls.length) {
      const [author, work, year] = citation(ls[i + 1]);
      const cut = body.indexOf('Copyright Statement');
      if (cut >= 0) body = body.slice(0, cut);
      const want = words(work);
      for (let j = 0; j < Math.min(body.length, 60); j += 1) {
        const b = body[j];
        const overlap = [...words(b)].filter((w) => want.has(w)).length;
        if (want.size && b.length < 90 && overlap >= Math.max(1, Math.floor((want.size + 1) / 2))) { body = body.slice(j + 1); break; }
      }
      const content = body.join('\n').trim();
      if (content.length > 40) {
        sections.push({ label: `${author} – ${work}${year ? ` (${year})` : ''}`, group: classify(`${author} ${work}`, year), text: content });
      }
      body = [];
      i += 1;
      continue;
    }
    body.push(ln);
  }
  return sections;
}

// ---------------------------------------------------------------- Bible Hub commentary pages
export const BH_NAMES = new Set([
  "Ellicott's Commentary for English Readers", "MacLaren's Expositions", 'Benson Commentary',
  "Matthew Henry's Concise Commentary", "Matthew Henry's Commentary", "Barnes' Notes on the Bible",
  'Jamieson-Fausset-Brown Bible Commentary', "Matthew Poole's Commentary", "Gill's Exposition of the Entire Bible",
  'Geneva Study Bible', "Meyer's NT Commentary", "Expositor's Greek Testament", 'Cambridge Bible for Schools and Colleges',
  "Bengel's Gnomen", "Bengel's Gnomon", 'Pulpit Commentary', "Vincent's Word Studies", 'The Treasury of David',
  'Keil and Delitzsch Biblical Commentary on the Old Testament', 'Pulpit Commentary Homiletics', "Clarke's Commentary",
  "Coffman's Commentary", "Wesley's Notes", "Expositor's Bible Commentary", 'Through the Bible Day by Day',
  "Pett's Commentary", "Calvin's Commentary", 'Biblical Illustrator', 'Sermon Bible', 'Kelly Commentary',
  "Darby's Bible Synopsis", 'Scofield Reference Notes', 'Treasury of Scripture Knowledge', 'Lange Commentary',
]);
const BH_HEADER = /^(EXPOSITORY|EXEGETICAL|HOMILETIC|HOMILETICS|DEVOTIONAL|SERMONS?)\b.*$/;
const BH_NAME = /^(The )?[A-Z][\w'.\- ]{2,70}?(Commentary|for English Readers|Commentaries|Notes|Expositions?|Gnom[eo]n|Testament|Word Studies|Treasury of David|Study Bible|Schools and Colleges|Old Testament|Exposition of the Entire Bible|Exposition|Homiletics|Illustrator)( on the [\w ]+)?$/;

export function biblehub(text) {
  const ls = lines(text);
  const known = ls.filter((l) => BH_NAMES.has(l)).length;
  const isName = known >= 2 ? (l) => BH_NAMES.has(l) : (l) => l.length <= 80 && BH_NAME.test(l);
  const sections = [];
  let cur = null;
  let body = [];
  const close = () => {
    const content = body.filter((b) => !['continued...', 'continued…'].includes(b.toLowerCase())).join('\n').trim();
    if (cur && content.length > 40) sections.push({ label: cur, group: classify(cur), text: content });
  };
  for (const ln of ls) {
    if (BH_HEADER.test(ln)) continue;
    if (isName(ln)) { close(); cur = ln; body = []; continue; }
    if (cur) body.push(ln);
  }
  close();
  return sections;
}

// ---------------------------------------------------------------- Catena Bible (Church Fathers)
const AD = /^AD (\d{2,4})$/;

export function catena(text) {
  const ls = lines(text);
  const starts = [];
  for (let i = 1; i < ls.length; i += 1) if (AD.test(ls[i])) starts.push(i);
  const sections = [];
  starts.forEach((i, n) => {
    const name = ls[i - 1];
    const year = parseInt(ls[i].match(AD)[1], 10);
    const end = n + 1 < starts.length ? starts[n + 1] - 1 : ls.length;
    const content = ls.slice(i + 1, end).filter((l) => l !== 'Read More' && l !== 'Share').join('\n').trim();
    if (content.length > 40) sections.push({ label: `${name} (AD ${year})`, group: year < 1000 ? 'early church' : classify(name, year), text: content });
  });
  return sections;
}

// ---------------------------------------------------------------- Bible Hub interlinear
const STRONGS = /^\d{1,5}$/;
const PARSE = /^[A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*$/;

export function interlinear(text) {
  const ls = lines(text);
  const out = [];
  let i = 0;
  while (i + 3 < ls.length) {
    if (STRONGS.test(ls[i]) && !STRONGS.test(ls[i + 1])) {
      const [num, translit, orig, gloss] = ls.slice(i, i + 4);
      const g = ls[i + 4];
      const grammar = i + 4 < ls.length && PARSE.test(g) && !STRONGS.test(g) ? g : '';
      out.push(`${orig} (${translit}, Strong's ${num}) – ${gloss}${grammar ? ` [${grammar}]` : ''}`);
      i += grammar ? 5 : 4;
      continue;
    }
    i += 1;
  }
  return out.length < 2 ? [] : [{ label: 'Original-language words', group: 'language', text: out.join('\n') }];
}

export const PARSERS = { studylight, biblehub, catena, interlinear };

// ---------------------------------------------------------------- sharing out the space
export function pick(sections, budget, minEach = 600) {
  if (!sections.length) return [];
  const room = Math.max(1, Math.min(sections.length, Math.floor(budget / minEach)));
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, sections.filter((s) => s.group === g)]));
  byGroup.other = sections.filter((s) => !GROUPS.includes(s.group));
  const chosen = [];
  while (chosen.length < room) {
    let took = false;
    for (const g of [...GROUPS, 'other']) {
      if (byGroup[g].length && chosen.length < room) { chosen.push(byGroup[g].shift()); took = true; }
    }
    if (!took) break;
  }
  chosen.sort((a, b) => sections.indexOf(a) - sections.indexOf(b));   // keep the page's own order
  const each = Math.max(minEach, Math.floor(budget / chosen.length));
  return chosen.map((s) => {
    let t = s.text;
    if (t.length > each) { t = t.slice(0, each); const sp = t.lastIndexOf(' '); t = `${sp > 0 ? t.slice(0, sp) : t} […]`; }
    return { ...s, text: t };
  });
}
