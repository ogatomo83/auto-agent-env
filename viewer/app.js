(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  const DOCS_DIR = 'docs/';
  const POLL_MS = 2000;
  const state = { docs: [], current: null, text: null, parsed: null, refs: new Map() };

  /* ---------- theme ---------- */
  const themes = ['auto', 'light', 'dark'];
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    $('#themeBtn').title = `テーマ: ${t}`;
  }
  let theme = store.get('theme') || 'auto';
  applyTheme(theme);
  $('#themeBtn').onclick = () => {
    theme = themes[(themes.indexOf(theme) + 1) % themes.length];
    store.set('theme', theme === 'auto' ? null : theme);
    applyTheme(theme);
  };

  /* ---------- nav (mobile) ---------- */
  const closeNav = () => { document.body.classList.remove('nav-open'); $('#scrim').hidden = true; };
  $('#menuBtn').onclick = () => {
    const open = document.body.classList.toggle('nav-open');
    $('#scrim').hidden = !open;
  };
  $('#scrim').onclick = closeNav;
  $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) closeNav(); });

  /* ---------- documents ---------- */
  async function listDocs() {
    try {
      const res = await fetch(DOCS_DIR, { cache: 'no-store' });
      const html = await res.text();
      const names = [...html.matchAll(/href="([^"?#]+\.md)"/g)].map((m) => decodeURIComponent(m[1]).split('/').pop());
      return [...new Set(names)].sort();
    } catch { return state.docs; }
  }

  const titles = new Map();
  async function loadTitles(names) {
    await Promise.all(names.filter((n) => !titles.has(n)).map(async (n) => {
      try {
        const head = (await fetchText(n)).slice(0, 2000);
        const m = head.match(/^---[\s\S]*?^title:\s*(.+)$/m) || head.match(/^#\s+(.+)$/m);
        titles.set(n, m ? m[1].trim() : n.replace(/\.md$/, ''));
      } catch { /* ignore */ }
    }));
    renderDocList();
  }

  function renderDocList() {
    $('#docs').innerHTML = state.docs.map((d) => {
      const label = (d === state.current && state.parsed && state.parsed.title) || titles.get(d) || d.replace(/\.md$/, '');
      return `<li><a href="?doc=${encodeURIComponent(d)}" class="${d === state.current ? 'current' : ''}">${escapeHtml(label)}</a></li>`;
    }).join('') || '<li class="muted">docs/ に .md がありません</li>';
  }

  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function fetchText(name) {
    const res = await fetch(DOCS_DIR + encodeURIComponent(name), { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.text();
  }

  function renderDoc(text, keepScroll) {
    const y = window.scrollY;
    const p = MD.parse(text);
    state.parsed = p;
    state.refs = new Map(p.refs.map((r) => [r.id, r]));
    const m = p.meta;
    const eyebrow = [
      m.date && `<span>📅 ${escapeHtml(m.date)}</span>`,
      `<span>${p.toc.filter((t) => t.level === 2).length} 節</span>`,
      `<span>出典 ${p.refs.length} 件</span>`,
    ].filter(Boolean).join('');
    const legend = Object.entries(p.tags).map(([k, t]) =>
      `<div><span class="tag tag-${k}">${escapeHtml(t.label)}</span><span>${escapeHtml(t.desc)}</span></div>`).join('');
    const warnings = p.warnings.length
      ? `<div class="warnings"><strong>構文チェック</strong><ul>${p.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>` : '';
    $('#doc').innerHTML = `<header class="doc-head"><div class="eyebrow">${eyebrow}</div><h1>${escapeHtml(p.title || state.current)}</h1>` +
      (m.description ? `<p class="desc">${escapeHtml(m.description)}</p>` : '') +
      (legend ? `<div class="legend">${legend}</div>` : '') + warnings + `</header>` + p.html;
    document.title = p.title || 'Research Notes';
    $('#brand').textContent = p.title || 'Research Notes';
    $('#toc').innerHTML = p.toc.filter((t) => t.level >= 2).map((t) =>
      `<li class="l${t.level}"><a href="#${t.id}" data-id="${t.id}">${escapeHtml(t.text)}</a></li>`).join('');
    enhance();
    renderDocList();
    if (keepScroll) window.scrollTo(0, y);
    else if (location.hash) { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView(); }
    if ($('#q').value) runSearch($('#q').value, false);
  }

  async function openDoc(name, keepScroll) {
    state.current = name;
    try {
      const text = await fetchText(name);
      state.text = text;
      renderDoc(text, keepScroll);
      setLive(true);
    } catch (e) {
      $('#doc').innerHTML = `<p class="muted">読み込めませんでした: ${escapeHtml(name)} (${escapeHtml(String(e.message))})</p>`;
      setLive(false);
    }
  }

  /* ---------- enhancements ---------- */
  function enhance() {
    // backlinks on references
    $$('ol.refs li').forEach((li) => {
      const id = li.dataset.ref;
      const cites = $$(`sup.cite a[data-ref="${CSS.escape(id)}"]`);
      if (!cites.length) return;
      const backs = document.createElement('div');
      backs.className = 'backs';
      backs.innerHTML = cites.map((a, i) => {
        const h = sectionOf(a);
        return `<a href="#${a.id}" title="${escapeHtml(h || '')}">↩ ${i + 1}${h ? ' ' + escapeHtml(h.slice(0, 14)) : ''}</a>`;
      }).join('');
      li.querySelector('.reftext').appendChild(backs);
    });
    // copy buttons
    $$('pre.code').forEach((pre) => {
      const b = document.createElement('button');
      b.className = 'copy'; b.textContent = 'コピー';
      b.onclick = () => navigator.clipboard?.writeText(pre.innerText.replace(/コピー$/, '')).then(() => { b.textContent = 'コピー済'; setTimeout(() => (b.textContent = 'コピー'), 1200); });
      pre.appendChild(b);
    });
    setupSpy();
  }

  function sectionOf(el) {
    let n = el;
    while (n && n.parentElement && n.parentElement.id !== 'doc') n = n.parentElement;
    for (let s = n; s; s = s.previousElementSibling) if (/^H[23]$/.test(s.tagName)) return s.textContent.replace(/^#/, '');
    return '';
  }

  /* ---------- scrollspy & progress ---------- */
  let spy;
  function setupSpy() {
    if (spy) spy.disconnect();
    const links = new Map($$('#toc a').map((a) => [a.dataset.id, a]));
    const visible = new Set();
    spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id)));
    }, { rootMargin: '-60px 0px -70% 0px' });
    const heads = $$('#doc h2[id], #doc h3[id]');
    heads.forEach((h) => spy.observe(h));
    const update = () => {
      let cur = null;
      for (const h of heads) { if (h.getBoundingClientRect().top < 120) cur = h.id; else break; }
      links.forEach((a, id) => a.classList.toggle('active', id === cur));
      const act = links.get(cur);
      if (act && !isInView(act, $('#sidebar'))) act.scrollIntoView({ block: 'nearest' });
    };
    window.onscroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      $('#progress').style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
      update();
      hidePop();
    };
    window.onscroll();
  }
  function isInView(el, box) {
    const a = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    return a.top >= b.top && a.bottom <= b.bottom;
  }

  /* ---------- citation popover ---------- */
  const pop = $('#pop');
  let popTimer, pinned = false;
  function showPop(a) {
    const r = state.refs.get(a.dataset.ref);
    if (!r) return;
    clearTimeout(popTimer);
    pop.innerHTML = `<span class="pn">[${r.n}]</span>${r.html}<br><a class="pj" href="#ref-${r.id}">出典一覧へ ↓</a>`;
    pop.hidden = false;
    const ar = a.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = Math.min(Math.max(16, ar.left + ar.width / 2 - pw / 2), innerWidth - pw - 16);
    let top = ar.bottom + 8;
    if (top + ph > innerHeight - 8) top = ar.top - ph - 8;
    pop.style.left = left + 'px'; pop.style.top = Math.max(8, top) + 'px';
  }
  function hidePop(delay) {
    clearTimeout(popTimer);
    if (delay) popTimer = setTimeout(() => { if (!pinned) pop.hidden = true; }, delay);
    else { pop.hidden = true; pinned = false; }
  }
  document.addEventListener('pointerover', (e) => {
    const a = e.target.closest('sup.cite a');
    if (a && e.pointerType === 'mouse') { pinned = false; showPop(a); }
    else if (e.target.closest('#pop')) clearTimeout(popTimer);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (e.target.closest('sup.cite a') || e.target.closest('#pop')) hidePop(250);
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('sup.cite a');
    if (a && matchMedia('(hover: none)').matches) { e.preventDefault(); pinned = true; showPop(a); return; }
    if (!e.target.closest('#pop')) hidePop();
    else if (e.target.closest('.pj')) hidePop();
  });
  document.addEventListener('focusin', (e) => { const a = e.target.closest('sup.cite a'); if (a) showPop(a); });

  /* ---------- search ---------- */
  let hits = [], hitIdx = -1, searchTimer;
  function clearMarks() {
    $$('mark.hit').forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
    $('#doc').normalize();
    hits = []; hitIdx = -1; $('#qcount').textContent = '';
  }
  function runSearch(q, jump = true) {
    clearMarks();
    q = q.trim();
    if (!q) return;
    const lower = q.toLowerCase();
    const walker = document.createTreeWalker($('#doc'), NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('.anchor, .copy') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const t = n.nodeValue, tl = t.toLowerCase();
      let idx = tl.indexOf(lower);
      if (idx < 0) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      while (idx >= 0) {
        frag.append(t.slice(last, idx));
        const m = document.createElement('mark');
        m.className = 'hit'; m.textContent = t.slice(idx, idx + q.length);
        frag.append(m); hits.push(m);
        last = idx + q.length;
        idx = tl.indexOf(lower, last);
      }
      frag.append(t.slice(last));
      n.replaceWith(frag);
    }
    $('#qcount').textContent = hits.length ? `0/${hits.length}` : '0件';
    if (jump && hits.length) step(1);
  }
  function step(d) {
    if (!hits.length) return;
    if (hits[hitIdx]) hits[hitIdx].classList.remove('cur');
    hitIdx = (hitIdx + d + hits.length) % hits.length;
    hits[hitIdx].classList.add('cur');
    hits[hitIdx].scrollIntoView({ block: 'center' });
    $('#qcount').textContent = `${hitIdx + 1}/${hits.length}`;
  }
  $('#q').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(e.target.value), 180); });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.target.value = ''; clearMarks(); e.target.blur(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
  });

  /* ---------- hash flash ---------- */
  window.addEventListener('hashchange', () => {
    const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!t) return;
    const el = t.closest('li') || t;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  });

  /* ---------- live reload ---------- */
  function setLive(ok) {
    const el = $('#live');
    el.classList.toggle('off', !ok);
    el.title = ok ? 'ライブ更新中（mdを保存すると自動で反映）' : 'サーバーに接続できません';
  }
  async function poll() {
    try {
      if (state.current) {
        const text = await fetchText(state.current);
        if (text !== state.text) { state.text = text; titles.delete(state.current); renderDoc(text, true); }
      }
      const docs = await listDocs();
      if (docs.join() !== state.docs.join()) { state.docs = docs; renderDocList(); loadTitles(docs); }
      setLive(true);
    } catch { setLive(false); }
    setTimeout(poll, POLL_MS);
  }

  /* ---------- boot ---------- */
  (async () => {
    state.docs = await listDocs();
    const want = new URLSearchParams(location.search).get('doc');
    const last = store.get('lastDoc');
    const name = want || (state.docs.includes(last) ? last : state.docs[0]);
    renderDocList();
    loadTitles(state.docs);
    if (!name) { $('#doc').innerHTML = '<p class="muted">docs/ に Markdown ファイルを置いてください。</p>'; return; }
    store.set('lastDoc', name);
    await openDoc(name, false);
    setTimeout(poll, POLL_MS);
  })();
})();
