// Eksaktin Omaha-equity-laskennan työläinen.
// Saa tehtäväkseen välin pöytiä (colex-järjestyksessä), ratkaisee jokaisen
// ja kerää tulokset kanonisiin käsiluokkiin.
//
// Katso scripts/exactOmaha.js ja docs/eksakti-omaha-equity.md (ei repossa).

const { parentPort, workerData } = require('worker_threads');
const { solveBoard, createBuffers, REST, N_HANDS, C2, C3, C4 } = require('./exactPrototype');

const N_CLASSES = 16432;

// Binomikertoimet koko pakalle (globaali colex-indeksointi) ja pöytien iteraattori
const { BINOM, unrank5, nextCombination } = require('./batchCommon');
const { G2, G3, G4 } = BINOM;

const classOf = workerData.classOf;   // Uint16Array(270725): 4 kortin colex -> luokka
const buf = createBuffers();

/**
 * Kerää yhden pöydän tulokset luokkakohtaisiin summiin.
 * rest on nousevassa järjestyksessä, joten rest[i] < rest[j] < rest[k] < rest[l]
 * ja globaali colex-indeksi saadaan suoraan.
 */
function accumulate(accWin, accTie) {
    const { rest, winNum, tieNum } = buf;
    for (let l = 3; l < REST; l++) {
        const c4l = C4[l], g4 = G4[rest[l]];
        for (let k = 2; k < l; k++) {
            const c3k = C3[k], g3 = g4 + G3[rest[k]];
            for (let j = 1; j < k; j++) {
                const c2j = C2[j], g2 = g3 + G2[rest[j]];
                const base = c4l + c3k + c2j;
                for (let i = 0; i < j; i++) {
                    const cls = classOf[g2 + rest[i]];
                    accWin[cls] += winNum[base + i];
                    accTie[cls] += tieNum[base + i];
                }
            }
        }
    }
}

parentPort.on('message', (task) => {
    const accWin = new Float64Array(N_CLASSES);
    const accTie = new Float64Array(N_CLASSES);
    const board = unrank5(task.startRank);
    for (let b = 0; b < task.count; b++) {
        solveBoard(board, buf);
        accumulate(accWin, accTie);
        if (b + 1 < task.count && !nextCombination(board)) break;
    }
    parentPort.postMessage(
        { chunk: task.chunk, boards: task.count, win: accWin, tie: accTie },
        [accWin.buffer, accTie.buffer]
    );
});
