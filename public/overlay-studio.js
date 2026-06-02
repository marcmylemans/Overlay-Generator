/* ===========================================================================
   overlay-studio.js — live text editing + client-side transparent 4K PNG export

   Owns the editable content model and the live DOM preview, and delegates all
   canvas rasterisation to the shared OverlayCore engine (lib/overlay-core.js) —
   the very same code the server API runs, so a PNG you download here is byte-
   for-byte what `POST /api/overlays/:key.png` produces.
   =========================================================================== */
(function () {
  'use strict';
  const Core = window.OverlayCore;
  const W = Core.W, H = Core.H;

  /* ---- editable content model (starts from the shared defaults) ---- */
  const DATA = Core.defaultData();

  /* ---- logo (inlined data URL → never taints canvas) ---- */
  const logoImg = new Image();
  let logoReady = false;
  logoImg.onload = () => { logoReady = true; };
  logoImg.src = window.LOGO_DATA_URL || 'assets/logo-dark.png';

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ======================= PREVIEW DOM RENDER ======================= */
  function render() {
    const d = DATA;
    set('#s-eyebrow', d.slate.eyebrow);
    set('#s-title', d.slate.title);
    set('#s-sub', d.slate.subtitle);
    set('#s-brand', d.slate.brand);
    set('#s-url', d.slate.url);

    set('#c-label', d.chapter.label);
    set('#c-num', d.chapter.num);
    set('#c-title', d.chapter.title);

    set('#t-title', d.terminal.title);
    renderTerminal();

    set('#p-label', d.tip.label);
    set('#p-title', d.tip.title);
    set('#p-body', d.tip.body);

    const cr = document.querySelector('#cr-text');
    if (cr) cr.innerHTML = esc(d.credit.prefix) + ' <b>' + esc(d.credit.url) + '</b>';
    renderQRPreview();

    set('#b-name', d.bug.name);
    set('#b-handle', d.bug.handle);
    set('#b-btnlabel', d.bug.button);
  }
  function set(sel, val) { const el = document.querySelector(sel); if (el) el.textContent = val; }

  function renderQRPreview() {
    const host = document.querySelector('#cr-qr'); if (!host) return;
    const d = DATA.credit;
    if (!d.qr) { host.style.display = 'none'; host.innerHTML = ''; return; }
    const S = 360;
    let cv = host.querySelector('canvas');
    if (!cv) { cv = document.createElement('canvas'); host.appendChild(cv); }
    cv.width = S; cv.height = S; cv.style.width = S + 'px'; cv.style.height = S + 'px';
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, S, S);
    Core.drawQRCard(ctx, 0, 0, S, d.qrUrl, false, window.QRCode.encode);
    host.style.display = 'block';
  }
  function renderTerminal() {
    const body = document.querySelector('#t-body'); if (!body) return;
    const lines = DATA.terminal.cmd.split('\n');
    const prompt = DATA.terminal.prompt;
    let html = '<div class="ln"><span class="cmt">' + esc(DATA.terminal.comment) + '</span></div>';
    lines.forEach((ln, i) => {
      const pre = (i === 0 && prompt) ? '<span class="pr">' + esc(prompt) + '</span> ' : '';
      const span = Core.tokens(ln).map((tk) => '<span class="' + tk.cls + '">' + esc(tk.t) + '</span>').join('');
      const cur = i === lines.length - 1 ? '<span class="cur"></span>' : '';
      html += '<div class="ln">' + pre + span + cur + '</div>';
    });
    body.innerHTML = html;
  }

  /* ======================= CANVAS EXPORT (via shared core) ======================= */
  function renderCanvas(key) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    Core.draw(ctx, key, DATA, { logo: logoReady ? logoImg : null, qrEncode: window.QRCode.encode });
    return c;
  }
  function download(key) {
    const c = renderCanvas(key);
    c.toBlob((blob) => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = Core.FILES[key] + '.png'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }
  function downloadAll() { Core.KEYS.forEach((k, i) => setTimeout(() => download(k), i * 350)); }

  /* ======================= EDITOR UI ======================= */
  const FIELDS = [
    { grp: 'Title slate', key: 'slate', items: [
      ['eyebrow', 'Eyebrow', 'text'], ['title', 'Title', 'text'], ['subtitle', 'Subtitle', 'area'],
      ['brand', 'Brand name', 'text'], ['url', 'URL', 'text']] },
    { grp: 'Chapter label', key: 'chapter', items: [
      ['label', 'Step label', 'text'], ['num', 'Step number', 'text'], ['title', 'Chapter title', 'text']] },
    { grp: 'Command callout', key: 'terminal', items: [
      ['title', 'Title bar', 'text'], ['prompt', 'Prompt', 'text'], ['comment', 'Comment line', 'text'], ['cmd', 'Command (one per line)', 'area']] },
    { grp: 'Key takeaway', key: 'tip', items: [
      ['label', 'Label', 'text'], ['title', 'Title', 'text'], ['body', 'Body', 'area']] },
    { grp: 'Source / URL strip', key: 'credit', items: [
      ['prefix', 'Prefix', 'text'], ['url', 'URL', 'text'],
      ['qr', 'Show QR code', 'check'], ['qrUrl', 'QR links to', 'text']] },
    { grp: 'Subscribe bug', key: 'bug', items: [
      ['name', 'Name', 'text'], ['handle', 'Handle', 'text'], ['button', 'Button label', 'text']] }
  ];

  function buildEditor(container, onEdit) {
    container.innerHTML = '';
    FIELDS.forEach((sec) => {
      const wrap = document.createElement('div'); wrap.className = 'ed-sec';
      const head = document.createElement('div'); head.className = 'ed-head';
      head.innerHTML = '<span>' + sec.grp + '</span><button class="ed-dl" data-key="' + sec.key + '">Download PNG</button>';
      wrap.appendChild(head);
      sec.items.forEach(([f, label, type]) => {
        if (type === 'check') {
          const row = document.createElement('label'); row.className = 'ed-row ed-check';
          const inp = document.createElement('input'); inp.type = 'checkbox'; inp.className = 'ed-cbx'; inp.checked = !!DATA[sec.key][f];
          const lab = document.createElement('span'); lab.className = 'ed-lab'; lab.textContent = label;
          inp.addEventListener('change', () => { DATA[sec.key][f] = inp.checked; render(); onEdit && onEdit(sec.key); });
          row.appendChild(inp); row.appendChild(lab); wrap.appendChild(row); return;
        }
        const row = document.createElement('label'); row.className = 'ed-row';
        const lab = document.createElement('span'); lab.className = 'ed-lab'; lab.textContent = label;
        const inp = type === 'area' ? document.createElement('textarea') : document.createElement('input');
        if (type !== 'area') inp.type = 'text';
        inp.className = 'ed-inp'; inp.value = DATA[sec.key][f];
        if (type === 'area') inp.rows = (sec.key === 'terminal' ? 3 : 2);
        inp.addEventListener('input', () => { DATA[sec.key][f] = inp.value; render(); onEdit && onEdit(sec.key); });
        row.appendChild(lab); row.appendChild(inp); wrap.appendChild(row);
      });
      container.appendChild(wrap);
    });
    container.querySelectorAll('.ed-dl').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); download(b.dataset.key); }));
  }

  /* expose */
  window.OverlayStudio = { DATA, render, buildEditor, download, downloadAll, renderCanvas, FILES: Core.FILES };
  document.addEventListener('DOMContentLoaded', render);
  if (document.readyState !== 'loading') render();
})();
