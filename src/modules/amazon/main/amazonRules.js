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

    let background = null;
    if (!hasTransparency) {
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
        if (!background) return true;
        const dr = data[i] - background.r;
        const dg = data[i + 1] - background.g;
        const db = data[i + 2] - background.b;
        return dr * dr + dg * dg + db * db > 30 * 30;
    }
    return { isContent, hasTransparency, background };
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


async function getOpaqueCornerAnchor(buffer, cut) {
    const { data, info } = await getRawInfo(buffer);
    const { width, height } = info;
    const { isContent } = createContentClassifier(data, info);

    const corners = [];
    if (cut.left && cut.top) corners.push({ name: "top-left", x: 0, y: 0 });
    if (cut.right && cut.top) corners.push({ name: "top-right", x: width - 1, y: 0 });
    if (cut.left && cut.bottom) corners.push({ name: "bottom-left", x: 0, y: height - 1 });
    if (cut.right && cut.bottom) corners.push({ name: "bottom-right", x: width - 1, y: height - 1 });
    if (!corners.length) return null;

    // Real item pixels only. Previously this tested alpha only, so *opaque*
    // JPG/PNG backgrounds were treated as solid product at every corner.
    // Prefer a *solid interior* pixel (3x3 neighborhood) rather than the
    // nearest faint antialiased edge pixel. Otherwise the cut corner can
    // render nearly white even though the nominal anchor reaches (0,0).
    function isInteriorPixel(x, y) {
        let inspected = 0;
        let occupied = 0;
        for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
            for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
                inspected++;
                if (isContent(nx, ny)) occupied++;
            }
        }
        return occupied >= Math.ceil(inspected * 0.90);
    }

    let best = null;
    for (const corner of corners) {
        let nearest = null;
        let distanceSq = Infinity;
        let interior = null;
        let interiorDistanceSq = Infinity;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (!isContent(x, y)) continue;
                const dx = x - corner.x;
                const dy = y - corner.y;
                const candidate = dx * dx + dy * dy;
                if (candidate < distanceSq) {
                    distanceSq = candidate;
                    nearest = { x, y };
                }
                if (candidate < interiorDistanceSq && isInteriorPixel(x, y)) {
                    interiorDistanceSq = candidate;
                    interior = { x, y };
                }
            }
        }
        const chosen = interior || nearest;
        if (!chosen) continue;
        const normalizedDistance = Math.sqrt(interior ? interiorDistanceSq : distanceSq) /
            Math.max(1, Math.min(width, height));
        if (!best || normalizedDistance > best.normalizedDistance) {
            best = { corner: corner.name, ...chosen, normalizedDistance };
        }
    }
    return best;
}

function scaleNeededForCutCoverage(anchor, width, height, cut) {
    if (!anchor) return 0;

    const targetX = anchor.corner.indexOf("right") !== -1 ? CANVAS_SIZE : 0;
    const targetY = anchor.corner.indexOf("bottom") !== -1 ? CANVAS_SIZE : 0;

    let required = 0;

    if (cut.left && targetX !== 0 && anchor.x > 0) {
        required = Math.max(required, CANVAS_SIZE / anchor.x);
    }
    if (cut.right && targetX !== CANVAS_SIZE && (width - 1 - anchor.x) > 0) {
        required = Math.max(required, CANVAS_SIZE / (width - 1 - anchor.x));
    }
    if (cut.top && targetY !== 0 && anchor.y > 0) {
        required = Math.max(required, CANVAS_SIZE / anchor.y);
    }
    if (cut.bottom && targetY !== CANVAS_SIZE && (height - 1 - anchor.y) > 0) {
        required = Math.max(required, CANVAS_SIZE / (height - 1 - anchor.y));
    }

    return required;
}

async function trimFirstImage(buffer) {
    try {
        const result = await trimToContent(buffer);
        return result.buffer;
    } catch (error) {
        return buffer;
    }
}

async function cropToCanvas(buffer, width, height, left, top) {
    const sourceX = Math.max(0, -left);
    const sourceY = Math.max(0, -top);
    const destinationX = Math.max(0, left);
    const destinationY = Math.max(0, top);

    const visibleWidth = Math.min(
        width - sourceX,
        CANVAS_SIZE - destinationX
    );

    const visibleHeight = Math.min(
        height - sourceY,
        CANVAS_SIZE - destinationY
    );

    if (visibleWidth <= 0 || visibleHeight <= 0) {
        throw new Error("Image ended outside canvas.");
    }

    let visible = buffer;

    if (
        sourceX !== 0 ||
        sourceY !== 0 ||
        visibleWidth !== width ||
        visibleHeight !== height
    ) {
        visible = await sharp(buffer)
            .extract({
                left: sourceX,
                top: sourceY,
                width: visibleWidth,
                height: visibleHeight
            })
            .png()
            .toBuffer();
    }

    return {
        buffer: visible,
        left: destinationX,
        top: destinationY
    };
}

async function renderAmazonImage(sourceBuffer, outputPosition, cut) {
    const { buffer: trimmedBuffer } = await trimToContent(sourceBuffer);
    const metadata = await sharp(trimmedBuffer).metadata();
    const sourceWidth = metadata.width;
    const sourceHeight = metadata.height;

    if (!sourceWidth || !sourceHeight) {
        throw new Error("Invalid source image dimensions.");
    }

    const hasCut = !!(cut.left || cut.right || cut.top || cut.bottom);
    const horizontalPair = cut.left && cut.right;
    const verticalPair = cut.top && cut.bottom;
    const allSides = horizontalPair && verticalPair;

    const target = outputPosition === 1
        ? MAIN_AREA
        : REST_AREA;

    // Normal images retain the Amazon safe-area rules. Once a genuine cut is
    // detected, cut placement overrides safe-area centering and aligns the
    // actual product pixels to the relevant canvas edge/corner.
    let scale = Math.min(
        target.width / sourceWidth,
        target.height / sourceHeight
    );

    if (hasCut) {
        if (allSides) {
            scale = Math.max(
                CANVAS_SIZE / sourceWidth,
                CANVAS_SIZE / sourceHeight
            );
        } else {
            if (horizontalPair) {
                scale = Math.max(scale, CANVAS_SIZE / sourceWidth);
            }
            if (verticalPair) {
                scale = Math.max(scale, CANVAS_SIZE / sourceHeight);
            }
        }
    }

    // Adjacent cut sides can still leave a triangular transparent/white gap
    // at the requested corner even when the bounding box touches both edges.
    // Lock the nearest real item pixel to the worst affected cut corner and,
    // where necessary, increase scale just enough to preserve coverage of the
    // other cut sides.
    const cornerAnchor = hasCut
        ? await getOpaqueCornerAnchor(trimmedBuffer, cut)
        : null;

    if (cornerAnchor && cornerAnchor.normalizedDistance > 0.002) {
        scale = Math.max(
            scale,
            scaleNeededForCutCoverage(
                cornerAnchor,
                sourceWidth,
                sourceHeight,
                cut
            )
        );
    }

    const resizedWidth = Math.max(1, Math.round(sourceWidth * scale));
    const resizedHeight = Math.max(1, Math.round(sourceHeight * scale));

    let left = Math.round(target.x + (target.width - resizedWidth) / 2);
    let top = Math.round(target.y + (target.height - resizedHeight) / 2);

    if (hasCut) {
        if (horizontalPair) {
            left = Math.round((CANVAS_SIZE - resizedWidth) / 2);
        } else if (cut.left) {
            left = 0;
        } else if (cut.right) {
            left = CANVAS_SIZE - resizedWidth;
        }

        if (verticalPair) {
            top = Math.round((CANVAS_SIZE - resizedHeight) / 2);
        } else if (cut.top) {
            top = 0;
        } else if (cut.bottom) {
            top = CANVAS_SIZE - resizedHeight;
        }

        if (cornerAnchor && cornerAnchor.normalizedDistance > 0.002) {
            const scaledAnchorX = cornerAnchor.x * scale;
            const scaledAnchorY = cornerAnchor.y * scale;

            if (cornerAnchor.corner.indexOf("left") !== -1) {
                left = Math.round(-scaledAnchorX);
            } else {
                left = Math.round(CANVAS_SIZE - scaledAnchorX);
            }

            if (cornerAnchor.corner.indexOf("top") !== -1) {
                top = Math.round(-scaledAnchorY);
            } else {
                top = Math.round(CANVAS_SIZE - scaledAnchorY);
            }
        }
    }

    const resized = await sharp(trimmedBuffer)
        .resize({
            width: resizedWidth,
            height: resizedHeight,
            fit: "fill"
        })
        .png()
        .toBuffer();

    const visible = await cropToCanvas(
        resized,
        resizedWidth,
        resizedHeight,
        left,
        top
    );

    const pngBuffer = await sharp({
        create: {
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 0 }
        }
    })
        .composite([{
            input: visible.buffer,
            left: visible.left,
            top: visible.top
        }])
        .png()
        .toBuffer();

    const jpgBuffer = await sharp(pngBuffer)
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        .toBuffer();

    return { pngBuffer, jpgBuffer };
}

module.exports = {
    CANVAS_SIZE,
    MAIN_AREA,
    REST_AREA,
    detectCutSides,
    trimFirstImage,
    renderAmazonImage,
    getContentBounds,
    trimToContent,
    getOpaqueCornerAnchor
};
