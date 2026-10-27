"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { WORKFLOW_RULES } = require("../../../shared/workflowConfig");

function jsxString(value) {
    return JSON.stringify(String(value).replace(/\\/g, "/"));
}

function vbsString(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
}

function jsxFromFile(filename, variables) {
    const jsx = fs.readFileSync(path.join(__dirname, "../jsx", filename), "utf8");
    const constants = Object.entries(variables).map(([key, value]) =>
        `var ${key} = ${typeof value === "number" ? String(value) : jsxString(value)};`
    );
    return constants.join("\n") + "\n" + jsx;
}

// Serialize *this module's* Photoshop calls. Preview generation cannot
// change the active Photoshop document while a cutout/PSD job is running.
let pendingPhotoshop = Promise.resolve();
function runPhotoshopJSX(scriptText, label, timeoutMs = 300000) {
    const task = pendingPhotoshop.then(() => runPhotoshopJSXDirect(scriptText, label, timeoutMs));
    pendingPhotoshop = task.catch(() => {});
    return task;
}

async function runPhotoshopJSXDirect(scriptText, label, timeoutMs = 300000) {
    if (process.platform !== "win32") {
        throw new Error("This workflow requires Adobe Photoshop on Windows.");
    }
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gws-removebg-"));
    const worker = path.join(dir, "worker.jsx");
    const launch = path.join(dir, "launch.vbs");
    const statusFile = path.join(dir, "status.txt");
    const body = String(scriptText).replace(/^\uFEFF/, "").replace(/^\s*#target\s+photoshop\s*/i, "");
    const wrapped = `#target photoshop\n` +
        `var __gwsOldDialogs = app.displayDialogs;\n` +
        `app.displayDialogs = DialogModes.NO;\n` +
        `function __gwsStatus(s) { var f = new File(${jsxString(statusFile)}); f.encoding = "UTF8"; if (!f.open("w")) throw new Error("Cannot write status"); f.write(String(s)); f.close(); }\n` +
        `try {\n${body}\n__gwsStatus("OK");\n` +
        `} catch (e) { var message = String(e && e.message ? e.message : e); try { if (e && e.line) message += " (JSX line " + e.line + ")"; } catch (ignore) {} __gwsStatus("ERROR\\n" + message); }\n` +
        `finally { app.displayDialogs = __gwsOldDialogs; }\n`;
    const vbs = `On Error Resume Next\n` +
        `Set ps = CreateObject("Photoshop.Application")\n` +
        `If Err.Number <> 0 Then\n WScript.Echo "Cannot launch Photoshop: " & Err.Description\n WScript.Quit 2\nEnd If\n` +
        `Err.Clear\nps.DoJavaScriptFile ${vbsString(worker)}\n` +
        `If Err.Number <> 0 Then\n WScript.Echo "Photoshop automation error: " & Err.Description\n WScript.Quit 3\nEnd If\nWScript.Quit 0\n`;
    await fs.promises.writeFile(worker, wrapped, "utf8");
    await fs.promises.writeFile(launch, vbs, "utf8");

    try {
        const result = await new Promise((resolve, reject) => {
            const child = spawn("cscript.exe", ["//nologo", launch], { windowsHide: true });
            let stdout = "";
            let stderr = "";
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                child.kill();
                reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds. Check Photoshop for an open dialog or a hung operation.`));
            }, timeoutMs);
            const finish = (error, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error);
                else resolve(value);
            };
            child.stdout.on("data", chunk => { stdout = (stdout + chunk.toString()).slice(-16000); });
            child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
            child.on("error", error => finish(error));
            child.on("close", code => finish(null, { code, stdout, stderr }));
        });
        let status = "";
        try {
            status = (await fs.promises.readFile(statusFile, "utf8")).replace(/^\uFEFF/, "").trim();
        } catch (error) {
            throw new Error(`${label}: Photoshop did not send a result. ${result.stdout} ${result.stderr}`.trim());
        }
        if (/^ERROR(?:\s|$)/.test(status)) throw new Error(status.slice(5).trim());
        if (result.code !== 0 || status !== "OK") {
            throw new Error(`${label} failed: ${result.stdout} ${result.stderr} ${status}`.trim());
        }
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

async function removeBackgroundInPhotoshop(source, stagedPng) {
    return runPhotoshopJSX(jsxFromFile("removeBackground.jsx", {
        GWS_SOURCE: source,
        GWS_OUTPUT: stagedPng
    }), `Remove Background: ${path.basename(source)}`);
}

async function createShadowPsdInPhotoshop(png, stagedPsd) {
    const rules = WORKFLOW_RULES.slider.shadow;
    return runPhotoshopJSX(jsxFromFile("addShadow.jsx", {
        GWS_PNG: png,
        GWS_PSD: stagedPsd,
        GWS_LOWER_RATIO: rules.lowerRatio,
        GWS_OPACITY: rules.opacity,
        GWS_BLUR: rules.blur,
        GWS_OFFSET_X: rules.offsetX,
        GWS_OFFSET_Y: rules.offsetY
    }), `Add Shadow: ${path.basename(png)}`);
}

module.exports = { jsxFromFile, runPhotoshopJSX, removeBackgroundInPhotoshop, createShadowPsdInPhotoshop };
