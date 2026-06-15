/* ===========================================================================
   members-csv.js — turn a YouTube "members" CSV export into the `members`
   overlay content model. UMD: browser global `MembersCsv` + CommonJS.

   YouTube's export (any UI language) has one row per member with at least a
   name column, a current-level column, and a tenure column. We group members
   by level, order the tiers highest → lowest, sort within each tier, and emit
   the six tierN Title/Names fields the overlay expects.

   API:  MembersCsv.parse(csvText, opts?) -> { model, total, tiers, extraLevels }
         opts.order      tier names, highest first
                         (default Network Architect ▸ Systems Specialist ▸ Tech Enthusiast)
         opts.sortBy     'tenure' (default, longest-standing first) | 'name' | 'none'
         opts.separator  names join string (default ', ')
   =========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MembersCsv = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // RFC-4180-ish CSV → array of rows (handles quotes, escaped quotes, CRLF, BOM)
  function parseRows(text) {
    var rows = [], row = [], field = '', inQ = false;
    text = String(text == null ? '' : text).replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
        continue;
      }
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* ignore */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function findIndex(header, pred, fallback) {
    for (var i = 0; i < header.length; i++) if (pred(header[i])) return i;
    return fallback;
  }

  function parse(text, opts) {
    opts = opts || {};
    var order = opts.order || ['Network Architect', 'Systems Specialist', 'Tech Enthusiast'];
    var sortBy = opts.sortBy || 'tenure';
    var sep = opts.separator || ', ';

    var rows = parseRows(text);
    if (!rows.length) throw new Error('CSV is empty');
    var header = rows[0].map(function (h) { return String(h || '').trim().toLowerCase(); });

    // Column detection — works across YouTube's localised exports, with
    // positional fallbacks matching the documented column order.
    var nameIdx = findIndex(header, function (h) { return h === 'lid' || h === 'member' || h === 'naam' || h === 'name'; }, 0);
    var levelIdx = findIndex(header, function (h) { return h.indexOf('level') >= 0; }, 2);
    var tenureIdx = findIndex(header, function (h) {
      return (h.indexOf('lid') >= 0 && h.indexOf('maand') >= 0) || (h.indexOf('member') >= 0 && h.indexOf('month') >= 0);
    }, -1);

    var groups = {}, seen = [], total = 0;
    for (var r = 1; r < rows.length; r++) {
      var rr = rows[r];
      if (!rr || !rr.length) continue;
      var name = String(rr[nameIdx] == null ? '' : rr[nameIdx]).trim();
      if (!name) continue;                                   // skip blank-name rows
      var level = String(rr[levelIdx] == null ? '' : rr[levelIdx]).trim() || 'Members';
      var tenure = tenureIdx >= 0 ? parseFloat(rr[tenureIdx]) : NaN;
      if (!groups[level]) { groups[level] = []; seen.push(level); }
      groups[level].push({ name: name, tenure: isNaN(tenure) ? 0 : tenure });
      total++;
    }

    seen.forEach(function (lv) {
      var arr = groups[lv];
      if (sortBy === 'tenure' && tenureIdx >= 0) arr.sort(function (a, b) { return b.tenure - a.tenure || a.name.localeCompare(b.name); });
      else if (sortBy !== 'none') arr.sort(function (a, b) { return a.name.localeCompare(b.name); });
    });

    // rank tiers: known order first, then any unknown levels in first-seen order
    var levels = seen.slice().sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0) ia = order.length + seen.indexOf(a);
      if (ib < 0) ib = order.length + seen.indexOf(b);
      return ia - ib;
    });

    var model = { tier1Title: '', tier1Names: '', tier2Title: '', tier2Names: '', tier3Title: '', tier3Names: '' };
    var tiers = [];
    for (var t = 0; t < 3 && t < levels.length; t++) {
      var lv = levels[t];
      model['tier' + (t + 1) + 'Title'] = lv;
      model['tier' + (t + 1) + 'Names'] = groups[lv].map(function (x) { return x.name; }).join(sep);
      tiers.push({ title: lv, count: groups[lv].length });
    }
    return { model: model, total: total, tiers: tiers, extraLevels: levels.slice(3) };
  }

  return { parse: parse, parseRows: parseRows };
});
