// Moninpelin hybridilaskennan työläinen.
//
// Rakenne: EKSAKTI pöytien yli (kaikki C(52,5) käydään läpi), Monte Carlo
// vain vastustajien korttien poiston yli. Katso docs/eksakti-omaha-equity.md (ei repossa)
// kohta 5.6.
//
// Yhdellä pöydällä ja yhdellä vastustajakonfiguraatiolla pisteytetään
// KAIKKI C(47 - 4*vastustajat, 4) heron kättä kerralla - siksi näyte maksaa
// vain muutaman operaation.

const { parentPort, workerData } = require('worker_threads');
const { prepareBoard, createBuffers, REST, C2, C3, C4 } = require('./exactPrototype');

const N_CLASSES = 16432;

// Binomikertoimet koko pakalle (globaali colex-indeksointi luokkataulukkoon)
const G2 = new Float64Array(53), G3 = new Float64Array(53), G4 = new Float64Array(53), G5 = new Float64Array(53);
const G1 = new Float64Array(53);
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

// --- xoshiro128** : jakso 2^128-1, riittää mihin tahansa ajokokoon ---------
// (mulberry32:n jakso 2^32 loppuisi kesken - katso dokumentin kohta 4.2)

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

// --- Työläisen tila ------------------------------------------------------

const classOf = workerData.classOf;
const OPPONENTS = workerData.players - 1;
const OPP_CARDS = OPPONENTS * 4;
const HERO_POOL = REST - OPP_CARDS;          // heron käytettävissä olevat kortit
const CONFIGS = workerData.configs;
const REPLICATES = workerData.replicates;

const buf = createBuffers();
// Jokaisella toistolla oma paikkataulukko ja oma satunnaisvirta, jotta
// toistot ovat aidosti riippumattomia - muuten toistojen keskihajonta
// aliarvioi keskivirheen (mitattu kerroin 1.57 ennen korjausta).
const posArr = Array.from({ length: REPLICATES }, () => new Int32Array(REST));
const heroPos = new Int32Array(HERO_POOL);   // heron paikat nousevassa järjestyksessä
// Esilasketut indeksipalat heron paikoille
const h4 = new Float64Array(HERO_POOL), h3 = new Float64Array(HERO_POOL);
const h2 = new Float64Array(HERO_POOL), h1 = new Int32Array(HERO_POOL);
const q4 = new Float64Array(HERO_POOL), q3 = new Float64Array(HERO_POOL);
const q2 = new Float64Array(HERO_POOL), q1 = new Int32Array(HERO_POOL);

/**
 * Yksi vastustajakonfiguraatio: arvo 4*vastustajat korttia, laske heidän
 * paras arvonsa ja pisteytä kaikki jäljelle jäävät heron kädet.
 */
function runConfig(rand, pos, shareAcc, cntAcc) {
    const { rest, pairRank, handVal } = buf;

    // Nollaus tekee konfiguraatioista riippumattomia (ilman tätä peräkkäiset
    // konfiguraatiot jakavat osan permutaatiosta). 47 kirjoitusta - mitätön
    // kustannus verrattuna ~200 000 operaatioon per konfiguraatio.
    for (let i = 0; i < REST; i++) pos[i] = i;

    // Osittainen Fisher-Yates: sekoita vain vastustajien tarvitsemat paikat
    for (let i = 0; i < OPP_CARDS; i++) {
        const j = i + (rand() % (REST - i));
        const t = pos[i]; pos[i] = pos[j]; pos[j] = t;
    }

    // Vastustajien parhaat arvot; riittää tietää suurin ja monellako se on
    let maxV = -1, tied = 0;
    for (let o = 0; o < OPPONENTS; o++) {
        const b = o * 4;
        let a0 = pos[b], a1 = pos[b + 1], a2 = pos[b + 2], a3 = pos[b + 3];
        // järjestä neljä paikkaa nousevaan järjestykseen (pieni lajittelu)
        let x;
        if (a0 > a1) { x = a0; a0 = a1; a1 = x; }
        if (a2 > a3) { x = a2; a2 = a3; a3 = x; }
        if (a0 > a2) { x = a0; a0 = a2; a2 = x; }
        if (a1 > a3) { x = a1; a1 = a3; a3 = x; }
        if (a1 > a2) { x = a1; a1 = a2; a2 = x; }
        let v = pairRank[C2[a1] + a0];
        let p = pairRank[C2[a2] + a0]; if (p > v) v = p;
        p = pairRank[C2[a3] + a0]; if (p > v) v = p;
        p = pairRank[C2[a2] + a1]; if (p > v) v = p;
        p = pairRank[C2[a3] + a1]; if (p > v) v = p;
        p = pairRank[C2[a3] + a2]; if (p > v) v = p;
        if (v > maxV) { maxV = v; tied = 1; }
        else if (v === maxV) tied++;
    }
    const tieShare = 1 / (tied + 1);

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
                    const v = handVal[i2 + h1[a]];
                    const cls = classOf[g2v + q1[a]];
                    cntAcc[cls]++;
                    if (v > maxV) shareAcc[cls] += 1;
                    else if (v === maxV) shareAcc[cls] += tieShare;
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
    // Oma satunnaisvirta per toisto; xoshiro128**:n jakso 2^128 tekee
    // virtojen päällekkäisyydestä käytännössä mahdotonta
    const rands = [];
    for (let r = 0; r < REPLICATES; r++) {
        rands.push(makeRng((task.seed ^ Math.imul(r + 1, 0x9E3779B9)) >>> 0));
    }
    const board = unrank5(task.startRank);

    for (let b = 0; b < task.count; b++) {
        prepareBoard(board, buf);
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
