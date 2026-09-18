/* ── Upload ─────────────────────────────────────────────────────────────────── */
function showUpload() { $('#uploadOverlay').classList.remove('hidden'); $('#uploadInput').value=''; $('#uploadMsg').textContent=''; $('#uploadMsg').className='upload-msg'; $('#uploadProgress').classList.add('hidden'); }
function hideUpload() { $('#uploadOverlay').classList.add('hidden'); }
function setUploadMsg(msg, isError) { const el=$('#uploadMsg'); el.textContent=msg; el.className='upload-msg'+(isError?' error':''); }

async function doUpload(files) {
  if (!files || files.length === 0) return;

  // Convert FileList to Array if needed
  const fileArray = Array.from(files);

  // Validate all files first
  for (const file of fileArray) {
    if (!/\.(db|csv)$/i.test(file.name)) {
      setUploadMsg(`File ${file.name}: Only .db and .csv files are supported.`, true);
      return;
    }
    if (file.size > 200*1024*1024) {
      setUploadMsg(`File ${file.name}: Too large (max 200 MB).`, true);
      return;
    }
  }

  $('#uploadProgress').classList.remove('hidden');
  $('#uploadBar').style.width='10%';

  const totalSize = fileArray.reduce((sum, f) => sum + f.size, 0);
  setUploadMsg(`Uploading ${fileArray.length} file(s) (${(totalSize/1024/1024).toFixed(1)} MB total)…`);

  try {
    const fd = new FormData();
    fileArray.forEach(file => fd.append('file', file));

    $('#uploadBar').style.width='70%';
    const r = await fetch(API + '/api/upload', {method:'POST', body: fd});
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Upload failed');
    if (j.ok === false) {
      const errs = (j.files || []).map(f => f.error ? `${f.filename}: ${f.error}` : f.filename).join('; ');
      throw new Error(errs || 'Upload failed');
    }

    $('#uploadBar').style.width='100%';

    if (j.files) {
      const successful = j.files.filter(f => f.count !== undefined);
      const failed = j.files.filter(f => f.error !== undefined);

      let msg = `Loaded ${j.total_count.toLocaleString()} networks from ${successful.length} file(s)`;
      if (failed.length > 0) {
        msg += `. ${failed.length} file(s) failed.`;
      }
      setUploadMsg(msg, failed.length > 0);
    } else {
      setUploadMsg(`Loaded ${(j.count||0).toLocaleString()} networks from ${j.filename}`, false);
    }

    // Reload dashboard
    metaInfo = await api('/api/meta');
    loadedFiles = (await api('/api/files')).files || [];
    if (!metaInfo.loaded || !metaInfo.count) {
      setUploadMsg('Upload succeeded but no networks found.', true);
      return;
    }

    hideUpload();
    channelTouched = false;
    renderSidebar();
    renderFileCheckboxes();
    await refresh();

  } catch(e) {
    $('#uploadBar').style.width='0%';
    setUploadMsg('Upload failed: ' + e.message, true);
  } finally {
    setTimeout(()=>$('#uploadProgress').classList.add('hidden'), isUploadVisible()?1500:0);
  }
}

function isUploadVisible() { return !$('#uploadOverlay').classList.contains('hidden'); }

async function unloadFile(fileId) {
  const file = loadedFiles.find(f => String(f.id) === String(fileId));
  if (!file) { console.warn('Unknown file id', fileId); return; }
  if (!confirm(`Unload "${file.filename}" from memory? Its networks will be removed from the dashboard (you can re-upload the file anytime).`)) return;

  try {
    await apiPost('/api/unload', { file_id: Number(fileId) });
  } catch(e) {
    alert('Failed to unload: ' + e.message);
    return;
  }

  metaInfo = await api('/api/meta');
  loadedFiles = (await api('/api/files')).files || [];
  activeFileIds.delete(String(fileId));

  if (!loadedFiles.length) {
    // Nothing left loaded — revert to the empty dashboard + upload prompt
    resetAllFilters();
    renderFileCheckboxes();
    await refresh();
    showUpload();
    return;
  }

  if (activeFileIds.size === 0) {
    loadedFiles.forEach(f => activeFileIds.add(String(f.id)));
  }
  renderSidebar();
  renderFileCheckboxes();
  await refresh();
}

function bindUploadEvents() {
  $('#btnPickFile').onclick = () => $('#uploadInput').click();
  $('#uploadInput').addEventListener('change', e => {
    const files = e.target.files;
    if(files && files.length > 0) doUpload(files);
  });
  $('#uploadBox').addEventListener('click', e => {
    if(e.target.closest('#btnPickFile') || e.target.id==='uploadInput') return;
    if (!e.target.closest('.upload-progress') && !e.target.closest('.upload-msg') && !e.target.closest('.formats'))
      $('#uploadInput').click();
  });
  const box = $('#uploadBox');
  ['dragenter','dragover'].forEach(ev=> box.addEventListener(ev, e=>{e.preventDefault(); box.classList.add('dragover');}));
  ['dragleave','drop'].forEach(ev=> box.addEventListener(ev, e=>{e.preventDefault(); box.classList.remove('dragover');}));
  box.addEventListener('drop', e=>{
    const files = e.dataTransfer.files;
    if(files && files.length > 0) doUpload(files);
  });
  $('#btnLoadData').onclick = showUpload;
  // Dismiss overlay by clicking the backdrop
  $('#uploadOverlay').addEventListener('click', e=>{ if(e.target===$('#uploadOverlay')) hideUpload(); });
}