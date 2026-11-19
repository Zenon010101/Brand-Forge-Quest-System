"use strict";

/**
 * Shared Windows Photoshop COM/ExtendScript launcher.
 *
 * Photoshop 2027 (28.x) still exposes Photoshop.Application on supported
 * installations, but some upgrades break COM registration. Never edit the
 * registry or silently pick an unverified version-specific ProgID here.
 *
 * This module is pure Node/VBScript text generation; it does not need Electron.
 */
const { spawn } = require("node:child_process");

const CONNECT_ERROR = "BRANDFORGE_COM_ERROR";
const SCRIPT_ERROR = "BRANDFORGE_JSX_ERROR";
const SUCCESS = "BRANDFORGE_CONNECTED";

function vbString(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
}

function validateVariableName(name) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
        throw new Error("Invalid VBScript object variable name.");
    }
    return name;
}

/**
 * Try the already-running Photoshop instance, then the standard registered
 * Photoshop.Application server. A broken COM server cannot be repaired by JS.
 * Both error descriptions and HRESULTs are preserved in the process output.
 */
function buildComConnectVbs(variableName = "ps") {
    const varName = validateVariableName(variableName);
    return `On Error Resume Next
Dim ${varName}, BFConnectMethod, BFGetNumber, BFGetDescription
Dim BFCreateNumber, BFCreateDescription, BFVersion
Set ${varName} = Nothing
BFConnectMethod = ""
Err.Clear
Set ${varName} = GetObject(, "Photoshop.Application")
BFGetNumber = Err.Number
BFGetDescription = Err.Description
If BFGetNumber = 0 Then
    If Not (${varName} Is Nothing) Then BFConnectMethod = "running"
End If
Err.Clear
If ${varName} Is Nothing Then
    Set ${varName} = CreateObject("Photoshop.Application")
    BFCreateNumber = Err.Number
    BFCreateDescription = Err.Description
    If BFCreateNumber = 0 Then
        If Not (${varName} Is Nothing) Then BFConnectMethod = "created"
    End If
    If ${varName} Is Nothing Then
        WScript.Echo "${CONNECT_ERROR}|GetObject=" & CStr(BFGetNumber) & ": " & BFGetDescription & " | CreateObject=" & CStr(BFCreateNumber) & ": " & BFCreateDescription
        WScript.Quit 52
    End If
End If
Err.Clear
BFVersion = CStr(${varName}.Version)
If Err.Number <> 0 Then
    BFVersion = "unknown"
End If
Err.Clear
`;
}

/** Build a complete VBScript that invokes the worker in Photoshop. */
function buildJsxLaunchVbs(jsxFile, { variableName = "ps", reveal = false } = {}) {
    const name = validateVariableName(variableName);
    return buildComConnectVbs(name) +
        (reveal ? `${name}.Visible = True\nErr.Clear\n` : "") +
        `${name}.DoJavaScriptFile ${vbString(jsxFile)}\n` +
        `If Err.Number <> 0 Then\n` +
        `    WScript.Echo "${SCRIPT_ERROR}|" & CStr(Err.Number) & ": " & Err.Description\n` +
        `    WScript.Quit 53\n` +
        `End If\n` +
        `WScript.Echo "${SUCCESS}|" & BFVersion & "|" & BFConnectMethod\n` +
        `WScript.Quit 0\n`;
}

function connectionAdvice(message) {
    if (/VBScript compilation error|VBScript syntax error|VBScript runtime error.*Invalid character/i.test(String(message))) {
        return "The temporary Windows VBScript launcher failed before Photoshop was contacted. " +
            "This is a launcher syntax problem, not proof of a Photoshop COM failure. " +
            "Use BrandForge v1.7.43 or later, which fixes the invalid internal variable names.";
    }
    if (String(message).includes(CONNECT_ERROR) || /ActiveX component can't create object|0x80080005|server execution failed/i.test(String(message))) {
        return "Photoshop COM could not connect. Open Photoshop 2027 normally and retry BrandForge > Settings > Test Photoshop. " +
            "If it still fails, open the Photoshop diagnostic report. A missing/stale Windows COM registration or a Photoshop 28.x issue must be repaired in Photoshop/Creative Cloud; BrandForge cannot force a broken COM server to register.";
    }
    if (String(message).includes(SCRIPT_ERROR)) {
        return "Photoshop connected, but refused the JSX command. Verify the Photoshop Scripts feature and test File > Scripts > Browse with the included JSX test.";
    }
    return "Photoshop did not finish this task. Check for a blocking Photoshop dialog, then run Settings > Test Photoshop.";
}

function explainFailure(result, label) {
    const detail = [result && result.stdout, result && result.stderr].filter(Boolean).join("\n").trim();
    const firstLine = detail.split(/\r?\n/).find(line => line.includes(CONNECT_ERROR) || line.includes(SCRIPT_ERROR) || /VBScript compilation error/i.test(line));
    const heading = `${label || "Photoshop task"} failed (exit ${result?.code ?? "unknown"}).`;
    return `${heading}\n${connectionAdvice(firstLine || detail)}\n${firstLine || detail}`.trim();
}

/** Single cscript runner with timeout; child processes and timeouts are cleaned. */
function runVbsScript(vbsPath, { timeoutMs = 180000, spawnProcess = spawn } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawnProcess("cscript.exe", ["//nologo", vbsPath], { windowsHide: true });
        let stdout = "", stderr = "", finished = false;
        const cap = 16000;
        const finish = (error, value) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(value);
        };
        const timer = setTimeout(() => {
            try { child.kill(); } catch (_) {}
            finish(new Error(`Photoshop COM/JSX call timed out after ${Math.round(timeoutMs / 1000)} seconds. Check Photoshop for a dialog or startup problem.`));
        }, timeoutMs);
        child.stdout.on("data", chunk => { stdout = (stdout + String(chunk)).slice(-cap); });
        child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-cap); });
        child.on("error", error => finish(error));
        child.on("close", code => finish(null, { code, stdout: stdout.trim(), stderr: stderr.trim() }));
    });
}

function parseSuccessfulConnection(text) {
    const found = String(text || "").match(/BRANDFORGE_CONNECTED\|([^|\r\n]+)\|(running|created)/);
    return found ? { version: found[1].trim(), method: found[2] } : null;
}

module.exports = {
    CONNECT_ERROR, SCRIPT_ERROR, SUCCESS, vbString,
    buildComConnectVbs, buildJsxLaunchVbs, runVbsScript, explainFailure,
    connectionAdvice, parseSuccessfulConnection
};
