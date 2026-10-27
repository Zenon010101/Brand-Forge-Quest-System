# Amazon module

Production Amazon Generator module used by the unified app.

Preserved rules:
- 1001x1001 final canvas
- strict exact source filenames 1-8 only
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
