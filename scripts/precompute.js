// Offline-eräajo: esilaskee kaikkien kanonisten Hold'em-aloituskäsien
// equityn skenaariossa "hero + N satunnaista vastustajaa, all-in preflop".
//
// Tämä skripti on täysin erillinen palvelimesta - se ei muuta mitään
// olemassa olevaa API:a tai sivua. Tulokset kirjoitetaan data/-hakemistoon
// sekä JSON- että CSV-muodossa.
//
// Käyttö:
//   node scripts/precompute.js [--game holdem|omaha] [--players 6]
//                              [--sims 1000000] [--workers 16] [--seed 20260724]
//                              [--csv-style std|fi] [--max-minutes 60]
//
// --max-minutes keskeyttää ajon siististi aikarajan täytyttyä: kesken olevat
// kädet lasketaan loppuun, checkpoint jää talteen ja ajoa jatketaan
// suorittamalla täsmälleen sama komento uudelleen (samat --sims, --players,
// --seed). Lopulliset JSON/CSV-tiedostot kirjoitetaan vasta kun kaikki
// käsiluokat on laskettu.
//
// CSV kirjoitetaan oletuksena standardimuodossa (pilkkuerotin, desimaalipiste).
// --csv-style fi tuottaa suomalaiseen Exceliin sopivan muodon (puolipiste,
// desimaalipilkku, UTF-8 BOM).
//
// Tiedostonimet sisältävät simulaatiomäärän (esim. preflop-holdem-6max-1m.json),
// joten eri tarkkuuksilla ajetut tulokset eivät ylikirjoita toisiaan.
//
// Ajo kirjoittaa checkpointin (JSONL) rivi kerrallaan, joten keskeytetyn
// ajon voi käynnistää uudelleen ja jo lasketut kädet ohitetaan. Jos valmis
// tulostiedosto samoilla parametreilla on jo olemassa, simulointi ohitetaan
// ja vain tulostiedostot kirjoitetaan uudelleen (esim. CSV-tyylin vaihto).

const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { enumerateHoldemCanonical, enumerateOmahaCanonical, describeOmahaKey } = require('../canonical');

// --- Komentoriviargumentit ---------------------------------------------

function parseArgs(argv) {
    const opts = {
        game: 'holdem',
        players: 6,
        sims: 1000000,
        workers: Math.min(16, os.availableParallelism()),
        seed: 20260724,
        csvStyle: 'std',
        maxMinutes: 0 // 0 = ei aikarajaa
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const value = argv[i + 1];
        switch (arg) {
            case '--game': opts.game = value; i++; break;
            case '--players': opts.players = parseInt(value, 10); i++; break;
            case '--sims': opts.sims = parseInt(value, 10); i++; break;
            case '--workers': opts.workers = parseInt(value, 10); i++; break;
            case '--seed': opts.seed = parseInt(value, 10); i++; break;
            case '--csv-style': opts.csvStyle = value; i++; break;
            case '--max-minutes': opts.maxMinutes = parseFloat(value); i++; break;
            default:
                console.error(`Tuntematon argumentti: ${arg}`);
                process.exit(1);
        }
    }
    if (opts.game !== 'holdem' && opts.game !== 'omaha') {
        console.error('--game oltava holdem tai omaha (omaha5: kanonisointia ei ole vielä toteutettu)');
        process.exit(1);
    }
    if (!Number.isInteger(opts.players) || opts.players < 2 || opts.players > 10) {
        console.error('--players oltava 2-10');
        process.exit(1);
    }
    if (!Number.isInteger(opts.sims) || opts.sims < 1000) {
        console.error('--sims oltava vähintään 1000');
        process.exit(1);
    }
    if (!Number.isInteger(opts.workers) || opts.workers < 1) {
        console.error('--workers oltava vähintään 1');
        process.exit(1);
    }
    if (!Number.isInteger(opts.seed)) {
        console.error('--seed oltava kokonaisluku');
        process.exit(1);
    }
    if (opts.csvStyle !== 'fi' && opts.csvStyle !== 'std') {
        console.error('--csv-style oltava std (pilkku + desimaalipiste, oletus) tai fi (Excel: puolipiste + desimaalipilkku)');
        process.exit(1);
    }
    if (!Number.isFinite(opts.maxMinutes) || opts.maxMinutes < 0) {
        console.error('--max-minutes oltava positiivinen luku (minuutteja)');
        process.exit(1);
    }
    return opts;
}

// --- Apufunktiot --------------------------------------------------------

/**
 * Muotoilee simulaatiomäärän tiedostonimeen: 1000000 -> "1m", 250000 -> "250k"
 * @param {number} sims
 * @returns {string}
 */
function formatSims(sims) {
    if (sims % 1000000 === 0) return `${sims / 1000000}m`;
    if (sims % 1000 === 0) return `${sims / 1000}k`;
    return String(sims);
}

/**
 * Muotoilee millisekunnit luettavaksi kestoksi: "2h 13min", "5min 30s", "42s"
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}min`;
    if (m > 0) return `${m}min ${s}s`;
    return `${s}s`;
}

/**
 * Rakentaa CSV-sisällön ranking-taulukosta.
 * 'fi'  = puolipiste-erotin + desimaalipilkku + UTF-8 BOM (aukeaa suoraan
 *         suomalaisessa Excelissä oikeisiin sarakkeisiin)
 * 'std' = pilkkuerotin + desimaalipiste (yleinen CSV-muoto)
 * @param {Array} hands - Lopulliset käsirivit (rank, key, combos, equity, win, tie)
 * @param {string} style - 'fi' | 'std'
 * @returns {string}
 */
function buildCsv(hands, style) {
    const fi = style === 'fi';
    const sep = fi ? ';' : ',';
    const num = v => (fi ? String(v).replace('.', ',') : String(v));
    // Omaha-riveillä on ihmisluettava label-sarake (esim. "AAKK (ds)")
    const hasLabel = hands.length > 0 && hands[0].label !== undefined;
    const header = fi
        ? ['sija', 'käsi', ...(hasLabel ? ['nimi'] : []), 'kombot', 'equity_%', 'voitto_%', 'tasapeli_%']
        : ['rank', 'hand', ...(hasLabel ? ['label'] : []), 'combos', 'equity_pct', 'win_pct', 'tie_pct'];

    const lines = [header.join(sep)];
    for (const h of hands) {
        lines.push([
            h.rank, h.key,
            ...(hasLabel ? [h.label] : []),
            h.combos, num(h.equity), num(h.win), num(h.tie)
        ].join(sep));
    }
    // BOM auttaa Exceliä tunnistamaan UTF-8:n (ä-kirjaimet otsikossa)
    return (fi ? '\uFEFF' : '') + lines.join('\n') + '\n';
}

/**
 * Lukee checkpoint-tiedoston ja palauttaa validit, tämän ajon parametreja
 * vastaavat tulokset. Eri parametreilla lasketut rivit ohitetaan.
 */
function readCheckpoint(checkpointPath, opts) {
    const done = new Map();
    if (!fs.existsSync(checkpointPath)) {
        return done;
    }
    const lines = fs.readFileSync(checkpointPath, 'utf8').split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try {
            entry = JSON.parse(line);
        } catch {
            continue; // keskeytynyt kirjoitus - ohita rikkinäinen rivi
        }
        if (entry.simulations === opts.sims &&
            entry.players === opts.players &&
            entry.seed === opts.seed &&
            typeof entry.key === 'string') {
            done.set(entry.key, entry);
        }
    }
    return done;
}

/**
 * Jos valmis tulostiedosto on jo olemassa täsmälleen samoilla parametreilla,
 * palauttaa sen käsirivit - simulointia ei tarvitse toistaa (sama seed
 * tuottaisi joka tapauksessa identtisen tuloksen).
 */
function readExistingOutput(outputPath, opts) {
    if (!fs.existsSync(outputPath)) {
        return null;
    }
    try {
        const data = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        const meta = data.meta || {};
        if (meta.gameType === opts.game &&
            meta.players === opts.players &&
            meta.simulationsPerHand === opts.sims &&
            meta.seed === opts.seed &&
            Array.isArray(data.hands) &&
            data.hands.length > 0) {
            return data.hands;
        }
    } catch {
        // rikkinäinen tiedosto - lasketaan uudelleen
    }
    return null;
}

// --- Simulointi ---------------------------------------------------------

async function runSimulations(classes, opts, checkpointPath) {
    const opponents = opts.players - 1;
    const done = readCheckpoint(checkpointPath, opts);
    const queue = classes.filter(c => !done.has(c.key));

    console.log(`Käsiluokkia: ${classes.length}, checkpointista valmiina: ${done.size}, laskettavana: ${queue.length}`);

    if (queue.length > 0) {
        const workerCount = Math.min(opts.workers, queue.length);
        console.log(`Käynnistetään ${workerCount} workeria...`);
        const startTime = Date.now();
        // Aikaraja: uusia käsiä ei aloiteta deadlinen jälkeen, kesken
        // olevat lasketaan loppuun (checkpoint pysyy eheänä)
        const deadline = opts.maxMinutes > 0 ? startTime + opts.maxMinutes * 60000 : Infinity;
        let completed = 0;
        let nextIndex = 0;
        let deadlineHit = false;

        await new Promise((resolve, reject) => {
            let active = 0;
            let failed = false;

            for (let w = 0; w < workerCount; w++) {
                const worker = new Worker(path.join(__dirname, 'precomputeWorker.js'));
                active++;

                const retire = () => {
                    worker.terminate();
                    active--;
                    if (active === 0 && !failed) {
                        resolve();
                    }
                };

                const assignNext = () => {
                    if (Date.now() >= deadline) {
                        deadlineHit = true;
                        retire();
                        return;
                    }
                    if (nextIndex >= queue.length) {
                        retire();
                        return;
                    }
                    const cls = queue[nextIndex++];
                    worker.postMessage({
                        key: cls.key,
                        hand: cls.hand,
                        opponents,
                        simulations: opts.sims,
                        seed: opts.seed,
                        gameType: opts.game
                    });
                };

                worker.on('message', (result) => {
                    const entry = {
                        key: result.key,
                        wins: result.wins,
                        ties: result.ties,
                        equitySum: result.equitySum,
                        simulations: opts.sims,
                        players: opts.players,
                        seed: opts.seed
                    };
                    done.set(entry.key, entry);
                    // Checkpoint heti levylle - ajon voi keskeyttää turvallisesti
                    fs.appendFileSync(checkpointPath, JSON.stringify(entry) + '\n');

                    completed++;
                    const equityPct = (100 * result.equitySum / opts.sims).toFixed(2);
                    const elapsedMs = Date.now() - startTime;
                    const etaMs = (elapsedMs / completed) * (queue.length - completed);
                    console.log(`[${completed}/${queue.length}] ${result.key.padEnd(8)} equity ${equityPct}%  ` +
                        `(kulunut ${formatDuration(elapsedMs)}, jäljellä ~${formatDuration(etaMs)})`);

                    assignNext();
                });

                worker.on('error', (err) => {
                    failed = true;
                    worker.terminate();
                    reject(err);
                });

                assignNext();
            }
        });

        console.log(`Erä valmis: ${completed} kättä ${formatDuration(Date.now() - startTime)} aikana.`);
        if (deadlineHit) {
            console.log('Aikaraja (--max-minutes) täyttyi.');
        }
    }

    if (done.size < classes.length) {
        return { complete: false, doneCount: done.size, total: classes.length, hands: null };
    }

    // Kokoa lopulliset rivit: ranking equityn mukaan
    const combosByKey = new Map(classes.map(c => [c.key, c.combos]));
    const hands = [...done.values()]
        .sort((a, b) => b.equitySum - a.equitySum)
        .map((entry, index) => ({
            key: entry.key,
            rank: index + 1,
            combos: combosByKey.get(entry.key),
            equity: Number((100 * entry.equitySum / entry.simulations).toFixed(4)),
            win: Number((100 * entry.wins / entry.simulations).toFixed(4)),
            tie: Number((100 * entry.ties / entry.simulations).toFixed(4))
        }));
    return { complete: true, hands };
}

// --- Pääohjelma ---------------------------------------------------------

async function main() {
    const opts = parseArgs(process.argv);

    const dataDir = path.resolve(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const baseName = `preflop-${opts.game}-${opts.players}max-${formatSims(opts.sims)}`;
    const checkpointPath = path.join(dataDir, `${baseName}.checkpoint.jsonl`);
    const outputPath = path.join(dataDir, `${baseName}.json`);
    const csvPath = path.join(dataDir, `${baseName}.csv`);

    console.log(`Peli: ${opts.game}, pelaajia: ${opts.players}, simulaatioita/käsi: ${opts.sims}, seed: ${opts.seed}`);

    let classes;
    if (opts.game === 'omaha') {
        console.log('Enumeroidaan kanoniset Omaha-kädet (kestää muutaman sekunnin)...');
        classes = enumerateOmahaCanonical();
    } else {
        classes = enumerateHoldemCanonical();
    }

    // Ohita simulointi, jos identtinen ajo on jo tehty
    let hands = readExistingOutput(outputPath, opts);
    if (hands) {
        console.log(`Valmis tulos löytyi (${outputPath}) - simulointia ei toisteta, kirjoitetaan tulostiedostot.`);
    } else {
        const result = await runSimulations(classes, opts, checkpointPath);
        if (!result.complete) {
            console.log(`\nLaskettu ${result.doneCount}/${result.total} käsiluokkaa. Checkpoint tallessa:`);
            console.log(`  ${checkpointPath}`);
            console.log('Jatka ajamalla täsmälleen sama komento uudelleen (samat --sims, --players ja --seed).');
            console.log('Lopulliset JSON/CSV-tiedostot kirjoitetaan vasta kun kaikki luokat on laskettu.');
            return;
        }
        hands = result.hands;
    }

    // Omaha: lisää ihmisluettava luokkanimi avaimen rinnalle. Tehdään myös
    // uudelleenkäytetyille riveille, jotta vanhat tulokset saavat labelin.
    if (opts.game === 'omaha') {
        hands = hands.map(h => ({
            key: h.key,
            label: describeOmahaKey(h.key),
            rank: h.rank,
            combos: h.combos,
            equity: h.equity,
            win: h.win,
            tie: h.tie
        }));
    }

    const output = {
        meta: {
            gameType: opts.game,
            players: opts.players,
            scenario: 'all-in preflop, hero vs. satunnaiset vastustajat',
            simulationsPerHand: opts.sims,
            seed: opts.seed,
            handClasses: hands.length,
            generatedAt: new Date().toISOString(),
            script: 'scripts/precompute.js'
        },
        hands
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
    console.log(`Kirjoitettu: ${outputPath} (${hands.length} käsiluokkaa)`);

    fs.writeFileSync(csvPath, buildCsv(hands, opts.csvStyle));
    console.log(`Kirjoitettu: ${csvPath} (csv-tyyli: ${opts.csvStyle})`);

    // Checkpoint ei ole enää tarpeen onnistuneen ajon jälkeen
    fs.rmSync(checkpointPath, { force: true });

    // Pieni järkevyysraportti
    console.log('\nTop 5:');
    for (const h of hands.slice(0, 5)) {
        console.log(`  ${h.rank}. ${h.key.padEnd(8)} ${h.equity.toFixed(2)}%`);
    }
    console.log('Heikoimmat 3:');
    for (const h of hands.slice(-3)) {
        console.log(`  ${h.rank}. ${h.key.padEnd(8)} ${h.equity.toFixed(2)}%`);
    }
}

module.exports = { parseArgs, formatSims, buildCsv };

if (require.main === module) {
    main().catch((err) => {
        console.error('Eräajo epäonnistui:', err);
        process.exit(1);
    });
}
