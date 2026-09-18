"""WardriveDB server entrypoint — wires up the HTTPServer + Handler."""

import os
from http.server import ThreadingHTTPServer
from pathlib import Path

from wardrivedb import session as sessions
from wardrivedb.config import PORT
from wardrivedb.handler import Handler


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
    # If a DB path was given via env, register it as the per-session seed so
    # every new visitor's session starts with that dataset. Sessions are
    # otherwise empty — upload a .db or .csv file via the browser UI.
    env_db = os.environ.get("WARDRIVING_DB", "")
    if env_db:
        p = Path(env_db)
        if p.is_file():
            sessions.set_seed(p.read_bytes(), str(p))
            try:
                # Validate the seed by loading it into a throwaway session.
                sessions.bind("__startup_probe__")
                probe = sessions.get_or_create("__startup_probe__")
                n = probe.conn.execute("SELECT COUNT(*) FROM networks").fetchone()[0]
                print(f"Seed ready: {p}  ({n} networks per new session)")
            except Exception as e:
                sessions.set_seed(None)
                print(f"[warn] Could not load {p}: {e}")
            finally:
                sessions.drop("__startup_probe__")
                sessions.bind(None)
        else:
            print(f"[warn] WARDRIVING_DB points to {p} but it does not exist — sessions start empty.")
    else:
        print("No seed dataset configured — each session starts empty; upload a .db/.csv via the browser UI.")

    httpd = create_server(PORT)
    print(f"WardriveDB serving http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")


if __name__ == "__main__":
    main()
