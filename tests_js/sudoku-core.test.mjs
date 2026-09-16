import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../puzzles.js');
const SudokuEngine = require('../solver.js');
globalThis.SudokuEngine = SudokuEngine;

function parseBoard(puzzle) {
    return Array.from({ length: 9 }, (_, row) => (
        Array.from(puzzle.slice(row * 9, row * 9 + 9), Number)
    ));
}

test('every bundled puzzle is structurally valid, unique and has one solution', () => {
    const ids = new Set();
    const puzzles = new Set();
    let count = 0;

    for (const [level, entries] of Object.entries(globalThis.SUDOKU_PUZZLES)) {
        for (const entry of entries) {
            count++;
            assert.match(entry.id, /\S/, `${level}: missing id`);
            assert.match(entry.puzzle, /^[0-9]{81}$/, `${entry.id}: invalid puzzle string`);
            assert.equal(ids.has(entry.id), false, `${entry.id}: duplicate id`);
            assert.equal(puzzles.has(entry.puzzle), false, `${entry.id}: duplicate puzzle`);
            ids.add(entry.id);
            puzzles.add(entry.puzzle);

            const result = SudokuEngine.solveBitwiseMRV(parseBoard(entry.puzzle), 2);
            assert.equal(result.solutionsCount, 1, `${entry.id}: expected exactly one solution`);
        }
    }

    assert.equal(count, 903);
});

test('deductive solver succeeds only when its own logic completes the board', () => {
    const easy = globalThis.SUDOKU_PUZZLES.easy[0];
    const easyResult = SudokuEngine.solveDeductive(parseBoard(easy.puzzle));
    assert.equal(easyResult.success, true);
    assert.equal(easyResult.isPureDeductive, true);
    assert.equal(easyResult.stalled, false);
    assert.ok(easyResult.solvedBoard);

    // Hard puzzles need eliminations (Pointing, pairs, wings) before the next single appears,
    // so this only passes while eliminations carry over from one step to the next.
    const hard = globalThis.SUDOKU_PUZZLES.hard[0];
    const hardResult = SudokuEngine.solveDeductive(parseBoard(hard.puzzle));
    assert.equal(hardResult.success, true);
    assert.ok(Object.keys(hardResult.techniquesUsed).some(name => !name.endsWith('Single')));

    const expert = globalThis.SUDOKU_PUZZLES.expert[0];
    const expertResult = SudokuEngine.solveDeductive(parseBoard(expert.puzzle));
    assert.equal(expertResult.success, false);
    assert.equal(expertResult.isPureDeductive, false);
    assert.equal(expertResult.stalled, true);
    assert.equal(expertResult.solvedBoard, null);
});

test('every deductive hint agrees with the unique solution', () => {
    const used = new Set();
    let checkedSteps = 0;

    for (const entries of Object.values(globalThis.SUDOKU_PUZZLES)) {
        // Every third puzzle keeps the suite fast while still covering all levels.
        for (let i = 0; i < entries.length; i += 3) {
            const entry = entries[i];
            const board = parseBoard(entry.puzzle);
            const solution = SudokuEngine.solveBitwiseMRV(board, 1).solvedBoard;
            SudokuEngine.solveDeductive(board, {
                onStep(hint) {
                    used.add(hint.technique);
                    checkedSteps++;
                    if (hint.action.type === 'set_value') {
                        const { row, col, value } = hint.action;
                        assert.equal(value, solution[row][col], `${entry.id}: ${hint.technique} placed a wrong digit`);
                    } else {
                        assert.ok(hint.action.eliminations.length > 0, `${entry.id}: ${hint.technique} eliminated nothing`);
                        for (const { row, col, digit } of hint.action.eliminations) {
                            assert.notEqual(digit, solution[row][col], `${entry.id}: ${hint.technique} removed the solution digit`);
                        }
                    }
                }
            });
        }
    }

    assert.ok(checkedSteps > 0);
    for (const technique of ['Claiming', 'Hidden Pair', 'Naked Triple', 'X-Wing', 'Swordfish', 'XY-Wing']) {
        assert.ok(used.has(technique), `${technique} was never exercised`);
    }
});

test('benchmark comparison uses consistent node and speed calculations', () => {
    const puzzle = globalThis.SUDOKU_PUZZLES.medium[0];
    const result = SudokuEngine.compareAlgorithms(parseBoard(puzzle.puzzle), 3);
    assert.equal(result.mrv.solutionsCount, 1);
    assert.equal(result.seq.solutionsCount, 1);
    assert.equal(result.nodesSaved, result.seq.nodesExplored - result.mrv.nodesExplored);
    assert.ok(Number.isFinite(result.speedup));
    assert.ok(result.mrv.timeUs >= 0);
    assert.ok(result.seq.timeUs >= 0);
});

test('solver trace callbacks replay to the same verified solution used by the animation', () => {
    const puzzle = '020900000048000031000063020009407003003080200400105600030570000250000180000006050';

    for (const algorithm of ['mrv', 'seq']) {
        const initial = parseBoard(puzzle);
        const replay = initial.map(row => [...row]);
        const trace = [];
        const result = algorithm === 'mrv'
            ? SudokuEngine.solveBitwiseMRV(initial, 1, { onStep: step => trace.push(step) })
            : SudokuEngine.solveBitwiseSequential(initial, 1, { onStep: step => trace.push(step) });

        for (const step of trace) {
            replay[step.row][step.col] = step.type === 'place' ? step.value : 0;
        }
        assert.ok(trace.some(step => step.type === 'place'), `${algorithm}: no placement trace`);
        assert.ok(trace.some(step => step.type === 'backtrack'), `${algorithm}: no backtracking trace`);
        assert.deepEqual(replay, result.solvedBoard, `${algorithm}: replay diverged from solution`);
    }

    const deductiveReplay = parseBoard(puzzle);
    const deductiveTrace = [];
    const deductiveResult = SudokuEngine.solveDeductive(parseBoard(puzzle), {
        onStep(hint) {
            deductiveTrace.push(hint);
            if (hint.action.type === 'set_value') {
                deductiveReplay[hint.action.row][hint.action.col] = hint.action.value;
            }
        }
    });
    assert.ok(deductiveTrace.some(hint => hint.action.type === 'eliminate_candidates'));
    assert.deepEqual(deductiveReplay, deductiveResult.solvedBoard);
});

test('all languages expose the same translation keys and correct direction', () => {
    const listeners = new Map();
    globalThis.document = {
        title: '',
        documentElement: { lang: '', dir: '' },
        addEventListener(type, callback) { listeners.set(type, callback); },
        getElementById() { return null; },
        querySelectorAll() { return []; }
    };
    globalThis.localStorage = { getItem() { return null; }, setItem() {} };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, options) { this.type = type; this.detail = options?.detail; }
    };
    globalThis.dispatchEvent = () => true;
    require('../i18n.js');

    const dictionaries = globalThis.SudokuI18n.translations;
    const hebrewKeys = Object.keys(dictionaries.he).sort();
    assert.deepEqual(Object.keys(dictionaries.en).sort(), hebrewKeys);
    assert.deepEqual(Object.keys(dictionaries.la).sort(), hebrewKeys);
    assert.deepEqual(Object.keys(dictionaries.yi).sort(), hebrewKeys);
    for (const [language, dictionary] of Object.entries(dictionaries)) {
        for (const key of hebrewKeys) {
            const expectedParams = [...new Set([...dictionaries.he[key].matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
            const actualParams = [...new Set([...dictionary[key].matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
            assert.deepEqual(actualParams, expectedParams, `${language}.${key}: placeholder mismatch`);
        }
    }

    const usedKeys = new Set();
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-html|-title|-aria-label)?="([^"]+)"/g)) {
        usedKeys.add(match[1]);
    }
    for (const match of app.matchAll(/\btr\('([^']+)'/g)) {
        usedKeys.add(match[1]);
    }
    for (const key of usedKeys) {
        assert.ok(Object.hasOwn(dictionaries.he, key), `missing translation key: ${key}`);
    }
    for (const entries of Object.values(globalThis.SUDOKU_PUZZLES)) {
        for (const entry of entries) {
            if (!entry.noteKey) continue;
            for (const [language, dictionary] of Object.entries(dictionaries)) {
                assert.ok(Object.hasOwn(dictionary, entry.noteKey), `${language}: missing puzzle note ${entry.noteKey}`);
            }
        }
    }

    globalThis.SudokuI18n.setLanguage('unsupported', { persist: false });
    assert.equal(globalThis.document.documentElement.lang, 'en');
    assert.equal(globalThis.document.documentElement.dir, 'ltr');

    globalThis.SudokuI18n.setLanguage('he', { persist: false });
    assert.equal(globalThis.document.documentElement.dir, 'rtl');
    globalThis.SudokuI18n.setLanguage('en', { persist: false });
    assert.equal(globalThis.document.documentElement.dir, 'ltr');
    globalThis.SudokuI18n.setLanguage('la', { persist: false });
    assert.equal(globalThis.document.documentElement.lang, 'la');
    assert.equal(globalThis.document.documentElement.dir, 'ltr');
    globalThis.SudokuI18n.setLanguage('yi', { persist: false });
    assert.equal(globalThis.document.documentElement.dir, 'rtl');
});

test('SudokuEngine.solveBitwiseMRV detects unique vs multiple vs unsolvable boards', () => {
    // 1. Unique solution (Easy puzzle #0)
    const easyPuzzle = globalThis.SUDOKU_PUZZLES.easy[0].puzzle;
    const grid = parseBoard(easyPuzzle);
    const uniqueRes = SudokuEngine.solveBitwiseMRV(grid, 2);
    assert.equal(uniqueRes.success, true);
    assert.equal(uniqueRes.solutionsCount, 1);
    assert.ok(uniqueRes.solvedBoard);
    assert.equal(SudokuEngine.isBoardCompleteAndValid(uniqueRes.solvedBoard), true);

    // 2. Multiple solutions (board with only 4 clues)
    const fewClues = Array(9).fill(null).map(() => Array(9).fill(0));
    fewClues[0][0] = 5;
    fewClues[1][1] = 6;
    fewClues[2][2] = 7;
    fewClues[3][3] = 8;
    const multiRes = SudokuEngine.solveBitwiseMRV(fewClues, 2);
    assert.equal(multiRes.success, true);
    assert.equal(multiRes.solutionsCount >= 2, true);

    // 3. Unsolvable board without direct conflicts
    const unsolvableBoard = [
        [5, 1, 6, 8, 4, 9, 7, 3, 2],
        [3, 4, 7, 6, 0, 5, 0, 0, 0],
        [8, 0, 9, 7, 0, 0, 0, 6, 5],
        [1, 3, 5, 0, 6, 0, 9, 0, 7],
        [4, 7, 2, 5, 9, 1, 0, 0, 6],
        [9, 6, 8, 3, 7, 0, 0, 5, 0],
        [2, 5, 3, 1, 8, 6, 0, 7, 9],
        [6, 8, 4, 2, 0, 7, 5, 0, 0],
        [7, 9, 1, 0, 5, 0, 6, 0, 8]
    ];
    const unsolvableRes = SudokuEngine.solveBitwiseMRV(unsolvableBoard, 2);
    assert.equal(unsolvableRes.solutionsCount, 0);
    assert.equal(unsolvableRes.success, false);
});

test('SudokuEngine.findConflicts detects row, col, and 3x3 box duplicates accurately', () => {
    const board = Array(9).fill(null).map(() => Array(9).fill(0));
    board[0][0] = 5;
    board[0][8] = 5; // row duplicate
    board[2][3] = 9;
    board[7][3] = 9; // col duplicate
    board[4][4] = 2;
    board[5][5] = 2; // box duplicate

    const conflicts = SudokuEngine.findConflicts(board);
    assert.ok(conflicts.has('0,0'));
    assert.ok(conflicts.has('0,8'));
    assert.ok(conflicts.has('2,3'));
    assert.ok(conflicts.has('7,3'));
    assert.ok(conflicts.has('4,4'));
    assert.ok(conflicts.has('5,5'));
    assert.equal(conflicts.size, 6);
});

test('Custom sample puzzle is valid, unique, and has no conflicts', () => {
    const sample = '003020600900305001001806400008102900700000008006708200002609500800203009005010300';
    const grid = SudokuEngine.stringToGrid(sample);
    let clues = 0;
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (grid[r][c] !== 0) clues++;
        }
    }
    assert.ok(clues >= 17, `Clues: ${clues}`);
    assert.equal(SudokuEngine.findConflicts(grid).size, 0);

    const res = SudokuEngine.solveBitwiseMRV(grid, 2);
    assert.equal(res.solutionsCount, 1);
    assert.ok(res.solvedBoard);
    assert.equal(SudokuEngine.isBoardCompleteAndValid(res.solvedBoard), true);
});

test('validateCustomBoard accurately handles all validation states', () => {
    // Setup minimal app context
    const fakeApp = {
        customGrid: Array(9).fill(null).map(() => Array(9).fill(0)),
        customCellEls: Array(9).fill(null).map(() => Array(9).fill(null)),
        clearCustomConflictClasses() {},
        lastCustomValidation: null
    };

    // Require app to borrow method
    globalThis.AudioContext = class {};
    globalThis.webkitAudioContext = class {};
    globalThis.tr = (key, params) => globalThis.SudokuI18n.t(key, params);
    const SudokuApp = require('../app.js');
    fakeApp.validateCustomBoard = SudokuApp.prototype.validateCustomBoard;

    // 1. Empty board
    const emptyCheck = fakeApp.validateCustomBoard(false);
    assert.equal(emptyCheck.status, 'empty');
    assert.equal(emptyCheck.valid, false);

    // 2. Conflict board
    fakeApp.customGrid[0][0] = 5;
    fakeApp.customGrid[0][5] = 5;
    const conflictCheck = fakeApp.validateCustomBoard(false);
    assert.equal(conflictCheck.status, 'conflicts');
    assert.equal(conflictCheck.valid, false);
    fakeApp.customGrid[0][5] = 0; // remove duplicate

    // 3. Too few clues (< 17) but solvable
    fakeApp.customGrid[1][1] = 3;
    fakeApp.customGrid[2][2] = 4;
    const tooFewCheck = fakeApp.validateCustomBoard(false);
    assert.equal(tooFewCheck.status, 'too_few');
    assert.equal(tooFewCheck.valid, false);

    // 4. Fully valid unique board
    const sample = '003020600900305001001806400008102900700000008006708200002609500800203009005010300';
    fakeApp.customGrid = SudokuEngine.stringToGrid(sample);
    const uniqueCheck = fakeApp.validateCustomBoard(false);
    assert.equal(uniqueCheck.status, 'unique');
    assert.equal(uniqueCheck.valid, true);
    assert.equal(uniqueCheck.solutionsCount, 1);
    assert.ok(uniqueCheck.solvedBoard);

    // 5. Multiple solutions (sample puzzle with clue at (0,6) removed, has 27 clues >= 17 and exactly 2+ solutions)
    fakeApp.customGrid = SudokuEngine.stringToGrid(sample);
    fakeApp.customGrid[0][6] = 0;
    const multiCheck = fakeApp.validateCustomBoard(false);
    assert.equal(multiCheck.status, 'multiple');
    assert.equal(multiCheck.valid, false);
    assert.ok(multiCheck.solutionsCount > 1);
});

test('player progress includes pencil marks, colors, and proven eliminations', () => {
    const SudokuApp = require('../app.js');
    const emptyBoard = () => Array.from({ length: 9 }, () => Array(9).fill(0));
    const emptyMarks = () => Array.from({ length: 9 }, () => (
        Array.from({ length: 9 }, () => new Set())
    ));
    const fakeApp = {
        initialBoard: emptyBoard(),
        currentBoard: emptyBoard(),
        centerMarks: emptyMarks(),
        cornerMarks: emptyMarks(),
        cellColors: Array.from({ length: 9 }, () => Array(9).fill(null)),
        provenEliminations: new Set()
    };

    assert.equal(SudokuApp.prototype.hasGameProgress.call(fakeApp), false);
    fakeApp.centerMarks[0][0].add(4);
    assert.equal(SudokuApp.prototype.hasGameProgress.call(fakeApp), true);
    fakeApp.centerMarks[0][0].clear();
    fakeApp.cellColors[4][4] = 'blue';
    assert.equal(SudokuApp.prototype.hasGameProgress.call(fakeApp), true);
    fakeApp.cellColors[4][4] = null;
    fakeApp.provenEliminations.add('1,1,7');
    assert.equal(SudokuApp.prototype.hasGameProgress.call(fakeApp), true);
});

test('pruned candidate snapshots survive JSON persistence', () => {
    const SudokuApp = require('../app.js');
    const fakeApp = {
        prunedSnapshots: {
            '0,0': {
                cellCenter: new Set([1, 7]),
                cellCorner: new Set([3]),
                affectedCenter: [{ row: 0, col: 1, value: 7 }],
                affectedCorner: [{ row: 1, col: 0, value: 7 }]
            }
        }
    };

    const serialized = SudokuApp.prototype.serializePrunedSnapshots.call(fakeApp);
    const parsed = JSON.parse(JSON.stringify(serialized));
    const restored = SudokuApp.prototype.deserializePrunedSnapshots.call(fakeApp, parsed);
    assert.deepEqual([...restored['0,0'].cellCenter], [1, 7]);
    assert.deepEqual([...restored['0,0'].cellCorner], [3]);
    assert.deepEqual(restored['0,0'].affectedCenter, [{ row: 0, col: 1, value: 7 }]);
    assert.deepEqual(restored['0,0'].affectedCorner, [{ row: 1, col: 0, value: 7 }]);
});

test('timer checkpoint prevents reload rollback for the same puzzle', () => {
    const SudokuApp = require('../app.js');
    const values = new Map();
    globalThis.localStorage = {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, value); }
    };
    const board = parseBoard(globalThis.SUDOKU_PUZZLES.easy[0].puzzle);
    const fakeApp = { initialBoard: board, timerSeconds: 41 };

    SudokuApp.prototype.saveTimerCheckpoint.call(fakeApp);
    fakeApp.timerSeconds = 12;
    SudokuApp.prototype.restoreTimerCheckpoint.call(fakeApp);
    assert.equal(fakeApp.timerSeconds, 41);

    fakeApp.initialBoard = parseBoard(globalThis.SUDOKU_PUZZLES.easy[1].puzzle);
    fakeApp.timerSeconds = 5;
    SudokuApp.prototype.restoreTimerCheckpoint.call(fakeApp);
    assert.equal(fakeApp.timerSeconds, 5);
});

test('modal markup is hidden by default and exposes dialog semantics', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.equal([...html.matchAll(/class="modal-backdrop" hidden aria-hidden="true"/g)].length, 6);
    assert.equal([...html.matchAll(/role="dialog" aria-modal="true"/g)].length, 6);

    const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    assert.match(serviceWorker, /await cache\.put\(/);
});

test('modal focus trap handles initial dialog focus in both directions', () => {
    const SudokuApp = require('../app.js');
    const focused = [];
    const visible = () => ({
        hidden: false,
        getAttribute() { return null; },
        getClientRects() { return [{}]; },
        focus() { focused.push(this); }
    });
    const first = visible();
    const last = visible();
    const dialog = visible();
    const modal = {
        querySelectorAll() { return [first, last]; },
        querySelector() { return dialog; },
        contains(element) { return element === dialog || element === first || element === last; }
    };
    globalThis.document.activeElement = dialog;
    const event = { shiftKey: true, preventDefaultCalled: false, preventDefault() { this.preventDefaultCalled = true; } };

    SudokuApp.prototype.trapModalFocus.call({}, modal, event);
    assert.equal(event.preventDefaultCalled, true);
    assert.equal(focused.at(-1), last);
});

test('non-unique custom games do not reveal an arbitrary solution', () => {
    const SudokuApp = require('../app.js');
    const messages = [];
    const fakeApp = {
        isExecutingCascade: false,
        isPaused: false,
        solutionIsUnique: false,
        showToast(message) { messages.push(message); }
    };

    SudokuApp.prototype.revealCell.call(fakeApp);
    assert.deepEqual(messages, [globalThis.tr('toast.revealNeedsUnique')]);
});

test('non-unique custom games never offer deterministic cascade completion', () => {
    const SudokuApp = require('../app.js');
    const addedClasses = [];
    const fakeApp = {
        cascadeBannerEl: { classList: { add(value) { addedClasses.push(value); } } },
        isPaused: false,
        isExecutingCascade: false,
        cascadeDismissedForCurrentPuzzle: false,
        solutionIsUnique: false,
        pendingCascadeSteps: [{ action: 'stale' }]
    };

    SudokuApp.prototype.checkCascadeAvailability.call(fakeApp);
    assert.equal(fakeApp.pendingCascadeSteps, null);
    assert.deepEqual(addedClasses, ['hidden']);
});

test('checkProgress rejects non-unique puzzles with toast.checkNeedsUnique', () => {
    const SudokuApp = require('../app.js');
    const messages = [];
    const fakeApp = {
        isExecutingCascade: false,
        isPaused: false,
        solutionIsUnique: false,
        showToast(message) { messages.push(message); }
    };

    SudokuApp.prototype.checkProgress.call(fakeApp);
    assert.deepEqual(messages, [globalThis.tr('toast.checkNeedsUnique')]);
});

test('checkProgress informs player when no user entries exist', () => {
    const SudokuApp = require('../app.js');
    const sample = '003020600900305001001806400008102900700000008006708200002609500800203009005010300';
    const grid = SudokuEngine.stringToGrid(sample);
    const messages = [];
    const fakeApp = {
        isExecutingCascade: false,
        isPaused: false,
        solutionIsUnique: true,
        initialBoard: grid.map(r => [...r]),
        currentBoard: grid.map(r => [...r]),
        solutionBoard: SudokuEngine.solve(grid),
        showToast(message) { messages.push(message); }
    };

    SudokuApp.prototype.checkProgress.call(fakeApp);
    assert.deepEqual(messages, [globalThis.tr('toast.checkNoEntries')]);
});

test('checkProgress validates all matching entries, pulses cells and plays chime', () => {
    const SudokuApp = require('../app.js');
    const sample = '003020600900305001001806400008102900700000008006708200002609500800203009005010300';
    const grid = SudokuEngine.stringToGrid(sample);
    const solution = SudokuEngine.solve(grid);
    const messages = [];
    const pulsed = [];
    let playedSuccess = false;
    let visualHighlightsUpdated = false;

    // Fill two correct cells
    const current = grid.map(r => [...r]);
    current[0][0] = solution[0][0];
    current[0][1] = solution[0][1];

    const fakeApp = {
        isExecutingCascade: false,
        isPaused: false,
        solutionIsUnique: true,
        initialBoard: grid.map(r => [...r]),
        currentBoard: current,
        solutionBoard: solution,
        checkedMistakes: new Set(['0,0']),
        audio: { playCheckSuccess() { playedSuccess = true; } },
        showToast(message) { messages.push(message); },
        pulseCell(r, c) { pulsed.push(`${r},${c}`); },
        updateVisualHighlights() { visualHighlightsUpdated = true; }
    };

    SudokuApp.prototype.checkProgress.call(fakeApp);
    assert.equal(messages.length, 1);
    assert.equal(messages[0], globalThis.tr('toast.checkAllCorrect', { count: 2 }));
    assert.equal(playedSuccess, true);
    assert.equal(visualHighlightsUpdated, true);
    assert.deepEqual(pulsed.sort(), ['0,0', '0,1']);
    assert.equal(fakeApp.checkedMistakes.size, 0);
});

test('checkProgress detects mismatches, sets checkedMistakes, shakes cells and selects first mistake', () => {
    const SudokuApp = require('../app.js');
    const sample = '003020600900305001001806400008102900700000008006708200002609500800203009005010300';
    const grid = SudokuEngine.stringToGrid(sample);
    const solution = SudokuEngine.solve(grid);
    const messages = [];
    const shaken = [];
    let selected = null;
    let playedConflict = false;
    let visualHighlightsUpdated = false;

    // One correct entry, one wrong entry
    const current = grid.map(r => [...r]);
    current[0][0] = solution[0][0]; // correct
    const wrongVal = solution[0][1] === 9 ? 1 : solution[0][1] + 1;
    current[0][1] = wrongVal; // wrong

    const fakeApp = {
        isExecutingCascade: false,
        isPaused: false,
        solutionIsUnique: true,
        initialBoard: grid.map(r => [...r]),
        currentBoard: current,
        solutionBoard: solution,
        checkedMistakes: new Set(),
        audio: { playConflict() { playedConflict = true; } },
        showToast(message) { messages.push(message); },
        shakeCell(r, c) { shaken.push(`${r},${c}`); },
        selectCell(r, c) { selected = { row: r, col: c }; },
        updateVisualHighlights() { visualHighlightsUpdated = true; }
    };

    SudokuApp.prototype.checkProgress.call(fakeApp);
    assert.equal(messages.length, 1);
    assert.equal(messages[0], globalThis.tr('toast.checkMistakesFound', { count: 1 }));
    assert.equal(playedConflict, true);
    assert.equal(visualHighlightsUpdated, true);
    assert.deepEqual(shaken, ['0,1']);
    assert.deepEqual(selected, { row: 0, col: 1 });
    assert.ok(fakeApp.checkedMistakes.has('0,1'));
});

test('index.html contains #btn-check-progress and shortcut V in keyboard-helper', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="btn-check-progress"/);
    assert.match(html, /data-i18n="assist\.checkTitle"/);
    assert.match(html, /data-i18n="keyboard\.check"/);
    assert.match(html, /<kbd>V<\/kbd>/);
});

test('renderCellContent marks revealed cells with .revealed class when highlightRevealed is enabled', () => {
    const SudokuApp = require('../app.js');
    const classNames = [];
    const fakeCell = {
        className: '',
        classList: {
            add(name) { classNames.push(name); },
            remove() {}
        },
        innerHTML: '',
        dataset: {},
        getAttribute() { return null; },
        setAttribute() {}
    };

    const fakeApp = {
        boardEl: { children: [fakeCell] },
        currentBoard: [[5]],
        initialBoard: [[0]],
        cellColors: [[null]],
        centerMarks: [[new Set()]],
        cornerMarks: [[new Set()]],
        revealedCells: new Set(['0,0']),
        settings: { highlightRevealed: true },
        updateCellLabel() {}
    };

    SudokuApp.prototype.renderCellContent.call(fakeApp, 0, 0);
    assert.ok(classNames.includes('user-input'));
    assert.ok(classNames.includes('revealed'));

    // When setting is disabled, .revealed is not added
    classNames.length = 0;
    fakeApp.settings.highlightRevealed = false;
    SudokuApp.prototype.renderCellContent.call(fakeApp, 0, 0);
    assert.ok(classNames.includes('user-input'));
    assert.equal(classNames.includes('revealed'), false);
});

test('index.html contains #set-highlight-revealed in settings modal', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="set-highlight-revealed"/);
    assert.match(html, /data-i18n="settings\.revealedTitle"/);
});

test('index.html contains settings categories tablist and 4 distinct sections', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    // Tablist & tabs
    assert.match(html, /class="settings-tabs"/);
    assert.match(html, /data-tab="all"/);
    assert.match(html, /data-tab="display"/);
    assert.match(html, /data-tab="assists"/);
    assert.match(html, /data-tab="pencils"/);
    assert.match(html, /data-tab="sound"/);

    // 4 sections
    assert.match(html, /data-section="display"/);
    assert.match(html, /data-section="assists"/);
    assert.match(html, /data-section="pencils"/);
    assert.match(html, /data-section="sound"/);

    // Section headers i18n
    assert.match(html, /data-i18n="settings\.sectionDisplay"/);
    assert.match(html, /data-i18n="settings\.sectionAssists"/);
    assert.match(html, /data-i18n="settings\.sectionPencils"/);
    assert.match(html, /data-i18n="settings\.sectionSound"/);
});

test('setSettingsActiveTab updates active class, aria-selected and data-active-tab', () => {
    const SudokuApp = require('../app.js');
    const tabs = [
        { dataset: { tab: 'all' }, classList: new Set(['active']), setAttribute(attr, val) { this[attr] = val; } },
        { dataset: { tab: 'display' }, classList: new Set(), setAttribute(attr, val) { this[attr] = val; } },
        { dataset: { tab: 'assists' }, classList: new Set(), setAttribute(attr, val) { this[attr] = val; } }
    ];
    // helper wrapper for classList
    tabs.forEach(t => {
        t.classList.toggle = function(cls, force) {
            if (force) this.add(cls); else this.delete(cls);
        };
    });
    const settingsList = { dataset: { activeTab: 'all' } };

    const originalQuerySelectorAll = globalThis.document?.querySelectorAll;
    const originalQuerySelector = globalThis.document?.querySelector;
    if (!globalThis.document) globalThis.document = {};
    globalThis.document.querySelectorAll = (sel) => {
        if (sel === '.settings-tab') return tabs;
        return [];
    };
    globalThis.document.querySelector = (sel) => {
        if (sel === '.settings-list') return settingsList;
        return null;
    };

    try {
        const fakeApp = {};
        SudokuApp.prototype.setSettingsActiveTab.call(fakeApp, 'display');

        assert.equal(settingsList.dataset.activeTab, 'display');
        assert.equal(tabs[0].classList.has('active'), false);
        assert.equal(tabs[0]['aria-selected'], 'false');
        assert.equal(tabs[1].classList.has('active'), true);
        assert.equal(tabs[1]['aria-selected'], 'true');
        assert.equal(tabs[2].classList.has('active'), false);
        assert.equal(tabs[2]['aria-selected'], 'false');
    } finally {
        if (originalQuerySelectorAll) globalThis.document.querySelectorAll = originalQuerySelectorAll;
        if (originalQuerySelector) globalThis.document.querySelector = originalQuerySelector;
    }
});
