(() => {
  const DB_NAME = 'notes-v1';
  const STORE = 'notes';
  const CFG_KEY = 'notes-v1-cfg';
  const PIN_KEY = 'notes-v1-pin';
  const DEFAULTS = {
    owner: 'irsamrhmtysf',
    repo: 'irsamrhmtysf.github.io',
    branch: 'master',
    dir: 'notes/posts',
    token: ''
  };

  let db, notes = [], current = null, filter = 'all', q = '';
  let cfg = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CFG_KEY) || '{}'));
  let dirHandle = null;

  const $ = (id) => document.getElementById(id);
  const panels = ['listPanel', 'editPanel', 'readPanel', 'setPanel'];
  const show = (id) => panels.forEach((p) => $(p).classList.toggle('show', p === id));
  const online = () => navigator.onLine;
  const uid = () => 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = () => new Date().toISOString();
  const slug = (s) => (s || 'note').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note';

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2200);
  }

  function beep(kind) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      const map = { post: 880, update: 660, del: 220, ok: 740 };
      o.frequency.value = map[kind] || 520;
      o.type = kind === 'del' ? 'sawtooth' : 'sine';
      g.gain.value = 0.05;
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      o.stop(ctx.currentTime + 0.2);
    } catch (e) {}
  }

  function setNet() {
    const on = online();
    $('net').textContent = on ? 'online' : 'offline';
    $('net').className = 'pill ' + (on ? 'on' : 'off');
    $('btnSync').hidden = !on;
  }

  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function tx(mode) { return db.transaction(STORE, mode).objectStore(STORE); }
  function allNotes() {
    return new Promise((res) => {
      const out = [];
      tx('readonly').openCursor().onsuccess = (e) => {
        const c = e.target.result;
        if (c) { out.push(c.value); c.continue(); }
        else res(out);
      };
    });
  }
  function putNote(n) {
    return new Promise((res, rej) => {
      const qy = tx('readwrite').put(n);
      qy.onsuccess = () => res(n);
      qy.onerror = () => rej(qy.error);
    });
  }
  function delNote(id) {
    return new Promise((res) => { tx('readwrite').delete(id).onsuccess = () => res(); });
  }

  function cats() {
    const s = {};
    notes.forEach((n) => { if (n.category) s[n.category] = 1; });
    return Object.keys(s).sort();
  }

  function visibleNotes() {
    let list = notes.slice();
    if (filter === 'public') list = list.filter((n) => n.vis === 'public');
    else if (filter === 'private') list = list.filter((n) => n.vis !== 'public');
    else if (filter !== 'all') list = list.filter((n) => n.category === filter);
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((n) => (n.title + ' ' + n.body + ' ' + n.category).toLowerCase().includes(s));
    }
    list.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    return list;
  }

  function renderTabs() {
    const items = ['all', 'public', 'private'].concat(cats());
    $('tabs').innerHTML = items.map((c) =>
      '<button class="tab' + (filter === c ? ' active' : '') + '" data-f="' + c + '">' + c + '</button>'
    ).join('');
    $('tabs').querySelectorAll('.tab').forEach((b) => b.onclick = () => { filter = b.dataset.f; renderList(); });
    $('catlist').innerHTML = cats().map((c) => '<option value="' + c + '"></option>').join('');
  }

  function renderList() {
    renderTabs();
    const list = visibleNotes();
    $('list').innerHTML = list.length ? list.map((n) =>
      '<button class="note" data-id="' + n.id + '">' +
        '<div class="row between">' +
          '<p class="title">' + esc(n.title || 'Untitled') + '</p>' +
          '<span class="dot ' + (n.vis === 'public' ? 'pub' : 'priv') + '"></span>' +
        '</div>' +
        '<p class="meta">' + esc(n.category || 'General') + ' · ' + (n.vis === 'public' ? 'public' : 'private') +
          (n.dirty ? ' · not synced' : '') + '</p>' +
      '</button>'
    ).join('') : '<p class="empty">No notes here. Tap +</p>';
    $('list').querySelectorAll('.note').forEach((b) => b.onclick = () => openRead(b.dataset.id));
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function visLabels() {
    const v = document.querySelector('input[name="vis"]:checked').value;
    $('labPriv').className = v === 'private' ? 'on-priv' : '';
    $('labPub').className = v === 'public' ? 'on-pub' : '';
  }

  function fillEditor(n) {
    current = n;
    $('title').value = n.title || '';
    $('category').value = n.category || 'General';
    $('body').value = n.body || '';
    document.querySelectorAll('input[name="vis"]').forEach((i) => { i.checked = i.value === (n.vis || 'private'); });
    visLabels();
  }

  function formNote() {
    const title = $('title').value.trim() || 'Untitled';
    return {
      id: current && current.id ? current.id : uid(),
      file: (current && current.file) || (slug(title) + '.md'),
      title,
      category: $('category').value.trim() || 'General',
      vis: document.querySelector('input[name="vis"]:checked').value,
      body: $('body').value,
      updated: now(),
      sha: current && current.sha,
      dirty: true
    };
  }

  async function saveNote(isNew) {
    const n = formNote();
    if (n.vis !== 'public') { n.sha = undefined; n.dirty = false; }
    await putNote(n);
    current = n;
    notes = await allNotes();
    const kind = isNew ? 'post' : 'update';
    beep(kind);
    toast(n.vis === 'public' ? (online() ? 'Saved · will sync public' : 'Saved offline · public waits for net') : 'Saved private on this device');
    if (n.vis === 'public' && online() && cfg.token) {
      try { await pushOne(n); toast('Public note synced'); } catch (e) { toast('Saved local. Sync later'); }
    }
    if (dirHandle) try { await writeToFolder(n); } catch (e) {}
    renderList();
  }

  async function removeNote() {
    if (!current) return;
    if (!confirm('Delete this note?')) return;
    if (current.vis === 'public' && online() && cfg.token && current.file) {
      try { await ghDelete(current); } catch (e) {}
    }
    await delNote(current.id);
    notes = await allNotes();
    beep('del');
    toast('Deleted');
    current = null;
    show('listPanel');
    $('fab').style.display = '';
    renderList();
  }

  function mdWrap(n) {
    return '---\n' +
      'title: ' + n.title + '\n' +
      'category: ' + n.category + '\n' +
      'visibility: ' + n.vis + '\n' +
      'updated: ' + n.updated + '\n' +
      '---\n\n' + (n.body || '');
  }

  function parseMd(raw, file) {
    const m = String(raw).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const n = { id: uid(), file, title: file.replace(/\.md$/, ''), category: 'General', vis: 'public', body: raw, updated: now() };
    if (!m) return n;
    n.body = m[2];
    m[1].split('\n').forEach((line) => {
      const i = line.indexOf(':');
      if (i < 0) return;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k === 'title') n.title = v;
      if (k === 'category') n.category = v;
      if (k === 'visibility' || k === 'vis') n.vis = v === 'private' ? 'private' : 'public';
      if (k === 'updated') n.updated = v;
    });
    return n;
  }

  function apiBase() {
    return 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + String(cfg.dir || '').replace(/^\/|\/$/g, '');
  }
  function headers() {
    const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (cfg.token) h.Authorization = 'Bearer ' + cfg.token;
    return h;
  }
  async function gh(url, opt) {
    const r = await fetch(url, opt);
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }

  async function pushOne(n) {
    if (!cfg.token) throw new Error('no token');
    const path = n.file.endsWith('.md') ? n.file : n.file + '.md';
    n.file = path;
    let sha = n.sha;
    if (!sha) {
      const ex = await gh(apiBase() + '/' + encodeURIComponent(path) + '?ref=' + cfg.branch, { headers: headers() });
      if (ex.ok) sha = ex.data.sha;
    }
    const body = {
      message: (sha ? 'update ' : 'create ') + path,
      content: btoa(unescape(encodeURIComponent(mdWrap(n)))),
      branch: cfg.branch
    };
    if (sha) body.sha = sha;
    const res = await gh(apiBase() + '/' + encodeURIComponent(path), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers()),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(res.data.message || 'push fail');
    n.sha = res.data.content.sha;
    n.dirty = false;
    await putNote(n);
    await writeCatalog();
    return n;
  }

  async function ghDelete(n) {
    if (!n.file || !n.sha) return;
    await gh(apiBase() + '/' + encodeURIComponent(n.file), {
      method: 'DELETE',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers()),
      body: JSON.stringify({ message: 'delete ' + n.file, sha: n.sha, branch: cfg.branch })
    });
    await writeCatalog();
  }

  async function writeCatalog() {
    const pubs = notes.filter((n) => n.vis === 'public').map((n) => ({
      file: n.file, title: n.title, category: n.category, updated: n.updated
    }));
    const ex = await gh(apiBase() + '/index.json?ref=' + cfg.branch, { headers: headers() });
    const body = {
      message: 'update catalog',
      content: btoa(unescape(encodeURIComponent(JSON.stringify(pubs, null, 2)))),
      branch: cfg.branch
    };
    if (ex.ok) body.sha = ex.data.sha;
    await gh(apiBase() + '/index.json', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers()),
      body: JSON.stringify(body)
    });
  }

  async function pullPublic() {
    if (!online()) return;
    const res = await gh(apiBase() + '?ref=' + cfg.branch, { headers: cfg.token ? headers() : {} });
    if (!res.ok || !Array.isArray(res.data)) return;
    const files = res.data.filter((f) => f.name && f.name.endsWith('.md'));
    for (const f of files) {
      const local = notes.find((n) => n.file === f.name && n.vis === 'public');
      const got = await gh(apiBase() + '/' + encodeURIComponent(f.name) + '?ref=' + cfg.branch, { headers: cfg.token ? headers() : {} });
      if (!got.ok) continue;
      const raw = decodeURIComponent(escape(atob(String(got.data.content || '').replace(/\n/g, ''))));
      const remote = parseMd(raw, f.name);
      remote.sha = got.data.sha;
      remote.vis = 'public';
      remote.dirty = false;
      if (!local) {
        remote.id = uid();
        await putNote(remote);
      } else if (!local.dirty && (remote.updated > (local.updated || ''))) {
        remote.id = local.id;
        await putNote(remote);
      }
    }
    notes = await allNotes();
  }

  async function syncAll() {
    if (!online()) { toast('Offline'); return; }
    toast('Syncing public notes…');
    try {
      await pullPublic();
      if (cfg.token) {
        for (const n of notes.filter((x) => x.vis === 'public' && x.dirty)) {
          await pushOne(n);
        }
      }
      notes = await allNotes();
      renderList();
      beep('ok');
      toast('Public notes updated');
    } catch (e) {
      toast('Sync failed');
    }
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ v: 1, notes, exported: now() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'notes-v1-backup.json';
    a.click();
    toast('Backup downloaded');
    beep('ok');
  }

  async function importData(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : (data.notes || []);
    for (const n of list) {
      if (!n.id) n.id = uid();
      if (!n.vis) n.vis = 'private';
      await putNote(n);
    }
    notes = await allNotes();
    renderList();
    toast('Imported ' + list.length + ' notes');
    beep('ok');
  }

  async function pickFolder() {
    if (!window.showDirectoryPicker) {
      toast('This phone needs Export / Import');
      return;
    }
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    localStorage.setItem('notes-v1-folder', '1');
    $('folderHint').textContent = 'Folder linked. Saves also write .md files there.';
    toast('Folder set');
  }

  async function writeToFolder(n) {
    if (!dirHandle) return;
    const fh = await dirHandle.getFileHandle((n.file || slug(n.title)) + (String(n.file).endsWith('.md') ? '' : '.md'), { create: true });
    const w = await fh.createWritable();
    await w.write(mdWrap(n));
    await w.close();
  }

  function shareNote(n) {
    if (!n) return;
    if (n.vis !== 'public') { toast('Turn it public first to share'); return; }
    const url = location.origin + location.pathname.replace(/index\.html$/, '') + '#/p/' + encodeURIComponent(n.file || n.id);
    if (navigator.share) navigator.share({ title: n.title, url }).catch(() => {});
    else navigator.clipboard.writeText(url).then(() => toast('Public link copied'));
  }

  function renderRead(n) {
    current = n;
    $('readDot').className = 'dot ' + (n.vis === 'public' ? 'pub' : 'priv');
    $('readCat').textContent = (n.category || 'General') + ' · ' + (n.vis === 'public' ? 'public' : 'private');
    const html = (window.DOMPurify && window.marked)
      ? DOMPurify.sanitize(marked.parse((n.title ? '# ' + n.title + '\n\n' : '') + (n.body || '')))
      : '<pre>' + esc(n.body) + '</pre>';
    $('readBody').innerHTML = html;
    show('readPanel');
    $('fab').style.display = 'none';
  }

  function openRead(id) {
    const n = notes.find((x) => x.id === id);
    if (n) renderRead(n);
  }

  function openEdit(n, isNew) {
    fillEditor(n || { vis: 'private', category: 'General', title: '', body: '' });
    if (isNew) current = { id: uid(), vis: 'private' };
    show('editPanel');
    $('fab').style.display = 'none';
    $('title').focus();
  }

  function loadCfgForm() {
    $('cfgOwner').value = cfg.owner;
    $('cfgRepo').value = cfg.repo;
    $('cfgBranch').value = cfg.branch;
    $('cfgDir').value = cfg.dir;
    $('cfgToken').value = '';
    $('cfgToken').placeholder = cfg.token ? 'Saved on this device · leave blank to keep' : 'Fine-grained PAT';
  }

  function saveCfg() {
    cfg.owner = $('cfgOwner').value.trim() || DEFAULTS.owner;
    cfg.repo = $('cfgRepo').value.trim() || DEFAULTS.repo;
    cfg.branch = $('cfgBranch').value.trim() || DEFAULTS.branch;
    cfg.dir = $('cfgDir').value.trim() || DEFAULTS.dir;
    if ($('cfgToken').value.trim()) cfg.token = $('cfgToken').value.trim();
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    const pin = $('cfgPin').value.trim();
    if (pin) localStorage.setItem(PIN_KEY, pin);
    toast('Settings saved on this device');
    beep('ok');
  }

  async function routeShare() {
    const hash = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
    if (!hash.startsWith('p/')) return false;
    const file = hash.slice(2);
    let n = notes.find((x) => x.file === file && x.vis === 'public');
    if (!n && online()) {
      try { await pullPublic(); n = notes.find((x) => x.file === file && x.vis === 'public'); } catch (e) {}
    }
    if (n) { renderRead(n); return true; }
    toast('Public note not found');
    return false;
  }

  $('q').oninput = () => { q = $('q').value.trim(); renderList(); };
  $('fab').onclick = () => openEdit(null, true);
  $('backEdit').onclick = () => { show('listPanel'); $('fab').style.display = ''; renderList(); };
  $('backRead').onclick = () => { show('listPanel'); $('fab').style.display = ''; };
  $('backSet').onclick = () => { show('listPanel'); $('fab').style.display = ''; };
  $('btnSettings').onclick = () => { loadCfgForm(); show('setPanel'); $('fab').style.display = 'none'; };
  $('btnSave').onclick = () => saveNote(!(current && notes.some((n) => n.id === current.id)));
  $('btnDel').onclick = removeNote;
  $('btnView').onclick = () => { current = Object.assign(current || {}, formNote()); renderRead(current); };
  $('btnEditFromRead').onclick = () => openEdit(current);
  $('btnShare').onclick = () => shareNote(formNote());
  $('btnShareRead').onclick = () => shareNote(current);
  $('btnSync').onclick = syncAll;
  $('btnExport').onclick = exportData;
  $('btnImport').onclick = () => $('fileImport').click();
  $('fileImport').onchange = (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; };
  $('btnFolder').onclick = () => pickFolder().catch(() => toast('Folder not set'));
  $('btnSaveCfg').onclick = saveCfg;
  document.querySelectorAll('input[name="vis"]').forEach((i) => i.onchange = visLabels);

  window.addEventListener('online', () => { setNet(); syncAll(); });
  window.addEventListener('offline', setNet);
  window.addEventListener('hashchange', routeShare);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

  (async () => {
    setNet();
    db = await openDB();
    notes = await allNotes();
    if (!notes.length) {
      await putNote({
        id: uid(),
        file: 'welcome.md',
        title: 'Welcome to V1',
        category: 'General',
        vis: 'private',
        body: 'This note is private (red). It stays on this device.\n\nTurn a note public (green) to sync and share when you are online.',
        updated: now(),
        dirty: false
      });
      notes = await allNotes();
    }
    if (!(await routeShare())) renderList();
    if (online()) pullPublic().then(() => renderList()).catch(() => {});
  })();
})();
