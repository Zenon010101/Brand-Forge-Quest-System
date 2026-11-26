# BrandForge v1.7.57 update / patch instructions

## Recommended - Full Project ZIP

Extract the `BrandForge_v1.7.57_FULL_PROJECT_Amazon_Clear_Creative_RK_Plain_PSD_Quiet.zip` archive into a **new folder**. On the Windows office PC use the project's existing start/build scripts (or `npm install`, `npm start`; `npm run build:portable` to create a new portable EXE). Do not expect an old EXE to automatically update.

## Patch - only for original v1.7.56

Extract `BrandForge_v1.7.57_PATCH_FROM_v1.7.56_Clear_Creative_RK_Plain.zip` over a backup/copy of the v1.7.56 project root, maintaining folders. This patch is not a standalone application. The patch contains only changed/new files, and the manifest lists their SHA-256. Do not apply it to earlier or unrecognized versions without backing up.

## First QA on Windows

1. Open Amazon Batch Workspace; import a folder that contains many PSD files. Filter PSD, scroll, change filters, switch to Unassigned. **Photoshop should stay closed** until you explicitly preview a PSD or Generate. Normal cached previews must not call Photoshop.
2. Assign a main picture, other images and a shared ID. Choose an optional Creative and enable Auto Creative #2. Verify Image #1 main, #2 Creative, #3 the previous second image and unchanged remaining order. Try 8 originals + Creative: generation must refuse without deleting images.
3. Enable RK Plain, select a brand project with `SINGLE/RAKUTEN/!!RAK PLAIN!!/PLAIN.psd` or manually choose the marker folder. Generate. Confirm `idplain.jpg` exactly matches Amazon Image #1 and `PLAIN.psd` remains unmodified. Only primary ID exported to RK Plain.
4. Check Clear Amazon only clears UI selections and **does not delete** source or already generated image files. The separate Clear Cache button is unrelated.
5. Repeat in Original Folder Mode. Verify Colorbox, PSD master, sharing, portrait cropping and the other BrandForge modules as needed.

## Diagnostics

The Amazon PSD Fast Loader cache from v1.7.56 is preserved. If Photoshop still opens repeatedly without clicking Preview/Generate, capture the active Amazon mode, source filter, event log and whether another BrandForge module is active. Full Windows Photoshop 2027/Electron integration could not run in the Linux test environment.
