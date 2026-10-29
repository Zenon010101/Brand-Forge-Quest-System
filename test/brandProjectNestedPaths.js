"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { discoverProject, resolveSelections, verifyLinkedProject, assertMarkerSafe } = require("../src/modules/project-location/main/projectPaths");

function folder(base, relative) {
    const target = path.join(base, ...relative.split("/"));
    fs.mkdirSync(target, { recursive: true });
    return target;
}
function marker(base, relative, filename = "Template.psd") {
    const dir = folder(base, relative);
    const file = path.join(dir, filename);
    fs.writeFileSync(file, `marker:${relative}/${filename}`);
    return file;
}
function selected(scan) {
    return Object.fromEntries(Object.entries(scan.roles).map(([role, data]) => [role, data.selectedMarker]));
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-project-nested-"));
try {
    // Real BrandForge G: hierarchy; source images can be on an unrelated D: volume.
    const root = folder(tmp, "Propper #DOT365");
    const amazon = marker(root, "SLIDER/AMAZON [single and slider]", "Propper Amazon Template.psd");
    const slider = marker(root, "SLIDER/SLIDER-IMAGES/psd", "Propper Slider Template.psd");
    const colorbox = marker(root, "COLORBOX", "Propper Colorbox Template.psd");
    const inCode = marker(root, "SLIDER/SLIDER-IMAGES/code", "not-an-output.psd");
    const legacyAmazon = marker(root, "SLIDER/AMAZON", "Legacy Amazon.psd");
    const legacySlider = marker(root, "SLIDER", "Legacy Slider.psd");
    const files = [amazon, slider, colorbox, inCode, legacyAmazon, legacySlider];
    const before = files.map(file => fs.readFileSync(file));
    const scan = discoverProject(root);
    for (const role of ["amazon", "slider", "colorbox"])
        assert.strictEqual(scan.roles[role].status, "ready", `${role} must auto-detect`);
    assert.strictEqual(scan.roles.amazon.selectedMarker, amazon);
    assert.strictEqual(scan.roles.slider.selectedMarker, slider);
    assert.strictEqual(scan.roles.colorbox.selectedMarker, colorbox);
    assert.strictEqual(scan.roles.slider.folderPath, path.dirname(slider));
    assert(!scan.roles.slider.choices.some(x => x.markerPath === inCode), "never select SLIDER-IMAGES/code as output");
    const linked = resolveSelections(root, selected(scan));
    assert.deepStrictEqual(verifyLinkedProject(linked), linked);
    assert.doesNotThrow(() => assertMarkerSafe(linked, "amazon", path.join(path.dirname(amazon), "AMZNEW.psd")));
    assert.throws(() => assertMarkerSafe(linked, "amazon", amazon), /Cannot overwrite/);
    assert.throws(() => assertMarkerSafe(linked, "slider", slider), /Cannot overwrite/);
    assert.throws(() => assertMarkerSafe(linked, "colorbox", colorbox), /Cannot overwrite/);
    // Stale links from v1.7.16 must be re-linked if specific nested markers now exist.
    const stale = { root, roles: {
        amazon: { markerPath: legacyAmazon, folderPath: path.dirname(legacyAmazon) },
        slider: { markerPath: legacySlider, folderPath: path.dirname(legacySlider) },
        colorbox: linked.roles.colorbox
    }};
    assert.throws(() => verifyLinkedProject(stale), /old layout/);
    // An explicit current-layout selection may still use a legacy location if intentionally chosen.
    const manualLegacy = resolveSelections(root, {
        amazon: legacyAmazon, slider: legacySlider, colorbox
    });
    assert.deepStrictEqual(verifyLinkedProject(manualLegacy), manualLegacy);
    // Ambiguity inside the preferred canonical directory requires a manual pick.
    fs.writeFileSync(path.join(path.dirname(slider), "Another.psd"), "second marker");
    // Exactly one 'Template' remains, so that one is still safe to choose.
    assert.strictEqual(discoverProject(root).roles.slider.selectedMarker, slider);
    fs.renameSync(slider, path.join(path.dirname(slider), "Original.psd"));
    assert.strictEqual(discoverProject(root).roles.slider.status, "ambiguous");
    // Alternative punctuation/case and nested "AMAZON/single and slider" are supported.
    const aliasRoot = folder(tmp, "Alias Project");
    const aliasAmazon = marker(aliasRoot, "slider/AMAZON (Single & Slider)", "AMZ.psd");
    const aliasSlider = marker(aliasRoot, "slider/SLIDER_IMAGES/PSD", "SLD.psb");
    const aliasColorbox = marker(aliasRoot, "COLORBOX", "CB.psd");
    const alias = discoverProject(aliasRoot);
    assert.strictEqual(alias.roles.amazon.selectedMarker, aliasAmazon);
    assert.strictEqual(alias.roles.slider.selectedMarker, aliasSlider);
    assert.strictEqual(alias.roles.colorbox.selectedMarker, aliasColorbox);
    const altRoot = folder(tmp, "Nested Amazon Project");
    const altAmazon = marker(altRoot, "SLIDER/AMAZON/single and slider", "Amazon.psd");
    assert.strictEqual(discoverProject(altRoot).roles.amazon.selectedMarker, altAmazon);
    // Every pre-existing PSD must remain byte-for-byte unchanged.
    for (const [i, f] of files.entries()) {
        if (f === slider) continue; // intentionally renamed to test ambiguity
        assert.deepStrictEqual(fs.readFileSync(f), before[i]);
    }
    console.log("PASS nested G: marker hierarchy, layout precedence, alias recognition, stale links, ambiguous markers and read-only safety");
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
