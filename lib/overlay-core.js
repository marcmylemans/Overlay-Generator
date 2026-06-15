/* ===========================================================================
   overlay-core.js — shared overlay drawing engine (browser + Node)

   This is the single source of truth for how every overlay is rasterised onto
   a 3840×2160 canvas. It is consumed two ways:

     • In the browser  → the studio (overlay-studio.js) imports it for the live
       preview's "Download PNG" buttons (window.OverlayCore).
     • In Node         → the REST API (src/render.js) imports it via require()
       and draws onto an @napi-rs/canvas surface.

   Keeping both paths on the same code guarantees the API produces pixel-
   identical PNGs to the in-browser studio.

   API:
     OverlayCore.W, OverlayCore.H            canvas dimensions (3840×2160)
     OverlayCore.KEYS                        ordered overlay keys
     OverlayCore.FILES                       key → export filename (no ext)
     OverlayCore.META                        key → {name, pos}
     OverlayCore.defaultData()               fresh deep copy of default content
     OverlayCore.tokens(line)                terminal tokenizer (preview + canvas)
     OverlayCore.draw(ctx, key, data, opts)  draw one overlay onto a 2D context
                                             opts = { logo, qrEncode }
   =========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OverlayCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var W = 3840, H = 2160;

  var C = {
    sky: '#38bdf8', blue400: '#60a5fa', blue500: '#3b82f6', blue600: '#2563eb',
    slate400: '#94a3b8', slate500: '#64748b', gray200: '#e5e7eb', txLight: '#e9eef6'
  };
  // Font stacks. The server registers/loads Liberation Sans + DejaVu Sans Mono
  // (and any bundled Inter / JetBrains Mono) so these resolve deterministically;
  // the browser falls through to the viewer's system UI font as originally designed.
  var SANS = "'Inter','Segoe UI',system-ui,-apple-system,'Liberation Sans',Arial,sans-serif";
  var MONO = "'JetBrains Mono','SF Mono','Cascadia Code','DejaVu Sans Mono',Menlo,Consolas,monospace";

  var KEYS = ['slate', 'chapter', 'terminal', 'tip', 'credit', 'bug', 'compare', 'checklist'];

  var META = {
    slate:     { name: 'Title slate',        pos: 'full frame' },
    chapter:   { name: 'Chapter label',      pos: 'top-left' },
    terminal:  { name: 'Command callout',    pos: 'lower-left' },
    tip:       { name: 'Key takeaway',       pos: 'right' },
    credit:    { name: 'Source / URL strip', pos: 'bottom-left' },
    bug:       { name: 'Subscribe bug',      pos: 'bottom-right' },
    compare:   { name: 'Comparison slide',   pos: 'full frame' },
    checklist: { name: 'Numbered list',      pos: 'left' }
  };

  var FILES = {
    slate: '01_title-slate', chapter: '02_chapter-label', terminal: '03_command-callout',
    tip: '04_key-takeaway', credit: '05_source-strip', bug: '06_subscribe-bug',
    compare: '07_comparison-slide', checklist: '08_numbered-list'
  };

  var DEFAULTS = {
    slate:    { eyebrow: 'Proxmox · Homelab · Automation', title: 'Build Your First Proxmox Cluster',
                subtitle: 'Three nodes, shared storage, and live migration — from bare metal to running VMs.',
                brand: 'Mylemans Online', url: 'mylemans.online' },
    chapter:  { label: 'Step', num: '01', title: 'Configure the VLAN trunk' },
    terminal: { title: 'root@pve: ~', prompt: 'root@pve:~#', comment: '# create a VM with 4 GB RAM on bridge vmbr0',
                cmd: 'qm create 100 --name web01 \\\n  --memory 4096 --cores 2 --net0 virtio,bridge=vmbr0' },
    tip:      { label: 'Pro tip', title: 'Snapshot before you patch',
                body: 'Proxmox snapshots are instant and roll back in seconds — take one before every kernel update.' },
    credit:   { prefix: 'Full guide →', url: 'blog.mylemans.online/proxmox-cluster',
                qr: true, qrUrl: 'https://blog.mylemans.online/proxmox-cluster' },
    bug:      { name: 'Mylemans Online', handle: '@mylemansonline', button: 'Subscribe' },
    compare:  { eyebrow: 'Side by side', title: 'Proxmox vs. VMware',
                leftHeading: 'Proxmox VE',
                leftBody: 'Open source, no license cost\nBuilt-in ZFS & Ceph storage\nKVM + LXC in one web UI',
                rightHeading: 'VMware ESXi',
                rightBody: 'Per-socket subscription\nMature vSphere tooling\nBroad hardware compatibility' },
    checklist: { title: 'What you need',
                items: 'USB stick (8 GB or larger)\n64-bit machine\n8 GB of RAM\nStable network connection' }
  };

  function defaultData() { return JSON.parse(JSON.stringify(DEFAULTS)); }

  /* ---- terminal tokenizer (shared by preview + canvas) ---- */
  function tokens(line) {
    var parts = line.split(/(\s+)/);
    return parts.filter(function (p) { return p !== ''; }).map(function (p) {
      if (/^\s+$/.test(p)) return { t: p, cls: 'tx' };
      if (p === '\\' || /^--?\w/.test(p) || /^\d+$/.test(p)) return { t: p, cls: 'fl' };
      return { t: p, cls: 'tx' };
    });
  }
  var TCOL = { pr: C.sky, fl: C.blue400, tx: C.txLight, cmt: C.slate500 };

  /* ======================= CANVAS HELPERS ======================= */
  function rr(ctx, x, y, w, h, r) {
    var tl, tr, br, bl;
    if (typeof r === 'number') { tl = tr = br = bl = r; } else { tl = r[0]; tr = r[1]; br = r[2]; bl = r[3]; }
    ctx.beginPath(); ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y); ctx.arcTo(x + w, y, x + w, y + tr, tr);
    ctx.lineTo(x + w, y + h - br); ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
    ctx.lineTo(x + bl, y + h); ctx.arcTo(x, y + h, x, y + h - bl, bl);
    ctx.lineTo(x, y + tl); ctx.arcTo(x, y, x + tl, y, tl); ctx.closePath();
  }
  function font(ctx, size, weight, mono) { ctx.font = (weight || 400) + ' ' + size + 'px ' + (mono ? MONO : SANS); }
  function shOn(ctx, blur, oy, col) { ctx.shadowColor = col; ctx.shadowBlur = blur; ctx.shadowOffsetY = oy; ctx.shadowOffsetX = 0; }
  function shOff(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
  function wrap(ctx, text, maxW) {
    var words = text.split(' '), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i], t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur); return lines;
  }
  function runs(ctx, arr, x, y, size) {
    font(ctx, size, 400, true); var cx = x;
    for (var i = 0; i < arr.length; i++) { ctx.fillStyle = arr[i][1]; ctx.fillText(arr[i][0], cx, y); cx += ctx.measureText(arr[i][0]).width; }
    return cx;
  }
  // letterSpacing helper that degrades gracefully if the backend lacks it
  function ls(ctx, val) { try { ctx.letterSpacing = val; } catch (e) { /* unsupported */ } }

  /* ---- QR code: encode (cached) + draw a white "scan me" card ---- */
  var QR_DARK = '#080d18';
  function drawQRCard(ctx, x, y, S, text, withShadow, qrEncode) {
    var qr = null;
    try { qr = qrEncode(text, 'M'); } catch (e) { qr = null; }
    if (!qr) return;
    if (withShadow) { shOn(ctx, 55, 22, 'rgba(2,6,23,.5)'); }
    rr(ctx, x, y, S, S, 28); ctx.fillStyle = '#ffffff'; ctx.fill();
    shOff(ctx);
    ctx.strokeStyle = 'rgba(15,23,42,.12)'; ctx.lineWidth = 2; rr(ctx, x, y, S, S, 28); ctx.stroke();
    var quiet = 4, n = qr.size;
    var mod = Math.floor(S / (n + quiet * 2));
    var draw = mod * n;
    var ox = x + Math.round((S - draw) / 2), oy = y + Math.round((S - draw) / 2);
    ctx.fillStyle = QR_DARK;
    for (var yy = 0; yy < n; yy++) for (var xx = 0; xx < n; xx++) {
      if (qr.get(xx, yy)) ctx.fillRect(ox + xx * mod, oy + yy * mod, mod, mod);
    }
  }

  /* ---- full-frame brand backdrop (shared by slate + comparison slide) ---- */
  function brandBackdrop(ctx) {
    var g = ctx.createLinearGradient(700, 0, 3140, 2160);
    g.addColorStop(0, '#0b1730'); g.addColorStop(.62, '#060b16'); g.addColorStop(1, '#080d1a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var r1 = ctx.createRadialGradient(W * .18, H * .22, 0, W * .18, H * .22, W * .42);
    r1.addColorStop(0, 'rgba(37,99,235,.30)'); r1.addColorStop(1, 'rgba(37,99,235,0)'); ctx.fillStyle = r1; ctx.fillRect(0, 0, W, H);
    var r2 = ctx.createRadialGradient(W * .92, H * .88, 0, W * .92, H * .88, W * .38);
    r2.addColorStop(0, 'rgba(56,189,248,.16)'); r2.addColorStop(1, 'rgba(56,189,248,0)'); ctx.fillStyle = r2; ctx.fillRect(0, 0, W, H);
  }

  // newline-separated text → array of non-empty, trimmed lines
  function listLines(s) { return String(s == null ? '' : s).split('\n').map(function (t) { return t.trim(); }).filter(Boolean); }

  /* ---- a comparison panel: rounded card + heading tab + bullet list ---- */
  function drawPanel(ctx, x, y, w, h, heading, body) {
    shOn(ctx, 60, 24, 'rgba(2,6,23,.5)'); rr(ctx, x, y, w, h, 28); ctx.fillStyle = 'rgba(11,17,32,.92)'; ctx.fill(); shOff(ctx);
    ctx.strokeStyle = 'rgba(148,163,184,.18)'; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 28); ctx.stroke();
    var padX = 56, padTop = 50, innerW = w - padX * 2;
    ctx.textBaseline = 'top';
    var contentTop = y + padTop;
    if (heading) {
      var tg = ctx.createLinearGradient(x + padX, y + padTop, x + padX + 14, y + padTop + 58);
      tg.addColorStop(0, '#2563eb'); tg.addColorStop(1, '#38bdf8');
      ctx.fillStyle = tg; rr(ctx, x + padX, y + padTop + 4, 12, 54, 6); ctx.fill();
      font(ctx, 56, 700, false); ctx.fillStyle = '#fff'; ctx.fillText(heading, x + padX + 34, y + padTop);
      contentTop = y + padTop + 58 + 42;
    }
    var size = 44, by = contentTop, bx = x + padX;
    listLines(body).forEach(function (ln) {
      ctx.beginPath(); ctx.fillStyle = C.sky; ctx.arc(bx + 10, by + size * 0.5, 9, 0, 7); ctx.fill();
      font(ctx, size, 400, false); ctx.fillStyle = '#c4d0e0';
      var wrapped = wrap(ctx, ln, innerW - 48);
      wrapped.forEach(function (wl, i) { ctx.fillText(wl, bx + 48, by + i * size * 1.32); });
      by += wrapped.length * size * 1.32 + 26;
    });
    ctx.textBaseline = 'alphabetic';
  }

  /* ======================= DRAW: each overlay ======================= */
  // Each draw fn receives (ctx, d, opts) where d is that overlay's data slice
  // and opts = { logo, logoReady, qrEncode }.
  var DRAW = {
    slate: function (ctx, d, opts) {
      brandBackdrop(ctx);
      var x = 384;
      ctx.textBaseline = 'top';
      var eyeSize = 42, h2Size = 188, subSize = 58;
      font(ctx, subSize, 400, false);
      var subLines = wrap(ctx, d.subtitle, 2200);
      var subH = subLines.length * subSize * 1.4;
      var blockH = eyeSize + 40 + h2Size * 1.02 + 54 + 10 + 40 + subH;
      var y = (H - blockH) / 2;
      font(ctx, eyeSize, 600, false); ctx.fillStyle = C.sky; ls(ctx, '12px');
      ctx.fillText(d.eyebrow.toUpperCase(), x, y); ls(ctx, '0px'); y += eyeSize + 40;
      font(ctx, h2Size, 700, false); ctx.fillStyle = '#fff'; ls(ctx, '-5px');
      var titleLines = wrap(ctx, d.title, 3000);
      titleLines.forEach(function (ln, i) { ctx.fillText(ln, x, y + i * h2Size * 1.02); });
      ls(ctx, '0px'); y += titleLines.length * h2Size * 1.02 + 54;
      var rg = ctx.createLinearGradient(x, y, x + 240, y + 10); rg.addColorStop(0, '#2563eb'); rg.addColorStop(1, '#38bdf8');
      ctx.fillStyle = rg; rr(ctx, x, y, 240, 10, 5); ctx.fill(); y += 10 + 40;
      font(ctx, subSize, 400, false); ctx.fillStyle = '#c4d0e0';
      subLines.forEach(function (ln, i) { ctx.fillText(ln, x, y + i * subSize * 1.4); });
      var fy = H - 150 - 74;
      if (opts.logoReady) ctx.drawImage(opts.logo, x, fy, 74, 74);
      ctx.textBaseline = 'alphabetic';
      font(ctx, 42, 700, false); ctx.fillStyle = '#fff'; ctx.fillText(d.brand, x + 96, fy + 30);
      font(ctx, 34, 400, true); ctx.fillStyle = C.slate400; ctx.fillText(d.url, x + 96, fy + 68);
    },
    chapter: function (ctx, d) {
      var x = 192, y = 150, h = 150;
      ctx.textBaseline = 'middle';
      font(ctx, 74, 700, true); var numW = ctx.measureText(d.num).width;
      font(ctx, 24, 600, false); ls(ctx, '5px'); var kW = ctx.measureText(d.label.toUpperCase()).width; ls(ctx, '0px');
      var stepW = Math.max(numW, kW) + 92;
      font(ctx, 66, 600, false); var bodyW = ctx.measureText(d.title).width + 112;
      shOn(ctx, 60, 24, 'rgba(2,6,23,.55)'); rr(ctx, x, y, stepW + bodyW, h, 18); ctx.fillStyle = '#0b1120'; ctx.fill(); shOff(ctx);
      var g = ctx.createLinearGradient(x, y, x + stepW, y + h); g.addColorStop(0, '#2563eb'); g.addColorStop(1, '#38bdf8');
      ctx.save(); rr(ctx, x, y, stepW, h, [18, 0, 0, 18]); ctx.clip(); ctx.fillStyle = g; ctx.fillRect(x, y, stepW, h); ctx.restore();
      ctx.save(); rr(ctx, x + stepW, y, bodyW, h, [0, 18, 18, 0]); ctx.clip(); ctx.fillStyle = 'rgba(11,17,32,.94)'; ctx.fillRect(x + stepW, y, bodyW, h); ctx.restore();
      ctx.strokeStyle = 'rgba(148,163,184,.22)'; ctx.lineWidth = 2; rr(ctx, x + stepW, y, bodyW, h, [0, 18, 18, 0]); ctx.stroke();
      var cx = x + stepW / 2; ctx.textAlign = 'center';
      font(ctx, 24, 600, false); ctx.fillStyle = 'rgba(255,255,255,.85)'; ls(ctx, '5px');
      ctx.fillText(d.label.toUpperCase(), cx, y + h / 2 - 36); ls(ctx, '0px');
      font(ctx, 74, 700, true); ctx.fillStyle = '#fff'; ctx.fillText(d.num, cx, y + h / 2 + 20);
      ctx.textAlign = 'left';
      font(ctx, 66, 600, false); ctx.fillStyle = '#fff'; ctx.fillText(d.title, x + stepW + 56, y + h / 2 + 2);
      ctx.textBaseline = 'alphabetic';
    },
    terminal: function (ctx, d) {
      var x = 192, y = 600, w = 2120, barH = 88, padX = 44, padTop = 46, lineH = 78;
      var cmdLines = d.cmd.split('\n'); var total = 1 + cmdLines.length;
      var h = barH + padTop * 2 + lineH * total;
      shOn(ctx, 90, 40, 'rgba(2,6,23,.6)'); rr(ctx, x, y, w, h, 20); ctx.fillStyle = 'rgba(6,10,20,.96)'; ctx.fill(); shOff(ctx);
      ctx.save(); rr(ctx, x, y, w, barH, [20, 20, 0, 0]); ctx.clip(); ctx.fillStyle = '#0d1424'; ctx.fillRect(x, y, w, barH); ctx.restore();
      ctx.strokeStyle = 'rgba(148,163,184,.16)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y + barH); ctx.lineTo(x + w, y + barH); ctx.stroke();
      ctx.strokeStyle = 'rgba(148,163,184,.2)'; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 20); ctx.stroke();
      var dotY = y + barH / 2, dotsCol = ['#ff5f57', '#febc2e', '#28c840'];
      dotsCol.forEach(function (col, i) { ctx.beginPath(); ctx.fillStyle = col; ctx.arc(x + 36 + 13 + i * 42, dotY, 13, 0, 7); ctx.fill(); });
      ctx.textBaseline = 'middle'; font(ctx, 34, 400, true); ctx.fillStyle = C.slate400; ctx.fillText(d.title, x + 36 + 3 * 42 + 30, dotY);
      ctx.textBaseline = 'top'; var ly = y + barH + padTop;
      font(ctx, 52, 400, true); ctx.fillStyle = C.slate500; ctx.fillText(d.comment, x + padX, ly);
      var endX = x + padX;
      var prompt = (d.prompt != null && d.prompt !== '') ? d.prompt + ' ' : '';
      cmdLines.forEach(function (ln, i) {
        ly += lineH; var arr = [];
        if (i === 0 && prompt) arr.push([prompt, C.sky]);
        tokens(ln).forEach(function (tk) { arr.push([tk.t, TCOL[tk.cls]]); });
        endX = runs(ctx, arr, x + padX, ly, 52);
      });
      ctx.fillStyle = C.sky; ctx.fillRect(endX + 8, ly + 2, 26, 54);
      ctx.textBaseline = 'alphabetic';
    },
    tip: function (ctx, d) {
      var w = 1240, x = W - 192 - w, y = 540, padX = 56, padTop = 54, padBot = 56;
      ctx.textBaseline = 'top'; font(ctx, 44, 400, false);
      var pLines = wrap(ctx, d.body, w - padX * 2); var h3Size = 62; var pH = pLines.length * 44 * 1.45;
      var titleLines = wrap(ctx, d.title, w - padX * 2);
      var h = padTop + 72 + 34 + titleLines.length * h3Size * 1.12 + 22 + pH + padBot;
      shOn(ctx, 90, 40, 'rgba(2,6,23,.6)'); rr(ctx, x, y, w, h, 24); ctx.fillStyle = 'rgba(11,17,32,.95)'; ctx.fill(); shOff(ctx);
      ctx.strokeStyle = 'rgba(148,163,184,.22)'; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 24); ctx.stroke();
      var by = y + padTop, bx = x + padX;
      var g = ctx.createLinearGradient(bx, by, bx + 72, by + 72); g.addColorStop(0, '#2563eb'); g.addColorStop(1, '#38bdf8');
      shOn(ctx, 26, 10, 'rgba(37,99,235,.5)'); rr(ctx, bx, by, 72, 72, 18); ctx.fillStyle = g; ctx.fill(); shOff(ctx);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      var lcx = bx + 36, lcy = by + 30;
      ctx.beginPath(); ctx.arc(lcx, lcy, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lcx - 7, by + 52); ctx.lineTo(lcx + 7, by + 52); ctx.moveTo(lcx - 5, by + 58); ctx.lineTo(lcx + 5, by + 58); ctx.stroke();
      ctx.textBaseline = 'middle'; font(ctx, 30, 700, false); ctx.fillStyle = C.sky; ls(ctx, '6px');
      ctx.fillText(d.label.toUpperCase(), bx + 90, by + 36); ls(ctx, '0px');
      ctx.textBaseline = 'top'; var ty = by + 72 + 34;
      font(ctx, h3Size, 700, false); ctx.fillStyle = '#fff'; ls(ctx, '-1px');
      titleLines.forEach(function (ln, i) { ctx.fillText(ln, x + padX, ty + i * h3Size * 1.12); }); ls(ctx, '0px');
      ty += titleLines.length * h3Size * 1.12 + 22;
      font(ctx, 44, 400, false); ctx.fillStyle = '#b8c4d4';
      pLines.forEach(function (ln, i) { ctx.fillText(ln, x + padX, ty + i * 44 * 1.45); });
      ctx.textBaseline = 'alphabetic';
    },
    credit: function (ctx, d, opts) {
      ctx.textBaseline = 'middle'; font(ctx, 42, 400, true);
      var t1 = d.prefix + ' ', t2 = d.url; var w1 = ctx.measureText(t1).width, w2 = ctx.measureText(t2).width;
      var icD = 60, gap = 26, padL = 30, padR = 44, h = 104, w = padL + icD + gap + w1 + w2 + padR;
      var y = H - 130 - h, x = 192;
      if (d.qr) { var S = 360; drawQRCard(ctx, x, y - 24 - S, S, d.qrUrl, true, opts.qrEncode); }
      shOn(ctx, 50, 20, 'rgba(2,6,23,.5)'); rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(11,17,32,.9)'; ctx.fill(); shOff(ctx);
      ctx.strokeStyle = 'rgba(148,163,184,.24)'; ctx.lineWidth = 2; rr(ctx, x, y, w, h, h / 2); ctx.stroke();
      var icx = x + padL + icD / 2, icy = y + h / 2;
      ctx.beginPath(); ctx.fillStyle = 'rgba(56,189,248,.14)'; ctx.arc(icx, icy, icD / 2, 0, 7); ctx.fill();
      ctx.strokeStyle = C.sky; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.save(); ctx.translate(icx, icy); ctx.rotate(-Math.PI / 4);
      rr(ctx, -16, -9, 20, 18, 9); ctx.stroke(); rr(ctx, -4, -9, 20, 18, 9); ctx.stroke(); ctx.restore();
      var tx = x + padL + icD + gap; font(ctx, 42, 400, true); ctx.fillStyle = '#dbe4f0'; ctx.fillText(t1, tx, icy); tx += w1;
      ctx.fillStyle = C.sky; ctx.fillText(t2, tx, icy); ctx.textBaseline = 'alphabetic';
    },
    bug: function (ctx, d, opts) {
      var padL = 30, padR = 26, gap = 30, logoD = 74;
      ctx.textBaseline = 'alphabetic';
      font(ctx, 40, 700, false); var nameW = ctx.measureText(d.name).width;
      font(ctx, 30, 400, true); var handW = ctx.measureText(d.handle).width;
      var whoW = Math.max(nameW, handW);
      var bellW = 42, bgap = 18, subPadX = 38;
      font(ctx, 42, 700, false); var subTxtW = ctx.measureText(d.button).width;
      var btnW = subPadX * 2 + bellW + bgap + subTxtW, btnH = 82, h = btnH + 44;
      var w = padL + logoD + gap + whoW + gap + btnW + padR, x = W - 192 - w, y = H - 130 - h;
      shOn(ctx, 55, 22, 'rgba(2,6,23,.55)'); rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(11,17,32,.92)'; ctx.fill(); shOff(ctx);
      ctx.strokeStyle = 'rgba(148,163,184,.24)'; ctx.lineWidth = 2; rr(ctx, x, y, w, h, h / 2); ctx.stroke();
      if (opts.logoReady) ctx.drawImage(opts.logo, x + padL, y + h / 2 - logoD / 2, logoD, logoD);
      var wx = x + padL + logoD + gap; var wcy = y + h / 2;
      font(ctx, 40, 700, false); ctx.fillStyle = '#fff'; ctx.fillText(d.name, wx, wcy - 4);
      font(ctx, 30, 400, true); ctx.fillStyle = C.slate400; ctx.fillText(d.handle, wx, wcy + 34);
      var bx = x + padL + logoD + gap + whoW + gap, by = y + h / 2 - btnH / 2;
      var g = ctx.createLinearGradient(bx, by, bx + btnW, by + btnH); g.addColorStop(0, '#2563eb'); g.addColorStop(1, '#38bdf8');
      shOn(ctx, 30, 12, 'rgba(37,99,235,.5)'); rr(ctx, bx, by, btnW, btnH, btnH / 2); ctx.fillStyle = g; ctx.fill(); shOff(ctx);
      var belx = bx + subPadX + bellW / 2, bely = by + btnH / 2; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(belx, bely - 20); ctx.arc(belx, bely - 2, 16, Math.PI * 1.15, Math.PI * -0.15);
      ctx.lineTo(belx + 20, bely + 8); ctx.lineTo(belx - 20, bely + 8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(belx, bely + 14, 6, 0, Math.PI); ctx.fill();
      ctx.beginPath(); ctx.arc(belx, bely - 22, 4, 0, 7); ctx.fill();
      ctx.textBaseline = 'middle'; font(ctx, 42, 700, false); ctx.fillStyle = '#fff';
      ctx.fillText(d.button, bx + subPadX + bellW + bgap, bely); ctx.textBaseline = 'alphabetic';
    },
    compare: function (ctx, d) {
      brandBackdrop(ctx);
      var margin = 192, gap = 80, x = margin, y = 150;
      ctx.textBaseline = 'top';
      if (d.eyebrow) {
        font(ctx, 40, 600, false); ctx.fillStyle = C.sky; ls(ctx, '10px');
        ctx.fillText(d.eyebrow.toUpperCase(), x, y); ls(ctx, '0px'); y += 40 + 26;
      }
      var titleSize = 120;
      font(ctx, titleSize, 700, false); ctx.fillStyle = '#fff'; ls(ctx, '-2px');
      var titleLines = wrap(ctx, d.title, W - margin * 2);
      titleLines.forEach(function (ln, i) { ctx.fillText(ln, x, y + i * titleSize * 1.04); });
      ls(ctx, '0px'); y += titleLines.length * titleSize * 1.04 + 24;
      var rg = ctx.createLinearGradient(x, y, x + 200, y + 10); rg.addColorStop(0, '#2563eb'); rg.addColorStop(1, '#38bdf8');
      ctx.fillStyle = rg; rr(ctx, x, y, 200, 10, 5); ctx.fill(); y += 10 + 56;

      var top = y, bottom = H - 150, panelH = bottom - top;
      var twoCol = !!(listLines(d.rightBody).length || (d.rightHeading && d.rightHeading.trim()));
      if (twoCol) {
        var pw = (W - margin * 2 - gap) / 2;
        drawPanel(ctx, x, top, pw, panelH, d.leftHeading, d.leftBody);
        drawPanel(ctx, x + pw + gap, top, pw, panelH, d.rightHeading, d.rightBody);
        // VS badge straddling the gap
        var vcx = x + pw + gap / 2, vcy = top + 96, vr = 64;
        var vg = ctx.createLinearGradient(vcx - vr, vcy - vr, vcx + vr, vcy + vr); vg.addColorStop(0, '#2563eb'); vg.addColorStop(1, '#38bdf8');
        shOn(ctx, 30, 12, 'rgba(37,99,235,.5)'); ctx.beginPath(); ctx.fillStyle = vg; ctx.arc(vcx, vcy, vr, 0, 7); ctx.fill(); shOff(ctx);
        ctx.strokeStyle = '#0b1120'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(vcx, vcy, vr, 0, 7); ctx.stroke();
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; font(ctx, 46, 700, false); ctx.fillStyle = '#fff';
        ctx.fillText('VS', vcx, vcy + 2); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      } else {
        var sw = Math.min(2600, W - margin * 2), sx = (W - sw) / 2;
        drawPanel(ctx, sx, top, sw, panelH, d.leftHeading, d.leftBody);
      }
    },
    checklist: function (ctx, d) {
      var items = listLines(d.items);
      var padX = 64, padTop = 56, padBot = 60, titleGap = 46;
      var badge = 84, itemGap = 30, titleSize = 56, itemSize = 46;
      ctx.textBaseline = 'top';
      font(ctx, titleSize, 700, false); var titleW = ctx.measureText(d.title).width;
      font(ctx, itemSize, 500, false);
      var maxItemW = 0; items.forEach(function (it) { maxItemW = Math.max(maxItemW, ctx.measureText(it).width); });
      var w = padX * 2 + Math.max(titleW, badge + 30 + maxItemW);
      w = Math.max(720, Math.min(1700, w));
      var itemsH = items.length * badge + Math.max(0, items.length - 1) * itemGap;
      var h = padTop + titleSize + titleGap + itemsH + padBot;
      var x = 192, y = Math.max(80, (H - h) / 2);
      shOn(ctx, 70, 30, 'rgba(2,6,23,.5)'); rr(ctx, x, y, w, h, 30); ctx.fillStyle = 'rgba(11,17,32,.93)'; ctx.fill(); shOff(ctx);
      ctx.strokeStyle = 'rgba(148,163,184,.2)'; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 30); ctx.stroke();
      font(ctx, titleSize, 700, false); ctx.fillStyle = '#fff'; ctx.fillText(d.title, x + padX, y + padTop);
      var iy = y + padTop + titleSize + titleGap;
      items.forEach(function (it, i) {
        var bg = ctx.createLinearGradient(x + padX, iy, x + padX + badge, iy + badge);
        bg.addColorStop(0, '#2563eb'); bg.addColorStop(1, '#38bdf8');
        shOn(ctx, 20, 8, 'rgba(37,99,235,.45)'); rr(ctx, x + padX, iy, badge, badge, 20); ctx.fillStyle = bg; ctx.fill(); shOff(ctx);
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; font(ctx, 46, 700, false); ctx.fillStyle = '#fff';
        ctx.fillText(String(i + 1), x + padX + badge / 2, iy + badge / 2 + 2);
        ctx.textAlign = 'left'; font(ctx, itemSize, 500, false); ctx.fillStyle = '#e6edf6';
        ctx.fillText(it, x + padX + badge + 30, iy + badge / 2);
        ctx.textBaseline = 'top';
        iy += badge + itemGap;
      });
      ctx.textBaseline = 'alphabetic';
    }
  };

  /* Draw one overlay. `data` is the full model; we hand each fn its slice. */
  function draw(ctx, key, data, opts) {
    opts = opts || {};
    var o = { logo: opts.logo || null, logoReady: !!opts.logo, qrEncode: opts.qrEncode || function () { return null; } };
    var d = (data && data[key]) || DEFAULTS[key];
    if (!DRAW[key]) throw new Error('Unknown overlay key: ' + key);
    DRAW[key](ctx, d, o);
  }

  return {
    W: W, H: H, C: C, SANS: SANS, MONO: MONO,
    KEYS: KEYS, META: META, FILES: FILES, TCOL: TCOL,
    defaultData: defaultData, tokens: tokens, draw: draw, drawQRCard: drawQRCard
  };
});
