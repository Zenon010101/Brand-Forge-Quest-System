# BrandForge v1.7.18 — Google Drive Link Button Fix

**Updated: Google Drive path-link interface fix, retaining nested project-folder detection.** Select a brand's project folder on G:, detect existing PSD/PSB markers in `SLIDER/AMAZON [single and slider]`, `SLIDER/SLIDER-IMAGES/psd`, and `COLORBOX`, then use those folder locations as automatic output destinations. The PSD markers are **never opened, edited, or overwritten by the automation**. Raw files can stay on D:. Previously verified project paths can be recalled from local settings. The existing Amazon sharing, optional Colorbox choice and Slider image-processing rules are unchanged.

The cancelled **Smart Folder Import (per-product folders)** stays removed. The original Folder Mode and folderless Amazon Batch Workspace remain available.

The Batch Workspace retains image folder path scanning (paste/Browse/Scan),
format filters (PNG/PSD/JPG/etc.), image library with numbered click-order,
1–8 images per product, drag/reorder, editable Product ID and Delete, **Share
Images** for multiple IDs, output-folder/PSD naming, Amazon 1001x1001 sizing,
801/921 positioning, cut-edge flush alignment, master PSD, and **Generate
Colorbox / Skip**. Image 1 still becomes the optional Colorbox source.

Slider Maker now supports G: destination linking and safe staged PSD publishing, without changing its composition rules. Remove BG + Shadow, both LP Generators, profiles, EXP/history, and settings are unchanged. No LAN leaderboard.

See `UPGRADE_v1.7.18.txt` for the fixed UI and path-application behavior, and `UPGRADE_v1.7.17.txt` for the nested-folder layout. This version is a
source ZIP, not a precompiled Windows executable. Run `npm.cmd run validate`
then `npm.cmd start` in the project directory with Node/Electron installed.
