// Print deterministic recipes. Run: node tools/find_training_recipes.cjs
// Each technique gets four different source puzzles, retaining catalogue attribution.
global.window = global;
require('../puzzles.js');
const Engine = require('../solver.js');
global.SudokuEngine = Engine;
const Training = require('../training.js');
const recipes = Object.fromEntries(Training.techniques.map(key => [key, []]));
for (const entries of Object.values(SUDOKU_PUZZLES)) {
    for (const entry of entries) {
        const seen = new Set();
        let step = 0;
        Engine.solveDeductive(Engine.stringToGrid(entry.puzzle), { onStep(hint) {
            const key = hint.nameKey.split('.')[1];
            if (recipes[key].length < 4 && !seen.has(key)) {
                recipes[key].push({ id: entry.id, step });
                seen.add(key);
            }
            step++;
        } });
        if (Object.values(recipes).every(items => items.length === 4)) break;
    }
    if (Object.values(recipes).every(items => items.length === 4)) break;
}
if (Object.values(recipes).some(items => items.length !== 4)) throw new Error('Insufficient drills');
console.log(JSON.stringify(recipes, null, 2));
