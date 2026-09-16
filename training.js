/** Guided technique drills reconstructed from verified catalogue solving paths. */
class SudokuTraining {
    static techniques = ['nakedSingle', 'hiddenSingle', 'pointing', 'claiming', 'nakedPair',
        'hiddenPair', 'nakedTriple', 'xWing', 'swordfish', 'xyWing'];

    static apply(board, eliminated, hint) {
        const action = hint.action;
        if (action.type === 'set_value') board[action.row][action.col] = action.value;
        else action.eliminations.forEach(({ row, col, digit }) => eliminated.add(`${row},${col},${digit}`));
    }

    // Recipes store a source ID and a deduction count, not a second puzzle dataset.
    // Replaying prior eliminations is essential: legal candidates alone lose the proof.
    static create(technique, recipe, catalogue) {
        const entry = Object.values(catalogue).flat().find(puzzle => puzzle.id === recipe.id);
        if (!entry || !this.techniques.includes(technique)) throw new Error('Unknown training recipe');
        const board = SudokuEngine.stringToGrid(entry.puzzle);
        const eliminated = new Set();
        for (let step = 0; step < recipe.step; step++) {
            const hint = SudokuEngine.getDeductiveHint(board, SudokuEngine.getAllCandidates(board, eliminated));
            if (!hint) throw new Error('Training replay stalled');
            this.apply(board, eliminated, hint);
        }
        const candidates = SudokuEngine.getAllCandidates(board, eliminated);
        const hint = SudokuEngine.getDeductiveHint(board, candidates);
        if (hint?.nameKey !== `hint.${technique}.name`) throw new Error('Training technique changed');
        const action = hint.action;
        const answer = new Set(action.type === 'set_value'
            ? [`${action.row},${action.col},${action.value}`]
            : action.eliminations.map(({ row, col, digit }) => `${row},${col},${digit}`));
        return { board, candidates, hint, answer, sourceId: entry.id };
    }

    static check(exercise, selection) {
        if (!selection.size) return 'empty';
        if ([...selection].some(key => !exercise.answer.has(key))) return 'incorrect';
        return selection.size === exercise.answer.size ? 'correct' : 'incomplete';
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = SudokuTraining;
