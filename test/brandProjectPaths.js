"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { discoverProject, resolveSelections, assertMarkerSafe, verifyLinkedProject } = require("../src/modules/project-location/main/projectPaths");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-project-test-"));
try {
    const root = path.join(tmp, "Propper #DOT365");
    for (const folder of ["SLIDER", "SLIDER/AMAZON", "COLORBOX", "OTHER"])
        fs.mkdirSync(path.join(root, folder), { recursive: true });
    const sliderMarker = path.join(root, "SLIDER", "Slider Template.psd");
    const amazonMarker = path.join(root, "SLIDER", "AMAZON", "Amazon Template.psd");
    const colorboxMarker = path.join(root, "COLORBOX", "Colorbox Template.psd");
    for (const p of [sliderMarker, amazonMarker, colorboxMarker, path.join(root, "OTHER", "unrelated.psd")])
        fs.writeFileSync(p, "dummy marker bytes");
    const before = [sliderMarker, amazonMarker, colorboxMarker].map(p => fs.readFileSync(p));
    const scan = discoverProject(root);
    assert.strictEqual(scan.roles.amazon.status, "ready");
    assert.strictEqual(scan.roles.slider.status, "ready");
    assert.strictEqual(scan.roles.colorbox.status, "ready");
    assert(scan.roles.amazon.folderPath.endsWith(path.join("SLIDER", "AMAZON")));
    const picked = Object.fromEntries(["slider", "amazon", "colorbox"].map(role => [role, scan.roles[role].selectedMarker]));
    const project = resolveSelections(root, picked);
    assert.deepStrictEqual(verifyLinkedProject(project), project);
    assert.doesNotThrow(() => assertMarkerSafe(project, "amazon", path.join(project.roles.amazon.folderPath, "APM100.psd")));
    assert.throws(() => assertMarkerSafe(project, "amazon", amazonMarker), /Cannot overwrite/);
    assert.throws(() => assertMarkerSafe(project, "slider", sliderMarker), /Cannot overwrite/);
    const ambiguous = path.join(root, "SLIDER", "AMAZON", "Second PSD.psd");
    fs.writeFileSync(ambiguous, "another marker");
    // A distinct explicit 'Template' marker can resolve the folder.
    assert.strictEqual(discoverProject(root).roles.amazon.selectedMarker, amazonMarker);
    fs.renameSync(amazonMarker, path.join(root, "SLIDER", "AMAZON", "Amazon Original.psd"));
    assert.strictEqual(discoverProject(root).roles.amazon.status, "ambiguous");
    assert.throws(() => resolveSelections(root, { amazon: amazonMarker }), /no longer/);
    // The same role in two folders must be explicitly resolved; do not guess
    // between root/AMAZON and root/SLIDER/AMAZON even if one says Template.
    const directAmazon = path.join(root, "AMAZON");
    fs.mkdirSync(directAmazon);
    fs.writeFileSync(path.join(directAmazon, "Additional Template.psd"), "other marker");
    assert.strictEqual(discoverProject(root).roles.amazon.status, "ambiguous");
    assert.throws(() => discoverProject(path.join(root, "not-here")), /ENOENT/);
    assert.throws(() => resolveSelections(root, {}), /No valid PSD marker/);
    for (const [i,p] of [sliderMarker, path.join(root,"SLIDER","AMAZON","Amazon Original.psd"), colorboxMarker].entries()) {
        assert.deepStrictEqual(fs.readFileSync(p), before[i]);
    }
    console.log("PASS Google Drive marker detection, ambiguous candidates, safe link validation, PSD protection, read-only source files");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
