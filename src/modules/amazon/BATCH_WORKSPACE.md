# Amazon Batch Workspace — BrandForge v1.7.11

**New mode in the existing Amazon Generator, NOT a replacement for Folder Mode.** No source image renaming, numbered 1–8 files or per-ID directories are needed in Batch Workspace. All original files remain where they are. The chosen Amazon **output folder** is still required.

## Designer workflow

1. Open **Amazon Generator**. **Batch Workspace · No folders** is already selected by default. Use **Original Folder Mode** if needed.
2. Click **Import Images** (select multiple from File Explorer) or drag/drop files from Windows Explorer into the drop area. Imported filenames may be anything. The existing Amazon source formats are supported: PSD, PSB, JPG, JPEG, PNG, WEBP, TIF, TIFF, BMP, GIF, AVIF, HEIC, HEIF (decoding requires Sharp or Photoshop support).
3. Paste multiple primary product IDs (line/comma/tab/semicolon separated), click **Add Pasted IDs**, or create individual groups with **+ Blank Group**. Different products have *different* image sets.
4. Click a product group, click images in the library and **Add Selected to Product**, or drag image tiles directly onto that group/the image-order list. For direct Explorer drops, dropping files on a product assigns imported files directly. **Limit: 1–8 images per source product.**
5. Drag items in **Image Order** to rearrange, or use Up/Down. Item 1 is the Amazon primary image and exact Colorbox source. Order changes output names, not original filenames. Clicking an image displays its large preview.
6. For identical image sets under other IDs, enter the IDs in **Sharing IDs** for that source group. These IDs are exported from the same rendered JPG bytes and inherit identical image order. No additional sources or folders are needed.
7. Choose **Output Folder**, edit the default **AMAZON_BATCH.psd** name if desired, then click **GENERATE AMAZON**. The app validates every group, input path, duplicate ID and full output filename collision, protects original inputs, and asks before replacing any existing output.
8. After successful Amazon processing, the original native **Generate Colorbox / Skip** dialog appears. Choosing Generate Colorbox opens the existing Colorbox destination picker. **Only Image 1 of every successful ID** is copied to Colorbox, with the original `idclr.jpg` naming. Choosing Skip generates no Colorbox.

## Core image rules preserved

- 1001 × 1001 JPG canvas; original image-1 target 801 × 801, images 2–8 target 921 × 921; existing cut-side detection, visible-pixel, Photoshop PSD extraction, and no-shadow rules are unchanged.
- JPG output names: `ID.jpg`, `ID_2.jpg`, ... `ID_8.jpg`. Shared IDs get matching files via a byte-identical copy without rerendering the source image set.
- Existing one-master-PSD builder, Colorbox exporter, local temporary staging, overwrite backups, checksum verification on G: / mapped drives, and original EXP scoring are reused.
- Distinct sources each render once. Sharing does not multiply rendered-set EXP.
- One source failure marks only the affected source and its dependent shared IDs failed; other products continue. PSD/Colorbox only contain successful IDs.
- Source inputs are NEVER moved, renamed, copied into new ID folders, edited, or deleted.

## Data safety

- File paths (not file contents) are passed to Electron main for validation and processing. Folderless sources may come from unrelated directories or drives.
- Every product group must have 1–8 accessible image files, otherwise the entire batch is rejected at preflight; no invalid groups are silently skipped.
- Duplicate IDs, invalid Windows names, filenames that clash across IDs (e.g. `ABC_2.jpg`), source-file/output overlap, and unapproved output replacement are rejected before rendering starts.
- Completed outputs are published using the existing checksum-verified, per-ID rollback code. Source files are protected even when output and source folders are the same.
- The UI does not autosave the batch: do not close the app until exports are finished. A reusable batch-draft feature can be added separately.
- If an image decoder cannot handle a given format, the existing Photoshop fallback is attempted; a failed file is shown in the results and does not stop other valid products.

## Testing

Run `npm.cmd run test:amazon-batch` for folderless validation, actual JPG rendering with mocked Photoshop PSD, sharing, Colorbox Image 1, output collision protection, and existing-output preflight. `npm.cmd run validate` also runs original BrandForge regression tests. Actual PSD construction, drag/drop from Windows Explorer, and Photoshop processing require a real Windows + Photoshop end-to-end test.

The canceled LAN Leaderboard remains excluded.

## Removing an incorrect Product ID (v1.7.10)

- Click the **Delete** button directly beside an ID in **03 · Product Groups**. You do not have to select it first.
- Alternatively, select an ID and click **Delete Selected Group** in the editor.
- Empty groups delete immediately. If the group has assigned images or shared IDs, BrandForge asks for confirmation first.
- This removes the virtual ID group and its sharing links **from the current batch only**. Image files remain untouched on disk; imported files remain available in the Image Library to assign to another group.
- After deleting, active selection, selected order, preview, counts and Generate Amazon readiness update. You may paste the corrected ID or re-add the removed ID.
- The Delete action is disabled while a batch is processing. It does not delete previously generated JPGs or PSDs.


## v1.7.12 — Image Path Scanning / File Type Filters / Pick Order

The Batch Workspace adds a separate **Image folder location** field. Paste a
full Windows folder path or choose one with Browse, then click **Scan Images**.
This scanner adds files to the Image Library;
it does not create Amazon product groups or guess IDs from directory names.
Choose a **Scan type** to restrict imported files (PNG, PSD, PSB, JPG/JPEG,
WEBP, TIFF, BMP, GIF, HEIC/HEIF or AVIF) and optionally enable **Include
subfolders**. Only supported, nonempty files are listed, with diagnostics
for unreadable files. Already imported paths are not duplicated.

**Show file type** is a separate non-destructive Library view filter: choose
PNG only or PSD only to see just those images. Previously picked images are
retained when changing the view filter. Click images *in output order*;
the green numbered badges indicate exact selection order, even if they are
shown in a different library sort or format filter. **Add Selected in Pick
Order** appends the picked images to the active product in that order, up to
the existing eight-image cap. Image 1 is always the main JPG and optional
Colorbox source. Drag-to-reorder after adding still works.

Windows file dialogs do not promise click order for multi-file selection;
use the numbered Library to guarantee the final image sequence.

No change to processing, output names, Share Images, Colorbox prompt, master
PSD, originals, or existing module workflows.

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

## v1.7.14 — Share Images directly from Product Groups

Use **Share** beside any source Product ID, or select the group and click the
large **Share Images** button. Paste additional IDs (one per line, CSV-style,
tabs, commas or semicolons). Review duplicate/filename errors and expected JPGs,
then click **Apply Sharing**. You may reopen the dialog to change or clear the
list. Changing the source image order automatically changes every shared ID's
output order and optional Colorbox source. No separate images/folders are needed
for shared IDs. This UI restores visibility; existing sharing engine stays intact.
