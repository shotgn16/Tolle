"""Helpers for studies, entries and files (all content encrypted)."""
import time
import uuid

from fastapi import HTTPException

from . import db
from .config import DATA_DIR
from .crypto import dec, dec_bytes, dec_json, enc, enc_bytes

FILES_DIR = DATA_DIR / "files"


def create_study(user_id: int, kind: str, title: str, meta: dict | None = None) -> int:
    now = time.time()
    return db.ex("INSERT INTO studies(user_id,kind,title_enc,meta_enc,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                 (user_id, kind, enc(title), enc(meta or {}), now, now))


def get_study(user_id: int, study_id: int):
    row = db.q1("SELECT * FROM studies WHERE id=? AND user_id=?", (study_id, user_id))
    if not row:
        raise HTTPException(404, "Study not found.")
    return row


def touch_study(study_id: int) -> None:
    db.ex("UPDATE studies SET updated_at=? WHERE id=?", (time.time(), study_id))


def add_entry(user_id: int, study_id: int, author: str, type_: str, title: str, content: str,
              meta: dict | None = None) -> int:
    now = time.time()
    eid = db.ex("INSERT INTO entries(study_id,user_id,author,type,title_enc,content_enc,meta_enc,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (study_id, user_id, author, type_, enc(title), enc(content), enc(meta or {}), now, now))
    touch_study(study_id)
    return eid


def entry_dict(r) -> dict:
    return {"id": r["id"], "study_id": r["study_id"], "author": r["author"], "type": r["type"],
            "title": dec(r["title_enc"]) or "", "content": dec(r["content_enc"]) or "",
            "meta": dec_json(r["meta_enc"], {}), "created_at": r["created_at"], "updated_at": r["updated_at"]}


def study_dict(r, with_counts: bool = True) -> dict:
    d = {"id": r["id"], "kind": r["kind"], "title": dec(r["title_enc"]) or "Untitled",
         "meta": dec_json(r["meta_enc"], {}), "created_at": r["created_at"], "updated_at": r["updated_at"]}
    if with_counts:
        c = db.q1("SELECT COUNT(*) n, SUM(author='ai') ai FROM entries WHERE study_id=?", (r["id"],))
        f = db.q1("SELECT COUNT(*) n FROM files WHERE study_id=?", (r["id"],))
        d.update(entries=c["n"], ai_entries=c["ai"] or 0, files=f["n"])
    return d


def save_file(user_id: int, study_id: int, filename: str, mime: str, data: bytes, extracted: str) -> int:
    name = f"{uuid.uuid4().hex}.bin"
    (FILES_DIR / name).write_bytes(enc_bytes(data))
    fid = db.ex("INSERT INTO files(study_id,user_id,filename_enc,mime,size,path,extracted_enc,created_at)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (study_id, user_id, enc(filename), mime, len(data), name, enc(extracted), time.time()))
    touch_study(study_id)
    return fid


def load_file(user_id: int, file_id: int) -> tuple[dict, bytes]:
    r = db.q1("SELECT * FROM files WHERE id=? AND user_id=?", (file_id, user_id))
    if not r:
        raise HTTPException(404, "File not found.")
    return file_dict(r), dec_bytes((FILES_DIR / r["path"]).read_bytes())


def file_dict(r) -> dict:
    return {"id": r["id"], "study_id": r["study_id"], "filename": dec(r["filename_enc"]) or "file",
            "mime": r["mime"], "size": r["size"], "extracted": dec(r["extracted_enc"]) or "",
            "created_at": r["created_at"]}


def delete_study(user_id: int, study_id: int) -> None:
    get_study(user_id, study_id)
    for r in db.q("SELECT path FROM files WHERE study_id=?", (study_id,)):
        try:
            (FILES_DIR / r["path"]).unlink()
        except FileNotFoundError:
            pass
    with db.tx() as c:
        c.execute("DELETE FROM files WHERE study_id=?", (study_id,))
        c.execute("DELETE FROM entries WHERE study_id=?", (study_id,))
        c.execute("DELETE FROM studies WHERE id=?", (study_id,))
