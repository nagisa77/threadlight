# PDF quality checks

## Structure

- Confirm the output exists, is non-empty, opens without repair warnings, and
  has the expected PDF version, page count, dimensions, and rotation.
- Check encryption, forms, annotations, bookmarks, links, attachments, and
  metadata when the task could affect them.

## Content

- Extract text and compare key headings, values, tables, page labels, and
  links against the source or brief.
- For OCR, sample low-confidence pages and verify proper nouns, dates,
  decimals, identifiers, and reading order.
- For redaction, search extracted text and inspect PDF objects for the removed
  content.

## Visual

Inspect rendered changed pages for:

- clipped, overlapping, missing, or substituted text;
- broken wrapping, pagination, columns, tables, and footnotes;
- missing, stretched, blurry, or color-shifted images;
- incorrect crop boxes, rotation, margins, page size, or blank pages;
- invisible form values or annotations;
- inconsistent headers, footers, and page numbers.

## Handoff

Report the destination, page count, transformation performed, render coverage,
and any remaining limitation. Do not leave page images or temporary
conversion files beside the deliverable.
