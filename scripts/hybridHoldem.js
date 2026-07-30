// Hold'emin preflop-equity useampaa vastustajaa vastaan - hybridimenetelmä.
//
// EKSAKTI pöytien yli: kaikki C(52,5) = 2 598 960 pöytää käydään läpi, joten
// pöytävarianssi häviää kokonaan. Monte Carlo vain vastustajien korttien
// poiston yli, koska useamman vastustajan tapausta ei voi laskea eksaktisti
// (katso docs/eksakti-omaha-equity.md (ei repossa) kohta 5.6).
//
// Virhearvio saadaan riippumattomista toistoista (--replicates): jokainen
// toisto kattaa kaikki pöydät omalla satunnaisvirrallaan, joten toistojen
// keskihajonta on suoraan käyttökelpoinen keskivirhe-estimaatti.
//
// Käyttö:
//   node scripts/hybridHoldem.js [--players 6] [--configs 512] [--replicates 16]
//                                [--workers 30] [--chunk 20000] [--limit N]
//
// Heads-up lasketaan eksaktisti: scripts/exactHoldem.js

const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildClassTable } = require('./exactHoldem');
const { addRankBounds } = require('./rankBounds');
const { sampleSe, replicateMeans, comparisonSe } = require('./replicateStats');

const N_CLASSES = 169;
const N_BOARDS = 2598960;
const REST = 47;

function parseArgs(argv) {
    const o = {
        players: 6, configs: 512, replicates: 16,
        workers: Math.min(30, os.availableParallelism()),
        chunk: 20000, limit: 0
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
            default: console.error(`Tuntematon argumentti: ${argv[i]}`); process.exit(1);
        }
    }
    if (o.players < 3 || o.players > 10) { console.error('--players 3..10 (heads-up: exactHoldem.js)'); process.exit(1); }
    if (o.configs % o.replicates !== 0) {
        console.error('--configs on oltava jaollinen --replicates-arvolla');
        process.exit(1);
    }
    return o;
}

const choose2 = n => n >= 2 ? (n * (n - 1)) / 2 : 0;

function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    if (m > 0) return `${m}min ${s % 60}s`;
    return `${s}s`;
}

async function runWorkers(opts, classOf, state) {
    const chunks = [];
    for (let start = 0; start < state.totalBoards; start += opts.chunk) {
        chunks.push({
            chunk: start / opts.chunk,
            startRank: start,
            count: Math.min(opts.chunk, state.totalBoards - start),
            // Eri satunnaisvirta jokaiselle palaselle; xoshiro128**:n jakso
            // 2^128 tekee päällekkäisyydestä käytännössä mahdotonta
            seed: (0x9e3779b9 ^ Math.imul(start / opts.chunk + 1, 0x85ebca6b)) >>> 0
        });
    }

    console.log(`Palasia: ${chunks.length}, workereita ${opts.workers}`);
    const startTime = Date.now();
    let next = 0, completed = 0, lastLog = 0;

    await new Promise((resolve, reject) => {
        let active = 0;
        for (let w = 0; w < Math.min(opts.workers, chunks.length); w++) {
            const worker = new Worker(path.join(__dirname, 'hybridHoldemWorker.js'), {
                workerData: {
                    classOf, players: opts.players,
                    configs: opts.configs, replicates: opts.replicates
                }
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
                for (let r = 0; r < opts.replicates; r++) {
                    const s = res.share[r], c = res.cnt[r];
                    const S = state.share[r], C = state.cnt[r];
                    for (let i = 0; i < N_CLASSES; i++) { S[i] += s[i]; C[i] += c[i]; }
                }
                state.boardsDone += res.boards;
                completed++;
                const el = Date.now() - startTime;
                if (el - lastLog > 5000 || completed === chunks.length) {
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

function main() {
    const opts = parseArgs(process.argv);
    const heroPool = REST - 2 * (opts.players - 1);
    if (heroPool < 2) { console.error('Liikaa pelaajia'); process.exit(1); }
    const handsPerConfig = choose2(heroPool);
    const totalBoards = opts.limit > 0 ? Math.min(opts.limit, N_BOARDS) : N_BOARDS;

    console.log(`Hold'em, ${opts.players} pelaajaa (${opts.players - 1} vastustajaa)`);
    console.log(`Pöytiä: ${totalBoards.toLocaleString('fi-FI')}${opts.limit ? ' (RAJATTU)' : ' (kaikki)'}, ` +
        `konfiguraatioita/pöytä: ${opts.configs}, toistoja: ${opts.replicates}`);
    console.log(`Heron kortteja/konfiguraatio: ${heroPool} -> ${handsPerConfig.toLocaleString('fi-FI')} kättä pisteytetään kerralla`);

    let t = Date.now();
    console.log('Rakennetaan luokkataulukko...');
    const { classes, classOf } = buildClassTable();
    console.log(`  ${classes.length} luokkaa, ${formatDuration(Date.now() - t)}`);

    const state = {
        totalBoards, boardsDone: 0,
        share: Array.from({ length: opts.replicates }, () => new Float64Array(N_CLASSES)),
        cnt: Array.from({ length: opts.replicates }, () => new Float64Array(N_CLASSES))
    };

    return runWorkers(opts, classOf, state).then(() => {
        // --- Tarkistukset ---
        console.log('\nTarkistukset:');
        let totalCnt = 0;
        for (let r = 0; r < opts.replicates; r++) {
            for (let i = 0; i < N_CLASSES; i++) totalCnt += state.cnt[r][i];
        }
        let totalShare = 0;
        for (let r = 0; r < opts.replicates; r++) {
            for (let i = 0; i < N_CLASSES; i++) totalShare += state.share[r][i];
        }
        const expectedCnt = state.boardsDone * opts.configs * handsPerConfig;
        const cntOk = totalCnt === expectedCnt;
        console.log(`  näytteitä yhteensä: ${totalCnt.toLocaleString('fi-FI')} vs odotus ` +
            `${expectedCnt.toLocaleString('fi-FI')} -> ${cntOk ? 'OK' : 'VIRHE'}`);

        // --- Kokoa tulokset + keskivirheet toistoista ---
        // seCmp: toiston yhteinen siirtymä poistettu - käytetään käsien
        // välisiin vertailuihin (katso scripts/replicateStats.js)
        const { repMean, grandMean } = replicateMeans(state.share, state.cnt);
        const hands = classes.map((c, i) => {
            let s = 0, n = 0;
            const est = [];
            for (let r = 0; r < opts.replicates; r++) {
                s += state.share[r][i];
                n += state.cnt[r][i];
                est.push(100 * state.share[r][i] / state.cnt[r][i]);
            }
            return {
                key: c.key, combos: c.combos,
                equity: 100 * s / n, se: sampleSe(est),
                seCmp: comparisonSe(est, repMean, grandMean), samples: n
            };
        });
        hands.sort((a, b) => b.equity - a.equity || (a.key < b.key ? -1 : 1));
        hands.forEach((h, i) => { h.rank = i + 1; });
        addRankBounds(hands);

        // Kokoava keskiosuus: heron ja vastustajien vaihdannaisuuden nojalla
        // TÄSMÄLLEEN 1/pelaajat odotusarvoltaan, riippumatta pöytäjoukosta.
        // (Kombopainotettu keskiarvo alempana on sama vain kun kaikki pöydät
        // on käyty läpi, koska vasta silloin näytemäärät ovat verrannollisia
        // kombomääriin.)
        const pooled = 100 * totalShare / totalCnt;
        const target0 = 100 / opts.players;
        console.log(`  kokoava keskiosuus: ${pooled.toFixed(6)} % vs odotus ${target0.toFixed(6)} % ` +
            `(ero ${(pooled - target0 >= 0 ? '+' : '') + (pooled - target0).toFixed(6)} pp)`);

        // Painotettu keski-equity pitäisi olla 1/pelaajat
        let wsum = 0, wtot = 0;
        for (const h of hands) { wsum += h.equity * h.combos; wtot += h.combos; }
        const meanEq = wsum / wtot, target = 100 / opts.players;
        if (opts.limit) {
            console.log(`  kombopainotettu keski-equity: ${meanEq.toFixed(6)} % ` +
                `(rajatulla pöytäjoukolla tämä EI ole 1/pelaajat - näytemäärät eivät ole ` +
                `verrannollisia kombomääriin; käytä kokoavaa keskiosuutta)`);
        } else {
            // Huom: käsien virheet ovat voimakkaasti korreloituneita (samat
            // konfiguraatiot), joten yksittäisistä keskivirheistä ei saa
            // mielekästä sigmaa tälle summalle - raportoidaan pelkkä ero.
            console.log(`  kombopainotettu keski-equity: ${meanEq.toFixed(6)} % vs odotus ${target.toFixed(6)} % ` +
                `(ero ${(meanEq - target >= 0 ? '+' : '') + (meanEq - target).toFixed(6)} pp)`);
        }
        const seMed = [...hands].map(h => h.se).sort((a, b) => a - b)[Math.floor(hands.length / 2)];
        console.log(`  keskivirhe (mediaani): ${seMed.toFixed(5)} pp`);

        if (!cntOk) { console.error('\nNäytemäärä ei täsmää - lopetetaan.'); process.exit(1); }

        // --- Validointi eksaktia vastaan kun players = 2 ---
        const exactPath = path.resolve(__dirname, '..', 'data', 'preflop-holdem-2max-exact.json');
        if (opts.players === 2 && !opts.limit && fs.existsSync(exactPath)) {
            const exact = JSON.parse(fs.readFileSync(exactPath, 'utf8'));
            const eq = new Map(exact.hands.map(h => [h.key, h.equity]));
            let maxZ = 0, maxKey = null, sumZ2 = 0, n = 0, within3 = 0;
            for (const h of hands) {
                const e = eq.get(h.key);
                if (e === undefined || !h.se) continue;
                const z = (h.equity - e) / h.se;
                sumZ2 += z * z; n++;
                if (Math.abs(z) <= 3) within3++;
                if (Math.abs(z) > Math.abs(maxZ)) { maxZ = z; maxKey = h.label; }
            }
            console.log('\nValidointi eksaktia heads-up-taulukkoa vastaan:');
            console.log(`  z-arvojen keskihajonta: ${Math.sqrt(sumZ2 / n).toFixed(3)} (odotus 1.000)`);
            console.log(`  |z| <= 3: ${(100 * within3 / n).toFixed(2)} % (odotus 99.73 %)`);
            console.log(`  suurin |z|: ${Math.abs(maxZ).toFixed(2)} (${maxKey})`);
        }

        if (opts.limit) { console.log('\nRajattu ajo - tulostiedostoja ei kirjoiteta.'); return; }

        // --- Tulostiedostot ---
        const dataDir = path.resolve(__dirname, '..', 'data');
        const base = `preflop-holdem-${opts.players}max-hybrid`;
        const round = (x, n) => Number(x.toFixed(n));
        const output = {
            meta: {
                gameType: 'holdem', players: opts.players,
                scenario: `all-in preflop, hero vs. ${opts.players - 1} satunnaista kättä`,
                method: 'hybridi: eksakti kaikkien C(52,5) pöydän yli, Monte Carlo vastustajien korttien poiston yli',
                exact: false,
                boards: totalBoards, configsPerBoard: opts.configs, replicates: opts.replicates,
                handsScoredPerConfig: handsPerConfig,
                totalSamples: totalCnt,
                rng: 'xoshiro128** (jakso 2^128-1), oma virta per palanen',
                handClasses: hands.length,
                generatedAt: new Date().toISOString(),
                script: 'scripts/hybridHoldem.js'
            },
            hands: hands.map(h => ({
                key: h.key, rank: h.rank, combos: h.combos,
                equity: round(h.equity, 5), se: round(h.se, 5), seCmp: round(h.seCmp, 5),
                samples: h.samples, rankLow: h.rankLow, rankHigh: h.rankHigh
            }))
        };
        fs.writeFileSync(path.join(dataDir, base + '.json'), JSON.stringify(output, null, 2) + '\n');
        const lines = ['rank,hand,combos,equity_pct,std_error_pp,std_error_cmp_pp,samples,rank_low,rank_high'];
        for (const h of hands) {
            lines.push([h.rank, h.key, h.combos, round(h.equity, 5), round(h.se, 5), round(h.seCmp, 5), h.samples, h.rankLow, h.rankHigh].join(','));
        }
        fs.writeFileSync(path.join(dataDir, base + '.csv'), lines.join('\n') + '\n');
        console.log(`\nKirjoitettu: data/${base}.json ja .csv`);

        console.log('\nTop 10:');
        for (const h of hands.slice(0, 10)) {
            console.log(`  ${String(h.rank).padStart(2)}. ${h.key.padEnd(4)} ${h.equity.toFixed(4)} % ± ${h.se.toFixed(4)}`);
        }
    });
}

if (require.main === module) {
    main().catch(err => { console.error('Ajo epäonnistui:', err); process.exit(1); });
}
