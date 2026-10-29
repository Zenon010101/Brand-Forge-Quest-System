**v1.7.9 navigation note:** Amazon opens the new folderless Batch Workspace by default; the original folder-based workflow is one tab away and unchanged.

# Amazon module

Production Amazon Generator module used by the unified app.

Preserved rules:
- 1001x1001 final canvas
- strict exact source filenames 1-8 only in **Folder Mode**; **Batch Workspace** supports arbitrary input filenames and direct assignment
- first image uses actual visible pixels in 801x801 at x=100/y=100
- images 2-8 use actual visible pixels in 921x921 at x=40/y=40
- cut-side rules preserve aspect ratio and push content to detected cut edges
- all-side cut uses full-canvas coverage
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
