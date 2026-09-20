/* ── Client-side data layer ──────────────────────────────────────────────────
 * Replaces the former Python/SQLite backend. All loading, filtering and SQL
 * querying now runs in-browser on an in-memory SQLite database powered by
 * sql.js (SQLite compiled to WebAssembly). Nothing is sent over the network.
 */
let SQL = null;        // sql.js module (from initSqlJs)
let db = null;         // in-memory SQLite Database
let dbReady = null;    // promise that resolves once the wasm + schema are up

/* ── Schema ─────────────────────────────────────────────────────────────── */
const FILES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    filename    TEXT UNIQUE NOT NULL,
    upload_time TEXT NOT NULL,
    row_count   INTEGER DEFAULT 0
  )`;

const NETWORKS_SCHEMA = `
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
    type        TEXT
  )`;

const AUTH_CATEGORY_SQL = `(auth_mode IS NOT NULL AND auth_mode != ''
  AND (auth_mode LIKE '[%' OR auth_mode LIKE 'LTE%'
  OR auth_mode LIKE 'GSM%' OR auth_mode LIKE 'NR%'
  OR auth_mode IN ('Open', 'WEP', 'WPA', 'WPA2', 'WPA3')))`;

const SELECT_RE = /^\s*(SELECT|WITH)\b/i;
const FORBIDDEN_RE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|VACUUM|REINDEX|ATTACH|DETACH)\b/i;

// Column mappings (the upload formats' headers/columns → networks column):
//   CSV_COL_MAP: Wigle export headers (lowercased, stripped) → networks column
//   DB_COL_MAP:  uploaded networks-table columns → networks column (null = ignored)
const CSV_COL_MAP = {
  mac: "mac", ssid: "ssid", authmode: "auth_mode", firstseen: "first_seen",
  channel: "channel", frequency: "frequency", rssi: "rssi",
  currentlatitude: "latitude", currentlongitude: "longitude",
  altitudemeters: "altitude", accuracymeters: "accuracy", type: "type",
  rcois: null, mfgrid: null,
};
const DB_COL_MAP = {
  mac: "mac", ssid: "ssid", auth_mode: "auth_mode", first_seen: "first_seen",
  channel: "channel", frequency: "frequency", rssi: "rssi",
  latitude: "latitude", longitude: "longitude",
  altitude: "altitude", altitude_meters: "altitude",
  accuracy: "accuracy", accuracy_meters: "accuracy", type: "type",
  rcois: null, mfgr_id: null,
};
const NETWORK_COLS = ["id", "file_id", "mac", "ssid", "auth_mode", "first_seen",
  "channel", "frequency", "rssi", "latitude", "longitude", "altitude", "accuracy", "type"];

/* ── Init ─────────────────────────────────────────────────────────────────── */
function ensureDb() {
  if (!dbReady) {
    dbReady = (async () => {
      SQL = await initSqlJs({ locateFile: f => 'static/vendor/' + f });
      db = new SQL.Database();
      // REGEXP() — used by /regex/ searches (mirrors the old backend which
      // registered `re.search(pattern, value, re.IGNORECASE)`).
      try {
        db.create_function("REGEXP", (pat, val) => {
          try { return (val != null && pat && new RegExp(pat, 'i').test(String(val))) ? 1 : 0; }
          catch (e) { return 0; }
        });
      } catch (e) { /* sql.js API drift guard */ }
      db.run(FILES_SCHEMA);
      db.run(NETWORKS_SCHEMA);
    })();
  }
  return dbReady;
}

/* ── Query helpers ──────────────────────────────────────────────────────────── */
function selectAll(sql, params) {
  const stmt = db.prepare(sql);
  try {
    if (params && params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally { stmt.free(); }
}
function selectScalar(sql, params) {
  const rows = selectAll(sql, params);
  if (!rows.length) return null;
  return rows[0][Object.keys(rows[0])[0]];
}

/* ── Params → WHERE (client-side port of the original /api/data query filter) ─── */
function toVal(v) {
  if (v == null) return '';
  if (v instanceof Set || Array.isArray(v)) return [...v].filter(x => x != null).join(',');
  return String(v);
}
function toElems(v) {
  const s = toVal(v);
  return s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];
}
function boundNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function authElemCond(elem) {
  // Bracketed combos ("[WPA2-PSK-CCMP][ESS]") match as the literal "[…]"
  // fragment; bare singletons ("WPA", "Open") match the whole value.
  if (elem.startsWith('[') && elem.endsWith(']')) {
    return { sql: 'auth_mode LIKE ?', param: '%' + elem + '%' };
  }
  return { sql: 'auth_mode = ?', param: elem };
}

function buildWhere(params) {
  const filters = [];
  const args = [];

  // File filtering
  const ids = toElems(params.file_ids).map(Number).filter(Number.isInteger);
  if (ids.length) {
    filters.push(`file_id IN (${ids.map(() => '?').join(',')})`);
    args.push(...ids);
  }

  // Network type
  const types = toElems(params.type);
  if (types.length) {
    filters.push(`type IN (${types.map(() => '?').join(',')})`);
    args.push(...types);
  }

  // Search q
  const q = toVal(params.q).trim();
  if (q) {
    if (q.length >= 2 && q.startsWith('/') && q.endsWith('/')) {
      filters.push('ssid REGEXP ?');
      args.push(q.slice(1, -1));
    } else {
      filters.push('(ssid LIKE ? OR mac LIKE ? OR auth_mode LIKE ?)');
      const like = '%' + q + '%';
      args.push(like, like, like);
    }
  }

  // Auth modes
  const auth = toElems(params.auth);
  const authOnly = params.auth_only === true || params.auth_only === 'true';
  if (auth.length) {
    if (authOnly) {
      const has = [], hasPars = [];
      for (const v of auth) { const c = authElemCond(v); has.push(c.sql); hasPars.push(c.param); }
      filters.push(`(${has.join(' OR ')})`);
      args.push(...hasPars);
      const authAllRaw = toVal(params.auth_all);
      if (authAllRaw) {
        const allElems = authAllRaw.split(',').map(s => s.trim()).filter(Boolean);
        const exclusions = allElems.filter(e => !auth.includes(e));
        for (const e of exclusions) {
          const c = authElemCond(e);
          filters.push(`NOT (${c.sql})`);
          args.push(c.param);
        }
      }
    } else {
      const ors = [], orsPars = [];
      for (const v of auth) { const c = authElemCond(v); ors.push(c.sql); orsPars.push(c.param); }
      filters.push(`(${ors.join(' OR ')})`);
      args.push(...orsPars);
    }
  }

  // Channel
  const chMin = boundNum(params.channel_min);
  if (chMin != null) { filters.push('channel >= ?'); args.push(chMin); }
  const chMax = boundNum(params.channel_max);
  if (chMax != null) { filters.push('channel <= ?'); args.push(chMax); }

  // RSSI
  const rssiMin = boundNum(params.rssi_min);
  if (rssiMin != null) { filters.push('rssi >= ?'); args.push(rssiMin); }
  const rssiMax = boundNum(params.rssi_max);
  if (rssiMax != null) { filters.push('rssi <= ?'); args.push(rssiMax); }

  // First seen date range
  if (toVal(params.date_from)) { filters.push('first_seen >= ?'); args.push(toVal(params.date_from)); }
  const dateTo = toVal(params.date_to).trim();
  if (dateTo) {
    let v = dateTo;
    if (v.length === 10) v += ' 23:59:59';
    filters.push('first_seen <= ?');
    args.push(v);
  }

  // Bounding box (lat_min,lng_min,lat_max,lng_max)
  if (toVal(params.bbox)) {
    try {
      const parts = toVal(params.bbox).split(',').map(Number);
      if (parts.length === 4 && parts.every(n => isFinite(n))) {
        let [la, ln, lb, lx] = parts;
        if (la > lb) [la, lb] = [lb, la];
        if (ln > lx) [ln, lx] = [lx, ln];
        filters.push('latitude BETWEEN ? AND ?'); args.push(la, lb);
        filters.push('longitude BETWEEN ? AND ?'); args.push(ln, lx);
      }
    } catch (e) { /* ignore malformed bbox */ }
  }

  // Accuracy / frequency: keep NULL rows visible (mirrors backend defaults)
  const accMax = boundNum(params.acc_max);
  if (accMax != null) { filters.push('(accuracy IS NULL OR accuracy <= ?)'); args.push(accMax); }
  const freqMin = boundNum(params.freq_min);
  if (freqMin != null) { filters.push('(frequency IS NULL OR frequency >= ?)'); args.push(freqMin); }
  const freqMax = boundNum(params.freq_max);
  if (freqMax != null) { filters.push('(frequency IS NULL OR frequency <= ?)'); args.push(freqMax); }

  // Advanced SQL WHERE fragment
  const adv = toVal(params.adv).trim();
  if (adv) {
    filters.push(FORBIDDEN_RE.test(adv) ? '1 = 0' : `(${adv})`);
  }

  return { where: filters.length ? ' WHERE ' + filters.join(' AND ') : '', args };
}

/* ── /api/meta ───────────────────────────────────────────────────────────── */
async function dbMeta() {
  await ensureDb();
  const count = selectScalar('SELECT COUNT(*) FROM networks');
  if (!count) return { loaded: false, count: 0 };
  const columns = selectAll("SELECT name, type FROM pragma_table_info('networks')")
    .map(r => ({ name: r.name, type: r.type }));
  const types = selectAll('SELECT DISTINCT type FROM networks ORDER BY type').map(r => r.type).filter(Boolean);
  const channels = selectAll('SELECT DISTINCT channel FROM networks WHERE channel IS NOT NULL ORDER BY channel').map(r => r.channel);
  const auth_modes = selectAll(`SELECT DISTINCT auth_mode FROM networks WHERE ${AUTH_CATEGORY_SQL} ORDER BY auth_mode`).map(r => r.auth_mode);
  const rssi_range = selectAll('SELECT MIN(rssi) as mn, MAX(rssi) as mx FROM networks')[0] || {};
  const date_range = selectAll('SELECT MIN(first_seen) as mn, MAX(first_seen) as mx FROM networks')[0] || {};
  const by_type = selectAll('SELECT type, COUNT(*) as c FROM networks GROUP BY type ORDER BY c DESC');
  return { loaded: true, count, columns, types, channels, auth_modes, rssi_range, date_range, by_type };
}

/* ── /api/files ──────────────────────────────────────────────────────────── */
async function dbFiles() {
  await ensureDb();
  const files = selectAll('SELECT f.id, f.filename, f.upload_time, COALESCE(f.row_count, 0) as row_count FROM files f ORDER BY f.upload_time DESC');
  return { files, total_files: files.length, total_networks: files.reduce((s, f) => s + (f.row_count || 0), 0) };
}

/* ── /api/data ───────────────────────────────────────────────────────────── */
async function dbData(params) {
  await ensureDb();
  const { where, args } = buildWhere(params || {});
  const allowed = ["mac", "ssid", "auth_mode", "first_seen", "channel",
    "frequency", "rssi", "latitude", "longitude", "type", "id"];
  const sortField = allowed.includes(params && params.sort) ? params.sort : 'first_seen';
  const sortDir = String(params && params.dir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  let limit = null;
  const rawLimit = params && params.limit;
  if (rawLimit != null && String(rawLimit) !== '') { limit = Math.max(1, parseInt(rawLimit, 10) || 0) || null; }
  let offset = 0;
  if (params && params.offset != null) offset = Math.max(0, parseInt(params.offset, 10) || 0);

  const total = selectScalar(`SELECT COUNT(*) FROM networks${where}`, args);
  let sql = `SELECT * FROM networks${where} ORDER BY ${sortField} ${sortDir}`;
  const rowArgs = [...args];
  if (limit != null) { sql += ' LIMIT ? OFFSET ?'; rowArgs.push(limit, offset); }
  const rows = selectAll(sql, rowArgs);
  return { rows, total, limit, offset };
}

/* ── /api/stats ──────────────────────────────────────────────────────────── */
async function dbStats(params) {
  await ensureDb();
  const { where, args } = buildWhere(params || {});
  const total = selectScalar(`SELECT COUNT(*) FROM networks${where}`, args);
  const by_type = selectAll(`SELECT type, COUNT(*) as c FROM networks${where} GROUP BY type ORDER BY c DESC`, args);
  const by_channel = selectAll(`SELECT channel, COUNT(*) as c FROM networks${where} GROUP BY channel ORDER BY channel`, args);
  const authWhere = (where ? where + ' AND ' : ' WHERE ') + AUTH_CATEGORY_SQL;
  const by_auth = selectAll(`SELECT auth_mode, COUNT(*) as c FROM networks${authWhere} GROUP BY auth_mode ORDER BY c DESC LIMIT 20`, args);
  const rssiWhere = (where ? where + ' AND ' : ' WHERE ') + 'rssi IS NOT NULL';
  const rssi_hist = selectAll(`SELECT CAST((rssi/5)*5 AS INTEGER) as bucket, COUNT(*) as c FROM networks${rssiWhere} GROUP BY bucket ORDER BY bucket`, args);
  const date_hist = selectAll(`SELECT substr(first_seen,1,10) as day, COUNT(*) as c FROM networks${where} GROUP BY day ORDER BY day`, args);
  const bounds = selectAll(`SELECT MIN(latitude) as lat_min, MAX(latitude) as lat_max, MIN(longitude) as lng_min, MAX(longitude) as lng_max FROM networks${where}`, args)[0] || {};
  return { total, by_type, by_channel, by_auth, rssi_hist, date_hist, bounds };
}

/* ── /api/query ──────────────────────────────────────────────────────────── */
async function dbQuery(sqlText) {
  await ensureDb();
  let sql = String(sqlText || '').trim().replace(/;\s*$/, '');
  if (!sql) throw new Error("Missing 'sql' field");
  if (!SELECT_RE.test(sql)) throw new Error('Only SELECT/WITH queries are allowed');
  if (FORBIDDEN_RE.test(sql)) throw new Error('Forbidden keyword in query');
  if (!/limit/i.test(sql)) sql += ' LIMIT 5000';
  try {
    const results = db.exec(sql);
    if (!results.length) return { columns: [], rows: [], count: 0, sql };
    const { columns, values } = results[0];
    const rows = values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
    return { columns, rows, count: rows.length, sql };
  } catch (e) {
    throw new Error(String(e && e.message || e));
  }
}

/* ── /api/unload ─────────────────────────────────────────────────────────── */
async function dbUnload(fileId) {
  await ensureDb();
  const id = Number(fileId);
  const file = selectAll('SELECT * FROM files WHERE id = ?', [id])[0];
  if (!file) throw new Error(`No file with id ${id} is loaded`);
  const removed = selectScalar('SELECT COUNT(*) FROM networks WHERE file_id = ?', [id]);
  db.run('DELETE FROM networks WHERE file_id = ?', [id]);
  db.run('DELETE FROM files WHERE id = ?', [id]);
  const total_remaining = selectScalar('SELECT COUNT(*) FROM networks');
  return { ok: true, file_id: id, filename: file.filename, removed, total_remaining };
}

/* ── /api/upload ─────────────────────────────────────────────────────────── */
function addFileRow(filename) {
  const ts = selectScalar("SELECT datetime('now')");
  db.run('INSERT INTO files (filename, upload_time, row_count) VALUES (?, ?, 0)', [filename, ts]);
  return selectScalar('SELECT last_insert_rowid()');
}
function updateFileCount(fileId, count) {
  db.run('UPDATE files SET row_count = ? WHERE id = ?', [count, fileId]);
}

// Robust RFC4180-ish CSV parser (handles quoted fields, embedded quotes/newlines).
function parseCSVArray(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (c === '\r') {
      if (text[i + 1] !== '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Port of parse_csv_upload: map Wigle headers → networks columns + coerce types.
function parseCsvRows(cells) {
  let start = 0;
  for (let i = 0; i < cells.length; i++) {
    const first = String(cells[i][0] === undefined ? cells[i] : cells[i][0]).trim();
    if (first.startsWith('WigleWifi') || first.startsWith('#')) { start = i + 1; break; }
  }
  const header = cells[start];
  if (!header || !header.length) throw new Error('No header row found in CSV');
  const idx = {};
  header.forEach((h, i) => { idx[String(h).trim().toLowerCase()] = i; });

  const rows = [];
  for (let r = start + 1; r < cells.length; r++) {
    const src = cells[r];
    if (!src || src.length === 1 && src[0] === '') continue;
    // Every row gets all mapped columns; short/truncated rows (missing
    // trailing fields like Type) just hold null for the absent column so
    // column keys stay consistent across rows.
    const mapped = {};
    for (const [, dbCol] of Object.entries(CSV_COL_MAP)) {
      if (dbCol !== null) mapped[dbCol] = null;
    }
    for (const [csvCol, dbCol] of Object.entries(CSV_COL_MAP)) {
      if (dbCol === null) continue;
      const i = idx[csvCol];
      if (i === undefined) continue;
      if (src[i] !== undefined) mapped[dbCol] = src[i];
    }
    for (const f of ['channel', 'rssi']) {
      const v = mapped[f];
      if (v != null && v !== '') { const n = Number.parseFloat(v); mapped[f] = Number.isFinite(n) ? Math.trunc(n) : null; }
      else mapped[f] = null;
    }
    for (const f of ['frequency', 'latitude', 'longitude', 'altitude', 'accuracy']) {
      const v = mapped[f];
      if (v != null && v !== '') { const n = Number.parseFloat(v); mapped[f] = Number.isFinite(n) ? n : null; }
      else mapped[f] = null;
    }
    if (mapped.latitude == null || mapped.longitude == null) continue;
    rows.push(mapped);
  }
  return rows;
}

async function loadCsv(content, filename) {
  await ensureDb();
  const cells = parseCSVArray(content);
  const rows = parseCsvRows(cells);
  if (!rows.length) throw new Error('No valid rows found (all rows missing lat/lng)');
  const fileId = addFileRow(filename);
  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => '?').join(',');
  const sql = `INSERT INTO networks (file_id, ${cols.join(',')}) VALUES (?, ${placeholders})`;
  const stmt = db.prepare(sql);
  try {
    db.run('BEGIN');
    for (const r of rows) stmt.run([fileId, ...cols.map(c => r[c] ?? null)]);
    db.run('COMMIT');
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) {}
    throw e;
  } finally { stmt.free(); }
  updateFileCount(fileId, rows.length);
  return rows.length;
}

async function loadDbFile(file) {
  await ensureDb();
  const buf = new Uint8Array(await file.arrayBuffer());
  let temp;
  try {
    temp = new SQL.Database(buf);
  } catch (e) {
    throw new Error('Not a valid SQLite database: ' + (e && e.message || e));
  }
  try {
    const tablesRes = temp.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = (tablesRes[0] ? tablesRes[0].values : []).map(v => String(v[0]));
    if (!tables.includes('networks')) {
      throw new Error(`No 'networks' table found. Tables present: ${tables.join(', ') || '(none)'}`);
    }
    const upCols = (temp.exec('PRAGMA table_info(networks)')[0]?.values || [])
      .map(v => v[1]).filter(n => n && String(n).toLowerCase() !== 'id' && String(n).toLowerCase() !== 'file_id');
    const dbMap = {};
    for (const [k, v] of Object.entries(DB_COL_MAP)) dbMap[k.toLowerCase()] = v;
    const targetCols = new Set(NETWORK_COLS);
    const pairs = [];
    const seen = new Set();
    for (const col of upCols) {
      const target = dbMap[String(col).toLowerCase()];
      if (!target || !targetCols.has(target) || seen.has(target)) continue;
      seen.add(target);
      pairs.push({ col: String(col), target });
    }
    if (!pairs.length) {
      throw new Error(`No mapped columns found in uploaded networks table; columns present: ${upCols.join(', ') || '(none)'}`);
    }
    const count = temp.exec('SELECT COUNT(*) FROM networks')[0].values[0][0];

    const targets = pairs.map(p => p.target);
    const placeholders = targets.map(() => '?').join(',');
    const ins = db.prepare(`INSERT INTO networks (file_id, ${targets.join(',')}) VALUES (?, ${placeholders})`);
    const sel = temp.prepare(`SELECT ${pairs.map(p => `"${p.col}" AS "${p.target}"`).join(', ')} FROM networks`);
    const fileId = addFileRow(file.name);
    let n = 0;
    try {
      db.run('BEGIN');
      while (sel.step()) {
        const o = sel.getAsObject();
        ins.run([fileId, ...targets.map(t => o[t] == null ? null : o[t])]);
        n++;
      }
      db.run('COMMIT');
    } catch (e) {
      try { db.run('ROLLBACK'); } catch (_) {}
      throw e;
    } finally { ins.free(); sel.free(); }
    updateFileCount(fileId, n);
    return count;
  } finally {
    try { temp.close(); } catch (_) {}
  }
}