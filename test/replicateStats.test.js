// Hybridiajojen virhearvioiden testit (scripts/replicateStats.js).
const test = require('node:test');
const assert = require('node:assert');
const { sampleSe, replicateMeans, comparisonSe } = require('../scripts/replicateStats');

test('sampleSe vastaa käsinlaskettua', () => {
    // 1,2,3,4: keskiarvo 2.5, otosvarianssi 5/3 -> se = sqrt(5/12)
    assert.ok(Math.abs(sampleSe([1, 2, 3, 4]) - Math.sqrt(5 / 12)) < 1e-12);
});

test('comparisonSe poistaa toistojen yhteisen siirtymän', () => {
    // Kolme luokkaa (todelliset equityt 10/20/30 %), neljä toistoa joilla
    // kullakin yhteinen siirtymä d[r]. Siirtymä näkyy absoluuttisessa
    // keskivirheessä mutta kumoutuu vertailukeskivirheessä täsmälleen.
    const d = [0.4, -0.2, 0.1, -0.3];
    const share = [], cnt = [];
    for (let r = 0; r < 4; r++) {
        const c = new Float64Array([1000, 1000, 1000]);
        const s = new Float64Array(3);
        [10, 20, 30].forEach((eq, i) => { s[i] = (eq + d[r]) / 100 * 1000; });
        share.push(s); cnt.push(c);
    }
    const { repMean, grandMean } = replicateMeans(share, cnt);
    // toiston kokoava keskiosuus on 20 + d[r]
    repMean.forEach((m, r) => assert.ok(Math.abs(m - (20 + d[r])) < 1e-9));

    const est = share.map((s, r) => 100 * s[0] / cnt[r][0]);   // luokan 0 estimaatit
    assert.ok(sampleSe(est) > 0.1, 'siirtymän pitää näkyä absoluuttisessa keskivirheessä');
    assert.ok(comparisonSe(est, repMean, grandMean) < 1e-9,
        'siirtymän pitää kumoutua vertailukeskivirheessä');
});
