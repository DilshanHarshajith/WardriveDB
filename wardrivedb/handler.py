"""HTTP request handler for WardriveDB."""

import json
import urllib.parse
import uuid
from http.server import SimpleHTTPRequestHandler

from wardrivedb import session as sessions
from wardrivedb.config import AUTH_CATEGORY_SQL, FORBIDDEN_RE, MAX_UPLOAD, ROOT, SELECT_RE
from wardrivedb.db import get_conn, network_count
from wardrivedb.ingest import load_csv, load_db_file, parse_multipart
from wardrivedb.query import build_where


class Handler(SimpleHTTPRequestHandler):
    # Explicitly close every response. HTTP/1.0 is also the default the
    # browser already maps to fresh connections; combined with the threaded
    # server this guarantees one client can never pin/block another.
    protocol_version = "HTTP/1.0"

    def _resolve_session(self):
        """Resolve the browser session from the cookie and bind it to this thread.

        A fresh session id is issued (via Set-Cookie in end_headers) when the
        client has none, so each browser gets an isolated in-memory dataset.
        """
        sid = None
        for part in self.headers.get("Cookie", "").split(";"):
            part = part.strip()
            if part.startswith(sessions.SESSION_COOKIE + "="):
                sid = part.split("=", 1)[1].strip()
                break
        if not sid or len(sid) != 32:
            sid = uuid.uuid4().hex
            self._new_sid = sid
        sessions.bind(sid)

    def translate_path(self, path):
        path = urllib.parse.unquote(path.split("?")[0].split("#")[0])
        if path == "/":
            path = "/index.html"
        target = (ROOT / path.lstrip("/")).resolve()
        try:
            target.relative_to(ROOT)
        except ValueError:
            return str(ROOT / "index.html")
        return str(target)

    def do_GET(self):
        self._resolve_session()
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/data":
            self._handle_api_data(qs)
        elif parsed.path == "/api/stats":
            self._handle_api_stats(qs)
        elif parsed.path == "/api/meta":
            self._handle_api_meta()
        elif parsed.path == "/api/files":
            self._handle_api_files()
        else:
            super().do_GET()

    def do_POST(self):
        self._resolve_session()
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/upload":
            self._handle_api_upload()
        elif parsed.path == "/api/unload":
            self._handle_api_unload()
        elif parsed.path == "/api/query":
            self._handle_api_query()
        else:
            self.send_error(404)

    # ── /api/data ──────────────────────────────────────────────────────────
    def _handle_api_data(self, qs):
        conn = get_conn()
        where, params = build_where(qs)

        sort_field = qs.get("sort", ["first_seen"])[0] or "first_seen"
        sort_dir = qs.get("dir", ["desc"])[0] or "desc"
        allowed_sorts = {
            "mac", "ssid", "auth_mode", "first_seen", "channel",
            "frequency", "rssi", "latitude", "longitude", "type", "id",
        }
        if sort_field not in allowed_sorts:
            sort_field = "first_seen"
        if sort_dir.lower() not in ("asc", "desc"):
            sort_dir = "desc"

        # Optional limit/offset — no default hard cap. When omitted, the full
        # filtered result set is returned so the table and map show every match.
        limit = None
        raw_limit = qs.get("limit", [None])[0]
        if raw_limit is not None and str(raw_limit) != "":
            try:
                limit = max(1, int(raw_limit))
            except (ValueError, TypeError):
                limit = None
        try:
            offset = max(0, int(qs.get("offset", ["0"])[0]))
        except (ValueError, TypeError):
            offset = 0

        try:
            count = conn.execute(f"SELECT COUNT(*) FROM networks{where}", params).fetchone()[0]
            order = f" ORDER BY {sort_field} {sort_dir.upper()}"
            sql = f"SELECT * FROM networks{where}{order}"
            row_args = params
            if limit is not None:
                sql += " LIMIT ? OFFSET ?"
                row_args = (*params, limit, offset)
            rows = conn.execute(sql, row_args).fetchall()
            self._json({"rows": [dict(r) for r in rows], "total": count, "limit": limit, "offset": offset})
        except Exception as e:
            self._json({"error": str(e)}, 500)

    # ── /api/stats ─────────────────────────────────────────────────────────
    def _handle_api_stats(self, qs):
        conn = get_conn()
        where, params = build_where(qs)
        try:
            total = conn.execute(f"SELECT COUNT(*) FROM networks{where}", params).fetchone()[0]
            by_type = [dict(r) for r in conn.execute(
                f"SELECT type, COUNT(*) as c FROM networks{where} GROUP BY type ORDER BY c DESC", params
            )]
            by_channel = [dict(r) for r in conn.execute(
                f"SELECT channel, COUNT(*) as c FROM networks{where} GROUP BY channel ORDER BY channel", params
            )]
            auth_where = f"{where} AND {AUTH_CATEGORY_SQL}" if where else f" WHERE {AUTH_CATEGORY_SQL}"
            by_auth = [dict(r) for r in conn.execute(
                f"SELECT auth_mode, COUNT(*) as c FROM networks{auth_where} GROUP BY auth_mode ORDER BY c DESC LIMIT 20", params
            )]
            rssi_where = f"{where} AND rssi IS NOT NULL" if where else " WHERE rssi IS NOT NULL"
            rssi_hist = [dict(r) for r in conn.execute(
                f"SELECT CAST((rssi/5)*5 AS INTEGER) as bucket, COUNT(*) as c FROM networks{rssi_where} GROUP BY bucket ORDER BY bucket", params
            )]
            date_hist = [dict(r) for r in conn.execute(
                f"SELECT substr(first_seen,1,10) as day, COUNT(*) as c FROM networks{where} GROUP BY day ORDER BY day", params
            )]
            bounds = conn.execute(
                f"SELECT MIN(latitude) as lat_min, MAX(latitude) as lat_max, MIN(longitude) as lng_min, MAX(longitude) as lng_max FROM networks{where}", params
            ).fetchone()
            self._json({
                "total": total,
                "by_type": by_type,
                "by_channel": by_channel,
                "by_auth": by_auth,
                "rssi_hist": rssi_hist,
                "date_hist": date_hist,
                "bounds": dict(bounds) if bounds else {},
            })
        except Exception as e:
            self._json({"error": str(e)}, 500)

    # ── /api/meta ──────────────────────────────────────────────────────────
    def _handle_api_meta(self):
        conn = get_conn()
        count = network_count()
        if count == 0:
            self._json({"loaded": False, "count": 0})
            return
        try:
            cols = [dict(r) for r in conn.execute("SELECT name, type FROM pragma_table_info('networks')")]
            types = [r[0] for r in conn.execute("SELECT DISTINCT type FROM networks ORDER BY type") if r[0]]
            channels = [r[0] for r in conn.execute(
                "SELECT DISTINCT channel FROM networks WHERE channel IS NOT NULL ORDER BY channel"
            )]
            auth_modes = [r[0] for r in conn.execute(
                f"SELECT DISTINCT auth_mode FROM networks WHERE {AUTH_CATEGORY_SQL} ORDER BY auth_mode"
            )]
            rssi_range = conn.execute("SELECT MIN(rssi) as mn, MAX(rssi) as mx FROM networks").fetchone()
            date_range = conn.execute("SELECT MIN(first_seen) as mn, MAX(first_seen) as mx FROM networks").fetchone()
            self._json({
                "loaded": True,
                "count": count,
                "columns": cols,
                "types": types,
                "channels": channels,
                "auth_modes": auth_modes,
                "rssi_range": dict(rssi_range) if rssi_range else {},
                "date_range": dict(date_range) if date_range else {},
            })
        except Exception as e:
            self._json({"error": str(e)}, 500)

    # ── /api/files ─────────────────────────────────────────────────────────
    def _handle_api_files(self):
        """Return list of uploaded files with metadata."""
        try:
            from wardrivedb.db import get_files
            files = get_files()
            self._json({
                "files": [dict(f) for f in files],
                "total_files": len(files),
                "total_networks": sum(f["row_count"] for f in files)
            })
        except Exception as e:
            self._json({"error": str(e)}, 500)

    # ── /api/upload ────────────────────────────────────────────────────────
    def _handle_api_upload(self):
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self._json({"error": "Expected multipart/form-data"}, 400)
            return

        # Parse boundary
        boundary = None
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary = part.split("=", 1)[1]
                break
        if not boundary:
            self._json({"error": "Missing boundary in Content-Type"}, 400)
            return

        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_UPLOAD:
            self._json({"error": f"File too large (max {MAX_UPLOAD // (1024*1024)} MB)"}, 400)
            return
        body = self.rfile.read(length)

        # Simple multipart parsing (stdlib, no deps) — returns all files
        files = parse_multipart(body, boundary)
        if not files:
            self._json({"error": "No file found in upload"}, 400)
            return

        results = []
        total_count = 0
        errors = []
        for filename, file_data in files:
            lower = filename.lower()
            try:
                if lower.endswith(".db"):
                    count = load_db_file(file_data, filename)
                elif lower.endswith(".csv"):
                    text = file_data.decode("utf-8", errors="replace")
                    count = load_csv(text, filename)
                else:
                    results.append({"filename": filename, "error": "Only .db and .csv files are supported"})
                    errors.append(filename)
                    continue
                results.append({"filename": filename, "count": count})
                total_count += count
            except Exception as e:
                results.append({"filename": filename, "error": str(e)})
                errors.append(filename)

        # On single-file upload keep old response for compatibility; on multi-file always return files array
        if len(files) == 1 and not errors:
            self._json({"ok": True, "count": total_count, "filename": files[0][0]})
        else:
            self._json({"ok": len(errors) == 0, "files": results, "total_count": total_count})

    # ── /api/unload ────────────────────────────────────────────────────────
    def _handle_api_unload(self):
        """Remove a loaded file (and its networks) from the in-memory DB."""
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body)
        except Exception:
            self._json({"error": "Invalid JSON body"}, 400)
            return
        file_id = payload.get("file_id")
        if file_id is None:
            self._json({"error": "Missing 'file_id' field"}, 400)
            return
        try:
            file_id = int(file_id)
        except (ValueError, TypeError):
            self._json({"error": "Invalid 'file_id'"}, 400)
            return

        from wardrivedb.db import get_file, remove_file
        f = get_file(file_id)
        if not f:
            self._json({"error": f"No file with id {file_id} is loaded"}, 404)
            return
        removed = remove_file(file_id)
        self._json({
            "ok": True,
            "file_id": file_id,
            "filename": f["filename"],
            "removed": removed,
            "total_remaining": network_count(),
        })

    # ── /api/query ─────────────────────────────────────────────────────────
    def _handle_api_query(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body)
        except Exception:
            self._json({"error": "Invalid JSON body"}, 400)
            return
        sql = (payload.get("sql") or "").strip().rstrip(";")
        if not sql:
            self._json({"error": "Missing 'sql' field"}, 400)
            return
        if not SELECT_RE.search(sql):
            self._json({"error": "Only SELECT/WITH queries are allowed"}, 400)
            return
        if FORBIDDEN_RE.search(sql):
            self._json({"error": "Forbidden keyword in query"}, 400)
            return
        if "limit" not in sql.lower():
            sql += " LIMIT 5000"
        conn = get_conn()
        try:
            cur = conn.execute(sql)
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = cur.fetchall()
            self._json({"columns": cols, "rows": [dict(r) for r in rows], "count": len(rows), "sql": sql})
        except Exception as e:
            self._json({"error": str(e), "sql": sql}, 400)

    # ── helpers ────────────────────────────────────────────────────────────
    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(body)
        finally:
            self.close_connection = True

    def end_headers(self):
        new_sid = getattr(self, "_new_sid", None)
        if new_sid:
            self.send_header(
                "Set-Cookie",
                f"{sessions.SESSION_COOKIE}={new_sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
            )
            self._new_sid = None
        if self.path.endswith((".html", ".js", ".css")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "favicon" in fmt % args:
            return
        super().log_message(fmt, *args)
