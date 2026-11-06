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
