# BrandForge v1.7.53 patch — apply to v1.7.52 ONLY

1. Back up the v1.7.52 project and existing output folders.
2. Extract the patch ZIP into the **v1.7.52 source root** and overwrite only
   the included files, preserving all other folders. The patch adds
   `src/shared/photoshopRot.ps1` and `test/photoshopRotFallback.js`.
3. Build / launch the source the same way you did v1.7.52. No registry changes,
   administrator privileges, or PowerShell policy changes are requested.
4. Close Photoshop 2026. Open Photoshop 2027 fully; then start BrandForge.
   Run **Settings > Test Photoshop** before any production batch.
5. If the connection works, Settings should show Photoshop `28.x` and either
   the usual COM connection or **Windows ROT fallback**. Test one JPG in Remove
   BG and inspect output before processing multiple images.
6. If the test still fails, use **Settings > Open Diagnostics**. Look for
   `BRANDFORGE_ROT_UNAVAILABLE` or `BRANDFORGE_ROT_ERROR` following the COM
   error. Photoshop 2027 may have no usable automation object, or corporate
   PowerShell restrictions may block the fallback. An Adobe repair/update or
   working Photoshop 2026 remains necessary in those cases.

**Do not edit the Windows registry, switch off IT security policies, or
install untrusted COM tools to force Photoshop registration.**

## Source-only release

This ZIP contains source changes, not a precompiled portable EXE. Windows
Photoshop and PowerShell execution were not tested in this Linux build.
