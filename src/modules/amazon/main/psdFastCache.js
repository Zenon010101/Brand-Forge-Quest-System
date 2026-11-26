"use strict";

// Amazon PSD/PSB Main-only extraction cache. A cached PNG is the exact
// normalized no-shadow extraction, NOT a flattened PSD preview: Photoshop
// must still hide the second top-level layer on a cache miss.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const sharp = require("sharp");
const { performance } = require("perf_hooks");

const CACHE_FORMAT = "amazon-main-second-top-level-hidden-v1";
const MAX_CACHE_BYTES = 1024 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 500;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const isPsd = filePath => /\.(psd|psb)$/i.test(String(filePath || ""));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const elapsedMs = from => Math.max(0, Math.round(performance.now() - from));

function defaultRoot() {
    // Windows %LOCALAPPDATA% is a local per-user cache, not the Roaming
    // profile and not the G: project/output folder.
    if (process.platform === "win32" && process.env.LOCALAPPDATA) {
        return path.join(process.env.LOCALAPPDATA, "BrandForge", "AmazonPsdFastCache");
    }
    try {
        const electron = require("electron");
        if (electron?.app?.getPath) {
            return path.join(electron.app.getPath("userData"), "amazon-psd-fast-cache");
        }
    } catch (_error) { /* Node-only tests, fallback below */ }
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".brandforge"),
        "BrandForge", "amazon-psd-fast-cache");
}

function sourceIdentity(sourcePath, stat) {
    const resolved = path.resolve(sourcePath);
    const normalized = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    // stat ctime catches replacements where modified time/size stayed constant.
    const fingerprint = [CACHE_FORMAT, normalized, stat.size,
        stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs].join("|");
    const key = sha256(fingerprint);
    return {
        key, sourcePath: resolved, size: stat.size,
        mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
        birthtimeMs: stat.birthtimeMs,
        version: CACHE_FORMAT
    };
}

class PsdFastCache {
    constructor({ root, maxBytes = MAX_CACHE_BYTES, maxEntries = MAX_CACHE_ENTRIES } = {}) {
        this.root = root || defaultRoot();
        this.maxBytes = maxBytes;
        this.maxEntries = maxEntries;
        this.pending = new Map();
        this.hits = 0;
        this.misses = 0;
        this.extractions = 0;
        this.saved = 0;
        this.pruneChain = Promise.resolve();
        this.lastPruneAt = 0;
    }

    paths(key) {
        return {
            png: path.join(this.root, `${key}.png`),
            json: path.join(this.root, `${key}.json`)
        };
    }

    async identity(sourcePath) {
        if (!isPsd(sourcePath)) throw new Error("PSD Fast Loader only accepts PSD/PSB files.");
        const stat = await fs.promises.stat(sourcePath);
        if (!stat.isFile()) throw new Error(`Not a file: ${sourcePath}`);
        return sourceIdentity(sourcePath, stat);
    }

    async readCached(identity) {
        const { png, json } = this.paths(identity.key);
        try {
            const [meta, pngInfo] = await Promise.all([
                fs.promises.readFile(json, "utf8").then(JSON.parse),
                fs.promises.stat(png)
            ]);
            if (meta.key !== identity.key || meta.version !== CACHE_FORMAT ||
                meta.sourcePath !== identity.sourcePath || meta.size !== identity.size ||
                meta.mtimeMs !== identity.mtimeMs || meta.ctimeMs !== identity.ctimeMs ||
                meta.birthtimeMs !== identity.birthtimeMs || pngInfo.size !== meta.pngBytes ||
                !pngInfo.isFile()) return null;
            const bytes = await fs.promises.readFile(png);
            if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
            // Detect broken/truncated cached images before sending to Amazon.
            const properties = await sharp(bytes, { failOn: "error" }).metadata();
            if (properties.format !== "png" || properties.width !== meta.width ||
                properties.height !== meta.height || bytes.length !== meta.pngBytes) return null;
            return bytes;
        } catch (_error) {
            return null; // Treat missing, damaged or partially written cache as a miss.
        }
    }

    async store(identity, bytes) {
        const { png, json } = this.paths(identity.key);
        const suffix = `${process.pid}-${crypto.randomUUID()}.tmp`;
        const tmpPng = `${png}.${suffix}`;
        const tmpJson = `${json}.${suffix}`;
        try {
            await fs.promises.mkdir(this.root, { recursive: true });
            const md = await sharp(bytes).metadata();
            if (md.format !== "png" || !md.width || !md.height) {
                throw new Error("Normalized Photoshop extraction is not a PNG.");
            }
            await fs.promises.writeFile(tmpPng, bytes, { flag: "wx" });
            await fs.promises.writeFile(tmpJson, JSON.stringify({
                ...identity, pngBytes: bytes.length, width: md.width,
                height: md.height, createdAt: Date.now()
            }), { flag: "wx" });
            await fs.promises.rename(tmpPng, png);
            // JSON written last: unfinished writes are never seen as valid hits.
            await fs.promises.rename(tmpJson, json);
            this.saved++;
            return true;
        } catch (_error) {
            // Cache is an optimization: full-quality processing must continue.
            return false;
        } finally {
            await Promise.all([tmpPng, tmpJson].map(file =>
                fs.promises.rm(file, { force: true }).catch(() => {})));
        }
    }

    async load(sourcePath, { extract, normalize, onProgress } = {}) {
        const identity = await this.identity(sourcePath);
        if (typeof extract !== "function" || typeof normalize !== "function") {
            throw new Error("PSD extraction and normalization functions are required.");
        }
        const started = performance.now();
        const hit = await this.readCached(identity);
        if (hit) {
            this.hits++;
            const durationMs = elapsedMs(started);
            onProgress?.({ status: "psd-cache-hit", cache: "HIT", durationMs,
                bytes: hit.length });
            return { buffer: hit, cache: "HIT", durationMs, extractionMs: 0 };
        }
        // First caller performs Photoshop extraction. Other callers requesting
        // the exact same PSD/source revision share the result instead of queuing
        // redundant Photoshop jobs. This includes preview + Generate overlaps.
        if (this.pending.has(identity.key)) {
            const shared = await this.pending.get(identity.key);
            onProgress?.({ status: "psd-cache-shared", cache: "SHARED", durationMs: elapsedMs(started) });
            return { ...shared, cache: "SHARED", durationMs: elapsedMs(started) };
        }
        this.misses++;
        const task = (async () => {
            onProgress?.({ status: "psd-cache-miss", cache: "MISS" });
            const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "brandforge-amazon-extract-"));
            const rawPng = path.join(dir, "psd-no-shadow.png");
            try {
                onProgress?.({ status: "extracting-psd-no-shadow" });
                const extractStart = performance.now();
                await extract(sourcePath, rawPng);
                const normalized = await normalize(rawPng);
                const extractionMs = elapsedMs(extractStart);
                this.extractions++;
                if (!Buffer.isBuffer(normalized) || !normalized.length) {
                    throw new Error("Photoshop PSD extraction returned an empty PNG.");
                }
                const stored = await this.store(identity, normalized);
                const durationMs = elapsedMs(started);
                onProgress?.({ status: stored ? "psd-cache-saved" : "psd-cache-save-skipped",
                    cache: stored ? "SAVED" : "UNCACHED", durationMs, extractionMs,
                    bytes: normalized.length });
                if (stored) this.pruneSoon();
                return { buffer: normalized, cache: stored ? "MISS" : "UNCACHED",
                    durationMs, extractionMs };
            } finally {
                await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
            }
        })();
        this.pending.set(identity.key, task);
        try { return await task; }
        finally { this.pending.delete(identity.key); }
    }

    pruneSoon() {
        const now = Date.now();
        // Do not scan the cache directory after every PSD extraction.
        if (now - this.lastPruneAt < 60000 && this.saved % 10 !== 0) return;
        this.lastPruneAt = now;
        this.pruneChain = this.pruneChain.then(() => this.prune()).catch(() => {});
    }

    async prune() {
        let files;
        try { files = (await fs.promises.readdir(this.root)).filter(x => /^[a-f0-9]{64}\.png$/.test(x)); }
        catch (_error) { return; }
        const entries = [];
        for (const name of files) {
            const file = path.join(this.root, name);
            try { const st = await fs.promises.stat(file); entries.push({ name, bytes: st.size, mtimeMs: st.mtimeMs }); }
            catch (_error) { /* file removed between listing and stat */ }
        }
        entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
        let used = 0;
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            used += entry.bytes;
            if (i < this.maxEntries && used <= this.maxBytes) continue;
            const key = entry.name.replace(/\.png$/, "");
            // Do not remove a cache entry while its extraction is active.
            if (this.pending.has(key)) continue;
            const target = this.paths(key);
            await fs.promises.rm(target.png, { force: true }).catch(() => {});
            await fs.promises.rm(target.json, { force: true }).catch(() => {});
        }
    }

    async summary(sourcePaths = []) {
        const unique = [...new Set((sourcePaths || []).filter(isPsd).map(String))];
        let cached = 0, needsExtraction = 0, missing = 0;
        // Limit concurrent filesystem probes for Google Drive/network sources.
        for (let offset = 0; offset < unique.length; offset += 8) {
            await Promise.all(unique.slice(offset, offset + 8).map(async file => {
                try {
                    const identity = await this.identity(file);
                    const { png, json } = this.paths(identity.key);
                    const [meta, st] = await Promise.all([
                        fs.promises.readFile(json, "utf8").then(JSON.parse),
                        fs.promises.stat(png)
                    ]);
                    if (meta.key === identity.key && meta.version === CACHE_FORMAT &&
                        meta.sourcePath === identity.sourcePath &&
                        meta.pngBytes === st.size && st.isFile()) cached++;
                    else needsExtraction++;
                } catch (error) {
                    if (error.code === "ENOENT" && !(await fs.promises.stat(file).catch(() => null))) missing++;
                    else needsExtraction++;
                }
            }));
        }
        return { total: unique.length, cached, needsExtraction, missing,
            hits: this.hits, misses: this.misses, extractions: this.extractions,
            saved: this.saved, cacheFolder: this.root,
            maxCacheBytes: this.maxBytes };
    }

    async clear() {
        if (this.pending.size) throw new Error("Wait for PSD extraction to finish before clearing cache.");
        await this.pruneChain;
        await fs.promises.rm(this.root, { recursive: true, force: true });
        return { ok: true, cacheFolder: this.root };
    }
}

const sharedPsdFastCache = new PsdFastCache();
let logChain = Promise.resolve();
function getAmazonPerformanceLogPath() {
    return path.join(path.dirname(sharedPsdFastCache.root), "amazon-psd-performance.log");
}
function logAmazonPerformance(stage, data = {}) {
    // Buffered/background file writes do not delay Photoshop or rendering.
    const row = JSON.stringify({ date: new Date().toISOString(), stage, ...data }) + "\n";
    logChain = logChain.then(async () => {
        const file = getAmazonPerformanceLogPath();
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        // Keep the performance log bounded (2 MB + one previous rotation).
        const st = await fs.promises.stat(file).catch(() => null);
        if (st?.size > 2 * 1024 * 1024) {
            await fs.promises.rm(file + ".old", { force: true }).catch(() => {});
            await fs.promises.rename(file, file + ".old").catch(() => {});
        }
        await fs.promises.appendFile(file, row, "utf8");
    }).catch(() => {}); // Logging is optional and must never block an Amazon job.
}
module.exports = { PsdFastCache, sharedPsdFastCache, sourceIdentity, isPsd, CACHE_FORMAT,
    getAmazonPerformanceLogPath, logAmazonPerformance };
