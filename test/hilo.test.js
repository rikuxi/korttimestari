// Omaha Hi/Lo -testit: low-arviointi riippumatonta verrokkia vasten,
// jaetun potin reunatapaukset käsin tarkistettavina river-tilanteina sekä
// simulaation ja eksaktin enumeroinnin yhtäpitävyys.
const test = require('node:test');
const assert = require('node:assert');

const E = require('../public/js/engine');

const card = s => E.cardToInt(s);
const cards = str => str.match(/.{2}/g).map(card);
const empty = { flop: [], turn: null, river: null };

/** hero + n satunnaista vastustajaa */
function randomTable(hero, players, cardsPerPlayer) {
    const list = [{ hand: hero, isFolded: false }];
    for (let i = 1; i < players; i++) {
        list.push({ hand: new Array(cardsPerPlayer).fill(''), isFolded: false });
    }
    return list;
}

// --- Riippumaton low-verrokki ------------------------------------------
//
// Käy kaikki 2+3-yhdistelmät läpi ja vertaa lajiteltuja arvolistoja.
// Ei jaa maskikoodausta eikä muuta logiikkaa moottorin kanssa -
// tahallaan naiivi.

function naiveLowRank(cardInt) {
    const r = cardInt >> 2;         // 0 = kakkonen .. 12 = ässä
    if (r === 12) return 1;         // ässä matalana
    if (r <= 6) return r + 2;       // 2..8
    return null;                    // 9..K ei kelpaa
}

function naiveBestLow(hole, board) {
    let best = null;
    for (let i = 0; i < hole.length; i++) {
        for (let j = i + 1; j < hole.length; j++) {
            for (let a = 0; a < 5; a++) {
                for (let b = a + 1; b < 5; b++) {
                    for (let c = b + 1; c < 5; c++) {
                        const vals = [hole[i], hole[j], board[a], board[b], board[c]]
                            .map(naiveLowRank);
                        if (vals.some(v => v === null)) continue;
                        if (new Set(vals).size !== 5) continue;
                        vals.sort((x, y) => y - x);  // suurin ensin
                        if (best === null) { best = vals; continue; }
                        for (let k = 0; k < 5; k++) {
                            if (vals[k] !== best[k]) {
                                if (vals[k] < best[k]) best = vals;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    return best;
}

/** Moottorin low-maski arvolistaksi suurimmasta pienimpään (A = 1) */
function maskToRanks(mask) {
    const out = [];
    for (let b = 7; b >= 0; b--) {
        if ((mask >> b) & 1) out.push(b === 0 ? 1 : b + 1);
    }
    return out;
}

test('evalOmahaLow vastaa riippumatonta verrokkia (4 ja 5 korttia)', () => {
    const deck = [];
    for (let c = 0; c < 52; c++) deck.push(c);
    for (const holeSize of [4, 5]) {
        const HP = E.HOLE_PAIRS[holeSize];
        for (let iter = 0; iter < 3000; iter++) {
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
            }
            const hole = deck.slice(0, holeSize);
            const board = deck.slice(holeSize, holeSize + 5);
            const mask = E.evalOmahaLow(hole, HP, board);
            const naive = naiveBestLow(hole, board);
            const where = () =>
                `hole ${hole.map(E.intToCard).join('')} board ${board.map(E.intToCard).join('')}`;
            if (naive === null) {
                assert.strictEqual(mask, E.NO_LOW, `verrokissa ei lowta: ${where()}`);
            } else {
                assert.deepStrictEqual(maskToRanks(mask), naive, where());
            }
        }
    }
});

test('low-reunatapaukset: pyörä, counterfeit, ei low-pöytää, maskijärjestys', () => {
    const HP4 = E.HOLE_PAIRS[4];
    // Pyörä A2345 on paras mahdollinen low (bitit 0..4 = 31)
    assert.strictEqual(
        E.evalOmahaLow(cards('As2hKdQc'), HP4, cards('3d4c5hKsQh')), 31);
    // Sama käsi on myös hi-suora (kategoria 4)
    assert.strictEqual(
        E.categoryOf(E.evalOmaha(cards('As2hKdQc'), HP4, cards('3d4c5hKsQh'))), 4);
    // Counterfeit: heron A2 on myös pöydässä - kädestä käytetään tasan
    // kaksi korttia eivätkä arvot saa toistua -> low ei synny
    assert.strictEqual(
        E.evalOmahaLow(cards('As2sKdKc'), HP4, cards('Ah2h3c4d9s')), E.NO_LOW);
    // Pöydässä vain kaksi eri low-arvoa -> low on mahdoton
    assert.strictEqual(
        E.evalOmahaLow(cards('As2h3d4c'), HP4, cards('5d5cThKsQh')), E.NO_LOW);
    // 86432 (maski 174) voittaa 86532:n (182): pienempi maski on parempi
    assert.strictEqual(
        E.evalOmahaLow(cards('2s3sKdKc'), HP4, cards('4h6c8dTsQh')), 174);
});

// --- Eksakti enumerointi: käsin tarkistettavat rivertilanteet -----------

test('hi/lo eksakti: kvarttaus riverillä (hero 1/4, vastustaja 3/4)', () => {
    // Molemmilla A2 -> low menee tasan; vastustajalla KKK-kolmoset -> hi.
    // Hero saa neljänneksen (puolet low-puoliskosta), vastustaja loput.
    const r = E.enumerateExact({
        playerHandsData: [
            { hand: ['As', '2h', 'Qd', 'Jc'], isFolded: false },
            { hand: ['Kh', 'Kd', 'Ac', '2c'], isFolded: false }
        ],
        communityCards: { flop: ['3h', '4c', '8d'], turn: 'Ks', river: '9d' },
        gameType: 'omahahilo', randomOpponents: false
    });
    assert.deepStrictEqual(r.equityPercentages, [25, 75]);
    assert.deepStrictEqual(r.hiEquityPercentages, [0, 50]);
    assert.deepStrictEqual(r.loEquityPercentages, [25, 25]);
    // Kumpikaan ei scoopannut - molemmat saivat osapotin
    assert.deepStrictEqual(r.winCounts, [0, 0]);
    assert.deepStrictEqual(r.tieCounts, [1, 1]);
    // Taajuudet: vastustaja vei hi:n yksin, low jaettiin
    assert.deepStrictEqual(r.hiWinPercentages, [0, 100]);
    assert.deepStrictEqual(r.hiTiePercentages, [0, 0]);
    assert.deepStrictEqual(r.loWinPercentages, [0, 0]);
    assert.deepStrictEqual(r.loTiePercentages, [100, 100]);
});

test('hi/lo eksakti: paras hi ja paras lo scooppaa koko potin', () => {
    // Hero: 8-high-suora (56 + 478) ja nut low (A2 + 347) -> 100 %
    const r = E.enumerateExact({
        playerHandsData: [
            { hand: ['Ah', '2d', '5c', '6s'], isFolded: false },
            { hand: ['Ts', 'Jd', 'Qc', 'Kd'], isFolded: false }
        ],
        communityCards: { flop: ['3s', '4d', '7c'], turn: '8h', river: 'Kh' },
        gameType: 'omahahilo', randomOpponents: false
    });
    assert.deepStrictEqual(r.equityPercentages, [100, 0]);
    assert.deepStrictEqual(r.winCounts, [1, 0]);
    assert.deepStrictEqual(r.tieCounts, [0, 0]);
    assert.strictEqual(r.hiLoStats.heroLowMade, 1);
    // Scoop tarkoittaa molempien puoliskojen voittamista yksin
    assert.deepStrictEqual(r.hiWinPercentages, [100, 0]);
    assert.deepStrictEqual(r.loWinPercentages, [100, 0]);
    assert.deepStrictEqual(r.hiTiePercentages, [0, 0]);
    assert.deepStrictEqual(r.loTiePercentages, [0, 0]);
});

test('hi/lo eksakti: ilman low-pöytää tulos on sama kuin Omahassa', () => {
    // Pöydällä 9TJQK kukaan ei voi tehdä low'ta -> hi ratkaisee kaiken
    const table = {
        playerHandsData: [
            { hand: ['As', 'Ah', '2c', '3d'], isFolded: false },
            { hand: ['Kd', 'Kc', 'Qs', '7h'], isFolded: false }
        ],
        communityCards: { flop: ['9s', 'Th', 'Jd'], turn: 'Qh', river: 'Kh' },
        randomOpponents: false
    };
    const hilo = E.enumerateExact({ ...table, gameType: 'omahahilo' });
    const hi = E.enumerateExact({ ...table, gameType: 'omaha' });
    assert.deepStrictEqual(hilo.equityPercentages, hi.equityPercentages);
    assert.deepStrictEqual(hilo.loEquityPercentages, [0, 0]);
    assert.deepStrictEqual(hilo.hiEquityPercentages, hilo.equityPercentages);
    assert.strictEqual(hilo.hiLoStats.noLowRounds, 1);
});

test('hi/lo eksakti: osoittajat ovat kokonaislukuja ja summautuvat tasan', () => {
    // Turn-tilanne: 40 jäljellä olevaa riveriä, osa low-pöytiä ja osa ei.
    // Kokonaislukusumma on eksakti bugiloukku: LCM_SHAREn (5040) pitää
    // jakaa jokainen osuus tasan.
    const r = E.enumerateExact({
        playerHandsData: [
            { hand: ['As', '2s', 'Th', 'Jh'], isFolded: false },
            { hand: ['Ad', '3d', 'Kc', 'Qc'], isFolded: false }
        ],
        communityCards: { flop: ['4h', '5c', '9d'], turn: '8s', river: null },
        gameType: 'omahahilo', randomOpponents: false
    });
    assert.strictEqual(r.boards, 40);
    for (const n of r.equityNumerators) {
        assert.strictEqual(n, Math.round(n), 'osoittajan pitää olla kokonaisluku');
    }
    const sum = r.equityNumerators.reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, r.equityDenominator, 'equityt eivät summaudu täyteen pottiin');
});

// --- Simulaatio ---------------------------------------------------------

test('hi/lo simulaatio: hi + lo = equity ja equityt summautuvat 100 %:iin', () => {
    const r = E.runSimulation({
        playerHandsData: [
            { hand: ['As', '2s', '3h', '4h'], isFolded: false },
            { hand: ['Ad', '2d', 'Kc', 'Kd'], isFolded: false },
            { hand: ['Ts', 'Jc', 'Qd', '9h'], isFolded: false }
        ],
        communityCards: empty, gameType: 'omahahilo',
        randomOpponents: false, simulationCount: 20000
    });
    let total = 0;
    for (let i = 0; i < 3; i++) {
        const sum = r.hiEquityPercentages[i] + r.loEquityPercentages[i];
        assert.ok(Math.abs(sum - r.equityPercentages[i]) < 1e-9,
            'pelaajan ' + i + ' hi+lo ei täsmää equityyn');
        total += r.equityPercentages[i];
    }
    assert.ok(Math.abs(total - 100) < 1e-9, 'equityt yhteensä ' + total);
});

test('hi/lo simulaatio osuu eksaktin luottamusvälille', () => {
    const table = {
        playerHandsData: [
            { hand: ['As', '2h', '3d', '4c'], isFolded: false },
            { hand: ['Kd', 'Kc', 'Js', 'Th'], isFolded: false }
        ],
        communityCards: { flop: ['5h', '6c', 'Qd'], turn: null, river: null },
        randomOpponents: false
    };
    const exact = E.enumerateExact({ ...table, gameType: 'omahahilo' });
    let within = 0;
    const runs = 20;
    for (let i = 0; i < runs; i++) {
        const r = E.runSimulation({ ...table, gameType: 'omahahilo', simulationCount: 20000 });
        if (Math.abs(r.equityPercentages[0] - exact.equityPercentages[0])
            <= 2 * r.standardErrors[0]) within++;
    }
    assert.ok(within >= 15, within + '/' + runs + ' osui kahden keskivirheen sisään');
});

test('hi/lo: exactPlan tuntee pelimuodon ja satunnaisvastustajat toimivat', () => {
    const plan = E.exactPlan({
        playerHandsData: [
            { hand: ['As', '2s', '3h', '4h'], isFolded: false },
            { hand: ['Kd', 'Kc', 'Qs', 'Jh'], isFolded: false }
        ],
        communityCards: { flop: ['5d', '6h', 'Td'], turn: null, river: null },
        gameType: 'omahahilo', randomOpponents: false
    });
    assert.strictEqual(plan.feasible, true);
    assert.strictEqual(plan.boards, E.binomial(41, 2));

    // Satunnaisvastustajat: hero-tilastot mukana ja equity järkevä
    const r = E.runSimulation({
        playerHandsData: randomTable(['As', '2s', '3h', '4h'], 4, 4),
        communityCards: empty, gameType: 'omahahilo',
        randomOpponents: true, simulationCount: 5000
    });
    assert.ok(r.equityPercentages[0] > 25 && r.equityPercentages[0] < 60,
        'A234 ds equity 4-max: ' + r.equityPercentages[0].toFixed(1));
    assert.ok(r.hiLoStats.heroLowMade > 0);
});

// --- Voitto- ja tasapelitaajuudet ---------------------------------------

test('hi/lo-taajuudet vastaavat ulkoista laskuria (cardplayer.com)', () => {
    // Vertailutilanne cardplayer.com:n Omaha Hi/Lo -laskurista.
    // Kaikki 1 086 008 pöytää enumeroidaan, joten luvut ovat tarkkoja
    // eivätkä otoksesta riippuvia. Tämä on ainoa testi joka sitoo
    // taajuudet ulkopuoliseen lähteeseen - jos jako- tai vertailulogiikka
    // muuttuu, se näkyy tässä heti.
    const r = E.enumerateExact({
        playerHandsData: [
            { hand: ['Jc', '2s', 'Qh', 'Kc'], isFolded: false },
            { hand: ['8c', 'As', '5d', 'Js'], isFolded: false }
        ],
        communityCards: empty, gameType: 'omahahilo', randomOpponents: false
    });
    const r2 = x => Number(x.toFixed(2));
    assert.strictEqual(r.boards, E.binomial(44, 5));
    assert.deepStrictEqual(r.winPercentages.map(r2), [25.49, 54.22]);       // Scoop
    assert.deepStrictEqual(r.hiWinPercentages.map(r2), [45.50, 54.22]);     // Hi
    assert.deepStrictEqual(r.hiTiePercentages.map(r2), [0.29, 0.29]);       // Hi Tie
    assert.deepStrictEqual(r.loWinPercentages.map(r2), [0, 54.01]);         // Lo
    assert.deepStrictEqual(r.loTiePercentages.map(r2), [0, 0]);             // Lo Tie
    assert.deepStrictEqual(r.equityPercentages.map(r2), [35.64, 64.36]);    // Ev
});

test('taajuudet ovat johdonmukaisia osuuksien ja scoopin kanssa', () => {
    // Kolme pelaajaa, jotta kolmisuuntaiset jaot tulevat mukaan
    const r = E.runSimulation({
        playerHandsData: [
            { hand: ['As', '2s', '3h', '4h'], isFolded: false },
            { hand: ['Ad', '2d', 'Kc', 'Kd'], isFolded: false },
            { hand: ['Ts', 'Jc', 'Qd', '9h'], isFolded: false }
        ],
        communityCards: empty, gameType: 'omahahilo',
        randomOpponents: false, simulationCount: 30000
    });
    const sum = a => a.reduce((x, y) => x + y, 0);

    // Jokaisella kierroksella hi-puolisko joko voitetaan yksin (tasan yksi
    // pelaaja saa merkinnän) tai jaetaan (vähintään kaksi saa). Siksi
    // yksin voitettujen osuus on korkeintaan 100 % ja voittojen sekä
    // jakojen summa vähintään 100 %.
    const hiWin = sum(r.hiWinPercentages), hiTie = sum(r.hiTiePercentages);
    assert.ok(hiWin <= 100 + 1e-9, `hi-voittoja ${hiWin} %`);
    assert.ok(hiWin + hiTie >= 100 - 1e-9, `hi-voitot + jaot ${hiWin + hiTie} %`);

    // Low-puoliskolla sama, mutta vain niillä kierroksilla joilla low syntyi
    const lowRounds = 100 - (100 * r.hiLoStats.noLowRounds) / r.simulationCount;
    const loWin = sum(r.loWinPercentages), loTie = sum(r.loTiePercentages);
    assert.ok(loWin <= lowRounds + 1e-9, 'low-voittoja enemmän kuin low-kierroksia');
    assert.ok(loWin + loTie >= lowRounds - 1e-9, 'low-kierroksia ilman low-voittajaa');
    assert.ok(lowRounds > 0 && lowRounds < 100, 'testitilanteessa pitää esiintyä molempia');

    for (let i = 0; i < 3; i++) {
        // Scoop vaatii hi-puoliskon voittamisen yksin
        assert.ok(r.winPercentages[i] <= r.hiWinPercentages[i] + 1e-9,
            'scoop ei voi olla yleisempi kuin hi:n voittaminen yksin');
        // Osuus ei voi ylittää taajuutta: kierros tuottaa hi-osuutta vain
        // jos pelaaja voitti tai jakoi hi:n, ja korkeintaan koko potin
        assert.ok(r.hiEquityPercentages[i] <=
            r.hiWinPercentages[i] + r.hiTiePercentages[i] + 1e-9);
        assert.ok(r.loEquityPercentages[i] <=
            r.loWinPercentages[i] + r.loTiePercentages[i] + 1e-9);
        // Pelaaja jolla ei ole low-kortteja ei voi voittaa low-puoliskoa
        assert.ok(r.loWinPercentages[i] >= 0 && r.loTiePercentages[i] >= 0);
    }
    // Kolmas käsi (TJQ9) ei voi tehdä low'ta lainkaan
    assert.strictEqual(r.loWinPercentages[2], 0);
    assert.strictEqual(r.loTiePercentages[2], 0);
    assert.strictEqual(r.loEquityPercentages[2], 0);
});

test('yhden aktiivisen pelaajan tilanteessa hi/lo-erittelyä ei keksitä', () => {
    // Kaikki muut foldanneet: equity on 100 %, mutta yhtään pöytää ei
    // jaeta, joten puoliskojen osuuksista ei ole tietoa. Aiemmin tässä
    // väitettiin "hi 100 % / ei low'ta 100 %".
    const table = {
        playerHandsData: [
            { hand: ['As', '2s', '3h', '4h'], isFolded: false },
            { hand: ['Kd', 'Kc', 'Qs', 'Jh'], isFolded: true }
        ],
        communityCards: empty, gameType: 'omahahilo', randomOpponents: false
    };
    const mc = E.runSimulation({ ...table, simulationCount: 1000 });
    assert.strictEqual(mc.equityPercentages[0], 100);
    assert.strictEqual(mc.hiEquityPercentages, undefined);
    assert.strictEqual(mc.hiWinPercentages, undefined);
    assert.strictEqual(mc.hiLoStats, undefined);

    const ex = E.enumerateExact(table);
    assert.strictEqual(ex.equityPercentages[0], 100);
    assert.strictEqual(ex.hiEquityPercentages, undefined);
    assert.strictEqual(ex.hiLoStats, undefined);
});
