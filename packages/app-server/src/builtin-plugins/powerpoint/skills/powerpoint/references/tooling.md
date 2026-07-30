# PowerPoint tooling

Choose tools only after checking what is available in the runtime.

## Structured presentation work

- Prefer `python-pptx` for ordinary `.pptx` creation and edits to slides,
  placeholders, text, shapes, images, tables, charts, notes support exposed by
  the installed version, and package relationships.
- Prefer a compatible office engine for legacy `.ppt` conversion and rendered
  fidelity checks.
- Inspect OOXML directly only for features unsupported by the presentation
  library. Make focused changes and preserve relationships, content types,
  masters, layouts, themes, notes, comments, and media parts.
- Use image tooling such as Pillow only to prepare assets. Do not rasterize
  editable slide content merely to simplify layout.

Presentation libraries may not round-trip animations, transitions, embedded
objects, charts, SmartArt, comments, notes, or custom XML perfectly. Inspect
the package and preserve the original when those features matter.

## Rendering

Use PowerPoint, LibreOffice, or another compatible renderer when available to
export the deck to PDF or slide images. Render every changed slide. A valid
OOXML package is not proof that text fits or that objects are visible.

For headless LibreOffice, use an isolated temporary user profile so parallel
or stale office processes do not affect conversion. Rendered PDF pages can be
converted to PNG for slide-by-slide inspection.

## Template use

When a template exists:

- work on a copy;
- use its slide masters and named layouts;
- retain theme colors and fonts;
- prefer placeholders over free-positioned duplicates;
- avoid deleting unused layouts unless specifically requested.

If no template exists, establish aspect ratio, theme, title/body hierarchy,
grid, margins, and a small set of reusable layouts before building the deck.
