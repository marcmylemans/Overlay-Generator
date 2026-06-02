# Bundled fonts (optional)

Drop `.ttf` / `.otf` font files in this directory and the server will register
them at startup (`src/render.js` → `GlobalFonts.registerFromPath`), making text
rendering fully deterministic and independent of the host's installed fonts.

The drawing engine prefers, in order:

| Role | Preferred family | Fallback (installed in the Docker image) |
|------|------------------|------------------------------------------|
| Sans | `Inter`          | `Liberation Sans` |
| Mono | `JetBrains Mono` | `DejaVu Sans Mono` |

So, for output that matches the design's intent most closely, bundle:

- **Inter** — `Inter-Regular.ttf`, `Inter-SemiBold.ttf`, `Inter-Bold.ttf`
  (SIL OFL, <https://github.com/rsms/inter>)
- **JetBrains Mono** — `JetBrainsMono-Regular.ttf`, `JetBrainsMono-Bold.ttf`
  (SIL OFL, <https://github.com/JetBrains/JetBrainsMono>)

If this directory contains no fonts (the default), the server falls back to the
Liberation/DejaVu fonts installed in the container — which still look clean and
on-brand. The browser studio always renders in the viewer's local system font,
as in the original design.
