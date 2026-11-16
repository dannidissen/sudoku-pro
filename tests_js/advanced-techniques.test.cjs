const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Guards for the techniques appended after XY-Wing: Skyscraper, Two-String Kite,
// XYZ-Wing, W-Wing and Simple Colouring.

const ROOT = path.resolve(__dirname, '..');

global.window = global.window || {};
require('../puzzles.js');
const SudokuEngine = require('../solver.js');
global.SudokuEngine = SudokuEngine;
const SudokuTraining = require('../training.js');
const recipes = require('../training-recipes.js');

const NEW_TECHNIQUES = ['skyscraper', 'twoStringKite', 'xyzWing', 'wWing', 'simpleColoring'];
const SOLVER_SOURCE = fs.readFileSync(path.join(ROOT, 'solver.js'), 'utf8');

function parseBoard(puzzle) {
    return Array.from({ length: 9 }, (unused, row) =>
        Array.from(puzzle.slice(row * 9, row * 9 + 9), Number));
}

test('the new finders run after XY-Wing, so stored training recipes stay valid', () => {
    const list = SOLVER_SOURCE.slice(
        SOLVER_SOURCE.indexOf('const finders = ['),
        SOLVER_SOURCE.indexOf('];', SOLVER_SOURCE.indexOf('const finders = ['))
    );
    const order = [...list.matchAll(/this\.(find\w+)/g)].map(match => match[1]);

    assert.deepEqual(order.slice(0, 10), [
        'findNakedSingle', 'findHiddenSingle', 'findPointing', 'findClaiming', 'findNakedPair',
        'findHiddenPair', 'findNakedTriple', 'findXWing', 'findSwordfish', 'findXYWing'
    ], 'inserting a finder before XY-Wing changes every recorded drill step');
    assert.deepEqual(order.slice(10), [
        'findSkyscraper', 'findTwoStringKite', 'findXYZWing', 'findWWing', 'findSimpleColoring'
    ]);
});

test('each new finder reports nothing on a board that holds no candidates', () => {
    const solved = SudokuEngine.solve(parseBoard(global.window.SUDOKU_PUZZLES.easy[0].puzzle));
    const candidates = SudokuEngine.getAllCandidates(solved);

    for (const finder of ['findSkyscraper', 'findTwoStringKite', 'findXYZWing', 'findWWing', 'findSimpleColoring']) {
        assert.equal(SudokuEngine[finder](solved, candidates), null, `${finder} invented a pattern`);
    }
});

test('each new technique produces sound, non-empty eliminations on its own drills', () => {
    for (const technique of NEW_TECHNIQUES) {
        assert.ok(recipes[technique], `no drills recorded for ${technique}`);

        for (const recipe of recipes[technique]) {
            const drill = SudokuTraining.create(technique, recipe, global.window.SUDOKU_PUZZLES);
            const solution = SudokuEngine.solveBitwiseMRV(drill.board, 1).solvedBoard;

            assert.equal(drill.hint.action.type, 'eliminate_candidates',
                `${technique} should eliminate candidates rather than place a digit`);
            assert.ok(drill.hint.action.eliminations.length > 0, `${technique} eliminated nothing`);

            for (const { row, col, digit } of drill.hint.action.eliminations) {
                assert.notEqual(digit, solution[row][col],
                    `${technique} removed the solution digit from (${row + 1}, ${col + 1})`);
                assert.ok(drill.candidates[`${row},${col}`].includes(digit),
                    `${technique} removed ${digit} from (${row + 1}, ${col + 1}), where it was not a candidate`);
            }
        }
    }
});

test('the new techniques carry the deductive solver past where it used to stall', () => {
    // Recorded before they were added: these five hard puzzles stalled with the
    // original ten techniques and must stay solvable by logic alone.
    let solved = 0;
    for (let i = 0; i < 30; i++) {
        const entry = global.window.SUDOKU_PUZZLES.hard[i];
        if (SudokuEngine.solveDeductive(parseBoard(entry.puzzle)).success) solved++;
    }
    assert.ok(solved >= 25, `only ${solved} of the first 30 hard puzzles solve by logic alone`);
});

test('every translation key the solver emits exists in all four languages', () => {
    const listeners = new Map();
    global.document = {
        title: '',
        documentElement: { lang: '', dir: '' },
        addEventListener(type, callback) { listeners.set(type, callback); },
        getElementById() { return null; },
        querySelectorAll() { return []; }
    };
    global.localStorage = { getItem() { return null; }, setItem() {} };
    global.CustomEvent = class CustomEvent {
        constructor(type, options) { this.type = type; this.detail = options && options.detail; }
    };
    global.dispatchEvent = () => true;
    require('../i18n.js');

    // puzzles.js and solver.js are loaded with a stub `window`, so i18n.js attaches there.
    const i18n = global.window.SudokuI18n || global.SudokuI18n;
    assert.ok(i18n, 'i18n.js did not expose SudokuI18n');
    const dictionaries = i18n.translations;
    // These keys reach tr() as variables, so the index.html/app.js scan cannot see them.
    const emitted = [...SOLVER_SOURCE.matchAll(/(?:nameKey|stage1Key|stage3Key):\s*'([^']+)'/g)]
        .map(match => match[1]);
    assert.ok(emitted.length >= 45, 'expected a key for every technique stage');

    for (const key of new Set(emitted)) {
        for (const [language, dictionary] of Object.entries(dictionaries)) {
            assert.ok(Object.hasOwn(dictionary, key), `${language} is missing the solver key ${key}`);
        }
    }

    for (const technique of SudokuTraining.techniques) {
        for (const [language, dictionary] of Object.entries(dictionaries)) {
            assert.ok(Object.hasOwn(dictionary, `training.rule.${technique}`),
                `${language} is missing training.rule.${technique}`);
        }
    }
});
