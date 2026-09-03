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

const { formatDuration, runPool } = require('./batchCommon');
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

// --- Checkpoint --------------------------------------------------------

// Kerättävät sarjat. Nimet ovat samat workerin acc-objektissa,
// checkpointissa ja tilassa, joten uuden sarjan lisääminen ei vaadi
// muutoksia kolmeen paikkaan.
const SERIES = ['hi', 'lo', 'hiWin', 'hiTie', 'loWin', 'loTie',
    'q0', 'q1', 'q2', 'q3', 'q4', 'lowMade', 'nutLow',
    'cat0', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6', 'cat7', 'cat8'];

// Käsiluokkien nimet (sama järjestys kuin public/js/engine.js)
const CATEGORY_NAMES = ['high card', 'one pair', 'two pairs', 'three of a kind',
    'straight', 'flush', 'full house', 'four of a kind', 'straight flush'];

// Checkpointin muoto. Kasvatetaan kun kerättävät sarjat muuttuvat, jotta
// vanha checkpoint ei sekoitu hiljaa uusiin tuloksiin.
const CHECKPOINT_FORMAT = 4;

function saveCheckpoint(file, state) {
    const tmp = file + '.tmp';
    const out = {
        format: CHECKPOINT_FORMAT,
        chunkSize: state.chunkSize,
        totalBoards: state.totalBoards,
        done: [...state.done],
        boardsDone: state.boardsDone
    };
    for (const s of SERIES) out[s] = Buffer.from(state[s].buffer).toString('base64');
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, file);
}

function loadCheckpoint(file, chunkSize, totalBoards) {
    if (!fs.existsSync(file)) return null;
    try {
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (d.format !== CHECKPOINT_FORMAT) {
            console.log('Checkpoint on vanhaa muotoa - ohitetaan.');
            return null;
        }
        if (d.chunkSize !== chunkSize || d.totalBoards !== totalBoards) {
            console.log('Checkpoint on eri parametreilla - ohitetaan.');
            return null;
        }
        const r = { done: new Set(d.done), boardsDone: d.boardsDone };
        for (const s of SERIES) {
            r[s] = new Float64Array(new Uint8Array(Buffer.from(d[s], 'base64')).buffer);
        }
        return r;
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
        workerFile: path.join(__dirname, 'exactOmahaHiloWorker.js'),
        workerData: { classOf },
        chunks, workers: opts.workers,
        progress: () => `${state.boardsDone.toLocaleString('fi-FI')} pöytää`,
        onResult: (res) => {
            for (const s of SERIES) {
                const src = res.acc[s], dst = state[s];
                for (let i = 0; i < N_CLASSES; i++) dst[i] += src[i];
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

    // Hi-taajuudet: jokaisessa järjestetyssä (hero, vastustaja) -parissa
    // korkean puoliskon vie joko toinen yksin tai se jaetaan. Yksin
    // voitetut parit lasketaan kerran (voittajan riviltä) ja jaetut
    // kahdesti, joten 2*voitot + tasapelit = kaikki järjestetyt parit.
    let hiWin = 0n, hiTie = 0n;
    for (let i = 0; i < N_CLASSES; i++) {
        hiWin += BigInt(state.hiWin[i]);
        hiTie += BigInt(state.hiTie[i]);
    }
    const pairs = BigInt(N_BOARDS) * BigInt(N_HANDS_PER_BOARD) * BigInt(N_OPP);
    const hiOk = 2n * hiWin + hiTie === pairs;
    console.log(`  hi-taajuudet: 2 x ${hiWin} + ${hiTie} vs ${pairs} -> ${hiOk ? 'OK' : 'VIRHE'}`);
    ok = hiOk && ok;

    // Osuusjakauma: kappalemäärien on summauduttava kaikkiin pareihin, ja
    // neljänneksillä painotettuna sen on toistettava koko osuussumma.
    let qn = 0n, qs = 0n;
    for (let i = 0; i < N_CLASSES; i++) {
        qn += BigInt(state.q0[i]) + BigInt(state.q1[i]) + BigInt(state.q2[i])
            + BigInt(state.q3[i]) + BigInt(state.q4[i]);
        qs += BigInt(state.q1[i]) + 2n * BigInt(state.q2[i])
            + 3n * BigInt(state.q3[i]) + 4n * BigInt(state.q4[i]);
    }
    const qnOk = qn === pairs;
    console.log(`  osuusjakauman summa: ${qn} vs ${pairs} -> ${qnOk ? 'OK' : 'VIRHE'}`);
    ok = qnOk && ok;
    const qsOk = qs === total;
    console.log(`  osuusjakauma painotettuna = kokonaisosuus -> ${qsOk ? 'OK' : 'VIRHE'}`);
    ok = qsOk && ok;

    // Scoopatut ja scooppaajat ovat sama joukko toisin päin: jokainen pari
    // jossa A vie koko potin antaa A:lle q4:n ja B:lle q0:n.
    let sq4 = 0n, sq0 = 0n;
    for (let i = 0; i < N_CLASSES; i++) { sq4 += BigInt(state.q4[i]); sq0 += BigInt(state.q0[i]); }
    const scoopOk = sq4 === sq0;
    console.log(`  scoopit = scoopatut: ${sq4} vs ${sq0} -> ${scoopOk ? 'OK' : 'VIRHE'}`);
    ok = scoopOk && ok;

    // Käsiluokkajakauman on katettava jokainen (käsi, pöytä) -pari tasan
    // kerran: jokaisella kädellä on jokaisella pöydällä yksi paras korkea käsi.
    let catAll = 0n;
    for (let k = 0; k < 9; k++) {
        for (let i = 0; i < N_CLASSES; i++) catAll += BigInt(state['cat' + k][i]);
    }
    const catExpected = BigInt(N_BOARDS) * BigInt(N_HANDS_PER_BOARD);
    const catOk = catAll === catExpected;
    console.log(`  käsiluokkajakauma: ${catAll} vs ${catExpected} -> ${catOk ? 'OK' : 'VIRHE'}`);
    ok = catOk && ok;

    // Low-taajuudet ja low-osuus mittaavat samaa asiaa eri yksiköissä:
    // voitettu puolisko on 2 neljännestä, jaettu 1. (Työläinen tarkistaa
    // tämän jo käsikohtaisesti; tässä se varmistetaan vielä koostetusti,
    // jolloin myös luokkiin kerääminen tulee katetuksi.)
    let loNum = 0n, loFreq = 0n;
    for (let i = 0; i < N_CLASSES; i++) {
        loNum += BigInt(state.lo[i]);
        loFreq += 2n * BigInt(state.loWin[i]) + BigInt(state.loTie[i]);
    }
    const loOk = loNum === loFreq;
    console.log(`  low-osuus vs. low-taajuudet: ${loNum} vs ${loFreq} -> ${loOk ? 'OK' : 'VIRHE'}`);
    ok = loOk && ok;

    return ok;
}

// --- Tulostiedostot ----------------------------------------------------

function writeOutputs(classes, state, dataDir, elapsedMs) {
    const hands = classes.map((c, i) => {
        // Nimittäjä neljännespotin yksiköissä: 4 per (pöytä, vastustaja)
        const denom = c.combos * BOARDS_PER_HAND * N_OPP * 4;
        // Taajuuksien nimittäjä on (pöytä, vastustaja) -parien määrä eli
        // neljäsosa siitä - luku on osuus jaoista, ei potista
        const deals = c.combos * BOARDS_PER_HAND * N_OPP;
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
            loEquity: 100 * lo / denom,
            // Taajuudet: kuinka usein puolisko voitetaan yksin tai jaetaan.
            // Eri suure kuin osuus - hi-voitto tuo koko potin vain kun
            // kumpikaan ei tehnyt low'ta.
            hiWin: 100 * state.hiWin[i] / deals,
            hiTie: 100 * state.hiTie[i] / deals,
            loWin: 100 * state.loWin[i] / deals,
            loTie: 100 * state.loTie[i] / deals,
            hiWinCount: state.hiWin[i],
            hiTieCount: state.hiTie[i],
            loWinCount: state.loWin[i],
            loTieCount: state.loTie[i],
            // Koko potinosuuden jakauma: scoop = koko potti yksin,
            // osapotti = jokin osa muttei kaikkea, quarter = neljännes
            // (kvartautuminen), scoopedOn = vastustaja vei koko potin.
            scoop: 100 * state.q4[i] / deals,
            partPot: 100 * (state.q1[i] + state.q2[i] + state.q3[i]) / deals,
            quarter: 100 * state.q1[i] / deals,
            threeQuarters: 100 * state.q3[i] / deals,
            half: 100 * state.q2[i] / deals,
            scoopedOn: 100 * state.q0[i] / deals,
            scoopCount: state.q4[i],
            quarterCount: state.q1[i],
            halfCount: state.q2[i],
            threeQuarterCount: state.q3[i],
            scoopedOnCount: state.q0[i],
            // Vastustajasta riippumattomat: kuinka usein käsi tekee
            // kelvollisen low'n ja kuinka usein se on pöydän paras low.
            // Nimittäjä on pöytien määrä, ei (pöytä, vastustaja) -parien.
            lowMade: 100 * state.lowMade[i] / (c.combos * BOARDS_PER_HAND),
            nutLow: 100 * state.nutLow[i] / (c.combos * BOARDS_PER_HAND),
            lowMadeCount: state.lowMade[i],
            nutLowCount: state.nutLow[i],
            // Käden oma korkea käsiluokka riverillä: kuinka usein se on
            // pari, kaksi paria, ... Ei riipu vastustajasta.
            handCategories: Object.fromEntries(CATEGORY_NAMES.map((n, k) =>
                [n, 100 * state['cat' + k][i] / (c.combos * BOARDS_PER_HAND)])),
            boards: c.combos * BOARDS_PER_HAND,
            deals
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
            frequencyUnit: 'osuus jaoista: deals = combos * C(48,5) * C(43,4)',
            columns: {
                equity: 'keskimääräinen osuus potista',
                hiEquity: 'osuus potista korkean puoliskon kautta (sisältää koko potin kun low\'ta ei syntynyt)',
                loEquity: 'osuus potista matalan puoliskon kautta; hiEquity + loEquity = equity',
                hiWin: 'kuinka usein korkea puolisko voitetaan yksin',
                hiTie: 'kuinka usein korkea puolisko jaetaan',
                loWin: 'kuinka usein matala puolisko voitetaan yksin',
                loTie: 'kuinka usein matala puolisko jaetaan',
                scoop: 'kuinka usein koko potti voitetaan yksin',
                partPot: 'kuinka usein saadaan osa potista muttei kaikkea',
                quarter: 'kuinka usein osuudeksi jää neljännes (kvartautuminen)',
                half: 'kuinka usein osuudeksi jää puolet',
                threeQuarters: 'kuinka usein osuudeksi jää kolme neljännestä',
                scoopedOn: 'kuinka usein vastustaja vie koko potin',
                lowMade: 'kuinka usein käsi tekee kelvollisen matalan käden (ei riipu vastustajasta)',
                nutLow: 'kuinka usein käsi tekee pöydän parhaan matalan käden (ei riipu vastustajasta)'
            },
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
            hiWin: round(h.hiWin, 6),
            hiTie: round(h.hiTie, 6),
            loWin: round(h.loWin, 6),
            loTie: round(h.loTie, 6),
            scoop: round(h.scoop, 6),
            partPot: round(h.partPot, 6),
            quarter: round(h.quarter, 6),
            half: round(h.half, 6),
            threeQuarters: round(h.threeQuarters, 6),
            scoopedOn: round(h.scoopedOn, 6),
            lowMade: round(h.lowMade, 6),
            nutLow: round(h.nutLow, 6),
            handCategories: Object.fromEntries(
                Object.entries(h.handCategories).map(([k, v]) => [k, round(v, 4)])),
            hiNumerator: h.hiNumerator,
            loNumerator: h.loNumerator,
            denominator: h.denominator,
            hiWinCount: h.hiWinCount,
            hiTieCount: h.hiTieCount,
            loWinCount: h.loWinCount,
            loTieCount: h.loTieCount,
            scoopCount: h.scoopCount,
            quarterCount: h.quarterCount,
            halfCount: h.halfCount,
            threeQuarterCount: h.threeQuarterCount,
            scoopedOnCount: h.scoopedOnCount,
            lowMadeCount: h.lowMadeCount,
            nutLowCount: h.nutLowCount,
            deals: h.deals,
            boards: h.boards,
            rankLow: h.rankLow,
            rankHigh: h.rankHigh
        }))
    };

    const jsonPath = path.join(dataDir, 'preflop-omahahilo-2max-exact.json');
    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2) + '\n');
    console.log(`Kirjoitettu: ${jsonPath}`);

    const lines = ['rank,hand,label,notation,combos,equity_pct,hi_equity_pct,lo_equity_pct,' +
        'hi_win_pct,hi_tie_pct,lo_win_pct,lo_tie_pct,' +
        'scoop_pct,part_pot_pct,quarter_pct,half_pct,three_quarters_pct,scooped_on_pct,' +
        'low_made_pct,nut_low_pct,' +
        'cat_high_card_pct,cat_one_pair_pct,cat_two_pairs_pct,cat_trips_pct,' +
        'cat_straight_pct,cat_flush_pct,cat_full_house_pct,cat_quads_pct,cat_straight_flush_pct,' +
        'hi_numerator,lo_numerator,denominator,' +
        'hi_win_count,hi_tie_count,lo_win_count,lo_tie_count,' +
        'scoop_count,quarter_count,half_count,three_quarter_count,scooped_on_count,' +
        'low_made_count,nut_low_count,deals,boards,rank_low,rank_high'];
    for (const h of hands) {
        lines.push([h.rank, h.key, h.label, h.notation, h.combos,
            round(h.equity, 6), round(h.hiEquity, 6), round(h.loEquity, 6),
            round(h.hiWin, 6), round(h.hiTie, 6), round(h.loWin, 6), round(h.loTie, 6),
            round(h.scoop, 6), round(h.partPot, 6), round(h.quarter, 6),
            round(h.half, 6), round(h.threeQuarters, 6), round(h.scoopedOn, 6),
            round(h.lowMade, 6), round(h.nutLow, 6),
            ...CATEGORY_NAMES.map(n => round(h.handCategories[n], 4)),
            h.hiNumerator, h.loNumerator, h.denominator,
            h.hiWinCount, h.hiTieCount, h.loWinCount, h.loTieCount,
            h.scoopCount, h.quarterCount, h.halfCount, h.threeQuarterCount, h.scoopedOnCount,
            h.lowMadeCount, h.nutLowCount, h.deals, h.boards,
            h.rankLow, h.rankHigh].join(','));
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
        boardsDone: restored ? restored.boardsDone : 0
    };
    for (const s of SERIES) {
        state[s] = restored ? restored[s] : new Float64Array(N_CLASSES);
    }
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
