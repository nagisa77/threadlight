# Excel quality checks

Apply the checks relevant to the requested change.

## Structure and content

- Open the workbook with a package-aware library after saving.
- Confirm expected sheet names, order, visibility, used ranges, tables, names,
  charts, validations, and freeze panes.
- Compare input and output record counts for imports, filters, joins, and
  deduplication.
- Spot-check source rows, boundary values, blanks, errors, dates, identifiers,
  and totals.
- Inspect formulas for broken references, shifted ranges, inconsistent fill,
  and accidental replacement by strings or cached values.
- Recalculate when formula results are part of the deliverable, then check for
  `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, and unexpected blanks.

## Visual and print layout

- Open or render every changed sheet or print area.
- Check truncated headers, unreadable column widths, row heights, merged-cell
  clipping, hidden data, frozen panes, filters, chart labels, legends, and
  number formats.
- For printable workbooks, inspect page orientation, margins, scaling, print
  area, repeated header rows, manual breaks, and footer content.
- Use color as reinforcement, not the only signal. Ensure text and chart
  labels remain readable in the intended theme and when printed.

## Final artifact

- Confirm the output extension matches the actual file format.
- Confirm no temporary sheets, diagnostic cells, placeholders, or test data
  remain.
- Preserve the original input unless overwrite was explicitly requested.
