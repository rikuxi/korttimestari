// Korttien perusmääritykset - ei riippuvuuksia.
//
// Palvelin ja canonical.js käyttävät tätä suoraan: pokerUtils vetäisi
// mukanaan poker-evaluator-kirjaston, joka ajaa demosimulaation ja
// tulostaa sen stdoutiin jo require-hetkellä. Tuotantopalvelimen ei
// kuulu ladata evaluaattoria lainkaan (laskenta on public/js/engine.js:ssä).

'use strict';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];

// Regex kortin validoinnille (esim. "Ah", "2d")
const VALID_CARD_PATTERN = /^[2-9TJQKA][cdhs]$/;

/**
 * Tarkistaa onko korttijono validi (esim. "Ah")
 * @param {string} card - Kortti merkkijonona
 * @returns {boolean} - true jos validi
 */
function isValidCard(card) {
    return typeof card === 'string' && VALID_CARD_PATTERN.test(card);
}

module.exports = { RANKS, SUITS, isValidCard };
