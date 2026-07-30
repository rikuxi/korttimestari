// Osittaiskäsihaku esilaskettuihin ranking-taulukoihin.
//
// Käyttäjä syöttää koko käden tai osan siitä, ja haku palauttaa kaikki
// kanoniset luokat jotka voivat sisältää sen. Kyselykieli:
//
//   AAJ           pelkät arvot: luokassa on oltava vähintään A, A ja J,
//                 maita ei rajoiteta
//   (AJ)(AJ)      sulkuryhmä = nämä kortit jakavat saman maan; eri ryhmät
//                 ovat eri maissa
//   AsAhJd        konkreettiset maat: sama maakirjain = sama maa, eri
//                 kirjain = eri maa (AsKs on siis sama asia kuin (AK))
//   AKs / AKo     vain Hold'em: suited / offsuit -lyhennys
//
// Maakirjaimet ovat vain samuusluokkia - luokat ovat maasymmetrian yli
// kanonisoituja, joten "pata" ei tarkoita mitään absoluuttista.
//
// Sovitus: löytyykö luokan korteista injektio kyselyn korteille niin, että
// arvot täsmäävät ja ryhmät kuvautuvat eri maihin. Luokassa on enintään 5
// korttia, joten pieni peruutushaku riittää; arvopeitteen esitarkistus
// karsii valtaosan riveistä ennen sitä.

'use strict';

const { keyToHand } = require('./canonical');
const { cardToInt } = require('./public/js/engine');

const RANK_CHARS = '23456789TJQKA';
const SUIT_CHARS = 'shdc';

const CPP = { holdem: 2, omaha: 4, omaha5: 5 };

/**
 * Kyselyvirhe koneluettavalla koodilla: UI kääntää koodin käyttäjän
 * kielelle (public/i18n.js), error-teksti jää fallbackiksi.
 */
function queryError(message, code, params) {
    const e = new Error(message);
    e.code = code;
    if (params) e.params = params;
    return e;
}

/**
 * Jäsennä hakukysely. Palauttaa null jos kysely on tyhjä (= selaa kaikki),
 * muuten { cards: [{rank, group}], groupCount, rankCount }. Heittää
 * virheen kelvottomasta syötteestä.
 */
function parseQuery(raw, gameType) {
    const cpp = CPP[gameType];
    const q = String(raw || '').replace(/\s+/g, '');
    if (!q) return null;

    const cards = [];
    const groups = [];              // ryhmien tunnisteet järjestyksessä
    const suitGroup = new Map();    // maakirjain -> ryhmäindeksi

    // Hold'emin vakiolyhennys voittaa maatulkinnan: AKs = suited,
    // ei "A + K pataa" (joka ei rajoittaisi mitään)
    const shorthand = gameType === 'holdem' &&
        /^([2-9TJQKA])([2-9TJQKA])([so])$/i.exec(q);
    if (shorthand) {
        const r1 = RANK_CHARS.indexOf(shorthand[1].toUpperCase());
        const r2 = RANK_CHARS.indexOf(shorthand[2].toUpperCase());
        if (r1 === r2) throw queryError('Invalid query: pair cannot be suited or offsuit', 'query_pair_suited');
        if (shorthand[3].toLowerCase() === 's') {
            cards.push({ rank: r1, group: 0 }, { rank: r2, group: 0 });
            groups.push(0);
        } else {
            cards.push({ rank: r1, group: 0 }, { rank: r2, group: 1 });
            groups.push(0, 1);
        }
    } else {
        let i = 0;
        while (i < q.length) {
            if (q[i] === '(') {
                const end = q.indexOf(')', i);
                if (end <= i + 1) throw queryError('Invalid query: empty or unclosed group', 'query_bad_group');
                const gid = groups.length;
                groups.push(gid);
                for (let j = i + 1; j < end; j++) {
                    const rank = RANK_CHARS.indexOf(q[j].toUpperCase());
                    if (rank < 0) throw queryError(`Invalid query: '${q[j]}' inside a group`, 'query_bad_char_in_group', { char: q[j] });
                    cards.push({ rank, group: gid });
                }
                i = end + 1;
                continue;
            }
            const rank = RANK_CHARS.indexOf(q[i].toUpperCase());
            if (rank < 0) throw queryError(`Invalid query: '${q[i]}'`, 'query_bad_char', { char: q[i] });
            const suit = i + 1 < q.length ? SUIT_CHARS.indexOf(q[i + 1].toLowerCase()) : -1;
            if (suit >= 0) {
                const sc = q[i + 1].toLowerCase();
                if (!suitGroup.has(sc)) {
                    suitGroup.set(sc, groups.length);
                    groups.push(groups.length);
                }
                cards.push({ rank, group: suitGroup.get(sc) });
                i += 2;
            } else {
                cards.push({ rank, group: null });
                i += 1;
            }
        }
    }

    if (cards.length === 0) return null;
    if (cards.length > cpp) {
        throw queryError(`Invalid query: at most ${cpp} cards for ${gameType}`, 'query_too_many_cards', { max: cpp });
    }
    if (groups.length > 4) throw queryError('Invalid query: more than four suit groups', 'query_too_many_groups');

    // Ryhmitellyt kortit ensin - maasidonnat ratkeavat aikaisin ja
    // peruutushaku karsiutuu nopeammin
    cards.sort((a, b) => (a.group === null) - (b.group === null));

    const rankCount = new Int32Array(13);
    for (const c of cards) rankCount[c.rank]++;
    return { cards, groupCount: groups.length, rankCount };
}

/** Luokan edustajakortit kokonaislukuina (rank*4 + suit) */
function classCards(row, gameType) {
    if (gameType === 'holdem') {
        // 'AA' -> eri maat; 'AKs' -> sama maa; 'AKo' -> eri maat
        const r1 = RANK_CHARS.indexOf(row.key[0]);
        const r2 = RANK_CHARS.indexOf(row.key[1]);
        const suited = row.key[2] === 's';
        return [r1 * 4, r2 * 4 + (suited ? 0 : 1)];
    }
    return keyToHand(row.key).map(cardToInt);
}

/** Rakenna taulukolle pakattu korttihakemisto (kerran, laiskasti) */
function ensureIndex(table, gameType) {
    if (table.searchCards) return;
    const cpp = CPP[gameType];
    const buf = new Uint8Array(table.rows.length * cpp);
    for (let i = 0; i < table.rows.length; i++) {
        const cards = classCards(table.rows[i], gameType);
        for (let j = 0; j < cpp; j++) buf[i * cpp + j] = cards[j];
    }
    table.searchCards = buf;
}

// Uudelleenkäytettävät puskurit (palvelin on yksisäikeinen)
const RC = new Int32Array(13);
const GROUP_SUIT = new Int32Array(4);

/** Sopiiko kysely luokkaan, jonka kortit ovat buf[base..base+cpp-1] */
function matchAt(buf, base, cpp, parsed) {
    // Arvopeite: luokassa on oltava kyselyn arvot vähintään yhtä monesti
    for (let i = 0; i < cpp; i++) RC[buf[base + i] >> 2]++;
    let ok = true;
    for (let i = 0; i < parsed.cards.length; i++) {
        const r = parsed.cards[i].rank;
        if (parsed.rankCount[r] > RC[r]) { ok = false; break; }
    }
    for (let i = 0; i < cpp; i++) RC[buf[base + i] >> 2] = 0;
    if (!ok) return false;

    // Ilman maaryhmiä arvopeite on koko ehto
    if (parsed.groupCount === 0) return true;

    GROUP_SUIT.fill(-1);
    const q = parsed.cards;

    function rec(idx, usedMask) {
        if (idx === q.length) return true;
        const want = q[idx];
        for (let i = 0; i < cpp; i++) {
            if (usedMask & (1 << i)) continue;
            const c = buf[base + i];
            if ((c >> 2) !== want.rank) continue;
            if (want.group === null) {
                if (rec(idx + 1, usedMask | (1 << i))) return true;
                continue;
            }
            const s = c & 3;
            const bound = GROUP_SUIT[want.group];
            if (bound === s) {
                if (rec(idx + 1, usedMask | (1 << i))) return true;
            } else if (bound === -1) {
                // Injektio: maa ei saa olla jo toisen ryhmän käytössä
                let taken = false;
                for (let g = 0; g < parsed.groupCount; g++) {
                    if (GROUP_SUIT[g] === s) { taken = true; break; }
                }
                if (taken) continue;
                GROUP_SUIT[want.group] = s;
                if (rec(idx + 1, usedMask | (1 << i))) return true;
                GROUP_SUIT[want.group] = -1;
            }
        }
        return false;
    }
    return rec(0, 0);
}

/**
 * Hae taulukosta kyselyä vastaavat rivit sijajärjestyksessä.
 * @param {?object} parsed - parseQueryn tulos; null = kaikki rivit
 * @returns {{total: number, hands: object[]}}
 */
function searchTable(table, gameType, parsed, offset, limit) {
    const rows = table.rows;
    if (!parsed) {
        return { total: rows.length, hands: rows.slice(offset, offset + limit) };
    }
    ensureIndex(table, gameType);
    const cpp = CPP[gameType];
    const buf = table.searchCards;
    const hands = [];
    let total = 0;
    for (let i = 0; i < rows.length; i++) {
        if (!matchAt(buf, i * cpp, cpp, parsed)) continue;
        if (total >= offset && hands.length < limit) hands.push(rows[i]);
        total++;
    }
    return { total, hands };
}

module.exports = { parseQuery, searchTable, classCards, CPP };
