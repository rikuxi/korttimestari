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
        const state = new Int32Array(playerCount);
        const fixedHands = new Array(playerCount).fill(null);

        const dead = [];
        for (let i = 0; i < playerCount; i++) {
            const p = playerHandsData[i];
            const cards = [];
            for (const s of (p.hand || [])) {
                const c = cardToInt(s);
                if (c >= 0) cards.push(c);
            }
            const randomlyDealt = randomOpponents && i > 0 && !p.isFolded;

            if (!randomlyDealt) {
                // Kortit ovat tiedossa eikä niitä jaeta uudelleen -> pois pakasta.
                // Tämä koskee myös foldannutta: hänen korttinsa ovat kuolleita.
                for (const c of cards) dead.push(c);
            }

            if (p.isFolded) state[i] = 0;
            else if (randomlyDealt) state[i] = 2;
            else if (cards.length === cardsPerPlayer) { state[i] = 1; fixedHands[i] = Int32Array.from(cards); }
            else state[i] = 0;  // vajaa käsi -> ei mukana
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

        return {
            playerCount, cardsPerPlayer, isOmaha, isHiLo, holePairs,
            state, fixedHands, knownBoard, deck, deckLen,
            boardNeeded, randomPlayers, need, active
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
            boardNeeded, randomPlayers, need, active
        } = prepare(data);

        const winCounts = new Array(playerCount).fill(0);
        const tieCounts = new Array(playerCount).fill(0);
        const equitySums = new Array(playerCount).fill(0);
        const heroHandStats = {};
        // Neliösumma keskivirhettä varten: kierrokset ovat riippumattomia,
        // joten osuuksien otosvarianssi antaa suoraan estimaatin tarkkuudesta
        const equitySq = new Array(playerCount).fill(0);
        // Hi/Lo: potin puolikkaat erikseen, jotta erittely voidaan näyttää.
        // hiSums sisältää koko potin silloin kun low'ta ei ole - näin
        // hiSums + loSums = equitySums pätee aina.
        const hiSums = isHiLo ? new Array(playerCount).fill(0) : null;
        const loSums = isHiLo ? new Array(playerCount).fill(0) : null;
        const hiLoCounts = isHiLo ? { heroLowMade: 0, heroLowWon: 0, noLowRounds: 0 } : null;

        if (active.length === 0) {
            throw new Error('No active players with cards');
        }
        if (need > deckLen) {
            throw new Error('Not enough cards in deck');
        }
        if (active.length === 1) {
            // Yksi pelaaja jäljellä - voittaa aina ilman laskentaa
            winCounts[active[0]] = simulationCount;
            equitySums[active[0]] = simulationCount;
            equitySq[active[0]] = simulationCount;
            if (isHiLo) {
                hiSums[active[0]] = simulationCount;
                hiLoCounts.noLowRounds = simulationCount;
            }
            return finish(winCounts, tieCounts, equitySums, equitySq, simulationCount, heroHandStats,
                hiSums, loSums, hiLoCounts);
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
            // Osittainen Fisher-Yates: sekoitetaan vain tarvittavat kortit
            for (let i = 0; i < need; i++) {
                const j = i + Math.floor(Math.random() * (deckLen - i));
                const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
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
                if (loWinnerCount === 0) hiLoCounts.noLowRounds++;
                if (state[0] !== 0) {
                    if (loValues[0] !== NO_LOW) hiLoCounts.heroLowMade++;
                    if (loWinnerCount > 0 && loValues[0] === loMin) hiLoCounts.heroLowWon++;
                }
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
                    const share = hiPart + loPart;
                    if (share === 1) winCounts[idx]++;
                    else if (share > 0) tieCounts[idx]++;
                    hiSums[idx] += hiPart;
                    loSums[idx] += loPart;
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

        return finish(winCounts, tieCounts, equitySums, equitySq, simulationCount, heroHandStats,
            hiSums, loSums, hiLoCounts);
    }

    function finish(winCounts, tieCounts, equitySums, equitySq, simulationCount, heroHandStats,
        hiSums, loSums, hiLoCounts) {
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
        if (hiSums) {
            // Hi/Lo-erittely: hiEquity sisältää koko potin kun low'ta ei
            // ollut, joten hi + lo = equity. winCounts = scooppasi koko potin,
            // tieCounts = sai osan potista.
            result.hiEquityPercentages = hiSums.map(e => (e / n) * 100);
            result.loEquityPercentages = loSums.map(e => (e / n) * 100);
            result.hiLoStats = {
                heroLowMade: hiLoCounts.heroLowMade,
                heroLowWon: hiLoCounts.heroLowWon,
                noLowRounds: hiLoCounts.noLowRounds
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
        const boards = binomial(p.deckLen, p.boardNeeded);
        const perBoard = p.active.length * (!p.isOmaha ? COST_HOLDEM
            : p.isHiLo ? COST_OMAHA_HILO
                : (p.cardsPerPlayer === 5 ? COST_OMAHA5 : COST_OMAHA));
        return {
            feasible: p.active.length >= 2,
            reason: p.active.length < 2 ? 'single-player' : null,
            boards,
            estimatedSeconds: boards * perBoard
        };
    }

    /**
     * Laskee equityn tarkasti käymällä läpi kaikki jäljellä olevat pöydät.
     * Palauttaa null jos tilannetta ei voi enumeroida (tuntemattomia käsiä).
     * @param {object} data - sama muoto kuin runSimulation
     * @param {function(number)} [onProgress]
     */
    function enumerateExact(data, onProgress) {
        const {
            playerCount, isOmaha, isHiLo, holePairs,
            state, fixedHands, knownBoard, deck, deckLen,
            boardNeeded, randomPlayers, active
        } = prepare(data);

        if (randomPlayers > 0 || active.length === 0) return null;

        const winCounts = new Array(playerCount).fill(0);
        const tieCounts = new Array(playerCount).fill(0);
        const equityNumerators = new Array(playerCount).fill(0);
        const hiNumerators = isHiLo ? new Array(playerCount).fill(0) : null;
        const loNumerators = isHiLo ? new Array(playerCount).fill(0) : null;
        const hiLoCounts = isHiLo ? { heroLowMade: 0, heroLowWon: 0, noLowRounds: 0 } : null;
        const heroHandStats = {};

        const totalBoards = binomial(deckLen, boardNeeded);

        if (active.length === 1) {
            winCounts[active[0]] = totalBoards;
            equityNumerators[active[0]] = totalBoards * LCM_SHARE;
            if (isHiLo) {
                hiNumerators[active[0]] = totalBoards * LCM_SHARE;
                hiLoCounts.noLowRounds = totalBoards;
            }
            return exactResult(winCounts, tieCounts, equityNumerators, totalBoards, heroHandStats,
                hiNumerators, loNumerators, hiLoCounts);
        }

        const board = new Int32Array(5);
        for (let i = 0; i < knownBoard.length; i++) board[i] = knownBoard[i];
        const boardTriples = new Int32Array(30);
        const lowTriples = new Int32Array(10);
        const values = new Array(playerCount).fill(0);
        const loValues = new Array(playerCount).fill(NO_LOW);
        const knownBoardLen = knownBoard.length;

        const idx = new Int32Array(boardNeeded);
        for (let i = 0; i < boardNeeded; i++) idx[i] = i;

        const progressStep = Math.max(1, Math.floor(totalBoards / 100));
        let done = 0;

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
                if (loWinnerCount === 0) hiLoCounts.noLowRounds++;
                if (state[0] !== 0) {
                    if (loValues[0] !== NO_LOW) hiLoCounts.heroLowMade++;
                    if (loWinnerCount > 0 && loValues[0] === loMin) hiLoCounts.heroLowWon++;
                }
                for (let a = 0; a < active.length; a++) {
                    const i = active[a];
                    let hiPart = 0, loPart = 0;
                    if (values[i] === maxValue) {
                        hiPart = loWinnerCount === 0
                            ? LCM_SHARE / winnerCount
                            : (LCM_SHARE / 2) / winnerCount;
                    }
                    if (loWinnerCount > 0 && loValues[i] === loMin) {
                        loPart = (LCM_SHARE / 2) / loWinnerCount;
                    }
                    const share = hiPart + loPart;
                    if (share === LCM_SHARE) winCounts[i]++;
                    else if (share > 0) tieCounts[i]++;
                    hiNumerators[i] += hiPart;
                    loNumerators[i] += loPart;
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

        return exactResult(winCounts, tieCounts, equityNumerators, totalBoards, heroHandStats,
            hiNumerators, loNumerators, hiLoCounts);
    }

    // Pienin yhteinen jaettava, jotta osuudet pysyvät kokonaislukuina eikä
    // liukulukupyöristystä kerry miljooniin pöytiin. Hi/Lo:ssa puolikas
    // potti jakautuu korkeintaan 10 voittajalle, joten jaettavaksi tarvitaan
    // LCM(2,4,...,20) = 5040 - pelkkä LCM(1..10) = 2520 ei riitä (2520/16
    // ei ole kokonaisluku).
    const LCM_SHARE = 5040;

    function exactResult(winCounts, tieCounts, equityNumerators, totalBoards, heroHandStats,
        hiNumerators, loNumerators, hiLoCounts) {
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
        if (hiNumerators) {
            result.hiEquityPercentages = hiNumerators.map(e => (e / denom) * 100);
            result.loEquityPercentages = loNumerators.map(e => (e / denom) * 100);
            result.hiLoStats = {
                heroLowMade: hiLoCounts.heroLowMade,
                heroLowWon: hiLoCounts.heroLowWon,
                noLowRounds: hiLoCounts.noLowRounds
            };
        }
        return result;
    }

    const PokerEngine = {
        cardToInt, intToCard, categoryOf,
        eval5, eval7, evalOmaha,
        evalOmahaLow, NO_LOW,
        HOLE_PAIRS, CATEGORY_NAMES,
        runSimulation, enumerateExact, exactPlan, binomial
    };

    global.PokerEngine = PokerEngine;
    if (typeof module !== 'undefined' && module.exports) module.exports = PokerEngine;
})(typeof self !== 'undefined' ? self : globalThis);
