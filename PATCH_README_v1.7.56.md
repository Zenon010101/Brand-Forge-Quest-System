# BrandForge v1.7.56 patch from v1.7.55

Extract the **changed-files-only** archive at the root of the existing BrandForge v1.7.55 project, preserving paths and replacing matching files. The patch contains new cache files, updated Amazon main/renderer/preload modules, package manifests and tests. No files are deleted.

For a clean installation, use the separately supplied full project ZIP.

Run `npm run validate` and `npm run test:amazon-fast-loader` in your project folder. On your Windows Photoshop 2027 PC, open Photoshop and load the same PSD twice in Amazon; preview should show MISS then HIT. Generate Amazon with that PSD and check loading time + output quality. The first load may remain slow.

The file cache lives in `%LOCALAPPDATA%\BrandForge\AmazonPsdFastCache`. To inspect diagnostic timings, click **Open Logs** in Amazon. **Clear Cache** removes only cached PNGs and metadata, not source PSDs or output JPG/PSD files.
