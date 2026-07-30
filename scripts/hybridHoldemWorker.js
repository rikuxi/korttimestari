// Hold'emin moninpelilaskennan työläinen.
//
// Sama rakenne kuin scripts/hybridOmahaWorker.js: EKSAKTI pöytien yli, Monte
// Carlo vain vastustajien korttien poiston yli. Hold'em on omana skriptinään,
// koska pöytäkohtainen taulukko rakennetaan eri tavalla - Omahassa käytetään
// tasan 2 korttia kädestä ja 3 pöydästä, Hold'emissa paras 5 seitsemästä.
//
// Kun pöytä on kiinnitetty, jokaisen C(47,2) = 1 081 kahden kortin käden arvo
// lasketaan kerran. Sen jälkeen pelaajan arvo on yksi taulukkohaku, joten
// yksi vastustajakonfiguraatio pisteyttää kaikki jäljelle jäävät heron kädet
// muutamalla operaatiolla kappaleelta.

const { parentPort, workerData } = require('worker_threads');
const { eval7 } = require('../public/js/engine');

const N_CLASSES = 169;
const REST = 47;
const N_HANDS = (REST * (REST - 1)) / 2;   // 1 081

const G1 = new Float64Array(53), G2 = new Float64Array(53), G3 = new Float64Array(53);
const G4 = new Float64Array(53), G5 = new Float64Array(53);
for (let n = 0; n <= 52; n++) {
    G1[n] = n;
    G2[n] = n >= 2 ? (n * (n - 1)) / 2 : 0;
    G3[n] = n >= 3 ? (n * (n - 1) * (n - 2)) / 6 : 0;
    G4[n] = n >= 4 ? (n * (n - 1) * (n - 2) * (n - 3)) / 24 : 0;
    G5[n] = n >= 5 ? (n * (n - 1) * (n - 2) * (n - 3) * (n - 4)) / 120 : 0;
}

function unrank5(r) {
    const c = new Int32Array(5);
    const tbls = [G1, G2, G3, G4, G5];
    for (let pos = 4; pos >= 0; pos--) {
        const tbl = tbls[pos];
        let n = pos;
        while (n + 1 <= 52 && tbl[n + 1] <= r) n++;
        c[pos] = n;
        r -= tbl[n];
    }
    return c;
}

function nextCombination(c) {
    for (let i = 0; i < 5; i++) {
        const limit = i === 4 ? 52 : c[i + 1];
        if (c[i] + 1 < limit) {
            c[i]++;
            for (let j = 0; j < i; j++) c[j] = j;
            return true;
        }
    }
    return false;
}

// xoshiro128** - jakso 2^128-1
function splitmix32(seed) {
    let z = seed >>> 0;
    return () => {
        z = (z + 0x9E3779B9) | 0;
        let t = z ^ (z >>> 16);
        t = Math.imul(t, 0x21F0AAAD); t ^= t >>> 15;
        t = Math.imul(t, 0x735A2D97);
        return (t ^ (t >>> 15)) >>> 0;
    };
}

function makeRng(seed) {
    const sm = splitmix32(seed);
    let s0 = sm(), s1 = sm(), s2 = sm(), s3 = sm();
    if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
    const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
    return function () {
        const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
        const t = (s1 << 9) >>> 0;
        s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t;
        s3 = rotl(s3, 11);
        return result;
    };
}

const classOf = workerData.classOf;          // Uint8Array(1326)
const OPPONENTS = workerData.players - 1;
const OPP_CARDS = OPPONENTS * 2;
const HERO_POOL = REST - OPP_CARDS;
const CONFIGS = workerData.configs;
const REPLICATES = workerData.replicates;

const rest = new Int32Array(REST);
const handVal = new Int32Array(N_HANDS);
const posArr = Array.from({ length: REPLICATES }, () => new Int32Array(REST));
const heroPos = new Int32Array(HERO_POOL);
const h2 = new Float64Array(HERO_POOL);      // C2[paikka]
const h1 = new Int32Array(HERO_POOL);        // paikka
const q2 = new Float64Array(HERO_POOL);      // G2[kortti]
const q1 = new Int32Array(HERO_POOL);        // kortti

/** Rakenna pöydän kaikkien 1 081 käden arvot */
function buildBoardTable(board) {
    const b0 = board[0], b1 = board[1], b2 = board[2], b3 = board[3], b4 = board[4];
    let n = 0;
    for (let c = 0; c < 52; c++) {
        if (c !== b0 && c !== b1 && c !== b2 && c !== b3 && c !== b4) rest[n++] = c;
    }
    for (let j = 1; j < REST; j++) {
        const cj = rest[j];
        const base = (j * (j - 1)) / 2;
        for (let i = 0; i < j; i++) {
            handVal[base + i] = eval7(rest[i], cj, b0, b1, b2, b3, b4);
        }
    }
}

function runConfig(rand, pos, shareAcc, cntAcc) {
    // Nollaus tekee konfiguraatioista riippumattomia
    for (let i = 0; i < REST; i++) pos[i] = i;
    for (let i = 0; i < OPP_CARDS; i++) {
        const j = i + (rand() % (REST - i));
        const t = pos[i]; pos[i] = pos[j]; pos[j] = t;
    }

    // Vastustajien arvot: riittää suurin ja monellako se on
    let maxV = -1, tied = 0;
    for (let o = 0; o < OPPONENTS; o++) {
        const b = o * 2;
        let a0 = pos[b], a1 = pos[b + 1];
        if (a0 > a1) { const t = a0; a0 = a1; a1 = t; }
        const v = handVal[(a1 * (a1 - 1)) / 2 + a0];
        if (v > maxV) { maxV = v; tied = 1; }
        else if (v === maxV) tied++;
    }
    const tieShare = 1 / (tied + 1);

    for (let i = OPP_CARDS; i < REST; i++) heroPos[i - OPP_CARDS] = pos[i];
    heroPos.sort();
    for (let x = 0; x < HERO_POOL; x++) {
        const p = heroPos[x], c = rest[p];
        h2[x] = (p * (p - 1)) / 2; h1[x] = p;
        q2[x] = G2[c]; q1[x] = c;
    }

    for (let b = 1; b < HERO_POOL; b++) {
        const i2 = h2[b], g2v = q2[b];
        for (let a = 0; a < b; a++) {
            const v = handVal[i2 + h1[a]];
            const cls = classOf[g2v + q1[a]];
            cntAcc[cls]++;
            if (v > maxV) shareAcc[cls] += 1;
            else if (v === maxV) shareAcc[cls] += tieShare;
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
        buildBoardTable(board);
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
