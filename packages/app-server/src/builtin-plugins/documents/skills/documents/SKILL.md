---
name: documents
description: Create, inspect, edit, convert, and verify professional Word or Google Docs-ready documents, including .docx formatting preservation, tables, images, headers, footers, comments, tracked-change constraints, and rendered layout checks. Use for any request whose input or deliverable is a Word document, DOCX file, or Google Docs-targeted document.
---

# Documents

Produce a real, verified document artifact. Do not substitute Markdown or a
renamed text file when the user asks for `.docx`.

## Workflow

1. Establish the deliverable: new document, edit, conversion, review,
   redline, or Google Docs-ready upload file. Confirm the output path and
   preserve the source file unless overwrite was explicitly requested.
2. Inspect every relevant input before authoring. For an existing `.docx`,
   inspect document structure, styles, sections, tables, relationships,
   headers/footers, comments, and tracked-change markup when relevant.
3. Choose the least destructive implementation path:
   - create or make ordinary edits with a DOCX library;
   - use LibreOffice for high-fidelity conversion when available;
   - edit OOXML directly only for features the library cannot preserve.
   Read `references/tooling.md` before choosing tools.
4. Preserve semantics and formatting that the user did not ask to change.
   Reuse named styles instead of hard-coding appearance paragraph by
   paragraph. Keep list numbering, table widths, section breaks, page
   orientation, headers, footers, links, and image relationships intact.
5. Render the result and inspect it. Read `references/quality-checks.md` and
   complete the relevant checks. Fix layout defects before reporting success.
6. Return the artifact path and summarize material edits, validation
   performed, and any unsupported feature that could not be preserved.

## Editing rules

- Never overwrite the only copy of an input document.
- Do not silently accept or remove tracked changes or comments.
- Do not claim tracked changes, comments, fields, macros, or embedded objects
  were preserved unless the chosen tool and inspection confirm it.
- For template-based work, edit a copy of the template and retain its styles,
  theme, section settings, and reusable content controls.
- For Google Docs requests without a connected Docs tool, create a `.docx`
  suitable for upload and say that it was not uploaded.
- When the user asks only for content, still apply a coherent heading
  hierarchy, readable typography, sensible spacing, and accessible tables.

## Completion gate

Do not finish until the document:

- opens as a valid Office package;
- contains the expected content and no accidental placeholders;
- has been visually checked through rendered pages or an equivalent office
  preview;
- is saved at the promised destination.
