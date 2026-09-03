// Eräajoskriptien yhteiset apurit.
//
// Jokainen ajuri (exact*/hybrid*) ja työläinen toisti nämä aiemmin omana
// kopionaan: colex-iteraattori pöydille, xoshiro128**-satunnaislukugeneraattori,
// binomikertoimet, pöydän kolmikot, keston muotoilu ja worker-pooli. Tässä ne
// ovat kerran, ja ajurit pitävät itsellään vain sen mikä eroaa: palasten
// muodostuksen, tulosten yhdistämisen ja checkpointit.

'use strict';

const { Worker } = require('worker_threads');

// --- Binomikertoimet ---------------------------------------------------
//
// G_k[n] = C(n, k). Käytetään sekä paikkaindeksointiin (0..46) että
// korttien globaaliin colex-indeksointiin (0..51); suurin arvo C(52,5)
// = 2 598 960 mahtuu tarkasti Float64:ään.

const BINOM = (() => {
    const G1 = new Float64Array(53), G2 = new Float64Array(53), G3 = new Float64Array(53);
    const G4 = new Float64Array(53), G5 = new Float64Array(53);
    for (let n = 0; n <= 52; n++) {
        G1[n] = n;
        G2[n] = n >= 2 ? (n * (n - 1)) / 2 : 0;
        G3[n] = n >= 3 ? (n * (n - 1) * (n - 2)) / 6 : 0;
        G4[n] = n >= 4 ? (n * (n - 1) * (n - 2) * (n - 3)) / 24 : 0;
        G5[n] = n >= 5 ? (n * (n - 1) * (n - 2) * (n - 3) * (n - 4)) / 120 : 0;
    }
    return { G1, G2, G3, G4, G5 };
})();

const { G1, G2, G3, G4, G5 } = BINOM;

/** Purkaa colex-sijaluvun 0..C(52,5)-1 viiden kortin pöydäksi (nouseva) */
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

/** Seuraava 5-osajoukko colex-järjestyksessä paikallaan. false kun loppu. */
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

// Pöydän 5 kortin 10 kolmikkoa paikkaindekseinä (i < j < k), 30 lukua
const BOARD_TRIPLES = (() => {
    const t = [];
    for (let i = 0; i < 5; i++)
        for (let j = i + 1; j < 5; j++)
            for (let k = j + 1; k < 5; k++) t.push(i, j, k);
    return new Int32Array(t);
})();

// --- xoshiro128** : jakso 2^128-1, riittää mihin tahansa ajokokoon ---------
// (mulberry32:n jakso 2^32 loppuisi kesken)

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

/** Palauttaa funktion, joka antaa 32-bittisen etumerkittömän satunnaisluvun */
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

/**
 * Eri satunnaisvirta jokaiselle palaselle. Siemen riippuu vain palasen
 * numerosta, joten checkpointista jatkaminen toistaa täsmälleen saman
 * arvonnan; xoshiro128**:n jakso 2^128 tekee virtojen päällekkäisyydestä
 * käytännössä mahdotonta.
 */
function chunkSeed(chunkId) {
    return (0x9e3779b9 ^ Math.imul(chunkId + 1, 0x85ebca6b)) >>> 0;
}

// --- Ajurin apurit -----------------------------------------------------

function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    if (m > 0) return `${m}min ${s % 60}s`;
    return `${s}s`;
}

/**
 * Jakaa palaset worker-säikeille ja kerää tulokset.
 *
 * Jokainen worker saa saman workerDatan, palaset annetaan postMessagella
 * yksi kerrallaan sitä mukaa kun edellinen valmistuu, ja jokaisesta
 * vastauksesta kutsutaan onResult(res). Edistyminen lokitetaan logEvery
 * millisekunnin välein ja viimeisen palasen jälkeen; progress() antaa
 * lokiriville ajurikohtaisen tekstin (esim. pöytien määrän). deadline
 * (ms-aikaleima) lopettaa uusien palasten jakamisen määräajan jälkeen.
 *
 * Worker-virhe hylkää lupauksen; ajuri päättää itse mitä silloin tehdään.
 *
 * @returns {Promise<{elapsed: number, stopped: boolean}>} stopped = määräaika
 *   täyttyi ennen kuin kaikki palaset oli jaettu
 */
async function runPool({ workerFile, workerData, chunks, workers, onResult, progress, logEvery = 5000, deadline = Infinity }) {
    const startTime = Date.now();
    let next = 0, completed = 0, lastLog = 0, stopped = false;

    await new Promise((resolve, reject) => {
        let active = 0;
        const workerCount = Math.min(workers, chunks.length);
        for (let w = 0; w < workerCount; w++) {
            const worker = new Worker(workerFile, { workerData });
            active++;
            const assign = () => {
                if (next >= chunks.length || Date.now() >= deadline) {
                    if (next < chunks.length) stopped = true;
                    worker.terminate();
                    if (--active === 0) resolve();
                    return;
                }
                worker.postMessage(chunks[next++]);
            };
            worker.on('message', (res) => {
                onResult(res);
                completed++;
                const elapsed = Date.now() - startTime;
                if (elapsed - lastLog > logEvery || completed === chunks.length) {
                    lastLog = elapsed;
                    const eta = (elapsed / completed) * (chunks.length - completed);
                    console.log(`[${completed}/${chunks.length}] ${progress ? progress() + '  ' : ''}` +
                        `kulunut ${formatDuration(elapsed)}, jäljellä ~${formatDuration(eta)}`);
                }
                assign();
            });
            worker.on('error', (err) => { worker.terminate(); reject(err); });
            assign();
        }
    });

    return { elapsed: Date.now() - startTime, stopped };
}

module.exports = {
    BINOM, unrank5, nextCombination, BOARD_TRIPLES,
    splitmix32, makeRng, chunkSeed,
    formatDuration, runPool
};
