const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { app, ipcMain, shell } = require("electron");
const { WORKFLOW_RULES } = require("../../../shared/workflowConfig");

const SHARED_RULES = Object.freeze({
    sliderShadow: {
        lowerRatio: WORKFLOW_RULES.slider.shadow.lowerRatio,
        opacity: WORKFLOW_RULES.slider.shadow.opacity,
        blurPx: WORKFLOW_RULES.slider.shadow.blur,
        offsetX: WORKFLOW_RULES.slider.shadow.offsetX,
        offsetY: WORKFLOW_RULES.slider.shadow.offsetY
    },
    amazon: {
        canvas: WORKFLOW_RULES.amazon.canvasSize,
        firstArea: WORKFLOW_RULES.amazon.firstImageArea.width,
        restArea: WORKFLOW_RULES.amazon.restImageArea.width,
        strictSlots: "1-8"
    },
    slider: {
        canvas: WORKFLOW_RULES.slider.canvasSize,
        detailCutVisibleHeight: WORKFLOW_RULES.slider.cutVisibleHeight,
        detailBottomWhite: WORKFLOW_RULES.slider.cutBottomWhite,
        maxOutputs: 18
    }
});

async function runPhotoshopProbe() {
    if (process.platform !== "win32") {
        return {
            ok: false,
            error: "Photoshop automation is supported by this app on Windows only."
        };
    }

    const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "image-workflow-ps-probe-"));
    const scriptPath = path.join(temp, "probe.vbs");
    const script = `
On Error Resume Next
Set ps = CreateObject("Photoshop.Application")
If Err.Number <> 0 Then
    WScript.Echo "ERROR|" & Err.Description
    WScript.Quit 2
End If
Err.Clear
ps.Visible = True
WScript.Echo "OK|" & ps.Version
WScript.Quit 0
`;

    await fs.promises.writeFile(scriptPath, script, "utf8");

    try {
        const result = await new Promise((resolve, reject) => {
            const child = spawn("cscript.exe", ["//nologo", scriptPath], { windowsHide: true });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", data => { stdout += data.toString(); });
            child.stderr.on("data", data => { stderr += data.toString(); });
            child.on("error", reject);
            child.on("close", code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
        });

        if (result.stdout.startsWith("OK|")) {
            return { ok: true, version: result.stdout.slice(3).trim() || "Detected" };
        }

        const error = result.stdout.startsWith("ERROR|")
            ? result.stdout.slice(6).trim()
            : (result.stderr || "Photoshop COM automation was not available.");
        return { ok: false, error };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    } finally {
        await fs.promises.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
}

ipcMain.handle("settings:get", async () => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    platform: process.platform,
    userDataPath: app.getPath("userData"),
    sharedRules: SHARED_RULES
}));

ipcMain.handle("settings:test-photoshop", runPhotoshopProbe);

ipcMain.handle("settings:open-user-data", async () => {
    const folder = app.getPath("userData");
    await fs.promises.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    return error ? { ok: false, error } : { ok: true, path: folder };
});

ipcMain.handle("settings:reset-recent-folders", async () => {
    const names = [
        "dialog-state.json",
        "amazon-dialog-state.json"
    ];
    const folder = app.getPath("userData");
    const removed = [];

    for (const name of names) {
        const file = path.join(folder, name);
        try {
            await fs.promises.unlink(file);
            removed.push(name);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }

    return { ok: true, removed };
});
