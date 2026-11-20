"use strict";

/**
 * Global Photoshop version guard shared by every JSX launcher. A preference
 * never changes Windows COM registration or launches a specific executable.
 * It only rejects the wrong major before any production JSX is executed.
 */
let requiredMajor = 0;
const allowed = Object.freeze([0, 27, 28]);

function validatePreferredMajor(value) {
    const major = Number(value);
    if (!Number.isInteger(major) || !allowed.includes(major)) {
        throw new TypeError("Photoshop preference must be Auto, 2026 (27.x) or 2027 (28.x).");
    }
    return major;
}
function setPreferredMajor(value) { requiredMajor = validatePreferredMajor(value); return requiredMajor; }
function getPreferredMajor() { return requiredMajor; }
function versionMatches(version, major = requiredMajor) {
    if (!major) return true;
    return String(version || "").trim().match(/^(\d+)(?:\.|$)/)?.[1] === String(major);
}

module.exports = { allowed, validatePreferredMajor, setPreferredMajor, getPreferredMajor, versionMatches };
