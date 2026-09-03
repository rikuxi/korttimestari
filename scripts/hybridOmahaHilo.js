// Omaha Hi/Lo (8-or-better) -preflop-equity useampaa vastustajaa vastaan -
// hybridimenetelmä.
//
// EKSAKTI pöytien yli: kaikki C(52,5) = 2 598 960 pöytää käydään läpi, joten
// pöytävarianssi häviää kokonaan. Monte Carlo vain vastustajien korttien
// poiston yli, koska useamman vastustajan tapausta ei voi laskea eksaktisti.
// Sama rakenne kuin scripts/hybridOmaha.js:ssä; menetelmä ja low-puolen
// koodaus on kuvattu tiedostossa scripts/hybridOmahaHiloWorker.js.
//
// Virhearvio saadaan riippumattomista toistoista (--replicates): jokainen
// toisto kattaa kaikki pöydät omalla satunnaisvirrallaan, joten toistojen
// keskihajonta on suoraan käyttökelpoinen keskivirhe-estimaatti.
//
// Käyttö:
//   node scripts/hybridOmahaHilo.js [--players 3] [--configs 32]
//        [--replicates 16] [--workers 30] [--chunk 4000] [--limit N]
//
// --limit rajaa pöytien määrän (savutesti; tulostiedostoja ei kirjoiteta).
// Ajon voi keskeyttää: checkpoint tallennetaan parin minuutin välein ja sama
// komento jatkaa siitä mihin jäätiin.

const { formatDuration, runPool, chunkSeed } = require('./batchCommon');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { describeOmahaKey, omahaNotation } = require('../canonical');
const { buildClassTable } = require('./exactOmaha');
const { addRankBounds } = require('./rankBounds');
const { sampleSe, replicateMeans, comparisonSe } = require('./replicateStats');

const N_CLASSES = 16432;
const N_BOARDS = 2598960;
const REST = 47;
const UNIT = 5040;               // koko potti kokonaislukuyksiköissä
const REP_SLOTS = 4;             // osuus, hi-osuus, näytteet, (varalla)
const FRQ_SLOTS = 8;

// Pöytiä joilla kelvollinen low on ylipäätään mahdollinen (vähintään kolme
// eri arvoa <= 8, ässä matalana). Eksakti kombinatorinen luku, varmistettu
// erikseen; toimii low-esivalmistelun riippumattomana tarkistuksena.
const LOW_BOARDS = 1561728;

// Taajuussarjat frq-taulukossa, samassa järjestyksessä kuin työläisessä
const FREQ = [
    { key: 'hiWin', csv: 'hi_win_pct', desc: 'korkea puolisko voitetaan yksin' },
    { key: 'hiTie', csv: 'hi_tie_pct', desc: 'korkea puolisko jaetaan' },
    { key: 'loWin', csv: 'lo_win_pct', desc: 'matala puolisko voitetaan yksin' },
    { key: 'loTie', csv: 'lo_tie_pct', desc: 'matala puolisko jaetaan' },
    { key: 'scoop', csv: 'scoop_pct', desc: 'koko potti voitetaan yksin' },
    { key: 'scoopedOn', csv: 'scooped_on_pct', desc: 'osuudeksi jää nolla' },
    { key: 'quarter', csv: 'quarter_pct', desc: 'osuudeksi jää tasan neljännes' },
    { key: 'half', csv: 'half_pct', desc: 'osuudeksi jää tasan puolet' }
];

function parseArgs(argv) {
    const o = {
        players: 3, configs: 32, replicates: 16,
        workers: Math.min(30, os.availableParallelism()),
        chunk: 4000, limit: 0
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
    // Yläraja 10 on osuusyksikön vaatimus: UNIT/k on kokonaisluku ja
    // parillinen vain kun k <= 10, ja tasapeliin voi osallistua k pelaajaa.
    if (o.players < 2 || o.players > 10) { console.error('--players 2..10'); process.exit(1); }
    if (o.configs % o.replicates !== 0) {
        console.error('--configs on oltava jaollinen --replicates-arvolla');
        process.exit(1);
    }
    return o;
}

const choose4 = n => n >= 4 ? (n * (n - 1) * (n - 2) * (n - 3)) / 24 : 0;

// --- Checkpoint --------------------------------------------------------

// Kasvatetaan kun kerättävät sarjat muuttuvat, jottei vanha checkpoint
// sekoitu hiljaa uusiin tuloksiin.
const CHECKPOINT_FORMAT = 1;

function saveCheckpoint(file, state, opts) {
    const tmp = file + '.tmp';
    const out = {
        format: CHECKPOINT_FORMAT,
        players: opts.players, configs: opts.configs, replicates: opts.replicates,
        chunkSize: opts.chunk, totalBoards: state.totalBoards,
        done: [...state.done],
        boardsDone: state.boardsDone,
        lowBoards: state.lowBoards,
        rep: state.rep.map(a => Buffer.from(a.buffer).toString('base64')),
        frq: state.frq.map(a => Buffer.from(a.buffer).toString('base64'))
    };
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, file);
}

function loadCheckpoint(file, state, opts) {
    if (!fs.existsSync(file)) return false;
    try {
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (d.format !== CHECKPOINT_FORMAT) {
            console.log('Checkpoint on vanhaa muotoa - ohitetaan.');
            return false;
        }
        if (d.players !== opts.players || d.configs !== opts.configs ||
            d.replicates !== opts.replicates || d.chunkSize !== opts.chunk ||
            d.totalBoards !== state.totalBoards) {
            console.log('Checkpoint on eri parametreilla - ohitetaan.');
            return false;
        }
        state.done = new Set(d.done);
        state.boardsDone = d.boardsDone;
        state.lowBoards = d.lowBoards;
        const decode = s => new Float64Array(new Uint8Array(Buffer.from(s, 'base64')).buffer);
        state.rep = d.rep.map(decode);
        state.frq = d.frq.map(decode);
        return true;
    } catch (e) {
        console.log('Checkpoint rikki - aloitetaan alusta.');
        return false;
    }
}

// --- Laskenta ----------------------------------------------------------

async function runWorkers(opts, classOf, state, checkpointPath) {
    const chunks = [];
    for (let start = 0; start < state.totalBoards; start += opts.chunk) {
        const id = start / opts.chunk;
        if (state.done.has(id)) continue;
        chunks.push({
            chunk: id,
            startRank: start,
            count: Math.min(opts.chunk, state.totalBoards - start),
            // Siemen riippuu vain palasen numerosta, joten checkpointista
            // jatkaminen toistaa täsmälleen saman arvonnan
            seed: chunkSeed(id)
        });
    }
    if (chunks.length === 0) return 0;

    console.log(`Palasia laskettavana: ${chunks.length} (${opts.chunk} pöytää/palanen), workereita ${opts.workers}`);
    let lastSave = Date.now();
    const { elapsed } = await runPool({
        workerFile: path.join(__dirname, 'hybridOmahaHiloWorker.js'),
        workerData: {
            classOf, players: opts.players,
            configs: opts.configs, replicates: opts.replicates
        },
        chunks, workers: opts.workers,
        progress: () => `${state.boardsDone.toLocaleString('fi-FI')} pöytää`,
        onResult: (res) => {
            for (let r = 0; r < opts.replicates; r++) {
                const sr = res.rep[r], dr = state.rep[r];
                for (let i = 0; i < dr.length; i++) dr[i] += sr[i];
                const sf = res.frq[r], df = state.frq[r];
                for (let i = 0; i < df.length; i++) df[i] += sf[i];
            }
            state.done.add(res.chunk);
            state.boardsDone += res.boards;
            state.lowBoards += res.lowBoards;
            if (checkpointPath && Date.now() - lastSave > 120000) {
                lastSave = Date.now();
                saveCheckpoint(checkpointPath, state, opts);
            }
        }
    });
    console.log(`Laskenta valmis ${formatDuration(elapsed)} aikana.`);
    return elapsed;
}

// --- Tulosten kokoaminen -----------------------------------------------

/**
 * Kokoa toistokohtaiset kertymät käsiriveiksi.
 *
 * Osuudet ovat kokonaislukuja UNIT:n yksiköissä, joten equity = 100 *
 * osuus / (UNIT * näytteet). hiEquity sisältää koko potin niiltä
 * kierroksilta joilla kukaan ei tehnyt low'ta, joten hiEquity + loEquity =
 * equity tasan - sama sopimus kuin eksaktissa heads-up-taulukossa.
 */
function collect(classes, state, opts) {
    const K = opts.replicates;
    // replicateMeans olettaa osuuden potin osuutena (100 * share / cnt = %),
    // joten UNIT-yksiköt on jaettava pois - muuten toiston yhteinen siirtymä
    // olisi 5040-kertainen ja seCmp roskaa.
    const shareArr = [], cntArr = [];
    for (let r = 0; r < K; r++) {
        const s = new Float64Array(N_CLASSES), c = new Float64Array(N_CLASSES);
        for (let i = 0; i < N_CLASSES; i++) {
            s[i] = state.rep[r][i * REP_SLOTS] / UNIT;
            c[i] = state.rep[r][i * REP_SLOTS + 2];
        }
        shareArr.push(s); cntArr.push(c);
    }
    const { repMean, grandMean } = replicateMeans(shareArr, cntArr);

    return classes.map((c, i) => {
        let share = 0, hi = 0, n = 0;
        const eqEst = [], hiEst = [], loEst = [];
        const freqSum = new Float64Array(FRQ_SLOTS);
        const freqEst = FREQ.map(() => []);
        for (let r = 0; r < K; r++) {
            const base = i * REP_SLOTS;
            const s = state.rep[r][base], h = state.rep[r][base + 1], m = state.rep[r][base + 2];
            share += s; hi += h; n += m;
            const denom = UNIT * m;
            eqEst.push(100 * s / denom);
            hiEst.push(100 * h / denom);
            loEst.push(100 * (s - h) / denom);
            for (let f = 0; f < FRQ_SLOTS; f++) {
                const v = state.frq[r][i * FRQ_SLOTS + f];
                freqSum[f] += v;
                freqEst[f].push(100 * v / m);
            }
        }
        const denom = UNIT * n;
        const row = {
            key: c.key,
            label: describeOmahaKey(c.key),
            notation: omahaNotation(c.key),
            combos: c.combos,
            equity: 100 * share / denom,
            hiEquity: 100 * hi / denom,
            loEquity: 100 * (share - hi) / denom,
            se: sampleSe(eqEst),
            seCmp: comparisonSe(eqEst, repMean, grandMean),
            seHi: sampleSe(hiEst),
            seLo: sampleSe(loEst),
            samples: n,
            shareSum: share,
            hiSum: hi
        };
        FREQ.forEach((f, k) => {
            row[f.key] = 100 * freqSum[k] / n;
            row[f.key + 'Se'] = sampleSe(freqEst[k]);
            row[f.key + 'Count'] = freqSum[k];
        });
        // Osapotti = kaikki paitsi koko potti ja nolla; johdettu, ei kerätty
        row.partPot = 100 - row.scoop - row.scoopedOn;
        return row;
    });
}

/** Rakenteelliset tarkistukset. Palauttaa true jos kaikki menivät läpi. */
function verify(hands, state, opts, handsPerConfig, partial) {
    let ok = true;
    const say = (name, pass, detail) => {
        console.log(`  ${name}: ${detail} -> ${pass ? 'OK' : 'VIRHE'}`);
        ok = pass && ok;
    };
    const med = arr => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];

    let totalCnt = 0, totalShare = 0;
    for (const h of hands) { totalCnt += h.samples; totalShare += h.shareSum; }
    const expectedCnt = state.boardsDone * opts.configs * handsPerConfig;
    say('näytteitä yhteensä', totalCnt === expectedCnt,
        `${totalCnt.toLocaleString('fi-FI')} vs odotus ${expectedCnt.toLocaleString('fi-FI')}`);

    // Low-kelpoisten pöytien määrä on eksakti kombinatorinen luku, ja
    // työläinen laskee sen omasta esivalmistelustaan. Täysajossa sen on
    // täsmättävä täsmälleen - riippumaton tarkistus low-logiikan pohjalle.
    if (!partial) {
        say('low-kelpoisia pöytiä', state.lowBoards === LOW_BOARDS,
            `${state.lowBoards.toLocaleString('fi-FI')} vs odotus ${LOW_BOARDS.toLocaleString('fi-FI')}`);
    } else {
        console.log(`  low-kelpoisia pöytiä: ${state.lowBoards.toLocaleString('fi-FI')} / ` +
            `${state.boardsDone.toLocaleString('fi-FI')} (${(100 * state.lowBoards / state.boardsDone).toFixed(2)} %)`);
    }

    // Puoliskojen osuuksien on summauduttava kokonaisosuudeksi tasan
    let hiSum = 0;
    for (const h of hands) hiSum += h.hiSum;
    let maxSplitErr = 0;
    for (const h of hands) {
        const d = Math.abs(h.hiEquity + h.loEquity - h.equity);
        if (d > maxSplitErr) maxSplitErr = d;
    }
    say('hiEquity + loEquity = equity', maxSplitErr < 1e-9,
        `suurin poikkeama ${maxSplitErr.toExponential(1)} pp`);

    // Scoop vaatii korkean puoliskon voittamisen yksin, joten scoop-lukumäärä
    // ei voi ylittää hi-voittoja millään kädellä
    let scoopViolations = 0;
    for (const h of hands) if (h.scoopCount > h.hiWinCount) scoopViolations++;
    say('scoop <= hi-voitto', scoopViolations === 0,
        `${scoopViolations} käsiluokkaa rikkoo ehdon`);

    // Kokoava keskiosuus: heron ja vastustajien vaihdannaisuuden nojalla
    // TÄSMÄLLEEN 1/pelaajat odotusarvoltaan, riippumatta pöytäjoukosta
    const pooled = 100 * totalShare / (UNIT * totalCnt);
    const target = 100 / opts.players;
    console.log(`  kokoava keskiosuus: ${pooled.toFixed(6)} % vs odotus ${target.toFixed(6)} % ` +
        `(ero ${(pooled - target >= 0 ? '+' : '') + (pooled - target).toFixed(6)} pp)`);
    console.log(`  hi-puoliskon osuus kokonaisosuudesta: ${(100 * hiSum / totalShare).toFixed(4)} %`);

    if (!partial) {
        let wsum = 0, wtot = 0;
        for (const h of hands) { wsum += h.equity * h.combos; wtot += h.combos; }
        const meanEq = wsum / wtot;
        console.log(`  kombopainotettu keski-equity: ${meanEq.toFixed(6)} % vs odotus ${target.toFixed(6)} % ` +
            `(ero ${(meanEq - target >= 0 ? '+' : '') + (meanEq - target).toFixed(6)} pp)`);
        let combos = 0;
        for (const h of hands) combos += h.combos;
        say('kombot yhteensä', combos === 270725, `${combos.toLocaleString('fi-FI')} vs odotus 270 725`);
    }

    // seCmp poistaa toistojen yhteisen siirtymän, joten sen on oltava samaa
    // suuruusluokkaa kuin se ja tyypillisesti pienempi. Iso poikkeama
    // paljastaa yksikkövirheen siirtymän laskennassa (osuudet ovat
    // UNIT-yksiköitä, replicateMeans odottaa potin osuuksia).
    const medSe = med(hands.map(h => h.se)), medCmp = med(hands.map(h => h.seCmp));
    say('seCmp samaa suuruusluokkaa kuin se', medCmp > 0 && medCmp <= 1.2 * medSe,
        `mediaani ${medCmp.toFixed(5)} pp vs se ${medSe.toFixed(5)} pp`);

    console.log(`  keskivirhe (mediaani): equity ± ${med(hands.map(h => h.se)).toFixed(5)} pp, ` +
        `hi ± ${med(hands.map(h => h.seHi)).toFixed(5)}, lo ± ${med(hands.map(h => h.seLo)).toFixed(5)}`);
    console.log('  taajuuksien keskivirhe (mediaani): ' +
        FREQ.map(f => `${f.key} ± ${med(hands.map(h => h[f.key + 'Se'])).toFixed(4)}`).join(', '));

    // Rajat nojaavat eksaktiin taulukkoon, joka kattaa kaikki pöydät -
    // rajatussa ajossa pöytäotos on vino eivätkä ne päde
    return (partial ? true : verifyLowBounds(hands)) && ok;
}

/**
 * Low-taajuuksien rajat eksaktista heads-up-taulukosta.
 *
 * `lowMade` (käsi tekee kelvollisen low'n) ja `nutLow` (se on pöydän paras
 * mahdollinen low) eivät riipu pelaajamäärästä lainkaan, joten eksaktin
 * taulukon luvut sitovat myös moninpeliä:
 *
 *   nutLow <= loWin + loTie <= lowMade
 *
 * Ylärajaa ei voi ylittää, koska matalan puoliskon voittaminen vaatii
 * low'n. Alarajaa ei voi alittaa, koska pöydän parasta low'ta ei voi
 * hävitä - sen kanssa voi korkeintaan tasata. Kumpikin on hybridissä
 * otosestimaatti, joten rikkeeksi lasketaan vasta 5 keskivirheen ylitys.
 *
 * Vain täysajolle: eksaktin taulukon luvut on laskettu kaikista pöydistä,
 * joten rajatun ajon vinolla pöytäotoksella ne eivät ole rajoja lainkaan.
 */
function verifyLowBounds(hands) {
    const exactPath = path.resolve(__dirname, '..', 'data', 'preflop-omahahilo-2max-exact.json');
    if (!fs.existsSync(exactPath)) {
        console.log('  low-rajat: eksaktia heads-up-taulukkoa ei löydy - ohitetaan');
        return true;
    }
    const byKey = new Map(JSON.parse(fs.readFileSync(exactPath, 'utf8'))
        .hands.map(h => [h.key, h]));
    let overs = 0, unders = 0, maxOver = 0, maxUnder = 0, checked = 0;
    for (const h of hands) {
        const e = byKey.get(h.key);
        if (!e) continue;
        checked++;
        const lo = h.loWin + h.loTie;
        const tol = 5 * Math.hypot(h.loWinSe, h.loTieSe);
        if (lo - e.lowMade > tol) { overs++; maxOver = Math.max(maxOver, lo - e.lowMade); }
        if (e.nutLow - lo > tol) { unders++; maxUnder = Math.max(maxUnder, e.nutLow - lo); }
    }
    const ok = overs === 0 && unders === 0;
    console.log(`  low-rajat nutLow <= loWin+loTie <= lowMade (${checked} luokkaa): ` +
        `${overs} ylitystä (max ${maxOver.toFixed(4)} pp), ${unders} alitusta ` +
        `(max ${maxUnder.toFixed(4)} pp) -> ${ok ? 'OK' : 'VIRHE'}`);
    return ok;
}

/**
 * Validointi eksaktia heads-up-taulukkoa vastaan (vain --players 2).
 *
 * Tämä on ajon vahvin tarkistus: hybridin low-puoli on kirjoitettu
 * riippumattomasti eksaktista putkesta, joten yhtäpitävyys kaikilla
 * 16 432 käsiluokalla ja yhdellätoista suureella kertoo molempien olevan
 * oikein.
 */
function validateAgainstExact(hands, opts, partial) {
    const exactPath = path.resolve(__dirname, '..', 'data', 'preflop-omahahilo-2max-exact.json');
    // Rajatulla pöytäjoukolla vertailu olisi merkityksetön: eksakti taulukko
    // kattaa kaikki pöydät, osittainen ajo vain alkupään.
    if (opts.players !== 2 || partial || !fs.existsSync(exactPath)) return;

    const exact = JSON.parse(fs.readFileSync(exactPath, 'utf8'));
    const byKey = new Map(exact.hands.map(h => [h.key, h]));
    console.log('\nValidointi eksaktia heads-up-taulukkoa vastaan:');

    // Eksaktissa tiedostossa half on vain kappalemääränä (halfCount)
    const exactValue = (e, key) => key === 'half' ? 100 * e.halfCount / e.deals : e[key];

    const series = [
        { name: 'equity', get: h => h.equity, se: h => h.se, ex: e => e.equity },
        { name: 'hiEquity', get: h => h.hiEquity, se: h => h.seHi, ex: e => e.hiEquity },
        { name: 'loEquity', get: h => h.loEquity, se: h => h.seLo, ex: e => e.loEquity },
        ...FREQ.map(f => ({
            name: f.key, get: h => h[f.key], se: h => h[f.key + 'Se'],
            ex: e => exactValue(e, f.key)
        }))
    ];

    for (const s of series) {
        let sumZ2 = 0, n = 0, within3 = 0, maxZ = 0, maxKey = null, maxDiff = 0;
        for (const h of hands) {
            const e = byKey.get(h.key);
            if (!e) continue;
            const diff = s.get(h) - s.ex(e);
            if (Math.abs(diff) > Math.abs(maxDiff)) maxDiff = diff;
            const se = s.se(h);
            if (!se) continue;             // rakenteellinen nolla (esim. lo = 0)
            const z = diff / se;
            sumZ2 += z * z; n++;
            if (Math.abs(z) <= 3) within3++;
            if (Math.abs(z) > Math.abs(maxZ)) { maxZ = z; maxKey = h.label; }
        }
        console.log(`  ${s.name.padEnd(10)} z-RMS ${Math.sqrt(sumZ2 / n).toFixed(3)} (odotus 1.000), ` +
            `|z|<=3 ${(100 * within3 / n).toFixed(2)} % (odotus 99.73), ` +
            `max |z| ${Math.abs(maxZ).toFixed(2)} (${maxKey}), suurin ero ${maxDiff.toFixed(5)} pp`);
    }
}

// --- Tulostiedostot ----------------------------------------------------

function writeOutputs(hands, state, opts, handsPerConfig, elapsedMs) {
    const dataDir = path.resolve(__dirname, '..', 'data');
    const base = `preflop-omahahilo-${opts.players}max-hybrid`;
    const round = (x, n) => Number(x.toFixed(n));

    let totalCnt = 0;
    for (const h of hands) totalCnt += h.samples;

    const output = {
        meta: {
            gameType: 'omahahilo', players: opts.players,
            scenario: `all-in preflop, hero vs. ${opts.players - 1} satunnaista kättä, 8-or-better hi/lo`,
            method: 'hybridi: eksakti kaikkien C(52,5) pöydän yli, Monte Carlo vastustajien korttien poiston yli; potti jaettuna hi- ja low-puoliskoihin',
            exact: false,
            boards: state.totalBoards,
            lowPossibleBoards: state.lowBoards,
            configsPerBoard: opts.configs,
            replicates: opts.replicates,
            handsScoredPerConfig: handsPerConfig,
            totalSamples: totalCnt,
            rng: 'xoshiro128** (jakso 2^128-1), oma virta per palanen ja toisto',
            handClasses: hands.length,
            shareUnit: `osuudet laskettu kokonaislukuina, koko potti = ${UNIT} yksikköä`,
            columns: {
                equity: 'keskimääräinen osuus potista',
                hiEquity: 'osuus potista korkean puoliskon kautta (sisältää koko potin kun kukaan ei tehnyt low\'ta)',
                loEquity: 'osuus potista matalan puoliskon kautta; hiEquity + loEquity = equity',
                se: 'equityn keskivirhe toistoista',
                seCmp: 'keskivirhe käsien väliseen vertailuun (toiston yhteinen siirtymä poistettu)',
                seHi: 'hiEquityn keskivirhe', seLo: 'loEquityn keskivirhe',
                partPot: 'kuinka usein saadaan osa potista muttei kaikkea (johdettu: 100 - scoop - scoopedOn)',
                ...Object.fromEntries(FREQ.map(f => [f.key, `kuinka usein ${f.desc}`]))
            },
            note: 'lowMade ja nutLow eivät riipu pelaajamäärästä; eksaktit arvot ovat tiedostossa preflop-omahahilo-2max-exact',
            computeSeconds: Math.round(elapsedMs / 1000),
            generatedAt: new Date().toISOString(),
            script: 'scripts/hybridOmahaHilo.js'
        },
        hands: hands.map(h => ({
            key: h.key, label: h.label, notation: h.notation, rank: h.rank, combos: h.combos,
            equity: round(h.equity, 5), se: round(h.se, 5), seCmp: round(h.seCmp, 5),
            hiEquity: round(h.hiEquity, 5), seHi: round(h.seHi, 5),
            loEquity: round(h.loEquity, 5), seLo: round(h.seLo, 5),
            hiWin: round(h.hiWin, 5), hiTie: round(h.hiTie, 5),
            loWin: round(h.loWin, 5), loTie: round(h.loTie, 5),
            scoop: round(h.scoop, 5), partPot: round(h.partPot, 5),
            quarter: round(h.quarter, 5), half: round(h.half, 5),
            scoopedOn: round(h.scoopedOn, 5),
            samples: h.samples, rankLow: h.rankLow, rankHigh: h.rankHigh
        }))
    };
    fs.writeFileSync(path.join(dataDir, base + '.json'), JSON.stringify(output, null, 2) + '\n');

    const lines = ['rank,hand,label,notation,combos,equity_pct,std_error_pp,std_error_cmp_pp,' +
        'hi_equity_pct,hi_std_error_pp,lo_equity_pct,lo_std_error_pp,' +
        'hi_win_pct,hi_tie_pct,lo_win_pct,lo_tie_pct,' +
        'scoop_pct,part_pot_pct,quarter_pct,half_pct,scooped_on_pct,' +
        'samples,rank_low,rank_high'];
    for (const h of hands) {
        lines.push([h.rank, h.key, h.label, h.notation, h.combos,
            round(h.equity, 5), round(h.se, 5), round(h.seCmp, 5),
            round(h.hiEquity, 5), round(h.seHi, 5), round(h.loEquity, 5), round(h.seLo, 5),
            round(h.hiWin, 5), round(h.hiTie, 5), round(h.loWin, 5), round(h.loTie, 5),
            round(h.scoop, 5), round(h.partPot, 5), round(h.quarter, 5), round(h.half, 5),
            round(h.scoopedOn, 5), h.samples, h.rankLow, h.rankHigh].join(','));
    }
    fs.writeFileSync(path.join(dataDir, base + '.csv'), lines.join('\n') + '\n');
    console.log(`\nKirjoitettu: data/${base}.json ja .csv`);
}

// --- Pääohjelma --------------------------------------------------------

async function main() {
    const opts = parseArgs(process.argv);
    const heroPool = REST - 4 * (opts.players - 1);
    if (heroPool < 4) { console.error('Liikaa pelaajia'); process.exit(1); }
    const handsPerConfig = choose4(heroPool);
    const totalBoards = opts.limit > 0 ? Math.min(opts.limit, N_BOARDS) : N_BOARDS;
    const partial = opts.limit > 0;

    console.log(`Omaha Hi/Lo (8-or-better), ${opts.players} pelaajaa (${opts.players - 1} vastustajaa)`);
    console.log(`Pöytiä: ${totalBoards.toLocaleString('fi-FI')}${partial ? ' (RAJATTU AJO - ei tulostiedostoja)' : ' (kaikki)'}, ` +
        `konfiguraatioita/pöytä: ${opts.configs}, toistoja: ${opts.replicates}`);
    console.log(`Heron kortteja/konfiguraatio: ${heroPool} -> ${handsPerConfig.toLocaleString('fi-FI')} kättä pisteytetään kerralla`);

    let t = Date.now();
    console.log('Rakennetaan luokkataulukko...');
    const { classes, classOf } = buildClassTable();
    console.log(`  ${classes.length} luokkaa, ${formatDuration(Date.now() - t)}`);

    // Taajuudet kertyvät työläisessä 32-bittisinä. Varmistetaan että
    // suurinkaan käsiluokka ei voi ylivuotaa yhden palasen aikana.
    let maxCombos = 0;
    for (const c of classes) if (c.combos > maxCombos) maxCombos = c.combos;
    const worstPerChunk = opts.chunk * opts.configs * handsPerConfig * maxCombos / 270725;
    if (worstPerChunk > 2 ** 31) {
        console.error(`--chunk liian suuri: yksi palanen tuottaisi ~${worstPerChunk.toExponential(2)} ` +
            'näytettä suurimmalle käsiluokalle, 32-bittinen laskuri ylivuotaisi.');
        process.exit(1);
    }

    const state = {
        totalBoards, boardsDone: 0, lowBoards: 0, done: new Set(),
        rep: Array.from({ length: opts.replicates }, () => new Float64Array(N_CLASSES * REP_SLOTS)),
        frq: Array.from({ length: opts.replicates }, () => new Float64Array(N_CLASSES * FRQ_SLOTS))
    };

    const checkpointPath = partial ? null : path.resolve(__dirname, '..', 'data',
        `preflop-omahahilo-${opts.players}max-hybrid.checkpoint.json`);
    if (checkpointPath && loadCheckpoint(checkpointPath, state, opts)) {
        console.log(`Checkpointista jatketaan: ${state.boardsDone.toLocaleString('fi-FI')} pöytää valmiina.`);
    }

    const elapsedMs = await runWorkers(opts, classOf, state, checkpointPath);

    console.log('\nTarkistukset:');
    const hands = collect(classes, state, opts);
    const ok = verify(hands, state, opts, handsPerConfig, partial);

    hands.sort((a, b) => b.equity - a.equity || (a.key < b.key ? -1 : 1));
    hands.forEach((h, i) => { h.rank = i + 1; });
    addRankBounds(hands);

    validateAgainstExact(hands, opts, partial);

    if (partial) {
        console.log(`\nRajattu ajo - tulostiedostoja ei kirjoiteta.`);
        console.log(`  nopeus: ${(elapsedMs / state.boardsDone).toFixed(2)} ms/pöytä (seinäkello), ` +
            `koko ajo ~${formatDuration(elapsedMs / state.boardsDone * N_BOARDS)}`);
        process.exit(ok ? 0 : 1);
    }
    if (!ok) {
        console.error('\nTARKISTUKSET EPÄONNISTUIVAT - tulostiedostoja ei kirjoiteta.');
        process.exit(1);
    }

    writeOutputs(hands, state, opts, handsPerConfig, elapsedMs);
    if (checkpointPath) fs.rmSync(checkpointPath, { force: true });

    console.log('\nTop 10:');
    for (const h of hands.slice(0, 10)) {
        console.log(`  ${String(h.rank).padStart(2)}. ${h.label.padEnd(12)} ${h.equity.toFixed(4)} % ± ${h.se.toFixed(4)} ` +
            `(hi ${h.hiEquity.toFixed(2)} + lo ${h.loEquity.toFixed(2)}, scoop ${h.scoop.toFixed(1)} %)`);
    }
    console.log('Heikoimmat 3:');
    for (const h of hands.slice(-3)) {
        console.log(`  ${h.rank}. ${h.label.padEnd(12)} ${h.equity.toFixed(4)} % ± ${h.se.toFixed(4)}`);
    }
}

if (require.main === module) {
    main().catch(err => { console.error('Ajo epäonnistui:', err); process.exit(1); });
}
