# BrandForge v1.7.46 - Excel-adjacent HTML + full-page JPEG Combine

- Added one full-page JPG per iframe, matching the **same HTML** 780px, 2-column Line Up / 3-column Details, and 28px DETAILS heading. Captured by Electron, no Photoshop or intermediary image downloads.
- Batch output now keeps the source worksheet and row positions: `IFRAME` (A), generated `OUTPUT` code (B), `HTML FILE LINK` (C), and `JPEG FILE LINK` (D) when the iframe starts in A. Other columns are shifted when needed, never discarded.
- Created `HTML_FILES/` and `JPEG_FILES/` beside a new `*_COMBINE_RESULTS.xlsx`; original Excel and source images remain unchanged.
- JPEG capture waits for every referenced image to load. Missing images / capture errors set the row to REVIEW, preserve the HTML output, and record the exact error. Never claim a broken JPEG was successfully generated.
- Added JPEG statistics in batch report/progress and extended safe same-sheet / JPEG error regression tests.
- Preserved the existing PSD Combine, Amazon, Slider, LP, Remove Background, Arcade and History/EXP workflows.

**Windows runtime validation required:** Electron's real Chromium capture, remote Rakuten image loading, ExcelJS workbook I/O, and Google Drive folder access must be tested with a short real batch before using ~1,000 records.
