const { isValidCard, RANKS, SUITS } = require('./cards');

// Arvot suurimmasta pienimpään (A, K, Q, ..., 2)
const RANKS_DESC = [...RANKS].reverse();

// Järjestysindeksit korttien deterministiseen lajitteluun
const RANK_ORDER = new Map(RANKS.map((r, i) => [r, i]));
const SUIT_ORDER = new Map(SUITS.map((s, i) => [s, i]));

// Kaikki 24 värien permutaatiota, esim. {s:'h', h:'s', d:'d', c:'c'}
const SUIT_PERMUTATIONS = (() => {
    const perms = [];
    for (const a of SUITS) {
        for (const b of SUITS) {
            if (b === a) continue;
            for (const c of SUITS) {
                if (c === a || c === b) continue;
                const d = SUITS.find(s => s !== a && s !== b && s !== c);
                perms.push({ [SUITS[0]]: a, [SUITS[1]]: b, [SUITS[2]]: c, [SUITS[3]]: d });
            }
        }
    }
    return perms;
})();

/**
 * Kanonisoi Texas Hold'em -aloituskäden luokka-avaimeksi.
 * Esim. ['As','Kh'] -> 'AKo', ['2s','3s'] -> '32s', ['7c','7d'] -> '77'
 * @param {string[]} hand - Kaksi korttia, esim. ['As', 'Kh']
 * @returns {string|null} - Kanoninen avain tai null jos käsi ei ole validi
 */
function canonicalizeHoldem(hand) {
    if (!Array.isArray(hand) || hand.length !== 2) {
        return null;
    }
    const [c1, c2] = hand;
    if (!isValidCard(c1) || !isValidCard(c2) || c1 === c2) {
        return null;
    }

    const r1 = c1[0];
    const r2 = c2[0];
    if (r1 === r2) {
        return r1 + r2;
    }

    // Järjestä arvot suurin ensin
    const hi = RANKS.indexOf(r1) > RANKS.indexOf(r2) ? r1 : r2;
    const lo = hi === r1 ? r2 : r1;
    const suited = c1[1] === c2[1];
    return hi + lo + (suited ? 's' : 'o');
}

/**
 * Enumeroi kaikki 169 kanonista Hold'em-aloituskäsiluokkaa.
 * Jokaiselle luokalle annetaan yksi konkreettinen edustajakäsi simulointia
 * varten (värisymmetrian nojalla equity on sama kaikille luokan käsille)
 * sekä paino eli konkreettisten kombojen määrä (yhteensä 1326).
 * @returns {{key: string, hand: string[], combos: number}[]}
 */
function enumerateHoldemCanonical() {
    const classes = [];
    for (let i = 0; i < RANKS_DESC.length; i++) {
        for (let j = i; j < RANKS_DESC.length; j++) {
            const hi = RANKS_DESC[i];
            const lo = RANKS_DESC[j];
            if (i === j) {
                classes.push({ key: hi + lo, hand: [hi + 's', hi + 'h'], combos: 6 });
            } else {
                classes.push({ key: hi + lo + 's', hand: [hi + 's', lo + 's'], combos: 4 });
                classes.push({ key: hi + lo + 'o', hand: [hi + 's', lo + 'h'], combos: 12 });
            }
        }
    }
    return classes;
}

/**
 * Lajittelee kortit deterministisesti (arvo suurin ensin, sitten väri
 * järjestyksessä s, h, d, c) ja yhdistää yhdeksi avainmerkkijonoksi.
 * @param {string[]} cards
 * @returns {string} - esim. 'AsAhKsKh'
 */
function sortedHandKey(cards) {
    return [...cards].sort((x, y) => {
        const dr = RANK_ORDER.get(y[0]) - RANK_ORDER.get(x[0]);
        if (dr !== 0) return dr;
        return SUIT_ORDER.get(x[1]) - SUIT_ORDER.get(y[1]);
    }).join('');
}

/**
 * Kanoninen avain ilman syötteen validointia (sisäiseen enumerointiin).
 * Käy läpi kaikki 24 värien permutaatiota ja valitsee leksikografisesti
 * pienimmän lajitellun käsimerkkijonon - näin kaikki väri-isomorfiset
 * kädet saavat saman avaimen.
 * @param {string[]} hand
 * @returns {string}
 */
function canonicalKey(hand) {
    const mapped = new Array(hand.length);
    let best = null;
    for (const perm of SUIT_PERMUTATIONS) {
        for (let i = 0; i < hand.length; i++) {
            mapped[i] = hand[i][0] + perm[hand[i][1]];
        }
        const key = sortedHandKey(mapped);
        if (best === null || key < best) {
            best = key;
        }
    }
    return best;
}

/**
 * Kanonisoi Omaha-aloituskäden (4 korttia) luokka-avaimeksi.
 * Avain on luokan edustajakäsi merkkijonona, esim. 'AsAhKsKh'.
 * @param {string[]} hand - Neljä korttia, esim. ['As', 'Kh', 'Qd', 'Jc']
 * @returns {string|null} - Kanoninen avain tai null jos käsi ei ole validi
 */
function canonicalizeOmaha(hand) {
    if (!Array.isArray(hand) || hand.length !== 4) {
        return null;
    }
    if (!hand.every(isValidCard) || new Set(hand).size !== 4) {
        return null;
    }
    return canonicalKey(hand);
}

/**
 * Kanonisoi 5 kortin Omaha-aloituskäden luokka-avaimeksi.
 * Sama väri-isomorfia kuin nelikortoisessa, vain käsi on pidempi.
 * @param {string[]} hand - Viisi korttia
 * @returns {string|null} - Kanoninen avain tai null jos käsi ei ole validi
 */
function canonicalizeOmaha5(hand) {
    if (!Array.isArray(hand) || hand.length !== 5) {
        return null;
    }
    if (!hand.every(isValidCard) || new Set(hand).size !== 5) {
        return null;
    }
    return canonicalKey(hand);
}

/**
 * Purkaa kanonisen avaimen takaisin korttitaulukoksi: 'AsAhKsKh' -> ['As','Ah','Ks','Kh']
 * @param {string} key
 * @returns {string[]}
 */
function keyToHand(key) {
    return key.match(/.{2}/g);
}

/**
 * Purkaa kanonisen Omaha-avaimen ihmisluettavaksi luokkanimeksi:
 * arvot suurimmasta pienimpään + väripatterni suluissa.
 *
 * Patternikoodit:
 *   ds = double-suited, kaksi väriparia (2+2)
 *   ss = single-suited, yksi väripari (2+1+1)
 *   3s = kolme samaa maata (3+1)
 *   m  = monotone, kaikki samaa maata (4)
 *   r  = rainbow, kaikki eri maata (1+1+1+1)
 *
 * Esim. 'AdAcKdKc' -> 'AAKK (ds)', 'AdKcQhJs' -> 'AKQJ (r)'
 *
 * HUOM: nimi ei ole yksikäsitteinen luokkatunniste - esim. "AKQJ (ss)"
 * kattaa useita luokkia riippuen siitä, mitkä kaksi korttia jakavat maan.
 * Yksikäsitteinen tunniste on aina avain itse.
 * @param {string} key - Kanoninen avain, esim. 'AdAcKdKc'
 * @returns {string|null} - Luokkanimi tai null jos avain ei ole validi
 */
function describeOmahaKey(key) {
    if (typeof key !== 'string' || (key.length !== 8 && key.length !== 10)) {
        return null;
    }
    const hand = keyToHand(key);
    if (!hand || (hand.length !== 4 && hand.length !== 5) || !hand.every(isValidCard)) {
        return null;
    }

    const ranks = hand.map(c => c[0]).join('');

    const suitCounts = new Map();
    for (const card of hand) {
        suitCounts.set(card[1], (suitCounts.get(card[1]) || 0) + 1);
    }
    const counts = [...suitCounts.values()].sort((a, b) => b - a);

    let pattern;
    if (counts[0] === hand.length) {
        pattern = 'm';                                  // kaikki samaa maata
    } else if (counts[0] === 4) {
        pattern = '4s';                                 // vain 5 kortin kädessä
    } else if (counts[0] === 3 && counts[1] === 2) {
        pattern = '3s2';                                // vain 5 kortin kädessä
    } else if (counts[0] === 3) {
        pattern = '3s';
    } else if (counts[0] === 2 && counts[1] === 2) {
        pattern = 'ds';
    } else if (counts[0] === 2) {
        pattern = 'ss';
    } else {
        pattern = 'r';
    }

    return `${ranks} (${pattern})`;
}

/**
 * Enumeroi kaikki kanoniset Omaha-aloituskäsiluokat (16 432 kpl) käymällä
 * läpi kaikki C(52,4) = 270 725 konkreettista kättä. Kestää muutaman
 * sekunnin - tarkoitettu eräajon käynnistysvaiheeseen.
 * Edustajakäsi on avain itse purettuna korteiksi.
 * @returns {{key: string, hand: string[], combos: number}[]}
 */
function enumerateOmahaCanonical() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push(rank + suit);
        }
    }

    const counts = new Map();
    const hand = new Array(4);
    for (let i = 0; i < deck.length; i++) {
        hand[0] = deck[i];
        for (let j = i + 1; j < deck.length; j++) {
            hand[1] = deck[j];
            for (let k = j + 1; k < deck.length; k++) {
                hand[2] = deck[k];
                for (let l = k + 1; l < deck.length; l++) {
                    hand[3] = deck[l];
                    const key = canonicalKey(hand);
                    counts.set(key, (counts.get(key) || 0) + 1);
                }
            }
        }
    }

    return [...counts.entries()].map(([key, combos]) => ({
        key,
        hand: keyToHand(key),
        combos
    }));
}

/**
 * Purkaa kanonisen Omaha-avaimen yksikäsitteiseksi merkinnäksi, jossa saman
 * maan kortit ovat suluissa: 'AdAcJdJcTh' -> '(AJ)(AJ)T'.
 *
 * describeOmahaKey antaa vain arvot ja väripatternin ('AAJJT (ds)'), mikä ei
 * yksilöi luokkaa - viisikorttisessa 134 459 luokalle on vain 28 496 nimeä.
 * Tämä merkintä erottaa ne. Sama muoto jota ProPokerTools käyttää.
 *
 * @param {string} key - Kanoninen avain
 * @returns {string|null}
 */
function omahaNotation(key) {
    if (typeof key !== 'string' || key.length % 2 !== 0) return null;
    const hand = keyToHand(key);
    if (!hand || !hand.every(isValidCard)) return null;

    const bySuit = new Map();
    for (const card of hand) {
        if (!bySuit.has(card[1])) bySuit.set(card[1], []);
        bySuit.get(card[1]).push(card[0]);
    }
    const groups = [...bySuit.values()].map(ranks =>
        ranks.sort((a, b) => RANK_ORDER.get(b) - RANK_ORDER.get(a)));

    // Ryhmät arvojonon mukaan laskevasti, tasatilanteessa pidempi ensin.
    // Tämä on ProPokerToolsin järjestys: se tuottaa heidän 16 432 rivistään
    // bitilleen samat merkkijonot (verifioitu), joten taulukot ovat suoraan
    // vertailukelpoisia. Huomaa ettei ryhmän koko ratkaise: 'AA(JT)' eikä
    // '(JT)AA', koska ässä on jättiä korkeampi.
    groups.sort((a, b) => {
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) {
            const d = RANK_ORDER.get(b[i]) - RANK_ORDER.get(a[i]);
            if (d !== 0) return d;
        }
        return b.length - a.length;
    });

    return groups.map(g => (g.length > 1 ? `(${g.join('')})` : g[0])).join('');
}

/**
 * Enumeroi kaikki kanoniset 5 kortin Omaha-aloituskäsiluokat (134 459 kpl)
 * käymällä läpi kaikki C(52,5) = 2 598 960 konkreettista kättä.
 * Kestää kymmeniä sekunteja - tarkoitettu eräajon käynnistysvaiheeseen.
 * @returns {{key: string, hand: string[], combos: number}[]}
 */
function enumerateOmaha5Canonical() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push(rank + suit);
        }
    }

    const counts = new Map();
    const hand = new Array(5);
    for (let i = 0; i < deck.length; i++) {
        hand[0] = deck[i];
        for (let j = i + 1; j < deck.length; j++) {
            hand[1] = deck[j];
            for (let k = j + 1; k < deck.length; k++) {
                hand[2] = deck[k];
                for (let l = k + 1; l < deck.length; l++) {
                    hand[3] = deck[l];
                    for (let m = l + 1; m < deck.length; m++) {
                        hand[4] = deck[m];
                        const key = canonicalKey(hand);
                        counts.set(key, (counts.get(key) || 0) + 1);
                    }
                }
            }
        }
    }

    return [...counts.entries()].map(([key, combos]) => ({
        key,
        hand: keyToHand(key),
        combos
    }));
}

module.exports = {
    canonicalizeHoldem,
    enumerateHoldemCanonical,
    canonicalizeOmaha,
    canonicalizeOmaha5,
    enumerateOmahaCanonical,
    enumerateOmaha5Canonical,
    describeOmahaKey,
    omahaNotation,
    keyToHand,
    RANKS_DESC
};
