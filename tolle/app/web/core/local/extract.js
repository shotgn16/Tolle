// Read text from uploaded files on the device (mirrors server/core/extract.py).
//   PDF  → its text (pdf.js); scanned pages can be sent to an AI that reads images
//   Word → the document's paragraphs (.docx is a zip of XML files)
//   text, Markdown, HTML → as text
//   images → no text here; "Transcribe with AI" reads them with a model that can see images
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|heic|tiff?)$/i;
export const isImage = (name, mime = '') => IMAGE_EXT.test(name) || mime.startsWith('image/');
export const isPdf = (name, mime = '') => /\.pdf$/i.test(name) || mime === 'application/pdf';

let pdfjs = null;
async function pdfLib() {
  if (!pdfjs) {
    pdfjs = await import('../../vendor/pdfjs/pdf.min.js');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
  }
  return pdfjs;
}

async function pdfText(bytes) {
  const lib = await pdfLib();
  const doc = await lib.getDocument({ data: bytes.slice() }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 200); i += 1) {
    const content = await (await doc.getPage(i)).getTextContent();
    let line = '';
    const lines = [];
    for (const item of content.items) {
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  return pages.join('\n\n').trim();
}

// ---------------------------------------------------------------- .docx (zip) without a library
async function unzipEntry(bytes, wanted) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  let p = view.getUint32(eocd + 16, true);
  const count = view.getUint16(eocd + 10, true);
  for (let n = 0; n < count; n += 1) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function docxText(bytes) {
  const xml = await unzipEntry(bytes, 'word/document.xml');
  if (!xml) return '';
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return [...doc.getElementsByTagNameNS(W, 'p')].map((p) => [...p.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join('')).join('\n');
}

export async function extractText(name, mime, bytes) {
  try {
    if (isPdf(name, mime)) return await pdfText(bytes);
    if (/\.docx$/i.test(name)) return await docxText(bytes);
    if (/\.(txt|md|markdown|text|csv)$/i.test(name) || mime.startsWith('text/plain')) return new TextDecoder().decode(bytes);
    if (/\.html?$/i.test(name)) return new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'text/html').body.innerText || '';
    if (isImage(name, mime)) return '';
    return mime.startsWith('text/') ? new TextDecoder().decode(bytes) : '';
  } catch (e) {
    return `[Could not read this file: ${e.message}]`;
  }
}

// ---------------------------------------------------------------- images for AI models that can see
async function canvasJpegB64(source, w, h, maxSide = 1600) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

export async function imageB64ForAi(bytes, mime) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime || 'image/jpeg' }));
  return canvasJpegB64(bitmap, bitmap.width, bitmap.height);
}

export async function pdfPagesB64(bytes, maxPages = 8) {
  const lib = await pdfLib();
  const doc = await lib.getDocument({ data: bytes.slice() }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i += 1) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
    out.push(await canvasJpegB64(canvas, canvas.width, canvas.height));
  }
  return out;
}
