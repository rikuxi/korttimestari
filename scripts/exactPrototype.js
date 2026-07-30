// Vaiheen 0 prototyyppi eksaktille Omaha-preflop-equitylle (heads-up).
// Katso docs/eksakti-omaha-equity.md (ei repossa) kohta 5.
//
// Laskee YHDELLE kiinnitetylle pöydälle kaikkien C(47,4) = 178 365 käden
// eksaktin equityn yhtä satunnaista vastustajaa vastaan - ilman arvontaa.
//
// Käyttö:
//   node scripts/exactPrototype.js verify     - oikeellisuustarkistukset
//   node scripts/exactPrototype.js bench [n]  - ajoita n pöytää (oletus 5)
//
// Kortit ovat kokonaislukuja 0..51: arvo = c >> 2 (0 = kakkonen, 12 = ässä),
// maa = c & 3. Merkkijonoja ei käytetä sisäsilmukoissa lainkaan.

const REST = 47;                                                     // pöydän jälkeen jäljellä
const N_PAIRS = (REST * (REST - 1)) / 2;                             // 1 081
const N_TRIPLES = (REST * (REST - 1) * (REST - 2)) / 6;              // 16 215
const N_HANDS = (REST * (REST - 1) * (REST - 2) * (REST - 3)) / 24;  // 178 365
const N_OPP = (43 * 42 * 41 * 40) / 24;                              // 123 410

// Histogrammirivien sijoittelu: 1 globaali + 47 korttia + 1 081 paria
// + 16 215 kolmikkoa. Rivin leveys on R+1, jotta S[R] = 0.
const ROW_CARD = 1;
const ROW_PAIR = ROW_CARD + REST;        // 48
const ROW_TRIPLE = ROW_PAIR + N_PAIRS;   // 1 129
const N_ROWS = ROW_TRIPLE + N_TRIPLES;   // 17 344
// Eri käsienarvoja per pöytä on mitattu 76-136. Puskuri kasvatetaan
// automaattisesti jos jokin pöytä ylittää kapasiteetin.
const INITIAL_STRIDE = 160;

// Binomikertoimet colex-indeksointiin
const C2 = new Int32Array(REST + 1);
const C3 = new Int32Array(REST + 1);
const C4 = new Int32Array(REST + 1);
for (let n = 0; n <= REST; n++) {
    C2[n] = n >= 2 ? (n * (n - 1)) / 2 : 0;
    C3[n] = n >= 3 ? (n * (n - 1) * (n - 2)) / 6 : 0;
    C4[n] = n >= 4 ? (n * (n - 1) * (n - 2) * (n - 3)) / 24 : 0;
}

/** Parin (i<j) colex-indeksi, 0..1080 */
const pairIndex = (i, j) => C2[j] + i;
/** Neljän kortin (i<j<k<l) colex-indeksi, 0..178364 */
const handIndex = (i, j, k, l) => C4[l] + C3[k] + C2[j] + i;

// --- 5 kortin käsienarvioija -------------------------------------------

const P15 = [1, 15, 225, 3375, 50625, 759375];
const rankCount = new Int32Array(13);

/**
 * Arvioi 5 kortin käden. Suurempi arvo = parempi käsi.
 * Kategoria * 15^5 + tiebreakerit (ryhmät: määrä laskevasti, sitten arvo).
 * @param {number} a - kortti 0..51
 * @returns {number}
 */
function eval5(a, b, c, d, e) {
    const ra = a >> 2, rb = b >> 2, rc = c >> 2, rd = d >> 2, re = e >> 2;
    rankCount[ra]++; rankCount[rb]++; rankCount[rc]++; rankCount[rd]++; rankCount[re]++;

    const mask = (1 << ra) | (1 << rb) | (1 << rc) | (1 << rd) | (1 << re);
    const sa = a & 3;
    const flush = sa === (b & 3) && sa === (c & 3) && sa === (d & 3) && sa === (e & 3);

    // Suora vaatii viisi eri arvoa
    let straightHigh = -1;
    if (rankCount[ra] === 1 && rankCount[rb] === 1 && rankCount[rc] === 1 &&
        rankCount[rd] === 1 && rankCount[re] === 1) {
        for (let hi = 12; hi >= 4; hi--) {
            if (((mask >>> (hi - 4)) & 31) === 31) { straightHigh = hi; break; }
        }
        // Pyörä A2345: ässä (12) + 2,3,4,5 -> korkein kortti on 5 (indeksi 3)
        if (straightHigh < 0 && (mask & 0x100F) === 0x100F) straightHigh = 3;
    }

    // Ryhmittele: määrä laskevasti, sitten arvo laskevasti
    let g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0;
    let n0 = 0, n1 = 0, gi = 0;
    for (let cnt = 4; cnt >= 1; cnt--) {
        for (let r = 12; r >= 0; r--) {
            if (rankCount[r] === cnt) {
                if (gi === 0) { g0 = r; n0 = cnt; }
                else if (gi === 1) { g1 = r; n1 = cnt; }
                else if (gi === 2) g2 = r;
                else if (gi === 3) g3 = r;
                else g4 = r;
                gi++;
            }
        }
    }

    rankCount[ra] = 0; rankCount[rb] = 0; rankCount[rc] = 0; rankCount[rd] = 0; rankCount[re] = 0;

    let cat;
    if (straightHigh >= 0 && flush) cat = 8;
    else if (n0 === 4) cat = 7;
    else if (n0 === 3 && n1 === 2) cat = 6;
    else if (flush) cat = 5;
    else if (straightHigh >= 0) cat = 4;
    else if (n0 === 3) cat = 3;
    else if (n0 === 2 && n1 === 2) cat = 2;
    else if (n0 === 2) cat = 1;
    else cat = 0;

    if (cat === 8 || cat === 4) return cat * P15[5] + straightHigh * P15[4];
    return cat * P15[5] + g0 * P15[4] + g1 * P15[3] + g2 * P15[2] + g3 * P15[1] + g4;
}

// --- Pöytäkohtainen laskenta -------------------------------------------

const BOARD_TRIPLES = (() => {
    const t = [];
    for (let i = 0; i < 5; i++)
        for (let j = i + 1; j < 5; j++)
            for (let k = j + 1; k < 5; k++) t.push(i, j, k);
    return new Int32Array(t);
})();

/** Uudelleenkäytettävät puskurit - ei allokointia pöytien välillä. */
function createBuffers() {
    return {
        rest: new Int32Array(REST),
        pairVal: new Int32Array(N_PAIRS),
        pairRank: new Int32Array(N_PAIRS),
        distinct: new Int32Array(N_PAIRS),
        handVal: new Int32Array(N_HANDS),
        hist: new Int32Array(N_ROWS * INITIAL_STRIDE),
        stride: INITIAL_STRIDE,
        rowCard: new Int32Array(REST),
        rowPair: new Int32Array(N_PAIRS),
        rowTriple: new Int32Array(N_TRIPLES),
        winNum: new Float64Array(N_HANDS),   // vastustajakäsiä jotka hero voittaa
        tieNum: new Float64Array(N_HANDS)    // vastustajakäsiä joiden kanssa tasan
    };
}

/**
 * Pöydän esivalmistelu: vaiheet 1, 1b ja 2. Täyttää buf.pairRank ja
 * buf.handVal (kaikkien C(47,4) käden arvo pakattuna 0..R-1) sekä buf.rest.
 * Tätä tarvitsevat sekä eksakti heads-up-laskenta että moninpelihybridi.
 * @param {Int32Array|number[]} board - 5 korttia (0..51)
 * @param {object} buf - createBuffers()
 * @returns {{R: number, timings: object}}
 */
function prepareBoard(board, buf) {
    const t = {};
    const t0 = process.hrtime.bigint();

    const { rest, pairVal, pairRank, distinct, handVal } = buf;
    const b0 = board[0], b1 = board[1], b2 = board[2], b3 = board[3], b4 = board[4];

    let n = 0;
    for (let c = 0; c < 52; c++) {
        if (c !== b0 && c !== b1 && c !== b2 && c !== b3 && c !== b4) rest[n++] = c;
    }

    // --- Vaihe 1: 1 081 parin paras arvo (10 810 arviointia) ---
    for (let j = 1; j < REST; j++) {
        const cj = rest[j];
        const base = C2[j];
        for (let i = 0; i < j; i++) {
            const ci = rest[i];
            let best = 0;
            for (let b = 0; b < 30; b += 3) {
                const v = eval5(ci, cj, board[BOARD_TRIPLES[b]], board[BOARD_TRIPLES[b + 1]], board[BOARD_TRIPLES[b + 2]]);
                if (v > best) best = v;
            }
            pairVal[base + i] = best;
        }
    }
    const t1 = process.hrtime.bigint(); t.evals = Number(t1 - t0) / 1e6;

    // --- Vaihe 1b: pakkaa arvot 0..R-1 (korkeintaan 1 081 eri arvoa) ---
    distinct.set(pairVal);
    distinct.sort();
    let R = 0;
    for (let i = 0; i < N_PAIRS; i++) {
        if (i === 0 || distinct[i] !== distinct[i - 1]) distinct[R++] = distinct[i];
    }
    for (let p = 0; p < N_PAIRS; p++) {
        const v = pairVal[p];
        let lo = 0, hi = R - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (distinct[mid] < v) lo = mid + 1; else hi = mid;
        }
        pairRank[p] = lo;
    }
    buf.R = R;
    const t2 = process.hrtime.bigint(); t.compress = Number(t2 - t1) / 1e6;

    // --- Vaihe 2: kaikkien 178 365 käden arvo (6 hakua kukin) ---
    for (let l = 3; l < REST; l++) {
        const c4l = C4[l], c2l = C2[l];
        for (let k = 2; k < l; k++) {
            const c3k = C3[k], c2k = C2[k];
            const pkl = pairRank[c2l + k];
            for (let j = 1; j < k; j++) {
                const c2j = C2[j];
                const pjk = pairRank[c2k + j];
                const pjl = pairRank[c2l + j];
                let m1 = pkl > pjk ? pkl : pjk;
                if (pjl > m1) m1 = pjl;
                const base = c4l + c3k + c2j;
                for (let i = 0; i < j; i++) {
                    const pij = pairRank[c2j + i];
                    const pik = pairRank[c2k + i];
                    const pil = pairRank[c2l + i];
                    let m = m1;
                    if (pij > m) m = pij;
                    if (pik > m) m = pik;
                    if (pil > m) m = pil;
                    handVal[base + i] = m;
                }
            }
        }
    }
    const t3 = process.hrtime.bigint(); t.handVals = Number(t3 - t2) / 1e6;
    t.total = Number(t3 - t0) / 1e6;
    return { R, timings: t };
}

/**
 * Laskee kaikkien 178 365 käden eksaktin equityn annetulla pöydällä yhtä
 * satunnaista vastustajaa vastaan. Tulos kirjoitetaan buf.winNum- ja
 * buf.tieNum-taulukoihin: equity = (winNum + tieNum/2) / 123410.
 * @param {Int32Array|number[]} board - 5 korttia (0..51)
 * @param {object} buf - createBuffers()
 * @returns {{R: number, timings: object}}
 */
function solveBoard(board, buf) {
    const prep = prepareBoard(board, buf);
    const R = prep.R;
    const t = prep.timings;
    const t3 = process.hrtime.bigint();

    const { handVal, rowCard, rowPair, rowTriple, winNum, tieNum } = buf;

    const STRIDE = R + 1;
    if (STRIDE > buf.stride) {
        // Harvinainen: jokin pöytä tuottaa odotettua enemmän eri arvoja
        buf.stride = STRIDE;
        buf.hist = new Int32Array(N_ROWS * STRIDE);
    }
    const hist = buf.hist;
    const HSTRIDE = buf.stride;
    for (let i = 0; i < REST; i++) rowCard[i] = (ROW_CARD + i) * HSTRIDE;
    for (let p = 0; p < N_PAIRS; p++) rowPair[p] = (ROW_PAIR + p) * HSTRIDE;
    for (let q = 0; q < N_TRIPLES; q++) rowTriple[q] = (ROW_TRIPLE + q) * HSTRIDE;

    // --- Vaihe 3a: histogrammit + suffiksisummat ---
    hist.fill(0, 0, N_ROWS * HSTRIDE);
    for (let l = 3; l < REST; l++) {
        const c4l = C4[l], c3l = C3[l], c2l = C2[l], rl = rowCard[l];
        for (let k = 2; k < l; k++) {
            const c3k = C3[k], c2k = C2[k], rk = rowCard[k];
            const rkl = rowPair[c2l + k];
            const b3ikl = c3l + c2k;
            for (let j = 1; j < k; j++) {
                const c2j = C2[j], rj = rowCard[j];
                const rjk = rowPair[c2k + j], rjl = rowPair[c2l + j];
                const rjkl = rowTriple[c3l + c2k + j];
                const b3ijk = c3k + c2j, b3ijl = c3l + c2j;
                const base = c4l + c3k + c2j;
                for (let i = 0; i < j; i++) {
                    const v = handVal[base + i];
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
                }
            }
        }
    }
    // S[v] = kuinka moni käsi on arvoltaan >= v
    for (let row = 0; row < N_ROWS; row++) {
        const off = row * HSTRIDE;
        for (let v = R - 1; v >= 0; v--) hist[off + v] += hist[off + v + 1];
    }
    const t4 = process.hrtime.bigint(); t.hist = Number(t4 - t3) / 1e6;

    // --- Vaihe 3b: inkluusio-ekskluusio per käsi ---
    for (let l = 3; l < REST; l++) {
        const c4l = C4[l], c3l = C3[l], c2l = C2[l], rl = rowCard[l];
        for (let k = 2; k < l; k++) {
            const c3k = C3[k], c2k = C2[k], rk = rowCard[k];
            const rkl = rowPair[c2l + k];
            const b3ikl = c3l + c2k;
            for (let j = 1; j < k; j++) {
                const c2j = C2[j], rj = rowCard[j];
                const rjk = rowPair[c2k + j], rjl = rowPair[c2l + j];
                const rjkl = rowTriple[c3l + c2k + j];
                const b3ijk = c3k + c2j, b3ijl = c3l + c2j;
                const base = c4l + c3k + c2j;
                for (let i = 0; i < j; i++) {
                    const idx = base + i;
                    const v = handVal[idx];
                    const w = v + 1;
                    const ri = rowCard[i];
                    const rij = rowPair[c2j + i], rik = rowPair[c2k + i], ril = rowPair[c2l + i];
                    const rijk = rowTriple[b3ijk + i], rijl = rowTriple[b3ijl + i], rikl = rowTriple[b3ikl + i];

                    // >= v : nelikkötermi (heron oma käsi) on mukana -> +1
                    const ge = hist[v]
                        - (hist[ri + v] + hist[rj + v] + hist[rk + v] + hist[rl + v])
                        + (hist[rij + v] + hist[rik + v] + hist[ril + v] + hist[rjk + v] + hist[rjl + v] + hist[rkl + v])
                        - (hist[rijk + v] + hist[rijl + v] + hist[rikl + v] + hist[rjkl + v]) + 1;
                    // > v : heron oma käsi ei ole mukana
                    const gt = hist[w]
                        - (hist[ri + w] + hist[rj + w] + hist[rk + w] + hist[rl + w])
                        + (hist[rij + w] + hist[rik + w] + hist[ril + w] + hist[rjk + w] + hist[rjl + w] + hist[rkl + w])
                        - (hist[rijk + w] + hist[rijl + w] + hist[rikl + w] + hist[rjkl + w]);

                    winNum[idx] = N_OPP - ge;
                    tieNum[idx] = ge - gt;
                }
            }
        }
    }
    const t5 = process.hrtime.bigint();
    t.incexc = Number(t5 - t4) / 1e6;
    t.total = t.evals + t.compress + t.handVals + t.hist + t.incexc;

    return { R, timings: t };
}

module.exports = {
    eval5, prepareBoard, solveBoard, createBuffers,
    pairIndex, handIndex, N_HANDS, N_PAIRS, N_TRIPLES, N_OPP, REST, C2, C3, C4
};

if (require.main === module) {
    require('./exactPrototypeMain')(process.argv.slice(2));
}
