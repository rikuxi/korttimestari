// Esilaskettujen preflop-taulukoiden haku.
//
// Kun hero on all-in preflop tuntemattomia vastustajia vastaan, vastausta ei
// tarvitse simuloida: se on jo laskettu. Omahan heads-up-taulukko on eksakti
// (kaikki 2 598 960 pöytää x kaikki 123 410 vastustajakättä), muut ovat
// laskettuja arvioita joiden tarkkuus kerrotaan tuloksen mukana.
//
// Katso docs/eksakti-omaha-equity.md (ei repossa).

const fs = require('fs');
const path = require('path');
const { canonicalizeHoldem, canonicalizeOmaha, canonicalizeOmaha5 } = require('./canonical');

const DATA_DIR = path.join(__dirname, 'data');

// Ehdokastiedostot pelaajamäärää kohti, paremmuusjärjestyksessä. Puuttuva
// tiedosto ohitetaan, joten uusi taulukko otetaan käyttöön pelkällä ajolla -
// koodiin ei tarvitse koskea. Katso data/README.md.
function candidatesFor(gameType, players) {
    if (gameType === 'omahahilo') {
        return [
            { file: `preflop-omahahilo-${players}max-exact.json`, exact: true },
            { file: `preflop-omahahilo-${players}max-hybrid.json`, exact: false }
        ];
    }
    if (gameType === 'omaha5') {
        return [
            { file: `preflop-omaha5-${players}max-exact.json`, exact: true },
            { file: `preflop-omaha5-${players}max-hybrid.json`, exact: false }
        ];
    }
    if (gameType === 'omaha') {
        return [
            { file: `preflop-omaha-${players}max-exact.json`, exact: true },
            { file: `preflop-omaha-${players}max-hybrid.json`, exact: false }
        ];
    }
    if (gameType === 'holdem') {
        return [
            { file: `preflop-holdem-${players}max-exact.json`, exact: true },
            { file: `preflop-holdem-${players}max-hybrid.json`, exact: false },
            { file: `preflop-holdem-${players}max-1m.json`, exact: false }
        ];
    }
    return [];
}

const SUPPORTED_GAMES = ['holdem', 'omaha', 'omaha5', 'omahahilo'];
const MAX_PLAYERS = { holdem: 10, omaha: 9, omaha5: 9, omahahilo: 9 };

const cache = new Map();

// Paljonko taulukoita pidetään muistissa kerralla. Muisti kuluu riveihin,
// joten budjetti lasketaan riveinä eikä taulukkoina: Hold'em-taulukko on
// 169 riviä (~32 kB), Omaha 16 432 (~4 MB) ja Omaha5 134 459 (~40 MB
// heapia). Kappalepohjainen raja kohtelisi näitä samanarvoisina, jolloin
// halpa Hold'em-taulukko voisi häätää kalliin Omaha5-taulukon ja
// pelimuotojen vuorottelu lukisi 35 MB:n tiedostoja levyltä loputtomiin
// (~0,9 s synkronista työtä per Omaha5-pyyntö).
//
// Map säilyttää lisäysjärjestyksen, joten vanhin (= pisimpään käyttämättä
// ollut) on ensimmäisenä.
//
// PREFLOP_CACHE_TABLES = montako Omaha5-kokoista taulukkoa budjettiin
// mahtuu. Oletus 11 riittää kaikille 33 taulukolle yhtä aikaa (Hold'em +
// Omaha + Omaha5 + Omaha Hi/Lo, yhteensä ~1,34 M riviä < 11 x 134 459),
// eli oletuksilla mikään ei häädy koskaan. Vanha oletus 10 olisi riittänyt
// vain 4 485 rivin marginaalilla. Muistiahtaassa ympäristössä rajaa voi
// pudottaa - alle 8:lla Omaha5:n /rankings/hand (8 taulukkoa silmukassa)
// alkaa taas lukea levyltä, kauppa on tietoinen. Minimi 2 takaa, ettei
// juuri ladattu taulukko koskaan häädä itseään.
const OMAHA5_TABLE_ROWS = 134459;
const MAX_CACHED_ROWS =
    Math.max(2, parseInt(process.env.PREFLOP_CACHE_TABLES, 10) || 11) * OMAHA5_TABLE_ROWS;

function evictIfNeeded() {
    let rows = 0;
    for (const v of cache.values()) if (v !== null) rows += v.handCount;
    for (const [k, v] of cache) {
        if (rows <= MAX_CACHED_ROWS) break;
        if (v === null) continue;   // null-merkintä ei vie muistia
        cache.delete(k);
        rows -= v.handCount;
    }
}

/** Lataa taulukko kerran ja pidä muistissa (LRU); haku on sen jälkeen O(1) */
function loadTable(gameType, players) {
    const key = `${gameType}:${players}`;
    if (cache.has(key)) {
        // Tuoreuta LRU-järjestys: poisto + lisäys siirtää Mapin loppuun
        const hit = cache.get(key);
        cache.delete(key);
        cache.set(key, hit);
        return hit;
    }

    for (const source of candidatesFor(gameType, players)) {
        const file = path.join(DATA_DIR, source.file);
        if (!fs.existsSync(file)) continue;
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!Array.isArray(data.hands) || data.hands.length === 0) continue;
            const byKey = new Map();
            for (const h of data.hands) byKey.set(h.key, h);
            // Kombopainotettu "top-%": kuinka suuri osa kaikista kombinaatioista
            // on vähintään yhtä hyviä, tämä käsi mukaan lukien. Sijaan perustuva
            // prosentti valehtelisi, koska luokkien kombomäärät vaihtelevat
            // (esim. Hold'emissa pari = 6 komboa, offsuit = 12).
            let totalCombos = 0;
            for (const h of data.hands) totalCombos += h.combos;
            let cum = 0;
            for (const h of data.hands) {
                cum += h.combos;
                h.topPct = 100 * cum / totalCombos;
            }
            const table = {
                byKey,
                // Rivit sijajärjestyksessä rankingselailuun ja hakuun
                rows: data.hands,
                // Luota tiedoston omaan ilmoitukseen, ei tiedostonimeen
                exact: data.meta && data.meta.exact === true ? true : source.exact === true,
                meta: data.meta || {},
                handCount: data.hands.length,
                totalCombos,
                file: source.file
            };
            cache.set(key, table);
            evictIfNeeded();
            return table;
        } catch (e) {
            // rikkinäinen tiedosto - kokeile seuraavaa ehdokasta
        }
    }
    cache.set(key, null);
    return null;
}

/**
 * Hae esilaskettu preflop-equity.
 * @param {string} gameType - 'holdem' | 'omaha' | 'omaha5'
 * @param {number} players - pelaajien määrä (hero + vastustajat)
 * @param {string[]} hand - heron kortit
 * @returns {?object} - { equity, exact, standardError, rank, handClasses, source, label }
 */
function lookup(gameType, players, hand) {
    const table = loadTable(gameType, players);
    if (!table) return null;

    const key = gameType === 'holdem' ? canonicalizeHoldem(hand)
        : gameType === 'omaha5' ? canonicalizeOmaha5(hand)
            : canonicalizeOmaha(hand);
    if (!key) return null;

    const row = table.byKey.get(key);
    if (!row) return null;

    return {
        equity: row.equity,
        // Hi/Lo-taulukoissa mukana: potin puoliskojen osuudet ja
        // voitto-/tasapelitaajuudet. Muissa nämä ovat undefined ja
        // putoavat pois JSON-vastauksesta.
        hiEquity: row.hiEquity,
        loEquity: row.loEquity,
        hiWin: row.hiWin,
        hiTie: row.hiTie,
        loWin: row.loWin,
        loTie: row.loTie,
        exact: table.exact,
        // Eksaktilla taulukolla virhettä ei ole; hybridillä se on rivikohtainen;
        // Monte Carlo -taulukoilla se johdetaan simulaatiomäärästä
        standardError: table.exact ? 0 : (typeof row.se === 'number' ? row.se : monteCarloSe(row.equity, table.meta)),
        rank: row.rank,
        // Sija-alue: millä sijoilla käsi voi keskivirheiden puitteissa olla.
        // Eksakteissa taulukoissa [rank, rank]; puuttuu vanhoista tiedostoista.
        rankLow: row.rankLow,
        rankHigh: row.rankHigh,
        label: row.label || key,
        // Kombopainotettu top-%: kuinka suuri osa komboista on vähintään
        // yhtä hyviä (sama luku kuin rankingsivulla)
        topPct: row.topPct,
        handClasses: table.handCount,
        source: table.meta.method || table.meta.scenario || null,
        players
    };
}

function monteCarloSe(equityPct, meta) {
    const n = meta.simulationsPerHand;
    if (!n) return null;
    const p = equityPct / 100;
    return 100 * Math.sqrt(Math.max(0, p * (1 - p)) / n);
}

/**
 * Top-X %:n alue: rivit sijajärjestyksessä alusta niin pitkälle kuin
 * kombopainotettu topPct on korkeintaan pct. Rivit ovat sijajärjestyksessä
 * ja topPct kasvaa monotonisesti, joten alue on aina listan alkuosa. Pieni
 * epsilon sietää liukulukujen pyöristyksen rajalla (esim. pct=100 ja
 * viimeisen rivin 100.0000001).
 * @returns {{count: number, combos: number}}
 */
function rangeSlice(table, pct) {
    const rows = table.rows;
    let count = 0;
    let combos = 0;
    while (count < rows.length && rows[count].topPct <= pct + 1e-9) {
        combos += rows[count].combos;
        count++;
    }
    return { count, combos };
}

/**
 * Käsialueen luokka-avaimet simulaattorille: top-X % pelaajamäärän
 * rankingista. Moottori laajentaa avaimet komboiksi (engine.js:
 * expandRangeKeys). null jos taulukkoa ei ole.
 * @returns {?{keys: string[], classes: number, combos: number, totalCombos: number, players: number}}
 */
function rangeKeys(gameType, players, pct) {
    const table = loadTable(gameType, players);
    if (!table) return null;
    const { count, combos } = rangeSlice(table, pct);
    return {
        keys: table.rows.slice(0, count).map(h => h.key),
        classes: count,
        combos,
        totalCombos: table.totalCombos,
        players
    };
}

/**
 * Onko taulukko olemassa - pelkkä tiedostotarkistus, EI parsintaa.
 *
 * loadTable jokaiselle yhdistelmälle lataisi kaikki taulukot muistiin
 * (~280 MB) ja blokkaisi event loopin lähes sekunniksi yhdellä
 * autentikoimattomalla pyynnöllä. Olemassaolo riittää tähän: jos tiedosto
 * osoittautuu hakuhetkellä rikkinäiseksi, lookup palauttaa null ja
 * /preflop vastaa 404 - sama lopputulos käyttäjälle.
 */
function tableExists(gameType, players) {
    const key = `${gameType}:${players}`;
    if (cache.has(key)) return cache.get(key) !== null;
    return candidatesFor(gameType, players)
        .some(source => fs.existsSync(path.join(DATA_DIR, source.file)));
}

/** Mille yhdistelmille taulukko on olemassa (käyttöliittymän tiedoksi) */
function available() {
    const out = {};
    for (const gameType of SUPPORTED_GAMES) {
        out[gameType] = [];
        for (let p = 2; p <= MAX_PLAYERS[gameType]; p++) {
            if (tableExists(gameType, p)) out[gameType].push(p);
        }
    }
    return out;
}

/**
 * Lämmitä välimuisti taustalla käynnistyksen jälkeen.
 *
 * Lataus on synkronista (readFileSync + JSON.parse), joten kylmä taulukko
 * pysäyttää pääsäikeen - Omaha5:llä ~130 ms per taulukko ja /rankings/hand
 * lataa niitä kahdeksan. Lämmittämällä hinta maksetaan heti käynnistyksessä
 * eikä ensimmäisten kävijöiden pyynnöissä. Yksi taulukko per event loop
 * -kierros, jotta palvelin vastaa pyyntöihin lämmityksen lomassa.
 *
 * Muistihuippu ei kasva tästä: /rankings/hand-pyynnöt ajaisivat välimuistin
 * samaan täyteen kokoon joka tapauksessa, lämmitys vain aikaistaa sen.
 */
function warmCache(onDone) {
    const combos = [];
    for (const gameType of SUPPORTED_GAMES) {
        for (let p = 2; p <= MAX_PLAYERS[gameType]; p++) combos.push([gameType, p]);
    }
    let i = 0;
    (function next() {
        if (i >= combos.length) {
            if (onDone) onDone(combos.length);
            return;
        }
        const [gameType, players] = combos[i++];
        loadTable(gameType, players);
        setImmediate(next);
    })();
}

module.exports = { lookup, available, loadTable, warmCache, rangeSlice, rangeKeys, SUPPORTED_GAMES, MAX_PLAYERS };
