// Pelimuotorekisterin eheys: jokaisen kuluttajan (moottori, palvelin,
// taulukot, käyttöliittymä) olettamat kentät ovat mukana ja keskenään
// johdonmukaisia.
const test = require('node:test');
const assert = require('node:assert');

const G = require('../public/js/games');

test('rekisteri: neljä pelimuotoa täysillä kentillä', () => {
    assert.deepStrictEqual([...G.GAME_TYPES], ['holdem', 'omaha', 'omaha5', 'omahahilo']);
    for (const type of G.GAME_TYPES) {
        const g = G.gameOf(type);
        assert.strictEqual(g.id, type);
        assert.ok(typeof g.name === 'string' && g.name.length > 0);
        assert.ok([2, 4, 5].includes(g.cardsPerPlayer), type);
        assert.strictEqual(typeof g.hiLo, 'boolean');
        assert.ok(g.maxPlayers >= 2 && g.maxPlayers <= 10);
        // Kortit riittävät: käsikortit + 5 pöytäkorttia
        assert.ok(g.maxPlayers * g.cardsPerPlayer + 5 <= 52, `${type}: kortit eivät riitä`);
        assert.ok(g.keyPattern instanceof RegExp);
        assert.ok(Array.isArray(g.tableSuffixes) && g.tableSuffixes[0] === 'exact');
        assert.ok(g.simCost > 0 && g.exactCost > 0);
    }
    assert.strictEqual(G.MAX_PLAYERS_ANY, 10);
    assert.strictEqual(G.gameOf('omahahilo').hiLo, true);
    assert.strictEqual(G.gameOf('omaha5').cardsPerPlayer, 5);
});

test('isGameType ja gameOf hylkäävät tuntemattoman ja prototyypin avaimet', () => {
    assert.strictEqual(G.isGameType('holdem'), true);
    assert.strictEqual(G.isGameType('razz'), false);
    assert.strictEqual(G.isGameType('toString'), false);
    assert.strictEqual(G.isGameType(undefined), false);
    assert.throws(() => G.gameOf('razz'), /Unknown game type/);
    // Rekisteriä ei voi muuttaa vahingossa
    assert.throws(() => { 'use strict'; G.GAMES.razz = {}; });
});

test('keyPattern: kanoniset avaimet kelpaavat, väärän pelin avaimet eivät', () => {
    const ok = { holdem: ['AA', 'AKs', 'T9o'], omaha: ['AdAc3c2d'], omaha5: ['AsAdKsKdTc'], omahahilo: ['AdAc3c2d'] };
    const bad = { holdem: ['AdAc3c2d', 'AKx', ''], omaha: ['AA', 'AsAdKsKdTc'], omaha5: ['AdAc3c2d'], omahahilo: ['AA'] };
    for (const type of G.GAME_TYPES) {
        const re = G.gameOf(type).keyPattern;
        for (const k of ok[type]) assert.ok(re.test(k), `${type} hyväksyy ${k}`);
        for (const k of bad[type]) assert.ok(!re.test(k), `${type} hylkää '${k}'`);
    }
});

test('inTopPct: raja kuuluu alueeseen pyöristyksestä huolimatta', () => {
    assert.strictEqual(G.inTopPct(30, 30), true);
    assert.strictEqual(G.inTopPct(30.0000000001, 30), true);
    assert.strictEqual(G.inTopPct(30.001, 30), false);
    assert.strictEqual(G.inTopPct(100.0000000001, 100), true);
    assert.strictEqual(G.inTopPct(100.0000001, 100), false);
    assert.strictEqual(G.inTopPct(undefined, 100), false);
    assert.strictEqual(G.inTopPct(null, 100), false);
});
