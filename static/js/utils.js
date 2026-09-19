/* ── Utils ─────────────────────────────────────────────────────────────── */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const debounce = (fn, ms=250) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const typeColor = t => TYPE_COLORS[t] || '#8b949e';

// Some uploaded DBs use *_meters suffixes (accuracy_meters) vs CSV import (accuracy)
const colVal = (r, plain) => r[plain] ?? r[plain + '_meters'] ?? r[plain.replace(/_meters$/,'') + '_meters'];

// Build the small popup HTML for a network row
function popupHtmlFor(r) {
  const ssid = r.ssid ? esc(r.ssid) : '<i>(hidden)</i>';
  return `<div style="font:12px sans-serif;line-height:1.5;min-width:200px">
    <div style="font-weight:700;font-size:13px;margin-bottom:4px">${ssid}</div>
    <div><b>MAC:</b> ${esc(r.mac)}</div>
    <div><b>Type:</b> ${esc(r.type)} &nbsp; <b>Auth:</b> ${esc(r.auth_mode||'')}</div>
    <div><b>Ch:</b> ${r.channel||''} &nbsp; <b>Freq:</b> ${r.frequency||''} MHz</div>
    <div><b>RSSI:</b> ${r.rssi||''} dBm &nbsp; <b>Acc:</b> ${(()=>{const v=colVal(r,'accuracy');return v!=null?v.toFixed(1):''})()} m</div>
    <div><b>First seen:</b> ${esc(r.first_seen)}</div>
  </div>`;
}

/* ── CSV export helpers ────────────────────────────────────────────────── */
function downloadCSV(cols, rows, filename) {
  const csvLines = [cols.map(csvEscape).join(',')];
  rows.forEach(r => csvLines.push(cols.map(c => csvEscape(r[c])).join(',')));
  const blob = new Blob([csvLines.join('\n')], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
function csvEscape(v) {
  if (v==null) return '';
  const s = String(v);
  if (s.includes(',')||s.includes('"')||s.includes('\n')) return '"'+s.replace(/"/g,'""')+'"';
  return s;
}