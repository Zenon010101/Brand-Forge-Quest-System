# BrandForge v1.7.44 - Combine Iframe -> HTML / Excel batch

## Main change

New **HTML Batch** is the default view under Combine. The existing PSD generator remains under **Legacy PSD Combine** so other modules and past projects still work. The legacy Rakuten image-downloader and caption text-removal UI panels are hidden from the workflow; the new HTML batch does not invoke either system.

### Source / output

- Input: a whole `<iframe src="https://www.rakuten.ne.jp/gold/...html" ...></iframe>` block; accepts the direct Rakuten GOLD iframe URL as well.
- Single preview: obtains HTML markup from the public iframe URL (not JPG/PNG bytes), extracts image URLs, builds code, previews via a sandboxed iframe, saves standalone `.html` on request.
- Excel batch: upload a `.xlsx` of iframe strings, optionally with `Lineup Count` in a separate column. Works on every row, throttled at three simultaneous remote page fetches.
- Format: 780 px HTML table; 2 columns x 380 px Line Up; `DETAILS` header styled 28 px; 3 columns x 250 px Details. Last incomplete rows include empty `<td>`s.
- Batch outputs: new `COMBINE_HTML_YYYYMMDD_HHMMSS` folder containing a new `*_COMBINE_RESULTS.xlsx` (original worksheet retained, `HTML_RESULTS` worksheet added), `HTML_FILES/*.html`, and `BATCH_REPORT.json`. Input Excel remains untouched.
- `HTML_RESULTS` has **Iframe Input | HTML Code | HTML File Link | Status | Line Up Count | Details Count | Split Method | Review / Error | Source Excel Row | Iframe URL | Source Sheet**. The HTML code sits directly beside the iframe in columns A/B.
- Report rows needing manual classification as `REVIEW`, and inaccessible/invalid URLs as `FAILED`. A batch can complete with partial failure and still provide the rest.
- Never rewrites or downloads image files. Generated HTML hotlinks to the Rakuten-hosted source images, so images require internet access to display.
- `DETAILS` delimiter is detected only from an actual source HTML heading/tag when available; otherwise the default Line Up count is applied and flagged REVIEW. User may add a `Lineup Count` column in the source worksheet to specify each split.
- Web content is treated as text only, not evaluated. The iframe URL and image sources are restricted to public HTTPS Rakuten hosts. UI preview is sandboxed without script permission.
- Existing Amazon / Slider / LP / Remove BG / Legacy Combine / profile/history/EXP / Arcade continue to load. HTML batch successes contribute to Combine History/EXP.

### Code changes

- New: `src/modules/combine/main/iframeHtml.js` (pure parser, split, 780px HTML generator, charset handling)
- New: `src/modules/combine/main/iframeBatchService.js` (ExcelJS reader/writer and batched remote HTML processing)
- New: `src/modules/combine/renderer/iframeBatchUi.js` (new HTML batch UI)
- Edited: `src/modules/combine/main/register.js` (IPC handles)
- Edited: `src/main/preload.js` (narrow IPC APIs)
- Edited: `src/modules/combine/renderer/index.html` / `style.css`
- Edited: `src/modules/profile/main/productionEvents.js` (HTML completion History/EXP)
- Edited: `package.json` (v1.7.44, ExcelJS 4.4 dependency, test)
- New: `test/combineIframeHtml.js`
- New: `examples/IFRAME_LIST_TEMPLATE.xlsx`, `examples/SEC-84_REFERENCE_LAYOUT.html`, `examples/SEC-84_REFERENCE_CODE.txt`

### Testing and limitations

- Local pure JS parser + mocked Excel batch: **passed**, including malformed URLs, true DETAILS detection, manual and default split, two-column/three-column HTML geometry, and errors kept per row.
- Existing `npm run validate` regression suite: **passed** in container with available native Sharp runtime.
- Renderer UI/toggle: **passed** in a headless browser with app APIs stubbed. Screenshot at `docs/COMBINE_HTML_GUI.png`.
- The full ExcelJS binary writer could **not** be integration-tested here because the new npm dependency is not available offline. On Windows run `npm install` before `npm run build:portable`; test with a small 2-5 row .xlsx before doing a 1,000-item batch.
- Public Rakuten iframe HTML URL could not be fetched from this environment; actual markup and access policy may differ across brands. Any inaccessible pages will be marked FAILED.
- Excel .xlsm files aren't supported in this HTML mode; convert the iframe list to .xlsx. Original workbook is never overwritten.
- HTML-only mode needs no Photoshop or JSX; legacy PSD Combine still does.
- No user files or Google Drive folders were modified here. No online publication.
