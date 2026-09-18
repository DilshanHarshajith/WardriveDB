"""In-memory SQLite database for WardriveDB."""

import re
import sqlite3

_CONN = None


def get_conn():
    """Return the shared in-memory SQLite connection (created once)."""
    global _CONN
    if _CONN is None:
        _CONN = sqlite3.connect(":memory:", check_same_thread=False)
        _CONN.row_factory = sqlite3.Row
        _CONN.create_function(
            "REGEXP", 2,
            lambda pat, val: 1 if (val and re.search(pat, val, re.IGNORECASE)) else 0,
        )
    return _CONN


def ensure_empty():
    """Create a fresh empty networks table (used when no dataset is loaded)."""
    conn = get_conn()
    conn.execute("DROP TABLE IF EXISTS networks")
    conn.execute("DROP TABLE IF EXISTS files")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS files (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            filename    TEXT UNIQUE NOT NULL,
            upload_time TEXT NOT NULL,
            row_count   INTEGER DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS networks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id     INTEGER NOT NULL,
            mac         TEXT,
            ssid        TEXT,
            auth_mode   TEXT,
            first_seen  TEXT,
            channel     INTEGER,
            frequency   REAL,
            rssi        INTEGER,
            latitude    REAL,
            longitude   REAL,
            altitude    REAL,
            accuracy    REAL,
            type        TEXT,
            FOREIGN KEY (file_id) REFERENCES files(id)
        )
    """)
    conn.commit()


def network_count() -> int:
    try:
        return get_conn().execute("SELECT COUNT(*) FROM networks").fetchone()[0]
    except Exception:
        return 0


def get_files():
    """Return list of uploaded files with their metadata."""
    try:
        conn = get_conn()
        return conn.execute("""
            SELECT f.id, f.filename, f.upload_time,
                   COALESCE(f.row_count, 0) as row_count
            FROM files f
            ORDER BY f.upload_time DESC
        """).fetchall()
    except Exception:
        return []


def get_file(file_id: int):
    """Return a single file record as a dict, or None."""
    try:
        row = get_conn().execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        return dict(row) if row else None
    except Exception:
        return None


def remove_file(file_id: int) -> int:
    """Unload a file: delete its networks rows and its files record.

    Returns the number of networks removed.
    """
    conn = get_conn()
    cur = conn.execute("DELETE FROM networks WHERE file_id = ?", (file_id,))
    conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
    conn.commit()
    return cur.rowcount


def add_file(filename: str) -> int:
    """Add a new file record and return its ID."""
    conn = get_conn()
    cursor = conn.execute("""
        INSERT INTO files (filename, upload_time, row_count)
        VALUES (?, datetime('now'), 0)
    """, (filename,))
    conn.commit()
    return cursor.lastrowid


def update_file_count(file_id: int, count: int):
    """Update the row count for a file."""
    conn = get_conn()
    conn.execute("UPDATE files SET row_count = ? WHERE id = ?", (count, file_id))
    conn.commit()
