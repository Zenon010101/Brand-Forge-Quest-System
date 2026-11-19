# BrandForge v1.7.48 - Changed files only

Base: original BrandForge v1.7.47 full source.

1. Make a backup of the v1.7.47 project.
2. Extract the **contents** of this patch into the v1.7.47 project root (the folder containing package.json), preserving directory paths.
3. Run `npm install`, `npm run check`, `npm run test:slider-new-brand`, `npm start`.
4. On Slider Maker, choose CREATE COMBINE FOR NEW BRAND, import Slider Line Up + Details, upload Single, choose output folder, review/move/reorder, Generate JPEG + HTML (optional PSD/PSB).
5. Build portable on Windows: `npm run build:portable`.

Note: If you extracted the full-project ZIP, do not apply this patch again.
Original project marker PSDs and profile/history folders are not altered.
Windows UI / Photoshop COM and actual Hiragino font rendering require local testing.
