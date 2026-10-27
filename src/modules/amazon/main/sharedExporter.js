"use strict";

const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { createHash, randomUUID } = require("crypto");
const { outputName, idKey } = require("../shared/sharingPlan");

function pathKey(value) {
    return path.resolve(String(value)).replace(/\\/g, "/").toLowerCase();
}

async function lstatOrNull(filePath) {
    try { return await fs.promises.lstat(filePath); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function canonicalPath(filePath) {
    try { return pathKey(await fs.promises.realpath(filePath)); }
    catch (error) {
        if (error.code !== "ENOENT") throw error;
        return pathKey(path.join(await fs.promises.realpath(path.dirname(filePath)), path.basename(filePath)));
    }
}

async function preflightDestinations(plan, outputFolder, psdName, sourcePaths = []) {
    if (!outputFolder || !path.isAbsolute(outputFolder)) {
        return { ok: false, errors: ["Select a valid absolute Amazon output folder."], existingFiles: [] };
    }
    const errors = [...plan.errors];
    const existingFiles = [];
    const knownInputs = new Set();
    try {
        const stat = await fs.promises.stat(outputFolder);
        if (!stat.isDirectory()) throw new Error("Amazon output location is not a folder.");
        for (const sourcePath of sourcePaths) {
            if (!sourcePath) continue;
            knownInputs.add(pathKey(sourcePath));
            knownInputs.add(await canonicalPath(sourcePath));
        }
        const targets = [...plan.outputFiles, psdName];
        for (const filename of targets) {
            const target = path.join(outputFolder, filename);
            const canonical = await canonicalPath(target);
            if (knownInputs.has(pathKey(target)) || knownInputs.has(canonical)) {
                errors.push(`Output ${filename} would overwrite an original source image. Choose a different output folder.`);
                continue;
            }
            const stat = await lstatOrNull(target);
            if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
                errors.push(`Output ${filename} already exists but is not a regular file.`);
            } else if (stat) {
                existingFiles.push(filename);
            }
        }
    } catch (error) {
        errors.push(`Output preflight failed: ${error.message || String(error)}`);
    }
    return { ok: errors.length === 0, errors, ...{
        existingFiles, sourceCount: plan.sourceCount, sharedCount: plan.sharedCount,
        totalVariants: plan.totalVariants, jpgCount: plan.jpgCount
    } };
}

const DEFAULT_VERIFY_DELAYS_MS = [0, 200, 500, 1100, 2000];
const DEFAULT_COPY_ATTEMPTS = 3;
const TRANSIENT_COPY_ERRORS = new Set(["EIO", "EBUSY", "EAGAIN", "ETIMEDOUT", "ECONNRESET", "ENOTCONN", "EPIPE", "EPERM", "EACCES", "ENOENT"]);
const STREAM_FALLBACK_ERRORS = new Set(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]);

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Read actual file bytes, not fs.stat().size. Google Drive for desktop and
// network/virtual drives can temporarily report cached size metadata even
// after a fully flushed write. SHA-256 comparison also catches same-size
// corruption, which a stat-only check would miss.
async function fingerprintFile(filePath) {
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of fs.createReadStream(filePath)) {
        size += chunk.length;
        hash.update(chunk);
    }
    return { size, hash: hash.digest("hex") };
}

function matchesFingerprint(actual, expected) {
    return actual.size === expected.size && actual.hash === expected.hash;
}

function fingerprintSummary(actual, expected) {
    return `expected ${expected.size} bytes; read ${actual.size} bytes${actual.size === expected.size ? " but the content checksum differs" : ""}`;
}

async function verifyContents(target, expected, verificationDelaysMs = DEFAULT_VERIFY_DELAYS_MS) {
    let last = "output could not be read";
    const delays = verificationDelaysMs.length ? verificationDelaysMs : [0];
    for (let i = 0; i < delays.length; i++) {
        if (delays[i] > 0) await delay(delays[i]);
        try {
            const actual = await fingerprintFile(target);
            if (matchesFingerprint(actual, expected)) return { ok: true };
            last = fingerprintSummary(actual, expected);
        } catch (error) {
            last = `read failed: ${error.code || "ERROR"}: ${error.message || String(error)}`;
        }
    }
    return { ok: false, detail: last };
}

// Ordinary Windows copy, not fs.link() or cross-drive fs.rename(). If the
// provider cannot perform copyFile, stream bytes to the already-owned target.
async function copyToOwnedTarget(staged, target) {
    try {
        await fs.promises.copyFile(staged, target);
    } catch (error) {
        if (!STREAM_FALLBACK_ERRORS.has(error.code)) throw error;
        await pipeline(fs.createReadStream(staged), fs.createWriteStream(target, { flags: "w" }));
    }
}

// Publishing a file to a virtual drive is not necessarily immediately
// observable in directory metadata. Wait for the actual bytes to become
// visible; if necessary, re-copy a bounded number of times. Never count an
// output as successful based on size alone or on an unverified copyFile call.
async function copyAndVerify(staged, target, expected, retryPolicy = {}) {
    const maxCopies = Number.isInteger(retryPolicy.copyAttempts)
        ? Math.max(1, Math.min(5, retryPolicy.copyAttempts)) : DEFAULT_COPY_ATTEMPTS;
    const delays = Array.isArray(retryPolicy.verifyDelaysMs)
        ? retryPolicy.verifyDelaysMs : DEFAULT_VERIFY_DELAYS_MS;
    let lastError = "unknown write failure";
    for (let attempt = 1; attempt <= maxCopies; attempt++) {
        try {
            await copyToOwnedTarget(staged, target);
            const verified = await verifyContents(target, expected, delays);
            if (verified.ok) return;
            lastError = `verification failed (${verified.detail})`;
        } catch (error) {
            lastError = `${error.code || "ERROR"}: ${error.message || String(error)}`;
            if (!TRANSIENT_COPY_ERRORS.has(error.code) && !STREAM_FALLBACK_ERRORS.has(error.code)) {
                throw new Error(`${path.basename(target)}: copy failed: ${lastError}`);
            }
        }
        if (attempt < maxCopies) await delay(attempt * 300);
    }
    throw new Error(`${path.basename(target)}: export could not be verified after ${maxCopies} write attempts; ${lastError}. Output for this ID will be rolled back.`);
}

async function backupVerifiedFile(target, backup) {
    const original = await fingerprintFile(target);
    await fs.promises.copyFile(target, backup, fs.constants.COPYFILE_EXCL);
    const checked = await verifyContents(backup, original, [0, 100]);
    if (!checked.ok) {
        throw new Error(`${path.basename(target)}: an accurate overwrite backup could not be created (${checked.detail}). Original left unchanged.`);
    }
    return original;
}

/* Per-variant transaction, including original-file backups for approved
 * replacements. New targets are reserved with 'wx' before writing so a file
 * introduced after preflight is never silently overwritten. Failure rolls
 * back only the current variant; completed IDs remain untouched. */
async function publishGroup(pairs, options) {
    const { backupFolder, outputFolder, confirmedExistingPaths = [], retryPolicy = {} } = options;
    const confirmed = new Set(confirmedExistingPaths.map(idKey));
    const touched = [];
    await fs.promises.mkdir(backupFolder, { recursive: true });
    for (const pair of pairs) {
        const target = path.join(outputFolder, pair.name);
        const stat = await lstatOrNull(target);
        if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
            throw new Error(`${pair.name}: destination is not a regular file.`);
        }
        if (stat && !confirmed.has(idKey(pair.name))) {
            throw new Error(`${pair.name}: an existing output has not been approved for replacement.`);
        }
        const staged = await fs.promises.stat(pair.staged);
        if (!staged.isFile() || staged.size === 0) throw new Error(`${pair.name}: staged output is empty.`);
    }

    try {
        for (const pair of pairs) {
            const target = path.join(outputFolder, pair.name);
            const stat = await lstatOrNull(target);
            const expected = await fingerprintFile(pair.staged);
            if (!expected.size) throw new Error(`${pair.name}: staged output is empty.`);
            if (stat) {
                if (!stat.isFile() || stat.isSymbolicLink() || !confirmed.has(idKey(pair.name))) {
                    throw new Error(`${pair.name}: destination cannot safely be replaced.`);
                }
                const backup = path.join(backupFolder, `${randomUUID()}.bak`);
                const originalFingerprint = await backupVerifiedFile(target, backup);
                touched.push({ target, backup, originalFingerprint });
                await copyAndVerify(pair.staged, target, expected, retryPolicy);
            } else {
                // Exclusive CREATE_NEW reservation preserves the overwrite
                // protection of the original publisher. Journal immediately,
                // including any subsequent partial copy, before copying bytes.
                const file = await fs.promises.open(target, "wx");
                touched.push({ target, backup: null });
                await file.close();
                await copyAndVerify(pair.staged, target, expected, retryPolicy);
            }
        }
    } catch (error) {
        const rollbackErrors = [];
        for (const item of touched.reverse()) {
            try {
                if (item.backup) {
                    await copyAndVerify(item.backup, item.target, item.originalFingerprint, retryPolicy);
                } else {
                    await fs.promises.rm(item.target, { force: true });
                }
            } catch (rollbackError) {
                rollbackErrors.push(`${path.basename(item.target)}: ${rollbackError.message}`);
            }
        }
        if (rollbackErrors.length) {
            const failure = new Error(`${error.message}. ROLLBACK INCOMPLETE: ${rollbackErrors.join("; ")}. Backups retained at ${backupFolder}`);
            failure.retainStage = true;
            throw failure;
        }
        throw error;
    }
    return pairs.map(pair => path.join(outputFolder, pair.name));
}

async function stageSharedJpgs(sourceJpgs, sharedId, stageFolder) {
    await fs.promises.mkdir(stageFolder, { recursive: true });
    const pairs = [];
    for (let index = 0; index < sourceJpgs.length; index++) {
        const name = outputName(sharedId, index + 1);
        const staged = path.join(stageFolder, `${randomUUID()}.jpg`);
        await fs.promises.copyFile(sourceJpgs[index], staged, fs.constants.COPYFILE_EXCL);
        pairs.push({ name, staged });
    }
    return pairs;
}

module.exports = {
    preflightDestinations, publishGroup, stageSharedJpgs, canonicalPath,
    // Exported to support direct reliability tests on the byte-verification path.
    fingerprintFile, verifyContents
};
