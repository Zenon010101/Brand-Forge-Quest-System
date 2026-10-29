# BrandForge v1.7.15 — Amazon Smart Folder Import Removed

The **Smart Folder Import (per-product folders)** button, Excel folder-to-ID
mapping modal, smart per-product scanner, and related IPC were removed as
requested. **The original Folder Mode and folderless Amazon Batch Workspace
remain working.**

The Batch Workspace retains image folder path scanning (paste/Browse/Scan),
format filters (PNG/PSD/JPG/etc.), image library with numbered click-order,
1–8 images per product, drag/reorder, editable Product ID and Delete, **Share
Images** for multiple IDs, output-folder/PSD naming, Amazon 1001x1001 sizing,
801/921 positioning, cut-edge flush alignment, master PSD, and **Generate
Colorbox / Skip**. Image 1 still becomes the optional Colorbox source.

No changes to Slider Maker, Remove BG + Shadow, either LP Generator, profiles,
EXP/history, or settings. No LAN leaderboard.

See `UPGRADE_v1.7.15.txt` for full and patch installation. This version is a
source ZIP, not a precompiled Windows executable. Run `npm.cmd run validate`
then `npm.cmd start` in the project directory with Node/Electron installed.
