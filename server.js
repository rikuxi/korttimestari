const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { isValidCard } = require('./cards');
const preflopTables = require('./preflopTables');
const { parseQuery, searchTable } = require('./handSearch');
const { resolveTrustProxy } = require('./trustProxy');

const app = express();

// Luotetut käänteisproxyt: oletuksena Cloudflaren edge-alueet, mutta
// korvattavissa TRUST_PROXY_IPS-ympäristömuuttujalla ilman koodimuutosta.
// Alueluettelo ja jäsennys ovat trustProxy.js:ssä.
try {
    app.set('trust proxy', resolveTrustProxy(process.env.TRUST_PROXY_IPS));
} catch (err) {
    // Express hylkää kelvottoman osoitteen jo tässä. Kaadetaan käynnistys
    // selkeällä viestillä: hiljainen fallback oletuksiin tarkoittaisi, että
    // väärin kirjoitettu asetus jäisi huomaamatta ja rate limitit
    // laskettaisiin väärästä osoitteesta.
    throw new Error(
        'TRUST_PROXY_IPS sisältää kelvottoman osoitteen tai CIDR-alueen: ' + err.message
    );
}

const PORT = process.env.PORT || 3002;

// Tuetut pelimuodot - sama lista kaikille reiteille. Rankings-reitit
// vastaavat 404 jos pelimuodolle ei ole vielä esilaskettua taulukkoa.
const VALID_GAME_TYPES = ['holdem', 'omaha', 'omaha5', 'omahahilo'];

// Käytä helmet konfiguroituna (yhdistetty CSP ja muut headerit)
// HUOM: helmet ennen express.static, jotta turvaotsakkeet tulevat myös staattisille tiedostoille
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", "data:"],
            fontSrc: ["'self'"],
            // Ilman tätä helmetin oletus frame-ancestors 'self' ohittaisi
            // X-Frame-Options: DENY:n moderneissa selaimissa
            frameAncestors: ["'none'"]
        }
    },
    frameguard: { action: 'deny' }
}));

// Sivut joilla on kieliversiot: suomi juuressa, englanti /en/-polussa
// englanninkielisin tiedostonimin. hreflang-vihjeet annetaan HTTP Link
// -otsakkeena, koska HTML-tageina ne vaatisivat absoluuttiset URLit eikä
// domainia ole kiinnitetty koodiin - otsake rakennetaan pyynnön hostista
// (kuten sitemap ja robots).
const PAGE_SLUGS = {
    'index.html': 'index.html',
    'rankingit.html': 'rankings.html',
    'menetelmat.html': 'methods.html'
};
const EN_TO_FI_SLUG = Object.fromEntries(
    Object.entries(PAGE_SLUGS).map(([fi, en]) => [en, fi]));

// Julkiset osoitteet ovat päätteettömiä (/rankingit, /en/rankings);
// vanhat .html-osoitteet ohjataan pysyvästi, myös index.html juureen,
// ettei samalle sivulle jää kahta indeksoituvaa osoitetta
const HTML_REDIRECTS = {
    '/index.html': '/',
    '/rankingit.html': '/rankingit',
    '/menetelmat.html': '/menetelmat',
    '/en/index.html': '/en/',
    '/en/rankings.html': '/en/rankings',
    '/en/methods.html': '/en/methods'
};

const stripHtmlExt = (file) => file.replace(/\.html$/, '');

function hreflangHeader(req, relPath) {
    const base = requestBase(req);
    if (!base) return null;
    const fiRel = relPath.startsWith('en/')
        ? EN_TO_FI_SLUG[relPath.slice(3)]
        : (relPath in PAGE_SLUGS ? relPath : undefined);
    if (!fiRel) return null;
    const fiUrl = base + (fiRel === 'index.html' ? '/' : `/${stripHtmlExt(fiRel)}`);
    const enUrl = base + (fiRel === 'index.html' ? '/en/' : `/en/${stripHtmlExt(PAGE_SLUGS[fiRel])}`);
    // x-default -> suomi, koska sivuston juuri on suomeksi
    return `<${fiUrl}>; rel="alternate"; hreflang="fi", ` +
        `<${enUrl}>; rel="alternate"; hreflang="en", ` +
        `<${fiUrl}>; rel="alternate"; hreflang="x-default"`;
}

// Ohjaus ennen express.staticia, muuten static ehtisi tarjoilla
// .html-osoitteen sellaisenaan. Query string säilytetään.
app.use((req, res, next) => {
    const target = HTML_REDIRECTS[req.path];
    if (!target) return next();
    res.redirect(301, target + req.originalUrl.slice(req.path.length));
});

// Polku moduulista, ei työhakemistosta: muuten palvelin 404:ää kaikki
// staattiset tiedostot jos se käynnistetään muualta kuin projektin juuresta.
// extensions: päätteetön osoite (/rankingit) löytää vastaavan .html-tiedoston.
app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    setHeaders(res, filePath) {
        // HTML revalidoidaan aina (ETag tekee siitä halpaa), muut saavat
        // tunnin välimuistin - tiedostonimissä ei ole versiohashia, joten
        // pidempi aika viivästyttäisi korjausten näkymistä
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
            const rel = path.relative(path.join(__dirname, 'public'), filePath)
                .split(path.sep).join('/');
            const link = hreflangHeader(res.req, rel);
            if (link) res.setHeader('Link', link);
        } else {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    }
}));
app.use(express.json({ limit: '10kb' }));

// Laskentareitti (/simulate) käynnistää worker-säikeen - tiukka raja
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  message: { error: 'Too many requests, please try again later.', code: 'rate_limited' }
});

// Taulukkohaut (/preflop, /rankings) ovat muistihakuja, ja käyttöliittymä
// kutsuu /preflopia jokaisesta simulaatiosta - jaettu 100 pyynnön raja
// täyttyi selailussa minuuteissa ja tarkat arvot katosivat hiljaa
const lookupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    message: { error: 'Too many requests, please try again later.', code: 'rate_limited' }
});

// Rajoita samanaikaisten worker-säikeiden määrä (DoS-suoja)
const MAX_CONCURRENT_WORKERS = 4;
let activeWorkers = 0;

/**
 * Esilaskettu preflop-equity tuntemattomia vastustajia vastaan.
 *
 * Tämä on taulukkohaku, ei laskentaa: vastaus on jo olemassa levyllä.
 * Omahan heads-up on eksakti, muut kertovat oman keskivirheensä.
 */
app.get('/preflop', lookupLimiter, (req, res) => {
    const gameType = req.query.gameType;
    if (!VALID_GAME_TYPES.includes(gameType)) {
        return res.status(400).json({ error: 'Invalid game type', code: 'invalid_game_type' });
    }

    const players = parseInt(req.query.players, 10);
    if (!Number.isInteger(players) || players < 2 || players > 10) {
        return res.status(400).json({ error: 'Invalid player count', code: 'invalid_player_count' });
    }

    const hand = typeof req.query.hand === 'string' ? req.query.hand.split(',') : null;
    const expected = gameType === 'holdem' ? 2 : (gameType === 'omaha5' ? 5 : 4);
    if (!Array.isArray(hand) || hand.length !== expected || !hand.every(isValidCard)) {
        return res.status(400).json({ error: 'Invalid hand' });
    }
    if (new Set(hand).size !== hand.length) {
        return res.status(400).json({ error: 'Duplicate cards' });
    }

    const result = preflopTables.lookup(gameType, players, hand);
    if (!result) {
        return res.status(404).json({ error: 'No precomputed table for this configuration', code: 'no_table' });
    }
    res.json(result);
});

/** Mille peli- ja pelaajamääräyhdistelmille taulukko löytyy */
app.get('/preflop/available', lookupLimiter, (req, res) => {
    res.json(preflopTables.available());
});

// CSV-lataukset ovat isoja tiedostoja (Omaha5 ~19 MB) - oma tiukempi raja
const csvLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    message: { error: 'Too many downloads, please try again later.', code: 'rate_limited' }
});

/**
 * Rankingtaulukon selaus ja osittaiskäsihaku.
 *
 * q tyhjänä selaa koko listan sijajärjestyksessä; muuten palautetaan
 * luokat joihin kysely upottuu (katso handSearch.js: pelkät arvot,
 * sulkuryhmät '(AJ)(AJ)', konkreettiset maat 'AsKs', hold'emissa AKs/AKo).
 */
app.get('/rankings', lookupLimiter, (req, res) => {
    const gameType = req.query.gameType;
    if (!VALID_GAME_TYPES.includes(gameType)) {
        return res.status(400).json({ error: 'Invalid game type', code: 'invalid_game_type' });
    }
    const players = parseInt(req.query.players, 10);
    if (!Number.isInteger(players) || players < 2 || players > 10) {
        return res.status(400).json({ error: 'Invalid player count', code: 'invalid_player_count' });
    }
    const offset = req.query.offset === undefined ? 0 : parseInt(req.query.offset, 10);
    if (!Number.isInteger(offset) || offset < 0) {
        return res.status(400).json({ error: 'Invalid offset', code: 'invalid_offset' });
    }
    const limit = req.query.limit === undefined ? 100 : parseInt(req.query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({ error: 'Limit must be between 1 and 500', code: 'invalid_limit' });
    }

    let parsed;
    try {
        parsed = parseQuery(req.query.q, gameType);
    } catch (e) {
        return res.status(400).json({ error: e.message, code: e.code, params: e.params });
    }

    const table = preflopTables.loadTable(gameType, players);
    if (!table) {
        return res.status(404).json({ error: 'No precomputed table for this configuration', code: 'no_table' });
    }

    const { total, hands } = searchTable(table, gameType, parsed, offset, limit);
    res.json({
        gameType,
        players,
        exact: table.exact,
        handClasses: table.handCount,
        total,
        offset,
        hands: hands.map(h => ({
            key: h.key,
            label: h.label,
            notation: h.notation,
            rank: h.rank,
            rankLow: h.rankLow,
            rankHigh: h.rankHigh,
            equity: h.equity,
            // Hi/Lo-taulukoissa mukana; muissa undefined putoaa pois JSONista
            hiEquity: h.hiEquity,
            loEquity: h.loEquity,
            hiWin: h.hiWin,
            hiTie: h.hiTie,
            loWin: h.loWin,
            loTie: h.loTie,
            se: h.se,
            combos: h.combos,
            topPct: h.topPct
        }))
    });
});

/**
 * Top-X %:n alueen tunnusluvut: montako käsiluokkaa ja komboa alueeseen
 * kuuluu ja missä equity-raja kulkee. Käsi kuuluu alueeseen, jos vähintään
 * yhtä hyvien kombinaatioiden osuus (topPct) on korkeintaan pyydetty
 * prosentti. Omaha-pelimuodoissa 13x13-ruudukkoa ei ole, joten alue
 * kuvataan näillä luvuilla; Hold'emissa sama raja värittää ruudukon.
 */
app.get('/rankings/range', lookupLimiter, (req, res) => {
    const gameType = req.query.gameType;
    if (!VALID_GAME_TYPES.includes(gameType)) {
        return res.status(400).json({ error: 'Invalid game type', code: 'invalid_game_type' });
    }
    const players = parseInt(req.query.players, 10);
    if (!Number.isInteger(players) || players < 2 || players > 10) {
        return res.status(400).json({ error: 'Invalid player count', code: 'invalid_player_count' });
    }
    const pct = parseFloat(req.query.pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        return res.status(400).json({ error: 'pct must be between 0 and 100', code: 'invalid_pct' });
    }

    const table = preflopTables.loadTable(gameType, players);
    if (!table) {
        return res.status(404).json({ error: 'No precomputed table for this configuration', code: 'no_table' });
    }

    // Rivit ovat sijajärjestyksessä ja topPct kasvaa monotonisesti, joten
    // alue on aina alkuosa listasta. Pieni epsilon sietää liukulukujen
    // pyöristyksen rajalla (esim. pct=100 ja viimeisen rivin 100.0000001).
    const rows = table.rows;
    let count = 0;
    let combos = 0;
    while (count < rows.length && rows[count].topPct <= pct + 1e-9) {
        combos += rows[count].combos;
        count++;
    }

    const strip = h => ({
        key: h.key,
        label: h.label,
        notation: h.notation,
        rank: h.rank,
        equity: h.equity,
        topPct: h.topPct
    });
    res.json({
        gameType,
        players,
        pct,
        handClasses: table.handCount,
        classes: count,
        combos,
        totalCombos: table.totalCombos,
        equityCutoff: count > 0 ? rows[count - 1].equity : null,
        lastIncluded: count > 0 ? strip(rows[count - 1]) : null,
        firstExcluded: count < rows.length ? strip(rows[count]) : null
    });
});

// Kanonisen avaimen muoto pelimuodoittain (rankings-rivien 'key'-kenttä)
const KEY_PATTERN = {
    holdem: /^[2-9TJQKA]{2}[so]?$/,
    omaha: /^([2-9TJQKA][shdc]){4}$/,
    omaha5: /^([2-9TJQKA][shdc]){5}$/,
    omahahilo: /^([2-9TJQKA][shdc]){4}$/
};

/**
 * Yksi käsiluokka kaikilla pelaajamäärillä - vertailunäkymää varten.
 * Kertoo miten sija ja equity muuttuvat pöydän täyttyessä (esim. AATT ds
 * on Omahan ykkönen 2-3 pelaajalla mutta putoaa AAKK:n taakse neljästä
 * alkaen).
 */
app.get('/rankings/hand', lookupLimiter, (req, res) => {
    const gameType = req.query.gameType;
    if (!VALID_GAME_TYPES.includes(gameType)) {
        return res.status(400).json({ error: 'Invalid game type', code: 'invalid_game_type' });
    }
    const key = req.query.key;
    if (typeof key !== 'string' || !KEY_PATTERN[gameType].test(key)) {
        return res.status(400).json({ error: 'Invalid hand key', code: 'invalid_hand_key' });
    }

    const maxPlayers = gameType === 'holdem' ? 10 : 9;
    const byPlayers = [];
    let label, notation;
    for (let p = 2; p <= maxPlayers; p++) {
        const table = preflopTables.loadTable(gameType, p);
        if (!table) continue;
        const row = table.byKey.get(key);
        if (!row) continue;
        if (label === undefined) { label = row.label; notation = row.notation; }
        byPlayers.push({
            players: p,
            rank: row.rank,
            rankLow: row.rankLow,
            rankHigh: row.rankHigh,
            equity: row.equity,
            se: row.se,
            topPct: row.topPct,
            exact: table.exact,
            handClasses: table.handCount
        });
    }
    if (byPlayers.length === 0) {
        return res.status(404).json({ error: 'Hand not found', code: 'hand_not_found' });
    }
    res.json({ gameType, key, label, notation, byPlayers });
});

/** Koko taulukko CSV:nä (CC BY 4.0, katso data/LICENSE) */
app.get('/rankings/csv', csvLimiter, (req, res) => {
    const gameType = req.query.gameType;
    if (!VALID_GAME_TYPES.includes(gameType)) {
        return res.status(400).json({ error: 'Invalid game type', code: 'invalid_game_type' });
    }
    const players = parseInt(req.query.players, 10);
    if (!Number.isInteger(players) || players < 2 || players > 10) {
        return res.status(400).json({ error: 'Invalid player count', code: 'invalid_player_count' });
    }
    const table = preflopTables.loadTable(gameType, players);
    if (!table) {
        return res.status(404).json({ error: 'No precomputed table for this configuration', code: 'no_table' });
    }
    const csvName = table.file.replace(/\.json$/, '.csv');
    const csvPath = path.join(__dirname, 'data', csvName);
    if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ error: 'CSV not available' });
    }
    // Vuorokauden julkinen välimuisti: tiedostot ovat isoja (Omaha5
    // ~10 MB) ja muuttuvat vain kun taulukko regeneroidaan, joten CDN saa
    // palvella ne reunalta origin-kaistan sijaan. Vuorokausi rajaa
    // päivityksen viiveen siedettäväksi ilman tiedostonimien versiointia.
    res.download(csvPath, csvName, { maxAge: '1d' });
});

app.post('/simulate', apiLimiter, (req, res) => {
    if (activeWorkers >= MAX_CONCURRENT_WORKERS) {
        return res.status(503).json({ error: 'Server busy - try again shortly', code: 'server_busy' });
    }

    // 1. INPUT VALIDATION
    const simulationCount = parseInt(req.body.simulationCount);
    if (isNaN(simulationCount) || simulationCount < 100 || simulationCount > 50000) {
        return res.status(400).json({ error: 'Simulation count must be between 100 and 50000' });
    }
    
    // Validoi gameType
    const gameType = req.body.gameType;
    if (!VALID_GAME_TYPES.includes(gameType)) {
        return res.status(400).json({ error: 'Invalid game type', code: 'invalid_game_type' });
    }

    // Validoi randomOpponents (boolean)
    const randomOpponents = req.body.randomOpponents === true;
    
    if (!Array.isArray(req.body.playerHandsData)) {
        return res.status(400).json({ error: 'Invalid player data format' });
    }

    // Rajoita pelaajamäärä pelimuodon mukaan (sama raja kuin selaimessa;
    // Omaha5:llä kortit eivät riitä 10 pelaajalle: 10*5 + 5 > 52)
    const maxPlayers = gameType === 'holdem' ? 10 : 9;
    if (req.body.playerHandsData.length < 2 || req.body.playerHandsData.length > maxPlayers) {
        return res.status(400).json({ error: `Player count must be between 2 and ${maxPlayers} for ${gameType}` });
    }
    
    const allCards = [];
    const communityCards = req.body.communityCards || {};

    // Validate community cards - flop
    if (communityCards.flop) {
        if (!Array.isArray(communityCards.flop) || communityCards.flop.length > 3) {
            return res.status(400).json({ error: 'Flop must be an array with max 3 cards' });
        }
        for (const card of communityCards.flop) {
            if (card && !isValidCard(card)) {
                return res.status(400).json({ error: 'Invalid flop card format' });
            }
            if (card) allCards.push(card);
        }
    }
    
    // Validate community cards - turn
    if (communityCards.turn) {
        if (!isValidCard(communityCards.turn)) {
            return res.status(400).json({ error: 'Invalid turn card format' });
        }
        allCards.push(communityCards.turn);
    }
    
    // Validate community cards - river
    if (communityCards.river) {
        if (!isValidCard(communityCards.river)) {
            return res.status(400).json({ error: 'Invalid river card format' });
        }
        allCards.push(communityCards.river);
    }
    
    // Validate player cards
    const cardsPerPlayer = gameType === 'holdem' ? 2 : (gameType === 'omaha5' ? 5 : 4);
    for (let i = 0; i < req.body.playerHandsData.length; i++) {
        const player = req.body.playerHandsData[i];
        
        if (typeof player !== 'object' || player === null) {
            return res.status(400).json({ error: `Invalid player ${i + 1} data` });
        }

        // randomOpponents-tilassa vain hero (i=0) tarvitsee kortit
        if (randomOpponents && i > 0) {
            continue;
        }

        if (!player.isFolded) {
            if (!Array.isArray(player.hand)) {
                return res.status(400).json({ error: `Player ${i + 1} hand must be an array` });
            }

            // Tarkista korttien määrä
            const validCards = player.hand.filter(c => c !== null && c !== '');
            if (validCards.length > 0 && validCards.length !== cardsPerPlayer) {
                return res.status(400).json({
                    error: `Player ${i + 1} must have exactly ${cardsPerPlayer} cards for ${gameType}`
                });
            }
        }

        // Myös foldatun pelaajan kortit validoidaan: moottori käsittelee ne
        // kuolleina kortteina, joten kelvoton tai duplikaattikortti kaataisi
        // workerin ja asiakas saisi 500:n 400:n sijaan
        if (Array.isArray(player.hand)) {
            for (const card of player.hand) {
                if (card && !isValidCard(card)) {
                    return res.status(400).json({ error: `Invalid card format for player ${i + 1}` });
                }
                if (card) allCards.push(card);
            }
        }
    }

    // Moottori vaatii vähintään yhden aktiivisen pelaajan; ilman tätä
    // kaikkien foldaaminen päätyisi worker-virheen kautta 500:aan
    if (randomOpponents) {
        if (req.body.playerHandsData[0] && req.body.playerHandsData[0].isFolded) {
            return res.status(400).json({ error: 'Hero cannot be folded with random opponents' });
        }
    } else if (req.body.playerHandsData.filter(p => p && !p.isFolded).length < 2) {
        return res.status(400).json({ error: 'At least two active players required' });
    }

    // Check for duplicate cards
    const uniqueCards = new Set(allCards);
    if (uniqueCards.size !== allCards.length) {
        return res.status(400).json({ error: 'Duplicate cards detected' });
    }

    // 2. RUN WORKER WITH TIMEOUT
    const worker = new Worker(path.resolve(__dirname, 'worker.js'), {
        workerData: {
            playerHandsData: req.body.playerHandsData,
            communityCards,
            simulationCount,
            gameType,
            randomOpponents
        }
    });
    activeWorkers++;

    // Timeout 30 sekuntia
    const timeout = setTimeout(() => {
        worker.terminate();
        if (!res.headersSent) {
            res.status(504).json({ error: 'Simulation timeout - try fewer simulations', code: 'simulation_timeout' });
        }
    }, 30000);

    worker.on('message', (result) => {
        clearTimeout(timeout);
        // Timeout on voinut jo lähettää 504:n - res.json kaataisi prosessin
        if (res.headersSent) {
            return;
        }
        if (result.error) {
            return res.status(500).json({ error: result.error });
        }
        res.json(result);
    });

    worker.on('error', (error) => {
        clearTimeout(timeout);
        // Älä logaa koko error-objektia tuotannossa
        if (process.env.NODE_ENV !== 'production') {
            console.error('Worker error:', error);
        } else {
            console.error('Worker error occurred');
        }
        if (!res.headersSent) {
            res.status(500).json({ error: 'Simulation failed', code: 'simulation_failed' });
        }
    });

    worker.on('exit', (code) => {
        // 'exit' laukeaa aina (myös terminate jälkeen), joten laskuri vähenee luotettavasti tässä
        activeWorkers--;
        clearTimeout(timeout);
        if (code !== 0 && !res.headersSent) {
            res.status(500).json({ error: 'Simulation process terminated unexpectedly', code: 'simulation_failed' });
        }
    });
});

// Hakukoneet: robots ja sitemap rakennetaan pyynnön hostista, koska
// lopullista domainia ei ole kiinnitetty koodiin. Host-otsake on
// asiakkaan syötettä, joten se validoidaan ennen vastaukseen upottamista.
function requestBase(req) {
    const host = req.get('host');
    if (typeof host !== 'string' || !/^[A-Za-z0-9.\-:[\]]+$/.test(host)) {
        return null;
    }
    return `${req.protocol}://${host}`;
}

app.get('/robots.txt', (req, res) => {
    const base = requestBase(req);
    res.type('text/plain').send(
        'User-agent: *\nAllow: /\n' +
        (base ? `\nSitemap: ${base}/sitemap.xml\n` : ''));
});

app.get('/sitemap.xml', (req, res) => {
    const base = requestBase(req);
    if (!base) return res.status(400).type('text/plain').send('Invalid host');
    const urls = ['/', '/rankingit', '/menetelmat',
        '/en/', '/en/rankings', '/en/methods']
        .map(p => `  <url><loc>${base}${p}</loc></url>`)
        .join('\n');
    res.type('application/xml').send(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls + '\n</urlset>\n');
});

app.use((err, req, res, next) => {
    // Virheellinen JSON-runko on asiakkaan virhe, ei palvelimen
    if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400)) {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body too large' });
    }
    if (process.env.NODE_ENV !== 'production') {
        console.error('Server error:', err);
    } else {
        console.error('Server error occurred');
    }
    res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Käynnistä palvelin vain suoraan ajettaessa; testit importtaavat appin
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        // Lämmitä taulukkovälimuisti heti, ettei ensimmäinen kävijä maksa
        // synkronisia levylatauksia. PREFLOP_PRELOAD=off ohittaa - käytä
        // muistiahtaassa ympäristössä yhdessä PREFLOP_CACHE_TABLES-rajan
        // kanssa (ks. preflopTables.js).
        if ((process.env.PREFLOP_PRELOAD || '').toLowerCase() !== 'off') {
            preflopTables.warmCache((count) => {
                console.log(`Preflop cache warmed: ${count} tables`);
            });
        }
    });
}

module.exports = app;