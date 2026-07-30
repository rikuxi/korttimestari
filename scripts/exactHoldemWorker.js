// Eksaktin Hold'em-equity-laskennan työläinen.
//
// Sama pöytäpääalgoritmi kuin scripts/exactOmahaWorker.js, mutta paljon
// kevyempi: kiinnitetyllä pöydällä kahden kortin käsiä on vain C(47,2) = 1 081
// (Omahassa C(47,4) = 178 365). Inkluusio-ekskluusiossa on 4 termiä 16:n
// sijaan, koska heron kortteja on kaksi.

const { parentPort, workerData } = require('worker_threads');
const { eval7 } = require('../public/js/engine');

const N_CLASSES = 169;
const REST = 47;
const N_HANDS = (REST * (REST - 1)) / 2;   // 1 081 kättä pöydän jälkeen
const N_OPP = (45 * 44) / 2;               // 990 vastustajakättä heron jälkeen

// Binomikertoimet colex-indeksointiin
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

const classOf = workerData.classOf;   // Uint8Array(1326): 2 kortin colex -> luokka

// Uudelleenkäytettävät puskurit
const rest = new Int32Array(REST);
const handVal = new Int32Array(N_HANDS);      // raaka 7 kortin arvo
const handRank = new Int32Array(N_HANDS);     // pakattu 0..R-1
const distinct = new Int32Array(N_HANDS);
// Histogrammit: rivi 0 = globaali, rivit 1..47 = korttikohtaiset
const STRIDE_MAX = N_HANDS + 1;
const hist = new Int32Array(48 * STRIDE_MAX);
const rowCard = new Int32Array(REST);

/** Parin (i<j) colex-indeksi jäljellä olevien korttien joukossa */
const pairIndex = (i, j) => (j * (j - 1)) / 2 + i;

function solveBoard(board, accWin, accTie) {
    const b0 = board[0], b1 = board[1], b2 = board[2], b3 = board[3], b4 = board[4];

    let n = 0;
    for (let c = 0; c < 52; c++) {
        if (c !== b0 && c !== b1 && c !== b2 && c !== b3 && c !== b4) rest[n++] = c;
    }

    // --- Kaikkien 1 081 käden arvo tällä pöydällä ---
    for (let j = 1; j < REST; j++) {
        const cj = rest[j];
        const base = (j * (j - 1)) / 2;
        for (let i = 0; i < j; i++) {
            handVal[base + i] = eval7(rest[i], cj, b0, b1, b2, b3, b4);
        }
    }

    // --- Pakkaa arvot 0..R-1 ---
    distinct.set(handVal);
    distinct.sort();
    let R = 0;
    for (let i = 0; i < N_HANDS; i++) {
        if (i === 0 || distinct[i] !== distinct[i - 1]) distinct[R++] = distinct[i];
    }
    for (let p = 0; p < N_HANDS; p++) {
        const v = handVal[p];
        let lo = 0, hi = R - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (distinct[mid] < v) lo = mid + 1; else hi = mid;
        }
        handRank[p] = lo;
    }
    const STRIDE = R + 1;
    for (let i = 0; i < REST; i++) rowCard[i] = (1 + i) * STRIDE;

    // --- Histogrammit: globaali + korttikohtaiset ---
    hist.fill(0, 0, 48 * STRIDE);
    for (let j = 1; j < REST; j++) {
        const base = (j * (j - 1)) / 2;
        const rj = rowCard[j];
        for (let i = 0; i < j; i++) {
            const v = handRank[base + i];
            hist[v]++;
            hist[rowCard[i] + v]++;
            hist[rj + v]++;
        }
    }
    // S[v] = kuinka moni käsi on arvoltaan >= v
    for (let row = 0; row < 48; row++) {
        const off = row * STRIDE;
        for (let v = R - 1; v >= 0; v--) hist[off + v] += hist[off + v + 1];
    }

    // --- Inkluusio-ekskluusio: 4 termiä, koska heron kortteja on kaksi ---
    for (let j = 1; j < REST; j++) {
        const base = (j * (j - 1)) / 2;
        const rj = rowCard[j];
        const gj = G2[rest[j]];
        for (let i = 0; i < j; i++) {
            const idx = base + i;
            const v = handRank[idx];
            const w = v + 1;
            const ri = rowCard[i];

            // Kädet >= v jotka eivät sisällä heron kortteja.
            // Nelikkötermi on heron oma käsi: mukana kun v >= t
            const ge = hist[v] - hist[ri + v] - hist[rj + v] + 1;
            const gt = hist[w] - hist[ri + w] - hist[rj + w];

            const cls = classOf[gj + rest[i]];
            accWin[cls] += N_OPP - ge;   // heron voittamat
            accTie[cls] += ge - gt;      // tasapelit
        }
    }
}

parentPort.on('message', (task) => {
    const accWin = new Float64Array(N_CLASSES);
    const accTie = new Float64Array(N_CLASSES);
    const board = unrank5(task.startRank);

    for (let b = 0; b < task.count; b++) {
        solveBoard(board, accWin, accTie);
        if (b + 1 < task.count && !nextCombination(board)) break;
    }

    parentPort.postMessage(
        { chunk: task.chunk, boards: task.count, win: accWin, tie: accTie },
        [accWin.buffer, accTie.buffer]
    );
});
