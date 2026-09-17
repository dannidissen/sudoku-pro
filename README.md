# Sudoku Pro 🔢

A dependency-free, browser-based Sudoku game for advanced solvers. Sudoku Pro runs entirely offline and combines progressive deductive hints, Snyder notation, candidate management, cell coloring, multiple solver engines, and a responsive desktop/mobile interface.

The interface is available in English, Hebrew, Yiddish, and Latin. English is the default; Hebrew and Yiddish use right-to-left layout automatically.

**Play online:** https://dannidissen.github.io/sudoku-pro/

The online version can be installed as an app (browser menu → *Install* / *Add to Home screen*) and keeps working offline after the first visit.

## Run locally

No installation, server, or internet connection is required.

- On Windows, double-click `open_game.bat`.
- On any platform, open `index.html` in a modern browser.

## Features

### Progressive deductive hints

The hint engine identifies human-solving techniques instead of revealing a brute-force answer immediately:

1. **Naked Single** — a cell has only one legal candidate.
2. **Hidden Single** — a digit can appear in only one cell of a row, column, or box.
3. **Pointing Pair/Triple** — candidates in a box align on one row or column and eliminate candidates outside the box.
4. **Claiming (Box/Line Reduction)** — every candidate for a digit in a row or column sits inside one box, eliminating it from the rest of that box.
5. **Naked Pair** — two cells in one unit contain the same two candidates, eliminating them elsewhere in that unit.
6. **Hidden Pair** — two digits are confined to the same two cells of a unit, so every other candidate in those cells is removed.
7. **Naked Triple** — three cells in a unit hold only three digits between them, eliminating those digits elsewhere in the unit.
8. **X-Wing** — a digit is restricted to the same two columns in two rows, or the same two rows in two columns.
9. **Swordfish** — the three-row (or three-column) extension of X-Wing.
10. **XY-Wing** — a two-candidate pivot and two pincers force a shared digit out of every cell that sees both pincers.

Eliminations made by an applied hint are remembered for the rest of the puzzle (and undone with the hint), so the next hint builds on them instead of repeating the same step. The Deductive Logic solver uses the same rule and solves every bundled Easy and Medium puzzle and more than half of the Hard ones without guessing.

Hints are presented in three stages:

1. A direction that tells the player where and what to inspect.
2. A visual highlight of the relevant cells and unit.
3. The placement or elimination, followed by a localized explanation.

A separate **Reveal Cell** action is available when the player wants the correct value directly.

### Technique practice

Open **Technique practice** in the header to practice all ten supported deductive techniques, from Naked Single to XY-Wing. Each technique has four guided exercises from different Sudoku Exchange puzzles (40 total), cycling in order. Each drill explains the rule and outlines its pattern; select a cell and use the keypad or number keys to mark a placement or all candidate eliminations. Arrow keys navigate the practice board. The board keeps column 1 on the left in every language so coordinates and candidate positions stay consistent.

Answer checking distinguishes incorrect, incomplete, and correct selections. **Show explanation** reveals the answer and its localized reasoning without counting an independent solve. The session counter tracks distinct correctly answered exercises and resets on page reload. These guided drills assess the displayed pattern rather than every possible valid move on the board.

Exercises replay verified deduction paths from the existing catalogue, including prior candidate eliminations. Practice never modifies the active game, its undo history, or its statistics, and the game timer does not advance while practice is open. All four languages, keyboard navigation, mobile layout, and offline play are supported.

To inspect or regenerate the recipe list, run `node tools/find_training_recipes.cjs`; it prints deterministic source IDs and step counts for `training-recipes.js`. The test suite reconstructs every exercise and checks its candidates and answer against the unique solution.

### Snyder notation and candidate entry

- **Normal mode** enters a final digit.
- **Corner mode** stores Snyder-style candidates around the cell perimeter.
- **Center mode** stores general candidates in a fixed 3×3 layout.

Keyboard shortcuts:

- `Space`, or `Tab` while a board cell has focus: switch input mode. `Shift+Tab` leaves the board.
- `Shift + 1-9`: toggle a corner mark when Snyder mode is enabled.
- `Ctrl + 1-9`: toggle a center mark.
- `Z`, `X`, `C`: select Normal, Corner, or Center mode.
- Arrow keys: move between cells according to the active LTR/RTL layout.
- `Backspace`: erase the selected cell.
- `Ctrl+Z` / `Ctrl+Y`: undo / redo.
- `H`: request a logical hint.

### Candidate safety

When a final digit is placed, matching candidates are pruned from neighboring cells. The game records those changes, persists the safety snapshots across reloads, and restores the candidates if the digit is erased or replaced. A **Refresh Area** action can also recalculate candidates in the selected row, column, and box.

The optional **Keep digit highlight on empty cells** setting controls whether navigation from a filled cell to an empty or pencil-mark-only cell preserves the previous digit highlight.

The **Block conflicting pencil marks** setting (on by default) refuses a corner or center mark whose digit already appears in the same row, column, or box, with the same shake-and-sound feedback as a blocked numpad digit. In a pencil mode the keypad dims those digits too. Marks that are already written stay clickable and erasable, so candidates that turn illegal after a later placement can still be cleaned up.

### Custom puzzles

The **Custom** dialog has a responsive 9×9 editor with its own keypad and keyboard input, plus a two-way synced 81-character text field, a sample puzzle, and clipboard paste. **Check validity & uniqueness** reports conflicts (highlighted in the grid), unsolvable boards, too few clues, multiple solutions, or a unique solution. Boards without a unique solution can still be loaded after a confirmation; exact-solution validation, Reveal, and deterministic cascade solving are then disabled so the game never treats an arbitrary solution as the only correct one.

### Timer and statistics

The timer is checkpointed every second so a reload cannot roll it back. It pauses automatically when the page is hidden — switching tabs, minimizing the window, or locking the phone — so it only measures time spent on the puzzle.

The **Statistics** dialog shows puzzles solved, the current and best daily streak, and the solved count, best time, and average time per difficulty level. Best times only count puzzles solved without deductive hints or revealed cells, and the victory screen announces a new best. Statistics are stored locally and can be reset from the dialog.

### Cell coloring

Four pastel colors help track chains, alternating inferences, and other advanced deductions. Colors work in both themes and participate in undo/redo history.

### Responsive layout

**Focus mode** keeps the board, number keys, input modes, erase, undo, and redo together. It starts automatically at widths up to 900px (also on short, coarse-pointer screens); the header toggle saves an explicit on/off preference locally. Rotation changes the layout without restarting the puzzle: portrait places the controls below the board, while landscape places a 3×3 keypad beside it. Buttons in the focus dock have a minimum 44px height; number keys wrap instead of shrinking into a narrow nine-key strip.

**Tools** opens a scrollable drawer containing hints, candidate tools, colors, difficulty/new game, language, display controls, practice, and other secondary features. Escape, the close button, or the backdrop dismisses it; choosing an action returns to the game or opens the relevant dialog. The timer and pause button remain in the header. Existing controls are moved, not copied, preserving their listeners and the game's state and undo history. The focus preference is independent of game saves and remains optional when storage is unavailable.

The layout reserves device safe-area space and uses a conservative viewport height for the board. Long hints, browser zoom, and exceptionally short screens can scroll rather than clipping controls. Focus mode supports every language and both themes, and is included in the offline app shell. In focus mode, open **Tools → Technique practice** to access drills.

The desktop layout keeps the board, keypad, timer, and controls in a compact workspace. Narrow screens switch to a scrollable single-column layout, with additional handling for the header, language selector, modals, and benchmark table.

### Audio and feedback

Small synthesized effects are generated with the Web Audio API, so no audio assets are required. Sounds can be disabled in Settings. Conflict animations, victory feedback, and a localized share summary are also included.

When the operating system requests reduced motion, animations and transitions are switched off; the conflict shake becomes a color blink so the feedback is not lost.

### Accessibility

The board is a single keyboard Tab stop: focus lands on the selected cell and follows the arrow keys. The custom-puzzle grid supports the same arrow-key navigation. Every cell has a screen-reader name with its row, column, and content (given digit, entered digit, pencil marks, or empty), and changes to the focused cell are announced through a polite live region, as are toasts and hint text. Keypad buttons announce how many of each digit remain. Dialogs expose modal semantics, trap keyboard focus while open, and return focus to the control that opened them.

### Offline app

A web app manifest and a network-first service worker (`sw.js`) let the hosted game be installed and played offline: online visits always fetch the latest files and refresh the cache, which is used only when the network is unavailable. The service worker needs http(s), so opening `index.html` directly from disk works exactly as before without it.

## Languages and directionality

Supported interface languages:

- English (`en`, LTR; default)
- Hebrew (`he`, RTL)
- Yiddish (`yi`, RTL)
- Latin (`la`, LTR)

Static controls, dynamic messages, accessibility labels, puzzle notes, hint explanations, result sharing, and the Algorithm Lab update immediately when the language changes. The selected language is stored locally in the browser.

Translations live in `i18n.js`. Every locale must expose the same keys and preserve the same interpolation placeholders; the test suite enforces both rules.

## Algorithm Lab

The game includes three solver modes:

- **Bitwise MRV** — depth-first backtracking with 9-bit row, column, and box masks. At every level it selects the empty cell with the fewest legal candidates, so contradictions are discovered and pruned early. Its worst-case running time remains exponential, `O(9^m)` for `m` empty cells, but the heuristic dramatically reduces the practical search tree.
- **Sequential Backtracking** — the same recursive search in fixed row-major order. It is intentionally simple and serves as a control that makes the effect of MRV visible. It has the same asymptotic bounds but often explores many more nodes.
- **Deductive Logic** — rebuilds candidate sets and applies human-style rules in increasing order of difficulty. It can place digits and eliminate candidates without guessing; if the available techniques cannot advance the board, it reports a stall instead of silently switching to brute force.

The benchmark runs multiple samples and reports median execution time, explored nodes, and detected solutions. It explicitly reports whether MRV was faster, slower, or effectively similar in the measured run.

The lab also contains a self-contained teaching area:

- a three-step explanation, complexity summary, and trade-off for the selected engine;
- a miniature 9×9 animation that visualizes placements, candidate eliminations, and failed branches without touching the player's board;
- equivalent MRV implementations in JavaScript, modern C++, portable C, and Java, with comments that expose the shared choose/try/recurse/backtrack structure;
- localized controls and live descriptions in English, Hebrew, Yiddish, and Latin, including RTL layout and reduced-motion support.

The animation is generated from the real solver trace callbacks rather than from a prerecorded sequence. Search traces are capped for presentation, then joined to the verified solved grid so the demonstration remains short even for sequential backtracking.

## Puzzle sources

- **Sudoku Exchange Puzzle Bank** — created by Grant McLean with QQWing and rated with Sudoku Explainer; used for Easy through Master levels. The included puzzle data is identified as Public Domain / CC0 by its source.
- **Top1465 benchmark collection** — exceptionally difficult puzzles collected by Guenter Stertenbrink.
- Selected extreme puzzles associated with Dr. Arto Inkala, including **AI Escargot** and **Platinum Blonde**.

Source attribution is also available from the in-game Library dialog.

## Tests

Run the JavaScript test suite from the repository root:

```powershell
node --test tests_js/sudoku-core.test.mjs tests_js/focus-ui.test.cjs
```

The suite verifies:

- all bundled puzzles are structurally valid, unique, and have exactly one solution;
- the deductive solver reports success only when its own logic completes the board;
- every placement and elimination made by the hint engine agrees with the puzzle's unique solution;
- benchmark calculations remain consistent;
- every locale has the complete translation-key and placeholder set;
- RTL/LTR behavior is correct for all supported languages.

## Optional native validator

Build the command-line validator on Windows with:

```powershell
.\build_validator.bat
```

The complete native validator is written in portable C, while the in-game Algorithm Lab includes compact JavaScript, C++, C, and Java versions of the recursive MRV idea. The build script detects GCC, Clang, or Microsoft C/C++. If no supported compiler is installed, it exits with a clear error and does not affect the browser game.

## Project structure

```text
index.html                     Application markup
style.css                      Responsive layout and themes
app.js                         UI, game state, history, and interactions
solver.js                      Puzzle generation, solving, hints, and benchmarks
training.js                    Practice replay and answer checking
training-ui.js                 Isolated technique practice interface
focus-ui.js                    Responsive focus mode and secondary-tool drawer
training-recipes.js            Forty source puzzle IDs and deduction offsets
puzzles.js                     Bundled puzzle catalogue
i18n.js                        English, Hebrew, Yiddish, and Latin translations
sw.js                          Offline service worker
manifest.webmanifest           Installable app metadata
icons/                         App icons and link-preview image
tests_js/sudoku-core.test.mjs  Core and localization tests
tools/sudoku_validator.c       Optional native validator
.github/workflows/tests.yml    Runs the test suite on every push and pull request
```

## Privacy

Sudoku Pro has no backend, analytics, advertisements, or external runtime dependencies. Game settings and progress are stored only in the browser's local storage.

## License

The repository does not currently declare a software license. Public visibility alone does not grant permission to copy, modify, or redistribute the source code. Puzzle datasets retain the attribution and licensing information described above.
