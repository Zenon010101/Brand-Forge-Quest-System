"use strict";
(function () {
    const rules = window.BrandForgeArcadeEngine;
    const api = window.arcadeApp;
    const $ = id => document.getElementById(id);
    const gameInfo = {
        snake: { title: "Snake", number: "01 / CLASSIC ARCADE", description: "Collect fruit. Don't hit a wall or your own tail.", help: "Arrow keys or WASD to steer. Avoid reversing into yourself.", metric: "FRUIT EATEN", tip: "Each fruit adds 10 points. Reach a new personal best." },
        color: { title: "Color Match Rush", number: "02 / COLOR LAB", description: "Find the tile that exactly matches the target swatch.", help: "Click the matching color tile. You have 45 seconds.", metric: "TIME LEFT", tip: "Correct answers add 10 points. Wrong answers cost 2 seconds." },
        memory: { title: "Memory Flip", number: "03 / PATTERN RECALL", description: "Turn two cards at a time to find all eight pairs.", help: "Click any two hidden cards. Match every pair to finish.", metric: "PAIRS FOUND", tip: "Finish with fewer moves and in less time for a higher score." },
        blocks: { title: "Block Puzzle", number: "04 / STACKING GAME", description: "Fit the falling blocks together and clear complete rows.", help: "← → move · ↑ rotate · ↓ soft drop · Space hard drop", metric: "ROWS CLEARED", tip: "Clear multiple rows at once for bonus points. Don't fill the top." }
    };
    const pieceColors = { I: "#68c7ce", O: "#edce75", T: "#b392ee", S: "#88d79d", Z: "#f28c92", J: "#80a4f8", L: "#e7aa75" };
    let chosen = "snake";
    let game = null;
    let running = false;
    let ended = false;
    let currentScore = 0;
    let remaining = 45;
    let elapsed = 0;
    let accumulator = 0;
    let lastTick = 0;
    let ticker = null;
    let mismatchTimer = null;
    let soundEnabled = true;
    let audioContext = null;
    let highs = { snake: 0, color: 0, memory: 0, blocks: 0 };
    let lastColorRound = null;
    let lastColorRunning = null;
    let lastMemoryDeck = null;
    let lastMemoryRunning = null;
    let sessionActive = false;
    let activeProfileId = null;

    function tone(freq = 480, duration = .09, type = "sine") {
        if (!soundEnabled) return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        try {
            if (!audioContext) audioContext = new AudioContextClass();
            if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            const now = audioContext.currentTime;
            oscillator.type = type;
            oscillator.frequency.setValueAtTime(freq, now);
            gain.gain.setValueAtTime(.045, now);
            gain.gain.exponentialRampToValueAtTime(.001, now + duration);
            oscillator.connect(gain); gain.connect(audioContext.destination);
            oscillator.start(now); oscillator.stop(now + duration + .005);
        } catch (_error) { /* Sound is optional; never interrupt gameplay. */ }
    }
    function setMessage(title, text) {
        $("fieldMessageTitle").textContent = title;
        $("fieldMessageText").textContent = text;
        $("fieldMessage").classList.remove("hidden-message");
    }
    function hideMessage() { $("fieldMessage").classList.add("hidden-message"); }
    function stateChip(text, kind = "") {
        $("gameState").textContent = text;
        $("gameState").className = `state-chip ${kind}`.trim();
    }
    let pausePreviously = false;
    function stopTicker() {
        if (ticker !== null) { clearInterval(ticker); ticker = null; }
        if (mismatchTimer !== null) { clearTimeout(mismatchTimer); mismatchTimer = null; }
        running = false;
    }
    function resetGame() {
        stopTicker();
        pausePreviously = false;
        ended = false; currentScore = 0; remaining = 45; elapsed = 0; accumulator = 0;
        if (chosen === "snake") game = rules.createSnake();
        else if (chosen === "color") game = rules.createColorRound();
        else if (chosen === "memory") game = rules.createMemory();
        else game = rules.createBlocks();
        render();
        stateChip("READY TO PLAY");
        setMessage("Ready when you are", "Press Start Game to begin.");
        $("startButton").textContent = "Start Game";
        $("startButton").disabled = !sessionActive;
        $("pauseButton").disabled = true;
    }
    function pauseGame(background = false) {
        if (!running) return;
        stopTicker();
        if (chosen === "memory" && game?.revealed?.length === 2) game = rules.hideMemoryMismatch(game);
        pausePreviously = true;
        stateChip("PAUSED", "paused");
        setMessage(background ? "Break paused" : "Game paused", "Press Resume Game when you're ready.");
        $("pauseButton").disabled = true;
        $("startButton").disabled = !sessionActive;
        $("startButton").textContent = "Resume Game";
        render();
    }
    async function finishGame(title, note) {
        if (ended) return;
        stopTicker();
        pausePreviously = false;
        ended = true;
        stateChip("GAME OVER", "over");
        setMessage(title, note);
        $("startButton").textContent = "Play Again";
        $("startButton").disabled = !sessionActive;
        $("pauseButton").disabled = true;
        render();
        tone(170, .25, "triangle");
        if (!api || !sessionActive || currentScore <= 0) return;
        const finishedGame = chosen;
        const finishedScore = currentScore;
        try {
            const result = await api.saveScore(finishedGame, finishedScore);
            if (result?.highScores) {
                highs = { ...highs, ...result.highScores };
                showHighs();
                if (result.updated && chosen === finishedGame && ended) $("fieldMessageText").textContent = `${note} New personal best!`;
            }
        } catch (_error) {
            $("saveNote").lastElementChild.textContent = "Could not save your latest score. Your production data is unaffected.";
        }
    }
    function startGame() {
        if (!sessionActive) return;
        if (ended) resetGame();
        if (running) return;
        pausePreviously = false;
        running = true;
        lastTick = performance.now();
        ticker = setInterval(updateLoop, 40);
        hideMessage();
        stateChip("PLAYING");
        $("startButton").disabled = true;
        $("pauseButton").disabled = false;
        tone(490, .08);
        render();
    }
    function updateLoop() {
        if (!running) return;
        const now = performance.now();
        const dt = Math.max(0, Math.min(130, now - lastTick));
        lastTick = now;
        if (chosen === "snake") {
            accumulator += dt;
            while (accumulator >= 130 && running) {
                accumulator -= 130;
                const previous = game.score;
                game = rules.stepSnake(game);
                currentScore = game.score;
                if (game.score > previous) tone(730, .08, "square");
                if (game.over) finishGame(game.won ? "You filled the grid!" : "Snake down!", `You earned ${currentScore} points.`);
            }
        } else if (chosen === "color") {
            remaining = Math.max(0, remaining - dt / 1000);
            if (remaining <= 0) finishGame("Time's up!", `You found ${currentScore / 10} matches.`);
        } else if (chosen === "memory") {
            elapsed += dt / 1000;
        } else if (chosen === "blocks") {
            accumulator += dt;
            const delay = Math.max(115, 650 - Math.floor(game.lines / 3) * 42);
            while (accumulator >= delay && running) {
                accumulator -= delay;
                const prior = game.score;
                game = rules.stepBlocks(game);
                if (game.score > prior) tone(600, .14, "triangle");
                currentScore = game.score;
                if (game.over) finishGame("Stack reached the top", `You cleared ${game.lines} rows.`);
            }
        }
        render();
    }
    function selectGame(name) {
        if (!gameInfo[name]) return;
        chosen = name;
        document.querySelectorAll(".game-tile").forEach(tile => {
            const selected = tile.dataset.game === name;
            tile.classList.toggle("active", selected);
            tile.setAttribute("aria-pressed", selected ? "true" : "false");
        });
        document.querySelectorAll(".game-view").forEach(view => { view.hidden = view.dataset.view !== name; });
        $("mobilePad").hidden = !(name === "snake" || name === "blocks");
        $("hardDropButton").hidden = name !== "blocks";
        const info = gameInfo[name];
        $("gameTitle").textContent = info.title;
        $("modeLabel").textContent = info.number;
        $("gameDescription").textContent = info.description;
        $("controlsHelp").textContent = info.help;
        $("metricLabel").textContent = info.metric;
        $("gameTip").textContent = info.tip;
        resetGame();
    }
    function showHighs() {
        for (const gameName of Object.keys(gameInfo)) {
            document.querySelector(`[data-best="${gameName}"]`).textContent = highs[gameName] || 0;
        }
        $("personalBest").textContent = highs[chosen] || 0;
    }
    async function reloadProfile() {
        pauseGame(true);
        if (!api) {
            const firstPreview = !sessionActive;
            sessionActive = true;
            $("profileName").textContent = "Preview only";
            $("saveNote").lastElementChild.textContent = "Open in BrandForge to save personal high scores.";
            if (firstPreview || !game) resetGame();
            return;
        }
        try {
            const data = await api.getState();
            sessionActive = true;
            soundEnabled = data.soundEnabled !== false;
            const changedProfile = activeProfileId !== data.profileId;
            activeProfileId = data.profileId;
            highs = { snake: 0, color: 0, memory: 0, blocks: 0, ...data.highScores };
            $("profileName").textContent = data.displayName || "Local profile";
            $("saveNote").lastElementChild.textContent = "High scores saved to your local profile. No impact on production EXP.";
            updateSoundButton(); showHighs();
            if (changedProfile || !game) resetGame();
        } catch (_error) {
            sessionActive = false;
            activeProfileId = null;
            highs = { snake: 0, color: 0, memory: 0, blocks: 0 };
            $("profileName").textContent = "Sign in required";
            $("saveNote").lastElementChild.textContent = "Sign in to your BrandForge profile to play and save scores.";
            stopTicker(); resetGame();
        }
    }
    function updateSoundButton() {
        $("soundToggle").textContent = soundEnabled ? "Sound: On" : "Sound: Off";
        $("soundToggle").setAttribute("aria-pressed", soundEnabled ? "true" : "false");
    }
    async function toggleSound() {
        const old = soundEnabled;
        soundEnabled = !soundEnabled;
        updateSoundButton();
        if (soundEnabled) tone(580, .09);
        if (!api || !sessionActive) return;
        try { await api.setSound(soundEnabled); }
        catch (_error) { soundEnabled = old; updateSoundButton(); }
    }
    function drawSnake() {
        const canvas = $("snakeCanvas"), ctx = canvas.getContext("2d");
        const size = canvas.width / game.columns;
        ctx.fillStyle = "#1b2826"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let y = 0; y < game.rows; y++) for (let x = 0; x < game.columns; x++) {
            if ((x + y) % 2 === 0) { ctx.fillStyle = "#20302d"; ctx.fillRect(x * size, y * size, size, size); }
        }
        if (game.food) {
            ctx.fillStyle = "#ef997f"; ctx.beginPath(); ctx.arc((game.food.x + .5) * size, (game.food.y + .5) * size, size * .32, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#a9d18c"; ctx.fillRect((game.food.x + .48) * size, (game.food.y + .08) * size, size * .13, size * .2);
        }
        game.body.forEach((part, index) => {
            ctx.fillStyle = index === 0 ? "#d4f2aa" : "#8ed4a2";
            const inset = index === 0 ? 1 : 2;
            ctx.beginPath(); ctx.roundRect(part.x * size + inset, part.y * size + inset, size - 2 * inset, size - 2 * inset, index === 0 ? 5 : 3); ctx.fill();
        });
    }
    function renderColor() {
        const swatch = $("targetSwatch");
        swatch.style.backgroundColor = game.target.hex;
        $("colorTargetText").textContent = "Choose the matching tile";
        const grid = $("colorGrid"); grid.replaceChildren();
        game.choices.forEach((choice, index) => {
            const button = document.createElement("button");
            button.type = "button"; button.className = "color-choice"; button.style.background = choice.hex;
            button.setAttribute("aria-label", `Color tile ${index + 1}`);
            button.title = `Tile ${index + 1}`; button.disabled = !running;
            button.addEventListener("click", () => {
                if (!running || chosen !== "color") return;
                if (rules.correctColor(game, index)) {
                    currentScore += 10;
                    tone(730, .08); game = rules.createColorRound();
                } else {
                    remaining = Math.max(0, remaining - 2);
                    tone(185, .09, "triangle");
                }
                render();
                if (remaining <= 0) finishGame("Time's up!", `You found ${currentScore / 10} matches.`);
            });
            grid.append(button);
        });
    }
    function renderMemory() {
        const grid = $("memoryGrid"); grid.replaceChildren();
        game.deck.forEach((symbol, index) => {
            const matched = game.matched.includes(index);
            const revealed = game.revealed.includes(index);
            const button = document.createElement("button"); button.type = "button";
            button.className = `memory-card${matched ? " matched" : revealed ? " revealed" : ""}`;
            button.textContent = matched || revealed ? symbol : "?";
            button.setAttribute("aria-label", matched ? `Matched ${symbol}` : revealed ? `Revealed ${symbol}` : `Hidden card ${index + 1}`);
            button.disabled = !running || matched || revealed || game.revealed.length >= 2;
            button.addEventListener("click", () => {
                if (!running || chosen !== "memory") return;
                const before = game;
                game = rules.flipMemory(game, index);
                if (before === game) return;
                if (game.revealed.length === 2) {
                    tone(275, .07, "triangle");
                    mismatchTimer = setTimeout(() => {
                        mismatchTimer = null;
                        if (chosen !== "memory" || !running) return;
                        game = rules.hideMemoryMismatch(game); render();
                    }, 720);
                } else tone(game.matched.length > before.matched.length ? 820 : 510, .08);
                if (game.over) {
                    currentScore = rules.memoryScore(game.moves, elapsed, game.pairs);
                    finishGame("All pairs found!", `Completed in ${game.moves} moves and ${Math.ceil(elapsed)}s.`);
                }
                render();
            });
            grid.append(button);
        });
    }
    function drawBlocks() {
        const canvas = $("blocksCanvas"), ctx = canvas.getContext("2d");
        const tiles = rules.blocksWithActive(game);
        const cell = canvas.width / game.columns;
        ctx.fillStyle = "#181d28"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let y = 0; y < game.rows; y++) for (let x = 0; x < game.columns; x++) {
            const value = tiles[y][x];
            ctx.fillStyle = value ? pieceColors[value] : "#262e3b";
            ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
            if (value) { ctx.fillStyle = "#ffffff30"; ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, 4); }
        }
        const next = $("nextCanvas"), nctx = next.getContext("2d");
        nctx.clearRect(0, 0, next.width, next.height);
        const shape = rules.BLOCK_SHAPES[game.next], s = 23;
        const dx = (next.width - shape[0].length * s) / 2;
        const dy = (next.height - shape.length * s) / 2;
        for (let y = 0; y < shape.length; y++) for (let x = 0; x < shape[y].length; x++) {
            if (!shape[y][x]) continue;
            nctx.fillStyle = pieceColors[game.next]; nctx.fillRect(dx + x * s + 1, dy + y * s + 1, s - 2, s - 2);
        }
    }
    function render() {
        if (!game) return;
        $("currentScore").textContent = String(currentScore).padStart(4, "0");
        showHighs();
        if (chosen === "snake") {
            drawSnake(); $("metricValue").textContent = currentScore / 10; $("metricSecondary").textContent = "20 × 20 grid";
        } else if (chosen === "color") {
            $("metricValue").textContent = `${Math.ceil(remaining)}s`;
            $("metricSecondary").textContent = `${currentScore / 10} correct matches`;
            if (lastColorRound !== game || lastColorRunning !== running) {
                renderColor(); lastColorRound = game; lastColorRunning = running;
            }
        } else if (chosen === "memory") {
            $("metricValue").textContent = `${game.matched.length / 2} / ${game.pairs}`;
            $("metricSecondary").textContent = `${game.moves} moves · ${Math.ceil(elapsed)}s`;
            if (lastMemoryDeck !== game || lastMemoryRunning !== running) {
                renderMemory(); lastMemoryDeck = game; lastMemoryRunning = running;
            }
        } else {
            $("metricValue").textContent = game.lines;
            $("metricSecondary").textContent = "Level " + (1 + Math.floor(game.lines / 10));
            drawBlocks();
        }
    }
    function moveGame(direction) {
        if (!running) return;
        if (chosen === "snake") game = rules.turnSnake(game, direction);
        else if (chosen === "blocks") {
            if (direction === "left") game = rules.moveBlocks(game, -1, 0);
            else if (direction === "right") game = rules.moveBlocks(game, 1, 0);
            else if (direction === "up") game = rules.rotateBlocks(game);
            else if (direction === "down") { game = rules.stepBlocks(game); currentScore = game.score; if (game.over) finishGame("Stack reached the top", `You cleared ${game.lines} rows.`); }
        }
        render();
    }
    function dropBlocks() {
        if (!running || chosen !== "blocks") return;
        game = rules.hardDropBlocks(game);
        currentScore = game.score;
        tone(300, .1, "square"); render();
        if (game.over) finishGame("Stack reached the top", `You cleared ${game.lines} rows.`);
    }
    document.querySelectorAll(".game-tile").forEach(button => button.addEventListener("click", () => selectGame(button.dataset.game)));
    $("startButton").addEventListener("click", startGame);
    $("pauseButton").addEventListener("click", () => pauseGame());
    $("restartButton").addEventListener("click", resetGame);
    $("soundToggle").addEventListener("click", toggleSound);
    document.querySelectorAll("[data-direction]").forEach(button => button.addEventListener("click", () => moveGame(button.dataset.direction)));
    $("hardDropButton").addEventListener("click", dropBlocks);
    document.addEventListener("keydown", event => {
        const key = event.key.toLowerCase();
        const mapped = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right" }[key];
        if (running && mapped && ["snake", "blocks"].includes(chosen)) { event.preventDefault(); moveGame(mapped); }
        else if (running && chosen === "blocks" && event.code === "Space") { event.preventDefault(); dropBlocks(); }
        else if (key === "p" && running) { event.preventDefault(); pauseGame(); }
    });
    // Parent navigation explicitly pauses Arcade while production tools are open.
    window.addEventListener("message", event => {
        if (event.source !== window.parent || event.data?.source !== "brandforge-shell") return;
        if (event.data.type === "arcade-hidden") pauseGame(true);
        if (event.data.type === "arcade-profile-refresh") reloadProfile();
    });
    window.addEventListener("blur", () => { if (running) pauseGame(true); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(true); });
    selectGame("snake");
    reloadProfile();
})();
