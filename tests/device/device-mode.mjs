// End-to-end test of the app running on its own ("this device only"), in headless Chromium.
//
//   python3 tests/device/expected.py > /tmp/expected.json
//   node tests/device/device-mode.mjs /tmp/expected.json [screenshot-dir]
//
// The web app is served from tolle/app/web. Study sites, bible-api.com and Ollama are answered by
// fakes inside the test, so it needs no network. It checks that the on-device engine writes the same
// prompts as the server, runs every AI feature, keeps data encrypted, survives a reload, and that
// backups restore.
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(here, '../../tolle/app/web');
const EXPECTED = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const SHOTS = process.argv[3];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ORIGIN = 'https://tolle.test';
const OLLAMA = 'https://ollama.test:11434';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failures += 1; };
const chats = [];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

async function setup(context) {
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.origin === ORIGIN) {
      const p = join(WEB, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
      if (!p.startsWith(WEB) || !existsSync(p)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, body: readFileSync(p), headers: { 'content-type': TYPES[extname(p)] || 'application/octet-stream' } });
    }
    if (u.origin === OLLAMA) {
      if (u.pathname === '/api/tags') return route.fulfill({ status: 200, headers: cors, json: { models: [{ name: 'qwen3:8b' }, { name: 'gemma3:4b' }] } });
      if (u.pathname === '/api/show') return route.fulfill({ status: 200, headers: cors, json: { capabilities: ['completion', 'thinking'] } });
      if (u.pathname === '/api/chat') {
        const body = JSON.parse(req.postData());
        chats.push(body);
        if (JSON.stringify(body.messages).includes('SLOWTASK')) await new Promise((r) => setTimeout(r, 5000));
        const last = body.messages[body.messages.length - 1].content;
        // LONGTASK: the first answer stops at the length limit, the continuation finishes it.
        const all = JSON.stringify(body.messages);
        if (all.includes('LONGTASK')) {
          const continuing = String(last).includes('was cut off');
          const part = continuing ? 'limit, carried on.\n\n## Application\nThe end.' : '## Overview\nThis first part stops at the length';
          return route.fulfill({ status: 200, headers: cors, json: { message: { role: 'assistant', content: part }, done: true, done_reason: continuing ? 'stop' : 'length' } });
        }
        const content = `## Overview\nFake answer number ${chats.length}. The prompt began: ${String(last).slice(0, 60).replace(/\n/g, ' ')}`;
        return route.fulfill({ status: 200, headers: cors, json: { message: { role: 'assistant', content, thinking: body.think ? 'Considering…' : '' }, done: true, done_reason: 'stop' } });
      }
    }
    if (u.hostname === 'bible-api.com') {
      return route.fulfill({ status: 200, headers: cors, json: { reference: 'x', verses: [1, 2, 3].map((v) => ({ book_name: 'John', chapter: 3, verse: v, text: `Verse ${v} text of the fake Bible, long enough to count.` })) } });
    }
    const page = (text) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/html' },
      body: `<html><body><nav>menu</nav><article>${text.split('\n').map((l) => `<p>${l.replace(/</g, '&lt;')}</p>`).join('')}</article></body></html>` });
    if (u.hostname === 'www.studylight.org' && u.pathname.startsWith('/commentary/')) return page(EXPECTED.pages.studylight);
    if (u.hostname === 'biblehub.com' && u.pathname.startsWith('/commentaries/')) return page(EXPECTED.pages.biblehub);
    if (u.hostname === 'biblehub.com' && u.pathname.startsWith('/interlinear/')) return page(EXPECTED.pages.interlinear);
    if (u.hostname === 'catenabible.com') return page(u.pathname.startsWith('/jn/') ? EXPECTED.pages.catena : EXPECTED.pages.catena_empty);
    if (/studylight|biblestudytools|bibleproject|blueletterbible|biblehub|gotquestions|enduringword/.test(u.hostname)) {
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/html' },
        body: `<html><body><nav>menu</nav><article><h1>Commentary on ${u.pathname}</h1><p>A long and careful commentary paragraph from ${u.hostname} about this passage and its meaning.</p></article></body></html>` });
    }
    return route.fulfill({ status: 404, headers: cors, body: '' });
  });
  await context.addInitScript(() => { try { localStorage.setItem('tolle.mode', 'device'); } catch { /* */ } });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await setup(context);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); });

console.log('Start-up');
await page.goto(`${ORIGIN}/index.html#/settings?tab=ai&welcome=1`);
await page.waitForSelector('.welcome-ai', { timeout: 20000 });
ok(true, 'settings opens with the “Choose your AI” welcome');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-choose-ai.png` });

// Helpers that run inside the page, through the same api() the screens use.
const call = (fn, arg) => page.evaluate(async ([src, a]) => {
  const api = await import('/core/api.js');
  // eslint-disable-next-line no-new-func
  return new Function('api', 'a', `return (async () => { ${src} })();`)(api, a);
}, [fn, arg]);

console.log('Prompts match the server');
const parity = await page.evaluate(async (E) => {
  const [{ systemBase }, research, insights, builder, library, calling, bible] = await Promise.all([
    import('/core/local/prompts.js'), import('/features/research/local.js'), import('/features/insights/local.js'),
    import('/features/builder/local.js'), import('/features/library/local.js'), import('/features/calling/local.js'), import('/core/local/bible.js')]);
  await (await import('/core/api.js')).get('api/health');   // starts the engine (loads settings)
  const res = {
    system: systemBase('Baptist') === E.system,
    passage: research.passageStudy('John 3:16, Romans 8', 'love', 'deep', 'SRC', 'sermon', 'short') === E.passage,
    passage_plain: research.passageStudy('Psalm 23', '', 'intro', 'SRC') === E.passage_plain,
    insight: insights.insight('life', 'work and rest', 'study', 'SRC') === E.insight,
    builder: builder.builder(E.builder_params, 'SRC') === E.builder,
    notes: library.notesAnalysis('My notes', 'Some notes', ['John 1'], 'SRC', 'preach') === E.notes,
    calling_system: calling.callingSystem('Anglican') === E.calling_system,
    calling_opening: calling.callingOpening('I feel drawn to teaching') === E.calling_opening,
    template: JSON.stringify(bible.templateVars(bible.parseRefs('1 John 4:7-12')[0], 'kjv')) === JSON.stringify(E.template),
  };
  const refs = {};
  for (const [t, want] of Object.entries(E.refs)) refs[t] = JSON.stringify(bible.parseRefs(t)) === JSON.stringify(want) ? true : JSON.stringify(bible.parseRefs(t));
  return { res, refs };
}, EXPECTED);
for (const [k, v] of Object.entries(parity.res)) ok(v, `${k} prompt is identical`);
const srcParity = await page.evaluate(async (E) => {
  const P = await import('/core/local/parsers.js');
  const S = await import('/core/local/sources.js');
  const { parseRefs } = await import('/core/local/bible.js');
  const SHARED = (await import('/core/local/shared.js')).default;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const parsed = Object.fromEntries(Object.entries(E.pages).map(([k, v]) => [k, P.PARSERS[k.split('_')[0]](v)]));
  const mixed = [...parsed.studylight, ...parsed.biblehub, ...parsed.catena];
  const plan = S.plan(parseRefs('Song of Solomon 2:4; 1 Corinthians 13:4'), SHARED.default_sources, 'web', ['love', 'work and rest']).map(([s, u, l]) => [s.id, u, l]);
  return {
    parsed: Object.fromEntries(Object.keys(parsed).map((k) => [k, same(parsed[k], E.parsed[k])])),
    picked: same(P.pick(mixed, 3000), E.picked),
    plan: same(plan, E.plan) || JSON.stringify(plan),
    citations: same([
      'Clarke, Adam. "Commentary on John 3:16". "The Adam Clarke Commentary". 1832.',
      'Exell, Joseph S. "Commentary on "John 3:16". The Biblical Illustrator. 1905-1909. New York.',
      'Haydock, George Leo. "Commentary on John 3". "George Haydock\'s Catholic Bible Commentary". 1859.'].map(P.citation), E.citations),
  };
}, EXPECTED);
for (const [k, v] of Object.entries(srcParity.parsed)) ok(v, `${k} page is split the same as on the server`);
ok(srcParity.picked, 'sources are shared out the same as on the server');
ok(srcParity.plan === true, `the same study pages are read as on the server${srcParity.plan === true ? '' : `: ${srcParity.plan}`}`);
ok(srcParity.citations, 'citations are read the same as on the server');
for (const [k, v] of Object.entries(parity.refs)) ok(v === true, `parse “${k}”${v === true ? '' : ` → ${v}`}`);

console.log('Settings and models');
await call(`await api.put('api/settings', { 'ai.provider': 'ollama', 'ollama.url': '${OLLAMA}', 'ai.model': 'qwen3:8b', 'openai.key': 'sk-secret-123' }); return true;`);
const st = await call(`return api.get('api/settings');`);
ok(st.values['ai.provider'] === 'ollama' && st.values['ollama.url'] === OLLAMA, 'settings saved');
ok(st.values['openai.key'] !== 'sk-secret-123', 'API keys are masked when read back');
const models = await call(`return api.get('api/ai/models?provider=ollama');`);
ok(models.models.some((m) => m.id === 'qwen3:8b' && m.thinking), 'lists Ollama models with thinking support');

console.log('AI features');
const study = await call(`const j = await api.runJob('passage_study', { passages: 'John 3:16-18', focus: 'love', level: 'study', thinking: true }); return j.result;`);
ok(study && study.study_id && study.entry_id, 'passage study finished and saved');
const lastChat = chats[chats.length - 1];
ok(lastChat.think === true && lastChat.messages[0].role === 'system', 'thinking request sent with system message');
ok(/StudyLight/.test(lastChat.messages[1].content) && /Verse 1 text of the fake Bible/.test(lastChat.messages[1].content), 'prompt includes the study sites and Bible text');
const sent = lastChat.messages[1].content;
ok(/#### Calvin, John – Calvin's Commentary on the Bible \(1840\) · reformation & puritan/.test(sent), 'StudyLight is split into its commentators, each labelled');
ok(/Augustine of Hippo \(AD 430\) · early church/.test(sent) && /MacLaren's Expositions · pastoral/.test(sent) && /Strong's 25/.test(sent), `Church Fathers, sermons and original languages are all in the prompt ${[/Augustine/, /MacLaren/, /Strong's 25/].map((r) => r.test(sent)).join()}`);
if (process.env.DUMP) console.log(sent.slice(0, 6000));
ok(/Make full use of the SOURCES/.test(sent), 'the AI is told to weigh every kind of source');
const s1 = await call(`return api.get('api/studies/' + a);`, study.study_id);
ok(s1.entries[0].author === 'ai' && /Fake answer/.test(s1.entries[0].content), 'AI note stored on the study');
ok(s1.entries[0].meta.sources.some((x) => x.ok), 'sources recorded on the note');

const ins = await call(`return (await api.runJob('insight', { mode: 'passage', query: 'Psalm 23', level: 'intro' })).result;`);
ok(ins.study_id > study.study_id, 'insight finished');
const plan = await call(`return (await api.runJob('builder', { audience: 'youth', passages: 'Luke 15', theme: 'grace', sessions: 1, level: 'study' })).result;`);
ok(!!plan.entry_id, 'study plan finished');
const ins2 = await call(`return (await api.runJob('insight', { mode: 'life', query: 'work and rest', level: 'study' })).result;`);
ok(!!ins2.entry_id, 'insight on an area of life (AI suggests passages first)');

const notes = await call(`
  const s = await api.post('api/studies', { title: 'Sermon notes', kind: 'notes', content: 'Thoughts on John 1:1-5 and Genesis 1.' });
  const fd = new FormData();
  fd.append('files', new File(['More notes about Romans 12:1-2 and living sacrifice.'], 'extra.txt', { type: 'text/plain' }));
  fd.append('study_id', String(s.id));
  await api.api('POST', 'api/notes/upload', fd);
  const j = await api.runJob('notes_analyze', { study_id: s.id, level: 'study' });
  return { id: s.id, result: j.result, study: await api.get('api/studies/' + s.id) };`);
ok(notes.study.files.length === 1 && /Romans 12/.test(notes.study.files[0].preview), 'uploaded file read on the device');
ok(notes.study.entries.some((e) => e.author === 'ai' && e.type === 'analysis'), 'notes analysed and compared with the sources');
ok(/Romans 12/.test(chats[chats.length - 1].messages[1].content) && /John 1/.test(chats[chats.length - 1].messages[1].content), 'analysis prompt has the notes and the uploaded file');
const blob = await call(`const b = await api.get('api/files/' + a); return await b.text();`, notes.study.files[0].id);
ok(/living sacrifice/.test(blob), 'uploaded file opens again (decrypted)');

const calling = await call(`
  const c = await api.post('api/calling', { focus: 'teaching' });
  await api.waitJob(c.job);
  const m = await api.post('api/calling/' + c.id + '/message', { content: 'I love explaining the Bible to children.' });
  await api.waitJob(m.job);
  const s = await api.post('api/calling/' + c.id + '/summary', {});
  await api.waitJob(s.job);
  return api.get('api/calling/' + c.id);`);
ok(calling.messages.map((m) => m.role).join(',') === 'ai,user,ai,summary', 'calling: opening, reply and summary');
ok(/\(Session start\)|Begin the session/.test(JSON.stringify(chats.slice(-3)[0].messages)), 'calling starts with the opening prompt');

console.log('Reading tracker');
const tr = await call(`
  await api.post('api/tracker/reading/manual', { book: 'jn', chapter: 3, minutes: 12, note: 'evening' });
  const s = await api.post('api/tracker/reading/start', { book: 'Romans', chapter: 8 });
  await api.post('api/tracker/app', {});
  await api.post('api/tracker/external', { app: 'YouVersion', minutes: 6 });
  const pending = await api.get('api/notifications/pending');
  const stats = await api.get('api/tracker/stats?days=7');
  const ch = await api.get('api/bible/chapter?book=John&chapter=3');
  return { stats, pending, ch };`);
const today = tr.stats.days[tr.stats.today];
ok(today.chapters.some((c) => c.label === 'John 3' && c.minutes === 12), 'manual reading logged (book abbreviation understood)');
ok(tr.stats.streak === 1, 'streak counts today');
ok(tr.pending.length === 1 && /YouVersion/.test(tr.pending[0].body), '“What did you read?” prompt raised on the device');
ok(tr.ch.ok && tr.ch.verses.length === 3, 'Bible chapter loads for the reader');

const dash = await call(`return api.get('api/dashboard');`);
ok(dash.recent.length >= 4 && dash.tracker && dash.ai.model === 'qwen3:8b', 'home screen summary');

console.log('Feature switches');
const off = await call(`await api.put('api/admin/features', { disabled: ['calling'] }); try { await api.get('api/calling'); return 'reachable'; } catch (e) { return e.status; } finally { await api.put('api/admin/features', { disabled: [] }); }`);
ok(off === 404, 'a switched-off feature is unavailable');

console.log('Encryption and persistence');
await page.evaluate(async () => (await import('/core/local/engine.js')).flush());
const raw = await page.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open('tolle-device');
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const db = r.result;
    const names = [...db.objectStoreNames];
    const tx = db.transaction(names, 'readonly');
    const out = [];
    for (const n of names) {
      const store = tx.objectStore(n);
      const c = store.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return;
        const v = cur.value;
        const bytes = v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : v?.data ? new Uint8Array(v.data) : null;
        out.push([String(cur.key), bytes ? new TextDecoder('latin1').decode(bytes) : JSON.stringify(v)]);
        cur.continue();
      };
    }
    tx.oncomplete = () => res(out);
  };
}));
const everything = raw.map(([, v]) => v).join('\n');
ok(raw.length >= 5, `data stored in IndexedDB (${raw.length} records)`);
ok(!/Fake answer|living sacrifice|explaining the Bible|sk-secret-123|Sermon notes/.test(everything), 'nothing readable at rest – notes, files, reflections and keys are encrypted');

await page.reload();
await page.waitForSelector('#nav a', { timeout: 20000 });
const after = await call(`return (await api.get('api/studies')).map((s) => s.title);`);
ok(after.includes('Sermon notes') && after.length === 5, 'studies are still there after restarting the app');

console.log('Backup and restore');
const back = await call(`
  try { await api.post('api/device/export', { password: 'short' }); return 'no error'; } catch (e) { if (e.status !== 400) return 'bad status'; }
  const { data } = await api.post('api/device/export', { password: 'correct horse battery' });
  const id = (await api.get('api/studies')).find((s) => s.title === 'Sermon notes').id;
  await api.del('api/studies/' + id);
  const before = (await api.get('api/studies')).length;
  let wrong;
  try { await api.post('api/device/import', { data, password: 'wrong password!' }); wrong = 'accepted'; } catch (e) { wrong = e.message; }
  await api.post('api/device/import', { data, password: 'correct horse battery' });
  const restored = await api.get('api/studies');
  const s = await api.get('api/studies/' + restored.find((x) => x.title === 'Sermon notes').id);
  const file = await (await api.get('api/files/' + s.files[0].id)).text();
  return { before, after: restored.length, wrong, plain: /Sermon notes|Fake answer/.test(data), file };`);
ok(back.before === 4 && back.after === 5, 'backup restores a deleted study');
ok(/Wrong password/.test(back.wrong), 'wrong backup password is refused');
ok(!back.plain, 'backup file is encrypted');
ok(/living sacrifice/.test(back.file), 'uploaded files come back with the backup');

console.log('Tasks');
await page.goto(`${ORIGIN}/index.html#/research`);
await page.waitForSelector('.page-head', { timeout: 15000 });
await call(`api.post('api/ai/jobs', { kind: 'passage_study', passages: 'Mark 4:35-41', focus: 'SLOWTASK storm' }); return true;`);
await page.goto(`${ORIGIN}/index.html#/notes`);   // leave the screen while it works
if (process.env.DEBUG_TASKS) { for (let i = 0; i < 4; i++) { console.log(JSON.stringify(await call(`return (await api.get('api/ai/jobs')).slice(0,2);`)), await page.evaluate(() => [...document.querySelectorAll("[data-task-count]")].map(e=>e.outerHTML+"|"+e.hidden).join(" "))); await page.waitForTimeout(1000); } }
await page.waitForFunction(() => document.querySelector('#nav [data-task-count]')?.textContent === '1', null, { timeout: 15000 }).then(() => ok(true, 'menu shows 1 task in progress'), () => ok(false, 'menu shows 1 task in progress'));
await page.goto(`${ORIGIN}/index.html#/tasks`);
await page.waitForSelector('.task-working', { timeout: 10000 }).then(() => ok(true, 'Tasks screen lists the running task'), () => ok(false, 'Tasks screen lists the running task'));
ok(/Passage study/.test(await page.textContent('.tasks')) && /Mark 4:35-41/.test(await page.textContent('.tasks')), 'task is named, with what it is about');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/10-tasks-running.png` });
await page.goto(`${ORIGIN}/index.html#/notes`);
await page.waitForSelector('.task-toast', { timeout: 20000 }).then(() => ok(true, '“Passage study is ready” message appears on another screen'), () => ok(false, '“ready” message appears on another screen'));
const openHref = await page.getAttribute('.task-toast .toast-action', 'href').catch(() => '');
ok(/^#\/study\/\d+$/.test(openHref || ''), 'message has an Open link to the study');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/11-task-ready.png` });
await page.reload();
await page.goto(`${ORIGIN}/index.html#/tasks`);
await page.waitForSelector('.task-done', { timeout: 15000 });
ok((await page.$$('.task-done')).length >= 5, 'finished tasks are still listed after restarting the app');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/12-tasks.png` });
await page.click('text=Clear finished');
await page.waitForSelector('.tasks .empty', { timeout: 10000 }).then(() => ok(true, 'Clear finished empties the list'), () => ok(false, 'Clear finished empties the list'));

console.log('Complete answers');
const long = await call(`return (await api.runJob('passage_study', { passages: 'Ruth 1', focus: 'LONGTASK' })).result;`);
const longStudy = await call(`return api.get('api/studies/' + a);`, long.study_id);
ok(longStudy.entries[0].content === '## Overview\nThis first part stops at the length limit, carried on.\n\n## Application\nThe end.', 'a cut-off answer is continued and joined seamlessly');
ok(chats[chats.length - 1].messages.slice(-2)[0].role === 'assistant' && /was cut off/.test(chats[chats.length - 1].messages.slice(-1)[0].content), 'continuation sends the answer so far and asks to carry on');
ok(chats[chats.length - 1].options.num_predict === 8000, 'longest answer setting reaches the model');

console.log('Small instruct models');
await call(`await api.put('api/settings', { 'ai.prompt_style': 'compact', 'ai.max_output_tokens': 3000 }); return true;`);
await call(`return (await api.runJob('passage_study', { passages: 'Psalm 1', level: 'intro' })).result;`);
const compactMsgs = chats[chats.length - 1].messages;
ok(compactMsgs[1].content.startsWith('<SOURCES>') && /Write the answer now\.$/.test(compactMsgs[1].content.trim()), 'compact prompts put the sources first and the task last');
ok(/Say each thing once/.test(compactMsgs[0].content) && compactMsgs[0].content.length < 700, 'compact ground rules are short');
ok(chats[chats.length - 1].options.num_predict === 3000, 'small-model answer length used');
await call(`await api.put('api/settings', { 'ai.prompt_style': 'auto', 'ai.max_output_tokens': 8000 }); return true;`);

console.log('Bible chat');
await page.goto(`${ORIGIN}/index.html#/chat`);
await page.waitForSelector('.chat-welcome', { timeout: 15000 });
ok((await page.$$('.starters .chip')).length >= 4, 'chat opens with conversation starters');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/13-chat-welcome.png` });
await page.click('.starters .chip >> nth=0');
await page.click('.chat-composer .send');
await page.waitForSelector('.bubble.ai:not(.typing)', { timeout: 20000 });
const chatReq = chats[chats.length - 1];
ok(/Bible/.test(chatReq.messages[0].content) && chatReq.messages[chatReq.messages.length - 1].role === 'user', 'chat sends the companion guide and your message');
ok(/#\/chat\/\d+$/.test(page.url()), 'the conversation opens');
await page.fill('.chat-composer textarea', 'Thank you, that helps');
await page.click('.chat-composer .send');
await page.waitForFunction(() => document.querySelectorAll('.bubble.ai:not(.typing)').length === 2, null, { timeout: 20000 });
const roles = chats[chats.length - 1].messages.map((m) => m.role).join(',');
ok(roles === 'system,user,assistant,user', `the whole conversation is sent (${roles})`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/14-chat.png` });
const thread = await call(`return (await api.get('api/chat'))[0];`);
ok(thread.title.startsWith('I’m feeling anxious') || thread.title.startsWith("I'm feeling anxious"), 'conversation is named from the first message');

console.log('Appearance');
await page.goto(`${ORIGIN}/index.html#/settings?tab=appearance`);
await page.waitForSelector('.swatches', { timeout: 15000 });
await page.click('.swatches >> nth=0 >> [aria-label="Blue"]');
await page.click('.seg >> text=Dark');
await page.waitForTimeout(600);
const look = await page.evaluate(() => ({ brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(), mode: document.documentElement.dataset.theme }));
ok(look.mode === 'dark' && look.brand && look.brand !== '#2bb5a8', `colour and dark mode apply straight away (${look.brand})`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/15-appearance.png` });
const saved = await call(`return (await api.get('api/settings')).values;`);
ok(saved['ui.accent'] === '#1d4ed8' && saved['ui.theme'] === 'dark', 'appearance is saved');
await page.click('.swatches >> nth=1 >> [aria-label="Blue"]');
await page.waitForTimeout(200);
ok(await page.isVisible('.hint.warn'), 'warns when the AI colour is too close to the main colour');
await page.reload();
await page.waitForSelector('.page-head', { timeout: 15000 });
ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'colours stay after restarting');
await call(`await api.put('api/settings', { 'ui.theme': 'auto', 'ui.accent': '#0f766e', 'ui.ai_colour': '#7c3aed' }); return true;`);

console.log('Screens');
for (const [hash, name, sel] of [['#/', '02-home', '.page-head'], [`#/study/${study.study_id}`, '03-study', '.note.ai'],
  ['#/tracker', '04-tracker', '.page-head'], ['#/settings?tab=account', '05-account', '.card'], ['#/settings?tab=about', '06-about', '.card']]) {
  await page.goto(`${ORIGIN}/index.html${hash}`);
  try { await page.waitForSelector(sel, { timeout: 15000 }); ok(true, `${hash} renders`); } catch { ok(false, `${hash} renders`); }
  await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await setup(phone);
const pp = await phone.newPage();
await pp.goto(`${ORIGIN}/index.html#/`);
await pp.waitForSelector('.page-head', { timeout: 20000 });
if (SHOTS) await pp.screenshot({ path: `${SHOTS}/07-phone-home.png` });

console.log('First launch in the phone app');
const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await setup(fresh);
await fresh.addInitScript(() => {
  try { localStorage.removeItem('tolle.mode'); } catch { /* */ }
  window.Capacitor = { isNativePlatform: () => true, Plugins: {} };   // looks like the app, with no native plugins
});
const fp = await fresh.newPage();
fp.on('pageerror', (e) => errors.push(e.message));
await fp.goto(`${ORIGIN}/index.html`);
await fp.waitForSelector('.choices', { timeout: 20000 });
ok(true, 'asks how to use Tolle: on this device, or with a server');
if (SHOTS) await fp.screenshot({ path: `${SHOTS}/08-phone-first-launch.png` });
await fp.click('text=On this device only');
await fp.waitForSelector('.welcome-ai', { timeout: 20000 });
ok(await fp.evaluate(() => localStorage.getItem('tolle.mode')) === 'device', 'choosing “On this device only” opens AI setup');
if (SHOTS) await fp.screenshot({ path: `${SHOTS}/09-phone-choose-ai.png` });

ok(errors.length === 0, `no script errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll device-mode checks passed');
process.exit(failures ? 1 : 0);
