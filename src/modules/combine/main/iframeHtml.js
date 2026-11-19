"use strict";

// HTML-only Combine: the original remote images are referenced by URL, never downloaded.
// The exported HTML uses the table geometry supplied by the user, independent of Photoshop.
const path = require("path");
const crypto = require("crypto");
const { safeUrl } = require("./rakutenImporter");
const MAX_IMAGES = 250;

function entities(text) {
    return String(text ?? "").replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([a-f0-9]+));/gi, (all, dec, hex) => {
        const named = {"&amp;":"&", "&quot;":"\"", "&apos;":"'", "&lt;":"<", "&gt;":">"};
        if (named[all.toLowerCase()]) return named[all.toLowerCase()];
        try { const n = dec ? Number(dec) : parseInt(hex,16); return n <= 0x10ffff ? String.fromCodePoint(n) : all; }
        catch (_) { return all; }
    });
}
function htmlAttr(tag, name) {
    const escaped = String(name).replace(/[^a-z0-9_-]/gi, "");
    const match = new RegExp(`(?:\\s|^)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,"i").exec(tag);
    return match ? entities(match[1] ?? match[2] ?? match[3]) : "";
}
function iframeUrl(input) {
    const value = String(input ?? "").trim();
    const frame = /<iframe\b[^>]*>/i.exec(value);
    const candidate = frame ? htmlAttr(frame[0], "src") : value;
    if (!candidate || /[<>]/.test(candidate)) throw new Error("Paste the full Rakuten iframe HTML, or its direct HTTPS iframe URL.");
    const url = safeUrl(candidate, undefined, "iframe");
    const u = new URL(url);
    if (!["www.rakuten.ne.jp", "rakuten.ne.jp"].includes(u.hostname.toLowerCase()) ||
        !/^\/gold\//i.test(u.pathname) || !/\.html?$/i.test(u.pathname)) {
        throw new Error("Input must point to a Rakuten GOLD HTML iframe page (https://www.rakuten.ne.jp/gold/...).");
    }
    return url;
}
function permittedImage(raw, base) {
    if (!raw || /^(?:data:|blob:|javascript:|#)/i.test(String(raw).trim())) return null;
    try {
        const full = safeUrl(entities(raw),base,"image");
        if (!/\.(?:jpe?g|png|webp|gif|bmp|avif|tiff?)$/i.test(new URL(full).pathname)) return null;
        return full;
    } catch (_) { return null; }
}
function stemFamily(url) {
    const u = new URL(url);
    const stem = path.posix.basename(u.pathname).replace(/\.[^.]*$/, "");
    // sec-84_13.jpg and tnr-90_02.jpg belong to their numbered image families.
    return `${u.hostname}/${path.posix.dirname(u.pathname)}/${stem.replace(/[_-]\d{1,4}$/i, "").toLowerCase()}`;
}
function imageTags(html, pageUrl) {
    const found = [], seen = new Set();
    for (const m of String(html).matchAll(/<img\b[^>]*>/gi)) {
        const tag = m[0];
        const keys = ["data-src", "data-original", "data-lazy-src", "src"];
        let src = null;
        for (const k of keys) {
            src = permittedImage(htmlAttr(tag,k),pageUrl);
            if (src) break;
        }
        if (!src) {
            const source = htmlAttr(tag,"srcset").split(",")[0]?.trim().split(/\s+/)[0];
            src = permittedImage(source,pageUrl);
        }
        if (!src || seen.has(src)) continue;
        seen.add(src);
        found.push({url:src, offset:m.index});
        if (found.length > MAX_IMAGES * 3) throw new Error("Page has too many image tags; review the iframe source.");
    }
    return found;
}
function visibleDetailsOffset(html) {
    const text = String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, m => " ".repeat(m.length))
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, m => " ".repeat(m.length))
        .replace(/<!--[\s\S]*?-->/g, m => " ".repeat(m.length));
    // Heading must be visible text inside a tag, not part of an image URL or JS data.
    const patterns = [
        /<h[1-6]\b[^>]*>\s*(?:<[^>]+>\s*)*DETAILS\s*(?:<\/[^>]+>\s*)*<\/h[1-6]>/i,
        /<(?:div|p|td|span|strong|b)\b[^>]*>\s*DETAILS\s*<\/(?:div|p|td|span|strong|b)>/i
    ];
    for (const p of patterns) { const match=p.exec(text); if (match) return match.index; }
    return -1;
}
function discoverImages(html, url) {
    const raw = imageTags(html,url);
    if (!raw.length) throw new Error("No image URLs found in the public iframe HTML.");
    const groups = new Map();
    for (const image of raw) {
        const key = stemFamily(image.url);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(image);
    }
    const ranked = [...groups.values()].sort((a,b)=>b.length-a.length);
    let list = raw;
    const warnings = [];
    // Avoid unrelated logos/ads if most images belong to one numbered family.
    // If several families are equally plausible, retain source order and request review.
    if (ranked[0]?.length >= 2 && ranked[0].length / raw.length >= 0.6) {
        list = ranked[0];
        if (list.length !== raw.length) warnings.push(`Excluded ${raw.length-list.length} unrelated image URL(s) outside the main numbered family.`);
    } else if (ranked.length > 1) {
        warnings.push("Multiple image families detected; review the exported images and order.");
    }
    if (list.length > MAX_IMAGES) throw new Error(`More than ${MAX_IMAGES} images found. Review source page before processing.`);
    // Prefer the dedicated gallery list, but never discard the heading boundary when it is present.
    // This function intentionally leaves source images unchanged.
    return {images:list, warnings, detailsOffset:visibleDetailsOffset(html), imageTagCount:raw.length};
}
function splitImages(discovery, {lineupCount=null, defaultLineupCount=3}={}) {
    const all = discovery.images;
    let count; let method;
    const warning = [...discovery.warnings];
    if (lineupCount !== "" && lineupCount != null) {
        count = Number(lineupCount); method="manual";
        if (!Number.isInteger(count) || count < 0 || count > all.length) throw new Error(`Line Up Count must be a whole number from 0 to ${all.length}.`);
    } else if (discovery.detailsOffset >= 0) {
        const derived = all.filter(x=>x.offset<discovery.detailsOffset).length;
        if (derived>0 && derived<all.length) {count=derived;method="source-details-heading";}
    }
    if (count == null) {
        count = Number(defaultLineupCount);
        if (!Number.isInteger(count) || count<0 || count>MAX_IMAGES) throw new Error("Default Line Up Count must be between 0 and 250.");
        count = Math.min(count,all.length);
        method="default-review";
        warning.push(`No reliable DETAILS boundary found; used default Line Up Count ${count}. Verify this split in Excel.`);
    }
    return { lineup:all.slice(0,count).map(x=>x.url), details:all.slice(count).map(x=>x.url),
        lineupCount:count,detailsCount:all.length-count, method,warnings:warning };
}
function escAttribute(value) {
    return String(value).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function table(items, columns, imgWidth) {
    if (!items.length) return "";
    const lines=[`<table width="780" border="0" cellpadding="3" cellspacing="0">`];
    for(let pos=0;pos<items.length;pos+=columns) {
        lines.push("  <tr>");
        for(let col=0;col<columns;col++) {
            const url=items[pos+col];
            lines.push(url ? `    <td><img src="${escAttribute(url)}" width="${imgWidth}"></td>` : "    <td></td>");
        }
        lines.push("  </tr>");
    }
    lines.push("</table>");
    return lines.join("\r\n");
}
function generateSnippet({lineup=[],details=[]}) {
    if (!lineup.length && !details.length) throw new Error("No images were extracted.");
    const sections=[];
    if (lineup.length) sections.push(table(lineup,2,380));
    if (details.length) {
        sections.push(`<table width="780" border="0">\r\n  <tr><td height="40"></td></tr>\r\n  <tr><td><h2 style="font-family:Arial,sans-serif;font-size:28px;font-weight:400;line-height:1.2;margin:0;">DETAILS</h2></td></tr>\r\n  <tr><td height="20"></td></tr>\r\n</table>`);
        sections.push(table(details,3,250));
    }
    return sections.join("\r\n");
}
function standaloneHtml(snippet) {
    return `<!doctype html>\r\n<html lang="ja">\r\n<head>\r\n<meta charset="utf-8">\r\n<meta name="viewport" content="width=device-width,initial-scale=1">\r\n<title>Combine Product Details</title>\r\n</head>\r\n<body style="margin:0;background:white;color:#222;">\r\n${snippet}\r\n</body>\r\n</html>\r\n`;
}
function outputStem(url, row) {
    const u=new URL(url);
    const base=path.posix.basename(u.pathname).replace(/\.html?$/i,"").replace(/[^a-z0-9_-]/gi,"_").slice(0,55)||"product";
    const hash=crypto.createHash("sha1").update(url).digest("hex").slice(0,7);
    return `${String(row).padStart(5,"0")}_${base}_${hash}`;
}
function decodePage(buffer,contentType="") {
    const head=buffer.subarray(0,2048).toString("latin1");
    const charset=/charset\s*=\s*['"]?([a-z0-9_-]+)/i.exec(contentType+" "+head)?.[1]||"utf-8";
    try { return new TextDecoder(charset,{fatal:false}).decode(buffer); }
    catch (_) { return new TextDecoder("utf-8").decode(buffer); }
}
module.exports={iframeUrl,discoverImages,splitImages,generateSnippet,standaloneHtml,outputStem,decodePage,imageTags,visibleDetailsOffset};
