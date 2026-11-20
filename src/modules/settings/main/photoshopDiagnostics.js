"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);

const DEFAULT_CLSID_PATH = "HKCR\\Photoshop.Application\\CLSID";

function parseRegDefault(stdout) {
    const match = String(stdout || "").match(/\bREG_(?:SZ|EXPAND_SZ)\s+([^\r\n]+)/i);
    return match ? match[1].trim() : "";
}

function extractExecutable(value) {
    const match = String(value || "").trim().match(/^"([^"]+\.exe)"|^(.+?\.exe)(?:\s|$)/i);
    return match ? (match[1] || match[2]) : "";
}

async function regDefault(key, execCommand = exec) {
    try {
        const { stdout } = await execCommand("reg.exe", ["query", key, "/ve"], { windowsHide: true, timeout: 5000 });
        return parseRegDefault(stdout) || "(value missing)";
    } catch (error) {
        return `(unavailable: ${error.code || error.message || "query failed"})`;
    }
}

async function getComRegistration({ platform = process.platform, execCommand = exec } = {}) {
    if (platform !== "win32") return { clsid: "Windows only", server: "Windows only", executable: "", exists: false };
    const clsid = await regDefault(DEFAULT_CLSID_PATH, execCommand);
    const registryPath = /^\{[a-f\d-]+\}$/i.test(clsid) ? `HKCR\\CLSID\\${clsid}\\LocalServer32` : "";
    const server = registryPath ? await regDefault(registryPath, execCommand) : "(cannot read until ProgID is registered)";
    const executable = extractExecutable(server);
    return { clsid, server, executable, exists: executable ? fs.existsSync(executable) : false };
}

async function findInstallations({ platform = process.platform, env = process.env } = {}) {
    if (platform !== "win32") return [];
    const bases = [...new Set([env.ProgramFiles, env["ProgramW6432"],
        env["ProgramFiles(x86)"]].filter(Boolean))];
    const result = [];
    for (const base of bases) {
        const adobeDir = path.join(base, "Adobe");
        let names = [];
        try { names = await fs.promises.readdir(adobeDir); } catch (_) { continue; }
        for (const name of names) {
            if (!/^Adobe Photoshop(?:\s|$)/i.test(name)) continue;
            const candidate = path.join(adobeDir, name, "Photoshop.exe");
            if (fs.existsSync(candidate)) result.push(candidate);
        }
    }
    return [...new Set(result)].sort((a, b) => b.localeCompare(a));
}

function formatReport({ result, registration, installations, date = new Date(), platform = process.platform, arch = process.arch }) {
    const lines = [
        "BRANDFORGE - PHOTOSHOP 2026 / 2027 CONNECTION DIAGNOSTIC (READ ONLY)",
        "Generated: " + date.toISOString(),
        `Platform: ${platform} (${arch})`,
        "",
        "COM/JSX test result: " + (result.ok ? "PASS" : "FAIL"),
        "Photoshop version: " + (result.version || "not detected"),
        "Connection method: " + (result.method || "none"),
        "JSX invocation method: " + (result.invocationMethod || "none"),
        "Error: " + (result.error || "none"),
        "Process stdout: " + (result.stdout || "(none)"),
        "Process stderr: " + (result.stderr || "(none)"),
        "",
        "Windows registry (queried only; never changed):",
        "HKCR\\Photoshop.Application\\CLSID = " + registration.clsid,
        "LocalServer32 = " + registration.server,
        "Registered Photoshop.exe path exists = " + registration.exists,
        "",
        "Installed Photoshop.exe files under Program Files:",
        ...(installations.length ? installations.map(x => " - " + x) : [" - None found in default Adobe folders"]),
        "",
        "Next steps if COM failed:",
        "1. Open Photoshop 2027 (28.x) or Photoshop 2026 (27.x) normally, confirm sign-in/activation, then retry Test Photoshop.",
        "2. Close both Photoshop and BrandForge completely. Relaunch Photoshop first, then BrandForge.",
        "3. Compare LocalServer32 with the Photoshop.exe version you intend to use.",
        "4. If COM fails, BrandForge attempts a read-only Windows Running Object Table (ROT) attach, requiring a live Photoshop COM _Application object.",
        "5. If ROT also fails, request an Adobe Creative Cloud Photoshop repair/reinstall from IT.",
        "6. Verify that File > Scripts > Browse works with a safe JSX test.",
        "7. If 28.x COM activation fails but 27.x works, update/repair Photoshop 2027 via Creative Cloud or ask IT to investigate its COM registration.",
        "8. Do not manually edit the registry, disable UAC, or run regsvr32 on Photoshop.exe.",
        "",
        "Note: ROT can recover a registered-object lookup mismatch, but cannot create an Adobe automation object if Photoshop does not publish one."
    ];
    return lines.join("\r\n") + "\r\n";
}

module.exports = { parseRegDefault, extractExecutable, getComRegistration, findInstallations, formatReport };
