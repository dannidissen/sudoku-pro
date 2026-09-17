/** Three persistent, board-only savepoints scoped to the current game. */
class SudokuCheckpointUI {
    static valid(point, givens) {
        const digit = value => Number.isInteger(value) && value >= 1 && value <= 9;
        const matrix = (value, check) => Array.isArray(value) && value.length === 9
            && value.every(row => Array.isArray(row) && row.length === 9 && row.every(check));
        const marks = value => Array.isArray(value) && value.length <= 9 && value.every(digit);
        const coord = value => Number.isInteger(value) && value >= 0 && value < 9;
        const affected = value => Array.isArray(value) && value.length <= 81
            && value.every(item => item && coord(item.row) && coord(item.col) && digit(item.num));
        const state = point?.state;
        if (!state || point.puzzle !== givens.flat().join('') || !Number.isFinite(point.createdAt)
            || !Number.isInteger(point.seconds) || point.seconds < 0
            || !matrix(state.currentBoard, value => value === 0 || digit(value))
            || !matrix(state.centerMarks, marks) || !matrix(state.cornerMarks, marks)
            || !matrix(state.cellColors, value => value === null || (typeof value === 'string' && value.length <= 40))
            || !Array.isArray(state.provenEliminations) || state.provenEliminations.length > 729
            || !state.provenEliminations.every(key => /^[0-8],[0-8],[1-9]$/.test(key))
            || !state.prunedSnapshots || typeof state.prunedSnapshots !== 'object'
            || Array.isArray(state.prunedSnapshots)) return false;
        if (givens.some((row, r) => row.some((value, c) => value && state.currentBoard[r][c] !== value))) return false;
        return Object.entries(state.prunedSnapshots).every(([key, snapshot]) => /^[0-8],[0-8]$/.test(key)
            && snapshot && marks(snapshot.cellCenter) && marks(snapshot.cellCorner)
            && affected(snapshot.affectedCenter) && affected(snapshot.affectedCorner));
    }

    constructor(app) {
        this.app = app;
        document.getElementById('btn-checkpoints').addEventListener('click', () => {
            if (app.isExecutingCascade) return;
            this.render();
            app.openModal('modal-checkpoints');
        });
        document.getElementById('checkpoint-save').addEventListener('click', () => {
            if (app.isExecutingCascade || app.isPaused || app.checkpoints.length >= 3) return;
            app.checkpoints.push({ puzzle: app.initialBoard.flat().join(''), createdAt: Date.now(),
                seconds: app.timerSeconds, state: app.captureCheckpointState() });
            const persisted = app.saveGameState();
            this.render();
            app.showToast(tr(persisted ? 'checkpoint.saved' : 'checkpoint.sessionOnly'));
        });
        window.addEventListener('sudoku-language-change', () => {
            if (document.getElementById('modal-checkpoints').classList.contains('open')) this.render();
        });
    }

    render() {
        const app = this.app;
        const list = document.getElementById('checkpoint-list');
        list.replaceChildren();
        document.getElementById('checkpoint-save').disabled = app.isPaused || app.checkpoints.length >= 3;
        document.getElementById('checkpoint-empty').hidden = app.checkpoints.length > 0;
        app.checkpoints.forEach((point, index) => {
            const row = document.createElement('div');
            row.className = 'checkpoint-row';
            const title = document.createElement('p');
            title.textContent = tr('checkpoint.entry', { index: index + 1, time: app.formatTime(point.seconds) });
            row.appendChild(title);
            for (const action of ['restore', 'delete']) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'action-btn';
                button.textContent = tr(`checkpoint.${action}`);
                button.setAttribute('aria-label', `${button.textContent}: ${title.textContent}`);
                button.disabled = app.isPaused;
                button.addEventListener('click', () => {
                    if (app.isExecutingCascade || app.isPaused) return;
                    if (action === 'restore') {
                        if (app.restoreCheckpoint(index)) {
                            app.closeModal('modal-checkpoints');
                            app.showToast(tr('checkpoint.restored'));
                        }
                    } else if (confirm(tr('checkpoint.confirmDelete'))) {
                        app.checkpoints.splice(index, 1);
                        const persisted = app.saveGameState();
                        this.render();
                        document.getElementById('checkpoint-save').focus();
                        if (!persisted) app.showToast(tr('checkpoint.sessionOnly'));
                    }
                });
                row.appendChild(button);
            }
            list.appendChild(row);
        });
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = SudokuCheckpointUI;
