"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const rules = require("../src/modules/arcade/shared/engines");
const scores = require("../src/modules/arcade/main/scoreStore");

// Snake: starting position, forbidden reversal, fruit, tail movement, wall collision.
let snake = rules.createSnake(10, 10, () => 0);
assert.equal(snake.body.length, 3);
assert.equal(rules.turnSnake(snake, "left"), snake, "Snake cannot immediately reverse");
snake = { ...snake, food: { x: snake.body[0].x + 1, y: snake.body[0].y } };
snake = rules.stepSnake(snake);
assert.equal(snake.score, 10);
assert.equal(snake.body.length, 4);
assert(!snake.body.some(cell => cell.x === snake.food?.x && cell.y === snake.food?.y));
const next = rules.turnSnake(snake, "up");
assert.equal(next.queued, "up");
assert.equal(rules.turnSnake(next, "left"), next, "At most one turn per tick");
snake = next;
for (let i = 0; i < 12 && !snake.over; i++) snake = rules.stepSnake(snake);
assert(snake.over, "Walls must end a game");

// Color: no duplicates, exactly one correct, deterministic under a seeded RNG.
let randomSeed = 482;
const rng = () => { randomSeed = (1664525 * randomSeed + 1013904223) >>> 0; return randomSeed / 4294967296; };
for (let i = 0; i < 30; i++) {
    const round = rules.createColorRound(rng);
    assert.equal(round.choices.length, 9);
    assert.equal(new Set(round.choices.map(x => x.hex)).size, 9);
    assert.equal(round.choices[round.correctIndex], round.target);
    assert(rules.correctColor(round, round.correctIndex));
    assert(!rules.correctColor(round, (round.correctIndex + 1) % 9));
}

// Memory: a mismatch hides, a match stays visible, completed pairs finish.
let memory = rules.createMemory(2, () => .1);
assert.equal(memory.deck.length, 4);
const a = 0, b = memory.deck.findIndex((value, index) => index > 0 && value !== memory.deck[0]);
const matchA = memory.deck.findIndex((value, index) => index > 0 && value === memory.deck[0]);
memory = rules.flipMemory(memory, a);
memory = rules.flipMemory(memory, b);
assert.equal(memory.moves, 1);
assert.equal(memory.revealed.length, 2);
memory = rules.hideMemoryMismatch(memory);
assert.equal(memory.revealed.length, 0);
memory = rules.flipMemory(rules.flipMemory(memory, a), matchA);
assert.equal(memory.matched.length, 2);
const rest = [0, 1, 2, 3].filter(i => !memory.matched.includes(i));
memory = rules.flipMemory(rules.flipMemory(memory, rest[0]), rest[1]);
assert(memory.over);
assert.equal(memory.matched.length, 4);
assert(rules.memoryScore(12, 70) > rules.memoryScore(30, 70));

// Blocks: legal transformations, hard drop, line clearing and spawn failure.
assert.deepEqual(rules.rotateMatrix([[1, 0, 0], [1, 1, 1]]), [[1, 1], [1, 0], [1, 0]]);
let blocks = rules.createBlocks(10, 20, () => 0);
const afterDrop = rules.hardDropBlocks(blocks, () => .2);
assert(afterDrop.score > 0, "Hard drop awards points");
assert(afterDrop.board.flat().some(Boolean), "Placed piece becomes part of board");
assert(afterDrop.active.type, "Next piece spawns");
let filled = rules.createBlocks(10, 20, () => .1);
filled.board[19] = ["I", "I", "I", "I", null, null, "I", "I", "I", "I"];
filled.active = { type: "O", shape: [[1, 1], [1, 1]], x: 4, y: 18 };
const cleared = rules.stepBlocks(filled, () => .5);
assert.equal(cleared.lines, 1);
assert.equal(cleared.score, 100);
assert.equal(cleared.board.length, 20);

// Score store: local-only, per UUID profile; record best only, separate sound setting.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "brandforge-arcade-test-"));
try {
    const file = path.join(root, "arcade-scores.json");
    const userA = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const userB = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
    assert.equal(scores.getState(file, userA).highScores.snake, 0);
    assert.equal(scores.getState(file, userA).soundEnabled, true);
    let changed = scores.saveScore(file, userA, "snake", 90);
    assert(changed.updated);
    changed = scores.saveScore(file, userA, "snake", 40);
    assert(!changed.updated);
    assert.equal(scores.getState(file, userA).highScores.snake, 90);
    assert.equal(scores.getState(file, userB).highScores.snake, 0);
    scores.saveSound(file, userA, false);
    assert.equal(scores.getState(file, userA).soundEnabled, false);
    assert.equal(scores.getState(file, userB).soundEnabled, true);
    assert.throws(() => scores.saveScore(file, userA, "unknown", 10), /Unknown/);
    assert.throws(() => scores.saveScore(file, userA, "snake", -2), /Invalid/);
    assert.throws(() => scores.saveScore(file, userA, "snake", 1.5), /Invalid/);
    assert.throws(() => scores.saveScore(file, userA, "snake", Infinity), /Invalid/);
    assert.throws(() => scores.saveSound(file, userA, "off"), /true or false/);
    assert.throws(() => scores.getState(file, "__proto__"), /signed-in/);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 1);
} finally { fs.rmSync(root, { recursive: true, force: true }); }

// Integration checks: sidebar, iframe, IPC, isolated module, no production EXP hook.
const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const shell = read("src/renderer/index.html");
const renderer = read("src/renderer/app.js");
const preload = read("src/main/preload.js");
const main = read("src/main/main.js");
const gameUi = read("src/modules/arcade/renderer/index.html");
assert.match(shell, /data-page="arcade"/);
assert.match(shell, /id="arcadeFrame"/);
assert.match(shell, /modules\/arcade\/renderer\/index\.html/);
assert.match(renderer, /arcade-hidden/);
assert.match(renderer, /arcade-profile-refresh/);
assert.match(preload, /exposeInMainWorld\("arcadeApp"/);
assert.match(main, /modules\/arcade\/main\/register/);
for (const game of ["snake", "color", "memory", "blocks"]) assert(gameUi.includes(`data-game="${game}"`));
assert(!read("src/modules/arcade/main/register.js").includes("recordProductionEvent"));
assert(!read("src/modules/arcade/main/scoreStore.js").includes("profiles.json"));
console.log("PASS Arcade: four engines, profile scores, sound, sidebar and isolated IPC integration");
