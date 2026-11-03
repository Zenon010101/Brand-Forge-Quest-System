# BrandForge v1.7.19 — Amazon Position-Only Cut Detection

## Scope
Correct Amazon product placement. Do not change source products or any Amazon export, sharing, PSD, Colorbox, or Google Drive destination rules.

## Source handling
1. Normalize the source while preserving its visual content and original aspect ratio.
2. Detect cut sides **on the original normalized source**, before bounding-box trimming.
3. Measure actual visible product pixels rather than including external transparent or estimated blank background margins.
4. Trim **external blank margins only** for fitting/placement. Never crop actual product pixels.
5. The first image is no longer pre-trimmed separately: all positions use the same single content measurement in the renderer.

## Placement
- Canvas is **1001 x 1001 px**.
- **Image 1 (normal):** visible content contained in centered **801 x 801 px** area.
- **Images 2–8 (normal):** visible content contained in centered **921 x 921 px** area.
- **Cut left:** align detected product left edge to canvas x = 0; keep vertical axis centered.
- **Cut right:** align product right edge to canvas x = 1001; keep vertical axis centered.
- **Cut top:** align product top edge to canvas y = 0; keep horizontal axis centered.
- **Cut bottom:** align product bottom edge to canvas y = 1001; keep horizontal axis centered.
- **Adjacent cuts:** align both relevant axes, without enlarging to fill the shared corner.
- **Opposite cuts:** fill that axis only if the **entire item** can remain inside the canvas, with uniform proportional scaling.
- If opposite edges cannot both be flush while retaining the entire product, **preserve the complete product** and return `limitedCutSides` diagnostics. Do not force a crop or distort the image.

## Explicitly prohibited
- No cut-corner filling or scaling based on corner anchors.
- No cover/max scale that makes product content larger than the final canvas.
- No `cropToCanvas()` to cut off product pixels after positioning.
- No stretching, compositing extra product parts, or changing the product's design.

## Preserved modules and workflow
- Existing Amazon Folder Mode and folderless Batch Workspace.
- Maximum eight images per independent Product ID.
- User-defined selection order and drag-to-reorder.
- Share Images: all linked IDs inherit the exact source image set and order.
- Amazon JPG filenames and master PSD rules.
- Image 1 as Colorbox source; **Generate Colorbox / Skip** decision remains optional.
- Google Drive project linking and read-only PSD marker templates.
- Slider Maker, Remove BG + Shadow, Landing Page Generators, local Profiles, EXP/History.
- No LAN leaderboard and no Smart Folder Import.

## Regression acceptance criteria
1. Normal centered image: no cut sides; product fits 801 or 921 safe area.
2. Each of the four cut sides: product touches **only the applicable canvas edge** and retains all pixels.
3. Adjacent cut sides: both align flush without forcing the shared corner to fill.
4. Opposite cut sides: never crop the product to reach the other edge.
5. Tall or wide source touching all four sides: preserve the top/bottom/left/right contents; no outside-canvas crop.
6. Product image with a naturally white/transparent corner: corner remains original, not filled by artificial zoom.
7. Images 1 through 8, shared IDs, master PSD and Colorbox retain their existing rules.

Run `npm.cmd run test:amazon-cut`, `npm.cmd run test:amazon-no-crop` and `npm.cmd run validate`. Actual Photoshop output and G: Shared Drive exporting still require a Windows workstation check.
