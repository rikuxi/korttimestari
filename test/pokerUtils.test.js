const test = require('node:test');
const assert = require('node:assert');
const {
    isValidCard,
    createDeck,
    getCombinations,
    evaluateOmahaHand,
    prepareSimulationBase,
    runSingleSimulation,
    runSingleOmahaSimulation,
    runSingleSimulationRandomOpponents
} = require('../pokerUtils');

test('isValidCard hyväksyy validit kortit ja hylkää virheelliset', () => {
    assert.ok(isValidCard('Ah'));
    assert.ok(isValidCard('2d'));
    assert.ok(isValidCard('Ts'));
    assert.ok(!isValidCard('1h'));
    assert.ok(!isValidCard('Ax'));
    assert.ok(!isValidCard('AH')); // maa pienellä kirjaimella
    assert.ok(!isValidCard(''));
    assert.ok(!isValidCard(null));
    assert.ok(!isValidCard(12));
    assert.ok(!isValidCard('Ahh'));
});

test('createDeck tuottaa 52 uniikkia korttia', () => {
    const deck = createDeck();
    assert.strictEqual(deck.length, 52);
    assert.strictEqual(new Set(deck).size, 52);
});

test('getCombinations laskee kombinaatiot oikein', () => {
    assert.strictEqual(getCombinations([1, 2, 3, 4, 5], 2).length, 10);
    assert.strictEqual(getCombinations([1, 2, 3, 4], 4).length, 1);
    assert.strictEqual(getCombinations([1, 2], 3).length, 0);
});

test('prepareSimulationBase poistaa tunnetut kortit pakasta', () => {
    const hands = [['As', 'Ks'], ['2d', '7c']];
    const community = { flop: ['Qh', 'Jh', 'Th'], turn: null, river: null };
    const { baseBoard, baseDeck } = prepareSimulationBase(community, hands);

    assert.deepStrictEqual(baseBoard, ['Qh', 'Jh', 'Th']);
    assert.strictEqual(baseDeck.length, 52 - 4 - 3);
    for (const card of ['As', 'Ks', '2d', '7c', 'Qh', 'Jh', 'Th']) {
        assert.ok(!baseDeck.includes(card), `${card} ei saa olla pakassa`);
    }
});

test('pakotettu kuningasvärisuora raportoituu värisuorana ja voittaa', () => {
    const hands = [['As', 'Ks'], ['2h', '7c']];
    const community = { flop: ['Qs', 'Js', 'Ts'], turn: '2d', river: '3c' };
    const { baseBoard, baseDeck } = prepareSimulationBase(community, hands);
    const result = runSingleSimulation(hands, baseBoard, baseDeck);

    assert.deepStrictEqual(result.winners, [0]);
    assert.strictEqual(result.handNames[0], 'straight flush');
});

test('AA voittaa 72o noin 88 % (Monte Carlo)', () => {
    const hands = [['As', 'Ah'], ['7d', '2c']];
    const { baseBoard, baseDeck } = prepareSimulationBase({}, hands);

    let wins = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
        const r = runSingleSimulation(hands, baseBoard, baseDeck);
        if (r.winners.length === 1 && r.winners[0] === 0) wins++;
    }
    const pct = (wins / N) * 100;
    assert.ok(pct > 84 && pct < 92, `odotettu ~88 %, saatiin ${pct.toFixed(1)} %`);
});

test('Omaha käyttää tasan kaksi korttia kädestä (väri ei synny yhdellä padalla)', () => {
    // Pöydässä neljä pataa, kädessä vain yksi pata -> väri ei ole mahdollinen
    const result = evaluateOmahaHand(['As', 'Kh', 'Qd', 'Jc'], ['2s', '5s', '9s', 'Ts', '3h']);
    assert.notStrictEqual(result.handName, 'flush');
});

test('Omaha-simulaatio palauttaa voittajat ja käsinimet', () => {
    const hands = [['As', 'Ah', 'Ks', 'Kh'], ['2d', '7c', '8h', '9d']];
    const { baseBoard, baseDeck } = prepareSimulationBase({}, hands);
    const result = runSingleOmahaSimulation(hands, baseBoard, baseDeck);

    assert.ok(Array.isArray(result.winners) && result.winners.length >= 1);
    assert.strictEqual(result.handNames.length, 2);
});

test('satunnaisten vastustajien simulaatio ei käytä heron kortteja', () => {
    const heroHand = ['As', 'Ks'];
    const { baseBoard, baseDeck } = prepareSimulationBase({}, [heroHand]);

    for (let i = 0; i < 200; i++) {
        const r = runSingleSimulationRandomOpponents(heroHand, 3, baseBoard, baseDeck, 'holdem');
        assert.strictEqual(r.handRankings.length, 4);
        assert.ok(r.winners.length >= 1);
    }
});

test('satunnaiset vastustajat: pakka ei riitä omaha5:lle kymmenellä pelaajalla', () => {
    const heroHand = ['As', 'Ks', 'Qs', 'Js', 'Ts'];
    const { baseBoard, baseDeck } = prepareSimulationBase({}, [heroHand]);
    assert.throws(() => {
        runSingleSimulationRandomOpponents(heroHand, 9, baseBoard, baseDeck, 'omaha5');
    }, /Not enough cards/);
});
