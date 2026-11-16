#!/usr/bin/env node
'use strict';

/**
 * Reports how far the deductive hint engine gets on the bundled catalogue.
 *
 *   node tools/measure_deductive.cjs            every difficulty
 *   node tools/measure_deductive.cjs hard       one difficulty
 *
 * "Solved" means the engine finished the board using only its human techniques,
 * with no guessing. The per-technique counts show which finders are earning
 * their place. Use it before and after changing the finder list.
 */

global.window = global.window || {};
require('../puzzles.js');
const SudokuEngine = require('../solver.js');

const CATALOGUE = global.window.SUDOKU_PUZZLES;
const requested = process.argv.slice(2);
const tiers = requested.length > 0 ? requested : Object.keys(CATALOGUE);

const techniqueTotals = new Map();
let overallSolved = 0;
let overallCount = 0;

console.log('difficulty    solved        stalled   avg steps');
console.log('------------------------------------------------');

for (const tier of tiers) {
    const puzzles = CATALOGUE[tier];
    if (!puzzles) {
        console.error(`unknown difficulty: ${tier}`);
        process.exitCode = 1;
        continue;
    }

    let solved = 0;
    let steps = 0;

    for (const entry of puzzles) {
        const result = SudokuEngine.solveDeductive(SudokuEngine.stringToGrid(entry.puzzle));
        if (result.success) solved++;
        steps += result.stepsCount;
        for (const [technique, count] of Object.entries(result.techniquesUsed)) {
            techniqueTotals.set(technique, (techniqueTotals.get(technique) || 0) + count);
        }
    }

    overallSolved += solved;
    overallCount += puzzles.length;
    const pct = (solved / puzzles.length * 100).toFixed(1);
    console.log(
        `${tier.padEnd(12)}  ${String(solved).padStart(3)}/${String(puzzles.length).padEnd(4)} ${pct.padStart(5)}%` +
        `  ${String(puzzles.length - solved).padStart(5)}      ${(steps / puzzles.length).toFixed(1).padStart(6)}`
    );
}

console.log('------------------------------------------------');
console.log(`${'total'.padEnd(12)}  ${String(overallSolved).padStart(3)}/${String(overallCount).padEnd(4)} ` +
    `${(overallSolved / overallCount * 100).toFixed(1).padStart(5)}%`);

console.log('\ntechnique usage across every puzzle attempted:');
for (const [technique, count] of [...techniqueTotals].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${technique.padEnd(26)} ${String(count).padStart(7)}`);
}
