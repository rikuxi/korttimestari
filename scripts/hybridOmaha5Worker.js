// 5 kortin Omahan moninpelilaskennan työläinen.
//
// Sama rakenne kuin hybridOmahaWorker.js: EKSAKTI pöytien yli, Monte Carlo
// vain vastustajien korttien poiston yli.
//
// Olennainen ero nelikorttiseen: heron käsien arvoja EI esilasketa pöytää
// kohti. Nelikorttisessa taulukoidaan kaikki C(47,4) = 178 365 kättä, mutta
// viisikorttisessa niitä olisi C(47,5) = 1 533 939 - kymmenkertainen määrä
// jokaista pöytää kohti. Sen sijaan heron arvo lasketaan lennossa parien
// arvoista: max kymmenestä hole-parista. Silmukka on järjestetty niin että
// uloimmat tasot laskevat osamaksimin kerran ja sisin taso tekee vain neljä
// hakua.

const { parentPort, workerData } = require('worker_threads');
const { eval5 } = require('../public/js/engine');

const REST = 47;
const N_PAIRS = (REST * (REST - 1)) / 2;   // 1 081

// Binomikertoimet: paikkaindeksointi (0..46) ja korttien globaali colex (0..51);
// pöytien iteraattori, xoshiro128** ja pöydän kolmikot (batchCommon.js)
const { BINOM, unrank5, nextCombination, makeRng, BOARD_TRIPLES } = require('./batchCommon');
const { G1: C1, G2: C2, G3: C3, G4: C4, G5: C5 } = BINOM;

const classOf = new Uint32Array(workerData.classOfBuffer);   // C(52,5) -> luokka
const OPPONENTS = workerData.players - 1;
const OPP_CARDS = OPPONENTS * 5;
const HERO_POOL = REST - OPP_CARDS;
const CONFIGS = workerData.configs;
const REPLICATES = workerData.replicates;
const N_CLASSES = workerData.classes;

const rest = new Int32Array(REST);
const pairVal = new Int32Array(N_PAIRS);
const pairRank = new Int32Array(N_PAIRS);
const distinct = new Int32Array(N_PAIRS);
const posArr = Array.from({ length: REPLICATES }, () => new Int32Array(REST));
const heroPos = new Int32Array(HERO_POOL);
// Esilasketut indeksipalat heron paikoille
const pC2 = new Int32Array(HERO_POOL);
const gC5 = new Float64Array(HERO_POOL), gC4 = new Float64Array(HERO_POOL);
const gC3 = new Float64Array(HERO_POOL), gC2 = new Float64Array(HERO_POOL);
const gC1 = new Int32Array(HERO_POOL);

/** Pöydän kaikkien 1 081 parin paras arvo, pakattuna 0..R-1 */
function buildPairTable(board) {
    const b0 = board[0], b1 = board[1], b2 = board[2], b3 = board[3], b4 = board[4];
    let n = 0;
    for (let c = 0; c < 52; c++) {
        if (c !== b0 && c !== b1 && c !== b2 && c !== b3 && c !== b4) rest[n++] = c;
    }
    for (let j = 1; j < REST; j++) {
        const cj = rest[j];
        const base = (j * (j - 1)) / 2;
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
}

/**
 * Viiden paikan käden arvo: max kymmenestä hole-parista.
 * Paikat lajitellaan ensin, koska pariparin indeksi C2[suurempi] + pienempi
 * edellyttää järjestystä - lajittelematta haut osuvat vieraisiin pareihin.
 * Knuthin 9 vertailijan optimaalinen lajitteluverkko viidelle alkiolle.
 */
function handValue(a0, a1, a2, a3, a4) {
    let t;
    if (a0 > a1) { t = a0; a0 = a1; a1 = t; }
    if (a3 > a4) { t = a3; a3 = a4; a4 = t; }
    if (a2 > a4) { t = a2; a2 = a4; a4 = t; }
    if (a2 > a3) { t = a2; a2 = a3; a3 = t; }
    if (a1 > a4) { t = a1; a1 = a4; a4 = t; }
    if (a0 > a3) { t = a0; a0 = a3; a3 = t; }
    if (a0 > a2) { t = a0; a0 = a2; a2 = t; }
    if (a1 > a3) { t = a1; a1 = a3; a3 = t; }
    if (a1 > a2) { t = a1; a1 = a2; a2 = t; }
    const p0 = a0, p1 = a1, p2 = a2, p3 = a3, p4 = a4;
    let m = pairRank[C2[p1] + p0];
    let v = pairRank[C2[p2] + p0]; if (v > m) m = v;
    v = pairRank[C2[p2] + p1]; if (v > m) m = v;
    v = pairRank[C2[p3] + p0]; if (v > m) m = v;
    v = pairRank[C2[p3] + p1]; if (v > m) m = v;
    v = pairRank[C2[p3] + p2]; if (v > m) m = v;
    v = pairRank[C2[p4] + p0]; if (v > m) m = v;
    v = pairRank[C2[p4] + p1]; if (v > m) m = v;
    v = pairRank[C2[p4] + p2]; if (v > m) m = v;
    v = pairRank[C2[p4] + p3]; if (v > m) m = v;
    return m;
}

function runConfig(rand, pos, shareAcc, cntAcc) {
    for (let i = 0; i < REST; i++) pos[i] = i;
    for (let i = 0; i < OPP_CARDS; i++) {
        const j = i + (rand() % (REST - i));
        const t = pos[i]; pos[i] = pos[j]; pos[j] = t;
    }

    let maxV = -1, tied = 0;
    for (let o = 0; o < OPPONENTS; o++) {
        const b = o * 5;
        const v = handValue(pos[b], pos[b + 1], pos[b + 2], pos[b + 3], pos[b + 4]);
        if (v > maxV) { maxV = v; tied = 1; }
        else if (v === maxV) tied++;
    }
    const tieShare = 1 / (tied + 1);

    for (let i = OPP_CARDS; i < REST; i++) heroPos[i - OPP_CARDS] = pos[i];
    heroPos.sort();
    for (let x = 0; x < HERO_POOL; x++) {
        const p = heroPos[x], c = rest[p];
        pC2[x] = C2[p];
        gC5[x] = C5[c]; gC4[x] = C4[c]; gC3[x] = C3[c]; gC2[x] = C2[c]; gC1[x] = c;
    }

    // Silmukka uloimmasta (suurin indeksi) sisimpään: osamaksimi ja
    // colex-indeksi kertyvät tasoittain, joten sisin taso tekee 4 hakua
    for (let e = 4; e < HERO_POOL; e++) {
        const pe = heroPos[e], ce2 = pC2[e], ge = gC5[e];
        for (let d = 3; d < e; d++) {
            const pd = heroPos[d], cd2 = pC2[d], gd = ge + gC4[d];
            const mde = pairRank[ce2 + pd];
            for (let c = 2; c < d; c++) {
                const pc = heroPos[c], cc2 = pC2[c], gc = gd + gC3[c];
                let m3 = mde;
                let v = pairRank[ce2 + pc]; if (v > m3) m3 = v;
                v = pairRank[cd2 + pc]; if (v > m3) m3 = v;
                for (let b = 1; b < c; b++) {
                    const pb = heroPos[b], cb2 = pC2[b], gb = gc + gC2[b];
                    let m4 = m3;
                    v = pairRank[ce2 + pb]; if (v > m4) m4 = v;
                    v = pairRank[cd2 + pb]; if (v > m4) m4 = v;
                    v = pairRank[cc2 + pb]; if (v > m4) m4 = v;
                    for (let a = 0; a < b; a++) {
                        const pa = heroPos[a];
                        let m5 = m4;
                        v = pairRank[ce2 + pa]; if (v > m5) m5 = v;
                        v = pairRank[cd2 + pa]; if (v > m5) m5 = v;
                        v = pairRank[cc2 + pa]; if (v > m5) m5 = v;
                        v = pairRank[cb2 + pa]; if (v > m5) m5 = v;

                        const cls = classOf[gb + gC1[a]];
                        cntAcc[cls]++;
                        if (m5 > maxV) shareAcc[cls] += 1;
                        else if (m5 === maxV) shareAcc[cls] += tieShare;
                    }
                }
            }
        }
    }
}

parentPort.on('message', (task) => {
    const share = [], cnt = [];
    for (let r = 0; r < REPLICATES; r++) {
        share.push(new Float64Array(N_CLASSES));
        cnt.push(new Float64Array(N_CLASSES));
    }
    const rands = [];
    for (let r = 0; r < REPLICATES; r++) {
        rands.push(makeRng((task.seed ^ Math.imul(r + 1, 0x9E3779B9)) >>> 0));
    }
    const board = unrank5(task.startRank);

    for (let b = 0; b < task.count; b++) {
        buildPairTable(board);
        for (let k = 0; k < CONFIGS; k++) {
            const r = k % REPLICATES;
            runConfig(rands[r], posArr[r], share[r], cnt[r]);
        }
        if (b + 1 < task.count && !nextCombination(board)) break;
    }

    const transfer = [];
    for (let r = 0; r < REPLICATES; r++) { transfer.push(share[r].buffer, cnt[r].buffer); }
    parentPort.postMessage({ chunk: task.chunk, boards: task.count, share, cnt }, transfer);
});
