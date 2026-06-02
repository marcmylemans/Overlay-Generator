/* ===========================================================================
   render.js — server-side overlay rasteriser

   Wraps the shared OverlayCore drawing engine with @napi-rs/canvas so the REST
   API can produce the exact same transparent 3840×2160 PNGs the browser studio
   downloads. Fonts and the brand logo are loaded once at startup.
   =========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const OverlayCore = require('../lib/overlay-core.js');
const QRCode = require('../lib/qrcode.js');

const ROOT = path.join(__dirname, '..');
const FONT_DIR = path.join(ROOT, 'fonts');
const LOGO_PATH = path.join(ROOT, 'public', 'assets', 'logo-dark.png');

let logoImage = null;
let initialised = false;

/* Register any bundled fonts (fonts/*.ttf|otf) for deterministic, brand-true
   output. If none are bundled we fall back to the system fonts @napi-rs/canvas
   loads automatically (Liberation Sans / DejaVu Sans Mono in the container). */
function registerFonts() {
  if (!fs.existsSync(FONT_DIR)) return;
  for (const file of fs.readdirSync(FONT_DIR)) {
    if (!/\.(ttf|otf|ttc)$/i.test(file)) continue;
    try { GlobalFonts.registerFromPath(path.join(FONT_DIR, file)); }
    catch (e) { console.warn('[render] failed to register font', file, e.message); }
  }
}

async function init() {
  if (initialised) return;
  registerFonts();
  try { logoImage = await loadImage(LOGO_PATH); }
  catch (e) { console.warn('[render] logo not found, slate/bug will omit it:', e.message); }
  initialised = true;
}

/**
 * Render a single overlay to a transparent PNG buffer.
 * @param {string} key   one of OverlayCore.KEYS
 * @param {object} data  full content model (merged with defaults by the caller)
 * @returns {Buffer} PNG bytes
 */
function renderOverlay(key, data) {
  if (!OverlayCore.KEYS.includes(key)) throw new Error('Unknown overlay: ' + key);
  const canvas = createCanvas(OverlayCore.W, OverlayCore.H);
  const ctx = canvas.getContext('2d');
  OverlayCore.draw(ctx, key, data, { logo: logoImage, qrEncode: QRCode.encode });
  return canvas.toBuffer('image/png');
}

/** Deep-merge a partial content model onto the defaults (one level of nesting). */
function mergeData(partial) {
  const data = OverlayCore.defaultData();
  if (partial && typeof partial === 'object') {
    for (const key of OverlayCore.KEYS) {
      if (partial[key] && typeof partial[key] === 'object') {
        Object.assign(data[key], partial[key]);
      }
    }
  }
  return data;
}

// Turn an arbitrary label into a safe filename fragment.
function slug(s) {
  return String(s).trim().replace(/\.png$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Render an ordered list of overlay *instances* into a numbered, play-ordered
 * set of PNGs. Each instance: { key, fields?, filename? }.
 * Returns [{ name, data }] with zero-padded, sortable, collision-free names.
 * @param {Array} instances
 * @returns {{name:string, data:Buffer}[]}
 */
function renderPack(instances) {
  if (!Array.isArray(instances) || instances.length === 0) {
    throw new Error('`overlays` must be a non-empty array of { key, fields } instances');
  }
  const pad = Math.max(2, String(instances.length).length);
  return instances.map((inst, i) => {
    if (!inst || typeof inst !== 'object') throw new Error(`overlays[${i}] must be an object`);
    const key = inst.key;
    if (!OverlayCore.KEYS.includes(key)) {
      throw new Error(`overlays[${i}]: unknown key '${key}' (valid: ${OverlayCore.KEYS.join(', ')})`);
    }
    const data = renderOverlay(key, mergeData({ [key]: inst.fields || {} }));
    const idx = String(i + 1).padStart(pad, '0');
    const label = inst.filename ? slug(inst.filename) : key;
    return { name: `${idx}_${label || key}.png`, data };
  });
}

module.exports = {
  init, renderOverlay, renderPack, mergeData,
  KEYS: OverlayCore.KEYS, FILES: OverlayCore.FILES, META: OverlayCore.META, defaultData: OverlayCore.defaultData
};
