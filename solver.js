/**
 * Sudoku Solver, Generator and Engine (Advanced Deductive Edition)
 * Handles board validation, fast backtracking solving, candidate calculation,
 * 5-tier human deductive hint engine (Naked Single, Hidden Single, Pointing, Naked Pair, X-Wing),
 * reveal cell functionality, and generator.
 */
class SudokuEngine {
    /**
     * Check if placing num at board[row][col] is valid
     * @param {number[][]} board 9x9 array
     * @param {number} row 0-8
     * @param {number} col 0-8
     * @param {number} num 1-9
     * @returns {boolean}
     */
    static isValid(board, row, col, num) {
        for (let i = 0; i < 9; i++) {
            if (i !== col && board[row][i] === num) return false;
            if (i !== row && board[i][col] === num) return false;
        }
        const boxRow = Math.floor(row / 3) * 3;
        const boxCol = Math.floor(col / 3) * 3;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const curR = boxRow + r;
                const curC = boxCol + c;
                if ((curR !== row || curC !== col) && board[curR][curC] === num) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Get all legal candidate numbers for a cell given the current board state
     * @param {number[][]} board 9x9 array (0 for empty)
     * @param {number} row 0-8
     * @param {number} col 0-8
     * @returns {number[]} array of candidates 1-9
     */
    static getCandidates(board, row, col) {
        if (board[row][col] !== 0) return [];
        const used = new Set();

        // Row and Col
        for (let i = 0; i < 9; i++) {
            if (board[row][i] !== 0) used.add(board[row][i]);
            if (board[i][col] !== 0) used.add(board[i][col]);
        }

        // 3x3 Box
        const boxRow = Math.floor(row / 3) * 3;
        const boxCol = Math.floor(col / 3) * 3;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const val = board[boxRow + r][boxCol + c];
                if (val !== 0) used.add(val);
            }
        }

        const candidates = [];
        for (let num = 1; num <= 9; num++) {
            if (!used.has(num)) {
                candidates.push(num);
            }
        }
        return candidates;
    }

    /**
     * Calculate candidate pencil marks for ALL empty cells on the board
     * @param {number[][]} board 9x9 array
     * @returns {Object.<string, number[]>} map of 'r,c' -> candidates array
     */
    static getAllCandidates(board) {
        const result = {};
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (board[r][c] === 0) {
                    result[`${r},${c}`] = this.getCandidates(board, r, c);
                }
            }
        }
        return result;
    }

    /**
     * Find all conflicts currently on the board
     * @param {number[][]} board 9x9 array
     * @returns {Set<string>} set of 'r,c' strings for conflicting cells
     */
    static findConflicts(board) {
        const conflicts = new Set();

        // Check rows
        for (let r = 0; r < 9; r++) {
            const seen = new Map();
            for (let c = 0; c < 9; c++) {
                const val = board[r][c];
                if (val !== 0) {
                    if (seen.has(val)) {
                        conflicts.add(`${r},${c}`);
                        conflicts.add(`${r},${seen.get(val)}`);
                    } else {
                        seen.set(val, c);
                    }
                }
            }
        }

        // Check columns
        for (let c = 0; c < 9; c++) {
            const seen = new Map();
            for (let r = 0; r < 9; r++) {
                const val = board[r][c];
                if (val !== 0) {
                    if (seen.has(val)) {
                        conflicts.add(`${r},${c}`);
                        conflicts.add(`${seen.get(val)},${c}`);
                    } else {
                        seen.set(val, r);
                    }
                }
            }
        }

        // Check 3x3 boxes
        for (let boxR = 0; boxR < 3; boxR++) {
            for (let boxC = 0; boxC < 3; boxC++) {
                const seen = new Map();
                for (let r = 0; r < 3; r++) {
                    for (let c = 0; c < 3; c++) {
                        const curR = boxR * 3 + r;
                        const curC = boxC * 3 + c;
                        const val = board[curR][curC];
                        if (val !== 0) {
                            if (seen.has(val)) {
                                conflicts.add(`${curR},${curC}`);
                                conflicts.add(seen.get(val));
                            } else {
                                seen.set(val, `${curR},${curC}`);
                            }
                        }
                    }
                }
            }
        }

        return conflicts;
    }

    /**
     * Solve the board using backtracking with minimum remaining values (MRV) heuristic
     * @param {number[][]} board 9x9 array
     * @param {boolean} randomize whether to randomize candidate order (for puzzle generation)
     * @returns {number[][]|null} solved board or null if unsolvable
     */
    static solve(board, randomize = false) {
        const copy = board.map(row => [...row]);

        function solveInternal() {
            let bestR = -1;
            let bestC = -1;
            let minCandidates = 10;
            let bestCandidates = null;

            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (copy[r][c] === 0) {
                        const candidates = SudokuEngine.getCandidates(copy, r, c);
                        if (candidates.length === 0) {
                            return false; // dead end
                        }
                        if (candidates.length < minCandidates) {
                            minCandidates = candidates.length;
                            bestCandidates = candidates;
                            bestR = r;
                            bestC = c;
                            if (minCandidates === 1) break;
                        }
                    }
                }
                if (minCandidates === 1) break;
            }

            if (bestR === -1) {
                return true; // solved!
            }

            const candidatesList = randomize 
                ? [...bestCandidates].sort(() => Math.random() - 0.5) 
                : bestCandidates;

            for (const num of candidatesList) {
                copy[bestR][bestC] = num;
                if (solveInternal()) {
                    return true;
                }
                copy[bestR][bestC] = 0;
            }

            return false;
        }

        return solveInternal() ? copy : null;
    }

    /**
     * Count solutions up to maxCount (for uniqueness verification)
     * @param {number[][]} board 
     * @param {number} maxCount 
     * @returns {number}
     */
    static countSolutions(board, maxCount = 2) {
        const copy = board.map(row => [...row]);
        let count = 0;

        function search() {
            let bestR = -1;
            let bestC = -1;
            let minCandidates = 10;
            let bestCandidates = null;

            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (copy[r][c] === 0) {
                        const candidates = SudokuEngine.getCandidates(copy, r, c);
                        if (candidates.length === 0) return;
                        if (candidates.length < minCandidates) {
                            minCandidates = candidates.length;
                            bestCandidates = candidates;
                            bestR = r;
                            bestC = c;
                            if (minCandidates === 1) break;
                        }
                    }
                }
                if (minCandidates === 1) break;
            }

            if (bestR === -1) {
                count++;
                return;
            }

            for (const num of bestCandidates) {
                copy[bestR][bestC] = num;
                search();
                copy[bestR][bestC] = 0;
                if (count >= maxCount) return;
            }
        }

        search();
        return count;
    }

    /**
     * Generate a new random puzzle dynamically
     * @param {'easy'|'medium'|'hard'|'expert'} difficulty
     * @returns {{puzzle: string, solution: string}}
     */
    static generate(difficulty = 'medium') {
        const empty = Array(9).fill(null).map(() => Array(9).fill(0));
        const solved = this.solve(empty, true);
        if (!solved) return null;

        const puzzle = solved.map(r => [...r]);
        const cells = [];
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                cells.push([r, c]);
            }
        }
        cells.sort(() => Math.random() - 0.5);

        const cluesTarget = {
            easy: 38,
            medium: 32,
            hard: 28,
            expert: 24
        }[difficulty] || 32;

        let clues = 81;
        for (const [r, c] of cells) {
            if (clues <= cluesTarget) break;
            const backup = puzzle[r][c];
            puzzle[r][c] = 0;

            if (this.countSolutions(puzzle, 2) !== 1) {
                puzzle[r][c] = backup;
            } else {
                clues--;
            }
        }

        return {
            puzzle: this.gridToString(puzzle),
            solution: this.gridToString(solved)
        };
    }

    // =========================================================================
    // DEDUCTIVE HINT ENGINE (3-STAGE HUMAN LOGIC)
    // =========================================================================

    /**
     * 1. Naked Single: A cell has exactly 1 legal candidate.
     */
    static findNakedSingle(board, candidatesMap) {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (board[r][c] === 0) {
                    const cands = candidatesMap[`${r},${c}`] || [];
                    if (cands.length === 1) {
                        const val = cands[0];
                        const boxIdx = Math.floor(r / 3) * 3 + Math.floor(c / 3);
                        return {
                            technique: 'Naked Single',
                            nameKey: 'hint.nakedSingle.name',
                            nameHebrew: 'ספרה גלויה יחידה (Naked Single)',
                            stage1Key: 'hint.nakedSingle.direction',
                            stage1Params: { box: boxIdx + 1, row: r + 1, col: c + 1 },
                            stage1Direction: `חפש תא עם מועמד יחיד בבלוק ${boxIdx + 1} (שורה ${r + 1}, טור ${c + 1})`,
                            stage2Highlight: {
                                cells: [{ row: r, col: c, role: 'primary' }],
                                units: [
                                    { type: 'row', index: r },
                                    { type: 'col', index: c },
                                    { type: 'box', index: boxIdx }
                                ],
                                digits: [val]
                            },
                            stage3Key: 'hint.nakedSingle.explanation',
                            stage3Params: { row: r + 1, col: c + 1, value: val },
                            stage3Explanation: `התא בשורה ${r + 1}, טור ${c + 1} "רואה" את כל שאר הספרות (1-9) באותה שורה, טור או בלוק. לכן הספרה היחידה האפשרית עבורו היא ${val}.`,
                            action: {
                                type: 'set_value',
                                row: r,
                                col: c,
                                value: val
                            }
                        };
                    }
                }
            }
        }
        return null;
    }

    /**
     * 2. Hidden Single: A digit can only appear in ONE cell in a row, column, or 3x3 block.
     */
    static findHiddenSingle(board, candidatesMap) {
        // Check blocks first (easiest for humans to see)
        for (let b = 0; b < 9; b++) {
            const bR = Math.floor(b / 3) * 3;
            const bC = (b % 3) * 3;
            for (let d = 1; d <= 9; d++) {
                let cellPossibilities = [];
                for (let r = 0; r < 3; r++) {
                    for (let c = 0; c < 3; c++) {
                        const row = bR + r;
                        const col = bC + c;
                        if (board[row][col] === 0) {
                            const cands = candidatesMap[`${row},${col}`] || [];
                            if (cands.includes(d)) {
                                cellPossibilities.push({ r: row, c: col });
                            }
                        }
                    }
                }
                if (cellPossibilities.length === 1) {
                    const target = cellPossibilities[0];
                    return {
                        technique: 'Hidden Single',
                        nameKey: 'hint.hiddenSingle.name',
                        nameHebrew: 'ספרה נסתרת יחידה (Hidden Single)',
                        stage1Key: 'hint.hiddenSingle.boxDirection',
                        stage1Params: { digit: d, box: b + 1 },
                        stage1Direction: `חפש Hidden Single עבור הספרה ${d} בבלוק ${b + 1}`,
                        stage2Highlight: {
                            cells: [{ row: target.r, col: target.c, role: 'primary' }],
                            units: [{ type: 'box', index: b }],
                            digits: [d]
                        },
                        stage3Key: 'hint.hiddenSingle.boxExplanation',
                        stage3Params: { box: b + 1, digit: d, row: target.r + 1, col: target.c + 1 },
                        stage3Explanation: `בבלוק ${b + 1}, הספרה ${d} אינה יכולה להתאים לאף תא אחר (הם נחסמים ע"י שורות וטורים חופפים). לפיכך ${d} חייבת להיות בתא בשורה ${target.r + 1}, טור ${target.c + 1}.`,
                        action: {
                            type: 'set_value',
                            row: target.r,
                            col: target.c,
                            value: d
                        }
                    };
                }
            }
        }

        // Check rows
        for (let r = 0; r < 9; r++) {
            for (let d = 1; d <= 9; d++) {
                let cellPossibilities = [];
                for (let c = 0; c < 9; c++) {
                    if (board[r][c] === 0) {
                        const cands = candidatesMap[`${r},${c}`] || [];
                        if (cands.includes(d)) {
                            cellPossibilities.push({ r, c });
                        }
                    }
                }
                if (cellPossibilities.length === 1) {
                    const target = cellPossibilities[0];
                    return {
                        technique: 'Hidden Single',
                        nameKey: 'hint.hiddenSingle.name',
                        nameHebrew: 'ספרה נסתרת יחידה (Hidden Single)',
                        stage1Key: 'hint.hiddenSingle.rowDirection',
                        stage1Params: { digit: d, row: r + 1 },
                        stage1Direction: `חפש Hidden Single עבור הספרה ${d} בשורה ${r + 1}`,
                        stage2Highlight: {
                            cells: [{ row: target.r, col: target.c, role: 'primary' }],
                            units: [{ type: 'row', index: r }],
                            digits: [d]
                        },
                        stage3Key: 'hint.hiddenSingle.rowExplanation',
                        stage3Params: { row: r + 1, digit: d, col: target.c + 1 },
                        stage3Explanation: `בשורה ${r + 1}, התא היחיד שיכול להכיל את הספרה ${d} הוא טור ${target.c + 1} (בכל שאר התאים ${d} נפסלת). לכן ${d} משובצת כאן.`,
                        action: {
                            type: 'set_value',
                            row: target.r,
                            col: target.c,
                            value: d
                        }
                    };
                }
            }
        }

        // Check columns
        for (let c = 0; c < 9; c++) {
            for (let d = 1; d <= 9; d++) {
                let cellPossibilities = [];
                for (let r = 0; r < 9; r++) {
                    if (board[r][c] === 0) {
                        const cands = candidatesMap[`${r},${c}`] || [];
                        if (cands.includes(d)) {
                            cellPossibilities.push({ r, c });
                        }
                    }
                }
                if (cellPossibilities.length === 1) {
                    const target = cellPossibilities[0];
                    return {
                        technique: 'Hidden Single',
                        nameKey: 'hint.hiddenSingle.name',
                        nameHebrew: 'ספרה נסתרת יחידה (Hidden Single)',
                        stage1Key: 'hint.hiddenSingle.colDirection',
                        stage1Params: { digit: d, col: c + 1 },
                        stage1Direction: `חפש Hidden Single עבור הספרה ${d} בטור ${c + 1}`,
                        stage2Highlight: {
                            cells: [{ row: target.r, col: target.c, role: 'primary' }],
                            units: [{ type: 'col', index: c }],
                            digits: [d]
                        },
                        stage3Key: 'hint.hiddenSingle.colExplanation',
                        stage3Params: { col: c + 1, digit: d, row: target.r + 1 },
                        stage3Explanation: `בטור ${c + 1}, התא היחיד שיכול להכיל את הספרה ${d} הוא שורה ${target.r + 1}. לכן ${d} חייבת להופיע בתא זה.`,
                        action: {
                            type: 'set_value',
                            row: target.r,
                            col: target.c,
                            value: d
                        }
                    };
                }
            }
        }

        return null;
    }

    /**
     * 3. Pointing Pairs / Triples: In a 3x3 block, all candidates for digit d lie in the same row or column.
     * Candidate d can therefore be eliminated from the rest of that row or column outside the block.
     */
    static findPointing(board, candidatesMap) {
        for (let b = 0; b < 9; b++) {
            const bR = Math.floor(b / 3) * 3;
            const bC = (b % 3) * 3;

            for (let d = 1; d <= 9; d++) {
                const blockCellsWithD = [];
                for (let r = 0; r < 3; r++) {
                    for (let c = 0; c < 3; c++) {
                        const row = bR + r;
                        const col = bC + c;
                        if (board[row][col] === 0) {
                            const cands = candidatesMap[`${row},${col}`] || [];
                            if (cands.includes(d)) {
                                blockCellsWithD.push({ r: row, c: col });
                            }
                        }
                    }
                }

                if (blockCellsWithD.length >= 2 && blockCellsWithD.length <= 3) {
                    // Check if all cells share the same row
                    const firstRow = blockCellsWithD[0].r;
                    const sameRow = blockCellsWithD.every(cell => cell.r === firstRow);

                    if (sameRow) {
                        // Look for eliminations in firstRow outside block b
                        const eliminations = [];
                        for (let col = 0; col < 9; col++) {
                            const inCurrentBlock = col >= bC && col < bC + 3;
                            if (!inCurrentBlock && board[firstRow][col] === 0) {
                                const cands = candidatesMap[`${firstRow},${col}`] || [];
                                if (cands.includes(d)) {
                                    eliminations.push({ row: firstRow, col, digit: d });
                                }
                            }
                        }

                        if (eliminations.length > 0) {
                            return {
                                technique: 'Pointing Pair / Triple',
                                nameKey: 'hint.pointing.name',
                                nameHebrew: 'זוג/שלשה מכוונת (Pointing)',
                                stage1Key: 'hint.pointing.rowDirection',
                                stage1Params: { digit: d, box: b + 1, row: firstRow + 1 },
                                stage1Direction: `חפש Pointing של הספרה ${d} בבלוק ${b + 1} (המשפיע על שורה ${firstRow + 1})`,
                                stage2Highlight: {
                                    cells: blockCellsWithD.map(cell => ({ row: cell.r, col: cell.c, role: 'primary' })),
                                    units: [{ type: 'row', index: firstRow }, { type: 'box', index: b }],
                                    digits: [d]
                                },
                                stage3Key: 'hint.pointing.rowExplanation',
                                stage3Params: { box: b + 1, digit: d, row: firstRow + 1, count: eliminations.length },
                                stage3Explanation: `בבלוק ${b + 1}, כל המועמדים לספרה ${d} נמצאים בשורה ${firstRow + 1} בלבד. לפיכך ${d} חייבת להיות באחד מהם בתוך הבלוק, וניתן למחוק את ${d} מכל שאר התאים בשורה ${firstRow + 1} שמחוץ לבלוק (${eliminations.length} מחיקות).`,
                                action: {
                                    type: 'eliminate_candidates',
                                    eliminations
                                }
                            };
                        }
                    }

                    // Check if all cells share the same column
                    const firstCol = blockCellsWithD[0].c;
                    const sameCol = blockCellsWithD.every(cell => cell.c === firstCol);

                    if (sameCol) {
                        const eliminations = [];
                        for (let row = 0; row < 9; row++) {
                            const inCurrentBlock = row >= bR && row < bR + 3;
                            if (!inCurrentBlock && board[row][firstCol] === 0) {
                                const cands = candidatesMap[`${row},${firstCol}`] || [];
                                if (cands.includes(d)) {
                                    eliminations.push({ row, col: firstCol, digit: d });
                                }
                            }
                        }

                        if (eliminations.length > 0) {
                            return {
                                technique: 'Pointing Pair / Triple',
                                nameKey: 'hint.pointing.name',
                                nameHebrew: 'זוג/שלשה מכוונת (Pointing)',
                                stage1Key: 'hint.pointing.colDirection',
                                stage1Params: { digit: d, box: b + 1, col: firstCol + 1 },
                                stage1Direction: `חפש Pointing של הספרה ${d} בבלוק ${b + 1} (המשפיע על טור ${firstCol + 1})`,
                                stage2Highlight: {
                                    cells: blockCellsWithD.map(cell => ({ row: cell.r, col: cell.c, role: 'primary' })),
                                    units: [{ type: 'col', index: firstCol }, { type: 'box', index: b }],
                                    digits: [d]
                                },
                                stage3Key: 'hint.pointing.colExplanation',
                                stage3Params: { box: b + 1, digit: d, col: firstCol + 1, count: eliminations.length },
                                stage3Explanation: `בבלוק ${b + 1}, כל המועמדים לספרה ${d} נמצאים בטור ${firstCol + 1} בלבד. לכן ${d} נעולה בטור זה בתוך הבלוק, וניתן למחוק את ${d} מכל שאר התאים בטור ${firstCol + 1} שמחוץ לבלוק (${eliminations.length} מחיקות).`,
                                action: {
                                    type: 'eliminate_candidates',
                                    eliminations
                                }
                            };
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * 4. Naked Pairs: Two cells in a unit contain only the exact same 2 candidates.
     * Those 2 digits can be eliminated from all other cells in that unit.
     */
    static findNakedPair(board, candidatesMap) {
        const units = [];

        // Rows
        for (let r = 0; r < 9; r++) {
            units.push({
                type: 'row',
                index: r,
                nameHebrew: `שורה ${r + 1}`,
                cells: Array.from({ length: 9 }, (_, c) => ({ r, c }))
            });
        }
        // Columns
        for (let c = 0; c < 9; c++) {
            units.push({
                type: 'col',
                index: c,
                nameHebrew: `טור ${c + 1}`,
                cells: Array.from({ length: 9 }, (_, r) => ({ r, c }))
            });
        }
        // Blocks
        for (let b = 0; b < 9; b++) {
            const bR = Math.floor(b / 3) * 3;
            const bC = (b % 3) * 3;
            const cells = [];
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 3; c++) {
                    cells.push({ r: bR + r, c: bC + c });
                }
            }
            units.push({
                type: 'box',
                index: b,
                nameHebrew: `בלוק ${b + 1}`,
                cells
            });
        }

        for (const unit of units) {
            const pairs = [];
            for (const { r, c } of unit.cells) {
                if (board[r][c] === 0) {
                    const cands = candidatesMap[`${r},${c}`] || [];
                    if (cands.length === 2) {
                        pairs.push({ r, c, cands });
                    }
                }
            }

            for (let i = 0; i < pairs.length; i++) {
                for (let j = i + 1; j < pairs.length; j++) {
                    const p1 = pairs[i];
                    const p2 = pairs[j];
                    if (p1.cands[0] === p2.cands[0] && p1.cands[1] === p2.cands[1]) {
                        const d1 = p1.cands[0];
                        const d2 = p1.cands[1];

                        // Find eliminations in other cells of the unit
                        const eliminations = [];
                        for (const { r, c } of unit.cells) {
                            const isPairCell = (r === p1.r && c === p1.c) || (r === p2.r && c === p2.c);
                            if (!isPairCell && board[r][c] === 0) {
                                const cands = candidatesMap[`${r},${c}`] || [];
                                if (cands.includes(d1)) eliminations.push({ row: r, col: c, digit: d1 });
                                if (cands.includes(d2)) eliminations.push({ row: r, col: c, digit: d2 });
                            }
                        }

                        if (eliminations.length > 0) {
                            return {
                                technique: 'Naked Pair',
                                nameKey: 'hint.nakedPair.name',
                                nameHebrew: 'זוג גלוי (Naked Pair)',
                                stage1Key: 'hint.nakedPair.direction',
                                stage1Params: { unitType: unit.type, unitIndex: unit.index + 1 },
                                stage1Direction: `חפש Naked Pair (זוג גלוי) ב${unit.nameHebrew}`,
                                stage2Highlight: {
                                    cells: [
                                        { row: p1.r, col: p1.c, role: 'primary' },
                                        { row: p2.r, col: p2.c, role: 'primary' }
                                    ],
                                    units: [{ type: unit.type, index: unit.index }],
                                    digits: [d1, d2]
                                },
                                stage3Key: 'hint.nakedPair.explanation',
                                stage3Params: {
                                    unitType: unit.type,
                                    unitIndex: unit.index + 1,
                                    row1: p1.r + 1,
                                    col1: p1.c + 1,
                                    row2: p2.r + 1,
                                    col2: p2.c + 1,
                                    digit1: d1,
                                    digit2: d2,
                                    count: eliminations.length
                                },
                                stage3Explanation: `התאים (${p1.r + 1}, ${p1.c + 1}) ו-(${p2.r + 1}, ${p2.c + 1}) ב${unit.nameHebrew} מכילים אך ורק את הספרות ${d1} ו-${d2}. שתי ספרות אלו נעולות בשני תאים אלו, וניתן למחוק אותן מכל שאר התאים ב${unit.nameHebrew} (${eliminations.length} מחיקות).`,
                                action: {
                                    type: 'eliminate_candidates',
                                    eliminations
                                }
                            };
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * 5. X-Wing: A digit appears in only 2 positions in 2 different rows, and both share the exact same 2 columns.
     * The digit can be eliminated from those 2 columns in all other rows. (And symmetrically for columns).
     */
    static findXWing(board, candidatesMap) {
        // Row-based X-Wing (eliminates from columns)
        for (let d = 1; d <= 9; d++) {
            const rowCandCols = [];
            for (let r = 0; r < 9; r++) {
                const colsWithD = [];
                for (let c = 0; c < 9; c++) {
                    if (board[r][c] === 0) {
                        const cands = candidatesMap[`${r},${c}`] || [];
                        if (cands.includes(d)) colsWithD.push(c);
                    }
                }
                if (colsWithD.length === 2) {
                    rowCandCols.push({ r, c1: colsWithD[0], c2: colsWithD[1] });
                }
            }

            for (let i = 0; i < rowCandCols.length; i++) {
                for (let j = i + 1; j < rowCandCols.length; j++) {
                    const r1 = rowCandCols[i];
                    const r2 = rowCandCols[j];
                    if (r1.c1 === r2.c1 && r1.c2 === r2.c2) {
                        const colA = r1.c1;
                        const colB = r1.c2;

                        const eliminations = [];
                        for (let r = 0; r < 9; r++) {
                            if (r !== r1.r && r !== r2.r) {
                                if (board[r][colA] === 0) {
                                    const cands = candidatesMap[`${r},${colA}`] || [];
                                    if (cands.includes(d)) eliminations.push({ row: r, col: colA, digit: d });
                                }
                                if (board[r][colB] === 0) {
                                    const cands = candidatesMap[`${r},${colB}`] || [];
                                    if (cands.includes(d)) eliminations.push({ row: r, col: colB, digit: d });
                                }
                            }
                        }

                        if (eliminations.length > 0) {
                            return {
                                technique: 'X-Wing',
                                nameKey: 'hint.xWing.name',
                                nameHebrew: 'כנף X (X-Wing)',
                                stage1Key: 'hint.xWing.rowsDirection',
                                stage1Params: { digit: d, row1: r1.r + 1, row2: r2.r + 1 },
                                stage1Direction: `חפש מבנה X-Wing עבור הספרה ${d} בשורות ${r1.r + 1} ו-${r2.r + 1}`,
                                stage2Highlight: {
                                    cells: [
                                        { row: r1.r, col: colA, role: 'primary' },
                                        { row: r1.r, col: colB, role: 'primary' },
                                        { row: r2.r, col: colA, role: 'primary' },
                                        { row: r2.r, col: colB, role: 'primary' }
                                    ],
                                    units: [
                                        { type: 'row', index: r1.r },
                                        { type: 'row', index: r2.r },
                                        { type: 'col', index: colA },
                                        { type: 'col', index: colB }
                                    ],
                                    digits: [d]
                                },
                                stage3Key: 'hint.xWing.rowsExplanation',
                                stage3Params: { digit: d, row1: r1.r + 1, row2: r2.r + 1, col1: colA + 1, col2: colB + 1, count: eliminations.length },
                                stage3Explanation: `הספרה ${d} מופיעה בשורות ${r1.r + 1} ו-${r2.r + 1} רק בטורים ${colA + 1} ו-${colB + 1}. נוצר מלבן X-Wing הנועל את ${d} בשני טורים אלו. לפיכך ניתן למחוק את ${d} משאר התאים בטורים אלו (${eliminations.length} מחיקות).`,
                                action: {
                                    type: 'eliminate_candidates',
                                    eliminations
                                }
                            };
                        }
                    }
                }
            }
        }

        // Column-based X-Wing (eliminates from rows)
        for (let d = 1; d <= 9; d++) {
            const colCandRows = [];
            for (let c = 0; c < 9; c++) {
                const rowsWithD = [];
                for (let r = 0; r < 9; r++) {
                    if (board[r][c] === 0) {
                        const cands = candidatesMap[`${r},${c}`] || [];
                        if (cands.includes(d)) rowsWithD.push(r);
                    }
                }
                if (rowsWithD.length === 2) {
                    colCandRows.push({ c, r1: rowsWithD[0], r2: rowsWithD[1] });
                }
            }

            for (let i = 0; i < colCandRows.length; i++) {
                for (let j = i + 1; j < colCandRows.length; j++) {
                    const c1 = colCandRows[i];
                    const c2 = colCandRows[j];
                    if (c1.r1 === c2.r1 && c1.r2 === c2.r2) {
                        const rowA = c1.r1;
                        const rowB = c1.r2;

                        const eliminations = [];
                        for (let c = 0; c < 9; c++) {
                            if (c !== c1.c && c !== c2.c) {
                                if (board[rowA][c] === 0) {
                                    const cands = candidatesMap[`${rowA},${c}`] || [];
                                    if (cands.includes(d)) eliminations.push({ row: rowA, col: c, digit: d });
                                }
                                if (board[rowB][c] === 0) {
                                    const cands = candidatesMap[`${rowB},${c}`] || [];
                                    if (cands.includes(d)) eliminations.push({ row: rowB, col: c, digit: d });
                                }
                            }
                        }

                        if (eliminations.length > 0) {
                            return {
                                technique: 'X-Wing',
                                nameKey: 'hint.xWing.name',
                                nameHebrew: 'כנף X (X-Wing)',
                                stage1Key: 'hint.xWing.colsDirection',
                                stage1Params: { digit: d, col1: c1.c + 1, col2: c2.c + 1 },
                                stage1Direction: `חפש מבנה X-Wing עבור הספרה ${d} בטורים ${c1.c + 1} ו-${c2.c + 1}`,
                                stage2Highlight: {
                                    cells: [
                                        { row: rowA, col: c1.c, role: 'primary' },
                                        { row: rowB, col: c1.c, role: 'primary' },
                                        { row: rowA, col: c2.c, role: 'primary' },
                                        { row: rowB, col: c2.c, role: 'primary' }
                                    ],
                                    units: [
                                        { type: 'col', index: c1.c },
                                        { type: 'col', index: c2.c },
                                        { type: 'row', index: rowA },
                                        { type: 'row', index: rowB }
                                    ],
                                    digits: [d]
                                },
                                stage3Key: 'hint.xWing.colsExplanation',
                                stage3Params: { digit: d, col1: c1.c + 1, col2: c2.c + 1, row1: rowA + 1, row2: rowB + 1, count: eliminations.length },
                                stage3Explanation: `הספרה ${d} מופיעה בטורים ${c1.c + 1} ו-${c2.c + 1} רק בשורות ${rowA + 1} ו-${rowB + 1}. נוצר מלבן X-Wing הנועל את ${d} בשתי שורות אלו. לפיכך ניתן למחוק את ${d} משאר התאים בשורות אלו (${eliminations.length} מחיקות).`,
                                action: {
                                    type: 'eliminate_candidates',
                                    eliminations
                                }
                            };
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Master Deductive Hint Method
     * Runs human deductive strategies in increasing order of difficulty.
     * @param {number[][]} board
     * @param {Object.<string, number[]>} candidatesMap
     * @returns {Object|null}
     */
    static getDeductiveHint(board, candidatesMap) {
        // 1. Naked Single
        const nakedSingle = this.findNakedSingle(board, candidatesMap);
        if (nakedSingle) return nakedSingle;

        // 2. Hidden Single
        const hiddenSingle = this.findHiddenSingle(board, candidatesMap);
        if (hiddenSingle) return hiddenSingle;

        // 3. Pointing Pairs/Triples
        const pointing = this.findPointing(board, candidatesMap);
        if (pointing) return pointing;

        // 4. Naked Pairs
        const nakedPair = this.findNakedPair(board, candidatesMap);
        if (nakedPair) return nakedPair;

        // 5. X-Wing
        const xWing = this.findXWing(board, candidatesMap);
        if (xWing) return xWing;

        return null;
    }

    /**
     * Reveal Cell: Direct solution lookup for selected cell or random empty cell.
     * @param {number[][]} currentBoard
     * @param {number[][]} solvedBoard
     * @param {{row: number, col: number}|null} selectedCell
     * @returns {{row: number, col: number, value: number, reason: string}|null}
     */
    static getRevealHint(currentBoard, solvedBoard, selectedCell = null) {
        if (!solvedBoard) return null;

        if (selectedCell && currentBoard[selectedCell.row][selectedCell.col] === 0) {
            const r = selectedCell.row;
            const c = selectedCell.col;
            return {
                row: r,
                col: c,
                value: solvedBoard[r][c],
                reason: `המספר הנכון לתא (${r + 1}, ${c + 1}) מתוך הפתרון המלא הוא ${solvedBoard[r][c]}.`
            };
        }

        const emptyCells = [];
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (currentBoard[r][c] === 0) {
                    emptyCells.push({ r, c });
                }
            }
        }

        if (emptyCells.length === 0) return null;
        const pick = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        return {
            row: pick.r,
            col: pick.c,
            value: solvedBoard[pick.r][pick.c],
            reason: `המספר הנכון לתא (${pick.r + 1}, ${pick.c + 1}) מתוך הפתרון המלא הוא ${solvedBoard[pick.r][pick.c]}.`
        };
    }

    /**
     * Convert 81-character string to 9x9 array
     * @param {string} str 81 chars, 0 or . for empty
     * @returns {number[][]}
     */
    static stringToGrid(str) {
        const grid = [];
        for (let r = 0; r < 9; r++) {
            const row = [];
            for (let c = 0; c < 9; c++) {
                const ch = str[r * 9 + c];
                const num = parseInt(ch, 10);
                row.push(isNaN(num) || num < 1 || num > 9 ? 0 : num);
            }
            grid.push(row);
        }
        return grid;
    }

    /**
     * Convert 9x9 array to 81-character string
     * @param {number[][]} grid
     * @returns {string}
     */
    static gridToString(grid) {
        return grid.map(r => r.map(v => (v === 0 ? '0' : v.toString())).join('')).join('');
    }

    /**
     * Check if remaining empty cells can be completely solved via a deterministic cascade of Singles (Naked & Hidden)
     * Active in the expanded range of 2 to 20 empty cells.
     * @param {number[][]} currentBoard Current 9x9 board state
     * @param {number[][]} solutionBoard Solved 9x9 board state
     * @returns {Array<{row: number, col: number, val: number}>|null} Ordered cascade steps or null
     */
    static checkSinglesCascade(currentBoard, solutionBoard) {
        if (!currentBoard || !solutionBoard) return null;

        // 1. Count empty cells (must be 2 to 20) & check for hidden mistakes in placed numbers
        const emptyCells = [];
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const val = currentBoard[r][c];
                if (val === 0) {
                    emptyCells.push({ r, c });
                } else if (val !== solutionBoard[r][c]) {
                    // Hidden error already present on the board
                    return null;
                }
            }
        }
        const emptyCount = emptyCells.length;
        if (emptyCount < 2 || emptyCount > 20) return null;

        // Ensure no direct conflicts
        if (this.findConflicts(currentBoard).size > 0) return null;

        // 2. Clone board for simulation
        const simBoard = currentBoard.map(row => [...row]);
        const cascadeSteps = [];

        // 3. Deterministic simulation loop (Naked Singles -> Hidden Singles)
        let remaining = emptyCount;
        while (remaining > 0) {
            let found = false;

            // Phase A: Search for Naked Single
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (simBoard[r][c] === 0) {
                        const cands = this.getCandidates(simBoard, r, c);
                        if (cands.length === 1) {
                            const val = cands[0];
                            if (val !== solutionBoard[r][c]) {
                                return null;
                            }
                            simBoard[r][c] = val;
                            cascadeSteps.push({ row: r, col: c, val });
                            remaining--;
                            found = true;
                            break;
                        }
                    }
                }
                if (found) break;
            }

            // Phase B: If no Naked Single found, search for Hidden Single
            if (!found) {
                const candsMap = {};
                for (let r = 0; r < 9; r++) {
                    for (let c = 0; c < 9; c++) {
                        if (simBoard[r][c] === 0) {
                            candsMap[`${r},${c}`] = this.getCandidates(simBoard, r, c);
                        }
                    }
                }

                // Check 3x3 blocks
                for (let b = 0; b < 9 && !found; b++) {
                    const bR = Math.floor(b / 3) * 3;
                    const bC = (b % 3) * 3;
                    for (let d = 1; d <= 9; d++) {
                        let possibleCells = [];
                        let alreadyInUnit = false;
                        for (let r = 0; r < 3; r++) {
                            for (let c = 0; c < 3; c++) {
                                const curR = bR + r;
                                const curC = bC + c;
                                if (simBoard[curR][curC] === d) {
                                    alreadyInUnit = true;
                                    break;
                                }
                                if (simBoard[curR][curC] === 0) {
                                    const cands = candsMap[`${curR},${curC}`];
                                    if (cands && cands.includes(d)) {
                                        possibleCells.push({ r: curR, c: curC });
                                    }
                                }
                            }
                            if (alreadyInUnit) break;
                        }
                        if (!alreadyInUnit && possibleCells.length === 1) {
                            const { r: tr, c: tc } = possibleCells[0];
                            if (d !== solutionBoard[tr][tc]) return null;
                            simBoard[tr][tc] = d;
                            cascadeSteps.push({ row: tr, col: tc, val: d });
                            remaining--;
                            found = true;
                            break;
                        }
                    }
                }

                // Check rows
                for (let r = 0; r < 9 && !found; r++) {
                    for (let d = 1; d <= 9; d++) {
                        let possibleCells = [];
                        let alreadyInUnit = false;
                        for (let c = 0; c < 9; c++) {
                            if (simBoard[r][c] === d) {
                                alreadyInUnit = true;
                                break;
                            }
                            if (simBoard[r][c] === 0) {
                                const cands = candsMap[`${r},${c}`];
                                if (cands && cands.includes(d)) {
                                    possibleCells.push({ r, c });
                                }
                            }
                        }
                        if (!alreadyInUnit && possibleCells.length === 1) {
                            const { r: tr, c: tc } = possibleCells[0];
                            if (d !== solutionBoard[tr][tc]) return null;
                            simBoard[tr][tc] = d;
                            cascadeSteps.push({ row: tr, col: tc, val: d });
                            remaining--;
                            found = true;
                            break;
                        }
                    }
                }

                // Check columns
                for (let c = 0; c < 9 && !found; c++) {
                    for (let d = 1; d <= 9; d++) {
                        let possibleCells = [];
                        let alreadyInUnit = false;
                        for (let r = 0; r < 9; r++) {
                            if (simBoard[r][c] === d) {
                                alreadyInUnit = true;
                                break;
                            }
                            if (simBoard[r][c] === 0) {
                                const cands = candsMap[`${r},${c}`];
                                if (cands && cands.includes(d)) {
                                    possibleCells.push({ r, c });
                                }
                            }
                        }
                        if (!alreadyInUnit && possibleCells.length === 1) {
                            const { r: tr, c: tc } = possibleCells[0];
                            if (d !== solutionBoard[tr][tc]) return null;
                            simBoard[tr][tc] = d;
                            cascadeSteps.push({ row: tr, col: tc, val: d });
                            remaining--;
                            found = true;
                            break;
                        }
                    }
                }
            }

            if (!found) {
                // If there are still empty cells but no single found, cascade cannot finish
                return null;
            }
        }

        return cascadeSteps;
    }

    /**
     * Backward-compatible alias for checkSinglesCascade
     */
    static checkNakedSinglesCascade(currentBoard, solutionBoard) {
        return this.checkSinglesCascade(currentBoard, solutionBoard);
    }

    /**
     * Check if the board is completely and correctly solved
     * @param {number[][]} board
     * @returns {boolean}
     */
    static isBoardCompleteAndValid(board) {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (board[r][c] === 0) return false;
            }
        }
        return this.findConflicts(board).size === 0;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SudokuEngine;
}
