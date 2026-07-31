// Eksakti Omaha Hi/Lo -preflop-equity (8-or-better) heads-upina kaikille
// 16 432 käsiluokalle.
//
// Ei Monte Carloa: käy läpi KAIKKI C(52,5) = 2 598 960 pöytää ja laskee
// jokaiselle pöydälle kaikkien C(47,4) = 178 365 käden tarkan potinosuuden
// yhtä satunnaista vastustajaa vastaan, hi- ja low-puoliskot eriteltyinä.
// Menetelmä: scripts/exactOmahaHiloWorker.js ja
// docs/omaha-hilo-suunnitelma.md (ei repossa).
//
// Käyttö:
//   node scripts/exactOmahaHilo.js [--workers 30] [--chunk 4000] [--limit N]
//
// --limit rajaa käsiteltävien pöytien määrän (savutesti; tulos ei tällöin
// ole eksakti eikä tulostiedostoja kirjoiteta).
//
// Ajon voi keskeyttää: checkpoint tallennetaan minuutin välein ja sama
// komento jatkaa siitä mihin jäätiin.

const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { describeOmahaKey, omahaNotation } = require('../canonical');
const { addRankBounds } = require('./rankBounds');
const { buildClassTable } = require('./exactOmaha');

const N_CLASSES = 16432;
const N_BOARDS = 2598960;          // C(52,5)
const N_HANDS_PER_BOARD = 178365;  // C(47,4)
const N_OPP = 123410;              // C(43,4)
const BOARDS_PER_HAND = 1712304;   // C(48,5)
const N_COMBOS = 270725;           // C(52,4)

function parseArgs(argv) {
    const o = {
        workers: Math.min(30, os.availableParallelism()),
        chunk: 4000,
        limit: 0
    };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--workers') o.workers = parseInt(argv[++i], 10);
        else if (argv[i] === '--chunk') o.chunk = parseInt(argv[++i], 10);
        else if (argv[i] === '--limit') o.limit = parseInt(argv[++i], 10);
        else { console.error(`Tuntematon argumentti: ${argv[i]}`); process.exit(1); }
    }
    return o;
}

function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    if (m > 0) return `${m}min ${s % 60}s`;
    return `${s}s`;
}

// --- Checkpoint --------------------------------------------------------

function saveCheckpoint(file, state) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
        chunkSize: state.chunkSize,
        totalBoards: state.totalBoards,
        done: [...state.done],
        boardsDone: state.boardsDone,
        hi: Buffer.from(state.hi.buffer).toString('base64'),
        lo: Buffer.from(state.lo.buffer).toString('base64')
    }));
    fs.renameSync(tmp, file);
}

function loadCheckpoint(file, chunkSize, totalBoards) {
    if (!fs.existsSync(file)) return null;
    try {
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (d.chunkSize !== chunkSize || d.totalBoards !== totalBoards) {
            console.log('Checkpoint on eri parametreilla - ohitetaan.');
            return null;
        }
        return {
            done: new Set(d.done),
            boardsDone: d.boardsDone,
            hi: new Float64Array(new Uint8Array(Buffer.from(d.hi, 'base64')).buffer),
            lo: new Float64Array(new Uint8Array(Buffer.from(d.lo, 'base64')).buffer)
        };
    } catch (e) {
        console.log('Checkpoint rikki - aloitetaan alusta.');
        return null;
    }
}

// --- Laskenta ----------------------------------------------------------

async function runWorkers(opts, classOf, state, checkpointPath) {
    const chunks = [];
    for (let start = 0; start < state.totalBoards; start += opts.chunk) {
        const id = start / opts.chunk;
        if (!state.done.has(id)) {
            chunks.push({ chunk: id, startRank: start, count: Math.min(opts.chunk, state.totalBoards - start) });
        }
    }
    if (chunks.length === 0) return;

    console.log(`Palasia laskettavana: ${chunks.length} (${opts.chunk} pöytää/palanen), workereita ${opts.workers}`);
    const startTime = Date.now();
    let next = 0, completed = 0, lastSave = Date.now(), lastLog = 0;

    await new Promise((resolve, reject) => {
        let active = 0;
        const workerCount = Math.min(opts.workers, chunks.length);
        for (let w = 0; w < workerCount; w++) {
            const worker = new Worker(path.join(__dirname, 'exactOmahaHiloWorker.js'), {
                workerData: { classOf }
            });
            active++;
            const assign = () => {
                if (next >= chunks.length) {
                    worker.terminate();
                    if (--active === 0) resolve();
                    return;
                }
                worker.postMessage(chunks[next++]);
            };
            worker.on('message', (res) => {
                for (let i = 0; i < N_CLASSES; i++) {
                    state.hi[i] += res.hi[i];
                    state.lo[i] += res.lo[i];
                }
                state.done.add(res.chunk);
                state.boardsDone += res.boards;
                completed++;

                const elapsed = Date.now() - startTime;
                if (elapsed - lastLog > 5000 || completed === chunks.length) {
                    lastLog = elapsed;
                    const eta = (elapsed / completed) * (chunks.length - completed);
                    console.log(`[${completed}/${chunks.length}] ${state.boardsDone.toLocaleString('fi-FI')} pöytää  ` +
                        `kulunut ${formatDuration(elapsed)}, jäljellä ~${formatDuration(eta)}`);
                }
                if (Date.now() - lastSave > 60000) {
                    lastSave = Date.now();
                    saveCheckpoint(checkpointPath, state);
                }
                assign();
            });
            worker.on('error', (err) => { worker.terminate(); reject(err); });
            assign();
        }
    });
    console.log(`Laskenta valmis ${formatDuration(Date.now() - startTime)} aikana.`);
}

// --- Tarkistukset ------------------------------------------------------

function verifyTotals(classes, state) {
    let ok = true;

    let combos = 0;
    for (const c of classes) combos += c.combos;
    const combosOk = combos === N_COMBOS;
    console.log(`  kombot yhteensä: ${combos.toLocaleString('fi-FI')} (odotus ${N_COMBOS.toLocaleString('fi-FI')}) -> ${combosOk ? 'OK' : 'VIRHE'}`);
    ok = combosOk && ok;

    // Neljännespottien summa kaikkien luokkien yli: jokainen järjestetty
    // (hero, vastustaja) -pari jakaa tasan yhden potin, joten summan on
    // oltava tasan 2 * pöydät * kädet * vastustajat. Luvut ylittävät 2^53,
    // joten summa lasketaan BigIntillä.
    let total = 0n;
    for (let i = 0; i < N_CLASSES; i++) {
        total += BigInt(state.hi[i]) + BigInt(state.lo[i]);
    }
    const expected = 2n * BigInt(N_BOARDS) * BigInt(N_HANDS_PER_BOARD) * BigInt(N_OPP);
    const sumOk = total === expected;
    console.log(`  summainvariantti: ${total} vs odotus ${expected} -> ${sumOk ? 'OK' : 'VIRHE'}`);
    ok = sumOk && ok;

    // Sama asia toisin: kombopainotetun keski-equityn on oltava tasan 1/2.
    // Nimittäjä on 4 neljännestä per (käsi, pöytä, vastustaja) -kolmikko.
    const denomAll = 4n * BigInt(N_COMBOS) * BigInt(BOARDS_PER_HAND) * BigInt(N_OPP);
    const meanOk = total * 2n === denomAll;
    console.log(`  painotettu keski-equity = 1/2 tasan -> ${meanOk ? 'OK' : 'VIRHE'}`);
    ok = meanOk && ok;

    return ok;
}

// --- Tulostiedostot ----------------------------------------------------

function writeOutputs(classes, state, dataDir, elapsedMs) {
    const hands = classes.map((c, i) => {
        // Nimittäjä neljännespotin yksiköissä: 4 per (pöytä, vastustaja)
        const denom = c.combos * BOARDS_PER_HAND * N_OPP * 4;
        const hi = state.hi[i], lo = state.lo[i];
        return {
            key: c.key,
            label: describeOmahaKey(c.key),
            notation: omahaNotation(c.key),
            combos: c.combos,
            // Eksaktit osoittajat neljännespotteina: equity = (hi+lo)/denom.
            // hiEquity sisältää koko potin kierroksilta joilla kumpikaan ei
            // tehnyt low'ta, joten hiEquity + loEquity = equity.
            hiNumerator: hi,
            loNumerator: lo,
            denominator: denom,
            equity: 100 * (hi + lo) / denom,
            hiEquity: 100 * hi / denom,
            loEquity: 100 * lo / denom
        };
    });
    hands.sort((a, b) => b.equity - a.equity || (a.key < b.key ? -1 : 1));
    hands.forEach((h, i) => { h.rank = i + 1; });
    addRankBounds(hands);   // eksaktilla se = 0 -> alue on aina [rank, rank]

    const round = (x, n) => Number(x.toFixed(n));
    const output = {
        meta: {
            gameType: 'omahahilo',
            players: 2,
            scenario: 'all-in preflop, hero vs. yksi satunnainen käsi, 8-or-better hi/lo',
            method: 'eksakti: kaikki C(52,5) pöytää x kaikki C(43,4) vastustajakättä, potti jaettuna hi- ja low-puoliskoihin',
            exact: true,
            boards: N_BOARDS,
            opponentHandsPerBoard: N_OPP,
            handClasses: hands.length,
            numeratorUnit: 'neljännespotti (1/4): denominator = combos * C(48,5) * C(43,4) * 4',
            computeSeconds: Math.round(elapsedMs / 1000),
            generatedAt: new Date().toISOString(),
            script: 'scripts/exactOmahaHilo.js'
        },
        hands: hands.map(h => ({
            key: h.key,
            label: h.label,
            notation: h.notation,
            rank: h.rank,
            combos: h.combos,
            equity: round(h.equity, 6),
            hiEquity: round(h.hiEquity, 6),
            loEquity: round(h.loEquity, 6),
            hiNumerator: h.hiNumerator,
            loNumerator: h.loNumerator,
            denominator: h.denominator,
            rankLow: h.rankLow,
            rankHigh: h.rankHigh
        }))
    };

    const jsonPath = path.join(dataDir, 'preflop-omahahilo-2max-exact.json');
    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2) + '\n');
    console.log(`Kirjoitettu: ${jsonPath}`);

    const lines = ['rank,hand,label,notation,combos,equity_pct,hi_equity_pct,lo_equity_pct,hi_numerator,lo_numerator,denominator,rank_low,rank_high'];
    for (const h of hands) {
        lines.push([h.rank, h.key, h.label, h.notation, h.combos,
            round(h.equity, 6), round(h.hiEquity, 6), round(h.loEquity, 6),
            h.hiNumerator, h.loNumerator, h.denominator, h.rankLow, h.rankHigh].join(','));
    }
    const csvPath = path.join(dataDir, 'preflop-omahahilo-2max-exact.csv');
    fs.writeFileSync(csvPath, lines.join('\n') + '\n');
    console.log(`Kirjoitettu: ${csvPath}`);

    return hands;
}

// --- Pääohjelma --------------------------------------------------------

async function main() {
    const opts = parseArgs(process.argv);
    const dataDir = path.resolve(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const checkpointPath = path.join(dataDir, 'preflop-omahahilo-2max-exact.checkpoint.json');

    const totalBoards = opts.limit > 0 ? Math.min(opts.limit, N_BOARDS) : N_BOARDS;
    const partial = opts.limit > 0;

    console.log('Eksakti Omaha Hi/Lo -preflop-equity, heads-up (8-or-better)');
    console.log(`Pöytiä: ${totalBoards.toLocaleString('fi-FI')}${partial ? ' (RAJATTU AJO - ei eksakti)' : ''}`);

    let t = Date.now();
    console.log('Rakennetaan luokkataulukko...');
    const { classes, classOf } = buildClassTable();
    console.log(`  ${classes.length} luokkaa, ${N_COMBOS.toLocaleString('fi-FI')} kombinaatiota, ${formatDuration(Date.now() - t)}`);

    const restored = partial ? null : loadCheckpoint(checkpointPath, opts.chunk, totalBoards);
    const state = {
        chunkSize: opts.chunk,
        totalBoards,
        done: restored ? restored.done : new Set(),
        boardsDone: restored ? restored.boardsDone : 0,
        hi: restored ? restored.hi : new Float64Array(N_CLASSES),
        lo: restored ? restored.lo : new Float64Array(N_CLASSES)
    };
    if (restored) {
        console.log(`Checkpointista jatketaan: ${state.boardsDone.toLocaleString('fi-FI')} pöytää valmiina.`);
    }

    const startCompute = Date.now();
    await runWorkers(opts, classOf, state, checkpointPath);
    const elapsedMs = Date.now() - startCompute;

    if (partial) {
        // Summainvariantti pätee myös osittaiselle ajolle: jokainen
        // käsitelty pöytä tuottaa tasan 2 * kädet * vastustajat neljännestä
        let total = 0n;
        for (let i = 0; i < N_CLASSES; i++) {
            total += BigInt(state.hi[i]) + BigInt(state.lo[i]);
        }
        const expected = 2n * BigInt(state.boardsDone) * BigInt(N_HANDS_PER_BOARD) * BigInt(N_OPP);
        console.log(`\nRajattu ajo (${state.boardsDone.toLocaleString('fi-FI')} pöytää) - ei tulostiedostoja.`);
        console.log(`  summainvariantti: ${total} vs odotus ${expected} -> ${total === expected ? 'OK' : 'VIRHE'}`);
        console.log(`  nopeus: ${(elapsedMs / state.boardsDone).toFixed(2)} ms/pöytä (seinäkello / pöytä), ` +
            `koko ajo ~${formatDuration(elapsedMs / state.boardsDone * N_BOARDS)}`);
        process.exit(total === expected ? 0 : 1);
    }

    console.log('\nTarkistukset:');
    const ok = verifyTotals(classes, state);
    if (!ok) {
        console.error('\nTARKISTUKSET EPÄONNISTUIVAT - tulostiedostoja ei kirjoiteta.');
        process.exit(1);
    }

    const hands = writeOutputs(classes, state, dataDir, elapsedMs);
    fs.rmSync(checkpointPath, { force: true });

    console.log('\nTop 10:');
    for (const h of hands.slice(0, 10)) {
        console.log(`  ${String(h.rank).padStart(2)}. ${h.label.padEnd(12)} ${h.equity.toFixed(4)} % ` +
            `(hi ${h.hiEquity.toFixed(2)} + lo ${h.loEquity.toFixed(2)})`);
    }
    console.log('Heikoimmat 3:');
    for (const h of hands.slice(-3)) {
        console.log(`  ${h.rank}. ${h.label.padEnd(12)} ${h.equity.toFixed(4)} %`);
    }
}

if (require.main === module) {
    main().catch(err => { console.error('Ajo epäonnistui:', err); process.exit(1); });
}
