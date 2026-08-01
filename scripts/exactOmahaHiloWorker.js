// Eksaktin Omaha Hi/Lo -equityn (heads-up, 8-or-better) pöytäratkaisija
// ja työläinen.
//
// Rakentuu hi-puolen putken (scripts/exactPrototype.js) päälle: prepareBoard
// antaa kaikkien C(47,4) käden hi-arvot, ja tämä moduuli lisää low-puolen
// sekä jaetun potin inkluusio-ekskluusion. Menetelmä:
//
//   Heron osuus yhtä vastustajaa vastaan = 1/2 * hiShare + 1/2 * loShare*,
//   missä loShare* on low-vertailu jos jommallakummalla on kelvollinen low,
//   ja muuten hiShare (koko potti menee hi:lle). Summa kaikkien vastustajien
//   yli hajoaa kolmeen histogrammiperheeseen:
//     1) hi-arvot kaikista käsistä          (sama kuin hi-putkessa)
//     2) hi-arvot vain low-käsistä          (tarvitaan kun herolla ei ole low'ta)
//     3) lo-arvot low-käsistä               (tarvitaan kun herolla on low)
//   Jokainen perhe käyttää samaa inkluusio-ekskluusiota heron neljän kortin
//   yli kuin hi-putki. Osuudet lasketaan neljännespotin yksiköissä (kokonais-
//   lukuja), ja jokaisen pöydän summa tarkistetaan: potti jakautuu tasan.
//
// Low-käsi koodataan kuten public/js/engine.js:ssä: 8-bittinen arvomaski
// (A = bitti 0, ..., 8 = bitti 7), pienempi maski = parempi low. Pöydän
// sisällä maskit pakataan "hyvyysasteiksi" 0..RL-1 (suurempi = parempi),
// jolloin histogrammilogiikka on identtinen hi-puolen kanssa.
//
// Katso scripts/exactOmahaHilo.js ja docs/omaha-hilo-suunnitelma.md (ei repossa).

const {
    prepareBoard, createBuffers, REST, N_HANDS, N_PAIRS, N_TRIPLES, N_OPP, C2, C3, C4
} = require('./exactPrototype');

// Histogrammirivien sijoittelu - sama kuin exactPrototype.js:ssä
const ROW_CARD = 1;
const ROW_PAIR = ROW_CARD + REST;
const ROW_TRIPLE = ROW_PAIR + N_PAIRS;
const N_ROWS = ROW_TRIPLE + N_TRIPLES;

// Low-maskeja on korkeintaan C(8,5) = 56 erilaista per pöytä (+1 suffiksi-
// summien nollarivi). 64 antaa varaa; ylitys on koodivirhe ja kaataa ajon.
const LSTRIDE = 64;

// Yhteisjakauman tasojen määrä. Käytännössä eri low-arvoja on pöydällä aina
// tasan 10 (todistettu tyhjentävästi kaikista pöydän arvojoukoista), ja
// kyselyt osuvat tasoille 0..RL, joten 11 riittäisi. 12 antaa varaa.
const G_LEVELS = 12;

const NO_LOW = 0x100;

// Kortin low-bitti, tai 0 jos kortti ei kelpaa low'hun (9..K).
// Sama koodaus kuin public/js/engine.js:ssä.
const LOW_BIT = (() => {
    const t = new Int32Array(52);
    for (let c = 0; c < 52; c++) {
        const r = c >> 2;                       // 0 = kakkonen .. 12 = ässä
        if (r === 12) t[c] = 1;                 // ässä on matalin
        else if (r <= 6) t[c] = 1 << (r + 1);   // 2..8
    }
    return t;
})();

const POP8 = (() => {
    const t = new Int32Array(256);
    for (let i = 1; i < 256; i++) t[i] = t[i >> 1] + (i & 1);
    return t;
})();

const BOARD_TRIPLES = (() => {
    const t = [];
    for (let i = 0; i < 5; i++)
        for (let j = i + 1; j < 5; j++)
            for (let k = j + 1; k < 5; k++) t.push(i, j, k);
    return new Int32Array(t);
})();

/** Hi/Lo-laskennan puskurit: hi-putken puskurit + low-puolen lisäykset */
function createHiloBuffers() {
    const buf = createBuffers();
    buf.pairLoG = new Int32Array(N_PAIRS);       // parin low-hyvyys tai -1
    buf.handLoG = new Int32Array(N_HANDS);       // käden low-hyvyys tai -1
    buf.loMasks = new Int32Array(64);            // pöydän eri low-maskit
    buf.histHL = new Int32Array(N_ROWS * buf.stride);  // hi-arvot low-käsistä
    buf.histL = new Int32Array(N_ROWS * LSTRIDE);      // low-hyvyydet
    buf.hi4 = new Float64Array(N_HANDS);         // hi-osuus, 1/4-potin yksiköissä
    buf.lo4 = new Float64Array(N_HANDS);         // low-osuus, 1/4-potin yksiköissä
    // Taajuudet: montako vastustajaa vastaan puolisko voitetaan yksin tai
    // jaetaan. Nämä ovat eri suure kuin osuus - hi-voitto tuo koko potin
    // vain low-kelvottomalla pöydällä. Luvut saadaan samoista I-E-termeistä
    // kuin osuudetkin, joten ne eivät maksa mitään lisää.
    buf.hiW = new Float64Array(N_HANDS);
    buf.hiT = new Float64Array(N_HANDS);
    buf.loW = new Float64Array(N_HANDS);
    buf.loT = new Float64Array(N_HANDS);
    // Koko potinosuuden jakauma neljänneksinä: montako vastustajaa vastaan
    // hero saa 0, 1, 2, 3 tai 4 neljännestä. q4 = scoop, q0 = vastustaja
    // scooppasi, q1..q3 = osapotti (q1 = kvartautuminen). Tästä saadaan
    // scoop ja osapotti, ja summa Σ q*n(q) on tarkistettavissa jo
    // laskettua osuutta (hi4 + lo4) vastaan.
    buf.q = [0, 1, 2, 3, 4].map(() => new Int32Array(N_HANDS));
    // Yhteisjakauma: ainoa rakenne joka vaatii hi:n ja low'n yhteisjakauman
    // (kaikki muu tulee marginaaleista). Indeksointi (rivi, hi, low-taso) on
    // järjestetty niin että low-taso on SISIN: käsi kirjataan kaikille
    // tasoille 0..g, mikä on tässä järjestyksessä yhtenäinen jono eikä
    // yhtätoista hajallaan olevaa kirjoitusta. Sillä on iso merkitys, koska
    // rakenne ei mahdu välimuistiin.
    //
    // Uint16 riittää kaikille riveille paitsi globaalille: yksittäinen
    // kortti esiintyy C(46,3) = 15 180 kädessä, pari 990:ssä ja kolmikko
    // 44:ssä. Globaali rivi (178 365) pidetään erillisessä 32-bittisessä
    // taulukossa - se on inkluusio-ekskluusion ensimmäinen termi.
    buf.hist2 = new Uint16Array(N_ROWS * buf.stride * G_LEVELS);
    buf.hist2g = new Uint32Array(buf.stride * G_LEVELS);
    // Pakatun hi-arvon käsiluokka (0 = hai .. 8 = värisuora)
    buf.catOf = new Int32Array(buf.stride);
    return buf;
}

// Yhteisjakauman rivisiirtymien esivaraus (15 riviä per käsi)
const scratchRows = new Int32Array(14);

// Pöydän summainvariantti: jokainen järjestetty (hero, vastustaja) -pari
// jakaa tasan yhden potin, joten neljännesosuuksien summa pöytää kohti on
// tasan 2 * N_HANDS * N_OPP.
const BOARD_SUM = 2 * N_HANDS * N_OPP;

/**
 * Ratkaisee yhden pöydän: kaikkien C(47,4) käden eksakti hi/lo-osuus yhtä
 * satunnaista vastustajaa vastaan. Tulokset buf.hi4/buf.lo4 -taulukoihin
 * neljännespotin yksiköissä: equity = (hi4 + lo4) / (4 * N_OPP).
 * @param {Int32Array|number[]} board - 5 korttia (0..51)
 * @param {object} buf - createHiloBuffers()
 */
function solveBoardHiLo(board, buf) {
    prepareBoard(board, buf);
    const R = buf.R;
    const { rest, handVal, pairLoG, handLoG, loMasks, hi4, lo4, hiW, hiT, loW, loT } = buf;
    const q0 = buf.q[0], q1 = buf.q[1], q2 = buf.q[2], q3 = buf.q[3], q4 = buf.q[4];

    // --- Pöydän low-kolmikot: 10 kolmikkoa, kelvollisissa 3 eri low-arvoa ---
    const bt = [];
    for (let b = 0; b < 30; b += 3) {
        const m = LOW_BIT[board[BOARD_TRIPLES[b]]]
            | LOW_BIT[board[BOARD_TRIPLES[b + 1]]]
            | LOW_BIT[board[BOARD_TRIPLES[b + 2]]];
        if (POP8[m] === 3) bt.push(m);
    }
    const lowPossible = bt.length > 0;
    const NBT = bt.length;

    // --- Histogrammipuskurit (stride voi kasvaa harvinaisella pöydällä) ---
    const STRIDE = R + 1;
    if (STRIDE > buf.stride) {
        buf.stride = STRIDE;
        buf.hist = new Int32Array(N_ROWS * STRIDE);
        buf.histHL = new Int32Array(N_ROWS * STRIDE);
        buf.hist2 = new Uint16Array(N_ROWS * STRIDE * G_LEVELS);
        buf.hist2g = new Uint32Array(STRIDE * G_LEVELS);
        buf.catOf = new Int32Array(STRIDE);
    }
    const HSTRIDE = buf.stride;

    // Käsiluokka (hai .. värisuora) pakatusta hi-arvosta. prepareBoard
    // jättää buf.distinct-taulukkoon pöydän eri raaka-arvot nousevaan
    // järjestykseen, ja eval5 koodaa luokan kertoimella 15^5. Taulukko on
    // korkeintaan 137 alkiota, joten luokka maksaa yhden haun per käsi
    // eikä jakolaskua 178 365 kertaa pöytää kohti.
    const catOf = buf.catOf;
    for (let v = 0; v < R; v++) catOf[v] = (buf.distinct[v] / 759375) | 0;

    const hist = buf.hist, histHL = buf.histHL, histL = buf.histL;
    const hist2 = buf.hist2, hist2g = buf.hist2g;
    const G = G_LEVELS;                  // low-taso on sisin indeksi
    const rows2 = scratchRows;           // 14 rivisiirtymää, esivarattu
    const { rowCard, rowPair, rowTriple } = buf;
    for (let i = 0; i < REST; i++) rowCard[i] = (ROW_CARD + i) * HSTRIDE;
    for (let p = 0; p < N_PAIRS; p++) rowPair[p] = (ROW_PAIR + p) * HSTRIDE;
    for (let q = 0; q < N_TRIPLES; q++) rowTriple[q] = (ROW_TRIPLE + q) * HSTRIDE;

    // Low-histogrammin rivit ovat kiinteällä LSTRIDE-leveydellä
    const lRowCard = new Int32Array(REST);
    const lRowPair = buf.lRowPair || (buf.lRowPair = new Int32Array(N_PAIRS));
    const lRowTriple = buf.lRowTriple || (buf.lRowTriple = new Int32Array(N_TRIPLES));
    for (let i = 0; i < REST; i++) lRowCard[i] = (ROW_CARD + i) * LSTRIDE;
    for (let p = 0; p < N_PAIRS; p++) lRowPair[p] = (ROW_PAIR + p) * LSTRIDE;
    for (let q = 0; q < N_TRIPLES; q++) lRowTriple[q] = (ROW_TRIPLE + q) * LSTRIDE;

    let RL = 0;

    if (lowPossible) {
        // --- Vaihe L1: 1 081 parin paras low-maski ---
        for (let j = 1; j < REST; j++) {
            const bj = LOW_BIT[rest[j]];
            const base = C2[j];
            for (let i = 0; i < j; i++) {
                const pm = LOW_BIT[rest[i]] | bj;
                let best = NO_LOW;
                if (POP8[pm] === 2) {
                    for (let b = 0; b < NBT; b++) {
                        const tm = bt[b];
                        // Erillisyys: parin ja kolmikon arvot eivät saa leikata
                        if ((pm & tm) === 0) {
                            const m = pm | tm;
                            if (m < best) best = m;
                        }
                    }
                }
                pairLoG[base + i] = best;   // väliaikaisesti maski; pakataan alla
            }
        }

        // --- Vaihe L1b: pakkaa maskit hyvyysasteiksi 0..RL-1 ---
        // Pienin maski = paras low = suurin hyvyys, jolloin histogrammien
        // ">= raja" -logiikka on identtinen hi-puolen kanssa.
        const seen = new Set();
        for (let p = 0; p < N_PAIRS; p++) {
            if (pairLoG[p] !== NO_LOW) seen.add(pairLoG[p]);
        }
        const sorted = [...seen].sort((a, b) => a - b);
        RL = sorted.length;
        if (RL + 1 > LSTRIDE) {
            throw new Error(`LSTRIDE ${LSTRIDE} ei riitä: pöydällä ${RL} eri low-maskia`);
        }
        // Yhteisjakaumasta kysytään tasoja gh ja gh+1, joten ylin tarvittava
        // taso on RL (aina tyhjä). Sen on mahduttava varattuun tilaan.
        if (RL + 1 > G_LEVELS) {
            throw new Error(`G_LEVELS ${G_LEVELS} ei riitä: pöydällä ${RL} eri low-arvoa`);
        }
        const goodOf = new Map();
        for (let t = 0; t < RL; t++) goodOf.set(sorted[t], RL - 1 - t);
        for (let t = 0; t < RL; t++) loMasks[RL - 1 - t] = sorted[t];  // hyvyys -> maski
        for (let p = 0; p < N_PAIRS; p++) {
            pairLoG[p] = pairLoG[p] === NO_LOW ? -1 : goodOf.get(pairLoG[p]);
        }

        // --- Vaihe L2: kaikkien käsien low-hyvyys (max kuudesta parista) ---
        // Sama silmukkarakenne kuin hi-puolen vaiheessa 2.
        for (let l = 3; l < REST; l++) {
            const c4l = C4[l], c2l = C2[l];
            for (let k = 2; k < l; k++) {
                const c3k = C3[k], c2k = C2[k];
                const gkl = pairLoG[c2l + k];
                for (let j = 1; j < k; j++) {
                    const c2j = C2[j];
                    const gjk = pairLoG[c2k + j];
                    const gjl = pairLoG[c2l + j];
                    let m1 = gkl > gjk ? gkl : gjk;
                    if (gjl > m1) m1 = gjl;
                    const base = c4l + c3k + c2j;
                    for (let i = 0; i < j; i++) {
                        const gij = pairLoG[c2j + i];
                        const gik = pairLoG[c2k + i];
                        const gil = pairLoG[c2l + i];
                        let m = m1;
                        if (gij > m) m = gij;
                        if (gik > m) m = gik;
                        if (gil > m) m = gil;
                        handLoG[base + i] = m;
                    }
                }
            }
        }
    }

    // --- Vaihe 3a: histogrammit + suffiksisummat ---
    hist.fill(0, 0, N_ROWS * HSTRIDE);
    if (lowPossible) {
        histHL.fill(0, 0, N_ROWS * HSTRIDE);
        histL.fill(0, 0, N_ROWS * LSTRIDE);
        hist2.fill(0, 0, N_ROWS * HSTRIDE * G);
        hist2g.fill(0, 0, HSTRIDE * G);
    }
    for (let l = 3; l < REST; l++) {
        const c4l = C4[l], c3l = C3[l], c2l = C2[l], rl = rowCard[l], sl = lRowCard[l];
        for (let k = 2; k < l; k++) {
            const c3k = C3[k], c2k = C2[k], rk = rowCard[k], sk = lRowCard[k];
            const rkl = rowPair[c2l + k], skl = lRowPair[c2l + k];
            const b3ikl = c3l + c2k;
            for (let j = 1; j < k; j++) {
                const c2j = C2[j], rj = rowCard[j], sj = lRowCard[j];
                const rjk = rowPair[c2k + j], rjl = rowPair[c2l + j];
                const sjk = lRowPair[c2k + j], sjl = lRowPair[c2l + j];
                const rjkl = rowTriple[c3l + c2k + j], sjkl = lRowTriple[c3l + c2k + j];
                const b3ijk = c3k + c2j, b3ijl = c3l + c2j;
                const base = c4l + c3k + c2j;
                for (let i = 0; i < j; i++) {
                    const idx = base + i;
                    const v = handVal[idx];
                    hist[v]++;
                    hist[rowCard[i] + v]++; hist[rj + v]++; hist[rk + v]++; hist[rl + v]++;
                    hist[rowPair[c2j + i] + v]++;
                    hist[rowPair[c2k + i] + v]++;
                    hist[rowPair[c2l + i] + v]++;
                    hist[rjk + v]++; hist[rjl + v]++; hist[rkl + v]++;
                    hist[rowTriple[b3ijk + i] + v]++;
                    hist[rowTriple[b3ijl + i] + v]++;
                    hist[rowTriple[b3ikl + i] + v]++;
                    hist[rjkl + v]++;

                    if (lowPossible) {
                        const g = handLoG[idx];
                        if (g >= 0) {
                            // Sama käsi low-käsien hi-histogrammiin...
                            histHL[v]++;
                            histHL[rowCard[i] + v]++; histHL[rj + v]++; histHL[rk + v]++; histHL[rl + v]++;
                            histHL[rowPair[c2j + i] + v]++;
                            histHL[rowPair[c2k + i] + v]++;
                            histHL[rowPair[c2l + i] + v]++;
                            histHL[rjk + v]++; histHL[rjl + v]++; histHL[rkl + v]++;
                            histHL[rowTriple[b3ijk + i] + v]++;
                            histHL[rowTriple[b3ijl + i] + v]++;
                            histHL[rowTriple[b3ikl + i] + v]++;
                            histHL[rjkl + v]++;
                            // ...ja low-hyvyyksien histogrammiin
                            histL[g]++;
                            histL[lRowCard[i] + g]++; histL[sj + g]++; histL[sk + g]++; histL[sl + g]++;
                            histL[lRowPair[c2j + i] + g]++;
                            histL[lRowPair[c2k + i] + g]++;
                            histL[lRowPair[c2l + i] + g]++;
                            histL[sjk + g]++; histL[sjl + g]++; histL[skl + g]++;
                            histL[lRowTriple[b3ijk + i] + g]++;
                            histL[lRowTriple[b3ijl + i] + g]++;
                            histL[lRowTriple[b3ikl + i] + g]++;
                            histL[sjkl + g]++;

                            // Yhteisjakauma: kirjataan käsi kaikille tasoille
                            // 0..g, jolloin taso tarkoittaa "low-hyvyys >= taso"
                            // eikä erillistä g-suuntaista summausta tarvita.
                            // Tasot ovat vierekkäin, joten tämä on 14 lyhyttä
                            // yhtenäistä jonoa. rows2 on esivarattu - allokointi
                            // tässä silmukassa maksaisi 178 365 kertaa/pöytä.
                            rows2[0] = (rowCard[i] + v) * G; rows2[1] = (rj + v) * G;
                            rows2[2] = (rk + v) * G; rows2[3] = (rl + v) * G;
                            rows2[4] = (rowPair[c2j + i] + v) * G;
                            rows2[5] = (rowPair[c2k + i] + v) * G;
                            rows2[6] = (rowPair[c2l + i] + v) * G;
                            rows2[7] = (rjk + v) * G; rows2[8] = (rjl + v) * G;
                            rows2[9] = (rkl + v) * G;
                            rows2[10] = (rowTriple[b3ijk + i] + v) * G;
                            rows2[11] = (rowTriple[b3ijl + i] + v) * G;
                            rows2[12] = (rowTriple[b3ikl + i] + v) * G;
                            rows2[13] = (rjkl + v) * G;
                            const gBase = v * G;
                            for (let gg = 0; gg <= g; gg++) {
                                hist2g[gBase + gg]++;
                                for (let r = 0; r < 14; r++) hist2[rows2[r] + gg]++;
                            }
                        }
                    }
                }
            }
        }
    }
    // S[v] = kuinka moni käsi on vähintään arvoa v
    for (let row = 0; row < N_ROWS; row++) {
        const off = row * HSTRIDE;
        for (let v = R - 1; v >= 0; v--) hist[off + v] += hist[off + v + 1];
    }
    if (lowPossible) {
        for (let row = 0; row < N_ROWS; row++) {
            const off = row * HSTRIDE;
            for (let v = R - 1; v >= 0; v--) histHL[off + v] += histHL[off + v + 1];
            const loff = row * LSTRIDE;
            for (let g = RL - 1; g >= 0; g--) histL[loff + g] += histL[loff + g + 1];
        }
        // Yhteisjakauma on jo kumulatiivinen low-suunnassa (rakennusvaiheessa),
        // joten vain hi-suunnan suffiksisumma puuttuu. Tasot ovat vierekkäin,
        // joten tämä käy taulukon läpi järjestyksessä.
        const gTop = RL;
        for (let v = R - 1; v >= 0; v--) {
            const a = v * G, b = a + G;
            for (let g = 0; g <= gTop; g++) hist2g[a + g] += hist2g[b + g];
        }
        for (let row = 1; row < N_ROWS; row++) {
            const rowOff = row * HSTRIDE;
            for (let v = R - 1; v >= 0; v--) {
                const a = (rowOff + v) * G, b = a + G;
                for (let g = 0; g <= gTop; g++) hist2[a + g] += hist2[b + g];
            }
        }
    }

    // --- Vaihe 3b: inkluusio-ekskluusio per käsi ---
    let boardSum = 0;
    for (let l = 3; l < REST; l++) {
        const c4l = C4[l], c3l = C3[l], c2l = C2[l], rl = rowCard[l], sl = lRowCard[l];
        for (let k = 2; k < l; k++) {
            const c3k = C3[k], c2k = C2[k], rk = rowCard[k], sk = lRowCard[k];
            const rkl = rowPair[c2l + k], skl = lRowPair[c2l + k];
            const b3ikl = c3l + c2k;
            for (let j = 1; j < k; j++) {
                const c2j = C2[j], rj = rowCard[j], sj = lRowCard[j];
                const rjk = rowPair[c2k + j], rjl = rowPair[c2l + j];
                const sjk = lRowPair[c2k + j], sjl = lRowPair[c2l + j];
                const rjkl = rowTriple[c3l + c2k + j], sjkl = lRowTriple[c3l + c2k + j];
                const b3ijk = c3k + c2j, b3ijl = c3l + c2j;
                const base = c4l + c3k + c2j;
                for (let i = 0; i < j; i++) {
                    const idx = base + i;
                    const v = handVal[idx];
                    const w = v + 1;
                    const ri = rowCard[i];
                    const rij = rowPair[c2j + i], rik = rowPair[c2k + i], ril = rowPair[c2l + i];
                    const rijk = rowTriple[b3ijk + i], rijl = rowTriple[b3ijl + i], rikl = rowTriple[b3ikl + i];

                    // Hi kaikkia vastustajia vastaan (sama kuin hi-putkessa):
                    // ge = vastustajia joiden hi >= heron, gt = aidosti parempia
                    const ge = hist[v]
                        - (hist[ri + v] + hist[rj + v] + hist[rk + v] + hist[rl + v])
                        + (hist[rij + v] + hist[rik + v] + hist[ril + v] + hist[rjk + v] + hist[rjl + v] + hist[rkl + v])
                        - (hist[rijk + v] + hist[rijl + v] + hist[rikl + v] + hist[rjkl + v]) + 1;
                    const gt = hist[w]
                        - (hist[ri + w] + hist[rj + w] + hist[rk + w] + hist[rl + w])
                        + (hist[rij + w] + hist[rik + w] + hist[ril + w] + hist[rjk + w] + hist[rjl + w] + hist[rkl + w])
                        - (hist[rijk + w] + hist[rijl + w] + hist[rikl + w] + hist[rjkl + w]);
                    const a1 = N_OPP - ge;     // hero voittaa hi:n
                    const t1 = ge - gt;        // hi tasan

                    if (!lowPossible) {
                        // Pöydällä ei voi olla low'ta: hi vie koko potin,
                        // joten osuus on 4, 2 tai 0 neljännestä
                        const s = 4 * a1 + 2 * t1;
                        hi4[idx] = s;
                        lo4[idx] = 0;
                        hiW[idx] = a1; hiT[idx] = t1;
                        loW[idx] = 0; loT[idx] = 0;
                        q4[idx] = a1; q3[idx] = 0; q2[idx] = t1; q1[idx] = 0;
                        q0[idx] = N_OPP - a1 - t1;
                        boardSum += s;
                        continue;
                    }

                    const si = lRowCard[i];
                    const sij = lRowPair[c2j + i], sik = lRowPair[c2k + i], sil = lRowPair[c2l + i];
                    const sijk = lRowTriple[b3ijk + i], sijl = lRowTriple[b3ijl + i], sikl = lRowTriple[b3ikl + i];
                    const g = handLoG[idx];

                    // Montako vastustajakättä tekee low'n: suffiksisumma
                    // hyvyydestä 0 ylöspäin = kaikki low-kädet. Nelikkötermi
                    // on heron oma käsi jos sillä on low.
                    const aOpp = histL[0]
                        - (histL[si] + histL[sj] + histL[sk] + histL[sl])
                        + (histL[sij] + histL[sik] + histL[sil] + histL[sjk] + histL[sjl] + histL[skl])
                        - (histL[sijk] + histL[sijl] + histL[sikl] + histL[sjkl])
                        + (g >= 0 ? 1 : 0);

                    // Hi-vertailu pelkkiä low-käsiä vastaan. Tarvitaan
                    // molemmissa haaroissa: ilman low'ta se erottaa ne
                    // vastustajat jotka vievät matalan puoliskon, ja low'n
                    // kanssa se antaa yhteisjakauman reunajakauman.
                    // Nelikkötermi lasketaan mukaan vain jos hero itse on
                    // low-käsi (silloin sen hi on tasan v).
                    const geHL = histHL[v]
                        - (histHL[ri + v] + histHL[rj + v] + histHL[rk + v] + histHL[rl + v])
                        + (histHL[rij + v] + histHL[rik + v] + histHL[ril + v] + histHL[rjk + v] + histHL[rjl + v] + histHL[rkl + v])
                        - (histHL[rijk + v] + histHL[rijl + v] + histHL[rikl + v] + histHL[rjkl + v])
                        + (g >= 0 ? 1 : 0);
                    const gtHL = histHL[w]
                        - (histHL[ri + w] + histHL[rj + w] + histHL[rk + w] + histHL[rl + w])
                        + (histHL[rij + w] + histHL[rik + w] + histHL[ril + w] + histHL[rjk + w] + histHL[rjl + w] + histHL[rkl + w])
                        - (histHL[rijk + w] + histHL[rijl + w] + histHL[rikl + w] + histHL[rjkl + w]);
                    const a2 = aOpp - geHL;  // low-kädet jotka hero voittaa hi:ssä
                    const t2 = geHL - gtHL;  // low-kädet joiden kanssa hi tasan
                    const nNL = N_OPP - aOpp;          // vastustajat ilman low'ta
                    const nlWin = a1 - a2, nlTie = t1 - t2;   // hi-vertailu niitä vastaan

                    let s, h4, l4;
                    if (g >= 0) {
                        // Herolla on low: hi-puolikas + low-vertailu low-käsiä
                        // vastaan + koko low-puolikas no-low-vastustajilta
                        const geL = histL[g]
                            - (histL[si + g] + histL[sj + g] + histL[sk + g] + histL[sl + g])
                            + (histL[sij + g] + histL[sik + g] + histL[sil + g] + histL[sjk + g] + histL[sjl + g] + histL[skl + g])
                            - (histL[sijk + g] + histL[sijl + g] + histL[sikl + g] + histL[sjkl + g]) + 1;
                        const gL = g + 1;
                        const gtL = gL > RL - 1
                            ? 0
                            : histL[gL]
                            - (histL[si + gL] + histL[sj + gL] + histL[sk + gL] + histL[sl + gL])
                            + (histL[sij + gL] + histL[sik + gL] + histL[sil + gL] + histL[sjk + gL] + histL[sjl + gL] + histL[skl + gL])
                            - (histL[sijk + gL] + histL[sijl + gL] + histL[sikl + gL] + histL[sjkl + gL]);
                        const a3 = aOpp - geL;   // hero voittaa low'n low-käsiä vastaan
                        const t3 = geL - gtL;    // low tasan
                        h4 = 2 * a1 + t1;
                        // Vastustaja jolla ei ole low'ta häviää low-puoliskon
                        // automaattisesti, joten hän kuuluu voitettuihin
                        l4 = 2 * a3 + t3 + 2 * nNL;
                        hiW[idx] = a1; hiT[idx] = t1;
                        loW[idx] = a3 + nNL; loT[idx] = t3;

                        // --- Osuusjakauma: tässä haarassa tarvitaan hi:n ja
                        // low'n YHTEISJAKAUMA. Marginaalit eivät riitä, koska
                        // scoop vaatii molempien puoliskojen voittamista samaa
                        // vastustajaa vastaan. Neljä kyselyä yhteisjakaumaan
                        // riittää 3x3-ristiintaulukon johtamiseen.
                        // Indeksointi: (rivisiirtymä + hi) * tasot + taso.
                        // Globaali rivi on omassa 32-bittisessä taulukossaan.
                        const gv = v * G + g, gw = w * G + g;
                        const gv1 = gv + 1, gw1 = gw + 1;
                        const HH = hist2g[gv]
                            - (hist2[ri * G + gv] + hist2[rj * G + gv] + hist2[rk * G + gv] + hist2[rl * G + gv])
                            + (hist2[rij * G + gv] + hist2[rik * G + gv] + hist2[ril * G + gv] + hist2[rjk * G + gv] + hist2[rjl * G + gv] + hist2[rkl * G + gv])
                            - (hist2[rijk * G + gv] + hist2[rijl * G + gv] + hist2[rikl * G + gv] + hist2[rjkl * G + gv]) + 1;
                        const H1 = hist2g[gw]
                            - (hist2[ri * G + gw] + hist2[rj * G + gw] + hist2[rk * G + gw] + hist2[rl * G + gw])
                            + (hist2[rij * G + gw] + hist2[rik * G + gw] + hist2[ril * G + gw] + hist2[rjk * G + gw] + hist2[rjl * G + gw] + hist2[rkl * G + gw])
                            - (hist2[rijk * G + gw] + hist2[rijl * G + gw] + hist2[rikl * G + gw] + hist2[rjkl * G + gw]);
                        const H2 = hist2g[gv1]
                            - (hist2[ri * G + gv1] + hist2[rj * G + gv1] + hist2[rk * G + gv1] + hist2[rl * G + gv1])
                            + (hist2[rij * G + gv1] + hist2[rik * G + gv1] + hist2[ril * G + gv1] + hist2[rjk * G + gv1] + hist2[rjl * G + gv1] + hist2[rkl * G + gv1])
                            - (hist2[rijk * G + gv1] + hist2[rijl * G + gv1] + hist2[rikl * G + gv1] + hist2[rjkl * G + gv1]);
                        const H3 = hist2g[gw1]
                            - (hist2[ri * G + gw1] + hist2[rj * G + gw1] + hist2[rk * G + gw1] + hist2[rl * G + gw1])
                            + (hist2[rij * G + gw1] + hist2[rik * G + gw1] + hist2[ril * G + gw1] + hist2[rjk * G + gw1] + hist2[rjl * G + gw1] + hist2[rkl * G + gw1])
                            - (hist2[rijk * G + gw1] + hist2[rijl * G + gw1] + hist2[rikl * G + gw1] + hist2[rjkl * G + gw1]);

                        // Ristiintaulukko: rivi = vastustajan hi heroon nähden
                        // (parempi / tasan / huonompi), sarake = sama low'lle.
                        // Heron osuus on hi-neljännekset + low-neljännekset.
                        const gtBetter = H3;                     // hi parempi, low parempi -> 0
                        const gtEqual = H1 - H3;                 // hi parempi, low tasan   -> 1
                        const gtWorse = gtHL - H1;               // hi parempi, low huonompi-> 2
                        const eqBetter = H2 - H3;                // hi tasan,  low parempi  -> 1
                        const eqEqual = (HH - H1) - eqBetter;    // hi tasan,  low tasan    -> 2
                        const eqWorse = t2 - (HH - H1);          // hi tasan,  low huonompi -> 3
                        const ltBetter = gtL - H2;               // hi huonompi, low parempi-> 2
                        const ltEqual = t3 - (HH - H2);          // hi huonompi, low tasan  -> 3
                        // Rivin "hero voittaa hi:n" (a2 kpl) jäännös
                        const ltWorse = a2 - ltBetter - ltEqual;  // -> 4 (scoop)

                        // Vastustajat ilman low'ta: hero vie matalan puoliskon
                        // aina, joten osuus on 2 + hi-neljännekset.
                        q0[idx] = gtBetter;
                        q1[idx] = gtEqual + eqBetter;
                        q2[idx] = gtWorse + eqEqual + ltBetter + (nNL - nlWin - nlTie);
                        q3[idx] = eqWorse + ltEqual + nlTie;
                        q4[idx] = ltWorse + nlWin;
                    } else {
                        // Herolla ei ole low'ta: hi-puolikas kaikkia vastaan +
                        // koko potti hi:llä niitä vastaan joilla ei myöskään
                        // ole low'ta (= kaikki miinus low-kädet)
                        h4 = 4 * a1 + 2 * t1 - 2 * a2 - t2;
                        l4 = 0;
                        // Ilman low'ta hero ei voi voittaa matalaa puoliskoa
                        hiW[idx] = a1; hiT[idx] = t1;
                        loW[idx] = 0; loT[idx] = 0;
                        // Osuusjakauma marginaaleista: low-vastustajaa vastaan
                        // hero saa korkeintaan hi-puolikkaan (0-2 neljännestä),
                        // muita vastaan koko potin (0, 2 tai 4).
                        q0[idx] = (aOpp - a2 - t2) + (nNL - nlWin - nlTie);
                        q1[idx] = t2;
                        q2[idx] = a2 + nlTie;
                        q3[idx] = 0;
                        q4[idx] = nlWin;
                    }
                    s = h4 + l4;
                    hi4[idx] = h4;
                    lo4[idx] = l4;
                    // Low-osuuden ja -taajuuksien on vastattava toisiaan:
                    // jokainen voitettu puolisko on 2 neljännestä ja jaettu 1
                    if (l4 !== 2 * loW[idx] + loT[idx]) {
                        throw new Error(`lo4 ${l4} != 2*loW ${loW[idx]} + loT ${loT[idx]}`);
                    }
                    // Osuusjakauman on toistettava sekä vastustajien määrä
                    // että jo laskettu osuus. Tämä on yhteisjakauman ainoa
                    // aito tarkistus: pöydän summainvariantti ei näe sitä,
                    // koska se katsoo vain kokonaisosuutta.
                    const qn = q0[idx] + q1[idx] + q2[idx] + q3[idx] + q4[idx];
                    if (qn !== N_OPP) {
                        throw new Error(`osuusjakauman summa ${qn} != ${N_OPP}`);
                    }
                    const qs = q1[idx] + 2 * q2[idx] + 3 * q3[idx] + 4 * q4[idx];
                    if (qs !== s) {
                        throw new Error(`osuusjakauma ${qs} != osuus ${s} (g=${g})`);
                    }
                    boardSum += s;
                }
            }
        }
    }

    // Summainvariantti: potti jakautuu tasan jokaisessa parissa. Tämä
    // laukeaa käytännössä mistä tahansa laskentavirheestä.
    if (boardSum !== BOARD_SUM) {
        throw new Error(`Pöydän summainvariantti rikki: ${boardSum} != ${BOARD_SUM} ` +
            `(pöytä ${Array.from(board).join(',')})`);
    }

    return { R, RL, lowPossible };
}

module.exports = {
    solveBoardHiLo, createHiloBuffers, LOW_BIT, POP8, NO_LOW, LSTRIDE,
    N_HANDS, N_OPP, REST, C2, C3, C4
};

// --- Työläinen (sama protokolla kuin exactOmahaWorker.js) ---------------

const { parentPort, workerData } = require('worker_threads');
if (parentPort) {
    const N_CLASSES = 16432;

    const G1 = new Float64Array(53), G2 = new Float64Array(53);
    const G3 = new Float64Array(53), G4 = new Float64Array(53), G5 = new Float64Array(53);
    for (let n = 0; n <= 52; n++) {
        G1[n] = n;
        G2[n] = n >= 2 ? (n * (n - 1)) / 2 : 0;
        G3[n] = n >= 3 ? (n * (n - 1) * (n - 2)) / 6 : 0;
        G4[n] = n >= 4 ? (n * (n - 1) * (n - 2) * (n - 3)) / 24 : 0;
        G5[n] = n >= 5 ? (n * (n - 1) * (n - 2) * (n - 3) * (n - 4)) / 120 : 0;
    }

    const unrank5 = (r) => {
        const c = new Int32Array(5);
        for (let pos = 4; pos >= 0; pos--) {
            const tbl = [G1, G2, G3, G4, G5][pos];
            let n = pos;
            while (n + 1 <= 52 && tbl[n + 1] <= r) n++;
            c[pos] = n;
            r -= tbl[n];
        }
        return c;
    };

    const nextCombination = (c) => {
        for (let i = 0; i < 5; i++) {
            const limit = i === 4 ? 52 : c[i + 1];
            if (c[i] + 1 < limit) {
                c[i]++;
                for (let j = 0; j < i; j++) c[j] = j;
                return true;
            }
        }
        return false;
    };

    const classOf = workerData.classOf;
    const buf = createHiloBuffers();

    function accumulate(acc, info) {
        const { rest, hi4, lo4, hiW, hiT, loW, loT, handLoG, handVal, catOf } = buf;
        const cat = acc.cat;
        const q0 = buf.q[0], q1 = buf.q[1], q2 = buf.q[2], q3 = buf.q[3], q4 = buf.q[4];
        // handLoG on kirjoitettu vain low-kelvollisilla pöydillä; muuten se
        // sisältää edellisen pöydän arvot, joten sitä ei saa lukea.
        const lowPossible = info.lowPossible;
        const nutG = info.RL - 1;
        for (let l = 3; l < REST; l++) {
            const c4l = C4[l], g4 = G4[rest[l]];
            for (let k = 2; k < l; k++) {
                const c3k = C3[k], g3 = g4 + G3[rest[k]];
                for (let j = 1; j < k; j++) {
                    const c2j = C2[j], g2 = g3 + G2[rest[j]];
                    const base = c4l + c3k + c2j;
                    for (let i = 0; i < j; i++) {
                        const cls = classOf[g2 + rest[i]];
                        const h = base + i;
                        acc.hi[cls] += hi4[h];
                        acc.lo[cls] += lo4[h];
                        acc.hiWin[cls] += hiW[h];
                        acc.hiTie[cls] += hiT[h];
                        acc.loWin[cls] += loW[h];
                        acc.loTie[cls] += loT[h];
                        acc.q0[cls] += q0[h];
                        acc.q1[cls] += q1[h];
                        acc.q2[cls] += q2[h];
                        acc.q3[cls] += q3[h];
                        acc.q4[cls] += q4[h];
                        // Käden oma korkea käsiluokka - ei riipu vastustajasta
                        cat[catOf[handVal[h]]][cls]++;
                        if (lowPossible) {
                            const gg = handLoG[h];
                            // Nämä eivät riipu vastustajasta lainkaan: kuinka
                            // usein käsi ylipäätään tekee low'n ja kuinka usein
                            // se on pöydän paras mahdollinen low.
                            if (gg >= 0) {
                                acc.lowMade[cls]++;
                                if (gg === nutG) acc.nutLow[cls]++;
                            }
                        }
                    }
                }
            }
        }
    }

    // cat0..cat8 = käden oma korkea käsiluokka (hai .. värisuora)
    const SERIES = ['hi', 'lo', 'hiWin', 'hiTie', 'loWin', 'loTie',
        'q0', 'q1', 'q2', 'q3', 'q4', 'lowMade', 'nutLow',
        'cat0', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6', 'cat7', 'cat8'];

    parentPort.on('message', (task) => {
        const acc = {};
        for (const s of SERIES) acc[s] = new Float64Array(N_CLASSES);
        acc.cat = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => acc['cat' + i]);
        const board = unrank5(task.startRank);
        for (let b = 0; b < task.count; b++) {
            const info = solveBoardHiLo(board, buf);
            accumulate(acc, info);
            if (b + 1 < task.count && !nextCombination(board)) break;
        }
        // cat on vain viitelista samoihin taulukoihin - se ei saa lähteä
        // mukaan viestiin, koska taulukot siirretään erikseen
        delete acc.cat;
        parentPort.postMessage(
            { chunk: task.chunk, boards: task.count, acc },
            SERIES.map(s => acc[s].buffer)
        );
    });
}
