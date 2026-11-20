# BrandForge v1.7.55 — Photoshop Compatibility Manager

New **Settings > Photoshop Compatibility Manager** helps you detect Photoshop updates before production. It scans installed Photoshop/COM registration, parses each module's JSX (including the complete Slider worker), runs an opt-in live scratch PSD/JPEG/Smart Object test, remembers the last successful Photoshop version, and saves a detailed compatibility report. You may require 2026 (27.x), 2027 (28.x), or Auto, but this only **guards against running the wrong version**—it does not change Windows COM registration or automatically install/select Photoshop. The original v1.7.54 Slider JSX fix and the working 2027 ROT fallback are preserved.

**After any Photoshop update:** restart BrandForge, choose Settings > Scan Installed + Check Scripts, run the Live Test with Photoshop open, and generate one real output from each Photoshop module before processing batches. The live preflight cannot certify AI Select Subject or an entire production PSD workflow. See `CHANGELOG_v1.7.55.md`, `PATCH_README_v1.7.55.md`, and `docs/PHOTOSHOP_COMPATIBILITY_MANAGER_v1.7.55.md`.

---

# BrandForge v1.7.54 — Slider Photoshop 2027 JSX syntax fix

Fixes the Slider Maker error `Photoshop - Error 4: Unterminated string constant` at the generated `__sliderWriteStatus("ERROR` line (~4060), seen after the ROT fallback reached Photoshop 2027. The Slider Photoshop worker wrapper accidentally embedded a real newline in a quoted string. This release generates a correctly escaped `"ERROR\n"` literal and adds full generated-JSX parsing tests. On ROT failures that actually reached Photoshop and then failed JSX execution, diagnostics now identify the Photoshop script error rather than reporting only COM 429.

The v1.7.53 ROT fallback, working Remove BG/Add Shadow, all original Slider creative/lineup/details rules, individual color-variant drag/drop, Amazon, Combine (JPEG/HTML/PSD), folders, History/EXP and Arcade are preserved. This is a **source-only** Windows Electron project; compile the portable EXE on Windows with `npm install` and `npm run build:portable`.

Validate: `npm run test:slider-jsx`, `npm run test:slider-open`, and `npm run validate`. On Photoshop 2027, reopen BrandForge and try one TEST_CODE Slider PSD first. If a *different* error occurs, save its full log. Photoshop 2027/COM live execution was not available in the Linux test environment. Details: `CHANGELOG_v1.7.54.md` and `PATCH_README_v1.7.54.md`.

---

**v1.7.53 update:** Experimental Photoshop 2027 ROT fallback for `GetObject`/`CreateObject` error 429. The existing COM automation still runs first; on a connection failure, a non-activating PowerShell COM interface probe tries an already-running Photoshop 28.x object if one exists. Windows field QA is required; this cannot repair a Photoshop build that exposes no COM scripting object. See `CHANGELOG_v1.7.53.md` and `docs/PHOTOSHOP_2027_ROT_FALLBACK_v1.7.53.md`.

# BrandForge v1.7.52 — Photoshop 2027 compatibility hardening

Based on the user-uploaded `brandforge latest.zip` (v1.7.50). Supports Photoshop 2026 (27.x) and **Photoshop 2027 (28.x)** when their Windows COM/JSX automation works. A single shared queue now prevents competing Photoshop tasks. JSX scripts get UTF-8 BOM to preserve Japanese captions; 2027 can fall back from `DoJavaScriptFile` to `DoJavaScript` if no completed worker receipt exists. Remove BG tries a second safe Select Subject descriptor, but refuses to publish an invalid cutout. Settings > Test Photoshop shows version, connection and JSX invocation method. **Does not bypass Adobe's broken COM registration/AI engine; Windows 2027 runtime testing still required.** See `CHANGELOG_v1.7.52.md` and `docs/PHOTOSHOP_2027_COMPATIBILITY_v1.7.52.md`.

---

## BrandForge v1.7.50 — Slider Line Up color movement

In the Slider Maker, each color variant tile is draggable independently. Drag the color **tile**, not the entire Line Up group: an occupied target swaps the two color variants while keeping each photo, caption, and Shadow setting together. Empty targets accept a move. The old whole-card drag handle is removed. PA Vertical moves the linked Item + Item Detail pair using its single color handle. See `CHANGELOG_v1.7.50.md`.

# BrandForge v1.7.49 — Slider Maker Drag & Drop

**Slider Maker (Creative / Line Up / Detail):** Drag image files from Windows Explorer directly onto the marked drop zones, their lists, or the matching sidebar tabs. Existing file-picker buttons still work. Bulk Line Up drops append photos in source order into available slots, creating additional cards as needed (2 per card for Horizontal, Vertical and PA Vertical; 4 for Four Cut). Dropping a single image onto an occupied Line Up slot requests confirmation before replacing it; the old caption is then cleared so it cannot label the wrong product. Supported dropped inputs: JPG/JPEG, PNG, WEBP, GIF, BMP, TIFF, PSD/PSB, AVIF, HEIC/HEIF, TGA, subject to Photoshop/Sharp format support for actual generation. Unsupported or missing files are reported, not silently imported.

**Reorder:** Drag the **Move card** handle in a Line Up card header to reorder complete groups. Drag the **⋮⋮ color handle** within a photo slot onto another slot (same or different card) to move or swap that single photo **with its variant name and Shadow setting**. Four Cut supports the same behavior. In PA Vertical, dragging an individual slot is deliberately disabled because Item and Item Detail are a linked pair; whole-card movement is supported. The current color/caption position is what goes into the Slider PSD and the New Brand Combine handoff. Creative/Detail card ordering and Overview ordering stay intact.

**Slider → Create Combine for New Brand:** The review screen accepts dropped images directly into Line Up or Details, and lets you drag reviewed image rows to reorder or move them between sections. You can also drop a Single photo onto the Single field. Re-importing Slider categories warns before discarding manually dropped review images. The reviewed order is passed unchanged to the existing Single → Line Up → DETAILS layout, 600px JPEG, local HTML, and optional layered PSD/PSB. The font remains **Hiragino Kaku Gothic Pro W3, 28px**; no text removal.

**No changes** to existing Amazon/Colorbox/Combine generators, original Slider image geometry/cropping rules, EXP/History, or output-folder selection. Slider drag-and-drop is local Windows Explorer input and does not upload files to a server.

**QA:** `npm install`, `npm run test:slider-drag-drop`, `npm run test:slider-new-brand`, `npm run validate`, then `npm run build:portable` on Windows. Source-level drag/drop and layout tests run in the container. Test live Explorer drag events, PSD generation and clipboard/file format support in Windows Electron before production use.

---

# BrandForge v1.7.48 — Slider -> New Brand Combine

Open **Slider Maker**, add your Creative / Line Up / Detail images as usual, then click **CREATE COMBINE FOR NEW BRAND**. This new workflow is inside BrandForge (not the Rakuten Standalone converter).

- Import & Classify from Slider: existing Slider Line Up groups become suggested Line Up images; Slider Detail and Creative become suggested Details. PA Vertical's feature image starts in Details. This is section-based detection **not OCR**. Move/reorder individual images in the review panel before generation.
- Manually upload an optional Single image (broad image types). Select output folder; BrandForge remembers the last Single/output folders. Output name defaults to `{ProductCode}_COMBINE` and will version safely if the same filename exists.
- **Final layout:** Single (600px, if supplied) -> 15px gap -> two-column Line Up (293px cells, 8px gap, 7px rows, original 28px captions) -> DETAILS heading -> two-column Details. Original image proportions and original embedded text are preserved. Caption text is optional when the source photo already contains text. The new names use Hiragino Kaku Gothic Pro W3 when installed; no text removal.
- Generate JPEG and local HTML first **without Photoshop**. HTML is table-only markup referencing the JPEG file(s) beside it; enter a public HTTPS JPEG folder URL to produce publishing-ready image links. The image files must separately be uploaded to that host before using the HTML on Rakuten.
- Check **Also generate editable PSD/PSB** for Photoshop Smart Object output. Photoshop failure is reported as a warning and does not delete the JPEG or HTML. A PSD/PSB input file requires Photoshop even for JPEG preview/rasterization.
- Existing Slider PSD generation, Combine Generator, Rakuten iframe batch, project markers, profiles, and EXP remain in place.

## QA / build

`npm install` followed by `npm run check`, `npm run test:slider-new-brand`, and `npm run build:portable` on Windows.

**Local-only verification available here:** synthetic JPEG/HTML export tests and original Combine/Slider planner regression tests. Windows Electron visual operation, installed Hiragino font, live source image types, and Photoshop PSD saving must still be tested on the actual Windows PC.

---

## v1.7.46 Combine HTML + JPEG Excel batch

Same worksheet: IFRAME | OUTPUT (HTML code) | HTML FILE LINK | JPEG FILE LINK. HTML remains 780px (2 Line Up / 3 Details columns); JPEG now follows the original 600px Combine geometry (2 Line Up / 2 Details columns), no Photoshop. Full details: CHANGELOG_v1.7.47.md.

# BrandForge v1.7.43 - Windows VBScript compilation hotfix

**Fix:** Photoshop Test failed with `probe.vbs(2, 10) Microsoft VBScript compilation error: Invalid character` in v1.7.42. The shared COM launcher generated VBScript variables beginning with `__bf`, which is not a legal VBScript identifier. This release renames them to `BF...`, tightens validation for generated variable names, and reports VBScript compilation errors distinctly from COM failures.

**Scope:** The Photoshop connection helper shared by Settings, Amazon, Slider, Combine, Landing Page and Remove Background. No changes to image positioning, PSD output templates, EXP, Arcade, or Google Drive saving logic.

**Windows steps:** Extract the full project or merge the changed-file patch into your existing v1.7.42 source, then run `npm run check`, `npm run test:photoshop-2027`, and `npm run build:portable`. Open Photoshop 2027, launch the NEW portable EXE, then Settings > Test Photoshop. A further COM error after the compile fix requires the diagnostic report. The compiled EXE is not part of the ZIP.

**Testing:** Node bridge tests and script text/BOM checks passed; cannot execute Windows VBScript/Photoshop COM in this environment.

---

# BrandForge v1.7.42 — Photoshop 2027 (28.x) COM recovery + diagnostics

This release centralizes the Windows Photoshop `Photoshop.Application` connection across Amazon, Slider, LP, Combine and Remove Background. Settings > **Test Photoshop** now checks COM + JSX, shows the connected version and connection method, and writes a read-only local report (Open Diagnostics). It first tries to attach to running Photoshop, then tries the registered COM server. No original JSX layouts, image selection, profile data, history/EXP, or Arcade content is changed. **It cannot repair a broken Photoshop 28.x COM installation**; see `docs/PHOTOSHOP_2027_CONNECTION.md`.

To build a portable Windows EXE: `npm install` then `npm run build:portable`. Test via `npm run check` and `npm run test:photoshop-2027`.

---

# BrandForge v1.7.40 — LP / Combine / Remove BG History + EXP, Slider Line Up Centering

**Production History + EXP:** Both LP generators (Screenshot LP and Folder LP), Combine, and Remove Background + Add Shadow now record completed production jobs for the currently signed-in BrandForge profile. Each successful generator records its result **after verified output publishing**, adding a clearly labeled History entry, EXP, output-file counts, and a module-specific lifetime counter. Remove Background and Add Shadow are independent phases: each records one event per successful batch (including partial batches). Failed runs, empty/previously completed BG batches, scans, previews, and Arcade games earn no production EXP.

EXP formulas: Screenshot LP **20 + 2 per input**; Folder LP **20 + 2 per image layer**; Combine **20 + 2 per source image**; Remove BG **10 + 4 per successfully processed image**; Add Shadow **10 + 5 per successfully created PSD**. Existing Amazon/Slider/Colorbox EXP formulas are unchanged. History is stored in local `profiles.json` under Electron userData; older profile stores get new counters automatically without losing previous progress. If saving an EXP entry fails, the completed export is reported as successful with a separate warning; no duplicate processing is triggered.

**Slider Line Up centering:** After building a Line Up group, Slider measures the **actual visible product bounds**, calculates equal left/right margins on its 600px canvas, and horizontally translates the complete editable group in one operation. This covers side-by-side, stacked vertical, PA Vertical, and Four Cut modes; it also centers single populated slots. **No resizing, cropping, or stretching:** existing product-to-caption spacing, groups, layer order, and shadows are retained. Slider's unlimited output count and bottom 50px Cut Image behavior remain unchanged.

Testing: `npm run check`, `npm run test:production-history`, `npm run test:slider-lineup-center`, and the full existing per-module test suite. In Windows, generate one asymmetrically padded side-by-side Line Up and one PA Vertical/4-Cut PSD, and check outer visible margins in Photoshop. Photoshop COM execution cannot be validated in this container.

Install: back up your original project, merge this source ZIP into the project root, run `VERIFY_BRANDFORGE_ROOT.cmd`, `npm run check`, `npm run test:production-history`, `npm run test:slider-lineup-center`, then `npm start`. No new runtime dependencies or Python installation are required. See `INSTALL_FULL_PROJECT_v1.7.40.txt`.

---

## v1.7.38 — Combine selected-caption auto-fill

After marking embedded caption text with an OCR box, Rectangle, or Brush Select,
**Preview Text Removal** now reads the selected original pixels before erasing
them and shows editable recovered text. **Save Clean Copy + Add to Combine**
automatically fills Line Up names (Single / LEFT-RIGHT / TOP-BOTTOM) while
keeping their 28px PSD text layers editable. Original caption Y positions are
preserved for vertical layouts. OCR failures do not block cleaning; review and
manually correct names when needed. Single/Details retain recovered text as
non-exported editable notes. The downloader still preserves originals and
does not auto-assign images into Combine. No new runtime dependencies.

---

# BrandForge v1.7.37 - Combine Dual Vertical TOP/BOTTOM Line Up

**New Line Up mode:** choose **2 variants - vertical (TOP / BOTTOM)** for a single downloaded image containing two products stacked vertically. The complete source image remains one full-width block. Use independent 28px editable color names for the top and bottom item; the names are placed **within the source image's original caption positions**, not as two labels underneath it. The default positions are 44% and 92.5% of source height, and each can be adjusted in the per-image controls. One Line Up image is one full-width vertical row.

**Existing horizontal workflow unchanged:** single-item images remain two per row (293px columns, proportional height); horizontal dual images remain one full row with LEFT/RIGHT editable 28px names. Other Combine, Amazon, Slider, LP, background removal, and Rakuten downloader rules remain intact.

**OCR position reuse:** In Combine Text Cleanup, if exactly two approved OCR captions are clearly separated top/bottom, **Save Clean Copy + Add to Combine** now assigns TOP/BOTTOM names and the detected original Y positions automatically. Similarly, if you import an already auto-cleaned PNG from the Rakuten downloader's `COMBINE_CLEANED` folder, Combine can retrieve its safe caption positions from the accompanying `slider_manifest.json`, when that file is present. You can override both names and Y positions. OCR can miss text: manually select vertical mode and adjust percentages if detection is inconclusive. The original images are never overwritten. Auto-downloading remains download-only, without auto-classification.

**Bulk naming:** `TOP NAME :: BOTTOM NAME` (vertical) vs. `LEFT NAME | RIGHT NAME` (horizontal). A new 'All -> Vertical (T/B)' button is provided alongside the prior batch mode buttons.

**QA:** `npm run check`, `npm run test:combine-vertical`, `npm run validate`, and optional browser `python3 test/combineVerticalBrowser.py`. Actual Windows Photoshop COM/JSX and live Rakuten OCR still need local validation. See `INSTALL_FULL_PROJECT_v1.7.37.txt`.

---

# BrandForge v1.7.36 - Auto-Clean Captions After Downloading Rakuten Slides

Combine's Rakuten Slider Downloader now offers **Automatically remove safe color captions after downloading**, ON by default. Each original slide is saved byte-for-byte, in website order, exactly as before. The downloader then runs existing local OCR + **Clean Fill** on short detected captions surrounded by a uniform light background; cleaned PNGs are versioned in `COMBINE_CLEANED` under the product folder. When OCR joins two separate left/right color names into one line, the system attempts to detect the gap and recognize each half separately (it does not erase the full combined width).

**Safety:** Only high-confidence, simple caption regions are auto-edited. Text overlapping a product, complex texture, unknown language, unsupported image formats, or an unavailable OCR engine is **left unchanged and flagged for review**. The original can always be opened in the existing manual Brush/Eraser text cleanup tool. Use **Show original thumbnails** in the downloader to compare originals with auto-cleaned previews. No Photoshop Content-Aware, network AI, new npm dependency, or Python runtime is required; locally installed Tesseract (preferably English + Japanese language packs) or supported Windows OCR is used. Full automatic accuracy is not guaranteed.

**No auto-classification:** Downloading does not add files to Single, Line Up or Details. Import the cleaned PNGs manually when ready. The slide manifest records original paths, cleaned paths, names, and review warnings. Previous Amazon, Slider and Combine generation behavior is unchanged.

Verified with `npm run validate`, optional browser UI test, and a local Tesseract run on an earlier dual-coat Line Up sample. Real Windows OCR, Photoshop and live Rakuten downloads must still be checked on the user's PC. See `INSTALL_FULL_PROJECT_v1.7.36.txt`.

---

# BrandForge v1.7.35 - Combine Single-Variant Line Up Image Sizing

Complete Electron/Photoshop source project, based on the user's merged v1.7.34 project (`updated 1.33.zip` plus Amazon Hide Completed/Assigned). Keeps the user's customized Slider renderer files intact.

## Fixed: single-variant lineup images look smaller than dual-variant images

The prior Combine planner forced every regular one-variant Line Up image into a **293 x 293 px** square, even for portrait clothing. Adjacent dual-item image rows can display almost twice the product height. This caused one-color coats in mixed row layouts (for example CHN-96) to look much smaller.

**New behavior:** regular one-variant Line Up images still occupy one **293 px column**, but may use up to **594 px of visible height**, maintaining the original aspect ratio without cropping, stretching, or resizing the original source file. Captions remain editable 28 px Photoshop text layers, 6 px below the visible image bottom. Two regular images still share a row when adjacent; rows with a dual-item source still take one full-width row with separate LEFT and RIGHT color labels. Details remain 293 x 293 px. The prior image order and optional Single behavior are unchanged.

The adjustment is made in the Combine layout planner and displayed in the existing Combine preview. Photoshop's existing image preparation and Smart Object placement honor the resulting dimensions. The images imported/downloaded by BrandForge are not modified.

## Files modified from user merged v1.7.34 baseline

- `src/modules/combine/main/planner.js` - permit taller regular Line Up product slots, using uniform aspect-ratio-preserving fit.
- `src/modules/combine/renderer/app.js` - clarify the 1-variant mode label.
- `test/combine.js` and `test/combineSpacing.js` - regression tests for mixed dual/solo Line Up source heights and PSD preparation.
- `package.json` and `package-lock.json` - version bump.
- `README.md`, `INSTALL_FULL_PROJECT_v1.7.35.txt` - usage notes.

## Installation

1. Close BrandForge. Back up the current project folder.
2. Extract this full project ZIP. Copy extracted contents into `D:\gulliver-image-workflow\gulliver-image-workflow`, merging folders and replacing matching files.
3. Run `VERIFY_BRANDFORGE_ROOT.cmd`, then `npm run validate` and `npm start` from the project root.
4. In Combine, assign one single-variant portrait image between two dual-item rows and check it in the full layout preview, then generate PSD/JPEG using Windows Photoshop for final verification.

**Important:** This ZIP contains complete source, not an EXE. Actual Windows Photoshop COM/JSX execution cannot be validated in this Linux environment; check it on your workstation.

---

# BrandForge v1.7.34 - Amazon Hide Completed / Assigned

**Complete Electron source project** (not an EXE). This release adds optional
visibility filters to the existing Amazon Batch Workspace and does not change
its image processing or Photoshop implementation.

**New Amazon workflow:** Both **Hide completed IDs** and **Hide assigned images**
start enabled. Assign 1-8 images to a Product ID and click **Mark Done & Next**.
The completed ID is hidden from the list while the app selects the next pending
ID, reducing repeated scrolling. The library hides images already assigned to
any Product ID; use **Show All** or uncheck the library filter to reuse them.
A selected image is never hidden just because a filter changed mid-pick.

**No files or assignments are deleted.** Share Images, Colorbox, image order,
the eight-image maximum, and all other modules remain unchanged. A completed
ID can be reopened and edited; modifying a finished image set resets it to
pending. This is a manual progress flag, not an 8/8 requirement or persistent
draft system. All in-progress groups are cleared on app restart as before.

**Verification:** `npm run validate` and the optional browser interaction test
`python test/amazonBatchVisibilityBrowser.py`. Actual Windows Photoshop
execution must still be checked on your machine.

Read `INSTALL_FULL_PROJECT_v1.7.34.txt` for installation steps and
`UPGRADE_v1.7.34.txt` for the changed-file inventory.

---

# BrandForge v1.7.33 — Precision Combine Text Cleanup

**Complete Electron source project**, including all features and fixes from
v1.7.32. Photoshop Windows execution has not been tested in this environment.

**New Combine Text Cleanup controls:** Brush Select / Restore, Eraser (selection
mask only), Rectangle, Undo/Redo, brush-size slider, optional 0–3px inner-edge
feather. The default restoration method is **Clean Fill**: it interpolates
background from the image's unselected pixels. The mask is displayed in green,
and the eraser subtracts from it without touching the source file. Clean Fill
never copies a foreign product texture or invokes Content-Aware Fill, and does
not edit pixels outside the selected mask. Review results carefully where the
text overlaps product details or textured backgrounds.

**Photoshop Content-Aware remains optional**, but because its current JSX
interface fills rectangles, it cannot process precise brush/eraser holes. The
app explicitly requires Clean Fill whenever brush/eraser strokes are present.
The legacy local texture-matching mode is retained only for compatibility.

OCR/manual selection, before/after QC, versioned `COMBINE_CLEANED` PNG output,
reused 28px editable color names, optional Single and dual-item Line Up rows,
Rakuten download-only import, unrestricted Slider item count, and the Slider
50px Cut Image footer remain unchanged.

**Validation:** `npm run validate`, `node test/combinePrecisionCleanup.js`, and
optional Chromium UI QA `python test/combinePrecisionBrowser.py`. Read
`INSTALL_FULL_PROJECT_v1.7.33.txt` before merging into your source folder.

---

# BrandForge v1.7.32 — Combine Spacing + Slider Cut Image Maximize

Full source project for Windows Electron + Adobe Photoshop. Includes all
v1.7.31 features (Optional Single, dual-item Line Up, Rakuten downloader,
non-destructive Text Cleanup, and unlimited Slider output-item count).

**Combine changes**
- Line Up captions now follow the visible product bottom, not unused white or
  transparent padding in the source image.
- Regular Line Up images remain two per row, with bottom-aligned products and
  the original editable 28px caption layers. Dual-item images stay intact as
  one full-width row with two separate editable 28px LEFT/RIGHT names.
- Empty color-name fields show local guidance without repeatedly triggering
  Electron layout errors. Generate stays disabled until required names exist.
- Input images, PSD source and other generators remain untouched.

**Slider changes**
- Detail Cut Image now scales uniformly to COVER the 600x550 visible canvas.
  Overflow remains non-destructively clipped, and the 50px white bottom is
  retained; normal Detail, Creative and Line Up are unchanged.
- 19 Slider images are still optional; there is no fixed maximum.

**Testing and usage**
- `npm run validate` passed on the source (including new sizing tests).
- Real Windows Photoshop COM/JSX operation must be checked locally before
  replacing any production installation.
- Read `INSTALL_FULL_PROJECT_v1.7.32.txt` for merge instructions.

---

# BrandForge v1.7.30 — Slider Flexible Image Count

**Slider no longer has a fixed output-item limit.** The prior 18-item ceiling was
removed from the Electron UI, validation, Photoshop job runner and standalone
Photoshop dialog. Nineteen output items are allowed, **not required**: 1, 19,
20, 25 or more are accepted. The UI shows the actual item count, and generation
is disabled only for zero items or while processing.

**All previously approved v1.7.29 Combine functionality is preserved**, including
optional Single, Text Cleanup and dual-item full-width Line Up rows. The Amazon,
Colorbox, LP, Remove BG, Profiles and G: project-location workflows are unchanged.

For installation, see `INSTALL_FULL_PROJECT_v1.7.30.txt`, and for Slider specifics,
see `UPGRADE_v1.7.30.txt` and `src/modules/slider/README.md`.
The expanded counts have automated regression coverage; actual high-count
Photoshop generation still needs a Windows workstation trial.

---

# BrandForge v1.7.29 — Complete Project: Dual-Item Line Up Rows

This is the **FULL Electron source project** (not just an incremental patch and
not a compiled EXE). The previous BrandForge v1.7.28 source, Optional Single,
Rakuten Downloader and non-destructive Text Cleanup are retained.

## New Combine behavior

- **Regular Line Up:** 2 separate image files per row; each gets its own
  editable 28px color label, as before.
- **Dual-item Line Up:** 1 source image with 2 products occupies **one full
  594px-wide row**. The complete source stays ONE Smart Object, not cut into
  two images. Two independent editable 28px labels appear below it, at left
  and right. The row height follows source aspect ratio (fit inside, no crop).
- Uploads can mix regular and dual images. Their visual order is preserved;
  regular rows are flushed before a full-width dual row. Multiple dual-item
  images become separate vertically stacked rows.
- Each imported Line Up image has a **1 item / 2 items** selector; use
  **All images -> 2 items / full row** for a folder of dual-product images.
- Bulk color names: one line per uploaded image; for a dual image write
  `Off White (012) | Spugnola (110)` (left name | right name).
- If you remove two **approved OCR color-name captions** through Text Cleanup,
  with one detected on each side of the image, the cleaned import is
  automatically set as a dual-item row and both captions fill the new names.
- **Original downloaded captions are not silently erased.** Use Remove Existing
  Image Text, preview the reconstruction, and save a cleaned copy before
  generating, otherwise original embedded captions may appear alongside the
  new editable labels. Original files are never overwritten.
- Optional Single and Details-only generation stay supported. Amazon, Slider,
  Colorbox, both LP generators, Remove BG, Profiles, and project-location
  handling are not altered by this change.

For installation, read `INSTALL_FULL_PROJECT_v1.7.29.txt`. For Combine details,
see `src/modules/combine/README.md` and `UPGRADE_v1.7.29.txt`.

---

# BrandForge v1.7.28 — Rakuten Product URL Slider Detection Fix

## New in v1.7.28 — Rakuten Slider Downloader

- Accepts Rakuten item links when the slider iframe URL is present in literal HTML, encoded description text, escaped JavaScript/JSON, or a nested GOLD iframe.
- Finds and prefers the slider matching the item code rather than unrelated product carousels.
- Reports how many candidate GOLD pages were checked and returns a clearer fallback when access is blocked.
- Retains **download-only** behavior: original bytes, site image order, numbered local folder, and no Combine categorization.
- Original Amazon, Slider, Colorbox, LP, and Combine generation modules are unchanged.
- Browser-access restrictions may still require the actual iframe URL.

See `UPGRADE_v1.7.28.txt` and `src/modules/combine/README.md`.


- **Slider Maker:** Generate now always requires a save destination (auto-linked G: project or selected folder). After verified publishing, Photoshop opens the **actual saved PSD**; temporary/staged documents are closed, not left as the active output. If an existing tab contains unsaved edits, it is left intact and a warning is shown.
- **LP Folder Generator:** Saves the finished PSD/PSB and JPEG(s) beside the source images. Internal JSX scripts, temporary assets, backups and the generated-output index live in OS temp / BrandForge local app data, **not** the LP output folder. Historical BrandForge-only helper indexes can be migrated on scan.
- **LP naming:** Enter Product ID `ABM-90` to export `abm-90lp.psd` and `abm-90lp.jpg` (lowercase, no spaces between ID and `lp`). Existing `ABM-90_LP.psd` input style also normalizes to this convention.
- Preserved: Amazon image sizing, 4-edge creative cover, Share Images, Colorbox, Combine, Slider layout/text, both LP layout engines, Profiles/EXP. No LAN leaderboard.
- **Validation:** Automated tests. Actual Windows Photoshop and G: Drive handoff still require workstation QA.

---

# BrandForge v1.7.26 — Amazon 4-Edge Full-Canvas Cover

- Restores the original **four-edge proportional cover** rule for Amazon Images
  2–8, with 4% extra enlargement. No portrait/landscape aspect-ratio limit:
  four-edge photographs now cover every part of the 1001×1001 JPG canvas.
- A 2100×3150 portrait TIFF renders as a 1041×1562 image centered at
  x=-20, y=-280. The top/bottom overflow is intentional and the complete
  resized frame remains an **editable embedded Photoshop Smart Object**.
- The PHOTO framing protection introduced in v1.7.25 remains: do not trim
  beige/photo backgrounds or the intentionally white half of a composed image.
- **Image 1 still follows 801×801 sizing**; normal Images 2–8 still use
  921×921. Cut detection (1–3 edges), Amazon Sharing, image order, master PSD,
  Colorbox Generate/Skip, Google Drive markers, and all other BrandForge
  modules remain unchanged.
- See `UPGRADE_v1.7.26.txt`. Tested on synthetic TIFFs and the uploaded
  portrait TIFF/JPEG examples using the native Amazon renderer. Windows
  Photoshop and G: shared-drive exports still require workstation QA.

---

# BrandForge v1.7.25 — Amazon Creative Frame Fix

- **Uploaded old `amazonRules(3).js` is the reference** for Amazon 1001px output, Image 1 centered inside an 801px safe area and Images 2–8 using the 921px base sizing.
- Photographic/full-frame sources (including beige-background TIFF model shots and images with a white panel beside a photo) keep the **whole original frame**. The renderer no longer trims or removes an intentional background panel as blank pixels.
- Four-edge cut detail images are **proportionally enlarged and centered**. Near-square creative images use full-bleed cover +4%; very tall/wide photographic images preserve the overall composition with only a gentle 4% long-axis overflow.
- True white/transparent isolated products still use visible-pixel measurement and the existing cut-edge positions. No nonuniform scaling, splitting or forced content rewrite.
- Standard JPGs stay 1001x1001. Off-canvas pixels remain inside their separate full-size embedded PSD Smart Object when overflow occurs.
- Amazon Sharing, Folder/Batch modes, Slider, Colorbox selection, Google Drive marker locations, LP generators, Combine and local Profiles/EXP are unchanged.
- Use `npm run test:amazon-creative` to check the new regression cases. **Actual Photoshop placement and Google Drive publishing still need a Windows production trial.**

See `UPGRADE_v1.7.25.txt` and `AMAZON_CREATIVE_FRAME_FIX_SPEC.md` for details.

---

# BrandForge v1.7.24 — Amazon Cut-Edge Full-Bleed Update

## v1.7.24 — Controlled edge enlargement without stretching

- For NORMAL images, Amazon still fits into its original 801px (Image 1) or
  921px (Images 2–8) safe area on a 1001 x 1001 canvas.
- For CUT images, the source is measured by visible pixels; the detected cut
  sides align with the output canvas and the image is proportionally enlarged
  by **4%**. Four-edge-cut images use proportional full bleed when practical.
- The JPG/PNG is only the 1001px viewport. A second uncropped, enlarged PNG
  is embedded into the **flat master PSD Smart Object** for any image that
  extends off-canvas, so repositioning the layer in Photoshop can reveal the
  overshoot. Existing PSD marker templates are not modified.
- Extreme panoramic/tall four-edge sources have a protective overscan limit
  rather than cropping almost all their subject just to paint every corner.
- All other Amazon rules and Combine/Rakuten, Slider, LP, Remove BG, Profile,
  Sharing, Colorbox and Google Drive behaviors remain unchanged.

See `UPGRADE_v1.7.24.txt` and `AMAZON_CUT_EDGE_BLEED_SPEC.md`. Verify one
four-edge and one three-edge source on Windows + Photoshop before a full batch.

---

# Previous v1.7.23 — Rakuten Slider Download Only

## v1.7.23 — Rakuten Product/Slider URL -> Download Folder

- **Combine Generator / Rakuten Slider Downloader** now has one main action:
  paste a public Rakuten item URL or slider iframe URL and click **Download Slider Images**.
- Product URLs automatically search their embedded Rakuten GOLD slider iframe.
  An iframe URL or its HTML can be used when the product page blocks access.
- Saving defaults to Windows Downloads, or you can choose a parent folder.
- The importer creates a unique product folder with numbered original files
  **directly inside**, and a `slider_manifest.json` documenting the website
  order and any individual download failures. No images are resized, cropped,
  recompressed or otherwise altered.
- **No automatic Single / Line Up / Details categorization** and no automatic
  movement into Combine. Combine's separate manual upload areas are unchanged.
- **Open Download Folder** opens the completed local folder.
- Existing Combine no-stretch fix, optional Line Up, PSD/PSB and JPEG exports,
  and all other BrandForge modules remain unchanged.
- Live Rakuten access still requires workstation testing. HTML and downloader
  behavior was tested against deterministic fixtures rather than the blocked
  public example page. See `UPGRADE_v1.7.23.txt`.

**Updated: Google Drive path-link interface fix, retaining nested project-folder detection.** Select a brand's project folder on G:, detect existing PSD/PSB markers in `SLIDER/AMAZON [single and slider]`, `SLIDER/SLIDER-IMAGES/psd`, and `COLORBOX`, then use those folder locations as automatic output destinations. The PSD markers are **never opened, edited, or overwritten by the automation**. Raw files can stay on D:. Previously verified project paths can be recalled from local settings. The existing Amazon sharing, optional Colorbox choice and Slider image-processing rules are unchanged.

The cancelled **Smart Folder Import (per-product folders)** stays removed. The original Folder Mode and folderless Amazon Batch Workspace remain available.

The Batch Workspace retains image folder path scanning (paste/Browse/Scan),
format filters (PNG/PSD/JPG/etc.), image library with numbered click-order,
1–8 images per product, drag/reorder, editable Product ID and Delete, **Share
Images** for multiple IDs, output-folder/PSD naming, Amazon 1001x1001 sizing,
801/921 positioning, cut-edge flush alignment, master PSD, and **Generate
Colorbox / Skip**. Image 1 still becomes the optional Colorbox source.

Slider Maker now supports G: destination linking and safe staged PSD publishing, without changing its composition rules. Remove BG + Shadow, both LP Generators, profiles, EXP/history, and settings are unchanged. No LAN leaderboard.

See `UPGRADE_v1.7.18.txt` for the fixed UI and path-application behavior, and `UPGRADE_v1.7.17.txt` for the nested-folder layout. This version is a
source ZIP, not a precompiled Windows executable. Run `npm.cmd run validate`
then `npm.cmd start` in the project directory with Node/Electron installed.

## Historical v1.7.19 — Amazon no-product-crop placement fix (superseded by v1.7.24)

Cut detection now controls positioning only; it never forces zooming or
clips image content to satisfy corner coverage. Blank margin measurement,
1001 x 1001 canvas, the 801/921 safe areas, Share Images, Colorbox, the
master PSD and Google Drive auto-save behavior stay intact. See
`UPGRADE_v1.7.19.txt` and run `npm.cmd run test:amazon-no-crop`.

## v1.7.21 — Combine Line Up is Optional

- Upload **Single + Details**, **Single + Line Up + Details**, or **Single only**.
- No blank Line Up rows, labels, or Photoshop group when Line Up is empty.
- Details begin after the Single with the original 15 px separation; a Single-only output is 600 px tall.
- Existing 600 px width, fixed Detail guides, output files, and other BrandForge modules are unchanged.

## v1.7.20 — Separate Combine Generator

A new standalone Combine Generator creates a 600px-wide, dynamic-height product
composition from one Single image, an ordered two-column Line Up with editable
28px color names, and a two-column Detail grid with 293px square cells. It
exports a layered Photoshop PSD/PSB and a high-quality JPEG. The original
Combine PSD is included as a non-destructive geometry reference. See
`src/modules/combine/README.md` and `UPGRADE_v1.7.20.txt`.

All pre-existing production modules are preserved. No LAN leaderboard or
Smart Folder Import was reintroduced.


## v1.7.31 — Combine Line Up: two variant color names

- Each imported Line Up image initially uses one variant and one color-name field.
- For an image showing two products, click **+ Add 2nd color name** in that image's row (or select **2 variants / 2 color names**). Two explicit fields appear: **Color 1 — LEFT** and **Color 2 — RIGHT**.
- A dual-variant image occupies **one full-width row** and creates two independent, editable 28px Photoshop text layers.
- Pasting `LEFT | RIGHT` into the first field or into the bulk color names box automatically sets that image to dual mode. The full-width row is not split into two source images.
- Existing optional Single, text cleanup, dual-row PSD export, unrestricted Slider, and other modules are unchanged.


## BrandForge Arcade (v1.7.39)

**New sidebar tab: Arcade · Mini Games.** Includes four original, entirely offline JavaScript mini-games. This feature is separate from Amazon, Slider, Combine, LP, Background Removal, Photoshop jobs, and production EXP/history.

| Game | Controls | Scoring |
| --- | --- | --- |
| Snake | Arrow keys / WASD or directional buttons | +10 for each fruit; wall/body ends game |
| Color Match Rush | Mouse or touch: find tile matching the target | +10 correct, wrong picks -2 seconds, 45-second round |
| Memory Flip | Mouse or touch: find 8 matching pairs | End score based on moves and elapsed time |
| Block Puzzle | Left/right move, up rotate, down soft drop, Space hard drop | Rows cleared and hard-drop distance |

All games have **Start, Pause, Reset**. Leaving the Arcade tab pauses an active game, and returning with the same profile preserves the paused game. Use **Sound: On / Off** for locally generated Web Audio effects (no sound assets or online service). Sound can be turned off at any time.

**Personal high scores** are saved for the signed-in local BrandForge profile (identified by profile UUID) in a separate `arcade-scores.json` file under Electron `userData`. No changes are made to `profiles.json` or production EXP, history, rankings, achievements, Photoshop jobs, or asset folders. The game code cannot reach production IPC endpoints through its own API.

Arcade code lives in `src/modules/arcade/`: `main/register.js` and `main/scoreStore.js` (profile-authenticated IPC and high scores), `shared/engines.js` (pure game rules), and `renderer/index.html`, `renderer/style.css`, `renderer/app.js` (interactive UI). No new npm packages are required. The build configuration already includes `src/**/*`.

Developers can run `npm run test:arcade`, `npm run check`, and `npm run validate`. Optional Python Playwright scripts `test/arcadeBrowser.py` and `test/arcadeProfileBrowser.py` are for development only; running BrandForge does not require Python. See `UPGRADE_v1.7.39.txt`.

---
## v1.7.44 - Combine iframe-to-HTML batch

The default Combine view now takes full Rakuten GOLD iframe markup or an Excel
list of iframe blocks. It creates 780px table-only image layouts (2 Line Up
columns at 380px, `DETAILS` 28px, 3 Details columns at 250px) using existing
remote image URLs. It never downloads/edits images and does not require Photoshop.

An input .xlsx with ~1,000 iframe rows produces one NEW result .xlsx (with
`HTML_RESULTS` sheet containing iframe | HTML code | local HTML hyperlink and
QC status), plus a folder of standalone .html files. Missing source DETAILS
boundaries are flagged REVIEW unless you provide the per-row Lineup Count.

See `CHANGELOG_v1.7.44.md`, `docs/IFRAME_HTML_BATCH_ARCHITECTURE.md`,
`examples/IFRAME_LIST_TEMPLATE.xlsx`, and `INSTALL_FULL_PROJECT_v1.7.44.txt`.
Run `npm install` before `npm run build:portable` to install new ExcelJS dependency.


## v1.7.47 - original Combine-style JPEG output restored

- HTML export: **unchanged** 780px table-only layout; 2-column Line Up, 3-column Details, 28px DETAILS heading.
- JPEG export: **600px** legacy Combine-style vertical canvas; 2-column Line Up and 2-column Details; 293px image slots, 8px column gap, 7px row gap, 30px separation before DETAILS, 28px DETAILS heading.
- Preserve source-image aspect ratio and existing printed color labels. No text removal, cropping, stretching, Photoshop, or separately saved image assets.
- One JPEG and one HTML per iframe; Excel OUTPUT code remains next to each original iframe, with adjacent HTML and JPEG hyperlinks.
- Preview selector switches between the published HTML layout and the separate legacy JPEG layout.
- The **Legacy PSD Combine** feature has not been rewritten or removed. Photoshop 2027 COM repair is still separate from this iframe workflow.
- JPEG rendering requires remote image URLs to load; failed image renders are flagged REVIEW while the HTML remains available.

## v1.7.55 — Photoshop Compatibility Manager

**Settings > Photoshop Compatibility Manager** lets you scan installed Photoshop versions, validate actual BrandForge JSX source syntax, run an opt-in Photoshop connection + temporary PSD/JPEG/Smart Object test, see per-module preflight status, and open a saved diagnostic report. The manager remembers the last verified working version and warns if the registered Photoshop executable changes after an Adobe update.

Set **Require Photoshop version** to Auto, 2026 (27.x) or 2027 (28.x). This is a **safety guard only**, not a version switcher: it prevents job JSX from running against a mismatched Photoshop major. All existing COM/ROT paths remain, including the v1.7.54 Slider JSX string fix. See `CHANGELOG_v1.7.55.md` and `docs/PHOTOSHOP_COMPATIBILITY_MANAGER_v1.7.55.md`. After a Photoshop update, always run one real job per module; a passed preflight is not a production-output guarantee.
