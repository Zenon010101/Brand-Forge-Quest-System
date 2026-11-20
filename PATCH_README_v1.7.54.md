# BrandForge v1.7.54 changed-files patch — apply to v1.7.53 ONLY

This is a focused fix for Photoshop 2027 Slider generation failing with `Unterminated string constant` near `__sliderWriteStatus("ERROR` (line ~4060). The normal COM 429 and ROT fallback message can appear in the same log; the Slider-specific error is bad generated JSX, not a new connection failure.

1. Back up your v1.7.53 source folder and outputs.
2. Extract the patch ZIP to the **root of the v1.7.53 project**, overwriting changed files while preserving all other project folders. Alternatively use the full v1.7.54 ZIP.
3. Run `npm run test:slider-jsx`, then `npm run validate` if dependencies are installed.
4. On Windows, open Photoshop 2027, launch the new BrandForge build (recompile with `npm run build:portable` if using a portable EXE). Test one Slider PSD and inspect it.
5. If a different Photoshop error appears, copy the entire new error. Do not assume every error is COM.

No administrator privileges, COM registration changes, or PowerShell policy modifications required. No Photoshop version selection behavior changed. The patch is source files only, not a precompiled EXE.
