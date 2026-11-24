import json
import hashlib
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
            if version > 4:
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
                        action TEXT CHECK(action IN ('explore','check','test_me')),
                        status TEXT NOT NULL CHECK(status IN
                            ('running','complete','cancelled','failed','interrupted')),
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX turns_topic ON turns(topic_id, sequence);
                    CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
                    PRAGMA user_version=2;
                """)
            elif version == 1:
                db.execute("BEGIN")
                db.execute("ALTER TABLE turns ADD COLUMN action TEXT CHECK(action IN ('explore','check','test_me'))")
                db.execute("PRAGMA user_version=2")
            if version < 3:
                # Run each migration in the same transaction; do not use executescript here.
                if not db.in_transaction:
                    db.execute("BEGIN")
                db.execute("ALTER TABLE turns ADD COLUMN image TEXT")
                db.execute("""CREATE TABLE ink_pages (
                    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                    id TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL,
                    mutation_id TEXT NOT NULL, created_at TEXT NOT NULL,
                    PRIMARY KEY(topic_id,id))""")
                db.execute("CREATE TABLE vision_verification (id INTEGER PRIMARY KEY CHECK(id=1), connection TEXT NOT NULL)")
                db.execute("PRAGMA user_version=3")
            if version < 4:
                if not db.in_transaction:
                    db.execute("BEGIN")
                db.execute("""CREATE TABLE notebook_appends (
                    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                    id TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
                    PRIMARY KEY(topic_id,id))""")
                db.execute("PRAGMA user_version=4")
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

    def append_conversion(self, topic_id, conversion_id, markdown, scope):
        checksum = hashlib.sha256((scope + "\0" + markdown).encode("utf-8")).hexdigest()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            topic = db.execute("SELECT markdown,revision FROM topics WHERE id=?", (topic_id,)).fetchone()
            if not topic:
                return None
            receipt = db.execute("SELECT * FROM notebook_appends WHERE topic_id=? AND id=?", (topic_id, conversion_id)).fetchone()
            if receipt and receipt["content_hash"] != checksum:
                raise ValueError("This conversion identifier was already used for different content.")
            timestamp = receipt["created_at"] if receipt else now()
            heading = f"Converted handwriting · {timestamp[:16].replace('T', ' ')} UTC"
            text, revision = topic["markdown"], topic["revision"]
            if not receipt:
                block = (f"<!-- verso:handwriting:{conversion_id}:begin -->\n\n"
                         f"## {heading}\n\n*Source: {scope}.*\n\n{markdown}\n\n"
                         f"<!-- verso:handwriting:{conversion_id}:end -->\n\n---\n")
                text += ("\n\n" if text else "") + "---\n\n" + block
                if len(text) > 2_000_000:
                    raise OverflowError("The text notebook is full. Download the conversion before making room.")
                revision += 1
                db.execute("UPDATE topics SET markdown=?,revision=?,updated_at=? WHERE id=?", (text, revision, timestamp, topic_id))
                db.execute("INSERT INTO notebook_appends VALUES (?,?,?,?)", (topic_id, conversion_id, checksum, timestamp))
            return {"markdown": text, "revision": revision, "heading": heading, "appended": receipt is None}

    def history(self, topic_id):
        with self.connect() as db:
            return [self.turn_view(row) for row in db.execute(
                "SELECT user_text,assistant_text,action,image FROM turns WHERE topic_id=? AND status='complete' ORDER BY sequence",
                (topic_id,),
            )]

    def latest_turn(self, topic_id):
        with self.connect() as db:
            row = db.execute(
                "SELECT user_text,assistant_text,status,action,image FROM turns WHERE topic_id=? ORDER BY sequence DESC LIMIT 1",
                (topic_id,),
            ).fetchone()
            return self.turn_view(row) if row else None

    @staticmethod
    def turn_view(row):
        result = dict(row)
        if result.get("image") is None:
            result.pop("image", None)
        return result

    def start_turn(self, topic_id, generation_id, content, action=None, image=None):
        with self.connect() as db:
            db.execute("INSERT INTO turns(id,topic_id,user_text,status,created_at,action,image) VALUES (?,?,?,'running',?,?,?)",
                       (generation_id, topic_id, content, now(), action, image))

    def ink_pages(self, topic_id):
        with self.connect() as db:
            return [{"id": row["id"], "revision": row["revision"], "mutation_id": row["mutation_id"],
                     **json.loads(row["document"])} for row in db.execute(
                "SELECT * FROM ink_pages WHERE topic_id=? ORDER BY created_at,id", (topic_id,))]

    def save_ink_page(self, topic_id, page_id, value):
        excluded = {"revision", "mutation_id"}
        if value.space == "page":
            excluded.add("space")  # Byte-identical retries of pre-canvas drafts still work.
        document = json.dumps(value.model_dump(mode="json", exclude=excluded))
        mutation = str(value.mutation_id)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT revision,mutation_id,document FROM ink_pages WHERE topic_id=? AND id=?",
                             (topic_id, page_id)).fetchone()
            # A response lost on the network can be retried without a false conflict.
            if row and row["mutation_id"] == mutation and row["document"] == document:
                return row["revision"]
            if (row and row["revision"] != value.revision) or (not row and value.revision != 0):
                return None
            revision = value.revision + 1
            db.execute("""INSERT INTO ink_pages VALUES (?,?,?,?,?,?) ON CONFLICT(topic_id,id)
                DO UPDATE SET document=excluded.document,revision=excluded.revision,mutation_id=excluded.mutation_id""",
                       (topic_id, page_id, document, revision, mutation, now()))
            return revision

    @staticmethod
    def connection(settings):
        return json.dumps([settings.mode, settings.provider, settings.endpoint, settings.model])

    def vision_verified(self, settings):
        with self.connect() as db:
            row = db.execute("SELECT connection FROM vision_verification WHERE id=1").fetchone()
            return bool(row and row[0] == self.connection(settings))

    def set_vision_verified(self, settings=None):
        with self.connect() as db:
            db.execute("DELETE FROM vision_verification")
            if settings is not None:
                db.execute("INSERT INTO vision_verification VALUES (1,?)", (self.connection(settings),))

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
            if self.connection(self.settings()) != self.connection(settings):
                db.execute("DELETE FROM vision_verification")
            db.execute("INSERT INTO settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
                       (json.dumps(value),))
