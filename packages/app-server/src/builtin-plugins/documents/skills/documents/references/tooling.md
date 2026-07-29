# DOCX tooling

Select tools based on the operation and the fidelity required.

## Inspect

- Use `file` to confirm the input type; a `.docx` must be an OOXML ZIP package.
- Use `unzip -Z1 input.docx` to inventory parts before complex edits.
- Inspect `word/document.xml`, `word/styles.xml`, section properties,
  relationships, headers, footers, comments, numbering, and tracked-change
  elements when those features matter.
- Extract text for content comparison, but never treat extracted text as a
  layout check.

## Create and edit

- Prefer `python-docx` for ordinary paragraphs, styles, tables, sections,
  headers, footers, and images.
- Prefer `docx`/docx-js in an existing TypeScript project already using that
  library.
- Use LibreOffice headless for format conversion or when opening and saving
  through an office engine gives better fidelity.
- Use direct OOXML editing only when the library cannot express the required
  feature. Modify the smallest set of ZIP parts and preserve namespaces,
  relationship IDs, content types, and unrelated XML.
- Do not use `python-docx` for a tracked-change or comment preservation claim
  without inspecting the resulting OOXML; unsupported elements may be lost.

## Render

When LibreOffice is available, convert a copy to PDF in a temporary directory:

```bash
soffice --headless --convert-to pdf --outdir <temp-dir> <document.docx>
```

Render PDF pages to images with `pdftoppm` when available. If an office engine
is unavailable, use the best local preview available and disclose that full
render verification could not be completed.

## Temporary files

Keep extracted OOXML, rendered pages, and conversion output in a temporary
directory. Leave only requested deliverables in the user's destination.
