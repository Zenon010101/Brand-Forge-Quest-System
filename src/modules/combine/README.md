# v1.7.38 — Recover selected OCR text and auto-fill Line Up names

**New flow:** Choose the image → approve OCR caption boxes or draw a Rectangle /
Brush Select over printed text → **Preview Text Removal**. BrandForge reads
text from the ORIGINAL selected pixels *before* applying Clean Fill. It reuses
matching OCR boxes from the initial scan; when a manual rectangle or brush
selection was missed, it rescans that selected region (English/Japanese when
OCR language packs are available). Unselected logos and product text are not
used to populate color names.

A **Captured text — review before adding** panel shows editable recovered
names. Original leading list numbers such as `1.` and `2.` are removed from
the suggested color name. For one detected caption, a normal Line Up name is
filled. For two spatially distinct captions, the system maps them to either
**LEFT/RIGHT** or **TOP/BOTTOM**, preserving the latter's original Y positions.
Users can override the arrangement and edit the name(s) before saving. Ambiguous
two-caption layouts require an explicit arrangement choice. If OCR misses the
selected area, cleanup still works and the name stays blank for manual input;
BrandForge does not invent a color name from `_textclean.png`.

Click **Save Clean Copy + Add to Combine** to fill the Line Up entry's existing
28px editable Photoshop text fields. The cleaned PNG lives under `COMBINE_CLEANED`;
originals remain byte-for-byte untouched. If the image is added to Single or
Details instead, its recovered text appears as an editable **note**, not an
unrequested text layer in the output PSD. Auto-cleaned Rakuten slides imported
later from `slider_manifest.json` now reuse single-caption suggestions too.

No Python runtime, network OCR service, or new npm runtime dependency is needed.
Tesseract/Windows OCR language support is still required for recognition;
real Japanese OCR and Photoshop output need Windows workstation testing.

Test: `npm run test:combine-caption-capture`, `npm run test:combine-vertical`,
`npm run validate`. Optional browser QA: `python test/combineCapturedNamesBrowser.py`
(Playwright/Chromium is only a developer test dependency).

---

# Combine vertical naming update (v1.7.37)

One source image containing two vertically stacked products is supported as **one full-width Line Up block** with **TOP and BOTTOM** editable 28px labels. Choose the vertical mode from that image's row-mode selector; names are independent. Caption Y offsets are percentages of the original canvas, and can be adjusted under the names. Unlike normal rows, vertical image preparation preserves the full white/alpha canvas (including cleared caption positions), so label distances match the original layout. Approved OCR captions in top/bottom positions can auto-populate names and Y offsets. Use `TOP :: BOTTOM` for bulk naming. Horizontal dual and regular modes are unchanged.

---

# BrandForge Combine Generator (v1.7.33)

This is a standalone Electron/Photoshop module. The uploaded `!COMBINE_TEMPLATE.psd`
is retained in `template/COMBINE_TEMPLATE_REFERENCE.psd` as a read-only geometric
reference, **not** modified or flattened as the output document. A new, dynamic
layered PSD/PSB is generated using the approved reference geometry.

## Workflow

1. **Single (optional)**: upload or drop one image if needed; it appears first in a 600 x 600 area.
2. **Line Up (optional)**: leave this section completely empty to skip it, or
   upload color variations. Color names are required **only for uploaded Line Up
   images**. Use the bulk name paste field (one per line, in the current order).
   Drag an entry to reorder its image and name together.
3. **Details (optional)**: upload images independently; drag entries to reorder.
   Without Line Up, Details follow Single with a 15 px gap when Single is present.
   Without Single, the first Line Up or Details section starts at the canvas top.
   Any one section alone is valid; an entirely empty Combine is not.
4. **QC Preview**: inspect the complete composition or a selected original.
5. **Output**: enter a PSD filename and select a destination folder; choose
   Save New Version, Back Up + Replace, or Cancel.
6. Click **Generate Combine**. The app stages the Photoshop document and JPEG,
   verifies the complete outputs, and then publishes the matched files.

## Fixed rules

- Canvas width: **600 px**; height expands from image counts and wrapped labels.
- Single (optional): **600 x 600 px** at the top, with a **15 px gap** before the
  first included section (Line Up or Details). A Single-only export is exactly
  **600 px high**, with no empty section or trailing gap. Without Single,
  Line Up or Details begins at y=0 with no reserved 600 px blank area.
- Line Up: **2 columns**, image areas **293 x 293 px**, at x=3 and x=304;
  **8 px** between columns. Each variation has a **28 px editable text layer**
  beneath its image (6 px text separation, 36 px per text line, 7 px row gap).
- Details: **2 columns**, **293 x 293 px** cells, **8 px horizontal gap**,
  **7 px vertical gap**, with 3 px outer margins. Images move left-to-right,
  then down, exactly following the ordered queue.
- Omitted Single creates no empty 600 px area or Photoshop group.
- Omitted Line Up creates no dummy rows, empty Photoshop group, or color
  labels. Details group is named `02_DETAILS` when Line Up is omitted.
- Details heading: editable text. The placeholder gray squares and the
  template's instructional text are **not exported**.
- Product contents are fitted proportionally to their designated slot.
  Transparent/near-white outer blank pixels may be excluded from measurement
  with a safety margin; product contents are **never deliberately cropped**.
- All displayed images are independently editable embedded **Smart Objects**.
  PSD/PSB inputs additionally retain a hidden embedded original-source Smart
  Object, so designers can recover its internal layers.
- Output pairs: **PSD + JPEG**, or **PSB + JPEG** when height exceeds 30,000 px.
  If height exceeds 60,000 px, JPEG is exported as contiguous numbered parts.
- Source files (including the supplied Combine template) are never edited.
- Existing outputs are verified with SHA-256, backed up before replacement,
  and restored on failure where possible. Temp folders are cleaned up.

## Important implementation notes

- Supported inputs include PSD, PSB, JPEG, PNG, WEBP, TIFF, BMP, GIF and other
  supported codecs, subject to the installed Sharp/Photoshop decoders. Damaged
  files are rejected individually.
- Importing from the Windows multi-file picker may reflect the picker file
  order rather than precise Ctrl-click order. The UI explicitly shows ordered
  entries; use drag-to-reorder to guarantee the intended sequence.
- For opaque photographs where foreground and blank background have the exact
  same color, no software can identify the separation perfectly; confirm such
  images in QC and adjust them manually if needed.
- Photoshop on Windows is required for PSD/PSB input preview and final
  PSD/PSB/JPEG composition. No Python runtime is required.
- The module deliberately does **not** modify Amazon, Slider, either LP
  Generator, Remove BG, profile EXP/history, or Google Drive marker paths.
- Automated tests verify the layout/publisher. Actual Photoshop JSX execution
  needs a final local Windows/Photoshop test before team-wide deployment.

Run `npm.cmd run test:combine`, followed by `npm.cmd run validate`.

## Rakuten Slider Downloader (v1.7.23, download only)

The downloader is deliberately independent of the Combine composition step.

1. Paste a public Rakuten item URL (`https://item.rakuten.co.jp/glv/lvh-97/`)
   or the product's Rakuten GOLD iframe URL
   (`https://www.rakuten.ne.jp/gold/glv/six/lavenham/LVH-97.html`).
2. Optionally click **Choose Folder**. Without this, BrandForge saves under
   Windows Downloads automatically.
3. Click **Download Slider Images** once. For item URLs it first locates and
   scans a public slider iframe, not unrelated shopping-page images. The
   detected slide sequence keeps the website order exactly.
4. A unique product folder (e.g. `LVH-97/`) is created within the selected
   destination, with numbered files (`001_lvh-97_1.jpg`, etc.) directly inside.
   A `slider_manifest.json` records the URLs, sizes, status, and failures.
5. Click **Open Download Folder**. No classification, category subfolders,
   automatic uploads to Combine, PSD conversion, or JPEG recompression occurs.

Each image is saved byte-for-byte, with no crop/stretch/resize or conversion.
If one slide fails to download, the rest continue. Previous output is not
replaced by later downloads; a new versioned folder is used instead.

The original Combine upload areas remain available separately when the user
later decides which files are Single, Line Up, and Details.

Only official public HTTPS Rakuten domains are accepted. If a page blocks
requests or injects the iframe dynamically, use the direct iframe URL or
Advanced HTML input. The live Rakuten site is not accessible in every
network environment; only offline fixtures were verified here.

**No-stretch correction:** prepared Line Up/Details now use uniform `fit: inside` scaling with `withoutEnlargement`, and Photoshop applies one equal X/Y percentage to placed Smart Objects. Existing uploaded source image dimensions and pixels remain unchanged; exported 600 px layouts may downscale images to fit their boxes but do not enlarge a small image just to fill a 293 px slot. Re-test with your real source images in Windows Photoshop.

Test with `npm.cmd run test:rakuten-combine`, `npm.cmd run validate`. No Python is required to run BrandForge.

## v1.7.28 Rakuten item link detection

The Rakuten download-only importer now discovers GOLD iframe URLs in literal
HTML, encoded product-description HTML (`&lt;iframe&gt;`), escaped JSON/JS
strings, and one additional nested GOLD iframe layer. It prioritizes a gallery
whose URL or image filenames match the item ID, and it does **not** fall back to
unrelated product-gallery images. The scanner checks at most 12 GOLD pages.

This improves product-link support but cannot bypass Rakuten HTTP 403/429
responses or run arbitrary website JavaScript. If the item page refuses access
or dynamically creates an iframe after page load, open the item in a normal
browser, inspect the actual slider iframe, copy its `src` (for example a URL
ending in `/six/.../ITEM.html`), and paste that into the downloader. As another
manual fallback, paste the relevant iframe HTML in **Advanced** along with
the iframe URL. The original images are saved into a numbered local folder;
no Single/Line Up/Details categorization occurs.

Run `npm run test:rakuten-discovery`, `npm run test:rakuten-combine`, and
`npm run validate`. Live access is network-dependent and was not confirmed
against the user's particular Rakuten item URL.

## Combine Text Cleanup update (optional; installed with the Optional Single patch)

The **Remove Existing Image Text** panel provides a non-destructive way to
remove captions which are already baked into downloaded Rakuten JPG/PNG files.
It does **not** modify the Rakuten Downloader or automatically classify slides.

1. Download the slides with the existing Rakuten tool (still download-only), then
   click **Use Downloaded Slides** in **Remove Existing Image Text**. Alternatively
   choose raster images from anywhere with **Choose Images**.
2. Text detection uses BrandForge's existing **Tesseract OCR** if available,
   with `eng+jpn` language data preferred. Otherwise, on Windows it attempts the
   installed **Windows OCR** engine. Japanese text detection requires a Japanese
   OCR language pack; if not installed, there is no guarantee Japanese captions
   will be detected. If OCR is unavailable or misses text, use **Draw Text Area**.
3. Default selection mode is **Review**: nothing is approved automatically.
   Click detected rectangles or their checkboxes to select **only** captions,
   never product logos, labels, printed designs or textures. **Auto-select**
   suggests likely lower-half captions, but does NOT remove anything until you
   review the regions, preview the result and click Save.
4. Choose reconstruction engine:
   - **Built-in local background matching**: no added runtime dependencies,
     works best on simple/plain or repeating backgrounds. It samples neighboring
     background colors/patches and may blur or alter complicated patterns.
   - **Photoshop Content-Aware Fill**: uses your existing desktop Photoshop to
     reconstruct textured photos. It never opens the original directly, instead
     working on a temp PNG; output needs QC and actual Windows Photoshop testing.
     It is NOT a bundled LaMa neural-network model.
5. Click **Preview Text Removal**, compare **Original + Regions** with **Cleaned
   Preview**, and adjust regions if the repair affects a product. You cannot
   save a changed selection until previewing again.
6. Choose **Line Up**, **Details**, or **Single**, then click **Save Clean Copy +
   Add to Combine**. A new PNG is saved in `COMBINE_CLEANED/` next to the input
   file, using `_textclean.png` or `_textclean_v2.png` etc. Existing files,
   including the original Rakuten downloads, are never overwritten. The new
   image is registered with the standard Combine upload pipeline.
7. If exactly one OCR caption was approved, **Reuse one removed OCR caption**
   can fill in the **editable 28px Line Up color name**. The text remains
   editable through the existing Line Up controls and inside the output PSD.

**Compatibility**: Single is optional. Any nonempty combination of Single,
Line Up, and Details is valid; a completely empty Combine is rejected.
No Python installation is needed to run BrandForge. You do not need a new npm
package; the feature uses the existing `sharp` dependency and the existing
OCR/Photoshop services. Bundled raster quality and UI tests run without Windows;
real Tesseract/Windows OCR and Photoshop actions must be checked on the user's
Windows workstation.

Tests: `npm run test:combine`, `npm run test:combine-cleanup`, then
`npm run validate`. The optional `python test/combineCleanupBrowser.py` is a
QA-only browser fixture and is NOT required by BrandForge users.

## v1.7.29 — Full-width dual-item Line Up rows

For downloaded images showing **two products and two color captions inside
ONE JPG/PNG source file**, choose `2 items · ONE full row` in that image's
Line Up entry. This is also available in bulk with `All images -> 2 items /
full row`. To return to the old behavior, choose `1 item · half row` or use
`All images -> 1 item / half row`.

- Regular items: continue in pairs, left-to-right, one 293x293 slot per file.
- Dual items: remain a **single complete 594px-wide image** centered in a
  dynamically sized full row. Never split the image down the middle; preserve
  its original aspect ratio and non-destructive embedded Smart Object.
- Each dual row adds **two distinct editable 28px Photoshop text layers** named
  `COLOR_NAME_N_LEFT` and `COLOR_NAME_N_RIGHT` under their respective items.
- Image order is exact: a dual row interrupts any pending regular row; the
  next regular image starts a new row. Any number of dual rows can be stacked.
- Enter LEFT and RIGHT names for each dual image. Bulk input uses one image
  per line, with `LEFT NAME | RIGHT NAME` for dual rows.
- While using Text Cleanup, approving one OCR caption on each half of a
  downloaded image allows the saved clean copy to import as a **dual row**
  automatically. OCR extraction works on approved regions only. Always inspect
  the cleaned preview; OCR may be unavailable or imperfect.
- Source JPG/PNG files that still include printed captions will still show
  those captions. Use the separate **Remove Existing Image Text** panel first
  to eliminate duplication while keeping the source originals unchanged.
- Single is **optional**, and Details continue supporting the old 293px grid.

Tests: `npm run test:combine`, `npm run test:combine-cleanup`, and
`npm run validate`. Optional browser QA: `python test/combineDualRowBrowser.py`
(requires Playwright/Chromium only for QA, not to run BrandForge). Photoshop
JSX/PSD export still needs verification on the Windows workstation.

## v1.7.32 — Close captions and dual-name input guard

Raster images are measured for visible product bounds at import. Regular Line Up
rows expand only as tall as the largest fitted product in the pair, with both
products bottom-aligned and their text boxes placed 6px beneath visible pixels.
Dual-item rows use the visible full-width composition ratio instead of an
unnecessary minimum blank height. Photoshop placement now honors the layout's
actual x/y offsets, including bottom-aligned products. The source file and its
full original PSD Smart Object remain unchanged. Unsupported PSD measurement
uses the source document dimensions as an import-time fallback.

The UI checks for LEFT and RIGHT names locally before requesting the layout:
while a new dual-item name is blank, it displays an inline message and disables
Generate, instead of repeatedly logging exceptions from Electron.

## v1.7.33 — Precision text-only eraser

The cleanup panel now supports Brush Select/Restore and Eraser that edit a
**selection mask**, not the original image. Users can also undo/redo mask edits,
adjust the brush diameter and use 0–3px inner-edge feather. Approved OCR boxes
and manual rectangles remain available and can be refined with the eraser.

**Clean Fill** is the default: locally interpolates nearby unselected source
pixels into *selected pixels only*; it never copies nearby textured products or
invents a product detail. Eraser holes are excluded from background sampling,
because they may themselves contain text or protected product pixels.
Content-Aware Fill is available only for rectangle selections (without brush
or eraser edits); attempts to use it with a precise mask are blocked to prevent
Photoshop from accidentally editing excluded product pixels.

**Safety:** Original images stay unchanged; new versions are saved inside
`COMBINE_CLEANED`. Preview approval is invalidated when the mask, feather, or
engine changes. Complex backgrounds still require manual QC; no automated tool
can guarantee perfect preservation when unwanted text overlaps a product.


## v1.7.36 — Rakuten Auto-Clean After Download

Downloader checkbox **Automatically remove safe color captions** defaults to ON.
Originals remain directly in the numbered product folder, byte-for-byte unchanged.
For each slide, the downloader calls local Tesseract / Windows OCR and attempts
Clean Fill only for short, strongly detected caption regions on clearly uniform
light backgrounds. Generated cleaned PNGs live inside `COMBINE_CLEANED`;
`slider_manifest.json` records `autoCleanupEnabled` and each image's `cleanup`
status (`cleaned`, `partial`, `no-caption`, or `needs-review`), clean path,
detected color-name text, and relevant warnings. One uncertain image never
prevents remaining originals from downloading.

When OCR merges two side-by-side color labels, a large-gap check triggers
additional OCR passes on each image half to avoid erasing the full row between
the two labels. Images without a confident, safe caption are not modified.
All images still require visual review for missed text or artifacts, and the
existing manual Brush/Eraser cleanup tools remain available. The downloader
is still separate from Combine PSD/JPEG generation: no automatic grouping,
classification or image import. This does not require Python to run.

Tests: `npm run test:rakuten-auto-clean` and `npm run validate`.
Optional UI QA: `python3 test/rakutenAutoCleanupBrowser.py`.
