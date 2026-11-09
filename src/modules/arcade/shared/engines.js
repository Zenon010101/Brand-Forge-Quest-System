"use strict";
/* Pure, dependency-free arcade game rules. Works in Node unit tests and Electron renderer. */
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.BrandForgeArcadeEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const randIndex = (length, rng) => Math.min(length - 1, Math.floor(Math.max(0, Math.min(.999999999, rng())) * length));
    function shuffle(items, rng = Math.random) {
        const list = [...items];
        for (let i = list.length - 1; i > 0; i--) {
            const j = randIndex(i + 1, rng);
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
    }

    const DIRECTIONS = Object.freeze({
        up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
        left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
    });
    const sameCell = (a, b) => a.x === b.x && a.y === b.y;
    function randomSnakeFood(body, columns, rows, rng = Math.random) {
        const used = new Set(body.map(cell => `${cell.x},${cell.y}`));
        const available = [];
        for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
            if (!used.has(`${x},${y}`)) available.push({ x, y });
        }
        return available.length ? available[randIndex(available.length, rng)] : null;
    }
    function createSnake(columns = 20, rows = 20, rng = Math.random) {
        if (columns < 5 || rows < 5) throw new Error("Snake grid must be at least 5 × 5.");
        const x = Math.floor(columns / 2);
        const y = Math.floor(rows / 2);
        const body = [{ x, y }, { x: x - 1, y }, { x: x - 2, y }];
        return { columns, rows, body, direction: "right", queued: "right", food: randomSnakeFood(body, columns, rows, rng), score: 0, over: false, won: false };
    }
    function turnSnake(state, direction) {
        if (!DIRECTIONS[direction] || state.over) return state;
        const a = DIRECTIONS[state.direction], b = DIRECTIONS[direction];
        if (a.x + b.x === 0 && a.y + b.y === 0) return state;
        // Only one direction change per tick, avoiding rapid reverse through two keys.
        if (state.queued !== state.direction) return state;
        return { ...state, queued: direction };
    }
    function stepSnake(state, rng = Math.random) {
        if (state.over) return state;
        const direction = state.queued;
        const step = DIRECTIONS[direction];
        const head = { x: state.body[0].x + step.x, y: state.body[0].y + step.y };
        const eating = state.food && sameCell(head, state.food);
        const collisionBody = eating ? state.body : state.body.slice(0, -1);
        if (head.x < 0 || head.y < 0 || head.x >= state.columns || head.y >= state.rows || collisionBody.some(cell => sameCell(cell, head))) {
            return { ...state, direction, queued: direction, over: true };
        }
        const body = [head, ...state.body.slice(0, eating ? undefined : -1)];
        const food = eating ? randomSnakeFood(body, state.columns, state.rows, rng) : state.food;
        return { ...state, body, food, direction, queued: direction, score: state.score + (eating ? 10 : 0), over: food === null, won: food === null };
    }

    const COLORS = Object.freeze([
        { name: "Coral", hex: "#f77a70" }, { name: "Mint", hex: "#60c9ad" },
        { name: "Cobalt", hex: "#577dff" }, { name: "Amber", hex: "#efb85e" },
        { name: "Lilac", hex: "#ae8de0" }, { name: "Rose", hex: "#ec80a1" },
        { name: "Turquoise", hex: "#4baebf" }, { name: "Lime", hex: "#acd36b" },
        { name: "Peach", hex: "#f4a882" }, { name: "Plum", hex: "#985588" },
        { name: "Sky", hex: "#86bef0" }, { name: "Rust", hex: "#c77852" },
        { name: "Teal", hex: "#327a80" }, { name: "Violet", hex: "#8457d8" },
        { name: "Gold", hex: "#d4a634" }, { name: "Pine", hex: "#4d976e" }
    ]);
    function createColorRound(rng = Math.random) {
        const choices = shuffle(COLORS, rng).slice(0, 9);
        const correctIndex = randIndex(choices.length, rng);
        return { choices, correctIndex, target: choices[correctIndex] };
    }
    function correctColor(round, index) {
        return Number.isInteger(index) && index === round.correctIndex;
    }

    const SYMBOLS = Object.freeze(["✦", "◆", "●", "✿", "☀", "♠", "☾", "♥", "☁", "✚", "♣", "▲"]);
    function createMemory(pairs = 8, rng = Math.random) {
        if (!Number.isInteger(pairs) || pairs < 2 || pairs > SYMBOLS.length) throw new Error("Memory needs 2–12 pairs.");
        const deck = shuffle([...SYMBOLS.slice(0, pairs), ...SYMBOLS.slice(0, pairs)], rng);
        return { deck, revealed: [], matched: [], moves: 0, pairs, over: false };
    }
    function flipMemory(state, index) {
        if (state.over || !Number.isInteger(index) || index < 0 || index >= state.deck.length || state.revealed.includes(index) || state.matched.includes(index) || state.revealed.length >= 2) return state;
        const revealed = [...state.revealed, index];
        if (revealed.length < 2) return { ...state, revealed };
        const moves = state.moves + 1;
        if (state.deck[revealed[0]] !== state.deck[revealed[1]]) return { ...state, revealed, moves };
        const matched = [...state.matched, ...revealed];
        return { ...state, revealed: [], matched, moves, over: matched.length === state.deck.length };
    }
    function hideMemoryMismatch(state) {
        return state.revealed.length === 2 ? { ...state, revealed: [] } : state;
    }
    function memoryScore(moves, seconds, pairs = 8) {
        return Math.max(100, Math.round(1250 * pairs / 8 - moves * 25 - Math.max(0, seconds) * 4));
    }

    const BLOCK_SHAPES = Object.freeze({
        I: [[1, 1, 1, 1]], O: [[1, 1], [1, 1]],
        T: [[0, 1, 0], [1, 1, 1]], S: [[0, 1, 1], [1, 1, 0]],
        Z: [[1, 1, 0], [0, 1, 1]], J: [[1, 0, 0], [1, 1, 1]],
        L: [[0, 0, 1], [1, 1, 1]]
    });
    const BLOCK_TYPES = Object.freeze(Object.keys(BLOCK_SHAPES));
    function rotateMatrix(matrix) {
        return Array.from({ length: matrix[0].length }, (_, x) =>
            Array.from({ length: matrix.length }, (_, y) => matrix[matrix.length - 1 - y][x]));
    }
    function createPiece(type, columns) {
        const shape = BLOCK_SHAPES[type].map(row => [...row]);
        return { type, shape, x: Math.floor((columns - shape[0].length) / 2), y: 0 };
    }
    function collision(board, piece, x = piece.x, y = piece.y, shape = piece.shape) {
        for (let r = 0; r < shape.length; r++) for (let c = 0; c < shape[r].length; c++) {
            if (!shape[r][c]) continue;
            const px = x + c, py = y + r;
            if (px < 0 || px >= board[0].length || py < 0 || py >= board.length || board[py][px]) return true;
        }
        return false;
    }
    const randomPiece = (rng = Math.random) => BLOCK_TYPES[randIndex(BLOCK_TYPES.length, rng)];
    function createBlocks(columns = 10, rows = 20, rng = Math.random) {
        const board = Array.from({ length: rows }, () => Array(columns).fill(null));
        const active = createPiece(randomPiece(rng), columns);
        return { columns, rows, board, active, next: randomPiece(rng), score: 0, lines: 0, over: false };
    }
    function moveBlocks(state, dx, dy) {
        if (state.over) return state;
        const piece = { ...state.active, x: state.active.x + dx, y: state.active.y + dy };
        return collision(state.board, piece) ? state : { ...state, active: piece };
    }
    function rotateBlocks(state) {
        if (state.over) return state;
        const shape = rotateMatrix(state.active.shape);
        for (const dx of [0, -1, 1, -2, 2]) {
            const piece = { ...state.active, shape, x: state.active.x + dx };
            if (!collision(state.board, piece)) return { ...state, active: piece };
        }
        return state;
    }
    function lockBlocks(state, rng = Math.random) {
        const board = state.board.map(row => [...row]);
        const { active } = state;
        for (let r = 0; r < active.shape.length; r++) for (let c = 0; c < active.shape[r].length; c++) {
            if (active.shape[r][c]) board[active.y + r][active.x + c] = active.type;
        }
        const kept = board.filter(row => row.some(cell => !cell));
        const linesCleared = board.length - kept.length;
        while (kept.length < board.length) kept.unshift(Array(board[0].length).fill(null));
        const activeNext = createPiece(state.next, state.columns);
        const over = collision(kept, activeNext);
        return {
            ...state, board: kept, active: activeNext, next: randomPiece(rng), over,
            lines: state.lines + linesCleared,
            score: state.score + ([0, 100, 300, 500, 800][linesCleared] || 0)
        };
    }
    function stepBlocks(state, rng = Math.random) {
        if (state.over) return state;
        const advanced = moveBlocks(state, 0, 1);
        return advanced === state ? lockBlocks(state, rng) : advanced;
    }
    function hardDropBlocks(state, rng = Math.random) {
        if (state.over) return state;
        let current = state;
        let distance = 0;
        for (;;) {
            const next = moveBlocks(current, 0, 1);
            if (next === current) break;
            current = next;
            distance++;
        }
        const locked = lockBlocks(current, rng);
        return { ...locked, score: locked.score + distance * 2 };
    }
    function blocksWithActive(state) {
        const board = state.board.map(row => [...row]);
        if (!state.over) {
            const p = state.active;
            for (let r = 0; r < p.shape.length; r++) for (let c = 0; c < p.shape[r].length; c++) {
                if (p.shape[r][c] && board[p.y + r] && board[p.y + r][p.x + c] === null) board[p.y + r][p.x + c] = p.type;
            }
        }
        return board;
    }
    return {
        shuffle, createSnake, turnSnake, stepSnake, randomSnakeFood,
        COLORS, createColorRound, correctColor,
        SYMBOLS, createMemory, flipMemory, hideMemoryMismatch, memoryScore,
        BLOCK_SHAPES, BLOCK_TYPES, rotateMatrix, collision,
        createBlocks, moveBlocks, rotateBlocks, stepBlocks, hardDropBlocks, blocksWithActive
    };
});
