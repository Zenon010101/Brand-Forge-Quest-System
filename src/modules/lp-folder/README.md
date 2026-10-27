# BrandForge LP Folder Generator (v1.7.6)

This is a separate new module from the screenshot/OCR-based Landing Page Generator.

## Workflow

1. Open **LP Folder Generator** in the BrandForge sidebar.
2. Click **Select LP Folder** and choose a folder containing the LP image files (not the output directory).
3. The app scans readable image formats in that folder. The Single is detected from a filename containing `Single` (case-insensitive), otherwise from an image whose filename stem matches the folder name (e.g. `AKA-90/AKA-90.jpg`). When several candidates match, choose manually with **Set as Single**.
4. Review the order shown in the queue. Use Move Up / Down, drag-to-reorder, Remove, Clear, Reset Auto Order, and Refresh Folder. The Single stays at position 1 in the PSD.
5. Use **Selected Image** for large QC or **Full LP Order** for an approximate low-resolution composite.
6. Edit **Output filename** if you want the LP PSD/JPEG to have a name other than `FOLDER_LP`. For example, `AKA-90_FINAL` produces `AKA-90_FINAL.psd` and `AKA-90_FINAL.jpg`. Filename extensions are added automatically; a typed `.psd`/`.psb`/`.jpg` suffix is stripped before generating. The filename preview updates immediately.
7. Choose how to handle existing LP outputs: **Save New Version** (default), **Back Up + Replace**, or **Cancel**. This policy applies to **both the PSD/PSB and all JPEG files together**.
8. Click **Generate LP**. Photoshop creates an editable PSD/PSB plus a high-quality flattened JPEG in the **same folder** as the source images.

## Exact layout

- Canvas width: **1000 px**.
- Single occupies **1000 x 1000 px** at the top; the source is fitted without cropping or stretching.
- Remaining images: proportional width **1000 px**, stacked directly below with **no automatic gaps**.
- Canvas height: `1000 + sum(round(1000 * original_height / original_width))`.
- Photoshop layer order: `01_SINGLE`, `02_LP_PART_01`, `03_LP_PART_02`, ... . Each part contains a separately moveable **embedded Smart Object**, not a combined flattened image.
- Photoshop-native PSD/PSB input is embedded as a Smart Object whose original layers are accessible by editing its Smart Object contents. JPG, PNG, and other raster sources are editable/repositionable as separate Smart Object sections. **Flattened raster text does not automatically become a Photoshop text layer**: use the separate screenshot-based LP Generator for OCR reconstruction.
- Height above 30,000 px: Photoshop Large Document `.psb`. Above Photoshop's 300,000 px document limit: a clear error.
- JPEG quality **12** is rendered from the exact same Photoshop LP composition **after saving the layered PSD/PSB**, without modifying or flattening the saved editable document. Any transparency is composited onto white in the JPEG.
- JPEG format has a 65,535 px dimension limit. Documents taller than 60,000 px automatically export contiguous JPEG strips of up to 60,000 px each; section order and all pixels are preserved. A single PSD/PSB remains the fully editable master.

## Image detection

The scanner attempts JPG/JPEG/JPE/JFIF, PNG, WEBP, TIFF/TIF, BMP/DIB, GIF, Photoshop PSD/PSB, AVIF, HEIF/HEIC, SVG, EXR, HDR, JP2/J2K, JXL, TGA, ICO, PPM/PGM/PBM. The file **must be readable**: raster decoding uses installed Sharp/libvips image codecs; PSD/PSB dimensions are read from the Photoshop header and the files are placed directly in Photoshop. Some optional codecs (e.g. HEIC/JXL) are not guaranteed on all PCs. Unreadable/corrupted inputs are explicitly listed in scan warnings and not silently included. GIF/multipage raster inputs use their first frame/page. Vector inputs decoded via Sharp for image placement become Smart Object rasters; the original input files are untouched.

Generated `FOLDER_LP.psd` / `FOLDER_LP_v2.psd` / corresponding PSB outputs and `FOLDER_LP.jpg`, `_01.jpg`, `_v2_01.jpg` JPEGs are excluded from later folder scans to avoid recursive inclusion. New custom-named outputs are also registered in `.brandforge-lp-generated.jsonl` in the same folder, so they are not mistaken for LP source images when rescanning. Unrelated non-images are ignored.

## Photoshop integration

New files are isolated under `src/modules/lp-folder`. The new module reuses the existing Windows Photoshop COM/JSX bridge to run `jsx/compose.jsx`, which uses **Place Embedded**, not Copy Merged or clipboard paste. Non-PSD inputs are converted to high-quality PNG assets in OS temp storage before placement; Photoshop PSD/PSB sources are embedded directly. The original source files are never written to.

PSD/PSB previews require a working Windows Photoshop installation. Raster thumbnails and previews are generated with Sharp; failed previews do not delete sources from the queue. A large PSD preview can take time to open in Photoshop.

## Output safety

Custom output names are validated before Photoshop starts; names that would match a selected or unselected original source JPEG/PSD (including multi-part JPEG names) are refused to protect the source files. Export builds the layered PSD/PSB and flattened JPEG(s) in the local OS temp folder first, then copies verified bytes to the selected source folder. New output names are reserved with exclusive creation; existing files require explicit replacement. Backup-and-replace retains an old copy in `.brandforge-lp-backups/` in the source folder. The copy is validated by SHA-256 content, with limited retries for mapped/cloud/shared drives; failed writes attempt rollback. New-version naming avoids overwrites and keeps the same suffix for both files. Replacing an LP backs up all original PSD/PSB and JPG members of the output family, verifies every new file, and rolls back the complete set if publishing fails. Obsolete JPEG strips from a previously longer LP are removed only after verified replacement and are kept in backups. The source folder is never treated as an input/output publishing stage.

## Compatibility / verification

The Slider Maker LINEUP variant/color-name text was updated to #1E1E1E (RGB 30/30/30). All other Slider behavior is unchanged. The original Amazon Generator (including Share Images), Remove BG + Shadow, screenshot Landing Page Generator, local Profiles, EXP, and History are unchanged. The cancelled LAN Leaderboard is not present.

Run `npm.cmd run validate` to execute old and new tests. Automated tests cover editable output filename input, custom Unicode names, source image collision prevention, generated file scan exclusion, file scanning, sorting, mock PSD/PSB headers, 1000 px layout, no gaps, simulated Photoshop Smart Object JSX, output versioning and backup, and simulated export. **A real Windows Photoshop PSD/PSB generation and QC pass is still required**. No Windows Photoshop session was available in the build environment.
