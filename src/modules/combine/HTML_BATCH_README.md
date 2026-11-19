# Current default Combine mode (v1.7.44)

Open BrandForge > Combine Generator. The default screen is **Iframe → HTML Batch**.

- Paste complete Rakuten GOLD iframe HTML, e.g. `<iframe src="https://www.rakuten.ne.jp/gold/glv/six/tenera/TNR-90.html" scrolling="no" frameborder="0" width="780" height="610"></iframe>`.
- Source HTML is fetched in order to collect image URL references. **JPGs/PNGs are not downloaded or altered.** Previewing HTML in a browser necessarily displays remote images over the network.
- Layout: 2 Line Up columns, 3 Details columns, 28px DETAILS heading.
- Excel Batch: .xlsx with a column of iframes; optional `Lineup Count` column. The new output workbook preserves the source sheet: Col A iframe, B HTML source, C HTML file link, D JPEG file link, plus QC columns (when iframe starts in A). Saves standalone HTML files in a new versioned folder.
- Rows with no reliable source DETAILS marker get a default count and REVIEW status. Manual overrides take priority; never claim the split was verified if it was only inferred.
- Old text removal and image-downloader panels are retired from the visible Combine workflow. The legacy PSD Combine remains accessible under **Legacy PSD Combine** for previously saved projects.
- The new HTML-only workflow works without Photoshop. The legacy PSD generator still uses Photoshop COM.

See root `CHANGELOG_v1.7.44.md` and `INSTALL_FULL_PROJECT_v1.7.44.txt`.

## v1.7.46: Complete JPEGs
JPEG_FILES contains one full-page JPG per iframe. Electron renders only the generated HTML and existing HTTPS image URLs; no Photoshop, text removal, or intermediary image files. The JPEG link is adjacent to the HTML link in the output Excel, and failed image loads are flagged REVIEW.


## v1.7.47: Different output layouts (intentional)

The HTML code and standalone HTML file retain the **780px table layout** (Line Up 2, Details 3).
JPEG files use the original **600px Combine composition** (Line Up 2, Details 2, flexible height), with the legacy 293px image boxes and 28px DETAILS heading. No text removal; original image contents and source order are preserved.
The Single iframe preview has two layout buttons so users can inspect HTML and JPEG separately. JPEG uses a temporary render-only HTML document that is removed after capture; it never replaces the exported HTML file.
