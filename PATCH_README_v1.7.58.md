# BrandForge v1.7.58 - Full Project and Patch

## Full Project

Extract `BrandForge_v1.7.58_FULL_PROJECT_RK_Plain_Auto_Detect_Main_Assignment.zip` into a new folder and run the usual BrandForge start command or build your Windows portable executable.

## Patch (v1.7.57 only)

Back up the v1.7.57 project, then extract the v1.7.58 patch archive onto its root. The patch includes only changed/new files (listed with SHA-256 in `PATCH_MANIFEST_v1.7.58.txt`). Do NOT apply to earlier versions directly.

## Windows QA with your actual brand

1. In the Amazon Google Drive Project panel, select `G:\Shared drives\Design Team - Single and Six 2026\11. NOVEMBER\CLARKS #QLT244` and click **Detect Folders**. Verify `RK PLAIN` selects `SINGLE\RAKUEN\!!RAK PLAIN!!\PLAIN.psd` alongside Amazon, Slider and Colorbox. Click **Use Detected Paths**.
2. Enable **RK Plain**, verify that its path is filled without browsing. (If multiple markers exist, choose the correct one.)
3. Create two product IDs with different image sets. Use **Set Main #1** for each. Confirm the green Main #1 label is different for the two IDs. Optionally enable Global Creative #2.
4. Generate Amazon; verify that `id.jpg` and `idplain.jpg` have **identical JPEG bytes** for each ID, and that Image #2 is the Creative when enabled. Check shared IDs separately if used.
5. Inspect that `PLAIN.psd`, Amazon/Slider/Colorbox markers and all raw sources remain unchanged. Re-run with an existing RK Plain file to verify replacement confirmation.

**The previous PSD filter fix is preserved:** no automatic Photoshop startup when scrolling through unassigned PSD thumbnails. A PSD preview still opens Photoshop only when you click it or generate.

If using a previously built portable EXE, rebuild it from v1.7.58; extracting source files next to an old EXE does not update it automatically.
