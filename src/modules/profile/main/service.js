"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");
const { levelInfo, rankForLevel } = require("./progression");

const STORE_VERSION = 1;
const BRAND_DISCOVERY_XP = 25;
const MAX_HISTORY = 1500;

let mutationQueue = Promise.resolve();

function dataPath() {
    return path.join(app.getPath("userData"), "profiles.json");
}

function sessionPath() {
    return path.join(app.getPath("userData"), "profile-session.json");
}

function emptyStore() {
    return { version: STORE_VERSION, profiles: [] };
}

function safeReadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (error) {
        return fallback;
    }
}

function loadStore() {
    const store = safeReadJson(dataPath(), emptyStore());
    if (!Array.isArray(store.profiles)) store.profiles = [];
    return store;
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
    try {
        fs.renameSync(tempPath, filePath);
    } catch (error) {
        // Some Windows filesystem configurations can refuse rename-over-existing.
        // Fall back to a replace sequence rather than losing the profile update.
        if (error.code !== "EEXIST" && error.code !== "EPERM" && error.code !== "EACCES") throw error;
        try { fs.unlinkSync(filePath); } catch (unlinkError) {
            if (unlinkError.code !== "ENOENT") throw unlinkError;
        }
        fs.renameSync(tempPath, filePath);
    }
}

function saveStore(store) {
    writeJsonAtomic(dataPath(), store);
}

function loadSession() {
    return safeReadJson(sessionPath(), {});
}

function saveSession(profileId) {
    writeJsonAtomic(sessionPath(), { profileId: profileId || null });
}

function enqueueMutation(work) {
    const next = mutationQueue.then(work, work);
    mutationQueue = next.then(() => undefined, () => undefined);
    return next;
}

function cleanUsername(value) {
    return String(value || "").trim();
}

function normalizeUsername(value) {
    return cleanUsername(value).toLowerCase();
}

function validateUsername(value) {
    const username = cleanUsername(value);
    if (username.length < 3 || username.length > 24) {
        throw new Error("Username must be 3–24 characters.");
    }
    if (!/^[a-z0-9._-]+$/i.test(username)) {
        throw new Error("Username may use letters, numbers, dot, underscore, and hyphen only.");
    }
    return username;
}

function validateDisplayName(value, fallback) {
    const name = String(value || "").trim() || fallback;
    if (name.length > 40) throw new Error("Display name must be 40 characters or fewer.");
    return name;
}

function validatePassword(value) {
    const password = String(value || "");
    if (password.length < 4) throw new Error("Password must be at least 4 characters.");
    if (password.length > 128) throw new Error("Password is too long.");
    return password;
}

function makePasswordRecord(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}

function verifyPassword(password, auth) {
    try {
        const salt = Buffer.from(auth.salt, "hex");
        const expected = Buffer.from(auth.hash, "hex");
        const actual = crypto.scryptSync(String(password || ""), salt, expected.length);
        return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    } catch (error) {
        return false;
    }
}

function defaultStats() {
    return {
        totalJobs: 0,
        sliderJobs: 0,
        amazonJobs: 0,
        amazonVariants: 0,
        colorboxes: 0,
        outputFiles: 0,
        qcPerfectJobs: 0,
        successStreak: 0,
        bestStreak: 0,
        uniqueBrands: []
    };
}

function ensureProfileShape(profile) {
    profile.xp = Number.isFinite(profile.xp) ? Math.max(0, Math.floor(profile.xp)) : 0;
    profile.achievements = Array.isArray(profile.achievements) ? profile.achievements : [];
    profile.history = Array.isArray(profile.history) ? profile.history : [];
    profile.stats = { ...defaultStats(), ...(profile.stats || {}) };
    profile.stats.uniqueBrands = Array.isArray(profile.stats.uniqueBrands)
        ? profile.stats.uniqueBrands.filter(Boolean)
        : [];
    return profile;
}

const ACHIEVEMENTS = [
    { id: "first-production", title: "First Production", description: "Complete your first production job.", check: s => s.totalJobs >= 1 },
    { id: "ten-jobs", title: "Getting Serious", description: "Complete 10 production jobs.", check: s => s.totalJobs >= 10 },
    { id: "century-club", title: "Century Club", description: "Complete 100 production jobs.", check: s => s.totalJobs >= 100 },
    { id: "brand-explorer", title: "Brand Explorer", description: "Process 10 unique brands.", check: s => s.uniqueBrands.length >= 10 },
    { id: "brand-collector", title: "Brand Collector", description: "Process 50 unique brands.", check: s => s.uniqueBrands.length >= 50 },
    { id: "slider-specialist", title: "Slider Specialist", description: "Complete 100 Slider PSD jobs.", check: s => s.sliderJobs >= 100 },
    { id: "amazonian", title: "Amazonian", description: "Complete 500 Amazon variants.", check: s => s.amazonVariants >= 500 },
    { id: "perfect-batch", title: "Perfect Batch", description: "Complete an Amazon batch with zero failed variants.", check: s => s.qcPerfectJobs >= 1 },
    { id: "clean-run", title: "Clean Run", description: "Complete 10 successful production jobs in a row.", check: s => s.bestStreak >= 10 }
];

function awardAchievements(profile) {
    const earned = new Set(profile.achievements.map(item => item.id));
    const newlyUnlocked = [];

    for (const definition of ACHIEVEMENTS) {
        if (earned.has(definition.id) || !definition.check(profile.stats)) continue;
        const item = {
            id: definition.id,
            title: definition.title,
            description: definition.description,
            unlockedAt: new Date().toISOString()
        };
        profile.achievements.push(item);
        newlyUnlocked.push(item);
    }

    return newlyUnlocked;
}

function publicProfile(profile) {
    if (!profile) return null;
    ensureProfileShape(profile);
    return {
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        createdAt: profile.createdAt,
        lastLoginAt: profile.lastLoginAt,
        xp: profile.xp,
        level: levelInfo(profile.xp),
        stats: {
            ...profile.stats,
            uniqueBrands: [...profile.stats.uniqueBrands],
            uniqueBrandCount: profile.stats.uniqueBrands.length
        },
        achievements: profile.achievements.map(item => ({ ...item }))
    };
}

function currentProfileFromStore(store) {
    const session = loadSession();
    if (!session.profileId) return null;
    const profile = store.profiles.find(item => item.id === session.profileId) || null;
    return profile ? ensureProfileShape(profile) : null;
}

async function getSession() {
    const store = loadStore();
    const profile = currentProfileFromStore(store);
    return {
        authenticated: Boolean(profile),
        hasAccounts: store.profiles.length > 0,
        profile: publicProfile(profile)
    };
}

async function createAccount(payload) {
    return enqueueMutation(async () => {
        const store = loadStore();
        const username = validateUsername(payload?.username);
        const normalized = normalizeUsername(username);
        if (store.profiles.some(item => normalizeUsername(item.username) === normalized)) {
            throw new Error("That username already exists on this computer.");
        }

        const password = validatePassword(payload?.password);
        const displayName = validateDisplayName(payload?.displayName, username);
        const now = new Date().toISOString();
        const profile = {
            id: crypto.randomUUID(),
            username,
            displayName,
            auth: makePasswordRecord(password),
            createdAt: now,
            lastLoginAt: now,
            xp: 0,
            stats: defaultStats(),
            achievements: [],
            history: []
        };
        store.profiles.push(profile);
        saveStore(store);
        saveSession(profile.id);
        return publicProfile(profile);
    });
}

async function login(payload) {
    return enqueueMutation(async () => {
        const store = loadStore();
        const normalized = normalizeUsername(payload?.username);
        const profile = store.profiles.find(item => normalizeUsername(item.username) === normalized);
        if (!profile || !verifyPassword(payload?.password, profile.auth || {})) {
            throw new Error("Incorrect username or password.");
        }
        profile.lastLoginAt = new Date().toISOString();
        ensureProfileShape(profile);
        saveStore(store);
        saveSession(profile.id);
        return publicProfile(profile);
    });
}

async function logout() {
    saveSession(null);
    return { ok: true };
}

function normalizeBrands(values) {
    const out = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const clean = String(value || "").trim();
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
    }
    return out;
}

async function recordProductionEvent(event) {
    return enqueueMutation(async () => {
        const store = loadStore();
        const profile = currentProfileFromStore(store);
        if (!profile) return null;
        ensureProfileShape(profile);

        const beforeLevel = levelInfo(profile.xp).level;
        const brands = normalizeBrands(event?.brandNames);
        const existingBrands = new Set(profile.stats.uniqueBrands.map(name => String(name).toLowerCase()));
        const newBrands = brands.filter(name => !existingBrands.has(name.toLowerCase()));
        newBrands.forEach(name => profile.stats.uniqueBrands.push(name));

        const baseXp = Math.max(0, Math.floor(Number(event?.xp) || 0));
        const xpEarned = baseXp + newBrands.length * BRAND_DISCOVERY_XP;
        profile.xp += xpEarned;

        const kind = String(event?.kind || "production");
        const countsAsJob = event?.countsAsJob !== false;
        const status = event?.status === "partial" ? "partial" : "success";

        if (countsAsJob) {
            profile.stats.totalJobs++;
            if (kind === "slider") profile.stats.sliderJobs++;
            if (kind === "amazon") profile.stats.amazonJobs++;
            if (status === "success") {
                profile.stats.successStreak++;
                profile.stats.bestStreak = Math.max(profile.stats.bestStreak, profile.stats.successStreak);
            } else {
                profile.stats.successStreak = 0;
            }
        }

        profile.stats.amazonVariants += Math.max(0, Math.floor(Number(event?.amazonVariants) || 0));
        profile.stats.colorboxes += Math.max(0, Math.floor(Number(event?.colorboxes) || 0));
        profile.stats.outputFiles += Math.max(0, Math.floor(Number(event?.outputFiles) || 0));
        if (event?.qcPerfect === true) profile.stats.qcPerfectJobs++;

        const now = new Date();
        const historyItem = {
            id: crypto.randomUUID(),
            timestamp: now.toISOString(),
            kind,
            label: String(event?.label || "Completed job").trim(),
            subtitle: String(event?.subtitle || "").trim(),
            status,
            xp: xpEarned,
            baseXp,
            brandBonusXp: newBrands.length * BRAND_DISCOVERY_XP,
            newBrands,
            brandNames: brands,
            itemCount: Math.max(0, Math.floor(Number(event?.itemCount) || 0)),
            outputFiles: Math.max(0, Math.floor(Number(event?.outputFiles) || 0)),
            outputPath: event?.outputPath ? String(event.outputPath) : null
        };
        profile.history.unshift(historyItem);
        if (profile.history.length > MAX_HISTORY) profile.history.length = MAX_HISTORY;

        const newlyUnlocked = awardAchievements(profile);
        const after = levelInfo(profile.xp);
        saveStore(store);

        return {
            xpEarned,
            newBrands,
            newlyUnlocked,
            levelUp: after.level > beforeLevel,
            profile: publicProfile(profile),
            historyItem
        };
    });
}

function mondayStart(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
}

function weeklyHistory(profile, referenceDate = new Date()) {
    const start = mondayStart(referenceDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 5); // Saturday 00:00; Monday-Friday only.

    const labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const days = labels.map((label, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        return {
            label,
            date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
            entries: [],
            xp: 0
        };
    });

    for (const entry of profile.history) {
        const time = new Date(entry.timestamp);
        if (!(time >= start && time < end)) continue;
        const index = (time.getDay() + 6) % 7;
        if (index < 0 || index > 4) continue;
        days[index].entries.push({ ...entry });
        days[index].xp += Number(entry.xp) || 0;
    }

    return {
        start: start.toISOString(),
        end: end.toISOString(),
        days,
        totalEntries: days.reduce((sum, day) => sum + day.entries.length, 0),
        totalXp: days.reduce((sum, day) => sum + day.xp, 0)
    };
}

async function getDashboard() {
    const store = loadStore();
    const profile = currentProfileFromStore(store);
    if (!profile) return { authenticated: false, hasAccounts: store.profiles.length > 0 };
    ensureProfileShape(profile);

    return {
        authenticated: true,
        profile: publicProfile(profile),
        weekly: weeklyHistory(profile),
        recentHistory: profile.history.slice(0, 20).map(item => ({ ...item })),
        achievementCatalog: ACHIEVEMENTS.map(item => ({
            id: item.id,
            title: item.title,
            description: item.description,
            unlocked: profile.achievements.some(earned => earned.id === item.id),
            unlockedAt: profile.achievements.find(earned => earned.id === item.id)?.unlockedAt || null
        }))
    };
}

module.exports = {
    getSession,
    createAccount,
    login,
    logout,
    getDashboard,
    recordProductionEvent,
    levelInfo,
    rankForLevel,
    BRAND_DISCOVERY_XP
};
