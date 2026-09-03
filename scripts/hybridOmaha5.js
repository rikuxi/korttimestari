// 5 kortin Omahan preflop-equity - hybridimenetelmä, keskeytettävissä.
//
// EKSAKTI kaikkien C(52,5) = 2 598 960 pöydän yli, Monte Carlo vain
// vastustajien korttien poiston yli (docs/eksakti-omaha-equity.md (ei repossa) kohta 5.6).
//
// Omaha5:ssä käsiluokkia on 134 459 eli kahdeksankertaisesti nelikorttiseen
// verrattuna, joten ajo kestää tunteja. Siksi tämä kirjoittaa checkpointin:
// keskeytetyn ajon voi jatkaa samalla komennolla, ja jo lasketut palaset
// ohitetaan.
//
// Käyttö:
//   node scripts/hybridOmaha5.js [--players 6] [--configs 64] [--replicates 8]
//                                [--workers 30] [--chunk 2000] [--limit N]
//                                [--max-minutes 0] [--restart]

const { formatDuration, runPool, chunkSeed } = require('./batchCommon');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { enumerateOmaha5Canonical, canonicalizeOmaha5, describeOmahaKey, omahaNotation } = require('../canonical');
const { intToCard } = require('../public/js/engine');
const { addRankBounds } = require('./rankBounds');
const { sampleSe, replicateMeans, comparisonSe } = require('./replicateStats');

const N_BOARDS = 2598960;
const REST = 47;
const N_COMBOS = 2598960;      // C(52,5) konkreettista kättä
const CHECKPOINT_MAGIC = 0x4f4d4835;   // "OMH5"
// Float64Array vaatii 8 tavun kohdistuksen, joten bittikartta pehmustetaan
// seuraavaan kahdeksan tavun rajaan - muuten sitä seuraavat summat eivät
// ole luettavissa ja checkpoint hylätään hiljaa
const align8 = n => Math.ceil(n / 8) * 8;

function parseArgs(argv) {
    const o = {
        players: 6, configs: 64, replicates: 8,
        workers: Math.min(30, os.availableParallelism()),
        chunk: 2000, limit: 0, maxMinutes: 0, restart: false
    };
    for (let i = 2; i < argv.length; i++) {
        const v = argv[i + 1];
        switch (argv[i]) {
            case '--players': o.players = parseInt(v, 10); i++; break;
            case '--configs': o.configs = parseInt(v, 10); i++; break;
            case '--replicates': o.replicates = parseInt(v, 10); i++; break;
            case '--workers': o.workers = parseInt(v, 10); i++; break;
            case '--chunk': o.chunk = parseInt(v, 10); i++; break;
            case '--limit': o.limit = parseInt(v, 10); i++; break;
            case '--max-minutes': o.maxMinutes = parseFloat(v); i++; break;
            case '--restart': o.restart = true; break;
            default: console.error(`Tuntematon argumentti: ${argv[i]}`); process.exit(1);
        }
    }
    if (o.players < 2 || o.players > 9) { console.error('--players 2..9'); process.exit(1); }
    if (o.configs % o.replicates !== 0) {
        console.error('--configs on oltava jaollinen --replicates-arvolla'); process.exit(1);
    }
    if (REST - 5 * (o.players - 1) < 5) { console.error('Liikaa pelaajia'); process.exit(1); }
    return o;
}

const choose5 = n => n >= 5 ? (n * (n - 1) * (n - 2) * (n - 3) * (n - 4)) / 120 : 0;

// --- Luokkataulukko -----------------------------------------------------
//
// C(52,5) = 2 598 960 kombinaatiota -> 134 459 luokkaa. Rakentaminen kestää
// puolisen minuuttia, joten tulos välimuistitetaan levylle: keskeytetyn ajon
// jatkaminen ei saa maksaa sitä uudelleen.

function buildClassTable(dataDir) {
    const cachePath = path.join(dataDir, 'omaha5-class-table.bin');
    const listPath = path.join(dataDir, 'omaha5-classes.json');

    // Enumerointi kestää parikymmentä sekuntia, joten sekin välimuistitetaan:
    // keskeytetyn ajon jatkaminen ei saa maksaa sitä joka kerta
    if (fs.existsSync(cachePath) && fs.existsSync(listPath)) {
        try {
            const buf = fs.readFileSync(cachePath);
            const classes = JSON.parse(fs.readFileSync(listPath, 'utf8'));
            if (buf.length === N_COMBOS * 4 && Array.isArray(classes) && classes.length > 0) {
                const sab = new SharedArrayBuffer(N_COMBOS * 4);
                new Uint8Array(sab).set(buf);
                return { classes, classOfBuffer: sab, fromCache: true };
            }
        } catch (e) {
            // rikkinäinen välimuisti - rakennetaan uudelleen
        }
    }

    const classes = enumerateOmaha5Canonical()
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const indexOf = new Map(classes.map((c, i) => [c.key, i]));
    const sab = new SharedArrayBuffer(N_COMBOS * 4);
    const classOf = new Uint32Array(sab);
    const G = [];
    for (let k = 1; k <= 5; k++) {
        G[k] = new Float64Array(53);
        for (let n = 0; n <= 52; n++) {
            let r = 1;
            for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
            G[k][n] = n >= k ? Math.round(r) : 0;
        }
    }
    const str = [];
    for (let c = 0; c < 52; c++) str[c] = intToCard(c);

    let filled = 0;
    const hand = new Array(5);
    for (let e = 4; e < 52; e++) {
        hand[4] = str[e];
        for (let d = 3; d < e; d++) {
            hand[3] = str[d];
            for (let c = 2; c < d; c++) {
                hand[2] = str[c];
                for (let b = 1; b < c; b++) {
                    hand[1] = str[b];
                    const base = G[5][e] + G[4][d] + G[3][c] + G[2][b];
                    for (let a = 0; a < b; a++) {
                        hand[0] = str[a];
                        const idx = indexOf.get(canonicalizeOmaha5(hand));
                        if (idx === undefined) throw new Error('Tuntematon luokka');
                        classOf[base + a] = idx;
                        filled++;
                    }
                }
            }
        }
    }
    if (filled !== N_COMBOS) throw new Error(`Täytettiin ${filled} / ${N_COMBOS}`);
    fs.writeFileSync(cachePath, Buffer.from(sab));
    fs.writeFileSync(listPath, JSON.stringify(classes.map(c => ({ key: c.key, combos: c.combos }))));
    return { classes, classOfBuffer: sab, fromCache: false };
}

// --- Checkpoint ---------------------------------------------------------
//
// Binäärimuoto, koska kertyneet summat ovat 134 459 x toistot x 2 lukua:
// JSON+base64 kolminkertaistaisi koon ja kirjoitusajan.

function checkpointPath(dataDir, players) {
    return path.join(dataDir, `preflop-omaha5-${players}max.checkpoint.bin`);
}

function saveCheckpoint(file, opts, state) {
    const header = new Int32Array(8);
    header[0] = CHECKPOINT_MAGIC;
    header[1] = 1;                       // versio
    header[2] = opts.players;
    header[3] = opts.configs;
    header[4] = opts.replicates;
    header[5] = opts.chunk;
    header[6] = state.totalChunks;
    header[7] = state.classes;

    const bitmap = Buffer.alloc(align8(state.totalChunks));
    Buffer.from(state.done.buffer).copy(bitmap);
    const parts = [Buffer.from(header.buffer),
        Buffer.from(new Float64Array([state.boardsDone]).buffer), bitmap];
    for (let r = 0; r < opts.replicates; r++) parts.push(Buffer.from(state.share[r].buffer));
    for (let r = 0; r < opts.replicates; r++) parts.push(Buffer.from(state.cnt[r].buffer));

    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, Buffer.concat(parts));
    fs.renameSync(tmp, file);
}

function loadCheckpoint(file, opts, totalChunks, classes) {
    if (!fs.existsSync(file)) return null;
    try {
        const buf = fs.readFileSync(file);
        const header = new Int32Array(buf.buffer, buf.byteOffset, 8);
        if (header[0] !== CHECKPOINT_MAGIC || header[1] !== 1) return null;
        if (header[2] !== opts.players || header[3] !== opts.configs ||
            header[4] !== opts.replicates || header[5] !== opts.chunk ||
            header[6] !== totalChunks || header[7] !== classes) {
            console.log('Checkpoint on eri parametreilla - ohitetaan.');
            return null;
        }
        let off = buf.byteOffset + 32;
        const boardsDone = new Float64Array(buf.buffer, off, 1)[0]; off += 8;
        const done = new Uint8Array(totalChunks);
        done.set(new Uint8Array(buf.buffer, off, totalChunks)); off += align8(totalChunks);
        const share = [], cnt = [];
        for (let r = 0; r < opts.replicates; r++) {
            share.push(Float64Array.from(new Float64Array(buf.buffer, off, classes))); off += classes * 8;
        }
        for (let r = 0; r < opts.replicates; r++) {
            cnt.push(Float64Array.from(new Float64Array(buf.buffer, off, classes))); off += classes * 8;
        }
        return { boardsDone, done, share, cnt };
    } catch (e) {
        console.log('Checkpoint rikki - aloitetaan alusta.');
        return null;
    }
}

// --- Laskenta -----------------------------------------------------------

async function runWorkers(opts, classOfBuffer, state, cpFile) {
    const pending = [];
    for (let c = 0; c < state.totalChunks; c++) {
        if (!state.done[c]) {
            pending.push({
                chunk: c,
                startRank: c * opts.chunk,
                count: Math.min(opts.chunk, state.totalBoards - c * opts.chunk),
                seed: chunkSeed(c)
            });
        }
    }
    console.log(`Palasia laskettavana: ${pending.length} / ${state.totalChunks}, workereita ${opts.workers}`);
    if (pending.length === 0) return true;

    const startTime = Date.now();
    let lastSave = startTime;
    const { elapsed, stopped } = await runPool({
        workerFile: path.join(__dirname, 'hybridOmaha5Worker.js'),
        workerData: {
            classOfBuffer, players: opts.players,
            configs: opts.configs, replicates: opts.replicates, classes: state.classes
        },
        chunks: pending, workers: opts.workers, logEvery: 10000,
        deadline: opts.maxMinutes > 0 ? startTime + opts.maxMinutes * 60000 : Infinity,
        progress: () => `${state.boardsDone.toLocaleString('fi-FI')} pöytää`,
        onResult: (res) => {
            for (let r = 0; r < opts.replicates; r++) {
                const s = res.share[r], c = res.cnt[r];
                const S = state.share[r], C = state.cnt[r];
                for (let i = 0; i < state.classes; i++) { S[i] += s[i]; C[i] += c[i]; }
            }
            state.done[res.chunk] = 1;
            state.boardsDone += res.boards;
            if (Date.now() - lastSave > 120000) {
                lastSave = Date.now();
                saveCheckpoint(cpFile, opts, state);
            }
        }
    });

    saveCheckpoint(cpFile, opts, state);
    console.log(`Erä valmis ${formatDuration(elapsed)} aikana.`);
    if (stopped) console.log('Aikaraja (--max-minutes) täyttyi.');
    return state.done.every(x => x === 1);
}

// --- Pääohjelma ---------------------------------------------------------

async function main() {
    const opts = parseArgs(process.argv);
    const dataDir = path.resolve(__dirname, '..', 'data');
    const heroPool = REST - 5 * (opts.players - 1);
    const handsPerConfig = choose5(heroPool);
    const totalBoards = opts.limit > 0 ? Math.min(opts.limit, N_BOARDS) : N_BOARDS;
    const totalChunks = Math.ceil(totalBoards / opts.chunk);

    console.log(`Omaha5, ${opts.players} pelaajaa (${opts.players - 1} vastustajaa)`);
    console.log(`Pöytiä: ${totalBoards.toLocaleString('fi-FI')}${opts.limit ? ' (RAJATTU)' : ''}, ` +
        `konfiguraatioita/pöytä: ${opts.configs}, toistoja: ${opts.replicates}`);
    console.log(`Heron kortteja/konfiguraatio: ${heroPool} -> ${handsPerConfig.toLocaleString('fi-FI')} kättä kerralla`);

    let t = Date.now();
    console.log('Luokkataulukko...');
    const { classes, classOfBuffer, fromCache } = buildClassTable(dataDir);
    console.log(`  ${classes.length.toLocaleString('fi-FI')} luokkaa, ${formatDuration(Date.now() - t)}` +
        `${fromCache ? ' (välimuistista)' : ''}`);

    const cpFile = checkpointPath(dataDir, opts.players);
    if (opts.restart) fs.rmSync(cpFile, { force: true });
    const restored = opts.limit ? null : loadCheckpoint(cpFile, opts, totalChunks, classes.length);

    const state = {
        totalBoards, totalChunks, classes: classes.length,
        boardsDone: restored ? restored.boardsDone : 0,
        done: restored ? restored.done : new Uint8Array(totalChunks),
        share: restored ? restored.share : Array.from({ length: opts.replicates }, () => new Float64Array(classes.length)),
        cnt: restored ? restored.cnt : Array.from({ length: opts.replicates }, () => new Float64Array(classes.length))
    };
    if (restored) {
        const doneChunks = state.done.reduce((a, b) => a + b, 0);
        console.log(`Checkpointista jatketaan: ${doneChunks}/${totalChunks} palasta, ` +
            `${state.boardsDone.toLocaleString('fi-FI')} pöytää valmiina.`);
    }

    const complete = await runWorkers(opts, classOfBuffer, state, cpFile);

    if (!complete) {
        console.log('\nAjo on kesken. Jatka samalla komennolla - checkpoint on tallessa:');
        console.log(`  ${cpFile}`);
        return;
    }

    // --- Tarkistukset ---
    console.log('\nTarkistukset:');
    let totalCnt = 0, totalShare = 0;
    for (let r = 0; r < opts.replicates; r++) {
        for (let i = 0; i < state.classes; i++) { totalCnt += state.cnt[r][i]; totalShare += state.share[r][i]; }
    }
    const expectedCnt = state.boardsDone * opts.configs * handsPerConfig;
    const cntOk = totalCnt === expectedCnt;
    console.log(`  näytteitä yhteensä: ${totalCnt.toLocaleString('fi-FI')} vs odotus ` +
        `${expectedCnt.toLocaleString('fi-FI')} -> ${cntOk ? 'OK' : 'VIRHE'}`);
    const pooled = 100 * totalShare / totalCnt, target = 100 / opts.players;
    console.log(`  kokoava keskiosuus: ${pooled.toFixed(6)} % vs odotus ${target.toFixed(6)} % ` +
        `(ero ${(pooled - target >= 0 ? '+' : '') + (pooled - target).toFixed(6)} pp)`);
    if (!cntOk) { console.error('\nNäytemäärä ei täsmää - lopetetaan.'); process.exit(1); }

    // --- Tulokset ---
    // seCmp: toiston yhteinen siirtymä poistettu - käytetään käsien
    // välisiin vertailuihin (katso scripts/replicateStats.js)
    const { repMean, grandMean } = replicateMeans(state.share, state.cnt);
    const hands = classes.map((c, i) => {
        let s = 0, n = 0;
        const est = [];
        for (let r = 0; r < opts.replicates; r++) {
            s += state.share[r][i]; n += state.cnt[r][i];
            est.push(100 * state.share[r][i] / state.cnt[r][i]);
        }
        return {
            key: c.key, label: describeOmahaKey(c.key), notation: omahaNotation(c.key), combos: c.combos,
            equity: 100 * s / n, se: sampleSe(est),
            seCmp: comparisonSe(est, repMean, grandMean), samples: n
        };
    });
    hands.sort((a, b) => b.equity - a.equity || (a.key < b.key ? -1 : 1));
    hands.forEach((h, i) => { h.rank = i + 1; });
    addRankBounds(hands);

    const seMed = [...hands].map(h => h.se).sort((a, b) => a - b)[Math.floor(hands.length / 2)];
    console.log(`  keskivirhe (mediaani): ${seMed.toFixed(5)} pp`);
    let wsum = 0, wtot = 0;
    for (const h of hands) { wsum += h.equity * h.combos; wtot += h.combos; }
    console.log(`  kombopainotettu keski-equity: ${(wsum / wtot).toFixed(6)} % vs odotus ${target.toFixed(6)} %`);

    if (opts.limit) { console.log('\nRajattu ajo - tulostiedostoja ei kirjoiteta.'); return; }

    const base = `preflop-omaha5-${opts.players}max-hybrid`;
    const round = (x, n) => Number(x.toFixed(n));
    const output = {
        meta: {
            gameType: 'omaha5', players: opts.players,
            scenario: `all-in preflop, hero vs. ${opts.players - 1} satunnaista kättä`,
            method: 'hybridi: eksakti kaikkien C(52,5) pöydän yli, Monte Carlo vastustajien korttien poiston yli',
            exact: false,
            boards: totalBoards, configsPerBoard: opts.configs, replicates: opts.replicates,
            handsScoredPerConfig: handsPerConfig, totalSamples: totalCnt,
            rng: 'xoshiro128** (jakso 2^128-1), oma virta per palanen ja toisto',
            handClasses: hands.length,
            generatedAt: new Date().toISOString(),
            script: 'scripts/hybridOmaha5.js'
        },
        hands: hands.map(h => ({
            key: h.key, label: h.label, notation: h.notation, rank: h.rank, combos: h.combos,
            equity: round(h.equity, 5), se: round(h.se, 5), seCmp: round(h.seCmp, 5),
            samples: h.samples, rankLow: h.rankLow, rankHigh: h.rankHigh
        }))
    };
    fs.writeFileSync(path.join(dataDir, base + '.json'), JSON.stringify(output, null, 2) + '\n');
    const lines = ['rank,hand,label,notation,combos,equity_pct,std_error_pp,std_error_cmp_pp,samples,rank_low,rank_high'];
    for (const h of hands) {
        lines.push([h.rank, h.key, h.label, h.notation, h.combos, round(h.equity, 5), round(h.se, 5), round(h.seCmp, 5), h.samples, h.rankLow, h.rankHigh].join(','));
    }
    fs.writeFileSync(path.join(dataDir, base + '.csv'), lines.join('\n') + '\n');
    console.log(`\nKirjoitettu: data/${base}.json ja .csv`);
    fs.rmSync(cpFile, { force: true });

    console.log('\nTop 10:');
    for (const h of hands.slice(0, 10)) {
        console.log(`  ${String(h.rank).padStart(2)}. ${h.label.padEnd(14)} ${h.equity.toFixed(4)} % ± ${h.se.toFixed(4)}`);
    }
}

if (require.main === module) {
    main().catch(err => { console.error('Ajo epäonnistui:', err); process.exit(1); });
}
