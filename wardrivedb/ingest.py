"""Load wardriving data (CSV or SQLite) into the in-memory networks table."""

import csv
import os
import tempfile

from wardrivedb.config import CSV_COL_MAP
from wardrivedb.db import get_conn


def parse_csv_upload(content: str) -> list[dict]:
    """Parse a Wigle CSV upload and return a list of row dicts for the networks table."""
    lines = content.splitlines()
    if not lines:
        raise ValueError("Empty CSV file")
    # Skip metadata line (WigleWifi-1.x header or comment)
    start = 0
    for i, line in enumerate(lines):
        if line.startswith("WigleWifi") or line.startswith("#"):
            start = i + 1
            break
    reader = csv.DictReader(lines[start:])
    if not reader.fieldnames:
        raise ValueError("No header row found in CSV")
    # Map CSV columns → DB columns
    rows = []
    for row in reader:
        mapped = {}
        for csv_col, db_col in CSV_COL_MAP.items():
            # Case-insensitive CSV header lookup
            val = None
            for k, v in row.items():
                if k.strip().lower() == csv_col:
                    val = v
                    break
            if val is not None:
                mapped[db_col] = val
        # Coerce numeric fields
        for int_field in ("channel", "rssi"):
            v = mapped.get(int_field)
            if v is not None and v != "":
                try:
                    mapped[int_field] = int(float(v))
                except (ValueError, TypeError):
                    mapped[int_field] = None
            else:
                mapped[int_field] = None
        for real_field in ("frequency", "latitude", "longitude", "altitude", "accuracy"):
            v = mapped.get(real_field)
            if v is not None and v != "":
                try:
                    mapped[real_field] = float(v)
                except (ValueError, TypeError):
                    mapped[real_field] = None
            else:
                mapped[real_field] = None
        # Skip rows with no coordinates
        if mapped.get("latitude") is None or mapped.get("longitude") is None:
            continue
        rows.append(mapped)
    return rows


def load_csv(content: str, filename: str):
    """Load parsed CSV rows into the in-memory DB with file tracking."""
    from wardrivedb.db import add_file, update_file_count

    conn = get_conn()
    rows = parse_csv_upload(content)
    if not rows:
        raise ValueError("No valid rows found (all rows missing lat/lng)")

    # Initialize tables if they don't exist
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

    # Add file record
    file_id = add_file(filename)

    # Insert rows with file_id
    cols = list(rows[0].keys())
    cols_with_file_id = ['file_id'] + cols
    placeholders = ", ".join("?" for _ in cols_with_file_id)
    sql = f"INSERT INTO networks ({', '.join(cols_with_file_id)}) VALUES ({placeholders})"

    batch = []
    for r in rows:
        row_data = [file_id] + [r[c] for c in cols]
        batch.append(tuple(row_data))
        if len(batch) >= 5000:
            conn.executemany(sql, batch)
            batch.clear()
    if batch:
        conn.executemany(sql, batch)

    conn.commit()
    update_file_count(file_id, len(rows))
    return len(rows)


def load_db_file(data: bytes, filename: str):
    """Load an uploaded SQLite .db file into the in-memory DB via ATTACH."""
    from wardrivedb.db import add_file, update_file_count

    # Write to a temp file (SQLite needs a real file to open)
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    conn = get_conn()
    try:
        conn.execute(f"ATTACH DATABASE '{tmp_path}' AS uploaded")
        # Check for a networks table
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM uploaded.sqlite_master WHERE type='table'"
        ).fetchall()]
        if "networks" not in tables:
            conn.execute("DETACH DATABASE uploaded")
            raise ValueError(
                f"No 'networks' table found. Tables present: {', '.join(tables) or '(none)'}"
            )

        # Initialize our tables if they don't exist
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

        # Add file record
        file_id = add_file(filename)

        # Copy data with file_id
        count = conn.execute("SELECT COUNT(*) FROM uploaded.networks").fetchone()[0]
        if count > 0:
            # Get column names from uploaded table (excluding id if present)
            columns = [row[1] for row in conn.execute("PRAGMA uploaded.table_info(networks)").fetchall()
                      if row[1] != 'id' and row[1] != 'file_id']
            cols_str = ', '.join(columns)
            placeholders = ', '.join(['?'] + ['?' for _ in columns])
            conn.execute(f"""
                INSERT INTO networks (file_id, {cols_str})
                SELECT ?, {cols_str} FROM uploaded.networks
            """, (file_id,))

        conn.execute("DETACH DATABASE uploaded")
        conn.commit()
        update_file_count(file_id, count)
        return count
    except Exception:
        # Clean up attachment on error
        try:
            conn.execute("DETACH DATABASE uploaded")
        except Exception:
            pass
        raise
    finally:
        os.unlink(tmp_path)


def parse_multipart(body: bytes, boundary: str):
    """Minimal multipart parser — extracts all file fields."""
    sep = f"--{boundary}".encode()
    parts = body.split(sep)
    files = []
    for part in parts:
        if part in (b"", b"--\r\n", b"--"):
            continue
        # Split headers from content
        header_end = part.find(b"\r\n\r\n")
        if header_end < 0:
            continue
        headers_raw = part[:header_end].decode("utf-8", errors="replace")
        content = part[header_end + 4:]
        # Strip trailing \r\n
        if content.endswith(b"\r\n"):
            content = content[:-2]
        # Find filename
        filename = None
        for h in headers_raw.split("\r\n"):
            if "filename=" in h.lower():
                eq = h.find("filename=")
                if eq >= 0:
                    filename = h[eq + 9:].strip().strip('"').strip("'")
                    break
        if filename:
            files.append((filename, content))
    return files