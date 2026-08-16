// Käyttöliittymätekstien katalogi ja käännösfunktio.
//
// Kieli luetaan <html lang> -attribuutista - HTML on kielen ainoa lähde,
// JS ei arvaa eikä muista kieltä itse. Suomenkieliset sivut ovat juuressa
// (/index.html), englanninkieliset /en/-polussa; molemmat lataavat tämän
// saman tiedoston. Katalogien avainjoukkojen yhtäpitävyys varmistetaan
// testissä (test/i18n.test.js), siksi tiedosto toimii myös Nodessa.
//
// Parametrit merkitään {nimi}-paikkamerkeillä: t('sim.bigRun', {n: 5000}).

'use strict';

const I18N_CATALOGS = {
    fi: {
        // Käsityypit (avaimet ovat laskentamoottorin englanninkielisiä nimiä)
        'hand.high card': 'Hai',
        'hand.one pair': 'Pari',
        'hand.two pairs': 'Kaksi paria',
        'hand.three of a kind': 'Kolmoset',
        'hand.straight': 'Suora',
        'hand.flush': 'Väri',
        'hand.full house': 'Täyskäsi',
        'hand.four of a kind': 'Neloset',
        'hand.straight flush': 'Värisuora',

        // Korttien puhenimet ruudunlukijaa varten
        'card.aria': '{suit} {rank}',
        'card.suit.s': 'pata',
        'card.suit.h': 'hertta',
        'card.suit.d': 'ruutu',
        'card.suit.c': 'risti',
        'card.rank.T': '10',
        'card.rank.J': 'jätkä',
        'card.rank.Q': 'rouva',
        'card.rank.K': 'kuningas',
        'card.rank.A': 'ässä',

        // Simulaattori (script.js)
        'sim.removeCard': 'Poista kortti',
        'sim.browserFallback': 'Selaimen laskenta epäonnistui — tulos laskettiin palvelimella.',
        'sim.shuffleBoard': 'Arvo pöytäkortit',
        'sim.heroDistribution': 'Heron käsien jakauma',
        'sim.stat.win': 'Voitto:',
        'sim.stat.tie': 'Tasan:',
        'sim.stat.equity': 'Equity:',
        'sim.stat.se': 'Virhe:',
        'sim.stat.exact': 'Tarkka:',
        'sim.stat.scoop': 'Scoop:',
        'sim.stat.split': 'Osapotti:',
        // Kolme hi/lo-riviä: ensimmäinen luku on aina hi, toinen lo.
        // "Osuus" on osa equitystä, "Voitto"/"Tasan" ovat taajuuksia.
        'sim.stat.hiloShare': 'Osuus hi/lo:',
        'sim.stat.hiloWin': 'Voitto hi/lo:',
        'sim.stat.hiloTie': 'Tasan hi/lo:',
        'sim.lowLineEmpty': 'Low tehty: – · Ei low\'ta: –',
        'sim.lowLine': 'Low tehty: {made} % · Ei low\'ta: {nolow} %',
        'sim.folded': 'Folded',
        'sim.shufflePlayer': 'Arvo uudet kortit',
        'sim.shufflePlayerAria': 'Arvo pelaajan {n} kortit',
        'sim.fold': 'Foldaa käsi / Peru foldaus',
        'sim.foldAria': 'Foldaa pelaajan {n} käsi tai peru foldaus',
        'sim.heroCardsMissing': 'Heron (pelaaja 1) kortit puuttuvat.',
        'sim.playerCardsMissing': 'Pelaajalla {n} ei ole kaikkia kortteja valittuna.',
        'sim.needTwoPlayers': 'Simulaatio vaatii vähintään kaksi aktiivista pelaajaa.',
        'sim.heroFolded': 'Hero ei voi olla foldannut tässä tilassa.',
        'sim.bigRun': 'Iso ajo: {n} kierrosta, arvioitu kesto ~{s} s. Voit perua milloin vain.',
        'sim.requestFailed': 'Virhe simulaation ajamisessa',
        'sim.errorPrefix': 'Virhe: {msg}',
        'sim.serverTruncated': 'Tulos laskettiin palvelimella {count} kierroksella ' +
            '(selain ei ollut käytettävissä; pyydetty {requested} katkaistiin).',
        'sim.rank': 'sija {rank}',
        'sim.rankRange': 'sija ~{rank} (väli {low}–{high})',
        'sim.preflopExact': 'Tarkka arvo esilasketusta taulukosta: {equity} % ({rank} / {classes} käsiluokasta, top {top}).',
        'sim.preflopHybrid': 'Esilaskettu arvo: {equity} % ± {se} ({rank} / {classes} käsiluokasta, top {top}).',
        'sim.exactDone': 'Tarkka tulos laskettu: kaikki {n} jäljellä olevaa pöytää käytiin läpi.',
        // Vastustajien käsialueet (ranges.js)
        'sim.exactDoneRange': 'Tarkka tulos laskettu: {c} käsialueiden yhdistelmää × jäljellä olevat pöydät = {n} tapausta käytiin läpi.',
        'sim.rangeAll': 'Kaikki kädet',
        'sim.rangeTop': 'Top {pct} %',
        'sim.rangeAria': 'Pelaajan {n} käsialue: parhaat prosentit käsistä',
        'sim.rangeAllLabel': 'Vastustajien käsialue:',
        'sim.rangePopHead': 'Top {pct} % — {players} pelaajan preflop-ranking',
        'sim.rangePopSummary': '{classes} käsiluokkaa, {combos} / {total} komboa',
        'sim.rangePopWeakest': ' — heikoin: {hand}',
        'sim.rangePopLink': 'Näytä rankingsivulla',
        'sim.rangeLoading': 'Haetaan…',
        'sim.rangeNoTable': 'Tälle pelaajamäärälle ei ole rankingtaulukkoa — käsialuetta ei voi käyttää.',
        'sim.rangeFetchFailed': 'Käsialueen haku epäonnistui.',
        'sim.rangeConflict': 'Valittuja käsialueita ei voi jakaa yhtä aikaa (liian kapeat alueet samoista käsistä).',
        'sim.rangeNote': 'Vastustajien käsialueet: {list}. Esilaskettua preflop-arvoa ei ole tälle asetelmalle.',
        'sim.rangeNoteRank': 'Vastustajien käsialueet: {list}. Heron käsi: {rank} / {classes} käsiluokasta, top {top} — ' +
            'HUOM: sija on ranking satunnaisia käsiä vastaan, ei valittua aluetta vastaan.',

        // Rankingsivu (rankings.js)
        'rk.searching': 'Haetaan…',
        'rk.searchFailed': 'Haku epäonnistui.',
        'rk.connectionFailed': 'Yhteys palvelimeen epäonnistui.',
        'rk.methodExact': 'eksakti taulukko',
        'rk.methodHybrid': 'hybriditaulukko',
        'rk.meta': '{game}, {players} pelaajaa — {method}, {classes} käsiluokkaa.',
        'rk.metaQuery': ' Kysely "{q}": {total} osumaa.',
        'rk.rowTitle': 'Näytä käsi kaikilla pelaajamäärillä',
        'rk.exactSe': 'tarkka',
        'rk.noResults': 'Ei osumia.',
        'rk.loadingDetail': 'Haetaan pelaajamäärävertailua…',
        'rk.detailFailed': 'Vertailun haku epäonnistui.',
        'rk.detailCaption': '{hand} pelaajamäärittäin:',
        // Hi/Lo:n lisätiedot avatussa rivissä (vain hi/lo-taulukoissa)
        'rk.detailHiloCaption': 'Hi/Lo-luvut {players} pelaajalla:',
        'rk.detailHalves': 'Voittaa korkean puoliskon yksin {hiWin}, jakaa sen {hiTie}; ' +
            'matalan yksin {loWin}, jakaa sen {loTie}.',
        'rk.detailShares': 'Koko potti yksin {scoop}, osa potista {part} ' +
            '(näistä neljännes {quarter}), ei mitään {none}.',
        'rk.detailLow': 'Tekee kelvollisen matalan käden {made}, ja se on pöydän paras {nut} ' +
            '(ei riipu pelaajamäärästä).',
        'rk.col.players': 'Pelaajia',
        'rk.col.rank': 'Sija',
        'rk.col.equity': 'Equity %',
        'rk.col.top': 'Top-%',
        'rk.col.se': 'Keskivirhe',
        'rk.cellDesc': '{key} — sija {rank}, equity {equity} %, top {top}',
        'rk.cellOut': ' (alueen ulkopuolella)',
        'rk.rangeValue': 'top {pct} %',
        'rk.chartSummary': 'Top {pct} % = {classes} käsiluokkaa, {combos} / {total} komboa',
        'rk.chartCutoff': ' — equity-raja ≥ {equity} %.',
        'rk.chartFailed': 'Chartin haku epäonnistui.',
        'rk.rangeHeadline': '{game}, {players} pelaajaa — top {pct} %:n alue:',
        'rk.rangeClasses': '{classes} / {allClasses} käsiluokkaa ({combos} / {totalCombos} komboa, {share}).',
        'rk.rangeCutoff': 'Equity-raja ≥ {equity} % — viimeinen alueeseen kuuluva käsi: {hand}, sija {rank}.',
        'rk.rangeExcluded': 'Ensimmäinen ulkopuolelle jäävä: {hand}, sija {rank}, equity {equity} %.',
        'rk.showCutoff': 'Näytä rajakohta taulukossa',
        'rk.rangeFailed': 'Alueen haku epäonnistui.',

        // Palvelimen virhekoodien käännökset. Tuntematon koodi -> UI näyttää
        // vastauksen error-tekstin sellaisenaan (fallback).
        'apiError.rate_limited': 'Liikaa pyyntöjä — yritä hetken kuluttua uudelleen.',
        'apiError.server_busy': 'Palvelin on varattu — yritä hetken kuluttua uudelleen.',
        'apiError.simulation_timeout': 'Simulaatio aikakatkaistiin — kokeile pienempää kierrosmäärää.',
        'apiError.simulation_failed': 'Simulaatio epäonnistui palvelimella.',
        'apiError.no_table': 'Tälle kokoonpanolle ei ole esilaskettua taulukkoa.',
        'apiError.range_conflict': 'Valittuja käsialueita ei voi jakaa yhtä aikaa (liian kapeat alueet samoista käsistä).',
        'apiError.invalid_range_pct': 'Käsialueen prosentti ei kelpaa.',
        'apiError.query_pair_suited': 'Pari ei voi olla suited eikä offsuit.',
        'apiError.query_bad_group': 'Sulkuryhmä on tyhjä tai sulkematta.',
        'apiError.query_bad_char_in_group': "Merkki '{char}' ei kelpaa sulkuryhmässä.",
        'apiError.query_bad_char': "Merkki '{char}' ei kelpaa kyselyssä.",
        'apiError.query_too_many_cards': 'Kysely saa sisältää enintään {max} korttia.',
        'apiError.query_too_many_groups': 'Kyselyssä voi olla enintään neljä maaryhmää.'
    },

    en: {
        'hand.high card': 'High card',
        'hand.one pair': 'One pair',
        'hand.two pairs': 'Two pairs',
        'hand.three of a kind': 'Three of a kind',
        'hand.straight': 'Straight',
        'hand.flush': 'Flush',
        'hand.full house': 'Full house',
        'hand.four of a kind': 'Four of a kind',
        'hand.straight flush': 'Straight flush',

        'card.aria': '{rank} of {suit}',
        'card.suit.s': 'spades',
        'card.suit.h': 'hearts',
        'card.suit.d': 'diamonds',
        'card.suit.c': 'clubs',
        'card.rank.T': '10',
        'card.rank.J': 'jack',
        'card.rank.Q': 'queen',
        'card.rank.K': 'king',
        'card.rank.A': 'ace',

        'sim.removeCard': 'Remove card',
        'sim.browserFallback': 'In-browser calculation failed — the result was computed on the server.',
        'sim.shuffleBoard': 'Deal random board cards',
        'sim.heroDistribution': "Hero's hand distribution",
        'sim.stat.win': 'Win:',
        'sim.stat.tie': 'Tie:',
        'sim.stat.equity': 'Equity:',
        'sim.stat.se': 'SE:',
        'sim.stat.exact': 'Exact:',
        'sim.stat.scoop': 'Scoop:',
        'sim.stat.split': 'Part-pot:',
        'sim.stat.hiloShare': 'Share hi/lo:',
        'sim.stat.hiloWin': 'Wins hi/lo:',
        'sim.stat.hiloTie': 'Ties hi/lo:',
        'sim.lowLineEmpty': 'Low made: – · No low: –',
        'sim.lowLine': 'Low made: {made} % · No low: {nolow} %',
        'sim.folded': 'Folded',
        'sim.shufflePlayer': 'Deal new cards',
        'sim.shufflePlayerAria': "Deal new cards to player {n}",
        'sim.fold': 'Fold hand / Undo fold',
        'sim.foldAria': "Fold or unfold player {n}'s hand",
        'sim.heroCardsMissing': 'Hero (player 1) is missing cards.',
        'sim.playerCardsMissing': 'Player {n} does not have all cards selected.',
        'sim.needTwoPlayers': 'The simulation needs at least two active players.',
        'sim.heroFolded': 'Hero cannot be folded in this mode.',
        'sim.bigRun': 'Large run: {n} iterations, estimated duration ~{s} s. You can cancel at any time.',
        'sim.requestFailed': 'Simulation request failed',
        'sim.errorPrefix': 'Error: {msg}',
        'sim.serverTruncated': 'The result was computed on the server with {count} iterations ' +
            '(the browser was unavailable; the requested {requested} was capped).',
        'sim.rank': 'rank {rank}',
        'sim.rankRange': 'rank ~{rank} (range {low}–{high})',
        'sim.preflopExact': 'Exact value from the precomputed table: {equity} % ({rank} of {classes} hand classes, top {top}).',
        'sim.preflopHybrid': 'Precomputed value: {equity} % ± {se} ({rank} of {classes} hand classes, top {top}).',
        'sim.exactDone': 'Exact result computed: all {n} remaining boards were enumerated.',
        'sim.exactDoneRange': 'Exact result computed: {c} range hand combinations × remaining boards = {n} cases enumerated.',
        'sim.rangeAll': 'All hands',
        'sim.rangeTop': 'Top {pct} %',
        'sim.rangeAria': 'Player {n} hand range: top percent of hands',
        'sim.rangeAllLabel': 'Opponent hand range:',
        'sim.rangePopHead': 'Top {pct} % — {players}-player preflop ranking',
        'sim.rangePopSummary': '{classes} hand classes, {combos} / {total} combos',
        'sim.rangePopWeakest': ' — weakest: {hand}',
        'sim.rangePopLink': 'Show on the rankings page',
        'sim.rangeLoading': 'Loading…',
        'sim.rangeNoTable': 'No ranking table exists for this player count — hand ranges are unavailable.',
        'sim.rangeFetchFailed': 'Fetching the hand range failed.',
        'sim.rangeConflict': 'The selected hand ranges cannot all be dealt at once (too narrow, built from the same hands).',
        'sim.rangeNote': 'Opponent hand ranges: {list}. No precomputed preflop value exists for this setup.',
        'sim.rangeNoteRank': "Opponent hand ranges: {list}. Hero's hand: {rank} of {classes} hand classes, top {top} — " +
            'NOTE: the rank is against random hands, not against the selected range.',

        'rk.searching': 'Searching…',
        'rk.searchFailed': 'Search failed.',
        'rk.connectionFailed': 'Could not reach the server.',
        'rk.methodExact': 'exact table',
        'rk.methodHybrid': 'hybrid table',
        'rk.meta': '{game}, {players} players — {method}, {classes} hand classes.',
        'rk.metaQuery': ' Query "{q}": {total} matches.',
        'rk.rowTitle': 'Show this hand for every player count',
        'rk.exactSe': 'exact',
        'rk.noResults': 'No matches.',
        'rk.loadingDetail': 'Loading player-count comparison…',
        'rk.detailFailed': 'Loading the comparison failed.',
        'rk.detailCaption': '{hand} by player count:',
        'rk.detailHiloCaption': 'Hi/Lo figures with {players} players:',
        'rk.detailHalves': 'Takes the high half outright {hiWin}, splits it {hiTie}; ' +
            'the low half outright {loWin}, splits it {loTie}.',
        'rk.detailShares': 'Whole pot alone {scoop}, part of the pot {part} ' +
            '(a quarter in {quarter}), nothing {none}.',
        'rk.detailLow': 'Makes a qualifying low {made}, and it is the board\'s best {nut} ' +
            '(independent of the player count).',
        'rk.col.players': 'Players',
        'rk.col.rank': 'Rank',
        'rk.col.equity': 'Equity %',
        'rk.col.top': 'Top %',
        'rk.col.se': 'Std. error',
        'rk.cellDesc': '{key} — rank {rank}, equity {equity} %, top {top}',
        'rk.cellOut': ' (outside the range)',
        'rk.rangeValue': 'top {pct} %',
        'rk.chartSummary': 'Top {pct} % = {classes} hand classes, {combos} / {total} combos',
        'rk.chartCutoff': ' — equity cutoff ≥ {equity} %.',
        'rk.chartFailed': 'Loading the chart failed.',
        'rk.rangeHeadline': '{game}, {players} players — top {pct} % range:',
        'rk.rangeClasses': '{classes} / {allClasses} hand classes ({combos} / {totalCombos} combos, {share}).',
        'rk.rangeCutoff': 'Equity cutoff ≥ {equity} % — last hand inside the range: {hand}, rank {rank}.',
        'rk.rangeExcluded': 'First hand left out: {hand}, rank {rank}, equity {equity} %.',
        'rk.showCutoff': 'Show the cutoff in the table',
        'rk.rangeFailed': 'Loading the range failed.',

        'apiError.rate_limited': 'Too many requests — please try again shortly.',
        'apiError.server_busy': 'The server is busy — please try again shortly.',
        'apiError.simulation_timeout': 'The simulation timed out — try fewer iterations.',
        'apiError.simulation_failed': 'The simulation failed on the server.',
        'apiError.no_table': 'No precomputed table exists for this configuration.',
        'apiError.range_conflict': 'The selected hand ranges cannot all be dealt at once (too narrow, built from the same hands).',
        'apiError.invalid_range_pct': 'Invalid hand range percentage.',
        'apiError.query_pair_suited': 'A pair cannot be suited or offsuit.',
        'apiError.query_bad_group': 'Empty or unclosed group in the query.',
        'apiError.query_bad_char_in_group': "The character '{char}' is not valid inside a group.",
        'apiError.query_bad_char': "The character '{char}' is not valid in a query.",
        'apiError.query_too_many_cards': 'A query may contain at most {max} cards.',
        'apiError.query_too_many_groups': 'A query may use at most four suit groups.'
    }
};

/**
 * Luo käännösolio kielelle.
 * @param {string} lang - 'fi' | 'en'
 * @returns {{t: function, lang: string, locale: string, apiError: function}}
 */
function createI18n(lang) {
    const resolved = lang === 'en' ? 'en' : 'fi';
    const catalog = I18N_CATALOGS[resolved];

    function t(key, params) {
        let text = catalog[key];
        if (text === undefined) text = I18N_CATALOGS.fi[key];
        if (text === undefined) return key;
        if (params) {
            for (const name of Object.keys(params)) {
                text = text.split('{' + name + '}').join(String(params[name]));
            }
        }
        return text;
    }

    /**
     * Käännä palvelimen virhevastaus: tunnettu code-kenttä katalogista,
     * muuten vastauksen englanninkielinen error-teksti sellaisenaan.
     * @param {?object} data - virhevastauksen runko ({ error, code, params })
     * @param {string} fallbackKey - avain jos vastauksessa ei ole mitään
     */
    function apiError(data, fallbackKey) {
        if (data && data.code && catalog['apiError.' + data.code] !== undefined) {
            return t('apiError.' + data.code, data.params);
        }
        if (data && data.error) return data.error;
        return t(fallbackKey);
    }

    return {
        t,
        apiError,
        lang: resolved,
        // fi: 1 326 / 0,45 % - en: 1,326 / 0.45 %
        locale: resolved === 'en' ? 'en-GB' : 'fi-FI'
    };
}

// Selaimessa: kieli sivun <html lang> -attribuutista, olio globaaliksi
if (typeof document !== 'undefined') {
    const pageLang = (document.documentElement.lang || 'fi').toLowerCase();
    window.I18N = createI18n(pageLang.startsWith('en') ? 'en' : 'fi');
}

// Nodessa (testit): paljasta katalogit ja tehdas
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { I18N_CATALOGS, createI18n };
}
