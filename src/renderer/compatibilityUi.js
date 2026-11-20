"use strict";

/** Settings-only Photoshop Compatibility Manager UI; main process owns all IO. */
window.initCompatibilityManager = async function initCompatibilityManager() {
    const api = window.settingsApp;
    if (!api?.getCompatibility) return;
    const byId = id => document.getElementById(id);
    const preferred = byId("compatPreferredVersion");
    const useLast = byId("compatUseLastWorkingBtn");
    const quick = byId("compatQuickBtn");
    const live = byId("compatLiveBtn");
    const open = byId("compatOpenReportBtn");
    const status = byId("compatStatus");
    const summary = byId("compatSummary");
    const moduleGrid = byId("compatModuleGrid");
    const details = byId("compatDetails");
    let lastWorking = null;

    function setBusy(busy) {
        for (const control of [preferred, useLast, quick, live, open]) control.disabled = !!busy;
    }
    function setMessage(message, kind = "") {
        status.className = "settings-status" + (kind ? " " + kind : "");
        status.textContent = message;
    }
    function addText(parent, tagName, text, cls) {
        const element = document.createElement(tagName);
        if (cls) element.className = cls;
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }
    function renderModules(modules) {
        moduleGrid.replaceChildren();
        for (const item of modules || []) {
            const card = document.createElement("div");
            card.className = "compat-module-item";
            const head = document.createElement("div");
            head.className = "compat-module-item-head";
            addText(head, "strong", item.label);
            const severity = item.status === "FAILED" || item.status === "BLOCKED" ? "fail" :
                item.status === "PREFLIGHT_PASSED" ? "pass" : "warn";
            const text = ({ FAILED: "SCRIPT FAILED", BLOCKED: "BLOCKED", PREFLIGHT_PASSED: "PREFLIGHT OK", NOT_LIVE_TESTED: "NEEDS LIVE TEST" })[item.status] || item.status;
            addText(head, "span", text, "compat-state " + severity);
            card.appendChild(head);
            addText(card, "p", item.detail || item.note || "");
            if (item.failures?.length) addText(card, "p", item.failures.join("; "));
            moduleGrid.appendChild(card);
        }
    }
    function render(data) {
        if (!data) return;
        const report = data.lastCheck || data;
        lastWorking = data.lastWorking || report.lastWorking || null;
        preferred.value = String(data.preferredMajor ?? report.preferredMajor ?? 0);
        useLast.disabled = !lastWorking || !/^(27|28)(?:\.|$)/.test(lastWorking.version || "");
        if (!report.checkedAt) return;
        summary.hidden = false;
        byId("compatRegistered").textContent = report.registration?.executable || "Not registered / Windows only";
        byId("compatInstallations").textContent = report.installations?.length ? report.installations.map(p => p.split(/[\\/]/).slice(-2, -1)[0]).join(", ") : "No standard installation found";
        byId("compatLastWorking").textContent = lastWorking ?
            `${lastWorking.version} (${lastWorking.method || "COM"}) · ${new Date(lastWorking.checkedAt).toLocaleString()}` : "Not yet verified";
        byId("compatLiveResult").textContent = report.mode === "full" ?
            (report.connection?.ok ? (report.scratch?.ok ? "Connection + PSD/JPEG/Smart Object passed" : "Scratch failed") : "Connection failed") : "Not run (quick scan only)";
        const statusText = report.overall === "PREFLIGHT_PASSED" ? "Live preflight passed; run a real job per module before production." :
            report.overall === "STATIC_CHECK_PASSED" ? "Source scan passed. Run Live Test with Photoshop open to verify the connection." :
                "Compatibility check found an error. Open the report to inspect it.";
        const staleSelection = (Number(report.preferredMajor) !== Number(preferred.value));
        setMessage(statusText + (report.note ? "\n" + report.note : "") +
            (staleSelection ? "\nVersion preference changed since this check. Run Live Test again." : ""),
            report.overall === "FAILED" ? "error" : (report.overall === "PREFLIGHT_PASSED" ? "ok" : ""));
        renderModules(report.modules || []);
        if (details) details.hidden = false;
        byId("compatDetailsText").textContent = `Last check: ${report.checkedAt}\nMode: ${report.mode}\nStatus: ${report.overall}\nConnection: ${report.connection?.error || report.connection?.method || "Not run"}\nScratch: ${report.scratch?.error || (report.scratch?.ok ? "PASS" : "Not run")}\nRegistered: ${report.registration?.server || "unknown"}`;
    }
    async function setPreference(major) {
        setBusy(true);
        try {
            const result = await api.setPhotoshopPreference(Number(major));
            preferred.value = String(result.preferredMajor);
            setMessage(result.note + " Run a Live Test before production.");
        } catch (error) {
            setMessage(error?.message || String(error), "error");
        } finally {
            setBusy(false);
            useLast.disabled = !lastWorking;
        }
    }
    preferred.addEventListener("change", () => setPreference(preferred.value));
    useLast.addEventListener("click", () => {
        if (!lastWorking) return;
        const major = Number((lastWorking.version || "").split(".")[0]);
        if (major === 27 || major === 28) setPreference(major);
    });
    async function runTest(mode) {
        setBusy(true);
        setMessage(mode === "full" ?
            "Running Windows Photoshop connection, JSX and temporary PSD/JPEG/Smart Object tests. Please avoid editing Photoshop documents during this check." :
            "Scanning Photoshop installations and BrandForge JSX scripts...");
        try {
            const result = await api.scanCompatibility(mode);
            render({ lastCheck: result, lastWorking: result.lastWorking, preferredMajor: result.preferredMajor });
        } catch (error) { setMessage(error?.message || String(error), "error"); }
        finally { setBusy(false); useLast.disabled = !lastWorking; }
    }
    quick.addEventListener("click", () => runTest("quick"));
    live.addEventListener("click", () => runTest("full"));
    open.addEventListener("click", async () => {
        try {
            const result = await api.openCompatibilityReport();
            if (!result?.ok) setMessage(result?.error || "Failed to open report.", "error");
        } catch (error) { setMessage(error?.message || String(error), "error"); }
    });
    try { render(await api.getCompatibility()); }
    catch (error) { setMessage(error?.message || String(error), "error"); }
};
