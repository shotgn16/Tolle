"""Smoke tests: accounts, encryption, notes, uploads, calling (on-device hand-off), tracker, devices."""
import os
import sys
import tempfile
import time
from pathlib import Path

os.environ["TOLLE_DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tolle" / "app"))

from fastapi.testclient import TestClient  # noqa: E402

from server.core import db  # noqa: E402
from server.core.bible import parse_refs  # noqa: E402
from server.main import app  # noqa: E402

H = {"X-Device-Id": "test-device"}


def _wait(c, job_id, status=("done", "error", "client")):
    for _ in range(50):
        j = c.get(f"/api/ai/jobs/{job_id}", headers=H).json()
        if j["status"] in status:
            return j
        time.sleep(0.1)
    raise AssertionError("job did not finish")


def test_parse_refs():
    found = [r["display"] for r in parse_refs("John 3:16-18; 1 Cor 13; Ps 23:1. It is 3 o'clock. Genesis 1-3")]
    assert found == ["John 3:16-18", "1 Corinthians 13", "Psalms 23:1", "Genesis 1-3"]


def test_full_flow():
    with TestClient(app) as c:
        assert c.get("/api/auth/status").json()["needs_setup"] is True
        token = c.post("/api/auth/setup", json={"username": "tester", "password": "correct horse"}, headers=H).json()["token"]
        H["Authorization"] = f"Bearer {token}"
        assert c.post("/api/auth/login", json={"username": "tester", "password": "wrong"}).status_code == 401

        # notes are encrypted at rest
        sid = c.post("/api/studies", json={"title": "Romans", "content": "Secret note on Romans 8:28"}, headers=H).json()["id"]
        raw = db.q1("SELECT content_enc FROM entries WHERE study_id=?", (sid,))["content_enc"]
        assert "Romans" not in raw
        assert c.get(f"/api/studies/{sid}", headers=H).json()["entries"][0]["content"].startswith("Secret")

        # bulk upload with groups
        r = c.post("/api/notes/upload", headers=H,
                   files=[("files", ("a.txt", b"John 1:1", "text/plain")), ("files", ("b.txt", b"x", "text/plain")),
                          ("files", ("c.txt", b"y", "text/plain"))],
                   data={"groups": ["One", "One", "Two"]})
        assert len(r.json()["studies"]) == 2

        # secrets are masked
        c.put("/api/settings", json={"ai.provider": "ondevice", "openai.key": "sk-x"}, headers=H)
        assert c.get("/api/settings", headers=H).json()["values"]["openai.key"] == "••••••••"

        # calling session hands work to the on-device model, then accepts the answer
        cs = c.post("/api/calling", json={"focus": "work"}, headers=H).json()
        job = _wait(c, cs["job"])
        assert job["status"] == "client" and job["client"]["messages"]
        assert c.post(f"/api/ai/jobs/{cs['job']}/complete", json={"text": "Welcome"}, headers=H).json()["status"] == "done"
        assert c.get(f"/api/calling/{cs['id']}", headers=H).json()["messages"][0]["role"] == "ai"

        # tracker
        c.post("/api/tracker/reading/manual", json={"book": "jn", "chapter": 3, "minutes": 5}, headers=H)
        st = c.get("/api/tracker/stats?days=2", headers=H).json()
        assert st["days"][st["today"]]["chapters"][0]["book"] == "John"

        # devices & notifications
        assert c.get("/api/devices", headers=H).json()[0]["id"] == "test-device"
        c.post("/api/devices/test-device/test", headers=H)
        assert c.get("/api/notifications/pending", headers=H).json()[0]["title"] == "Tolle test"


def test_bible_app_and_share():
    with TestClient(app) as c:
        key = c.get("/api/me/api-key", headers=H).json()["key"]
        K = {"X-Api-Key": key}
        assert c.post("/api/v1/bible/app", json={"event": "opened"}, headers={"X-Api-Key": "x" * 30}).status_code == 401
        assert c.post("/api/v1/bible/app", json={"event": "opened"}, headers=K).json()["session"] == "started"
        # back-date the session so it passes the minimum length
        db.ex("UPDATE reading_sessions SET started_at=started_at-300 WHERE source='bible-app'")
        assert c.post("/api/v1/bible/app", json={"event": "closed"}, headers=K).json()["session"] == "ended"
        r = c.post("/api/v1/bible/read", json={"reference": "https://www.bible.com/bible/111/JHN.15.1-8.NIV"}, headers=K).json()
        assert r["logged"] == ["John 15"]
        st = c.get("/api/tracker/stats?days=1", headers=H).json()
        labels = [x["label"] for x in st["days"][st["today"]]["chapters"]]
        assert "Time in the Bible app" in labels and "John 15" in labels
        assert any(n["title"] == "What did you read?" for n in c.get("/api/notifications/pending", headers=H).json())


def test_repetition_loop_is_removed():
    from server.core.ai import repetition
    good = "## Read and notice\nJohn opens with the Word. Grace and truth come through Jesus Christ (John 1:17)."
    assert not repetition.has_loop(good) and repetition.clean(good) == (good, False)
    looped = "This is the first verse of the Gospel of John" + " — the *first* verse of the *first* Gospel" * 200
    assert repetition.has_loop(looped) and repetition.is_looping(looped[-400:])
    cleaned, changed = repetition.clean(looped)
    assert changed and cleaned.count("first* Gospel") == 1
    table = "| a | b |\n|---|---|---|---|---|---|---|---|\n| x | y |"
    assert not repetition.has_loop(table)


def test_features_can_be_switched_off():
    with TestClient(app) as c:
        feats = {f["id"]: f for f in c.get("/api/features").json()}
        assert feats["calling"]["enabled"] and feats["library"]["essential"]
        r = c.put("/api/admin/features", json={"disabled": ["calling", "library"]}, headers=H).json()
        state = {f["id"]: f["enabled"] for f in r}
        assert state["calling"] is False and state["library"] is True   # essential features stay on
        assert c.get("/api/calling", headers=H).status_code == 404
        assert c.post("/api/ai/jobs", json={"kind": "calling_turn", "session_id": 1}, headers=H).status_code == 404
        c.put("/api/admin/features", json={"disabled": []}, headers=H)
        assert c.get("/api/calling", headers=H).status_code == 200


def test_ai_instructions_can_be_customised():
    from server.core.ai import prompts
    with TestClient(app) as c:
        items = {i["key"]: i for i in c.get("/api/admin/instructions", headers=H).json()}
        assert {"assistant", "level.study", "calling.guide"} <= set(items)
        c.put("/api/admin/instructions", json={"level.study": "Write for a church home group."}, headers=H)
        assert prompts.LEVEL_GUIDE["study"] == "Write for a church home group."
        c.put("/api/admin/instructions", json={"level.study": ""}, headers=H)   # reset
        assert prompts.LEVEL_GUIDE["study"].startswith("LEVEL: Study")


def test_pairing_codes():
    with TestClient(app) as c:
        r = c.get("/api/server/pairing", headers=H).json()
        assert "addresses" in r
