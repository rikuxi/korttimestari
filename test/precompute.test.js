const test = require('node:test');
const assert = require('node:assert');
const { formatSims, buildCsv } = require('../scripts/precompute');

test('formatSims muotoilee simulaatiomäärän tiedostonimeen', () => {
    assert.strictEqual(formatSims(1000000), '1m');
    assert.strictEqual(formatSims(5000000), '5m');
    assert.strictEqual(formatSims(100000), '100k');
    assert.strictEqual(formatSims(250000), '250k');
    assert.strictEqual(formatSims(1000), '1k');
    assert.strictEqual(formatSims(12345), '12345');
});

const SAMPLE_HANDS = [
    { key: 'AA', rank: 1, combos: 6, equity: 49.1874, win: 48.9663, tie: 0.5574 },
    { key: 'AKs', rank: 5, combos: 4, equity: 31.09, win: 30.5, tie: 1.2 }
];

test('buildCsv std-tyyli: pilkkuerotin, desimaalipiste, ei BOMia', () => {
    const csv = buildCsv(SAMPLE_HANDS, 'std');
    const lines = csv.trimEnd().split('\n');
    assert.strictEqual(lines[0], 'rank,hand,combos,equity_pct,win_pct,tie_pct');
    assert.strictEqual(lines[1], '1,AA,6,49.1874,48.9663,0.5574');
    assert.strictEqual(lines[2], '5,AKs,4,31.09,30.5,1.2');
    assert.ok(!csv.startsWith('\uFEFF'));
});

test('buildCsv lisää label-sarakkeen kun riveillä on label (Omaha)', () => {
    const omahaHands = [
        { key: 'AdAcKdKc', label: 'AAKK (ds)', rank: 1, combos: 6, equity: 34.94, win: 34.1, tie: 1.0 }
    ];
    const csv = buildCsv(omahaHands, 'std');
    const lines = csv.trimEnd().split('\n');
    assert.strictEqual(lines[0], 'rank,hand,label,combos,equity_pct,win_pct,tie_pct');
    assert.strictEqual(lines[1], '1,AdAcKdKc,AAKK (ds),6,34.94,34.1,1');
});

test('buildCsv fi-tyyli: puolipiste, desimaalipilkku, UTF-8 BOM', () => {
    const csv = buildCsv(SAMPLE_HANDS, 'fi');
    assert.ok(csv.startsWith('\uFEFF'));
    const lines = csv.slice(1).trimEnd().split('\n');
    assert.strictEqual(lines[0], 'sija;käsi;kombot;equity_%;voitto_%;tasapeli_%');
    assert.strictEqual(lines[1], '1;AA;6;49,1874;48,9663;0,5574');
    assert.strictEqual(lines[2], '5;AKs;4;31,09;30,5;1,2');
});
