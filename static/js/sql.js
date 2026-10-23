/* ── SQL Modal ─────────────────────────────────────────────────────────────── */
let sqlResults = [], sqlColumns = [];
let sqlTables = [], sqlShowInternal = false;
function openSQL() {
  $('#sqlModal').classList.remove('hidden');
  $('#sqlText').focus();
  loadSchema();
}
function closeSQL() { $('#sqlModal').classList.add('hidden'); }

async function loadSchema() {
  try {
    const r = await api('/api/schema');
    sqlTables = r.tables || [];
    renderSchema();
  } catch(e) {
    $('#sqlSchema').innerHTML = `<div class="sql-hint">Couldn't load schema: ${esc(e.message)}</div>`;
  }
}

function renderSchema() {
  const wrap = $('#sqlSchema');
  if (!sqlTables.length) {
    wrap.innerHTML = '<div class="sql-hint">No tables yet. Upload a dataset first.</div>';
    return;
  }
  const tables = sqlShowInternal
    ? sqlTables
    : sqlTables.filter(t => !t.internal).map(t => ({...t, columns: (t.columns||[]).filter(c => !c.internal)}));
  wrap.innerHTML = `<label class="sql-toggle"><input type="checkbox" id="sqlShowInternal"${sqlShowInternal ? ' checked' : ''}> Show internal fields</label>
    <div class="sql-hint">Click a table or column to insert it at the cursor.</div>` +
    tables.map(t => {
      const rows = t.row_count == null ? '' : `${t.row_count.toLocaleString()} rows`;
      const query = `SELECT * FROM ${t.name} LIMIT 100`;
      return `<div class="sql-table">
        <div class="sql-table-head">
          <button class="sql-table-name" data-table="${esc(t.name)}" title="Insert table name">${esc(t.name)}</button>
          <button class="sql-starter" data-query="${esc(query)}" title="Replace editor with this starter query">SELECT *</button>
        </div>
        <div class="sql-table-cols">${(t.columns||[]).map(c =>
          `<button class="sql-col" data-col="${esc(c.name)}" title="${esc(c.type||'')}${c.pk ? ' (primary key)' : ''}">${esc(c.name)}${c.type ? ` <span class="type">${esc(c.type)}</span>` : ''}</button>`
        ).join('')}</div>
        ${rows ? `<div class="sql-hint">${rows}</div>` : ''}
      </div>`;
    }).join('');
}

function insertSQL(text, el) {
  const ta = el || $('#sqlText');
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.focus();
  const pos = start + text.length;
  ta.setSelectionRange(pos, pos);
}

$('#sqlSchema').addEventListener('click', e => {
  const starter = e.target.closest('.sql-starter');
  if (starter) {
    const ta = $('#sqlText');
    ta.value = starter.dataset.query;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    return;
  }
  const target = e.target.closest('.sql-table-name, .sql-col');
  if (!target) return;
  insertSQL(target.dataset.table || target.dataset.col);
});

$('#sqlSchema').addEventListener('change', e => {
  if (e.target.id !== 'sqlShowInternal') return;
  sqlShowInternal = e.target.checked;
  renderSchema();
});

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