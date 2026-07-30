# Excel tooling

Choose tools only after checking what is available in the runtime.

## Structured workbook work

- Prefer `openpyxl` for `.xlsx` and `.xlsm` structure, formulas, styles,
  tables, charts, validations, names, and print settings. Use `keep_vba=True`
  when opening a macro-enabled workbook that must retain its VBA project.
- Prefer `pandas` for tabular analysis, joins, reshaping, and bulk import or
  export. Write the final workbook through a workbook library when formatting,
  formulas, or multiple sheets matter.
- Prefer `xlsxwriter` for creating presentation-heavy new `.xlsx` workbooks.
  It does not edit existing workbooks.
- Inspect OOXML parts directly only when a workbook feature is unsupported by
  the chosen library. Make the smallest possible package change and preserve
  relationships and content types.

Workbook libraries generally write formulas without calculating their cached
results. Do not treat a saved workbook as recalculated merely because it opens
as a valid ZIP package.

## Recalculation, conversion, and rendering

Use LibreOffice or another compatible office engine when available to:

- recalculate formulas and refresh cached values;
- convert legacy `.xls` files;
- export selected sheets or print areas to PDF;
- inspect pagination, clipping, repeated headers, and chart layout.

For a headless LibreOffice run, use an isolated temporary user profile so
parallel or stale office processes do not affect the result. Never reuse the
user's live office profile.

## Data-only files

Use a CSV-aware parser rather than splitting lines manually. Detect or confirm
delimiter and encoding, preserve quoting, and stream large files instead of
loading them fully into memory when practical.

## Unsupported or risky features

Be conservative with VBA, Power Query, data connections, pivot caches, slicers,
embedded objects, digital signatures, and password-protected workbooks. If the
toolchain cannot round-trip a feature, preserve the original and disclose the
limitation before handing off the result.
