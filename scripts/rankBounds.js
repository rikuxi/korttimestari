// Sija-alueen [rankLow, rankHigh] laskenta esilasketuille taulukoille.
//
// Pelkkä rank esittää järjestyksen tarkempana kuin se on: esimerkiksi
// Omaha5:n 6-max-listan keskivaiheilla käden todellinen sija voi
// keskivirheiden puitteissa olla ±satoja sijoja. Alue kertoo rehellisesti,
// mitkä sijat ovat käden ulottuvilla.
//
// Määritelmä: naapuri j kuuluu käden i alueeseen, jos equity-ero on alle
// kaksi yhdistettyä keskivirhettä eli |eq_i - eq_j| < 2*sqrt(se_i²+se_j²).
// Aluetta kasvatetaan molempiin suuntiin kunnes ehto katkeaa. Eksakteissa
// taulukoissa se = 0, joten alue on aina [rank, rank].
//
// Käyttö kirjastona (eräajot):   const { addRankBounds } = require('./rankBounds');
//                                addRankBounds(hands);   // equityn mukaan järjestetty
// Käyttö työkaluna (jälkikäteen): node scripts/rankBounds.js
//   - rikastaa kaikki data/preflop-*.json + .csv -parit paikallaan (idempotentti)

'use strict';

/**
 * Lisää rankLow/rankHigh-kentät käsilistaan.
 * @param {Array<{equity: number, se?: number}>} hands - equityn mukaan
 *   laskevasti järjestetty; muokataan paikallaan
 */
function addRankBounds(hands) {
    const n = hands.length;
    const se = i => hands[i].se || 0;
    for (let i = 0; i < n; i++) {
        let lo = i;
        while (lo > 0 && hands[lo - 1].equity - hands[i].equity < 2 * Math.hypot(se(i), se(lo - 1))) lo--;
        let hi = i;
        while (hi < n - 1 && hands[i].equity - hands[hi + 1].equity < 2 * Math.hypot(se(i), se(hi + 1))) hi++;
        hands[i].rankLow = lo + 1;
        hands[i].rankHigh = hi + 1;
    }
    return hands;
}

// --- Työkalu: rikasta olemassa olevat taulukot -------------------------

function enrichFile(jsonPath, timestamp) {
    const fs = require('fs');
    const d = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    addRankBounds(d.hands);
    d.meta.rankBounds = {
        method: 'naapuri kuuluu alueeseen jos equity-ero < 2*sqrt(se_i^2+se_j^2)',
        note: 'eksakteissa taulukoissa alue on [rank, rank]',
        addedAt: timestamp
    };
    fs.writeFileSync(jsonPath, JSON.stringify(d, null, 2) + '\n');

    // CSV: sama tieto sarakkeina rank_low, rank_high. Rivit ovat samassa
    // järjestyksessä kuin JSON:n hands (verifioitu vastaavuus).
    const csvPath = jsonPath.replace(/\.json$/, '.csv');
    if (!fs.existsSync(csvPath)) return d.hands.length;
    const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
    if (lines.length - 1 !== d.hands.length) {
        throw new Error(`${csvPath}: ${lines.length - 1} riviä vs ${d.hands.length} kättä`);
    }
    const rows = lines.map(l => l.split(','));
    // Idempotenssi: pudota mahdolliset aiemmat sarakkeet ennen lisäystä
    const drop = ['rank_low', 'rank_high'].map(c => rows[0].indexOf(c)).filter(x => x >= 0);
    const strip = row => row.filter((_, idx) => !drop.includes(idx));
    for (let i = 0; i < rows.length; i++) rows[i] = strip(rows[i]);
    rows[0].push('rank_low', 'rank_high');
    for (let i = 1; i < rows.length; i++) {
        const h = d.hands[i - 1];
        if (parseInt(rows[i][0], 10) !== h.rank) {
            throw new Error(`${csvPath} rivi ${i}: rank ${rows[i][0]} != ${h.rank}`);
        }
        rows[i].push(h.rankLow, h.rankHigh);
    }
    fs.writeFileSync(csvPath, rows.map(r => r.join(',')).join('\n') + '\n');
    return d.hands.length;
}

if (require.main === module) {
    const fs = require('fs');
    const path = require('path');
    const dataDir = path.resolve(__dirname, '..', 'data');
    const files = fs.readdirSync(dataDir)
        .filter(f => /^preflop-.*\.json$/.test(f))
        .sort();
    const timestamp = new Date().toISOString();
    for (const f of files) {
        const n = enrichFile(path.join(dataDir, f), timestamp);
        console.log(`${f}: ${n} kättä rikastettu`);
    }
    console.log(`\nValmis: ${files.length} taulukkoa.`);
}

module.exports = { addRankBounds };
