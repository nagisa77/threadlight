# PDF tooling

Choose the smallest toolchain that preserves required features.

## Inspect and extract

- `pdfinfo`: page count, page size, metadata, encryption, and PDF version.
- `pdftotext`: searchable text and post-redaction checks.
- `pdffonts`: embedded font inspection when available.
- `pdfimages -list`: image inventory and scan diagnosis.
- `pdfplumber`: text, tables, coordinates, and page-level extraction.
- `pypdf`: metadata, page operations, forms, attachments, and lightweight
  structural edits.
- PyMuPDF (`fitz`): rendering, annotations, redaction, extraction, and page
  geometry.

## Render

Prefer Poppler:

```bash
pdftoppm -png -r 144 <input.pdf> <output-prefix>
```

PyMuPDF is a suitable fallback. Render every changed page; for a newly created
PDF, render every page.

## OCR

- Use OCR only for pages that lack usable text.
- Prefer `ocrmypdf` for a searchable PDF that preserves page images.
- Use Tesseract for page/image OCR when a PDF pipeline is unavailable.
- Record the OCR language and inspect names, numbers, tables, and low-quality
  scans manually.

## Create and convert

- ReportLab: programmatic layouts with explicit pagination.
- WeasyPrint or Chromium print-to-PDF: HTML/CSS-driven layouts.
- LibreOffice headless: office document conversion.
- Preserve vector content and embed fonts where the library supports it.

## Page operations and forms

- Use `pypdf`, PyMuPDF, or qpdf for merge, split, reorder, rotate, crop, and
  encryption-aware operations.
- Inspect AcroForm field names, types, values, flags, and appearance streams
  before filling.
- After filling, verify the visual appearance in a renderer. Flatten only when
  requested or required for portability.

## Redaction

Use a library's true redaction operation and apply it. Then verify both
rendered output and text/object extraction. A black rectangle is not a
redaction.
