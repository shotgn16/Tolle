// Study notes on the device (mirrors server/features/library). Also provides the generic study and
// note endpoints that passage studies, insights and study plans save into.
import { AIError } from '../../core/local/ai.js';
import { parseRefs } from '../../core/local/bible.js';
import { extractText, imageB64ForAi, isImage, isPdf, pdfPagesB64 } from '../../core/local/extract.js';
import * as J from '../../core/local/jobs.js';
import { levelGuide, sourcesBlock, transcribeImage } from '../../core/local/prompts.js';
import * as settings from '../../core/local/settings.js';
import { formatForPrompt, gather, sourceMeta } from '../../core/local/sources.js';
import { db } from '../../core/local/store.js';
import * as S from '../../core/local/studies.js';

const MAX_UPLOAD_MB = 50;

export function notesAnalysis(title, notes, refs, src, level) {
  return `The user has uploaded or written their own study notes titled "${title}". Read them carefully, then compare them with the research SOURCES.\n\n`
    + `${levelGuide(level)}\n\n`
    + 'Produce these sections:\n'
    + '## Summary of your notes — a faithful summary of what the user wrote (do not change their meaning).\n'
    + '## Passages and themes — the Scriptures and main themes found in the notes.\n'
    + '## Where the sources agree — points in the notes confirmed by the sources, with citations.\n'
    + "## What the sources add — helpful insights, context or cross references the notes don't include.\n"
    + '## Points to examine further — anything in the notes the sources read differently, or that needs a closer look. Be gentle and specific; explain why.\n'
    + '## Questions for further study\n\n'
    + `Passages detected: ${refs.length ? refs.join(', ') : 'none detected – infer from the notes'}\n\n`
    + `<USER_NOTES>\n${notes}\n</USER_NOTES>${sourcesBlock(src)}`;
}

export function register(engine) {
  const r = engine.route;

  // ---------------------------------------------------------------- studies & notes
  r('GET', 'studies', ({ query }) => db.all('studies', (s) => !query.kind || s.kind === query.kind)
    .sort((a, b) => b.updated_at - a.updated_at).slice(0, 500).map((s) => S.studyDict(s)));

  r('POST', 'studies', ({ body }) => {
    const id = S.createStudy(body.kind || 'notes', (body.title || '').trim() || 'Untitled study', body.meta || {});
    if (body.content) S.addEntry(id, 'user', 'note', body.note_title || 'My notes', body.content);
    return { id };
  });

  r('GET', 'studies/:id', ({ params }) => {
    const s = S.studyDict(S.getStudy(params.id));
    s.entries = db.all('entries', (e) => e.study_id === s.id).sort((a, b) => a.id - b.id).map(S.entryDict);
    s.files = db.all('files', (f) => f.study_id === s.id).sort((a, b) => a.id - b.id).map((f) => {
      const d = S.fileDict(f);
      d.preview = d.extracted.slice(0, 600);
      delete d.extracted;
      return d;
    });
    return s;
  });

  r('PATCH', 'studies/:id', ({ params, body }) => {
    const s = S.getStudy(params.id);
    db.update('studies', s.id, { title: body.title || s.title, meta: { ...s.meta, ...(body.meta || {}) }, updated_at: Date.now() / 1000 });
    return { ok: true };
  });

  r('DELETE', 'studies/:id', async ({ params }) => { await S.deleteStudy(params.id); return { ok: true }; });

  r('POST', 'studies/:id/entries', ({ params, body }) => {
    S.getStudy(params.id);
    return { id: S.addEntry(params.id, 'user', 'note', body.title || 'Note', body.content || '') };
  });

  r('PATCH', 'entries/:id', ({ params, body }) => {
    const e = db.get('entries', params.id);
    if (!e) throw S.notFound('Entry');
    if (e.author === 'ai' && 'content' in body) {
      throw Object.assign(new Error('AI notes are kept as generated. Copy the text into your own note to edit it.'), { status: 400 });
    }
    db.update('entries', e.id, { title: body.title ?? e.title, content: body.content ?? e.content, updated_at: Date.now() / 1000 });
    S.touchStudy(e.study_id);
    return { ok: true };
  });

  r('DELETE', 'entries/:id', ({ params }) => { db.remove('entries', params.id); return { ok: true }; });

  // ---------------------------------------------------------------- uploads
  r('POST', 'notes/upload', async ({ body }) => {
    const files = body.getAll('files');
    const groups = body.getAll('groups');
    const studyId = body.get('study_id') ? Number(body.get('study_id')) : null;
    const cfg = settings.all();
    const grouped = new Map();
    for (const [i, f] of files.entries()) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (bytes.length > MAX_UPLOAD_MB * 1024 * 1024) throw Object.assign(new Error(`${f.name} is larger than ${MAX_UPLOAD_MB} MB.`), { status: 413 });
      const group = ((groups[i] || '').trim() || f.name.replace(/\.[^.]+$/, '')).trim();
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push([f, bytes]);
    }
    if (studyId) S.getStudy(studyId);
    const created = [];
    const jobIds = [];
    const autoVision = cfg['ai.vision_transcribe'] && cfg['ai.provider'] !== 'ondevice' && cfg['ai.model'];
    for (const [group, items] of grouped) {
      const sid = studyId || S.createStudy('notes', group.slice(0, 200), { source: 'upload' });
      for (const [f, bytes] of items) {
        const text = await extractText(f.name, f.type || '', bytes);
        const fid = await S.saveFile(sid, f.name, f.type || '', bytes, text);
        if (autoVision && (isImage(f.name, f.type) || (isPdf(f.name, f.type) && text.length < 30))) {
          jobIds.push(J.create('transcribe', { file_id: fid }, () => true));
        }
      }
      if (!created.includes(sid)) created.push(sid);
    }
    return { studies: created, jobs: jobIds };
  });

  r('GET', 'files/:id', async ({ params }) => {
    const [f, bytes] = await S.loadFile(params.id);
    return new Blob([bytes], { type: f.mime || 'application/octet-stream' });
  });
  r('DELETE', 'files/:id', async ({ params }) => { await S.deleteFile(params.id); return { ok: true }; });

  // ---------------------------------------------------------------- AI: analyse notes
  engine.jobs({
    notes_analyze: [
      async ({ params, cfg, progress }) => {
        const study = S.getStudy(params.study_id);
        const parts = [];
        for (const e of db.all('entries', (x) => x.study_id === study.id && (x.author === 'user' || x.type === 'transcription')).sort((a, b) => a.id - b.id)) {
          parts.push(`--- ${e.title || e.type} ---\n${e.content}`);
        }
        for (const f of db.all('files', (x) => x.study_id === study.id).sort((a, b) => a.id - b.id)) {
          if ((f.extracted || '').trim()) parts.push(`--- File: ${f.filename} ---\n${f.extracted}`);
        }
        let notes = parts.join('\n\n').trim();
        if (!notes) throw new AIError("This study has no readable notes yet. Add a note, upload a file, or use 'Transcribe with AI' on image files first.");
        notes = notes.slice(0, 40000);
        const refs = parseRefs(notes, 8);
        progress(`Found ${refs.length} passage reference(s). Gathering sources…`);
        const results = await gather(refs, cfg.sources, cfg['bible.translation'], J.budget(cfg, params._provider), progress);
        return {
          messages: [J.systemMessage(cfg), { role: 'user', content: notesAnalysis(study.title || 'Study notes', notes, refs.map((x) => x.display), formatForPrompt(results), J.level(params)) }],
          meta: { sources: sourceMeta(results), refs: refs.map((x) => x.display) },
        };
      },
      async ({ params, meta, text, thinking, model }) => ({
        study_id: Number(params.study_id),
        entry_id: S.addEntry(params.study_id, 'ai', 'analysis', `AI analysis & comparison (${J.levelName(params)})`, text, J.modelMeta(meta, params, model, thinking)),
      }),
    ],

    // ---------------------------------------------------------------- AI: read images / scanned PDFs
    transcribe: [
      async ({ params }) => {
        if (params._provider === 'ondevice') {
          throw new AIError("On-device models can't read images yet. Pick a model that can (e.g. Ollama gemma3, GPT-4o/5, Gemini or Claude) for transcription.");
        }
        const [f, bytes] = await S.loadFile(params.file_id);
        let images;
        if (isImage(f.filename, f.mime)) images = [await imageB64ForAi(bytes, f.mime)];
        else if (isPdf(f.filename, f.mime)) images = await pdfPagesB64(bytes);
        else throw new AIError('Only images and PDFs can be transcribed.');
        return { messages: [{ role: 'user', content: transcribeImage() }], images, meta: { file_id: f.id, filename: f.filename, study_id: f.study_id } };
      },
      async ({ params, meta, text, thinking, model }) => {
        db.update('files', meta.file_id, { extracted: text });
        return { study_id: meta.study_id, entry_id: S.addEntry(meta.study_id, 'ai', 'transcription', `AI transcription of ${meta.filename}`, text, J.modelMeta(meta, params, model, thinking)) };
      },
    ],
  });

  engine.summary(() => {
    const all = db.all('studies');
    const counts = {};
    for (const s of all) counts[s.kind] = (counts[s.kind] || 0) + 1;
    return { recent: all.sort((a, b) => b.updated_at - a.updated_at).slice(0, 6).map((s) => S.studyDict(s)), counts };
  });
}
