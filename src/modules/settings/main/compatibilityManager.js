"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { buildJsxLaunchVbs, runVbsScript, parseSuccessfulConnection, explainFailure } = require("../../../shared/photoshopCom");
const { writeJsxFile } = require("../../../shared/photoshopFiles");
const { withPhotoshopTask } = require("../../../shared/photoshopTaskQueue");
const { validatePreferredMajor } = require("../../../shared/photoshopVersionPolicy");
const { getComRegistration, findInstallations } = require("./photoshopDiagnostics");

const DATA_FILE = "photoshop-compatibility-settings.json";
const REPORT_FILE = "photoshop-compatibility-report.txt";
const ROOT = path.resolve(__dirname, "../../../..");
const MODULES = Object.freeze([
    { id: "removeBg", label: "Remove Background", files: ["src/modules/remove-bg/jsx/removeBackground.jsx", "src/modules/remove-bg/jsx/preview.jsx"] },
    { id: "shadow", label: "Add Shadow", files: ["src/modules/remove-bg/jsx/addShadow.jsx"] },
    { id: "slider", label: "Slider Maker", files: ["src/modules/slider/jsx/sliderEngine.jsx"], generatedWorker: true },
    { id: "amazon", label: "Amazon Generator", files: ["src/modules/amazon/main/photoshopBridge.js", "src/modules/amazon/main/psdBuilder.js"], generatedJsx: true },
    { id: "combine", label: "Combine Generator", files: ["src/modules/combine/jsx/compose.jsx", "src/modules/combine/jsx/previewPsd.jsx", "src/modules/combine/jsx/cleanupContentAware.jsx"] },
    { id: "landing", label: "Landing Page", files: ["src/modules/landing-page/jsx/buildLandingPage.jsx"] },
    { id: "lpFolder", label: "LP Folder", files: ["src/modules/lp-folder/jsx/compose.jsx", "src/modules/lp-folder/jsx/previewPhotoshop.jsx"] }
]);

function javascriptSyntax(source, filename) {
    const stripped = String(source).replace(/^\uFEFF/, "").split(/\r?\n/)
        .map(line => /^\s*#(?:target|include)\b/i.test(line) ? "" : line).join("\n");
    return new vm.Script(stripped, { filename });
}

function scanSourceModules(root = ROOT) {
    return MODULES.map(module => {
        const failures = [];
        let checked = 0;
        for (const name of module.files) {
            const source = path.join(root, name);
            try {
                javascriptSyntax(fs.readFileSync(source, "utf8"), name);
                checked++;
            } catch (error) {
                failures.push(`${name}: ${error.message}`);
            }
        }
        if (module.generatedWorker && !failures.length) {
            try {
                const { buildJobScript } = require("../../slider/main/jobBuilder");
                const { buildSliderWorkerJsx } = require("../../slider/main/photoshopBridge");
                const engine = path.join(root, "src/modules/slider/jsx/sliderEngine.jsx");
                const sampleJob = {
                    productCode: "BRANDFORGE_CHECK", creative: [], detail: [], lineupRows: [],
                    outputPsdPath: "C:\\Temp\\BRANDFORGE_CHECK.psd"
                };
                const generated = buildSliderWorkerJsx(buildJobScript(engine, sampleJob), "C:\\Temp\\status.txt");
                javascriptSyntax(generated, "slider-generated-worker.jsx");
                checked++;
            } catch (error) {
                failures.push(`Generated Slider JSX: ${error.message}`);
            }
        }
        return {
            id: module.id, label: module.label,
            sourceStatus: failures.length ? "FAILED" : (module.generatedJsx ? "PARTIAL" : "PASS"),
            checked, failures,
            note: failures.length ? "Script syntax or required source failed." :
                (module.generatedJsx ? "JavaScript builders pass; dynamic Photoshop JSX still needs a sample job." :
                    "Source JSX parses; actual Photoshop commands still need a real job test.")
        };
    });
}

/** Scratch-only Photoshop capability check. Never opens, changes, or saves the user's documents. */
function buildScratchJsx({ receipt, psd, jpeg }) {
    function photoshopPath(p) { return JSON.stringify(String(p).replace(/\\/g, "/")); }
    return `#target photoshop
var BFCompatPrevious = null, BFCompatDocument = null;
var BFCompatStep = "prepare", BFCompatDone = [], BFCompatError = "", BFCompatOldDialogs = null;
try { if (app.documents.length) BFCompatPrevious = app.activeDocument; } catch (ignorePrevious) {}
try { BFCompatOldDialogs = app.displayDialogs; app.displayDialogs = DialogModes.NO; } catch (ignoreDialogs) {}
try {
    BFCompatStep = "create_document";
    BFCompatDocument = app.documents.add(128, 128, 72, "__BrandForge_Compatibility_Scratch__", NewDocumentMode.RGB, DocumentFill.WHITE);
    BFCompatDone.push(BFCompatStep);
    BFCompatStep = "create_layer";
    var BFCompatLayer = BFCompatDocument.artLayers.add();
    BFCompatLayer.name = "BrandForge scratch layer";
    BFCompatDone.push(BFCompatStep);
    BFCompatStep = "create_text";
    var BFCompatText = BFCompatDocument.artLayers.add();
    BFCompatText.kind = LayerKind.TEXT;
    BFCompatText.textItem.contents = "BrandForge";
    BFCompatDone.push(BFCompatStep);
    BFCompatStep = "save_psd";
    var BFCompatPsdOptions = new PhotoshopSaveOptions();
    BFCompatPsdOptions.layers = true;
    BFCompatDocument.saveAs(new File(${photoshopPath(psd)}), BFCompatPsdOptions, true, Extension.LOWERCASE);
    BFCompatDone.push(BFCompatStep);
    BFCompatStep = "save_jpeg";
    var BFCompatJpgOptions = new JPEGSaveOptions();
    BFCompatJpgOptions.quality = 9;
    BFCompatDocument.saveAs(new File(${photoshopPath(jpeg)}), BFCompatJpgOptions, true, Extension.LOWERCASE);
    BFCompatDone.push(BFCompatStep);
    BFCompatStep = "place_smart_object";
    var BFCompatPlace = new ActionDescriptor();
    BFCompatPlace.putPath(charIDToTypeID("null"), new File(${photoshopPath(jpeg)}));
    BFCompatPlace.putEnumerated(charIDToTypeID("FTcs"), charIDToTypeID("QCSt"), charIDToTypeID("Qcsa"));
    executeAction(charIDToTypeID("Plc "), BFCompatPlace, DialogModes.NO);
    if (!BFCompatDocument.activeLayer) throw new Error("Smart Object placement returned no layer");
    BFCompatDone.push(BFCompatStep);
} catch (BFCompatException) {
    BFCompatError = String(BFCompatException && BFCompatException.message ? BFCompatException.message : BFCompatException);
} finally {
    try { if (BFCompatDocument) BFCompatDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreClose) {}
    try { if (BFCompatPrevious) app.activeDocument = BFCompatPrevious; } catch (ignoreRestore) {}
    try { if (BFCompatOldDialogs !== null) app.displayDialogs = BFCompatOldDialogs; } catch (ignoreRestoreDialogs) {}
    try {
        var BFCompatReceipt = new File(${photoshopPath(receipt)});
        BFCompatReceipt.encoding = "UTF8";
        if (!BFCompatReceipt.open("w")) throw new Error("Cannot write compatibility receipt");
        BFCompatReceipt.write(BFCompatError ? "ERROR|" + BFCompatStep + "|" + BFCompatError : "OK|" + BFCompatDone.join(","));
        BFCompatReceipt.close();
    } catch (ignoreReceipt) {}
}`;
}

async function liveScratchProbe({ platform = process.platform, run = runVbsScript, label = "Photoshop compatibility scratch test" } = {}) {
    if (platform !== "win32") return { ok: false, error: "Photoshop live tests require Windows.", steps: [] };
    const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-compat-scratch-"));
    const script = path.join(folder, "scratch.jsx");
    const launcher = path.join(folder, "scratch.vbs");
    const receipt = path.join(folder, "receipt.txt");
    const psd = path.join(folder, "scratch.psd");
    const jpeg = path.join(folder, "scratch.jpg");
    try {
        await writeJsxFile(script, buildScratchJsx({ receipt, psd, jpeg }));
        await fs.promises.writeFile(launcher, "\uFEFF" + buildJsxLaunchVbs(script, { receiptPath: receipt }), "utf16le");
        const reply = await withPhotoshopTask(label, () => run(launcher, { timeoutMs: 120000, rotFallback: { jsxPath: script, receiptPath: receipt } }));
        const connected = parseSuccessfulConnection(reply.stdout);
        let contents = "";
        try { contents = (await fs.promises.readFile(receipt, "utf8")).replace(/^\uFEFF/, "").trim(); } catch (_) {}
        const match = contents.match(/^OK\|([a-z_,]+)$/);
        const steps = match ? match[1].split(",") : [];
        const outputsExist = (await Promise.all([psd, jpeg].map(async file => {
            try { return (await fs.promises.stat(file)).size > 200; } catch (_) { return false; }
        }))).every(Boolean);
        if (reply.code === 0 && connected && match && outputsExist) {
            return { ok: true, steps, version: connected.version, method: connected.method, invocationMethod: connected.invocationMethod || "", error: "" };
        }
        return {
            ok: false, steps, version: connected?.version || "", method: connected?.method || "",
            error: contents.startsWith("ERROR|") ? contents.replace(/^ERROR\|/, "Failed at ") :
                (reply.code !== 0 ? explainFailure(reply, label) : "Photoshop scratch document did not create verified PSD/JPEG output or a success receipt.")
        };
    } catch (error) { return { ok: false, steps: [], error: error.message || String(error) }; }
    finally { await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {}); }
}

function executableFingerprint(executable) {
    if (!executable) return null;
    try {
        const info = fs.statSync(executable);
        return { mtimeMs: Math.round(info.mtimeMs), size: info.size };
    } catch (_) { return null; }
}
function fingerprintChanged(a, b) {
    return !!(a && b && (a.mtimeMs !== b.mtimeMs || a.size !== b.size));
}
function initialState() { return { schema: 1, preferredMajor: 0, lastCheck: null, lastWorking: null }; }
async function readState(dir) {
    try {
        const raw = JSON.parse(await fs.promises.readFile(path.join(dir, DATA_FILE), "utf8"));
        const state = initialState();
        state.preferredMajor = validatePreferredMajor(raw.preferredMajor ?? 0);
        state.lastCheck = raw.lastCheck && typeof raw.lastCheck === "object" ? raw.lastCheck : null;
        state.lastWorking = raw.lastWorking && typeof raw.lastWorking === "object" ? raw.lastWorking : null;
        return state;
    } catch (_) { return initialState(); }
}
async function writeAtomic(filename, body) {
    await fs.promises.mkdir(path.dirname(filename), { recursive: true });
    const tmp = `${filename}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
        await fs.promises.writeFile(tmp, body, "utf8");
        await fs.promises.rename(tmp, filename);
    } finally { await fs.promises.unlink(tmp).catch(() => {}); }
}
async function persistState(dir, state) { await writeAtomic(path.join(dir, DATA_FILE), JSON.stringify(state, null, 2) + "\n"); }

function readinessForModules(scans, connection, scratch, mode) {
    return scans.map(scan => {
        const status = scan.sourceStatus === "FAILED" ? "FAILED" :
            (mode !== "full" ? "NOT_LIVE_TESTED" :
                (!connection?.ok || !scratch?.ok ? "BLOCKED" : "PREFLIGHT_PASSED"));
        return { ...scan, status,
            detail: status === "PREFLIGHT_PASSED" ?
                "Connection + scratch PSD/JPEG/Smart Object passed. " + scan.note + " Run a real product test." :
                status === "NOT_LIVE_TESTED" ? "Quick source scan complete. " + scan.note + " Run Live Test, then one real product." :
                    status === "BLOCKED" ? "Photoshop connection or scratch check failed; production workflow not verified." : scan.note
        };
    });
}
function formatCompatibilityReport(report) {
    const lines = [
        "BRANDFORGE PHOTOSHOP COMPATIBILITY MANAGER - PREFLIGHT REPORT",
        "Generated: " + report.checkedAt,
        "Mode: " + report.mode,
        "Result: " + report.overall,
        "Selected preference (guard only): " + (report.preferredMajor || "Auto") + " (does not switch Photoshop installations)",
        "COM registered path: " + (report.registration?.executable || "unknown"),
        "COM path exists: " + !!report.registration?.exists,
        "Executable modified since last verified test: " + !!report.hasExecutableChanged,
        "Installations detected: " + (report.installations.length || "none"),
        ...report.installations.map(x => " - " + x),
        "Last verified working: " + (report.lastWorking?.version || "none"),
        "Connection: " + (report.connection ? (report.connection.ok ? "PASS" : "FAIL") : "NOT RUN"),
        "Version: " + (report.connection?.version || "not detected"),
        "Connection method: " + (report.connection?.method || "not tested"),
        "JSX method: " + (report.connection?.invocationMethod || "not tested"),
        "Connection error: " + (report.connection?.error || "none"),
        "Connection stdout: " + (report.connection?.stdout || "(none)"),
        "Connection stderr: " + (report.connection?.stderr || "(none)"),
        "Temporary PSD/JPEG + Smart Object scratch test: " + (report.scratch ? (report.scratch.ok ? "PASS" : "FAIL") : "NOT RUN"),
        "Scratch steps: " + (report.scratch?.steps?.join(", ") || "none"),
        "Scratch error: " + (report.scratch?.error || "none"),
        "New-version warning: " + (report.note || "none"),
        "", "MODULE PREFLIGHT STATUS (NOT A REAL OUTPUT TEST)"
    ];
    for (const item of report.modules) {
        lines.push(`- ${item.label}: ${item.status}; source=${item.sourceStatus}; checks=${item.checked}`);
        lines.push(`  ${item.detail}`);
        for (const fail of item.failures) lines.push("  ERROR: " + fail);
    }
    lines.push("", "Notes:",
        "1. A successful preflight DOES NOT confirm Select Subject results, full Slider/Amazon placement accuracy, or module-specific production outputs.",
        "2. Use one real file per module before any production batch.",
        "3. Preferred major only rejects a mismatched version. It does not edit COM registry, update, install or launch Photoshop.",
        "4. ROT fallback works only if an installed Photoshop exposes a compatible automation object.",
        "5. This scan does not run UXP and cannot automatically repair Photoshop updates.");
    return lines.join("\r\n") + "\r\n";
}

/** Dependency injection keeps this testable without Photoshop or Electron on CI. */
async function runCheck({ mode = "quick", userDataPath, root = ROOT, platform = process.platform,
    getRegistration = getComRegistration, getInstallations = findInstallations,
    connectionProbe, scratchProbe = liveScratchProbe, clock = () => new Date() } = {}) {
    if (!userDataPath || !["quick", "full"].includes(mode)) throw new Error("Invalid compatibility check request.");
    const prior = await readState(userDataPath);
    const scans = scanSourceModules(root);
    const [registration, installations] = await Promise.all([
        getRegistration({platform}), getInstallations({platform})
    ]);
    const fingerprint = executableFingerprint(registration?.executable);
    let connection = null, scratch = null;
    if (mode === "full") {
        try {
            if (typeof connectionProbe !== "function") throw new Error("Photoshop connection test is not available.");
            connection = await connectionProbe();
        } catch (error) { connection = {ok:false, error:error.message || String(error)}; }
        if (connection?.ok) {
            try { scratch = await scratchProbe({platform}); }
            catch (error) { scratch = {ok:false, steps:[], error:error.message || String(error)}; }
        }
    }
    const modules = readinessForModules(scans, connection, scratch, mode);
    const goodStatic = scans.every(row => row.sourceStatus !== "FAILED");
    const complete = goodStatic && connection?.ok && scratch?.ok;
    const overall = !goodStatic || (mode === "full" && !complete) ? "FAILED" :
        (mode === "full" ? "PREFLIGHT_PASSED" : "STATIC_CHECK_PASSED");
    const lastWorking = complete ? {
        version: String(connection.version || scratch.version || ""),
        method: String(connection.method || ""),
        registeredExecutable: String(registration?.executable || ""),
        executableFingerprint: fingerprint,
        checkedAt: clock().toISOString()
    } : prior.lastWorking;
    const hasRegistrationChanged = !!(prior.lastWorking?.registeredExecutable && registration?.executable &&
        prior.lastWorking.registeredExecutable.toLowerCase() !== registration.executable.toLowerCase());
    const hasVersionChanged = !!(prior.lastWorking?.version && connection?.version && prior.lastWorking.version !== connection.version);
    const hasExecutableChanged = fingerprintChanged(prior.lastWorking?.executableFingerprint, fingerprint);
    const report = {
        checkedAt: clock().toISOString(), mode, overall, preferredMajor: prior.preferredMajor,
        registration, installations, connection, scratch, modules, lastWorking,
        hasRegistrationChanged, hasVersionChanged, hasExecutableChanged,
        note: hasRegistrationChanged || hasVersionChanged || hasExecutableChanged ? "Photoshop changed since the last successful test. Run Live Test and verify one real output from each production module." : ""
    };
    await writeAtomic(path.join(userDataPath, REPORT_FILE), formatCompatibilityReport(report));
    prior.lastCheck = { ...report, reportPath: path.join(userDataPath, REPORT_FILE) };
    prior.lastWorking = lastWorking;
    await persistState(userDataPath, prior);
    return prior.lastCheck;
}

module.exports = {
    DATA_FILE, REPORT_FILE, MODULES, ROOT, javascriptSyntax, scanSourceModules,
    buildScratchJsx, liveScratchProbe, executableFingerprint, fingerprintChanged, readState, persistState,
    readinessForModules, formatCompatibilityReport, runCheck
};
