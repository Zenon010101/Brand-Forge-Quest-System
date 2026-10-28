# BrandForge v1.7.10 — Amazon Product Group Delete

**New:** In **Amazon Generator → Batch Workspace**, every Product ID now has a visible **Delete** button directly beside its row. You can also select a group and click **Delete Selected Group**. Empty groups delete immediately; groups containing assigned images or sharing IDs require confirmation. Deletion removes only that virtual group and its linked IDs from the in-memory batch—**original source files are never renamed, moved, or deleted**, and imported images remain in the Image Library for other groups. The group list, active selection, preview, output count, and Generate Amazon eligibility refresh immediately. You can create the deleted ID again.

**All existing Amazon rules remain:** 1–8 images per source group, image drag/reorder, sharing, Image 1 as the optional Colorbox source, master PSD, output naming, and the original Folder Mode. Slider Maker, Remove BG, both LP modules, local profiles/EXP/history, and settings are unchanged. The cancelled LAN Leaderboard remains excluded.

Run `npm.cmd run test:amazon-group-delete` for the new regression check, or `npm.cmd run validate` for the full suite. Actual Photoshop export still requires testing on the designer's Windows workstation.

## Previous update: v1.7.9 — Amazon Batch Workspace visibility fix

Amazon Generator now opens **Batch Workspace (No folders)** by default, instead of the unchanged-looking Folder Mode. The original Folder Mode is still available with the **Original Folder Mode** tab. The Dashboard shortcut also advertises the new workspace. No production backend, source-image rules, 8-image limit, sharing, master PSD, Colorbox, EXP, or local profile logic were changed from v1.7.8.

**If your app still opens the old Amazon screen without the two mode tabs, close all previous BrandForge/Electron instances.** Then open a terminal in this exact extracted project folder and run `node -p "require('./package.json').version"` (expected `1.7.9`) and `npm.cmd start`. The v1.7.7 single-instance lock can focus an already-running, older BrandForge window.

# BrandForge Image Workflow Studio v1.7.9

A local Electron production workspace for **Slider Maker**, **Amazon Generator**, **Remove Background + Shadow**, **Landing Page Generator**, and **LP Folder Generator**.

## New in v1.7.8 — Amazon Batch Workspace (no source folders)

- Amazon Generator now has **Folder Mode** (unchanged) and **Batch Workspace · No folders**. Batch Workspace directly imports images from File Explorer (multiple files / OS drag-and-drop) without creating or renaming per-ID folders or numbered 1–8 source filenames.
- Enter or paste multiple product IDs; assign separate image sets of **1–8 images per ID** from a shared image library. Drag files to product groups and drag within each group to change Amazon output order. The first image becomes the exact **Colorbox source**.
- Full-image **Share Images** still accepts multiple secondary IDs per source group, reuses finished JPGs byte-for-byte, and adds individually named layers to the existing master PSD. Existing 1001px, 801/921 and cut-side rules, output names, EXP/history and the post-generation **Generate Colorbox / Skip** dialog are reused unchanged.
- All outputs go to a designer-selected output folder, directly (no ID subfolders), with an editable master PSD filename. Original images are untouched. File/source existence, ID/filename conflicts, prior output overwrite approval, Drive-safe staging, and batch isolation are enforced by Electron main.
- Run `npm.cmd run test:amazon-batch` for new integration tests or `npm.cmd run validate` for all suites. See `src/modules/amazon/BATCH_WORKSPACE.md` for usage and limits. **Windows Explorer drag/drop and Photoshop PSD creation still require a Windows workstation smoke test.** No Python required and the canceled LAN Leaderboard is not included.

## Fix in v1.7.7 — Windows Chromium disk cache permission error (0x5)

- Prevent duplicate BrandForge launches with Electron's single-instance lock. A second launch restores/focuses the existing window instead of using the same GPU/disk cache simultaneously.
- Redirect Electron's `sessionData` to `%LOCALAPPDATA%\BrandForge\ChromiumSession-v1` before Electron is ready, with a write-tested fallback under the user's temporary directory. The cache is no longer in the default roaming profile data directory.
- Preserve `userData` without migration or deletion: profiles, EXP, history, settings, and remembered production folders remain in the same place. No admin privileges or Python required.
- No changes to LP Folder Generator's editable PSD/PSB + JPEG output or custom filenames, Amazon Share Images, Slider LINEUP #1E1E1E, Remove BG + Shadow, or screenshot-based Landing Page Generator. The cancelled LAN Leaderboard is excluded.

**Update:** Close all old BrandForge/Electron processes first. Install the complete project or the v1.7.7 startup patch over v1.7.6 and run `npm.cmd start`. No new dependencies are needed. `npm.cmd run validate` includes tests for cache relocation, denied-folder fallback, primary/secondary app instances, and all existing production modules.

**Verification limit:** Simulated Electron startup and filesystem regression tests passed. Actual Windows permissions and GPU cache behavior still need verification on your PC. If the local and temporary directories are both restricted, system permissions will require attention.

## New in v1.7.6 — Custom LP Output Filename

- LP Folder Generator now has an editable **Output filename** field. It defaults to `FOLDER_LP`, but you can type any valid filename stem, such as `AKA-90_FINAL` or `別注 LP 2026`, before clicking **Generate LP**.
- The editable PSD (or large-document PSB) and flattened JPEG use the **same chosen stem**, and their exact filenames update live in the UI. The `.psd`, `.psb`, or `.jpg` extension is added automatically; typing `.psd` or `.jpg` in the field is also accepted.
- Invalid Windows filename characters and reserved names are blocked. Any custom name that would collide with a source JPG/PSD or LP strip is refused, even when **Back up + Replace** is selected. Existing versioning and rollback still protect the paired export.
- A small `.brandforge-lp-generated.jsonl` record is written in the source folder to keep **custom-named output PSD/JPEG files out of later source scans**. If this bookkeeping write fails, completed exports remain valid and a warning appears.
- No changes to Photoshop layer structure, LP dimensions, Slider LINEUP #1E1E1E, Amazon, Remove BG, the screenshot LP Generator, Profiles/EXP/History, or Settings. The LAN Leaderboard is not included.

**Testing:** automated custom-name, filename-collision, same-stem PSD/JPEG versioning, rescanning, and existing module regression tests pass. Actual Windows Photoshop generation still needs verification.

## New in v1.7.5 — LP Folder Generator JPEG + Slider LINEUP Color

- **LP Folder Generator** now creates both an **editable layered PSD/PSB** and a **high-quality flattened JPEG** directly from the same Photoshop composition, in the selected source-image folder.
- The production button is now **Generate LP**. Both filenames are previewed, and the output status confirms the PSD and JPEG files.
- Versioning and overwrite approval work as a **single paired export**: `AKA-90_LP.psd` + `AKA-90_LP.jpg` (or `_v2` for both). Files are verified after writing; replacement backups and rollback protect completed exports on mapped/shared drives.
- A JPEG cannot exceed 65,535 pixels high. For taller LPs, the app automatically exports contiguous **60,000 px high JPEG segments** (`..._01.jpg`, `..._02.jpg`, etc.) while preserving one complete layered PSB. Generated JPGs/PSD/PSBs are excluded from future source-folder scans.
- The **Slider Maker generated LINEUP variant/color-name text** is now **#1E1E1E** (RGB 30/30/30). Shadow colors and other text styles are unchanged.
- No LAN leaderboard was included. The existing Amazon, Slider sizing/shadow algorithms, Remove BG, screenshot LP Generator, profile/EXP/history system, and settings remain intact.

**Testing note:** automated export, JPEG-part, rollback, JSX simulation, and existing module regression tests pass. The actual Photoshop JPEG and PSD generation must still be confirmed in Windows Photoshop.

## New in v1.7.4 — LP Folder Generator

BrandForge now has a **separate LP Folder Generator** page. Select a folder containing image files; it detects `Single` or an image named after the product folder, shows large QC and ordered LP previews, supports Move Up/Down / drag reordering and manual Set as Single, and generates a **1000 px-wide, dynamic-height layered PSD/PSB** with each section embedded as an individual Photoshop Smart Object. The Single occupies the first 1000 × 1000 px; the remaining images are placed without automatic gaps. The output is automatically saved in the **same source folder** as `FOLDER_LP.psd` (or `.psb` for long pages), with versioning and backup/replace protections.

The scanner recognizes common raster and Photoshop files (JPG, PNG, WEBP, TIFF, GIF, BMP, PSD/PSB and other supported Sharp codecs such as AVIF/HEIC). Unreadable files produce scan warnings rather than being silently omitted. Native Photoshop PSD/PSB input is embedded without flattening the original source. An image Smart Object is editable as a **whole image layer**; text inside flattened source JPGs does **not** automatically become a separate editable text layer. The existing screenshot/OCR LP Generator remains available unchanged. No LAN leaderboard is included.

**New regression tests:** `npm.cmd run test:lp-folder` and the normal `npm.cmd run validate`. See `src/modules/lp-folder/README.md` for usage, supported input formats, safe shared-drive output behavior, and limitations. Actual Windows Photoshop PSD creation still requires testing on a workstation.

## Fix in v1.7.3 — Landing Page Photoshop Copy Merged error

**Fixed:** Landing Page Generator no longer calls `source.selection.copy(true)` / Photoshop **Copy Merged** when importing normalized screenshots, cropped image blocks, clean backgrounds, or the Single. Some Photoshop installations (especially through the Windows COM bridge) reject Copy Merged with: `General Photoshop error ... The command "Copy Merged" is not currently available.`

- Imports each prepared single-layer PNG by `source.activeLayer.duplicate(targetDocument, ElementPlacement.INSIDE)` instead of using the clipboard. The source is closed without saving; original images remain unchanged.
- Places the duplicated layer at the exact requested X/Y by reading its Photoshop pixel bounds and translating it, preserving the 1000 px canvas and screenshot order.
- Gives a contextual error naming the import layer and PNG path if a specific file cannot be imported, and discards the incomplete Photoshop document.
- Added `npm run test:landing-page-jsx` (included in `npm run validate`), exercising the actual JSX body with a Photoshop DOM simulation for duplication, group order, positioning, editable text, hidden raster references, and failure cleanup.
- No changes to Amazon sharing (including Google Drive fixes), Slider Maker, Remove BG + Shadow, profile/history, or settings logic.

**Windows testing still required:** Run Analyze → Generate PSD with one Single and two short screenshots. The scripting simulation is not a substitute for Photoshop itself; if this Photoshop version rejects layer duplication, the new error identifies which import failed.

## Fix in v1.7.2 — Google Shared Drive JPG verification (0/10 Amazon sharing failures)

**Fixed:** On the user's Google Shared Drive (`G:\\Shared drives`), Amazon Share Images v1.7.1 sometimes wrote the source JPG successfully but then rejected it with `published file size does not match the staged export`. For example, `APM-90200-JP_6.jpg` and `APM-90202-JP_5.jpg` failed, causing their eight dependent shared IDs to fail. An immediate filesystem metadata check is not a reliable way to validate a just-written file on every virtual/cloud drive. An incomplete copy must also not be accepted as success.

- Changed Amazon publishing to use ordinary cross-drive `copyFile` and an optional streamed fallback. It never requires hard links or cross-volume renames.
- **Verifies the actual destination bytes with SHA-256** against the locally rendered export, not just `fs.stat().size`. Matching content is accepted even if Google Drive is still returning outdated size metadata; same-size corruption is caught.
- Waits for temporarily delayed destination reads. If a file really is incomplete, retries copying a bounded number of times. Failed outputs are rolled back per Variant ID, and approved replaced files are restored from independently verified local backups.
- New files are exclusively reserved (`wx`) before publishing. Existing files still require explicit user approval. Intermediate renders, staged PSDs, and overwrite backups remain on the local Windows temporary drive; original images are never changed.
- Source images are rendered only once. Linked IDs reuse the locally rendered JPGs, and the established Amazon sizing, JPEG naming, master PSD/Colorbox logic, UI, and other BrandForge modules are unchanged.

**Regression tests:** Simulated stale destination size metadata, delayed file visibility, incomplete successful copy operations, byte corruption with the *same length*, copy operation incompatibility, and rollback/overwrite protection. An end-to-end test models the exact 10-ID APOM batch (two source IDs with 6 and 5 images, each with four shared IDs): **10 successful IDs and 55 verified JPG files** with delayed reads on the reported 6th and 5th output images. `npm.cmd run validate` also runs the previous Amazon, Slider, Remove BG, and Landing Page suites.

**Windows testing still required:** A real Google Drive for desktop `G:` mount was not available in this environment. Back up the current project, start v1.7.2, and retry the same batch. If Google Drive refuses byte-correct writes or the destination is locked, BrandForge still reports the actual verification failure instead of marking corrupt or partial images successful. Check Drive sync/permissions and free disk space in that case.

## Fix in v1.7.1 — Amazon Share Images on Google Shared Drive (ESIDR)

**Fixed:** When the Amazon export folder is on a mapped / virtual drive such as `G:\\Shared drives`, the v1.7.0 sharing publisher may fail with `ESIDR: illegal operation on a directory, link` while publishing the first source JPG. Every linked ID then reports `Source ... failed; no images were copied`. This is an export publishing error, not failed JPG rendering or Photoshop shadow processing.

- New and replacement JPG/PSD exports are written with normal exclusive/approved file streams. Publishing never calls NTFS hard links or cross-volume rename, which virtual/cloud drives may reject.
- Rendered Amazon JPGs and the staging PSD now live in the OS user's local temp folder while the batch runs, so intermediate files are not synced to Google Drive. Only completed exports are written to the chosen output folder.
- Linked IDs reuse locally rendered source JPG files rather than downloading completed outputs from `G:` to make each copy. Their resulting JPG bytes and ordering are unchanged.
- Existing outputs still require explicit overwrite approval. Each Variant ID is transactional: a failed write removes its new partial exports and restores backups of its previously existing files; other Variant IDs continue. No source photos are modified.
- The original Amazon 1001 px layout, 801/921 sizing, source image selection/order, Share Images naming, master PSD layer naming, Colorbox, EXP/history, Slider Maker, Remove BG + Shadow and Landing Page Generator remain unchanged.

**After updating:** Re-run the same source and shared IDs against the intended output folder. Confirm replacements only if there are already valid files you want to replace. The app can reuse existing source images but reruns their render operation; the failed v1.7.0 batch should not have created complete final JPGs. Allow room in the local Windows temporary directory for intermediate images and the master PSD.

**Validation:** `npm.cmd run validate` includes new simulated drive incompatibilities (`ESIDR` hard links and `EXDEV` cross-device renames), copy failures, partial-write rollback, existing-export protection, byte-for-byte shared outputs and all previous module tests. Actual mapped Google Drive/Windows Photoshop I/O has not been exercised in this container.

## New in v1.7.0 — Landing Page Generator (Screenshot → Editable Photoshop LP)

A new independent **Landing Page Generator** page is available in the left navigation and Dashboard. Add an optional Single (automatically fits in a 1000 × 1000 section) and one or multiple screenshots. Reorder screenshots via Move Up/Down or drag-and-drop, then **Analyze Landing Page** and **Generate PSD**. The total width is exactly 1000 px and height is calculated from actual screenshot sizes; all parts follow each other without added vertical gaps. Every screenshot is included and the source files are unchanged.

**Editable structure:** Photoshop output has an `01_SINGLE` section and numbered `02_LP_PART_01`, `03_LP_PART_02`, etc. groups. Within each screenshot group, `BACKGROUND` preserves a pixel-accurate raster fallback and a hidden original reference; `IMAGES` contains reliably isolated image sections; `TEXT` contains editable OCR text when text can be removed safely from a uniform background; `OCR_REVIEW (hidden)` contains editable OCR transcription for complex regions where visible reconstruction would harm the screenshot. This is a conservative editable reconstruction—not a guaranteed perfect font match or full semantic rebuild of every image/table.

**OCR:** Uses optional locally installed Tesseract (English + Japanese, if both language data packages exist), or Windows built-in OCR. If unavailable or uncertain, raster fallback preserves the LP and the UI displays a warning. No Python is required. Preview includes **Full** and **Detail QC** modes and detected bounding boxes.

**Output:** The user selects an output folder, then the app creates `PRODUCT_CODE/PRODUCT_CODE.psd` with `extracted/`, `ocr/` and `manifest.json` supporting files. Existing exports require an explicit backup+replace checkbox. If the total page height exceeds 30,000 px, it uses Photoshop's editable `.psb` large-document format (regular `.psd` cannot store those dimensions) and warns the user. Source screenshots and existing Amazon / Slider / Remove BG modules remain unchanged.

**Testing:** `npm.cmd run validate` now also tests the new LP planner, OCR TSV parser, actual Sharp normalization, manifest and supporting files, backup/overwrite behavior, no-gap section positions and unchanged input sources. Actual Photoshop COM/JSX creation must be verified on Windows with Adobe Photoshop. More technical details and limitations are in `src/modules/landing-page/README.md`.

## New in v1.6.0 — Amazon Share Images (full-image sharing)

**Use case:** one physical Amazon Variant ID folder contains the source images, but other Variant IDs must get **the same finished Amazon images** under their own ID-based filenames. No duplicate physical folders are needed.

### How to use it

1. Open **Amazon Generator**, select Parent Folder(s), then select and arrange the original images 1–8 under the source Variant ID as usual.
2. Click **Share Images** on that source row. Paste multiple shared IDs, one per line, or from Excel using newlines/tabs/commas/semicolons (example: `DPK101`, `DPK102`). The live preview shows output filenames and counts.
3. Fix any detected errors, then click **Apply Sharing**. Each shared ID appears under the source with its own Remove (×) button. Click Share Images again to edit the list. When the source image selection/order changes, all its shared IDs automatically inherit that selection/order.
4. Choose an output folder and master PSD name, then click **PROCESS AMAZON**. For a sharing batch, the app validates again using an independent Electron filesystem preflight. Existing JPGs or master PSDs require an **explicit Replace confirmation**, and a source image will never be overwritten by an output. If you cancel, nothing is processed.
5. The source image set is processed **once** using the unchanged Amazon visible-pixel 801/921 rules, then each shared ID gets **byte-identical copies** of its finished JPGs with its own filename. Shared PSD layers are separately named top-level Smart Objects but reuse the original temporary transparent PNG assets. The master PSD remains one flat editable PSD; optional Colorbox includes successful shared IDs and copies each ID's first exported JPG exactly.

**Example:** source `DPK100` with files `1.psd`, `2.psd`, `3.psd` plus `DPK101` and `DPK102` produces `DPK100.jpg`, `DPK100_2.jpg`, `DPK100_3.jpg`, and the equivalent three files for each shared ID (nine JPGs total), plus your named master PSD. The additional IDs do **not** require real folders.

**Validation:** rejects pasted duplicates (case-insensitive), any ID already used by a scanned physical Variant folder, reserved Windows device names, invalid Windows filename characters, IDs over 150 characters, more than 200 shared IDs per source, and actual flat-output collisions such as `DPK100_2.jpg` from `DPK100` image 2 conflicting with shared ID `DPK100_2` image 1. Validates again on disk before processing. A failed source skips only its dependent shared IDs; other sources continue. A failed shared JPG copy does not halt other IDs. Staged JPG files are published per ID with rollback copies of previously existing outputs. If Photoshop master PSD generation fails, the prior PSD is preserved, while successfully exported JPGs remain available.

**EXP / History:** each successful exported ID counts toward Amazon variant statistics, but the processing EXP bonus is based on unique source image sets, avoiding multiplied processing rewards for copy-only shared IDs. Other progression rules stay the same.

**Scope:** v1.6.0 supports **full-image sharing only**. Partial sharing (different image 1 but shared images 2–5) is not included. The original no-sharing Amazon path, Slider Maker, Remove BG + Shadow, profile, account, Settings and history modules retain their previous behavior.

**Tests:** `npm.cmd run validate` includes full Amazon sharing validations and simulated PSD builder tests using real Sharp JPG rendering, byte-identical copies, overwrite/rollback handling, Colorbox, source failure isolation, and old-module regressions. The modal was also exercised with a headless browser. Actual Adobe Photoshop PSD generation must still be validated on a Windows design workstation.

## Fix in v1.5.2 — Add Shadow disabled despite PNG success

- Fixed the Electron iframe event bug: Photoshop progress messages now go to the **specific Remove BG + Shadow frame that started the operation**, instead of only to the parent application window.
- Final Remove Background and Add Shadow IPC replies **always update the per-file queue**, even when live progress notifications are missed. The buttons and `PNG ready / PSD ready` counters now reflect actual processed files.
- The queue is restored from the main-process job state when the module iframe reloads. If a batch is still running, it periodically refreshes the state until the batch finishes.
- **Reuse the PNGs already exported by v1.5.1:** after restarting the updated app, re-add the original JPG/JPEG/other sources to the queue. If the expected same-folder `.png` is a valid transparent cutout and not older than the source, the item immediately shows **PNG Ready**. Inspect the PNG Result and click **Add Shadow**. Photoshop does **not** repeat Remove Background and the PNG is not modified. If an existing PNG is opaque, corrupted, or older than its source, it is not automatically trusted as a QC-approved cutout.
- PSD creation still uses the existing Slider lower-50% contact-shadow settings, two PSD layers (`Main` Smart Object / `Shadow`), output in the original folder, and independent per-file error handling. Other working modules are unchanged.
- `npm.cmd run validate` now includes a UI regression that simulates all progress events being lost and verifies that a successful 3-file cutout batch enables the Add Shadow button.

**Updating:** close the current app, back up your project folder, extract this v1.5.2 complete source project and start it. Any PNGs already saved in the source folders stay untouched. Re-add the original files, verify that the recovered PNGs are displayed, and click Add Shadow. Check **Back up + replace existing exports** only if an existing PSD should be replaced (the old PSD will be backed up).

**Verification boundary:** automated tests validate the IPC routing, UI synchronization, previous PNG recovery and mock PSD outputs. Actual Photoshop COM and PSD creation must be checked on a Windows PC with Photoshop.

## Fix in v1.5.1 — Photoshop detection errors

- For opaque input images, the Remove BG module now uses Photoshop **Select Subject** (`autoCutout`) rather than its **Remove Background** Quick Action, which can show **"Couldn't find background to remove"** in Photoshop 2026. It deletes only the inverse selection in a temporary composite, verifies the resulting transparency, and leaves originals unchanged.
- A failed subject selection stops only that one cutout, shows the specific error under the large preview, and keeps processing the rest of the queue. No fake/approximate background removal is produced.
- If Select Subject also fails, set Photoshop **Edit > Preferences > Image Processing > Select Subject and Remove Background > Cloud**, restart Photoshop and retry. Photoshop's local and cloud engines may both fail on certain images; human PNG QC is still required.
- Slider Maker, Amazon Generator, profiles, history, shadow rules, output locations, and PSD structure are unchanged.

## New in v1.5.0 — Remove Background + Shadow

A third, separate module appears in the left navigation and Dashboard. Slider Maker, Amazon Generator, Settings, profiles, EXP and history retain their original behavior.

**Requirements:** Windows, installed Adobe Photoshop with a functional built-in **Select Subject** action, and Node.js/npm. Photoshop's auto-segmentation depends on the input image: thin straps, transparent items and low-contrast edges still require the human QC step.

**Production steps**

1. Open **Remove BG + Shadow** and use **Add Images** or drag multiple JPG/JPEG/PNG/WEBP/TIF/TIFF/BMP/GIF/PSD/PSB/TGA/HEIC/HEIF files into the queue. Photoshop must have support installed for the source format (e.g. HEIC).
2. Click **Remove Background**. Supported pre-cut transparent inputs are preserved; opaque sources are processed using Photoshop's native Select Subject function. Only transparent PNGs are saved at this stage, next to each source image (`bag01.jpg` → `bag01.png`). One failure does not stop the other images.
3. Click each file in the left queue, inspect **Original** vs. **PNG Result** in the large checkerboard preview, and select **100%** to inspect the full-resolution PNG edges. The workflow stops after PNG processing; no shadow is created until you click the next action.
4. When ready, click **Add Shadow**. Every PNG-ready item without a completed PSD is processed independently. The PSD is written beside its source (`bag01.psd`). Background removal is **not** run again.
5. Open a PSD in Photoshop: **Main** is a Smart Object above a separate, editable **Shadow** pixel layer. Exactly those two layers are saved (not merged/flattened).

**Exact Slider contact-shadow rules:** select the item's *actual non-transparent pixels*; intersect with the **lower 50%** of its real visible item bounds, including the bottom silhouette; fill black, offset **X = 0, Y = +4 px**, apply **Gaussian Blur 5 px**, set layer **opacity 18%**. This shares the actual constants from `src/shared/workflowConfig.js` with the Slider Maker. There is no Drop Shadow effect, generic oval, or full-object shadow. This module adapts the Slider's fixed 600px canvas calculation to the imported PNG's actual dimensions.

**File overwrite policy:** existing PNG/PSD export destinations are never silently replaced. Enable **Back up + replace existing exports** for intentional replacement; the prior file is copied/moved into a `GWS Backups` subfolder beside the source. When the input *itself* is an opaque PNG (or a source PSD that must be replaced by the resulting same-name PSD), the app automatically backs up that original before writing the required output name, and the Original preview continues to use the backed-up source. Two different source formats with the same base name in one folder cannot be queued together because they target identical export filenames. Removing a file from the queue never deletes output files on disk.

**Error and cleanup behavior:** per-file statuses (`Original`, `Processing...`, `PNG Ready`, `Shadow Ready`, `Remove BG Failed`, `Shadow Failed`), per-file fault isolation, generated-output validation, Photoshop COM/error reporting, a five-minute per-operation Photoshop timeout (two minutes for Photoshop-only previews), and staged temporary-file cleanup. Reattempting failed PSD creation uses the existing PNG, without new segmentation.

**Testing:** `npm.cmd run validate` checks JS syntax, existing Slider/Amazon smoke tests, and mocked (non-Photoshop) Remove BG/Shadow integration tests, including output isolation, overwrite backups, original-preserving behavior and PSD stage ordering. Real cutout accuracy and exact Photoshop PSD rendering must be QC-tested on a Windows machine with Photoshop. The automated tests do not substitute for that Photoshop verification.


## New in v1.4.3

### Slider guide-safe visible-pixel correction
- PSD Main+Shadow sources now size from the actual visible `Main` layer only; whole-document white-margin ratios are never remapped onto `Main` a second time.
- Normal Detail remains a hard `570x530` target at `x=15, y=20` inside the `600x600` document.
- FIT placements receive a strict post-transform containment pass so visible product pixels cannot cross their dedicated guides because of Smart Object/group rounding.
- Lineup and PA Vertical slots receive the same hard-boundary safety pass.
- Source Shadow remains editable and is still lifted 4px only after final placement.
- PSD Main remains a Smart Object before Slider transforms.


### Slider PSD + visible-pixel correction
- PSD/PSB sources with named Main + Shadow now guarantee Main is a Smart Object before Slider resizing, preserving source quality.
- Main + Shadow still receive one common transform so their original relative positioning is retained.
- After final placement, source Shadow is lifted **4 px upward** to cover the white fringe that can appear around the product edge. Shadow is not independently resized, blurred, or recolored.
- Opaque white-background sources are analyzed in a throw-away Photoshop duplicate. Remove Background is used only for **placement analysis**, allowing sizing/centering to use the actual item instead of the white source canvas. The source image itself is not altered.
- Normal Detail continues to use the **570×530** target inside the 600×600 Slider canvas; once white padding is excluded, one visible item dimension reaches the target boundary instead of appearing undersized.
- The same visible-item bounds feed Lineup and PA Vertical sizing/centering.

## New in v1.4.1

### Amazon production update
- Amazon source preparation now removes opaque image backgrounds before sizing/output.
- PSD/PSB inputs follow the production no-shadow rule: Photoshop opens the source, hides the **second top-level layer**, exports a temporary PNG, and closes the source without saving.
- Already-transparent assets are preserved without an unnecessary second segmentation pass.
- Existing 801×801 first-image, 921×921 remaining-image, visible-pixel centering, cut-side placement, flat JPG, master PSD, and Colorbox rules remain in place.

### Slider lineup update
- `Horizontal` now correctly means **side by side**.
- `Vertical` now correctly means **stacked top to bottom**.
- Added `PA Vertical` for the Item / Item Detail / Color Name format:
  - Item: **571×280** at y=20
  - Item Detail: **571×250** at y=300
  - Color Name: **571×50** at y=550
- PA Vertical uses two source images and one Color Name field.

## New in v1.3.0

- Local user profiles with username/password sign-in.
- Passwords are stored as salted `scrypt` hashes; plain-text passwords are never written to disk.
- Persistent EXP, levels, ranks, achievements, streaks, unique-brand collection, and lifetime production stats.
- Monday–Friday weekly production history.
- Slider jobs can optionally include a Brand name for brand collection tracking.
- Amazon successful parent folders automatically count toward the brand collection.
- EXP is awarded only after successful production work. Failed jobs never remove EXP.
- The app name and internal product branding are neutral and do not use a company name.

## EXP rules

- Slider PSD: `+20 EXP`, plus `+2 EXP` per output item.
- Amazon: `+10 EXP` per successful variant.
- Clean Amazon batch: `+15 EXP` bonus.
- Successful Amazon master PSD: `+20 EXP` bonus.
- Colorbox: `+5 EXP` per newly exported Colorbox.
- First time a profile processes a unique brand: `+25 EXP` discovery bonus.

## Levels / ranks

Level requirements increase progressively. Ranks are:

- LV 1–5: Rookie Operator
- LV 6–10: Image Operator
- LV 11–20: Production Specialist
- LV 21–30: Senior Specialist
- LV 31–40: Workflow Expert
- LV 41–50: Production Master
- LV 51+: Automation Legend

## Local profile storage

Profiles are device-local. The profile data, history, achievements, and remembered folders are stored under Electron's app data directory. Use **Settings → Open App Data Folder** to view the location.

This is not a cloud account system. Moving to another computer does not automatically transfer levels or history. A later version can add export/import or server sync if needed.

## Run from source

```powershell
npm.cmd install
npm.cmd run validate
npm.cmd start
```

## Build portable Windows app

```powershell
npm.cmd run build:portable
```

Built files are created in `dist/`.

## Amazon global source-type filter (v1.4.4)

Amazon now has one Source Type filter that applies to every selected Parent / Variant folder at the same time. Options are **All / Anything**, **PSD / PSB**, **PNG**, **JPG / JPEG**, **WEBP**, and **Other supported**. The scanner still recognizes only exact source basenames `1` through `8`; the filter only changes which recognized source types are visible/selectable and used by Check All / processing. Changing the filter automatically clears selections that do not belong to the new type so hidden files cannot be processed accidentally.

## Amazon cut-edge and cut-corner flush placement (v1.4.5)

When Amazon detects a genuine crop/cut side, that side now overrides normal safe-area centering and is aligned to the actual 1001x1001 canvas edge. Adjacent cut sides also use a visible-pixel corner lock: if transparent background removal leaves a triangular blank gap at the cut corner, the renderer anchors the nearest real product pixel to that corner and increases crop/scale only as needed to keep the other cut sides covered. This applies to Amazon image 1 as well as images 2-8. Non-cut images keep the normal 801/921 rules.
