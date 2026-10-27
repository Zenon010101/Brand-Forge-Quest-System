# Remove Background + Shadow (separate Image Workflow Studio module)

This is a third Electron UI module registered by `src/modules/remove-bg/main/register.js`.
It does not require changes to Slider Maker, Amazon Generator, or the profile/history storage.

## v1.5.2 batch-status repair

Electron `webContents.send` reaches the top-level frame, not this module's iframe. Progress updates now use the requesting frame's `senderFrame.send`; on navigation or message loss, the final `ipcRenderer.invoke` reply is the fallback source of truth. A `remove-bg:get-state` IPC method allows iframe reloads and active batch recovery. When original images are imported in a later app session, matching same-folder transparent PNG exports with up-to-date timestamps are detected and marked PNG Ready without segmenting again. QC approval remains the operator's responsibility; Add Shadow does not modify PNGs.

## Architecture

- `renderer/index.html`, `renderer/style.css`, `renderer/app.js`: drag/drop queue, item status, large checkerboard QC, Original/PNG result toggle, fit/100% zoom, two explicit processing actions.
- `main/register.js`: Electron IPC, OS file picker, original preview composites (Sharp or Photoshop for PSD/PSB), per-file progress to the renderer.
- `main/processor.js`: session queue, independent file jobs, input/output collision handling, JPEG/PNG/WEBP/TIFF conversion, PNG/PSD verification, original PNG/PSD backups.
- `main/files.js`: supported raster input extensions, source-relative output paths, unique temporary file names, safe commits, `GWS Backups`.
- `main/photoshopBridge.js`: time-limited Windows Photoshop COM/JSX execution, error status file, scripts with shared `WORKFLOW_RULES.slider.shadow` constants.
- `jsx/removeBackground.jsx`: duplicate open Photoshop document, hide existing named `Shadow` layers in PSD inputs, build a pixel composite, use Photoshop `autoCutout` (Select Subject) when opaque, invert the foreground selection and clear background pixels only in a disposable duplicate, save staged PNG, close temporary documents without saving. Native `removeBackground` Quick Action is not used.
- `jsx/addShadow.jsx`: open approved PNG, turn Main into Smart Object, load nontransparent pixels, select lower half with `SelectionType.INTERSECT`, fill Shadow black, offset +4px, Gaussian Blur 5, opacity 18, save exactly two editable PSD layers.
- `jsx/preview.jsx`: read-only Photoshop-only source previews.

## Supported inputs

JPG, JPEG, PNG, WEBP, TIF, TIFF, BMP, GIF, PSD, PSB, TGA, HEIC, HEIF. The underlying version of Photoshop must be able to open the selected format. Animated or multipage formats are intended as single still-image inputs.

## Known runtime constraints

Requires **Windows + Adobe Photoshop** for opaque image segmentation and PSD export.
Adobe's native Remove Background segmentation is imperfect on some transparent, reflective, or fine-detail products, so human checking of the PNG before Add Shadow is mandatory.
The JavaScript integration tests use injected Photoshop stubs; full Windows Photoshop JSX runtime validation must be performed on a production workstation.

## Photoshop 2026: Could not find background

If Photoshop displays **"Couldn't find background to remove"**, it is often an issue with its on-device AI processing. Go to **Edit > Preferences > Image Processing > Select Subject and Remove Background > Cloud**, restart Photoshop, then retry. This setting must be made by the Photoshop user; the app will not change Photoshop preferences automatically. Cloud processing requires access to Adobe's cloud service.

Version 1.5.1 bypasses the Quick Action by using Photoshop's native **Select Subject** selection and clearing the inverse on a temporary raster composite; this is still Photoshop segmentation and still requires a functioning Select Subject engine. Failure produces an actionable per-file error without touching source or other queue items. It does not promise correct segmentation for every product; inspect the PNG at 100% before continuing to Add Shadow.
