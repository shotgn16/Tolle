"""Turn uploaded files into text.

PDF → embedded text (OCR fallback for scanned pages when tesseract is present)
DOCX → paragraphs; TXT/MD/HTML → text; images → OCR (and optional AI vision
transcription, which handles handwriting far better – see jobs.transcribe).
"""
import base64
import io
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

HAS_TESSERACT = shutil.which("tesseract") is not None
HAS_PDFTOPPM = shutil.which("pdftoppm") is not None

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".heic", ".tif", ".tiff"}


def is_image(filename: str, mime: str = "") -> bool:
    return Path(filename).suffix.lower() in IMAGE_EXT or (mime or "").startswith("image/")


def _ocr_image_bytes(data: bytes) -> str:
    if not HAS_TESSERACT:
        return ""
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "img.png"
        Image.open(io.BytesIO(data)).convert("RGB").save(p)
        try:
            out = subprocess.run(["tesseract", str(p), "stdout"], capture_output=True, timeout=120)
            return out.stdout.decode("utf-8", "ignore").strip()
        except (subprocess.SubprocessError, OSError):
            return ""


def _ocr_pdf(data: bytes, max_pages: int = 30) -> str:
    if not (HAS_TESSERACT and HAS_PDFTOPPM):
        return ""
    with tempfile.TemporaryDirectory() as tmp:
        pdf = Path(tmp) / "in.pdf"
        pdf.write_bytes(data)
        subprocess.run(["pdftoppm", "-r", "200", "-png", "-l", str(max_pages), str(pdf), str(Path(tmp) / "pg")],
                       capture_output=True, timeout=300)
        texts = []
        for img in sorted(Path(tmp).glob("pg*.png")):
            texts.append(_ocr_image_bytes(img.read_bytes()))
        return "\n\n".join(t for t in texts if t)


def extract_text(filename: str, mime: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower()
    try:
        if ext == ".pdf" or mime == "application/pdf":
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            text = "\n\n".join((page.extract_text() or "") for page in reader.pages).strip()
            if len(text) < 30:
                text = _ocr_pdf(data) or text
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
            return _ocr_image_bytes(data)
    except Exception as exc:
        return f"[Could not read this file: {exc}]"
    return data.decode("utf-8", "ignore") if mime.startswith("text/") else ""


def image_b64_for_ai(data: bytes, max_side: int = 1600) -> str:
    """Downscale and JPEG-encode an image for vision models."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def pdf_pages_b64(data: bytes, max_pages: int = 8) -> list[str]:
    if not HAS_PDFTOPPM:
        return []
    with tempfile.TemporaryDirectory() as tmp:
        pdf = Path(tmp) / "in.pdf"
        pdf.write_bytes(data)
        subprocess.run(["pdftoppm", "-r", "150", "-png", "-l", str(max_pages), str(pdf), str(Path(tmp) / "pg")],
                       capture_output=True, timeout=300)
        return [image_b64_for_ai(p.read_bytes()) for p in sorted(Path(tmp).glob("pg*.png"))]
