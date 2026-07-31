// Eksaktin Omaha Hi/Lo -pöytäratkaisijan riippumaton varmennus.
//
// Ratkaisee pöytiä solveBoardHiLo:lla ja vertaa tuloksia raakalaskentaan,
// joka käyttää TOISTA arviointitoteutusta (public/js/engine.js) ja
// toteuttaa jakosäännöt suoraan pelisäännöistä - ei työläisen
// inkluusio-ekskluusiokaavoista. Jokaiselle testikädelle käydään läpi
// kaikki C(43,4) = 123 410 vastustajakättä. Tulosten on täsmättävä
// bitilleen.
//
// Käyttö:
//   node scripts/verifyExactHilo.js [pöytiä] [käsiä/pöytä]   (oletus 6 ja 8)

const E = require('../public/js/engine');
const {
    solveBoardHiLo, createHiloBuffers, NO_LOW, N_OPP, REST, C2, C3, C4
} = require('./exactOmahaHiloWorker');

const HP4 = E.HOLE_PAIRS[4];
const card = s => E.cardToInt(s);
const cards = str => str.match(/.{2}/g).map(card);
const show = h => h.map(E.intToCard).join('');

/** Käden colex-indeksi rest-taulukon positioista i<j<k<l */
const handIndex = (i, j, k, l) => C4[l] + C3[k] + C2[j] + i;

/**
 * Raakalaskenta: heron eksakti hi/lo-osuus neljännespotteina kaikkia
 * C(43,4) vastustajakäsiä vastaan. Suora sääntötoteutus.
 */
function bruteForce(heroCards, board, rest) {
    const heroHi = E.evalOmaha(heroCards, HP4, board);
    const heroLo = E.evalOmahaLow(heroCards, HP4, board);

    // Vastustajan kortit: rest miinus heron kortit
    const others = rest.filter(c => !heroCards.includes(c));
    if (others.length !== 43) throw new Error('vastustajakortteja ei ole 43');

    let hi4 = 0, lo4 = 0, opps = 0;
    const opp = new Array(4);
    for (let a = 0; a < 43; a++) {
        opp[0] = others[a];
        for (let b = a + 1; b < 43; b++) {
            opp[1] = others[b];
            for (let c = b + 1; c < 43; c++) {
                opp[2] = others[c];
                for (let d = c + 1; d < 43; d++) {
                    opp[3] = others[d];
                    opps++;

                    const oppHi = E.evalOmaha(opp, HP4, board);
                    const oppLo = E.evalOmahaLow(opp, HP4, board);

                    // Hi-puolikas neljänneksinä: voitto 2, tasan 1, häviö 0
                    const hiCmp = heroHi > oppHi ? 2 : heroHi === oppHi ? 1 : 0;

                    if (heroLo === NO_LOW && oppLo === NO_LOW) {
                        // Kummallakaan ei low'ta: hi ratkaisee koko potin.
                        // Kirjataan hi-komponenttiin (sama esityskäytäntö
                        // kuin moottorissa ja taulukossa).
                        hi4 += 2 * hiCmp;
                    } else {
                        hi4 += hiCmp;
                        if (heroLo !== NO_LOW) {
                            // Pienempi maski on parempi low
                            lo4 += oppLo === NO_LOW ? 2
                                : heroLo < oppLo ? 2
                                    : heroLo === oppLo ? 1 : 0;
                        }
                        // heroLo === NO_LOW: vastustaja vie low-puolikkaan
                    }
                }
            }
        }
    }
    if (opps !== N_OPP) throw new Error(`vastustajakäsiä ${opps}, odotus ${N_OPP}`);
    return { hi4, lo4 };
}

function verifyBoard(boardStr, handsPerBoard, rng) {
    const board = cards(boardStr);
    const buf = createHiloBuffers();
    const info = solveBoardHiLo(board, buf);

    // rest samassa järjestyksessä kuin ratkaisijassa
    const rest = [];
    for (let c = 0; c < 52; c++) if (!board.includes(c)) rest.push(c);

    // 1) Low-arvot: ratkaisijan handLoG vs. engine.evalOmahaLow
    //    otokselle käsiä (maski puretaan hyvyydestä buf.loMasks-taululla)
    let loChecked = 0;
    for (let n = 0; n < 3000; n++) {
        const pos = samplePositions(rng);
        const idx = handIndex(pos[0], pos[1], pos[2], pos[3]);
        const hand = pos.map(p => rest[p]);
        const engineLo = E.evalOmahaLow(hand, HP4, board);
        const g = info.lowPossible ? buf.handLoG[idx] : -1;
        const solverLo = g >= 0 ? buf.loMasks[g] : NO_LOW;
        if (engineLo !== solverLo) {
            throw new Error(`low-ero: ${show(hand)} pöydällä ${boardStr}: ` +
                `engine ${engineLo}, ratkaisija ${solverLo}`);
        }
        loChecked++;
    }

    // 2) Hi-järjestys: pakattujen arvojen järjestyksen on vastattava
    //    enginen arvojen järjestystä satunnaisilla käsipareilla
    for (let n = 0; n < 2000; n++) {
        const p1 = samplePositions(rng), p2 = samplePositions(rng);
        const i1 = handIndex(...p1), i2 = handIndex(...p2);
        const e1 = E.evalOmaha(p1.map(p => rest[p]), HP4, board);
        const e2 = E.evalOmaha(p2.map(p => rest[p]), HP4, board);
        if (Math.sign(e1 - e2) !== Math.sign(buf.handVal[i1] - buf.handVal[i2])) {
            throw new Error(`hi-järjestysero pöydällä ${boardStr}`);
        }
    }

    // 3) Täysi raakalaskenta testikäsille: kaikki 123 410 vastustajaa.
    //    Puolet käsistä arvotaan low-käsien joukosta (jos mahdollista),
    //    jotta molemmat haarat (herolla low / ei low'ta) tulevat katetuiksi.
    let checked = 0, withLow = 0;
    for (let n = 0; n < handsPerBoard; n++) {
        let pos = samplePositions(rng);
        if (info.lowPossible && n % 2 === 0) {
            // Etsi low-käsi (rajallinen määrä yrityksiä)
            for (let tries = 0; tries < 200; tries++) {
                if (buf.handLoG[handIndex(...pos)] >= 0) break;
                pos = samplePositions(rng);
            }
        }
        const idx = handIndex(...pos);
        const hand = pos.map(p => rest[p]);
        const bf = bruteForce(hand, board, rest);
        if (bf.hi4 !== buf.hi4[idx] || bf.lo4 !== buf.lo4[idx]) {
            throw new Error(`OSUUSERO: ${show(hand)} pöydällä ${boardStr}: ` +
                `raaka hi=${bf.hi4} lo=${bf.lo4}, ` +
                `ratkaisija hi=${buf.hi4[idx]} lo=${buf.lo4[idx]}`);
        }
        checked++;
        if (buf.handLoG && info.lowPossible && buf.handLoG[idx] >= 0) withLow++;
    }

    console.log(`  ${boardStr}: lowPossible=${info.lowPossible} R=${info.R} RL=${info.RL}  ` +
        `low-arvot ${loChecked} OK, raakalaskenta ${checked}/${checked} OK (${withLow} low-kättä)`);
}

// Deterministinen PRNG, jotta ajo on toistettavissa
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function samplePositions(rng) {
    const s = new Set();
    while (s.size < 4) s.add(Math.floor(rng() * REST));
    return [...s].sort((x, y) => x - y);
}

function main() {
    const nBoards = parseInt(process.argv[2], 10) || 6;
    const handsPerBoard = parseInt(process.argv[3], 10) || 8;
    const rng = mulberry32(20260731);

    // Käsin valitut reunatapaukset + satunnaisia pöytiä:
    //  - ei low-mahdollisuutta (kaikki >= 9)
    //  - tasan 3 eri low-arvoa
    //  - matala suora + väripöytä (hi ja lo sekoittuvat)
    //  - parillinen matala pöytä (counterfeit-tilanteita)
    const boards = [
        '9sThJdQhKc',
        'As2h8dTcJs',
        '3s4s5s6s7s',
        'Ah2d2c7s8h'
    ];
    const RANKS = '23456789TJQKA', SUITS = 'shdc';
    while (boards.length < nBoards) {
        const s = new Set();
        while (s.size < 5) s.add(Math.floor(rng() * 52));
        boards.push([...s].map(c => RANKS[c >> 2] + SUITS[c & 3]).join(''));
    }

    console.log(`Varmennetaan ${boards.length} pöytää, ${handsPerBoard} raakalaskentakättä/pöytä:`);
    const t0 = Date.now();
    for (const b of boards) verifyBoard(b, handsPerBoard, rng);
    console.log(`Kaikki tarkistukset läpi (${((Date.now() - t0) / 1000).toFixed(1)} s).`);
}

main();
