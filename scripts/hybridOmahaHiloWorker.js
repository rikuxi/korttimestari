// Omaha Hi/Lo -moninpelin hybridilaskennan työläinen.
//
// Rakenne on sama kuin hi-puolen hybridissä (scripts/hybridOmahaWorker.js):
// EKSAKTI pöytien yli - kaikki C(52,5) pöytää käydään läpi - ja Monte Carlo
// vain vastustajien korttien poiston yli. Yhdellä pöydällä ja yhdellä
// vastustajakonfiguraatiolla pisteytetään KAIKKI C(47 - 4*vastustajat, 4)
// heron kättä kerralla.
//
// Uutta hi-puoleen verrattuna on low: pöydälle rakennetaan hi-arvojen
// rinnalle low-hyvyydet, ja kierroksen osuus on 1/2 hi + 1/2 low - paitsi
// jos kukaan pöydässä olevista ei tehnyt kelvollista low'ta, jolloin korkea
// käsi vie koko potin.
//
// Low-koodaus on sama kuin public/js/engine.js:ssä: 8-bittinen arvomaski
// (ässä = bitti 0, ..., 8 = bitti 7), ja pienempi maski kokonaislukuna =
// parempi low. Pöydän sisällä maskit pakataan hyvyysasteiksi 0..RL-1
// (suurempi = parempi), jolloin low-vertailu on yhtä halpa kokonaisluku-
// vertailu kuin hi-vertailu.
//
// Low-puoli on kirjoitettu tähän itsenäisesti eikä jaettu eksaktin putken
// (scripts/exactOmahaHiloWorker.js) kanssa. Se on tarkoituksellista: kahden
// pelaajan ajo validoidaan eksaktia heads-up-taulukkoa vastaan, jolloin
// riippumattomien toteutusten täsmääminen on aito tarkistus. Eksaktia
// putkea ei myöskään saa ladata työläisessä, koska se rekisteröi oman
// parentPort-kuuntelijansa.
//
// Osuudet ovat kokonaislukuja: koko potti = UNIT = 5040 yksikköä. 5040 on
// jaollinen kaikilla 1..10:llä ja osamäärät ovat parillisia, joten sekä
// n-suuntainen tasapeli että puoliskoihin jako menevät tasan - liukuluku-
// pyöristystä ei synny lainkaan.

const { parentPort, workerData } = require('worker_threads');
const {
    prepareBoard, createBuffers, REST, N_PAIRS, N_HANDS, C2, C3, C4
} = require('./exactPrototype');

const N_CLASSES = 16432;

// Koko potti kokonaislukuyksiköissä. LCM(1..10) = 2520; kaksinkertaisena
// myös puoliskot menevät tasan (5040/k on parillinen kaikilla k <= 10).
const UNIT = 5040;

// Kertymätaulukoiden asettelu. Sarjat ovat luokan sisällä peräkkäin, jolloin
// yhden käden kaikki kirjaukset osuvat samaan välimuistiriviin - erillisinä
// taulukoina jokainen sarja olisi oma satunnainen osumansa.
const REP_SLOTS = 4;    // osuus, hi-osuus, näytteet, (varalla) = 32 tavua
const FRQ_SLOTS = 8;    // 8 x uint32 = 32 tavua
const F_HIWIN = 0, F_HITIE = 1, F_LOWIN = 2, F_LOTIE = 3;
const F_SCOOP = 4, F_NONE = 5, F_QUARTER = 6, F_HALF = 7;

// Binomikertoimet (globaali colex-indeksointi luokkataulukkoon), pöytien
// iteraattori, xoshiro128** ja pöydän kolmikot (batchCommon.js); low-koodaus
// on sama kuin public/js/engine.js:ssä, taulukot tuodaan sieltä
const { BINOM, unrank5, nextCombination, makeRng, BOARD_TRIPLES } = require('./batchCommon');
const { NO_LOW, LOW_BIT, POP8 } = require('../public/js/engine');
const { G2, G3, G4 } = BINOM;

// --- xoshiro128** : jakso 2^128-1, riittää mihin tahansa ajokokoon ---------

// --- Työläisen tila ------------------------------------------------------

// Asetukset tulevat työläisenä workerDatasta. Pääsäikeestä ladattaessa
// (scripts/verifyHybridHilo.js) ne annetaan globaalina, jotta varmennus voi
// kutsua runConfigia suoraan samalla koodilla jota eräajo ajaa.
const wd = workerData || globalThis.__hybridHiloWorkerConfig;
if (!wd) throw new Error('hybridOmahaHiloWorker: asetukset puuttuvat');

const classOf = wd.classOf;
const OPPONENTS = wd.players - 1;
const OPP_CARDS = OPPONENTS * 4;
const HERO_POOL = REST - OPP_CARDS;
const CONFIGS = wd.configs;
const REPLICATES = wd.replicates;

// Osuus kun k pelaajaa jakaa puoliskon (tai koko potin) tasan
const SHARE = new Int32Array(12);
for (let k = 1; k <= 11; k++) SHARE[k] = UNIT % k === 0 ? UNIT / k : -1;

const QUARTER = UNIT / 4;
const HALF = UNIT / 2;

const buf = createBuffers();
const pairLo = new Int32Array(N_PAIRS);      // parin low-hyvyys tai -1
const handLo = new Int32Array(N_HANDS);      // käden low-hyvyys tai -1
const boardTri = new Int32Array(10);         // pöydän low-kelpoiset kolmikot
const maskSeen = new Uint8Array(256);
const maskOrder = new Int32Array(64);
const goodOf = new Int32Array(256);

const posArr = Array.from({ length: REPLICATES }, () => new Int32Array(REST));
const heroPos = new Int32Array(HERO_POOL);
const h4 = new Float64Array(HERO_POOL), h3 = new Float64Array(HERO_POOL);
const h2 = new Float64Array(HERO_POOL), h1 = new Int32Array(HERO_POOL);
const q4 = new Float64Array(HERO_POOL), q3 = new Float64Array(HERO_POOL);
const q2 = new Float64Array(HERO_POOL), q1 = new Int32Array(HERO_POOL);

/**
 * Pöydän low-puolen esivalmistelu: täyttää pairLo ja handLo.
 * Kutsutaan prepareBoardin jälkeen (tarvitsee buf.rest).
 * @returns {boolean} - voiko pöydällä ylipäätään syntyä low'ta
 */
function prepareLow(board) {
    // Kelvollinen low vaatii pöydältä kolme eri low-arvoa ja kädestä kaksi
    let nbt = 0;
    for (let b = 0; b < 30; b += 3) {
        const m = LOW_BIT[board[BOARD_TRIPLES[b]]]
            | LOW_BIT[board[BOARD_TRIPLES[b + 1]]]
            | LOW_BIT[board[BOARD_TRIPLES[b + 2]]];
        if (POP8[m] === 3) boardTri[nbt++] = m;
    }
    if (nbt === 0) return false;

    // --- Parien paras low-maski ---
    const rest = buf.rest;
    maskSeen.fill(0);
    for (let j = 1; j < REST; j++) {
        const bj = LOW_BIT[rest[j]];
        const base = C2[j];
        for (let i = 0; i < j; i++) {
            const pm = LOW_BIT[rest[i]] | bj;
            let best = NO_LOW;
            if (POP8[pm] === 2) {
                for (let b = 0; b < nbt; b++) {
                    const tm = boardTri[b];
                    // Viisi ERI arvoa: parin ja kolmikon arvot eivät saa leikata
                    if ((pm & tm) === 0) {
                        const m = pm | tm;
                        if (m < best) best = m;
                    }
                }
            }
            pairLo[base + i] = best;
            if (best !== NO_LOW) maskSeen[best] = 1;
        }
    }

    // --- Pakkaa maskit hyvyysasteiksi: pienin maski = paras = suurin hyvyys ---
    let rl = 0;
    for (let m = 0; m < 256; m++) if (maskSeen[m]) maskOrder[rl++] = m;
    if (rl === 0) return false;      // pöytä sallisi low'n, mutta yksikään
    for (let t = 0; t < rl; t++) goodOf[maskOrder[t]] = rl - 1 - t;
    for (let p = 0; p < N_PAIRS; p++) {
        const m = pairLo[p];
        pairLo[p] = m === NO_LOW ? -1 : goodOf[m];
    }

    // --- Käsien low-hyvyys: paras kuudesta parista (sama rakenne kuin hi) ---
    for (let l = 3; l < REST; l++) {
        const c4l = C4[l], c2l = C2[l];
        for (let k = 2; k < l; k++) {
            const c3k = C3[k], c2k = C2[k];
            const gkl = pairLo[c2l + k];
            for (let j = 1; j < k; j++) {
                const c2j = C2[j];
                const gjk = pairLo[c2k + j];
                const gjl = pairLo[c2l + j];
                let m1 = gkl > gjk ? gkl : gjk;
                if (gjl > m1) m1 = gjl;
                const base = c4l + c3k + c2j;
                for (let i = 0; i < j; i++) {
                    const gij = pairLo[c2j + i];
                    const gik = pairLo[c2k + i];
                    const gil = pairLo[c2l + i];
                    let m = m1;
                    if (gij > m) m = gij;
                    if (gik > m) m = gik;
                    if (gil > m) m = gil;
                    handLo[base + i] = m;
                }
            }
        }
    }
    return true;
}

/**
 * Yksi vastustajakonfiguraatio: arvo 4*vastustajat korttia, laske heidän
 * paras hi-arvonsa ja paras low'nsa ja pisteytä kaikki jäljelle jäävät
 * heron kädet.
 */
function runConfig(rand, pos, rep, frq, LOW) {
    const { rest, pairRank, handVal } = buf;

    // Nollaus tekee konfiguraatioista riippumattomia
    for (let i = 0; i < REST; i++) pos[i] = i;

    // Osittainen Fisher-Yates: sekoita vain vastustajien tarvitsemat paikat
    for (let i = 0; i < OPP_CARDS; i++) {
        const j = i + (rand() % (REST - i));
        const t = pos[i]; pos[i] = pos[j]; pos[j] = t;
    }

    // Vastustajien paras hi-arvo ja paras low-hyvyys tasapelimäärineen
    let maxV = -1, tiedHi = 0, maxG = -1, tiedLo = 0;
    for (let o = 0; o < OPPONENTS; o++) {
        const b = o * 4;
        let a0 = pos[b], a1 = pos[b + 1], a2 = pos[b + 2], a3 = pos[b + 3];
        let x;
        if (a0 > a1) { x = a0; a0 = a1; a1 = x; }
        if (a2 > a3) { x = a2; a2 = a3; a3 = x; }
        if (a0 > a2) { x = a0; a0 = a2; a2 = x; }
        if (a1 > a3) { x = a1; a1 = a3; a3 = x; }
        if (a1 > a2) { x = a1; a1 = a2; a2 = x; }
        const p01 = C2[a1] + a0, p02 = C2[a2] + a0, p03 = C2[a3] + a0;
        const p12 = C2[a2] + a1, p13 = C2[a3] + a1, p23 = C2[a3] + a2;

        let v = pairRank[p01];
        let p = pairRank[p02]; if (p > v) v = p;
        p = pairRank[p03]; if (p > v) v = p;
        p = pairRank[p12]; if (p > v) v = p;
        p = pairRank[p13]; if (p > v) v = p;
        p = pairRank[p23]; if (p > v) v = p;
        if (v > maxV) { maxV = v; tiedHi = 1; }
        else if (v === maxV) tiedHi++;

        if (LOW) {
            let g = pairLo[p01];
            let e = pairLo[p02]; if (e > g) g = e;
            e = pairLo[p03]; if (e > g) g = e;
            e = pairLo[p12]; if (e > g) g = e;
            e = pairLo[p13]; if (e > g) g = e;
            e = pairLo[p23]; if (e > g) g = e;
            if (g >= 0) {
                if (g > maxG) { maxG = g; tiedLo = 1; }
                else if (g === maxG) tiedLo++;
            }
        }
    }
    const HTIE = SHARE[tiedHi + 1];
    const LTIE = SHARE[tiedLo + 1];

    // Heron käytettävissä olevat paikat nousevaan järjestykseen
    for (let i = OPP_CARDS; i < REST; i++) heroPos[i - OPP_CARDS] = pos[i];
    heroPos.sort();

    for (let x = 0; x < HERO_POOL; x++) {
        const p = heroPos[x], c = rest[p];
        h4[x] = C4[p]; h3[x] = C3[p]; h2[x] = C2[p]; h1[x] = p;
        q4[x] = G4[c]; q3[x] = G3[c]; q2[x] = G2[c]; q1[x] = c;
    }

    // Pisteytä kaikki C(HERO_POOL, 4) kättä
    for (let d = 3; d < HERO_POOL; d++) {
        const i4 = h4[d], g4v = q4[d];
        for (let c = 2; c < d; c++) {
            const i3 = i4 + h3[c], g3v = g4v + q3[c];
            for (let b = 1; b < c; b++) {
                const i2 = i3 + h2[b], g2v = g3v + q2[b];
                for (let a = 0; a < b; a++) {
                    const idx = i2 + h1[a];
                    const cls = classOf[g2v + q1[a]];
                    const rb = cls * REP_SLOTS, fb = cls * FRQ_SLOTS;
                    rep[rb + 2]++;

                    // Korkea puolisko
                    const v = handVal[idx];
                    let hiSh;
                    if (v > maxV) { hiSh = UNIT; frq[fb + F_HIWIN]++; }
                    else if (v === maxV) { hiSh = HTIE; frq[fb + F_HITIE]++; }
                    else hiSh = 0;

                    // Matala puolisko. Jos kukaan - hero mukaan lukien - ei
                    // tehnyt low'ta, korkea käsi vie koko potin.
                    const g = LOW ? handLo[idx] : -1;
                    let s, hp;
                    if (g < 0 && maxG < 0) {
                        s = hiSh; hp = hiSh;
                    } else {
                        hp = hiSh >> 1;
                        let loSh;
                        if (g > maxG) { loSh = UNIT; frq[fb + F_LOWIN]++; }
                        else if (g === maxG) { loSh = LTIE; frq[fb + F_LOTIE]++; }
                        else loSh = 0;
                        s = hp + (loSh >> 1);
                    }
                    rep[rb] += s;
                    rep[rb + 1] += hp;

                    if (s === UNIT) frq[fb + F_SCOOP]++;
                    else if (s === 0) frq[fb + F_NONE]++;
                    else if (s === QUARTER) frq[fb + F_QUARTER]++;
                    else if (s === HALF) frq[fb + F_HALF]++;
                }
            }
        }
    }
}

module.exports = {
    prepareLow, runConfig, buf, pairLo, handLo,
    UNIT, REP_SLOTS, FRQ_SLOTS, N_CLASSES, OPPONENTS, OPP_CARDS, HERO_POOL
};

if (parentPort) parentPort.on('message', (task) => {
    const rep = [], frq = [];
    for (let r = 0; r < REPLICATES; r++) {
        rep.push(new Float64Array(N_CLASSES * REP_SLOTS));
        frq.push(new Uint32Array(N_CLASSES * FRQ_SLOTS));
    }
    const rands = [];
    for (let r = 0; r < REPLICATES; r++) {
        rands.push(makeRng((task.seed ^ Math.imul(r + 1, 0x9E3779B9)) >>> 0));
    }
    const board = unrank5(task.startRank);

    let lowBoards = 0;
    for (let b = 0; b < task.count; b++) {
        prepareBoard(board, buf);
        const LOW = prepareLow(board);
        if (LOW) lowBoards++;
        for (let k = 0; k < CONFIGS; k++) {
            const r = k % REPLICATES;
            runConfig(rands[r], posArr[r], rep[r], frq[r], LOW);
        }
        if (b + 1 < task.count && !nextCombination(board)) break;
    }

    const transfer = [];
    for (let r = 0; r < REPLICATES; r++) { transfer.push(rep[r].buffer, frq[r].buffer); }
    parentPort.postMessage(
        { chunk: task.chunk, boards: task.count, lowBoards, rep, frq }, transfer);
});
