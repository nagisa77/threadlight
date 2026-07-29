# DOCX quality checks

Apply the checks relevant to the request.

## Package integrity

- Confirm the output exists, is non-empty, and opens as a ZIP package.
- Confirm `[Content_Types].xml`, `_rels/.rels`, and `word/document.xml` exist.
- Confirm referenced images, headers, footers, comments, and hyperlinks still
  have valid relationship targets.

## Content integrity

- Compare headings, paragraphs, tables, links, notes, and key values against
  the source or brief.
- Search for placeholders such as `TODO`, `TBD`, dummy names, and template
  instructions.
- Confirm list order, table row/column counts, and intentional page/section
  breaks.

## Visual integrity

Inspect every rendered page for:

- clipped or overlapping text;
- orphaned headings and awkward page breaks;
- broken table widths, split rows, or unreadable cells;
- distorted, missing, or low-resolution images;
- inconsistent fonts, spacing, margins, headers, and footers;
- unexpected blank pages or orientation changes.

## Change integrity

For edits, compare before and after. Confirm requested changes are present and
unrelated text, styles, comments, tracked changes, and metadata were not
silently altered.
