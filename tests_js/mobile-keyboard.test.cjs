const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../app.js');

function fixture(t) {
    const saved = { window: global.window, document: global.document, Element: global.Element, getComputedStyle: global.getComputedStyle };
    t.after(() => Object.assign(global, saved));
    class Element {
        constructor(kind) { this.kind = kind; }
        matches() { return this.kind === 'input'; }
        closest(selector) {
            if (selector === '#sudoku-board') return this.kind === 'cell' ? this : null;
            if (selector.startsWith('#numpad')) return this.kind === 'gameControl' ? this : null;
            return ['gameControl', 'otherControl', 'cell'].includes(this.kind) ? this : null;
        }
        focus() { global.document.activeElement = this; }
    }
    global.Element = Element;
    global.getComputedStyle = () => ({ direction: 'ltr' });
    const events = {};
    global.window = { addEventListener: (type, fn) => { events[type] = fn; } };
    const nodes = Object.fromEntries(['cell', 'gameControl', 'otherControl', 'input', 'body'].map(k => [k, new Element(k)]));
    let modal = null;
    global.document = {
        activeElement: nodes.cell,
        querySelector: () => modal,
        getElementById: () => null,
        documentElement: { dir: 'ltr' }, body: { dir: 'ltr' }
    };
    const app = Object.assign(Object.create(App.prototype), {
        boardEl: { children: [nodes.cell], contains: el => el === nodes.cell },
        selectedCell: { row: 0, col: 0 }, selectedNumber: 0, activeColor: null,
        currentBoard: Array.from({ length: 9 }, () => Array(9).fill(0)),
        settings: { enableSnyder: false }, inputMode: 'normal',
        setInputMode(mode) { this.inputMode = mode; },
        updateVisualHighlights() {}, audio: { playPencil() {} },
        trapModalFocus() {}, handleNumberInput() {},
        selectCell: App.prototype.selectCell
    });
    app.setupKeyboard();
    return { app, nodes, modal(value) { modal = value; },
        click(node, detail = 1) {
            document.activeElement = node;
            events.click({ target: node, detail });
        },
        key(overrides = {}) {
            const e = { key: ' ', code: 'Space', target: document.activeElement,
                preventDefault() { this.prevented = true; }, ...overrides };
            events.keydown(e);
            return e;
        }
    };
}

test('pointer game controls return focus to the selection and Space cycles both mode configurations', t => {
    const { app, nodes, click, key } = fixture(t);
    click(nodes.gameControl);
    assert.equal(document.activeElement, nodes.cell);
    assert.equal(key().prevented, true);
    assert.equal(app.inputMode, 'center');
    key(); assert.equal(app.inputMode, 'normal');
    app.settings.enableSnyder = true;
    for (const mode of ['corner', 'center', 'normal']) {
        key(); assert.equal(app.inputMode, mode);
    }
    // Tap selection must focus a cell even if the browser left focus on the body.
    document.activeElement = nodes.body;
    app.selectCell(0, 0);
    assert.equal(document.activeElement, nodes.cell);
});

test('keyboard and assistive button activation retains native focus; other controls are never stolen', t => {
    const { app, nodes, click, key } = fixture(t);
    click(nodes.gameControl, 0);
    assert.equal(document.activeElement, nodes.gameControl);
    assert.equal(key().prevented, undefined);
    assert.equal(app.inputMode, 'normal');
    click(nodes.otherControl);
    assert.equal(document.activeElement, nodes.otherControl);
    assert.equal(key().prevented, undefined);
    assert.equal(key({ key: 'Tab', code: 'Tab' }).prevented, undefined);
});

test('Space ignores repeats, modifiers, inputs, dialogs and cascade execution', t => {
    const { app, nodes, key, modal, click } = fixture(t);
    for (const overrides of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { target: nodes.input }]) {
        key(overrides); assert.equal(app.inputMode, 'normal');
    }
    modal({}); key(); click(nodes.gameControl);
    assert.equal(document.activeElement, nodes.gameControl);
    assert.equal(app.inputMode, 'normal');
    modal(null); document.activeElement = nodes.cell;
    app.isExecutingCascade = true;
    key(); assert.equal(app.inputMode, 'normal');
    app.isExecutingCascade = false;
    app.isPaused = true; click(nodes.gameControl);
    assert.equal(document.activeElement, nodes.gameControl);
});

test('Space works from a selected non-interactive surface; Tab stays board-scoped and Shift+Tab exits', t => {
    const { app, nodes, key } = fixture(t);
    document.activeElement = nodes.body;
    key(); assert.equal(app.inputMode, 'center');
    assert.equal(key({ key: 'Tab', code: 'Tab' }).prevented, undefined);
    document.activeElement = nodes.cell;
    key({ key: 'Tab', code: 'Tab' }); assert.equal(app.inputMode, 'normal');
    assert.equal(key({ key: 'Tab', code: 'Tab', shiftKey: true }).prevented, undefined);
    document.activeElement = nodes.body; app.selectedCell = null;
    assert.equal(key().prevented, undefined);
});
