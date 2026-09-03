// Eksakti Omaha-preflop-equity heads-upina, kaikille 16 432 käsiluokalle.
//
// Ei Monte Carloa: käy läpi KAIKKI C(52,5) = 2 598 960 pöytää ja laskee
// jokaiselle pöydälle kaikkien C(47,4) = 178 365 käden tarkan equityn yhtä
// satunnaista vastustajaa vastaan. Menetelmä on kuvattu tiedostossa
// docs/eksakti-omaha-equity.md (ei repossa) kohdassa 5.
//
// Käyttö:
//   node scripts/exactOmaha.js [--workers 30] [--chunk 5000] [--limit N]
//
// --limit rajaa käsiteltävien pöytien määrän (savutesti; tulos ei tällöin
// ole eksakti eikä tarkistuksia ajeta).
//
// Ajon voi keskeyttää: checkpoint tallennetaan minuutin välein ja sama
// komento jatkaa siitä mihin jäätiin.

const { formatDuration, runPool } = require('./batchCommon');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { enumerateOmahaCanonical, canonicalizeOmaha, describeOmahaKey, omahaNotation } = require('../canonical');
const { addRankBounds } = require('./rankBounds');

const N_CLASSES = 16432;
const N_BOARDS = 2598960;      // C(52,5)
const N_HANDS_PER_BOARD = 178365;  // C(47,4)
const N_OPP = 123410;          // C(43,4)
const BOARDS_PER_HAND = 1712304;   // C(48,5)
const N_COMBOS = 270725;       // C(52,4)

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const cardToStr = c => RANKS[c >> 2] + SUITS[c & 3];

function parseArgs(argv) {
    const o = {
        workers: Math.min(30, os.availableParallelism()),
        chunk: 5000,
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

// --- Luokkataulukko: 4 kortin colex-indeksi -> käsiluokan järjestysnumero ---

function buildClassTable() {
    const G2 = [], G3 = [], G4 = [];
    for (let n = 0; n <= 52; n++) {
        G2[n] = n >= 2 ? (n * (n - 1)) / 2 : 0;
        G3[n] = n >= 3 ? (n * (n - 1) * (n - 2)) / 6 : 0;
        G4[n] = n >= 4 ? (n * (n - 1) * (n - 2) * (n - 3)) / 24 : 0;
    }

    const classes = enumerateOmahaCanonical()
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    if (classes.length !== N_CLASSES) {
        throw new Error(`Odotettiin ${N_CLASSES} luokkaa, saatiin ${classes.length}`);
    }
    const indexOf = new Map(classes.map((c, i) => [c.key, i]));

    const classOf = new Uint16Array(N_COMBOS);
    const seen = new Int32Array(N_CLASSES);
    const str = [];
    for (let c = 0; c < 52; c++) str[c] = cardToStr(c);

    let filled = 0;
    for (let d = 3; d < 52; d++) {
        for (let c = 2; c < d; c++) {
            for (let b = 1; b < c; b++) {
                for (let a = 0; a < b; a++) {
                    const key = canonicalizeOmaha([str[a], str[b], str[c], str[d]]);
                    const idx = indexOf.get(key);
                    if (idx === undefined) throw new Error(`Tuntematon luokka: ${key}`);
                    classOf[G4[d] + G3[c] + G2[b] + a] = idx;
                    seen[idx]++;
                    filled++;
                }
            }
        }
    }
    if (filled !== N_COMBOS) throw new Error(`Täytettiin ${filled} / ${N_COMBOS} kombinaatiota`);
    // Ristiintarkistus: luokkataulukon kombomäärien on täsmättävä enumerointiin
    for (let i = 0; i < N_CLASSES; i++) {
        if (seen[i] !== classes[i].combos) {
            throw new Error(`Luokka ${classes[i].key}: taulukossa ${seen[i]}, enumeroinnissa ${classes[i].combos}`);
        }
    }
    return { classes, classOf };
}

// --- Checkpoint --------------------------------------------------------

function saveCheckpoint(file, state) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
        chunkSize: state.chunkSize,
        totalBoards: state.totalBoards,
        done: [...state.done],
        boardsDone: state.boardsDone,
        win: Buffer.from(state.win.buffer).toString('base64'),
        tie: Buffer.from(state.tie.buffer).toString('base64')
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
            win: new Float64Array(new Uint8Array(Buffer.from(d.win, 'base64')).buffer),
            tie: new Float64Array(new Uint8Array(Buffer.from(d.tie, 'base64')).buffer)
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
    let lastSave = Date.now();
    const { elapsed } = await runPool({
        workerFile: path.join(__dirname, 'exactOmahaWorker.js'),
        workerData: { classOf },
        chunks, workers: opts.workers,
        progress: () => `${state.boardsDone.toLocaleString('fi-FI')} pöytää`,
        onResult: (res) => {
            for (let i = 0; i < N_CLASSES; i++) {
                state.win[i] += res.win[i];
                state.tie[i] += res.tie[i];
            }
            state.done.add(res.chunk);
            state.boardsDone += res.boards;
            if (Date.now() - lastSave > 60000) {
                lastSave = Date.now();
                saveCheckpoint(checkpointPath, state);
            }
        }
    });
    console.log(`Laskenta valmis ${formatDuration(elapsed)} aikana.`);
}

// --- Tarkistukset ------------------------------------------------------

function verifyTotals(classes, state) {
    let ok = true;

    let combos = 0;
    for (const c of classes) combos += c.combos;
    const combosOk = combos === N_COMBOS;
    console.log(`  kombot yhteensä: ${combos.toLocaleString('fi-FI')} (odotus ${N_COMBOS.toLocaleString('fi-FI')}) -> ${combosOk ? 'OK' : 'VIRHE'}`);
    ok = combosOk && ok;

    // Σ (2*voitot + tasapelit) kaikkien luokkien yli. Luvut ylittävät 2^53,
    // joten summa lasketaan BigIntillä (yksittäiset luokkasummat ovat
    // eksakteja kokonaislukuja float64:ssä).
    let total = 0n;
    for (let i = 0; i < N_CLASSES; i++) {
        total += 2n * BigInt(state.win[i]) + BigInt(state.tie[i]);
    }
    const expected = BigInt(N_BOARDS) * BigInt(N_HANDS_PER_BOARD) * BigInt(N_OPP);
    const sumOk = total === expected;
    console.log(`  summainvariantti: ${total} vs odotus ${expected} -> ${sumOk ? 'OK' : 'VIRHE'}`);
    ok = sumOk && ok;

    // Sama asia toisin ilmaistuna: painotetun keskiarvon on oltava tasan 1/2
    const denomAll = BigInt(N_COMBOS) * BigInt(BOARDS_PER_HAND) * BigInt(N_OPP) * 2n;
    const meanOk = total * 2n === denomAll;
    console.log(`  painotettu keski-equity = 1/2 tasan -> ${meanOk ? 'OK' : 'VIRHE'}`);
    ok = meanOk && ok;

    return ok;
}

// --- Tulostiedostot ----------------------------------------------------

function writeOutputs(classes, state, dataDir, elapsedMs) {
    const hands = classes.map((c, i) => {
        const denom = c.combos * BOARDS_PER_HAND * N_OPP;
        const win = state.win[i], tie = state.tie[i];
        return {
            key: c.key,
            label: describeOmahaKey(c.key),
            // Yksikäsitteinen merkintä ('(AJ)(AT)') - label ei yksilöi luokkaa.
            // Sarake on tuotantotiedostossa, joten generaattorin on tuotettava
            // se itse: muuten uudelleenajo pudottaisi sen hiljaa.
            notation: omahaNotation(c.key),
            combos: c.combos,
            winCount: win,
            tieCount: tie,
            denominator: denom,
            // HUOM: tie/2 on oikein VAIN heads-upissa (tasajako tasan
            // kahdelle). Jos tähän joskus lisätään --players, kaava on
            // vaihdettava moottorin Σ(1/k)-jakoon (public/js/engine.js) -
            // muuten moniwaytasajaot lasketaan hiljaa väärin.
            equity: 100 * (win + tie / 2) / denom,
            win: 100 * win / denom,
            tie: 100 * tie / denom
        };
    });
    hands.sort((a, b) => b.equity - a.equity || (a.key < b.key ? -1 : 1));
    hands.forEach((h, i) => { h.rank = i + 1; });
    addRankBounds(hands);   // eksaktilla se = 0 -> alue on aina [rank, rank]

    const round = (x, n) => Number(x.toFixed(n));
    const output = {
        meta: {
            gameType: 'omaha',
            players: 2,
            scenario: 'all-in preflop, hero vs. yksi satunnainen käsi',
            method: 'eksakti: kaikki C(52,5) pöytää x kaikki C(43,4) vastustajakättä',
            exact: true,
            boards: N_BOARDS,
            opponentHandsPerBoard: N_OPP,
            handClasses: hands.length,
            computeSeconds: Math.round(elapsedMs / 1000),
            generatedAt: new Date().toISOString(),
            script: 'scripts/exactOmaha.js'
        },
        hands: hands.map(h => ({
            key: h.key,
            label: h.label,
            notation: h.notation,
            rank: h.rank,
            combos: h.combos,
            equity: round(h.equity, 6),
            win: round(h.win, 6),
            tie: round(h.tie, 6),
            winCount: h.winCount,
            tieCount: h.tieCount,
            denominator: h.denominator,
            rankLow: h.rankLow,
            rankHigh: h.rankHigh
        }))
    };

    const jsonPath = path.join(dataDir, 'preflop-omaha-2max-exact.json');
    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2) + '\n');
    console.log(`Kirjoitettu: ${jsonPath}`);

    const lines = ['rank,hand,label,notation,combos,equity_pct,win_pct,tie_pct,win_count,tie_count,denominator,rank_low,rank_high'];
    for (const h of hands) {
        lines.push([h.rank, h.key, h.label, h.notation, h.combos,
            round(h.equity, 6), round(h.win, 6), round(h.tie, 6),
            h.winCount, h.tieCount, h.denominator, h.rankLow, h.rankHigh].join(','));
    }
    const csvPath = path.join(dataDir, 'preflop-omaha-2max-exact.csv');
    fs.writeFileSync(csvPath, lines.join('\n') + '\n');
    console.log(`Kirjoitettu: ${csvPath}`);

    return hands;
}

// --- Pääohjelma --------------------------------------------------------

async function main() {
    const opts = parseArgs(process.argv);
    const dataDir = path.resolve(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const checkpointPath = path.join(dataDir, 'preflop-omaha-2max-exact.checkpoint.json');

    const totalBoards = opts.limit > 0 ? Math.min(opts.limit, N_BOARDS) : N_BOARDS;
    const partial = opts.limit > 0;

    console.log('Eksakti Omaha-preflop-equity, heads-up');
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
        win: restored ? restored.win : new Float64Array(N_CLASSES),
        tie: restored ? restored.tie : new Float64Array(N_CLASSES)
    };
    if (restored) {
        console.log(`Checkpointista jatketaan: ${state.boardsDone.toLocaleString('fi-FI')} pöytää valmiina.`);
    }

    const startCompute = Date.now();
    await runWorkers(opts, classOf, state, checkpointPath);
    const elapsedMs = Date.now() - startCompute;

    if (partial) {
        // Summainvariantti pätee myös osittaiselle ajolle: jokainen käsitelty
        // pöytä tuottaa tasan N_HANDS_PER_BOARD * N_OPP puolikasta.
        let total = 0n;
        for (let i = 0; i < N_CLASSES; i++) {
            total += 2n * BigInt(state.win[i]) + BigInt(state.tie[i]);
        }
        const expected = BigInt(state.boardsDone) * BigInt(N_HANDS_PER_BOARD) * BigInt(N_OPP);
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
        console.log(`  ${String(h.rank).padStart(2)}. ${h.label.padEnd(12)} ${h.equity.toFixed(4)} %`);
    }
    console.log('Heikoimmat 3:');
    for (const h of hands.slice(-3)) {
        console.log(`  ${h.rank}. ${h.label.padEnd(12)} ${h.equity.toFixed(4)} %`);
    }
}

if (require.main === module) {
    main().catch(err => { console.error('Ajo epäonnistui:', err); process.exit(1); });
}

module.exports = { buildClassTable, verifyTotals };
