// Toistoihin perustuvat virhearviot hybridiajoille.
//
// se: toistoestimaattien otoshajonnasta johdettu keskivirhe - kertoo
// yksittäisen equity-luvun absoluuttisen epävarmuuden.
//
// seCmp: sama, mutta jokaisesta toistosta on ensin vähennetty sen oma
// kokoava keskiosuus (yhteinen siirtymä). Saman ajon toistot jakavat
// siirtymän, joka kumoutuu kahta kättä vertailtaessa - siksi naiivi
// sqrt(se_i² + se_j²) yliarvioi erojen epävarmuuden noin 20 %
// (mitattu eksaktia heads-up-taulukkoa vasten: parien erojen RMS z
// oli 0.815, kun yksittäisten käsien RMS z oli 0.996).
//
// Käytä seCmp:tä kun vertaat käsiä keskenään (järjestys, erot) ja
// se:tä kun kysyt yhden käden absoluuttista equityä.

'use strict';

/** Toistoestimaattien keskivirhe: otoshajonta / sqrt(k) */
function sampleSe(values) {
    const k = values.length;
    const m = values.reduce((a, b) => a + b, 0) / k;
    const v = values.reduce((a, b) => a + (b - m) * (b - m), 0) / (k - 1);
    return Math.sqrt(v / k);
}

/**
 * Toistokohtaiset kokoavat keskiosuudet prosentteina ja niiden keskiarvo.
 * @param {Float64Array[]} shareArrays - state.share, yksi taulukko per toisto
 * @param {Float64Array[]} cntArrays - state.cnt samoin
 */
function replicateMeans(shareArrays, cntArrays) {
    const k = shareArrays.length;
    const repMean = new Array(k);
    for (let r = 0; r < k; r++) {
        let s = 0, c = 0;
        const S = shareArrays[r], C = cntArrays[r];
        for (let i = 0; i < S.length; i++) { s += S[i]; c += C[i]; }
        repMean[r] = 100 * s / c;
    }
    const grandMean = repMean.reduce((a, b) => a + b, 0) / k;
    return { repMean, grandMean };
}

/** Vertailukeskivirhe: toiston yhteinen siirtymä poistettu ennen hajontaa */
function comparisonSe(est, repMean, grandMean) {
    return sampleSe(est.map((e, r) => e - (repMean[r] - grandMean)));
}

module.exports = { sampleSe, replicateMeans, comparisonSe };
