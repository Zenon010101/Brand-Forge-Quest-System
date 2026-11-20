"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildJsxLaunchVbs, runVbsScript, explainFailure } = require("../../../shared/photoshopCom");
const { writeJsxFile } = require("../../../shared/photoshopFiles");
const { withPhotoshopTask } = require("../../../shared/photoshopTaskQueue");

function jsxString(value) { return JSON.stringify(String(value).replace(/\\/g, "/")); }
function vbsString(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }

let previous = Promise.resolve();
function runPhotoshopJSX(scriptBody, label = "Landing Page PSD", timeoutMs = 900000) {
    const pending = previous.then(() => withPhotoshopTask(label, () => runDirect(scriptBody, label, timeoutMs)));
    previous = pending.catch(() => {});
    return pending;
}

async function runDirect(body, label, timeoutMs) {
    if (process.platform !== "win32") throw new Error("PSD generation requires Adobe Photoshop installed on Windows.");
    const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-lp-jsx-"));
    const source = path.join(folder, "worker.jsx");
    const launch = path.join(folder, "launch.vbs");
    const status = path.join(folder, "status.txt");
    const wrapped = `#target photoshop\n` +
        `var __oldDialogs = app.displayDialogs; app.displayDialogs = DialogModes.NO;\n` +
        `function __result(s) { var f = new File(${jsxString(status)}); f.encoding = "UTF8"; if (!f.open("w")) throw new Error("Could not write status file"); f.write(String(s)); f.close(); }\n` +
        `try {\n${body.replace(/^\s*#target\s+photoshop[^\n]*\n?/i, "")}\n__result("OK");\n` +
        `} catch(e) { var msg = String(e && e.message ? e.message : e); try { if (e.line) msg += " (JSX line " + e.line + ")"; } catch(ignore) {} __result("ERROR\\n" + msg); }\n` +
        `finally { app.displayDialogs = __oldDialogs; }`;
    const vbs = buildJsxLaunchVbs(source, { variableName: "p", receiptPath: status });
    await writeJsxFile(source, wrapped);
    await fs.promises.writeFile(launch, "\uFEFF" + vbs, "utf16le");
    try {
        const childResult = await runVbsScript(launch, { timeoutMs, rotFallback: { jsxPath: source, receiptPath: status } });
        let reply = "";
        try { reply = (await fs.promises.readFile(status, "utf8")).replace(/^\uFEFF/, "").trim(); }
        catch (_) { throw new Error(`${label}: Photoshop did not write a result. ${explainFailure({code: childResult.code, stdout: childResult.stdout, stderr: childResult.stderr}, label)}`); }
        if (/^ERROR(?:\s|$)/.test(reply)) throw new Error(`${label}: ${reply.slice(5).trim()}`);
        if (childResult.code !== 0 || reply !== "OK") throw new Error(`${label}: ${explainFailure({code: childResult.code, stdout: childResult.stdout, stderr: childResult.stderr}, label)} ${reply}`);
    } finally {
        await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {});
    }
}

async function buildLandingPsd(layout, outputPath, options = {}) {
    const template = await fs.promises.readFile(path.join(__dirname, "../jsx/buildLandingPage.jsx"), "utf8");
    const data = {
        ...layout, code: options.code, hasSingle: !!options.hasSingle,
        singlePath: String(options.singlePath).replace(/\\/g, "/"),
        fontLatin: options.fontLatin || "ArialMT", fontJapanese: options.fontJapanese || "YuGothic-Regular",
        parts: layout.parts.map(p => ({
            ...p,
            normalizedPath: p.normalizedPath.replace(/\\/g, "/"),
            basePath: p.basePath.replace(/\\/g, "/"),
            images: p.images.map(img => ({ ...img, file: img.file.replace(/\\/g, "/") }))
        }))
    };
    const script = `var LP_DATA = ${JSON.stringify(data)};\nvar LP_OUTPUT = ${jsxString(outputPath)};\n` + template.replace(/^\s*#target\s+photoshop[^\n]*\n?/i, "");
    await runPhotoshopJSX(script, "Landing Page PSD", Math.max(240000, Math.min(900000, 240000 + layout.parts.length * 30000)));
    const stat = await fs.promises.stat(outputPath);
    if (!stat.isFile() || stat.size < 1000) throw new Error("Photoshop did not produce a valid PSD/PSB output.");
    return outputPath;
}

module.exports = { buildLandingPsd, runPhotoshopJSX };
