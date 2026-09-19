# WardriveDB — Wardriving Dashboard

A lightweight, **static, fully client-side** web dashboard for exploring Wi-Fi
wardriving data captured with [Wigle](https://wigle.net/) or similar tools.
No server required — it runs entirely in your browser.

**Everything runs in memory.** Data is parsed and stored in an in-browser
SQLite engine (sql.js / WebAssembly); nothing leaves your machine. Upload a
dataset, explore it, and reload the page to start fresh.

## Features

- **Interactive map** — Leaflet map with circle markers, marker clustering, and heatmap overlay.
- **Type-aware coloring** — Wi-Fi, BLE, BT, LTE, GSM each get their own color.
- **Rich filters** — network type, auth mode, channel, RSSI, date range, frequency, accuracy, GPS bounding box.
- **Search & regex** — search SSIDs, MACs, and auth modes; use `/regex/` for pattern matching.
- **Advanced SQL** — free-form SQL WHERE fragment applied to the dataset.
- **Read-only SQL console** — run `SELECT` queries against the loaded data.
- **CSV export** — download the current view as a CSV file.
- **Keyboard shortcuts** — `/` search, `F` toggle sidebar, `?` help.

## Hosting on GitHub Pages

This is a plain static site — no build step. Just push the repo and enable
GitHub Pages:

1. Push this repository to GitHub.
2. In **Settings → Pages**, set the source to **Deploy from a branch**
   (e.g. `main`, root `/`).
3. Open the published URL and upload your data.

Everything needed to run locally (Leaflet map, heatmap, and the sql.js
WebAssembly engine) is vendored or loaded from CDNs, so no configuration is
required.

You can also test locally with any static file server:

```bash
python3 -m http.server 8765
# open http://localhost:8765
```

## Supported Formats

| Format | Notes |
|--------|-------|
| **SQLite `.db`** | Must contain a `networks` table. Columns are mapped automatically to `mac`, `ssid`, `auth_mode`, `first_seen`, `channel`, `frequency`, `rssi`, `latitude`, `longitude`, `altitude`/`accuracy`, `type`; both `altitude_meters`/`accuracy_meters` (Wigle export) and `altitude`/`accuracy` names are recognised. |
| **Wigle CSV** | Standard Wigle export (`WigleWifi_1.x`). The metadata line is skipped automatically. |

Column mappings for both formats are defined in `static/js/db.js`
(`CSV_COL_MAP` / `DB_COL_MAP`) — add an entry whose value is the target
`networks` column, or `null` to ignore the source column.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search bar |
| `F` | Toggle sidebar |
| `?` | Show help |

## Project Layout

```
WardriveDB/
├── index.html           # Page shell (markup only — CSS & JS live in static/)
├── static/
│   ├── css/style.css    # Dashboard styles
│   ├── vendor/          # sql.js (SQLite → WebAssembly), vendored locally
│   └── js/
│       ├── config.js    # Columns, colors, tile configs
│       ├── state.js     # Shared global state
│       ├── utils.js     # Helpers: $, debounce, esc, CSV, popups
│       ├── db.js        # In-browser data layer: sql.js init, schema, ingest, filters, query
│       ├── api.js       # Local "API" wrappers + URL param builder
│       ├── map.js       # Map init, layers, markers, legend
│       ├── sidebar.js   # Filter chips + top stats
│       ├── table.js     # Results table + sort + export
│       ├── upload.js    # Upload overlay (drag & drop)
│       ├── sql.js       # SQL console modal
│       └── app.js       # init(), events, refresh, boot
└── README.md
```

## License

GNU GENERAL PUBLIC LICENSE