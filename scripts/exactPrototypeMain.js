// Ajurit vaiheen 0 prototyypille: oikeellisuustarkistukset ja mittaus.
// Katso scripts/exactPrototype.js ja docs/eksakti-omaha-equity.md (ei repossa).

const {
    eval5, solveBoard, createBuffers,
    N_HANDS, N_OPP, REST, C2, C3, C4
} = require('./exactPrototype');

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

/** Kokonaislukukortti 0..51 -> 'Ad' */
const cardToStr = c => RANKS[c >> 2] + SUITS[c & 3];

/** Deterministinen PRNG testipöytien arpomiseen */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomBoard(rand) {
    const deck = new Int32Array(52);
    for (let i = 0; i < 52; i++) deck[i] = i;
    for (let i = 0; i < 5; i++) {
        const j = i + Math.floor(rand() * (52 - i));
        const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return Array.from(deck.slice(0, 5)).sort((a, b) => a - b);
}

// --- Tarkistus 1: eval5 vs. poker-evaluator ----------------------------

function verifyEvaluator(rounds) {
    const pe = require('poker-evaluator');
    const rand = mulberry32(20260727);
    const deck = new Int32Array(52);
    for (let i = 0; i < 52; i++) deck[i] = i;
    let disagree = 0;
    for (let t = 0; t < rounds; t++) {
        for (let i = 0; i < 10; i++) {
            const j = i + Math.floor(rand() * (52 - i));
            const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
        }
        const A = [deck[0], deck[1], deck[2], deck[3], deck[4]];
        const B = [deck[5], deck[6], deck[7], deck[8], deck[9]];
        const mine = Math.sign(eval5(...A) - eval5(...B));
        const theirs = Math.sign(
            pe.evalHand(A.map(cardToStr)).value - pe.evalHand(B.map(cardToStr)).value);
        if (mine !== theirs) {
            if (disagree < 5) {
                console.log('  ERIMIELISYYS:', A.map(cardToStr).join(' '), 'vs', B.map(cardToStr).join(' '));
            }
            disagree++;
        }
    }
    console.log(`  eval5 vs poker-evaluator: ${rounds} paria, erimielisyyksiä ${disagree}`);
    return disagree === 0;
}

// --- Tarkistus 2: pöytäkohtainen summainvariantti ----------------------
//
// Jokaiselle järjestetylle pistevieraalle parille (X,Y) pätee
// equity(X vs Y) + equity(Y vs X) = 1, joten kaikkien käsien equityjen
// summan on oltava tasan puolet parien määrästä.

function verifySumInvariant(buf) {
    let sum = 0;
    for (let i = 0; i < N_HANDS; i++) sum += 2 * buf.winNum[i] + buf.tieNum[i];
    const expected = N_HANDS * N_OPP;  // puolikkaina: 2 * (1/2 * N_HANDS * N_OPP)
    const ok = sum === expected;
    console.log(`  summainvariantti: ${sum.toLocaleString('fi-FI')} vs odotettu ` +
        `${expected.toLocaleString('fi-FI')} -> ${ok ? 'OK' : 'VIRHE'}`);
    return ok;
}

// --- Tarkistus 3: raakalaskenta muutamalle kädelle ---------------------

function verifyBruteForce(buf, samples, rand) {
    const { handVal, winNum, tieNum } = buf;
    let ok = true;
    for (let s = 0; s < samples; s++) {
        // arvo satunnainen käsi (i<j<k<l)
        const idxs = [];
        while (idxs.length < 4) {
            const x = Math.floor(rand() * REST);
            if (!idxs.includes(x)) idxs.push(x);
        }
        idxs.sort((a, b) => a - b);
        const [i, j, k, l] = idxs;
        const heroIdx = C4[l] + C3[k] + C2[j] + i;
        const v = handVal[heroIdx];

        // Käy läpi KAIKKI 4 kortin kädet ja ohita ne jotka jakavat kortin heron kanssa
        let better = 0, equal = 0, worse = 0;
        for (let d = 3; d < REST; d++) {
            if (d === i || d === j || d === k || d === l) continue;
            for (let c = 2; c < d; c++) {
                if (c === i || c === j || c === k || c === l) continue;
                for (let b = 1; b < c; b++) {
                    if (b === i || b === j || b === k || b === l) continue;
                    const base = C4[d] + C3[c] + C2[b];
                    for (let a = 0; a < b; a++) {
                        if (a === i || a === j || a === k || a === l) continue;
                        const ov = handVal[base + a];
                        if (ov > v) better++;
                        else if (ov === v) equal++;
                        else worse++;
                    }
                }
            }
        }
        const total = better + equal + worse;
        const pass = total === N_OPP && worse === winNum[heroIdx] && equal === tieNum[heroIdx];
        if (!pass) {
            console.log(`  VIRHE käsi ${i},${j},${k},${l}: yht ${total} (odotus ${N_OPP}), ` +
                `raaka voitot/tasat ${worse}/${equal} vs inc-exc ${winNum[heroIdx]}/${tieNum[heroIdx]}`);
            ok = false;
        }
    }
    console.log(`  raakalaskenta ${samples} kädelle: ${ok ? 'OK' : 'VIRHE'}`);
    return ok;
}

// --- Tarkistus 4: handVal suoraan eval5:llä ----------------------------

function verifyHandVals(board, buf, samples, rand) {
    const { rest, handVal, distinct, pairVal } = buf;
    // rakenna arvo -> rank uudelleen binäärihaulla
    let R = 0;
    { // laske R samalla tavalla kuin solveBoard
        const seen = new Set();
        for (let p = 0; p < pairVal.length; p++) seen.add(pairVal[p]);
        R = seen.size;
    }
    const triples = [];
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) for (let c = b + 1; c < 5; c++) triples.push([a, b, c]);

    let ok = true;
    for (let s = 0; s < samples; s++) {
        const idxs = [];
        while (idxs.length < 4) {
            const x = Math.floor(rand() * REST);
            if (!idxs.includes(x)) idxs.push(x);
        }
        idxs.sort((a, b) => a - b);
        const [i, j, k, l] = idxs;
        const cards = [rest[i], rest[j], rest[k], rest[l]];
        let best = 0;
        for (let p = 0; p < 4; p++) {
            for (let q = p + 1; q < 4; q++) {
                for (const tr of triples) {
                    const v = eval5(cards[p], cards[q], board[tr[0]], board[tr[1]], board[tr[2]]);
                    if (v > best) best = v;
                }
            }
        }
        // best -> rank
        let lo = 0, hi = R - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (distinct[mid] < best) lo = mid + 1; else hi = mid;
        }
        const got = handVal[C4[l] + C3[k] + C2[j] + i];
        if (distinct[got] !== best) {
            console.log(`  VIRHE handVal ${cards.map(cardToStr).join('')}: raaka ${best}, taulukko ${distinct[got]}`);
            ok = false;
        }
    }
    console.log(`  handVal ${samples} kädelle suoraan eval5:llä: ${ok ? 'OK' : 'VIRHE'}`);
    return ok;
}

// --- Ajurit ------------------------------------------------------------

function verify() {
    console.log('Vaihe 0: oikeellisuustarkistukset\n');
    let allOk = true;

    console.log('1. Käsienarvioija');
    allOk = verifyEvaluator(200000) && allOk;

    const rand = mulberry32(4242);
    const buf = createBuffers();

    for (let boardNo = 1; boardNo <= 3; boardNo++) {
        const board = randomBoard(rand);
        console.log(`\n${boardNo + 1}. Pöytä ${board.map(cardToStr).join(' ')}`);
        const { R, timings } = solveBoard(board, buf);
        console.log(`  eri arvoja pöydällä: R = ${R} (max ${1081})`);
        console.log(`  aika ${timings.total.toFixed(0)} ms`);
        allOk = verifySumInvariant(buf) && allOk;
        allOk = verifyHandVals(board, buf, 20, rand) && allOk;
        allOk = verifyBruteForce(buf, 8, rand) && allOk;
    }

    console.log(`\n${allOk ? 'KAIKKI TARKISTUKSET LÄPI' : 'TARKISTUKSISSA VIRHEITÄ'}`);
    process.exit(allOk ? 0 : 1);
}

function bench(n) {
    const rand = mulberry32(999);
    const buf = createBuffers();
    console.log(`Mittaus: ${n} pöytää\n`);

    // lämmittely
    solveBoard(randomBoard(rand), buf);

    const sums = { evals: 0, compress: 0, handVals: 0, hist: 0, incexc: 0, total: 0 };
    let rSum = 0;
    for (let i = 0; i < n; i++) {
        const { R, timings } = solveBoard(randomBoard(rand), buf);
        rSum += R;
        for (const key of Object.keys(sums)) sums[key] += timings[key];
    }

    console.log('vaihe                     ms/pöytä    osuus');
    const label = {
        evals: '1  parien arvot (10 810)',
        compress: '1b pakkaus + binäärihaku',
        handVals: '2  käsien arvot (178 365)',
        hist: '3a histogrammit + summat',
        incexc: '3b inkluusio-ekskluusio'
    };
    for (const key of ['evals', 'compress', 'handVals', 'hist', 'incexc']) {
        const ms = sums[key] / n;
        console.log(`${label[key].padEnd(26)}${ms.toFixed(2).padStart(8)}   ${(100 * sums[key] / sums.total).toFixed(1)}%`);
    }
    const perBoard = sums.total / n;
    console.log(`${'YHTEENSÄ'.padEnd(26)}${perBoard.toFixed(2).padStart(8)}`);
    console.log(`\nkeskim. eri arvoja pöydällä: R = ${(rSum / n).toFixed(0)}`);

    const BOARDS_ALL = 2598960;
    const BOARDS_CANON = 134459;
    console.log('\nEkstrapolaatio:');
    for (const [name, boards] of [['kaikki pöydät', BOARDS_ALL], ['kanoniset pöydät', BOARDS_CANON]]) {
        const coreHours = perBoard * boards / 1000 / 3600;
        console.log(`  ${name.padEnd(18)} ${boards.toLocaleString('fi-FI').padStart(9)} kpl  ` +
            `${coreHours.toFixed(2).padStart(7)} ydintuntia  ` +
            `= ${(coreHours * 60 / 32).toFixed(0).padStart(4)} min / 32 säiettä`);
    }
}

module.exports = function main(argv) {
    const mode = argv[0] || 'verify';
    if (mode === 'verify') verify();
    else if (mode === 'bench') bench(parseInt(argv[1] || '5', 10));
    else {
        console.error('Käyttö: node scripts/exactPrototype.js verify|bench [n]');
        process.exit(1);
    }
};
