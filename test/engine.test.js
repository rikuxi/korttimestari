// Laskentamoottorin (public/js/engine.js) testit.
// Moottori on sama sekä selaimessa että palvelimella, joten nämä testit
// kattavat molemmat polut.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

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

// --- Käsienarviointi ---------------------------------------------------

test('eval5: käsiluokkien voimajärjestys on oikea', () => {
    const order = [
        cards('2h5s9dJcAh'),  // hai
        cards('2h2s9dJcAh'),  // pari
        cards('2h2s9d9cAh'),  // kaksi paria
        cards('2h2s2d9cAh'),  // kolmoset
        cards('2h3s4d5c6h'),  // suora
        cards('2h5h9hJhAh'),  // väri
        cards('2h2s2d9c9h'),  // täyskäsi
        cards('2h2s2d2c9h'),  // neloset
        cards('2s3s4s5s6s')   // värisuora
    ].map(c => E.eval5(...c));

    for (let i = 1; i < order.length; i++) {
        assert.ok(order[i] > order[i - 1], `luokka ${i} pitää voittaa luokka ${i - 1}`);
    }
});

test('eval5: pyörä on pienin suora, kuningasvärisuora ei ole oma luokkansa', () => {
    const wheel = E.eval5(...cards('Ah2s3d4c5h'));
    const sixHigh = E.eval5(...cards('2h3s4d5c6h'));
    assert.strictEqual(E.categoryOf(wheel), 4);
    assert.ok(sixHigh > wheel);

    const royal = E.eval5(...cards('AsKsQsJsTs'));
    const kingSF = E.eval5(...cards('9sKsQsJsTs'));
    assert.strictEqual(E.categoryOf(royal), 8);
    assert.strictEqual(E.categoryOf(kingSF), 8);
    assert.ok(royal > kingSF);
});

test('eval7 antaa täsmälleen saman arvon kuin paras 21:stä eval5-kutsusta', () => {
    const deck = [];
    for (let c = 0; c < 52; c++) deck.push(c);
    const N = 40000;
    for (let t = 0; t < N; t++) {
        for (let i = 0; i < 7; i++) {
            const j = i + Math.floor(Math.random() * (52 - i));
            const x = deck[i]; deck[i] = deck[j]; deck[j] = x;
        }
        const h = deck.slice(0, 7);
        let best = 0;
        for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 7; c++)
            for (let d = c + 1; d < 7; d++) for (let e = d + 1; e < 7; e++) {
                const v = E.eval5(h[a], h[b], h[c], h[d], h[e]);
                if (v > best) best = v;
            }
        assert.strictEqual(E.eval7(...h), best,
            `poikkeama kädellä ${h.map(E.intToCard).join(' ')}`);
    }
});

test('eval7: seitsemän kortin erikoistapaukset', () => {
    // Kaksi kolmosta -> täyskäsi, alempi kolmonen toimii parina
    const twoTrips = E.eval7(...cards('9h9s9dKcKsKh2c'));
    assert.strictEqual(E.categoryOf(twoTrips), 6);
    assert.strictEqual(twoTrips, E.eval5(...cards('KcKsKh9h9s')));

    // Kolme paria -> kaksi paria, kolmas pari voi olla kicker
    const threePairs = E.eval7(...cards('2h2s5d5cKhKs7d'));
    assert.strictEqual(E.categoryOf(threePairs), 2);
    assert.strictEqual(threePairs, E.eval5(...cards('KhKs5d5c7d')));

    // Neloset + pari -> kicker on korkein jäljellä oleva
    const quadsPair = E.eval7(...cards('7h7s7d7c3h3sAd'));
    assert.strictEqual(quadsPair, E.eval5(...cards('7h7s7d7cAd')));

    // Väri ja suora samassa kädessä -> väri voittaa
    const both = E.eval7(...cards('2h3h4h5h9h8s7c'));
    assert.strictEqual(E.categoryOf(both), 5);
});

test('Omaha käyttää tasan kaksi korttia kädestä', () => {
    // Pöydässä neljä pataa, kädessä yksi pata -> väri ei ole mahdollinen
    const hole = cards('AsKhQdJc');
    const board = cards('2s5s9sTs3h');
    const v = E.evalOmaha(hole, E.HOLE_PAIRS[4], board);
    assert.notStrictEqual(E.categoryOf(v), 5);
    assert.notStrictEqual(E.categoryOf(v), 8);
});

// --- Kuolleet kortit ---------------------------------------------------

test('foldanneen pelaajan kortit ovat kuolleita', () => {
    // Hero AsAh, foldannut pelaaja pitää muita ässiä -> heron ässänelosia
    // ei voi enää syntyä, vain pöydän omat neloset ovat mahdollisia
    const result = E.runSimulation({
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['Ks', 'Kh'], isFolded: false },
            { hand: ['Ad', 'Ac'], isFolded: true }
        ],
        communityCards: empty,
        simulationCount: 200000,
        gameType: 'holdem',
        randomOpponents: false
    });
    const quads = result.heroHandStats['four of a kind'] || 0;
    assert.ok(quads / 200000 < 0.001, `nelosten osuus ${(100 * quads / 200000).toFixed(3)} %`);

    // Foldannut ei myöskään voita mitään
    assert.strictEqual(result.winPercentages[2], 0);
    assert.strictEqual(result.equityPercentages[2], 0);
});

test('tuplakortti syötteessä heittää virheen', () => {
    // Palvelinreitti validoi duplikaatit, mutta ensisijainen polku on
    // selaimen worker - engine on ainoa paikka joka suojaa molemmat.
    const base = {
        communityCards: empty, simulationCount: 100,
        gameType: 'holdem', randomOpponents: false
    };

    // Sama kortti kahdella pelaajalla
    assert.throws(() => E.runSimulation({
        ...base,
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['As', 'Kd'], isFolded: false }
        ]
    }), /Duplicate/);

    // Sama kortti kädessä ja pöydässä
    assert.throws(() => E.runSimulation({
        ...base,
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['Kd', 'Kc'], isFolded: false }
        ],
        communityCards: { flop: ['As', '7h', '2d'], turn: null, river: null }
    }), /Duplicate/);

    // enumerateExact kulkee saman preparen kautta
    assert.throws(() => E.enumerateExact({
        ...base,
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['Ah', 'Kd'], isFolded: false }
        ]
    }), /Duplicate/);

    // exactPlan raportoi saman siististi kaatumatta
    const plan = E.exactPlan({
        ...base,
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['As', 'Kd'], isFolded: false }
        ]
    });
    assert.strictEqual(plan.feasible, false);
    assert.strictEqual(plan.reason, 'invalid');

    // Satunnaisvastustajan syötetyt kortit palaavat pakkaan (ne jaetaan
    // uudelleen), joten päällekkäisyys heron kanssa EI ole duplikaatti
    assert.doesNotThrow(() => E.runSimulation({
        ...base,
        randomOpponents: true,
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['As', 'Kd'], isFolded: false }
        ]
    }));
});

test('satunnaisvastustajien kortit palaavat pakkaan, heron eivät', () => {
    // Jos vastustajien syötetyt kortit poistettaisiin pakasta, heron
    // equity muuttuisi. Tyhjät ja täytetyt vastustajakädet antavat saman.
    const base = {
        communityCards: empty, simulationCount: 60000,
        gameType: 'holdem', randomOpponents: true
    };
    const a = E.runSimulation({
        ...base,
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['', ''], isFolded: false }
        ]
    }).equityPercentages[0];
    const b = E.runSimulation({
        ...base,
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['Kd', 'Kc'], isFolded: false }
        ]
    }).equityPercentages[0];
    assert.ok(Math.abs(a - b) < 1.0, `equityt ${a.toFixed(2)} ja ${b.toFixed(2)} eroavat liikaa`);
});

// --- Potin jako --------------------------------------------------------

test('jaettu potti jaetaan voittajien määrällä', () => {
    // Pöydässä valmis värisuora: kaikki kolme jakavat potin joka jaossa
    const result = E.runSimulation({
        playerHandsData: [
            { hand: ['2h', '3h'], isFolded: false },
            { hand: ['4d', '5d'], isFolded: false },
            { hand: ['7c', '8c'], isFolded: false }
        ],
        communityCards: { flop: ['As', 'Ks', 'Qs'], turn: 'Js', river: 'Ts' },
        simulationCount: 100,
        gameType: 'holdem',
        randomOpponents: false
    });

    for (let i = 0; i < 3; i++) {
        assert.strictEqual(result.winPercentages[i], 0);
        assert.strictEqual(result.tiePercentages[i], 100);
        assert.ok(Math.abs(result.equityPercentages[i] - 100 / 3) < 1e-9);
    }
    const sum = result.equityPercentages.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 1e-9, `equityjen summa ${sum}`);
    // Vanha kaava voitto + tasapeli/2 olisi antanut 50 % kullekin
    assert.strictEqual(result.winPercentages[0] + result.tiePercentages[0] / 2, 50);
});

test('equity on aina välillä [voitto, voitto + tasapeli]', () => {
    const result = E.runSimulation({
        playerHandsData: randomTable(['Ad', 'Ac', 'Kd', 'Kc'], 6, 4),
        communityCards: empty,
        simulationCount: 20000,
        gameType: 'omaha',
        randomOpponents: true
    });
    const w = result.winPercentages[0], t = result.tiePercentages[0], e = result.equityPercentages[0];
    assert.ok(e >= w - 1e-9 && e <= w + t + 1e-9);
});

test('yhden aktiivisen pelaajan tapaus: potti tulee ilman laskentaa', () => {
    const result = E.runSimulation({
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['', ''], isFolded: true }
        ],
        communityCards: empty,
        simulationCount: 500,
        gameType: 'holdem',
        randomOpponents: true
    });
    assert.strictEqual(result.winPercentages[0], 100);
    assert.strictEqual(result.equityPercentages[0], 100);
});

// --- Tarkkuus eksaktia taulukkoa vastaan -------------------------------

test('equity osuu eksaktiin heads-up-taulukkoon', () => {
    const exactPath = path.join(__dirname, '..', 'data', 'preflop-omaha-2max-exact.json');
    if (!fs.existsSync(exactPath)) return; // taulukkoa ei ole generoitu
    const { canonicalizeOmaha } = require('../canonical');
    const exact = JSON.parse(fs.readFileSync(exactPath, 'utf8'));
    const ref = new Map(exact.hands.map(h => [h.key, h.equity]));

    const N = 100000;
    for (const hand of [['Ad', 'Ac', 'Kd', 'Kc'], ['Jd', 'Tc', '9d', '8c']]) {
        const eq = E.runSimulation({
            playerHandsData: randomTable(hand, 2, 4),
            communityCards: empty,
            simulationCount: N,
            gameType: 'omaha',
            randomOpponents: true
        }).equityPercentages[0];
        const target = ref.get(canonicalizeOmaha(hand));
        const se = 100 * Math.sqrt(0.25 / N);
        assert.ok(Math.abs(eq - target) < 5 * se,
            `${hand.join('')}: ${eq.toFixed(3)} vs eksakti ${target.toFixed(3)} (5σ = ${(5 * se).toFixed(3)})`);
    }
});

test("Hold'em: AA voittaa 72o noin 88 %", () => {
    const result = E.runSimulation({
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['7d', '2c'], isFolded: false }
        ],
        communityCards: empty,
        simulationCount: 200000,
        gameType: 'holdem',
        randomOpponents: false
    });
    assert.ok(result.equityPercentages[0] > 87 && result.equityPercentages[0] < 89,
        `saatiin ${result.equityPercentages[0].toFixed(2)} %`);
    const total = Object.values(result.heroHandStats).reduce((a, b) => a + b, 0);
    assert.strictEqual(total, 200000);
});

test('osittainen pöytä: turn tiedossa, vain river arvotaan', () => {
    // AA vs KK, pöydässä KQJ + T -> KK on jo tehnyt suoran, AA tarvitsee
    // riveriin ässän tai pöydän parittumisen
    const result = E.runSimulation({
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['Kd', 'Kc'], isFolded: false }
        ],
        communityCards: { flop: ['Ks', 'Qs', 'Jd'], turn: 'Th', river: null },
        simulationCount: 20000,
        gameType: 'holdem',
        randomOpponents: false
    });
    // Molemmilla on suora (AKQJT vs KQJT + K); AA:lla ässäkorkea suora,
    // KK:lla kolmoset -> AA voittaa aina paitsi kun river antaa KK:lle täyskäden
    assert.ok(result.equityPercentages[0] > 70 && result.equityPercentages[0] < 100,
        `heron equity ${result.equityPercentages[0].toFixed(2)} %`);
    assert.ok(Math.abs(result.equityPercentages[0] + result.equityPercentages[1] - 100) < 1e-9,
        'equityjen summa ei ole 100');
});

// --- Eksakti enumerointi -----------------------------------------------

test('enumerateExact: AsAh vs KdKc on tasan 81,2555 %', () => {
    const r = E.enumerateExact({
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['Kd', 'Kc'], isFolded: false }
        ],
        communityCards: empty,
        gameType: 'holdem',
        randomOpponents: false
    });
    assert.strictEqual(r.exact, true);
    assert.strictEqual(r.boards, E.binomial(48, 5));
    assert.ok(Math.abs(r.equityPercentages[0] - 81.2555) < 0.0001,
        `saatiin ${r.equityPercentages[0]}`);
    // Equityt summautuvat tasan sataan - vahva invariantti eksaktille tulokselle
    const sum = r.equityPercentages.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 1e-9, `summa ${sum}`);
    assert.strictEqual(r.standardErrors[0], 0);
});

test('enumerateExact ja Monte Carlo antavat saman vastauksen', () => {
    const data = {
        playerHandsData: [
            { hand: ['Ad', 'Ac', 'Kd', 'Kc'], isFolded: false },
            { hand: ['Js', 'Ts', '9h', '8h'], isFolded: false },
            { hand: ['2d', '2c', '7h', '8s'], isFolded: false }
        ],
        communityCards: { flop: ['7d', '8d', '9s'], turn: null, river: null },
        gameType: 'omaha',
        randomOpponents: false,
        simulationCount: 200000
    };
    const exactRes = E.enumerateExact(data);
    const mc = E.runSimulation(data);
    for (let i = 0; i < 3; i++) {
        const diff = Math.abs(mc.equityPercentages[i] - exactRes.equityPercentages[i]);
        const se = mc.standardErrors[i];
        assert.ok(diff < 5 * se + 1e-9,
            `pelaaja ${i}: MC ${mc.equityPercentages[i].toFixed(3)} vs eksakti ` +
            `${exactRes.equityPercentages[i].toFixed(3)}, keskivirhe ${se.toFixed(4)}`);
    }
});

test('enumerateExact palauttaa null kun vastustajat ovat tuntemattomia', () => {
    const r = E.enumerateExact({
        playerHandsData: randomTable(['As', 'Ah'], 3, 2),
        communityCards: empty,
        gameType: 'holdem',
        randomOpponents: true
    });
    assert.strictEqual(r, null);
    const plan = E.exactPlan({
        playerHandsData: randomTable(['As', 'Ah'], 3, 2),
        communityCards: empty,
        gameType: 'holdem',
        randomOpponents: true
    });
    assert.strictEqual(plan.feasible, false);
    assert.strictEqual(plan.reason, 'random-opponents');
});

test('exactPlan hinnoittelee Omaha5:n kalliimmaksi kuin Omahan', () => {
    // Omaha5 tekee 100 eval5-kutsua per pelaaja per pöytä, Omaha 60 -
    // yhteinen vakio aliarvioi budjetin ja 10 s raja venyy ~17 s:iin
    const plan4 = E.exactPlan({
        playerHandsData: [
            { hand: ['Ad', 'Ac', 'Kd', 'Kc'], isFolded: false },
            { hand: ['Js', 'Ts', '9h', '8h'], isFolded: false }
        ],
        communityCards: empty, gameType: 'omaha', randomOpponents: false
    });
    const plan5 = E.exactPlan({
        playerHandsData: [
            { hand: ['Ad', 'Ac', 'Kd', 'Kc', 'Qh'], isFolded: false },
            { hand: ['Js', 'Ts', '9h', '8h', '7c'], isFolded: false }
        ],
        communityCards: empty, gameType: 'omaha5', randomOpponents: false
    });
    const per4 = plan4.estimatedSeconds / plan4.boards;
    const per5 = plan5.estimatedSeconds / plan5.boards;
    // suhde ~100/60 ≈ 1.7
    assert.ok(per5 / per4 > 1.4 && per5 / per4 < 2.2,
        `pöytäkohtainen hintasuhde ${(per5 / per4).toFixed(2)}, odotettu ~1.7`);
});

test('exactPlan laskee pöytien määrän oikein', () => {
    const holdemHU = E.exactPlan({
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['Kd', 'Kc'], isFolded: false }
        ],
        communityCards: empty, gameType: 'holdem', randomOpponents: false
    });
    assert.strictEqual(holdemHU.boards, E.binomial(48, 5));
    assert.strictEqual(holdemHU.feasible, true);

    const withFlop = E.exactPlan({
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['Kd', 'Kc'], isFolded: false }
        ],
        communityCards: { flop: ['2s', '7h', '9d'], turn: null, river: null },
        gameType: 'holdem', randomOpponents: false
    });
    assert.strictEqual(withFlop.boards, E.binomial(45, 2));
});

// --- Keskivirhe --------------------------------------------------------

test('keskivirhe kutistuu kuten 1/sqrt(n)', () => {
    const base = {
        playerHandsData: randomTable(['As', 'Ah'], 2, 2),
        communityCards: empty, gameType: 'holdem', randomOpponents: true
    };
    const small = E.runSimulation({ ...base, simulationCount: 10000 }).standardErrors[0];
    const large = E.runSimulation({ ...base, simulationCount: 250000 }).standardErrors[0];
    const ratio = small / large;
    // 25-kertainen otos -> keskivirhe viidesosaan
    assert.ok(ratio > 4 && ratio < 6, `suhde ${ratio.toFixed(2)}, odotettu ~5`);
});

test('keskivirhe kattaa todellisen virheen eksaktiin nähden', () => {
    // 20 riippumatonta ajoa: noin 95 % pitäisi osua kahden keskivirheen sisään
    const exactValue = E.enumerateExact({
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['Kd', 'Kc'], isFolded: false }
        ],
        communityCards: empty, gameType: 'holdem', randomOpponents: false
    }).equityPercentages[0];

    let within = 0;
    const runs = 20;
    for (let i = 0; i < runs; i++) {
        const r = E.runSimulation({
            playerHandsData: [
                { hand: ['As', 'Ah'], isFolded: false },
                { hand: ['Kd', 'Kc'], isFolded: false }
            ],
            communityCards: empty, gameType: 'holdem',
            randomOpponents: false, simulationCount: 20000
        });
        if (Math.abs(r.equityPercentages[0] - exactValue) <= 2 * r.standardErrors[0]) within++;
    }
    assert.ok(within >= 15, `${within}/${runs} osui kahden keskivirheen sisään`);
});
