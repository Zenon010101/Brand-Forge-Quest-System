# BrandForge v1.7.52 — Patch from uploaded `brandforge latest.zip` (v1.7.50)

1. Back up your current BrandForge project and PSD outputs.
2. Unzip this patch **over the exact version in the uploaded file**, preserving
   the folder hierarchy and overwriting the included changed source files.
3. Run `npm install`, `npm run validate`, then `npm run build:portable` on
   Windows. Node/npm is required for a source build; no admin rights are
   required to use the portable EXE once built.
4. Close other Photoshop versions, open Photoshop 2027 (28.x), launch
   BrandForge, and run **Settings > Test Photoshop**. It must report JSX OK and
   version 28.x before you run a Photoshop-dependent batch.
5. Test one Remove BG JPG; inspect transparent PNG, then Add Shadow PSD. Then
   test one Slider and one Combine or LP PSD job. No batch should run before a
   successful 2027 connection and single-product validation.

If Test Photoshop fails with `BRANDFORGE_COM_ERROR`, open the diagnostic report
and check the registered Photoshop executable; no change to the BrandForge
scripts can force Adobe's failed COM server to initialize. Ask your Adobe/
Windows IT admin to repair Photoshop or temporarily use the working 2026
installation. **Do not manually edit the registry.**

This patch is not derived from the earlier v1.7.51 2026-only release.
