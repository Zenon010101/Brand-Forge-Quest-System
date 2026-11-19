# v1.7.43 - Fix for `probe.vbs(2, 10) Invalid character`

The v1.7.42 shared Photoshop COM launcher accidentally generated variables starting with `__bf`. VBScript identifiers must begin with a letter. This causes `cscript.exe` to report a compilation error (exit 1) at line 2, column 10 before Photoshop can be contacted. The fix renames the variables with `BF` prefixes. Do not try to repair Photoshop or edit the Windows registry for this specific error.

After building v1.7.43, test the connection again with Photoshop 2027 already open. If the error changes to an actual `BRANDFORGE_COM_ERROR` (e.g. 429), use Open Diagnostics to investigate the separate COM registration issue.

---

# BrandForge v1.7.42 - Photoshop 2027 (28.x) COM/JSX connection

## Why this update

After installing Photoshop 2027, BrandForge's **Test Photoshop** sometimes reported
`ActiveX component can't create object`. This happens before Amazon, Slider,
Combine, Landing Page, or Remove Background can execute their JSX workers.

Photoshop 2027 reports Photoshop version 28.x (Adobe's November 2026 release).
The generic `Photoshop.Application` Windows COM ProgID is still the supported
scripting entry point. **Do not** assume a hard-coded ProgID such as
`Photoshop.Application.2027` exists.

The v1.7.42 connection helper tries:

1. `GetObject(, "Photoshop.Application")` - an already running COM instance.
2. `CreateObject("Photoshop.Application")` - the registered COM server.
3. When connected, `DoJavaScriptFile` for the actual JSX worker.

The probe verifies both COM connection and JSX execution (no documents edited).
It displays the detected Photoshop version and whether it attached or created
an instance. Failures retain the COM error codes and descriptions.

## Read-only diagnostics

Settings > Photoshop connection > **Test Photoshop**.
Click **Open Diagnostics** or expand **Photoshop connection details**.

The report is written in Electron's existing userData directory as
`photoshop-connection-diagnostic.txt`. It checks:
- Registered `HKCR\Photoshop.Application\CLSID`
- The CLSID's `LocalServer32` executable and whether that file exists
- Photoshop executables in the standard Adobe Program Files directories
- The actual COM/JSX output and error messages

BrandForge **does not write to the registry** or run elevated tools. Existing
profile data, PSD templates, outputs, and workflow geometry are unchanged.

## If `ActiveX component can't create object` still appears

1. Start Adobe Photoshop 2027 manually, wait for the editor to load, and confirm
   Creative Cloud sign-in and activation. Run BrandForge > Test Photoshop.
2. Quit Photoshop and BrandForge completely. Open Photoshop 2027 normally, then
   open BrandForge and retry.
3. Open the diagnostic report. If the CLSID or LocalServer32 entry is missing
   or points to an old Photoshop version, your Windows COM registration is not
   pointing to the intended installation.
4. If both connection methods fail even with Photoshop open, contact IT or the
   Adobe Creative Cloud admin for a supported Photoshop repair/reinstall.
5. To distinguish COM problems from JSX problems, run in Photoshop 2027:
   **File > Scripts > Browse** and select
   `tools/PHOTOSHOP_2027_JSX_TEST.jsx`. This displays a harmless version alert.
   If it works, the JSX runtime is fine and the COM bridge needs repair.

**Do not manually alter Windows registry keys, disable UAC, or try regsvr32 on
Photoshop.exe.** These measures are not part of the fix and could compromise
other Adobe installations. If your company PC lacks admin rights, IT should
perform registration repairs.

## Build portable EXE (Windows)

Open the v1.7.42 source folder in VS Code / CMD:

```cmd
npm install
npm run check
npm run test:photoshop-2027
npm run build:portable
```

The EXE is in `dist/`. No Python is required on the production PC.
The Electron EXE still requires Photoshop Desktop and a Windows COM connection.

## Validation scope

- Node syntax: validated.
- JavaScript bridge and diagnostic tests: validated using simulated COM responses.
- Existing BrandForge regression suite: validated without real Photoshop.
- Real Photoshop 2027 Windows COM, JSX, and PSD generation: **not tested here**.

If Photoshop 28.x itself refuses to register or run its COM server, a JavaScript
update cannot repair that external application defect. Read the report and
repair Photoshop/Creative Cloud with an authorized IT administrator.

References:
- Adobe scripting: https://helpx.adobe.com/photoshop/using/scripting.html
- Microsoft error 429: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/activex-component-can-t-create-object-or-return-reference-to-this-object-error-4
- Adobe release notes: https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html
