# PowerPoint quality checks

Apply the checks relevant to the requested change.

## Story and content

- Confirm slide count, order, section flow, titles, notes, appendix, and hidden
  slides match the intended presentation.
- Read titles in sequence at thumbnail scale; they should form a coherent
  story without relying on body text.
- Check names, dates, units, totals, citations, chart data, and repeated claims
  against the provided source material.
- Remove accidental placeholders, duplicate slides, drafting notes, and test
  assets.

## Visual inspection

Render every changed slide and inspect both full-slide and thumbnail views.
Check for:

- text overflow, clipping, unexpected wrapping, or fonts substituted by the
  renderer;
- overlapping objects, off-canvas content, broken crops, missing images, and
  distorted aspect ratios;
- inconsistent margins, alignment, spacing, type hierarchy, colors, or icon
  treatment;
- chart labels, legends, axes, table density, and contrast that become
  unreadable in presentation mode;
- footers, slide numbers, citations, and logos colliding with content;
- content too close to the slide edge or likely to be lost to overscan.

## Package integrity

- Reopen the saved presentation with a package-aware library.
- Confirm masters, layouts, theme, relationships, media, hyperlinks, notes,
  and hidden-slide state that should be preserved.
- Confirm the output extension matches the actual file format and the deck
  opens in a compatible presentation application.
- Preserve the original input unless overwrite was explicitly requested.
