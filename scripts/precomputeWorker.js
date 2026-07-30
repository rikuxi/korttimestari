// Eräajon worker: simuloi yhden kanonisen käsiluokan equityn.
// Tämä on erillinen, optimoitu polku VAIN offline-eräajoa varten
// (scripts/precompute.js) - palvelimen ajonaikainen simulaatio
// (worker.js + pokerUtils.js) ei muutu.
//
// Erot ajonaikaiseen polkuun:
//  - seedattava PRNG (mulberry32) -> ajo on toistettavissa
//  - osittainen Fisher-Yates: sekoitetaan vain tarvittavat kortit
//  - tasapelin osuus jaetaan (equity = voitot + sum(1/k))
//  - evaluointi katkaistaan heti kun joku vastustaja ohittaa heron

const pokerEvaluator = require('poker-evaluator');
const { createDeck, getCombinations } = require('../pokerUtils');

/**
 * Mulberry32 - nopea seedattava PRNG, palauttaa arvoja väliltä [0, 1)
 * @param {number} seed - 32-bittinen siemen
 * @returns {function(): number}
 */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * FNV-1a-hajautus merkkijonolle - käytetään per-käsi-siemenen johtamiseen
 * @param {string} str
 * @returns {number} - 32-bittinen hajautusarvo
 */
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/**
 * Simuloi yhden Hold'em-käsiluokan: hero vs. satunnaiset vastustajat,
 * kaikki all-in preflop, koko board jaetaan joka kierroksella.
 * @param {string[]} heroHand - Heron 2 korttia (edustajakäsi)
 * @param {number} opponents - Vastustajien määrä (1-9)
 * @param {number} simulations - Kierrosten määrä
 * @param {number} seed - PRNG:n siemen
 * @returns {{wins: number, ties: number, equitySum: number}}
 *   wins = yksin voitetut, ties = jaetut potit, equitySum = wins + sum(1/k)
 */
function simulateHandClass(heroHand, opponents, simulations, seed) {
    const rand = mulberry32(seed);
    const deck = createDeck().filter(c => c !== heroHand[0] && c !== heroHand[1]);
    const deckLen = deck.length;
    const need = opponents * 2 + 5; // vastustajien kortit + board
    const boardStart = opponents * 2;

    // Uudelleenkäytettävät 7 kortin taulukot (vältetään allokoinnit silmukassa)
    const hero7 = [heroHand[0], heroHand[1], '', '', '', '', ''];
    const opp7 = ['', '', '', '', '', '', ''];

    let wins = 0;
    let ties = 0;
    let equitySum = 0;

    for (let n = 0; n < simulations; n++) {
        // Osittainen Fisher-Yates: sekoitetaan vain 'need' ensimmäistä korttia
        for (let i = 0; i < need; i++) {
            const j = i + Math.floor(rand() * (deckLen - i));
            const tmp = deck[i];
            deck[i] = deck[j];
            deck[j] = tmp;
        }

        // Board taulukoiden loppuun (indeksit 2-6)
        for (let b = 0; b < 5; b++) {
            hero7[2 + b] = deck[boardStart + b];
            opp7[2 + b] = deck[boardStart + b];
        }

        const heroValue = pokerEvaluator.evalHand(hero7).value;

        // Heron equitylle riittää tieto: ohittiko joku heron, ja monenko
        // kanssa hero jakaa kärjen -> katkaistaan heti kun hero häviää
        let heroBest = true;
        let tiedCount = 1;
        for (let i = 0; i < opponents; i++) {
            opp7[0] = deck[i * 2];
            opp7[1] = deck[i * 2 + 1];
            const v = pokerEvaluator.evalHand(opp7).value;
            if (v > heroValue) {
                heroBest = false;
                break;
            }
            if (v === heroValue) {
                tiedCount++;
            }
        }

        if (heroBest) {
            if (tiedCount === 1) {
                wins++;
                equitySum += 1;
            } else {
                ties++;
                equitySum += 1 / tiedCount;
            }
        }
    }

    return { wins, ties, equitySum };
}

/**
 * Simuloi yhden Omaha-käsiluokan: hero vs. satunnaiset vastustajat,
 * kaikki all-in preflop. Omahassa käytetään tasan 2 korttia kädestä ja
 * 3 pöydästä (4 kortin kädellä 6 x 10 = 60 viiden kortin yhdistelmää).
 *
 * Optimoinnit verrattuna ajonaikaiseen evaluateOmahaHand-polkuun:
 *  - heron 2 kortin yhdistelmät lasketaan kerran per käsiluokka
 *  - pöydän 3 kortin yhdistelmät lasketaan kerran per kierros ja
 *    jaetaan kaikkien pelaajien kesken
 *  - vastustajan evaluointi katkaistaan heti kun tämä ohittaa heron
 *
 * Toimii myös 5 kortin Omahalle (10 x 10 yhdistelmää), kunhan heroHand
 * sisältää 5 korttia.
 * @param {string[]} heroHand - Heron 4 (tai 5) korttia
 * @param {number} opponents - Vastustajien määrä (1-9)
 * @param {number} simulations - Kierrosten määrä
 * @param {number} seed - PRNG:n siemen
 * @returns {{wins: number, ties: number, equitySum: number}}
 */
function simulateOmahaHandClass(heroHand, opponents, simulations, seed) {
    const rand = mulberry32(seed);
    const deck = createDeck().filter(c => !heroHand.includes(c));
    const deckLen = deck.length;
    const cardsPerPlayer = heroHand.length;
    const need = opponents * cardsPerPlayer + 5;
    const boardStart = opponents * cardsPerPlayer;

    // Heron 2 kortin yhdistelmät: kiinteät koko ajon ajan
    const heroCombos = getCombinations(heroHand, 2);
    // Vastustajan 2 kortin yhdistelmien indeksiparit (samat kaikille)
    const pairIdx = getCombinations([...Array(cardsPerPlayer).keys()], 2);
    // Pöydän 3 kortin yhdistelmien indeksit (10 kpl)
    const boardIdx = getCombinations([0, 1, 2, 3, 4], 3);

    // Uudelleenkäytettävät taulukot (vältetään allokoinnit silmukassa)
    const five = ['', '', '', '', ''];
    const boardCombos = boardIdx.map(() => ['', '', '']);
    const oppCombos = pairIdx.map(() => ['', '']);

    let wins = 0;
    let ties = 0;
    let equitySum = 0;

    // Paras arvo annetuilla 2 kortin yhdistelmillä; keskeytys kun
    // stopAbove ylittyy (vastustaja on jo ohittanut heron)
    const bestOmahaValue = (twoCombos, stopAbove) => {
        let best = 0;
        for (let p = 0; p < twoCombos.length; p++) {
            five[0] = twoCombos[p][0];
            five[1] = twoCombos[p][1];
            for (let b = 0; b < boardCombos.length; b++) {
                five[2] = boardCombos[b][0];
                five[3] = boardCombos[b][1];
                five[4] = boardCombos[b][2];
                const v = pokerEvaluator.evalHand(five).value;
                if (v > best) {
                    best = v;
                    if (stopAbove > 0 && best > stopAbove) {
                        return best;
                    }
                }
            }
        }
        return best;
    };

    for (let n = 0; n < simulations; n++) {
        // Osittainen Fisher-Yates: sekoitetaan vain 'need' ensimmäistä korttia
        for (let i = 0; i < need; i++) {
            const j = i + Math.floor(rand() * (deckLen - i));
            const tmp = deck[i];
            deck[i] = deck[j];
            deck[j] = tmp;
        }

        // Pöydän 3 kortin yhdistelmät kerran - jaetaan kaikille pelaajille
        for (let b = 0; b < boardIdx.length; b++) {
            boardCombos[b][0] = deck[boardStart + boardIdx[b][0]];
            boardCombos[b][1] = deck[boardStart + boardIdx[b][1]];
            boardCombos[b][2] = deck[boardStart + boardIdx[b][2]];
        }

        const heroValue = bestOmahaValue(heroCombos, 0);

        let heroBest = true;
        let tiedCount = 1;
        for (let i = 0; i < opponents; i++) {
            const base = i * cardsPerPlayer;
            for (let p = 0; p < pairIdx.length; p++) {
                oppCombos[p][0] = deck[base + pairIdx[p][0]];
                oppCombos[p][1] = deck[base + pairIdx[p][1]];
            }
            const v = bestOmahaValue(oppCombos, heroValue);
            if (v > heroValue) {
                heroBest = false;
                break;
            }
            if (v === heroValue) {
                tiedCount++;
            }
        }

        if (heroBest) {
            if (tiedCount === 1) {
                wins++;
                equitySum += 1;
            } else {
                ties++;
                equitySum += 1 / tiedCount;
            }
        }
    }

    return { wins, ties, equitySum };
}

module.exports = { simulateHandClass, simulateOmahaHandClass, mulberry32, fnv1a };

// Worker-tilassa: vastaanota tehtäviä pääsäikeeltä
const { parentPort } = require('worker_threads');
if (parentPort) {
    parentPort.on('message', (task) => {
        const { key, hand, opponents, simulations, seed, gameType } = task;
        // Johda per-käsi-siemen, jotta tulos ei riipu tehtävien jakojärjestyksestä
        const handSeed = (seed ^ fnv1a(key)) >>> 0;
        const isOmaha = gameType === 'omaha' || gameType === 'omaha5';
        const result = isOmaha
            ? simulateOmahaHandClass(hand, opponents, simulations, handSeed)
            : simulateHandClass(hand, opponents, simulations, handSeed);
        parentPort.postMessage({
            key,
            wins: result.wins,
            ties: result.ties,
            equitySum: result.equitySum
        });
    });
}
