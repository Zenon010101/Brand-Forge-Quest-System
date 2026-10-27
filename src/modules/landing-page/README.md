# BrandForge Landing Page Generator (v1.7.3)

This module is isolated from Slider Maker, Amazon Generator, Remove BG + Shadow, Profiles, EXP / History, and Settings. It uses the existing Electron + JavaScript + Sharp + Windows Photoshop/JSX architecture.

## Workflow

1. Optional **Add Single** (usually 600 x 600). The Single section is always 1000 x 1000, even if no Single is provided; a white `PLACE_SINGLE_HERE` layer is created for manual editing. Non-square Singles use proportional contain fitting, not distortion or accidental trimming.
2. **Add Screenshots** in order, or drag and drop multiple files. Reorder by dragging the rows or Move Up / Move Down; remove or clear individual parts. No filename-based reordering is performed.
3. Enter product code and select Output folder. Optional Photoshop fonts (`ArialMT`, `YuGothic-Regular`) and custom local Tesseract path.
4. **Analyze Landing Page**. Each screenshot is normalized to precisely 1000 px width; the body starts at Y=1000 and each part immediately follows the previous one. Tesseract OCR (locally installed) or built-in Windows OCR recognizes text. Text over reliably flat backgrounds may be restored as visible, editable Photoshop text; uncertain OCR text is retained as an **editable but hidden review layer**, while its original raster pixels remain visible. Large isolated photographic blocks can be separated into their own `IMG_XX` raster layers; uncertain graphics remain in raster fallback. Warnings are shown without failing the project.
5. Use **Full / Detail QC** to inspect screenshots and OCR / image box markers. **Generate PSD** creates an organized Photoshop document. PSD save happens in staging before final publishing, with optional backup of existing output files. Source images are never modified.

## Canvas and layer structure

- Width always `1000` pixels; no fixed LP height. The Single section always occupies Y=0–999.
- For screenshots i with original W_i × H_i, normalized height H'_i = round(1000 × H_i / W_i). Total height = 1000 + sum(H'_i).
- If height is greater than 30,000 px, automatically save an **editable .psb** (Photoshop Large Document Format), with a warning in Analysis; a regular .psd cannot hold this height. Photoshop's approximately 300,000 px height limit is enforced. Very long pages also require enough computer memory.
- No blank separators or padding are inserted between LP parts.

```
PRODUCT_CODE.psd (or .psb)
  01_SINGLE
    Single / PLACE_SINGLE_HERE (1000x1000)
  02_LP_PART_01
    TEXT                    (visible safe-to-restore editable text)
      TEXT_01
      ...
    OCR_REVIEW (hidden)     (hidden editable recognized text to inspect)
    IMAGES
      IMG_01                (isolated raster photo / graphic)
      ...
    BACKGROUND
      BG_RASTER_FALLBACK    (cleaned where reliable, otherwise exact screenshot)
      ORIGINAL_REFERENCE (hidden)
  03_LP_PART_02
    ...
```

The user has editable text layers whenever recognition and background restoration are safe, and separately moveable raster images for obvious image panels. Complex layouts/overlapping text, decorative typography, complex diagrams and tables are **not fully vectorized**; for visual safety they remain raster fallbacks or hidden review text. Exact original font identification is not guaranteed. The module is **not** a complete automatic recreation of every screenshot element; advanced semantic grouping and multi-column reconstruction are future work.

## Export files

```
Chosen output directory/
  PRODUCT_CODE/
    PRODUCT_CODE.psd
    extracted/
      part01_normalized_reference.png
      part01_background.png
      part01_img01.png  (where isolated reliably)
      ...
    ocr/
      part01.json
      ...
    manifest.json
    backups/             (only if an existing file was replaced)
```

Manifest includes Single source, screenshot order, original/normalized sizes, section Y offsets, OCR boxes and confidence, extracted image blocks, warnings, fallback information, and canvas height. Generation does not silently overwrite an existing PSD/manifest. When **Back up + replace existing exports** is selected, existing conflicted files are moved into a timestamped backup. The entire export is staged and publishing attempts rollback on failure.

## OCR engine

- Priority 1: local **Tesseract OCR** executable (PATH, standard Program Files locations, or a custom executable path entered in the UI). `eng+jpn` trained data used if installed, `eng` fallback otherwise.
- Priority 2 (Windows only): **Windows built-in OCR engine** through PowerShell/WinRT with installed Windows OCR language packs.
- If neither engine is available, the screenshot remains intact as raster fallback, and Analysis displays a warning. No Python or mandatory cloud OCR is used.
- OCR text on complex photographic backgrounds is recorded as hidden editable review layers, not forcefully inpainted. Visible text is only created when sufficiently reliable and surrounded by a stable background color. Review all OCR text in Photoshop, particularly Japanese and stylized fonts.

## Requirements / validation

- Windows 10/11, installed desktop Adobe Photoshop, current project Node / Electron dependencies.
- `npm.cmd install`, `npm.cmd run validate`, `npm.cmd start`.
- Automated: `npm.cmd run test:landing-page`, then the full `validate` suite.
- **Adobe Photoshop JSX execution itself requires a real Windows Photoshop smoke test.** Test with a 600×600 Single, two screenshots (one containing normal text on white) and verify group order, text editability, PSD dimensions and no gaps. On very long pages, verify the .psb fallback.

## Photoshop Copy Merged compatibility fix (v1.7.3)

PNG import uses **cross-document raster layer duplication**, not clipboard commands. Specifically, `source.activeLayer.duplicate(document, ElementPlacement.INSIDE)` imports each normalized screenshot, raster background, isolated image or Single into the LP document. Its visible pixel bounds are then translated to the expected section coordinates. This avoids the `Copy Merged is not currently available` error triggered by scripted `selection.copy(true)` in some Windows Photoshop environments. Failed imports report the affected layer and path and do not publish partial PSDs. Test with installed Photoshop on Windows before production use; automated `test:landing-page-jsx` runs a DOM simulation on other platforms.

## Technical notes

- Isolated modules: `main/planner.js` (safe layouts/filename rules), `main/analyzer.js` (normalization, OCR confidence/background sampling, conservative image extraction), `main/ocr.js` (Tesseract/WinRT OCR), `main/service.js` (batch sessions, manifest and staged publishing), `main/photoshopBridge.js`, `jsx/buildLandingPage.jsx`, and iframe renderer.
- The existing source list, original images and other production modules are not modified.
- Main IPC notifies **the invoking iframe** for progress instead of the host main frame.
