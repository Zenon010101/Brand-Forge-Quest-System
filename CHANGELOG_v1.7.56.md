# BrandForge v1.7.56 - Amazon PSD Fast Loader

Based on **v1.7.55** Photoshop Compatibility Manager. Amazon-specific performance improvement. All other workflows unchanged.

## Added
- Disk-persistent normalized no-shadow PSD/PSB PNG cache. The first load still runs Photoshop; subsequent previews and Amazon generation reuse the same full-resolution normalized pixels without re-opening the same unchanged PSD.
- Local cache on Windows `%LOCALAPPDATA%\BrandForge\AmazonPsdFastCache` (fallback to app userData/normal per-user location).
- File identity includes absolute source path, size, modified/changed/creation times and extraction rule version. Re-extracts when source changes. Never modifies PSDs or temp/output PSD markers.
- One-flight concurrency: overlapping preview and Generate requests for the same source revision share one Photoshop extraction.
- Atomic cache writes, corrupted cache recovery, and continued processing if cache writes fail.
- Bounded cache size (maximum ~1 GiB and 500 PNGs) with cleanup of old entries; Clear Cache control in Amazon UI.
- Fast Loader counters in both Amazon modes: cached/selected, needing extraction, hit/extraction session counts, Refresh, Clear Cache, Open Logs.
- Local performance log: `amazon-psd-performance.log` beside cache folder. Records preview and generation timing, cache hit/miss, cut/render stage duration; rotates at 2 MiB.
- Preview displays cache HIT/MISS and duration; progress displays cache status, loading, cut and rendering times.
- Added unit and pipeline integration tests including a simulated Photoshop extraction.

## Preserved
- Hide SECOND top-level layer only for PSD no-shadow extraction; leave original PSD untouched and unmodified.
- Full-resolution normalized pixels for Amazon output and editable Smart Objects, 1001x1001 placement and all existing Amazon rules.
- Photoshop 2027 COM / ROT fallback and Compatibility Manager from v1.7.55.
- Batch and Folder Mode, image sharing, Colorbox, no-image/cut/position logic and output path settings.
- Slider, Remove Background, Combine, LP, History/EXP, profiles and unrelated modules.

## Limitations / validation
- First-time PSD still must be opened by Photoshop. Cache speeds repeated previews and generation; SSD and Photoshop performance vary.
- Photoshop 2027 COM + live PSD extraction must be confirmed on Windows; automated tests mock the Photoshop bridge.
- Cache does not store an existing JPG/PSD output or disable Photoshop for the final editable master PSD build.
- Cached PNG is the exact previous normalized Photoshop output (not a flattened PSD thumbnail). Cache layout rule changes must bump `CACHE_FORMAT` in `psdFastCache.js`.
