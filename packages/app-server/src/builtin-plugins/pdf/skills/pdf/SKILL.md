---
name: pdf
description: Read, extract, OCR, create, edit, merge, split, rotate, fill, redact, and verify PDF files with page-level visual checks. Use whenever a PDF is an input or deliverable, especially when layout, forms, scanned pages, fonts, accessibility, or print fidelity matters.
---

# PDF

Treat a PDF as both structured content and rendered pages. Text extraction
alone is never proof that the PDF is visually correct.

## Workflow

1. Inspect the input: file type, page count, dimensions, rotation, metadata,
   encryption, embedded fonts, forms, annotations, attachments, and whether
   pages contain text or scans. Read `references/tooling.md` before choosing
   an implementation.
2. Route the task:
   - extract/search/summarize text;
   - OCR scanned pages;
   - create or convert a document;
   - merge, split, reorder, crop, or rotate pages;
   - fill or inspect AcroForms;
   - redact or sanitize content.
3. Preserve the original unless overwrite was explicitly requested. Use a
   temporary directory for page renders, OCR intermediates, and conversions.
4. Apply the smallest safe transformation. For redaction, remove underlying
   content rather than drawing an opaque rectangle. For forms, preserve field
   names and values unless flattening was requested.
5. Validate structure and content, then render every changed page. Read
   `references/quality-checks.md` and fix defects before handoff.
6. Return the output path, page count, operations performed, and validation
   evidence. Disclose encryption, OCR uncertainty, missing fonts, or features
   that could not be preserved.

## Creation rules

- Generate a real PDF with embedded or reliably available fonts.
- Keep text selectable unless the requested output is intentionally
  image-only.
- Set page size, margins, wrapping, and pagination deliberately.
- Use vector text and graphics when possible; do not rasterize the whole
  document merely to simplify conversion.
- Include accessible reading order, meaningful link text, document language,
  and tags when the tooling supports them and accessibility matters.

## Safety rules

- Never claim visual verification without rendering pages.
- Never claim secure redaction without confirming removed text cannot be
  extracted or recovered from PDF objects.
- Do not bypass passwords or permissions.
- Do not discard annotations, bookmarks, forms, signatures, layers, or
  attachments silently.

## Completion gate

Do not finish until the PDF opens, has the expected page count and content,
and all changed pages have been visually inspected.
