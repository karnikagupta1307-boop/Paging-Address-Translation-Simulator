/* Educational diagrams — reads the simulator's existing state (pageTable, tlb, lastPage, lastFrame, stats)
   and wraps translateAddress()/generateMemory() without changing the translation algorithm. */
(function () {
  'use strict';
  const CAP = 32, el = id => document.getElementById(id), all = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let last = null, timers = [];

  const PATHS = {
    hit: 'cpu logical split tlb hitb frame memory physical s1 s2 s3 s6 h1 h2 h3 h4 h8 h9',
    miss: 'cpu logical split tlb missb table frame memory physical s1 s2 s3 s4 s5 s6 h1 h2 h3 h5 h7 h8 h9',
    fault: 'cpu logical split tlb missb table fault s1 s2 s3 s4 pf1 pf2 pf3 pf4 pf5 pf6 h1 h2 h3 h5 h6',
    invalid: 'cpu logical split s1 s2 h1 h2'
  };

  function bind(map) {
    all('[data-bind]').forEach(e => {
      if (e.dataset.def === undefined) e.dataset.def = e.textContent;
      e.textContent = map && e.dataset.bind in map ? map[e.dataset.bind] : e.dataset.def;
    });
  }
  function bindings(o) {
    const F = o.frame !== null && o.frame !== undefined;
    const tl = { hit: 'HIT', miss: 'MISS', fault: 'MISS', invalid: 'Not checked' }[o.type];
    return {
      lapage: o.page, laoff: o.offset, laframe: F ? o.frame : '—', paframe: F ? o.frame : '—', paoff: o.offset,
      la: o.address, pg: o.page, off: o.offset, tlbr: tl, fr: F ? o.frame : (o.type === 'fault' ? 'None (page fault)' : '—'),
      pa: F ? o.physical : (o.type === 'fault' ? 'Page fault' : 'Invalid address'),
      st1: `Address ${o.address}`, st2: `Page ${o.page}, offset ${o.offset}`, st3: `TLB ${tl}`,
      st4: o.type === 'miss' || o.type === 'fault' ? `Page ${o.page}: ${o.type === 'fault' ? 'valid bit = 0' : 'valid bit = 1'}` : (o.type === 'hit' ? 'Skipped (TLB hit)' : 'Page out of range'),
      st5: F ? `Frame ${o.frame}` : 'No frame', st6: F ? `Physical address ${o.physical}` : 'No physical address'
    };
  }

  function renderTable() {
    const box = el('dgPageTable'), mini = el('dgMiniFrames');
    if (!box) return;
    const nF = Number(el('numFrames').value) || 0;
    box.innerHTML = pageTable.slice(0, CAP).map(e => `<div class="pt-row ${e.valid ? '' : 'unloaded'} ${e.page === lastPage ? 'active-row' : ''}" data-page="${e.page}" tabindex="0"><span>${e.page}</span><span>${e.valid ? e.frame : '---'}</span><span class="valid-pill ${e.valid ? 'valid' : 'invalid'}">${e.valid ? 1 : 0}</span></div>`).join('') +
      (pageTable.length > CAP ? `<div class="dg-note">Showing first ${CAP} of ${pageTable.length} pages.</div>` : '');
    mini.innerHTML = Array.from({ length: Math.min(nF, CAP) }, (_, f) => {
      const p = pageTable.find(e => e.valid && e.frame === f);
      return `<div class="frame-chip ${p ? '' : 'free'} ${f === lastFrame ? 'highlight-frame' : ''}" data-frame="${f}">F${f}<small>${p ? 'Page ' + p.page : 'free'}</small></div>`;
    }).join('');
  }
  function renderMemory() {
    const nF = Number(el('numFrames').value) || 0;
    el('dgMemory').innerHTML = Array.from({ length: Math.min(nF, CAP) }, (_, f) => {
      const p = pageTable.find(e => e.valid && e.frame === f);
      return `<div class="memory-frame ${p ? '' : 'free'} ${f === lastFrame ? 'highlight-frame' : ''}" data-frame="${f}"><b>FRAME ${f}</b><span>${p ? 'Page ' + p.page : 'FREE'}</span></div>`;
    }).join('') + (nF > CAP ? `<div class="dg-note">Showing first ${CAP} of ${nF} frames.</div>` : '');
  }
  function renderTlb() {
    el('dgTlbEntries').innerHTML = tlb.length ? tlb.map(e => `<i class="${e.page === lastPage && lastFrame !== null ? 'cur' : ''}">P${e.page}→F${e.frame}</i>`).join('') : '<small>empty</small>';
    el('dgHits').textContent = stats.hits; el('dgMisses').textContent = stats.misses;
  }
  function highlight() {
    const keys = new Set(last ? PATHS[last.type].split(' ') : []);
    all('.diagram-container [data-step]').forEach(n => {
      const on = keys.has(n.dataset.step);
      n.classList.toggle('active-node', on);
      n.classList.remove('hit', 'miss', 'fault');
      if (on && n.dataset.step === 'tlb') n.classList.add(last.type === 'hit' ? 'hit' : 'miss');
      if (on && (n.dataset.step === 'fault' || n.dataset.step === 'pf6')) n.classList.add('fault');
    });
    el('dgStatus').textContent = last
      ? `Latest translation: address ${last.address} → Page ${last.page}, offset ${last.offset} · ` + ({ hit: `TLB HIT → Frame ${last.frame} → physical ${last.physical}`, miss: `TLB MISS → page table → Frame ${last.frame} → physical ${last.physical}`, fault: 'TLB MISS → valid bit 0 → PAGE FAULT', invalid: 'page outside the page table (invalid address)' }[last.type])
      : 'No translation yet — run one in the Simulator tab.';
  }
  function refresh() { renderTable(); renderMemory(); renderTlb(); highlight(); bind(last ? bindings(last) : null); }

  /* ---- live translation panel ---- */
  function liveReset() {
    timers.forEach(clearTimeout); timers = [];
    all('#dgLive [data-live]').forEach(n => { n.className = 'diagram-node'; n.querySelector('span').textContent = '—'; });
  }
  function animateLive(o) {
    liveReset();
    const p = o.page, f = o.frame, t = o.type, P = `Page ${p} · Offset ${o.offset}`;
    const S = [
      ['cpu', 'Issues request', ''], ['logical', o.address, ''], ['split', P, ''],
      ['tlb', t === 'hit' ? `HIT → Frame ${f}` : t === 'invalid' ? 'Not checked' : 'MISS', t === 'hit' ? 'hit' : t === 'invalid' ? 'skipped' : 'miss'],
      ['table', t === 'hit' ? 'Not needed' : t === 'invalid' ? `Page ${p} out of range` : t === 'fault' ? 'Valid bit = 0' : `Page ${p} → Frame ${f}`, t === 'hit' ? 'skipped' : t === 'miss' ? 'hit' : 'fault'],
      ['frame', f != null ? `Frame ${f}` : 'No frame', f != null ? 'hit' : 'fault'],
      ['memory', f != null ? `Frame ${f}` : 'Not accessed', f != null ? 'hit' : 'fault'],
      ['physical', f != null ? o.physical : t === 'fault' ? 'Page fault' : 'No address', f != null ? 'hit' : 'fault']
    ];
    S.forEach(([k, v, st], i) => {
      timers.push(setTimeout(() => {
        all('#dgLive .active-node').forEach(n => n.classList.remove('active-node'));
        const n = document.querySelector(`#dgLive [data-live="${k}"]`);
        n.querySelector('span').textContent = v;
        n.className = `diagram-node ${st} ${st === 'skipped' ? '' : 'active-node'}`;
        if (!st) n.classList.add('done');
        all('#dgLive .diagram-node').forEach(x => { if (x !== n && x.querySelector('span').textContent !== '—' && !x.classList.contains('skipped')) x.classList.add('done'); });
      }, reduce ? 0 : i * 420));
    });
  }

  /* ---- hook into the existing simulator (algorithm untouched) ---- */
  const origGen = generateMemory;
  generateMemory = function () { origGen.apply(this, arguments); last = null; liveReset(); refresh(); };

  const origTr = translateAddress, btn = el('translateBtn');
  translateAddress = function () {
    let ref = stats, b = { hits: stats.hits, misses: stats.misses, faults: stats.faults };
    origTr();
    if (stats !== ref) b = { hits: 0, misses: 0, faults: 0 };
    const dh = stats.hits - b.hits, dm = stats.misses - b.misses, df = stats.faults - b.faults;
    if (!dh && !dm) return;                       // invalid input – nothing was translated
    const address = Number(el('logicalAddress').value), ps = Number(el('pageSize').value);
    const page = Math.floor(address / ps), offset = address % ps;
    const type = dh ? 'hit' : (df ? (page >= pageTable.length ? 'invalid' : 'fault') : 'miss');
    const frame = (type === 'hit' || type === 'miss') ? lastFrame : null;
    last = { address, page, offset, type, frame, physical: frame !== null ? frame * ps + offset : null };
    refresh(); animateLive(last);
  };
  btn.removeEventListener('click', origTr);
  btn.addEventListener('click', translateAddress);

  /* ---- hover / focus tooltip on the page-table diagram ---- */
  const tip = el('dgTip');
  function showPage(row) {
    const e = pageTable[Number(row.dataset.page)]; if (!e) return;
    clearHover(); row.classList.add('hover-row');
    if (e.valid) all(`[data-frame="${e.frame}"]`).forEach(x => x.classList.add('hover-frame'));
    tip.textContent = e.valid ? `Page ${e.page} is mapped to Frame ${e.frame}.` : `Page ${e.page} is not loaded (valid bit = 0): accessing it causes a page fault.`;
    const r = row.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(innerWidth - 250, r.left + r.width / 2 - 100)) + 'px';
    tip.style.top = Math.max(8, r.top - 46) + 'px';
    tip.classList.add('show');
  }
  function clearHover() {
    all('.hover-row').forEach(x => x.classList.remove('hover-row'));
    all('.hover-frame').forEach(x => x.classList.remove('hover-frame'));
    tip.classList.remove('show');
  }
  const pt = el('dgPageTable');
  ['mouseover', 'focusin', 'click'].forEach(ev => pt.addEventListener(ev, e => { const r = e.target.closest('.pt-row'); if (r) showPage(r); }));
  ['mouseleave', 'focusout'].forEach(ev => pt.addEventListener(ev, clearHover));
  window.addEventListener('scroll', clearHover, { passive: true });

  /* ---- How Paging Works cards + misc ---- */
  all('.hp-card').forEach(c => {
    const toggle = () => { const o = c.classList.toggle('open'); c.setAttribute('aria-expanded', o); };
    c.addEventListener('click', toggle);
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
  el('dgGoSim').addEventListener('click', () => document.querySelector('[data-tab="simulator"]').click());

  refresh();
})();
