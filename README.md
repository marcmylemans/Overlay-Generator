# Overlay-Generator

Brand-matched **DaVinci Resolve overlay pack** for the *Mylemans Online* channel —
shipped two ways:

1. **An interactive 4K studio** (the recreated `DaVinci Overlays.html` design) where
   you edit text live, see the slide/fade motion, drop in a frame of footage for
   context, and download transparent **3840×2160 PNGs** straight from the browser.
2. **A REST API** for headless / automated overlay generation — perfect for
   scripting an episode's overlays from a CI job, a content pipeline, or a
   `curl` one-liner.

Both paths share the **same rendering engine** (`lib/overlay-core.js`), so a PNG
the API returns is byte-for-byte identical to one you download from the studio.

Self-host it anywhere with Docker.

## The overlays

| # | Key | Overlay | Position |
|---|-----|---------|----------|
| 1 | `slate`     | Title slate (full-frame intro) | full frame |
| 2 | `chapter`   | Chapter / step label | top-left |
| 3 | `terminal`  | Code / command callout (terminal) | lower-left |
| 4 | `tip`       | Key takeaway / tip callout | right |
| 5 | `credit`    | Source / URL strip (with optional scannable QR) | bottom-left |
| 6 | `bug`       | Subscribe / like bug | bottom-right |
| 7 | `compare`   | Comparison / explainer slide — two-column A/B, or a single centered panel | full frame |
| 8 | `checklist` | Numbered "what you need" list with badges | left |
| 9 | `members`   | Member thank-you / credits — up to three tiers (empty tiers hidden) | full frame |

All render at true **4K (3840×2160)** with a transparent background (the title
slate, comparison slide and member-thanks slide are intentionally full-frame
opaque cards), in the brand's deep-navy + electric-blue terminal aesthetic.

> **Slideshow tip:** sequence several `compare`/`checklist` (and other) overlays
> through `POST /api/overlays/pack.zip` and drop them on the timeline in order —
> that play-ordered set *is* your slideshow. The `compare` slide collapses to a
> single centered panel automatically when you leave the right side blank, so it
> doubles as a detail/explainer slide.

---

## Quick start

### Run the published container

```bash
docker run -d --name overlay-generator -p 3000:3000 \
  ghcr.io/marcmylemans/overlay-generator:latest
```

Then open the studio at <http://localhost:3000/> and the API at
<http://localhost:3000/api/overlays>.

### Docker Compose

```bash
docker compose up -d
```

### Local development (Node 22+)

```bash
npm install
npm start          # http://localhost:3000
npm test           # render + API unit tests
```

> Local rendering needs a sans + mono font installed (Liberation/DejaVu work
> great and ship in the Docker image). See [`fonts/`](fonts/) to bundle Inter /
> JetBrains Mono for output that matches the design's intent exactly.

---

## The studio

Open `/`. The left panel lists all six overlays:

- **Click an overlay** to preview it on the 4K stage; **Play sequence** runs the
  whole slide/fade timeline; **Show all** lays them out together.
- **Drag a frame** of your footage onto the stage to judge placement (it is
  never exported).
- Toggle **title / action-safe guides**.
- Under **Edit text**, every overlay has labelled fields. Type and the preview
  updates live, then hit **Download PNG** (per overlay) or **Download all 6 PNGs**.
- The **Source / URL strip** has a *Show QR code* checkbox and a *QR links to*
  field — a real, offline QR encoder bakes a scannable code into the PNG.

---

## REST API

Base URL: `http://<host>:3000`

### `GET /api/health`
Liveness probe. `{ "status": "ok", "overlays": 6 }`

### `GET /api/overlays`
Discover everything an automation needs: resolution, every overlay's key,
position, export filename, editable fields (with types), and default values.

```bash
curl http://localhost:3000/api/overlays
```

### `GET /api/overlays/:key.png`
Render a single overlay, overriding fields via query string. Returns a
transparent PNG.

```bash
# Chapter label "Lab 12 · Set up OSPF"
curl "http://localhost:3000/api/overlays/chapter.png?label=Lab&num=12&title=Set%20up%20OSPF" \
  -o chapter.png
```

### `POST /api/overlays/:key.png`
Same, with a JSON body — friendlier for long text and multi-line commands.

```bash
curl -X POST http://localhost:3000/api/overlays/terminal.png \
  -H 'Content-Type: application/json' \
  -d '{
        "title": "root@core-sw: ~",
        "comment": "# advertise the management network",
        "cmd": "vtysh -c \"conf t\" \\\n  -c \"router ospf\" -c \"network 10.0.0.0/24 area 0\""
      }' \
  -o terminal.png
```

The credit strip's QR code:

```bash
curl -X POST http://localhost:3000/api/overlays/credit.png \
  -H 'Content-Type: application/json' \
  -d '{"prefix":"Scan for the guide →","url":"mylemans.online/ospf","qr":true,"qrUrl":"https://mylemans.online/ospf"}' \
  -o source-strip.png
```

### `GET` / `POST /api/overlays.zip`
Render many overlays into one `.zip`. `GET` returns all six with default copy;
`POST` accepts a (partial) content model and an optional `keys` array.

```bash
# All six, default copy
curl http://localhost:3000/api/overlays.zip -o overlay-pack.zip

# Just the slate + chapter, with custom text
curl -X POST http://localhost:3000/api/overlays.zip \
  -H 'Content-Type: application/json' \
  -d '{
        "keys": ["slate", "chapter"],
        "slate": { "title": "Build an OSPF Backbone", "eyebrow": "Networking · Lab" },
        "chapter": { "num": "01", "title": "Wire up the core" }
      }' \
  -o pack.zip
```

### `POST /api/overlays/pack.zip` — ordered episode pack
Render an **ordered list of overlay instances** (many of the same type allowed)
into one numbered, play-ordered zip — the whole episode in a single call.

```bash
curl -X POST http://localhost:3000/api/overlays/pack.zip \
  -H 'Content-Type: application/json' \
  -d '{
        "name": "script-02-powershell",
        "overlays": [
          { "key": "slate",    "fields": { "title": "10 PowerShell Commands" } },
          { "key": "chapter",  "fields": { "num": "01", "title": "Find your way around" } },
          { "key": "terminal", "fields": { "prompt": "PS C:\\>", "cmd": "Get-Command *service*" } },
          { "key": "terminal", "fields": { "prompt": "PS C:\\>", "cmd": "Get-Help Restart-Service" } }
        ]
      }' \
  -o script-02-powershell.zip
```

Returns `01_slate.png`, `02_chapter.png`, `03_terminal.png`, `04_terminal.png` —
zero-padded, sortable and collision-free even with repeated types. Each instance
may set an optional `filename` (used as `NN_<filename>.png`). Unlike
`overlays.zip` (one of each type), this is built for real multi-beat episodes.

### Content model

Every field is optional; anything you omit keeps its default. Field names per
overlay come straight from `GET /api/overlays`:

| Key | Fields |
|-----|--------|
| `slate`    | `eyebrow`, `title`, `subtitle`, `brand`, `url` |
| `chapter`  | `label`, `num`, `title` |
| `terminal` | `title`, `prompt` *(in-card prompt, e.g. `PS C:\>`; empty = none)*, `comment`, `cmd` *(newline-separated lines)* |
| `tip`      | `label`, `title`, `body` |
| `credit`   | `prefix`, `url`, `qr` *(boolean)*, `qrUrl` |
| `bug`      | `name`, `handle`, `button` |
| `compare`  | `eyebrow`, `title`, `leftHeading`, `leftBody` *(one point per line)*, `rightHeading`, `rightBody` *(leave the right side blank for a single panel)* |
| `checklist`| `title`, `items` *(one per line; auto-numbered)* |
| `members`  | `eyebrow`, `title`, `tier1Title`/`tier1Names` (top), `tier2Title`/`tier2Names` (mid), `tier3Title`/`tier3Names` (lower) — names comma- or newline-separated; **any tier with no names is hidden entirely** |

Errors return `4xx` with `{ "error": "…" }`.

---

## Using the PNGs in DaVinci Resolve

1. **Import** the PNGs into the Media Pool (alpha is preserved automatically).
2. Drop each onto a **video track above** your footage clip.
3. To recreate the motion from the studio preview, keyframe **Transform →
   Position + Opacity** on the Edit page, or build a **Fusion** transition.
   Directions that match the mockups: chapter slides from the left,
   terminal/credit rise up, the tip slides from the right, the subscribe bug
   slides from the right, and the slate fades + scales in.

Pre-rendered sample PNGs live in [`public/exports/`](public/exports/) and are
served at `/exports/…`.

---

## How it works / project layout

```
lib/overlay-core.js   Shared drawing engine (UMD) — the single source of truth
                      used by BOTH the browser studio and the server API.
lib/qrcode.js         Self-contained QR encoder (UMD), no network needed.
lib/zip.js            Tiny dependency-free ZIP writer for the bulk endpoint.
src/render.js         Server rasteriser: @napi-rs/canvas + font/logo loading.
src/server.js         Express app: static studio + REST API.
public/               The studio frontend (index.html, overlay-studio.js, assets).
fonts/                Optional bundled fonts (see fonts/README.md).
test/                 Render + API unit tests (npm test).
Dockerfile            Production image (Node 22, Skia canvas, fonts).
.github/workflows/    CI: test, then build & push a multi-arch image to GHCR.
```

`@napi-rs/canvas` ships prebuilt Skia binaries, so the image needs **no native
compilation** and builds for both `linux/amd64` and `linux/arm64` (great for a
Raspberry Pi homelab).

---

## CI / publishing

`.github/workflows/docker.yml` runs the tests on every push/PR, then — on pushes
to `main` and on `v*.*.*` tags — builds a multi-arch image and pushes it to
**GitHub Container Registry** at `ghcr.io/marcmylemans/overlay-generator`.
Tagging `v1.2.3` publishes `1`, `1.2`, `1.2.3`, and `latest`.

No secrets to configure — it uses the built-in `GITHUB_TOKEN`. Make sure the
package is set to your desired visibility under the repo's *Packages* settings.

---

## License

MIT. Brand assets (logo, name) belong to Mylemans Online.
