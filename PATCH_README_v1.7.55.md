# BrandForge v1.7.55 patch — apply to v1.7.54 ONLY

This patch adds a Photoshop Compatibility Manager in the existing **Settings** page. It preserves the working v1.7.54 Photoshop 2027 connection fallback, Slider JSX hotfix, Remove BG, Amazon, Combine, Arcade and all user data.

1. Close BrandForge. Back up the v1.7.54 project directory.
2. Extract the **changed-files ZIP** into the **root of the v1.7.54 project**, overwriting files. Or extract the **full-project ZIP** into a separate new folder.
3. Install dependencies (`npm install` if needed), run `npm run test:photoshop-compat-manager` and `npm run validate`.
4. If using an EXE, rebuild with `npm run build:portable` and launch that rebuilt v1.7.55 app. The ZIP contains source, not a prebuilt Windows executable.
5. Open Photoshop 2027, then BrandForge > Settings > Photoshop Compatibility Manager. Choose Auto or 2027 (28.x), run **Scan Installed + Check Scripts**, then **Run Photoshop Live Test**. Run one product each in Remove BG, Slider and Amazon before a production batch.
6. If a test fails, use **Open Compatibility Report** to inspect the exact connection, script or scratch stage. Do not edit Windows registry or disable security protections.

The version preference only blocks a mismatch. It never switches Photoshop installations or repairs COM automatically. The Photoshop scratch test is opt-in and isolated to temporary documents/files.
