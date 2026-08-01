// Omaha Hi/Lo -hybridityöläisen riippumaton varmennus.
//
// Ajaa työläisen runConfigin oikeilla pöydillä ja vertaa sen kertymiä
// raakalaskentaan, joka käyttää TOISTA arviointitoteutusta
// (public/js/engine.js) ja toteuttaa jakosäännöt suoraan pelisäännöistä -
// ei työläisen pakattuja hi-arvoja eikä low-hyvyysasteita. Vertailu kattaa
// konfiguraation KAIKKI heron kädet (C(39,4) = 82 251 kolmen pelaajan
// tapauksessa) ja kaikki kerättävät sarjat, ja lukujen on täsmättävä
// bitilleen.
//
// Tämä on eräajon ainoa tarkistus joka näkee yksittäisen kierroksen
// jakosäännöt. Muut tarkistukset (summainvariantit, players=2 eksaktia
// taulukkoa vasten) katsovat vasta miljardien kierrosten summia.
//
// Käyttö:
//   node scripts/verifyHybridHilo.js [pelaajia] [pöytiä] [konfiguraatioita]
//   (oletus 3 pelaajaa, 4 pöytää, 1 konfiguraatio/pöytä)

const E = require('../public/js/engine');
const { prepareBoard, REST } = require('./exactPrototype');
const { buildClassTable } = require('./exactOmaha');

const PLAYERS = parseInt(process.argv[2], 10) || 3;
const N_BOARDS = parseInt(process.argv[3], 10) || 4;
const N_CONFIGS = parseInt(process.argv[4], 10) || 1;

const HP4 = E.HOLE_PAIRS[4];
const NO_LOW = E.NO_LOW;
const RANKS = '23456789TJQKA', SUITS = 'shdc';
const show = c => RANKS[c >> 2] + SUITS[c & 3];

console.log('Rakennetaan luokkataulukko...');
const { classOf } = buildClassTable();

// Työläinen lukee asetuksensa globaalista kun sitä ei ajeta worker-säikeenä
globalThis.__hybridHiloWorkerConfig = {
    classOf, players: PLAYERS, configs: 1, replicates: 1
};
const W = require('./hybridOmahaHiloWorker');

const N_CLASSES = W.N_CLASSES, UNIT = W.UNIT;
const REP_SLOTS = W.REP_SLOTS, FRQ_SLOTS = W.FRQ_SLOTS;
const OPPONENTS = W.OPPONENTS, OPP_CARDS = W.OPP_CARDS, HERO_POOL = W.HERO_POOL;

// Globaali colex-indeksointi luokkataulukkoon (samat kertoimet kuin työläisessä)
const G = [1, 2, 3, 4].map(k => {
    const t = new Float64Array(53);
    for (let n = 0; n <= 52; n++) {
        let v = 1;
        if (n < k) { t[n] = 0; continue; }
        for (let i = 0; i < k; i++) v = v * (n - i) / (i + 1);
        t[n] = Math.round(v);
    }
    return t;
});
const classIndex = (a, b, c, d) => classOf[G[3][d] + G[2][c] + G[1][b] + a];

// --- Raakalaskenta: samat kertymät suoraan pelisäännöistä ----------------

function reference(board, oppHands, heroCards) {
    const rep = new Float64Array(N_CLASSES * REP_SLOTS);
    const frq = new Float64Array(N_CLASSES * FRQ_SLOTS);

    // Vastustajien paras korkea käsi ja paras low
    let maxHi = -Infinity, tiedHi = 0, minLo = NO_LOW, tiedLo = 0;
    for (const h of oppHands) {
        const hi = E.evalOmaha(h, HP4, board);
        if (hi > maxHi) { maxHi = hi; tiedHi = 1; }
        else if (hi === maxHi) tiedHi++;
        const lo = E.evalOmahaLow(h, HP4, board);
        if (lo !== NO_LOW) {
            if (lo < minLo) { minLo = lo; tiedLo = 1; }
            else if (lo === minLo) tiedLo++;
        }
    }

    const n = heroCards.length;
    const hand = new Array(4);
    for (let d = 3; d < n; d++) {
        hand[3] = heroCards[d];
        for (let c = 2; c < d; c++) {
            hand[2] = heroCards[c];
            for (let b = 1; b < c; b++) {
                hand[1] = heroCards[b];
                for (let a = 0; a < b; a++) {
                    hand[0] = heroCards[a];
                    const cls = classIndex(hand[0], hand[1], hand[2], hand[3]);
                    const rb = cls * REP_SLOTS, fb = cls * FRQ_SLOTS;
                    rep[rb + 2]++;

                    const hi = E.evalOmaha(hand, HP4, board);
                    let hiSh;
                    if (hi > maxHi) { hiSh = UNIT; frq[fb + 0]++; }
                    else if (hi === maxHi) { hiSh = UNIT / (tiedHi + 1); frq[fb + 1]++; }
                    else hiSh = 0;

                    const lo = E.evalOmahaLow(hand, HP4, board);
                    let s, hp;
                    if (lo === NO_LOW && minLo === NO_LOW) {
                        // Kukaan ei tehnyt low'ta: korkea käsi vie koko potin
                        s = hiSh; hp = hiSh;
                    } else {
                        hp = hiSh / 2;
                        let loSh;
                        if (lo < minLo) { loSh = UNIT; frq[fb + 2]++; }
                        else if (lo === minLo) { loSh = UNIT / (tiedLo + 1); frq[fb + 3]++; }
                        else loSh = 0;
                        s = hp + loSh / 2;
                    }
                    rep[rb] += s;
                    rep[rb + 1] += hp;

                    if (s === UNIT) frq[fb + 4]++;
                    else if (s === 0) frq[fb + 5]++;
                    else if (s === UNIT / 4) frq[fb + 6]++;
                    else if (s === UNIT / 2) frq[fb + 7]++;
                }
            }
        }
    }
    return { rep, frq };
}

// --- Vertailu ------------------------------------------------------------

function compare(name, got, want) {
    if (got.length !== want.length) throw new Error(`${name}: eri pituus`);
    let diffs = 0, first = null;
    for (let i = 0; i < got.length; i++) {
        if (got[i] !== want[i]) {
            diffs++;
            if (!first) first = { i, got: got[i], want: want[i] };
        }
    }
    if (diffs) {
        throw new Error(`${name}: ${diffs} eroa, ensimmäinen indeksissä ${first.i}: ` +
            `työläinen ${first.got}, raakalaskenta ${first.want}`);
    }
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return (t ^ (t >>> 14)) >>> 0;
    };
}

function verifyBoard(board, rng, configs) {
    prepareBoard(board, W.buf);
    const LOW = W.prepareLow(board);
    const rest = W.buf.rest;

    const pos = new Int32Array(REST);
    let lowHands = 0, scoops = 0;
    for (let k = 0; k < configs; k++) {
        const rep = new Float64Array(N_CLASSES * REP_SLOTS);
        const frq = new Uint32Array(N_CLASSES * FRQ_SLOTS);
        W.runConfig(rng, pos, rep, frq, LOW);

        // Sama arvonta luettuna ulos: vastustajien kortit ja heron pooli
        const oppHands = [];
        for (let o = 0; o < OPPONENTS; o++) {
            oppHands.push([0, 1, 2, 3].map(x => rest[pos[o * 4 + x]]));
        }
        const heroCards = [];
        for (let i = OPP_CARDS; i < REST; i++) heroCards.push(rest[pos[i]]);
        heroCards.sort((x, y) => x - y);
        if (heroCards.length !== HERO_POOL) throw new Error('heron poolin koko väärä');

        const ref = reference(board, oppHands, heroCards);
        compare('rep', rep, ref.rep);
        compare('frq', frq, ref.frq);

        for (let i = 0; i < N_CLASSES; i++) {
            scoops += frq[i * FRQ_SLOTS + 4];
            lowHands += frq[i * FRQ_SLOTS + 2] + frq[i * FRQ_SLOTS + 3];
        }
    }
    const bs = Array.from(board).map(show).join('');
    console.log(`  ${bs}: lowPossible=${LOW}, ${configs} konfiguraatiota x ` +
        `${HERO_POOL >= 4 ? (HERO_POOL * (HERO_POOL - 1) * (HERO_POOL - 2) * (HERO_POOL - 3) / 24).toLocaleString('fi-FI') : 0} kättä ` +
        `-> kaikki sarjat täsmäävät (low-osumia ${lowHands.toLocaleString('fi-FI')}, scoopeja ${scoops.toLocaleString('fi-FI')})`);
}

function main() {
    const rng = mulberry32(20260801);

    // Käsin valitut reunatapaukset + satunnaisia pöytiä. Samat kuin
    // eksaktin putken varmennuksessa, jotta molemmat haarat tulevat
    // katetuiksi: ei low-mahdollisuutta, tasan kolme low-arvoa, matala
    // suora/väri ja parillinen matala pöytä.
    const card = s => E.cardToInt(s);
    const cards = str => str.match(/.{2}/g).map(card);
    const boards = [
        cards('9sThJdQhKc'),
        cards('As2h8dTcJs'),
        cards('3s4s5s6s7s'),
        cards('Ah2d2c7s8h')
    ];
    while (boards.length < N_BOARDS) {
        const s = new Set();
        while (s.size < 5) s.add(rng() % 52);
        boards.push([...s]);
    }

    console.log(`Varmennetaan ${PLAYERS} pelaajaa, ${boards.length} pöytää, ` +
        `${N_CONFIGS} konfiguraatiota/pöytä (kaikki heron kädet joka konfiguraatiossa):`);
    const t0 = Date.now();
    for (const b of boards.slice(0, Math.max(N_BOARDS, 4))) verifyBoard(b, rng, N_CONFIGS);
    console.log(`Kaikki tarkistukset läpi (${((Date.now() - t0) / 1000).toFixed(1)} s).`);
}

main();
