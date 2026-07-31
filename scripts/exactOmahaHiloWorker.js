// Eksaktin Omaha Hi/Lo -equityn (heads-up, 8-or-better) pöytäratkaisija
// ja työläinen.
//
// Rakentuu hi-puolen putken (scripts/exactPrototype.js) päälle: prepareBoard
// antaa kaikkien C(47,4) käden hi-arvot, ja tämä moduuli lisää low-puolen
// sekä jaetun potin inkluusio-ekskluusion. Menetelmä:
//
//   Heron osuus yhtä vastustajaa vastaan = 1/2 * hiShare + 1/2 * loShare*,
//   missä loShare* on low-vertailu jos jommallakummalla on kelvollinen low,
//   ja muuten hiShare (koko potti menee hi:lle). Summa kaikkien vastustajien
//   yli hajoaa kolmeen histogrammiperheeseen:
//     1) hi-arvot kaikista käsistä          (sama kuin hi-putkessa)
//     2) hi-arvot vain low-käsistä          (tarvitaan kun herolla ei ole low'ta)
//     3) lo-arvot low-käsistä               (tarvitaan kun herolla on low)
//   Jokainen perhe käyttää samaa inkluusio-ekskluusiota heron neljän kortin
//   yli kuin hi-putki. Osuudet lasketaan neljännespotin yksiköissä (kokonais-
//   lukuja), ja jokaisen pöydän summa tarkistetaan: potti jakautuu tasan.
//
// Low-käsi koodataan kuten public/js/engine.js:ssä: 8-bittinen arvomaski
// (A = bitti 0, ..., 8 = bitti 7), pienempi maski = parempi low. Pöydän
// sisällä maskit pakataan "hyvyysasteiksi" 0..RL-1 (suurempi = parempi),
// jolloin histogrammilogiikka on identtinen hi-puolen kanssa.
//
// Katso scripts/exactOmahaHilo.js ja docs/omaha-hilo-suunnitelma.md (ei repossa).

const {
    prepareBoard, createBuffers, REST, N_HANDS, N_PAIRS, N_TRIPLES, N_OPP, C2, C3, C4
} = require('./exactPrototype');

// Histogrammirivien sijoittelu - sama kuin exactPrototype.js:ssä
const ROW_CARD = 1;
const ROW_PAIR = ROW_CARD + REST;
const ROW_TRIPLE = ROW_PAIR + N_PAIRS;
const N_ROWS = ROW_TRIPLE + N_TRIPLES;

// Low-maskeja on korkeintaan C(8,5) = 56 erilaista per pöytä (+1 suffiksi-
// summien nollarivi). 64 antaa varaa; ylitys on koodivirhe ja kaataa ajon.
const LSTRIDE = 64;

const NO_LOW = 0x100;

// Kortin low-bitti, tai 0 jos kortti ei kelpaa low'hun (9..K).
// Sama koodaus kuin public/js/engine.js:ssä.
const LOW_BIT = (() => {
    const t = new Int32Array(52);
    for (let c = 0; c < 52; c++) {
        const r = c >> 2;                       // 0 = kakkonen .. 12 = ässä
        if (r === 12) t[c] = 1;                 // ässä on matalin
        else if (r <= 6) t[c] = 1 << (r + 1);   // 2..8
    }
    return t;
})();

const POP8 = (() => {
    const t = new Int32Array(256);
    for (let i = 1; i < 256; i++) t[i] = t[i >> 1] + (i & 1);
    return t;
})();

const BOARD_TRIPLES = (() => {
    const t = [];
    for (let i = 0; i < 5; i++)
        for (let j = i + 1; j < 5; j++)
            for (let k = j + 1; k < 5; k++) t.push(i, j, k);
    return new Int32Array(t);
})();

/** Hi/Lo-laskennan puskurit: hi-putken puskurit + low-puolen lisäykset */
function createHiloBuffers() {
    const buf = createBuffers();
    buf.pairLoG = new Int32Array(N_PAIRS);       // parin low-hyvyys tai -1
    buf.handLoG = new Int32Array(N_HANDS);       // käden low-hyvyys tai -1
    buf.loMasks = new Int32Array(64);            // pöydän eri low-maskit
    buf.histHL = new Int32Array(N_ROWS * buf.stride);  // hi-arvot low-käsistä
    buf.histL = new Int32Array(N_ROWS * LSTRIDE);      // low-hyvyydet
    buf.hi4 = new Float64Array(N_HANDS);         // hi-osuus, 1/4-potin yksiköissä
    buf.lo4 = new Float64Array(N_HANDS);         // low-osuus, 1/4-potin yksiköissä
    return buf;
}

// Pöydän summainvariantti: jokainen järjestetty (hero, vastustaja) -pari
// jakaa tasan yhden potin, joten neljännesosuuksien summa pöytää kohti on
// tasan 2 * N_HANDS * N_OPP.
const BOARD_SUM = 2 * N_HANDS * N_OPP;

/**
 * Ratkaisee yhden pöydän: kaikkien C(47,4) käden eksakti hi/lo-osuus yhtä
 * satunnaista vastustajaa vastaan. Tulokset buf.hi4/buf.lo4 -taulukoihin
 * neljännespotin yksiköissä: equity = (hi4 + lo4) / (4 * N_OPP).
 * @param {Int32Array|number[]} board - 5 korttia (0..51)
 * @param {object} buf - createHiloBuffers()
 */
function solveBoardHiLo(board, buf) {
    prepareBoard(board, buf);
    const R = buf.R;
    const { rest, pairRank, handVal, pairLoG, handLoG, loMasks, hi4, lo4 } = buf;

    // --- Pöydän low-kolmikot: 10 kolmikkoa, kelvollisissa 3 eri low-arvoa ---
    const bt = [];
    for (let b = 0; b < 30; b += 3) {
        const m = LOW_BIT[board[BOARD_TRIPLES[b]]]
            | LOW_BIT[board[BOARD_TRIPLES[b + 1]]]
            | LOW_BIT[board[BOARD_TRIPLES[b + 2]]];
        if (POP8[m] === 3) bt.push(m);
    }
    const lowPossible = bt.length > 0;
    const NBT = bt.length;

    // --- Histogrammipuskurit (stride voi kasvaa harvinaisella pöydällä) ---
    const STRIDE = R + 1;
    if (STRIDE > buf.stride) {
        buf.stride = STRIDE;
        buf.hist = new Int32Array(N_ROWS * STRIDE);
        buf.histHL = new Int32Array(N_ROWS * STRIDE);
    }
    const HSTRIDE = buf.stride;
    const hist = buf.hist, histHL = buf.histHL, histL = buf.histL;
    const { rowCard, rowPair, rowTriple } = buf;
    for (let i = 0; i < REST; i++) rowCard[i] = (ROW_CARD + i) * HSTRIDE;
    for (let p = 0; p < N_PAIRS; p++) rowPair[p] = (ROW_PAIR + p) * HSTRIDE;
    for (let q = 0; q < N_TRIPLES; q++) rowTriple[q] = (ROW_TRIPLE + q) * HSTRIDE;

    // Low-histogrammin rivit ovat kiinteällä LSTRIDE-leveydellä
    const lRowCard = new Int32Array(REST);
    const lRowPair = buf.lRowPair || (buf.lRowPair = new Int32Array(N_PAIRS));
    const lRowTriple = buf.lRowTriple || (buf.lRowTriple = new Int32Array(N_TRIPLES));
    for (let i = 0; i < REST; i++) lRowCard[i] = (ROW_CARD + i) * LSTRIDE;
    for (let p = 0; p < N_PAIRS; p++) lRowPair[p] = (ROW_PAIR + p) * LSTRIDE;
    for (let q = 0; q < N_TRIPLES; q++) lRowTriple[q] = (ROW_TRIPLE + q) * LSTRIDE;

    let RL = 0;

    if (lowPossible) {
        // --- Vaihe L1: 1 081 parin paras low-maski ---
        for (let j = 1; j < REST; j++) {
            const bj = LOW_BIT[rest[j]];
            const base = C2[j];
            for (let i = 0; i < j; i++) {
                const pm = LOW_BIT[rest[i]] | bj;
                let best = NO_LOW;
                if (POP8[pm] === 2) {
                    for (let b = 0; b < NBT; b++) {
                        const tm = bt[b];
                        // Erillisyys: parin ja kolmikon arvot eivät saa leikata
                        if ((pm & tm) === 0) {
                            const m = pm | tm;
                            if (m < best) best = m;
                        }
                    }
                }
                pairLoG[base + i] = best;   // väliaikaisesti maski; pakataan alla
            }
        }

        // --- Vaihe L1b: pakkaa maskit hyvyysasteiksi 0..RL-1 ---
        // Pienin maski = paras low = suurin hyvyys, jolloin histogrammien
        // ">= raja" -logiikka on identtinen hi-puolen kanssa.
        const seen = new Set();
        for (let p = 0; p < N_PAIRS; p++) {
            if (pairLoG[p] !== NO_LOW) seen.add(pairLoG[p]);
        }
        const sorted = [...seen].sort((a, b) => a - b);
        RL = sorted.length;
        if (RL + 1 > LSTRIDE) {
            throw new Error(`LSTRIDE ${LSTRIDE} ei riitä: pöydällä ${RL} eri low-maskia`);
        }
        const goodOf = new Map();
        for (let t = 0; t < RL; t++) goodOf.set(sorted[t], RL - 1 - t);
        for (let t = 0; t < RL; t++) loMasks[RL - 1 - t] = sorted[t];  // hyvyys -> maski
        for (let p = 0; p < N_PAIRS; p++) {
            pairLoG[p] = pairLoG[p] === NO_LOW ? -1 : goodOf.get(pairLoG[p]);
        }

        // --- Vaihe L2: kaikkien käsien low-hyvyys (max kuudesta parista) ---
        // Sama silmukkarakenne kuin hi-puolen vaiheessa 2.
        for (let l = 3; l < REST; l++) {
            const c4l = C4[l], c2l = C2[l];
            for (let k = 2; k < l; k++) {
                const c3k = C3[k], c2k = C2[k];
                const gkl = pairLoG[c2l + k];
                for (let j = 1; j < k; j++) {
                    const c2j = C2[j];
                    const gjk = pairLoG[c2k + j];
                    const gjl = pairLoG[c2l + j];
                    let m1 = gkl > gjk ? gkl : gjk;
                    if (gjl > m1) m1 = gjl;
                    const base = c4l + c3k + c2j;
                    for (let i = 0; i < j; i++) {
                        const gij = pairLoG[c2j + i];
                        const gik = pairLoG[c2k + i];
                        const gil = pairLoG[c2l + i];
                        let m = m1;
                        if (gij > m) m = gij;
                        if (gik > m) m = gik;
                        if (gil > m) m = gil;
                        handLoG[base + i] = m;
                    }
                }
            }
        }
    }

    // --- Vaihe 3a: histogrammit + suffiksisummat ---
    hist.fill(0, 0, N_ROWS * HSTRIDE);
    if (lowPossible) {
        histHL.fill(0, 0, N_ROWS * HSTRIDE);
        histL.fill(0, 0, N_ROWS * LSTRIDE);
    }
    for (let l = 3; l < REST; l++) {
        const c4l = C4[l], c3l = C3[l], c2l = C2[l], rl = rowCard[l], sl = lRowCard[l];
        for (let k = 2; k < l; k++) {
            const c3k = C3[k], c2k = C2[k], rk = rowCard[k], sk = lRowCard[k];
            const rkl = rowPair[c2l + k], skl = lRowPair[c2l + k];
            const b3ikl = c3l + c2k;
            for (let j = 1; j < k; j++) {
                const c2j = C2[j], rj = rowCard[j], sj = lRowCard[j];
                const rjk = rowPair[c2k + j], rjl = rowPair[c2l + j];
                const sjk = lRowPair[c2k + j], sjl = lRowPair[c2l + j];
                const rjkl = rowTriple[c3l + c2k + j], sjkl = lRowTriple[c3l + c2k + j];
                const b3ijk = c3k + c2j, b3ijl = c3l + c2j;
                const base = c4l + c3k + c2j;
                for (let i = 0; i < j; i++) {
                    const idx = base + i;
                    const v = handVal[idx];
                    hist[v]++;
                    hist[rowCard[i] + v]++; hist[rj + v]++; hist[rk + v]++; hist[rl + v]++;
                    hist[rowPair[c2j + i] + v]++;
                    hist[rowPair[c2k + i] + v]++;
                    hist[rowPair[c2l + i] + v]++;
                    hist[rjk + v]++; hist[rjl + v]++; hist[rkl + v]++;
                    hist[rowTriple[b3ijk + i] + v]++;
                    hist[rowTriple[b3ijl + i] + v]++;
                    hist[rowTriple[b3ikl + i] + v]++;
                    hist[rjkl + v]++;

                    if (lowPossible) {
                        const g = handLoG[idx];
                        if (g >= 0) {
                            // Sama käsi low-käsien hi-histogrammiin...
                            histHL[v]++;
                            histHL[rowCard[i] + v]++; histHL[rj + v]++; histHL[rk + v]++; histHL[rl + v]++;
                            histHL[rowPair[c2j + i] + v]++;
                            histHL[rowPair[c2k + i] + v]++;
                            histHL[rowPair[c2l + i] + v]++;
                            histHL[rjk + v]++; histHL[rjl + v]++; histHL[rkl + v]++;
                            histHL[rowTriple[b3ijk + i] + v]++;
                            histHL[rowTriple[b3ijl + i] + v]++;
                            histHL[rowTriple[b3ikl + i] + v]++;
                            histHL[rjkl + v]++;
                            // ...ja low-hyvyyksien histogrammiin
                            histL[g]++;
                            histL[lRowCard[i] + g]++; histL[sj + g]++; histL[sk + g]++; histL[sl + g]++;
                            histL[lRowPair[c2j + i] + g]++;
                            histL[lRowPair[c2k + i] + g]++;
                            histL[lRowPair[c2l + i] + g]++;
                            histL[sjk + g]++; histL[sjl + g]++; histL[skl + g]++;
                            histL[lRowTriple[b3ijk + i] + g]++;
                            histL[lRowTriple[b3ijl + i] + g]++;
                            histL[lRowTriple[b3ikl + i] + g]++;
                            histL[sjkl + g]++;
                        }
                    }
                }
            }
        }
    }
    // S[v] = kuinka moni käsi on vähintään arvoa v
    for (let row = 0; row < N_ROWS; row++) {
        const off = row * HSTRIDE;
        for (let v = R - 1; v >= 0; v--) hist[off + v] += hist[off + v + 1];
    }
    if (lowPossible) {
        for (let row = 0; row < N_ROWS; row++) {
            const off = row * HSTRIDE;
            for (let v = R - 1; v >= 0; v--) histHL[off + v] += histHL[off + v + 1];
            const loff = row * LSTRIDE;
            for (let g = RL - 1; g >= 0; g--) histL[loff + g] += histL[loff + g + 1];
        }
    }

    // --- Vaihe 3b: inkluusio-ekskluusio per käsi ---
    let boardSum = 0;
    for (let l = 3; l < REST; l++) {
        const c4l = C4[l], c3l = C3[l], c2l = C2[l], rl = rowCard[l], sl = lRowCard[l];
        for (let k = 2; k < l; k++) {
            const c3k = C3[k], c2k = C2[k], rk = rowCard[k], sk = lRowCard[k];
            const rkl = rowPair[c2l + k], skl = lRowPair[c2l + k];
            const b3ikl = c3l + c2k;
            for (let j = 1; j < k; j++) {
                const c2j = C2[j], rj = rowCard[j], sj = lRowCard[j];
                const rjk = rowPair[c2k + j], rjl = rowPair[c2l + j];
                const sjk = lRowPair[c2k + j], sjl = lRowPair[c2l + j];
                const rjkl = rowTriple[c3l + c2k + j], sjkl = lRowTriple[c3l + c2k + j];
                const b3ijk = c3k + c2j, b3ijl = c3l + c2j;
                const base = c4l + c3k + c2j;
                for (let i = 0; i < j; i++) {
                    const idx = base + i;
                    const v = handVal[idx];
                    const w = v + 1;
                    const ri = rowCard[i];
                    const rij = rowPair[c2j + i], rik = rowPair[c2k + i], ril = rowPair[c2l + i];
                    const rijk = rowTriple[b3ijk + i], rijl = rowTriple[b3ijl + i], rikl = rowTriple[b3ikl + i];

                    // Hi kaikkia vastustajia vastaan (sama kuin hi-putkessa):
                    // ge = vastustajia joiden hi >= heron, gt = aidosti parempia
                    const ge = hist[v]
                        - (hist[ri + v] + hist[rj + v] + hist[rk + v] + hist[rl + v])
                        + (hist[rij + v] + hist[rik + v] + hist[ril + v] + hist[rjk + v] + hist[rjl + v] + hist[rkl + v])
                        - (hist[rijk + v] + hist[rijl + v] + hist[rikl + v] + hist[rjkl + v]) + 1;
                    const gt = hist[w]
                        - (hist[ri + w] + hist[rj + w] + hist[rk + w] + hist[rl + w])
                        + (hist[rij + w] + hist[rik + w] + hist[ril + w] + hist[rjk + w] + hist[rjl + w] + hist[rkl + w])
                        - (hist[rijk + w] + hist[rijl + w] + hist[rikl + w] + hist[rjkl + w]);
                    const a1 = N_OPP - ge;     // hero voittaa hi:n
                    const t1 = ge - gt;        // hi tasan

                    if (!lowPossible) {
                        // Pöydällä ei voi olla low'ta: hi vie koko potin
                        const s = 4 * a1 + 2 * t1;
                        hi4[idx] = s;
                        lo4[idx] = 0;
                        boardSum += s;
                        continue;
                    }

                    const si = lRowCard[i];
                    const sij = lRowPair[c2j + i], sik = lRowPair[c2k + i], sil = lRowPair[c2l + i];
                    const sijk = lRowTriple[b3ijk + i], sijl = lRowTriple[b3ijl + i], sikl = lRowTriple[b3ikl + i];
                    const g = handLoG[idx];

                    // Montako vastustajakättä tekee low'n: suffiksisumma
                    // hyvyydestä 0 ylöspäin = kaikki low-kädet. Nelikkötermi
                    // on heron oma käsi jos sillä on low.
                    const aOpp = histL[0]
                        - (histL[si] + histL[sj] + histL[sk] + histL[sl])
                        + (histL[sij] + histL[sik] + histL[sil] + histL[sjk] + histL[sjl] + histL[skl])
                        - (histL[sijk] + histL[sijl] + histL[sikl] + histL[sjkl])
                        + (g >= 0 ? 1 : 0);

                    let s, h4, l4;
                    if (g >= 0) {
                        // Herolla on low: hi-puolikas + low-vertailu low-käsiä
                        // vastaan + koko low-puolikas no-low-vastustajilta
                        const geL = histL[g]
                            - (histL[si + g] + histL[sj + g] + histL[sk + g] + histL[sl + g])
                            + (histL[sij + g] + histL[sik + g] + histL[sil + g] + histL[sjk + g] + histL[sjl + g] + histL[skl + g])
                            - (histL[sijk + g] + histL[sijl + g] + histL[sikl + g] + histL[sjkl + g]) + 1;
                        const gL = g + 1;
                        const gtL = gL > RL - 1
                            ? 0
                            : histL[gL]
                            - (histL[si + gL] + histL[sj + gL] + histL[sk + gL] + histL[sl + gL])
                            + (histL[sij + gL] + histL[sik + gL] + histL[sil + gL] + histL[sjk + gL] + histL[sjl + gL] + histL[skl + gL])
                            - (histL[sijk + gL] + histL[sijl + gL] + histL[sikl + gL] + histL[sjkl + gL]);
                        const a3 = aOpp - geL;   // hero voittaa low'n
                        const t3 = geL - gtL;    // low tasan
                        h4 = 2 * a1 + t1;
                        l4 = 2 * a3 + t3 + 2 * (N_OPP - aOpp);
                    } else {
                        // Herolla ei ole low'ta: hi-puolikas kaikkia vastaan +
                        // koko potti hi:llä niitä vastaan joilla ei myöskään
                        // ole low'ta (= kaikki miinus low-kädet)
                        const geHL = histHL[v]
                            - (histHL[ri + v] + histHL[rj + v] + histHL[rk + v] + histHL[rl + v])
                            + (histHL[rij + v] + histHL[rik + v] + histHL[ril + v] + histHL[rjk + v] + histHL[rjl + v] + histHL[rkl + v])
                            - (histHL[rijk + v] + histHL[rijl + v] + histHL[rikl + v] + histHL[rjkl + v]);
                        const gtHL = histHL[w]
                            - (histHL[ri + w] + histHL[rj + w] + histHL[rk + w] + histHL[rl + w])
                            + (histHL[rij + w] + histHL[rik + w] + histHL[ril + w] + histHL[rjk + w] + histHL[rjl + w] + histHL[rkl + w])
                            - (histHL[rijk + w] + histHL[rijl + w] + histHL[rikl + w] + histHL[rjkl + w]);
                        const a2 = aOpp - geHL;  // low-kädet jotka hero voittaa hi:ssä
                        const t2 = geHL - gtHL;  // low-kädet joiden kanssa hi tasan
                        h4 = 4 * a1 + 2 * t1 - 2 * a2 - t2;
                        l4 = 0;
                    }
                    s = h4 + l4;
                    hi4[idx] = h4;
                    lo4[idx] = l4;
                    boardSum += s;
                }
            }
        }
    }

    // Summainvariantti: potti jakautuu tasan jokaisessa parissa. Tämä
    // laukeaa käytännössä mistä tahansa laskentavirheestä.
    if (boardSum !== BOARD_SUM) {
        throw new Error(`Pöydän summainvariantti rikki: ${boardSum} != ${BOARD_SUM} ` +
            `(pöytä ${Array.from(board).join(',')})`);
    }

    return { R, RL, lowPossible };
}

module.exports = {
    solveBoardHiLo, createHiloBuffers, LOW_BIT, POP8, NO_LOW, LSTRIDE,
    N_HANDS, N_OPP, REST, C2, C3, C4
};

// --- Työläinen (sama protokolla kuin exactOmahaWorker.js) ---------------

const { parentPort, workerData } = require('worker_threads');
if (parentPort) {
    const N_CLASSES = 16432;

    const G1 = new Float64Array(53), G2 = new Float64Array(53);
    const G3 = new Float64Array(53), G4 = new Float64Array(53), G5 = new Float64Array(53);
    for (let n = 0; n <= 52; n++) {
        G1[n] = n;
        G2[n] = n >= 2 ? (n * (n - 1)) / 2 : 0;
        G3[n] = n >= 3 ? (n * (n - 1) * (n - 2)) / 6 : 0;
        G4[n] = n >= 4 ? (n * (n - 1) * (n - 2) * (n - 3)) / 24 : 0;
        G5[n] = n >= 5 ? (n * (n - 1) * (n - 2) * (n - 3) * (n - 4)) / 120 : 0;
    }

    const unrank5 = (r) => {
        const c = new Int32Array(5);
        for (let pos = 4; pos >= 0; pos--) {
            const tbl = [G1, G2, G3, G4, G5][pos];
            let n = pos;
            while (n + 1 <= 52 && tbl[n + 1] <= r) n++;
            c[pos] = n;
            r -= tbl[n];
        }
        return c;
    };

    const nextCombination = (c) => {
        for (let i = 0; i < 5; i++) {
            const limit = i === 4 ? 52 : c[i + 1];
            if (c[i] + 1 < limit) {
                c[i]++;
                for (let j = 0; j < i; j++) c[j] = j;
                return true;
            }
        }
        return false;
    };

    const classOf = workerData.classOf;
    const buf = createHiloBuffers();

    function accumulate(accHi, accLo) {
        const { rest, hi4, lo4 } = buf;
        for (let l = 3; l < REST; l++) {
            const c4l = C4[l], g4 = G4[rest[l]];
            for (let k = 2; k < l; k++) {
                const c3k = C3[k], g3 = g4 + G3[rest[k]];
                for (let j = 1; j < k; j++) {
                    const c2j = C2[j], g2 = g3 + G2[rest[j]];
                    const base = c4l + c3k + c2j;
                    for (let i = 0; i < j; i++) {
                        const cls = classOf[g2 + rest[i]];
                        accHi[cls] += hi4[base + i];
                        accLo[cls] += lo4[base + i];
                    }
                }
            }
        }
    }

    parentPort.on('message', (task) => {
        const accHi = new Float64Array(N_CLASSES);
        const accLo = new Float64Array(N_CLASSES);
        const board = unrank5(task.startRank);
        for (let b = 0; b < task.count; b++) {
            solveBoardHiLo(board, buf);
            accumulate(accHi, accLo);
            if (b + 1 < task.count && !nextCombination(board)) break;
        }
        parentPort.postMessage(
            { chunk: task.chunk, boards: task.count, hi: accHi, lo: accLo },
            [accHi.buffer, accLo.buffer]
        );
    });
}
