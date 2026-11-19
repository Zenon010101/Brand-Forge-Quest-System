# Combine HTML Batch: architecture and safeguards

```
Renderer: Combine > Iframe HTML (default)
   | user pastes full iframe / selects .xlsx, output folder
   v
Electron preload (isolated IPC)
   v
Main process combine:html:* (no Photoshop)
   | HTTPS Rakuten GOLD allowlist, HTML GET only (3 concurrent in batch)
   v
iframeHtml.js
   | extract ordered <img src/data-src> URLs; never fetch image binary
   | prefer dominant numbered family, warn about mixed families
   | find source HTML DETAILS heading, else use manual override or default+REVIEW
   | generate 2-col Line Up and 3-col Details HTML tables
   v
iframeBatchService.js
   | HTML_FILES/row_filename.html
   | HTML_RESULTS sheet: iframe | code | linked HTML | status/counts/review
   | BATCH_REPORT.json
   v
New versioned folder (original .xlsx untouched)
   v
User QC: check links, images, lineup/details count, then publish elsewhere
```

## Why a review flag exists

The screenshot represents a combined visual output. The public iframe's HTML may not contain a text heading before details, or may embed text inside a JPG. A generator cannot reliably infer lineup/detail boundaries from image URLs alone for every brand. If it cannot detect a **visible DETAILS heading in the source HTML**, it uses the user-specified/default count and returns `REVIEW`, not a false `READY`.

For Excel, place an optional `Lineup Count` column in the original sheet; the number of images before Details varies per item. If the count isn't known, review the generated result workbook's counts, image ordering and page. The code remains in the result workbook beside the iframe.

## Security and non-destructive behavior

- Only allowlisted `https://www.rakuten.ne.jp/gold/*.html` input URLs.
- All remote image URLs must resolve to HTTPS Rakuten hosts and have image extensions.
- Don't execute remote scripts or include source HTML fragments in output. Generate only static, escaped `<table>` / `<img>` tags.
- Never download image binaries, extract EXIF, crop, resize, perform OCR, or call Photoshop.
- Source workbook remains byte-for-byte unchanged; write a distinct new workbook+HTML folder per run.
- HTML file URLs are local hyperlink paths inside the generated workbook. Keep output folder together on the same PC/G drive.
- For HTML code longer than Excel's 32,767-character cell limit, save the full HTML file and mark the row REVIEW with an explanation rather than silently truncate.
- Failed page accesses are isolated per row; every iframe remains in output with FAILED status.
- Rate limited to 3 concurrent public-page HTML requests, no unbounded parallelism; cancellation stops assigning further rows and saves partial status.

## What this cannot guarantee without a real Rakuten URL test

- Public GOLD HTML may be blocked on specific networks; failures go to Excel for review.
- Image URLs may be in JS or a dynamically constructed DOM rather than img tags; a pure markup fetch then cannot recover them. Those rows fail rather than invent images.
- The selected numbered image family may exclude unusual product-detail images; check all exported images and flags.
- ExcelJS may not preserve advanced workbook features in arbitrary source files. Use a simple iframe-list .xlsx and never treat the generated result as an in-place edit to a macro-enabled workbook.

## v1.7.46 Full-page JPEG export

After extracting the iframe HTML, the app builds the same 780px HTML tables and saves them to HTML_FILES. It renders those generated local HTML documents with an isolated, hidden Electron BrowserWindow, waiting for ALL remote image URLs to load. The page is captured to one 780px-wide JPEG in JPEG_FILES; very tall pages are captured in vertical tiles and joined by Sharp. No Photoshop or intermediary image files are created.

### Excel columns (when input iframe is in A)
A: IFRAME · B: OUTPUT (complete HTML code) · C: HTML FILE LINK · D: JPEG FILE LINK · E+: original data/Lineup Count and QC columns. A new results copy is created; input workbook is unchanged.

### Failure behavior
HTTP image failures, missing images, capture timeouts, or output-size limits yield JPEG STATUS=FAILED, STATUS=REVIEW and a review message in Excel, while the HTML output remains accessible. The app never produces a successful-but-empty JPEG.

### Runtime constraints
Full-page screenshot requires Electron Chromium network access to remote image URLs. JPGs are requested in memory by Chromium for display and only the final combined JPEG is written to disk. Source HTML extraction is still the same allowlisted HTTPS Rakuten GOLD pathway.


### v1.7.47 - dual rendering layouts

- `main/iframeHtml.js`: 780px table HTML for Excel/standalone `.html`.
- `main/iframeJpegLayout.js`: independent 600px legacy Combine raster DOM, using the existing `planner.js` layout constants. 2 Line Up columns, 2 Details columns, no local source-image downloads.
- `main/iframeBatchService.js`: returns both `document` and `jpegDocument`; puts only `document` in `HTML_FILES` and Excel `OUTPUT`; the JPEG render string is forwarded in memory.
- `main/iframeJpegRenderer.js`: writes the raster DOM into a temporary system file for Chromium `loadFile`, captures to JPEG, verifies dimensions, and cleans up that temporary file even on failure.
- `main/register.js`: Single Save uses the same JPEG layout as Excel Batch.
- `renderer/iframeBatchUi.js`: preview allows HTML/JPEG layout switching.

The user's legacy PSD Combine path is **not modified**. The HTML output and JPEG are intentionally not pixel-identical because the approved layout requirements differ.
