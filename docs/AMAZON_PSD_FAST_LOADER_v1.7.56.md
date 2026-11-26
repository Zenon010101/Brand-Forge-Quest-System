# Amazon PSD Fast Loader technical notes

## Before
1. Preview: Photoshop opens source PSD/PSB, hides second top-level layer, exports no-shadow PNG; preview is made from normalized PNG.
2. Generate: Photoshop reopens source PSD and exports the same no-shadow PNG again for cut detection, 1001px JPG + Smart Object creation.

## After
1. PSD/PSB input -> filesystem stat + versioned source fingerprint (absolute path, size, mtime, ctime, birthtime, rule version).
2. If a valid normalized PNG exists in the private per-user cache, read exact bytes. No Photoshop connection needed for this step.
3. If absent/changed/corrupted, open source via **existing** `extractPsdNoShadowToPng` (second top-level layer hidden), normalize with Sharp, atomically cache PNG + metadata, then proceed.
4. Preview uses 1000px thumbnail derived from full-resolution cached PNG. Generation reads *full-resolution PNG* and runs same cut detection / render / Smart Object pipeline as before.
5. Shared requests on the same PSD revision use one in-flight extraction promise. No parallel Photoshop extraction is introduced.
6. Cache save errors never fail a working extraction; damaged entries are treated as cache misses.

## Storage
On Windows `%LOCALAPPDATA%\BrandForge\AmazonPsdFastCache` (normal app data fallback elsewhere). The cache is automatically pruned to ~1 GiB and 500 entries, oldest first. Clear Cache does not touch user sources or outputs. Logs next to cache: `amazon-psd-performance.log` (rotated at 2 MiB).

## UI
In both Original Folder and Batch Workspace Amazon modes, the header displays *PSD Fast Loader* counts for assigned PSDs and allows Refresh / Clear Cache / Open Logs. The preview info displays source dimensions, cache result and time. Generation status shows per-stage timing and console/log output records preview/generate metrics.

## Photoshop upgrades
COM/ROT compatibility layers from v1.7.55 are retained. This cache avoids Photoshop only on unchanged cached sources, not when extracting a changed PSD or creating the editable final master PSD. If a new Photoshop build changes desired extraction behavior, clear cache or increment `CACHE_FORMAT`.

## QA
`npm run test:amazon-fast-loader` uses a mock Photoshop bridge to verify preview -> generate reuse, full-resolution pixels, file changes, corruption recovery, simultaneous requests, nonfatal cache failure, and cache deletion. `npm run validate` includes the complete BrandForge regression suite. Windows Photoshop 2027 live and Google Drive path timing are not exercised in this container.
