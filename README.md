# WardriveDB — Wardriving Dashboard

A lightweight, self-contained web dashboard for exploring Wi-Fi wardriving data
captured with [Wigle](https://wigle.net/) or similar tools. No external
dependencies beyond Python 3 — just run and upload.

**Everything runs in memory.** Nothing is written to disk. Upload a dataset,
explore it, and on restart you start fresh.

## Features

- **Interactive map** — Leaflet map with circle markers, marker clustering, and heatmap overlay.
- **Type-aware coloring** — Wi-Fi, BLE, BT, LTE, GSM each get their own color.
- **Rich filters** — network type, auth mode, channel, RSSI, date range, frequency, accuracy, GPS bounding box.
- **Search & regex** — search SSIDs, MACs, and auth modes; use `/regex/` for pattern matching.
- **Advanced SQL** — free-form SQL WHERE fragment applied to the dataset.
- **Read-only SQL console** — run `SELECT` queries against the loaded data.
- **CSV export** — download the current view as a CSV file.
- **Keyboard shortcuts** — `/` search, `F` toggle sidebar, `?` help.

## Quick Start

```bash
git clone <url> && cd WardriveDB
./start.sh
```

Then open **http://localhost:8765** in your browser and upload your data.

You can also bypass the UI upload by pointing `WARDRIVING_DB` at an existing file:

```bash
WARDRIVING_DB=/path/to/wardriving.db ./start.sh
```

## Supported Formats

| Format | Notes |
|--------|-------|
| **SQLite `.db`** | Must contain a `networks` table with columns: `mac`, `ssid`, `auth_mode`, `first_seen`, `channel`, `frequency`, `rssi`, `latitude`, `longitude`, `altitude`, `accuracy`, `type` |
| **Wigle CSV** | Standard Wigle export (`WigleWifi_1.x`). The metadata line is skipped automatically. |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search bar |
| `F` | Toggle sidebar |
| `?` | Show help |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8765` | Server port |
| `WARDRIVING_DB` | *(empty)* | Path to a SQLite DB to load on startup (skips upload UI) |

## Docker

A Dockerfile is provided for containerised deployment.

```bash
docker build -t wardrivedb .
docker run -p 8765:8765 wardrivedb
```

You can mount a local DB into the container so it loads on startup:

```bash
docker run -p 8765:8765 \
  -e WARDRIVING_DB=/data/wardriving.db \
  -v /path/to/wardriving.db:/data/wardriving.db:ro \
  wardrivedb
```

Or pass a custom port:

```bash
docker run -p 9000:9000 -e PORT=9000 wardrivedb
```

## Project Layout

```
WardriveDB/
├── index.html           # Page shell (markup only — CSS & JS live in static/)
├── server.py            # Thin shim: delegates to wardrivedb.server.main()
├── start.sh             # One-click launcher
├── wardrivedb/          # Python package (backend)
│   ├── __init__.py
│   ├── __main__.py      # Enables `python -m wardrivedb`
│   ├── config.py        # Constants, regexes, CSV column map
│   ├── db.py            # SQLite in-memory connection & schema
│   ├── ingest.py        # CSV / .db upload parsing + loading
│   ├── query.py         # Shared filter → SQL WHERE builder
│   ├── handler.py       # HTTP handler + API endpoints + static serving
│   └── server.py        # create_server() + main() startup
├── static/
│   ├── css/style.css    # Dashboard styles (extracted from inline <style>)
│   └── js/              # Plain scripts loaded in dependency order
│       ├── config.js    # API base, columns, colors, tile configs
│       ├── state.js     # Shared global state
│       ├── utils.js     # Helpers: $, debounce, esc, CSV, popups
│       ├── api.js       # Fetch wrappers + URL param builder
│       ├── map.js       # Map init, layers, markers, legend
│       ├── sidebar.js   # Filter chips + top stats
│       ├── table.js     # Results table + sort + export
│       ├── upload.js    # Upload overlay (drag & drop)
│       ├── sql.js       # SQL console modal
│       └── app.js       # init(), events, refresh, boot
└── README.md
```

`python server.py` and `python -m wardrivedb` are equivalent entrypoints — `start.sh`
prefers the package entry and falls back to the shim.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/meta` | GET | Dataset metadata: count, types, auth modes, date range |
| `/api/data` | GET | Row data with filters, sorting, pagination |
| `/api/stats` | GET | Aggregated stats (type/channel/auth histograms, RSSI, dates, bounds) |
| `/api/upload` | POST | Upload a `.db` or `.csv` file (`multipart/form-data`, field `file`) |
| `/api/query` | POST | Run a read-only SQL query (`{"sql": "SELECT ..."}`) |

## License

GNU GENERAL PUBLIC LICENSE
