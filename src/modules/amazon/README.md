**v1.7.9 navigation note:** Amazon opens the new folderless Batch Workspace by default; the original folder-based workflow is one tab away and unchanged.

# Amazon module

Production Amazon Generator module used by the unified app.

Preserved rules:
- 1001x1001 final canvas
- strict exact source filenames 1-8 only in **Folder Mode**; **Batch Workspace** supports arbitrary input filenames and direct assignment
- first image uses actual visible pixels in 801x801 at x=100/y=100
- images 2-8 use actual visible pixels in 921x921 at x=40/y=40
- cut-side rules preserve aspect ratio and push content to detected cut edges
- all-side cut details use full proportional cover of the 1001px canvas plus 4%, even for tall/wide creative photos; preserve the source frame in the PSD Smart Object
- selected/dragged order controls output numbering
- flat JPG output directly in the selected folder
- Colorbox copies actual first exported Amazon JPG
- user supplies the master PSD filename


## v1.4 source preparation
- Opaque Amazon sources are passed through Photoshop Remove Background before sizing.
- PSD/PSB: hide the second top-level layer, export a no-shadow PNG, close source without saving, then remove background only if the exported PNG is still opaque.
- Visible-pixel centering and cut detection run on the prepared transparent source.

## v1.6.0 Share Images
- Click **Share Images** beside a selected source Variant ID and paste newline/comma/tab/semicolon-separated extra IDs; the linked IDs do not need real folders.
- Shares inherit the source's exact selected image order and unchanged 801/921 Amazon rules. Rendering/PSD extraction happens once for each source set; JPGs for linked IDs are exact copies of the completed JPGs.
- The master PSD adds separate, flat top-level embedded Smart Object layers for each successful shared ID using the same temporary PNG assets and each ID's unique layer names. Colorbox includes shared IDs.
- `shared/sharingPlan.js` supplies the same filename/ID rules to the UI and main process. The Electron preflight verifies scanned physical IDs, flat-filename collisions, source-path protection and existing outputs before any sharing job starts.
- Sharing batches stage output, ask permission to replace existing JPG/PSD files, publish outputs with per-ID rollback, continue after per-file failures, and preserve existing PSDs if Photoshop fails.
- No-sharing Amazon processing remains on its original code path. Sharing is full-image only, not partial-image sharing.
- Run `npm.cmd run test:amazon-sharing` for integration tests.

## v1.7.2 Google Shared Drive size/checksum reliability

`sharedExporter.js` now copies locally staged JPGs/PSDs with normal file operations and verifies the actual resulting bytes with SHA-256, instead of comparing an immediate `stat()` to the staged file length. Some virtual drives can report temporarily stale metadata after writing. The publisher waits for content to become readable and retries an incomplete copy (three total attempts by default), but never accepts partial or same-size corrupted data. Existing-file backups are checksum-verified before replacement, and per-ID rollback restores or deletes touched targets on failure. New destinations are reserved with exclusive creation and existing outputs require prior overwrite approval. A fallback handles providers which do not implement `fs.copyFile`. Both the main output and shared-ID JPG bytes remain identical to the v1.6.0 rendering rules. Tests include the user's 10-ID, 55-JPG source-sharing pattern with delayed reads on the last source JPGs. Hardware-level verification on Windows with Google Drive for desktop remains necessary.

## v1.7.1 G: drive publishing fix
- Share Images no longer uses `fs.link` for new JPG/PSD output or `fs.rename` to replace approved existing outputs. Google Drive/virtual drives can reject those operations (`ESIDR` / `EXDEV`).
- Stage all rendered JPG and master PSD assets in the user's local temporary directory. Publish using exclusive stream-create for new files and backed-up streaming replacement for approved existing files, with per-ID rollback of partial files.
- Shared IDs read the same local rendered JPGs. Final JPG bytes are identical; the original source images and other Amazon image/PSD rules are unchanged.
- Run `npm.cmd run test:amazon-sharing` and check with a small Amazon batch on `G:` before production.

## v1.7.8 Folderless Batch Workspace

See `BATCH_WORKSPACE.md`. This new UI mode uses virtual Product ID groups, drag/drop source files, up to eight images per group, and optional shared IDs. It uses the same existing Amazon processing/publishing/PSD/Colorbox code as Folder Mode. No per-ID source directories or source-file renaming.

## v1.7.13 — Cut side / corner alignment correction

The Amazon renderer still uses a 1001x1001 JPG canvas. Uncut image 1 fits its
visible content within the 801x801 area; uncut images 2-8 fit within 921x921.
When a genuine cut side is detected, its visible product pixels align flush to
the corresponding *full canvas* edge. The background estimate for opaque JPGs
now comes from the perimeter rather than an average of four corners; the
cut-corner anchor uses solid product pixels instead of opaque background or
faint antialiasing. Image 1 remains the optional Colorbox source and all shared
IDs reuse its completed output. No change to PSD shadow hiding, PSD layer
structure, order, source files, ID mapping or the Generate Colorbox / Skip
dialog. Run `npm.cmd run test:amazon-cut` for edge-specific regression tests.

## v1.7.14 — Sharing button restored in Batch Workspace

Batch Workspace now displays a dedicated Share Images button per Product Group
and in the selected-group editor. A multi-ID modal applies the original
`sharingPlan.js` filename and duplicate-ID rules, and shows the expected shared
JPGs. Existing shared IDs remain linked and editable. The old inline IDs textarea and Folder Mode sharing modal remain.
The renderer, cut alignment, master PSD, shared publisher and optional Colorbox
logic are unchanged. See `test/amazonBatchSharingUi.js`.

## v1.7.16 Read-only brand project location linking
Use the shared Google Drive Brand Project panel to select a brand/project root on G:.
The existing PSD/PSB files in AMAZON, SLIDER and COLORBOX are *location markers only* and are never opened or modified. For a linked project, the Amazon output folder is the verified AMAZON marker's containing folder. Colorbox automatically uses the COLORBOX marker's folder **only after** the user selects Generate Colorbox. Missing marker = manual selection. Each batch has one final master PSD/output destination; use separate runs for independent brand destinations.

## v1.7.19 — Detect cut sides, reposition only; never crop the product

The 1001 x 1001 output canvas is unchanged. Normal images still fit
inside the 801 (Image 1) and 921 (Images 2–8) visible-product areas.
Cut detection is calculated on the original normalized source, before the
external blank margins are measured. The renderer then places the complete
content in the canvas: a left/right/top/bottom cut moves just that axis to
the corresponding canvas edge; the untouched axis stays centered.

**Removed:** forced corner enlargement, corner filling, max-cover scale on
non-square full-bleed content, and the `cropToCanvas` step. The renderer
rejects any computed placement that would extend product pixels outside
the canvas. Opposite cut sides that cannot both be made flush without
cropping or distortion are flagged rather than forcing a crop.

These rendering rules apply identically to Folder Mode, Batch Workspace,
Shared IDs, and the optional Colorbox source (Image 1). All Google Drive
marker PSD files remain read-only location guides.

Run `npm.cmd run test:amazon-cut` and
`npm.cmd run test:amazon-no-crop` to verify the edge logic.


## v1.7.24 — Controlled cut-edge overscan

Uncut images retain the original 801/921 safe-area behavior. Cut images enlarge
uniformly by 4%; four-edge cuts request proportional cover of the 1001px
canvas. Extremely panoramic/tall four-edge content uses a bounded enlargement
instead of destructive massive cropping. The final JPG is a clipped view, not
an alteration of the original source file. The master PSD references a separate
full-sized embedded Smart Object whenever the placement extends beyond the
canvas: the full product can be repositioned inside Photoshop. Shared IDs reuse
these same assets with unique layer names, while Colorbox continues to use the
first finished Amazon JPG only when requested. None of these changes affect
Google Drive PSD location markers. Run `npm run test:amazon-bleed` and
`npm run test:amazon-no-crop`.

## v1.7.25 creative-frame safeguards

- For opaque photos on non-white studio backgrounds, preserve the full photo rather than trimming it to inferred product pixels.
- Protect white-plus-photo split compositions: keep intentional whitespace as part of the creative asset.
- Image 1 always remains centered within its original 801px safe area.
- Images 2–8 with four cut edges use uniform scaling, central placement, and limited natural viewport overflow. No pixel stretching or internal cropping before placement.
- For genuine isolated products on white or transparent backgrounds, preserve visible-pixel trimming and established per-side alignment.
- Keep full off-canvas layer imagery in the editable master PSD Smart Objects; JPGs are 1001px final views.

## v1.7.26 — Restore unlimited four-edge cover (Images 2–8)

- For four-edge cut creative images, restore the original proportional `cover`
  rule from the uploaded `amazonRules(3).js`: `scale = max(1001/sourceWidth,
  1001/sourceHeight) * 1.04`. No portrait contain-fit exception or 1.12x cap.
- Center the complete original frame. A portrait TIFF 2100×3150 now becomes
  approximately 1041×1562, positioned at x=-20, y=-280. The JPG is exactly
  1001×1001 and covers the entire canvas; vertical overflow is intentional.
- Do not infer/trim a photographed backdrop; preserve the original composition
  inside the full-size embedded Photoshop Smart Object, even off-canvas.
- Image 1 retains its established centered 801px safe area. Uncut images 2–8
  retain their 921px safe area. One-to-three-edge alignment, file order,
  Share Images, Colorbox Generate/Skip, and output-location detection unchanged.
- Run `npm run test:amazon-portrait-cover` with the full suite. Actual Photoshop
  placement still needs Windows Photoshop QC.
