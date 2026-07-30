// Eksakti Texas Hold'em -preflop-equity heads-upina, kaikille 169 käsiluokalle.
//
// Ei Monte Carloa: käy läpi KAIKKI C(52,5) = 2 598 960 pöytää ja laskee
// jokaiselle pöydälle kaikkien C(47,2) = 1 081 käden tarkan equityn yhtä
// satunnaista vastustajaa vastaan. Menetelmä on sama kuin Omahassa
// (docs/eksakti-omaha-equity.md (ei repossa) kohta 5), mutta 165× kevyempi: kahden kortin
// käsiä on murto-osa neljän kortin käsistä.
//
// Käyttö:
//   node scripts/exactHoldem.js [--workers 30] [--chunk 20000] [--limit N]

const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { enumerateHoldemCanonical, canonicalizeHoldem } = require('../canonical');
const { intToCard } = require('../public/js/engine');
const { addRankBounds } = require('./rankBounds');

const N_CLASSES = 169;
const N_BOARDS = 2598960;        // C(52,5)
const N_HANDS_PER_BOARD = 1081;  // C(47,2)
const N_OPP = 990;               // C(45,2)
const BOARDS_PER_HAND = 2118760; // C(50,5)
const N_COMBOS = 1326;           // C(52,2)

function parseArgs(argv) {
    const o = { workers: Math.min(30, os.availableParallelism()), chunk: 20000, limit: 0 };
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
    const m = Math.floor(s / 60);
    if (m > 0) return `${m}min ${s % 60}s`;
    return `${s}s`;
}

/** 2 kortin colex-indeksi -> käsiluokan järjestysnumero */
function buildClassTable() {
    const classes = enumerateHoldemCanonical()
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    if (classes.length !== N_CLASSES) {
        throw new Error(`Odotettiin ${N_CLASSES} luokkaa, saatiin ${classes.length}`);
    }
    const indexOf = new Map(classes.map((c, i) => [c.key, i]));

    const classOf = new Uint8Array(N_COMBOS);
    const seen = new Int32Array(N_CLASSES);
    let filled = 0;
    for (let b = 1; b < 52; b++) {
        for (let a = 0; a < b; a++) {
            const key = canonicalizeHoldem([intToCard(a), intToCard(b)]);
            const idx = indexOf.get(key);
            if (idx === undefined) throw new Error(`Tuntematon luokka: ${key}`);
            classOf[(b * (b - 1)) / 2 + a] = idx;
            seen[idx]++;
            filled++;
        }
    }
    if (filled !== N_COMBOS) throw new Error(`Täytettiin ${filled} / ${N_COMBOS}`);
    for (let i = 0; i < N_CLASSES; i++) {
        if (seen[i] !== classes[i].combos) {
            throw new Error(`Luokka ${classes[i].key}: taulukossa ${seen[i]}, enumeroinnissa ${classes[i].combos}`);
        }
    }
    return { classes, classOf };
}

async function runWorkers(opts, classOf, state) {
    const chunks = [];
    for (let start = 0; start < state.totalBoards; start += opts.chunk) {
        chunks.push({
            chunk: start / opts.chunk,
            startRank: start,
            count: Math.min(opts.chunk, state.totalBoards - start)
        });
    }
    console.log(`Palasia: ${chunks.length} (${opts.chunk} pöytää/palanen), workereita ${opts.workers}`);
    const startTime = Date.now();
    let next = 0, completed = 0, lastLog = 0;

    await new Promise((resolve, reject) => {
        let active = 0;
        for (let w = 0; w < Math.min(opts.workers, chunks.length); w++) {
            const worker = new Worker(path.join(__dirname, 'exactHoldemWorker.js'), {
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
                    state.win[i] += res.win[i];
                    state.tie[i] += res.tie[i];
                }
                state.boardsDone += res.boards;
                completed++;
                const el = Date.now() - startTime;
                if (el - lastLog > 3000 || completed === chunks.length) {
                    lastLog = el;
                    const eta = (el / completed) * (chunks.length - completed);
                    console.log(`[${completed}/${chunks.length}] ${state.boardsDone.toLocaleString('fi-FI')} pöytää  ` +
                        `kulunut ${formatDuration(el)}, jäljellä ~${formatDuration(eta)}`);
                }
                assign();
            });
            worker.on('error', (e) => { worker.terminate(); reject(e); });
            assign();
        }
    });
    console.log(`Laskenta valmis ${formatDuration(Date.now() - startTime)} aikana.`);
}

async function main() {
    const opts = parseArgs(process.argv);
    const dataDir = path.resolve(__dirname, '..', 'data');
    const totalBoards = opts.limit > 0 ? Math.min(opts.limit, N_BOARDS) : N_BOARDS;
    const partial = opts.limit > 0;

    console.log("Eksakti Texas Hold'em -preflop-equity, heads-up");
    console.log(`Pöytiä: ${totalBoards.toLocaleString('fi-FI')}${partial ? ' (RAJATTU - ei eksakti)' : ''}`);

    const { classes, classOf } = buildClassTable();
    console.log(`Luokkataulukko: ${classes.length} luokkaa, ${N_COMBOS} kombinaatiota`);

    const state = {
        totalBoards, boardsDone: 0,
        win: new Float64Array(N_CLASSES),
        tie: new Float64Array(N_CLASSES)
    };

    const t0 = Date.now();
    await runWorkers(opts, classOf, state);
    const elapsedMs = Date.now() - t0;

    // --- Tarkistukset ---
    console.log('\nTarkistukset:');
    let combos = 0;
    for (const c of classes) combos += c.combos;
    const combosOk = combos === N_COMBOS;
    console.log(`  kombot yhteensä: ${combos} (odotus ${N_COMBOS}) -> ${combosOk ? 'OK' : 'VIRHE'}`);

    let total = 0n;
    for (let i = 0; i < N_CLASSES; i++) {
        total += 2n * BigInt(state.win[i]) + BigInt(state.tie[i]);
    }
    const expected = BigInt(state.boardsDone) * BigInt(N_HANDS_PER_BOARD) * BigInt(N_OPP);
    const sumOk = total === expected;
    console.log(`  summainvariantti: ${total} vs odotus ${expected} -> ${sumOk ? 'OK' : 'VIRHE'}`);

    if (partial) {
        console.log('\nRajattu ajo - tulostiedostoja ei kirjoiteta.');
        console.log(`  nopeus: ${(elapsedMs / state.boardsDone * 1000).toFixed(2)} µs/pöytä, ` +
            `koko ajo ~${formatDuration(elapsedMs / state.boardsDone * N_BOARDS)}`);
        process.exit(sumOk ? 0 : 1);
    }

    // Painotettu keski-equity on tasan 1/2
    const denomAll = BigInt(N_COMBOS) * BigInt(BOARDS_PER_HAND) * BigInt(N_OPP) * 2n;
    const meanOk = total * 2n === denomAll;
    console.log(`  painotettu keski-equity = 1/2 tasan -> ${meanOk ? 'OK' : 'VIRHE'}`);

    if (!combosOk || !sumOk || !meanOk) {
        console.error('\nTARKISTUKSET EPÄONNISTUIVAT - tulostiedostoja ei kirjoiteta.');
        process.exit(1);
    }

    // --- Tulostiedostot ---
    const hands = classes.map((c, i) => {
        const denom = c.combos * BOARDS_PER_HAND * N_OPP;
        const win = state.win[i], tie = state.tie[i];
        return {
            key: c.key, combos: c.combos,
            winCount: win, tieCount: tie, denominator: denom,
            // HUOM: tie/2 on oikein VAIN heads-upissa - katso exactOmaha.js
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
            gameType: 'holdem', players: 2,
            scenario: 'all-in preflop, hero vs. yksi satunnainen käsi',
            method: 'eksakti: kaikki C(52,5) pöytää x kaikki C(45,2) vastustajakättä',
            exact: true,
            boards: N_BOARDS, opponentHandsPerBoard: N_OPP,
            handClasses: hands.length,
            computeSeconds: Math.round(elapsedMs / 1000),
            generatedAt: new Date().toISOString(),
            script: 'scripts/exactHoldem.js'
        },
        hands: hands.map(h => ({
            key: h.key, rank: h.rank, combos: h.combos,
            equity: round(h.equity, 6), win: round(h.win, 6), tie: round(h.tie, 6),
            winCount: h.winCount, tieCount: h.tieCount, denominator: h.denominator,
            rankLow: h.rankLow, rankHigh: h.rankHigh
        }))
    };
    fs.writeFileSync(path.join(dataDir, 'preflop-holdem-2max-exact.json'),
        JSON.stringify(output, null, 2) + '\n');

    const lines = ['rank,hand,combos,equity_pct,win_pct,tie_pct,win_count,tie_count,denominator,rank_low,rank_high'];
    for (const h of hands) {
        lines.push([h.rank, h.key, h.combos, round(h.equity, 6), round(h.win, 6),
            round(h.tie, 6), h.winCount, h.tieCount, h.denominator, h.rankLow, h.rankHigh].join(','));
    }
    fs.writeFileSync(path.join(dataDir, 'preflop-holdem-2max-exact.csv'), lines.join('\n') + '\n');
    console.log('\nKirjoitettu: data/preflop-holdem-2max-exact.json ja .csv');

    console.log('\nTop 10:');
    for (const h of hands.slice(0, 10)) {
        console.log(`  ${String(h.rank).padStart(2)}. ${h.key.padEnd(4)} ${h.equity.toFixed(4)} %`);
    }
    console.log('Heikoimmat 3:');
    for (const h of hands.slice(-3)) {
        console.log(`  ${h.rank}. ${h.key.padEnd(4)} ${h.equity.toFixed(4)} %`);
    }
}

if (require.main === module) {
    main().catch(err => { console.error('Ajo epäonnistui:', err); process.exit(1); });
}

module.exports = { buildClassTable };
