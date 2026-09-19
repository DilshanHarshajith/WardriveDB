/* ── Table ─────────────────────────────────────────────────────────────────── */
const DISPLAY_COLS = ['first_seen','ssid','mac','type','auth_mode','channel','rssi','latitude','longitude'];
function renderTable() {
  const thead = $('#tableHead');
  const tbody = $('#tableBody');
  thead.innerHTML = DISPLAY_COLS.map(c => `<th data-col="${c}">${COL_LABELS[c]||c}${state.sort===c?(state.sortDir==='asc'?' ▲':' ▼'):''}</th>`).join('');
  const rows = visibleRows();
  tbody.innerHTML = rows.map(r => `<tr data-id="${r.id||''}">${DISPLAY_COLS.map(c => `<td title="${esc(r[c])}">${esc(r[c])}</td>`).join('')}</tr>`).join('');
  // Click row → highlight on map + fly to + show hover popup (no details modal)
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.style.cursor = 'pointer';
    tr.onclick = () => {
      const r = rows.find(x => String(x.id)===tr.dataset.id);
      if (!r) return;
      map.closePopup(hoverPopup);
      selectedId = r.id ?? null;
      highlightSelection();
      tr.scrollIntoView({behavior:'smooth', block:'nearest'});
      const m = markerById.get(String(r.id));
      if (m && r.latitude && r.longitude) {
        // Expand the cluster (if any) and show the popup on the specific marker
        // zoomToShowLayer spiderfies or zooms to the marker, then calls the callback
        markersLayer.zoomToShowLayer(m, () => {
          // Spiderfied markers lose inline style — re-highlight
          highlightSelection();
          hoverPopup.setLatLng([r.latitude, r.longitude]).setContent(popupHtmlFor(r)).openOn(map);
        });
      }
    };
  });
  // Column sort
  thead.querySelectorAll('th').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.col;
      if (state.sort === col) state.sortDir = state.sortDir==='asc'?'desc':'asc';
      else { state.sort = col; state.sortDir = 'asc'; }
      refresh();
    };
  });
  const total = currentRows.length;
  if (state.mapLimit) {
    $('#tableTitle').textContent = `Visible in map (${rows.length.toLocaleString()})`;
    $('#tableInfo').textContent = `${rows.length.toLocaleString()} of ${total.toLocaleString()} networks`;
  } else {
    $('#tableTitle').textContent = `Results (${total.toLocaleString()})`;
    $('#tableInfo').textContent = `${total.toLocaleString()} networks`;
  }
}

/* ── CSV export ────────────────────────────────────────────────────────────── */
async function exportCSV() {
  const p = buildParams();
  p.limit = 50000; p.offset = 0;
  try {
    const data = await api('/api/data', p);
    const rows = data.rows||[];
    if (!rows.length) { alert('No data to export.'); return; }
    const cols = COLUMNS.filter(c => rows.some(r=>r[c]!=null));
    downloadCSV(cols, rows, 'wardrivedb_export_'+new Date().toISOString().slice(0,10)+'.csv');
  } catch(e) { alert('Export failed: ' + e.message); }
}