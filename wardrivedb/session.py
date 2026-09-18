"""Per-browser-session in-memory databases.

Every visitor gets an isolated in-memory SQLite database so concurrent users
never mix up their loaded files. A session is identified by a cookie; its DB
lives only in memory and is evicted (closed) when idle sessions push the store
over capacity.
"""

import re
import sqlite3
import threading
import time

SESSION_COOKIE = "wardrivedb_sid"

# Concurrent sessions kept in memory; the least-active session is evicted when
# this cap is exceeded.
MAX_SESSIONS = 16

_locker = threading.RLock()
_sessions = {}
_local = threading.local()
_seed = None  # (bytes, filename) loaded into every new session, or None


def set_seed(data: bytes | None, filename: str | None = None):
    """Register startup data (WARDRIVING_DB) cloned into each new session."""
    global _seed
    _seed = (data, filename) if data is not None else None


class _Session:
    def __init__(self, sid):
        self.sid = sid
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.create_function(
            "REGEXP", 2,
            lambda pat, val: 1 if (val and re.search(pat, val, re.IGNORECASE)) else 0,
        )
        self.last_activity = time.time()


def bind(sid: str | None):
    """Bind this thread to a session id (all db calls resolve to its DB)."""
    _local.sid = sid


def get_or_create(sid: str) -> _Session:
    """Return the session, creating it (with schema + seed) on first use."""
    with _locker:
        sess = _sessions.get(sid)
        if sess is not None:
            sess.last_activity = time.time()
            return sess
        while len(_sessions) >= MAX_SESSIONS:
            _evict_oldest()
        sess = _Session(sid)
        _sessions[sid] = sess

        from wardrivedb.db import ensure_empty
        ensure_empty()

        if _seed is not None:
            from wardrivedb.ingest import load_db_file
            try:
                load_db_file(_seed[0], _seed[1])
            except Exception as e:
                print(f"[warn] Seed load failed for a new session: {e}")
                ensure_empty()
        return sess


def _evict_oldest():
    """Close and drop the least-recently-used session."""
    if not _sessions:
        return
    now = time.time()
    candidates = sorted(_sessions.items(), key=lambda kv: kv[1].last_activity)
    victim_id = None
    for sid, sess in candidates:
        if now - sess.last_activity >= 60:
            victim_id = sid
            break
    if victim_id is None:
        victim_id = candidates[0][0]
    victim = _sessions.pop(victim_id)
    try:
        victim.conn.close()
    except Exception:
        pass


def current_conn():
    """Return the current thread's session connection (creating it if needed)."""
    sid = getattr(_local, "sid", None)
    if not sid:
        raise RuntimeError("No browser session bound to this thread")
    return get_or_create(sid).conn


def drop(sid: str):
    """Close and remove a session (used at startup for seed validation)."""
    with _locker:
        sess = _sessions.pop(sid, None)
    if sess is not None:
        try:
            sess.conn.close()
        except Exception:
            pass