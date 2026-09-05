    const ICO = {
      clip: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="3.2" width="8" height="3.6" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="5.2" y="5.2" width="13.6" height="15.6" rx="2.4" stroke="currentColor" stroke-width="1.2"/><path d="M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
      search: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.2" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l-3.6-3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      warn: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4.2L21.2 20.2H2.8L12 4.2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10.2v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1" fill="currentColor"/></svg>',
      cam: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.2 8.4h3l1.4-2.2h6.8l1.4 2.2h3c.9 0 1.6.7 1.6 1.6v8.2c0 .9-.7 1.6-1.6 1.6H4.2c-.9 0-1.6-.7-1.6-1.6V10c0-.9.7-1.6 1.6-1.6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13.4" r="3.1" stroke="currentColor" stroke-width="1.8"/></svg>',
      doc: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3.4h7.2L19.6 9v11.2c0 .8-.7 1.4-1.5 1.4H7c-.8 0-1.5-.6-1.5-1.4V4.8c0-.8.7-1.4 1.5-1.4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14.2 3.5V9h5.3" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.6 13h6.8M8.6 16.4h4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      check: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.8"/><path d="M8.2 12.2l2.6 2.6 5-5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    // ========== DATA ==========
    let APP_DATA = null;
    let currentInspection = null;
    let editingInspectionId = null; // when set, start form is in edit-meta mode
    let currentSectionIndex = 0;
    let extraSectionTab = null;
    let notesSource = 'inspection';
    let results = {}; // item_id -> {condition, notes, impacts, severity, photoDataUrl}
    let findings = [];

    // Load data
    function setActiveMachine(model) {
      const key = model || 'LX-8';
      const pack = (window.MACHINE_TEMPLATES && (window.MACHINE_TEMPLATES[key] || window.MACHINE_TEMPLATES['LX-8'])) || window.EMBEDDED_DATA;
      APP_DATA = pack || { sections: [], items: [], lists: {} };
      return APP_DATA;
    }
    async function loadData() {
      if (window.MACHINE_TEMPLATES && window.MACHINE_TEMPLATES['LX-8']) {
        setActiveMachine('LX-8');
      } else if (window.EMBEDDED_DATA && window.EMBEDDED_DATA.sections && window.EMBEDDED_DATA.sections.length) {
        APP_DATA = window.EMBEDDED_DATA;
      } else {
        try {
          const res = await fetch('inspection_data.json');
          APP_DATA = await res.json();
        } catch (e) {
          console.warn('Could not load data');
          APP_DATA = { sections: [], items: [], lists: {} };
        }
      }
      initApp();
    }

    // ========== STORAGE (IndexedDB + localStorage fallback) ==========
    const LX_DB_NAME = 'lematic-lx8';
    const LX_DB_VER = 1;
    const storeMem = {
      inspections: null,
      visits: null,
      jobs: null,
      ready: false
    };
    let lxDb = null;
    let lxPersistTimer = null;

    function lsRead(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed == null ? fallback : parsed;
      } catch (e) { return fallback; }
    }
    function lsWrite(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    }

    function idbOpen() {
      if (lxDb) return Promise.resolve(lxDb);
      if (!('indexedDB' in window)) return Promise.reject(new Error('no-idb'));
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(LX_DB_NAME, LX_DB_VER);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        };
        req.onsuccess = () => { lxDb = req.result; resolve(lxDb); };
        req.onerror = () => reject(req.error || new Error('idb-open-failed'));
      });
    }
    function idbGetKv(key) {
      return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }));
    }
    function idbSetKv(key, value) {
      return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      }));
    }
    function idbPutPhoto(rec) {
      return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').put(rec);
        tx.oncomplete = () => resolve(rec.id);
        tx.onerror = () => reject(tx.error);
      }));
    }
    function idbGetPhoto(id) {
      if (!id) return Promise.resolve(null);
      return idbOpen().then(db => new Promise((resolve, reject) => {
        const req = db.transaction('photos', 'readonly').objectStore('photos').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      }));
    }
    function idbDeletePhotos(ids) {
      const list = (ids || []).filter(Boolean);
      if (!list.length) return Promise.resolve();
      return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('photos', 'readwrite');
        const st = tx.objectStore('photos');
        list.forEach(id => st.delete(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }));
    }
    function idbGetAllPhotos() {
      return idbOpen().then(db => new Promise((resolve, reject) => {
        const req = db.transaction('photos', 'readonly').objectStore('photos').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      })).catch(() => []);
    }

    function dataUrlToBlob(dataUrl) {
      try {
        const m = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/);
        if (!m) return null;
        const bin = atob(m[2]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: m[1] || 'image/jpeg' });
      } catch (e) { return null; }
    }
    function blobToObjectUrl(blob) {
      if (!blob) return '';
      try { return URL.createObjectURL(blob); } catch (e) { return ''; }
    }
    function compressImageFile(file, maxEdge, quality) {
      maxEdge = maxEdge || 1600;
      quality = quality == null ? 0.72 : quality;
      return new Promise((resolve) => {
        if (!file) return resolve(null);
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            let w = img.naturalWidth || img.width;
            let h = img.naturalHeight || img.height;
            const scale = Math.min(1, maxEdge / Math.max(w, h));
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob((blob) => {
              URL.revokeObjectURL(url);
              resolve(blob || file);
            }, 'image/jpeg', quality);
          } catch (e) {
            URL.revokeObjectURL(url);
            resolve(file);
          }
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
      });
    }

    async function hydratePhotoUrl(ph) {
      if (!ph) return ph;
      if (typeof ph === 'string') {
        if (ph.indexOf('data:') === 0 || ph.indexOf('blob:') === 0) return { url: ph, caption: '' };
        const rec = await idbGetPhoto(ph).catch(() => null);
        if (rec && rec.blob) return { id: ph, url: blobToObjectUrl(rec.blob), caption: rec.caption || '' };
        return { url: ph, caption: '' };
      }
      if (ph.url && (String(ph.url).indexOf('data:') === 0 || String(ph.url).indexOf('blob:') === 0 || String(ph.url).indexOf('http') === 0)) return ph;
      if (ph.id) {
        const rec = await idbGetPhoto(ph.id).catch(() => null);
        if (rec && rec.blob) return { id: ph.id, url: blobToObjectUrl(rec.blob), caption: ph.caption || rec.caption || '' };
      }
      return ph;
    }

    async function persistPhotoRecord(photo, prefix) {
      if (!photo) return photo;
      const caption = typeof photo === 'string' ? '' : (photo.caption || '');
      const existingId = typeof photo === 'object' ? photo.id : null;
      const url = typeof photo === 'string' ? photo : (photo.url || '');
      if (existingId && (!url || url.indexOf('blob:') === 0)) {
        return { id: existingId, caption };
      }
      if (url && url.indexOf('data:') === 0) {
        const blob = dataUrlToBlob(url);
        if (!blob) return { url: url, caption };
        const id = existingId || (prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
        await idbPutPhoto({ id, blob, caption, createdAt: Date.now() }).catch(() => null);
        return { id, caption };
      }
      if (photo && photo.blob instanceof Blob) {
        const id = existingId || (prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
        await idbPutPhoto({ id, blob: photo.blob, caption, createdAt: Date.now() }).catch(() => null);
        return { id, caption };
      }
      if (existingId) return { id: existingId, caption };
      return { url: url, caption };
    }

    function stripInspectionPhotos(list) {
      return (list || []).map(ins => {
        const copy = Object.assign({}, ins);
        if (copy.results) {
          const r2 = {};
          Object.keys(copy.results).forEach(k => {
            const row = Object.assign({}, copy.results[k]);
            if (row.photoId) delete row.photoDataUrl;
            else if (row.photoDataUrl && String(row.photoDataUrl).indexOf('blob:') === 0) delete row.photoDataUrl;
            else if (row.photoDataUrl && String(row.photoDataUrl).length > 80 && String(row.photoDataUrl).indexOf('data:') === 0) {
              /* kept only as last-resort fallback if IDB write failed */
            }
            r2[k] = row;
          });
          copy.results = r2;
        }
        if (copy.findings) {
          copy.findings = copy.findings.map(f => {
            const ff = Object.assign({}, f);
            if (ff.photoId) delete ff.photoDataUrl;
            return ff;
          });
        }
        return copy;
      });
    }

    async function extractInspectionBlobs(list) {
      const out = [];
      for (const ins of (list || [])) {
        const copy = JSON.parse(JSON.stringify(ins));
        const insId = copy.id || ('ins_' + Date.now());
        copy.id = insId;
        if (copy.results) {
          for (const k of Object.keys(copy.results)) {
            const row = copy.results[k] || {};
            if (row.photoDataUrl && String(row.photoDataUrl).indexOf('data:') === 0 && !row.photoId) {
              const saved = await persistPhotoRecord({ url: row.photoDataUrl }, 'ins_' + insId + '_' + k);
              if (saved && saved.id) {
                row.photoId = saved.id;
                delete row.photoDataUrl;
              }
            } else if (row.photoDataUrl && String(row.photoDataUrl).indexOf('blob:') === 0) {
              delete row.photoDataUrl;
            }
            copy.results[k] = row;
          }
        }
        if (copy.findings) {
          for (let i = 0; i < copy.findings.length; i++) {
            const f = copy.findings[i] || {};
            if (f.photoDataUrl && String(f.photoDataUrl).indexOf('data:') === 0 && !f.photoId) {
              const saved = await persistPhotoRecord({ url: f.photoDataUrl }, 'insf_' + insId + '_' + i);
              if (saved && saved.id) {
                f.photoId = saved.id;
                delete f.photoDataUrl;
              }
            }
            copy.findings[i] = f;
          }
        }
        out.push(copy);
      }
      return out;
    }

    async function hydrateInspectionBlobs(list) {
      const out = [];
      for (const ins of (list || [])) {
        const copy = Object.assign({}, ins);
        if (copy.results) {
          const r2 = {};
          for (const k of Object.keys(copy.results)) {
            const row = Object.assign({}, copy.results[k]);
            if (row.photoId && !row.photoDataUrl) {
              const rec = await idbGetPhoto(row.photoId).catch(() => null);
              if (rec && rec.blob) row.photoDataUrl = blobToObjectUrl(rec.blob);
            }
            r2[k] = row;
          }
          copy.results = r2;
        }
        if (copy.findings) {
          const next = [];
          for (const f of copy.findings) {
            const ff = Object.assign({}, f);
            if (ff.photoId && !ff.photoDataUrl) {
              const rec = await idbGetPhoto(ff.photoId).catch(() => null);
              if (rec && rec.blob) ff.photoDataUrl = blobToObjectUrl(rec.blob);
            }
            next.push(ff);
          }
          copy.findings = next;
        }
        out.push(copy);
      }
      return out;
    }

    async function persistAllStores() {
      const visits = storeMem.visits || [];
      const inspections = storeMem.inspections || [];
      const slimVisits = [];
      for (const v of visits) {
        const copy = Object.assign({}, v);
        const photos = [];
        for (const ph of (v.photos || [])) {
          photos.push(await persistPhotoRecord(ph, 'vis_' + (v.id || 'x')));
        }
        copy.photos = photos;
        slimVisits.push(copy);
      }
      const slimIns = await extractInspectionBlobs(inspections);
      try {
        await idbSetKv('visits', slimVisits);
        await idbSetKv('inspections', slimIns);
      } catch (e) {
        console.warn('IndexedDB persist failed', e);
      }
      lsWrite('lx8_visits_meta', slimVisits.map(v => ({
        id: v.id, customer: v.customer, equip: v.equip, dates: v.dates, tech: v.tech,
        scope: v.scope, status: v.status, updatedAt: v.updatedAt,
        findings: (v.findings || []).length, photos: (v.photos || []).length
      })));
      try {
        const tiny = stripInspectionPhotos(slimIns).map(ins => {
          const c = Object.assign({}, ins);
          if (c.results) {
            Object.keys(c.results).forEach(k => {
              if (c.results[k] && c.results[k].photoDataUrl) delete c.results[k].photoDataUrl;
            });
          }
          return c;
        });
        lsWrite('lx8_inspections', tiny);
      } catch (e) {}
      try { lsWrite('lx8_visits', slimVisits); } catch (e) {}
    }

    function schedulePersist() {
      clearTimeout(lxPersistTimer);
      lxPersistTimer = setTimeout(() => {
        persistAllStores().catch(err => console.warn(err));
      }, 180);
    }

    async function bootStorage() {
      let visits = lsRead('lx8_visits', []);
      let inspections = lsRead('lx8_inspections', []);
      try {
        await idbOpen();
        const idbVisits = await idbGetKv('visits');
        const idbIns = await idbGetKv('inspections');
        if (Array.isArray(idbVisits) && idbVisits.length) visits = idbVisits;
        if (Array.isArray(idbIns) && idbIns.length) inspections = idbIns;
        if (Array.isArray(idbVisits) && visits === idbVisits) {
          /* already IDB */
        } else if (Array.isArray(visits) && visits.length) {
          await idbSetKv('visits', visits).catch(() => {});
        }
        inspections = await hydrateInspectionBlobs(inspections);
        for (const v of visits) {
          if (v.photos && v.photos.length) {
            v.photos = await Promise.all(v.photos.map(hydratePhotoUrl));
          }
        }
      } catch (e) {
        console.warn('IndexedDB unavailable, using localStorage', e);
      }
      storeMem.visits = Array.isArray(visits) ? visits : [];
      storeMem.inspections = Array.isArray(inspections) ? inspections : [];
      storeMem.ready = true;
      try {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      } catch (e) {}
    }

    function saveInspections(list) {
      storeMem.inspections = Array.isArray(list) ? list : [];
      schedulePersist();
      const ok = lsWrite('lx8_inspections', stripInspectionPhotos(storeMem.inspections));
      if (!ok) {
        try {
          const slim = stripInspectionPhotos(storeMem.inspections);
          if (lsWrite('lx8_inspections', slim)) return true;
        } catch (e2) {}
        toast('Saved to device storage (IndexedDB)');
      }
      return true;
    }
    function loadInspections() {
      if (storeMem.inspections) {
        storeMem.inspections = ensureSampleInspection(storeMem.inspections);
        return storeMem.inspections;
      }
      const raw = lsRead('lx8_inspections', []);
      storeMem.inspections = ensureSampleInspection(Array.isArray(raw) ? raw : []);
      try { saveInspections(storeMem.inspections); } catch (e) {}
      return storeMem.inspections;
    }
    function saveCurrentDraft() {
      if (!currentInspection) return;
      currentInspection.results = results;
      currentInspection.findings = findings;
      currentInspection.currentSectionIndex = currentSectionIndex;
      currentInspection.updatedAt = new Date().toISOString();
      let list = loadInspections();
      const idx = list.findIndex(i => i.id === currentInspection.id);
      if (idx >= 0) list[idx] = currentInspection;
      else list.unshift(currentInspection);
      saveInspections(list);
    }

    // ========== UI HELPERS ==========
    function showScreen(id) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById(id).classList.add('active');
      const bottom = document.getElementById('bottomBar');
      const barInspect = document.getElementById('barInspect');
      const bars = {
        screenInspect: 'barInspect',
        screenFindings: 'barFindings',
        screenNotes: 'barNotes',
        screenInspectPreview: 'barPreview'
      };
      const barIds = ['barInspect', 'barFindings', 'barNotes', 'barPreview'];
      if (bottom) {
        if (bars[id]) {
          bottom.classList.remove('hidden');
          barIds.forEach(bid => {
            const el = document.getElementById(bid);
            if (el) el.classList.toggle('hidden', bid !== bars[id]);
          });
        } else {
          bottom.classList.add('hidden');
        }
      }
      // Header red glow only on home
      document.body.classList.toggle('on-home', id === 'screenHome');
      document.body.classList.toggle('on-settings', id === 'screenSettings');
      document.body.classList.toggle('on-punchlist', id === 'screenPunchlist');
      document.body.classList.toggle('on-jobs-list', id === 'screenJobsList');
      const fab = document.getElementById('fab-add');
      if (fab) {
        if (id === 'screenJobsList') {
          fab.title = 'Add Job';
          fab.setAttribute('aria-label', 'Add Job');
        } else if (id === 'screenPunchlist') {
          fab.title = 'Add Item';
          fab.setAttribute('aria-label', 'Add Item');
        }
      }
      document.body.classList.toggle('on-list-search', id === 'screenInspectList' || id === 'screenJobsList');
      document.body.classList.toggle('on-notes', id === 'screenNotes');
      if (id === 'screenNotes') {
        initNotesEditor();
        requestAnimationFrame(placeNotesFormatBar);
      } else {
        document.body.classList.remove('notes-focus');
        document.body.classList.remove('notes-typing');
      }
      const tripFlow = isTripFlowScreen(id);
      const inspectFlow = id === 'screenInspect' || id === 'screenFindings' || id === 'screenNotes';
      document.body.classList.toggle('on-inspect-flow', inspectFlow);
      const inInspections = (
        id === 'screenStart' ||
        id === 'screenInspect' ||
        id === 'screenFindings' ||
        (id === 'screenNotes') ||
        id === 'screenInspectPreview'
      );
      document.body.classList.toggle('on-inspections', inInspections);
      if (id === 'screenFindings') extraSectionTab = 'findings';
      else if (id === 'screenNotes') extraSectionTab = 'notes';
      else if (id === 'screenInspect') extraSectionTab = null;
      if (inspectFlow && typeof APP_DATA !== 'undefined' && APP_DATA && APP_DATA.sections) {
        renderSectionDots(true);
      }
      if (id !== 'screenHome') closeSearch();
      // Always reveal chrome when switching screens
      window.scrollTo(0, 0);
      resetChrome();
      requestAnimationFrame(measureHeaderHeight);
    }
    function toast(msg, ms = 2200) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), ms);
    }
    function setHeader(title) {
      // Logo is fixed; title change is optional / no-op for branded header
    }

    // ========== HOME ==========
    let searchQuery = '';

    async function refreshPunchlistHome() {
      const container = document.getElementById('recentPunchlistList');
      if (!container) return;
      try {
        if (typeof window.getPunchlistSummaries === 'function') {
          const rows = await window.getPunchlistSummaries();
          if (!rows.length) {
            container.innerHTML = `<div class="empty-state"><div class="icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.2" y="3.2" width="15.6" height="17.6" rx="2.2" stroke="currentColor" stroke-width="1.2"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></div><p>No punchlists yet.<br>Tap “+ Punchlist” to begin.</p></div>`;
            return;
          }
          container.innerHTML = rows.map(row => {
            const done = row.complete || 0;
            const total = row.total || 0;
            const open = total - done;
            const allDone = total > 0 && open === 0;
            const statusClass = allDone ? 'badge-complete' : (done > 0 ? 'badge-draft' : 'badge-draft');
            const statusLabel = allDone ? 'Complete' : (total === 0 ? 'Empty' : 'Open');
            const rowTone = allDone ? 'list-complete' : '';
            return `
              <div class="list-item ${rowTone}" data-job-name="${String(row.name).replace(/"/g, '&quot;')}">
                <div class="list-item-main" data-action="open">
                  <div class="title">${row.name}</div>
                  <div class="sub">${total} item${total !== 1 ? 's' : ''} · ${done} complete${open ? ' · ' + open + ' open' : ''}</div>
                </div>
                <div class="list-item-actions">
                  <span class="badge ${statusClass}">${statusLabel}</span>
                </div>
              </div>`;
          }).join('');
          container.querySelectorAll('.list-item').forEach(el => {
            const name = el.getAttribute('data-job-name');
            el.querySelector('[data-action="open"]').addEventListener('click', async () => {
              if (typeof window.openPunchlistByName === 'function') {
                await window.openPunchlistByName(name);
                showScreen('screenPunchlist');
                setHeader('Punchlist');
                if (typeof window.renderList === 'function') window.renderList();
              }
            });
          });
          return;
        }
      } catch (e) {
        console.warn(e);
      }
      container.innerHTML = `<div class="empty-state"><div class="icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.2" y="3.2" width="15.6" height="17.6" rx="2.2" stroke="currentColor" stroke-width="1.2"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></div><p>No punchlists yet.<br>Tap “+ Punchlist” to begin.</p></div>`;
    }

    function formatJobDateRange(job) {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const parse = (v) => {
        if (!v) return null;
        const s = String(v).slice(0, 10);
        const p = s.split('-').map(Number);
        if (p.length < 3 || !p[0] || !p[1] || !p[2]) return null;
        return { y: p[0], m: p[1], d: p[2] };
      };
      const fmt = (dt, withYear) => months[dt.m - 1] + ' ' + dt.d + (withYear ? ', ' + dt.y : '');
      const a = parse(job && job.date);
      const b = parse(job && job.endDate);
      if (a && b) {
        if (a.y === b.y) return fmt(a, false) + ' - ' + fmt(b, true);
        return fmt(a, true) + ' - ' + fmt(b, true);
      }
      if (a) return fmt(a, true);
      if (b) return fmt(b, true);
      return '';
    }
    function jobDayStamp(v) {
      if (!v) return null;
      const n = Date.parse(String(v).slice(0, 10) + 'T00:00:00');
      return Number.isNaN(n) ? null : n;
    }
    function jobStatusFromDates(job) {
      const start = jobDayStamp(job && job.date);
      const end = jobDayStamp(job && job.endDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayMs = today.getTime();
      if (start != null && todayMs < start) return 'Planned';
      if (start != null && end != null && todayMs >= start && todayMs <= end) return 'In Progress';
      if (start != null && end == null && todayMs >= start) return 'In Progress';
      if (end != null && todayMs > end) return 'Complete';
      if (start == null && end != null && todayMs <= end) return 'In Progress';
      return (job && job.status) || 'Planned';
    }
    function applyJobStatuses(list) {
      const arr = Array.isArray(list) ? list : [];
      let changed = false;
      arr.forEach(job => {
        if (!job) return;
        const next = jobStatusFromDates(job);
        if (job.status !== next) {
          job.status = next;
          changed = true;
        }
      });
      return changed;
    }
    function isPastJobByDate(job) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayMs = today.getTime();
      const end = jobDayStamp(job && job.endDate);
      const start = jobDayStamp(job && job.date);
      if (end != null) return end < todayMs;
      if (start != null) return start < todayMs;
      return false;
    }
    function getCurrentJobs() {
      return loadJobs().filter(j => j && !isPastJobByDate(j));
    }
    let homeDateEditJobId = null;
    function openHomeJobDatesEditor(jobId) {
      const job = loadJobs().find(j => j.id === jobId);
      if (!job) return;
      homeDateEditJobId = jobId;
      const s = document.getElementById('homeJobDateStart');
      const e = document.getElementById('homeJobDateEnd');
      if (s) s.value = job.date || '';
      if (e) e.value = job.endDate || '';
      const modal = document.getElementById('jobDatesModal');
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.classList.add('show');
    }
    function closeHomeJobDatesEditor() {
      const modal = document.getElementById('jobDatesModal');
      if (!modal) return;
      modal.classList.add('hidden');
      modal.classList.remove('show');
      homeDateEditJobId = null;
    }
    function saveHomeJobDates() {
      if (!homeDateEditJobId) return;
      const list = loadJobs();
      const job = list.find(j => j.id === homeDateEditJobId);
      if (!job) return;
      job.date = (document.getElementById('homeJobDateStart') || {}).value || '';
      job.endDate = (document.getElementById('homeJobDateEnd') || {}).value || '';
      job.status = jobStatusFromDates(job);
      saveJobs(list);
      closeHomeJobDatesEditor();
      refreshHomeCurrentJob();
      if (typeof refreshJobsList === 'function') refreshJobsList();
    }
    function refreshHomeCurrentJob() {
      const card = document.getElementById('homeCurrentJobCard');
      if (!card) return;
      const current = getCurrentJobs();
      if (!current.length) {
        card.classList.add('hidden');
        document.body.classList.remove('on-home-has-job');
        return;
      }
      const job = current[0];
      card.classList.remove('hidden');
      document.body.classList.add('on-home-has-job');
      const item = document.getElementById('homeCurrentJobItem');
      if (item) {
        const dateRange = formatJobDateRange(job);
        const sub = [job.site, job.technician, dateRange].filter(Boolean).join(' · ');
        const classes = ['pl-item'];
        if (job.status === 'Complete') classes.push('list-complete');
        else if (job.status === 'In Progress') classes.push('job-inprogress');
        else classes.push('job-planned');
        item.className = classes.join(' ');
        const siteLine = [job.site, job.technician].filter(Boolean).join(' · ');
        const jobInspects = loadInspections().filter(i => i && i.jobId === job.id);
        const inspectCount = jobInspects.length;
        let openItems = 0, doneItems = 0;
        try {
          if (typeof window.getPunchlistSummaries === 'function') {
            /* filled below if summaries already loaded */
          }
        } catch (e) {}
        item.innerHTML = `
          <div class="hj-top">
            <span class="hj-label">Current job</span>
            <button type="button" class="hj-dates" id="homeCurrentJobDates">${dateRange ? jobEsc(dateRange) : 'Set dates'}</button>
          </div>
          <div class="hj-name">${jobEsc(job.customer || 'Untitled job')}</div>
          ${siteLine ? `<div class="hj-meta">${jobEsc(siteLine)}</div>` : ''}
          <div class="hj-stats" id="homeCurrentJobStats"><span><b class="n-open">0</b> Open</span><span><b class="n-done">0</b> Complete</span><span><b class="n-ins">${inspectCount}</b> Inspection${inspectCount===1?'':'s'}</span></div>`;
        const statsEl = item.querySelector('#homeCurrentJobStats');
        const fillStats = (openN, doneN) => {
          if (!statsEl) return;
          statsEl.innerHTML = `<span><b class="n-open">${openN}</b> Open</span><span><b class="n-done">${doneN}</b> Complete</span><span><b class="n-ins">${inspectCount}</b> Inspection${inspectCount===1?'':'s'}</span>`;
        };
        const key = jobDisplayName(job);
        if (typeof window.searchPunchlistItems === 'function') {
          window.searchPunchlistItems(' ').catch(() => []);
        }
        if (typeof window.getPunchlistStatsForJob === 'function') {
          window.getPunchlistStatsForJob(job).then(s => fillStats(s.open || 0, s.complete || 0)).catch(() => fillStats(0, 0));
        } else if (typeof window.getPunchlistSummaries === 'function') {
          window.getPunchlistSummaries().then(rows => {
            const row = (rows || []).find(r => r.name === key || r.name === job.customer);
            if (!row) { fillStats(0, 0); return; }
            fillStats(Math.max(0, (row.total || 0) - (row.complete || 0)), row.complete || 0);
          }).catch(() => fillStats(0, 0));
        }
      }
      card.onclick = (e) => {
        if (e.target.closest('.hj-dates')) return;
        if (typeof openJobDetail === 'function') openJobDetail(job.id);
      };
      const dateBtn = document.getElementById('homeCurrentJobDates');
      if (dateBtn) dateBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openHomeJobDatesEditor(job.id);
      };
    }

    function refreshHome() {
      const inspections = loadInspections();
      let list = inspections;
      const container = document.getElementById('recentList');
      if (!container) {
        refreshHomeCurrentJob();
        refreshStorageCard();
        return;
      }
      if (list.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="icon">${ICO.clip}</div><p>No inspections yet.<br>Tap “+ Inspection” to begin.</p></div>`;
        refreshHomeCurrentJob();
        refreshStorageCard();
        return;
      }
      container.innerHTML = list.slice(0, 30).map(ins => {
        const findCount = (ins.findings || []).length;
        const statusClass = ins.status === 'Complete' ? 'badge-complete' : 'badge-draft';
        const statusLabel = ins.status === 'Complete' ? 'Complete' : 'Draft';
        const rowTone = ins.status === 'Complete' ? 'list-complete' : '';
        return `
          <div class="list-item ${rowTone}" data-id="${ins.id}">
            <div class="list-item-main" data-action="open">
              <div class="title">${ins.customer || 'Unknown'} – ${ins.model || 'LX-8'} – ${ins.serial || 'No S/N'}</div>
              <div class="sub">${ins.technician || ''} · ${ins.date || ''} · ${findCount} finding${findCount !== 1 ? 's' : ''}</div>
            </div>
            <div class="list-item-actions">
              <button class="btn-edit" data-action="edit" type="button">Edit</button>
              <span class="badge ${statusClass}">${statusLabel}</span>
            </div>
          </div>`;
      }).join('');
      container.querySelectorAll('.list-item').forEach(el => {
        const id = el.dataset.id;
        el.querySelector('[data-action="open"]').addEventListener('click', () => openInspection(id));
        el.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
          e.stopPropagation();
          editInspectionMeta(id);
        });
      });
      refreshHomeCurrentJob();
        refreshStorageCard();
    }

    function formatBytes(n) {
      n = Number(n) || 0;
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
      if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
      return (n / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    }
    async function refreshStorageCard() {
      const line = document.getElementById('storageLine');
      const sub = document.getElementById('storageSub');
      const fill = document.getElementById('storageBarFill');
      if (!line) return;
      const visits = (typeof loadVisits === 'function' ? loadVisits() : []) || [];
      const inspections = (typeof loadInspections === 'function' ? loadInspections() : []) || [];
      const jobs = (typeof loadJobs === 'function' ? loadJobs() : []) || [];
      let photoCount = 0;
      visits.forEach(v => { photoCount += (v.photos || []).length; });
      inspections.forEach(ins => {
        if (ins.results) Object.keys(ins.results).forEach(k => {
          if (ins.results[k] && (ins.results[k].photoId || ins.results[k].photoDataUrl)) photoCount += 1;
        });
        (ins.findings || []).forEach(f => { if (f && (f.photoId || f.photoDataUrl)) photoCount += 1; });
      });
      let used = 0;
      let quota = 0;
      let persisted = false;
      try {
        const timeout = (p, ms) => Promise.race([
          p,
          new Promise((_, rej) => setTimeout(() => rej(new Error("storage-timeout")), ms))
        ]);
        if (navigator.storage && navigator.storage.estimate) {
          const est = await timeout(navigator.storage.estimate(), 1500);
          used = est.usage || 0;
          quota = est.quota || 0;
        }
        if (navigator.storage && navigator.storage.persisted) {
          persisted = await timeout(navigator.storage.persisted(), 800);
        }
      } catch (e) {}
      if (quota) {
        const pct = Math.max(1, Math.min(100, Math.round((used / quota) * 100)));
        line.textContent = formatBytes(used) + ' of ' + formatBytes(quota) + ' used';
        if (fill) fill.style.width = pct + '%';
      } else {
        line.textContent = jobs.length + ' jobs · ' + inspections.length + ' inspections';
        if (fill) fill.style.width = photoCount ? '12%' : '2%';
      }
      const bits = [];
      bits.push(jobs.length + ' job' + (jobs.length === 1 ? '' : 's'));
      bits.push(inspections.length + ' inspection' + (inspections.length === 1 ? '' : 's'));
      bits.push(photoCount + ' photo' + (photoCount === 1 ? '' : 's'));
      bits.push(persisted ? 'kept by the OS' : 'ask the OS to keep');
      if (sub) sub.textContent = bits.join(' · ');
    }

    async function blobToUint8(blob) {
      const buf = await blob.arrayBuffer();
      return new Uint8Array(buf);
    }
    function safeZipName(s) {
      return String(s || 'item').replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'item';
    }
    async function exportBackupZip() {
      toast('Building backup…');
      try {
        await persistAllStores();
        const visits = JSON.parse(JSON.stringify(loadVisits() || []));
        visits.forEach(v => {
          (v.photos || []).forEach(ph => { if (ph && ph.url) delete ph.url; });
        });
        const inspections = stripInspectionPhotos(JSON.parse(JSON.stringify(loadInspections() || [])));
        const jobs = JSON.parse(JSON.stringify(loadJobs() || []));
        const photos = await idbGetAllPhotos();
        const files = [
          { name: 'manifest.json', data: JSON.stringify({
            app: 'lematic-lx8',
            version: 1,
            exportedAt: new Date().toISOString(),
            visits: visits.length,
            inspections: inspections.length,
            jobs: jobs.length,
            photos: photos.length
          }, null, 2) },
          { name: 'visits.json', data: JSON.stringify(visits) },
          { name: 'inspections.json', data: JSON.stringify(inspections) },
          { name: 'jobs.json', data: JSON.stringify(jobs) }
        ];
        if (typeof window.getPunchlistBackup === 'function') {
          files.push({ name: 'punchlist.json', data: JSON.stringify(window.getPunchlistBackup()) });
        }
        for (const rec of photos) {
          if (!rec || !rec.id || !rec.blob) continue;
          const ext = (rec.blob.type && rec.blob.type.indexOf('png') >= 0) ? 'png' : 'jpg';
          files.push({
            name: 'photos/' + safeZipName(rec.id) + '.' + ext,
            data: await blobToUint8(rec.blob)
          });
        }
        const bytes = zipStore(files);
        const blob = new Blob([bytes], { type: 'application/zip' });
        const a = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        a.href = URL.createObjectURL(blob);
        a.download = 'LeMatic_backup_' + stamp + '.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast('Backup downloaded');
      } catch (e) {
        console.warn(e);
        toast('Backup failed');
      }
    }
    function unzipStore(u8) {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      const files = [];
      let o = 0;
      while (o + 30 <= u8.length) {
        const sig = dv.getUint32(o, true);
        if (sig === 0x06054b50 || sig === 0x02014b50) break;
        if (sig !== 0x04034b50) break;
        const method = dv.getUint16(o + 8, true);
        const comp = dv.getUint32(o + 18, true);
        const uncomp = dv.getUint32(o + 22, true);
        const nameLen = dv.getUint16(o + 26, true);
        const extraLen = dv.getUint16(o + 28, true);
        const name = new TextDecoder().decode(u8.subarray(o + 30, o + 30 + nameLen));
        const start = o + 30 + nameLen + extraLen;
        if (method !== 0) throw new Error('compressed-zip');
        files.push({ name, data: u8.subarray(start, start + (comp || uncomp)) });
        o = start + (comp || uncomp);
      }
      return files;
    }
    function u8ToText(u8) {
      return new TextDecoder().decode(u8);
    }
    async function importBackupZip(file) {
      if (!file) return;
      toast('Restoring backup…');
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const files = unzipStore(buf);
        const byName = {};
        files.forEach(f => { byName[f.name] = f.data; });
        if (!byName['visits.json'] && !byName['inspections.json'] && !byName['punchlist.json']) {
          toast('Not a LeMatic backup');
          return;
        }
        const visits = byName['visits.json'] ? JSON.parse(u8ToText(byName['visits.json'])) : [];
        const inspections = byName['inspections.json'] ? JSON.parse(u8ToText(byName['inspections.json'])) : [];
        const jobs = byName['jobs.json'] ? JSON.parse(u8ToText(byName['jobs.json'])) : [];
        const photoFiles = files.filter(f => f.name.indexOf('photos/') === 0);
        for (const pf of photoFiles) {
          const base = pf.name.split('/').pop();
          const id = base.replace(/\.(jpg|jpeg|png)$/i, '');
          const mime = /\.png$/i.test(base) ? 'image/png' : 'image/jpeg';
          const blob = new Blob([pf.data], { type: mime });
          await idbPutPhoto({ id, blob, caption: '', createdAt: Date.now() });
        }
        storeMem.visits = Array.isArray(visits) ? visits : [];
        storeMem.inspections = Array.isArray(inspections) ? inspections : [];
        storeMem.jobs = Array.isArray(jobs) ? jobs : [];
        try { saveJobs(storeMem.jobs); } catch (e) {}
        for (const v of storeMem.visits) {
          if (v.photos && v.photos.length) v.photos = await Promise.all(v.photos.map(hydratePhotoUrl));
        }
        storeMem.inspections = await hydrateInspectionBlobs(storeMem.inspections);
        await persistAllStores();
        if (byName['punchlist.json'] && typeof window.setPunchlistBackup === 'function') {
          try {
            const pl = JSON.parse(u8ToText(byName['punchlist.json']));
            await window.setPunchlistBackup(pl);
          } catch (err) {
            console.warn('punchlist restore', err);
          }
        }
        refreshHome();
        toast(byName['punchlist.json'] ? 'Backup restored' : 'Inspections restored — this zip has no punchlists');
      } catch (e) {
        console.warn(e);
        toast(String(e && e.message) === 'compressed-zip' ? 'Need an uncompressed LeMatic backup' : 'Restore failed');
      }
    }

    function loadVisits() { return []; }
    function saveVisits(list) {}
    function isTripFlowScreen(id) { return false; }
    function persistVisit(opts) { return {}; }
    function openVisit(id) {}
    function openDeleteVisitModal(id) {}
    function performDeleteVisit(id) {}

    // ========== JOBS ==========
    let editingJobId = null;

    const SAMPLE_JOB_ID = 'job_sample_demo';
    function getSampleJob() {
      const today = new Date();
      const end = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
      const iso = (d) => d.toISOString().slice(0, 10);
      return {
        id: SAMPLE_JOB_ID,
        customer: 'BBU Sample Bakery',
        site: 'Orangeburg',
        contact: 'John Doe',
        technician: 'Sample Tech',
        date: iso(today),
        endDate: iso(end),
        po: 'PO-DEMO-1001',
        status: 'In Progress',
        scope: 'Demo trip for testing Job Detail, inspections, and punchlist linking.\n\n• Inspect LX-8 line 2\n• Capture punchlist items as found\n• Verify bagger guides and slicer linkage',
        notes: 'Sample job — safe to edit or delete while testing.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isSample: true
      };
    }
    const SAMPLE_INSPECTION_ID = 'ins_example_orangeburg';
    function getSampleInspectionRecord() {
      const exampleResults = {1:{condition:'N/A'},2:{condition:'N/A'},3:{condition:'N/A'},4:{condition:'N/A'},5:{condition:'N/A'},6:{condition:'Good'},7:{condition:'Fair',notes:'Belting is stretched.'},8:{condition:'Good'},9:{condition:'Good'},10:{condition:'Fair',notes:'Some wear but can be adjusted.'},11:{condition:'Fair',notes:'Missing 4 but not needed on clusters.'},12:{condition:'Pass'},13:{condition:'Good'},14:{condition:'Fair',notes:'Belting is stretched.'},15:{condition:'Fair'},16:{condition:'Good',impacts:['Performance']},17:{condition:'Poor',notes:'Both are worn. Infeed is worn a lot.',impacts:['Performance'],severity:2},18:{condition:'Good'},19:{condition:'Fair',notes:'Circuit breaker tripped.'},20:{condition:'Good'},21:{condition:'Good'},22:{condition:'Poor',notes:'Worn smooth, should replace.',impacts:['Performance'],severity:2},23:{condition:'Fair',notes:'Center support bushings gone.'},24:{condition:'Fair',notes:'Play in base, pin, and clevis.'},25:{condition:'Fair',notes:'Broken top corner, op side gate.'},26:{condition:'Good'},27:{condition:'Good'},28:{condition:'Good'},29:{condition:'Good'},30:{condition:'Pass'},31:{condition:'Fair',notes:'Belting new but lane guides have worn grooves in rubber grip top.'},32:{condition:'Good'},33:{condition:'Poor',notes:'Infeed nose bar worn and transition gap is large.',impacts:['Performance'],severity:2},34:{condition:'Good'},35:{condition:'Good'},36:{condition:'Pass'},37:{condition:'Pass'},38:{condition:'Pass',notes:'Blade break prox cable has been cut and taped back together.'},39:{condition:'Good'},40:{condition:'Fair',notes:'Guides showing wear. Mix of old and new belts. Belts should be replaced in sets.'},41:{condition:'Good'},42:{condition:'N/A'},43:{condition:'Good'},44:{condition:'Poor',notes:'Missing blade guides. Blade wipers are broken.',impacts:['Downtime', 'Performance'],severity:2},45:{condition:'Poor',notes:'Bearings are bad, need to be replaced.',impacts:['Downtime', 'Performance'],severity:2},46:{condition:'Fair',notes:'Idler pulley new, drive pulley is worn.'},47:{condition:'Good',notes:'One bad hub, LeMatic and maintenance replaced.'},48:{condition:'Pass'},49:{condition:'Good',notes:'We installed a new blade, old blade had a lot of crumb build up.'},50:{condition:'Good'},51:{condition:'Good'},52:{condition:'Pass'},53:{condition:'Good'},54:{condition:'Good'},55:{condition:'Poor',notes:'Missing tensioner assembly.',impacts:['Downtime', 'Performance'],severity:2},56:{condition:'Good'},57:{condition:'Within Spec'},58:{condition:'Good'},59:{condition:'Good'},60:{condition:'Good'},61:{condition:'N/A'},62:{condition:'Good'},63:{condition:'Good'},65:{condition:'Pass'},66:{condition:'Pass',notes:'Prox is ok but linkage is worn and turning off prox.'},67:{condition:'Poor',notes:'Linkage worn out and needs to be replaced.',impacts:['Downtime', 'Performance'],severity:2},68:{condition:'Good'},69:{condition:'Good'},70:{condition:'Good'},71:{condition:'Good'},72:{condition:'Pass'},73:{condition:'Good'},75:{condition:'Pass'},76:{condition:'Good'},77:{condition:'Good'},78:{condition:'Poor',notes:'Blades are very rusty.',severity:2},79:{condition:'Pass'},81:{condition:'Good'},82:{condition:'Good'},83:{condition:'Fair',notes:'Track is showing some wear.',impacts:['Downtime']},84:{condition:'Good'},85:{condition:'Within Spec'},86:{condition:'Within Spec'},87:{condition:'Good'},88:{condition:'Good'},90:{condition:'Pass'},91:{condition:'Pass'},92:{condition:'Good'},93:{condition:'Good'},94:{condition:'Pass'},95:{condition:'Good'},96:{condition:'Fair',notes:'Non op bagger guides missing bolts.',impacts:['Performance']},97:{condition:'Poor',notes:'Transfer grate is bent, should be replaced.',impacts:['Performance'],severity:2},98:{condition:'Fair',notes:'Friction top is worn smooth, buns may slide.'},99:{condition:'Good'},100:{condition:'Good'},101:{condition:'Pass'},102:{condition:'Good'},103:{condition:'Fair',notes:'Dead plate is slightly bent.'},104:{condition:'Fair',notes:'Some play in clevis.'},105:{condition:'Good'},106:{condition:'Fair',notes:'Brackets were bent, LeMatic and maintenance fixed.'},107:{condition:'Fair',notes:'Some play in clevis'},108:{condition:'Poor',notes:'Bearings feel tight.',impacts:['Downtime'],severity:2},109:{condition:'Good'},110:{condition:'Fail',notes:'Lower drive belt cover is missing',impacts:['Safety'],severity:2},111:{condition:'Fair'},112:{condition:'Fair',notes:'Lift screws slightly noisy needs a little lube.'},113:{condition:'Poor',notes:'Broken tab.',impacts:['Performance'],severity:2},114:{condition:'Good'},115:{condition:'Within Spec'},116:{condition:'Fair',notes:'Should be cleaned.'},117:{condition:'Good'},118:{condition:'Good'},119:{condition:'Good'},120:{condition:'Good'},121:{condition:'Fair',notes:'Belt is slightly old but ok.'},122:{condition:'Good'},123:{condition:'Good'},124:{condition:'Good'},125:{condition:'Good'},126:{condition:'Good'},127:{condition:'Good'},128:{condition:'Within Spec'},129:{condition:'Good'},130:{condition:'Good'},131:{condition:'Out of Spec',notes:'Timing belts are getting loose.',severity:2},132:{condition:'Good'},133:{condition:'Good'},134:{condition:'Good'},135:{condition:'Pass'}};
      return {
        id: SAMPLE_INSPECTION_ID,
        jobId: SAMPLE_JOB_ID,
        customer: 'BBU Sample Bakery',
        site: 'Orangeburg',
        model: 'LX-8',
        serial: '44621019 Line 1',
        technician: 'Josh Denig',
        date: '2026-02-22',
        po: 'PO-DEMO-1001',
        status: 'Draft',
        results: exampleResults,
        findings: [],
        currentSectionIndex: 1,
        createdAt: new Date().toISOString(),
        overallCondition: 'Needs Attention',
        coverCards: [
          { tag: 'Safety', title: 'Missing elevator drive belt cover', body: 'Lower drive-belt cover is off. Put it on before Monday.' },
          { tag: 'Uptime', title: 'Hinge tensioners', body: 'All three lines. Line 2 is worst. Order the full assembly.' },
          { tag: 'Slice', title: 'Bottom-slicer linkage', body: 'Worn on all three. Order LH sleeves and clevises.' }
        ],
        summaryNotes: "The baggers are in much better condition now than they were a year ago. The bottom slicer linkage and the hinge slicer drive chain tensioners should be the immediate focus for improvement as both of those items can lead to a loss in efficiency and an increase in downtime.\n\nThe horizontal blades in the hinge slicer are the double notch design. They should be swapped for single notch blades as it is very easy to install blades incorrectly, this will lead to a poor slice and/or damage to the machine.\n\nBlade scrapers for the band slicers could increase the life of the blades and decrease down time due to blades coming off."
      };
    }
    function ensureSampleInspection(list) {
      const arr = Array.isArray(list) ? list.slice() : [];
      const idx = arr.findIndex(i => i && i.id === SAMPLE_INSPECTION_ID);
      if (idx < 0) {
        const full = (typeof window !== 'undefined' && window.__SAMPLE_INSPECTION_FULL) || getSampleInspectionRecord();
        arr.unshift(full);
      } else {
        arr[idx].jobId = SAMPLE_JOB_ID;
        if (!arr[idx].customer) arr[idx].customer = 'BBU Sample Bakery';
      }
      return arr;
    }
    function ensureSampleJob(list) {
      const arr = Array.isArray(list) ? list.slice() : [];
      const sample = getSampleJob();
      const idx = arr.findIndex(j => j && j.id === SAMPLE_JOB_ID);
      if (idx < 0) arr.unshift(sample);
      else {
        arr[idx] = Object.assign({}, arr[idx], {
          site: sample.site,
          contact: sample.contact
        });
      }
      return arr;
    }
    function loadJobs() {
      if (storeMem.jobs) {
        storeMem.jobs = ensureSampleJob(storeMem.jobs);
        if (applyJobStatuses(storeMem.jobs)) saveJobs(storeMem.jobs);
        return storeMem.jobs;
      }
      const raw = lsRead('lx8_jobs', []);
      storeMem.jobs = ensureSampleJob(Array.isArray(raw) ? raw : []);
      try { saveJobs(storeMem.jobs); } catch (e) {}
      return storeMem.jobs;
    }

    function saveJobs(list) {
      storeMem.jobs = Array.isArray(list) ? list : [];
      const ok = lsWrite('lx8_jobs', storeMem.jobs);
      if (!ok) {
        try {
          if (lsWrite('lx8_jobs', storeMem.jobs)) return true;
        } catch (e) {}
      }
      try { idbSetKv('jobs', storeMem.jobs); } catch (e) {}
      return ok;
    }

    function jobEsc(s) {
      return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function jobStatusClass(status) {
      const s = String(status || '').toLowerCase();
      if (s === 'complete' || s === 'done') return 'badge-complete';
      if (s === 'in progress') return 'badge-inprogress';
      return 'badge-planned';
    }

    function refreshJobsList() {
      const container = document.getElementById('jobsList');
      if (!container) return;
      const list = loadJobs().slice().sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')));
      if (!list.length) {
        container.innerHTML = `<div class="empty">
          <div class="icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="7.5" width="17" height="12" rx="2.2" stroke="currentColor" stroke-width="1.2"/><path d="M8.5 7.5V6A1.5 1.5 0 0 1 10 4.5h4A1.5 1.5 0 0 1 15.5 6v1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M3.5 12.5h17" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M11 12.5v2.2h2v-2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div>No jobs yet</div>
          <div style="margin-top:8px;font-size:13px;opacity:0.8">Tap + to start a trip</div>
        </div>`;
        return;
      }
            const dayStamp = (v) => {
        if (!v) return null;
        const n = Date.parse(String(v).slice(0, 10) + 'T00:00:00');
        return Number.isNaN(n) ? null : n;
      };
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayMs = today.getTime();
      const isPastJob = (job) => {
        const end = dayStamp(job.endDate);
        const start = dayStamp(job.date);
        if (end != null) return end < todayMs;
        if (start != null) return start < todayMs;
        return false;
      };
      const current = list.filter(j => !isPastJob(j));
      const past = list.filter(isPastJob);

      function jobCard(job) {
        const dateRange = formatJobDateRange(job);
        const sub = [job.site, job.technician, dateRange].filter(Boolean).join(' · ');
        const scopePreview = (job.scope || '').trim().replace(/\s+/g, ' ').slice(0, 90);
        const classes = ['pl-item'];
        if (job.status === 'Complete') classes.push('list-complete');
        else if (job.status === 'In Progress') classes.push('job-inprogress');
        else classes.push('job-planned');
        return `<div class="${classes.join(' ')}" data-job-id="${job.id}">
          <div class="list-item-main">
            <div class="title">${jobEsc(job.customer || 'Untitled job')}</div>
            <div class="sub">${jobEsc(sub || 'No details yet')}</div>
            ${scopePreview ? `<div class="action-line">${jobEsc(scopePreview)}${(job.scope || '').length > 90 ? '…' : ''}</div>` : ''}
          </div>
          <div class="list-item-actions">
            <span class="badge ${jobStatusClass(job.status)}">${jobEsc(job.status || 'Planned')}</span>
          </div>
        </div>`;
      }

      let html = '';
      if (current.length) {
        html += '<div class="jobs-section-label">Current job</div>' + current.map(jobCard).join('');
      }
      if (past.length) {
        html += '<div class="jobs-section-label">Past jobs</div>' + past.map(jobCard).join('');
      }
      container.innerHTML = html;
      container.querySelectorAll('[data-job-id]').forEach(el => {
        el.addEventListener('click', () => openJobDetail(el.getAttribute('data-job-id')));
      });
    }

    function fillJobCustomerList() {
      const jobs = loadJobs();
      const customers = [...new Set(jobs.map(j => j.customer).filter(Boolean))];
      const dl = document.getElementById('jobCustomerList');
      if (dl) dl.innerHTML = customers.map(c => `<option value="${jobEsc(c)}">`).join('');
    }

    function initJobForm(job) {
      document.getElementById('jobCustomer').value = job?.customer || '';
      document.getElementById('jobSite').value = job?.site || '';
      document.getElementById('jobContact').value = job?.contact || '';
      document.getElementById('jobTechnician').value = job?.technician || (lsRead('lx8_last_tech', '') || '');
      document.getElementById('jobDate').value = job?.date || new Date().toISOString().slice(0, 10);
      document.getElementById('jobEndDate').value = job?.endDate || '';
      document.getElementById('jobPO').value = job?.po || '';
      document.getElementById('jobSO').value = job?.so || '';
      document.getElementById('jobStatus').value = job?.status || 'Planned';
      document.getElementById('jobScope').value = job?.scope || '';
      document.getElementById('jobNotes').value = job?.notes || '';
      fillJobCustomerList();
      setJobMachineFields(job?.machine || 'LX-8');
      jobSerialsDraft = Array.isArray(job?.serials) ? job.serials.slice() : [];
      populateJobSerialSelect(jobSerialsDraft, jobSerialsDraft[0] || '');
      if (typeof renderJobSerialChips === 'function') renderJobSerialChips();
      updateJobMachineSummary();
    }

    let jobSerialsDraft = [];
    let machineModalMode = 'job';

    function updateJobMachineSummary() {
      const el = document.getElementById('jobMachineSummaryText');
      if (!el) return;
      const machine = readJobMachine() || 'No machine';
      const serial = readJobSerial() || (jobSerialsDraft[0] || '');
      el.textContent = serial ? (machine + ' · ' + serial) : (machine + ' · add serial');
    }

    function openMachineModal() {
      const modal = document.getElementById('machineModal');
      if (!modal) return;
      if (!machineModalMode) machineModalMode = 'job';
      if (machineModalMode === 'job') {
        const title = document.getElementById('machineModalTitle');
        const done = document.getElementById('machineModalDone');
        if (title) title.textContent = 'Machine & serials';
        if (done) done.textContent = 'Done';
      }
      modal.classList.remove('hidden');
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeMachineModal() {
      const modal = document.getElementById('machineModal');
      if (!modal) return;
      const serial = readJobSerial();
      if (serial && !jobSerialsDraft.some(s => String(s).toLowerCase() === serial.toLowerCase())) {
        jobSerialsDraft.push(serial);
      }
      modal.classList.add('hidden');
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      updateJobMachineSummary();
    }

    function renderJobSerialChips() {
      const wrap = document.getElementById('jobSerialChips');
      if (!wrap) return;
      if (!jobSerialsDraft.length) {
        wrap.innerHTML = '<div class="job-serial-empty">No serials yet</div>';
        return;
      }
      wrap.innerHTML = jobSerialsDraft.map((s, i) =>
        `<button type="button" class="job-serial-chip" data-idx="${i}">${jobEsc(s)} <span aria-hidden="true">×</span></button>`
      ).join('');
      wrap.querySelectorAll('.job-serial-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.getAttribute('data-idx'));
          jobSerialsDraft.splice(idx, 1);
          renderJobSerialChips();
        });
      });
      updateJobMachineSummary();
    }

    function addJobSerialFromInput() {
      const input = document.getElementById('jobSerialInput');
      if (!input) return;
      const v = input.value.trim();
      if (!v) return;
      if (!jobSerialsDraft.some(s => s.toLowerCase() === v.toLowerCase())) jobSerialsDraft.push(v);
      input.value = '';
      renderJobSerialChips();
    }

    function setInspectMachineFields(value) {
      const sel = document.getElementById('inspectMachine');
      const custom = document.getElementById('inspectMachineCustom');
      if (!sel || !custom) return;
      const known = ['LX-8', 'LX-7', 'LS-132', 'LS-133'];
      const v = String(value || '').trim();
      if (!v || known.includes(v)) {
        sel.value = v || 'LX-8';
        custom.value = '';
        custom.classList.add('hidden');
      } else {
        sel.value = '__other';
        custom.value = v;
        custom.classList.remove('hidden');
      }
    }

    function readInspectMachine() {
      const sel = document.getElementById('inspectMachine');
      const custom = document.getElementById('inspectMachineCustom');
      if (!sel) return '';
      if (sel.value === '__other') return (custom && custom.value.trim()) || '';
      return sel.value;
    }

    function setJobMachineFields(value) {
      const sel = document.getElementById('jobMachine');
      const custom = document.getElementById('jobMachineCustom');
      if (!sel || !custom) return;
      const known = ['LX-8', 'LX-7', 'LS-132', 'LS-133'];
      const v = String(value || '').trim();
      if (!v || known.includes(v)) {
        sel.value = v || 'LX-8';
        custom.value = '';
        custom.classList.add('hidden');
      } else {
        sel.value = '__other';
        custom.value = v;
        custom.classList.remove('hidden');
      }
    }

    function readJobMachine() {
      const sel = document.getElementById('jobMachine');
      const custom = document.getElementById('jobMachineCustom');
      if (!sel) return '';
      if (sel.value === '__other') return (custom && custom.value.trim()) || '';
      return sel.value;
    }

    function populateJobSerialSelect(serials, selected) {
      const sel = document.getElementById('inspectSerialSelect');
      const custom = document.getElementById('inspectSerialInput');
      if (!sel) return;
      const list = Array.isArray(serials) ? serials.filter(Boolean) : [];
      const selVal = String(selected || '').trim();
      sel.innerHTML = '<option value="">Select serial</option>' +
        list.map(s => `<option value="${jobEsc(s)}">${jobEsc(s)}</option>`).join('') +
        '<option value="__other">Other</option>';
      if (selVal && list.some(s => s === selVal)) {
        sel.value = selVal;
        if (custom) { custom.value = ''; custom.classList.add('hidden'); }
      } else if (selVal) {
        sel.value = '__other';
        if (custom) { custom.value = selVal; custom.classList.remove('hidden'); }
      } else if (list.length === 1) {
        sel.value = list[0];
        if (custom) { custom.value = ''; custom.classList.add('hidden'); }
      } else {
        sel.value = '';
        if (custom) { custom.value = ''; custom.classList.add('hidden'); }
      }
    }

    function readJobSerial() {
      const sel = document.getElementById('inspectSerialSelect');
      const custom = document.getElementById('inspectSerialInput');
      if (sel && sel.value === '__other') return (custom && custom.value.trim()) || '';
      if (sel && sel.value) return sel.value.trim();
      return (custom && custom.value.trim()) || '';
    }

    let detailJobId = null;

    function openJobDetail(id) {
      const job = loadJobs().find(j => j.id === id);
      if (!job) { toast('Job not found'); return; }
      detailJobId = id;
      showScreen('screenJobDetail');
      setHeader('Job');
      refreshJobDetail();
    }

    async function refreshJobDetail() {
      const job = loadJobs().find(j => j.id === detailJobId);
      if (!job) {
        toast('Job not found');
        showScreen('screenJobsList');
        setHeader('Jobs');
        refreshJobsList();
        return;
      }

      document.getElementById('jobDetailTitle').textContent = job.customer || 'Untitled job';
      const subParts = [job.site, job.technician].filter(Boolean);
      document.getElementById('jobDetailSub').textContent = subParts.join(' · ') || '';
      const badge = document.getElementById('jobDetailStatusBadge');
      if (badge) {
        badge.textContent = job.status || 'Planned';
        badge.className = 'badge hidden';
      }

      const dash = (v) => (v && String(v).trim()) ? String(v).trim() : '—';
      document.getElementById('jdSite').textContent = dash(job.site);
      document.getElementById('jdContact').textContent = dash(job.contact);
      document.getElementById('jdTech').textContent = dash(job.technician);
      document.getElementById('jdDates').textContent = formatJobDateRange(job) || '—';
      document.getElementById('jdPO').textContent = dash(job.po);

      const scopeCard = document.getElementById('jobDetailScopeCard');
      const scope = (job.scope || '').trim();
      const notes = (job.notes || '').trim();
      if (scope || notes) {
        scopeCard.classList.remove('hidden');
        document.getElementById('jdScope').textContent = scope || '';
        document.getElementById('jdScope').style.display = scope ? '' : 'none';
        const notesEl = document.getElementById('jdNotes');
        if (notes) {
          notesEl.textContent = notes;
          notesEl.classList.remove('hidden');
        } else {
          notesEl.classList.add('hidden');
        }
      } else {
        scopeCard.classList.add('hidden');
      }

      // Linked inspections
      const inspections = loadInspections().filter(i => i.jobId === job.id);
      const inspectList = document.getElementById('jobDetailInspectList');
      const draftN = inspections.filter(i => i.status !== 'Complete').length;
      const doneN = inspections.filter(i => i.status === 'Complete').length;
      if (!inspections.length) {
        document.getElementById('jdInspectCount').textContent = 'None yet';
        inspectList.innerHTML = `<div class="empty-state compact"><p>No inspections linked yet.</p></div>`;
      } else {
        document.getElementById('jdInspectCount').textContent =
          (draftN ? draftN + ' open' : '') + (draftN && doneN ? ' · ' : '') + (doneN ? doneN + ' complete' : '') || (inspections.length + ' total');
        inspectList.innerHTML = inspections.slice(0, 20).map(ins => {
          const findCount = (ins.findings || []).length;
          const statusClass = ins.status === 'Complete' ? 'badge-complete' : 'badge-draft';
          const statusLabel = ins.status === 'Complete' ? 'Complete' : 'Draft';
          const rowTone = ins.status === 'Complete' ? 'list-complete' : '';
          return `<div class="list-item ${rowTone}" data-id="${ins.id}">
            <div class="list-item-main" data-action="open">
              <div class="title">${jobEsc(ins.customer || 'Unknown')} – ${jobEsc(ins.model || 'LX-8')} – ${jobEsc(ins.serial || 'No S/N')}</div>
              <div class="sub">${jobEsc(ins.technician || '')} · ${jobEsc(ins.date || '')} · ${findCount} finding${findCount !== 1 ? 's' : ''}</div>
            </div>
            <div class="list-item-actions">
              <span class="badge ${statusClass}">${statusLabel}</span>
            </div>
          </div>`;
        }).join('');
        inspectList.querySelectorAll('.list-item').forEach(el => {
          const id = el.dataset.id;
          el.querySelector('[data-action="open"]').addEventListener('click', () => openInspection(id));
        });
      }

      // Punchlist summary for this job
      let punchTotal = 0, punchDone = 0, punchName = '';
      try {
        const key = (typeof punchlistKeyForJob === 'function') ? punchlistKeyForJob(job) : (job.customer || '');
        punchName = key;
        if (typeof window.getPunchlistSummaries === 'function') {
          const rows = await window.getPunchlistSummaries();
          const match = rows.find(r => r.name === key);
          if (match) {
            punchTotal = match.total;
            punchDone = match.complete;
            punchName = match.name;
          }
        }
      } catch (e) {}
      if (punchTotal === 0 && !punchName) {
        document.getElementById('jdPunchCount').textContent = 'None yet';
      } else {
        const open = punchTotal - punchDone;
        document.getElementById('jdPunchCount').textContent =
          punchTotal === 0 ? 'Ready to add' : (punchTotal + ' item' + (punchTotal !== 1 ? 's' : '') + (open ? ' · ' + open + ' open' : ' · complete'));
      }

      const punchList = document.getElementById('jobDetailPunchList');
      if (punchTotal === 0) {
        punchList.innerHTML = `<div class="empty-state compact"><p>No punchlist items yet. Tap Punchlist to add.</p></div>`;
      } else {
        const open = punchTotal - punchDone;
        const allDone = open === 0;
        punchList.innerHTML = `<div class="list-item ${allDone ? 'list-complete' : ''}" data-action="open-punch">
          <div class="list-item-main">
            <div class="title">${jobEsc(punchName || jobDisplayName(job))}</div>
            <div class="sub">${punchTotal} item${punchTotal !== 1 ? 's' : ''} · ${punchDone} complete${open ? ' · ' + open + ' open' : ''}</div>
          </div>
          <div class="list-item-actions">
            <span class="badge ${allDone ? 'badge-complete' : 'badge-draft'}">${allDone ? 'Complete' : 'Open'}</span>
          </div>
        </div>`;
        punchList.querySelector('[data-action="open-punch"]').addEventListener('click', () => startPunchlistForDetailJob());
      }
    }

    function openJob(id) {
      // Edit form
      const job = loadJobs().find(j => j.id === id);
      if (!job) { toast('Job not found'); return; }
      editingJobId = id;
      detailJobId = id;
      initJobForm(job);
      document.getElementById('btnSaveJob').textContent = 'Save Job';
      document.getElementById('btnDeleteJob').classList.remove('hidden');
      showScreen('screenJobForm');
      setHeader('Edit Job');
    }

    function startInspectionForDetailJob() {
      const job = loadJobs().find(j => j.id === detailJobId);
      if (!job) { toast('Job not found'); return; }
      currentInspection = null;
      editingInspectionId = null;
      results = {};
      findings = [];
      currentSectionIndex = 0;
      applyJobToInspectionForm(job);
      const model = job.machine || 'LX-8';
      const known = ['LX-8', 'LX-7', 'LS-132', 'LS-133'];
      const modelEl = document.getElementById('inpModel');
      if (modelEl) {
        if (known.includes(model)) modelEl.value = model;
        else modelEl.value = 'LX-8';
      }
      fillInspectionSerialOptions(job);
      jobSerialsDraft = Array.isArray(job.serials) ? job.serials.slice() : [];
      machineModalMode = 'startInspect';
      const title = document.getElementById('machineModalTitle');
      const done = document.getElementById('machineModalDone');
      if (title) title.textContent = 'Machine & serial';
      if (done) done.textContent = 'Start inspection';
      setInspectMachineFields(job.machine || 'LX-8');
      populateJobSerialSelect(jobSerialsDraft, jobSerialsDraft[0] || '');
      openMachineModal();
      toast('Add machine type and serial number to start inspection');
    }

    function fillInspectionSerialOptions(job) {
      let dl = document.getElementById('jobSerialList');
      if (!dl) {
        dl = document.createElement('datalist');
        dl.id = 'jobSerialList';
        const serialInp = document.getElementById('inpSerial');
        if (serialInp) {
          serialInp.setAttribute('list', 'jobSerialList');
          serialInp.parentNode.appendChild(dl);
        }
      }
      const serials = (job && Array.isArray(job.serials)) ? job.serials : [];
      dl.innerHTML = serials.map(s => `<option value="${jobEsc(s)}">`).join('');
    }

    function startInspectionFromMachinePopup() {
      const job = loadJobs().find(j => j.id === detailJobId);
      if (!job) { toast('Job not found'); closeMachineModal(); return; }
      const serial = readJobSerial();
      const model = readInspectMachine() || job.machine || 'LX-8';
      if (serial) {
        if (!jobSerialsDraft.some(s => String(s).toLowerCase() === serial.toLowerCase())) jobSerialsDraft.push(serial);
        rememberJobSerial(job.id, serial);
      }
      closeMachineModal();
      machineModalMode = 'job';
      currentInspection = null;
      editingInspectionId = null;
      results = {};
      findings = [];
      currentSectionIndex = 0;
      if (typeof setActiveMachine === 'function') setActiveMachine(model);
      currentInspection = {
        id: 'ins_' + Date.now(),
        customer: job.customer || '',
        model,
        serial,
        technician: job.technician || '',
        date: job.date || new Date().toISOString().slice(0, 10),
        po: job.po || '',
        jobId: job.id,
        status: 'Draft',
        results: {},
        findings: [],
        currentSectionIndex: 0,
        createdAt: new Date().toISOString()
      };
      saveCurrentDraft();
      renderSection();
      showScreen('screenInspect');
      setHeader('Inspecting');
    }

    function rememberJobSerial(jobId, serial) {
      if (!jobId || !serial) return;
      const list = loadJobs();
      const job = list.find(j => j.id === jobId);
      if (!job) return;
      if (!Array.isArray(job.serials)) job.serials = [];
      if (!job.serials.some(s => String(s).toLowerCase() === serial.toLowerCase())) {
        job.serials.push(serial);
        saveJobs(list);
      }
      jobSerialsDraft = job.serials.slice();
    }

    async function startPunchlistForDetailJob() {
      const job = loadJobs().find(j => j.id === detailJobId);
      if (!job) { toast('Job not found'); return; }
      try {
        if (typeof window.openPunchlistForJob !== 'function') {
          toast('Punchlist not ready');
          return;
        }
        await window.openPunchlistForJob(job);
        showScreen('screenPunchlist');
        setHeader('Punchlist');
        if (typeof window.renderList === 'function') window.renderList();
        toast('Punchlist: ' + jobDisplayName(job));
      } catch (e) {
        console.error(e);
        toast('Could not open punchlist');
      }
    }

    function openNewJob() {
      editingJobId = null;
      initJobForm(null);
      document.getElementById('btnSaveJob').textContent = 'Save Job';
      document.getElementById('btnDeleteJob').classList.add('hidden');
      showScreen('screenJobForm');
      setHeader('New Job');
    }

    function saveJobFromForm() {
      const customer = document.getElementById('jobCustomer').value.trim();
      const tech = document.getElementById('jobTechnician').value.trim();
      const scope = document.getElementById('jobScope').value.trim();
      const so = document.getElementById('jobSO').value.trim();
      if (!customer || !tech) {
        toast('Please fill Customer and Technician');
        return;
      }
      if (!so) {
        toast('Please fill Sales order');
        return;
      }
      const payload = {
        customer,
        site: document.getElementById('jobSite').value.trim(),
        contact: document.getElementById('jobContact').value.trim(),
        technician: tech,
        date: document.getElementById('jobDate').value,
        endDate: document.getElementById('jobEndDate').value,
        po: document.getElementById('jobPO').value.trim(),
        so: document.getElementById('jobSO').value.trim(),
        status: document.getElementById('jobStatus').value || 'Planned',
        scope,
        machine: readJobMachine(),
        serials: jobSerialsDraft.slice(),
        notes: document.getElementById('jobNotes').value.trim(),
        updatedAt: new Date().toISOString()
      };
      payload.status = jobStatusFromDates(payload);
      try { lsWrite('lx8_last_tech', tech); } catch (e) {}
      const list = loadJobs();
      if (editingJobId) {
        const idx = list.findIndex(j => j.id === editingJobId);
        if (idx < 0) { toast('Job not found'); return; }
        list[idx] = { ...list[idx], ...payload };
        toast('Job updated');
      } else {
        const newId = 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        list.unshift({
          id: newId,
          createdAt: new Date().toISOString(),
          ...payload
        });
        editingJobId = newId;
        toast('Job saved');
      }
      saveJobs(list);
      const savedId = editingJobId;
      editingJobId = null;
      if (savedId) {
        detailJobId = savedId;
        showScreen('screenJobDetail');
        setHeader('Job');
        refreshJobDetail();
      } else {
        showScreen('screenJobsList');
        setHeader('Jobs');
        refreshJobsList();
      }
      refreshHomeCurrentJob();
        refreshStorageCard();
    }

    function deleteJobCurrent() {
      const id = editingJobId;
      if (!id) {
        toast('No job to delete');
        return;
      }
      pendingDeleteId = id;
      pendingDeleteKind = 'job';
      document.getElementById('deleteModalTitle').textContent = 'Delete job?';
      document.getElementById('deleteModalLabel').textContent =
        'This job and its details will be permanently deleted.';
      const modal = document.getElementById('deleteModal');
      modal.classList.remove('hidden');
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
    }

    function performDeleteJob(id) {
      if (!id) {
        toast('No job to delete');
        return;
      }
      const list = loadJobs();
      const before = list.length;
      const next = list.filter(j => j.id !== id);
      if (next.length === before) {
        toast('Job not found');
        closeDeleteModal();
        return;
      }
      saveJobs(next);
      const check = loadJobs();
      if (check.some(j => j.id === id)) {
        toast('Delete failed — storage error');
        return;
      }
      if (editingJobId === id) editingJobId = null;
      if (detailJobId === id) detailJobId = null;
      const delBtn = document.getElementById('btnDeleteJob');
      if (delBtn) delBtn.classList.add('hidden');
      closeDeleteModal();
      toast('Job deleted');
      showScreen('screenJobsList');
      setHeader('Jobs');
      refreshJobsList();
      refreshHomeCurrentJob();
        refreshStorageCard();
    }

    let pendingDeleteId = null;
    let pendingDeleteKind = 'inspection';

    function openDeleteModal(id) {
      const list = loadInspections();
      const ins = list.find(i => i.id === id);
      if (!ins) {
        toast('Inspection not found');
        return;
      }
      pendingDeleteId = id;
      pendingDeleteKind = 'inspection';
      document.getElementById('deleteModalTitle').textContent = 'Delete inspection?';
      const modal = document.getElementById('deleteModal');
      document.getElementById('deleteModalLabel').textContent =
        'This inspection report will be permanently deleted.';
      modal.classList.remove('hidden');
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeDeleteModal() {
      pendingDeleteId = null;
      pendingDeleteKind = 'inspection';
      const modal = document.getElementById('deleteModal');
      modal.classList.add('hidden');
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
    }

    function performDeleteInspection(id) {
      if (!id) {
        toast('No inspection to delete');
        return;
      }
      const list = loadInspections();
      const before = list.length;
      const next = list.filter(i => i.id !== id);
      if (next.length === before) {
        toast('Inspection not found');
        closeDeleteModal();
        return;
      }
      saveInspections(next);

      // Verify write stuck
      const check = loadInspections();
      if (check.some(i => i.id === id)) {
        toast('Delete failed — storage error');
        return;
      }

      if (currentInspection && currentInspection.id === id) {
        currentInspection = null;
        results = {};
        findings = [];
      }
      editingInspectionId = null;
      document.getElementById('btnBeginInspection').textContent = 'Begin Inspection';
      const delBtn = document.getElementById('btnDeleteInspection');
      if (delBtn) delBtn.classList.add('hidden');

      closeDeleteModal();
      toast('Inspection deleted');
      showScreen('screenInspectList');
      setHeader('Inspections');
      refreshHome();
    }

    document.getElementById('btnDeleteInspection').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = editingInspectionId || (currentInspection && currentInspection.id);
      if (!id) {
        toast('No inspection to delete');
        return;
      }
      openDeleteModal(id);
    });

    document.getElementById('deleteModalCancel').addEventListener('click', (e) => {
      e.preventDefault();
      closeDeleteModal();
    });

    document.getElementById('deleteModalConfirm').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = pendingDeleteId;
      const kind = pendingDeleteKind;
      if (!id) {
        closeDeleteModal();
        return;
      }
      if (kind === 'visit') performDeleteVisit(id);
      else if (kind === 'job') performDeleteJob(id);
      else if (kind === 'punchlist-item') performDeletePunchlistItem(id);
      else if (kind === 'punchlist-photo') { removePhoto(); closePunchlistPhoto(); closeDeleteModal(); }
      else performDeleteInspection(id);
    });

    // Tap backdrop to cancel
    document.getElementById('deleteModal').addEventListener('click', (e) => {
      if (e.target.id === 'deleteModal') closeDeleteModal();
    });

    function openInspection(id) {
      closeSearch();
      const list = loadInspections();
      const ins = list.find(i => i.id === id);
      if (!ins) return;
      currentInspection = ins;
      setActiveMachine(ins.model || 'LX-8');
      results = ins.results || {};
      findings = ins.findings || [];
      currentSectionIndex = Math.max(0, ins.currentSectionIndex || 0);
      editingInspectionId = null;
      if (ins.status === 'Complete') {
        showFindings();
      } else {
        renderSection();
        showScreen('screenInspect');
        setHeader('Inspecting');
      }
    }

    function editInspectionMeta(id) {
      closeSearch();
      const list = loadInspections();
      const ins = list.find(i => i.id === id);
      if (!ins) return;
      editingInspectionId = id;
      currentInspection = ins;
      // Prefill form
      document.getElementById('inpCustomer').value = ins.customer || '';
      document.getElementById('inpModel').value = ins.model || 'LX-8';
      document.getElementById('inpSerial').value = ins.serial || '';
      document.getElementById('inpTechnician').value = ins.technician || '';
      document.getElementById('inpDate').value = ins.date || new Date().toISOString().slice(0, 10);
      document.getElementById('inpPO').value = ins.po || '';
      // Autocomplete customers
      const customers = [...new Set(list.map(i => i.customer).filter(Boolean))];
      document.getElementById('customerList').innerHTML = customers.map(c => `<option value="${c}">`).join('');
      // Linked job chip
      linkedJobIdForStart = ins.jobId || null;
      if (ins.jobId && typeof loadJobs === 'function') {
        const linked = loadJobs().find(j => j.id === ins.jobId);
        applyJobToInspectionForm(linked || { id: ins.jobId, customer: ins.customer, technician: ins.technician, date: ins.date, po: ins.po });
        // re-apply inspection values (applyJob may overwrite)
        document.getElementById('inpCustomer').value = ins.customer || '';
        document.getElementById('inpModel').value = ins.model || 'LX-8';
        document.getElementById('inpSerial').value = ins.serial || '';
        document.getElementById('inpTechnician').value = ins.technician || '';
        document.getElementById('inpDate').value = ins.date || '';
        document.getElementById('inpPO').value = ins.po || '';
      } else {
        const group = document.getElementById('jobLinkGroup');
        if (group) group.classList.add('hidden');
      }
      // Update button label + show delete
      const btn = document.getElementById('btnBeginInspection');
      btn.textContent = 'Save Changes';
      document.getElementById('btnDeleteInspection').classList.remove('hidden');
      document.getElementById('exampleInspectCard').classList.add('hidden');
      showScreen('screenStart');
      setHeader('Edit Inspection');
    }

    // ========== START ==========
    function initStartForm() {
      // Always start blank for a new inspection
      document.getElementById('inpCustomer').value = '';
      document.getElementById('inpModel').value = 'LX-8';
      document.getElementById('inpSerial').value = '';
      document.getElementById('inpSerial').placeholder = 'Enter serial number';
      document.getElementById('inpTechnician').value = '';
      document.getElementById('inpDate').value = new Date().toISOString().slice(0, 10);
      document.getElementById('inpPO').value = '';
      linkedJobIdForStart = null;
      const group = document.getElementById('jobLinkGroup');
      if (group) group.classList.add('hidden');
      const chip = document.getElementById('jobLinkChip');
      if (chip) chip.textContent = '—';
      // Autocomplete suggestions only (does not fill the fields)
      const list = loadInspections();
      const customers = [...new Set(list.map(i => i.customer).filter(Boolean))];
      document.getElementById('customerList').innerHTML = customers.map(c => `<option value="${c}">`).join('');
    }


    document.getElementById('btnLoadExampleInspection').addEventListener('click', () => {
      closeSearch();
      const exampleResults = {1:{condition:'N/A'},2:{condition:'N/A'},3:{condition:'N/A'},4:{condition:'N/A'},5:{condition:'N/A'},6:{condition:'Good'},7:{condition:'Fair',notes:'Belting is stretched.'},8:{condition:'Good'},9:{condition:'Good'},10:{condition:'Fair',notes:'Some wear but can be adjusted.'},11:{condition:'Fair',notes:'Missing 4 but not needed on clusters.'},12:{condition:'Pass'},13:{condition:'Good'},14:{condition:'Fair',notes:'Belting is stretched.'},15:{condition:'Fair'},16:{condition:'Good',impacts:['Performance']},17:{condition:'Poor',notes:'Both are worn. Infeed is worn a lot.',impacts:['Performance'],severity:2},18:{condition:'Good'},19:{condition:'Fair',notes:'Circuit breaker tripped.'},20:{condition:'Good'},21:{condition:'Good'},22:{condition:'Poor',notes:'Worn smooth, should replace.',impacts:['Performance'],severity:2},23:{condition:'Fair',notes:'Center support bushings gone.'},24:{condition:'Fair',notes:'Play in base, pin, and clevis.'},25:{condition:'Fair',notes:'Broken top corner, op side gate.'},26:{condition:'Good'},27:{condition:'Good'},28:{condition:'Good'},29:{condition:'Good'},30:{condition:'Pass'},31:{condition:'Fair',notes:'Belting new but lane guides have worn grooves in rubber grip top.'},32:{condition:'Good'},33:{condition:'Poor',notes:'Infeed nose bar worn and transition gap is large.',impacts:['Performance'],severity:2},34:{condition:'Good'},35:{condition:'Good'},36:{condition:'Pass'},37:{condition:'Pass'},38:{condition:'Pass',notes:'Blade break prox cable has been cut and taped back together.'},39:{condition:'Good'},40:{condition:'Fair',notes:'Guides showing wear. Mix of old and new belts. Belts should be replaced in sets.'},41:{condition:'Good'},42:{condition:'N/A'},43:{condition:'Good'},44:{condition:'Poor',notes:'Missing blade guides. Blade wipers are broken.',impacts:['Downtime', 'Performance'],severity:2},45:{condition:'Poor',notes:'Bearings are bad, need to be replaced.',impacts:['Downtime', 'Performance'],severity:2},46:{condition:'Fair',notes:'Idler pulley new, drive pulley is worn.'},47:{condition:'Good',notes:'One bad hub, LeMatic and maintenance replaced.'},48:{condition:'Pass'},49:{condition:'Good',notes:'We installed a new blade, old blade had a lot of crumb build up.'},50:{condition:'Good'},51:{condition:'Good'},52:{condition:'Pass'},53:{condition:'Good'},54:{condition:'Good'},55:{condition:'Poor',notes:'Missing tensioner assembly.',impacts:['Downtime', 'Performance'],severity:2},56:{condition:'Good'},57:{condition:'Within Spec'},58:{condition:'Good'},59:{condition:'Good'},60:{condition:'Good'},61:{condition:'N/A'},62:{condition:'Good'},63:{condition:'Good'},65:{condition:'Pass'},66:{condition:'Pass',notes:'Prox is ok but linkage is worn and turning off prox.'},67:{condition:'Poor',notes:'Linkage worn out and needs to be replaced.',impacts:['Downtime', 'Performance'],severity:2},68:{condition:'Good'},69:{condition:'Good'},70:{condition:'Good'},71:{condition:'Good'},72:{condition:'Pass'},73:{condition:'Good'},75:{condition:'Pass'},76:{condition:'Good'},77:{condition:'Good'},78:{condition:'Poor',notes:'Blades are very rusty.',severity:2},79:{condition:'Pass'},81:{condition:'Good'},82:{condition:'Good'},83:{condition:'Fair',notes:'Track is showing some wear.',impacts:['Downtime']},84:{condition:'Good'},85:{condition:'Within Spec'},86:{condition:'Within Spec'},87:{condition:'Good'},88:{condition:'Good'},90:{condition:'Pass'},91:{condition:'Pass'},92:{condition:'Good'},93:{condition:'Good'},94:{condition:'Pass'},95:{condition:'Good'},96:{condition:'Fair',notes:'Non op bagger guides missing bolts.',impacts:['Performance']},97:{condition:'Poor',notes:'Transfer grate is bent, should be replaced.',impacts:['Performance'],severity:2},98:{condition:'Fair',notes:'Friction top is worn smooth, buns may slide.'},99:{condition:'Good'},100:{condition:'Good'},101:{condition:'Pass'},102:{condition:'Good'},103:{condition:'Fair',notes:'Dead plate is slightly bent.'},104:{condition:'Fair',notes:'Some play in clevis.'},105:{condition:'Good'},106:{condition:'Fair',notes:'Brackets were bent, LeMatic and maintenance fixed.'},107:{condition:'Fair',notes:'Some play in clevis'},108:{condition:'Poor',notes:'Bearings feel tight.',impacts:['Downtime'],severity:2},109:{condition:'Good'},110:{condition:'Fail',notes:'Lower drive belt cover is missing',impacts:['Safety'],severity:2},111:{condition:'Fair'},112:{condition:'Fair',notes:'Lift screws slightly noisy needs a little lube.'},113:{condition:'Poor',notes:'Broken tab.',impacts:['Performance'],severity:2},114:{condition:'Good'},115:{condition:'Within Spec'},116:{condition:'Fair',notes:'Should be cleaned.'},117:{condition:'Good'},118:{condition:'Good'},119:{condition:'Good'},120:{condition:'Good'},121:{condition:'Fair',notes:'Belt is slightly old but ok.'},122:{condition:'Good'},123:{condition:'Good'},124:{condition:'Good'},125:{condition:'Good'},126:{condition:'Good'},127:{condition:'Good'},128:{condition:'Within Spec'},129:{condition:'Good'},130:{condition:'Good'},131:{condition:'Out of Spec',notes:'Timing belts are getting loose.',severity:2},132:{condition:'Good'},133:{condition:'Good'},134:{condition:'Good'},135:{condition:'Pass'}};
      currentInspection = {
        id: 'ins_example_orangeburg',
        jobId: (typeof SAMPLE_JOB_ID !== 'undefined' ? SAMPLE_JOB_ID : 'job_sample_demo'),
        customer: 'BBU Sample Bakery',
        site: 'Orangeburg',
        model: 'LX-8',
        serial: '44621019 Line 1',
        technician: 'Josh Denig',
        date: '2026-02-22',
        po: 'PO-DEMO-1001',
        status: 'Draft',
        results: exampleResults,
        findings: [],
        currentSectionIndex: 1,
        createdAt: new Date().toISOString(),
        overallCondition: 'Needs Attention',
        coverCards: [
          { tag: 'Safety', title: 'Missing elevator drive belt cover', body: 'Lower drive-belt cover is off. Put it on before Monday.' },
          { tag: 'Uptime', title: 'Hinge tensioners', body: 'All three lines. Line 2 is worst. Order the full assembly.' },
          { tag: 'Slice', title: 'Bottom-slicer linkage', body: 'Worn on all three. Order LH sleeves and clevises.' }
        ],
        summaryNotes: "The baggers are in much better condition now than they were a year ago. The bottom slicer linkage and the hinge slicer drive chain tensioners should be the immediate focus for improvement as both of those items can lead to a loss in efficiency and an increase in downtime.\n\nThe horizontal blades in the hinge slicer are the double notch design. They should be swapped for single notch blades as it is very easy to install blades incorrectly, this will lead to a poor slice and/or damage to the machine.\n\nBlade scrapers for the band slicers could increase the life of the blades and decrease down time due to blades coming off."
      };
      currentInspection.jobId = SAMPLE_JOB_ID;
      currentInspection.results = exampleResults;
      try { window.__SAMPLE_INSPECTION_FULL = JSON.parse(JSON.stringify(currentInspection)); } catch (e) {}
      results = exampleResults;
      findings = [];
      currentSectionIndex = 1;
      editingInspectionId = null;
      const list = loadInspections().filter(i => i.id !== currentInspection.id);
      list.unshift(currentInspection);
      saveInspections(list);
      updateFindings();
      currentInspection.findings = findings;
      saveCurrentDraft();
      renderSection(true);
      showScreen('screenInspect');
      toast('Orangeburg Line 1 example loaded');
    });

    document.getElementById('homeTileInspect').addEventListener('click', () => {
      closeSearch();
      showScreen('screenInspectList');
      setHeader('Inspections');
      refreshHome();
    });
    function getLastPunchlistName() {
      try {
        if (typeof lsRead === 'function') return lsRead('lx8_last_punchlist', '') || '';
        return localStorage.getItem('lx8_last_punchlist') || '';
      } catch (e) { return ''; }
    }
    function setLastPunchlistName(name) {
      if (!name) return;
      try {
        if (typeof lsWrite === 'function') lsWrite('lx8_last_punchlist', name);
        else localStorage.setItem('lx8_last_punchlist', name);
      } catch (e) {}
      try { window.__lastPunchlistName = name; } catch (e) {}
    }
    window.setLastPunchlistName = setLastPunchlistName;
    window.getLastPunchlistName = getLastPunchlistName;

    async function openPunchlistRecentList() {
      closeSearch();
      showScreen('screenPunchlistList');
      setHeader('Punchlist');
      if (typeof refreshPunchlistHome === 'function') await refreshPunchlistHome();
    }

    async function resumeLastPunchlistOrList() {
      closeSearch();
      const last = (getLastPunchlistName() || '').trim();
      if (last && typeof window.openPunchlistByName === 'function') {
        try {
          const rows = typeof window.getPunchlistSummaries === 'function'
            ? await window.getPunchlistSummaries()
            : [];
          const match = rows.find(r => r.name === last);
          // Resume when the list exists and is "in progress":
          // empty (ready to capture) or has open items. If fully complete, show All lists.
          if (match) {
            const open = (match.total || 0) - (match.complete || 0);
            const inProgress = match.total === 0 || open > 0;
            if (inProgress) {
              await window.openPunchlistByName(last);
              showScreen('screenPunchlist');
              setHeader('Punchlist');
              if (typeof window.renderList === 'function') window.renderList();
              return;
            }
          }
        } catch (e) {
          console.warn(e);
        }
      }
      await openPunchlistRecentList();
    }

    document.getElementById('homeTilePunchlist').addEventListener('click', () => {
      resumeLastPunchlistOrList();
    });

    const btnHeaderPunchlist = document.getElementById('btnHeaderPunchlist');
    if (btnHeaderPunchlist) btnHeaderPunchlist.addEventListener('click', () => {
      openPunchlistRecentList();
    });
    const btnPunchlistAllLists = document.getElementById('btnPunchlistAllLists');
    if (btnPunchlistAllLists) btnPunchlistAllLists.addEventListener('click', () => {
      openPunchlistRecentList();
    });
    document.getElementById('homeTileJobs').addEventListener('click', () => {
      closeSearch();
      showScreen('screenJobsList');
      setHeader('Jobs');
      refreshJobsList();
    });
    document.getElementById('btnCancelJob').addEventListener('click', () => {
      editingJobId = null;
      document.getElementById('btnDeleteJob').classList.add('hidden');
      if (detailJobId && loadJobs().some(j => j.id === detailJobId)) {
        showScreen('screenJobDetail');
        setHeader('Job');
        refreshJobDetail();
      } else {
        showScreen('screenJobsList');
        setHeader('Jobs');
        refreshJobsList();
      }
    });
    document.getElementById('btnEditJobDetail').addEventListener('click', () => {
      if (detailJobId) openJob(detailJobId);
    });
    document.getElementById('btnJobStartInspection').addEventListener('click', () => startInspectionForDetailJob());
    document.getElementById('btnJobOpenPunchlist').addEventListener('click', () => startPunchlistForDetailJob());

    const btnJobMachinePopup = document.getElementById('btnJobMachinePopup');
    if (btnJobMachinePopup) btnJobMachinePopup.addEventListener('click', () => {
      machineModalMode = 'job';
      openMachineModal();
    });
    const jobDatesCancel = document.getElementById('jobDatesCancel');
    if (jobDatesCancel) jobDatesCancel.addEventListener('click', closeHomeJobDatesEditor);
    const jobDatesSave = document.getElementById('jobDatesSave');
    if (jobDatesSave) jobDatesSave.addEventListener('click', saveHomeJobDates);
    const jobDatesModal = document.getElementById('jobDatesModal');
    if (jobDatesModal) jobDatesModal.addEventListener('click', (e) => {
      if (e.target.id === 'jobDatesModal') closeHomeJobDatesEditor();
    });
    const machineCancel = document.getElementById('machineModalCancel');
    if (machineCancel) machineCancel.addEventListener('click', () => {
      machineModalMode = 'job';
      closeMachineModal();
    });
    const machineDone = document.getElementById('machineModalDone');
    if (machineDone) machineDone.addEventListener('click', () => {
      if (machineModalMode === 'startInspect') {
        startInspectionFromMachinePopup();
        return;
      }
      closeMachineModal();
    });
    const machineModal = document.getElementById('machineModal');
    if (machineModal) machineModal.addEventListener('click', (e) => {
      if (e.target.id === 'machineModal') closeMachineModal();
    });
    const addSerialBtn = document.getElementById('btnAddJobSerial');
    if (addSerialBtn) addSerialBtn.addEventListener('click', addJobSerialFromInput);
    const serialInp = document.getElementById('jobSerialInput');
    if (serialInp) serialInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addJobSerialFromInput(); }
    });
    const jobSerialSel = document.getElementById('inspectSerialSelect');
    if (jobSerialSel) {
      jobSerialSel.addEventListener('change', () => {
        const custom = document.getElementById('inspectSerialInput');
        if (!custom) return;
        if (jobSerialSel.value === '__other') {
          custom.classList.remove('hidden');
          custom.focus();
        } else {
          custom.classList.add('hidden');
          custom.value = '';
        }
        updateJobMachineSummary();
      });
    }
    const inspectMachineSel = document.getElementById('inspectMachine');
    if (inspectMachineSel) {
      inspectMachineSel.addEventListener('change', () => {
        const custom = document.getElementById('inspectMachineCustom');
        if (!custom) return;
        if (inspectMachineSel.value === '__other') {
          custom.classList.remove('hidden');
          custom.focus();
        } else {
          custom.classList.add('hidden');
          custom.value = '';
        }
      });
    }
    const jobMachineSel = document.getElementById('jobMachine');
    if (jobMachineSel) {
      jobMachineSel.addEventListener('change', () => {
        const custom = document.getElementById('jobMachineCustom');
        if (!custom) return;
        if (jobMachineSel.value === '__other') {
          custom.classList.remove('hidden');
          custom.focus();
        } else {
          custom.classList.add('hidden');
          custom.value = '';
        }
        updateJobMachineSummary();
      });
    }
    document.getElementById('btnSaveJob').addEventListener('click', () => saveJobFromForm());
    document.getElementById('btnDeleteJob').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteJobCurrent();
    });

    // ========== JOB LINKING (inspections + punchlist) ==========
    let pendingJobPickPurpose = null; // 'inspection' | 'punchlist'
    let linkedJobIdForStart = null;

    function jobDisplayName(job) {
      if (!job) return 'Job';
      const site = (job.site || '').trim();
      return site ? (job.customer || 'Job') + ' – ' + site : (job.customer || 'Job');
    }

    function jobSubLine(job) {
      if (!job) return '';
      const parts = [];
      if (job.technician) parts.push(job.technician);
      const range = formatJobDateRange(job);
      if (range) parts.push(range);
      if (job.status) parts.push(job.status);
      return parts.join(' · ');
    }

    function punchlistKeyForJob(job) {
      return jobDisplayName(job);
    }

    function ensurePunchlistBucketForJob(job) {
      if (!job) return;
      if (!data) data = { jobs: {}, currentJob: '' };
      if (!data.jobs) data.jobs = {};
      const key = punchlistKeyForJob(job);
      if (!data.jobs[key]) data.jobs[key] = [];
      data.currentJob = key;
      if (!data.jobIdByKey) data.jobIdByKey = {};
      data.jobIdByKey[key] = job.id;
      if (!data.keyByJobId) data.keyByJobId = {};
      data.keyByJobId[job.id] = key;
      if (typeof plSaveData === 'function') plSaveData();
      if (typeof populateJobSelect === 'function') populateJobSelect();
      return key;
    }

    function closeJobPicker() {
      pendingJobPickPurpose = null;
      const modal = document.getElementById('jobPickerModal');
      if (!modal) return;
      modal.classList.add('hidden');
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
    }

    function openJobPicker(purpose) {
      const jobs = (typeof loadJobs === 'function' ? loadJobs() : []) || [];
      pendingJobPickPurpose = purpose;
      const modal = document.getElementById('jobPickerModal');
      const listEl = document.getElementById('jobPickerList');
      const title = document.getElementById('jobPickerTitle');
      if (!modal || !listEl) return;

      title.textContent = purpose === 'punchlist' ? 'Select Job for Punchlist' : 'Select Job for Inspection';

      const skipLabel = purpose === 'punchlist' ? 'Continue without a job' : 'Continue without a job';
      const skipSub = purpose === 'punchlist'
        ? 'Start a punchlist not linked to a job'
        : 'Enter customer details manually';
      let html = '';
      if (!jobs.length) {
        html += `<div class="job-picker-empty">No jobs yet.<br>You can continue without one, or create a job first.</div>`;
      } else {
        const sorted = jobs.slice().sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')));
        html += sorted.map(job => {
          const sub = jobSubLine(job);
          return `<button type="button" class="job-picker-item" data-job-id="${jobEsc(job.id)}">
            <span class="jp-title">${jobEsc(jobDisplayName(job))}</span>
            ${sub ? `<span class="jp-sub">${jobEsc(sub)}</span>` : ''}
          </button>`;
        }).join('');
      }
      html += `<button type="button" class="job-picker-item job-picker-skip" data-job-id="__none__">
        <span class="jp-title">${skipLabel}</span>
        <span class="jp-sub">${skipSub}</span>
      </button>`;
      listEl.innerHTML = html;
      listEl.querySelectorAll('[data-job-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-job-id');
          onJobPicked(id);
        });
      });

      modal.classList.remove('hidden');
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
    }

    function applyJobToInspectionForm(job) {
      linkedJobIdForStart = job ? job.id : null;
      const group = document.getElementById('jobLinkGroup');
      const chip = document.getElementById('jobLinkChip');
      if (job) {
        if (group) group.classList.remove('hidden');
        if (chip) {
          const sub = jobSubLine(job);
          chip.innerHTML = jobEsc(jobDisplayName(job)) + (sub ? `<span class="jl-sub">${jobEsc(sub)}</span>` : '');
        }
        document.getElementById('inpCustomer').value = job.customer || '';
        document.getElementById('inpTechnician').value = job.technician || '';
        document.getElementById('inpDate').value = job.date || new Date().toISOString().slice(0, 10);
        document.getElementById('inpPO').value = job.po || '';
        // Prefer site as a helpful default for serial/location context only if serial empty
        if (job.site && !document.getElementById('inpSerial').value) {
          document.getElementById('inpSerial').placeholder = job.site;
        }
      } else {
        linkedJobIdForStart = null;
        if (group) group.classList.add('hidden');
        if (chip) chip.textContent = '—';
      }
    }

    async function onJobPicked(jobId) {
      const purpose = pendingJobPickPurpose;
      const skip = !jobId || jobId === '__none__';
      const job = skip ? null : loadJobs().find(j => j.id === jobId);
      if (!skip && !job) {
        toast('Job not found');
        closeJobPicker();
        return;
      }
      closeJobPicker();

      if (purpose === 'inspection') {
        currentInspection = null;
        editingInspectionId = null;
        results = {};
        findings = [];
        currentSectionIndex = 0;
        document.getElementById('btnBeginInspection').textContent = 'Begin Inspection';
        document.getElementById('btnDeleteInspection').classList.add('hidden');

        // Linked job: start inspection immediately (edit details later from card)
        if (job) {
          const model = 'LX-8';
          setActiveMachine(model);
          currentInspection = {
            id: 'ins_' + Date.now(),
            customer: job.customer || '',
            model,
            serial: (job.site || '').trim() || 'TBD',
            technician: job.technician || '',
            date: job.date || new Date().toISOString().slice(0, 10),
            po: job.po || '',
            jobId: job.id,
            status: 'Draft',
            results: {},
            findings: [],
            currentSectionIndex: 0,
            createdAt: new Date().toISOString()
          };
          linkedJobIdForStart = null;
          saveCurrentDraft();
          renderSection();
          showScreen('screenInspect');
          setHeader('Inspecting');
          toast('Inspection started — ' + jobDisplayName(job));
          return;
        }

        // No job: show manual start form
        initStartForm();
        applyJobToInspectionForm(null);
        document.getElementById('exampleInspectCard').classList.remove('hidden');
        showScreen('screenStart');
        setHeader('New Inspection');
        return;
      }

      if (purpose === 'punchlist') {
        try {
          if (typeof window.openPunchlistForJob !== 'function') {
            toast('Punchlist not ready');
            return;
          }
          const label = await window.openPunchlistForJob(job || null);
          showScreen('screenPunchlist');
          setHeader('Punchlist');
          if (typeof window.renderList === 'function') window.renderList();
          toast(job ? ('Punchlist: ' + jobDisplayName(job)) : 'Punchlist (no job)');
        } catch (err) {
          console.error(err);
          toast('Could not open punchlist');
        }
      }
    }

    document.getElementById('jobPickerCancel').addEventListener('click', () => closeJobPicker());
    document.getElementById('jobPickerGoJobs').addEventListener('click', () => {
      closeJobPicker();
      showScreen('screenJobsList');
      setHeader('Jobs');
      if (typeof refreshJobsList === 'function') refreshJobsList();
    });

    document.getElementById('jobPickerModal').addEventListener('click', (e) => {
      if (e.target.id === 'jobPickerModal') closeJobPicker();
    });


    const btnBackupZip = document.getElementById('btnBackupZip');
    const btnRestoreZip = document.getElementById('btnRestoreZip');
    const restoreZipInput = document.getElementById('restoreZipInput');
    if (btnBackupZip) btnBackupZip.addEventListener('click', () => exportBackupZip());
    if (btnRestoreZip) btnRestoreZip.addEventListener('click', () => restoreZipInput && restoreZipInput.click());
    if (restoreZipInput) restoreZipInput.addEventListener('change', ev => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (file) importBackupZip(file);
    });

    function getActiveCurrentJob() {
      const list = (typeof getCurrentJobs === 'function') ? getCurrentJobs() : [];
      return (list && list[0]) || null;
    }
    function startInspectionForJob(job) {
      currentInspection = null;
      editingInspectionId = null;
      results = {};
      findings = [];
      currentSectionIndex = 0;
      const beginBtn = document.getElementById('btnBeginInspection');
      if (beginBtn) beginBtn.textContent = 'Begin Inspection';
      const delBtn = document.getElementById('btnDeleteInspection');
      if (delBtn) delBtn.classList.add('hidden');
      if (job) {
        const model = job.machine || 'LX-8';
        setActiveMachine(model);
        currentInspection = {
          id: 'ins_' + Date.now(),
          customer: job.customer || '',
          model,
          serial: (job.serials && job.serials[0]) || (job.site || '').trim() || 'TBD',
          technician: job.technician || '',
          date: job.date || new Date().toISOString().slice(0, 10),
          po: job.po || job.salesOrder || '',
          jobId: job.id,
          status: 'Draft',
          results: {},
          findings: [],
          currentSectionIndex: 0,
          createdAt: new Date().toISOString()
        };
        linkedJobIdForStart = null;
        saveCurrentDraft();
        renderSection();
        showScreen('screenInspect');
        setHeader('Inspecting');
        toast('Inspection started — ' + jobDisplayName(job));
        return;
      }
      initStartForm();
      applyJobToInspectionForm(null);
      const ex = document.getElementById('exampleInspectCard');
      if (ex) ex.classList.remove('hidden');
      showScreen('screenStart');
      setHeader('New Inspection');
    }
    async function startPunchlistForCurrentJob(job) {
      try {
        if (typeof window.openPunchlistForJob !== 'function') {
          toast('Punchlist not ready');
          return;
        }
        const label = await window.openPunchlistForJob(job || null);
        showScreen('screenPunchlist');
        setHeader('Punchlist');
        if (typeof window.renderList === 'function') window.renderList();
        toast(job ? ('Punchlist: ' + jobDisplayName(job)) : 'Punchlist (no job)');
      } catch (err) {
        console.error(err);
        toast('Could not open punchlist');
      }
    }
    document.getElementById('btnNewInspection').addEventListener('click', () => {
      closeSearch();
      startInspectionForJob(getActiveCurrentJob());
    });
    document.getElementById('btnNewPunchlist').addEventListener('click', () => {
      closeSearch();
      startPunchlistForCurrentJob(getActiveCurrentJob());
    });


    document.getElementById('btnCancelStart').addEventListener('click', () => {
      editingInspectionId = null;
      document.getElementById('btnBeginInspection').textContent = 'Begin Inspection';
      document.getElementById('btnDeleteInspection').classList.add('hidden');
      showScreen('screenInspectList');
      setHeader('Inspections');
      refreshHome();
    });

    document.getElementById('btnBeginInspection').addEventListener('click', () => {
      const customer = document.getElementById('inpCustomer').value.trim();
      const serial = document.getElementById('inpSerial').value.trim();
      const tech = document.getElementById('inpTechnician').value.trim();
      if (!customer || !serial || !tech) {
        toast('Please fill Customer, Serial # and Technician');
        return;
      }
      if (linkedJobIdForStart) rememberJobSerial(linkedJobIdForStart, serial);
      const model = document.getElementById('inpModel').value.trim() || 'LX-8';
      setActiveMachine(model);
      const date = document.getElementById('inpDate').value;
      const po = document.getElementById('inpPO').value.trim();

      // Edit existing inspection metadata
      if (editingInspectionId) {
        const list = loadInspections();
        const idx = list.findIndex(i => i.id === editingInspectionId);
        if (idx < 0) {
          toast('Inspection not found');
          return;
        }
        list[idx].customer = customer;
        list[idx].model = model;
        list[idx].serial = serial;
        list[idx].technician = tech;
        list[idx].date = date;
        list[idx].po = po;
        if (linkedJobIdForStart) list[idx].jobId = linkedJobIdForStart;
        list[idx].updatedAt = new Date().toISOString();
        saveInspections(list);
        currentInspection = list[idx];
        editingInspectionId = null;
        document.getElementById('btnBeginInspection').textContent = 'Begin Inspection';
        document.getElementById('btnDeleteInspection').classList.add('hidden');
        toast('Inspection details updated');
        showScreen('screenInspectList');
        setHeader('Inspections');
        refreshHome();
        return;
      }

      // Create new inspection
      currentInspection = {
        id: 'ins_' + Date.now(),
        customer,
        model,
        serial,
        technician: tech,
        date,
        po,
        jobId: linkedJobIdForStart || null,
        status: 'Draft',
        results: {},
        findings: [],
        currentSectionIndex: 0,
        createdAt: new Date().toISOString()
      };
      linkedJobIdForStart = null;
      results = {};
      findings = [];
      currentSectionIndex = 0;
      saveCurrentDraft();
      renderSection();
      showScreen('screenInspect');
      setHeader('Inspecting');
      toast('Inspection started');
    });

    // ========== INSPECTION ==========
    function getItemsForSection(sectionId) {
      const items = (APP_DATA && APP_DATA.items) || [];
      return items
        .filter(i => i.section_id === sectionId)
        .sort((a, b) => a.item_order_in_section - b.item_order_in_section);
    }

    function shortSectionName(name) {
      // Keep names readable but compact for the horizontal scroller
      const map = {
        'Spread Conveyor': 'Spread Conv.',
        'Accumulating Conveyor': 'Accum. Conv.',
        'Grouper Section': 'Grouper',
        'Slicing Conveyor': 'Slicing Conv.',
        'Band Slicer': 'Band Slicer',
        'Hinge Slicer': 'Hinge Slicer',
        'Bottom Slicer': 'Bottom Slicer',
        'Top Slicer': 'Top Slicer',
        'Cross-Over Conveyor': 'Cross-Over',
        'Bagger': 'Bagger',
        'Over Head Paddle Conveyor': 'Paddle Conv.',
        'Tying Conveyor': 'Tying Conv.'
      };
      return map[name] || name;
    }

    function renderSectionDots(scrollToCurrent) {
      const container = document.getElementById('sectionDots');
      if (!container || !APP_DATA || !APP_DATA.sections) return;
      const inspectCurrent = extraSectionTab == null;
      let html = APP_DATA.sections.map((s, idx) => {
        let cls = 'section-dot';
        if (idx < currentSectionIndex) cls += ' done';
        if (inspectCurrent && idx === currentSectionIndex) cls += ' current';
        const sectionItems = getItemsForSection(s.section_id);
        const hasFinding = sectionItems.some(it => {
          const r = results[it.item_id];
          return r && isBadResult(it, r.condition);
        });
        if (hasFinding) cls += ' has-findings';
        const label = shortSectionName(s.section);
        return `<div class="${cls}" data-idx="${idx}" title="${s.section}">${label}</div>`;
      }).join('');
      html += `<div class="section-dot${extraSectionTab === 'findings' ? ' current' : ''}" data-extra="findings">Findings</div>`;
      html += `<div class="section-dot${extraSectionTab === 'notes' ? ' current' : ''}" data-extra="notes">Notes</div>`;
      container.innerHTML = html;
      container.querySelectorAll('.section-dot').forEach(d => {
        d.addEventListener('click', () => {
          if (d.dataset.extra === 'findings') {
            extraSectionTab = 'findings';
            if (currentInspection) saveCurrentDraft();
            updateFindings();
            showFindings();
            return;
          }
          if (d.dataset.extra === 'notes') {
            extraSectionTab = 'notes';
            if (currentInspection) {
              saveCurrentDraft();
              if (!document.getElementById('summaryNotes').value && currentInspection.summaryNotes) {
                setNotesContent(currentInspection.summaryNotes);
              }
            }
            notesSource = 'inspection';
            showScreen('screenNotes');
            setHeader('Notes');
            return;
          }
          extraSectionTab = null;
          currentSectionIndex = parseInt(d.dataset.idx, 10);
          showScreen('screenInspect');
          renderSection(true);
        });
      });
      // Only auto-scroll the dots bar when changing sections intentionally
      if (scrollToCurrent) {
        const current = container.querySelector('.section-dot.current');
        if (current) current.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }

    function isBadResult(item, value) {
      if (!value) return false;
      const bad = (item.photo_required_if || '').toLowerCase();
      return value.toLowerCase() === bad ||
        (item.inspection_type === 'Condition' && (value === 'Poor' || value === 'Damaged')) ||
        (item.inspection_type === 'Functional' && value === 'Fail') ||
        (item.inspection_type === 'Measurement' && value === 'Out of Spec');
    }

    function isFairResult(value) {
      return value === 'Fair';
    }

    function showsFindingPanel(item, value) {
      return isBadResult(item, value) || isFairResult(value);
    }

    function choiceTone(value) {
      const v = (value || '').toLowerCase();
      if (v === 'n/a') return 'na';
      if (v === 'good' || v === 'pass' || v === 'within spec') return 'good';
      if (v === 'fair') return 'fair';
      if (v === 'poor' || v === 'fail' || v === 'out of spec' || v === 'damaged') return 'bad';
      return '';
    }

    function renderSection(isSectionChange) {
      if (!APP_DATA || !APP_DATA.sections || !APP_DATA.sections.length) {
        toast('Inspection data not loaded');
        return;
      }
      if (currentSectionIndex < 0) currentSectionIndex = 0;
      if (currentSectionIndex >= APP_DATA.sections.length) {
        currentSectionIndex = APP_DATA.sections.length - 1;
      }
      const section = APP_DATA.sections[currentSectionIndex];
      if (!section) return;
      document.getElementById('sectionCounter').textContent = `Section ${currentSectionIndex + 1} of ${APP_DATA.sections.length}`;
      document.getElementById('sectionName').textContent = section.section;
      renderSectionDots(!!isSectionChange);

      const items = getItemsForSection(section.section_id);
      const answered = items.filter(i => results[i.item_id]?.condition).length;
      document.getElementById('itemProgress').textContent = `${answered} / ${items.length}`;

      const container = document.getElementById('itemsContainer');
      container.innerHTML = items.map(item => {
        const res = results[item.item_id] || {};
        const isAnswered = !!res.condition;
        const isFinding = isBadResult(item, res.condition);
        const isFair = isFairResult(res.condition);
        let cardClass = 'item-card';
        if (isFinding) cardClass += ' finding';
        else if (isFair) cardClass += ' fair';
        else if (res.condition === 'N/A') cardClass += ' na';
        else if (isAnswered) cardClass += ' answered';

        const choices = (item.choices || '').split('|').filter(Boolean);
        const choiceHtml = choices.map(c => {
          const sel = res.condition === c ? 'selected' : '';
          return `<button class="choice-btn ${choiceTone(c)} ${sel}" data-item="${item.item_id}" data-value="${c}">${c}</button>`;
        }).join('');

        let findingHtml = '';
        if (showsFindingPanel(item, res.condition)) {
          const impacts = res.impacts || [];
          const impactBtns = (APP_DATA.lists.impact || ['Downtime','Performance','Safety']).map(imp => {
            const sel = impacts.includes(imp) ? 'selected' : '';
            return `<span class="impact-tag ${sel}" data-item="${item.item_id}" data-impact="${imp}">${imp}</span>`;
          }).join('');
          const sevs = APP_DATA.lists.severity || ['1 - Monitor','2 - Repair','3 - Critical'];
          const curSev = res.severity ? String(res.severity) : '';
          const sevOpts = ['<option value=""' + (curSev ? '' : ' selected') + '>Select</option>'].concat(sevs.map(s => {
            const val = s.charAt(0);
            const selected = curSev === val ? 'selected' : '';
            return `<option value="${val}" ${selected}>${s}</option>`;
          })).join('');

          findingHtml = `
            <div class="finding-panel show">
              <div class="finding-heading"><span class="ico">${ICO.warn}</span>Finding Details</div>
              <div class="form-group" style="margin-bottom:8px">
                <label>Impact</label>
                <div class="impact-tags">${impactBtns}</div>
              </div>
              <div class="form-group severity-select">
                <label>Severity</label>
                <select class="sev-select" data-item="${item.item_id}">${sevOpts}</select>
              </div>
              <div class="form-group">
                <label>Notes</label>
                <textarea class="notes-input" data-item="${item.item_id}" placeholder="Describe the issue...">${res.notes || ''}</textarea>
              </div>
              <div class="photo-area ${res.photoDataUrl ? 'has-photo' : ''}" data-item="${item.item_id}">
                ${res.photoDataUrl
                  ? `<img class="photo-preview" src="${res.photoDataUrl}" alt="Photo" /><br><button class="photo-btn" data-item="${item.item_id}">Change Photo</button>`
                  : `<div class="photo-needed"><span class="ico">${ICO.cam}</span>${isFinding ? 'Photo required' : 'Photo optional'}</div><button class="photo-btn" data-item="${item.item_id}"><span class="ico">${ICO.cam}</span>Take / Choose Photo</button>`
                }
                <input type="file" accept="image/*" class="photo-input hidden" data-item="${item.item_id}" />
              </div>
            </div>`;
        }

        return `
          <div class="${cardClass}" id="item-${item.item_id}">
            <div class="item-title">${item.inspection_item}</div>
            <div class="choice-grid">${choiceHtml}</div>
            ${findingHtml}
          </div>`;
      }).join('');

      // Bind choice buttons
      container.querySelectorAll('.choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const itemId = parseInt(btn.dataset.item);
          const value = btn.dataset.value;
          if (!results[itemId]) results[itemId] = {};
          results[itemId].condition = value;
          const item = APP_DATA.items.find(i => i.item_id === itemId);
          if (!showsFindingPanel(item, value)) {
            delete results[itemId].impacts;
            delete results[itemId].notes;
            delete results[itemId].photoDataUrl;
            delete results[itemId].severity;
          }
          updateFindings();
          saveCurrentDraft();
          // Preserve scroll position when re-rendering
          const scrollY = window.scrollY || window.pageYOffset;
          renderSection(false);
          // Restore after layout (double rAF is more reliable on mobile)
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.scrollTo(0, scrollY);
            });
          });
        });
      });

      // Bind impact tags
      container.querySelectorAll('.impact-tag').forEach(tag => {
        tag.addEventListener('click', () => {
          const itemId = parseInt(tag.dataset.item, 10);
          const impact = tag.dataset.impact;
          if (!results[itemId]) results[itemId] = {};
          if (!results[itemId].impacts) results[itemId].impacts = [];
          const idx = results[itemId].impacts.indexOf(impact);
          if (idx >= 0) results[itemId].impacts.splice(idx, 1);
          else results[itemId].impacts.push(impact);
          updateFindings();
          saveCurrentDraft();
          tag.classList.toggle('selected');
        });
      });

      // Bind severity
      container.querySelectorAll('.sev-select').forEach(sel => {
        sel.addEventListener('change', () => {
          const itemId = parseInt(sel.dataset.item, 10);
          if (!results[itemId]) results[itemId] = {};
          results[itemId].severity = sel.value ? parseInt(sel.value, 10) : '';
          updateFindings();
          saveCurrentDraft();
        });
      });

      // Bind notes
      container.querySelectorAll('.notes-input').forEach(ta => {
        ta.addEventListener('input', () => {
          const itemId = parseInt(ta.dataset.item, 10);
          if (!results[itemId]) results[itemId] = {};
          results[itemId].notes = ta.value;
          updateFindings();
          saveCurrentDraft();
        });
      });

      // Bind photo
      container.querySelectorAll('.photo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const itemId = btn.dataset.item;
          const input = container.querySelector(`.photo-input[data-item="${itemId}"]`);
          if (input) input.click();
        });
      });
      container.querySelectorAll('.photo-input').forEach(inp => {
        inp.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          if (!file.type || !file.type.startsWith('image/')) {
            toast('Please choose an image');
            return;
          }
          const itemId = parseInt(inp.dataset.item, 10);
          if (!results[itemId]) results[itemId] = {};
          (async () => {
            try {
              const blob = await compressImageFile(file, 1600, 0.72);
              const id = 'ins_' + ((currentInspection && currentInspection.id) || 'draft') + '_' + itemId + '_' + Date.now();
              await idbPutPhoto({ id, blob: blob || file, caption: '', createdAt: Date.now() });
              results[itemId].photoId = id;
              results[itemId].photoDataUrl = blobToObjectUrl(blob || file);
            } catch (err) {
              const reader = new FileReader();
              await new Promise((resolve, reject) => {
                reader.onload = resolve;
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              results[itemId].photoDataUrl = reader.result;
            }
            updateFindings();
            saveCurrentDraft();
            const scrollY = window.scrollY || window.pageYOffset;
            renderSection(false);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                window.scrollTo(0, scrollY);
              });
            });
            toast('Photo attached');
          })();
        });
      });

      // Update next button text
      const isLast = currentSectionIndex === APP_DATA.sections.length - 1;
      document.getElementById('btnNextSection').textContent = isLast ? 'Findings →' : 'Next →';
      document.getElementById('btnPrevSection').style.visibility = currentSectionIndex === 0 ? 'hidden' : 'visible';
    }

    function updateFindings() {
      findings = [];
      if (!APP_DATA || !APP_DATA.items) return;
      Object.keys(results).forEach(idStr => {
        const itemId = parseInt(idStr, 10);
        const item = APP_DATA.items.find(i => i.item_id === itemId);
        if (!item) return;
        const r = results[itemId];
        if (!r) return;
        if (showsFindingPanel(item, r.condition)) {
          findings.push({
            item_id: itemId,
            section: item.section,
            item_name: item.inspection_item,
            condition: r.condition,
            severity: r.severity ? Math.min(parseInt(r.severity, 10) || 0, 3) : '',
            impacts: r.impacts || [],
            notes: r.notes || '',
            photoDataUrl: r.photoDataUrl || null,
            ai_category: item.ai_finding_category,
            status: 'Open'
          });
        }
      });
    }

    document.getElementById('btnNextSection').addEventListener('click', () => {
      if (!APP_DATA || !APP_DATA.sections) return;
      if (currentSectionIndex < APP_DATA.sections.length - 1) {
        currentSectionIndex++;
        saveCurrentDraft();
        renderSection(true);
        window.scrollTo(0, 0);
      } else {
        updateFindings();
        saveCurrentDraft();
        showFindings();
      }
    });

    document.getElementById('btnPrevSection').addEventListener('click', () => {
      if (currentSectionIndex > 0) {
        currentSectionIndex--;
        saveCurrentDraft();
        renderSection(true);
        window.scrollTo(0, 0);
      }
    });

    // ========== SUMMARY ==========
    function collectCoverCards() {
      const cards = [];
      for (let n = 1; n <= 3; n++) {
        const tag = (document.getElementById('cover' + n + 'tag') || {}).value || '';
        const title = (document.getElementById('cover' + n + 'title') || {}).value || '';
        const body = (document.getElementById('cover' + n + 'body') || {}).value || '';
        if (title.trim() || body.trim()) cards.push({ tag: tag.trim(), title: title.trim(), body: body.trim() });
      }
      return cards;
    }
    function saveCoverCards() {
      if (!currentInspection) return;
      currentInspection.coverCards = collectCoverCards();
      currentInspection.summaryNotes = (document.getElementById('summaryNotes') || {}).value || '';
      currentInspection.overallCondition = (document.getElementById('overallCondition') || {}).value || '';
    }
    function fillCoverCards(list) {
      for (let n = 1; n <= 3; n++) {
        const c = (list || [])[n - 1] || {};
        const tag = document.getElementById('cover' + n + 'tag');
        const title = document.getElementById('cover' + n + 'title');
        const body = document.getElementById('cover' + n + 'body');
        if (tag) tag.value = c.tag || '';
        if (title) title.value = c.title || '';
        if (body) body.value = c.body || '';
      }
    }

    function showFindings() {
      if (!currentInspection) {
        toast('No active inspection');
        showScreen('screenHome');
        return;
      }
      updateFindings();
      const totalAnswered = Object.keys(results).length;
      document.getElementById('sumTotalItems').textContent = totalAnswered;
      document.getElementById('sumFindings').textContent = findings.length;

      document.getElementById('summaryMeta').innerHTML = `
        <div class="review-customer">${currentInspection.customer || 'Inspection'}</div>
        <div class="review-line">${currentInspection.model || ''} · S/N ${currentInspection.serial || ''}</div>
        <div class="review-line">${currentInspection.technician || ''} · ${currentInspection.date || ''}${currentInspection.po ? ' · PO ' + currentInspection.po : ''}</div>
      `;

      if (currentInspection.summaryNotes && !document.getElementById('summaryNotes').value) {
        setNotesContent(currentInspection.summaryNotes);
      }
      if (currentInspection.overallCondition) {
        document.getElementById('overallCondition').value = currentInspection.overallCondition;
      }
      fillCoverCards(currentInspection.coverCards);

      const listEl = document.getElementById('findingsList');
      if (findings.length === 0) {
        listEl.innerHTML = `<div class="empty-state" style="padding:20px"><div class="icon">${ICO.check}</div><p>No findings.<br>All items passed.</p></div>`;
      } else {
        const sevNames = { 1: 'Monitor', 2: 'Repair', 3: 'Critical' };
        listEl.innerHTML = findings
          .sort((a, b) => (parseInt(b.severity, 10) || 0) - (parseInt(a.severity, 10) || 0))
          .map(f => {
            let sev = parseInt(f.severity, 10) || 0;
            if (sev > 3) sev = 3;
            const isFair = f.condition === 'Fair';
            const high = !isFair && (sev >= 3 || f.condition === 'Poor' || f.condition === 'Fail' || f.condition === 'Out of Spec' || f.condition === 'Damaged');
            const sevLabel = sevNames[sev] || '';
            const cardTone = high ? ' sev-high' : (isFair ? ' sev-fair' : '');
            const pill = sevLabel
              ? `<span class="badge badge-sev ${high ? 'badge-findings' : 'badge-draft'}">${sevLabel}</span>`
              : '';
            const src = f.photoDataUrl || (results[f.item_id] && results[f.item_id].photoDataUrl);
            return `
            <div class="finding-summary-card${cardTone}">
              <div class="finding-summary-top">
                <div>
                  <div class="finding-name">${f.item_name}</div>
                  <div class="finding-section">${f.section}</div>
                </div>
                ${pill}
              </div>
              <div class="finding-meta">${f.condition}${f.impacts.length ? ' · ' + f.impacts.join(', ') : ''}</div>
              ${f.notes ? `<div class="finding-notes">${f.notes}</div>` : ''}
              ${src ? `<img src="${src}" class="photo-preview" style="margin-top:8px" />` : ''}
            </div>`;
          }).join('');
      }

      showScreen('screenFindings');
      setHeader('Findings');
    }

    function renderInspectPreview() {
      saveCoverCards();
      updateFindings();
      const items = (APP_DATA && APP_DATA.items) || [];
      let nGood = 0, nFair = 0, nPoor = 0, nAns = 0;
      items.forEach(it => {
        const c = String((results[it.item_id] && results[it.item_id].condition) || '').toLowerCase();
        if (!c) return;
        nAns++;
        if (c === 'poor' || c === 'fail' || c === 'out of spec') nPoor++;
        else if (c === 'fair') nFair++;
        else if (c !== 'n/a') nGood++;
      });
      const photos = [];
      findings.forEach(f => {
        const r = results[f.item_id] || {};
        const src = f.photoDataUrl || r.photoDataUrl;
        if (src) photos.push({ src, cap: f.item_name || '', notes: f.notes || '' });
      });
      const logo = (document.querySelector('.header-logo-img') || {}).src || '';
      const esc = s => String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
      const cards = collectCoverCards();
      const feat = photos.slice(0, 2).map(p =>
        `<div><img src="${p.src}" alt=""><p>${esc(p.cap)}${p.notes ? ' · ' + esc(p.notes) : ''}</p></div>`
      ).join('');
      const moves = cards.map(c => `
        <div class="move">
          <div class="t">${esc(c.tag || 'REPAIR')}</div>
          <b>${esc(c.title)}</b>
          <div>${esc(c.body)}</div>
        </div>`).join('');
      document.getElementById('irPreviewSheet').innerHTML = `
        <div class="hero">
          <div class="k">FIELD SERVICE TRIP REPORT</div>
          <div class="visit-logo-pill">${logo ? `<img src="${logo}" alt="LeMatic">` : ''}</div>
          <h2>${esc(currentInspection.customer || 'Inspection')}</h2>
          <div class="s">${esc(currentInspection.model || '')}${currentInspection.serial ? ' · S/N ' + esc(currentInspection.serial) : ''}</div>
          <div class="s">${esc(currentInspection.technician || '')}${currentInspection.date ? ' · ' + esc(currentInspection.date) : ''}</div>
        </div>
        <div class="tiles">
          <div class="tile" style="background:#2a3036"><b>${nAns}</b><span>ITEMS CHECKED</span></div>
          <div class="tile" style="background:#c62828"><b>${nPoor}</b><span>POOR</span></div>
          <div class="tile" style="background:#b8860b"><b>${nFair}</b><span>FAIR</span></div>
          <div class="tile" style="background:#1f4e3a"><b>${nGood}</b><span>GOOD</span></div>
        </div>
        ${feat ? `<div class="feat">${feat}</div>` : ''}
        ${moves || '<div class="body">Add cover items on Review to show them here.</div>'}
        <div class="h">On site</div>
        <div class="body">${esc(getNotesPlain() || '—')}</div>
      `;
      showScreen('screenInspectPreview');
    }

    document.getElementById('btnFindingsBack').addEventListener('click', () => {
      renderSection();
      showScreen('screenInspect');
      setHeader('Inspecting');
    });
    document.getElementById('btnFindingsNext').addEventListener('click', () => {
      if (currentInspection && !document.getElementById('summaryNotes').value && currentInspection.summaryNotes) {
        setNotesContent(currentInspection.summaryNotes);
      }
      notesSource = 'inspection';
      showScreen('screenNotes');
    });
    function notesLooksHTML(s) {
      return /<(p|div|h1|h2|h3|ul|ol|li|b|i|u|strong|em|br|span)[>\s/]/i.test(s || '');
    }
    function syncNotesField() {
      const ed = document.getElementById('notesEditor');
      const ta = document.getElementById('summaryNotes');
      if (ed && ta) ta.value = ed.innerHTML === '<br>' ? '' : ed.innerHTML;
    }
    function setNotesContent(val) {
      const ed = document.getElementById('notesEditor');
      const ta = document.getElementById('summaryNotes');
      val = String(val || '').replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
      if (!ed || !ta) return;
      if (!val) {
        ed.innerHTML = '';
        ta.value = '';
        return;
      }
      if (notesLooksHTML(val)) ed.innerHTML = val;
      else ed.textContent = val;
      syncNotesField();
    }
    function getNotesPlain() {
      const ed = document.getElementById('notesEditor');
      if (!ed) return (document.getElementById('summaryNotes') || {}).value || '';
      const clone = ed.cloneNode(true);
      clone.querySelectorAll('li').forEach(li => { li.prepend('• '); });
      return String(clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    }
    function placeNotesFormatBar() {
      const bar = document.getElementById('notesFormatBar');
      if (!bar || !document.body.classList.contains('on-notes')) return;
      const vv = window.visualViewport;
      const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      const typing = kb > 80;
      document.body.classList.toggle('notes-typing', typing);
      const dock = document.getElementById('bottomBar');
      const dockUp = !typing && notesSource !== 'visit-letter' && dock && !dock.classList.contains('hidden');
      const dockH = dockUp ? dock.getBoundingClientRect().height : 0;
      bar.style.bottom = (kb + dockH + 10) + 'px';
    }
    function initNotesEditor() {
      const ed = document.getElementById('notesEditor');
      const bar = document.getElementById('notesFormatBar');
      if (!ed || !bar || bar.dataset.ready) return;
      bar.dataset.ready = '1';
      ed.addEventListener('input', syncNotesField);
      ed.addEventListener('focus', () => {
        document.body.classList.add('notes-focus');
        placeNotesFormatBar();
      });
      ed.addEventListener('blur', () => {
        setTimeout(() => {
          if (!bar.contains(document.activeElement)) document.body.classList.remove('notes-focus');
        }, 80);
      });
      bar.addEventListener('mousedown', (e) => e.preventDefault());
      bar.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        ed.focus();
        const cmd = btn.dataset.notesCmd;
        const block = btn.dataset.notesBlock;
        const size = btn.dataset.notesSize;
        if (cmd) document.execCommand(cmd, false, null);
        else if (block) document.execCommand('formatBlock', false, block);
        else if (size) document.execCommand('fontSize', false, size === 'inc' ? '5' : '2');
        syncNotesField();
      });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', placeNotesFormatBar);
        window.visualViewport.addEventListener('scroll', placeNotesFormatBar);
      }
      window.addEventListener('resize', placeNotesFormatBar);
    }

    function openFullNotes(source, value) {
      notesSource = source || 'inspection';
      setNotesContent(value || '');
      showScreen('screenNotes');
      setHeader(source === 'visit-letter' ? 'On Site' : 'Notes');
      initNotesEditor();
      requestAnimationFrame(() => {
        const ed = document.getElementById('notesEditor');
        if (ed) ed.focus();
        placeNotesFormatBar();
      });
    }
    function closeFullNotes() {
      syncNotesField();
      const html = (document.getElementById('summaryNotes') || {}).value || '';
      const plain = getNotesPlain();
      if (false) {
        vrWriteNotesBack();
        showTripSection(vrSection || 'site');
        setHeader('Trip Report');
        return;
      }
      if (currentInspection) currentInspection.summaryNotes = html;
      showFindings();
    }
    function leaveNotesToFindings() {
      closeFullNotes();
    }
    document.getElementById('btnNotesBack').addEventListener('click', leaveNotesToFindings);
    document.getElementById('btnHeaderBack').addEventListener('click', () => {
      if (document.body.classList.contains('on-notes')) closeFullNotes();
      if (document.body.classList.contains('on-settings')) {
        showScreen('screenHome');
        setHeader('LeMatic Inspection');
        refreshHome();
      }
    });
    document.getElementById('btnNotesNext').addEventListener('click', () => {
      if (false) {
        closeFullNotes();
        return;
      }
      if (currentInspection) {
        syncNotesField();
        currentInspection.summaryNotes = document.getElementById('summaryNotes').value;
      }
      renderInspectPreview();
    });

        document.getElementById('btnPreviewBack').addEventListener('click', () => {
      notesSource = 'inspection';
      showScreen('screenNotes');
    });
    function openSaveSheet() {
      const scrim = document.getElementById('saveSheetScrim');
      const sheet = document.getElementById('saveSheet');
      scrim.hidden = false;
      sheet.hidden = false;
      requestAnimationFrame(() => {
        scrim.classList.add('show');
        sheet.classList.add('show');
      });
    }
    function closeSaveSheet() {
      const scrim = document.getElementById('saveSheetScrim');
      const sheet = document.getElementById('saveSheet');
      scrim.classList.remove('show');
      sheet.classList.remove('show');
      setTimeout(() => {
        if (!sheet.classList.contains('show')) {
          scrim.hidden = true;
          sheet.hidden = true;
        }
      }, 380);
    }
    document.getElementById('btnSaveInspect').addEventListener('click', openSaveSheet);
    document.getElementById('saveSheetScrim').addEventListener('click', closeSaveSheet);
    document.getElementById('saveSheetCancel').addEventListener('click', closeSaveSheet);
    document.getElementById('saveSheetPdf').addEventListener('click', () => {
      closeSaveSheet();
      generatePDFReport();
    });
    document.getElementById('saveSheetDocx').addEventListener('click', () => {
      closeSaveSheet();
      generateWordReport();
    });
    document.getElementById('saveSheetXlsx').addEventListener('click', () => {
      closeSaveSheet();
      generateInspectionExcel().catch(err => {
        console.warn(err);
        toast('Could not build Excel file');
      });
    });
    document.getElementById('btnCompleteInspect').addEventListener('click', () => {
      if (!currentInspection) {
        toast('No active inspection');
        return;
      }
      syncNotesField();
      currentInspection.summaryNotes = (document.getElementById('summaryNotes') || {}).value || currentInspection.summaryNotes || '';
      updateFindings();
      currentInspection.findings = findings;
      currentInspection.results = results;
      currentInspection.status = 'Complete';
      currentInspection.updatedAt = new Date().toISOString();
      saveCurrentDraft();
      toast('Inspection completed');
      showScreen('screenInspectList');
      setHeader('Inspections');
      refreshHome();
    });


    // ========== PDF REPORT ==========
    function findRelatedVisit(ins) { return null; }
    const LEMATIC_LOGO_JPG = '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';
    function generatePDFReport() {
      if (!currentInspection) {
        toast('No inspection data');
        return;
      }
      if (typeof window.jspdf === 'undefined') {
        toast('PDF library still loading… try again in a moment');
        return;
      }

      updateFindings();

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const L = 14;
      const R = W - 14;
      const usable = R - L;
      const footerY = H - 10;
      let y = 20;

      const INK = [20, 20, 24];
      const MUTED = [92, 101, 112];
      const LINE = [228, 230, 234];
      const PAPER = [244, 245, 247];
      const RED = [212, 34, 59];
      const POORC = [198, 40, 40];
      const FAIRC = [184, 134, 11];
      const GOODC = [27, 122, 74];

      const customer = currentInspection.customer || 'Customer';
      const model = currentInspection.model || 'LX-8';
      const serial = currentInspection.serial || '';
      const tech = currentInspection.technician || '';
      const date = currentInspection.date || '';
      const notes = (getNotesPlain() || String(currentInspection.summaryNotes || '').replace(/<[^>]+>/g, ' ')).trim();
      let visit = findRelatedVisit(currentInspection);
      if (!visit) {
        try {
          const live = collectVisit();
          const same = String(live.customer || '').toLowerCase().trim() === String(currentInspection.customer || '').toLowerCase().trim();
          if (same && (live.summary || live.scopeText || live.arrival || (live.findings||[]).length || (live.parts||[]).length)) visit = live;
        } catch (e) {}
      }
      const combined = !!visit;

      function condOf(id) {
        return (results[id] && results[id].condition) || '';
      }
      let nGood = 0, nFair = 0, nPoor = 0, nNa = 0, nAns = 0;
      const items = (APP_DATA && APP_DATA.items) || [];
      items.forEach(it => {
        const c = String(condOf(it.item_id)).toLowerCase();
        if (!c) return;
        nAns++;
        if (c === 'poor' || c === 'fail' || c === 'out of spec') nPoor++;
        else if (c === 'fair') nFair++;
        else if (c === 'n/a') nNa++;
        else nGood++;
      });

      const photoFindings = [];
      findings.forEach(f => {
        const r = results[f.item_id] || f;
        const src = r.photoDataUrl || f.photoDataUrl;
        if (src) photoFindings.push({ src, cap: (f.item_name || '') + (f.notes ? '  ·  ' + f.notes : ''), finding: f });
      });

      function rankScore(f) {
        const im = (f.impacts || []).join(' ').toLowerCase();
        let s = 0;
        if (im.includes('safety')) s += 100;
        if (im.includes('downtime')) s += 50;
        if (im.includes('performance')) s += 20;
        const c = String(f.condition || '').toLowerCase();
        if (c === 'poor' || c === 'fail' || c === 'out of spec') s += 30;
        s += Number(f.severity || 0);
        return s;
      }
      const ranked = findings.slice().sort((a, b) => rankScore(b) - rankScore(a));
      const coverCards = (typeof collectCoverCards === "function" ? collectCoverCards() : []) || currentInspection.coverCards || [];
      const poorList = ranked.filter(f => {
        const c = String(f.condition || '').toLowerCase();
        return c === 'poor' || c === 'fail' || c === 'out of spec';
      });

      function runningHeader() {
        doc.setFillColor(20, 20, 24);
        doc.rect(0, 0, W, 10, 'F');
        doc.setFillColor(212, 34, 59);
        doc.rect(0, 0, 3.2, 10, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('LeMatic  ·  Field Service Report', 8, 6.6);
        doc.setFont('helvetica', 'normal');
        const right = (customer + (date ? '  ·  ' + date : (serial ? '  ·  ' + serial : ''))).substring(0, 48);
        doc.text(right, W - 8, 6.6, { align: 'right' });
      }
      function runningFooter() {
        const page = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFillColor(244, 245, 247);
        doc.rect(0, H - 12, W, 12, 'F');
        doc.setTextColor(92, 101, 112);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text(combined ? 'Visit report + inspection  ·  Customer copy' : 'Inspection checklist  ·  Customer copy', 8, H - 5);
        doc.text('Page ' + page, W - 8, H - 5, { align: 'right' });
      }
      function paintChrome() {
        runningHeader();
        runningFooter();
      }
      function newPage() {
        doc.addPage();
        paintChrome();
        y = 16;
      }
      function need(h) {
        if (y + h > H - 16) newPage();
      }
      function wrap(text, width, fontSize) {
        doc.setFontSize(fontSize || 9);
        return doc.splitTextToSize(String(text || ''), width);
      }

      paintChrome();
      y = 14;

      // Hero
      doc.setFillColor(20, 20, 24);
      doc.rect(L, y, usable, 36, 'F');
      doc.setTextColor(243, 179, 188);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text('FIELD SERVICE TRIP REPORT', L + 6, y + 8);
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text(customer, L + 6, y + 17);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(208, 213, 219);
      const line2 = [model, serial].filter(Boolean).join('  ·  ');
      const line3 = [date, tech].filter(Boolean).join('  ·  ');
      if (line2) doc.text(line2, L + 6, y + 24);
      if (line3) doc.text(line3, L + 6, y + 29.5);
      try {
        const lw = 34, lh = 11.5;
        const logoTop = y + 6;
        doc.setFillColor(255, 255, 255);
        doc.rect(R - 8 - lw, logoTop, lw, lh, 'F');
        doc.addImage('data:image/jpeg;base64,' + LEMATIC_LOGO_JPG, 'JPEG', R - 8 - lw + 1.1, logoTop + 0.9, lw - 2.2, lh - 1.8);
      } catch (e) {}
      y += 40;

      // Tiles
      const tiles = [
        [String(nAns || items.length), 'ITEMS CHECKED', [42, 48, 54]],
        [String(nPoor), 'POOR', [198, 40, 40]],
        [String(nFair), 'FAIR', [184, 134, 11]],
        [String(nGood), 'GOOD', [31, 78, 58]]
      ];
      const tw = (usable - 9) / 4;
      tiles.forEach((tile, i) => {
        const x = L + i * (tw + 3);
        doc.setFillColor(tile[2][0], tile[2][1], tile[2][2]);
        doc.rect(x, y, tw, 18, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text(tile[0], x + tw / 2, y + 9, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.text(tile[1], x + tw / 2, y + 15, { align: 'center' });
      });
      y += 22;

      // Impact graphics
      const impactCount = (name) => findings.filter(f =>
        (f.impacts || []).some(x => String(x).toLowerCase().includes(name))
      ).length;
      const nSafety = impactCount('safety');
      const nDown = impactCount('downtime') + impactCount('down-time');
      const nPerf = impactCount('performance');
      const impacts = [
        { n: nSafety, label: 'SAFETY', color: [198, 40, 40], icon: 'safety' },
        { n: nDown, label: 'DOWNTIME', color: [184, 134, 11], icon: 'down' },
        { n: nPerf, label: 'PERFORMANCE', color: [37, 99, 180], icon: 'perf' }
      ];
      doc.setTextColor(92, 101, 112);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text('IMPACT', L, y);
      y += 3;
      const iw = (usable - 6) / 3;
      impacts.forEach((imp, i) => {
        const x = L + i * (iw + 3);
        doc.setFillColor(248, 249, 251);
        doc.roundedRect(x, y, iw, 20, 1.2, 1.2, 'F');
        const cx = x + 10;
        const cy = y + 10;
        doc.setFillColor(imp.color[0], imp.color[1], imp.color[2]);
        if (imp.icon === 'safety') {
          doc.triangle(cx, cy - 5, cx - 5, cy + 4.2, cx + 5, cy + 4.2, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7);
          doc.text('!', cx, cy + 2.4, { align: 'center' });
        } else if (imp.icon === 'down') {
          doc.circle(cx, cy, 5.1, 'F');
          doc.setFillColor(248, 249, 251);
          doc.rect(cx - 1.8, cy - 2.6, 1.2, 5.2, 'F');
          doc.rect(cx + 0.6, cy - 2.6, 1.2, 5.2, 'F');
        } else {
          doc.rect(cx - 4.2, cy + 1.6, 2.2, 3.2, 'F');
          doc.rect(cx - 1.1, cy - 0.6, 2.2, 5.4, 'F');
          doc.rect(cx + 2.0, cy - 3.4, 2.2, 8.2, 'F');
        }
        doc.setTextColor(20, 20, 24);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text(String(imp.n), x + 20, y + 9);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.4);
        doc.setTextColor(92, 101, 112);
        doc.text(imp.label, x + 20, y + 15);
      });
      y += 24;

      // Featured photos
      const feat = photoFindings.slice(0, 2);
      if (feat.length) {
        const pw = (usable - 4) / 2;
        const ph = 42;
        feat.forEach((p, i) => {
          const x = L + i * (pw + 4);
          doc.setFillColor(244, 245, 247);
          doc.rect(x, y, pw, ph + 10, 'F');
          try {
            doc.addImage(p.src, 'JPEG', x + 1.5, y + 1.5, pw - 3, ph);
          } catch (e) {
            try { doc.addImage(p.src, 'PNG', x + 1.5, y + 1.5, pw - 3, ph); } catch (e2) {}
          }
          doc.setTextColor(92, 101, 112);
          doc.setFontSize(6.5);
          const cap = wrap(p.cap, pw - 4, 6.5);
          doc.text(cap.slice(0, 2), x + 2, y + ph + 5);
        });
        y += ph + 14;
      }

      // Three cover action cards
      if (coverCards.length) {
        const cw = (usable - 8) / 3;
        const ch = 28;
        coverCards.forEach((f, i) => {
          const x = L + i * (cw + 4);
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(228, 230, 234);
          doc.rect(x, y, cw, ch, 'FD');
          doc.setFillColor(198, 40, 40);
          doc.rect(x, y, 1.6, ch, 'F');
          const tag = (f.tag || f.condition || 'REPAIR').toUpperCase();
          doc.setTextColor(198, 40, 40);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.5);
          doc.text(String(tag).substring(0, 16), x + 4, y + 6);
          doc.setTextColor(20, 20, 24);
          doc.setFontSize(8);
          const title = wrap(f.title || f.item_name || '', cw - 7, 8);
          doc.text(title.slice(0, 2), x + 4, y + 12);
          doc.setTextColor(92, 101, 112);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.5);
          const body = wrap(f.body || f.notes || '', cw - 7, 6.5);
          doc.text(body.slice(0, 2), x + 4, y + 21);
        });
        y += 32;
      }

      doc.setTextColor(92, 101, 112);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('Primary findings, photos, and the full checklist start on the next page.', L, y);

      // On site / notes
      newPage();
      doc.setTextColor(212, 34, 59);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('ON SITE', L, y);
      y += 6;
      doc.setTextColor(20, 20, 24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('On site', L, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(92, 101, 112);
      doc.text([date, tech].filter(Boolean).join('  ·  ') || '', L, y);
      y += 8;
      if (notes) {
        doc.setTextColor(20, 20, 24);
        doc.setFontSize(9.5);
        const lines = wrap(notes, usable, 9.5);
        lines.forEach(line => {
          need(6);
          doc.text(line, L, y);
          y += 5;
        });
      } else {
        doc.setTextColor(92, 101, 112);
        doc.setFontSize(9);
        doc.text('No summary notes recorded for this inspection.', L, y);
        y += 8;
      }

      if (combined) {
        function writePara(titleKicker, title, body) {
          if (!body) return;
          need(20);
          doc.setTextColor(212, 34, 59);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.text(titleKicker, L, y);
          y += 6;
          doc.setTextColor(20, 20, 24);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(16);
          doc.text(title, L, y);
          y += 8;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9.5);
          String(body).split('\n').forEach(para => {
            if (!para.trim()) { y += 3; return; }
            wrap(para, usable, 9.5).forEach(line => {
              need(6);
              doc.text(line, L, y);
              y += 5;
            });
            y += 2;
          });
          y += 4;
        }
        newPage();
                const letter = visit.letter || visit.arrival || visitNarrative(visit);
        const done = visit.done || [visit.inspectIntro, tripPlainBlocks(visit.inspectBlocks), visit.prodIntro, tripPlainBlocks(visit.prodBlocks)].filter(Boolean).join('\n\n');
        const order = visit.order || visitPartsText(visit);
        const close = visit.close || visit.summary || '';
        writePara('VISIT LETTER', 'What happened on site', String(letter || '').replace(/<[^>]+>/g, ' ').trim());
        if (done) writePara('ON SITE', 'Completed on site', done);
        if (order) writePara('ORDER NOW', 'Parts to order', order);
        if (close) writePara('CONCLUSION', 'Conclusion', close);
        const vphotos = (visit.photos || []).map(ph => (typeof ph === 'string' ? ph : (ph && ph.url) || '')).filter(Boolean);
        if (vphotos.length) {
          need(56);
          doc.setTextColor(212, 34, 59);
          doc.setFontSize(8);
          doc.text('TRIP PHOTOS', L, y);
          y += 6;
          const pw = (usable - 4) / 2;
          const ph = 42;
          vphotos.slice(0, 4).forEach((src, i) => {
            if (i === 2) { y += ph + 8; }
            need(ph + 8);
            const x = L + (i % 2) * (pw + 4);
            try { doc.addImage(src, 'JPEG', x, y, pw, ph); }
            catch (e) { try { doc.addImage(src, 'PNG', x, y, pw, ph); } catch (e2) {} }
          });
          y += ph + 10;
        }
      }

      // Primary findings
      newPage();
      doc.setTextColor(20, 20, 24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Primary findings', L, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(92, 101, 112);
      doc.text('Poor and fail items, ranked by safety, then downtime, then performance.', L, y);
      y += 8;

      function chip(label, x, yy, tone) {
        const bg = tone === 'poor' ? [253, 236, 234] : [255, 246, 217];
        const fg = tone === 'poor' ? [198, 40, 40] : [184, 134, 11];
        doc.setFillColor(bg[0], bg[1], bg[2]);
        doc.roundedRect(x, yy - 4, 16, 6, 1, 1, 'F');
        doc.setTextColor(fg[0], fg[1], fg[2]);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.text(String(label || '').toUpperCase().substring(0, 8), x + 8, yy, { align: 'center' });
      }

      function findingCard(f) {
        const r = results[f.item_id] || f;
        const src = r.photoDataUrl || f.photoDataUrl;
        const bodyLines = wrap(f.notes || 'No note recorded.', usable - 10, 9);
        const photoH = src ? 48 : 0;
        const h = 16 + bodyLines.length * 4.2 + photoH + (src ? 8 : 4);
        need(Math.min(h, 70));
        const boxH = Math.min(h, H - 16 - y);
        doc.setDrawColor(228, 230, 234);
        doc.setFillColor(255, 255, 255);
        doc.rect(L, y, usable, h, 'FD');
        doc.setFillColor(198, 40, 40);
        doc.rect(L, y, 1.8, h, 'F');
        doc.setTextColor(20, 20, 24);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(String(f.item_name || '').substring(0, 62), L + 5, y + 7);
        const c = String(f.condition || 'Poor');
        chip(c, R - 22, y + 7, /poor|fail|out/i.test(c) ? 'poor' : 'fair');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(92, 101, 112);
        const meta = [f.section, (f.impacts || []).join('  ·  ')].filter(Boolean).join('  ·  ');
        doc.text(meta.substring(0, 90), L + 5, y + 13);
        doc.setTextColor(20, 20, 24);
        doc.setFontSize(9);
        let yy = y + 19;
        bodyLines.forEach(line => {
          doc.text(line, L + 5, yy);
          yy += 4.2;
        });
        if (src) {
          try {
            doc.addImage(src, 'JPEG', L + 5, yy, 70, 42);
          } catch (e) {
            try { doc.addImage(src, 'PNG', L + 5, yy, 70, 42); } catch (e2) {}
          }
        }
        y += h + 4;
      }

      if (!poorList.length) {
        doc.setTextColor(27, 122, 74);
        doc.setFontSize(9);
        doc.text('No Poor items on this inspection.', L, y);
        y += 8;
      } else {
        poorList.forEach(findingCard);
      }


      // Checklist appendix — match customer example
      newPage();
      doc.setTextColor(20, 20, 24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Point-by-point inspection', L, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(92, 101, 112);
      doc.text((model || 'Machine') + (serial ? '  ·  S/N ' + serial : ''), L, y);
      y += 5;
      const intro = wrap('Every checkpoint on this machine, with result and notes.', usable, 8);
      intro.forEach(line => { doc.text(line, L, y); y += 4; });
      y += 3;

      function resultStyle(raw) {
        const v = String(raw || '').trim().toLowerCase();
        if (v === 'good' || v === 'pass' || v === 'within spec') {
          return { label: v === 'pass' ? 'PASS' : (v === 'within spec' ? 'IN SPEC' : 'GOOD'), bg: [229, 246, 238], fg: [27, 122, 74] };
        }
        if (v === 'fair') return { label: 'FAIR', bg: [255, 246, 217], fg: [184, 134, 11] };
        if (v === 'poor' || v === 'fail' || v === 'out of spec' || v === 'damaged') {
          return { label: v === 'fail' ? 'FAIL' : (v === 'out of spec' ? 'OUT OF SPEC' : 'POOR'), bg: [253, 236, 234], fg: [198, 40, 40] };
        }
        if (v === 'n/a' || v === 'na') return { label: 'N/A', bg: [244, 245, 247], fg: [113, 128, 150] };
        if (!v || v === '—') return { label: '—', bg: [255, 255, 255], fg: [160, 174, 192] };
        return { label: String(raw).toUpperCase().substring(0, 10), bg: [244, 245, 247], fg: [20, 20, 24] };
      }

      const sections = (APP_DATA && APP_DATA.sections) || [];
      sections.forEach(sec => {
        const secItems = items.filter(i => {
          if (i.section_id !== sec.section_id) return false;
          const r = results[i.item_id] || {};
          const name = String(i.inspection_item || '');
          if (/^other:?$/i.test(name.trim()) && !r.condition && !r.notes) return false;
          return true;
        });
        if (!secItems.length) return;
        need(22);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(20, 20, 24);
        doc.text(sec.section.replace(/ Section$/,'') , L, y);
        y += 3;
        const body = secItems.map(it => {
          const r = results[it.item_id] || {};
          return [it.inspection_item, r.condition || '', r.notes || '—'];
        });
        doc.autoTable({
          startY: y,
          margin: { left: L, right: 14, bottom: 16 },
          head: [['Item', 'Result', 'Notes']],
          body,
          theme: 'plain',
          styles: {
            fontSize: 8,
            cellPadding: { top: 2.2, bottom: 2.2, left: 2.4, right: 2.4 },
            valign: 'middle',
            textColor: [20, 20, 24],
            lineColor: [228, 230, 234],
            lineWidth: 0.15
          },
          headStyles: {
            fillColor: [244, 245, 247],
            textColor: [92, 101, 112],
            fontStyle: 'bold',
            fontSize: 7.5
          },
          columnStyles: {
            0: { cellWidth: 62 },
            1: { cellWidth: 32, halign: 'center', valign: 'middle', fontStyle: 'bold', fontSize: 6.4, overflow: 'linebreak' },
            2: { cellWidth: 'auto' }
          },
          didParseCell: function(data) {
            if (data.section === 'head' && data.column.index === 1) {
              data.cell.styles.halign = 'center';
              return;
            }
            if (data.section !== 'body' || data.column.index !== 1) return;
            const st = resultStyle(data.cell.raw);
            data.cell.styles.fillColor = st.bg;
            data.cell.styles.textColor = st.fg;
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.halign = 'center';
            data.cell.styles.valign = 'middle';
            data.cell.styles.fontSize = st.label.length > 6 ? 6.2 : 7;
            data.cell.styles.overflow = 'linebreak';
            data.cell.styles.cellPadding = { top: 2.4, bottom: 2.4, left: 1.2, right: 1.2 };
            data.cell.text = [st.label];
          }
        });
        y = doc.lastAutoTable.finalY + 8;
      });

      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        runningFooter();
      }

      const safeName = (customer || 'Inspection').replace(/[^a-z0-9]/gi, '_').substring(0, 30);
      doc.save((combined ? 'LeMatic_Visit_Inspection_' : 'LeMatic_Inspection_') + safeName + '_' + (date || 'report') + '.pdf');
      toast(combined ? 'Combined visit + inspection PDF downloaded' : 'PDF report downloaded');
    }





    async function generateInspectionExcel() {
      if (!currentInspection) { toast('No inspection data'); return; }
      if (typeof updateFindings === 'function') updateFindings();
      await ensureExcelLibs();
      if (typeof ExcelJS === 'undefined') { toast('Excel library not available'); return; }
      const customer = currentInspection.customer || 'Customer';
      const model = currentInspection.model || '';
      const serial = currentInspection.serial || '';
      const tech = currentInspection.technician || '';
      const date = currentInspection.date || '';
      const job = currentInspection.jobId ? (loadJobs().find(j => j.id === currentInspection.jobId) || null) : null;
      const items = (APP_DATA && APP_DATA.items) || [];
      const sections = (APP_DATA && APP_DATA.sections) || [];
      const sectionName = (id) => {
        const s = sections.find(x => x.section_id === id);
        return s ? (s.name || s.title || '') : '';
      };
      const wb = new ExcelJS.Workbook();
      wb.creator = 'LeMatic Field Service';
      const ws = wb.addWorksheet('Inspection', { views: [{ state: 'frozen', ySplit: 8 }] });
      ws.columns = [
        { width: 22 }, { width: 36 }, { width: 14 }, { width: 28 }, { width: 36 }
      ];
      const title = ws.getRow(1);
      title.getCell(1).value = 'LeMatic Field Service Inspection';
      title.getCell(1).font = { bold: true, size: 16, color: { argb: 'FF141418' } };
      ws.mergeCells('A1:E1');
      const meta = [
        ['Customer', customer],
        ['Machine', model],
        ['Serial', serial],
        ['Technician', tech],
        ['Date', date],
        ['Sales order', job && job.so ? job.so : (currentInspection.so || '')],
        ['Job site', job && job.site ? job.site : '']
      ];
      meta.forEach((pair, i) => {
        const row = ws.getRow(2 + i);
        row.getCell(1).value = pair[0];
        row.getCell(1).font = { bold: true, color: { argb: 'FF5C656F' } };
        row.getCell(2).value = pair[1] || '—';
        ws.mergeCells(2 + i, 2, 2 + i, 5);
      });
      const head = ws.getRow(10);
      ['Section', 'Item', 'Condition', 'Notes', 'Finding'].forEach((h, i) => {
        const c = head.getCell(i + 1);
        c.value = h;
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141418' } };
      });
      const condOf = (id) => (results[id] && results[id].condition) || '';
      const notesOf = (id) => (results[id] && (results[id].notes || results[id].comment)) || '';
      items.forEach((it, idx) => {
        const row = ws.getRow(11 + idx);
        row.getCell(1).value = sectionName(it.section_id);
        row.getCell(2).value = it.name || it.title || it.item_id;
        row.getCell(3).value = condOf(it.item_id) || '';
        row.getCell(4).value = notesOf(it.item_id);
        const f = (findings || []).find(x => x.item_id === it.item_id);
        row.getCell(5).value = f ? (f.notes || f.item_name || '') : '';
      });
      const safe = String(customer).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Inspection';
      for (let r = firstDataRow + items.length; r <= lastTemplateRow; r++) {
        clearUnusedRow(ws.getRow(r));
      }

      const out = await wb.xlsx.writeBuffer();
      const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'LeMatic_Inspection_' + safe + '_' + (date || 'report') + '.xlsx';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      toast('Excel report downloaded');
    }

    async function generateWordReport() {
      if (!currentInspection) { toast('No inspection data'); return; }
      updateFindings();
      generateWordHtmlDoc();
    }

    function crc32Bytes(u8) {
      let c = ~0;
      for (let i = 0; i < u8.length; i++) {
        c ^= u8[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
      }
      return (~c) >>> 0;
    }
    function zipStore(files) {
      const enc = new TextEncoder();
      const parts = [];
      const central = [];
      let offset = 0;
      files.forEach(f => {
        const name = enc.encode(f.name);
        const data = (typeof f.data === 'string') ? enc.encode(f.data) : f.data;
        const crc = crc32Bytes(data);
        const local = new Uint8Array(30 + name.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, name.length, true);
        local.set(name, 30);
        parts.push(local, data);
        const cen = new Uint8Array(46 + name.length);
        const cv = new DataView(cen.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, name.length, true);
        cv.setUint32(42, offset, true);
        cen.set(name, 46);
        central.push(cen);
        offset += local.length + data.length;
      });
      const cenStart = offset;
      let cenSize = 0;
      central.forEach(c => { parts.push(c); cenSize += c.length; });
      const end = new Uint8Array(22);
      const ev = new DataView(end.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(8, files.length, true);
      ev.setUint16(10, files.length, true);
      ev.setUint32(12, cenSize, true);
      ev.setUint32(16, cenStart, true);
      parts.push(end);
      let total = 0;
      parts.forEach(p => total += p.length);
      const out = new Uint8Array(total);
      let o = 0;
      parts.forEach(p => { out.set(p, o); o += p.length; });
      return out;
    }
    function generateWordHtmlDoc() {
      if (!currentInspection) return;
      const customer = currentInspection.customer || 'Customer';
      const model = currentInspection.model || 'LX-8';
      const serial = currentInspection.serial || '';
      const tech = currentInspection.technician || '';
      const date = currentInspection.date || '';
      const notes = (typeof getNotesPlain === 'function' ? getNotesPlain() : '') || String(currentInspection.summaryNotes || '').replace(/<[^>]+>/g, ' ').trim();
      const items = (APP_DATA && APP_DATA.items) || [];
      const sections = (APP_DATA && APP_DATA.sections) || [];
      const ICON_B64 = {
        safety: 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABa0lEQVR4nO1auw7CMBBrET/TASGx8f8DGxJi6K+AGGA6CVWkzePunBB7pO2dYzupOBgfz9d76Bg7NAE0KACaABoUAE0ADbgA1+MB2h8qgCweKQI8AWjABFi6jkoBE4BoGnIbkQImwLvhlsveKWACPJvFuuuZAibAq1Gqq14pYAI8muS66ZECcwFKF2EtQvdbYLScCofcO89z8JnLNP38/HS7q3BaovsEmAmgvXetzgImwKKolVsWdZkA7YLW723t+kyAZjGvLzCafdQE8J7kaPXjFtAogprpa/RlAkoLoH/cLO3PBJQ8jHZfUMKj+wRkD0Rqcf8bOUOT7hOQJUCN7g9DHq+9AY9N5MwErZCcgFrdF6TySxKg9sULUnjyEIy9sRX3BbF8mYCYm1pzXxDDG/Ia9H7VrWEzAa26L9jizzNg7WLr7gvW1sEEhC78i/uC0HpM/yDRArgF0ATQoABoAmhQADQBNCgAmgAaH1wjVlChn5+sAAAAAElFTkSuQmCC',
        down: 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABY0lEQVR4nO2bSw4CIRBEHeMBPJJ38hzeySO51LjQFYkhZugfVBPqrRGqa4pPRmZ7vt6fw8Ic0QLQ0AC0ADQ0AC0ADQ1AC0BzGj3g/XZutrlcH911FLbeByFJwS16GtLNgIjCa3oYEW5Aj8JrIo0IXQRHFB89TkgCRhX+D28a3AlAFh8xvssAdPEFjw6zAVmKL1j1mAzIVnzBomv5o7DagKxPv6DVp9oGNZ3vbU97/Vh/p+nnF04BacPs0a+R6mUCJI1me/oFiW4mAC0ADQ1oNZh1/hda+pkAtAA0NAAtAA0NQAtAQwPQAtA0DRj5R2UPWvqZALQANDRA0mjWdUCimwmQNpwtBXwtLkR9P2CGFySatKoTkH0qaPUtPwVMBmRNgUWXOQHZTLDqcU2BLCZ4dLjXALQJ3vFDL0qO3CKjjA/dBUalIXIc3hXmbfHB3w0u971AdngURgtAQwPQAtDQALQANF9eD4x7xDKd6AAAAABJRU5ErkJggg==',
        perf: 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAyUlEQVR4nO3bsQlCQRAAURXbsQ57sSB7sQ6bUQy0BP0f9Ak7E9/BMGywF9z2dn88N4PZaQFNAbSApgBaQFMALaApgBbQFEALaAqgBTR7LfCOw+my+M71fPz47PgJKIAW0BRAC2gKoAU0BdACmgJoAc3P3gLf3unXMn4CCqAFNAXQApoCaAFNAbSAZvEm+K8b3VrGT0ABtICmAFpAUwAtoCmAFtAUQAtoCqAFNAXQApoCaAHN+ADbvs0NpwBaQFMALaApgBbQjA/wAv4sEVtu4y33AAAAAElFTkSuQmCC'
      };
      function condOf(id) { return (results[id] && results[id].condition) || ''; }
      function xml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
      function iconDrawing(rid, name) {
        const cx = 365760, cy = 365760;
        return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="' + rid.replace('rId','') + '" name="' + name + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="' + name + '.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
      }
      function resultLabel(raw) {
        const v = String(raw || '').trim().toLowerCase();
        if (v === 'pass') return 'PASS';
        if (v === 'within spec') return 'IN SPEC';
        if (v === 'out of spec') return 'OUT OF SPEC';
        if (v === 'good') return 'GOOD';
        if (v === 'fair') return 'FAIR';
        if (v === 'poor') return 'POOR';
        if (v === 'fail') return 'FAIL';
        if (v === 'n/a' || v === 'na') return 'N/A';
        if (!v) return '—';
        return String(raw).toUpperCase();
      }
      function resultFill(raw) {
        const v = String(raw || '').trim().toLowerCase();
        if (v === 'good' || v === 'pass' || v === 'within spec') return 'E5F6EE';
        if (v === 'fair') return 'FFF6D9';
        if (v === 'poor' || v === 'fail' || v === 'out of spec') return 'FDECEA';
        return 'F4F5F7';
      }
      function resultColor(raw) {
        const v = String(raw || '').trim().toLowerCase();
        if (v === 'good' || v === 'pass' || v === 'within spec') return '1B7A4A';
        if (v === 'fair') return 'B8860B';
        if (v === 'poor' || v === 'fail' || v === 'out of spec') return 'C62828';
        return '718096';
      }
      let nGood = 0, nFair = 0, nPoor = 0, nAns = 0;
      items.forEach(it => {
        const c = String(condOf(it.item_id)).toLowerCase();
        if (!c) return;
        nAns++;
        if (c === 'poor' || c === 'fail' || c === 'out of spec') nPoor++;
        else if (c === 'fair') nFair++;
        else if (c !== 'n/a' && c !== 'na') nGood++;
      });
      const impactCount = (name) => (findings || []).filter(f => (f.impacts || []).some(x => String(x).toLowerCase().includes(name))).length;
      const ranked = (findings || []).filter(f => {
        const c = String(f.condition || '').toLowerCase();
        return c === 'poor' || c === 'fail' || c === 'out of spec';
      });

      function run(text, o) {
        o = o || {};
        return '<w:r><w:rPr><w:noProof/>' + (o.bold ? '<w:b/>' : '') + '<w:sz w:val="' + (o.size || 22) + '"/><w:szCs w:val="' + (o.size || 22) + '"/>' + (o.color ? '<w:color w:val="' + o.color + '"/>' : '<w:color w:val="141418"/>') + '<w:u w:val="none"/><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr><w:t xml:space="preserve">' + xml(text) + '</w:t></w:r>';
      }
      function para(runsXml, o) {
        o = o || {};
        return '<w:p><w:pPr><w:keepNext w:val="0"/><w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after || 60) + '"/>' + (o.center ? '<w:jc w:val="center"/>' : '') + (o.right ? '<w:jc w:val="right"/>' : '') + '</w:pPr>' + (runsXml || '') + '</w:p>';
      }
      function p(text, o) { return para(run(text, o), o); }
      function emptyP() { return '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>'; }
      function strut(color) {
        return para(run(new Array(92).join('\u00A0'), { size: 4, color: color || 'FFFFFF' }), { after: 0 });
      }
      function tc(inner, dxa, fill, extra) {
        return '<w:tc><w:tcPr><w:tcW w:w="' + dxa + '" w:type="dxa"/>' + (fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/>' : '') + (extra || '') + '<w:vAlign w:val="center"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>' + (inner || emptyP()) + '</w:tc>';
      }
      function resultCell(label, raw, dxa) {
        const fill = resultFill(raw);
        const color = resultColor(raw);
        const inner = '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60" w:line="276" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/></w:pPr>' + run(label, { size: 16, bold: true, color: color }) + '</w:p>';
        return '<w:tc><w:tcPr><w:tcW w:w="' + dxa + '" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/><w:vAlign w:val="center"/><w:tcBorders><w:top w:val="single" w:sz="12" w:color="' + fill + '"/><w:left w:val="single" w:sz="4" w:color="D0D4DA"/><w:bottom w:val="single" w:sz="12" w:color="' + fill + '"/><w:right w:val="single" w:sz="4" w:color="D0D4DA"/></w:tcBorders><w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="40" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tcMar></w:tcPr>' + inner + '</w:tc>';
      }
      function makeTbl(widths, rowsXml, bordered) {
        const total = widths.reduce(function(a, b) { return a + b; }, 0);
        const borders = bordered
          ? '<w:top w:val="single" w:sz="4" w:space="0" w:color="D0D4DA"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D0D4DA"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D0D4DA"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D0D4DA"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D0D4DA"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D0D4DA"/>'
          : '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>';
        return '<w:tbl><w:tblPr><w:tblW w:w="' + total + '" w:type="dxa"/><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/><w:tblBorders>' + borders + '</w:tblBorders></w:tblPr><w:tblGrid>' + widths.map(function(w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>' + rowsXml + '</w:tbl>';
      }

      const FULL = 10800;
      let body = '';

      body += makeTbl([7600, 3200], '<w:tr>' +
        tc(
          strut('141418') +
          p('FIELD SERVICE INSPECTION', { size: 16, color: 'F3B3BC', after: 40 }) +
          p(customer, { size: 36, bold: true, color: 'FFFFFF', after: 40 }) +
          p([model.replace('-', '\u2011'), serial ? 'S/N ' + serial : ''].filter(Boolean).join('   '), { size: 18, color: 'D0D5DB', after: 20 }) +
          p([tech, date].filter(Boolean).join('   '), { size: 18, color: 'D0D5DB', after: 20 }),
          7600, '141418') +
        tc('<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="120" w:after="0"/></w:pPr>' + (function(){
          const cx=1371600, cy=457200;
          return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="21" name="LeMatic logo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="lematic-logo.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogoDoc"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
        })() + '</w:p>', 3200, '141418') +
      '</w:tr>');
      body += p('', { after: 160 });

      const tiles = [
        [String(nAns), 'ITEMS CHECKED', '2A3036'],
        [String(nPoor), 'POOR', 'C62828'],
        [String(nFair), 'FAIR', 'B8860B'],
        [String(nGood), 'GOOD', '1F4E3A']
      ];
      const tw = 2700;
      body += makeTbl([tw, tw, tw, tw], '<w:tr>' + tiles.map(function(tile) {
        return tc(strut(tile[2]) + p(tile[0], { size: 32, bold: true, color: 'FFFFFF', center: true, after: 40 }) + p(tile[1], { size: 13, color: 'FFFFFF', center: true, after: 20 }), tw, tile[2]);
      }).join('') + '</w:tr>');
      body += p('', { after: 160 });

      body += p('IMPACT', { size: 16, bold: true, color: '5C6570', after: 80 });
      const impacts = [
        [String(impactCount('safety')), 'SAFETY', 'C62828', 'rId5', 'safety'],
        [String(impactCount('downtime') + impactCount('down-time')), 'DOWNTIME', 'B8860B', 'rId6', 'down'],
        [String(impactCount('performance')), 'PERFORMANCE', '2563B4', 'rId7', 'perf']
      ];
      const iw = 3600;
      body += makeTbl([iw, iw, iw], '<w:tr>' + impacts.map(function(imp) {
        const iconP = '<w:p><w:pPr><w:spacing w:after="40"/><w:jc w:val="left"/></w:pPr>' + iconDrawing(imp[3], imp[4]) + run('  ' + imp[0], { size: 28, bold: true, color: imp[2] }) + '</w:p>';
        return tc(strut('F8F9FB') + iconP + p(imp[1], { size: 14, color: '5C6570', after: 20 }), iw, 'F8F9FB');
      }).join('') + '</w:tr>');
      body += p('', { after: 200 });

      if (notes) {
        body += p('SUMMARY NOTES', { size: 16, bold: true, color: '5C6570', after: 80 });
        notes.split(/\n+/).forEach(function(line) { body += p(line, { size: 22, after: 80 }); });
        body += p('', { after: 120 });
      }

      body += p('Primary findings', { size: 32, bold: true, after: 40 });
      body += p('Poor and fail items, ranked by safety, then downtime, then performance.', { size: 18, color: '5C6570', after: 160 });
      if (!ranked.length) {
        body += p('No Poor items on this inspection.', { size: 22, color: '1B7A4A' });
      } else {
        ranked.forEach(function(f) {
          const label = resultLabel(f.condition);
          const fill = resultFill(f.condition);
          const color = resultColor(f.condition);
          const titleP = '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="10080"/></w:tabs><w:spacing w:after="40"/></w:pPr>' +
            run(f.item_name || '', { size: 22, bold: true }) +
            '<w:r><w:tab/></w:r>' +
            run(label, { size: 16, bold: true, color: color }) +
          '</w:p>';
          const metaP = p([f.section, (f.impacts || []).join('  |  ')].filter(Boolean).join('   '), { size: 16, color: '5C6570', after: 40 });
          const noteP = p(f.notes || 'No note recorded.', { size: 20, after: 40 });
          const cell = '<w:tc><w:tcPr><w:tcW w:w="' + FULL + '" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="single" w:sz="48" w:space="0" w:color="C62828"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar></w:tcPr>' + titleP + metaP + noteP + '</w:tc>';
          body += makeTbl([FULL], '<w:tr>' + cell + '</w:tr>');
          body += p('', { after: 80 });
        });
      }

      body += p('Point-by-point inspection', { size: 32, bold: true, before: 200, after: 40 });
      body += p([model.replace('-', '\u2011'), serial ? 'S/N ' + serial : ''].filter(Boolean).join('   '), { size: 18, color: '5C6570', after: 160 });
      const cItem = 4800, cRes = 1800, cNote = 4200;
      sections.forEach(function(sec) {
        const secItems = items.filter(function(it) { return it.section_id === sec.section_id; });
        if (!secItems.length) return;
        body += p(sec.section, { size: 26, bold: true, before: 160, after: 80 });
        let rows = '<w:tr>' +
          tc(strut('F4F5F7') + p('Item', { size: 16, bold: true, color: '5C6570', after: 20 }), cItem, 'F4F5F7') +
          tc(p('Result', { size: 16, bold: true, color: '5C6570', center: true, after: 20 }), cRes, 'F4F5F7') +
          tc(p('Notes', { size: 16, bold: true, color: '5C6570', after: 20 }), cNote, 'F4F5F7') +
        '</w:tr>';
        secItems.forEach(function(it) {
          const r = results[it.item_id] || {};
          rows += '<w:tr>' +
            tc(p(it.inspection_item, { size: 18, after: 20 }), cItem, 'FFFFFF') +
            resultCell(resultLabel(r.condition), r.condition, cRes) +
            tc(p(r.notes || '', { size: 18, after: 20 }), cNote, 'FFFFFF') +
          '</w:tr>';
        });
        body += makeTbl([cItem, cRes, cNote], rows, true);
      });

      body += '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/></w:sectPr>';

      const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body + '</w:body></w:document>';
      const headerInner = '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="10080"/></w:tabs><w:spacing w:before="40" w:after="40"/></w:pPr>' +
        run('LeMatic  ·  Field Service Report', { size: 16, bold: true, color: 'FFFFFF' }) +
        '<w:r><w:tab/></w:r>' +
        run((customer + (date ? '  ·  ' + date : (serial ? '  ·  ' + serial : ''))).substring(0, 48), { size: 16, color: 'D0D5DB' }) +
      '</w:p>';
      const headerCell = '<w:tc><w:tcPr><w:tcW w:w="' + FULL + '" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="141418"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="single" w:sz="48" w:space="0" w:color="D4223B"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders><w:tcMar><w:top w:w="40" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar></w:tcPr>' + headerInner + '</w:tc>';
      const headerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        makeTbl([FULL], '<w:tr>' + headerCell + '</w:tr>') +
      '</w:hdr>';
      const footerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        makeTbl([FULL], '<w:tr>' + tc(strut('F4F5F7') + p('Inspection checklist   Customer copy', { size: 14, color: '5C6570', after: 20 }), FULL, 'F4F5F7') + '</w:tr>') +
      '</w:ftr>';
      const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:noProof/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>';
      const settingsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:hideSpellingErrors w:val="true"/><w:hideGrammaticalErrors w:val="true"/><w:proofState w:spelling="clean" w:grammar="clean"/><w:zoom w:percent="100"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';
      const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>';
      const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
      const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/icon-safety.png"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/icon-down.png"/><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/icon-perf.png"/><Relationship Id="rIdLogoDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/lematic-logo.jpg"/></Relationships>';
      const bytes = zipStore([
        { name: '[Content_Types].xml', data: contentTypes },
        { name: '_rels/.rels', data: rels },
        { name: 'word/document.xml', data: documentXml },
        { name: 'word/_rels/document.xml.rels', data: docRels },
        { name: 'word/header1.xml', data: headerXml },
        { name: 'word/footer1.xml', data: footerXml },
        { name: 'word/styles.xml', data: stylesXml },
        { name: 'word/settings.xml', data: settingsXml },
        { name: 'word/media/icon-safety.png', data: Uint8Array.from(atob(ICON_B64.safety), function(c) { return c.charCodeAt(0); }) },
        { name: 'word/media/icon-down.png', data: Uint8Array.from(atob(ICON_B64.down), function(c) { return c.charCodeAt(0); }) },
        { name: 'word/media/icon-perf.png', data: Uint8Array.from(atob(ICON_B64.perf), function(c) { return c.charCodeAt(0); }) },
        { name: 'word/media/lematic-logo.jpg', data: Uint8Array.from(atob(LEMATIC_LOGO_JPG), function(c) { return c.charCodeAt(0); }) },
      ]);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const a = document.createElement('a');
      const safe = (customer || 'Inspection').replace(/[^a-z0-9]/gi, '_').substring(0, 30);
      a.href = URL.createObjectURL(blob);
      a.download = safe + '_' + (model || 'machine') + '_' + (date || 'report') + '.docx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('Word document downloaded');
    }

    // ========== NAV ==========
    document.getElementById('btnInspectHome').addEventListener('click', () => {
      if (currentInspection && currentInspection.status !== 'Complete') {
        saveCurrentDraft();
      }
      if (document.body.classList.contains('on-notes')) syncNotesField();
      closeSearch();
      showScreen('screenInspectList');
      setHeader('Inspections');
      refreshHome();
    });

    const btnSettings = document.getElementById('btnSettings');
    if (btnSettings) btnSettings.addEventListener('click', () => {
      closeSearch();
      showScreen('screenSettings');
      setHeader('Settings');
      if (typeof refreshStorageCard === 'function') refreshStorageCard();
    });
    document.getElementById('btnHome').addEventListener('click', () => {
      if (currentInspection && currentInspection.status !== 'Complete') {
        saveCurrentDraft();
      }
      closeSearch();
      showScreen('screenHome');
      setHeader('LeMatic Inspection');
      refreshHome();
      measureHeaderHeight();
      requestAnimationFrame(() => {
        measureHeaderHeight();
        window.scrollTo(0, 0);
        resetChrome();
      });
    });

    document.getElementById('btnSearch').addEventListener('click', () => {
      const bar = document.getElementById('searchBar');
      const isOpen = bar.classList.toggle('show');
      if (isOpen) {
        document.body.classList.add('search-open');
        const inp = document.getElementById('inpSearch');
        inp.focus();
        renderSearchResults();
      } else {
        closeSearch();
      }
    });

    function syncSearchClear() {
      const bar = document.getElementById('searchBar');
      const inp = document.getElementById('inpSearch');
      bar.classList.toggle('has-query', !!(inp.value || '').trim());
    }

    function hideSearchResults() {
      const panel = document.getElementById('searchResults');
      const scrim = document.getElementById('searchScrim');
      panel.classList.remove('show');
      panel.hidden = true;
      panel.innerHTML = '';
      if (scrim) {
        scrim.classList.remove('show');
        scrim.hidden = true;
      }
    }

    function positionSearchResults() {
      const bar = document.getElementById('searchBar');
      const panel = document.getElementById('searchResults');
      if (!bar.classList.contains('show') || !panel.classList.contains('show')) return;
      const rect = bar.getBoundingClientRect();
      const vv = window.visualViewport;
      const viewBottom = vv ? (vv.offsetTop + vv.height) : window.innerHeight;
      panel.style.top = Math.round(rect.bottom + 8) + 'px';
      panel.style.maxHeight = Math.max(120, Math.round(viewBottom - rect.bottom - 16)) + 'px';
    }

    function renderSearchResults() {
      const panel = document.getElementById('searchResults');
      const bar = document.getElementById('searchBar');
      const q = (searchQuery || '').trim().toLowerCase();
      if (!bar.classList.contains('show') || !q) {
        hideSearchResults();
        return;
      }
      const rows = [];
      loadJobs().forEach(job => {
        const hay = [job.customer, job.site, job.contact, job.technician, job.po, job.salesOrder, job.status, job.scope]
          .map(x => (x || '').toLowerCase()).join(' ');
        if (hay.includes(q)) {
          rows.push({
            kind: 'job',
            id: job.id,
            kicker: 'Job',
            title: job.customer || 'Untitled job',
            sub: [job.site, formatJobDateRange(job), job.status].filter(Boolean).join(' · ')
          });
        }
      });
      loadInspections().forEach(ins => {
        const hay = [ins.customer, ins.serial, ins.technician, ins.model, ins.po, ins.date, ins.status]
          .map(x => (x || '').toLowerCase()).join(' ');
        if (hay.includes(q)) {
          rows.push({
            kind: 'inspection',
            id: ins.id,
            kicker: 'Inspection',
            title: (ins.customer || 'Unknown') + ' – ' + (ins.model || 'LX-8') + ' – ' + (ins.serial || 'No S/N'),
            sub: [ins.technician, ins.date, ins.status].filter(Boolean).join(' · ')
          });
        }
      });
      try {
        const punch = (typeof window.getPunchlistSummaries === 'function') ? null : null;
      } catch (e) {}
      const punchNames = [];
      try {
        if (window.__plData && window.__plData.jobs) {
          Object.keys(window.__plData.jobs).forEach(name => punchNames.push(name));
        }
      } catch (e) {}
      // punchlist internal data
      try {
        if (typeof window.getPunchlistSummaries === 'function') {
          /* summaries filled async below */
        }
      } catch (e) {}

      function paint(extraPunch) {
        const all = rows.concat(extraPunch || []).slice(0, 40);
        if (!all.length) {
          panel.innerHTML = `<div class="search-empty">No matches</div>`;
        } else {
          panel.innerHTML = all.map(row => `
            <div class="list-item" data-kind="${row.kind}" data-id="${String(row.id || row.name || '').replace(/"/g,'')}" data-job="${String(row.job || '').replace(/"/g,'')}">
              <div class="list-item-main" data-action="open">
                <div class="search-result-kicker">${row.kicker}</div>
                <div class="title">${row.title}</div>
                <div class="sub">${row.sub || ''}</div>
              </div>
            </div>
          `).join('');
          panel.querySelectorAll('.list-item').forEach(el => {
            el.addEventListener('click', () => {
              const kind = el.dataset.kind;
              const id = el.dataset.id;
              closeSearch();
              if (kind === 'job') {
                const job = loadJobs().find(j => j.id === id);
                if (job && typeof openJobDetail === 'function') openJobDetail(job.id);
                else if (job) { showScreen('screenJobsList'); refreshJobsList(); }
              } else if (kind === 'inspection') {
                openInspection(id);
              } else if (kind === 'punchlist') {
                if (typeof window.openPunchlistByName === 'function') {
                  window.openPunchlistByName(id).then(() => {
                    showScreen('screenPunchlist');
                    setHeader('Punchlist');
                    if (typeof window.renderList === 'function') window.renderList();
                  }).catch(() => toast('Could not open punchlist'));
                }
              } else if (kind === 'punchitem') {
                const job = el.dataset.job || el.getAttribute('data-job');
                if (typeof window.openPunchlistItem === 'function') {
                  window.openPunchlistItem(job, Number(id) || id).then(() => {
                    showScreen('screenPunchlist');
                    setHeader('Punchlist');
                  }).catch(() => toast('Could not open item'));
                }
              }
            });
          });
        }
        panel.hidden = false;
        panel.classList.add('show');
        const scrim = document.getElementById('searchScrim');
        if (scrim) {
          scrim.hidden = false;
          scrim.classList.add('show');
        }
        positionSearchResults();
      }

      if (typeof window.getPunchlistSummaries === 'function') {
        Promise.all([
          window.getPunchlistSummaries(),
          window.searchPunchlistItems ? window.searchPunchlistItems(q) : Promise.resolve([])
        ]).then(([list, items]) => {
          const extra = (list || []).filter(r => String(r.name || '').toLowerCase().includes(q)).map(r => ({
            kind: 'punchlist',
            id: r.name,
            name: r.name,
            kicker: 'Punchlist',
            title: r.name,
            sub: (r.total || 0) + ' item' + ((r.total || 0) !== 1 ? 's' : '') + ' · ' + (r.complete || 0) + ' complete'
          }));
          (items || []).forEach(it => extra.push({
            kind: 'punchitem',
            id: String(it.id),
            job: it.job,
            kicker: 'Punchlist item',
            title: it.description || 'Item',
            sub: [it.job, it.status, it.line, it.location].filter(Boolean).join(' · ')
          }));
          paint(extra);
        }).catch(() => paint([]));
      } else {
        paint([]);
      }
    }

    function closeSearch() {
      const bar = document.getElementById('searchBar');
      bar.classList.remove('show', 'has-query');
      document.body.classList.remove('search-open');
      searchQuery = '';
      document.getElementById('inpSearch').value = '';
      hideSearchResults();
      refreshHome();
    }

    document.getElementById('inpSearch').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      syncSearchClear();
      renderSearchResults();
    });

    document.getElementById('btnSearchClear').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const inp = document.getElementById('inpSearch');
      inp.value = '';
      searchQuery = '';
      syncSearchClear();
      inp.focus();
      hideSearchResults();
    });

    document.getElementById('btnSearchCancel').addEventListener('click', (e) => {
      e.preventDefault();
      closeSearch();
    });

    window.addEventListener('resize', positionSearchResults);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', positionSearchResults);
      window.visualViewport.addEventListener('scroll', positionSearchResults);
    }

    // ========== NATIVE iOS-STYLE SCROLL CHROME ==========
    // Let the browser own scrolling. JavaScript only changes chrome state.
    let lastY = window.scrollY || 0;
    let chromeHidden = false;
    let chromeTicking = false;

    function setChrome(hidden) {
      if (chromeHidden === hidden) return;
      chromeHidden = hidden;

      document.body.classList.toggle('chrome-hidden', hidden);

      const header = document.getElementById('appHeader');
      const search = document.getElementById('searchBar');
      const dots = document.getElementById('sectionDots');
      const headerHeight = header ? header.offsetHeight : 96;
      const dotsHeight = dots && dots.offsetHeight ? dots.offsetHeight : 52;
      const searchHeight = search && search.offsetHeight ? search.offsetHeight : 56;
      // Extra clears the Dynamic Island after the bar reaches y = 0
      const extra = 20;
      const headerOffset = hidden ? -(headerHeight + extra) : 0;
      const dotsOffset = hidden ? -(headerHeight + dotsHeight + extra) : 0;
      const searchOffset = hidden ? -(headerHeight + searchHeight + extra) : 0;

      if (header) header.style.transform = `translate3d(0, ${headerOffset}px, 0)`;
      if (search && search.classList.contains('show')) {
        search.style.transform = `translate3d(0, ${searchOffset}px, 0)`;
      }
      if (dots) dots.style.transform = `translate3d(0, ${dotsOffset}px, 0)`;
    }

    function handleScroll() {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const delta = y - lastY;

      if (y <= 8) {
        setChrome(false);
      } else if (delta > 8) {
        setChrome(true);
      } else if (delta < -8) {
        setChrome(false);
      }

      lastY = y;
      chromeTicking = false;
    }

    window.addEventListener('scroll', () => {
      if (!chromeTicking) {
        chromeTicking = true;
        requestAnimationFrame(handleScroll);
      }
    }, { passive: true });

    function measureHeaderHeight() {
      const header = document.getElementById('appHeader');
      if (header) {
        const h = Math.max(header.offsetHeight || 0, 81);
        document.documentElement.style.setProperty('--header-h', h + 'px');
      }
      const dots = document.getElementById('sectionDots');
      if (dots && dots.offsetHeight) {
        document.documentElement.style.setProperty('--section-bar-h', dots.offsetHeight + 'px');
      }
    }

    function resetChrome() {
      lastY = window.scrollY || 0;
      chromeHidden = false;
      chromeTicking = false;
      document.body.classList.remove('chrome-hidden');

      const header = document.getElementById('appHeader');
      const search = document.getElementById('searchBar');
      const dots = document.getElementById('sectionDots');

      if (header) header.style.transform = 'translate3d(0, 0, 0)';
      if (search) search.style.transform = '';
      if (dots) dots.style.transform = 'translate3d(0, 0, 0)';
    }

    // ========== INIT ==========
    function initApp() {
      document.addEventListener('gesturestart', e => e.preventDefault());
      window.addEventListener('resize', measureHeaderHeight);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', measureHeaderHeight);
      }
      initNotesEditor();
      // Same path as tapping Home — avoids first-paint jumble
      showScreen('screenHome');
      setHeader('LeMatic Inspection');
      refreshHome();
      measureHeaderHeight();
      requestAnimationFrame(() => {
        measureHeaderHeight();
        window.scrollTo(0, 0);
        resetChrome();
      });
    }

    // Start
    bootStorage().then(() => loadData()).catch(() => loadData());

    // Register service worker (PWA) and keep drafts on device
    
    function syncViewportVars() {
      const vv = window.visualViewport;
      const h = (vv && vv.height) ? vv.height : window.innerHeight;
      const w = (vv && vv.width) ? vv.width : window.innerWidth;
      document.documentElement.style.setProperty('--app-vh', h + 'px');
      document.documentElement.style.setProperty('--app-vw', w + 'px');
      document.documentElement.classList.toggle('is-tablet', w >= 768);
      document.documentElement.classList.toggle('is-short', h < 700);
    }
    syncViewportVars();
    window.addEventListener('resize', syncViewportVars);
    window.addEventListener('orientationchange', () => setTimeout(syncViewportVars, 200));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewportVars);
    }
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js?v=flat-1').catch((err) => {
          console.warn('Service worker registration failed:', err);
        });
      });
    }
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    function syncOfflineBanner() {
      let bar = document.getElementById('offlineBanner');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'offlineBanner';
        bar.setAttribute('role', 'status');
        bar.style.cssText = 'display:none;position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:80;padding:10px 14px;border-radius:12px;background:#2a3036;color:#e8eef2;font-size:0.82rem;text-align:center;border:1px solid rgba(249,253,255,0.12)';
        bar.textContent = 'Offline — reports and photos stay on this device.';
        document.body.appendChild(bar);
      }
      const offline = (typeof navigator.onLine === 'boolean') ? !navigator.onLine : false;
      bar.style.display = offline ? 'block' : 'none';
    }
    window.addEventListener('online', syncOfflineBanner);
    window.addEventListener('offline', syncOfflineBanner);
    syncOfflineBanner();
    window.addEventListener('pagehide', () => { persistAllStores().catch(() => {}); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persistAllStores().catch(() => {});
    });

  
    // ========== PUNCHLIST ==========
    (function punchlistModule() {
const IDB_NAME = "FieldPunchlistDB";
    const IDB_VERSION = 1;
    const STORE_NAME = "appdata";
    const LEGACY_KEY = "field_punchlist_v3";

    const defaultData = {
      currentJob: "Aryzta Australia",
      jobs: {
        "Aryzta Australia": [
          { id:1, line:"LH", location:"Seal Unit", description:"Bad center seal heater", action:"Send new heater for warranty", department:"Service", responsible:"", dueDate:"", priority:"Normal", comments:"", status:"Not Started", photo:null },
          { id:2, line:"Rh", location:"Basket loader", description:"Leaking regulator (through spring/screw)", action:"Send new regulator for warranty", department:"Service", responsible:"", dueDate:"", priority:"High", comments:"", status:"In Progress", photo:null },
          { id:3, line:"LH", location:"Band slicer", description:"Missing complete set of band blade guides", action:"Send new blade guides", department:"Bakery", responsible:"", dueDate:"", priority:"Normal", comments:"Looked all over bakery – can't find.", status:"Not Started", photo:null },
          { id:4, line:"both", location:"Band slicer", description:"Missing top conveyor and upper band adjust handles", action:"Send new handles (x4)", department:"Bakery", responsible:"", dueDate:"", priority:"Normal", comments:"Cannot find handles in bakery.", status:"Not Started", photo:null },
          { id:5, line:"both", location:"Basket feed conveyors", description:"Infeed basket gate cycles too much", action:"Add timer to basket gate close", department:"Programming", responsible:"", dueDate:"", priority:"Normal", comments:"", status:"Complete", photo:null },
          { id:6, line:"both", location:"Grouper", description:"Not enough lane coverage with grouper hold downs", action:"Need two more assemblies per machine", department:"Service", responsible:"", dueDate:"", priority:"High", comments:"", status:"Not Started", photo:null }
        ],
        "Epi": [
          { id:1, line:"Epi", location:"Non-op vacuum header", description:"Very bent non-op vacuum header", action:"Repair or replace", department:"Engineering", responsible:"", dueDate:"", priority:"High", comments:"Film sucked into op vacuum header causing no seal on op side", status:"Not Started", photo:null },
          { id:2, line:"Epi", location:"Air system", description:"Heavy water in airlines", action:"Inspect filters, drains, dryer; correct moisture source", department:"Maintenance", responsible:"", dueDate:"", priority:"High", comments:"Caused stuck Airbar solenoid", status:"Not Started", photo:null },
          { id:3, line:"Epi", location:"X-ray interlock", description:"Auto-starts after safety reset; requires code entry", action:"Change logic so operator must manually start after reset", department:"Controls", responsible:"", dueDate:"", priority:"High", comments:"~2 min recovery + 2 people currently", status:"In Progress", photo:null },
          { id:4, line:"Epi", location:"Top heater assembly", description:"Not level and binding", action:"Verify level and spring tension", department:"Engineering", responsible:"", dueDate:"", priority:"Normal", comments:"Re-leveled this visit; springs at 12 lbs with binding", status:"Complete", photo:null }
        ]
      }
    };

    let data = null;
    let db = null;
    let editingId = null;
    let tempPhoto = null;
    let filterField = "any";
    let filterQuery = "";
    let plStatusFilters = [];
    let filterChipValue = "";

    const CARD_FIELDS = ["description","line","location","action","department","status","priority","responsible","dueDate","createdAt","comments"];
    const CHIP_FIELDS = {
      status: ["Not Started", "In Progress", "Complete", "Waiting Parts"],
      priority: ["High", "Normal", "Low"],
      department: ["Service", "Bakery", "Programming", "Engineering", "Sales", "Other"],
      line: null,
      createdAt: null
    };

    function nowStamp() {
      const d = new Date();
      const pad = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    function stampDate(v) {
      if (!v) return "";
      const s = String(v);
      return s.slice(0, 10);
    }

    function openDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = (e) => {
          const database = e.target.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
        req.onerror = (e) => reject(e.target.error);
      });
    }

    function idbGet(key) {
      return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("DB not open"));
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    function idbSet(key, value) {
      return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("DB not open"));
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }

    async function plLoadData() {
      try {
        await openDB();
        let saved = await idbGet("main");
        if (!saved) {
          try {
            const legacy = localStorage.getItem(LEGACY_KEY);
            if (legacy) {
              saved = JSON.parse(legacy);
              await idbSet("main", saved);
              toast("Data upgraded to larger storage");
            }
          } catch (e) {}
        }
        if (saved && saved.jobs && saved.currentJob) data = saved;
        else { data = JSON.parse(JSON.stringify(defaultData)); await plSaveData(); }
      } catch (e) {
        data = JSON.parse(JSON.stringify(defaultData));
        try { await openDB(); } catch (_) {}
      }
    }

    async function plSaveData() {
      try {
        if (!db) await openDB();
        await idbSet("main", data);
        return true;
      } catch (e) {
        try {
          localStorage.setItem(LEGACY_KEY, JSON.stringify(data));
          toast("Saved (fallback mode)");
          return true;
        } catch (e2) {
          toast("Storage full – remove photos or old jobs");
          return false;
        }
      }
    }

    function updateOnlineStatus() {
      const offline = !navigator.onLine;
      const offEl = document.getElementById("offline-badge");
      if (offEl) offEl.classList.toggle("show", offline);
      const onEl = document.getElementById("online-badge");
      if (onEl) onEl.style.display = "none";
      if (offline) toast("You are offline – changes still save on this device");
    }

    window.addEventListener("online", () => { updateOnlineStatus(); toast("Back online"); });
    window.addEventListener("offline", updateOnlineStatus);

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js?v=8").catch(() => {});
      });
    }

    function getItems() { return data.jobs[data.currentJob] || []; }
    function setItems(items) { data.jobs[data.currentJob] = items; plSaveData(); }

    function punchlistShowToast(msg) {
      const t = document.getElementById("toast");
      t.textContent = msg;
      t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 2200);
    }

    function statusBadgeClass(s) {
      if (s === "Not Started") return "badge-notstarted";
      if (s === "In Progress") return "badge-inprogress";
      if (s === "Complete") return "badge-complete";
      return "badge-waiting";
    }

    function deptClass(d) {
      const map = {
        "Service": "dept-Service",
        "Bakery": "dept-Bakery",
        "Programming": "dept-Programming",
        "Engineering": "dept-Engineering",
        "Sales": "dept-Sales"
      };
      return map[d] || "dept-Other";
    }

    function escapeHtml(str) {
      if (!str) return "";
      return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    function populateJobSelect() {
      const sel = document.getElementById("job-select");
      if (!sel || !data) return;
      // Prefer field-service jobs as the source of punchlist buckets
      try {
        const fieldJobs = (typeof loadJobs === "function" ? loadJobs() : []) || [];
        fieldJobs.forEach(job => {
          const key = (typeof punchlistKeyForJob === "function") ? punchlistKeyForJob(job) : (job.customer || job.id);
          if (!data.jobs[key]) data.jobs[key] = [];
          if (!data.jobIdByKey) data.jobIdByKey = {};
          data.jobIdByKey[key] = job.id;
        });
      } catch (e) {}
      const jobs = Object.keys(data.jobs);
      if (!jobs.length) {
        data.jobs["Default"] = [];
        data.currentJob = "Default";
        jobs.push("Default");
      }
      if (!data.currentJob || !data.jobs[data.currentJob]) data.currentJob = jobs[0];
      sel.innerHTML = jobs.map(j =>
        `<option value="${escapeHtml(j)}" ${j === data.currentJob ? "selected" : ""}>${escapeHtml(j)}</option>`
      ).join("");
    }

    function itemMatchesFilter(item) {
      if (plStatusFilters && plStatusFilters.length) {
        const st = String(item.status || "Not Started");
        if (!plStatusFilters.includes(st)) return false;
      }
      const q = (filterQuery || "").trim().toLowerCase();
      const chip = (filterChipValue || "").trim().toLowerCase();
      if (!q && !chip) return true;

      function fieldText(key) {
        if (key === "createdAt") {
          const raw = String(item.createdAt || "");
          return (raw + " " + stampDate(raw)).toLowerCase();
        }
        return String(item[key] == null ? "" : item[key]).toLowerCase();
      }

      if (filterField === "any") {
        const hay = CARD_FIELDS.map(fieldText).join(" ");
        return (!q || hay.includes(q)) && (!chip || hay.includes(chip));
      }

      const value = fieldText(filterField);
      if (chip && value !== chip) return false;
      if (q && !value.includes(q)) return false;
      return true;
    }

    function uniqueFieldValues(items, field) {
      const seen = new Set();
      const out = [];
      items.forEach(item => {
        const v = String(item[field] || "").trim();
        if (!v) return;
        const key = v.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(v);
      });
      return out.sort((a, b) => a.localeCompare(b));
    }

    function chipValuesForField(field) {
      const items = getItems();
      let values = CHIP_FIELDS[field];
      if (field === "line") values = uniqueFieldValues(items, "line");
      else if (field === "createdAt") {
        const seen = new Set();
        values = [];
        items.forEach(item => {
          const d = stampDate(item.createdAt);
          if (d && !seen.has(d)) { seen.add(d); values.push(d); }
        });
        values.sort().reverse();
      }
      else if (field === "department") {
        values = (CHIP_FIELDS.department || []).slice();
        uniqueFieldValues(items, "department").forEach(v => {
          if (!values.includes(v)) values.push(v);
        });
      }
      return values || [];
    }

    function updateFilterButton() {
      const active = !!(filterQuery.trim() || filterChipValue);
      document.getElementById("btn-filter").classList.toggle("active", active);
      const countEl = document.getElementById("filter-count");
      const items = getItems();
      const filtered = items.filter(itemMatchesFilter);
      if (active) {
        countEl.classList.add("show");
        countEl.textContent = filtered.length + " of " + items.length + " items";
      } else {
        countEl.classList.remove("show");
        countEl.textContent = "";
      }
    }

    function openFilterSheet() {
      const tb = document.getElementById("modal-trash");
      if (tb) tb.style.display = "none";
      const cam = document.getElementById("modal-camera");
      if (cam) cam.style.display = "none";
      document.getElementById("modal-title").textContent = "Filter";
      const chips = chipValuesForField(filterField);
      document.getElementById("modal-body").innerHTML = `
        <div class="form-group">
          <label>Field</label>
          <select id="f-filter-field">
            <option value="any"${filterField === "any" ? " selected" : ""}>Any field</option>
            <option value="description"${filterField === "description" ? " selected" : ""}>Description</option>
            <option value="line"${filterField === "line" ? " selected" : ""}>Line</option>
            <option value="location"${filterField === "location" ? " selected" : ""}>Location</option>
            <option value="action"${filterField === "action" ? " selected" : ""}>Action</option>
            <option value="department"${filterField === "department" ? " selected" : ""}>Department</option>
            <option value="status"${filterField === "status" ? " selected" : ""}>Status</option>
            <option value="priority"${filterField === "priority" ? " selected" : ""}>Priority</option>
            <option value="responsible"${filterField === "responsible" ? " selected" : ""}>Responsible</option>
            <option value="dueDate"${filterField === "dueDate" ? " selected" : ""}>Due date</option>
            <option value="createdAt"${filterField === "createdAt" ? " selected" : ""}>Created date</option>
            <option value="comments"${filterField === "comments" ? " selected" : ""}>Comments</option>
          </select>
        </div>
        <div class="form-group">
          <label>Contains</label>
          <input type="text" id="f-filter-query" value="${escapeHtml(filterQuery)}" placeholder="Type to filter">
        </div>
        <div class="filter-chips" id="filter-chips">${chips.map(v =>
          `<button type="button" class="filter-chip${filterChipValue === v ? " active" : ""}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`
        ).join("")}</div>
        <div class="btn-row">
          <button class="btn btn-outline" type="button" id="btn-filter-reset">Clear</button>
          <button class="btn btn-primary" type="button" id="btn-filter-apply">Apply</button>
        </div>
      `;
      document.getElementById("pl-modal").classList.add("show");

      const fieldSel = document.getElementById("f-filter-field");
      fieldSel.addEventListener("change", () => {
        filterField = fieldSel.value;
        filterChipValue = "";
        openFilterSheet();
      });
      document.getElementById("filter-chips").querySelectorAll(".filter-chip").forEach(btn => {
        btn.addEventListener("click", () => {
          const val = btn.dataset.value;
          filterChipValue = filterChipValue === val ? "" : val;
          document.querySelectorAll("#filter-chips .filter-chip").forEach(b => b.classList.toggle("active", b.dataset.value === filterChipValue));
        });
      });
      document.getElementById("btn-filter-apply").addEventListener("click", () => {
        filterField = document.getElementById("f-filter-field").value;
        filterQuery = document.getElementById("f-filter-query").value;
        closeModal();
        renderList();
      });
      document.getElementById("btn-filter-reset").addEventListener("click", () => {
        filterField = "any";
        filterQuery = "";
        filterChipValue = "";
        closeModal();
        renderList();
      });
    }

    function syncStatusChips() {
      const map = {
        "stat-open": "Not Started",
        "stat-progress": "In Progress",
        "stat-done": "Complete"
      };
      Object.keys(map).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle("on", plStatusFilters.indexOf(map[id]) >= 0);
      });
    }
    function onStatusChipTap(status) {
      const i = plStatusFilters.indexOf(status);
      if (i >= 0) plStatusFilters.splice(i, 1);
      else plStatusFilters.push(status);
      syncStatusChips();
      renderList();
    }
    ["stat-open","stat-progress","stat-done"].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.bound === "1") return;
      el.dataset.bound = "1";
      el.addEventListener("click", () => onStatusChipTap(el.getAttribute("data-filter") || ""));
    });
    function renderList() {
      const items = getItems();
      const list = document.getElementById("item-list");
      const filtered = items.filter(itemMatchesFilter).slice().sort((a, b) => {
        const rank = (item) => {
          if (String(item.status || "") === "Complete") return 2;
          if (String(item.priority || "") === "High") return 0;
          return 1;
        };
        return rank(a) - rank(b);
      });

      document.getElementById("stat-open").innerHTML = `<strong>${items.filter(i => i.status === "Not Started").length}</strong> Open`;
      document.getElementById("stat-progress").innerHTML = `<strong>${items.filter(i => i.status === "In Progress").length}</strong> In Progress`;
      document.getElementById("stat-done").innerHTML = `<strong>${items.filter(i => i.status === "Complete").length}</strong> Done`;
      if (typeof syncStatusChips === "function") syncStatusChips();
      updateFilterButton();

      if (items.length === 0) {
        list.innerHTML = `<div class="empty"><div class="empty-icon" style="display:flex;justify-content:center;margin-bottom:8px;color:var(--muted);opacity:0.85"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" aria-hidden="true"><rect x="4.2" y="3.2" width="15.6" height="17.6" rx="2.2" stroke="currentColor" stroke-width="0.9"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg></div><div>No items for this job</div></div>`;
        return;
      }

      if (filtered.length === 0) {
        list.innerHTML = `<div class="empty"><div class="empty-icon" style="display:flex;justify-content:center;margin-bottom:8px;color:var(--muted);opacity:0.85"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.2" stroke="currentColor" stroke-width="1.4"/><path d="M20 20l-3.6-3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></div><div>No items match this filter</div><div style="margin-top:8px;font-size:13px;opacity:0.8">Clear the filter or pick another field</div></div>`;
        return;
      }

      list.innerHTML = filtered.map(item => {
        const classes = ["pl-item"];
        if (item.status === "Complete") classes.push("list-complete");
        else if (item.priority === "High") classes.push("priority-high");
        return `
        <div class="${classes.join(" ")}" data-id="${item.id}" onclick="toggleItem(${item.id}, event)">
          <div class="list-item-main">
            <div class="title">${escapeHtml(item.description)}</div>
            <div class="sub">${escapeHtml(item.line)} · ${escapeHtml(item.location)}${item.dueDate ? " · " + item.dueDate : ""}${item.responsible ? " · " + escapeHtml(item.responsible) : ""}</div>
            <div class="action-line">→ ${escapeHtml(item.action)}</div>
            <span class="dept ${deptClass(item.department)}">${escapeHtml(item.department)}</span>
          </div>
          <div class="list-item-actions">
            <span class="badge ${statusBadgeClass(item.status)}">${item.status}</span>
            ${item.photo ? `<img class="list-item-photo" src="${item.photo}" alt="Item photo" onclick="openPunchlistPhoto(event, this.src)">` : ""}
          </div>
          <div class="list-item-detail">
            ${item.comments ? `<div class="detail-row"><strong>Comments</strong>${escapeHtml(item.comments)}</div>` : ""}
            ${item.responsible ? `<div class="detail-row"><strong>Responsible</strong>${escapeHtml(item.responsible)}</div>` : ""}
            ${item.dueDate ? `<div class="detail-row"><strong>Due</strong>${escapeHtml(item.dueDate)}</div>` : ""}
            ${item.photo ? `<img class="list-item-photo" src="${item.photo}" alt="Item photo" onclick="openPunchlistPhoto(event, this.src)">` : ""}

          </div>
        </div>
      `}).join("");
    }

    function toggleItem(id, ev) {
      if (ev && ev.target.closest("button, a, input, select, textarea, img.list-item-photo, .pl-photo-viewer")) return;
      openDetail(id);
    }

    function openPunchlistPhoto(ev, src) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      if (!src) return;
      const viewer = document.getElementById("pl-photo-viewer");
      const img = document.getElementById("pl-photo-viewer-img");
      if (!viewer || !img) return;
      img.src = src;
      viewer.hidden = false;
      viewer.setAttribute("aria-hidden", "false");
    }

    function closePunchlistPhoto(ev) {
      if (ev) ev.stopPropagation();
      const viewer = document.getElementById("pl-photo-viewer");
      const img = document.getElementById("pl-photo-viewer-img");
      if (img) img.removeAttribute("src");
      if (viewer) {
        viewer.hidden = true;
        viewer.setAttribute("aria-hidden", "true");
      }
    }

    document.getElementById("job-select").addEventListener("change", (e) => {
      data.currentJob = e.target.value;
      plSaveData();
      filterChipValue = "";
      renderList();
      try {
        if (typeof window.setLastPunchlistName === "function") window.setLastPunchlistName(data.currentJob);
        else localStorage.setItem("lx8_last_punchlist", data.currentJob);
      } catch (err) {}
      toast("Switched to " + data.currentJob);
    });

    document.getElementById("btn-filter").addEventListener("click", openFilterSheet);

    function openDetail(id) {
      const item = getItems().find(i => i.id === id);
      if (!item) return;
      editingId = id;
      tempPhoto = null;
      showForm(item, false);
    }

    function showForm(item, isNew) {
      document.getElementById("modal-title").textContent = isNew ? "New Item" : `Item #${item.id}`;
      const trashBtn = document.getElementById("modal-trash");
      if (trashBtn) {
        trashBtn.style.display = "none";
        trashBtn.onclick = null;
      }
      const camBtn = document.getElementById("modal-camera");
      if (camBtn) camBtn.style.display = "grid";
      document.getElementById("modal-body").innerHTML = `
        <div class="pl-photo-block">
          <div id="photo-preview-wrap" class="pl-photo-preview-wrap ${(item.photo || tempPhoto) ? '' : 'hidden'}">
            <img id="photo-preview" class="photo-preview" src="${tempPhoto || item.photo || ''}" alt="preview" onclick="if (this.src) openPunchlistPhoto(event, this.src)">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Line</label>
            <input type="text" id="f-line" value="${escapeHtml(item.line || '')}" placeholder="LH / RH / both">
          </div>
          <div class="form-group">
            <label>Priority</label>
            <select id="f-priority">
              <option ${item.priority === "Normal" ? "selected" : ""}>Normal</option>
              <option ${item.priority === "High" ? "selected" : ""}>High</option>
              <option ${item.priority === "Low" ? "selected" : ""}>Low</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Location</label>
          <input type="text" id="f-location" value="${escapeHtml(item.location || '')}" placeholder="e.g. Seal Unit">
        </div>
        <div class="form-group">
          <label>Description *</label>
          <textarea id="f-description" placeholder="What is the problem?">${escapeHtml(item.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Action</label>
          <textarea id="f-action" placeholder="What needs to be done?">${escapeHtml(item.action || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Department</label>
          <select id="f-department">
            <option ${item.department === "Service" ? "selected" : ""}>Service</option>
            <option ${item.department === "Bakery" ? "selected" : ""}>Bakery</option>
            <option ${item.department === "Programming" ? "selected" : ""}>Programming</option>
            <option ${item.department === "Engineering" ? "selected" : ""}>Engineering</option>
            <option ${item.department === "Sales" ? "selected" : ""}>Sales</option>
            <option ${item.department === "Other" ? "selected" : ""}>Other</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Responsible</label>
            <input type="text" id="f-responsible" value="${escapeHtml(item.responsible || '')}" placeholder="Name">
          </div>
          <div class="form-group">
            <label>Created</label>
            <input type="date" id="f-createdAt" value="${escapeHtml(stampDate(item.createdAt || nowStamp()))}">
          </div>
        </div>
        <div class="form-group pl-status-full">
          <label>Status</label>
          <select id="f-status">
            <option ${item.status === "Not Started" ? "selected" : ""}>Not Started</option>
            <option ${item.status === "In Progress" ? "selected" : ""}>In Progress</option>
            <option ${item.status === "Complete" ? "selected" : ""}>Complete</option>
            <option ${item.status === "Waiting Parts" ? "selected" : ""}>Waiting Parts</option>
          </select>
        </div>
        <div class="form-group">
          <label>Comments</label>
          <textarea id="f-comments" rows="4" placeholder="Notes">${escapeHtml(item.comments || '')}</textarea>
        </div>
        <button type="button" class="btn btn-outline pl-item-delete" id="btn-delete-item">Delete item</button>
        <div class="btn-row">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="saveItem()">${isNew ? 'Add Item' : 'Save'}</button>
        </div>
      `;
      document.getElementById("pl-modal").classList.add("show");
      const delBtn = document.getElementById("btn-delete-item");
      if (delBtn) {
        const idToDelete = item && item.id != null ? item.id : editingId;
        delBtn.addEventListener("click", function(e) {
          e.preventDefault();
          e.stopPropagation();
          deleteItem(idToDelete);
        });
      }
    }

    function handlePhoto(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        tempPhoto = ev.target.result;
        const preview = document.getElementById("photo-preview");
        const wrap = document.getElementById("photo-preview-wrap");
        if (preview) {
          preview.src = tempPhoto;
          preview.classList.remove("hidden");
        }
        if (wrap) wrap.classList.remove("hidden");
      };
      reader.readAsDataURL(file);
    }


    function requestDeletePunchlistPhoto(ev) {
      if (ev) ev.stopPropagation();
      pendingDeleteId = editingId || 'photo';
      pendingDeleteKind = 'punchlist-photo';
      document.getElementById('deleteModalTitle').textContent = 'Delete photo?';
      document.getElementById('deleteModalLabel').textContent = 'This photo will be removed from the item.';
      const modal = document.getElementById('deleteModal');
      modal.classList.remove('hidden');
      modal.classList.add('show');
    }
    function removePhoto() {
      tempPhoto = null;
      const preview = document.getElementById("photo-preview");
      const wrap = document.getElementById("photo-preview-wrap");
      if (preview) {
        preview.src = "";
        preview.classList.add("hidden");
      }
      if (wrap) wrap.classList.add("hidden");
      if (editingId) {
        const item = getItems().find(i => i.id === editingId);
        if (item) item.photo = null;
      }
    }

    document.getElementById("fab-add").addEventListener("click", () => {
      if (document.body.classList.contains("on-jobs-list")) {
        if (typeof openNewJob === "function") openNewJob();
        return;
      }
      editingId = null;
      tempPhoto = null;
      showForm({ line:"", location:"", description:"", action:"", department:"Service", responsible:"", dueDate:"", createdAt: nowStamp(), priority:"Normal", comments:"", status:"Not Started", photo:null }, true);
    });

    function saveItem() {
      const formData = {
        line: document.getElementById("f-line").value.trim(),
        location: document.getElementById("f-location").value.trim(),
        description: document.getElementById("f-description").value.trim(),
        action: document.getElementById("f-action").value.trim(),
        department: document.getElementById("f-department").value,
        responsible: document.getElementById("f-responsible").value.trim(),
        dueDate: editingId ? ((getItems().find(i => i.id === editingId) || {}).dueDate || "") : "",
        priority: document.getElementById("f-priority").value,
        comments: document.getElementById("f-comments").value.trim(),
        createdAt: (document.getElementById("f-createdAt") && document.getElementById("f-createdAt").value) || nowStamp(),
        status: document.getElementById("f-status").value,
        photo: tempPhoto !== null ? tempPhoto : (editingId ? (getItems().find(i => i.id === editingId)?.photo || null) : null)
      };
      if (!formData.description) { alert("Description is required"); return; }

      let items = getItems();
      if (editingId) {
        const idx = items.findIndex(i => i.id === editingId);
        items[idx] = { ...items[idx], ...formData };
        toast("Item updated");
      } else {
        const newId = items.length ? Math.max(...items.map(i => i.id)) + 1 : 1;
        items.push({ id: newId, ...formData });
        toast("Item added");
      }
      setItems(items);
      closeModal();
      renderList();
    }

    function deleteItem(id) {
      const targetId = (id !== undefined && id !== null && id !== "") ? id : editingId;
      if (targetId === undefined || targetId === null || targetId === "") {
        closeModal();
        toast("Item discarded");
        return;
      }
      pendingDeleteId = targetId;
      pendingDeleteKind = "punchlist-item";
      document.getElementById("deleteModalTitle").textContent = "Delete item?";
      document.getElementById("deleteModalLabel").textContent =
        "This punchlist item will be permanently deleted.";
      const modal = document.getElementById("deleteModal");
      modal.classList.remove("hidden");
      modal.classList.add("show");
      modal.setAttribute("aria-hidden", "false");
    }

    function performDeletePunchlistItem(id) {
      const targetId = (id !== undefined && id !== null && id !== "") ? id : editingId;
      if (targetId === undefined || targetId === null || targetId === "") {
        closeDeleteModal();
        return;
      }
      const items = getItems();
      const next = items.filter(i => String(i.id) !== String(targetId));
      setItems(next);
      closeDeleteModal();
      closeModal();
      renderList();
      toast("Item deleted");
    }
    window.performDeletePunchlistItem = performDeletePunchlistItem;
    window.deleteItem = deleteItem;

    function closeModal() {
      const overlay = document.getElementById("pl-modal");
      const sheet = document.getElementById("modal-sheet");
      overlay.classList.remove("show");
      if (sheet) {
        sheet.style.transform = "";
        sheet.classList.remove("dragging");
      }
      overlay.style.background = "";
      editingId = null;
      tempPhoto = null;
      const tb = document.getElementById("modal-trash");
      if (tb) tb.style.display = "none";
    }

    document.getElementById("pl-modal").addEventListener("click", (e) => { if (e.target.id === "pl-modal") closeModal(); });

    // Trash button uses onclick set in showForm (avoids double-binding)

    // Swipe down to close modal sheet
    (function setupSwipeClose() {
      const sheet = document.getElementById("modal-sheet");
      const overlay = document.getElementById("pl-modal");
      if (!sheet || !overlay) return;

      let startY = 0;
      let currentY = 0;
      let dragging = false;

      function onStart(y) {
        // Only start drag near the top of the sheet (handle / header area)
        startY = y;
        currentY = 0;
        dragging = true;
        sheet.classList.add("dragging");
      }

      function onMove(y) {
        if (!dragging) return;
        currentY = Math.max(0, y - startY);
        sheet.style.transform = `translateY(${currentY}px)`;
        overlay.style.background = `rgba(0,0,0,${Math.max(0.25, 0.72 - currentY / 600)})`;
      }

      function onEnd() {
        if (!dragging) return;
        dragging = false;
        sheet.classList.remove("dragging");
        if (currentY > 120) {
          sheet.style.transform = "translateY(100%)";
          setTimeout(() => {
            closeModal();
            sheet.style.transform = "";
            overlay.style.background = "";
          }, 180);
        } else {
          sheet.style.transform = "";
          overlay.style.background = "";
        }
        currentY = 0;
      }

      sheet.addEventListener("touchstart", (e) => {
        const t = e.touches[0];
        const rect = sheet.getBoundingClientRect();
        // Allow swipe from top 80px of sheet
        if (t.clientY - rect.top < 80) onStart(t.clientY);
      }, { passive: true });

      sheet.addEventListener("touchmove", (e) => {
        if (!dragging) return;
        onMove(e.touches[0].clientY);
      }, { passive: true });

      sheet.addEventListener("touchend", onEnd);
      sheet.addEventListener("touchcancel", onEnd);
    })();

    const btnJobs = document.getElementById("btn-jobs");
    if (btnJobs) btnJobs.addEventListener("click", () => {
      const jobNames = Object.keys(data.jobs);
      document.getElementById("modal-title").textContent = "Manage Jobs";
      const tb = document.getElementById("modal-trash"); if (tb) tb.style.display = "none";
      const cam = document.getElementById("modal-camera"); if (cam) cam.style.display = "none";
      document.getElementById("modal-body").innerHTML = `
        <div class="job-manage-list">
          ${jobNames.map(j => `
            <div class="job-manage-item">
              <span>${escapeHtml(j)} ${j === data.currentJob ? "(current)" : ""}</span>
              ${jobNames.length > 1 ? `
                <button type="button" class="icon-btn danger" data-job="${escapeHtml(j)}" title="Delete job">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M10 11v6M14 11v6"/></svg>
                </button>` : ''}
            </div>
          `).join("")}
        </div>
        <div class="form-group">
          <label>New Job Name</label>
          <input type="text" id="new-job-name" placeholder="e.g. Customer / Line name">
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Close</button>
          <button class="btn btn-primary" onclick="addJob()">Add Job</button>
        </div>
      `;
      document.getElementById("pl-modal").classList.add("show");
      document.querySelectorAll("#modal-body [data-job]").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const name = btn.getAttribute("data-job");
          if (name) deleteJob(name);
        });
      });
    });

    function addJob() {
      const name = document.getElementById("new-job-name").value.trim();
      if (!name) { alert("Enter a job name"); return; }
      if (data.jobs[name]) { alert("A job with that name already exists"); return; }
      data.jobs[name] = [];
      data.currentJob = name;
      plSaveData();
      populateJobSelect();
      closeModal();
      renderList();
      toast("Job created: " + name);
    }

    function deleteJob(name) {
      if (!name || !data.jobs[name]) {
        toast("Job not found");
        return;
      }
      if (!confirm("Delete job \"" + name + "\" and all its items?")) return;
      delete data.jobs[name];
      if (data.currentJob === name) {
        const remaining = Object.keys(data.jobs);
        data.currentJob = remaining[0] || "";
      }
      plSaveData();
      populateJobSelect();
      closeModal();
      renderList();
      toast("Job deleted");
    }
    window.deleteJob = deleteJob;
    window.deleteItem = deleteItem;
    window.handlePhoto = handlePhoto;
    window.removePhoto = removePhoto;
    window.requestDeletePunchlistPhoto = requestDeletePunchlistPhoto;
    window.openPunchlistPhoto = openPunchlistPhoto;
    window.closePunchlistPhoto = closePunchlistPhoto;
    window.closeModal = closeModal;
    window.saveItem = saveItem;
    window.openDetail = openDetail;
    window.addJob = addJob;
    window.toggleItem = toggleItem;
    window.renderList = renderList;
    window.plRenderList = renderList;
    window.plLoadData = plLoadData;
    window.populateJobSelect = populateJobSelect;
    window.openPunchlistForJob = async function(job) {
      await plLoadData();
      if (!data) data = { jobs: {}, currentJob: '' };
      if (!data.jobs) data.jobs = {};
      if (job) {
        const site = (job.site || '').trim();
        const key = site ? ((job.customer || 'Job') + ' – ' + site) : (job.customer || 'Job');
        if (!data.jobs[key]) data.jobs[key] = [];
        data.currentJob = key;
        if (!data.jobIdByKey) data.jobIdByKey = {};
        data.jobIdByKey[key] = job.id;
        if (!data.keyByJobId) data.keyByJobId = {};
        data.keyByJobId[job.id] = key;
      } else {
        const key = 'General';
        if (!data.jobs[key]) data.jobs[key] = [];
        data.currentJob = key;
      }
      await plSaveData();
      populateJobSelect();
      renderList();
      try {
        if (typeof window.setLastPunchlistName === 'function') window.setLastPunchlistName(data.currentJob);
        else localStorage.setItem('lx8_last_punchlist', data.currentJob);
      } catch (e) {}
      return data.currentJob;
    };
    window.getPunchlistStatsForJob = async function(jobOrName) {
      await plLoadData();
      if (!data || !data.jobs) return { total: 0, open: 0, complete: 0 };
      const name = typeof jobOrName === 'string' ? jobOrName : (jobOrName && (jobOrName.customer && jobOrName.site ? (jobOrName.customer + ' – ' + jobOrName.site) : (jobOrName.customer || '')));
      const keys = Object.keys(data.jobs);
      const key = keys.find(k => k === name) || keys.find(k => jobOrName && data.jobIdByKey && data.jobIdByKey[k] === jobOrName.id) || keys.find(k => jobOrName && k.indexOf(jobOrName.customer || '') === 0);
      const items = key ? (data.jobs[key] || []) : [];
      const complete = items.filter(i => i && i.status === 'Complete').length;
      return { total: items.length, open: items.length - complete, complete };
    };
    window.searchPunchlistItems = async function(q) {
      await plLoadData();
      const needle = String(q || "").trim().toLowerCase();
      if (!needle || !data || !data.jobs) return [];
      const out = [];
      Object.keys(data.jobs).forEach(name => {
        (data.jobs[name] || []).forEach(item => {
          if (!item) return;
          const hay = [item.description, item.action, item.location, item.line, item.comments, item.department, item.status, name]
            .map(x => String(x || "").toLowerCase()).join(" ");
          if (hay.indexOf(needle) >= 0) {
            out.push({
              job: name,
              id: item.id,
              description: item.description || "Punchlist item",
              status: item.status || "",
              location: item.location || "",
              line: item.line || ""
            });
          }
        });
      });
      return out.slice(0, 30);
    };
    window.openPunchlistItem = async function(jobName, itemId) {
      await window.openPunchlistByName(jobName);
      if (typeof openDetail === "function") openDetail(itemId);
    };
    window.getPunchlistSummaries = async function() {
      await plLoadData();
      if (!data || !data.jobs) return [];
      return Object.keys(data.jobs).map(name => {
        const items = data.jobs[name] || [];
        const complete = items.filter(i => i && i.status === 'Complete').length;
        return { name, total: items.length, complete };
      }).sort((a, b) => {
        // Prefer non-empty, then alpha
        if ((b.total > 0) !== (a.total > 0)) return b.total > 0 ? 1 : -1;
        return String(a.name).localeCompare(String(b.name));
      });
    };
    window.openPunchlistByName = async function(name) {
      await plLoadData();
      if (!data) data = { jobs: {}, currentJob: '' };
      if (!data.jobs) data.jobs = {};
      if (!data.jobs[name]) data.jobs[name] = [];
      data.currentJob = name;
      await plSaveData();
      populateJobSelect();
      renderList();
      try {
        if (typeof window.setLastPunchlistName === 'function') window.setLastPunchlistName(name);
        else localStorage.setItem('lx8_last_punchlist', name);
      } catch (e) {}
      return name;
    };
    window.getPunchlistBackup = function() {
      return JSON.parse(JSON.stringify(data));
    };
    window.setPunchlistBackup = async function(saved) {
      if (!saved || !saved.jobs) throw new Error('bad-punchlist');
      data = saved;
      if (!data.currentJob || !data.jobs[data.currentJob]) {
        const names = Object.keys(data.jobs);
        data.currentJob = names[0] || "Default";
        if (!data.jobs[data.currentJob]) data.jobs[data.currentJob] = [];
      }
      await plSaveData();
      populateJobSelect();
      renderList();
      return true;
    };

    const PUNCHLIST_TEMPLATE_B64 = "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";

    function b64ToArrayBuffer(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }

    async function getStoredTemplateBuffer() {
      const buf = b64ToArrayBuffer(PUNCHLIST_TEMPLATE_B64);
      try { await idbSet("templateXlsx", buf); } catch (e) {}
      return buf;
    }

    function loadScriptOnce(src) {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-lib-src="' + src + '"]');
        if (existing) {
          if (existing.getAttribute('data-loaded') === '1') return resolve();
          existing.addEventListener('load', () => resolve());
          existing.addEventListener('error', () => reject(new Error('Failed ' + src)));
          return;
        }
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.setAttribute('data-lib-src', src);
        s.onload = () => { s.setAttribute('data-loaded', '1'); resolve(); };
        s.onerror = () => reject(new Error('Failed ' + src));
        document.head.appendChild(s);
      });
    }

    async function ensureExcelLibs() {
      if (typeof ExcelJS !== 'undefined') return;
      const urls = [
        'vendor/exceljs.min.js',
        'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'
      ];
      for (const url of urls) {
        try {
          await loadScriptOnce(url);
          if (typeof ExcelJS !== 'undefined') return;
        } catch (e) {}
      }
    }

    async function downloadBlob(blob, filename) {
      const type = blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const file = new File([blob], filename, { type });
      try {
        if (navigator.share) {
          if (!navigator.canShare || navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename });
            return true;
          }
        }
      } catch (e) {
        if (e && e.name === "AbortError") return true;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} a.remove(); }, 4000);
      return true;
    }


    function exportPunchlistPdf() {
      if (typeof window.jspdf === 'undefined') {
        toast('PDF library still loading… try again in a moment');
        return;
      }
      const items = getItems();
      const jobName = data.currentJob || 'Punchlist';
      const jobs = (typeof loadJobs === 'function') ? loadJobs() : [];
      const job = jobs.find(j => j && (j.id === jobName || (typeof jobDisplayName === 'function' && jobDisplayName(j) === jobName) || j.customer === jobName)) || null;
      const customer = (job && job.customer) || jobName || 'Customer';
      const site = (job && job.site) || '';
      const tech = (job && job.technician) || '';
      const dateRange = (typeof formatJobDateRange === 'function' && job) ? formatJobDateRange(job) : '';
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const L = 10;

      function paintChrome() {
        doc.setFillColor(20, 20, 24);
        doc.rect(0, 0, W, 8, 'F');
        doc.setFillColor(212, 34, 59);
        doc.rect(0, 0, 2.6, 8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('LeMatic  ·  Field Service Report', 8, 5.4);
        doc.setFont('helvetica', 'normal');
        doc.text((customer + (dateRange ? '  ·  ' + dateRange : '')).substring(0, 70), W - 8, 5.4, { align: 'right' });
        doc.setFillColor(244, 245, 247);
        doc.rect(0, H - 8, W, 8, 'F');
        doc.setTextColor(92, 101, 112);
        doc.setFontSize(7);
        doc.text('Punchlist  ·  Customer copy', 8, H - 3.2);
        const page = doc.internal.getCurrentPageInfo().pageNumber;
        doc.text('Page ' + page, W - 8, H - 3.2, { align: 'right' });
      }
      paintChrome();

      doc.setFillColor(20, 20, 24);
      doc.rect(L, 12, W - 20, 18, 'F');
      doc.setTextColor(243, 179, 188);
      doc.setFontSize(7);
      doc.text('PUNCHLIST', L + 4, 17.5);
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(String(customer).substring(0, 48), L + 4, 24);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(208, 213, 219);
      const sub = [site, dateRange, tech].filter(Boolean).join('  ·  ');
      if (sub) doc.text(sub, L + 70, 24);
      try {
        if (typeof LEMATIC_LOGO_JPG === 'string' && LEMATIC_LOGO_JPG) {
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(W - 10 - 32, 14.2, 30, 10, 1, 1, 'F');
          doc.addImage('data:image/jpeg;base64,' + LEMATIC_LOGO_JPG, 'JPEG', W - 10 - 30.6, 15, 27.2, 8.4);
        }
      } catch (e) {}

      function normStatus(s) {
        const v = String(s || '').trim().toLowerCase();
        if (v === 'complete' || v === 'done' || v === 'completed') return 'Complete';
        if (v === 'in progress' || v === 'progress') return 'In Progress';
        if (v.indexOf('waiting') >= 0) return 'Waiting Parts';
        return String(s || '').trim() || 'Not Started';
      }

      const head = [['Item', 'Line', 'Location', 'Description', 'Action', 'Department', 'Comments', 'Status']];
      const body = (items.length ? items : [{}]).map((item, idx) => [
        idx + 1,
        item.line || '',
        item.location || '',
        item.description || '',
        item.action || '',
        item.department || '',
        item.comments || '',
        normStatus(item.status)
      ]);

      if (typeof doc.autoTable === 'function') {
        doc.autoTable({
          head: head,
          body: body,
          startY: 34,
          theme: 'grid',
          styles: {
            font: 'helvetica',
            fontSize: 8,
            cellPadding: 1.6,
            valign: 'middle',
            textColor: [20, 20, 24],
            lineColor: [200, 204, 210],
            lineWidth: 0.2,
            overflow: 'linebreak'
          },
          headStyles: {
            fillColor: [20, 20, 24],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8
          },
          columnStyles: {
            0: { cellWidth: 12, halign: 'center' },
            1: { cellWidth: 22 },
            2: { cellWidth: 28 },
            3: { cellWidth: 58 },
            4: { cellWidth: 50 },
            5: { cellWidth: 26 },
            6: { cellWidth: 50 },
            7: { cellWidth: 24 }
          },
          didParseCell: function (data) {
            if (data.section !== 'body') return;
            const status = String(data.row.raw[7] || '').toLowerCase();
            const pri = String((items[data.row.index] || {}).priority || '').toLowerCase();
            if (data.column.index === 7) {
              if (status === 'complete') data.cell.styles.textColor = [27, 122, 74];
              else if (status === 'in progress') data.cell.styles.textColor = [10, 132, 255];
              else if (status.indexOf('waiting') >= 0) data.cell.styles.textColor = [184, 134, 11];
              data.cell.styles.fontStyle = 'bold';
            }
            if (pri === 'high' || pri === 'critical') {
              data.cell.styles.fillColor = [252, 232, 234];
            }
          },
          didDrawPage: function () { paintChrome(); }
        });
      } else {
        doc.setTextColor(20, 20, 24);
        doc.setFontSize(10);
        doc.text('Punchlist table requires the PDF table plugin.', L, 40);
      }

      const safe = String(jobName).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Punchlist';
      doc.save(safe + ' Punchlist.pdf');
      toast('Punchlist PDF downloaded');
    }


    async function exportPunchlistExcel() {
      const items = getItems();
      const jobName = data.currentJob || "Punchlist";
      const safeName = jobName.replace(/[\\/:*?"<>|]/g, "-").trim() || "Punchlist";
      const filename = safeName + " Punchlist.xlsx";

      function normStatus(s) {
        const v = String(s || "").trim().toLowerCase();
        if (v === "complete" || v === "done" || v === "completed") return "Complete";
        if (v === "in progress" || v === "progress") return "In Progress";
        if (v === "waiting parts" || v === "waiting part" || v === "parts") return "Waiting Parts";
        return "Not Started";
      }
      function solid(argb) {
        return { type: "pattern", pattern: "solid", fgColor: { argb: argb } };
      }

      await ensureExcelLibs();
      if (typeof ExcelJS === "undefined") { toast("Excel library not available"); return; }

      const templateBuf = await getStoredTemplateBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(templateBuf);
      const ws = wb.worksheets[0];
      const firstDataRow = 6;
      const lastTemplateRow = 50;
      const used = Math.max(items.length, 1);

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const row = ws.getRow(firstDataRow + idx);
        const status = normStatus(item.status);
        const dept = String(item.department || "").trim();
        row.getCell(1).value = idx + 1;
        row.getCell(2).value = item.line || "";
        row.getCell(3).value = item.location || "";
        row.getCell(4).value = item.description || "";
        row.getCell(5).value = item.action || "";
        row.getCell(6).value = dept;
        row.getCell(7).value = item.comments || "";
        row.getCell(8).value = status;
        for (let c = 2; c <= 7; c++) {
          const cell = row.getCell(c);
          cell.alignment = Object.assign({}, cell.alignment || {}, { wrapText: true, vertical: "top" });
        }
        const text = [item.description, item.action, item.comments].join(" ");
        const lines = Math.max(1, Math.ceil(String(text).length / 42));
        row.height = Math.min(72, Math.max(row.height || 18, 18 + lines * 12));
      }

      if (!items.length) {
        const row = ws.getRow(firstDataRow);
        row.getCell(1).value = 1;
        for (let c = 2; c <= 8; c++) row.getCell(c).value = "";
      }

      const deleteFrom = firstDataRow + used;
      const deleteCount = lastTemplateRow - deleteFrom + 1;
      if (deleteCount > 0 && typeof ws.spliceRows === "function") {
        ws.spliceRows(deleteFrom, deleteCount);
      }

      if (ws.conditionalFormattings && ws.conditionalFormattings.length) {
        const last = firstDataRow + used - 1;
        ws.conditionalFormattings.forEach((cf) => {
          if (!cf || !cf.ref) return;
          const ref = String(cf.ref);
          if (ref.indexOf("F6") === 0) cf.ref = "F6:F" + last;
          if (ref.indexOf("H6") === 0) cf.ref = "H6:H" + last;
        });
      }

      const out = await wb.xlsx.writeBuffer();
      const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
      toast("Excel ready — use Save to Files if asked");
    }


    function openPlExportSheet() {
      const sheet = document.getElementById('plExportSheet');
      if (!sheet) return;
      sheet.hidden = false;
      sheet.removeAttribute('hidden');
      sheet.classList.add('show');
    }
    function closePlExportSheet() {
      const sheet = document.getElementById('plExportSheet');
      if (!sheet) return;
      sheet.classList.remove('show');
      sheet.hidden = true;
      sheet.setAttribute('hidden', '');
    }
    document.getElementById("btn-export").addEventListener("click", () => {
      openPlExportSheet();
    });
    const plExportPdf = document.getElementById('plExportPdf');
    if (plExportPdf) plExportPdf.addEventListener('click', () => {
      closePlExportSheet();
      exportPunchlistPdf();
    });
    const plExportXlsx = document.getElementById('plExportXlsx');
    if (plExportXlsx) plExportXlsx.addEventListener('click', () => {
      closePlExportSheet();
      exportPunchlistExcel().catch(err => {
        console.warn(err);
        toast("Could not build Excel file");
      });
    });
    const plExportCancel = document.getElementById('plExportCancel');
    if (plExportCancel) plExportCancel.addEventListener('click', closePlExportSheet);

    async function initPunchlist() {
      await plLoadData();
      populateJobSelect();
      renderList();
      updateOnlineStatus();
      try {
        if (data && data.currentJob) {
          if (typeof window.setLastPunchlistName === 'function') window.setLastPunchlistName(data.currentJob);
          else localStorage.setItem('lx8_last_punchlist', JSON.stringify(data.currentJob));
        }
      } catch (e) {}
    }
    window.initPunchlist = initPunchlist;
    initPunchlist().catch(err => console.warn('Punchlist init', err));
  
    })();
  