"""Turn uploaded files into text.

* PDF   → its text layer (pypdf). Scanned pages are rendered with pypdfium2 (bundled – no system
          tools needed) and read by OCR when Tesseract is installed, or by a vision AI model.
* DOCX  → paragraphs.  TXT / MD / HTML → text.
* Images → OCR when Tesseract is installed; otherwise use "Transcribe with AI", which handles
          handwriting far better anyway.
"""
import base64
import io
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

try:
    import pypdfium2 as pdfium
    HAS_PDF_RENDER = True
except ImportError:  # pragma: no cover – optional
    pdfium = None
    HAS_PDF_RENDER = False

HAS_TESSERACT = shutil.which("tesseract") is not None
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".heic", ".tif", ".tiff"}


def is_image(filename: str, mime: str = "") -> bool:
    return Path(filename).suffix.lower() in IMAGE_EXT or (mime or "").startswith("image/")


def _ocr_image(img: Image.Image) -> str:
    if not HAS_TESSERACT:
        return ""
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "img.png"
        img.convert("RGB").save(p)
        try:
            out = subprocess.run(["tesseract", str(p), "stdout"], capture_output=True, timeout=120)
            return out.stdout.decode("utf-8", "ignore").strip()
        except (subprocess.SubprocessError, OSError):
            return ""


def pdf_page_images(data: bytes, max_pages: int = 30, scale: float = 2.0) -> list[Image.Image]:
    """Render PDF pages to images (about 150 dpi at scale 2)."""
    if not HAS_PDF_RENDER:
        return []
    doc = pdfium.PdfDocument(data)
    try:
        return [doc[i].render(scale=scale).to_pil() for i in range(min(len(doc), max_pages))]
    finally:
        doc.close()


def extract_text(filename: str, mime: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower()
    try:
        if ext == ".pdf" or mime == "application/pdf":
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            text = "\n\n".join((page.extract_text() or "") for page in reader.pages).strip()
            if len(text) < 30 and HAS_TESSERACT:
                text = "\n\n".join(t for t in (_ocr_image(i) for i in pdf_page_images(data)) if t) or text
            return text
        if ext == ".docx":
            import docx
            d = docx.Document(io.BytesIO(data))
            return "\n".join(p.text for p in d.paragraphs)
        if ext in {".txt", ".md", ".markdown", ".text", ".csv"}:
            return data.decode("utf-8", "ignore")
        if ext in {".html", ".htm"}:
            from bs4 import BeautifulSoup
            return BeautifulSoup(data, "html.parser").get_text("\n", strip=True)
        if is_image(filename, mime):
            return _ocr_image(Image.open(io.BytesIO(data)))
    except Exception as exc:
        return f"[Could not read this file: {exc}]"
    return data.decode("utf-8", "ignore") if mime.startswith("text/") else ""


def _jpeg_b64(img: Image.Image, max_side: int = 1600) -> str:
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def image_b64_for_ai(data: bytes, max_side: int = 1600) -> str:
    """Downscale and JPEG-encode an image for vision models."""
    return _jpeg_b64(Image.open(io.BytesIO(data)), max_side)


def pdf_pages_b64(data: bytes, max_pages: int = 8) -> list[str]:
    return [_jpeg_b64(img) for img in pdf_page_images(data, max_pages=max_pages)]
