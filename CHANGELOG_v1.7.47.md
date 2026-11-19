# BrandForge v1.7.47 — Restore Original Combine JPEG Layout

**Previous version:** v1.7.46.  **Change type:** JPEG-only layout revision in iframe → HTML/Excel batch.

## User requirement

Restore original legacy Combine JPEG look, while keeping the newer HTML/Excel mechanics.

| Output | Geometry | Contents |
| --- | --- | --- |
| Excel OUTPUT column B | 780px HTML code | Whole original iframe's transformed image URLs |
| Standalone HTML | 780px table | 2 Line Up columns / 3 Details columns, 28px DETAILS heading |
| JPEG | **600px** dynamic height | 2 Line Up columns / 2 Details columns, legacy 293px image slots and spacing |

## Exact changed paths

- **NEW** `src/modules/combine/main/iframeJpegLayout.js` — legacy 600px Combine JPEG DOM, using geometry from existing `planner.js`.
- `src/modules/combine/main/iframeJpegRenderer.js` — captures this separate DOM at 600px, while keeping the published HTML untouched; removes temporary render documents.
- `src/modules/combine/main/iframeBatchService.js` — supplies legacy JPEG DOM for all rows; keeps original Excel columns and HTML output identical.
- `src/modules/combine/main/register.js` — Single Save also renders the legacy JPEG layout.
- `src/modules/combine/renderer/index.html` — labels both preview modes.
- `src/modules/combine/renderer/iframeBatchUi.js` — switch between HTML and JPEG layouts before Save.
- `test/combineIframeHtml.js` — validates both layouts and the batch renderer contract.
- `package.json`, `package-lock.json` — version bump and syntax checking of new module.
- `README.md`, `src/modules/combine/HTML_BATCH_README.md`, `docs/IFRAME_HTML_BATCH_ARCHITECTURE.md` — instructions.

## Retained safeguards

- Source Excel is never overwritten; same sheet, original iframe in column A, generated HTML code in B, and HTML/JPEG hyperlinks in C and D.
- Original image URLs are not locally downloaded or text-removed. They load over HTTPS in Chromium to compose the JPEG.
- JPEG failure leaves HTML available, clears JPEG link, and marks row REVIEW.
- Dynamic JPEG height. The renderer currently enforces a 52,000px safety limit; exceptionally long pages require review.
- No Photoshop COM dependency for this mode; Amazon/Slider/legacy PSD Combine code remains unchanged.

## Validation notes

- `npm run validate`: passed the existing BrandForge regression suite.
- `npm run test:combine-html`: passed 13-image layout checks (three Line Up, ten Details) and Excel adjacency tests.
- Chromium synthetic visual QA: 600px page, 12 images, 5 Line Up and 7 Details, correct heading and two-column Details.
- Live Rakuten network/Windows Electron rendering: NOT validated in this environment; first use should test 2–5 iframe rows.

## Build

```cmd
npm install
npm run validate
npm run build:portable
```
