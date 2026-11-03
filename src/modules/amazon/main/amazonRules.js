const sharp = require("sharp");

const CANVAS_SIZE = 1001;
const MAIN_AREA = {
    x: 100,
    y: 100,
    width: 801,
    height: 801
};

const REST_AREA = {
    x: 40,
    y: 40,
    width: 921,
    height: 921
};

async function getRawInfo(buffer) {
    return sharp(buffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
}

// The opaque-image classifier is deliberately shared by trimming, cut-side
// detection and cut-corner anchoring. In older builds each step used a
// different definition of visible pixels: trimming/detection averaged all
// four corners, while anchoring treated every JPEG pixel (including its white
// background) as product. On cropped white-background product photographs
// that creates false cut sides and leaves visibly white cut corners.
function createContentClassifier(data, info) {
    const { width, height, channels } = info;
    const alphaIndex = channels - 1;
    // A single antialiased/partly transparent pixel does not make an opaque
    // product photograph a transparent cutout. Count meaningful alpha area.
    let lowAlphaPixels = 0;
    let semiAlphaPixels = 0;
    for (let i = alphaIndex; i < data.length; i += channels) {
        if (data[i] <= 64) lowAlphaPixels++;
        if (data[i] < 225) semiAlphaPixels++;
    }
    const totalPixels = width * height;
    const hasTransparency = lowAlphaPixels >= Math.max(4, Math.ceil(totalPixels * 0.0005)) ||
        semiAlphaPixels >= Math.max(8, Math.ceil(totalPixels * 0.01));

    // Creative/photo assets often use beige, grey or split-tone backgrounds.
    // Such areas are NOT disposable white padding. The old corner-average
    // heuristic could falsely label those backgrounds as content, trim away
    // half a composition, and then zoom what remained to the canvas edge.
    // Only transparent or confidently white-background product photography
    // may be measured by a tight product rectangle.
    const preserveFullFrame = !hasTransparency && isDesignedPhotoFrame(data, info);

    let background = null;
    if (!hasTransparency && !preserveFullFrame) {
        // Sample the whole perimeter rather than averaging four corners.
        // Product pixels often cover one or more corners of a *cut* image.
        // Using them as the background turns the real white background into
        // "content", so the image wrongly becomes an all-sides cut.
        const bins = new Map();
        let brightCount = 0;
        let brightR = 0;
        let brightG = 0;
        let brightB = 0;
        let brightCorner = false;
        let count = 0;
        const sample = (x, y) => {
            const i = (y * width + x) * channels;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            let bin = bins.get(key);
            if (!bin) {
                bin = { count: 0, r: 0, g: 0, b: 0 };
                bins.set(key, bin);
            }
            bin.count++;
            bin.r += r;
            bin.g += g;
            bin.b += b;
            count++;
            if (r >= 235 && g >= 235 && b >= 235) {
                brightCount++;
                brightR += r;
                brightG += g;
                brightB += b;
                if ((x === 0 || x === width - 1) &&
                    (y === 0 || y === height - 1)) brightCorner = true;
            }
        };
        for (let x = 0; x < width; x++) {
            sample(x, 0);
            if (height > 1) sample(x, height - 1);
        }
        for (let y = 1; y < height - 1; y++) {
            sample(0, y);
            if (width > 1) sample(width - 1, y);
        }

        let dominant = null;
        for (const bin of bins.values()) {
            if (!dominant || bin.count > dominant.count) dominant = bin;
        }

        // E-commerce sources are often on white / near-white backgrounds.
        // A dark product can dominate the perimeter when cut on 2–3 sides;
        // don't mistake the product for the background in that case.
        if (brightCount >= Math.max(4, Math.ceil(count * 0.16)) ||
            (brightCorner && brightCount >= Math.max(4, Math.ceil(count * 0.025)))) {
            background = {
                r: brightR / brightCount,
                g: brightG / brightCount,
                b: brightB / brightCount
            };
        } else if (dominant && dominant.count >= Math.max(4, Math.ceil(count * 0.20))) {
            background = {
                r: dominant.r / dominant.count,
                g: dominant.g / dominant.count,
                b: dominant.b / dominant.count
            };
        }
        // No stable perimeter background generally means a full-bleed photo.
        // Those must cover the whole Amazon canvas, not sit in the safe area.
    }

    function isContent(x, y) {
        const i = (y * width + x) * channels;
        if (hasTransparency) return data[i + alphaIndex] > 20;
        if (preserveFullFrame || !background) return true;
        const dr = data[i] - background.r;
        const dg = data[i + 1] - background.g;
        const db = data[i + 2] - background.b;
        return dr * dr + dg * dg + db * db > 30 * 30;
    }
    return { isContent, hasTransparency, background, preserveFullFrame };
}

// Conservative full-photo detection. Sample small patches at the corners,
// not a single potentially antialiased pixel. Two matching non-white, light
// background corners (e.g. a beige photo panel beside white copy space)
// indicate an intentional composition that must never be background-trimmed.
// White cutout photos with a dark item against white remain on the existing
// product-bounds path. This is only an image-frame safeguard; it never changes
// color, scale or resolution of the source.
function isDesignedPhotoFrame(data, info) {
    const { width, height, channels } = info;
    const points = [
        [0.025, 0.025], [0.975, 0.025],
        [0.025, 0.975], [0.975, 0.975]
    ];
    function cornerColor(cx, cy) {
        const xs = [-0.012, 0, 0.012];
        const ys = [-0.012, 0, 0.012];
        const rgb = [0, 0, 0];
        let count = 0;
        for (const dy of ys) for (const dx of xs) {
            const x = Math.max(0, Math.min(width - 1, Math.round((cx + dx) * (width - 1))));
            const y = Math.max(0, Math.min(height - 1, Math.round((cy + dy) * (height - 1))));
            const i = (y * width + x) * channels;
            for (let c = 0; c < 3; c++) rgb[c] += data[i + c];
            count++;
        }
        return rgb.map(value => value / count);
    }
    const corners = points.map(([x, y]) => cornerColor(x, y));
    const neutralWhite = color => Math.min(...color) >= 243 &&
        Math.max(...color) - Math.min(...color) <= 14;
    const whiteCorners = corners.filter(neutralWhite).length;
    const tone = color => (color[0] + color[1] + color[2]) / 3;

    // Every corner belongs to non-white image content: preserve the frame.
    if (whiteCorners === 0) return true;

    // A continuous light, non-white backdrop on two corners is generally a
    // photo or split-layout panel, not an isolated dark product on pure white.
    const coloredLight = corners.filter(color => !neutralWhite(color) &&
        tone(color) >= 158 && tone(color) <= 243);
    for (let a = 0; a < coloredLight.length; a++) {
        for (let b = a + 1; b < coloredLight.length; b++) {
            const diff = Math.max(...coloredLight[a].map((v, c) => Math.abs(v - coloredLight[b][c])));
            if (diff <= 38) return true;
        }
    }
    return false;
}

async function isCreativeFrame(buffer) {
    // Cheap diagnostic thumbnail, never used for export or resizing.
    const { data, info } = await sharp(buffer)
        .resize({ width: 112, height: 112, fit: "fill" })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { channels, width, height } = info;
    let translucent = 0;
    for (let i = channels - 1; i < data.length; i += channels) {
        if (data[i] < 225) translucent++;
    }
    if (translucent >= Math.max(4, Math.ceil(width * height * 0.0005))) return false;
    return isDesignedPhotoFrame(data, info);
}

async function getContentBounds(buffer) {
    const { data, info } = await getRawInfo(buffer);
    const { width, height } = info;
    const { isContent } = createContentClassifier(data, info);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!isContent(x, y)) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }

    if (maxX === -1) {
        return { left: 0, top: 0, width, height, empty: true };
    }
    return {
        left: minX,
        top: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        empty: false
    };
}

async function trimToContent(buffer) {
    const bounds = await getContentBounds(buffer);

    if (bounds.empty) {
        return {
            buffer,
            bounds: {
                left: 0,
                top: 0,
                width: (await sharp(buffer).metadata()).width || 1,
                height: (await sharp(buffer).metadata()).height || 1
            }
        };
    }

    const trimmed = await sharp(buffer)
        .extract({
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height
        })
        .png()
        .toBuffer();

    return {
        buffer: trimmed,
        bounds
    };
}

async function detectCutSides(buffer) {
    const { data, info } = await getRawInfo(buffer);
    const { width, height } = info;
    const { isContent } = createContentClassifier(data, info);

    const strip = Math.max(2, Math.min(8, Math.round(Math.min(width, height) * 0.005)));
    // Account for a small transparent fringe from PSD extraction / antialiasing.
    // Never use a broad tolerance: a normally centered product must continue
    // to use the 801 / 921 px safe-area placement.
    const nearby = Math.max(strip, Math.min(12, Math.round(Math.min(width, height) * 0.012)));

    function countEdge(side, thickness) {
        let count = 0;
        if (side === "left" || side === "right") {
            for (let y = 0; y < height; y++) {
                for (let s = 0; s < Math.min(thickness, width); s++) {
                    const x = side === "left" ? s : width - 1 - s;
                    if (isContent(x, y)) count++;
                }
            }
        } else {
            for (let x = 0; x < width; x++) {
                for (let s = 0; s < Math.min(thickness, height); s++) {
                    const y = side === "top" ? s : height - 1 - s;
                    if (isContent(x, y)) count++;
                }
            }
        }
        return count;
    }

    function edgeHasContent(side) {
        const length = side === "left" || side === "right" ? height : width;
        const strict = countEdge(side, strip);
        if (strict >= Math.max(4, Math.ceil(length * strip * 0.0015))) return true;
        if (nearby <= strip) return false;
        // Near-edge pixels count only when there is meaningful continuous
        // product coverage. This avoids treating a tiny corner speck as a cut.
        const nearCount = countEdge(side, nearby);
        return nearCount >= Math.max(12, Math.ceil(length * nearby * 0.05));
    }

    return {
        left: edgeHasContent("left"),
        right: edgeHasContent("right"),
        top: edgeHasContent("top"),
        bottom: edgeHasContent("bottom")
    };
}


// Trimming is for MEASURING the visible source. Never create a permanent
// 1001px crop of a Smart Object that intentionally extends past the canvas.
async function trimFirstImage(buffer) {
    try {
        return (await trimToContent(buffer)).buffer;
    } catch (error) {
        return buffer;
    }
}

// Cut edges enlarge uniformly. A four-sided cut MUST cover the full
// 1001 x 1001 viewport, even when the source is a tall portrait. The
// complete resized image is kept for the embedded Photoshop Smart Object;
// top/bottom or left/right overflow is clipped ONLY in the JPG viewport.
// Image 1 still follows the original centered 801 x 801 Amazon rule.
const CUT_ENLARGEMENT = 1.04;

function getCutFlags(detectedCut) {
    return {
        left: !!detectedCut?.left,
        right: !!detectedCut?.right,
        top: !!detectedCut?.top,
        bottom: !!detectedCut?.bottom
    };
}

function placeScaledImage(width, height, outputPosition, cut) {
    const target = outputPosition === 1 ? MAIN_AREA : REST_AREA;
    const horizontalPair = cut.left && cut.right;
    const verticalPair = cut.top && cut.bottom;

    // Only an axis with cut edges moves towards the edge. The other axis
    // stays centered on the 1001px canvas (or safe area for normal images).
    let left = Math.round(target.x + (target.width - width) / 2);
    let top = Math.round(target.y + (target.height - height) / 2);
    // The original Amazon first-image rule has always been a centered
    // 801px product inside the 1001px canvas, even for cut images.
    if (outputPosition === 1) return {
        left, top, width, height,
        overflow: left < 0 || top < 0 || left + width > CANVAS_SIZE || top + height > CANVAS_SIZE
    };
    if (horizontalPair) left = Math.round((CANVAS_SIZE - width) / 2);
    else if (cut.left) left = 0;
    else if (cut.right) left = CANVAS_SIZE - width;

    if (verticalPair) top = Math.round((CANVAS_SIZE - height) / 2);
    else if (cut.top) top = 0;
    else if (cut.bottom) top = CANVAS_SIZE - height;

    return { left, top, width, height, overflow:
        left < 0 || top < 0 || left + width > CANVAS_SIZE || top + height > CANVAS_SIZE };
}

function calculateAmazonPlacement(sourceWidth, sourceHeight, outputPosition, detectedCut) {
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
        sourceWidth <= 0 || sourceHeight <= 0) {
        throw new Error("Invalid source image dimensions.");
    }
    if (!Number.isInteger(outputPosition) || outputPosition < 1 || outputPosition > 8) {
        throw new Error("Amazon output position must be between 1 and 8.");
    }

    const cut = getCutFlags(detectedCut);
    const numberOfCutSides = Object.values(cut).filter(Boolean).length;
    const target = outputPosition === 1 ? MAIN_AREA : REST_AREA;
    const baseScale = Math.min(target.width / sourceWidth, target.height / sourceHeight);
    const fullContain = Math.min(CANVAS_SIZE / sourceWidth, CANVAS_SIZE / sourceHeight);
    let scale = baseScale;

    if (outputPosition === 1) {
        // The original Image 1 rule: centered inside the 801 x 801 safe area.
        scale = baseScale;
    } else if (numberOfCutSides === 4) {
        // Restore the original four-edge COVER rule from amazonRules(3).js.
        // No portrait/panorama aspect-ratio cap. Cover the full canvas, zoom
        // a further 4%, and center the ENTIRE SOURCE FRAME. Portrait overflow
        // above and below the viewport is intentional and non-destructive.
        scale = Math.max(CANVAS_SIZE / sourceWidth,
            CANVAS_SIZE / sourceHeight) * CUT_ENLARGEMENT;
    } else if (numberOfCutSides) {
        // Preserve current 1-3 edge handling and 4% edge enlargement.
        const requested = Math.max(baseScale,
            cut.left && cut.right ? CANVAS_SIZE / sourceWidth : 0,
            cut.top && cut.bottom ? CANVAS_SIZE / sourceHeight : 0);
        scale = Math.min(requested, fullContain) * CUT_ENLARGEMENT;
    }

    // Both output dimensions come from ONE scale. Never independently stretch
    // a product's width/height to cover the canvas.
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const position = placeScaledImage(width, height, outputPosition, cut);
    const limitedCutSides = [];
    if (outputPosition > 1 && cut.left && cut.right && width < CANVAS_SIZE) limitedCutSides.push("left/right");
    if (outputPosition > 1 && cut.top && cut.bottom && height < CANVAS_SIZE) limitedCutSides.push("top/bottom");

    return { ...position, cut, limitedCutSides, scale, enlargement: outputPosition > 1 && numberOfCutSides ? CUT_ENLARGEMENT : 1 };
}

async function renderAmazonImage(sourceBuffer, outputPosition, cut) {
    const creativeFrame = await isCreativeFrame(sourceBuffer);
    const detected = getCutFlags(cut);
    const effectiveCut = creativeFrame
        ? { left: true, right: true, top: true, bottom: true }
        : detected;
    const allCut = Object.values(effectiveCut).every(Boolean);
    // Four-edge compositions are complete SOURCE FRAMES. Never crop one by
    // an inferred product rectangle first. Only white/transparent product
    // assets with fewer cut sides use the usual blank-pixel trim.
    const contentBuffer = allCut ? sourceBuffer : (await trimToContent(sourceBuffer)).buffer;
    const metadata = await sharp(contentBuffer).metadata();
    const placementPlan = calculateAmazonPlacement(metadata.width, metadata.height,
        outputPosition, effectiveCut);

    // One uniform resize with libvips' proportional INSIDE fit. Pixel rounding
    // may change a dimension by one pixel: recompute alignment using the
    // resulting dimensions rather than stretching to match both numbers.
    const fullResized = await sharp(contentBuffer)
        .resize({
            width: placementPlan.width,
            height: placementPlan.height,
            fit: "inside",
            kernel: sharp.kernel.lanczos3
        })
        .png()
        .toBuffer();
    const resizedMeta = await sharp(fullResized).metadata();
    const exact = placeScaledImage(resizedMeta.width, resizedMeta.height, outputPosition, placementPlan.cut);
    const placement = { ...placementPlan, ...exact };
    placement.limitedCutSides = [];
    if (outputPosition > 1 && placement.cut.left && placement.cut.right && placement.width < CANVAS_SIZE) placement.limitedCutSides.push("left/right");
    if (outputPosition > 1 && placement.cut.top && placement.cut.bottom && placement.height < CANVAS_SIZE) placement.limitedCutSides.push("top/bottom");

    // libvips cannot composite an image larger than the destination directly.
    // Compute ONLY the visible viewport for the final JPG/PNG. This is not a
    // destructive crop of the Photoshop source: fullResized is stored intact
    // as a separate embedded Smart Object whenever overflow occurs.
    const intersectionLeft = Math.max(0, placement.left);
    const intersectionTop = Math.max(0, placement.top);
    const intersectionRight = Math.min(CANVAS_SIZE, placement.left + placement.width);
    const intersectionBottom = Math.min(CANVAS_SIZE, placement.top + placement.height);
    const visibleWidth = intersectionRight - intersectionLeft;
    const visibleHeight = intersectionBottom - intersectionTop;
    if (visibleWidth < 1 || visibleHeight < 1) {
        throw new Error("Amazon image is outside the output canvas.");
    }
    const crop = {
        left: intersectionLeft - placement.left,
        top: intersectionTop - placement.top,
        width: visibleWidth,
        height: visibleHeight
    };
    const visibleOverlay = crop.width === placement.width && crop.height === placement.height
        ? fullResized
        : await sharp(fullResized).extract(crop).png().toBuffer();

    const pngBuffer = await sharp({
        create: {
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 0 }
        }
    }).composite([{
        input: visibleOverlay,
        left: intersectionLeft,
        top: intersectionTop
    }]).png().toBuffer();

    const jpgBuffer = await sharp(pngBuffer)
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        .toBuffer();

    return {
        pngBuffer,
        jpgBuffer,
        placement,
        // Saved only for oversized images; all off-canvas pixels remain in
        // the underlying Photoshop Smart Object rather than the JPG viewport.
        smartObjectBuffer: placement.overflow ? fullResized : null
    };
}

module.exports = {
    CANVAS_SIZE,
    MAIN_AREA,
    REST_AREA,
    CUT_ENLARGEMENT,
    detectCutSides,
    trimFirstImage,
    renderAmazonImage,
    getContentBounds,
    trimToContent,
    calculateAmazonPlacement,
    isCreativeFrame
};
