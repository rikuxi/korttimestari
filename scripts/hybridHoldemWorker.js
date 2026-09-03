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

// Binomikertoimet, pöytien colex-iteraattori ja xoshiro128** (batchCommon.js)
const { BINOM, unrank5, nextCombination, makeRng } = require('./batchCommon');
const { G2 } = BINOM;

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
