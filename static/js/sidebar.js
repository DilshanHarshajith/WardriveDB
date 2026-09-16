/* ── Sidebar ────────────────────────────────────────────────────────────────── */
function renderSidebar() {
  // Types
  allTypes = (metaInfo.types || []).sort();
  renderChips('chipsType', allTypes, state.types, typeColor);
  // Auth modes — split bracketed combos into individual selectable elements,
  // e.g. "[WPA2-PSK-CCMP][RSN-PSK-CCMP][ESS]" → "[WPA2-PSK-CCMP]","[RSN-PSK-CCMP]","[ESS]"
  const rawAuths = (metaInfo.by_auth && metaInfo.by_auth.length ? metaInfo.by_auth.map(r=>r.auth_mode) : (metaInfo.auth_modes||[]));
  allAuths = splitAuthModes(rawAuths);
  renderAuthCheckboxes('chipsAuth', allAuths, state.authModes);
  // Date range defaults
  if (metaInfo.date_range) {
    if (metaInfo.date_range.mn) { state.dateFrom = metaInfo.date_range.mn.slice(0,10); $('#dateFrom').value = state.dateFrom; }
    if (metaInfo.date_range.mx) { state.dateTo = metaInfo.date_range.mx.slice(0,10); $('#dateTo').value = state.dateTo; }
  }
  // Stats pills
  updateTopStats();
}

function renderFileCheckboxes() {
  const container = $('#fileCheckboxes');
  const wrapper = $('#fileSelector');
  if (!loadedFiles || loadedFiles.length === 0) {
    wrapper.style.display = 'none';
    return;
  }
  wrapper.style.display = 'flex';
  container.innerHTML = '';

  // If activeFileIds is empty, populate it with all file IDs (default state)
  if (activeFileIds.size === 0) {
    loadedFiles.forEach(f => activeFileIds.add(String(f.id)));
  }

  loadedFiles.forEach(file => {
    const label = document.createElement('label');
    label.style.cssText = 'display: flex; align-items: center; gap: 5px; font-size: 11px; cursor: pointer; color: var(--fg);';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = activeFileIds.has(String(file.id));

    checkbox.onchange = () => {
      if (checkbox.checked) {
        activeFileIds.add(String(file.id));
      } else {
        activeFileIds.delete(String(file.id));
      }
      debounceRefresh();
    };

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(file.filename.split('/').pop()));
    container.appendChild(label);
  });
}

// Reduce raw auth_mode DB values (unique/distinct) to a deduped, sorted list of
// individual selectable elements. Combo strings like "[WPA2-PSK-CCMP][RSN-PSK-CCMP][ESS]"
// become one checkbox per bracketed element; bare values ("Open", "WEP", "WPA") pass through.
function splitAuthModes(rawValues) {
  const out = new Set();
  for (const raw of rawValues) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!s) continue;
    const parts = s.match(/\[[^\]]*\]/g);
    if (parts) parts.forEach(p => out.add(p));
    else out.add(s);
  }
  return [...out].sort();
}

function renderChips(containerId, items, activeSet, colorFn, labelFn) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  items.forEach(item => {
    const c = document.createElement('span');
    c.className = 'chip' + (activeSet.has(item) ? ' active' : '');
    const label = labelFn ? labelFn(item) : item;
    const dot = colorFn ? `<span class="dot" style="background:${colorFn(item)};width:6px;height:6px;margin-right:4px"></span>` : '';
    c.innerHTML = dot + esc(label);
    c.onclick = () => { activeSet.has(item) ? activeSet.delete(item) : activeSet.add(item); c.classList.toggle('active'); debounceRefresh(); };
    el.appendChild(c);
  });
}

function renderAuthCheckboxes(containerId, items, activeSet) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';

  // "Only contains" toggle
  const onlyDiv = document.createElement('div');
  onlyDiv.style.marginBottom = '8px';
  onlyDiv.innerHTML = `
    <label style="display: flex; align-items: center; font-size: 13px; color: #ccc;">
      <input type="checkbox" id="authOnlyContains" ${state.authOnlyContains ? 'checked' : ''}
             style="margin-right: 6px;">
      Only contains selected modes
    </label>
  `;
  el.appendChild(onlyDiv);

  // Wire up the toggle
  const onlyCheckbox = document.getElementById('authOnlyContains');
  onlyCheckbox.onchange = () => {
    state.authOnlyContains = onlyCheckbox.checked;
    debounceRefresh();
  };

  // Individual auth mode checkboxes
  items.forEach(item => {
    const div = document.createElement('div');
    div.style.marginBottom = '4px';
    const checkboxId = `auth_${item.replace(/[^a-zA-Z0-9]/g, '_')}`;
    div.innerHTML = `
      <label style="display: flex; align-items: center; font-size: 13px; color: #ccc; cursor: pointer;">
        <input type="checkbox" id="${checkboxId}" ${activeSet.has(item) ? 'checked' : ''}
               style="margin-right: 6px;">
        ${esc(item)}
      </label>
    `;
    el.appendChild(div);

    // Wire up checkbox
    const checkbox = document.getElementById(checkboxId);
    checkbox.onchange = () => {
      if (checkbox.checked) {
        activeSet.add(item);
      } else {
        activeSet.delete(item);
      }
      debounceRefresh();
    };
  });
}

function updateTopStats() {
  $('#topStats').innerHTML = `
    <span class="pill"><b>${(totalCount||0).toLocaleString()}</b> results</span>
    <span class="pill"><b>${metaInfo?.count?.toLocaleString() || '?'}</b> total</span>
    <span class="pill">WIFI <b>${(metaInfo.by_type||[]).find(r=>r.type==='WIFI')?.c||0}</b></span>
    <span class="pill">BLE <b>${(metaInfo.by_type||[]).find(r=>r.type==='BLE')?.c||0}</b></span>
  `;
}