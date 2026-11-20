# Photoshop 2027 (v28.x) / 2026 (v27.x) — workstation QC

Adobe still documents Windows COM and ExtendScript/JSX automation. Photoshop
2027 also has user-reported COM activation / running-object lookup problems;
BrandForge cannot guarantee behavior that the installed Photoshop build refuses.

## Checklist on the production Windows PC

1. Close all Photoshop versions and any unfinished BrandForge batches.
2. Open **Photoshop 2027**, confirm activation and wait for startup to finish.
3. Open BrandForge v1.7.52, Settings -> **Test Photoshop**. Verify the detected
   version begins with `28.` and says `JSX OK`. The diagnostic shows the
   invocation method (`DoJavaScriptFile` or `DoJavaScript-evalFile`).
4. If it says `27.x`, BrandForge attached to Photoshop 2026 instead. Close
   2026, open 2027 and re-test. Do not trust the application title alone.
5. If `BRANDFORGE_COM_ERROR` or `0x80080005` appears, click **Open Diagnostics**.
   The report records `Photoshop.Application` -> CLSID -> `LocalServer32` and
   known Photoshop executable paths. Ask IT/Adobe Creative Cloud to repair or
   update Photoshop 2027 if those checks show stale/broken COM registration.
   **Do not force a registry edit, regsvr32 Photoshop.exe or admin mode.**
6. Distinguish a script problem from a COM problem: inside Photoshop choose
   **File > Scripts > Browse** and open
   `tools/PHOTOSHOP_2027_JSX_TEST.jsx`. This tests JSX independently from COM.
7. Remove BG: start with one high-contrast JPG and inspect the PNG at 100%; if
   Select Subject reports a problem, try Photoshop preferences for its
   on-device/Cloud image-processing setting and update Photoshop. The script
   attempts two descriptor forms but does not fabricate a cutout.
8. Test Add Shadow, one Slider PSD, and one Combine/LP output. Inspect Main,
   Shadow and embedded images, not just successful log messages.

## What changed internally

- `src/shared/photoshopCom.js`: guarded DoJavaScriptFile -> DoJavaScript
  fallback, visible COM error codes; 27.x and 28.x allowed.
- `src/shared/photoshopTaskQueue.js`: cross-module Photoshop execution lock.
- `src/shared/photoshopFiles.js`: generated `.jsx` files with UTF-8 BOM.
- Remove BG `autoCutout`: try default descriptor only when first attempt fails.
- Settings diagnostics now reports the version and invocation method.

## What this does not solve

Windows/Photoshop not exposing the COM server at all, Adobe AI model failure,
GPU issues, an invalid license, missing Photoshop Scripts support, or a bug
inside a third-party Adobe plug-in. Such failures remain actionable errors and
must not silently publish bad files. This release was not tested against a
real Windows Photoshop 2027 installation in the build environment.

References:
- https://helpx.adobe.com/photoshop/desktop/automate-tasks/automation-settings-and-presets/automate-photoshop-with-scripts.html
- https://community.adobe.com/bug-reports-699/p-com-cannot-find-the-running-instance-although-automation-still-works-1651084
- https://github.com/alisaitteke/photoshop-mcp/issues/80
