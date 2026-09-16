/* ── Map ─────────────────────────────────────────────────────────────────── */

function initMap() {
  map = L.map('map', {zoomControl: true, attributionControl: true}).setView([20, 0], 2);
  setTileLayer('osm');
  hoverPopup = L.popup({closeButton: false, autoPan: false, offset: [0, -8]});
  markersLayer = L.markerClusterGroup({maxClusterRadius: 50, spiderfyOnMaxZoom: true, showCoverageOnHover: false, chunkedLoading: true});
  map.addLayer(markersLayer);
  heatLayer = L.heatLayer([], {radius: 18, blur: 22, maxZoom: 17});
  map.on('moveend', debounce(()=>{ /* could sync bbox filter */ }, 300));
}

function setTileLayer(k) {
  if (tileLayer) map.removeLayer(tileLayer);
  const t = TILES[k] || TILES.osm;
  tileLayer = L.tileLayer(t.url, t.opt).addTo(map);
}

/* ── Map rendering ─────────────────────────────────────────────────────────── */
function highlightSelection() {
  $$('#tableBody tr').forEach(tr => { tr.classList.toggle('selected', tr.dataset.id === String(selectedId)); });
  // visually emphasize the selected marker (bigger + white stroke + pulse glow + bring to front)
  for (const [id, m] of markerById) {
    const isSel = String(id) === String(selectedId);
    if (isSel) {
      m.setStyle({weight:3, color:'#fff', radius: (m.options._baseRadius||5)*1.6});
      m.getElement()?.style.setProperty('animation', 'markerPulse 1.2s ease-in-out infinite');
      m.bringToFront();
    } else {
      m.setStyle({weight:1, color:m.options._baseColor, radius: m.options._baseRadius||5});
      m.getElement()?.style.removeProperty('animation');
    }
  }
}

function renderMap(rows) {
  markersLayer.clearLayers();
  markerById.clear();
  if (heatLayer._map) map.removeLayer(heatLayer);
  if (selectedId !== null && !rows.some(r => String(r.id) === String(selectedId))) { selectedId = null; }
  const heatPts = [];
  const bounds = [];
  rows.forEach(r => {
    if (!r.latitude || !r.longitude) return;
    const col = typeColor(r.type);
    const op = Math.max(state.opacMin, Math.min(1, 0.4 + (r.rssi||-90)/120));
    const sz = state.markerSize + Math.max(0, ((r.rssi||-90)+100)/20);
    const m = L.circleMarker([r.latitude, r.longitude], {radius: sz, color: col, fillColor: col, fillOpacity: op, weight: 1, _baseColor: col, _baseRadius: sz});
    const pHtml = popupHtmlFor(r);
    // Hover → show popup; Click → close popup + show details modal
    m.on('mouseover', () => { hoverPopup.setLatLng([r.latitude, r.longitude]).setContent(pHtml).openOn(map); });
    m.on('mouseout',  () => { map.closePopup(hoverPopup); });
    if (r.id != null) {
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e); /* prevent map click */
        map.closePopup(hoverPopup);
        selectedId = r.id;
        highlightSelection();
        showDetails(r);
      });
      markerById.set(String(r.id), m);
    }
    markersLayer.addLayer(m);
    bounds.push([r.latitude, r.longitude]);
    heatPts.push([r.latitude, r.longitude, Math.max(0.2, (r.rssi||-90+100)/100)]);
  });
  if (state.cluster) { map.addLayer(markersLayer); } else { map.removeLayer(markersLayer); markersLayer.eachLayer(l => l.addTo(map)); }
  if (state.heat) { heatLayer.setLatLngs(heatPts); map.addLayer(heatLayer); }
  if (bounds.length && state.offset===0) { try { map.fitBounds(bounds, {padding:[40,40], maxZoom:16}); } catch(e){} }
  // Legend
  const types = [...new Set(rows.map(r=>r.type).filter(Boolean))];
  $('#mapLegend').innerHTML = '<div><b>Legend</b></div>' + types.map(t=>`<div><span class="dot" style="background:${typeColor(t)}"></span> ${esc(t)}</div>`).join('') +
    '<div style="margin-top:4px;color:var(--muted);font-size:10px">Click marker for details</div>';
}

function fitBounds() {
  const bounds = currentRows.filter(r=>r.latitude&&r.longitude).map(r=>[r.latitude,r.longitude]);
  if (bounds.length) map.fitBounds(bounds, {padding:[40,40]});
}

/* ── Details drawer ────────────────────────────────────────────────────────── */
function showDetails(r) {
  const body = $('#detailsBody');
  $('#detailsTitle').textContent = r.ssid ? (r.ssid.length>40 ? r.ssid.slice(0,40)+'…' : r.ssid) : '(hidden SSID)';
  const rows = [
    ['MAC', r.mac],
    ['Type', r.type],
    ['Auth mode', r.auth_mode],
    ['Channel', r.channel],
    ['Frequency', r.frequency ? r.frequency + ' MHz' : null],
    ['RSSI', r.rssi != null ? r.rssi + ' dBm' : null],
    ['Latitude', r.latitude],
    ['Longitude', r.longitude],
    ['Altitude', (()=>{const v=colVal(r,'altitude');return v!=null?v.toFixed(1)+' m':null})()],
    ['Accuracy', (()=>{const v=colVal(r,'accuracy');return v!=null?v.toFixed(1)+' m':null})()],
    ['First seen', r.first_seen],
  ].filter(x => x[1] != null && x[1] !== '');
  body.innerHTML = '<table style="font-size:13px;line-height:1.7">' +
    rows.map(([k,v]) => `<tr><td style="color:var(--muted);padding-right:16px;white-space:nowrap">${esc(k)}</td><td style="font-family:var(--mono);font-size:12px">${esc(v)}</td></tr>`).join('') +
    (r.latitude && r.longitude ? `<tr><td colspan="2" style="padding-top:8px"><a class="btn" style="display:inline-flex" href="https://www.google.com/maps?q=${r.latitude},${r.longitude}" target="_blank" rel="noopener">Open in Google Maps ↗</a></td></tr>` : '') +
    '</table>';
  $('#detailsModal').classList.remove('hidden');
}
function closeDetails() { $('#detailsModal').classList.add('hidden'); }