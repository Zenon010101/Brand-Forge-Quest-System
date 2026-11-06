"use strict";

// Rakuten slide downloader: download-only, original image bytes and website order.
// Item pages are supported when their public HTML exposes a supported slider iframe.
const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const sharp = require("sharp");

const ALLOWED_HOSTS = new Set([
    "www.rakuten.ne.jp", "rakuten.ne.jp", "image.rakuten.co.jp", "shop.r10s.jp",
    "item.rakuten.co.jp", "www.rakuten.co.jp"
]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".tif", ".tiff"]);
const MAX_IMAGES = 80;
const MAX_HTML_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

function safeUrl(raw, base, kind = "page") {
    let u;
    try { u = new URL(String(raw || "").trim(), base || undefined); }
    catch (_) { throw new Error(`Invalid ${kind} URL.`); }
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname.toLowerCase()) ||
        u.username || u.password || u.port) throw new Error(`Only public HTTPS Rakuten URLs are supported for ${kind}.`);
    u.hash = "";
    return u.href;
}
function imageUrl(raw, base) {
    if (!raw || /^(?:data:|blob:|javascript:|#)/i.test(raw.trim())) return null;
    try {
        const url = safeUrl(raw, base, "image");
        if (!IMAGE_EXTS.has(path.posix.extname(new URL(url).pathname).toLowerCase())) return null;
        return url;
    } catch (_) { return null; }
}
function attr(tag, key) {
    const re = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
    const m = re.exec(tag);
    return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}
function decodeEntities(v) {
    return String(v || "").replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([0-9a-f]+));/gi, (s, dec, hex) => {
        const common = {"&amp;":"&", "&quot;":"\"", "&apos;":"'", "&lt;":"<", "&gt;":">"};
        if (common[s.toLowerCase()]) return common[s.toLowerCase()];
        try { return String.fromCodePoint(Number(dec || parseInt(hex, 16))); } catch (_) { return s; }
    });
}
function imgList(fragment, base) {
    const out = [];
    for (const tag of fragment.match(/<img\b[^>]*>/gi) || []) {
        const candidates = ["data-src", "data-original", "data-lazy", "src"];
        let target = null;
        for (const key of candidates) {
            const candidate = imageUrl(decodeEntities(attr(tag, key)), base);
            if (candidate) { target = candidate; break; }
        }
        if (!target) {
            const srcset = decodeEntities(attr(tag, "srcset"));
            target = imageUrl((srcset.split(",")[0] || "").trim().split(/\s+/)[0], base);
        }
        if (target) out.push(target);
    }
    return out;
}
function orderedUnique(items) { return [...new Set(items)].slice(0, MAX_IMAGES); }
function imageGroupKey(url) {
    const u = new URL(url);
    const stem = path.posix.basename(u.pathname).replace(/\.[^.]+$/, "");
    return `${u.host}/${path.posix.dirname(u.pathname)}/${stem.replace(/(?:[_-]\d{1,3})$/, "").toLowerCase()}`;
}
function findSliderImages(html, base) {
    const raw = normalizeEmbeddedHtml(html);
    if (raw.length > MAX_HTML_BYTES) throw new Error("Page HTML is too large to inspect safely.");
    // Prefer the exact lightSlider gallery shown by the Rakuten example.
    const lists = [...raw.matchAll(/<ul\b[^>]*>[\s\S]*?<\/ul>/gi)];
    for (const match of lists) {
        const tag = (match[0].match(/^<ul\b[^>]*>/i) || [""])[0];
        if (/\blSPager\b/i.test(attr(tag,"class")) && /\blSGallery\b/i.test(attr(tag,"class"))) {
            const images = orderedUnique(imgList(match[0], base));
            if (images.length) return { urls: images, method: "lightslider-gallery" };
        }
    }
    for (const match of lists) {
        const tag = (match[0].match(/^<ul\b[^>]*>/i) || [""])[0];
        const value = [attr(tag,"id"), attr(tag,"class")].join(" ");
        if (/image.?gallery|light.?slider|slider|carousel|lSSlide/i.test(value)) {
            const images = orderedUnique(imgList(match[0], base));
            if (images.length >= 2) return { urls: images, method: "slider-list" };
        }
    }
    // Raw Rakuten GOLD HTML sometimes declares slides as img tags or in JS.
    // Select a shared numbered image family; never pull all product-page art.
    const candidates = imgList(raw, base);
    const literal = raw.match(/https:\/\/(?:image\.rakuten\.co\.jp|shop\.r10s\.jp|www\.rakuten\.ne\.jp)\/[^\s"'<>\\]+?\.(?:jpe?g|png|webp|gif)(?:\?[^\s"'<>\\]*)?/gi) || [];
    for (const token of literal) {
        const parsed = imageUrl(decodeEntities(token), base);
        if (parsed) candidates.push(parsed);
    }
    const groups = new Map();
    for (const url of orderedUnique(candidates)) {
        const key = imageGroupKey(url);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(url);
    }
    const best = [...groups.values()].sort((a,b)=>b.length-a.length)[0] || [];
    return { urls: best.length >= 2 ? best : [], method: best.length >= 2 ? "numbered-image-family" : "none" };
}
// Rakuten item pages frequently store their GOLD iframe markup as escaped
// description text or as JS string data rather than a literal <iframe> node.
// Normalize only inert text. Never evaluate scripts or load non-Rakuten URLs.
function normalizeEmbeddedHtml(source) {
    let text = String(source || "");
    for (let pass = 0; pass < 3; pass++) {
        const next = decodeEntities(text)
            .replace(/\\u003[cC]|\\x3[cC]|%3[cC]/g, "<")
            .replace(/\\u003[eE]|\\x3[eE]|%3[eE]/g, ">")
            .replace(/\\u0022|\\x22|%22/gi, '"')
            .replace(/\\u0027|\\x27|%27/gi, "'")
            .replace(/\\(["'])/g, "$1")
            .replace(/\\u002[fF]|\\x2[fF]|%2[fF]/g, "/")
            .replace(/\\u003[aA]|\\x3[aA]|%3[aA]/g, ":")
            .replace(/\\\//g, "/");
        if (next === text) break;
        text = next;
    }
    return text;
}
function isGoldHtmlUrl(url) {
    const u = new URL(url);
    return ["www.rakuten.ne.jp", "rakuten.ne.jp"].includes(u.hostname.toLowerCase()) &&
        /^\/gold\//i.test(u.pathname) && /\.html?$/i.test(u.pathname);
}
function iframeUrls(html, page) {
    const out = [];
    for (const tag of normalizeEmbeddedHtml(html).match(/<iframe\b[^>]*>/gi) || []) {
        for (const key of ["src", "data-src", "data-original", "data-lazy-src"]) {
            const raw = decodeEntities(attr(tag, key));
            if (!raw) continue;
            try {
                const url = safeUrl(raw, page);
                if (isGoldHtmlUrl(url)) { out.push(url); break; }
            } catch (_) { /* no external or unsafe iframe URLs */ }
        }
    }
    return orderedUnique(out);
}
function goldHtmlUrls(html, page) {
    const normalized = normalizeEmbeddedHtml(html);
    const values = iframeUrls(normalized, page);
    // Also discover URLs embedded in JSON, document.write, and product descriptions
    // that don't contain literal iframe tags. Only GOLD HTML pages are candidates.
    const re = /(?:https?:)?\/\/(?:www\.)?rakuten\.ne\.jp\/gold\/[^\s"'<>\\]+?\.html?(?:\?[^\s"'<>\\]*)?/gi;
    for (const match of normalized.match(re) || []) {
        try {
            const url = safeUrl(match.startsWith("//") ? `https:${match}` : match, page);
            if (isGoldHtmlUrl(url)) values.push(url);
        } catch (_) { /* ignore unsafe or invalid URL */ }
    }
    return orderedUnique(values);
}
function sameItem(slider, itemId) {
    if (!itemId) return false;
    const needle = itemId.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (needle.length < 3) return false;
    return [slider.sliderPage, ...(slider.urls || [])].some(url =>
        new URL(url).pathname.toLowerCase().replace(/[^a-z0-9]/g, "").includes(needle));
}
function prioritizeGoldUrls(urls, itemPage) {
    const u = new URL(itemPage);
    const itemId = u.pathname.split("/").filter(Boolean).pop() || "";
    const shop = (u.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
    return urls.map((url, index) => {
        const p = new URL(url).pathname.toLowerCase();
        let score = 0;
        const normalized = p.replace(/[^a-z0-9]/g, "");
        const token = itemId.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (token.length >= 3 && normalized.includes(token)) score += 100;
        if (/\/(?:six|slider|slide|gallery|product)\//.test(p)) score += 20;
        if (shop && p.startsWith(`/gold/${shop}/`)) score += 10;
        if (/\/banner|\/header|\/footer|\/campaign|\/ranking/.test(p)) score -= 30;
        return { url, index, score };
    }).sort((a,b) => b.score-a.score || a.index-b.index).map(entry => entry.url);
}

function getUrlBuffer(sourceUrl, { maxBytes = MAX_HTML_BYTES, redirectCount = 0, timeoutMs = 16000 } = {}) {
    const target = safeUrl(sourceUrl);
    if (redirectCount > 4) return Promise.reject(new Error("Too many redirects."));
    return new Promise((resolve, reject) => {
        const req = https.get(target, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36", "Accept": "text/html,image/avif,image/webp,image/*,*/*;q=0.8", "Accept-Encoding": "gzip, deflate, br" },
            timeout: timeoutMs
        }, response => {
            const code = response.statusCode || 0;
            if (code >= 300 && code < 400 && response.headers.location) {
                const location = response.headers.location;
                response.resume();
                let next;
                try { next = safeUrl(location, target); }
                catch (error) { reject(error); return; }
                getUrlBuffer(next, { maxBytes, redirectCount: redirectCount + 1, timeoutMs }).then(resolve,reject); return;
            }
            if (code !== 200) { response.resume(); reject(new Error(`Rakuten returned HTTP ${code} for ${new URL(target).pathname}.`)); return; }
            const parts = []; let size = 0;
            response.on("data", part => { size += part.length; if (size > maxBytes) req.destroy(new Error("Downloaded response exceeds size limit.")); else parts.push(part); });
            response.on("error", reject);
            response.on("end", () => {
                try {
                    let value = Buffer.concat(parts);
                    const encoding = String(response.headers["content-encoding"] || "").toLowerCase();
                    if (encoding === "gzip") value = zlib.gunzipSync(value);
                    else if (encoding === "deflate") value = zlib.inflateSync(value);
                    else if (encoding === "br") value = zlib.brotliDecompressSync(value);
                    if (value.length > maxBytes) throw new Error("Decompressed response exceeds size limit.");
                    resolve({ buffer: value, contentType: String(response.headers["content-type"] || "") });
                } catch (error) { reject(error); }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("Rakuten request timed out.")));
    });
}
function safeStem(v) {
    return String(v || "").normalize("NFKC").replace(/[^\w.-]+/g,"_").replace(/^\.+|\.+$/g, "").slice(0,80) || "Rakuten_Slider";
}
function displayName(url) {
    const file = new URL(url).pathname.split("/").pop() || "slide.jpg";
    let decoded; try { decoded = decodeURIComponent(file); } catch (_) { decoded = file; }
    return safeStem(decoded.replace(/\.[^.]+$/, "")) + path.posix.extname(file).toLowerCase();
}
async function newFolder(parent, stem) {
    const base = path.join(parent, safeStem(stem));
    for (let i=0; i < 1000; i++) {
        const candidate = i ? `${base}_v${i+1}` : base;
        try { await fs.promises.mkdir(candidate); return candidate; }
        catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    throw new Error("Too many existing import folders.");
}
class RakutenImporter {
    constructor({ fetcher = getUrlBuffer } = {}) {
        this.fetcher = fetcher; this.scanned = null; this.downloaded = null;
    }
    async scan(pageUrl, pastedHtml) {
        const original = safeUrl(pageUrl);
        const isItemPage = new URL(original).hostname.toLowerCase() === "item.rakuten.co.jp";
        let html = String(pastedHtml || "").trim();
        if (!html) {
            let response;
            try { response = await this.fetcher(original, { maxBytes: MAX_HTML_BYTES }); }
            catch (error) {
                const guidance = isItemPage ? " Try pasting the direct Rakuten GOLD slider iframe URL from the item's page instead." : "";
                throw new Error(`Could not read the Rakuten page: ${error.message}.${guidance}`);
            }
            if (!/text\/html|text\/plain|application\/xhtml|^$/i.test(response.contentType)) {
                throw new Error("This URL did not return an HTML page.");
            }
            html = response.buffer.toString("utf8");
        }
        // Prefer dedicated GOLD sliders to the unrelated product galleries,
        // advertising carousels, and recommendation lists on item pages.
        let detected = isItemPage ? { urls:[], method:"none" } : findSliderImages(html, original);
        let sliderPage = original;
        const failures = [];
        const matches = [];
        const rootCandidates = prioritizeGoldUrls(goldHtmlUrls(html, original), original);
        const queue = rootCandidates.slice(0, 12).map(url => ({ url, depth:1 }));
        const visited = new Set();
        const itemId = new URL(original).pathname.split("/").filter(Boolean).pop() || "";
        const MAX_CANDIDATES = 12;
        if (!detected.urls.length) {
            while (queue.length && visited.size < MAX_CANDIDATES) {
                const { url:frame, depth } = queue.shift();
                if (visited.has(frame)) continue;
                visited.add(frame);
                try {
                    const response = await this.fetcher(frame, { maxBytes: MAX_HTML_BYTES, timeoutMs:10000 });
                    if (!/text\/html|text\/plain|application\/xhtml|^$/i.test(response.contentType)) continue;
                    const frameHtml = response.buffer.toString("utf8");
                    const result = findSliderImages(frameHtml, frame);
                    if (result.urls.length) {
                        matches.push({ ...result, sliderPage:frame, matchesItem:sameItem({ sliderPage:frame, urls:result.urls }, itemId) });
                        if (!isItemPage || matches[matches.length - 1].matchesItem) break;
                    }
                    // Some Rakuten stores use a GOLD wrapper iframe that
                    // loads the actual gallery from another GOLD HTML page.
                    if (depth < 2) {
                        for (const child of prioritizeGoldUrls(goldHtmlUrls(frameHtml, frame), original)) {
                            if (child !== frame && !visited.has(child) && !queue.some(q => q.url === child)) {
                                queue.push({url:child, depth:depth+1});
                            }
                        }
                    }
                } catch (error) { failures.push(`${new URL(frame).pathname}: ${error.message}`); }
            }
            if (matches.length) {
                const matching = matches.filter(x => x.matchesItem);
                // If several different GOLD sliders were found but none can be
                // tied to the item, do not silently download a random one.
                if (matching.length || matches.length === 1) {
                    const result = matching[0] || matches[0];
                    detected = { urls:result.urls, method:result.method };
                    sliderPage = result.sliderPage;
                }
            }
        }
        if (isItemPage && !detected.urls.length) {
            // Only accept a strong in-page slider gallery, never ordinary
            // numbered item photographs found elsewhere in the product page.
            const direct = findSliderImages(html, original);
            if (["lightslider-gallery", "slider-list"].includes(direct.method)) detected = direct;
        }
        if (!detected.urls.length) {
            this.scanned = null;
            this.downloaded = null;
            const detail = !rootCandidates.length ? "No Rakuten GOLD iframe URL was exposed in the downloaded item HTML." :
                matches.length > 1 ? "Multiple unrelated GOLD sliders were found, so none was chosen automatically." :
                `${visited.size} GOLD page(s) checked, but no matching slider gallery was identified.`;
            const failed = failures.length ? ` First failed iframe: ${failures[0]}.` : "";
            throw new Error(`No slider images found. ${detail}${failed} The product page may load its iframe in the browser or restrict automated requests. Paste the direct slider iframe URL, or its HTML in Advanced, instead.`);
        }
        const images = detected.urls.map((url, i) => ({ index:i+1, url, name:displayName(url) }));
        this.scanned = { sourcePage:original, sliderPage, method:detected.method, images };
        this.downloaded = null;
        return this.scanned;
    }

    async download(parentFolder, progress=()=>{}, { autoClean = false, autoCleaner = null } = {}) {
        if (autoClean && typeof autoCleaner !== "function") throw new Error("An automatic text-cleanup processor is required.");
        if (!this.scanned) throw new Error("Scan the Rakuten iframe first.");
        const root = await fs.promises.realpath(parentFolder);
        if (!(await fs.promises.stat(root)).isDirectory()) throw new Error("Choose an existing download folder.");
        const name = path.posix.basename(new URL(this.scanned.sliderPage).pathname).replace(/\.html?$/i, "");
        const batchFolder = await newFolder(root, name);
        // All slides live directly in the product folder: no category or extra subfolders.
        const records = [];
        for (const item of this.scanned.images) {
            const destination = path.join(batchFolder, `${String(item.index).padStart(3,"0")}_${item.name}`);
            try {
                const res = await this.fetcher(item.url, {maxBytes:MAX_IMAGE_BYTES});
                if (res.buffer.length < 24 || res.buffer.length > MAX_IMAGE_BYTES) throw new Error("Empty or oversized image.");
                const metadata = await sharp(res.buffer, {failOn:"error",animated:false,limitInputPixels:400000000}).metadata();
                if (!metadata.width || !metadata.height) throw new Error("Not a readable image.");
                const temporary = `${destination}.partial`;
                try { await fs.promises.writeFile(temporary, res.buffer, {flag:"wx"}); await fs.promises.rename(temporary,destination); }
                finally { await fs.promises.rm(temporary,{force:true}).catch(()=>{}); }
                // Download succeeds independently of OCR or text cleanup.
                // A cleanup failure must never discard/recompress the original.
                const record={ ...item, path:destination, width:metadata.width, height:metadata.height,
                    bytes:res.buffer.length, status:"downloaded" };
                if (autoClean) {
                    progress({done:records.length,total:this.scanned.images.length,name:item.name,status:"cleaning"});
                    try {
                        const cleaned=await autoCleaner(destination,item);
                        record.cleanup=cleaned || {status:"needs-review",warning:"No cleanup result returned."};
                    } catch (error) {
                        record.cleanup={status:"needs-review",removedCount:0,warning:`Cleanup error: ${error.message}`};
                    }
                }
                records.push(record);
                progress({done:records.length, total:this.scanned.images.length, name:item.name,
                    status:autoClean ? (record.cleanup.status || "needs-review") : "downloaded"});
            } catch (error) {
                records.push({...item, path:null, status:"failed", error:error.message });
                progress({done:records.length,total:this.scanned.images.length,name:item.name,status:"failed",error:error.message});
            }
        }
        const manifest = { sourcePage:this.scanned.sourcePage, sliderPage:this.scanned.sliderPage,
            detectedUsing:this.scanned.method, downloadedAt:new Date().toISOString(),
            outputMode:autoClean ? "download-with-optional-caption-cleanup" : "download-only", imageOrder:"website",
            originalsPreserved:true, autoCleanupEnabled:Boolean(autoClean), images:records };
        await fs.promises.writeFile(path.join(batchFolder,"slider_manifest.json"),JSON.stringify(manifest,null,2));
        this.downloaded = {folder:batchFolder, images:records, sourcePage:this.scanned.sourcePage, autoCleanupEnabled:Boolean(autoClean)};
        return this.downloaded;
    }

}
module.exports={RakutenImporter,findSliderImages,iframeUrls,goldHtmlUrls,normalizeEmbeddedHtml,safeUrl,displayName,getUrlBuffer};
