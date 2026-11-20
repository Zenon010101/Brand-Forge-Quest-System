"use strict";

/**
 * Shared Windows Photoshop COM/ExtendScript launcher.
 * Photoshop 2026 (27.x) and 2027 (28.x) use Photoshop.Application on Windows.
 * A 2027 installation with broken COM registration still needs an Adobe fix;
 * BrandForge does not edit the registry or launch an arbitrary executable.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { getPreferredMajor } = require("./photoshopVersionPolicy");

const CONNECT_ERROR = "BRANDFORGE_COM_ERROR";
const SCRIPT_ERROR = "BRANDFORGE_JSX_ERROR";
const SUCCESS = "BRANDFORGE_CONNECTED";
const VERSION_MISMATCH = "BRANDFORGE_VERSION_MISMATCH";

function vbString(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
}

function validateVariableName(name) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error("Invalid VBScript object variable name.");
    return name;
}

/** Get a running Photoshop first, then the Windows-registered server. */
function buildComConnectVbs(variableName = "ps") {
    const name = validateVariableName(variableName);
    const expected = getPreferredMajor();
    const checkVersion = expected ? `If NOT (BFVersion = "${expected}" Or Left(BFVersion, ${String(expected).length + 1}) = "${expected}.") Then
    WScript.Echo "${VERSION_MISMATCH}|required=${expected}|actual=" & BFVersion
    WScript.Quit 55
End If
` : "";
    return `On Error Resume Next
Dim ${name}, BFConnectMethod, BFGetNumber, BFGetDescription
Dim BFCreateNumber, BFCreateDescription, BFVersion
Set ${name} = Nothing
BFConnectMethod = ""
Err.Clear
Set ${name} = GetObject(, "Photoshop.Application")
BFGetNumber = Err.Number
BFGetDescription = Err.Description
If BFGetNumber = 0 Then
    If Not (${name} Is Nothing) Then BFConnectMethod = "running"
End If
Err.Clear
If ${name} Is Nothing Then
    Set ${name} = CreateObject("Photoshop.Application")
    BFCreateNumber = Err.Number
    BFCreateDescription = Err.Description
    If BFCreateNumber = 0 Then
        If Not (${name} Is Nothing) Then BFConnectMethod = "created"
    End If
    If ${name} Is Nothing Then
        WScript.Echo "${CONNECT_ERROR}|GetObject=" & CStr(BFGetNumber) & ": " & BFGetDescription & " | CreateObject=" & CStr(BFCreateNumber) & ": " & BFCreateDescription
        WScript.Quit 52
    End If
End If
Err.Clear
BFVersion = CStr(${name}.Version)
If Err.Number <> 0 Then
    BFVersion = "unknown"
End If
Err.Clear
${checkVersion}`;
}

/**
 * Prefer DoJavaScriptFile for all versions. In some Photoshop 2027 installations
 * that COM method fails even though DoJavaScript is available. If (and only if)
 * there is no worker receipt, try DoJavaScript with $.evalFile once.
 * Do not re-execute a task that already wrote a receipt: that could publish a
 * second PSD, duplicate edits, or overwrite files.
 */
function buildJsxLaunchVbs(jsxFile, { variableName = "ps", reveal = false, receiptPath = "" } = {}) {
    const name = validateVariableName(variableName);
    const evalScript = `$.evalFile(new File(${JSON.stringify(String(jsxFile).replace(/\\/g, "/"))}));`;
    const receiptCheck = receiptPath ? `
        Err.Clear
        Set BFFileSystem = CreateObject("Scripting.FileSystemObject")
        If Err.Number = 0 Then
            BFReceiptExists = BFFileSystem.FileExists(${vbString(receiptPath)})
        End If
        Err.Clear` : "";
    const allowFallback = receiptPath ? "" : `
        BFReceiptExists = True ' No receipt path: never risk duplicate invocation`;
    return buildComConnectVbs(name) +
        (reveal ? `${name}.Visible = True\nErr.Clear\n` : "") +
        `Dim BFPrimaryError, BFPrimaryMessage, BFFallbackError, BFFallbackMessage
Dim BFReceiptExists, BFFileSystem, BFInvocationMethod
BFInvocationMethod = "DoJavaScriptFile"
Err.Clear
${name}.DoJavaScriptFile ${vbString(jsxFile)}
BFPrimaryError = Err.Number
BFPrimaryMessage = Err.Description
Err.Clear
If BFPrimaryError <> 0 Then
    BFReceiptExists = False${allowFallback}${receiptCheck}
    If Not BFReceiptExists Then
        BFInvocationMethod = "DoJavaScript-evalFile"
        Err.Clear
        ${name}.DoJavaScript ${vbString(evalScript)}
        BFFallbackError = Err.Number
        BFFallbackMessage = Err.Description
        Err.Clear
        If BFFallbackError <> 0 Then
            WScript.Echo "${SCRIPT_ERROR}|DoJavaScriptFile=" & CStr(BFPrimaryError) & ": " & BFPrimaryMessage & " | DoJavaScript=" & CStr(BFFallbackError) & ": " & BFFallbackMessage
            WScript.Quit 53
        End If
    End If
End If
WScript.Echo "${SUCCESS}|" & BFVersion & "|" & BFConnectMethod & "|" & BFInvocationMethod
WScript.Quit 0
`;
}

function connectionAdvice(message) {
    const msg = String(message || "");
    if (/VBScript compilation error|VBScript syntax error|VBScript runtime error.*Invalid character/i.test(msg)) {
        return "The Windows VBScript launcher failed before Photoshop was contacted (compilation error). Check the launcher diagnostic (not an Adobe COM failure).";
    }
    if (msg.includes(CONNECT_ERROR) || /ActiveX component can't create object|0x80080005|server execution failed|0x800401e3/i.test(msg)) {
        return "Photoshop COM could not connect. The Windows COM server rejected the registered ProgID (error 429). For Photoshop 2027 (28.x), BrandForge also attempts a non-activating Photoshop Running Object Table attach on Windows. " +
            "If that attach failed, Photoshop is not exposing a compatible scripting object to BrandForge. " +
            "Check Settings > Open Diagnostics for the registered Photoshop executable path. A Creative Cloud repair/update may be needed; Photoshop 2026 is an alternative.";
    }
    if (msg.includes(VERSION_MISMATCH)) {
        return "Connected to a different Photoshop version than the one selected in Compatibility Manager. Open the preferred version and retry. The selected preference does not change Windows COM registration.";
    }
    if (msg.includes(SCRIPT_ERROR)) {
        return "Photoshop connected, but refused the JSX command. Both script execution methods failed or the worker returned an error. " +
            "Run Settings > Test Photoshop and check that File > Scripts > Browse can run a JSX in this installation.";
    }
    return "Photoshop did not finish this task. Close blocking dialogs, run Settings > Test Photoshop, and inspect the saved diagnostic report.";
}

function explainFailure(result, label) {
    const detail = [result?.stdout, result?.stderr].filter(Boolean).join("\n").trim();
    const lines = detail.split(/\r?\n/);
    const line = lines.find(x => x.includes(CONNECT_ERROR) || x.includes(SCRIPT_ERROR) || x.includes(VERSION_MISMATCH) || /VBScript compilation error/i.test(x));
    const rot = lines.find(x => /BRANDFORGE_ROT_(?:ERROR|UNAVAILABLE)/.test(x));
    // COM may fail with 429 but the ROT fallback *can still reach* Photoshop.
    // If Photoshop then rejects JSX, report that actual error rather than
    // misleading designers that nothing connected to the application.
    if (rot && /BRANDFORGE_ROT_ERROR\|.*(?:General Photoshop error|Unterminated string|Syntax error|\bError \d+:|JavaScript execution)/i.test(rot)) {
        return `${label || "Photoshop task"} failed during Photoshop script execution.\n` +
            `The ROT fallback reached Photoshop, but Photoshop rejected the generated JSX. ` +
            `The initial COM 429 is not the final cause of this failure.\n${rot}`;
    }
    return `${label || "Photoshop task"} failed (exit ${result?.code ?? "unknown"}).\n${connectionAdvice(line || detail)}\n${line || detail}${rot ? "\nROT fallback: " + rot : ""}`.trim();
}

function runProcess(executable, args, { timeoutMs = 180000, spawnProcess = spawn, env } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawnProcess(executable, args, { windowsHide: true, ...(env ? {env} : {}) });
        let stdout = "", stderr = "", finished = false;
        const cap = 16000;
        let timer;
        const finish = (error, value) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(value);
        };
        timer = setTimeout(() => {
            try { child.kill(); } catch (_) {}
            finish(new Error(`Photoshop automation call timed out after ${Math.round(timeoutMs / 1000)} seconds. Check Photoshop for a dialog or startup problem.`));
        }, timeoutMs);
        child.stdout.on("data", chunk => { stdout = (stdout + String(chunk)).slice(-cap); });
        child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-cap); });
        child.on("error", error => finish(error));
        child.on("close", code => finish(null, { code, stdout: stdout.trim(), stderr: stderr.trim() }));
    });
}

/**
 * Non-activating, read-only fallback for the Photoshop 28.x ROT/ProgID mismatch.
 * Uses built-in Windows PowerShell + .NET COM interop. Does not bypass an
 * absent Photoshop COM object, modify the registry, or re-run a worker with
 * an existing completion receipt. Some 28.x builds expose no such object.
 */
async function runRotFallback({ jsxPath, receiptPath = "", timeoutMs = 180000, spawnProcess = spawn } = {}) {
    if (!jsxPath) throw new Error("ROT recovery requires a JSX worker path.");
    const program = fs.readFileSync(path.join(__dirname, "photoshopRot.ps1"), "utf8");
    return runProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Sta", "-Command", program], {
        timeoutMs, spawnProcess,
        env: { ...process.env, BRANDFORGE_ROT_JSX: jsxPath, BRANDFORGE_ROT_RECEIPT: receiptPath, BRANDFORGE_REQUIRED_MAJOR: String(getPreferredMajor()) }
    });
}

async function runVbsScript(vbsPath, {
    timeoutMs = 180000, spawnProcess = spawn, rotFallback = null, rotRunner = runRotFallback
} = {}) {
    const normal = await runProcess("cscript.exe", ["//nologo", vbsPath], { timeoutMs, spawnProcess });
    // 52: COM lookup failed. 55: COM reached the wrong selected version.
    // Both fail before running the JSX; a matching ROT object may recover them.
    // Never replay a JSX task that may have begun executing.
    const safeFallback = (normal.code === 52 && String(normal.stdout).includes(CONNECT_ERROR)) ||
        (normal.code === 55 && String(normal.stdout).includes(VERSION_MISMATCH));
    if (!rotFallback || !safeFallback) return normal;
    try {
        const alternate = await rotRunner({ ...rotFallback, timeoutMs, spawnProcess });
        if (alternate.code === 0 && parseSuccessfulConnection(alternate.stdout)) {
            return alternate;
        }
        return {
            code: normal.code,
            stdout: [normal.stdout, alternate.stdout].filter(Boolean).join("\n"),
            stderr: [normal.stderr, alternate.stderr].filter(Boolean).join("\n")
        };
    } catch (error) {
        return {
            code: normal.code, stdout: [normal.stdout, "BRANDFORGE_ROT_ERROR|" + (error?.message || error)].join("\n"),
            stderr: normal.stderr
        };
    }
}

function parseSuccessfulConnection(text) {
    const found = String(text || "").match(/BRANDFORGE_CONNECTED\|([^|\r\n]+)\|(running|created|rot)(?:\|([^\r\n|]+))?/);
    return found ? { version: found[1].trim(), method: found[2], ...(found[3] ? { invocationMethod: found[3] } : {}) } : null;
}

module.exports = {
    CONNECT_ERROR, SCRIPT_ERROR, SUCCESS, VERSION_MISMATCH, vbString,
    buildComConnectVbs, buildJsxLaunchVbs, runVbsScript, runRotFallback, explainFailure,
    connectionAdvice, parseSuccessfulConnection
};
