import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .models import ModelSettings


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.touch(mode=0o600, exist_ok=True)
        path.chmod(0o600)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > 1:
                raise RuntimeError("Database was created by a newer application.")
            if version == 0:
                db.executescript("""
                    CREATE TABLE topics (
                        id TEXT PRIMARY KEY, title TEXT NOT NULL,
                        markdown TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    );
                    CREATE TABLE turns (
                        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                        id TEXT UNIQUE NOT NULL,
                        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                        user_text TEXT NOT NULL, assistant_text TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL CHECK(status IN
                            ('running','complete','cancelled','failed','interrupted')),
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX turns_topic ON turns(topic_id, sequence);
                    CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
                    PRAGMA user_version=1;
                """)
            db.execute("UPDATE turns SET status='interrupted' WHERE status='running'")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def topics(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT id,title,created_at,updated_at FROM topics ORDER BY created_at DESC"
            )]

    def topic(self, topic_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM topics WHERE id=?", (topic_id,)).fetchone()
            return dict(row) if row else None

    def create_topic(self, title):
        topic_id, timestamp = str(uuid4()), now()
        with self.connect() as db:
            db.execute("INSERT INTO topics(id,title,created_at,updated_at) VALUES (?,?,?,?)",
                       (topic_id, title, timestamp, timestamp))
        return self.topic(topic_id)

    def rename_topic(self, topic_id, title):
        with self.connect() as db:
            return db.execute("UPDATE topics SET title=?,updated_at=? WHERE id=?",
                              (title, now(), topic_id)).rowcount > 0

    def delete_topic(self, topic_id):
        with self.connect() as db:
            return db.execute("DELETE FROM topics WHERE id=?", (topic_id,)).rowcount > 0

    def save_notebook(self, topic_id, markdown, revision):
        with self.connect() as db:
            changed = db.execute(
                "UPDATE topics SET markdown=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
                (markdown, now(), topic_id, revision),
            ).rowcount
            return revision + 1 if changed else None

    def history(self, topic_id):
        with self.connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT user_text,assistant_text FROM turns WHERE topic_id=? AND status='complete' ORDER BY sequence",
                (topic_id,),
            )]

    def latest_turn(self, topic_id):
        with self.connect() as db:
            row = db.execute(
                "SELECT user_text,assistant_text,status FROM turns WHERE topic_id=? ORDER BY sequence DESC LIMIT 1",
                (topic_id,),
            ).fetchone()
            return dict(row) if row else None

    def start_turn(self, topic_id, generation_id, content):
        with self.connect() as db:
            db.execute("INSERT INTO turns(id,topic_id,user_text,status,created_at) VALUES (?,?,?,'running',?)",
                       (generation_id, topic_id, content, now()))

    def update_turn(self, generation_id, text, status="running"):
        with self.connect() as db:
            # A checkpoint running in a worker thread can finish after cancellation.
            # It must never turn a finalized generation back into a running one.
            db.execute("UPDATE turns SET assistant_text=?,status=? WHERE id=? AND status='running'",
                       (text, status, generation_id))

    def settings(self):
        with self.connect() as db:
            row = db.execute("SELECT value FROM settings WHERE id=1").fetchone()
            return ModelSettings.model_validate_json(row[0]) if row else ModelSettings()

    def save_settings(self, settings: ModelSettings):
        # Explicit field selection keeps API keys out of SQLite even for SettingsInput.
        value = {key: getattr(settings, key) for key in ModelSettings.model_fields}
        with self.connect() as db:
            db.execute("INSERT INTO settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
                       (json.dumps(value),))
