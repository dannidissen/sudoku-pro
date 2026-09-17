const test = require('node:test');
const assert = require('node:assert/strict');
const FocusUI = require('../focus-ui.js');

// Minimal DOM model for identity-preserving moves and preference behavior.
class Element {
    constructor(id = '') {
        this.id = id;
        this.children = [];
        this.events = {};
        this.attributes = {};
        const classes = new Set();
        this.classList = {
            contains: key => classes.has(key),
            toggle: (key, on) => on ? classes.add(key) : classes.delete(key)
        };
    }
    addEventListener(name, callback) { this.events[name] = callback; }
    setAttribute(key, value) { this.attributes[key] = value; }
    focus() { this.focused = true; }
    append(node) { this.insertBefore(node, null); }
    insertBefore(node, sibling) {
        if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
        const index = sibling ? this.children.indexOf(sibling) : this.children.length;
        this.children.splice(index, 0, node);
        node.parent = this;
    }
    before(node) { this.parent.insertBefore(node, this); }
    after(node) { this.parent.insertBefore(node, this.parent.children[this.parent.children.indexOf(this) + 1]); }
}

function fixture({ small = true, saved = null, unavailable = false } = {}) {
    const nodes = new Map();
    const get = selector => {
        if (!nodes.has(selector)) nodes.set(selector, new Element(selector.replace(/^#/, '')));
        return nodes.get(selector);
    };
    const root = new Element('root');
    const selectors = ['#btn-focus', '#btn-focus-tools', '#modal-tools', '#focus-dock', '#focus-edit-tools', '#focus-secondary', '#focus-timer', '.header-actions', '.color-palette-group', '.control-column', '.timer-card', '#numpad', '.mode-selector-group', '#btn-erase', '#btn-undo', '#btn-redo'];
    selectors.forEach(s => root.append(get(s)));
    get('#focus-dock').append(get('#focus-edit-tools'));
    ['.timer-card', '#btn-erase', '#btn-undo', '#btn-redo'].forEach(s => get('.control-column').append(get(s)));
    const originals = new Map(selectors.map(s => [s, { parent: get(s).parent, node: get(s) }]));
    const undoListener = () => 'existing game listener';
    get('#btn-undo').addEventListener('click', undoListener);
    const media = { matches: small, addEventListener(_, fn) { this.changed = fn; } };
    let stored = saved;
    global.document = { body: new Element('body'), getElementById: id => get(`#${id}`), querySelector: get, createComment: () => new Element() };
    global.window = { matchMedia: () => media };
    global.localStorage = {
        getItem() { if (unavailable) throw Error('denied'); return stored; },
        setItem(_, value) { if (unavailable) throw Error('denied'); stored = value; }
    };
    const app = {
        openModal() { get('#modal-tools').classList.toggle('open', true); },
        closeModal() { get('#modal-tools').classList.toggle('open', false); }
    };
    const ui = new FocusUI(app);
    return { ui, get, media, originals, undoListener, stored: () => stored };
}

test('automatic responsive focus moves the same controls and restores their original parents', () => {
    const { ui, get, media, originals, undoListener } = fixture();
    assert.equal(ui.enabled, true);
    assert.equal(get('#btn-undo').parent, get('#focus-edit-tools'));
    assert.equal(get('.timer-card').parent, get('#focus-timer'));
    assert.deepEqual(get('#focus-dock').children.map(n => n.id), ['.mode-selector-group', 'numpad', 'focus-edit-tools']);
    for (let cycle = 0; cycle < 3; cycle++) {
        media.matches = false;
        media.changed();
        assert.equal(ui.enabled, false);
        for (const [selector, original] of originals) {
            assert.equal(get(selector), original.node);
            assert.equal(get(selector).parent, original.parent, selector);
        }
        media.matches = true;
        media.changed();
    }
    assert.equal(get('#btn-undo').events.click, undoListener);
});

test('explicit toggle survives viewport changes and saved preference wins on startup', () => {
    const { ui, get, media, stored } = fixture();
    get('#btn-focus').events.click();
    assert.equal(stored(), 'false');
    assert.equal(get('#btn-focus').attributes['aria-pressed'], 'false');
    media.changed();
    assert.equal(ui.enabled, false);
    assert.equal(fixture({ small: true, saved: 'false' }).ui.enabled, false);
    assert.equal(fixture({ small: false, saved: 'true' }).ui.enabled, true);
});

test('storage failures and invalid preferences still leave focus mode usable', () => {
    const { ui, get } = fixture({ unavailable: true });
    get('#btn-focus').events.click();
    assert.equal(ui.enabled, false);
    assert.equal(fixture({ saved: 'invalid', small: false }).ui.enabled, false);
});

test('leaving automatic focus closes its drawer before restoring controls', () => {
    const { get, media } = fixture();
    get('#btn-focus-tools').events.click();
    assert.equal(get('#modal-tools').classList.contains('open'), true);
    media.matches = false;
    media.changed();
    assert.equal(get('#modal-tools').classList.contains('open'), false);
    assert.equal(get('#btn-focus-tools').hidden, true);
    assert.equal(get('#btn-focus').focused, true);
});
