"""WardriveDB server entrypoint — wires up the HTTPServer + Handler."""

import os
from http.server import ThreadingHTTPServer
from pathlib import Path

from wardrivedb.config import PORT
from wardrivedb.db import ensure_empty, get_conn, network_count
from wardrivedb.handler import Handler
from wardrivedb.ingest import load_db_file


def create_server(port: int = PORT) -> ThreadingHTTPServer:
    # Threaded server so a slow/held client connection (e.g. a fetch that was
    # abandoned mid-flight, a keep-alive stall) cannot block the next filter
    # refresh — the user symptom "filters stop after minutes, recorrects on
    # refresh" is consistent with head-of-line blocking on a single-threaded
    # HTTPServer.
    srv = ThreadingHTTPServer(("", port), Handler)
    srv.daemon_threads = True
    return srv


def main():
    # If a DB path was given via env, load it on startup
    env_db = os.environ.get("WARDRIVING_DB", "")
    if env_db:
        p = Path(env_db)
        if p.is_file():
            ensure_empty()
            try:
                data = p.read_bytes()
                load_db_file(data)
                print(f"Loaded database from {p}  ({network_count()} networks)")
            except Exception as e:
                ensure_empty()
                print(f"[warn] Could not load {p}: {e}")
        else:
            ensure_empty()
            print(f"[warn] WARDRIVING_DB points to {p} but it does not exist — starting empty.")
    else:
        ensure_empty()
        print("No dataset loaded — upload a .db or .csv file via the browser UI.")

    httpd = create_server(PORT)
    print(f"WardriveDB serving http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")


if __name__ == "__main__":
    main()
