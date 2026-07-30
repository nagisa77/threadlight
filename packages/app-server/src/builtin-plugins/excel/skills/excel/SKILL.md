---
name: excel
description: Create, inspect, analyze, edit, convert, and verify Excel workbooks and spreadsheet data, including formulas, charts, tables, formatting, imports, and print layout. Use whenever an .xlsx, .xlsm, .xls, .csv, or .tsv file is an input or deliverable.
---

# Excel

Produce a real, usable spreadsheet artifact. Preserve formulas, workbook
structure, and visual conventions that the user did not ask to change.

## Workflow

1. Establish whether the task is inspection, analysis, creation, editing,
   repair, conversion, or chart/report production. Confirm the output path and
   preserve the source unless overwrite was explicitly requested.
2. Inspect all relevant sheets, used ranges, headers, data types, formulas,
   names, tables, charts, validations, hidden rows or sheets, merged cells,
   freeze panes, print settings, and external links before editing.
3. Read `references/tooling.md`, then choose the least destructive toolchain.
   Prefer structured workbook libraries for ordinary changes and an office
   engine when recalculation or rendered layout fidelity matters.
4. Make focused changes. Reuse existing number formats, styles, tables, named
   ranges, and formulas instead of rebuilding the workbook. Keep source data
   separate from calculations and presentation when creating a new model.
5. Validate values, formulas, structure, and visible layout using
   `references/quality-checks.md`. Recalculate with a compatible spreadsheet
   engine when formula results matter.
6. Return the artifact path and summarize changed sheets, material formulas or
   assumptions, validation performed, and any feature that could not be
   preserved.

## Spreadsheet rules

- Never rename a text, JSON, or HTML file to `.xlsx`; create a valid Office
  Open XML package.
- Do not replace formulas with cached values unless the user explicitly asks
  for a flattened workbook.
- Preserve macros in `.xlsm` files when the chosen library supports it. Do not
  claim VBA, external connections, Power Query, pivots, or slicers were
  preserved without verifying them.
- Treat identifiers such as account numbers, postal codes, and SKUs as text
  when leading zeros or exact formatting matter.
- Use real dates and deliberate number formats. State the unit and currency in
  labels instead of relying on color or position alone.
- For CSV and TSV files, confirm delimiter, encoding, quoting, header policy,
  and newline behavior. Explain that these formats cannot retain formulas,
  multiple sheets, charts, or styling.
- Keep formulas auditable: avoid unexplained constants, document assumptions,
  and use named ranges or structured references when they improve clarity.

## Completion gate

Do not finish until the deliverable opens successfully, contains the expected
sheets and records, has no accidental formula errors or placeholder content,
and all changed visible ranges or print pages have been inspected.
