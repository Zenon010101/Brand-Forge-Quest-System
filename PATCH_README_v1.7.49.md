# BrandForge v1.7.49 changed-files patch

1. Back up your full BrandForge v1.7.48 folder.
2. Extract this patch at the **BrandForge project root**, replacing matching files under `src`, `test`, and the `package*.json` files.
3. Run `npm install`, `npm run test:slider-drag-drop`, `npm run validate`, then `npm start`.
4. In Slider Maker, drop an image onto each of Creative, Line Up and Detail; drag a Line Up card and one variation tile; import into New Brand Combine; review and save JPEG+HTML.
5. If all checks pass, build the Windows portable app with `npm run build:portable`.

All other modules remain present in the full project ZIP. The patch requires exactly v1.7.48 as its base.
