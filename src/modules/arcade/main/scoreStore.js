"use strict";
/* Profile-keyed arcade data. Separate from production EXP, histories, and achievements. */
const fs = require("fs");
const path = require("path");
const GAMES = Object.freeze(["snake", "color", "memory", "blocks"]);
const STORE_VERSION = 1;
const blankScores = () => Object.fromEntries(GAMES.map(game => [game, 0]));
function validatedId(value) {
    const id = String(value || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("A signed-in profile is required for Arcade scores.");
    return id;
}
function validateGame(game) {
    if (!GAMES.includes(game)) throw new Error("Unknown Arcade game.");
    return game;
}
function validatedScore(score) {
    if (!Number.isSafeInteger(score) || score < 0 || score > 100000000) throw new Error("Invalid Arcade score.");
    return score;
}
function readStore(file) {
    try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        return raw && raw.version === STORE_VERSION && raw.profiles && typeof raw.profiles === "object" && !Array.isArray(raw.profiles)
            ? raw : { version: STORE_VERSION, profiles: {} };
    } catch (_error) {
        return { version: STORE_VERSION, profiles: {} };
    }
}
function writeStore(file, store) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
        fs.writeFileSync(temp, JSON.stringify(store, null, 2), "utf8");
        // On Windows rename-over-existing may fail; protect existing data with a backup.
        try {
            fs.renameSync(temp, file);
        } catch (error) {
            if (!["EACCES", "EPERM", "EEXIST"].includes(error.code)) throw error;
            const backup = `${file}.arcade-backup`;
            if (fs.existsSync(file)) fs.copyFileSync(file, backup);
            fs.copyFileSync(temp, file);
            fs.unlinkSync(temp);
        }
    } finally {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
}
function profileState(store, profileId) {
    const item = store.profiles[validatedId(profileId)] || {};
    const highScores = blankScores();
    for (const game of GAMES) {
        const n = item.highScores?.[game];
        if (Number.isSafeInteger(n) && n >= 0 && n <= 100000000) highScores[game] = n;
    }
    return { highScores, soundEnabled: item.soundEnabled !== false };
}
function getState(file, profileId) {
    return profileState(readStore(file), profileId);
}
function saveScore(file, profileId, game, score) {
    validateGame(game);
    validatedScore(score);
    const store = readStore(file);
    const previous = profileState(store, profileId);
    const updated = score > previous.highScores[game];
    if (updated) {
        previous.highScores[game] = score;
        store.profiles[validatedId(profileId)] = previous;
        writeStore(file, store);
    }
    return { ...previous, updated };
}
function saveSound(file, profileId, enabled) {
    if (typeof enabled !== "boolean") throw new Error("Sound setting must be true or false.");
    const store = readStore(file);
    const previous = profileState(store, profileId);
    previous.soundEnabled = enabled;
    store.profiles[validatedId(profileId)] = previous;
    writeStore(file, store);
    return previous;
}
module.exports = { GAMES, getState, saveScore, saveSound, validatedId, validatedScore, validateGame };
