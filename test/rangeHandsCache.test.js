// Laajennettujen käsialueiden välimuisti: tavubudjetti ja LRU-häätö.
const test = require('node:test');
const assert = require('node:assert');

const { createCache, parseBudget } = require('../rangeHandsCache');

const sab = bytes => new SharedArrayBuffer(bytes);

test('parseBudget: oletus 96 MB, 0 poistaa käytöstä, roska antaa oletuksen', () => {
    assert.strictEqual(parseBudget(undefined), 96 * 1024 * 1024);
    assert.strictEqual(parseBudget(''), 96 * 1024 * 1024);
    assert.strictEqual(parseBudget('0'), 0);
    assert.strictEqual(parseBudget('1.5'), Math.floor(1.5 * 1024 * 1024));
    assert.strictEqual(parseBudget('abc'), 96 * 1024 * 1024);
    assert.strictEqual(parseBudget('-3'), 96 * 1024 * 1024);
});

test('set/get: vain SharedArrayBuffer, budjettia suurempi hylätään', () => {
    const c = createCache(100);
    assert.strictEqual(c.set('a', new ArrayBuffer(10)), false);
    assert.strictEqual(c.set('a', sab(101)), false);
    assert.strictEqual(c.set('a', sab(60)), true);
    assert.strictEqual(c.size(), 1);
    assert.strictEqual(c.bytes(), 60);
    assert.ok(c.get('a') instanceof SharedArrayBuffer);
    assert.strictEqual(c.get('x'), undefined);
    // Budjetti 0 = pois käytöstä
    const off = createCache(0);
    assert.strictEqual(off.set('a', sab(1)), false);
    assert.strictEqual(off.size(), 0);
});

test('häätö: vanhin käytetty lähtee ensin, get virkistää', () => {
    const c = createCache(100);
    c.set('a', sab(40));
    c.set('b', sab(40));
    c.get('a');                 // a on nyt tuoreempi kuin b
    c.set('c', sab(40));        // ei mahdu: b häädetään
    assert.strictEqual(c.has('a'), true);
    assert.strictEqual(c.has('b'), false);
    assert.strictEqual(c.has('c'), true);
    assert.strictEqual(c.bytes(), 80);
    // Sama tunniste uudelleen: vanha koko vapautuu
    c.set('a', sab(50));
    assert.strictEqual(c.bytes(), 90);
    assert.strictEqual(c.size(), 2);
    // Iso merkintä häätää useamman
    c.set('d', sab(95));
    assert.deepStrictEqual([c.has('a'), c.has('c'), c.has('d')], [false, false, true]);
    c.clear();
    assert.strictEqual(c.size(), 0);
    assert.strictEqual(c.bytes(), 0);
});
