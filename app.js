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
        this.solutionIsUnique = true;

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
        // 'r,c,d' candidates ruled out by applied elimination hints. The engine only sees the
        // board, so without this it would offer the same elimination again on the next hint.
        this.provenEliminations = new Set();

        // Statistics: set once the current puzzle's win has been counted
        this.gameResultRecorded = false;
        this.lastVictoryNewBest = false;

        // History for undo/redo
        this.history = [];
        this.historyIndex = -1;

        // Timer
        this.timerSeconds = 0;
        this.timerInterval = null;
        this.isPaused = false;

        // Focus is restored to the opener when a modal closes.
        this.modalReturnFocus = new Map();

        // Algorithm Lab teaching animation. It always uses a small demo puzzle and never
        // mutates the player's board.
        this.algorithmDemo = null;
        this.algorithmDemoTimer = null;
        this.algorithmDemoPlaying = false;

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

        // Settings switch id -> settings key, filled in by bindSettingCheckbox
        this.settingCheckboxKeys = new Map();

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
            blockConflictingPencil: true,
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
        this.initCustomBoardEditor();

        if (!this.loadGameState()) {
            this.startNewGame(this.currentDifficulty);
        }
    }

    setupDOM() {
        this.boardEl = document.getElementById('sudoku-board');
        this.boardStatusEl = document.getElementById('board-status');
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
                cell.setAttribute('role', 'button');
                cell.tabIndex = r === 0 && c === 0 ? 0 : -1;
                cell.addEventListener('click', () => this.selectCell(r, c));
                // Tabbing into the board selects the cell that receives focus.
                cell.addEventListener('focus', () => {
                    const sel = this.selectedCell;
                    // Paint mode colors on click; merely focusing a cell must not paint it.
                    if (this.activeColor === null && (!sel || sel.row !== r || sel.col !== c)) this.selectCell(r, c);
                });
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
            const difficulty = this.diffSelect.value === 'custom' ? this.currentDifficulty : this.diffSelect.value;
            this.startNewGame(difficulty);
        });

        this.diffSelect.addEventListener('change', (e) => {
            const newDifficulty = e.target.value;
            if (this.hasGameProgress() && !confirm(tr('confirm.difficulty'))) {
                e.target.value = this.isCustomGame ? 'custom' : this.currentDifficulty;
                return;
            }
            this.startNewGame(newDifficulty);
        });

        // Pause / Resume
        this.pauseBtn.addEventListener('click', () => this.togglePause());
        document.getElementById('btn-resume').addEventListener('click', () => this.togglePause(false));

        // Pause when the page is hidden (another tab, minimized window, locked phone) so the
        // timer only measures time spent looking at the puzzle. The timer interval exists only
        // while a game is in progress, so finished or solved boards are left alone.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.timerInterval && !this.isPaused && !this.isExecutingCascade) {
                this.togglePause(true);
            }
            if (document.hidden) this.saveGameState();
        });
        window.addEventListener('pagehide', () => this.saveGameState());

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
        document.getElementById('btn-stats').addEventListener('click', () => this.openModal('modal-stats'));
        document.getElementById('btn-reset-stats').addEventListener('click', () => this.resetStats());
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
                this.updateAlgorithmLab();
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

        document.getElementById('btn-algo-demo-play')?.addEventListener('click', () => this.toggleAlgorithmDemo());
        document.getElementById('btn-algo-demo-reset')?.addEventListener('click', () => this.resetAlgorithmDemo());
        document.getElementById('algo-code-tab-js')?.addEventListener('click', () => this.selectAlgorithmCodeTab('js'));
        document.getElementById('algo-code-tab-cpp')?.addEventListener('click', () => this.selectAlgorithmCodeTab('cpp'));
        document.querySelector('.algo-code-tabs')?.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const selectCpp = event.key === 'ArrowRight' || event.key === 'End';
            this.selectAlgorithmCodeTab(selectCpp ? 'cpp' : 'js');
        });

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
        this.bindSettingCheckbox('set-block-conflicts', 'blockConflicts');
        this.bindSettingCheckbox('set-block-conflicting-pencil', 'blockConflictingPencil');
        this.bindSettingCheckbox('set-smart-pencil-grid', 'smartPencilGrid', (val) => {
            document.body.classList.toggle('classic-pencil-flow', !val);
            this.renderBoard();
        });

        window.addEventListener('sudoku-language-change', () => this.refreshLocalizedUI());
    }

    /**
     * Binds one settings switch to a settings key. The binding is also recorded so the
     * settings modal can re-sync every switch from a single source of truth instead of
     * repeating the id -> key mapping (which used to drift whenever a setting was added).
     */
    bindSettingCheckbox(elementId, settingKey, callback = null) {
        const checkbox = document.getElementById(elementId);
        if (!checkbox) return;
        this.settingCheckboxKeys.set(elementId, settingKey);
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

            const openModal = document.querySelector('.modal-backdrop.open');
            if (openModal && e.key === 'Tab') {
                this.trapModalFocus(openModal, e);
                return;
            }

            const target = e.target;
            const isEditable = target instanceof Element && (
                target.matches('input, textarea, select') || target.isContentEditable
            );
            if (isEditable) return;

            // Route inputs to custom board editor when custom modal is open
            if (document.getElementById('modal-custom')?.classList.contains('open')) {
                if (document.getElementById('custom-board')?.contains(document.activeElement)) {
                    this.handleCustomKeyboard(e);
                }
                return;
            }

            // If any other modal is open, ignore main board keyboard shortcuts
            if (document.querySelector('.modal-backdrop.open')) {
                return;
            }

            // Let ordinary controls keep their native keyboard behavior. Game shortcuts are
            // active only from the board or a non-interactive page surface.
            const isNonBoardControl = target instanceof Element
                && target.closest('button, a, select, summary, [role="button"], [role="radio"]')
                && !target.closest('#sudoku-board');
            if (isNonBoardControl) return;

            // Space / Tab: Fast toggle (Normal <-> Center) when Snyder disabled; 3-way toggle when enabled.
            // Tab only switches modes while focus is on the board, so keyboard users can still Tab
            // between buttons; Shift+Tab always moves focus out of the board.
            const tabSwitchesMode = e.key === 'Tab' && !e.shiftKey && this.boardEl.contains(document.activeElement);
            const spaceSwitchesMode = e.key === ' ' && this.boardEl.contains(document.activeElement);
            if (spaceSwitchesMode || tabSwitchesMode) {
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

    // True when replacing the board would discard player-created work.
    hasGameProgress() {
        if (!this.initialBoard || !this.currentBoard) return false;
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (this.initialBoard[r][c] !== this.currentBoard[r][c]
                    || this.centerMarks[r][c].size > 0
                    || this.cornerMarks[r][c].size > 0
                    || this.cellColors[r][c] !== null) {
                    return true;
                }
            }
        }
        return this.provenEliminations.size > 0;
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
        this.solutionIsUnique = true;

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
        this.provenEliminations = new Set();
        this.gameResultRecorded = false;
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
        if (diff === 'custom') return tr('meta.custom');
        const key = `difficulty.${diff}`;
        const translated = tr(key);
        return translated === key ? diff : translated;
    }

    getCurrentGameDifficultyLabel() {
        return this.isCustomGame ? tr('meta.custom') : this.getDifficultyLabel(this.currentDifficulty);
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
        this.renderBoard();
        this.updateRemainingCounts();
        this.updateVisualHighlights();
        if (this.currentDeductiveHint && this.hintStage > 0) {
            this.renderCurrentHintStage();
        }
        const benchmarkResults = document.getElementById('algo-benchmark-results');
        if (benchmarkResults && !benchmarkResults.classList.contains('hidden')) {
            this.runAlgorithmBenchmark();
        }
        const victoryDifficulty = document.getElementById('victory-difficulty');
        if (victoryDifficulty) victoryDifficulty.textContent = this.getCurrentGameDifficultyLabel();
        this.renderVictoryRecord();
        if (document.getElementById('modal-stats')?.classList.contains('open')) {
            this.renderStats();
        }
        if (document.getElementById('modal-algo')?.classList.contains('open')) {
            this.updateAlgorithmGuide();
            this.renderAlgorithmDemo();
        }
        this.refreshCustomModalLocalization();
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

        // Keep keyboard focus on the selected cell while navigating with the arrow keys.
        if (this.boardEl.contains(document.activeElement)) {
            this.boardEl.children[r * 9 + c]?.focus({ preventScroll: true });
        }
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
                    this.shakeCell(row, col);
                    return;
                }
            }
            this.setCellValue(row, col, num);
        }
    }

    /**
     * A pencil mark for a digit that already sits in the same row, column or box can never
     * turn into a real placement, so writing one is always a slip. When the guard is on we
     * refuse it with the same feedback a blocked numpad digit gets.
     *
     * Only *adding* is guarded: a mark can become illegal after a later placement (for
     * example with automatic candidate removal switched off), and those leftovers must stay
     * erasable. Cells that already hold a digit are left to the callers' own early return.
     */
    isPencilMarkBlocked(row, col, num) {
        if (!this.settings.blockConflictingPencil) return false;
        if (this.currentBoard[row][col] !== 0) return false;
        return !SudokuEngine.getCandidates(this.currentBoard, row, col).includes(num);
    }

    rejectConflictingPencilMark(row, col, num) {
        if (!this.isPencilMarkBlocked(row, col, num)) return false;
        this.audio.playConflict();
        this.shakeCell(row, col);
        this.showToast(tr('toast.pencilConflict', { num }));
        return true;
    }

    shakeCell(row, col) {
        const cellEl = this.boardEl.children[row * 9 + col];
        if (!cellEl) return;
        cellEl.classList.add('shake');
        setTimeout(() => cellEl.classList.remove('shake'), 400);
    }

    toggleCornerMark(row, col, num) {
        if (this.currentBoard[row][col] !== 0) return;

        const set = this.cornerMarks[row][col];
        const hadNum = set.has(num);
        if (!hadNum && this.rejectConflictingPencilMark(row, col, num)) return;

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
        if (!hadNum && this.rejectConflictingPencilMark(row, col, num)) return;

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
                const corrected = this.solutionIsUnique
                    ? this.solutionBoard && newVal === this.solutionBoard[row][col]
                    : newVal !== 0 && SudokuEngine.isValid(this.currentBoard, row, col, newVal);
                if (corrected) {
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
            const isSolutionMismatch = this.solutionIsUnique
                && this.settings.validateAgainstSolution
                && this.solutionBoard
                && (newVal !== this.solutionBoard[row][col]);

            if (hasRuleConflict || isSolutionMismatch) {
                this.mistakesCount++;
                this.lastMistakeTimestamp = Date.now();
                this.lastMistakeCell = { row, col, val: newVal };
                this.audio.playConflict();
                this.shakeCell(row, col);
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
        if (this.solutionIsUnique && this.solutionBoard) {
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
        const cands = SudokuEngine.getAllCandidates(this.currentBoard, this.provenEliminations);
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

                const eliminationKeys = hint.action.eliminations.map(({ row, col, digit }) => `${row},${col},${digit}`);
                eliminationKeys.forEach(key => this.provenEliminations.add(key));

                this.pushAction({
                    type: 'hint_elimination',
                    affectedCells,
                    eliminationKeys
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

        if (!this.solutionIsUnique) {
            this.showToast(tr('toast.revealNeedsUnique'));
            return;
        }

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
            (action.eliminationKeys || []).forEach(key => this.provenEliminations.delete(key));
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
            (action.eliminationKeys || []).forEach(key => this.provenEliminations.add(key));
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

        this.updateCellLabel(r, c);
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

    /**
     * Screen-reader name for a cell: position plus its digit, notes or "empty". When the
     * focused cell's content changes, the new name is also sent to the polite live region,
     * because an aria-label change on the focused element is not announced reliably.
     */
    updateCellLabel(r, c) {
        const cell = this.boardEl.children[r * 9 + c];
        if (!cell) return;

        const val = this.currentBoard[r][c];
        let content;
        if (val !== 0) {
            content = this.initialBoard[r][c] !== 0 ? tr('a11y.given', { value: val }) : `${val}`;
        } else {
            const notes = [...new Set([...this.cornerMarks[r][c], ...this.centerMarks[r][c]])].sort((a, b) => a - b);
            content = notes.length > 0 ? tr('a11y.notes', { digits: notes.join(', ') }) : tr('a11y.empty');
        }

        const label = tr('a11y.cell', { row: r + 1, col: c + 1, content });
        const previous = cell.getAttribute('aria-label');
        cell.setAttribute('aria-label', label);
        if (previous && previous !== label && document.activeElement === cell && this.boardStatusEl) {
            this.boardStatusEl.textContent = label;
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
        const markHighlightNum = this.settings.highlightSame && !isDigitCompleted ? activeNum : 0;

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

        if (this.solutionIsUnique && this.settings.validateAgainstSolution && this.solutionBoard) {
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

                // Roving tabindex: the board is a single Tab stop that lands on the selected cell.
                const isTabStop = selected ? (selected.row === r && selected.col === c) : (r === 0 && c === 0);
                cell.tabIndex = isTabStop ? 0 : -1;

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

                // Highlight matching pencil marks. This follows the "highlight matching
                // digits" setting too - it promises to cover pencil marks, so switching it
                // off has to silence them as well, not just the filled cells above.
                cell.querySelectorAll('.center-mark, .corner-mark').forEach(pn => {
                    const num = parseInt(pn.dataset.num, 10);
                    if (markHighlightNum > 0 && num === markHighlightNum) {
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
        const illegalDigits = new Set();
        const pencilSet = this.inputMode === 'corner' ? this.cornerMarks
            : this.inputMode === 'center' ? this.centerMarks
            : null;
        const guardEnabled = pencilSet
            ? this.settings.blockConflictingPencil
            : this.settings.blockConflicts;

        if (guardEnabled && this.selectedCell) {
            const { row, col } = this.selectedCell;
            if (this.currentBoard[row][col] === 0) {
                const legal = new Set(SudokuEngine.getCandidates(this.currentBoard, row, col));
                // A mark already written in this cell stays clickable: marks can turn illegal
                // after a later placement, and the numpad is how they get erased again.
                const written = pencilSet ? pencilSet[row][col] : null;
                for (let d = 1; d <= 9; d++) {
                    if (!legal.has(d) && !(written && written.has(d))) illegalDigits.add(d);
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
                // Without a label the button reads as two bare numbers ("5 4").
                btn.setAttribute('aria-label', rem > 0
                    ? tr('a11y.numpadDigit', { num, count: rem })
                    : tr('a11y.numpadDone', { num }));
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
     * Check if 2 to 20 empty cells remain and can be solved through a chain of Naked and Hidden Singles.
     */
    checkCascadeAvailability() {
        if (!this.cascadeBannerEl || this.isPaused || this.isExecutingCascade || this.cascadeDismissedForCurrentPuzzle) {
            return;
        }

        if (!this.solutionIsUnique) {
            this.pendingCascadeSteps = null;
            this.cascadeBannerEl.classList.add('hidden');
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
        // Undo/redo can complete the same board again; only the first win is counted.
        if (!this.gameResultRecorded) {
            this.lastVictoryNewBest = this.recordSolvedGame();
        }
        document.getElementById('victory-time').textContent = this.formatTime(this.timerSeconds);
        document.getElementById('victory-difficulty').textContent = this.getCurrentGameDifficultyLabel();
        document.getElementById('victory-mistakes').textContent = `${this.mistakesCount}`;
        document.getElementById('victory-hints').textContent = `${this.hintsCount + this.revealedCount}`;
        this.renderVictoryRecord();
        this.openModal('modal-victory');
    }

    renderVictoryRecord() {
        const recordEl = document.getElementById('victory-record');
        if (!recordEl) return;
        recordEl.hidden = !this.lastVictoryNewBest;
        recordEl.textContent = this.lastVictoryNewBest
            ? tr('victory.newRecord', { difficulty: this.getStatsLevelLabel(this.getStatsLevelKey()) })
            : '';
    }

    // =========================================================================
    // STATISTICS
    // =========================================================================

    getStatsLevelKey() {
        return this.isCustomGame ? 'custom' : this.currentDifficulty;
    }

    getStatsLevelLabel(levelKey) {
        return levelKey === 'custom' ? tr('meta.custom') : this.getDifficultyLabel(levelKey);
    }

    // Local calendar day as an integer, so consecutive days differ by exactly 1 across DST changes.
    getDayNumber(date = new Date()) {
        return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
    }

    loadStats() {
        const stats = { levels: {}, totalSolved: 0, lastSolvedDay: null, currentStreak: 0, bestStreak: 0 };
        try {
            const raw = localStorage.getItem('sudoku_pro_stats_v1');
            if (raw) Object.assign(stats, JSON.parse(raw));
        } catch (e) {
            console.warn('Could not load statistics', e);
        }
        return stats;
    }

    saveStats(stats) {
        try {
            localStorage.setItem('sudoku_pro_stats_v1', JSON.stringify(stats));
        } catch (e) {
            console.warn('Could not save statistics', e);
        }
    }

    /**
     * Counts the current win. Best times only accept puzzles solved without deductive hints
     * or revealed cells, so an assisted solve never replaces a record.
     * @returns {boolean} true when this solve set a new best time for its level
     */
    recordSolvedGame() {
        this.gameResultRecorded = true;
        const stats = this.loadStats();
        const levelKey = this.getStatsLevelKey();
        const level = stats.levels[levelKey] || { solved: 0, totalSeconds: 0, bestSeconds: null };
        stats.levels[levelKey] = level;

        level.solved++;
        level.totalSeconds += this.timerSeconds;
        const assisted = this.hintsCount + this.revealedCount > 0;
        const isNewBest = !assisted && (level.bestSeconds === null || this.timerSeconds < level.bestSeconds);
        if (isNewBest) level.bestSeconds = this.timerSeconds;

        stats.totalSolved++;
        const today = this.getDayNumber();
        if (stats.lastSolvedDay !== today) {
            stats.currentStreak = stats.lastSolvedDay === today - 1 ? stats.currentStreak + 1 : 1;
            stats.lastSolvedDay = today;
        }
        stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);

        this.saveStats(stats);
        this.saveGameState();
        return isNewBest;
    }

    renderStats() {
        const stats = this.loadStats();
        // A streak survives until the end of the day after the last solve.
        const streakAlive = stats.lastSolvedDay !== null && stats.lastSolvedDay >= this.getDayNumber() - 1;
        document.getElementById('stats-total').textContent = `${stats.totalSolved}`;
        document.getElementById('stats-streak').textContent = `${streakAlive ? stats.currentStreak : 0}`;
        document.getElementById('stats-best-streak').textContent = `${stats.bestStreak}`;

        const levelKeys = ['easy', 'medium', 'hard', 'expert', 'master', 'extreme'];
        if (stats.levels.custom) levelKeys.push('custom');

        const body = document.getElementById('stats-table-body');
        body.innerHTML = '';
        for (const levelKey of levelKeys) {
            const level = stats.levels[levelKey] || { solved: 0, totalSeconds: 0, bestSeconds: null };
            const cells = [
                this.getStatsLevelLabel(levelKey),
                `${level.solved}`,
                level.bestSeconds === null ? '—' : this.formatTime(level.bestSeconds),
                level.solved > 0 ? this.formatTime(Math.round(level.totalSeconds / level.solved)) : '—'
            ];
            const row = document.createElement('tr');
            cells.forEach(text => {
                const cell = document.createElement('td');
                cell.textContent = text;
                row.appendChild(cell);
            });
            body.appendChild(row);
        }
    }

    resetStats() {
        if (!confirm(tr('stats.resetConfirm'))) return;
        try {
            localStorage.removeItem('sudoku_pro_stats_v1');
        } catch (e) {
            console.warn('Could not reset statistics', e);
        }
        this.renderStats();
        this.showToast(tr('toast.statsReset'));
    }

    shareResult() {
        const diffName = this.getCurrentGameDifficultyLabel();
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
                this.saveTimerCheckpoint();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.saveTimerCheckpoint();
    }

    resetTimer() {
        this.stopTimer();
        this.timerSeconds = 0;
        this.updateTimerDisplay();
        this.saveTimerCheckpoint();
    }

    updateTimerDisplay() {
        this.timerEl.textContent = this.formatTime(this.timerSeconds);
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    }

    saveTimerCheckpoint() {
        try {
            if (!this.initialBoard || !Array.isArray(this.initialBoard[0])) return;
            localStorage.setItem('sudoku_pro_timer_checkpoint_v1', JSON.stringify({
                puzzle: SudokuEngine.gridToString(this.initialBoard),
                timerSeconds: this.timerSeconds
            }));
        } catch (e) {
            console.warn('Could not save timer checkpoint', e);
        }
    }

    restoreTimerCheckpoint() {
        try {
            const raw = localStorage.getItem('sudoku_pro_timer_checkpoint_v1');
            if (!raw) return;
            const checkpoint = JSON.parse(raw);
            const samePuzzle = checkpoint.puzzle === SudokuEngine.gridToString(this.initialBoard);
            const seconds = Number(checkpoint.timerSeconds);
            if (samePuzzle && Number.isFinite(seconds) && seconds >= 0) {
                this.timerSeconds = Math.max(this.timerSeconds, Math.floor(seconds));
            }
        } catch (e) {
            console.warn('Could not restore timer checkpoint', e);
        }
    }

    togglePause(forceState = null) {
        this.isPaused = forceState !== null ? forceState : !this.isPaused;
        if (this.isPaused) {
            this.pauseOverlay.classList.remove('hidden');
        } else {
            this.pauseOverlay.classList.add('hidden');
        }
        this.saveGameState();
    }

    // -------------------------------------------------------------------------
    // Custom Puzzle Visual Grid & Uniqueness Validator
    // -------------------------------------------------------------------------

    initCustomBoardEditor() {
        if (this.customEditorInitialized) return;
        this.customEditorInitialized = true;

        this.customGrid = Array(9).fill(null).map(() => Array(9).fill(0));
        this.customSelectedCell = { row: 0, col: 0 };
        this.customCellEls = Array(9).fill(null).map(() => Array(9).fill(null));
        this.lastCustomValidation = null;

        const boardEl = document.getElementById('custom-board');
        if (!boardEl) return;
        boardEl.innerHTML = '';

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cell = document.createElement('div');
                cell.className = 'custom-cell';
                cell.dataset.row = r;
                cell.dataset.col = c;
                cell.setAttribute('role', 'gridcell');
                cell.tabIndex = r === 0 && c === 0 ? 0 : -1;

                cell.addEventListener('click', () => {
                    document.getElementById('custom-puzzle-input')?.blur();
                    this.selectCustomCell(r, c, true);
                });
                cell.addEventListener('focus', () => this.selectCustomCell(r, c));

                boardEl.appendChild(cell);
                this.customCellEls[r][c] = cell;
            }
        }

        // Custom Numpad buttons (1-9 and Erase)
        const numpadEl = document.getElementById('custom-numpad');
        if (numpadEl) {
            numpadEl.querySelectorAll('.custom-num-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const num = parseInt(btn.dataset.num, 10);
                    this.inputCustomNumber(num);
                });
            });
        }

        // Clear board button
        const btnClear = document.getElementById('btn-custom-clear');
        if (btnClear) {
            btnClear.addEventListener('click', () => this.clearCustomBoard());
        }

        // Sample puzzle button
        const btnSample = document.getElementById('btn-custom-sample');
        if (btnSample) {
            btnSample.addEventListener('click', () => this.loadCustomSample());
        }

        // Paste button
        const btnPaste = document.getElementById('btn-custom-paste');
        if (btnPaste) {
            btnPaste.addEventListener('click', () => this.pasteCustomBoardFromClipboard());
        }

        // Validate button
        const btnValidate = document.getElementById('btn-custom-validate');
        if (btnValidate) {
            btnValidate.addEventListener('click', () => this.validateCustomBoard(true));
        }

        // Textarea two-way sync
        const inputEl = document.getElementById('custom-puzzle-input');
        if (inputEl) {
            inputEl.addEventListener('input', () => {
                this.syncCustomGridFromText(inputEl.value);
            });
            inputEl.addEventListener('paste', () => {
                setTimeout(() => this.syncCustomGridFromText(inputEl.value), 20);
            });
        }

        this.updateCustomBoardDisplay();
        this.updateCustomCluesBadge();
        this.updateCustomHighlights();
    }

    onOpenCustomModal() {
        this.initCustomBoardEditor();
        this.selectCustomCell(0, 0);
        this.clearCustomValidationStatus();
        this.updateCustomBoardDisplay();
        this.updateCustomCluesBadge();
        this.updateCustomHighlights();
    }

    selectCustomCell(r, c, shouldFocus = false) {
        this.customSelectedCell = { row: r, col: c };
        this.updateCustomHighlights();
        if (shouldFocus) this.customCellEls[r]?.[c]?.focus({ preventScroll: true });
    }

    inputCustomNumber(num) {
        if (!this.customSelectedCell) return;
        const { row, col } = this.customSelectedCell;
        const keepKeyboardFocus = document.getElementById('custom-board')?.contains(document.activeElement);

        if (num >= 1 && num <= 9) {
            this.customGrid[row][col] = num;
            // Auto advance to next cell
            const nextIdx = (row * 9 + col + 1) % 81;
            this.customSelectedCell = { row: Math.floor(nextIdx / 9), col: nextIdx % 9 };
        } else {
            this.customGrid[row][col] = 0;
        }

        this.updateCustomBoardDisplay();
        this.syncCustomTextareaFromGrid();
        this.updateCustomCluesBadge();
        this.clearCustomValidationStatus();
        this.updateCustomHighlights();
        if (keepKeyboardFocus) {
            const selected = this.customSelectedCell;
            this.customCellEls[selected.row]?.[selected.col]?.focus({ preventScroll: true });
        }
        this.audio.playInput();
    }

    eraseCustomCell(moveBack = false) {
        if (!this.customSelectedCell) return;
        const { row, col } = this.customSelectedCell;

        if (this.customGrid[row][col] !== 0) {
            this.customGrid[row][col] = 0;
        } else if (moveBack) {
            const prevIdx = (row * 9 + col - 1 + 81) % 81;
            this.customSelectedCell = { row: Math.floor(prevIdx / 9), col: prevIdx % 9 };
            this.customGrid[this.customSelectedCell.row][this.customSelectedCell.col] = 0;
        } else {
            return;
        }

        this.updateCustomBoardDisplay();
        this.syncCustomTextareaFromGrid();
        this.updateCustomCluesBadge();
        this.clearCustomValidationStatus();
        this.updateCustomHighlights();
        this.audio.playErase();
    }

    handleCustomKeyboard(e) {
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
            return;
        }

        // Backspace
        if (e.key === 'Backspace') {
            e.preventDefault();
            this.eraseCustomCell(true);
            return;
        }

        // Delete or 0
        if (e.key === 'Delete' || e.key === '0') {
            e.preventDefault();
            this.eraseCustomCell(false);
            return;
        }

        // Digits 1-9
        const digitMatch = /^(Digit|Numpad)([1-9])$/.exec(e.code);
        if (digitMatch) {
            e.preventDefault();
            const num = parseInt(digitMatch[2], 10);
            this.inputCustomNumber(num);
            return;
        }

        // Arrow navigation
        if (this.customSelectedCell) {
            let { row, col } = this.customSelectedCell;
            const isRTL = document.documentElement.dir === 'rtl' || document.body.dir === 'rtl' || getComputedStyle(document.body).direction === 'rtl';

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.selectCustomCell((row - 1 + 9) % 9, col, true);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.selectCustomCell((row + 1) % 9, col, true);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const nextCol = isRTL ? (col + 1) % 9 : (col - 1 + 9) % 9;
                this.selectCustomCell(row, nextCol, true);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                const nextCol = isRTL ? (col - 1 + 9) % 9 : (col + 1) % 9;
                this.selectCustomCell(row, nextCol, true);
            }
        }
    }

    updateCustomBoardDisplay() {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cellEl = this.customCellEls[r]?.[c];
                if (!cellEl) continue;
                const val = this.customGrid[r][c];
                cellEl.textContent = val === 0 ? '' : val.toString();
                cellEl.setAttribute('aria-label', tr('a11y.cell', {
                    row: r + 1,
                    col: c + 1,
                    content: val === 0 ? tr('a11y.empty') : `${val}`
                }));
            }
        }
    }

    updateCustomHighlights() {
        if (!this.customSelectedCell) return;
        const { row: selR, col: selC } = this.customSelectedCell;
        const selVal = this.customGrid[selR]?.[selC] || 0;
        const selBox = Math.floor(selR / 3) * 3 + Math.floor(selC / 3);

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cellEl = this.customCellEls[r]?.[c];
                if (!cellEl) continue;

                const isSelected = (r === selR && c === selC);
                const curBox = Math.floor(r / 3) * 3 + Math.floor(c / 3);
                const isUnit = (r === selR || c === selC || curBox === selBox);
                const val = this.customGrid[r][c];
                const isSame = (selVal !== 0 && val === selVal);

                cellEl.classList.toggle('selected', isSelected);
                cellEl.classList.toggle('highlight-unit', isUnit && !isSelected);
                cellEl.classList.toggle('highlight-same', isSame && !isSelected);
                cellEl.tabIndex = isSelected ? 0 : -1;
                cellEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            }
        }
    }

    syncCustomGridFromText(rawText) {
        const cleaned = rawText.replace(/[\s\r\n]/g, '').replace(/\./g, '0');
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const idx = r * 9 + c;
                if (idx < cleaned.length) {
                    const digit = parseInt(cleaned[idx], 10);
                    this.customGrid[r][c] = (digit >= 1 && digit <= 9) ? digit : 0;
                } else {
                    this.customGrid[r][c] = 0;
                }
            }
        }
        this.updateCustomBoardDisplay();
        this.updateCustomCluesBadge();
        this.clearCustomValidationStatus();
        this.updateCustomHighlights();
    }

    syncCustomTextareaFromGrid() {
        const inputEl = document.getElementById('custom-puzzle-input');
        if (!inputEl) return;
        const str = SudokuEngine.gridToString(this.customGrid);
        inputEl.value = str;
    }

    updateCustomCluesBadge() {
        let count = 0;
        if (this.customGrid) {
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (this.customGrid[r][c] !== 0) count++;
                }
            }
        }
        const textEl = document.getElementById('custom-clues-text');
        if (textEl) {
            textEl.textContent = tr('custom.cluesCount', { count });
        }
    }

    clearCustomBoard() {
        this.customGrid = Array(9).fill(null).map(() => Array(9).fill(0));
        this.customSelectedCell = { row: 0, col: 0 };
        this.updateCustomBoardDisplay();
        this.syncCustomTextareaFromGrid();
        this.updateCustomCluesBadge();
        this.clearCustomValidationStatus();
        this.updateCustomHighlights();
        this.clearCustomConflictClasses();
    }

    loadCustomSample() {
        // High quality classic sample puzzle with a proven unique solution
        const samplePuzzle = '003020600900305001001806400008102900700000008006708200002609500800203009005010300';
        this.syncCustomGridFromText(samplePuzzle);
        this.syncCustomTextareaFromGrid();
        this.validateCustomBoard(true);
    }

    async pasteCustomBoardFromClipboard() {
        try {
            if (navigator.clipboard && navigator.clipboard.readText) {
                const text = await navigator.clipboard.readText();
                if (text && text.trim().length > 0) {
                    this.syncCustomGridFromText(text.trim());
                    this.syncCustomTextareaFromGrid();
                    this.validateCustomBoard(true);
                    return;
                }
            }
        } catch (e) {
            console.warn('Clipboard read error', e);
        }
        // Fallback: focus textarea
        const inputEl = document.getElementById('custom-puzzle-input');
        if (inputEl) {
            const details = document.getElementById('custom-string-accordion');
            if (details) details.open = true;
            inputEl.focus();
            inputEl.select();
        }
    }

    clearCustomConflictClasses() {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                this.customCellEls[r]?.[c]?.classList.remove('conflict');
            }
        }
    }

    clearCustomValidationStatus() {
        this.clearCustomConflictClasses();
        const statusEl = document.getElementById('custom-validation-status');
        if (statusEl) {
            statusEl.className = 'custom-validation-status hidden';
            statusEl.innerHTML = '';
        }
        this.lastCustomValidation = null;
    }

    validateCustomBoard(showStatusCard = true) {
        if (!this.customGrid) {
            this.customGrid = Array(9).fill(null).map(() => Array(9).fill(0));
        }

        this.clearCustomConflictClasses();
        const statusEl = document.getElementById('custom-validation-status');

        let clueCount = 0;
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (this.customGrid[r][c] !== 0) clueCount++;
            }
        }

        // 1. Check if empty
        if (clueCount === 0) {
            const msg = tr('custom.statusEmpty');
            if (showStatusCard && statusEl) {
                statusEl.className = 'custom-validation-status status-info';
                statusEl.innerHTML = `<span>ℹ️</span> <div>${msg}</div>`;
            }
            this.lastCustomValidation = { status: 'empty', valid: false, clueCount, message: msg };
            return this.lastCustomValidation;
        }

        // 2. Check for duplicate conflicts
        const conflicts = SudokuEngine.findConflicts(this.customGrid);
        if (conflicts.size > 0) {
            conflicts.forEach(coord => {
                const [r, c] = coord.split(',').map(Number);
                this.customCellEls[r]?.[c]?.classList.add('conflict');
            });
            const msg = tr('custom.statusConflicts', { count: conflicts.size });
            if (showStatusCard && statusEl) {
                statusEl.className = 'custom-validation-status status-error';
                statusEl.innerHTML = `<span>🚫</span> <div><b>${tr('custom.conflicts')}:</b> ${msg}</div>`;
            }
            this.lastCustomValidation = { status: 'conflicts', valid: false, clueCount, conflicts, message: msg };
            return this.lastCustomValidation;
        }

        // 3. Check for fewer than 17 clues (mathematically impossible to have a unique solution)
        if (clueCount < 17) {
            const mrvRes = SudokuEngine.solveBitwiseMRV(this.customGrid, 2);
            if (mrvRes.solutionsCount === 0) {
                const msg = tr('custom.statusUnsolvable');
                if (showStatusCard && statusEl) {
                    statusEl.className = 'custom-validation-status status-error';
                    statusEl.innerHTML = `<span>❌</span> <div>${msg}</div>`;
                }
                this.lastCustomValidation = { status: 'unsolvable', valid: false, clueCount, message: msg };
                return this.lastCustomValidation;
            } else {
                const msg = tr('custom.statusTooFew', { count: clueCount });
                if (showStatusCard && statusEl) {
                    statusEl.className = 'custom-validation-status status-warning';
                    statusEl.innerHTML = `<span>⚠️</span> <div>${msg}</div>`;
                }
                this.lastCustomValidation = {
                    status: 'too_few',
                    valid: false,
                    clueCount,
                    solutionsCount: mrvRes.solutionsCount,
                    solvedBoard: mrvRes.solvedBoard,
                    message: msg
                };
                return this.lastCustomValidation;
            }
        }

        // 4. Solve and test uniqueness (clueCount >= 17)
        const result = SudokuEngine.solveBitwiseMRV(this.customGrid, 2);

        if (result.solutionsCount === 0) {
            const msg = tr('custom.statusUnsolvable');
            if (showStatusCard && statusEl) {
                statusEl.className = 'custom-validation-status status-error';
                statusEl.innerHTML = `<span>❌</span> <div>${msg}</div>`;
            }
            this.lastCustomValidation = { status: 'unsolvable', valid: false, clueCount, message: msg };
            return this.lastCustomValidation;
        }

        if (result.solutionsCount > 1) {
            const msg = tr('custom.statusMultiple');
            if (showStatusCard && statusEl) {
                statusEl.className = 'custom-validation-status status-warning';
                statusEl.innerHTML = `<span>⚠️</span> <div>${msg}</div>`;
            }
            this.lastCustomValidation = {
                status: 'multiple',
                valid: false,
                clueCount,
                solutionsCount: result.solutionsCount,
                solvedBoard: result.solvedBoard,
                message: msg
            };
            return this.lastCustomValidation;
        }

        // Exactly 1 solution! Fully valid unique puzzle!
        const timeMs = (result.timeUs / 1000).toFixed(1);
        const msg = tr('custom.statusUnique', { time: timeMs });
        if (showStatusCard && statusEl) {
            statusEl.className = 'custom-validation-status status-success';
            // The unique-status translation already starts with ✅.
            statusEl.innerHTML = `<div>${msg}</div>`;
        }
        this.lastCustomValidation = {
            status: 'unique',
            valid: true,
            clueCount,
            solutionsCount: 1,
            solvedBoard: result.solvedBoard,
            timeMs,
            message: msg
        };
        return this.lastCustomValidation;
    }

    refreshCustomModalLocalization() {
        this.updateCustomCluesBadge();
        if (this.lastCustomValidation) {
            this.validateCustomBoard(true);
        }
    }

    // Custom Puzzle Loader
    loadCustomPuzzle(input) {
        if (this.isExecutingCascade) {
            this.cancelCascadeExecution = true;
            this.isExecutingCascade = false;
        }
        this.cascadeDismissedForCurrentPuzzle = false;

        if (typeof input === 'string' && input.trim().length > 0) {
            this.syncCustomGridFromText(input.trim());
        }

        const check = this.validateCustomBoard(true);

        if (check.status === 'empty') {
            alert(tr('custom.invalidLength'));
            return;
        }

        if (check.status === 'conflicts') {
            alert(tr('custom.conflicts'));
            return;
        }

        if (check.status === 'unsolvable') {
            alert(tr('custom.unsolvable'));
            return;
        }

        if (check.status === 'multiple' || check.status === 'too_few') {
            const proceed = confirm(tr('custom.warnMultipleConfirm'));
            if (!proceed) return;
        }

        const grid = this.customGrid.map(r => [...r]);
        let solved = check.solvedBoard;
        if (!solved) {
            solved = SudokuEngine.solve(grid);
        }
        if (!solved) {
            alert(tr('custom.unsolvable'));
            return;
        }

        this.closeModal('modal-custom');
        this.isCustomGame = true;
        this.solutionIsUnique = check.status === 'unique';
        this.diffSelect.value = 'custom';
        this.initialBoard = grid;
        this.currentBoard = grid.map(r => [...r]);
        this.solutionBoard = solved;
        this.centerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
        this.cornerMarks = Array(9).fill(null).map(() => Array(9).fill(null).map(() => new Set()));
        this.cellColors = Array(9).fill(null).map(() => Array(9).fill(null));
        this.prunedSnapshots = {};

        this.selectedCell = null;
        this.selectedNumber = 0;
        this.history = [];
        this.historyIndex = -1;
        this.hintsCount = 0;
        this.revealedCount = 0;
        this.mistakesCount = 0;
        this.provenEliminations = new Set();
        this.gameResultRecorded = false;
        this.dismissDeductiveHint();

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
            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLElement) {
                this.modalReturnFocus.set(modalId, activeElement);
            }
            if (modalId === 'modal-settings') {
                this.settingCheckboxKeys.forEach((key, id) => {
                    const el = document.getElementById(id);
                    if (el) el.checked = !!this.settings[key];
                });
            } else if (modalId === 'modal-stats') {
                this.renderStats();
            } else if (modalId === 'modal-algo') {
                const activeAlgo = this.settings.activeAlgorithm || 'mrv';
                const radio = document.getElementById(`algo-${activeAlgo}`);
                if (radio) radio.checked = true;
                document.querySelectorAll('.algo-card').forEach(card => {
                    const cardRadio = card.querySelector('input[type="radio"]');
                    if (cardRadio) card.classList.toggle('active', cardRadio.checked);
                });
                this.updateAlgorithmLab();
            } else if (modalId === 'modal-custom') {
                this.onOpenCustomModal();
            }
            modal.hidden = false;
            modal.setAttribute('aria-hidden', 'false');
            modal.classList.add('open');
            document.body.classList.add('modal-open');
            const dialog = modal.querySelector('[role="dialog"]');
            requestAnimationFrame(() => dialog?.focus({ preventScroll: true }));
        }
    }

    closeModal(modalId, restoreFocus = true) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.classList.remove('open');
        if (modalId === 'modal-algo') this.stopAlgorithmDemo();
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        if (!document.querySelector('.modal-backdrop.open')) {
            document.body.classList.remove('modal-open');
        }
        const returnTarget = this.modalReturnFocus.get(modalId);
        this.modalReturnFocus.delete(modalId);
        if (restoreFocus && returnTarget?.isConnected) {
            returnTarget.focus({ preventScroll: true });
        }
    }

    trapModalFocus(modal, event) {
        const focusable = Array.from(modal.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])'
        )).filter(element => !element.hidden
            && element.getAttribute('aria-hidden') !== 'true'
            && element.getClientRects().length > 0);

        if (focusable.length === 0) {
            event.preventDefault();
            modal.querySelector('[role="dialog"]')?.focus({ preventScroll: true });
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!modal.contains(active) || !focusable.includes(active)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus({ preventScroll: true });
        } else if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus({ preventScroll: true });
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
    }

    updateAlgorithmLab() {
        this.updateAlgorithmGuide();
        this.prepareAlgorithmDemo();
    }

    updateAlgorithmGuide() {
        const algo = this.settings.activeAlgorithm || 'mrv';
        const content = document.getElementById('algo-guide-content');
        const complexity = document.getElementById('algo-guide-complexity');
        const tradeoff = document.getElementById('algo-guide-tradeoff');
        if (!content || !complexity || !tradeoff) return;

        const summary = document.createElement('p');
        summary.textContent = tr(`algo.guide.${algo}.summary`);
        const steps = document.createElement('ol');
        for (let index = 1; index <= 3; index++) {
            const item = document.createElement('li');
            item.textContent = tr(`algo.guide.${algo}.step${index}`);
            steps.appendChild(item);
        }
        content.replaceChildren(summary, steps);
        complexity.textContent = tr(`algo.guide.${algo}.complexity`);
        tradeoff.textContent = tr(`algo.guide.${algo}.tradeoff`);
    }

    prepareAlgorithmDemo() {
        this.stopAlgorithmDemo();
        const puzzle = '020900000048000031000063020009407003003080200400105600030570000250000180000006050';
        const initial = SudokuEngine.stringToGrid(puzzle);
        const algo = this.settings.activeAlgorithm || 'mrv';
        const steps = [];
        const traceLimit = 260;
        let condensed = false;
        const record = step => {
            if (steps.length < traceLimit) steps.push(step);
            else condensed = true;
        };
        let result;

        if (algo === 'seq') {
            result = SudokuEngine.solveBitwiseSequential(initial, 1, { onStep: record });
        } else if (algo === 'deductive') {
            result = SudokuEngine.solveDeductive(initial, {
                onStep: hint => {
                    if (hint.action?.type === 'set_value') {
                        record({
                            type: 'place',
                            algorithm: 'deductive',
                            row: hint.action.row,
                            col: hint.action.col,
                            value: hint.action.value,
                            nameKey: hint.nameKey,
                            technique: hint.technique
                        });
                    } else if (hint.action?.type === 'eliminate_candidates') {
                        record({
                            type: 'eliminate',
                            algorithm: 'deductive',
                            eliminations: hint.action.eliminations,
                            nameKey: hint.nameKey,
                            technique: hint.technique
                        });
                    }
                }
            });
        } else {
            result = SudokuEngine.solveBitwiseMRV(initial, 1, { onStep: record });
        }

        if (result?.solvedBoard) {
            steps.push({ type: 'finish', board: result.solvedBoard, condensed });
        } else {
            steps.push({ type: 'stalled' });
        }

        this.algorithmDemo = {
            algorithm: algo,
            initial,
            board: initial.map(row => [...row]),
            steps,
            index: 0
        };
        this.renderAlgorithmDemo();
        this.renderAlgorithmDemoStatus('algo.demo.ready');
    }

    renderAlgorithmDemo() {
        const demo = this.algorithmDemo;
        const boardEl = document.getElementById('algo-demo-board');
        if (!demo || !boardEl) return;

        if (boardEl.children.length !== 81) {
            boardEl.replaceChildren();
            for (let index = 0; index < 81; index++) {
                const cell = document.createElement('span');
                cell.className = 'algo-demo-cell';
                cell.setAttribute('role', 'gridcell');
                boardEl.appendChild(cell);
            }
        }

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cell = boardEl.children[r * 9 + c];
                const value = demo.board[r][c];
                cell.textContent = value || '';
                cell.classList.toggle('given', demo.initial[r][c] !== 0);
                cell.setAttribute('aria-label', tr('algo.demo.cell', {
                    row: r + 1,
                    col: c + 1,
                    value: value || tr('a11y.empty')
                }));
            }
        }

        const counter = document.getElementById('algo-demo-counter');
        if (counter) counter.textContent = `${demo.index} / ${demo.steps.length}`;
        this.updateAlgorithmDemoPlayButton();
    }

    renderAlgorithmDemoStatus(key, params = {}) {
        const status = document.getElementById('algo-demo-status');
        if (status) status.textContent = tr(key, params);
    }

    resetAlgorithmDemo() {
        if (!this.algorithmDemo) {
            this.prepareAlgorithmDemo();
            return;
        }
        this.stopAlgorithmDemo();
        this.algorithmDemo.board = this.algorithmDemo.initial.map(row => [...row]);
        this.algorithmDemo.index = 0;
        document.querySelectorAll('.algo-demo-cell').forEach(cell => {
            cell.classList.remove('demo-choice', 'demo-backtrack', 'demo-eliminate', 'demo-solved');
        });
        this.renderAlgorithmDemo();
        this.renderAlgorithmDemoStatus('algo.demo.ready');
    }

    toggleAlgorithmDemo() {
        if (!this.algorithmDemo) this.prepareAlgorithmDemo();
        if (this.algorithmDemoPlaying) {
            this.stopAlgorithmDemo();
            return;
        }
        if (this.algorithmDemo.index >= this.algorithmDemo.steps.length) this.resetAlgorithmDemo();

        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            while (this.algorithmDemo.index < this.algorithmDemo.steps.length) {
                this.applyNextAlgorithmDemoStep();
            }
            return;
        }

        this.algorithmDemoPlaying = true;
        this.updateAlgorithmDemoPlayButton();
        this.scheduleAlgorithmDemoStep();
    }

    scheduleAlgorithmDemoStep() {
        if (!this.algorithmDemoPlaying) return;
        if (!this.applyNextAlgorithmDemoStep()) {
            this.stopAlgorithmDemo();
            return;
        }
        const speed = Number(document.getElementById('algo-demo-speed')?.value || 2);
        const delays = { 1: 620, 2: 280, 3: 125, 4: 55 };
        this.algorithmDemoTimer = window.setTimeout(() => this.scheduleAlgorithmDemoStep(), delays[speed] || 280);
    }

    applyNextAlgorithmDemoStep() {
        const demo = this.algorithmDemo;
        if (!demo || demo.index >= demo.steps.length) return false;
        const step = demo.steps[demo.index++];
        const boardEl = document.getElementById('algo-demo-board');
        boardEl?.querySelectorAll('.algo-demo-cell').forEach(cell => {
            cell.classList.remove('demo-choice', 'demo-backtrack', 'demo-eliminate');
        });

        if (step.type === 'place') {
            demo.board[step.row][step.col] = step.value;
            boardEl?.children[step.row * 9 + step.col]?.classList.add('demo-choice');
            const technique = step.nameKey ? tr(step.nameKey) : tr(`algo.name.${step.algorithm}`);
            this.renderAlgorithmDemoStatus('algo.demo.placing', {
                value: step.value,
                row: step.row + 1,
                col: step.col + 1,
                technique
            });
        } else if (step.type === 'backtrack') {
            demo.board[step.row][step.col] = 0;
            boardEl?.children[step.row * 9 + step.col]?.classList.add('demo-backtrack');
            this.renderAlgorithmDemoStatus('algo.demo.backtracking', {
                value: step.value,
                row: step.row + 1,
                col: step.col + 1
            });
        } else if (step.type === 'eliminate') {
            const affected = new Set();
            step.eliminations.forEach(({ row, col }) => {
                affected.add(`${row},${col}`);
                boardEl?.children[row * 9 + col]?.classList.add('demo-eliminate');
            });
            const technique = step.nameKey ? tr(step.nameKey) : step.technique;
            this.renderAlgorithmDemoStatus('algo.demo.eliminating', {
                count: affected.size,
                technique
            });
        } else if (step.type === 'finish') {
            demo.board = step.board.map(row => [...row]);
            boardEl?.querySelectorAll('.algo-demo-cell:not(.given)').forEach(cell => cell.classList.add('demo-solved'));
            this.renderAlgorithmDemoStatus(step.condensed ? 'algo.demo.solvedCondensed' : 'algo.demo.solved');
        } else {
            this.renderAlgorithmDemoStatus('algo.demo.stalled');
        }

        this.renderAlgorithmDemo();
        return demo.index < demo.steps.length;
    }

    stopAlgorithmDemo() {
        if (this.algorithmDemoTimer !== null) {
            window.clearTimeout(this.algorithmDemoTimer);
            this.algorithmDemoTimer = null;
        }
        this.algorithmDemoPlaying = false;
        this.updateAlgorithmDemoPlayButton();
    }

    updateAlgorithmDemoPlayButton() {
        const button = document.getElementById('btn-algo-demo-play');
        if (!button) return;
        button.textContent = this.algorithmDemoPlaying ? tr('algo.demo.pause') : tr('algo.demo.play');
        button.setAttribute('aria-pressed', `${this.algorithmDemoPlaying}`);
    }

    selectAlgorithmCodeTab(language) {
        const isCpp = language === 'cpp';
        const jsTab = document.getElementById('algo-code-tab-js');
        const cppTab = document.getElementById('algo-code-tab-cpp');
        const jsPanel = document.getElementById('algo-code-js');
        const cppPanel = document.getElementById('algo-code-cpp');
        jsTab?.classList.toggle('active', !isCpp);
        cppTab?.classList.toggle('active', isCpp);
        jsTab?.setAttribute('aria-selected', `${!isCpp}`);
        cppTab?.setAttribute('aria-selected', `${isCpp}`);
        if (jsTab) jsTab.tabIndex = isCpp ? -1 : 0;
        if (cppTab) cppTab.tabIndex = isCpp ? 0 : -1;
        if (jsPanel) jsPanel.hidden = isCpp;
        if (cppPanel) cppPanel.hidden = !isCpp;
        (isCpp ? cppTab : jsTab)?.focus({ preventScroll: true });
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

    serializePrunedSnapshots() {
        return Object.fromEntries(Object.entries(this.prunedSnapshots).map(([key, snapshot]) => [key, {
            cellCenter: Array.from(snapshot.cellCenter || []),
            cellCorner: Array.from(snapshot.cellCorner || []),
            affectedCenter: (snapshot.affectedCenter || []).map(item => ({ ...item })),
            affectedCorner: (snapshot.affectedCorner || []).map(item => ({ ...item }))
        }]));
    }

    deserializePrunedSnapshots(rawSnapshots) {
        if (!rawSnapshots || typeof rawSnapshots !== 'object' || Array.isArray(rawSnapshots)) return {};
        const snapshots = {};
        for (const [key, snapshot] of Object.entries(rawSnapshots)) {
            if (!snapshot || typeof snapshot !== 'object') continue;
            snapshots[key] = {
                cellCenter: new Set(Array.isArray(snapshot.cellCenter) ? snapshot.cellCenter : []),
                cellCorner: new Set(Array.isArray(snapshot.cellCorner) ? snapshot.cellCorner : []),
                affectedCenter: Array.isArray(snapshot.affectedCenter) ? snapshot.affectedCenter.map(item => ({ ...item })) : [],
                affectedCorner: Array.isArray(snapshot.affectedCorner) ? snapshot.affectedCorner.map(item => ({ ...item })) : []
            };
        }
        return snapshots;
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
                isCustomGame: this.isCustomGame,
                solutionIsUnique: this.solutionIsUnique,
                prunedSnapshots: this.serializePrunedSnapshots(),
                provenEliminations: Array.from(this.provenEliminations),
                gameResultRecorded: this.gameResultRecorded
            };
            localStorage.setItem('sudoku_pro_game_state_v2', JSON.stringify(data));
            this.saveTimerCheckpoint();
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
            this.prunedSnapshots = this.deserializePrunedSnapshots(data.prunedSnapshots);

            this.currentDifficulty = data.difficulty || 'easy';
            this.currentPuzzleMeta = data.puzzleMeta || { id: '', rating: '-', note: '' };
            this.timerSeconds = data.timerSeconds || 0;
            this.hintsCount = data.hintsCount || 0;
            this.revealedCount = data.revealedCount || 0;
            this.mistakesCount = data.mistakesCount || 0;
            this.isCustomGame = !!data.isCustomGame;
            if (typeof data.solutionIsUnique === 'boolean') {
                this.solutionIsUnique = data.solutionIsUnique;
            } else if (this.isCustomGame) {
                this.solutionIsUnique = SudokuEngine.solveBitwiseMRV(this.initialBoard, 2).solutionsCount === 1;
            } else {
                this.solutionIsUnique = true;
            }
            this.diffSelect.value = this.isCustomGame ? 'custom' : this.currentDifficulty;
            this.provenEliminations = new Set(Array.isArray(data.provenEliminations) ? data.provenEliminations : []);
            // Saves from before statistics existed have no flag; never count an already finished board.
            this.gameResultRecorded = data.gameResultRecorded ?? SudokuEngine.isBoardCompleteAndValid(this.currentBoard);
            this.restoreTimerCheckpoint();

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
if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', () => {
        window.app = new SudokuApp();
    });

    // Offline support and "install app". Service workers need http(s), so opening
    // index.html straight from disk (open_game.bat) simply skips this.
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker registration failed', e));
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SudokuApp;
}
