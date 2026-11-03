# BrandForge Combine Generator (v1.7.23)

This is a standalone Electron/Photoshop module. The uploaded `!COMBINE_TEMPLATE.psd`
is retained in `template/COMBINE_TEMPLATE_REFERENCE.psd` as a read-only geometric
reference, **not** modified or flattened as the output document. A new, dynamic
layered PSD/PSB is generated using the approved reference geometry.

## Workflow

1. **Single**: upload or drop one image; always first in a 600 x 600 area.
2. **Line Up (optional)**: leave this section completely empty to skip it, or
   upload color variations. Color names are required **only for uploaded Line Up
   images**. Use the bulk name paste field (one per line, in the current order).
   Drag an entry to reorder its image and name together.
3. **Details (optional)**: upload images independently; drag entries to reorder.
   Without Line Up, Details follow the Single with the same 15 px separation
   before the DETAILS heading. Single-only Combine is also supported.
4. **QC Preview**: inspect the complete composition or a selected original.
5. **Output**: enter a PSD filename and select a destination folder; choose
   Save New Version, Back Up + Replace, or Cancel.
6. Click **Generate Combine**. The app stages the Photoshop document and JPEG,
   verifies the complete outputs, and then publishes the matched files.

## Fixed rules

- Canvas width: **600 px**; height expands from image counts and wrapped labels.
- Single: **600 x 600 px** at the top, with a **15 px gap** before the
  first included section (Line Up or Details). A Single-only export is exactly
  **600 px high**, with no empty section or trailing gap.
- Line Up: **2 columns**, image areas **293 x 293 px**, at x=3 and x=304;
  **8 px** between columns. Each variation has a **28 px editable text layer**
  beneath its image (6 px text separation, 36 px per text line, 7 px row gap).
- Details: **2 columns**, **293 x 293 px** cells, **8 px horizontal gap**,
  **7 px vertical gap**, with 3 px outer margins. Images move left-to-right,
  then down, exactly following the ordered queue.
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
