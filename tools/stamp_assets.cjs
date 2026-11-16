#!/usr/bin/env node
'use strict';

/**
 * Keeps the ?v= cache-busting stamps in index.html in sync with file contents.
 *
 *   node tools/stamp_assets.cjs          rewrite every stale stamp
 *   node tools/stamp_assets.cjs --check  report stale stamps, exit 1 if any
 *
 * The stamp is the first 8 hex characters of the SHA-256 of the referenced
 * file, so it changes if and only if that file's bytes change. Returning
 * players therefore never run a cached script against a newer index.html.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DOCUMENT = path.join(ROOT, 'index.html');

// href="file.css?v=abc" / src="file.js?v=abc" — local paths only.
const STAMPED = /(\s(?:href|src)=")(?!https?:|data:|\/\/)([^"?#]+)\?v=([^"#]*)(")/g;
// Local .js/.css references that carry no stamp at all.
const UNSTAMPED = /\s(?:href|src)="(?!https?:|data:|\/\/)([^"?#]+\.(?:js|css))"/g;

function stampFor(assetPath) {
    // Hash with LF endings: that is what git stores and Pages serves, even when
    // core.autocrlf checks the file out with CRLF on Windows.
    const text = fs.readFileSync(path.join(ROOT, assetPath), 'utf8').replace(/\r\n/g, '\n');
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
}

function analyze() {
    const original = fs.readFileSync(DOCUMENT, 'utf8');
    const stale = [];
    const missing = [];

    const updated = original.replace(STAMPED, (match, before, assetPath, currentStamp, after) => {
        if (!fs.existsSync(path.join(ROOT, assetPath))) {
            missing.push(assetPath);
            return match;
        }
        const expected = stampFor(assetPath);
        if (expected !== currentStamp) stale.push({ assetPath, currentStamp, expected });
        return `${before}${assetPath}?v=${expected}${after}`;
    });

    const unstamped = [];
    for (const match of original.matchAll(UNSTAMPED)) {
        if (fs.existsSync(path.join(ROOT, match[1]))) unstamped.push(match[1]);
    }

    return { original, updated, stale, missing, unstamped };
}

function main() {
    const check = process.argv.includes('--check');
    const { original, updated, stale, missing, unstamped } = analyze();

    for (const assetPath of missing) {
        console.error(`index.html references a file that does not exist: ${assetPath}`);
    }
    for (const assetPath of unstamped) {
        console.error(`index.html references ${assetPath} without a ?v= stamp`);
    }

    if (check) {
        for (const entry of stale) {
            console.error(`stale stamp: ${entry.assetPath}?v=${entry.currentStamp} should be ?v=${entry.expected}`);
        }
        const problems = stale.length + missing.length + unstamped.length;
        if (problems > 0) {
            console.error(`\n${problems} problem(s). Run: node tools/stamp_assets.cjs`);
            process.exit(1);
        }
        console.log('All asset stamps are current.');
        return;
    }

    if (missing.length > 0 || unstamped.length > 0) process.exitCode = 1;

    if (updated === original) {
        console.log('All asset stamps are current; index.html unchanged.');
        return;
    }
    fs.writeFileSync(DOCUMENT, updated);
    for (const entry of stale) {
        console.log(`${entry.assetPath}: ${entry.currentStamp} -> ${entry.expected}`);
    }
    console.log(`Updated ${stale.length} stamp(s) in index.html.`);
}

main();
