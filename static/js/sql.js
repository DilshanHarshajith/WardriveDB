/* ── SQL Modal ─────────────────────────────────────────────────────────────── */
let sqlResults = [], sqlColumns = [];
function openSQL() { $('#sqlModal').classList.remove('hidden'); $('#sqlText').focus(); }
function closeSQL() { $('#sqlModal').classList.add('hidden'); }
async function runSQL() {
  const sql = $('#sqlText').value.trim();
  if (!sql) return;
  $('#sqlMsg').textContent = 'Running…';
  try {
    const r = await apiPost('/api/query', {sql});
    sqlResults = r.rows||[]; sqlColumns = r.columns||[];
    $('#sqlMsg').textContent = `${r.count} rows`;
    renderSQLResults();
  } catch(e) { $('#sqlMsg').textContent = 'Error: ' + e.message; $('#sqlResults').classList.add('hidden'); }
}
function renderSQLResults() {
  const wrap = $('#sqlResults');
  if (!sqlResults.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = `<table><thead><tr>${sqlColumns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
    sqlResults.slice(0,500).map(r=>`<tr>${sqlColumns.map(c=>`<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')
  }</tbody></table>${sqlResults.length>500?'<div style="padding:6px;color:var(--muted);font-size:12px">Showing 500 of '+sqlResults.length+'</div>':''}`;
}
async function exportSQLResults() {
  if (!sqlResults.length) { alert('No results to export. Run a query first.'); return; }
  downloadCSV(sqlColumns, sqlResults, 'wardrivedb_query_results.csv');
}