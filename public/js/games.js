/**
 * Pelimuotorekisteri - yksi paikka pelimuotojen ominaisuuksille.
 *
 * Sama tiedosto ladataan selaimessa (sivut ja poker-worker) ja Nodessa
 * (palvelin, worker, preflopTables, handSearch), jotta uusi pelimuoto
 * lisätään yhteen paikkaan eikä kahdeksaan tiedostoon nimiperusteisina
 * literaaleina. HTML-sivujen radionapit ovat edelleen sivukohtaisia.
 *
 * Kentät:
 *   name           näyttönimi (kielineutraali)
 *   cardsPerPlayer käsikortteja per pelaaja
 *   hiLo           potti jaetaan hi- ja low-puoliskoihin (8-or-better)
 *   maxPlayers     suurin pelaajamäärä (Omaha5: 10*5 + 5 > 52)
 *   keyPattern     kanonisen luokka-avaimen muoto rankingtaulukoissa
 *   tableSuffixes  esilaskettujen taulukoiden tiedostopäätteet
 *                  paremmuusjärjestyksessä (preflop-<peli>-<n>max-<pääte>.json)
 *   simCost        Monte Carlo -kierroksen hinta per pelaaja sekunteina
 *                  (selain ~1.5x Node), kestoarvioon
 *   exactCost      eksaktin enumeroinnin hinta per pöytä per pelaaja
 *                  sekunteina (Hold'em: yksi eval7; Omaha: 60 x eval5;
 *                  Omaha5: 100 x eval5; Hi/Lo: hi + halpa low-maski, 40 %
 *                  pöydistä ohittaa low'n)
 */
(function (global) {
    'use strict';

    const HOLDEM_KEY = /^[2-9TJQKA]{2}[so]?$/;
    const OMAHA_KEY = /^([2-9TJQKA][shdc]){4}$/;
    const OMAHA5_KEY = /^([2-9TJQKA][shdc]){5}$/;

    const GAMES = {
        holdem: {
            id: 'holdem', name: "Hold'em", cardsPerPlayer: 2, hiLo: false, maxPlayers: 10,
            keyPattern: HOLDEM_KEY, tableSuffixes: ['exact', 'hybrid', '1m'],
            simCost: 1.0e-7, exactCost: 3.5e-8
        },
        omaha: {
            id: 'omaha', name: 'Omaha', cardsPerPlayer: 4, hiLo: false, maxPlayers: 9,
            keyPattern: OMAHA_KEY, tableSuffixes: ['exact', 'hybrid'],
            simCost: 4.8e-6, exactCost: 2.2e-6
        },
        omaha5: {
            id: 'omaha5', name: 'Omaha5', cardsPerPlayer: 5, hiLo: false, maxPlayers: 9,
            keyPattern: OMAHA5_KEY, tableSuffixes: ['exact', 'hybrid'],
            simCost: 8.0e-6, exactCost: 3.7e-6
        },
        omahahilo: {
            id: 'omahahilo', name: 'Omaha Hi/Lo', cardsPerPlayer: 4, hiLo: true, maxPlayers: 9,
            keyPattern: OMAHA_KEY, tableSuffixes: ['exact', 'hybrid'],
            simCost: 6.5e-6, exactCost: 3.0e-6
        }
    };
    Object.freeze(GAMES);

    const GAME_TYPES = Object.freeze(Object.keys(GAMES));

    // Suurin pelaajamäärä yli kaikkien pelimuotojen (syötteiden ylärajaksi)
    const MAX_PLAYERS_ANY = Math.max(...GAME_TYPES.map(g => GAMES[g].maxPlayers));

    function isGameType(type) {
        return typeof type === 'string' && Object.prototype.hasOwnProperty.call(GAMES, type);
    }

    /** Pelimuodon tiedot; heittää tuntemattomalla tyypillä */
    function gameOf(type) {
        if (!isGameType(type)) throw new Error('Unknown game type: ' + type);
        return GAMES[type];
    }

    /**
     * Top X % -sääntö: käsi kuuluu alueeseen, jos sen kombopainotettu
     * top-% on korkeintaan X. Pieni epsilon sietää liukulukujen pyöristyksen
     * rajalla (esim. pct = 100 ja viimeisen rivin 100.0000001). Sama sääntö
     * palvelimella (rangeSlice), simulaattorissa ja rankingsivulla.
     */
    function inTopPct(topPct, pct) {
        return typeof topPct === 'number' && topPct <= pct + 1e-9;
    }

    const PokerGames = { GAMES, GAME_TYPES, MAX_PLAYERS_ANY, isGameType, gameOf, inTopPct };

    global.PokerGames = PokerGames;
    if (typeof module !== 'undefined' && module.exports) module.exports = PokerGames;
})(typeof self !== 'undefined' ? self : globalThis);
