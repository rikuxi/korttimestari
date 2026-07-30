// Osittaiskäsihaun testit (handSearch.js). Sovitus ajetaan pientä
// käsintehtyä taulukkoa ja oikeita datatiedostoja vasten.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseQuery, searchTable } = require('../handSearch');

/** Taulukko suoraan avaimista (rank/equity eivät ole olennaisia täällä) */
function tableOf(keys) {
    const rows = keys.map((key, i) => ({ key, rank: i + 1, equity: 100 - i }));
    return { rows };
}

function keysOf(result) {
    return result.hands.map(h => h.key);
}

// --- Jäsennys ----------------------------------------------------------

test('parseQuery: muodot ja virheet', () => {
    assert.strictEqual(parseQuery('', 'omaha'), null);
    assert.strictEqual(parseQuery('   ', 'omaha'), null);

    const plain = parseQuery('aaj', 'omaha');
    assert.strictEqual(plain.cards.length, 3);
    assert.strictEqual(plain.groupCount, 0);

    const groups = parseQuery('(AJ)(aj)', 'omaha');
    assert.strictEqual(groups.groupCount, 2);
    assert.ok(groups.cards.every(c => c.group !== null));

    // Konkreettiset maat: sama kirjain = sama ryhmä
    const cardsQ = parseQuery('AsKsQh', 'omaha');
    assert.strictEqual(cardsQ.groupCount, 2);

    // Hold'em-lyhennys voittaa maatulkinnan
    const suited = parseQuery('AKs', 'holdem');
    assert.strictEqual(suited.groupCount, 1);
    const offsuit = parseQuery('AKo', 'holdem');
    assert.strictEqual(offsuit.groupCount, 2);

    assert.throws(() => parseQuery('AAX', 'omaha'), /Invalid query/);
    assert.throws(() => parseQuery('(AJ', 'omaha'), /Invalid query/);
    assert.throws(() => parseQuery('()', 'omaha'), /Invalid query/);
    assert.throws(() => parseQuery('AAKKQ', 'omaha'), /at most 4/);
    assert.throws(() => parseQuery('AAs', 'holdem'), /pair/);
});

// --- Sovitus -----------------------------------------------------------

test('haku: pelkät arvot ovat monijoukkopeite', () => {
    const t = tableOf(['AdAcKdKc', 'AdAcJdJc', 'AsKhQdJc', 'KsKhQdQc']);
    assert.deepStrictEqual(keysOf(searchTable(t, 'omaha', parseQuery('AA', 'omaha'), 0, 10)),
        ['AdAcKdKc', 'AdAcJdJc']);
    assert.deepStrictEqual(keysOf(searchTable(t, 'omaha', parseQuery('KQ', 'omaha'), 0, 10)),
        ['AsKhQdJc', 'KsKhQdQc']);
    assert.deepStrictEqual(keysOf(searchTable(t, 'omaha', parseQuery('KK', 'omaha'), 0, 10)),
        ['AdAcKdKc', 'KsKhQdQc']);
});

test('haku: maaryhmät sitovat samaan maahan, eri ryhmät eri maihin', () => {
    // AAKK kolmena maarakenteena: ds, ss (kolme maata) ja neljä maata.
    const t2 = tableOf(['AdAcKdKc', 'AdAcKcKh', 'AsAhKdKc']);
    // (AK)(AK) = kaksi samamaista AK-paria eri maissa -> vain ds täsmää
    assert.deepStrictEqual(keysOf(searchTable(t2, 'omaha', parseQuery('(AK)(AK)', 'omaha'), 0, 10)),
        ['AdAcKdKc']);
    // (AK) = vähintään yksi samamainen AK-pari -> ds ja ss
    assert.deepStrictEqual(keysOf(searchTable(t2, 'omaha', parseQuery('(AK)', 'omaha'), 0, 10)),
        ['AdAcKdKc', 'AdAcKcKh']);
    // AsAh = ässät eri maissa -> kaikki kolme (ässät ovat aina eri maissa)
    assert.strictEqual(searchTable(t2, 'omaha', parseQuery('AsAh', 'omaha'), 0, 10).total, 3);
    // (AA) = ässät samassa maassa -> mahdoton
    assert.strictEqual(searchTable(t2, 'omaha', parseQuery('(AA)', 'omaha'), 0, 10).total, 0);
});

test('haku: hold\'em-luokat ja lyhennykset', () => {
    const t = tableOf(['AA', 'AKs', 'AKo', 'KQs', '72o']);
    assert.deepStrictEqual(keysOf(searchTable(t, 'holdem', parseQuery('AK', 'holdem'), 0, 10)),
        ['AKs', 'AKo']);
    assert.deepStrictEqual(keysOf(searchTable(t, 'holdem', parseQuery('AKs', 'holdem'), 0, 10)),
        ['AKs']);
    assert.deepStrictEqual(keysOf(searchTable(t, 'holdem', parseQuery('AKo', 'holdem'), 0, 10)),
        ['AKo']);
    assert.deepStrictEqual(keysOf(searchTable(t, 'holdem', parseQuery('A', 'holdem'), 0, 10)),
        ['AA', 'AKs', 'AKo']);
    // Konkreettiset maat toimivat myös: AsKs = suited
    assert.deepStrictEqual(keysOf(searchTable(t, 'holdem', parseQuery('AsKs', 'holdem'), 0, 10)),
        ['AKs']);
});

test('haku: sivutus ja tyhjä kysely selaa kaikki', () => {
    const t = tableOf(['AA', 'KK', 'QQ', 'JJ', 'TT']);
    const page = searchTable(t, 'holdem', null, 1, 2);
    assert.strictEqual(page.total, 5);
    assert.deepStrictEqual(keysOf(page), ['KK', 'QQ']);
});

// --- Oikeaa dataa vasten ----------------------------------------------

test('haku oikeasta taulukosta: (AJ)(AJ)T löytää Omaha5-kärjen', () => {
    const file = path.join(__dirname, '..', 'data', 'preflop-omaha5-6max-hybrid.json');
    if (!fs.existsSync(file)) return;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const table = { rows: data.hands };

    // Paljas T ei rajoita maata, joten kysely upottuu myös luokkaan
    // (AJT)(AJ) - siinäkin on kaksi samamaista AJ-paria ja kymppi
    const broad = searchTable(table, 'omaha5', parseQuery('(AJ)(AJ)T', 'omaha5'), 0, 10);
    assert.strictEqual(broad.total, 2);
    assert.strictEqual(broad.hands[0].rank, 1);
    assert.strictEqual(broad.hands[0].notation, '(AJ)(AJ)T');
    assert.strictEqual(broad.hands[1].notation, '(AJT)(AJ)');

    // Oma sulkuryhmä (T) = kymppi omassa maassaan -> yksikäsitteinen
    const exact = searchTable(table, 'omaha5', parseQuery('(AJ)(AJ)(T)', 'omaha5'), 0, 10);
    assert.strictEqual(exact.total, 1);
    assert.strictEqual(exact.hands[0].notation, '(AJ)(AJ)T');

    // Osittainen: kaikki neljän ässän luokat, sijajärjestyksessä
    const quads = searchTable(table, 'omaha5', parseQuery('AAAA', 'omaha5'), 0, 500);
    assert.ok(quads.total > 0 && quads.total < 500, `AAAA-luokkia ${quads.total}`);
    for (const h of quads.hands) {
        const aces = h.key.match(/A[shdc]/g) || [];
        assert.strictEqual(aces.length, 4, h.key);
    }
    for (let i = 1; i < quads.hands.length; i++) {
        assert.ok(quads.hands[i].rank > quads.hands[i - 1].rank, 'sijajärjestys rikki');
    }
});
