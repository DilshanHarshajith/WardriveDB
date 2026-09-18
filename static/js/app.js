/* ── Init ──────────────────────────────────────────────────────────────────── */
async function init() {
  initMap();
  bindUploadEvents();
  bindEvents();
  try {
    metaInfo = await api('/api/meta');
    if (!metaInfo.loaded) { showUpload(); $('#topStats').innerHTML = '<span class="pill" style="color:var(--muted)">No dataset — upload one above</span>'; return; }
    loadedFiles = (await api('/api/files')).files || [];
    renderSidebar();
    renderFileCheckboxes();
    await refresh();
  } catch(e) { console.error('Init failed:', e); alert('Failed to load metadata: ' + e.message); }
}

// Monotonic counter used to drop stale responses. refresh() is debounced but
// not serialized — rapid filter changes can leave several fetch pairs in
// flight, and a slower OLDER response landing after a faster NEWER one used to
// overwrite the view with stale rows (user sees filters "stop working" until a
// refresh completes). Each refresh claims an epoch; only the response matching
// the LATEST epoch may render.
let refreshEpoch = 0;

/* ── Refresh ────────────────────────────────────────────────────────────────── */
const debounceRefresh = debounce(refresh, 200);

async function refresh() {
  const epoch = ++refreshEpoch;   // invalidate any earlier in-flight refresh
  try {
    // No pagination — the backend returns every row matching the filters, so
    // the table and map both show the complete result set.
    const [data, stats] = await Promise.all([api('/api/data', buildParams()), api('/api/stats', buildParams())]);
    if (epoch !== refreshEpoch) return;   // superseded by a newer refresh — discard
    currentRows = data.rows || [];
    totalCount = data.total || 0;
    renderMap(currentRows);
    renderTable();
    updateTopStats();
    $('#tableTitle').textContent = `Results (${(data.total||0).toLocaleString()})`;
    $('#tableInfo').textContent = `${(data.total||0).toLocaleString()} networks`;
  } catch(e) { console.error('Refresh failed:', e); }
}

/* ── Events ────────────────────────────────────────────────────────────────── */
function bindEvents() {
  // Search
  $('#globalSearch').addEventListener('input', debounce(e => { state.q = e.target.value; state.offset=0; refresh(); }, 300));
  // Range sliders — also keep any companion text input in sync on the fly
  const rangeBind = (id, key, labelId, fmt, textId) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      state[key] = Number(el.value);
      document.getElementById(labelId).textContent = fmt(el.value);
      if (textId) { const ti = document.getElementById(textId); if (ti) ti.value = el.value; }
    });
    el.addEventListener('change', () => { state.offset=0; refresh(); });
  };
  rangeBind('chMin','chMin','chMinVal', v=>{ channelTouched=true; return v; }, 'chMinText');
  rangeBind('chMax','chMax','chMaxVal', v=>{ channelTouched=true; return v; }, 'chMaxText');
  rangeBind('rssiMin','rssiMin','rssiMinVal', v=>v);
  rangeBind('rssiMax','rssiMax','rssiMaxVal', v=>v);
  // acc/freq sliders have no companion text inputs; kept as before (freq has text range, ch has text range)
  rangeBind('accMax','accMax','accMaxVal', v=>{ accTouched=true; return '≤ '+v+' m'; });
  rangeBind('freqMin','freqMin','freqMinVal', v=>{ freqTouched=true; return v; }, 'freqMinText');
  rangeBind('freqMax','freqMax','freqMaxVal', v=>{ freqTouched=true; return v; }, 'freqMaxText');
  rangeBind('markerSize','markerSize','markerSizeVal', v=>v);
  rangeBind('opacMin','opacMin','opacMinVal', v=>(v/100).toFixed(2));
  // Number inputs — typed channel/frequency bounds, kept in sync with the sliders
  const numBind = (id, sliderId, key, group) => {
    const el = document.getElementById(id);
    const slider = document.getElementById(sliderId);
    const syncFromText = () => {
      if (el.value === '' || isNaN(Number(el.value))) return;
      const v = Math.max(+slider.min, Math.min(+slider.max, Math.round(Number(el.value))));
      el.value = v; slider.value = v;
      state[key] = v;
      document.getElementById(sliderId + 'Val').textContent = v;
      if (group === 'channel') channelTouched = true;
      else if (group === 'freq') freqTouched = true;
    };
    // Live mirror while typing / spinners — slider + label track the text
    el.addEventListener('input', syncFromText);
    // Fire the refresh once the control loses focus / enter is pressed
    el.addEventListener('change', () => { syncFromText(); state.offset = 0; refresh(); });
  };
  numBind('chMinText', 'chMin', 'chMin', 'channel');
  numBind('chMaxText', 'chMax', 'chMax', 'channel');
  numBind('freqMinText', 'freqMin', 'freqMin', 'freq');
  numBind('freqMaxText', 'freqMax', 'freqMax', 'freq');
  // Date
  $('#dateFrom').addEventListener('change', e => { state.dateFrom = e.target.value||null; state.offset=0; refresh(); });
  $('#dateTo').addEventListener('change', e => { state.dateTo = e.target.value||null; state.offset=0; refresh(); });
  // Display
  $('#mapStyle').addEventListener('change', e => { state.mapStyle=e.target.value; setTileLayer(e.target.value); });
  $('#chkHeat').addEventListener('change', e => { state.heat=e.target.checked; refresh(); });
  $('#chkCluster').addEventListener('change', e => { state.cluster=e.target.checked; refresh(); });
  // Advanced
  $('#btnApplyAdv').onclick = () => { state.advSQL = $('#advSQL').value.trim(); state.offset=0; refresh(); };
  $('#btnClearAdv').onclick = () => { $('#advSQL').value=''; state.advSQL=''; state.offset=0; refresh(); };
  // Buttons
  $('#btnResetFilters').onclick = resetAllFilters;
  $('#btnFitBounds').onclick = fitBounds;
  $('#btnSQL').onclick = openSQL;
  $('#btnCloseSQL').onclick = closeSQL;
  $('#btnRunSQL').onclick = runSQL;
  $('#btnExportSQL').onclick = exportSQLResults;
  $('#btnExport').onclick = exportCSV;
  $('#btnCloseDetails').onclick = closeDetails;
  $('#btnCloseDetails2').onclick = closeDetails;
  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    if (e.key==='/') { e.preventDefault(); $('#globalSearch').focus(); }
    if (e.key==='f'||e.key==='F') { e.preventDefault(); $('#sidebar').classList.toggle('collapsed'); }
  });
  // Section toggle
  $$('.section-header').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
  // Bottom panel resize
  let dragging = false, startY, startH;
  $('#bottomHandle').addEventListener('mousedown', e => { dragging=true; startY=e.clientY; startH=$('#bottomPanel').offsetHeight; e.preventDefault(); });
  document.addEventListener('mousemove', e => { if (!dragging) return; const h = Math.max(80, Math.min(window.innerHeight*.6, startH-(e.clientY-startY))); $('#bottomPanel').style.height=h+'px'; });
  document.addEventListener('mouseup', () => { dragging=false; });
}

function resetAllFilters() {
  state.types.clear(); state.authModes.clear(); state.authOnlyContains=false;
  channelTouched=false; accTouched=false; freqTouched=false;
  selectedId = null; closeDetails();
  state.chMin=0; state.chMax=196; state.rssiMin=-120; state.rssiMax=-10;
  state.dateFrom=null; state.dateTo=null; state.accMax=200; state.freqMin=0; state.freqMax=6000;
  state.q=''; state.advSQL=''; state.offset=0; state.sort='first_seen'; state.sortDir='desc';
  $('#globalSearch').value=''; $('#advSQL').value='';
  $('#chMin').value=0; $('#chMax').value=196; $('#rssiMin').value=-120; $('#rssiMax').value=-10;
  $('#chMinText').value=0; $('#chMaxText').value=196;
  $('#accMax').value=200; $('#freqMin').value=0; $('#freqMax').value=6000;
  $('#freqMinText').value=0; $('#freqMaxText').value=6000;
  $('#dateFrom').value=''; $('#dateTo').value='';
  $('#chMinVal').textContent='0'; $('#chMaxVal').textContent='196';
  $('#rssiMinVal').textContent='-120'; $('#rssiMaxVal').textContent='-10';
  $('#accMaxVal').textContent='≤ 200 m'; $('#freqMinVal').textContent='0'; $('#freqMaxVal').textContent='6000';
  renderSidebar();
  refresh();
}

/* ── Start ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);