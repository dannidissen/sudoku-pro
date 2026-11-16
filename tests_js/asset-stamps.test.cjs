const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Guards the cache-busting contract: every local asset index.html loads carries a
// ?v= stamp derived from its own bytes. Without this, changing app.js without
// touching the stamp leaves returning players on a cached copy of the old file
// while they receive the new index.html.

const ROOT = path.resolve(__dirname, '..');
const DOCUMENT = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const STAMPED = /\s(?:href|src)="(?!https?:|data:|\/\/)([^"?#]+)\?v=([^"#]*)"/g;
const UNSTAMPED = /\s(?:href|src)="(?!https?:|data:|\/\/)([^"?#]+\.(?:js|css))"/g;

function stampFor(assetPath) {
    // Same LF normalisation as tools/stamp_assets.cjs.
    const text = fs.readFileSync(path.join(ROOT, assetPath), 'utf8').replace(/\r\n/g, '\n');
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
}

test('every stamped asset in index.html exists and its stamp matches its contents', () => {
    const stamped = [...DOCUMENT.matchAll(STAMPED)];
    assert.ok(stamped.length > 0, 'index.html should reference stamped local assets');

    for (const [, assetPath, stamp] of stamped) {
        assert.ok(
            fs.existsSync(path.join(ROOT, assetPath)),
            `index.html references a missing file: ${assetPath}`
        );
        assert.equal(
            stamp,
            stampFor(assetPath),
            `${assetPath} changed without restamping. Run: node tools/stamp_assets.cjs`
        );
    }
});

test('no local script or stylesheet is loaded without a ?v= stamp', () => {
    const unstamped = [...DOCUMENT.matchAll(UNSTAMPED)]
        .map(match => match[1])
        .filter(assetPath => fs.existsSync(path.join(ROOT, assetPath)));

    assert.deepEqual(
        unstamped,
        [],
        `these assets need a ?v= stamp: ${unstamped.join(', ')}`
    );
});

test('the service worker caches every script and stylesheet index.html loads', () => {
    const worker = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const shell = worker.slice(worker.indexOf('APP_SHELL'), worker.indexOf('];', worker.indexOf('APP_SHELL')));

    for (const [, assetPath] of DOCUMENT.matchAll(STAMPED)) {
        assert.ok(
            shell.includes(`'${assetPath}'`),
            `sw.js APP_SHELL is missing ${assetPath}, so it is unavailable offline`
        );
    }
});
