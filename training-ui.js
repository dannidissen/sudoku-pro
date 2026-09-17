/** Isolated practice UI. All mutations belong to the drill, never the player's board. */
class SudokuTrainingUI {
    constructor(app) {
        this.app = app;
        this.indexes = {};
        this.completed = new Set();
        this.independentCompleted = new Set();
        this.el = id => document.getElementById(`training-${id}`);
        this.select = this.el('technique');
        for (const key of SudokuTraining.techniques) {
            const option = document.createElement('option');
            option.value = key;
            option.dataset.i18n = `hint.${key}.name`;
            option.textContent = tr(option.dataset.i18n);
            this.select.appendChild(option);
        }
        this.cells = Array.from({ length: 81 }, (_, index) => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'training-cell';
            cell.dataset.index = index;
            cell.addEventListener('focus', () => {
                if (this.exercise && this.active !== index) {
                    this.active = index;
                    this.render();
                }
            });
            cell.addEventListener('click', () => this.selectCell(index));
            cell.addEventListener('keydown', event => this.onKey(event, index));
            this.el('board').appendChild(cell);
            return cell;
        });
        this.digits = Array.from({ length: 9 }, (_, i) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'action-btn';
            button.textContent = i + 1;
            button.addEventListener('click', () => this.toggle(i + 1));
            this.el('keypad').appendChild(button);
            return button;
        });
        document.getElementById('btn-training').addEventListener('click', () => {
            if (app.isExecutingCascade) return;
            if (!this.exercise) this.load();
            app.openModal('modal-training');
        });
        this.select.addEventListener('change', () => this.load());
        this.el('mode').addEventListener('change', () => this.load());
        this.el('hint').addEventListener('click', () => {
            this.assisted = true;
            this.render();
        });
        this.el('next').addEventListener('click', () => {
            const key = this.select.value;
            this.indexes[key] = ((this.indexes[key] || 0) + 1) % SUDOKU_TRAINING_RECIPES[key].length;
            this.load();
        });
        this.el('clear').addEventListener('click', () => {
            this.selection.clear();
            this.feedback = '';
            this.render();
        });
        this.el('check').addEventListener('click', () => {
            if (this.resolved) return;
            this.feedback = SudokuTraining.check(this.exercise, this.selection);
            if (this.feedback === 'correct') {
                this.resolved = true;
                this.completed.add(this.exerciseId);
                if (this.independent && !this.assisted) this.independentCompleted.add(this.exerciseId);
            }
            this.render();
        });
        this.el('reveal').addEventListener('click', () => {
            this.selection = new Set(this.exercise.answer);
            this.resolved = true;
            this.feedback = 'revealed';
            this.render();
        });
        window.addEventListener('sudoku-language-change', () => {
            if (this.exercise) this.render();
        });
    }

    load() {
        const key = this.select.value;
        const index = this.indexes[key] || 0;
        this.exercise = SudokuTraining.create(key, SUDOKU_TRAINING_RECIPES[key][index], window.SUDOKU_PUZZLES);
        this.exerciseId = `${key}:${index}`;
        this.independent = this.el('mode').value === 'independent';
        this.assisted = false;
        this.selection = new Set();
        this.resolved = false;
        this.feedback = '';
        this.active = this.exercise.board.flat().findIndex(value => !value);
        this.render();
    }

    selectCell(index) {
        this.active = index;
        this.render();
        this.cells[index].focus({ preventScroll: true });
    }

    onKey(event, index) {
        // The numbered board stays physically LTR in every interface language.
        const row = Math.floor(index / 9), col = index % 9;
        const destinations = {
            ArrowLeft: row * 9 + Math.max(0, col - 1), ArrowRight: row * 9 + Math.min(8, col + 1),
            ArrowUp: Math.max(0, row - 1) * 9 + col, ArrowDown: Math.min(8, row + 1) * 9 + col,
            Home: row * 9, End: row * 9 + 8
        };
        if (event.key in destinations) {
            event.preventDefault();
            this.selectCell(destinations[event.key]);
        } else if (/^[1-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            this.toggle(Number(event.key));
        } else if (['Backspace', 'Delete'].includes(event.key) && !this.resolved) {
            event.preventDefault();
            this.selection = new Set([...this.selection].filter(key => !key.startsWith(`${row},${col},`)));
            this.feedback = '';
            this.render();
        }
    }

    toggle(digit) {
        if (this.resolved) return;
        const row = Math.floor(this.active / 9), col = this.active % 9;
        if (!(this.exercise.candidates[`${row},${col}`] || []).includes(digit)) return;
        const key = `${row},${col},${digit}`;
        if (this.selection.has(key)) this.selection.delete(key);
        else {
            if (this.exercise.hint.action.type === 'set_value') this.selection.clear();
            this.selection.add(key);
        }
        this.feedback = '';
        this.render();
    }

    render() {
        const { board, candidates, hint } = this.exercise;
        const placing = hint.action.type === 'set_value';
        const showPattern = !this.independent || this.assisted || this.resolved;
        const pattern = new Set(hint.stage2Highlight.cells.filter(cell => cell.role === 'primary')
            .map(({ row, col }) => `${row},${col}`));
        for (let index = 0; index < 81; index++) {
            const cell = this.cells[index], row = Math.floor(index / 9), col = index % 9;
            const value = board[row][col];
            const legal = candidates[`${row},${col}`] || [];
            const marked = legal.filter(digit => this.selection.has(`${row},${col},${digit}`));
            cell.tabIndex = index === this.active ? 0 : -1;
            cell.classList.toggle('active', index === this.active);
            cell.classList.toggle('pattern', showPattern && pattern.has(`${row},${col}`));
            cell.classList.toggle('given', !!value);
            cell.setAttribute('aria-label', tr(value ? 'training.given' : 'training.cell', {
                row: row + 1, col: col + 1, value,
                candidates: legal.join(', '), marked: marked.join(', ') || tr('training.none')
            }) + (showPattern && pattern.has(`${row},${col}`) ? `; ${tr('training.pattern')}` : ''));
            cell.replaceChildren();
            if (value) cell.textContent = value;
            else {
                const marks = document.createElement('span');
                marks.className = 'training-candidates';
                marks.setAttribute('aria-hidden', 'true');
                for (let digit = 1; digit <= 9; digit++) {
                    const mark = document.createElement('span');
                    mark.textContent = legal.includes(digit) ? digit : '';
                    if (marked.includes(digit)) mark.className = placing ? 'marked' : 'marked eliminated';
                    marks.appendChild(mark);
                }
                cell.appendChild(marks);
            }
        }
        const row = Math.floor(this.active / 9), col = this.active % 9;
        const legal = candidates[`${row},${col}`] || [];
        this.digits.forEach((button, index) => {
            button.disabled = this.resolved || !legal.includes(index + 1);
            button.setAttribute('aria-pressed', String(this.selection.has(`${row},${col},${index + 1}`)));
            button.setAttribute('aria-label', tr('training.digit', { digit: index + 1 }));
        });
        this.el('selection').textContent = tr('training.selection', { row: row + 1, col: col + 1, count: this.selection.size });
        this.el('rule').textContent = tr(`training.rule.${this.select.value}`);
        this.el('direction').textContent = showPattern ? this.app.getLocalizedHintPart(hint, 'stage1', hint.stage1Direction) : '';
        this.el('legend').textContent = tr(showPattern ? 'training.legend' : 'training.independentLegend');
        this.el('instruction').textContent = tr(placing ? 'training.place'
            : showPattern ? 'training.eliminate' : 'training.independentEliminate', { count: this.exercise.answer.size });
        this.el('hint').hidden = !this.independent;
        this.el('hint').disabled = this.assisted || this.resolved;
        this.el('independent-progress').textContent = tr('training.independentProgress', { count: this.independentCompleted.size });
        this.el('progress').textContent = tr('training.progress', {
            index: (this.indexes[this.select.value] || 0) + 1,
            total: SUDOKU_TRAINING_RECIPES[this.select.value].length, count: this.completed.size
        });
        this.el('feedback').textContent = this.feedback ? tr(`training.${this.feedback}`) : '';
        this.el('feedback').classList.toggle('training-success', this.feedback === 'correct');
        this.el('explanation').textContent = this.resolved
            ? this.app.getLocalizedHintPart(hint, 'stage3', hint.stage3Explanation) : '';
        this.el('source').textContent = tr('training.source', { id: this.exercise.sourceId });
        for (const id of ['check', 'clear', 'reveal']) this.el(id).disabled = this.resolved;
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = SudokuTrainingUI;
