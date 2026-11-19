# BrandForge v1.7.50 patch from v1.7.49

Apply **only** to a BrandForge v1.7.49 source folder. Unzip over the project root and allow file replacement. Or use the v1.7.50 full source ZIP.

The patch changes the Slider Maker individual Line Up color-drag UX. It removes whole-Line-Up-card drag. All existing BrandForge modules and output behavior remain intact.

To run from source: `npm install`, then `npm start`. To test: `npm run test:slider-drag-drop` or `npm run validate`.

QA on Windows: import a 2-cut or 4-cut Slider Line Up; grab any one color tile (not its color input) and drop it onto a variant in another card; confirm only the two target variants exchange places and their captions and shadow states follow them. For PA Vertical, move the Color Name group handle and confirm Item + Item Detail stay linked. Generate Slider and Combine and inspect final variation order. The zip is source, not a prebuilt Windows executable.
