/* ── API layer (local, in-browser) ─────────────────────────────────────────────
 * These functions mirror the old HTTP endpoints but run entirely against the
 * in-memory sql.js database — no network requests are made.
 */
async function api(path, params) {
  switch (path) {
    case '/api/meta': return await dbMeta();
    case '/api/files': return await dbFiles();
    case '/api/data': return await dbData(params);
    case '/api/stats': return await dbStats(params);
    default: throw new Error(`Unknown endpoint: ${path}`);
  }
}

async function apiPost(path, body) {
  switch (path) {
    case '/api/query': return await dbQuery(body && body.sql);
    case '/api/unload': return await dbUnload(body && body.file_id);
    default: throw new Error(`Unknown endpoint: ${path}`);
  }
}

// Builds the params object the backend understood. The query layer (db.js)
// reads snake_case names (rssi_min, channel_min, dir, …); the frontend state
// uses camelCase, so we translate here — param-name mismatches previously made
// channel/RSSI/date/sort filters silently no-ops.
function buildParams() {
  const p = {
    type: state.types, auth: state.authModes, auth_only: state.authOnlyContains,
    rssi_min: state.rssiMin, rssi_max: state.rssiMax,
    date_from: state.dateFrom, date_to: state.dateTo,
    q: state.q, adv: state.advSQL,
    sort: state.sort, dir: state.sortDir,
  };
  // File filtering — only send when the user has unchecked something;
  // omitted (or "all selected" = all loadedFiles IDs) = no constraint, show everything
  if (activeFileIds && activeFileIds.size > 0 && activeFileIds.size !== loadedFiles.length && loadedFiles.length > 0) {
    p.file_ids = Array.from(activeFileIds).join(',');
  }
  // auth_only="Only contains" requires the full known-element inventory to
  // exclude nets that also contain a non-selected element. Send it only in
  // that mode so URLs stay lean.
  if (state.authOnlyContains && allAuths && allAuths.length) p.auth_all = allAuths;
  // Constraints only sent once the user touched the control — defaults
  // (channel 0–196, acc ≤200 m, freq 0–6000 MHz) cover the full dataset and
  // would otherwise send wide-open bounds that still drop NULL rows.
  if (channelTouched) { p.channel_min = state.chMin; p.channel_max = state.chMax; }
  if (accTouched)    { p.acc_max = state.accMax; }
  if (freqTouched)   { p.freq_min = state.freqMin; p.freq_max = state.freqMax; }
  return p;
}