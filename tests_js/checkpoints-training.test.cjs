const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../app.js');
const Checkpoints = require('../checkpoint-ui.js');
const TrainingUI = require('../training-ui.js');
global.SudokuEngine = require('../solver.js');
global.SudokuCheckpointUI = Checkpoints;
global.SudokuTraining = require('../training.js');
global.SUDOKU_TRAINING_RECIPES = require('../training-recipes.js');
global.window = { addEventListener() {} };
require('../puzzles.js');
global.tr = (key, args = {}) => `${key}:${JSON.stringify(args)}`;

class Element {
    constructor() {
        this.children = []; this.events = {}; this.attributes = {}; this.dataset = {};
        this.classes = new Set(); this.value = '';
        this.classList = { contains: key => this.classes.has(key),
            add: key => this.classes.add(key),
            toggle: (key, on) => on ? this.classes.add(key) : this.classes.delete(key) };
    }
    appendChild(node) { this.children.push(node); if (!this.value && node.value) this.value = node.value; }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, fn) { this.events[key] = fn; }
    focus() {}
}
function dom() {
    const nodes = new Map();
    const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
    global.document = { getElementById: get, createElement: () => new Element() };
    return get;
}
function appFixture() {
    const app = Object.create(App.prototype);
    const matrix = factory => Array.from({ length: 9 }, () => Array.from({ length: 9 }, factory));
    Object.assign(app, {
        initialBoard: matrix(() => 0), currentBoard: matrix(() => 0),
        centerMarks: matrix(() => new Set()), cornerMarks: matrix(() => new Set()), cellColors: matrix(() => null),
        provenEliminations: new Set(['0,0,2']), prunedSnapshots: {}, checkedMistakes: new Set(['0,0']),
        checkpoints: [], history: [], historyIndex: -1, timerSeconds: 100, hintsCount: 3,
        mistakesCount: 2, revealedCount: 1, revealedCells: new Set(['0,1']), gameResultRecorded: true,
        audio: { playErase() {}, playInput() {} },
        saveTimerCheckpoint() {}, renderBoard() {}, updateRemainingCounts() {}, updateVisualHighlights() {},
        checkCascadeAvailability() {}, checkGameCompletion() {}, dismissDeductiveHint() {}, showToast(message) { this.toast = message; },
        startTimer() { this.running = true; }, stopTimer() { this.running = false; }, openModal() {}, closeModal() {},
        updatePuzzleMetaDisplay() {}, updateTimerDisplay() {}, restoreTimerCheckpoint() {}, diffSelect: {}
    });
    return app;
}

test('checkpoint restore, undo and redo preserve notes, colors and pruning without aliasing or rolling back counters', () => {
    const app = appFixture();
    app.centerMarks[0][0].add(1); app.cornerMarks[0][0].add(3); app.cellColors[0][0] = '#aabbcc';
    app.prunedSnapshots['0,1'] = { cellCenter: new Set([2]), cellCorner: new Set([4]),
        affectedCenter: [{ row: 1, col: 1, num: 2 }], affectedCorner: [] };
    const state = app.captureCheckpointState();
    app.checkpoints.push({ puzzle: app.initialBoard.flat().join(''), state, createdAt: 1, seconds: 12 });
    app.currentBoard[0][0] = 5; app.centerMarks[0][0].clear(); app.cellColors[0][0] = null;
    app.prunedSnapshots = {}; app.provenEliminations.clear();
    const before = app.captureCheckpointState();
    let completions = 0;
    app.checkGameCompletion = () => completions++;
    app.saveGameState = () => true;
    assert.equal(app.restoreCheckpoint(0), true);
    assert.deepEqual(app.captureCheckpointState(), state);
    app.undo(); assert.deepEqual(app.captureCheckpointState(), before);
    app.redo(); assert.deepEqual(app.captureCheckpointState(), state);
    assert.equal(completions, 0);
    assert.equal(app.timerSeconds, 100); assert.equal(app.hintsCount, 3); assert.equal(app.mistakesCount, 2);
    assert.equal(app.gameResultRecorded, true); assert.equal(app.revealedCount, 1);
    assert.deepEqual([...app.revealedCells], ['0,1']);
    app.centerMarks[0][0].add(9); app.prunedSnapshots['0,1'].affectedCenter[0].num = 8;
    assert.deepEqual(state.centerMarks[0][0], [1]); assert.equal(state.prunedSnapshots['0,1'].affectedCenter[0].num, 2);
    app.isPaused = true; assert.equal(app.restoreCheckpoint(0), false);
    app.isPaused = false; app.isExecutingCascade = true; assert.equal(app.restoreCheckpoint(0), false);
});

test('checkpoint validation rejects malformed data, changed givens and foreign puzzles', () => {
    const app = appFixture(); app.initialBoard[0][0] = 1; app.currentBoard[0][0] = 1;
    const point = { puzzle: app.initialBoard.flat().join(''), state: app.captureCheckpointState(), createdAt: 1, seconds: 0 };
    assert.equal(Checkpoints.valid(point, app.initialBoard), true);
    for (const mutate of [p => p.state.currentBoard[0][0] = 0, p => p.state.centerMarks[1][1] = [10],
        p => p.state.cornerMarks = [], p => p.puzzle = '0'.repeat(81), p => p.state.provenEliminations = ['9,1,1'],
        p => p.state.prunedSnapshots['0,1'] = { cellCenter: [], cellCorner: [], affectedCenter: [{}], affectedCorner: [] }]) {
        const copy = structuredClone(point); mutate(copy); assert.equal(Checkpoints.valid(copy, app.initialBoard), false);
    }
});

test('checkpoint UI caps slots at three and checkpoints survive a game save/load round trip', () => {
    const get = dom(); const app = appFixture(); let raw;
    global.localStorage = { setItem(key, value) { raw = value; }, getItem() { return raw; } };
    new Checkpoints(app);
    for (let i = 0; i < 4; i++) get('checkpoint-save').events.click();
    assert.equal(app.checkpoints.length, 3); assert.equal(get('checkpoint-save').disabled, true);
    const restored = appFixture(); assert.equal(restored.loadGameState(), true);
    assert.deepEqual(restored.checkpoints, app.checkpoints);
    const data = JSON.parse(raw); delete data.checkpoints; raw = JSON.stringify(data);
    assert.equal(restored.loadGameState(), true); assert.deepEqual(restored.checkpoints, []);
});

test('storage failure reports session-only saving and retains a usable checkpoint', () => {
    const get = dom(); const app = appFixture();
    global.localStorage = { setItem() { throw Error('quota'); } };
    const warn = console.warn; console.warn = () => {};
    try {
        new Checkpoints(app); get('checkpoint-save').events.click();
        assert.match(app.toast, /checkpoint.sessionOnly/); assert.equal(app.checkpoints.length, 1);
        assert.equal(app.restoreCheckpoint(0), true);
    } finally { console.warn = warn; }
});

test('starting a new puzzle clears checkpoints, including replaying the same puzzle', () => {
    const get = dom();
    const app = appFixture();
    app.checkpoints = [{}]; app.resetTimer = () => {}; app.saveGameState = () => true;
    assert.equal(app.hasGameProgress(), true);
    const puzzle = window.SUDOKU_PUZZLES.easy[0];
    app.startNewGame('easy', puzzle);
    assert.deepEqual(app.checkpoints, []);
    app.checkpoints = [{}]; app.startNewGame('easy', puzzle);
    assert.deepEqual(app.checkpoints, []);
});

test('independent drills hide visual and accessible pattern hints until requested and do not count assisted solves', () => {
    const get = dom(); get('training-mode').value = 'independent';
    const ui = new TrainingUI({ getLocalizedHintPart: (_, part) => part, openModal() {} });
    get('training-technique').value = 'pointing'; ui.load();
    const patternCount = () => ui.cells.filter(cell => cell.classList.contains('pattern')).length;
    assert.equal(patternCount(), 0); assert.equal(get('training-direction').textContent, '');
    assert.ok(ui.cells.every(cell => !cell.attributes['aria-label'].includes('training.pattern')));
    assert.match(get('training-instruction').textContent, /training.independentEliminate/);
    get('training-hint').events.click(); assert.ok(patternCount() > 0);
    ui.selection = new Set(ui.exercise.answer); get('training-check').events.click();
    assert.equal(ui.completed.size, 1); assert.equal(ui.independentCompleted.size, 0);
    get('training-next').events.click(); assert.equal(patternCount(), 0);
    ui.selection = new Set(ui.exercise.answer); get('training-check').events.click();
    assert.equal(ui.independentCompleted.size, 1); assert.ok(patternCount() > 0);
    get('training-next').events.click(); get('training-reveal').events.click();
    assert.equal(ui.independentCompleted.size, 1); assert.ok(patternCount() > 0);
    get('training-mode').value = 'guided'; get('training-mode').events.change();
    assert.ok(patternCount() > 0); assert.equal(ui.resolved, false); assert.equal(ui.selection.size, 0);
    assert.equal(get('training-hint').hidden, true);
});
