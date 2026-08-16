/**
 * Korttimestarin laskentamoottori.
 *
 * Sama tiedosto ajetaan sekä selaimessa (Web Worker: importScripts) että
 * palvelimella (require), jotta molemmat polut antavat bitilleen saman
 * tuloksen.
 *
 * Kortit ovat kokonaislukuja 0..51: arvo = c >> 2 (0 = kakkonen, 12 = ässä),
 * maa = c & 3. Merkkijonoja käytetään vain rajapinnassa - sisäsilmukoissa
 * ei parsita eikä allokoida mitään.
 *
 * Käsien arvo koodataan muodossa kategoria * 15^5 + tiebreakerit, missä
 * tiebreakerit ovat ryhmien arvot järjestyksessä (määrä laskevasti, sitten
 * arvo laskevasti). Suorille ja värisuorille riittää korkein kortti.
 * eval7 tuottaa täsmälleen saman luvun kuin paras 21:stä eval5-kutsusta,
 * mikä tekee siitä suoraan testattavan.
 */
(function (global) {
    'use strict';

    const RANK_CHARS = '23456789TJQKA';
    const SUIT_CHARS = 'shdc';

    const CATEGORY_NAMES = [
        'high card', 'one pair', 'two pairs', 'three of a kind',
        'straight', 'flush', 'full house', 'four of a kind', 'straight flush'
    ];

    const P15 = [1, 15, 225, 3375, 50625, 759375];

    /** 'Ad' -> 48..51 -alueen kokonaisluku, tai -1 jos kortti ei kelpaa */
    function cardToInt(str) {
        if (typeof str !== 'string' || str.length !== 2) return -1;
        const r = RANK_CHARS.indexOf(str[0]);
        const s = SUIT_CHARS.indexOf(str[1]);
        if (r < 0 || s < 0) return -1;
        return r * 4 + s;
    }

    /** Kokonaisluku -> 'Ad' */
    function intToCard(c) {
        return RANK_CHARS[c >> 2] + SUIT_CHARS[c & 3];
    }

    /** Kategoria (0..8) käsien arvosta */
    function categoryOf(value) {
        return Math.floor(value / P15[5]);
    }

    // --- 5 kortin arviointi ------------------------------------------------

    const rc5 = new Int32Array(13);

    function eval5(a, b, c, d, e) {
        const ra = a >> 2, rb = b >> 2, rc = c >> 2, rd = d >> 2, re = e >> 2;
        rc5[ra]++; rc5[rb]++; rc5[rc]++; rc5[rd]++; rc5[re]++;

        const mask = (1 << ra) | (1 << rb) | (1 << rc) | (1 << rd) | (1 << re);
        const sa = a & 3;
        const flush = sa === (b & 3) && sa === (c & 3) && sa === (d & 3) && sa === (e & 3);

        let straightHigh = -1;
        if (rc5[ra] === 1 && rc5[rb] === 1 && rc5[rc] === 1 && rc5[rd] === 1 && rc5[re] === 1) {
            for (let hi = 12; hi >= 4; hi--) {
                if (((mask >>> (hi - 4)) & 31) === 31) { straightHigh = hi; break; }
            }
            // Pyörä A2345: korkein kortti on 5 (indeksi 3)
            if (straightHigh < 0 && (mask & 0x100F) === 0x100F) straightHigh = 3;
        }

        let g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0;
        let n0 = 0, n1 = 0, gi = 0;
        for (let cnt = 4; cnt >= 1; cnt--) {
            for (let r = 12; r >= 0; r--) {
                if (rc5[r] === cnt) {
                    if (gi === 0) { g0 = r; n0 = cnt; }
                    else if (gi === 1) { g1 = r; n1 = cnt; }
                    else if (gi === 2) g2 = r;
                    else if (gi === 3) g3 = r;
                    else g4 = r;
                    gi++;
                }
            }
        }

        rc5[ra] = 0; rc5[rb] = 0; rc5[rc] = 0; rc5[rd] = 0; rc5[re] = 0;

        let cat;
        if (straightHigh >= 0 && flush) cat = 8;
        else if (n0 === 4) cat = 7;
        else if (n0 === 3 && n1 === 2) cat = 6;
        else if (flush) cat = 5;
        else if (straightHigh >= 0) cat = 4;
        else if (n0 === 3) cat = 3;
        else if (n0 === 2 && n1 === 2) cat = 2;
        else if (n0 === 2) cat = 1;
        else cat = 0;

        if (cat === 8 || cat === 4) return cat * P15[5] + straightHigh * P15[4];
        return cat * P15[5] + g0 * P15[4] + g1 * P15[3] + g2 * P15[2] + g3 * P15[1] + g4;
    }

    // --- 7 kortin arviointi (Texas Hold'em) --------------------------------
    //
    // Suora vastaus ilman 21:n osajoukon läpikäyntiä: arvojakauma ja
    // maajakauma lasketaan kerran, ja kategoria luetaan niistä.

    const rc7 = new Int32Array(13);
    const suitMask = new Int32Array(4);
    const suitCount = new Int32Array(4);

    /** Korkein suora 13-bittisestä arvomaskista, tai -1 */
    function straightFrom(mask) {
        for (let hi = 12; hi >= 4; hi--) {
            if (((mask >>> (hi - 4)) & 31) === 31) return hi;
        }
        if ((mask & 0x100F) === 0x100F) return 3;
        return -1;
    }

    function eval7(c0, c1, c2, c3, c4, c5, c6) {
        const r0 = c0 >> 2, r1 = c1 >> 2, r2 = c2 >> 2, r3 = c3 >> 2,
            r4 = c4 >> 2, r5 = c5 >> 2, r6 = c6 >> 2;
        rc7[r0]++; rc7[r1]++; rc7[r2]++; rc7[r3]++; rc7[r4]++; rc7[r5]++; rc7[r6]++;

        const s0 = c0 & 3, s1 = c1 & 3, s2 = c2 & 3, s3 = c3 & 3,
            s4 = c4 & 3, s5 = c5 & 3, s6 = c6 & 3;
        suitMask[s0] |= 1 << r0; suitCount[s0]++;
        suitMask[s1] |= 1 << r1; suitCount[s1]++;
        suitMask[s2] |= 1 << r2; suitCount[s2]++;
        suitMask[s3] |= 1 << r3; suitCount[s3]++;
        suitMask[s4] |= 1 << r4; suitCount[s4]++;
        suitMask[s5] |= 1 << r5; suitCount[s5]++;
        suitMask[s6] |= 1 << r6; suitCount[s6]++;

        const mask = (1 << r0) | (1 << r1) | (1 << r2) | (1 << r3) |
            (1 << r4) | (1 << r5) | (1 << r6);

        let flushSuit = -1;
        if (suitCount[0] >= 5) flushSuit = 0;
        else if (suitCount[1] >= 5) flushSuit = 1;
        else if (suitCount[2] >= 5) flushSuit = 2;
        else if (suitCount[3] >= 5) flushSuit = 3;
        const flushMask = flushSuit >= 0 ? suitMask[flushSuit] : 0;

        // Ryhmittele arvot: laskurit käydään ylhäältä alas, joten
        // ensimmäisenä löytyvä on aina korkein
        let quad = -1, trip1 = -1, trip2 = -1, pair1 = -1, pair2 = -1;
        for (let r = 12; r >= 0; r--) {
            const n = rc7[r];
            if (n === 4) quad = r;
            else if (n === 3) { if (trip1 < 0) trip1 = r; else if (trip2 < 0) trip2 = r; }
            else if (n === 2) { if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; }
        }

        rc7[r0] = 0; rc7[r1] = 0; rc7[r2] = 0; rc7[r3] = 0; rc7[r4] = 0; rc7[r5] = 0; rc7[r6] = 0;
        suitMask[0] = 0; suitMask[1] = 0; suitMask[2] = 0; suitMask[3] = 0;
        suitCount[0] = 0; suitCount[1] = 0; suitCount[2] = 0; suitCount[3] = 0;

        // Värisuora
        if (flushSuit >= 0) {
            const sf = straightFrom(flushMask);
            if (sf >= 0) return 8 * P15[5] + sf * P15[4];
        }
        // Neloset
        if (quad >= 0) {
            let kicker = -1;
            for (let r = 12; r >= 0; r--) {
                if (r !== quad && (mask >>> r) & 1) { kicker = r; break; }
            }
            return 7 * P15[5] + quad * P15[4] + kicker * P15[3];
        }
        // Täyskäsi (myös kaksi kolmosta: alempi kolmonen toimii parina)
        if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
            const pair = trip2 > pair1 ? trip2 : pair1;
            return 6 * P15[5] + trip1 * P15[4] + pair * P15[3];
        }
        // Väri: viisi korkeinta väriarvoa
        if (flushSuit >= 0) {
            let v = 5 * P15[5], taken = 0;
            for (let r = 12; r >= 0 && taken < 5; r--) {
                if ((flushMask >>> r) & 1) { v += r * P15[4 - taken]; taken++; }
            }
            return v;
        }
        // Suora
        const st = straightFrom(mask);
        if (st >= 0) return 4 * P15[5] + st * P15[4];
        // Kolmoset
        if (trip1 >= 0) {
            let v = 3 * P15[5] + trip1 * P15[4], taken = 0;
            for (let r = 12; r >= 0 && taken < 2; r--) {
                if (r !== trip1 && (mask >>> r) & 1) { v += r * P15[3 - taken]; taken++; }
            }
            return v;
        }
        // Kaksi paria (kolmas pari toimii tarvittaessa kickerinä)
        if (pair2 >= 0) {
            let kicker = -1;
            for (let r = 12; r >= 0; r--) {
                if (r !== pair1 && r !== pair2 && (mask >>> r) & 1) { kicker = r; break; }
            }
            return 2 * P15[5] + pair1 * P15[4] + pair2 * P15[3] + kicker * P15[2];
        }
        // Pari
        if (pair1 >= 0) {
            let v = 1 * P15[5] + pair1 * P15[4], taken = 0;
            for (let r = 12; r >= 0 && taken < 3; r--) {
                if (r !== pair1 && (mask >>> r) & 1) { v += r * P15[3 - taken]; taken++; }
            }
            return v;
        }
        // Hai
        let v = 0, taken = 0;
        for (let r = 12; r >= 0 && taken < 5; r--) {
            if ((mask >>> r) & 1) { v += r * P15[4 - taken]; taken++; }
        }
        return v;
    }

    // --- Omaha -------------------------------------------------------------

    /** Kaikki 2 alkion indeksiparit joukosta 0..n-1 */
    function pairIndexes(n) {
        const out = [];
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push(i, j);
        return new Int32Array(out);
    }
    const HOLE_PAIRS = { 4: pairIndexes(4), 5: pairIndexes(5), 6: pairIndexes(6) };

    // Pöydän 10 kolmen kortin yhdistelmää indeksipareina
    const BOARD_TRIPLES = (() => {
        const t = [];
        for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) for (let k = j + 1; k < 5; k++) t.push(i, j, k);
        return new Int32Array(t);
    })();

    /**
     * Purkaa pöydän 10 kolmen kortin yhdistelmää valmiiksi korteiksi.
     * Tehdään kerran per kierros ja jaetaan kaikkien pelaajien kesken -
     * muuten samat indeksihaut toistuisivat 60 kertaa per pelaaja.
     * @param {Int32Array|number[]} board - viisi pöytäkorttia
     * @param {Int32Array} out - 30 alkion puskuri
     */
    function expandBoardTriples(board, out) {
        for (let b = 0; b < 30; b++) out[b] = board[BOARD_TRIPLES[b]];
        return out;
    }

    /** Omahan paras käsi puretuista pöytäkolmikoista (sisäinen nopea polku) */
    function evalOmahaFast(hole, holePairs, bt) {
        let best = 0;
        for (let p = 0; p < holePairs.length; p += 2) {
            const h1 = hole[holePairs[p]], h2 = hole[holePairs[p + 1]];
            for (let b = 0; b < 30; b += 3) {
                const v = eval5(h1, h2, bt[b], bt[b + 1], bt[b + 2]);
                if (v > best) best = v;
            }
        }
        return best;
    }

    const scratchTriples = new Int32Array(30);

    /**
     * Omahan paras käsi: tasan 2 korttia kädestä ja 3 pöydästä.
     * @param {Int32Array|number[]} hole - pelaajan kortit
     * @param {Int32Array} holePairs - HOLE_PAIRS[hole.length]
     * @param {Int32Array|number[]} board - viisi pöytäkorttia
     */
    function evalOmaha(hole, holePairs, board) {
        return evalOmahaFast(hole, holePairs, expandBoardTriples(board, scratchTriples));
    }

    // --- Omaha Hi/Lo: low-käden arviointi ----------------------------------
    //
    // 8-or-better: viisi eri arvoa, kaikki korkeintaan 8, ässä matalana.
    // Suorat ja värit eivät haittaa, joten maat ja kerrannaisuudet eivät
    // merkitse - low-käsi on pelkkä arvojoukko. Se koodataan 8-bittisenä
    // maskina (A = bitti 0, 2 = bitti 1, ..., 8 = bitti 7), jolloin
    // PIENEMPI maski kokonaislukuna on PAREMPI low: vertailu ratkeaa
    // korkeimman erottavan bitin eli korkeimman erottavan kortin kohdalla,
    // täsmälleen kuten säännöissä. Esim. 86432 (bitit 7,5,3,2,1 = 174)
    // voittaa 86532:n (bitit 7,5,4,2,1 = 182).

    // Sentinel "ei low'ta": suurempi kuin mikään kelvollinen maski (max 248)
    const NO_LOW = 0x100;

    // Kortin low-bitti, tai 0 jos kortti ei kelpaa low'hun (9..K)
    const LOW_BIT = (() => {
        const t = new Int32Array(52);
        for (let c = 0; c < 52; c++) {
            const r = c >> 2;                       // 0 = kakkonen .. 12 = ässä
            if (r === 12) t[c] = 1;                 // ässä on matalin
            else if (r <= 6) t[c] = 1 << (r + 1);   // 2..8
        }
        return t;
    })();

    // Bittien määrä 8-bittisessä maskissa
    const POP8 = (() => {
        const t = new Int32Array(256);
        for (let i = 1; i < 256; i++) t[i] = t[i >> 1] + (i & 1);
        return t;
    })();

    /**
     * Purkaa pöydän 10 kolmikon low-maskit. out[i] = kolmen eri low-arvon
     * maski, tai 0 jos kolmikko ei kelpaa low'n pohjaksi (sisältää kortin
     * 9..K tai toistuvan arvon - kummassakin bittejä jää alle kolmen).
     * @returns {boolean} - voiko tällä pöydällä ylipäänsä olla low
     */
    function expandBoardLowTriples(board, out) {
        let any = false;
        for (let i = 0, b = 0; b < 30; i++, b += 3) {
            const m = LOW_BIT[board[BOARD_TRIPLES[b]]]
                | LOW_BIT[board[BOARD_TRIPLES[b + 1]]]
                | LOW_BIT[board[BOARD_TRIPLES[b + 2]]];
            if (POP8[m] === 3) { out[i] = m; any = true; }
            else out[i] = 0;
        }
        return any;
    }

    /** Paras low puretuista pöytäkolmikoista (sisäinen nopea polku) */
    function evalOmahaLowFast(hole, holePairs, lowTriples) {
        let best = NO_LOW;
        for (let p = 0; p < holePairs.length; p += 2) {
            const pm = LOW_BIT[hole[holePairs[p]]] | LOW_BIT[hole[holePairs[p + 1]]];
            if (POP8[pm] !== 2) continue;
            for (let i = 0; i < 10; i++) {
                const tm = lowTriples[i];
                // Erillisyys: parin ja kolmikon bitit eivät saa leikata,
                // muuten arvoja olisi alle viisi
                if (tm !== 0 && (pm & tm) === 0) {
                    const m = pm | tm;
                    if (m < best) best = m;
                }
            }
        }
        return best;
    }

    const scratchLowTriples = new Int32Array(10);

    /**
     * Paras low-käsi: tasan 2 korttia kädestä ja 3 pöydästä, kaikki viisi
     * eri arvoja ja korkeintaan 8 (ässä matalana).
     * @param {Int32Array|number[]} hole - pelaajan kortit
     * @param {Int32Array} holePairs - HOLE_PAIRS[hole.length]
     * @param {Int32Array|number[]} board - viisi pöytäkorttia
     * @returns {number} - low-maski, tai NO_LOW jos kelvollista low'ta ei ole
     */
    function evalOmahaLow(hole, holePairs, board) {
        if (!expandBoardLowTriples(board, scratchLowTriples)) return NO_LOW;
        return evalOmahaLowFast(hole, holePairs, scratchLowTriples);
    }

    // --- Simulaatio --------------------------------------------------------

    // --- Käsialueet ---------------------------------------------------------
    //
    // Range-pelaaja ("top X % käsistä") saa joka kierroksella satunnaisen
    // käden äärellisestä käsijoukosta. Joukko tulee luokka-avaimina
    // (Hold'em: 'AKs' | 'AKo' | 'AA', Omaha: edustajakäsi 'AsAhKsKh') ja
    // laajennetaan tässä konkreettisiksi komboiksi, koska sisäsilmukassa ei
    // kanonisoida mitään: käsi arvotaan valmiista listasta O(1)-ajassa.

    // Binomikertoimet kombojen indeksointiin (colex-järjestys)
    const BINOM = (() => {
        const t = [];
        for (let n = 0; n <= 52; n++) {
            t.push(new Float64Array(6));
            for (let k = 0; k <= 5; k++) t[n][k] = binomialSmall(n, k);
        }
        return t;
    })();
    function binomialSmall(n, k) {
        if (k < 0 || k > n) return 0;
        let r = 1;
        for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
        return Math.round(r);
    }

    /** Nousevaan järjestykseen lajitellun kombon indeksi 0..C(52,k)-1 */
    function comboIndex(cards, k) {
        let idx = 0;
        for (let i = 0; i < k; i++) idx += BINOM[cards[i]][i + 1];
        return idx;
    }

    // Kaikki 24 väripermutaatiota (maa 0..3 -> maa)
    const SUIT_PERMS = (() => {
        const out = [];
        const p = [0, 1, 2, 3];
        const permute = (i) => {
            if (i === 4) { out.push(p.slice()); return; }
            for (let j = i; j < 4; j++) {
                [p[i], p[j]] = [p[j], p[i]];
                permute(i + 1);
                [p[i], p[j]] = [p[j], p[i]];
            }
        };
        permute(0);
        return out;
    })();

    /**
     * Laajentaa luokka-avaimet konkreettisiksi komboiksi.
     *
     * @param {string[]} keys - Hold'em: 'AA' | 'AKs' | 'AKo'; Omaha(5):
     *   kanoninen edustajakäsi 'AsAhKsKh' (väri-isomorfian nojalla luokka =
     *   kaikki 24 väripermutaatiota, duplikaatit pois)
     * @param {number} cardsPerPlayer - 2, 4 tai 5
     * @returns {Int32Array} - kombot peräkkäin, cardsPerPlayer korttia
     *   kutakin, kortit nousevassa järjestyksessä
     */
    function expandRangeKeys(keys, cardsPerPlayer) {
        const k = cardsPerPlayer;
        const seen = new Uint8Array(BINOM[52][k]);
        const out = [];
        const combo = new Int32Array(k);
        const push = () => {
            // Lajittele nousevaan järjestykseen (k <= 5: lisäyslajittelu)
            for (let i = 1; i < k; i++) {
                const v = combo[i]; let j = i - 1;
                while (j >= 0 && combo[j] > v) { combo[j + 1] = combo[j]; j--; }
                combo[j + 1] = v;
            }
            for (let i = 1; i < k; i++) if (combo[i] === combo[i - 1]) return;  // sama kortti kahdesti
            const ci = comboIndex(combo, k);
            if (seen[ci]) return;
            seen[ci] = 1;
            for (let i = 0; i < k; i++) out.push(combo[i]);
        };
        for (const key of keys) {
            if (typeof key !== 'string') continue;
            if (k === 2) {
                if (key.length < 2 || key.length > 3) continue;
                const r1 = RANK_CHARS.indexOf(key[0]), r2 = RANK_CHARS.indexOf(key[1]);
                if (r1 < 0 || r2 < 0) continue;
                const suffix = key[2];
                if (r1 === r2) {
                    if (key.length !== 2) continue;
                    for (let s = 0; s < 4; s++) for (let t = s + 1; t < 4; t++) {
                        combo[0] = r1 * 4 + s; combo[1] = r1 * 4 + t; push();
                    }
                } else if (suffix === 's') {
                    for (let s = 0; s < 4; s++) { combo[0] = r1 * 4 + s; combo[1] = r2 * 4 + s; push(); }
                } else if (suffix === 'o') {
                    for (let s = 0; s < 4; s++) for (let t = 0; t < 4; t++) {
                        if (s === t) continue;
                        combo[0] = r1 * 4 + s; combo[1] = r2 * 4 + t; push();
                    }
                }
                continue;
            }
            if (key.length !== 2 * k) continue;
            const base = new Int32Array(k);
            let ok = true;
            for (let i = 0; i < k; i++) {
                const c = cardToInt(key.substr(2 * i, 2));
                if (c < 0) { ok = false; break; }
                base[i] = c;
            }
            if (!ok) continue;
            for (const perm of SUIT_PERMS) {
                for (let i = 0; i < k; i++) combo[i] = (base[i] & ~3) | perm[base[i] & 3];
                push();
            }
        }
        return Int32Array.from(out);
    }

    // Laajennus on Omaha5:llä kymmeniä tuhansia avaimia x 24 permutaatiota;
    // pieni välimuisti tunnisteella säästää sen toistuvissa ajoissa
    const rangeCache = new Map();
    const RANGE_CACHE_MAX = 6;
    function expandRangeCached(keys, cardsPerPlayer, id) {
        if (!id) return expandRangeKeys(keys, cardsPerPlayer);
        const cacheKey = cardsPerPlayer + ':' + id;
        if (rangeCache.has(cacheKey)) {
            const hit = rangeCache.get(cacheKey);
            rangeCache.delete(cacheKey);
            rangeCache.set(cacheKey, hit);
            return hit;
        }
        const combos = expandRangeKeys(keys, cardsPerPlayer);
        rangeCache.set(cacheKey, combos);
        while (rangeCache.size > RANGE_CACHE_MAX) rangeCache.delete(rangeCache.keys().next().value);
        return combos;
    }

    /** Alueen kombot, joissa ei ole yhtään kuollutta korttia */
    function filterRange(combos, k, deadSet) {
        const out = [];
        for (let i = 0; i < combos.length; i += k) {
            let ok = true;
            for (let j = 0; j < k; j++) if (deadSet[combos[i + j]]) { ok = false; break; }
            if (ok) for (let j = 0; j < k; j++) out.push(combos[i + j]);
        }
        return Int32Array.from(out);
    }

    function cardsPerPlayerFor(gameType) {
        if (gameType === 'holdem') return 2;
        if (gameType === 'omaha5') return 5;
        return 4;   // omaha ja omahahilo
    }

    /**
     * Monte Carlo -simulaatio.
     *
     * @param {object} data
     * @param {Array<{hand: string[], isFolded: boolean}>} data.playerHandsData
     * @param {{flop: string[], turn: ?string, river: ?string}} data.communityCards
     * @param {number} data.simulationCount
     * @param {string} data.gameType - 'holdem' | 'omaha' | 'omaha5'
     * @param {boolean} data.randomOpponents
     * @param {function(number)} [onProgress] - kutsutaan edistymisprosentilla
     */
    /**
     * Purkaa pyynnön laskentavalmiiksi tilaksi: kuolleet kortit, pakka,
     * pelaajien tila ja tarvittavien korttien määrä. Sekä Monte Carlo että
     * eksakti enumerointi lähtevät tästä, jotta ne tulkitsevat syötteen
     * varmasti samalla tavalla.
     */
    function prepare(data) {
        const { playerHandsData, communityCards, gameType, randomOpponents } = data;
        const playerCount = playerHandsData.length;
        const cardsPerPlayer = cardsPerPlayerFor(gameType);
        const isOmaha = gameType !== 'holdem';
        const isHiLo = gameType === 'omahahilo';
        const holePairs = HOLE_PAIRS[cardsPerPlayer];

        // Pelaajan tila: 0 = ei mukana, 1 = kiinteä käsi, 2 = arvotaan
        // pakasta, 3 = arvotaan käsialueesta (rangeKeys)
        const state = new Int32Array(playerCount);
        const fixedHands = new Array(playerCount).fill(null);
        const rangeKeysOf = new Array(playerCount).fill(null);

        const dead = [];
        for (let i = 0; i < playerCount; i++) {
            const p = playerHandsData[i];
            const cards = [];
            for (const s of (p.hand || [])) {
                const c = cardToInt(s);
                if (c >= 0) cards.push(c);
            }
            const hasRange = Array.isArray(p.rangeKeys) && p.rangeKeys.length > 0;
            const randomlyDealt = randomOpponents && i > 0 && !p.isFolded;

            if (!randomlyDealt) {
                // Kortit ovat tiedossa eikä niitä jaeta uudelleen -> pois pakasta.
                // Tämä koskee myös foldannutta: hänen korttinsa ovat kuolleita.
                for (const c of cards) dead.push(c);
            }

            if (p.isFolded) state[i] = 0;
            else if (randomlyDealt) state[i] = hasRange ? 3 : 2;
            else if (cards.length === cardsPerPlayer) { state[i] = 1; fixedHands[i] = Int32Array.from(cards); }
            else if (hasRange) state[i] = 3;
            else state[i] = 0;  // vajaa käsi -> ei mukana
            if (state[i] === 3) rangeKeysOf[i] = p.rangeKeys;
        }

        // Pöytäkortit
        const knownBoard = [];
        const cc = communityCards || {};
        if (Array.isArray(cc.flop)) for (const s of cc.flop) { const c = cardToInt(s); if (c >= 0) knownBoard.push(c); }
        for (const s of [cc.turn, cc.river]) { const c = cardToInt(s); if (c >= 0) knownBoard.push(c); }
        for (const c of knownBoard) dead.push(c);

        // Sama kortti kahdesti (kahdella pelaajalla tai kädessä ja pöydässä)
        // tekisi tuloksesta hiljaa väärän. Palvelinreitti validoi tämän jo,
        // mutta ensisijainen polku on selaimen worker - heitto suojaa molemmat.
        const deadSet = new Uint8Array(52);
        for (const c of dead) {
            if (deadSet[c]) throw new Error('Duplicate cards in input');
            deadSet[c] = 1;
        }
        const deck = new Int32Array(52 - dead.length);
        let dn = 0;
        for (let c = 0; c < 52; c++) if (!deadSet[c]) deck[dn++] = c;
        const deckLen = deck.length;

        const boardNeeded = 5 - knownBoard.length;
        let randomPlayers = 0;
        for (let i = 0; i < playerCount; i++) if (state[i] === 2) randomPlayers++;
        const need = randomPlayers * cardsPerPlayer + boardNeeded;

        const active = [];
        for (let i = 0; i < playerCount; i++) if (state[i] !== 0) active.push(i);

        // Käsialueet: laajenna komboiksi ja pudota kiinteisiin kuolleisiin
        // kortteihin törmäävät. Listan koko on sen jälkeen vakio koko ajon,
        // mikä on eksaktin arvonnan edellytys (ks. runSimulation).
        const rangePlayers = [];
        const rangeLists = new Array(playerCount).fill(null);
        for (let i = 0; i < playerCount; i++) {
            if (state[i] !== 3) continue;
            const p = playerHandsData[i];
            const all = expandRangeCached(rangeKeysOf[i], cardsPerPlayer, p.rangeId);
            const list = filterRange(all, cardsPerPlayer, deadSet);
            if (list.length === 0) throw new Error('Range has no possible hands');
            rangeLists[i] = list;
            rangePlayers.push(i);
        }
        const rangeCards = rangePlayers.length * cardsPerPlayer;

        return {
            playerCount, cardsPerPlayer, isOmaha, isHiLo, holePairs,
            state, fixedHands, knownBoard, deck, deckLen,
            boardNeeded, randomPlayers, need, active,
            rangePlayers, rangeLists, rangeCards
        };
    }

    /**
     * Monte Carlo -simulaatio.
     *
     * @param {object} data
     * @param {Array<{hand: string[], isFolded: boolean}>} data.playerHandsData
     * @param {{flop: string[], turn: ?string, river: ?string}} data.communityCards
     * @param {number} data.simulationCount
     * @param {string} data.gameType - 'holdem' | 'omaha' | 'omaha5'
     * @param {boolean} data.randomOpponents
     * @param {function(number)} [onProgress] - kutsutaan edistymisprosentilla
     */
    function runSimulation(data, onProgress) {
        const simulationCount = data.simulationCount;
        const {
            playerCount, cardsPerPlayer, isOmaha, isHiLo, holePairs,
            state, fixedHands, knownBoard, deck, deckLen,
            boardNeeded, randomPlayers, need, active,
            rangePlayers, rangeLists, rangeCards
        } = prepare(data);

        const winCounts = new Array(playerCount).fill(0);
        const tieCounts = new Array(playerCount).fill(0);
        const equitySums = new Array(playerCount).fill(0);
        const heroHandStats = {};
        // Range-pelaajan käsi kirjoitetaan joka kierroksella tähän puskuriin,
        // jolloin arviointi kohtelee sitä kuin kiinteää kättä
        for (const i of rangePlayers) fixedHands[i] = new Int32Array(cardsPerPlayer);
        const rangeCount = rangePlayers.length;
        // Kortit, jotka ovat tällä kierroksella range-käsissä (pakka ei
        // sisällä niitä valmiiksi, koska ne vaihtuvat joka kierros)
        const used = new Uint8Array(52);
        let rangeAttempts = 0;
        // Neliösumma keskivirhettä varten: kierrokset ovat riippumattomia,
        // joten osuuksien otosvarianssi antaa suoraan estimaatin tarkkuudesta
        const equitySq = new Array(playerCount).fill(0);
        // Hi/Lo:sta kerätään kahdenlaista tietoa, koska ne vastaavat eri
        // kysymykseen:
        //   - osuudet (hiSums/loSums): kuinka suuren osan KOKO potista
        //     pelaaja saa kummankin puoliskon kautta. hiSums sisältää koko
        //     potin silloin kun low'ta ei syntynyt, joten
        //     hiSums + loSums = equitySums pätee aina.
        //   - taajuudet (hiWins/hiTies/loWins/loTies): kuinka USEIN pelaaja
        //     voittaa puoliskon yksin tai jakaa sen. Tämä on se luku jonka
        //     muut laskurit yleensä näyttävät; se ei kerro puoliskon arvoa,
        //     koska hi-voitto tuo koko potin vain kun low'ta ei ole.
        const hilo = isHiLo ? {
            hiSums: new Array(playerCount).fill(0),
            loSums: new Array(playerCount).fill(0),
            hiWins: new Array(playerCount).fill(0),
            hiTies: new Array(playerCount).fill(0),
            loWins: new Array(playerCount).fill(0),
            loTies: new Array(playerCount).fill(0),
            heroLowMade: 0,
            noLowRounds: 0
        } : null;

        if (active.length === 0) {
            throw new Error('No active players with cards');
        }
        if (need + rangeCards > deckLen) {
            throw new Error('Not enough cards in deck');
        }
        if (active.length === 1) {
            // Yksi pelaaja jäljellä - voittaa aina ilman laskentaa.
            // Hi/Lo-erittelyä ei anneta: yhtään pöytää ei jaeta, joten
            // puoliskojen osuuksista tai low-taajuuksista ei ole tietoa.
            // Keksitty "hi 100 % / ei low'ta 100 %" olisi väärä väite.
            winCounts[active[0]] = simulationCount;
            equitySums[active[0]] = simulationCount;
            equitySq[active[0]] = simulationCount;
            return finish(winCounts, tieCounts, equitySums, equitySq, simulationCount,
                heroHandStats, null);
        }

        // Uudelleenkäytettävät puskurit
        const board = new Int32Array(5);
        for (let i = 0; i < knownBoard.length; i++) board[i] = knownBoard[i];
        const dealt = new Int32Array(cardsPerPlayer);
        const values = new Array(playerCount).fill(0);
        const loValues = new Array(playerCount).fill(NO_LOW);
        const boardTriples = new Int32Array(30);
        const lowTriples = new Int32Array(10);

        const progressStep = Math.max(1, Math.floor(simulationCount / 100));
        const boardStart = randomPlayers * cardsPerPlayer;
        const knownBoardLen = knownBoard.length;

        for (let sim = 0; sim < simulationCount; sim++) {
            if (rangeCount > 0) {
                // Range-kädet ensin, riippumattomasti kukin omasta listastaan;
                // jos kaksi kättä jakaa kortin, arvotaan kaikki uudestaan.
                // Ehdotus on tasainen listojen tulojoukolla ja hylkäys
                // ehdollistaa erillisiin, joten yhteisjakauma on täsmälleen
                // tasainen kaikkien sallittujen käsiyhdistelmien yli - sama
                // kuin "kortit jaettiin ja jokainen sattui saamaan alueensa
                // käden". Peräkkäinen arvonta (toinen välttäen ensimmäisen
                // kortit) olisi hienovaraisesti harhainen blokkerien takia.
                //
                // Listat suodatettiin kiinteistä kuolleista korteista jo
                // prepare():ssa, ja pakka jaetaan vasta tämän jälkeen: näin
                // range-käsien lukumäärä ei riipu pöydästä eikä muista
                // arvottavista käsistä.
                for (;;) {
                    used.fill(0);
                    let clash = false;
                    for (let r = 0; r < rangeCount && !clash; r++) {
                        const list = rangeLists[rangePlayers[r]];
                        const hand = fixedHands[rangePlayers[r]];
                        const off = Math.floor(Math.random() * (list.length / cardsPerPlayer)) * cardsPerPlayer;
                        for (let k = 0; k < cardsPerPlayer; k++) {
                            const c = list[off + k];
                            if (used[c]) { clash = true; break; }
                            used[c] = 1;
                            hand[k] = c;
                        }
                    }
                    if (!clash) break;
                    // Alueet voivat olla keskenään mahdottomat (esim. viisi
                    // "pelkkä AA" -aluetta): älä jää ikuiseen silmukkaan
                    if (++rangeAttempts > 20000 * (sim + 1)) {
                        throw new Error('Ranges conflict: no disjoint hands found');
                    }
                }
                // Osittainen Fisher-Yates ohittaen range-käsien kortit: kortti
                // hylätään ja arvotaan uusi, jolloin valinta on tasainen
                // jäljellä olevien vapaiden korttien yli
                for (let i = 0; i < need; i++) {
                    let j;
                    do { j = i + Math.floor(Math.random() * (deckLen - i)); } while (used[deck[j]]);
                    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
                }
            } else {
                // Osittainen Fisher-Yates: sekoitetaan vain tarvittavat kortit
                for (let i = 0; i < need; i++) {
                    const j = i + Math.floor(Math.random() * (deckLen - i));
                    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
                }
            }

            for (let b = 0; b < boardNeeded; b++) board[knownBoardLen + b] = deck[boardStart + b];
            let lowPossible = false;
            if (isOmaha) {
                expandBoardTriples(board, boardTriples);
                if (isHiLo) lowPossible = expandBoardLowTriples(board, lowTriples);
            }

            let maxValue = -1, winnerCount = 0;
            let loMin = NO_LOW, loWinnerCount = 0;
            let di = 0;
            for (let a = 0; a < active.length; a++) {
                const idx = active[a];
                let value;
                if (isOmaha) {
                    let hole;
                    if (state[idx] === 2) {
                        for (let k = 0; k < cardsPerPlayer; k++) dealt[k] = deck[di + k];
                        di += cardsPerPlayer;
                        hole = dealt;
                    } else {
                        hole = fixedHands[idx];
                    }
                    value = evalOmahaFast(hole, holePairs, boardTriples);
                    if (isHiLo) {
                        const lo = lowPossible ? evalOmahaLowFast(hole, holePairs, lowTriples) : NO_LOW;
                        loValues[idx] = lo;
                        if (lo < loMin) { loMin = lo; loWinnerCount = 1; }
                        else if (lo === loMin && loMin !== NO_LOW) loWinnerCount++;
                    }
                } else {
                    let h0, h1;
                    if (state[idx] === 2) { h0 = deck[di]; h1 = deck[di + 1]; di += 2; }
                    else { h0 = fixedHands[idx][0]; h1 = fixedHands[idx][1]; }
                    value = eval7(h0, h1, board[0], board[1], board[2], board[3], board[4]);
                }
                values[idx] = value;
                if (value > maxValue) { maxValue = value; winnerCount = 1; }
                else if (value === maxValue) winnerCount++;
            }

            if (state[0] !== 0) {
                const name = CATEGORY_NAMES[categoryOf(values[0])];
                heroHandStats[name] = (heroHandStats[name] || 0) + 1;
            }

            if (isHiLo) {
                // Jaettu potti: puolet parhaalle hi-kädelle, puolet parhaalle
                // low'lle. Jos kukaan ei tee low'ta, hi vie koko potin.
                if (loWinnerCount === 0) hilo.noLowRounds++;
                if (state[0] !== 0 && loValues[0] !== NO_LOW) hilo.heroLowMade++;
                for (let a = 0; a < active.length; a++) {
                    const idx = active[a];
                    const hiShare = values[idx] === maxValue ? 1 / winnerCount : 0;
                    let hiPart, loPart;
                    if (loWinnerCount === 0) {
                        hiPart = hiShare;
                        loPart = 0;
                    } else {
                        hiPart = 0.5 * hiShare;
                        loPart = loValues[idx] === loMin ? 0.5 / loWinnerCount : 0;
                    }
                    // Taajuudet: yksin voitettu vs. jaettu puolisko
                    if (values[idx] === maxValue) {
                        if (winnerCount === 1) hilo.hiWins[idx]++; else hilo.hiTies[idx]++;
                    }
                    if (loWinnerCount > 0 && loValues[idx] === loMin) {
                        if (loWinnerCount === 1) hilo.loWins[idx]++; else hilo.loTies[idx]++;
                    }
                    const share = hiPart + loPart;
                    if (share === 1) winCounts[idx]++;
                    else if (share > 0) tieCounts[idx]++;
                    hilo.hiSums[idx] += hiPart;
                    hilo.loSums[idx] += loPart;
                    equitySums[idx] += share;
                    equitySq[idx] += share * share;
                }
            } else {
                const share = 1 / winnerCount;
                for (let a = 0; a < active.length; a++) {
                    const idx = active[a];
                    if (values[idx] === maxValue) {
                        if (winnerCount === 1) winCounts[idx]++;
                        else tieCounts[idx]++;
                        equitySums[idx] += share;
                        equitySq[idx] += share * share;
                    }
                }
            }

            if (onProgress && sim % progressStep === 0) {
                onProgress((sim / simulationCount) * 100);
            }
        }

        return finish(winCounts, tieCounts, equitySums, equitySq, simulationCount,
            heroHandStats, hilo);
    }

    function finish(winCounts, tieCounts, equitySums, equitySq, simulationCount,
        heroHandStats, hilo) {
        const n = simulationCount;
        const result = {
            winCounts,
            tieCounts,
            winPercentages: winCounts.map(w => (w / n) * 100),
            tiePercentages: tieCounts.map(t => (t / n) * 100),
            equityPercentages: equitySums.map(e => (e / n) * 100),
            // Keskivirhe prosenttiyksikköinä. Kertoo kuinka paljon tulos
            // heiluisi jos sama simulaatio ajettaisiin uudelleen.
            standardErrors: equitySums.map((e, i) => {
                if (n < 2) return 0;
                const mean = e / n;
                const variance = Math.max(0, (equitySq[i] / n) - mean * mean);
                return 100 * Math.sqrt(variance / n);
            }),
            simulationCount,
            heroHandStats
        };
        if (hilo) {
            // Osuudet: hiEquity sisältää koko potin kun low'ta ei ollut,
            // joten hi + lo = equity. winCounts = scooppasi koko potin,
            // tieCounts = sai osan potista.
            result.hiEquityPercentages = hilo.hiSums.map(e => (e / n) * 100);
            result.loEquityPercentages = hilo.loSums.map(e => (e / n) * 100);
            // Taajuudet: kuinka usein puolisko voitetaan yksin tai jaetaan.
            // Eri suure kuin osuus - hi-voitto tuo koko potin vain kun
            // kukaan ei tehnyt low'ta.
            result.hiWinPercentages = hilo.hiWins.map(w => (w / n) * 100);
            result.hiTiePercentages = hilo.hiTies.map(t => (t / n) * 100);
            result.loWinPercentages = hilo.loWins.map(w => (w / n) * 100);
            result.loTiePercentages = hilo.loTies.map(t => (t / n) * 100);
            result.hiLoStats = {
                heroLowMade: hilo.heroLowMade,
                noLowRounds: hilo.noLowRounds
            };
        }
        return result;
    }

    // --- Eksakti enumerointi -----------------------------------------------
    //
    // Kun jokaisen mukana olevan pelaajan kortit tunnetaan, jäljellä olevat
    // pöytäkortit voi käydä läpi tyhjentävästi. Silloin tulos ei ole arvio
    // vaan tarkka murtoluku. Mitä enemmän pelaajia, sitä vähemmän pöytiä -
    // kortit ovat pois pakasta.

    function binomial(n, k) {
        if (k < 0 || k > n) return 0;
        let r = 1;
        for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
        return Math.round(r);
    }

    // Mitattu karkea hinta per pelaaja per pöytä (sekunteina)
    const COST_HOLDEM = 3.5e-8;   // yksi eval7
    const COST_OMAHA = 2.2e-6;    // 60 x eval5 (4 korttia: 6 paria x 10 kolmikkoa)
    const COST_OMAHA5 = 3.7e-6;   // 100 x eval5 (5 korttia: 10 paria x 10 kolmikkoa)
    // Hi + low: low-arviointi on maskioperaatioita eli paljon eval5:ttä
    // halvempi, ja 40 % pöydistä ohittaa sen kokonaan
    const COST_OMAHA_HILO = 3.0e-6;

    /**
     * Kertoo voiko tilanteen laskea tarkasti ja mitä se maksaisi.
     * @returns {{feasible: boolean, reason: ?string, boards: number, estimatedSeconds: number}}
     */
    function exactPlan(data) {
        let p;
        try {
            p = prepare(data);
        } catch (e) {
            return { feasible: false, reason: 'invalid', boards: 0, estimatedSeconds: 0 };
        }
        if (p.active.length === 0) {
            return { feasible: false, reason: 'no-players', boards: 0, estimatedSeconds: 0 };
        }
        if (p.randomPlayers > 0) {
            // Tuntemattomia käsiä ei voi enumeroida - näihin on esilasketut taulukot
            return { feasible: false, reason: 'random-opponents', boards: 0, estimatedSeconds: 0 };
        }
        // Käsialueet ovat äärellisiä: enumeroidaan alueiden erilliset
        // käsiyhdistelmät x pöydät. Yhdistelmien tulojoukko voi olla valtava
        // (kaksi Omaha-aluetta = miljardeja), joten sitä ei edes lasketa
        // tarkasti jos yläraja ylittää budjetin.
        const rangeCombos = countRangeCombos(p, RANGE_COMBO_CAP);
        if (rangeCombos < 0) {
            return { feasible: false, reason: 'range-too-large', boards: 0, estimatedSeconds: Infinity };
        }
        const boards = binomial(p.deckLen - p.rangeCards, p.boardNeeded) * rangeCombos;
        const perBoard = p.active.length * (!p.isOmaha ? COST_HOLDEM
            : p.isHiLo ? COST_OMAHA_HILO
                : (p.cardsPerPlayer === 5 ? COST_OMAHA5 : COST_OMAHA));
        return {
            feasible: p.active.length >= 2,
            reason: p.active.length < 2 ? 'single-player' : null,
            boards,
            rangeCombos,
            estimatedSeconds: boards * perBoard
        };
    }

    // Enemmän kuin näin monta alueiden käsiyhdistelmää ei enumeroida
    // (10 s budjetilla Hold'em-riverkin olisi ~300 M eval7:ää)
    const RANGE_COMBO_CAP = 5e6;

    /**
     * Käy läpi range-pelaajien käsiyhdistelmät (kunkin listan tulojoukko),
     * ohittaa yhdistelmät joissa kaksi kättä jakaa kortin, ja kutsuu cb:tä
     * kun kädet on kirjoitettu fixedHands-puskureihin ja käytetyt kortit
     * used-maskiin. Palauttaa yhdistelmien määrän.
     */
    function forEachRangeCombo(p, used, cb) {
        const { rangePlayers, rangeLists, cardsPerPlayer: k, fixedHands } = p;
        const n = rangePlayers.length;
        if (n === 0) { used.fill(0); cb(); return 1; }
        const sizes = rangePlayers.map(i => rangeLists[i].length / k);
        const pos = new Int32Array(n);
        let count = 0;
        for (;;) {
            used.fill(0);
            let clash = false;
            for (let r = 0; r < n && !clash; r++) {
                const list = rangeLists[rangePlayers[r]];
                const hand = fixedHands[rangePlayers[r]];
                const off = pos[r] * k;
                for (let j = 0; j < k; j++) {
                    const c = list[off + j];
                    if (used[c]) { clash = true; break; }
                    used[c] = 1;
                    hand[j] = c;
                }
            }
            if (!clash) { count++; if (cb) cb(); }
            let r = n - 1;
            while (r >= 0 && pos[r] === sizes[r] - 1) { pos[r] = 0; r--; }
            if (r < 0) break;
            pos[r]++;
        }
        return count;
    }

    /** Erillisten range-yhdistelmien määrä, tai -1 jos tulojoukko ylittää capin */
    function countRangeCombos(p, cap) {
        if (p.rangePlayers.length === 0) return 1;
        let product = 1;
        for (const i of p.rangePlayers) product *= p.rangeLists[i].length / p.cardsPerPlayer;
        if (product > cap) return -1;
        for (const i of p.rangePlayers) p.fixedHands[i] = new Int32Array(p.cardsPerPlayer);
        return forEachRangeCombo(p, new Uint8Array(52), null);
    }

    /**
     * Laskee equityn tarkasti käymällä läpi kaikki jäljellä olevat pöydät.
     * Palauttaa null jos tilannetta ei voi enumeroida (tuntemattomia käsiä).
     * @param {object} data - sama muoto kuin runSimulation
     * @param {function(number)} [onProgress]
     */
    function enumerateExact(data, onProgress) {
        const p = prepare(data);
        const {
            playerCount, cardsPerPlayer, isOmaha, isHiLo, holePairs,
            state, fixedHands, knownBoard, deck: fullDeck, deckLen: fullDeckLen,
            boardNeeded, randomPlayers, active, rangePlayers, rangeCards
        } = p;

        if (randomPlayers > 0 || active.length === 0) return null;
        for (const i of rangePlayers) fixedHands[i] = new Int32Array(cardsPerPlayer);
        const rangeCombos = countRangeCombos(p, RANGE_COMBO_CAP);
        if (rangeCombos < 0) return null;

        const winCounts = new Array(playerCount).fill(0);
        const tieCounts = new Array(playerCount).fill(0);
        const equityNumerators = new Array(playerCount).fill(0);
        // Sama kahtiajako kuin runSimulationissa: osuudet potista ja
        // taajuudet puoliskojen voittamiselle (ks. runSimulation)
        const hilo = isHiLo ? {
            hiNumerators: new Array(playerCount).fill(0),
            loNumerators: new Array(playerCount).fill(0),
            hiWins: new Array(playerCount).fill(0),
            hiTies: new Array(playerCount).fill(0),
            loWins: new Array(playerCount).fill(0),
            loTies: new Array(playerCount).fill(0),
            heroLowMade: 0,
            noLowRounds: 0
        } : null;
        const heroHandStats = {};

        // Pöytiä per range-yhdistelmä x yhdistelmät. Kaikilla yhdistelmillä
        // on yhtä monta pöytää, joten nimittäjä on tulo.
        const deckLen = fullDeckLen - rangeCards;
        const boardsPerCombo = binomial(deckLen, boardNeeded);
        const totalBoards = boardsPerCombo * rangeCombos;

        if (active.length === 1) {
            // Ei pöytiä käytävänä läpi -> hi/lo-erittelyä ei ole olemassa
            winCounts[active[0]] = totalBoards;
            equityNumerators[active[0]] = totalBoards * LCM_SHARE;
            return exactResult(winCounts, tieCounts, equityNumerators, totalBoards,
                heroHandStats, null);
        }

        const board = new Int32Array(5);
        for (let i = 0; i < knownBoard.length; i++) board[i] = knownBoard[i];
        const boardTriples = new Int32Array(30);
        const lowTriples = new Int32Array(10);
        const values = new Array(playerCount).fill(0);
        const loValues = new Array(playerCount).fill(NO_LOW);
        const knownBoardLen = knownBoard.length;

        const idx = new Int32Array(boardNeeded);

        const progressStep = Math.max(1, Math.floor(totalBoards / 100));
        let done = 0;

        // Pakka ilman kulloisenkin range-yhdistelmän kortteja
        const deck = new Int32Array(deckLen);
        const used = new Uint8Array(52);

        forEachRangeCombo(p, used, () => {
            let dn = 0;
            for (let i = 0; i < fullDeckLen; i++) if (!used[fullDeck[i]]) deck[dn++] = fullDeck[i];
            for (let i = 0; i < boardNeeded; i++) idx[i] = i;

            for (;;) {
                for (let b = 0; b < boardNeeded; b++) board[knownBoardLen + b] = deck[idx[b]];
                let lowPossible = false;
                if (isOmaha) {
                    expandBoardTriples(board, boardTriples);
                    if (isHiLo) lowPossible = expandBoardLowTriples(board, lowTriples);
                }

                let maxValue = -1, winnerCount = 0;
                let loMin = NO_LOW, loWinnerCount = 0;
                for (let a = 0; a < active.length; a++) {
                    const i = active[a];
                    const value = isOmaha
                        ? evalOmahaFast(fixedHands[i], holePairs, boardTriples)
                        : eval7(fixedHands[i][0], fixedHands[i][1], board[0], board[1], board[2], board[3], board[4]);
                    values[i] = value;
                    if (isHiLo) {
                        const lo = lowPossible ? evalOmahaLowFast(fixedHands[i], holePairs, lowTriples) : NO_LOW;
                        loValues[i] = lo;
                        if (lo < loMin) { loMin = lo; loWinnerCount = 1; }
                        else if (lo === loMin && loMin !== NO_LOW) loWinnerCount++;
                    }
                    if (value > maxValue) { maxValue = value; winnerCount = 1; }
                    else if (value === maxValue) winnerCount++;
                }

                if (state[0] !== 0) {
                    const name = CATEGORY_NAMES[categoryOf(values[0])];
                    heroHandStats[name] = (heroHandStats[name] || 0) + 1;
                }

                if (isHiLo) {
                    // Osoittajat kokonaislukuina yksikössä 1/LCM_SHARE:
                    // puolikas potti on LCM_SHARE/2, ja sekin jakautuu tasan
                    // korkeintaan 10 voittajalle (5040/2/k on kokonaisluku)
                    if (loWinnerCount === 0) hilo.noLowRounds++;
                    if (state[0] !== 0 && loValues[0] !== NO_LOW) hilo.heroLowMade++;
                    for (let a = 0; a < active.length; a++) {
                        const i = active[a];
                        let hiPart = 0, loPart = 0;
                        if (values[i] === maxValue) {
                            hiPart = loWinnerCount === 0
                                ? LCM_SHARE / winnerCount
                                : (LCM_SHARE / 2) / winnerCount;
                            if (winnerCount === 1) hilo.hiWins[i]++; else hilo.hiTies[i]++;
                        }
                        if (loWinnerCount > 0 && loValues[i] === loMin) {
                            loPart = (LCM_SHARE / 2) / loWinnerCount;
                            if (loWinnerCount === 1) hilo.loWins[i]++; else hilo.loTies[i]++;
                        }
                        const share = hiPart + loPart;
                        if (share === LCM_SHARE) winCounts[i]++;
                        else if (share > 0) tieCounts[i]++;
                        hilo.hiNumerators[i] += hiPart;
                        hilo.loNumerators[i] += loPart;
                        equityNumerators[i] += share;
                    }
                } else {
                    // Osoittajat pidetään kokonaislukuina: jaetaan vasta lopuksi
                    const scaled = LCM_SHARE / winnerCount;
                    for (let a = 0; a < active.length; a++) {
                        const i = active[a];
                        if (values[i] === maxValue) {
                            if (winnerCount === 1) winCounts[i]++;
                            else tieCounts[i]++;
                            equityNumerators[i] += scaled;
                        }
                    }
                }

                done++;
                if (onProgress && done % progressStep === 0) onProgress((done / totalBoards) * 100);

                // Seuraava pöytäyhdistelmä
                let i = boardNeeded - 1;
                while (i >= 0 && idx[i] === deckLen - boardNeeded + i) i--;
                if (i < 0) break;
                idx[i]++;
                for (let j = i + 1; j < boardNeeded; j++) idx[j] = idx[j - 1] + 1;
            }
        });

        const result = exactResult(winCounts, tieCounts, equityNumerators, totalBoards,
            heroHandStats, hilo);
        result.rangeCombos = rangeCombos;
        return result;
    }

    // Pienin yhteinen jaettava, jotta osuudet pysyvät kokonaislukuina eikä
    // liukulukupyöristystä kerry miljooniin pöytiin. Hi/Lo:ssa puolikas
    // potti jakautuu korkeintaan 10 voittajalle, joten jaettavaksi tarvitaan
    // LCM(2,4,...,20) = 5040 - pelkkä LCM(1..10) = 2520 ei riitä (2520/16
    // ei ole kokonaisluku).
    const LCM_SHARE = 5040;

    function exactResult(winCounts, tieCounts, equityNumerators, totalBoards,
        heroHandStats, hilo) {
        const denom = totalBoards * LCM_SHARE;
        const result = {
            exact: true,
            boards: totalBoards,
            winCounts,
            tieCounts,
            winPercentages: winCounts.map(w => (w / totalBoards) * 100),
            tiePercentages: tieCounts.map(t => (t / totalBoards) * 100),
            equityPercentages: equityNumerators.map(e => (e / denom) * 100),
            equityNumerators,
            equityDenominator: denom,
            standardErrors: winCounts.map(() => 0),
            simulationCount: totalBoards,
            heroHandStats
        };
        if (hilo) {
            result.hiEquityPercentages = hilo.hiNumerators.map(e => (e / denom) * 100);
            result.loEquityPercentages = hilo.loNumerators.map(e => (e / denom) * 100);
            result.hiWinPercentages = hilo.hiWins.map(w => (w / totalBoards) * 100);
            result.hiTiePercentages = hilo.hiTies.map(t => (t / totalBoards) * 100);
            result.loWinPercentages = hilo.loWins.map(w => (w / totalBoards) * 100);
            result.loTiePercentages = hilo.loTies.map(t => (t / totalBoards) * 100);
            result.hiLoStats = {
                heroLowMade: hilo.heroLowMade,
                noLowRounds: hilo.noLowRounds
            };
        }
        return result;
    }

    const PokerEngine = {
        cardToInt, intToCard, categoryOf,
        eval5, eval7, evalOmaha,
        evalOmahaLow, NO_LOW,
        HOLE_PAIRS, CATEGORY_NAMES,
        runSimulation, enumerateExact, exactPlan, binomial,
        expandRangeKeys, comboIndex
    };

    global.PokerEngine = PokerEngine;
    if (typeof module !== 'undefined' && module.exports) module.exports = PokerEngine;
})(typeof self !== 'undefined' ? self : globalThis);
