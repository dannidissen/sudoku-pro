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


