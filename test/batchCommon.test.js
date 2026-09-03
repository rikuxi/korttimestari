// Eräajoskriptien yhteisten apurien testit: colex-iteraattori, RNG ja
// worker-pooli. Ajurit itse vaativat tunteja, joten niiden yhteinen runko
// testataan täällä pienellä työläisellä.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const B = require('../scripts/batchCommon');

test('BINOM: C(n,k) täsmää kertomakaavaan', () => {
    // Tulomuoto pysyy tarkkana kokonaislukuna (kertomien osamäärä pyöristyisi)
    const C = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = Math.round(r * (n - i) / (i + 1)); return r; };
    const tables = [B.BINOM.G1, B.BINOM.G2, B.BINOM.G3, B.BINOM.G4, B.BINOM.G5];
    for (let k = 1; k <= 5; k++) {
        for (let n = 0; n <= 52; n++) {
            assert.strictEqual(tables[k - 1][n], C(n, k), `C(${n},${k})`);
        }
    }
    assert.strictEqual(B.BINOM.G5[52], 2598960);
});

test('unrank5 ja nextCombination käyvät samat pöydät samassa järjestyksessä', () => {
    // colex: rank = C(c4,5) + C(c3,4) + C(c2,3) + C(c1,2) + c0
    const { G2, G3, G4, G5 } = B.BINOM;
    const rank = c => G5[c[4]] + G4[c[3]] + G3[c[2]] + G2[c[1]] + c[0];
    const c = B.unrank5(0);
    assert.deepStrictEqual(Array.from(c), [0, 1, 2, 3, 4]);
    for (let r = 0; r < 5000; r++) {
        assert.strictEqual(rank(c), r, `sijaluku ${r}`);
        assert.deepStrictEqual(Array.from(B.unrank5(r)), Array.from(c), `unrank5(${r})`);
        assert.ok(c[0] < c[1] && c[1] < c[2] && c[2] < c[3] && c[3] < c[4]);
        assert.ok(B.nextCombination(c));
    }
    // Viimeinen pöytä: seuraavaa ei ole
    const last = B.unrank5(2598959);
    assert.deepStrictEqual(Array.from(last), [47, 48, 49, 50, 51]);
    assert.strictEqual(B.nextCombination(last), false);
});

test('BOARD_TRIPLES: 10 kolmikkoa nousevassa järjestyksessä', () => {
    assert.strictEqual(B.BOARD_TRIPLES.length, 30);
    for (let t = 0; t < 10; t++) {
        const [i, j, k] = [B.BOARD_TRIPLES[3 * t], B.BOARD_TRIPLES[3 * t + 1], B.BOARD_TRIPLES[3 * t + 2]];
        assert.ok(i < j && j < k && k < 5, `kolmikko ${t}`);
    }
});

test('makeRng: deterministinen, 32-bittinen ja siemenestä riippuva', () => {
    const a = B.makeRng(12345), b = B.makeRng(12345), c = B.makeRng(12346);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    const seqC = Array.from({ length: 50 }, () => c());
    assert.deepStrictEqual(seqA, seqB);
    assert.notDeepStrictEqual(seqA, seqC);
    assert.ok(seqA.every(x => Number.isInteger(x) && x >= 0 && x <= 0xFFFFFFFF));
    // Nollasiemen ei jää nollatilaan
    const z = B.makeRng(0);
    assert.ok(Array.from({ length: 20 }, () => z()).some(x => x !== 0));
    // Palasen siemen: sama kaava kuin ajureissa oli (0x9e3779b9 ^ imul(id+1, 0x85ebca6b))
    assert.strictEqual(B.chunkSeed(0), (0x9e3779b9 ^ Math.imul(1, 0x85ebca6b)) >>> 0);
    assert.notStrictEqual(B.chunkSeed(1), B.chunkSeed(2));
});

test('formatDuration', () => {
    assert.strictEqual(B.formatDuration(0), '0s');
    assert.strictEqual(B.formatDuration(59400), '59s');
    assert.strictEqual(B.formatDuration(61000), '1min 1s');
    assert.strictEqual(B.formatDuration(3600000 + 120000), '1h 2min');
    assert.strictEqual(B.formatDuration(-5), '0s');
});

test('runPool jakaa palaset työläisille ja kerää jokaisen tuloksen kerran', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'korttimestari-pool-'));
    const workerFile = path.join(dir, 'worker.js');
    fs.writeFileSync(workerFile, `
        const { parentPort, workerData } = require('worker_threads');
        parentPort.on('message', (chunk) => {
            parentPort.postMessage({ chunk: chunk.chunk, sum: chunk.count * workerData.factor });
        });
    `);
    try {
        const chunks = Array.from({ length: 23 }, (_, i) => ({ chunk: i, count: i + 1 }));
        const seen = new Map();
        const log = console.log;
        const lines = [];
        console.log = (s) => lines.push(String(s));
        let result;
        try {
            result = await B.runPool({
                workerFile, workerData: { factor: 2 }, chunks, workers: 4,
                progress: () => 'edistys',
                onResult: (res) => seen.set(res.chunk, res.sum)
            });
        } finally {
            console.log = log;
        }
        assert.strictEqual(seen.size, 23);
        for (let i = 0; i < 23; i++) assert.strictEqual(seen.get(i), (i + 1) * 2);
        assert.strictEqual(result.stopped, false);
        assert.ok(result.elapsed >= 0);
        // Viimeinen palanen lokitetaan aina
        assert.ok(lines.some(l => l.startsWith('[23/23] edistys')), lines.join('\n'));

        // Määräaika menneisyydessä: yhtään palasta ei jaeta ja stopped = true
        const none = await B.runPool({
            workerFile, workerData: { factor: 1 }, chunks, workers: 2,
            deadline: Date.now() - 1, onResult: () => assert.fail('ei pitänyt jakaa')
        });
        assert.strictEqual(none.stopped, true);

        // Työläisen virhe hylkää lupauksen
        const badFile = path.join(dir, 'bad.js');
        fs.writeFileSync(badFile, "throw new Error('rikki');");
        await assert.rejects(B.runPool({
            workerFile: badFile, workerData: {}, chunks: chunks.slice(0, 2), workers: 1, onResult: () => {}
        }), /rikki/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
