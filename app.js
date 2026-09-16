/**
 * Sudoku Pro - Application Controller (Pro Edition)
 * Zero Dependencies (Pure Vanilla JS)
 * Features:
 * - 3-Stage Progressive Deductive Hints (Naked/Hidden Single, Pointing, Pairs, X-Wing)
 * - Snyder Notation (Corner Marks vs Center Marks vs Normal)
 * - Safe Candidate Auto-Restoration on Backspace/Erase
 * - Cell Coloring for Chains (4 pastel colors + eraser)
 * - Pure Web Audio API Sound Effects
 * - Zero-Scroll Viewport Adaptation
 * - Conflict Shake & Advanced Victory Stats with Wordle-style Share
 */

function tr(key, params = {}) {
    return window.SudokuI18n ? window.SudokuI18n.t(key, params) : key;
}

class SoundEffects {
    constructor() {
        this.ctx = null;
        this.enabled = true;
    }

    init() {
        if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioCtx();
        }
    }

    playTone(freq, duration, type = 'sine', gainVal = 0.08) {
        if (!this.enabled) return;
        try {
            this.init();
            if (!this.ctx) return;
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) {
            // Audio context blocked or unsupported
        }
    }

    playInput() { this.playTone(520, 0.035, 'sine', 0.08); }
    playPencil() { this.playTone(380, 0.025, 'triangle', 0.06); }
    playErase() { this.playTone(240, 0.04, 'sine', 0.07); }
    playConflict() {
        this.playTone(180, 0.08, 'sawtooth', 0.05);
        setTimeout(() => this.playTone(140, 0.12, 'sawtooth', 0.05), 70);
    }
    playVictory() {
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
            setTimeout(() => this.playTone(freq, 0.22, 'sine', 0.1), idx * 110);
        });
    }
}

class SudokuApp {
    constructor() {
        this.boardSize = 9;
        this.initialBoard = Array(9).fill(null).map(() => Array(9).fill(0));
        this.currentBoard = Array(9).fill(null).map(() => Array(9).fill(0));
        this.solutionBoard = null;

        // Snyder Notation: Corner Marks vs Center Marks
        this.cornerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
        this.centerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));

        // Cell Coloring
        this.cellColors = Array(9).fill(null).map(() => Array(9).fill(null));
        this.activeColor = null;

        // Safety Mechanism: Pruned candidate snapshots
        this.prunedSnapshots = {}; // 'r,c' -> { center: [...], corner: [...] }

        // Selection & Input Modes
        this.selectedCell = null; // { row, col }
        this.selectedNumber = 0;  // 1-9 for scanning
        this.inputMode = 'normal'; // 'normal' | 'corner' | 'center'

        // Progressive Deductive Hint System
        this.currentDeductiveHint = null;
        this.hintStage = 0; // 0=inactive, 1=direction, 2=highlight, 3=applied
        this.hintsCount = 0;
        this.revealedCount = 0;
        this.mistakesCount = 0;

        // History for undo/redo
        this.history = [];
        this.historyIndex = -1;

        // Timer
        this.timerSeconds = 0;
        this.timerInterval = null;
        this.isPaused = false;

        // Metadata
        this.currentDifficulty = 'easy';
        this.currentPuzzleMeta = { id: '', rating: 0, note: '' };
        this.isCustomGame = false;

        // Cascade Auto-Complete
        this.pendingCascadeSteps = null;
        this.isExecutingCascade = false;
        this.cancelCascadeExecution = false;
        this.cascadeDismissedForCurrentPuzzle = false;
        this.cascadeBannerEl = null;
        this.btnCascadeAutoComplete = null;
        this.btnCascadeDismiss = null;

        // Misclick Grace Period
        this.lastMistakeTimestamp = 0;
        this.lastMistakeCell = null;

        // Audio
        this.audio = new SoundEffects();

        // Settings
        this.settings = {
            enableSnyder: false,
            soundEnabled: true,
            highlightSame: true,
            preserveDigitHighlightOnEmpty: true,
            highlightArea: true,
            highlightDigitLines: true,
            autoRemovePencil: true,
            highlightConflicts: true,
            blockConflicts: true,
            validateAgainstSolution: true,
            smartPencilGrid: true,
            theme: 'dark',
            pencilSize: 'normal',
            activeAlgorithm: 'mrv'
        };

        this.init();
    }

    init() {
        this.loadSettings();
        this.audio.enabled = this.settings.soundEnabled;
        this.applyTheme(this.settings.theme);
        this.applyPencilSize(this.settings.pencilSize);
        document.body.classList.toggle('classic-pencil-flow', !this.settings.smartPencilGrid);
        this.setupDOM();
        this.updateSnyderModeUI();
        this.setupEvents();
        this.setupKeyboard();

        if (!this.loadGameState()) {
            this.startNewGame(this.currentDifficulty);
        }
    }

    setupDOM() {
        this.boardEl = document.getElementById('sudoku-board');
        this.numpadEl = document.getElementById('numpad');
        this.timerEl = document.getElementById('timer-display');
        this.pauseBtn = document.getElementById('btn-pause');
        this.pauseOverlay = document.getElementById('pause-overlay');
        this.diffSelect = document.getElementById('difficulty-select');
        this.puzzleIdDisplay = document.getElementById('puzzle-id-display');
        this.puzzleRatingDisplay = document.getElementById('puzzle-rating-display');
        this.puzzleNoteDisplay = document.getElementById('puzzle-note-display');
        this.themeIcon = document.getElementById('theme-icon');

        // Hint Banner
        this.hintBannerEl = document.getElementById('hint-banner');
        this.hintStageBadgeEl = document.getElementById('hint-stage-badge');
        this.hintTextEl = document.getElementById('hint-text');
        this.btnHintNext = document.getElementById('btn-hint-next');
        this.btnHintDismiss = document.getElementById('btn-hint-dismiss');

        // Cascade Auto-Complete Banner
        this.cascadeBannerEl = document.getElementById('cascade-banner');
        this.btnCascadeAutoComplete = document.getElementById('btn-cascade-autocomplete');
        if (this.btnCascadeAutoComplete) {
            this.btnCascadeAutoComplete.addEventListener('click', () => this.executeCascadeAutoComplete());
        }
        this.btnCascadeDismiss = document.getElementById('btn-cascade-dismiss');
        if (this.btnCascadeDismiss) {
            this.btnCascadeDismiss.addEventListener('click', () => {
                this.cascadeDismissedForCurrentPuzzle = true;
                if (this.cascadeBannerEl) this.cascadeBannerEl.classList.add('hidden');
            });
        }

        // Render Numpad
        this.numpadEl.innerHTML = '';
        for (let num = 1; num <= 9; num++) {
            const btn = document.createElement('button');
            btn.className = 'num-btn';
            btn.dataset.number = num;
            btn.innerHTML = `
                <span>${num}</span>
                <span class="rem-count" id="rem-${num}">9</span>
            `;
            btn.addEventListener('click', () => this.handleNumpadClick(num));
            this.numpadEl.appendChild(btn);
        }

        // Render 81 Cells
        this.boardEl.innerHTML = '';
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = r;
                cell.dataset.col = c;
                cell.addEventListener('click', () => this.selectCell(r, c));
                this.boardEl.appendChild(cell);
            }
        }
    }

    setupEvents() {
        // New Game Button
        document.getElementById('btn-new-game').addEventListener('click', () => {
            if (this.hasGameProgress() && !confirm(tr('confirm.newGame'))) {
                return;
            }
            this.startNewGame(this.diffSelect.value);
        });

        this.diffSelect.addEventListener('change', (e) => {
            const newDifficulty = e.target.value;
            if (this.hasGameProgress() && !confirm(tr('confirm.difficulty'))) {
                e.target.value = this.currentDifficulty;
                return;
            }
            this.startNewGame(newDifficulty);
        });

        // Pause / Resume
        this.pauseBtn.addEventListener('click', () => this.togglePause());
        document.getElementById('btn-resume').addEventListener('click', () => this.togglePause(false));

        // Deductive Hints & Reveal Cell (Separated!)
        document.getElementById('btn-deductive-hint').addEventListener('click', () => this.triggerDeductiveHint());
        this.btnHintNext.addEventListener('click', () => this.stepDeductiveHint());
        this.btnHintDismiss.addEventListener('click', () => this.dismissDeductiveHint());
        document.getElementById('btn-reveal-cell').addEventListener('click', () => this.revealCell());

        // Pencil & Safety Tools
        document.getElementById('btn-autofill-pencil').addEventListener('click', () => this.autoFillPencilMarks());
        document.getElementById('btn-refresh-neighborhood').addEventListener('click', () => this.refreshNeighborhoodCandidates());
        document.getElementById('btn-clear-pencil').addEventListener('click', () => this.clearAllPencilMarks());
        document.getElementById('btn-erase').addEventListener('click', () => this.eraseSelected());

        // Standard Quick Tools
        document.getElementById('btn-undo').addEventListener('click', () => this.undo());
        document.getElementById('btn-redo').addEventListener('click', () => this.redo());
        document.getElementById('btn-solve').addEventListener('click', () => this.solveBoard());

        // Input Modes (Normal / Corner / Center)
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setInputMode(btn.dataset.mode);
            });
        });

        // Color Palette Buttons
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.color || null;
                this.handleColorButtonClick(color);
            });
        });

        // Pencil size buttons
        document.getElementById('btn-pencil-size-normal').addEventListener('click', () => this.setPencilSize('normal'));
        document.getElementById('btn-pencil-size-large').addEventListener('click', () => this.setPencilSize('large'));
        document.getElementById('btn-pencil-size-xlarge').addEventListener('click', () => this.setPencilSize('xlarge'));

        // Theme Toggle
        document.getElementById('btn-theme').addEventListener('click', () => {
            const newTheme = this.settings.theme === 'dark' ? 'light' : 'dark';
            this.settings.theme = newTheme;
            this.applyTheme(newTheme);
            this.saveSettings();
        });

        // Modals
        document.getElementById('btn-settings').addEventListener('click', () => this.openModal('modal-settings'));
        document.getElementById('btn-credits').addEventListener('click', () => this.openModal('modal-credits'));
        document.getElementById('btn-custom-puzzle').addEventListener('click', () => this.openModal('modal-custom'));
        
        const btnAlgoLab = document.getElementById('btn-algo-lab');
        if (btnAlgoLab) {
            btnAlgoLab.addEventListener('click', () => this.openModal('modal-algo'));
        }

        // Algo Radio selections
        document.querySelectorAll('input[name="selected-algo"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.settings.activeAlgorithm = e.target.value;
                this.saveSettings();
                document.querySelectorAll('.algo-card').forEach(card => {
                    const cardRadio = card.querySelector('input[type="radio"]');
                    if (cardRadio) {
                        card.classList.toggle('active', cardRadio.checked);
                    }
                });
            });
        });

        // Run Selected Algo / Benchmark buttons
        const btnRunSolve = document.getElementById('btn-run-algo-solve');
        if (btnRunSolve) {
            btnRunSolve.addEventListener('click', () => this.runSelectedAlgorithmSolve());
        }

        const btnRunCompare = document.getElementById('btn-run-algo-compare');
        if (btnRunCompare) {
            btnRunCompare.addEventListener('click', () => this.runAlgorithmBenchmark());
        }

        document.getElementById('btn-victory-new-game').addEventListener('click', () => {
            this.closeModal('modal-victory');
            this.startNewGame(this.currentDifficulty);
        });

        // Share result button
        document.getElementById('btn-share-result').addEventListener('click', () => this.shareResult());

        // Close Modal buttons
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.closeModal(btn.getAttribute('data-close'));
            });
        });

        document.querySelectorAll('.modal-backdrop').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeModal(modal.id);
            });
        });

        // Custom puzzle loader
        document.getElementById('btn-load-custom').addEventListener('click', () => {
            const input = document.getElementById('custom-puzzle-input').value.trim();
            this.loadCustomPuzzle(input);
        });

        // Settings Checkboxes
        this.bindSettingCheckbox('set-enable-snyder', 'enableSnyder', () => {
            this.updateSnyderModeUI();
        });
        this.bindSettingCheckbox('set-sound-enabled', 'soundEnabled', (val) => {
            this.audio.enabled = val;
        });
        this.bindSettingCheckbox('set-highlight-same', 'highlightSame');
        this.bindSettingCheckbox('set-preserve-digit-highlight', 'preserveDigitHighlightOnEmpty', (enabled) => {
            if (!enabled && this.selectedCell
                && this.currentBoard[this.selectedCell.row][this.selectedCell.col] === 0) {
                this.selectedNumber = 0;
            }
        });
        this.bindSettingCheckbox('set-highlight-area', 'highlightArea');
        this.bindSettingCheckbox('set-highlight-digit-lines', 'highlightDigitLines');
        this.bindSettingCheckbox('set-auto-remove-pencil', 'autoRemovePencil');
        this.bindSettingCheckbox('set-highlight-conflicts', 'highlightConflicts');
        this.bindSettingCheckbox('set-validate-solution', 'validateAgainstSolution');
        this.bindSettingCheckbox('set-block-conflicts', 'blockConflicts', () => {
            this.updateSmartNumpad();
        });
        this.bindSettingCheckbox('set-smart-pencil-grid', 'smartPencilGrid', (val) => {
            document.body.classList.toggle('classic-pencil-flow', !val);
            this.renderBoard();
        });

        window.addEventListener('sudoku-language-change', () => this.refreshLocalizedUI());
    }

    bindSettingCheckbox(elementId, settingKey, callback = null) {
        const checkbox = document.getElementById(elementId);
        if (!checkbox) return;
        checkbox.checked = this.settings[settingKey];
        checkbox.addEventListener('change', (e) => {
            this.settings[settingKey] = e.target.checked;
            if (callback) callback(e.target.checked);
            this.saveSettings();
            this.updateVisualHighlights();
        });
    }

    setupKeyboard() {
        window.addEventListener('keydown', (e) => {
            if (this.isExecutingCascade) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Escape
            if (e.key === 'Escape') {
                const openModal = document.querySelector('.modal-backdrop.open');
                if (openModal) {
                    this.closeModal(openModal.id);
                    return;
                }
                this.dismissDeductiveHint();
                this.selectedCell = null;
                this.selectedNumber = 0;
                this.updateVisualHighlights();
                return;
            }

            // Space / Tab: Fast toggle (Normal <-> Center) when Snyder disabled; 3-way toggle when enabled
            if (e.key === ' ' || e.key === 'Tab') {
                e.preventDefault();
                if (this.settings.enableSnyder) {
                    const modes = ['normal', 'corner', 'center'];
                    const nextIdx = (modes.indexOf(this.inputMode) + 1) % modes.length;
                    this.setInputMode(modes[nextIdx]);
                } else {
                    const nextMode = this.inputMode === 'normal' ? 'center' : 'normal';
                    this.setInputMode(nextMode);
                }
                this.audio.playPencil();
                return;
            }

            // Quick Keys for Modes: Z (Normal), X (Corner - if Snyder enabled), C (Center)
            if (!e.ctrlKey && !e.metaKey) {
                if (e.key.toLowerCase() === 'z') {
                    this.setInputMode('normal');
                    return;
                }
                if (e.key.toLowerCase() === 'x') {
                    if (this.settings.enableSnyder) {
                        this.setInputMode('corner');
                    }
                    return;
                }
                if (e.key.toLowerCase() === 'c') {
                    this.setInputMode('center');
                    return;
                }
            }

            // Number input (1-9)
            // Use e.code (physical key) instead of e.key: with Shift held, e.key
            // becomes a symbol (e.g. Shift+1 -> "!"), so relying on e.key silently
            // broke the "Shift + 1-9" corner-mark shortcut.
            const digitMatch = /^(Digit|Numpad)([1-9])$/.exec(e.code);
            if (digitMatch) {
                e.preventDefault();
                const num = parseInt(digitMatch[2], 10);
                if (e.shiftKey) {
                    // Shift + 1-9: Force Corner Mark if Snyder enabled, otherwise Center
                    this.handleDirectMark(num, this.settings.enableSnyder ? 'corner' : 'center');
                } else if (e.ctrlKey || e.altKey) {
                    // Ctrl/Alt + 1-9: Force Center Mark
                    this.handleDirectMark(num, 'center');
                } else {
                    this.handleNumberInput(num);
                }
                return;
            }

            // Erase
            if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
                e.preventDefault();
                this.eraseSelected();
                return;
            }

            // Undo / Redo
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) this.redo();
                else this.undo();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                this.redo();
                return;
            }

            // Deductive Hint (H)
            if (e.key.toLowerCase() === 'h') {
                e.preventDefault();
                this.triggerDeductiveHint();
                return;
            }

            // Arrow navigation (taking RTL into account so physical arrows match visual movement)
            if (this.selectedCell) {
                let { row, col } = this.selectedCell;
                const isRTL = document.documentElement.dir === 'rtl' || document.body.dir === 'rtl' || getComputedStyle(document.body).direction === 'rtl';

                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.selectCell((row - 1 + 9) % 9, col);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.selectCell((row + 1) % 9, col);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    // In RTL, moving visual Left means increasing col (+1); in LTR, it means decreasing col (-1)
                    const nextCol = isRTL ? (col + 1) % 9 : (col - 1 + 9) % 9;
                    this.selectCell(row, nextCol);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    // In RTL, moving visual Right means decreasing col (-1); in LTR, it means increasing col (+1)
                    const nextCol = isRTL ? (col - 1 + 9) % 9 : (col + 1) % 9;
                    this.selectCell(row, nextCol);
                }
            }
        });
    }

    setInputMode(mode) {
        if (!this.settings.enableSnyder && mode === 'corner') {
            mode = 'normal';
        }
        this.inputMode = mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            if (btn.dataset.mode === mode) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        this.updateSmartNumpad();
    }

    updateSnyderModeUI() {
        const cornerBtn = document.getElementById('mode-corner');
        if (cornerBtn) {
            cornerBtn.style.display = this.settings.enableSnyder ? '' : 'none';
        }
        if (!this.settings.enableSnyder && this.inputMode === 'corner') {
            this.setInputMode('normal');
        }
    }

    handleColorButtonClick(color) {
        if (this.isPaused || this.isExecutingCascade) return;

        if (this.selectedCell) {
            // Apply color to selected cell immediately
            const { row, col } = this.selectedCell;
            this.setCellColor(row, col, color);
            this.audio.playInput();
        } else {
            // Toggle active paint color
            this.activeColor = this.activeColor === color ? null : color;
            document.querySelectorAll('.color-btn').forEach(btn => {
                if (btn.dataset.color === this.activeColor && this.activeColor !== null) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
            if (this.activeColor) {
                this.showToast(tr('toast.paintMode'));
            }
        }
    }

    setCellColor(row, col, color) {
        const prevColor = this.cellColors[row][col];
        if (prevColor === color) return;

        this.pushAction({
            type: 'color_change',
            row,
            col,
            prevColor,
            newColor: color
        });

        this.cellColors[row][col] = color;
        this.renderCellContent(row, col);
        this.saveGameState();
    }

    // True if the player has filled in any non-given cell on the current board.
    // Used to decide whether starting a new game / switching difficulty needs confirmation.
    hasGameProgress() {
        if (!this.initialBoard || !this.currentBoard) return false;
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (this.initialBoard[r][c] === 0 && this.currentBoard[r][c] !== 0) {
                    return true;
                }
            }
        }
        return false;
    }

    startNewGame(difficulty = 'easy', specificPuzzle = null) {
        if (this.isExecutingCascade) {
            this.cancelCascadeExecution = true;
            this.isExecutingCascade = false;
        }
        this.cascadeDismissedForCurrentPuzzle = false;

        this.currentDifficulty = difficulty;
        this.diffSelect.value = difficulty;
        this.isCustomGame = false;

        let puzzleObj = specificPuzzle;
        if (!puzzleObj) {
            const puzzlesList = window.SUDOKU_PUZZLES && window.SUDOKU_PUZZLES[difficulty];
            if (puzzlesList && puzzlesList.length > 0) {
                puzzleObj = puzzlesList[Math.floor(Math.random() * puzzlesList.length)];
            }
        }

        let puzzleString = '';
        if (puzzleObj) {
            puzzleString = puzzleObj.puzzle;
            this.currentPuzzleMeta = {
                id: puzzleObj.id || 'N/A',
                rating: puzzleObj.rating || '-',
                note: puzzleObj.note || '',
                noteKey: puzzleObj.noteKey || ''
            };
        } else {
            const gen = SudokuEngine.generate(difficulty === 'extreme' ? 'expert' : difficulty);
            puzzleString = gen.puzzle;
            this.currentPuzzleMeta = {
                id: '',
                rating: '',
                note: '',
                idKey: 'meta.generator',
                ratingKey: 'meta.automatic'
            };
        }

        this.initialBoard = SudokuEngine.stringToGrid(puzzleString);
        this.currentBoard = this.initialBoard.map(row => [...row]);
        this.solutionBoard = SudokuEngine.solve(this.initialBoard);

        this.cornerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
        this.centerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
        this.cellColors = Array(9).fill(null).map(() => Array(9).fill(null));
        this.prunedSnapshots = {};

        this.selectedCell = null;
        this.selectedNumber = 0;
        this.history = [];
        this.historyIndex = -1;
        this.hintsCount = 0;
        this.revealedCount = 0;
        this.mistakesCount = 0;
        this.dismissDeductiveHint();

        this.resetTimer();
        this.startTimer();

        this.updatePuzzleMetaDisplay();

        this.renderBoard();
        this.updateRemainingCounts();
        this.updateVisualHighlights();
        this.saveGameState();

        this.pendingCascadeSteps = null;
        if (this.cascadeBannerEl) this.cascadeBannerEl.classList.add('hidden');
        this.checkCascadeAvailability();

        this.showToast(tr('toast.newBoard', {
            difficulty: this.getDifficultyLabel(difficulty),
            rating: this.currentPuzzleMeta.ratingKey ? tr(this.currentPuzzleMeta.ratingKey) : this.currentPuzzleMeta.rating
        }));
    }

    getDifficultyLabel(diff) {
        const key = `difficulty.${diff}`;
        const translated = tr(key);
        return translated === key ? diff : translated;
    }

    updatePuzzleMetaDisplay() {
        const meta = this.currentPuzzleMeta || {};
        this.puzzleIdDisplay.textContent = meta.idKey ? tr(meta.idKey) : `${meta.id ?? ''}`;
        this.puzzleRatingDisplay.textContent = meta.ratingKey ? tr(meta.ratingKey) : `${meta.rating ?? '-'}`;
        if (this.puzzleNoteDisplay) {
            this.puzzleNoteDisplay.textContent = meta.noteKey ? tr(meta.noteKey) : (meta.note || '');
        }
    }

    refreshLocalizedUI() {
        this.updatePuzzleMetaDisplay();
        if (this.currentDeductiveHint && this.hintStage > 0) {
            this.renderCurrentHintStage();
        }
        const benchmarkResults = document.getElementById('algo-benchmark-results');
        if (benchmarkResults && !benchmarkResults.classList.contains('hidden')) {
            this.runAlgorithmBenchmark();
        }
        const victoryDifficulty = document.getElementById('victory-difficulty');
        if (victoryDifficulty) victoryDifficulty.textContent = this.getDifficultyLabel(this.currentDifficulty);
    }

    selectCell(r, c) {
        if (this.isPaused || this.isExecutingCascade) return;

        // If paint mode is active, color the cell directly
        if (this.activeColor !== null) {
            this.setCellColor(r, c, this.activeColor);
            this.audio.playInput();
            return;
        }

        this.selectedCell = { row: r, col: c };
        const val = this.currentBoard[r][c];
        if (val !== 0) {
            this.selectedNumber = val;
        } else if (!this.settings.preserveDigitHighlightOnEmpty) {
            this.selectedNumber = 0;
        }
        this.updateVisualHighlights();
    }

    handleNumpadClick(num) {
        if (this.isPaused || this.isExecutingCascade) return;

        if (this.selectedCell) {
            this.handleNumberInput(num);
        } else {
            this.selectedNumber = this.selectedNumber === num ? 0 : num;
            this.updateVisualHighlights();
        }
    }

    handleDirectMark(num, mode) {
        if (this.isPaused || this.isExecutingCascade || !this.selectedCell) return;
        const { row, col } = this.selectedCell;
        if (this.initialBoard[row][col] !== 0 || this.currentBoard[row][col] !== 0) return;

        if (mode === 'corner') {
            this.toggleCornerMark(row, col, num);
        } else {
            this.toggleCenterMark(row, col, num);
        }
    }

    handleNumberInput(num) {
        if (this.isPaused || !this.selectedCell || this.isExecutingCascade) return;
        const { row, col } = this.selectedCell;

        if (this.initialBoard[row][col] !== 0) {
            this.showToast(tr('toast.givenImmutable'));
            return;
        }

        if (this.inputMode === 'corner') {
            this.toggleCornerMark(row, col, num);
        } else if (this.inputMode === 'center') {
            this.toggleCenterMark(row, col, num);
        } else {
            // Misclick protection in normal mode: if blockConflicts is enabled, disallow numbers that already exist in unit
            if (this.settings.blockConflicts && this.currentBoard[row][col] === 0) {
                const legal = SudokuEngine.getCandidates(this.currentBoard, row, col);
                if (!legal.includes(num)) {
                    this.audio.playConflict();
                    const cellEl = this.boardEl.children[row * 9 + col];
                    if (cellEl) {
                        cellEl.classList.add('shake');
                        setTimeout(() => cellEl.classList.remove('shake'), 400);
                    }
                    return;
                }
            }
            this.setCellValue(row, col, num);
        }
    }

    toggleCornerMark(row, col, num) {
        if (this.currentBoard[row][col] !== 0) return;

        const set = this.cornerMarks[row][col];
        const hadNum = set.has(num);

        this.pushAction({
            type: 'corner_toggle',
            row,
            col,
            num,
            previousState: new Set(set)
        });

        if (hadNum) set.delete(num);
        else set.add(num);

        this.audio.playPencil();
        this.renderCellContent(row, col);
        this.updateVisualHighlights();
        this.saveGameState();
    }

    toggleCenterMark(row, col, num) {
        if (this.currentBoard[row][col] !== 0) return;

        const set = this.centerMarks[row][col];
        const hadNum = set.has(num);

        this.pushAction({
            type: 'center_toggle',
            row,
            col,
            num,
            previousState: new Set(set)
        });

        if (hadNum) set.delete(num);
        else set.add(num);

        this.audio.playPencil();
        this.renderCellContent(row, col);
        this.updateVisualHighlights();
        this.saveGameState();
    }

    /**
     * Set Cell Value with Safety Snapshot of Pruned Candidates
     */
    setCellValue(row, col, num) {
        const prevVal = this.currentBoard[row][col];
        const newVal = prevVal === num ? 0 : num;
        if (prevVal === newVal) return;

        // Ensure solutionBoard is available for validation & grace checks
        if (!this.solutionBoard) {
            this.solutionBoard = SudokuEngine.solve(this.initialBoard) || SudokuEngine.solve(this.currentBoard);
        }

        // Direct Overwrite Grace Period check (2.5s)
        if (this.lastMistakeCell && this.lastMistakeCell.row === row && this.lastMistakeCell.col === col) {
            if (Date.now() - this.lastMistakeTimestamp <= 2500) {
                if (this.solutionBoard && newVal === this.solutionBoard[row][col]) {
                    if (this.mistakesCount > 0) {
                        this.mistakesCount--;
                        this.showToast(tr('toast.mistakeCorrected'));
                    }
                }
            }
            this.lastMistakeCell = null;
            this.lastMistakeTimestamp = 0;
        }

        // If placing a number that was already set, or replacing an existing value,
        // first restore any previously pruned candidates from that position! Keep a
        // clone of what was restored so undo/redo can replay/reverse this step too -
        // otherwise it's an invisible mutation the history can't account for.
        //
        // Temporarily clear the cell before restoring: restorePrunedCandidatesForCell
        // re-checks legality with SudokuEngine.isValid, which scans this cell's own
        // row/col/box. If prevVal were still sitting here, every same-unit neighbor
        // candidate for exactly that digit would be rejected as a false self-conflict,
        // silently no-op'ing the restore for the one case it exists to handle.
        this.currentBoard[row][col] = 0;
        const oldSnapshot = this.cloneSnapshot(this.restorePrunedCandidatesForCell(row, col));

        const affectedCenter = [];
        const affectedCorner = [];
        const cellPrevCenter = new Set(this.centerMarks[row][col]);
        const cellPrevCorner = new Set(this.cornerMarks[row][col]);

        if (newVal !== 0) {
            this.centerMarks[row][col].clear();
            this.cornerMarks[row][col].clear();

            // Auto-remove candidate from neighborhood
            if (this.settings.autoRemovePencil) {
                const boxR = Math.floor(row / 3) * 3;
                const boxC = Math.floor(col / 3) * 3;

                for (let r = 0; r < 9; r++) {
                    for (let c = 0; c < 9; c++) {
                        const inSameUnit = (r === row || c === col || (r >= boxR && r < boxR + 3 && c >= boxC && c < boxC + 3));
                        if (inSameUnit && (r !== row || c !== col)) {
                            if (this.centerMarks[r][c].has(newVal)) {
                                affectedCenter.push({ row: r, col: c, num: newVal });
                                this.centerMarks[r][c].delete(newVal);
                            }
                            if (this.cornerMarks[r][c].has(newVal)) {
                                affectedCorner.push({ row: r, col: c, num: newVal });
                                this.cornerMarks[r][c].delete(newVal);
                            }
                        }
                    }
                }
            }

            // Save snapshot in safety map
            this.prunedSnapshots[`${row},${col}`] = {
                cellCenter: cellPrevCenter,
                cellCorner: cellPrevCorner,
                affectedCenter,
                affectedCorner
            };
        }

        this.pushAction({
            type: 'value_change',
            row,
            col,
            prevVal,
            newVal,
            cellPrevCenter,
            cellPrevCorner,
            affectedCenter,
            affectedCorner,
            oldSnapshot
        });

        this.currentBoard[row][col] = newVal;
        this.selectedNumber = newVal;

        // Solution validation & conflict detection
        if (newVal !== 0) {
            const conflicts = SudokuEngine.findConflicts(this.currentBoard);
            const hasRuleConflict = conflicts.has(`${row},${col}`);
            const isSolutionMismatch = this.settings.validateAgainstSolution && this.solutionBoard && (newVal !== this.solutionBoard[row][col]);

            if (hasRuleConflict || isSolutionMismatch) {
                this.mistakesCount++;
                this.lastMistakeTimestamp = Date.now();
                this.lastMistakeCell = { row, col, val: newVal };
                this.audio.playConflict();
                const cellEl = this.boardEl.children[row * 9 + col];
                if (cellEl) {
                    cellEl.classList.add('shake');
                    setTimeout(() => cellEl.classList.remove('shake'), 400);
                }
                if (isSolutionMismatch) {
                    this.showToast(tr('toast.wrongNumber'));
                }
            } else {
                this.audio.playInput();
            }
        } else {
            this.audio.playErase();
        }

        // Re-render cell and neighborhood
        this.renderCellContent(row, col);
        affectedCenter.forEach(item => this.renderCellContent(item.row, item.col));
        affectedCorner.forEach(item => this.renderCellContent(item.row, item.col));

        this.updateRemainingCounts();
        this.updateVisualHighlights();
        this.saveGameState();

        this.checkGameCompletion();
        this.checkCascadeAvailability();
    }

    /**
     * Re-adds the candidates recorded in a pruned-candidates snapshot back to their
     * cells (when still legal). Used both by the live "safety restoration" feature
     * and by undo/redo to replay/reverse that restoration deterministically.
     */
    restoreSnapshotToNeighbors(snapshot) {
        if (!snapshot) return;
        (snapshot.affectedCenter || []).forEach(item => {
            if (this.currentBoard[item.row][item.col] === 0 && SudokuEngine.isValid(this.currentBoard, item.row, item.col, item.num)) {
                this.centerMarks[item.row][item.col].add(item.num);
                this.renderCellContent(item.row, item.col);
            }
        });
        (snapshot.affectedCorner || []).forEach(item => {
            if (this.currentBoard[item.row][item.col] === 0 && SudokuEngine.isValid(this.currentBoard, item.row, item.col, item.num)) {
                this.cornerMarks[item.row][item.col].add(item.num);
                this.renderCellContent(item.row, item.col);
            }
        });
    }

    /**
     * Inverse of restoreSnapshotToNeighbors: removes the candidates recorded in a
     * snapshot from their cells again. Used by undo/redo to re-apply a pruning that
     * a restoreSnapshotToNeighbors() call had previously undone.
     */
    repruneSnapshotFromNeighbors(snapshot) {
        if (!snapshot) return;
        (snapshot.affectedCenter || []).forEach(item => {
            this.centerMarks[item.row][item.col].delete(item.num);
            this.renderCellContent(item.row, item.col);
        });
        (snapshot.affectedCorner || []).forEach(item => {
            this.cornerMarks[item.row][item.col].delete(item.num);
            this.renderCellContent(item.row, item.col);
        });
    }

    /**
     * Deep-clones a pruned-candidates snapshot so it can be safely stashed inside an
     * undo/redo history entry without aliasing the live prunedSnapshots map.
     */
    cloneSnapshot(snapshot) {
        if (!snapshot) return null;
        return {
            cellCenter: new Set(snapshot.cellCenter),
            cellCorner: new Set(snapshot.cellCorner),
            affectedCenter: (snapshot.affectedCenter || []).map(item => ({ ...item })),
            affectedCorner: (snapshot.affectedCorner || []).map(item => ({ ...item }))
        };
    }

    /**
     * Safety Restoration: Restores candidates that were pruned when cell (row, col) was filled.
     * Returns the snapshot that was restored (or null), so callers that also record an
     * undo/redo action can stash it and replay/reverse this restoration on undo/redo.
     */
    restorePrunedCandidatesForCell(row, col) {
        const key = `${row},${col}`;
        const snapshot = this.prunedSnapshots[key];
        if (!snapshot) return null;

        this.restoreSnapshotToNeighbors(snapshot);
        delete this.prunedSnapshots[key];
        return snapshot;
    }

    eraseSelected() {
        if (this.isPaused || !this.selectedCell || this.isExecutingCascade) return;
        const { row, col } = this.selectedCell;

        if (this.initialBoard[row][col] !== 0) {
            this.showToast(tr('toast.givenCannotErase'));
            return;
        }

        const prevVal = this.currentBoard[row][col];
        const hadCenter = this.centerMarks[row][col].size > 0;
        const hadCorner = this.cornerMarks[row][col].size > 0;

        if (prevVal === 0 && !hadCenter && !hadCorner) return;

        // Grace period check (2.5s)
        if (this.lastMistakeCell && this.lastMistakeCell.row === row && this.lastMistakeCell.col === col) {
            if (Date.now() - this.lastMistakeTimestamp <= 2500) {
                if (this.mistakesCount > 0) {
                    this.mistakesCount--;
                    this.showToast(tr('toast.mistakeUndone'));
                }
            }
            this.lastMistakeCell = null;
            this.lastMistakeTimestamp = 0;
        }

        // Restore safety candidates for neighborhood. Clear the cell first: same reason
        // as setCellValue - restorePrunedCandidatesForCell's isValid checks would otherwise
        // see prevVal still sitting here and reject every same-unit neighbor as a false
        // self-conflict, silently no-op'ing the restore.
        let oldSnapshot = null;
        if (prevVal !== 0) {
            this.currentBoard[row][col] = 0;
            oldSnapshot = this.cloneSnapshot(this.restorePrunedCandidatesForCell(row, col));
            this.showToast(tr('toast.candidatesRestored'));
        }

        this.pushAction({
            type: 'erase',
            row,
            col,
            prevVal,
            prevCenter: new Set(this.centerMarks[row][col]),
            prevCorner: new Set(this.cornerMarks[row][col]),
            oldSnapshot
        });

        this.currentBoard[row][col] = 0;
        this.centerMarks[row][col].clear();
        this.cornerMarks[row][col].clear();

        this.audio.playErase();
        this.renderCellContent(row, col);
        this.updateRemainingCounts();
        this.updateVisualHighlights();
        this.saveGameState();
        this.checkCascadeAvailability();
    }

    /**
     * Helper to recalculate legal candidates for empty cells in row, col, and block
     */
    refreshNeighborhoodCandidates() {
        if (this.isExecutingCascade || this.isPaused) return;
        if (!this.selectedCell) {
            this.showToast(tr('toast.selectRefreshCell'));
            return;
        }

        const { row, col } = this.selectedCell;
        const boxR = Math.floor(row / 3) * 3;
        const boxC = Math.floor(col / 3) * 3;
        let count = 0;
        const previousPencils = [];
        const afterPencils = [];

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const inSameUnit = (r === row || c === col || (r >= boxR && r < boxR + 3 && c >= boxC && c < boxC + 3));
                if (inSameUnit && this.currentBoard[r][c] === 0) {
                    const legal = SudokuEngine.getCandidates(this.currentBoard, r, c);
                    previousPencils.push({
                        row: r,
                        col: c,
                        previous: new Set(this.centerMarks[r][c])
                    });
                    this.centerMarks[r][c] = new Set(legal);
                    afterPencils.push({
                        row: r,
                        col: c,
                        next: new Set(legal)
                    });
                    this.renderCellContent(r, c);
                    count++;
                }
            }
        }

        // Reuses the 'autofill_pencil' action type: both overwrite center marks for a
        // set of cells with no corner-mark changes, so undo/redo share identical logic.
        if (count > 0) {
            this.pushAction({
                type: 'autofill_pencil',
                previousPencils,
                afterPencils
            });
        }

        this.audio.playPencil();
        this.updateVisualHighlights();
        this.saveGameState();
        this.showToast(tr('toast.refreshed', { count }));
    }

    /**
     * Auto-Fill Center Marks for all empty cells
     */
    autoFillPencilMarks() {
        if (this.isExecutingCascade || this.isPaused) return;

        const allCandidates = SudokuEngine.getAllCandidates(this.currentBoard);
        const previousPencils = [];
        const afterPencils = [];
        let updatedCount = 0;

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (this.currentBoard[r][c] === 0) {
                    previousPencils.push({
                        row: r,
                        col: c,
                        previous: new Set(this.centerMarks[r][c])
                    });
                    const cands = allCandidates[`${r},${c}`] || [];
                    this.centerMarks[r][c] = new Set(cands);
                    afterPencils.push({
                        row: r,
                        col: c,
                        next: new Set(cands)
                    });
                    this.renderCellContent(r, c);
                    updatedCount++;
                }
            }
        }

        this.pushAction({
            type: 'autofill_pencil',
            previousPencils,
            afterPencils
        });

        this.audio.playPencil();
        this.updateVisualHighlights();
        this.saveGameState();
        this.showToast(tr('toast.autofilled', { count: updatedCount }));
    }

    clearAllPencilMarks() {
        if (this.isExecutingCascade || this.isPaused) return;

        const previousPencils = [];
        let hadAny = false;

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (this.centerMarks[r][c].size > 0 || this.cornerMarks[r][c].size > 0) {
                    hadAny = true;
                    previousPencils.push({
                        row: r,
                        col: c,
                        prevCenter: new Set(this.centerMarks[r][c]),
                        prevCorner: new Set(this.cornerMarks[r][c])
                    });
                    this.centerMarks[r][c].clear();
                    this.cornerMarks[r][c].clear();
                    this.renderCellContent(r, c);
                }
            }
        }

        if (!hadAny) {
            this.showToast(tr('toast.noPencils'));
            return;
        }

        this.pushAction({
            type: 'clear_pencil',
            previousPencils
        });

        this.audio.playErase();
        this.updateVisualHighlights();
        this.saveGameState();
        this.showToast(tr('toast.pencilsCleared'));
    }

    // =========================================================================
    // PROGRESSIVE DEDUCTIVE HINT SYSTEM (3 STAGES)
    // =========================================================================

    getLocalizedHintPart(hint, part, fallback) {
        const key = hint[`${part}Key`];
        if (!key) return fallback;
        const params = { ...(hint[`${part}Params`] || {}) };
        if (params.unitType && params.unitIndex) {
            params.unit = tr(`unit.${params.unitType}`, { index: params.unitIndex });
        }
        return tr(key, params);
    }

    getLocalizedHintName(hint) {
        return this.getLocalizedHintPart(hint, 'name', hint.nameFallback || hint.technique || '');
    }

    renderCurrentHintStage() {
        const hint = this.currentDeductiveHint;
        if (!hint || this.hintStage <= 0) return;
        const name = this.getLocalizedHintName(hint);

        if (this.hintStage === 1) {
            this.hintStageBadgeEl.textContent = tr('hint.stage1Badge');
            this.hintStageBadgeEl.style.background = '#eab308';
            const direction = this.getLocalizedHintPart(hint, 'stage1', hint.stage1Direction || '');
            this.hintTextEl.textContent = `💡 ${name}: ${direction}`;
            this.btnHintNext.textContent = tr('hint.stage2Action');
        } else if (this.hintStage === 2) {
            this.hintStageBadgeEl.textContent = tr('hint.stage2Badge');
            this.hintStageBadgeEl.style.background = '#38bdf8';
            this.hintTextEl.textContent = `🔍 ${name}: ${tr('hint.stage2Scan')}`;
            this.btnHintNext.textContent = tr('hint.stage3Action');
        } else {
            this.hintStageBadgeEl.textContent = tr('hint.stage3Badge');
            this.hintStageBadgeEl.style.background = '#22c55e';
            const explanation = this.getLocalizedHintPart(hint, 'stage3', hint.stage3Explanation || '');
            this.hintTextEl.textContent = `✅ ${explanation}`;
            this.btnHintNext.textContent = tr('hint.close');
        }
    }

    triggerDeductiveHint() {
        if (this.isExecutingCascade || this.isPaused) return;

        // If hint already active, step to next stage
        if (this.hintStage > 0 && this.currentDeductiveHint) {
            this.stepDeductiveHint();
            return;
        }

        // Refuse to hint on a board that already contains a wrong entry:
        // the hint engine reasons from currentBoard, so a mistake can make it
        // "confidently" suggest an incorrect placement.
        if (this.solutionBoard) {
            let mistakeFound = false;
            for (let r = 0; r < 9 && !mistakeFound; r++) {
                for (let c = 0; c < 9; c++) {
                    const val = this.currentBoard[r][c];
                    if (val !== 0 && val !== this.solutionBoard[r][c]) {
                        mistakeFound = true;
                        break;
                    }
                }
            }
            if (mistakeFound) {
                this.showToast(tr('toast.fixMistake'));
                this.updateVisualHighlights();
                return;
            }
        }

        // Search for deductive hint
        const cands = SudokuEngine.getAllCandidates(this.currentBoard);
        const hint = SudokuEngine.getDeductiveHint(this.currentBoard, cands);

        if (!hint) {
            this.showToast(tr('toast.noBasicHint'));
            return;
        }

        this.hintsCount++;
        this.currentDeductiveHint = hint;
        this.hintStage = 1;

        // Stage 1: Direction
        this.hintBannerEl.classList.remove('hidden');
        this.renderCurrentHintStage();

        this.audio.playInput();
        this.updateVisualHighlights();
    }

    stepDeductiveHint() {
        if (this.isExecutingCascade || !this.currentDeductiveHint) return;

        if (this.hintStage === 1) {
            // Stage 2: Highlight
            this.hintStage = 2;
            this.renderCurrentHintStage();

            this.audio.playPencil();
            this.updateVisualHighlights();
        } else if (this.hintStage === 2) {
            // Stage 3: Apply action & Full explanation
            this.hintStage = 3;
            const hint = this.currentDeductiveHint;

            if (hint.action.type === 'set_value') {
                this.setCellValue(hint.action.row, hint.action.col, hint.action.value);
            } else if (hint.action.type === 'eliminate_candidates') {
                const cellMap = new Map();

                // Group eliminations by cell and capture initial state before any mutations
                hint.action.eliminations.forEach(item => {
                    const key = `${item.row},${item.col}`;
                    if (!cellMap.has(key)) {
                        cellMap.set(key, {
                            row: item.row,
                            col: item.col,
                            digits: new Set(),
                            prevCenter: new Set(this.centerMarks[item.row][item.col]),
                            prevCorner: new Set(this.cornerMarks[item.row][item.col])
                        });
                    }
                    cellMap.get(key).digits.add(item.digit);
                });

                const affectedCells = [];
                cellMap.forEach(cellData => {
                    const { row, col, digits, prevCenter, prevCorner } = cellData;
                    const hasPencil = prevCenter.size > 0 || prevCorner.size > 0;

                    if (!hasPencil) {
                        // If cell had no pencil marks, populate legal candidates minus the eliminated digits
                        const legalCandidates = SudokuEngine.getCandidates(this.currentBoard, row, col);
                        this.centerMarks[row][col] = new Set(legalCandidates.filter(d => !digits.has(d)));
                    } else {
                        digits.forEach(digit => {
                            this.centerMarks[row][col].delete(digit);
                            this.cornerMarks[row][col].delete(digit);
                        });
                    }

                    const nextCenter = new Set(this.centerMarks[row][col]);
                    const nextCorner = new Set(this.cornerMarks[row][col]);
                    this.renderCellContent(row, col);

                    affectedCells.push({
                        row,
                        col,
                        prevCenter,
                        prevCorner,
                        nextCenter,
                        nextCorner
                    });
                });

                this.pushAction({
                    type: 'hint_elimination',
                    affectedCells
                });
                this.saveGameState();
            }

            this.renderCurrentHintStage();

            this.audio.playInput();
            this.updateVisualHighlights();
        } else {
            // Dismiss
            this.dismissDeductiveHint();
        }
    }

    dismissDeductiveHint() {
        this.hintStage = 0;
        this.currentDeductiveHint = null;
        if (this.hintBannerEl) {
            this.hintBannerEl.classList.add('hidden');
        }
        this.updateVisualHighlights();
    }

    /**
     * Separate "Reveal Cell" functionality
     */
    revealCell() {
        if (this.isExecutingCascade || this.isPaused) return;

        if (!this.solutionBoard) {
            this.solutionBoard = SudokuEngine.solve(this.initialBoard);
        }
        if (!this.solutionBoard) {
            this.showToast(tr('toast.noSolution'));
            return;
        }

        const reveal = SudokuEngine.getRevealHint(this.currentBoard, this.solutionBoard, this.selectedCell);
        if (!reveal) {
            this.showToast(tr('toast.allFilled'));
            return;
        }

        this.revealedCount++;
        this.selectCell(reveal.row, reveal.col);
        this.setCellValue(reveal.row, reveal.col, reveal.value);
        this.showToast(tr('toast.revealed', {
            row: reveal.row + 1,
            col: reveal.col + 1,
            value: reveal.value
        }));
    }

    solveBoard() {
        if (this.isExecutingCascade || this.isPaused) return;
        if (!this.solutionBoard) {
            this.solutionBoard = SudokuEngine.solve(this.currentBoard) || SudokuEngine.solve(this.initialBoard);
        }

        if (!this.solutionBoard) {
            this.showToast(tr('toast.noValidSolution'));
            return;
        }

        if (!confirm(tr('confirm.solve'))) return;

        const previousBoard = this.currentBoard.map(r => [...r]);
        const prevCenter = this.centerMarks.map(r => r.map(set => new Set(set)));
        const prevCorner = this.cornerMarks.map(r => r.map(set => new Set(set)));

        this.currentBoard = this.solutionBoard.map(r => [...r]);
        this.centerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
        this.cornerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));

        this.pushAction({
            type: 'full_solve',
            previousBoard,
            prevCenter,
            prevCorner
        });

        this.renderBoard();
        this.updateRemainingCounts();
        this.updateVisualHighlights();
        this.saveGameState();
        this.stopTimer();
        this.showToast(tr('toast.solved'));
    }

    pushAction(action) {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(action);
        this.historyIndex++;
    }

    undo() {
        if (this.isExecutingCascade) return;
        if (this.historyIndex < 0) {
            this.showToast(tr('toast.noUndo'));
            return;
        }

        const action = this.history[this.historyIndex];
        this.historyIndex--;

        if (action.type === 'value_change') {
            // Grace period check (2.5s) for mistake cancellation on undo
            if (action.newVal !== 0 && this.lastMistakeCell) {
                if (this.lastMistakeCell.row === action.row && this.lastMistakeCell.col === action.col) {
                    if (Date.now() - this.lastMistakeTimestamp <= 2500 && this.mistakesCount > 0) {
                        this.mistakesCount--;
                        this.showToast(tr('toast.mistakeUndone'));
                    }
                }
                this.lastMistakeCell = null;
                this.lastMistakeTimestamp = 0;
            }

            this.currentBoard[action.row][action.col] = action.prevVal;
            this.centerMarks[action.row][action.col] = new Set(action.cellPrevCenter);
            this.cornerMarks[action.row][action.col] = new Set(action.cellPrevCorner);
            this.renderCellContent(action.row, action.col);

            if (action.affectedCenter) {
                action.affectedCenter.forEach(item => {
                    if (this.currentBoard[item.row][item.col] === 0 && SudokuEngine.isValid(this.currentBoard, item.row, item.col, item.num)) {
                        this.centerMarks[item.row][item.col].add(item.num);
                        this.renderCellContent(item.row, item.col);
                    }
                });
            }
            if (action.affectedCorner) {
                action.affectedCorner.forEach(item => {
                    if (this.currentBoard[item.row][item.col] === 0 && SudokuEngine.isValid(this.currentBoard, item.row, item.col, item.num)) {
                        this.cornerMarks[item.row][item.col].add(item.num);
                        this.renderCellContent(item.row, item.col);
                    }
                });
            }

            // Reverse the silent restoration that happened when newVal replaced prevVal:
            // prevVal is back in the cell, so its neighborhood pruning must be re-applied,
            // and its safety snapshot put back so a future erase can restore it again.
            {
                const key = `${action.row},${action.col}`;
                if (action.oldSnapshot) {
                    this.repruneSnapshotFromNeighbors(action.oldSnapshot);
                    this.prunedSnapshots[key] = this.cloneSnapshot(action.oldSnapshot);
                } else {
                    delete this.prunedSnapshots[key];
                }
            }
        } else if (action.type === 'corner_toggle') {
            this.cornerMarks[action.row][action.col] = new Set(action.previousState);
            this.renderCellContent(action.row, action.col);
        } else if (action.type === 'center_toggle') {
            this.centerMarks[action.row][action.col] = new Set(action.previousState);
            this.renderCellContent(action.row, action.col);
        } else if (action.type === 'color_change') {
            this.cellColors[action.row][action.col] = action.prevColor;
            this.renderCellContent(action.row, action.col);
        } else if (action.type === 'erase') {
            this.currentBoard[action.row][action.col] = action.prevVal;
            this.centerMarks[action.row][action.col] = new Set(action.prevCenter);
            this.cornerMarks[action.row][action.col] = new Set(action.prevCorner);
            this.renderCellContent(action.row, action.col);

            // Reverse the silent restoration that eraseSelected performed: prevVal is
            // back in the cell, so re-prune its neighborhood and reinstate its snapshot.
            {
                const key = `${action.row},${action.col}`;
                if (action.oldSnapshot) {
                    this.repruneSnapshotFromNeighbors(action.oldSnapshot);
                    this.prunedSnapshots[key] = this.cloneSnapshot(action.oldSnapshot);
                } else {
                    delete this.prunedSnapshots[key];
                }
            }
        } else if (action.type === 'hint_elimination') {
            action.affectedCells.forEach(cell => {
                this.centerMarks[cell.row][cell.col] = new Set(cell.prevCenter);
                this.cornerMarks[cell.row][cell.col] = new Set(cell.prevCorner);
                this.renderCellContent(cell.row, cell.col);
            });
            this.showToast(tr('toast.hintCandidatesRestored'));
        } else if (action.type === 'autofill_pencil') {
            action.previousPencils.forEach(item => {
                this.centerMarks[item.row][item.col] = new Set(item.previous);
                this.renderCellContent(item.row, item.col);
            });
        } else if (action.type === 'clear_pencil') {
            action.previousPencils.forEach(item => {
                this.centerMarks[item.row][item.col] = new Set(item.prevCenter);
                this.cornerMarks[item.row][item.col] = new Set(item.prevCorner);
                this.renderCellContent(item.row, item.col);
            });
        } else if (action.type === 'full_solve') {
            this.currentBoard = action.previousBoard.map(r => [...r]);
            this.centerMarks = action.prevCenter.map(r => r.map(set => new Set(set)));
            this.cornerMarks = action.prevCorner.map(r => r.map(set => new Set(set)));
            this.renderBoard();
            this.startTimer();
        }

        this.audio.playErase();
        this.updateRemainingCounts();
        this.updateVisualHighlights();
        this.saveGameState();
        this.checkGameCompletion();
        this.checkCascadeAvailability();
    }

    redo() {
        if (this.isExecutingCascade) return;
        if (this.historyIndex >= this.history.length - 1) {
            this.showToast(tr('toast.noRedo'));
            return;
        }

        this.historyIndex++;
        const action = this.history[this.historyIndex];

        if (action.type === 'value_change') {
            // Replay the silent restoration that setCellValue performed when it first
            // replaced prevVal with newVal, so neighbor candidates end up identical
            // to the original apply instead of missing the prevVal-snapshot restore.
            // Clear the cell first - at this point in history it still holds prevVal,
            // which would otherwise make isValid reject the very digit being restored
            // as a false self-conflict (same root cause fixed in setCellValue).
            if (action.oldSnapshot) {
                this.currentBoard[action.row][action.col] = 0;
                this.restoreSnapshotToNeighbors(action.oldSnapshot);
            }

            this.currentBoard[action.row][action.col] = action.newVal;
            this.centerMarks[action.row][action.col].clear();
            this.cornerMarks[action.row][action.col].clear();
            if (action.affectedCenter) {
                action.affectedCenter.forEach(item => {
                    this.centerMarks[item.row][item.col].delete(action.newVal);
                    this.renderCellContent(item.row, item.col);
                });
            }
            if (action.affectedCorner) {
                action.affectedCorner.forEach(item => {
                    this.cornerMarks[item.row][item.col].delete(action.newVal);
                    this.renderCellContent(item.row, item.col);
                });
            }
            this.renderCellContent(action.row, action.col);

            const key = `${action.row},${action.col}`;
            if (action.newVal !== 0) {
                this.prunedSnapshots[key] = {
                    cellCenter: new Set(action.cellPrevCenter),
                    cellCorner: new Set(action.cellPrevCorner),
                    affectedCenter: action.affectedCenter,
                    affectedCorner: action.affectedCorner
                };
            } else {
                delete this.prunedSnapshots[key];
            }
        } else if (action.type === 'corner_toggle') {
            const set = this.cornerMarks[action.row][action.col];
            if (set.has(action.num)) set.delete(action.num);
            else set.add(action.num);
            this.renderCellContent(action.row, action.col);
        } else if (action.type === 'center_toggle') {
            const set = this.centerMarks[action.row][action.col];
            if (set.has(action.num)) set.delete(action.num);
            else set.add(action.num);
            this.renderCellContent(action.row, action.col);
        } else if (action.type === 'color_change') {
            this.cellColors[action.row][action.col] = action.newColor;
            this.renderCellContent(action.row, action.col);
        } else if (action.type === 'erase') {
            // Replay the silent restoration that eraseSelected performed before clearing.
            // Clear the cell first for the same self-conflict reason as above.
            if (action.oldSnapshot) {
                this.currentBoard[action.row][action.col] = 0;
                this.restoreSnapshotToNeighbors(action.oldSnapshot);
            }

            this.currentBoard[action.row][action.col] = 0;
            this.centerMarks[action.row][action.col].clear();
            this.cornerMarks[action.row][action.col].clear();
            delete this.prunedSnapshots[`${action.row},${action.col}`];
            this.renderCellContent(action.row, action.col);
        } else if (action.type === 'hint_elimination') {
            action.affectedCells.forEach(cell => {
                this.centerMarks[cell.row][cell.col] = new Set(cell.nextCenter);
                this.cornerMarks[cell.row][cell.col] = new Set(cell.nextCorner);
                this.renderCellContent(cell.row, cell.col);
            });
            this.showToast(tr('toast.hintRedone'));
        } else if (action.type === 'autofill_pencil') {
            action.afterPencils.forEach(item => {
                this.centerMarks[item.row][item.col] = new Set(item.next);
                this.renderCellContent(item.row, item.col);
            });
        } else if (action.type === 'clear_pencil') {
            action.previousPencils.forEach(item => {
                this.centerMarks[item.row][item.col].clear();
                this.cornerMarks[item.row][item.col].clear();
                this.renderCellContent(item.row, item.col);
            });
        } else if (action.type === 'full_solve') {
            this.currentBoard = this.solutionBoard.map(r => [...r]);
            this.centerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
            this.cornerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
            this.renderBoard();
            this.stopTimer();
        }

        this.audio.playInput();
        this.updateRemainingCounts();
        this.updateVisualHighlights();
        this.saveGameState();
        // Skip for full_solve: revealing the solution was never treated as a "win" when
        // first applied (solveBoard doesn't call checkGameCompletion either), so redoing
        // it shouldn't suddenly pop the victory modal that the original action never showed.
        if (action.type !== 'full_solve') {
            this.checkGameCompletion();
        }
        this.checkCascadeAvailability();
    }

    renderBoard() {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                this.renderCellContent(r, c);
            }
        }
    }

    renderCellContent(r, c) {
        const cell = this.boardEl.children[r * 9 + c];
        if (!cell) return;

        const val = this.currentBoard[r][c];
        const isGiven = this.initialBoard[r][c] !== 0;
        const customColor = this.cellColors[r][c];

        cell.className = 'cell';
        if (customColor) {
            cell.dataset.color = customColor;
        } else {
            delete cell.dataset.color;
        }

        if (isGiven) {
            cell.classList.add('given');
        } else if (val !== 0) {
            cell.classList.add('user-input');
        }

        if (val !== 0) {
            cell.innerHTML = `<span>${val}</span>`;
        } else {
            const center = this.centerMarks[r][c];
            const corner = this.cornerMarks[r][c];
            const hasCenter = center && center.size > 0;
            const hasCorner = corner && corner.size > 0;

            if (hasCenter || hasCorner) {
                let html = '<div class="cell-notes-wrapper">';

                // Corner Marks (Snyder)
                if (hasCorner) {
                    html += '<div class="corner-marks-grid">';
                    const sortedCorner = Array.from(corner).sort((a, b) => a - b);
                    sortedCorner.forEach(num => {
                        html += `<span class="corner-mark" data-num="${num}">${num}</span>`;
                    });
                    html += '</div>';
                }

                // Center Marks
                if (hasCenter) {
                    html += `<div class="center-marks-grid${hasCorner ? ' with-corner' : ''}">`;
                    const sortedCenter = Array.from(center).sort((a, b) => a - b);
                    sortedCenter.forEach(num => {
                        html += `<span class="center-mark" data-num="${num}">${num}</span>`;
                    });
                    html += '</div>';
                }

                html += '</div>';
                cell.innerHTML = html;
            } else {
                cell.innerHTML = '';
            }
        }
    }

    updateVisualHighlights() {
        const selected = this.selectedCell;
        let activeNum = this.selectedNumber;
        if (selected) {
            const cellVal = this.currentBoard[selected.row][selected.col];
            if (cellVal !== 0) activeNum = cellVal;
        }

        // Count how many times activeNum is placed on the board
        let activeNumCount = 0;
        if (activeNum > 0) {
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (this.currentBoard[r][c] === activeNum) activeNumCount++;
                }
            }
        }
        const isDigitCompleted = activeNumCount >= 9;

        // Cross-hatching coverage
        const coveredRows = new Set();
        const coveredCols = new Set();
        const coveredBoxes = new Set();

        if (this.settings.highlightDigitLines && activeNum > 0 && !isDigitCompleted) {
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (this.currentBoard[r][c] === activeNum) {
                        coveredRows.add(r);
                        coveredCols.add(c);
                        const bR = Math.floor(r / 3);
                        const bC = Math.floor(c / 3);
                        coveredBoxes.add(`${bR},${bC}`);
                    }
                }
            }
        }

        const conflicts = this.settings.highlightConflicts
            ? SudokuEngine.findConflicts(this.currentBoard)
            : new Set();

        if (this.settings.validateAgainstSolution && this.solutionBoard) {
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    const val = this.currentBoard[r][c];
                    if (val !== 0 && val !== this.solutionBoard[r][c]) {
                        conflicts.add(`${r},${c}`);
                    }
                }
            }
        }

        const boxR = selected ? Math.floor(selected.row / 3) * 3 : -1;
        const boxC = selected ? Math.floor(selected.col / 3) * 3 : -1;

        // Deductive Hint Highlight Targets
        const hintTargets = new Set();
        const hintUnits = { rows: new Set(), cols: new Set(), boxes: new Set() };

        if (this.hintStage === 2 && this.currentDeductiveHint) {
            const hl = this.currentDeductiveHint.stage2Highlight;
            if (hl.cells) {
                hl.cells.forEach(c => hintTargets.add(`${c.row},${c.col}`));
            }
            if (hl.units) {
                hl.units.forEach(u => {
                    if (u.type === 'row') hintUnits.rows.add(u.index);
                    if (u.type === 'col') hintUnits.cols.add(u.index);
                    if (u.type === 'box') hintUnits.boxes.add(u.index);
                });
            }
        }

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cell = this.boardEl.children[r * 9 + c];
                const cellVal = this.currentBoard[r][c];
                const bR = Math.floor(r / 3);
                const bC = Math.floor(c / 3);
                const boxIdx = bR * 3 + bC;

                cell.classList.remove(
                    'selected', 'highlight-rowcol', 'highlight-same',
                    'digit-line-highlight', 'conflict', 'hint-target', 'hint-unit'
                );

                // Deductive Hint Highlighting
                if (hintTargets.has(`${r},${c}`)) {
                    cell.classList.add('hint-target');
                } else if (hintUnits.rows.has(r) || hintUnits.cols.has(c) || hintUnits.boxes.has(boxIdx)) {
                    cell.classList.add('hint-unit');
                }

                // Conflict highlight
                if (conflicts.has(`${r},${c}`)) {
                    cell.classList.add('conflict');
                }

                // Digit cross-hatch coverage
                if (this.settings.highlightDigitLines && activeNum > 0 && !isDigitCompleted) {
                    if (coveredRows.has(r) || coveredCols.has(c) || coveredBoxes.has(`${bR},${bC}`)) {
                        cell.classList.add('digit-line-highlight');
                    }
                }

                // Selected cell & unit highlight
                if (selected) {
                    if (r === selected.row && c === selected.col) {
                        cell.classList.add('selected');
                    } else if (this.settings.highlightArea && (r === selected.row || c === selected.col || (r >= boxR && r < boxR + 3 && c >= boxC && c < boxC + 3))) {
                        cell.classList.add('highlight-rowcol');
                    }
                }

                // Same number highlight
                if (this.settings.highlightSame && activeNum > 0 && cellVal === activeNum) {
                    cell.classList.add('highlight-same');
                }

                // Highlight matching center marks
                const centerMarksEls = cell.querySelectorAll('.center-mark');
                centerMarksEls.forEach(pn => {
                    const num = parseInt(pn.dataset.num, 10);
                    if (activeNum > 0 && !isDigitCompleted && num === activeNum) {
                        pn.classList.add('highlight');
                    } else {
                        pn.classList.remove('highlight');
                    }
                });

                // Highlight matching corner marks
                const cornerMarksEls = cell.querySelectorAll('.corner-mark');
                cornerMarksEls.forEach(pn => {
                    const num = parseInt(pn.dataset.num, 10);
                    if (activeNum > 0 && !isDigitCompleted && num === activeNum) {
                        pn.classList.add('highlight');
                    } else {
                        pn.classList.remove('highlight');
                    }
                });
            }
        }

        this.updateSmartNumpad();
    }

    updateSmartNumpad() {
        if (!this.numpadEl) return;
        let illegalDigits = new Set();
        if (this.inputMode === 'normal' && this.settings.blockConflicts && this.selectedCell) {
            const { row, col } = this.selectedCell;
            if (this.currentBoard[row][col] === 0) {
                const legal = SudokuEngine.getCandidates(this.currentBoard, row, col);
                const legalSet = new Set(legal);
                for (let d = 1; d <= 9; d++) {
                    if (!legalSet.has(d)) illegalDigits.add(d);
                }
            }
        }
        for (let num = 1; num <= 9; num++) {
            const btn = this.numpadEl.children[num - 1];
            if (btn) {
                if (illegalDigits.has(num)) {
                    btn.classList.add('illegal-num');
                } else {
                    btn.classList.remove('illegal-num');
                }
            }
        }
    }

    updateRemainingCounts() {
        const counts = Array(10).fill(0);
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const val = this.currentBoard[r][c];
                if (val >= 1 && val <= 9) counts[val]++;
            }
        }

        for (let num = 1; num <= 9; num++) {
            const rem = 9 - counts[num];
            const badge = document.getElementById(`rem-${num}`);
            const btn = this.numpadEl.children[num - 1];

            if (badge) {
                badge.textContent = rem > 0 ? rem : '✓';
            }

            if (btn) {
                if (rem <= 0) btn.classList.add('completed');
                else btn.classList.remove('completed');
            }
        }
    }

    checkGameCompletion() {
        if (SudokuEngine.isBoardCompleteAndValid(this.currentBoard)) {
            if (this.cascadeBannerEl) {
                this.cascadeBannerEl.classList.add('hidden');
            }
            this.pendingCascadeSteps = null;
            this.stopTimer();
            this.audio.playVictory();
            this.showVictoryModal();
        }
    }

    /**
     * Check if 2 to 12 empty cells remain and can be deterministically solved via a chain of Naked Singles
     */
    checkCascadeAvailability() {
        if (!this.cascadeBannerEl || this.isPaused || this.isExecutingCascade || this.cascadeDismissedForCurrentPuzzle) {
            return;
        }

        if (SudokuEngine.isBoardCompleteAndValid(this.currentBoard)) {
            this.pendingCascadeSteps = null;
            this.cascadeBannerEl.classList.add('hidden');
            return;
        }

        if (!this.solutionBoard) {
            this.solutionBoard = SudokuEngine.solve(this.initialBoard) || SudokuEngine.solve(this.currentBoard);
        }
        if (!this.solutionBoard) {
            this.pendingCascadeSteps = null;
            this.cascadeBannerEl.classList.add('hidden');
            return;
        }

        const steps = SudokuEngine.checkSinglesCascade
            ? SudokuEngine.checkSinglesCascade(this.currentBoard, this.solutionBoard)
            : SudokuEngine.checkNakedSinglesCascade(this.currentBoard, this.solutionBoard);
        if (steps && steps.length > 0) {
            this.pendingCascadeSteps = steps;
            this.cascadeBannerEl.classList.remove('hidden');
        } else {
            this.pendingCascadeSteps = null;
            this.cascadeBannerEl.classList.add('hidden');
        }
    }

    /**
     * Animate cascade completion:
     * 1. Freezes timer
     * 2. Sequentially fills cells with 65ms delay, audio click, and CSS flash
     * 3. Triggers victory modal on finish
     */
    async executeCascadeAutoComplete() {
        if (!this.pendingCascadeSteps || this.pendingCascadeSteps.length === 0 || this.isExecutingCascade) {
            return;
        }

        this.isExecutingCascade = true;
        this.cancelCascadeExecution = false;
        if (this.cascadeBannerEl) {
            this.cascadeBannerEl.classList.add('hidden');
        }

        // Freeze game timer immediately in player's favor
        this.stopTimer();

        const steps = [...this.pendingCascadeSteps];
        this.pendingCascadeSteps = null;

        for (const step of steps) {
            if (this.cancelCascadeExecution) {
                this.cancelCascadeExecution = false;
                this.isExecutingCascade = false;
                return;
            }

            const { row, col, val } = step;
            this.currentBoard[row][col] = val;
            this.centerMarks[row][col].clear();
            this.cornerMarks[row][col].clear();

            // Auto-remove candidate from neighborhood
            const boxR = Math.floor(row / 3) * 3;
            const boxC = Math.floor(col / 3) * 3;
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if ((r === row || c === col || (r >= boxR && r < boxR + 3 && c >= boxC && c < boxC + 3)) && (r !== row || c !== col)) {
                        this.centerMarks[r][c].delete(val);
                        this.cornerMarks[r][c].delete(val);
                    }
                }
            }

            this.renderCellContent(row, col);

            // Visual flash and audio
            const cellEl = this.boardEl.children[row * 9 + col];
            if (cellEl) {
                cellEl.classList.add('cascade-flash');
                setTimeout(() => cellEl.classList.remove('cascade-flash'), 350);
            }
            this.audio.playInput();

            // 65ms delay per cell
            await new Promise(res => setTimeout(res, 65));
            if (this.cancelCascadeExecution) {
                this.cancelCascadeExecution = false;
                this.isExecutingCascade = false;
                return;
            }
        }

        this.isExecutingCascade = false;
        this.renderBoard();
        this.updateRemainingCounts();
        this.updateVisualHighlights();
        this.saveGameState();

        // Trigger victory celebration
        this.audio.playVictory();
        this.showVictoryModal();
    }

    showVictoryModal() {
        document.getElementById('victory-time').textContent = this.formatTime(this.timerSeconds);
        document.getElementById('victory-difficulty').textContent = this.getDifficultyLabel(this.currentDifficulty);
        document.getElementById('victory-mistakes').textContent = `${this.mistakesCount}`;
        document.getElementById('victory-hints').textContent = `${this.hintsCount + this.revealedCount}`;
        this.openModal('modal-victory');
    }

    shareResult() {
        const diffName = this.getDifficultyLabel(this.currentDifficulty);
        const rating = this.currentPuzzleMeta.ratingKey ? tr(this.currentPuzzleMeta.ratingKey) : this.currentPuzzleMeta.rating;
        const timeStr = this.formatTime(this.timerSeconds);
        const totalHints = this.hintsCount + this.revealedCount;

        const shareText = tr('share.text', {
            difficulty: diffName,
            rating,
            time: timeStr,
            mistakes: this.mistakesCount,
            hints: totalHints
        });

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareText).then(() => {
                this.showToast(tr('toast.shareCopied'));
            }).catch(() => {
                this.showToast(tr('toast.shareFailed'));
            });
        } else {
            prompt(tr('share.prompt'), shareText);
        }
    }

    // Timer Methods
    startTimer() {
        this.stopTimer();
        this.timerInterval = setInterval(() => {
            if (!this.isPaused) {
                this.timerSeconds++;
                this.updateTimerDisplay();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    resetTimer() {
        this.stopTimer();
        this.timerSeconds = 0;
        this.updateTimerDisplay();
    }

    updateTimerDisplay() {
        this.timerEl.textContent = this.formatTime(this.timerSeconds);
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    }

    togglePause(forceState = null) {
        this.isPaused = forceState !== null ? forceState : !this.isPaused;
        if (this.isPaused) {
            this.pauseOverlay.classList.remove('hidden');
        } else {
            this.pauseOverlay.classList.add('hidden');
        }
    }

    // Custom Puzzle Loader
    loadCustomPuzzle(input) {
        if (this.isExecutingCascade) {
            this.cancelCascadeExecution = true;
            this.isExecutingCascade = false;
        }
        this.cascadeDismissedForCurrentPuzzle = false;

        const cleaned = input.replace(/[\s\r\n]/g, '').replace(/\./g, '0');
        if (cleaned.length !== 81) {
            alert(tr('custom.invalidLength'));
            return;
        }

        const grid = SudokuEngine.stringToGrid(cleaned);
        const conflicts = SudokuEngine.findConflicts(grid);
        if (conflicts.size > 0) {
            alert(tr('custom.conflicts'));
            return;
        }

        const solved = SudokuEngine.solve(grid);
        if (!solved) {
            alert(tr('custom.unsolvable'));
            return;
        }

        this.closeModal('modal-custom');
        this.isCustomGame = true;
        this.initialBoard = grid;
        this.currentBoard = grid.map(r => [...r]);
        this.solutionBoard = solved;
        this.centerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
        this.cornerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
        this.cellColors = Array(9).fill(null).map(() => Array(9).fill(null));

        this.selectedCell = null;
        this.selectedNumber = 0;
        this.history = [];
        this.historyIndex = -1;
        this.hintsCount = 0;
        this.revealedCount = 0;
        this.mistakesCount = 0;

        this.resetTimer();
        this.startTimer();

        this.currentPuzzleMeta = {
            id: '',
            rating: '',
            note: '',
            idKey: 'meta.custom',
            ratingKey: 'meta.personal'
        };
        this.updatePuzzleMetaDisplay();

        this.renderBoard();
        this.updateRemainingCounts();
        this.updateVisualHighlights();
        this.saveGameState();

        this.pendingCascadeSteps = null;
        if (this.cascadeBannerEl) this.cascadeBannerEl.classList.add('hidden');
        this.checkCascadeAvailability();

        this.showToast(tr('toast.customLoaded'));
    }

    showToast(message) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 2600);
    }

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            if (modalId === 'modal-settings') {
                const map = {
                    'set-enable-snyder': 'enableSnyder',
                    'set-sound-enabled': 'soundEnabled',
                    'set-highlight-same': 'highlightSame',
                    'set-preserve-digit-highlight': 'preserveDigitHighlightOnEmpty',
                    'set-highlight-area': 'highlightArea',
                    'set-highlight-digit-lines': 'highlightDigitLines',
                    'set-auto-remove-pencil': 'autoRemovePencil',
                    'set-highlight-conflicts': 'highlightConflicts',
                    'set-validate-solution': 'validateAgainstSolution',
                    'set-block-conflicts': 'blockConflicts',
                    'set-smart-pencil-grid': 'smartPencilGrid'
                };
                Object.entries(map).forEach(([id, key]) => {
                    const el = document.getElementById(id);
                    if (el) el.checked = !!this.settings[key];
                });
            } else if (modalId === 'modal-algo') {
                const activeAlgo = this.settings.activeAlgorithm || 'mrv';
                const radio = document.getElementById(`algo-${activeAlgo}`);
                if (radio) radio.checked = true;
                document.querySelectorAll('.algo-card').forEach(card => {
                    const cardRadio = card.querySelector('input[type="radio"]');
                    if (cardRadio) card.classList.toggle('active', cardRadio.checked);
                });
            }
            modal.classList.add('open');
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove('open');
    }

    runSelectedAlgorithmSolve() {
        if (this.isExecutingCascade || this.isPaused) return;

        const algo = this.settings.activeAlgorithm || 'mrv';
        const targetBoard = this.currentBoard.some(r => r.some(v => v !== 0))
            ? this.currentBoard
            : this.initialBoard;

        let result = null;
        let algoName = '';

        if (algo === 'mrv') {
            algoName = tr('algo.name.mrv');
            result = SudokuEngine.solveBitwiseMRV(targetBoard);
        } else if (algo === 'seq') {
            algoName = tr('algo.name.seq');
            result = SudokuEngine.solveBitwiseSequential(targetBoard);
        } else if (algo === 'deductive') {
            algoName = tr('algo.name.deductive');
            result = SudokuEngine.solveDeductive(targetBoard);
        }

        if (!result || !result.solvedBoard) {
            const messageKey = algo === 'deductive' && result?.stalled
                ? 'algo.solve.deductiveStalled'
                : 'algo.solve.noResult';
            this.showToast(tr(messageKey));
            return;
        }

        const previousBoard = this.currentBoard.map(r => [...r]);
        const prevCenter = this.centerMarks.map(r => r.map(set => new Set(set)));
        const prevCorner = this.cornerMarks.map(r => r.map(set => new Set(set)));

        this.currentBoard = result.solvedBoard.map(r => [...r]);
        this.centerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
        this.cornerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));

        this.pushAction({
            type: 'full_solve',
            previousBoard,
            prevCenter,
            prevCorner
        });

        this.renderBoard();
        this.updateRemainingCounts();
        this.updateVisualHighlights();
        this.saveGameState();
        this.stopTimer();
        this.closeModal('modal-algo');

        const timeStr = result.timeUs < 1000 ? `${result.timeUs.toFixed(1)} µs` : `${(result.timeUs / 1000).toFixed(2)} ms`;
        const details = result.nodesExplored !== undefined
            ? tr('algo.solve.nodes', { count: result.nodesExplored.toLocaleString() })
            : (result.stepsCount !== undefined ? tr('algo.solve.steps', { count: result.stepsCount.toLocaleString() }) : '');
        this.showToast(tr('algo.solve.success', { algorithm: algoName, time: timeStr, details }));
    }

    runAlgorithmBenchmark() {
        const targetBoard = this.initialBoard.some(r => r.some(v => v !== 0))
            ? this.initialBoard
            : this.currentBoard;

        const resultsEl = document.getElementById('algo-benchmark-results');
        if (!resultsEl) return;

        const cmp = SudokuEngine.compareAlgorithms(targetBoard);
        const mrvTime = cmp.mrv.timeUs < 1000 ? `${cmp.mrv.timeUs.toFixed(1)} µs` : `${(cmp.mrv.timeUs / 1000).toFixed(2)} ms`;
        const seqTime = cmp.seq.timeUs < 1000 ? `${cmp.seq.timeUs.toFixed(1)} µs` : `${(cmp.seq.timeUs / 1000).toFixed(2)} ms`;

        let statusText = tr('algo.status.unique');
        let statusBadgeClass = 'badge-fast';
        if (cmp.mrv.solutionsCount === 0) {
            statusText = tr('algo.status.unsolvable');
            statusBadgeClass = 'badge-standard';
        } else if (cmp.mrv.solutionsCount >= 2) {
            statusText = tr('algo.status.multiple');
            statusBadgeClass = 'badge-standard';
        }

        const absoluteNodes = Math.abs(cmp.nodesSaved);
        const absolutePercent = Math.abs(cmp.nodesSavedPct).toFixed(1);
        const nodesSummary = cmp.nodesSaved >= 0
            ? tr('algo.benchmark.nodesSaved', { count: absoluteNodes.toLocaleString(), percent: absolutePercent })
            : tr('algo.benchmark.nodesExtra', { count: absoluteNodes.toLocaleString(), percent: absolutePercent });
        let speedSummary = tr('algo.benchmark.similar');
        if (Number.isFinite(cmp.speedup) && cmp.speedup > 1.05) {
            speedSummary = tr('algo.benchmark.faster', { ratio: cmp.speedup.toFixed(1) });
        } else if (Number.isFinite(cmp.speedup) && cmp.speedup > 0 && cmp.speedup < 0.95) {
            speedSummary = tr('algo.benchmark.slower', { ratio: (1 / cmp.speedup).toFixed(1) });
        }
        const highlightClass = cmp.speedup < 0.95 ? ' is-slower' : '';

        resultsEl.innerHTML = `
            <div class="algo-results-header">
                <span>${tr('algo.benchmark.title')}</span>
                <span class="algo-badge ${statusBadgeClass}">${statusText}</span>
            </div>
            <table class="algo-table">
                <thead>
                    <tr>
                        <th>${tr('algo.table.metric')}</th>
                        <th>${tr('algo.table.mrv')}</th>
                        <th>${tr('algo.table.sequential')}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${tr('algo.table.nodes')}</td>
                        <td><b>${cmp.mrv.nodesExplored.toLocaleString()}</b></td>
                        <td>${cmp.seq.nodesExplored.toLocaleString()}</td>
                    </tr>
                    <tr>
                        <td>${tr('algo.table.time')}</td>
                        <td><b>${mrvTime}</b></td>
                        <td>${seqTime}</td>
                    </tr>
                    <tr>
                        <td>${tr('algo.table.solutions')}</td>
                        <td>${cmp.mrv.solutionsCount}</td>
                        <td>${cmp.seq.solutionsCount}</td>
                    </tr>
                </tbody>
            </table>
            <div class="algo-highlight-stat${highlightClass}">
                ${nodesSummary} ${speedSummary}
            </div>
        `;
        resultsEl.classList.remove('hidden');
    }

    saveGameState() {
        try {
            const data = {
                initialBoard: this.initialBoard,
                currentBoard: this.currentBoard,
                centerMarks: this.centerMarks.map(r => r.map(set => Array.from(set))),
                cornerMarks: this.cornerMarks.map(r => r.map(set => Array.from(set))),
                cellColors: this.cellColors,
                difficulty: this.currentDifficulty,
                puzzleMeta: this.currentPuzzleMeta,
                timerSeconds: this.timerSeconds,
                hintsCount: this.hintsCount,
                revealedCount: this.revealedCount,
                mistakesCount: this.mistakesCount,
                isCustomGame: this.isCustomGame
            };
            localStorage.setItem('sudoku_pro_game_state_v2', JSON.stringify(data));
        } catch (e) {
            console.warn('Could not save game state to localStorage', e);
        }
    }

    loadGameState() {
        try {
            const raw = localStorage.getItem('sudoku_pro_game_state_v2');
            if (!raw) return false;

            const data = JSON.parse(raw);
            if (!data.initialBoard || !data.currentBoard) return false;

            this.initialBoard = data.initialBoard;
            this.currentBoard = data.currentBoard;
            this.solutionBoard = SudokuEngine.solve(this.initialBoard);

            this.centerMarks = (data.centerMarks || []).map(r => r.map(arr => new Set(arr)));
            this.cornerMarks = (data.cornerMarks || []).map(r => r.map(arr => new Set(arr)));
            this.cellColors = data.cellColors || Array(9).fill(null).map(() => Array(9).fill(null));

            this.currentDifficulty = data.difficulty || 'easy';
            this.diffSelect.value = this.currentDifficulty;
            this.currentPuzzleMeta = data.puzzleMeta || { id: '', rating: '-', note: '' };
            this.timerSeconds = data.timerSeconds || 0;
            this.hintsCount = data.hintsCount || 0;
            this.revealedCount = data.revealedCount || 0;
            this.mistakesCount = data.mistakesCount || 0;
            this.isCustomGame = !!data.isCustomGame;

            this.updatePuzzleMetaDisplay();

            this.renderBoard();
            this.updateRemainingCounts();
            this.updateTimerDisplay();

            if (SudokuEngine.isBoardCompleteAndValid(this.currentBoard)) {
                this.stopTimer();
                if (this.cascadeBannerEl) this.cascadeBannerEl.classList.add('hidden');
            } else {
                this.startTimer();
                this.checkCascadeAvailability();
            }
            return true;
        } catch (e) {
            console.warn('Could not restore game state', e);
            return false;
        }
    }

    saveSettings() {
        try {
            localStorage.setItem('sudoku_pro_settings_v2', JSON.stringify(this.settings));
        } catch (e) {
            console.warn('Could not save settings', e);
        }
    }

    loadSettings() {
        try {
            const raw = localStorage.getItem('sudoku_pro_settings_v2');
            if (raw) {
                this.settings = Object.assign(this.settings, JSON.parse(raw));
            }
        } catch (e) {
            console.warn('Could not load settings', e);
        }
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        if (this.themeIcon) {
            this.themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
    }

    setPencilSize(size) {
        this.settings.pencilSize = size;
        this.applyPencilSize(size);
        this.saveSettings();
    }

    applyPencilSize(size) {
        document.body.classList.remove('pencil-large', 'pencil-xlarge');
        if (size === 'large') document.body.classList.add('pencil-large');
        if (size === 'xlarge') document.body.classList.add('pencil-xlarge');

        ['normal', 'large', 'xlarge'].forEach(s => {
            const btn = document.getElementById(`btn-pencil-size-${s}`);
            if (btn) {
                if (s === size) btn.classList.add('active');
                else btn.classList.remove('active');
            }
        });
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new SudokuApp();
});
