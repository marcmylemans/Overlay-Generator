/* ===========================================================================
   server.js — Overlay Generator

   • Serves the interactive 4K overlay studio (the recreated DaVinci Overlays
     design) as a static web app at  /
   • Exposes a REST API for headless / automated overlay generation at  /api

   Self-host with Docker or `npm start`. See README.md for full API docs.
   =========================================================================== */
'use strict';

const path = require('path');
const express = require('express');

const render = require('./render.js');
const { createZip } = require('../lib/zip.js');
const OverlayCore = require('../lib/overlay-core.js');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

/* ---- static: studio frontend + shared libs + assets ---- */
app.use(express.static(path.join(ROOT, 'public')));
app.use('/lib', express.static(path.join(ROOT, 'lib')));
app.use('/fonts', express.static(path.join(ROOT, 'fonts')));

/* ----------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

// Coerce a flat field map ({num:'03', title:'…'}) into a model slice for `key`,
// respecting the default value types (e.g. credit.qr is boolean).
function flatToSlice(key, params) {
  const defaults = OverlayCore.defaultData()[key];
  const slice = {};
  for (const field of Object.keys(defaults)) {
    if (params == null || !(field in params)) continue;
    const v = params[field];
    if (typeof defaults[field] === 'boolean') {
      slice[field] = v === true || v === 'true' || v === '1' || v === 'on';
    } else {
      slice[field] = String(v);
    }
  }
  return slice;
}

// Build a full content model from a request that may carry either a flat field
// map for a single key, or a nested {key:{…}} model.
function modelFromRequest(key, source) {
  if (source && typeof source === 'object' && source[key] && typeof source[key] === 'object') {
    return { [key]: flatToSlice(key, source[key]) };
  }
  return { [key]: flatToSlice(key, source) };
}

function sendPng(res, buf, filename) {
  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', `inline; filename="${filename}.png"`);
  res.set('Cache-Control', 'no-store');
  res.send(buf);
}

function isValidKey(key) { return OverlayCore.KEYS.includes(key); }

/* ----------------------------------------------------------------------------
   API
   -------------------------------------------------------------------------- */

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', overlays: OverlayCore.KEYS.length });
});

// Discoverable schema: every overlay, its position, export filename, editable
// fields, and default values — enough to drive automated generation.
app.get('/api/overlays', (_req, res) => {
  const defaults = render.defaultData();
  const overlays = OverlayCore.KEYS.map((key) => ({
    key,
    name: OverlayCore.META[key].name,
    position: OverlayCore.META[key].pos,
    file: OverlayCore.FILES[key],
    fields: Object.keys(defaults[key]).map((f) => ({ name: f, type: typeof defaults[key][f] })),
    defaults: defaults[key]
  }));
  res.json({ resolution: { width: OverlayCore.W, height: OverlayCore.H }, overlays });
});

// Render a single overlay via query-string overrides:
//   GET /api/overlays/chapter.png?num=03&title=Configure%20OSPF
function handleSingle(source) {
  return (req, res) => {
    const key = req.params.key;
    if (!isValidKey(key)) return res.status(404).json({ error: `Unknown overlay '${key}'`, valid: OverlayCore.KEYS });
    try {
      const model = render.mergeData(modelFromRequest(key, source(req)));
      const buf = render.renderOverlay(key, model);
      sendPng(res, buf, OverlayCore.FILES[key]);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  };
}

// Ordered pack: render an arbitrary, ordered list of overlay *instances*
// (many of the same type allowed) into a single numbered .zip. Registered
// before the `:key` routes so "pack.zip" isn't mistaken for an overlay key.
//   POST /api/overlays/pack.zip
//   { "name": "episode-02", "overlays": [ { "key": "slate", "fields": {…} }, … ] }
app.post('/api/overlays/pack.zip', (req, res) => {
  try {
    const body = req.body || {};
    const files = render.renderPack(body.overlays);
    const zip = createZip(files);
    const name = body.name ? String(body.name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') : '';
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${name || 'overlay-pack'}.zip"`);
    res.set('Cache-Control', 'no-store');
    res.send(zip);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/overlays/:key.png', handleSingle((req) => req.query));
app.post('/api/overlays/:key.png', handleSingle((req) => req.body));
// Accept the same without the .png suffix for convenience.
app.get('/api/overlays/:key', handleSingle((req) => req.query));
app.post('/api/overlays/:key', handleSingle((req) => req.body));

// Bulk: render many overlays into a single .zip.
//   GET  /api/overlays.zip                       → all six, defaults
//   POST /api/overlays.zip  { credit:{…}, keys:[…] } → selected, edited
function handleZip(source) {
  return (req, res) => {
    try {
      const body = source(req) || {};
      let keys = Array.isArray(body.keys) && body.keys.length ? body.keys : OverlayCore.KEYS;
      keys = keys.filter(isValidKey);
      if (!keys.length) return res.status(400).json({ error: 'No valid overlay keys requested', valid: OverlayCore.KEYS });

      const model = render.mergeData(body);
      const files = keys.map((key) => ({ name: `${OverlayCore.FILES[key]}.png`, data: render.renderOverlay(key, model) }));
      const zip = createZip(files);

      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename="overlay-pack.zip"');
      res.set('Cache-Control', 'no-store');
      res.send(zip);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  };
}

app.get('/api/overlays.zip', handleZip((req) => req.query));
app.post('/api/overlays.zip', handleZip((req) => req.body));

/* ---- start ---- */
async function start() {
  await render.init();
  app.listen(PORT, () => {
    console.log(`Overlay Generator listening on http://0.0.0.0:${PORT}`);
    console.log(`  Studio:  http://localhost:${PORT}/`);
    console.log(`  API:     http://localhost:${PORT}/api/overlays`);
  });
}

if (require.main === module) {
  start().catch((e) => { console.error('Fatal:', e); process.exit(1); });
}

module.exports = { app, start };
