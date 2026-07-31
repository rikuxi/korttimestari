// Taulukkovälimuistin painotetun LRU-häädön testit.
//
// Budjetti lasketaan riveinä, ei taulukkoina: Hold'em-taulukko (169 riviä)
// ei saa häätää Omaha5-taulukkoa (134 459 riviä), koska muuten pelimuotojen
// vuorottelu lukisi 35 MB:n tiedostoja levyltä jokaisella pyynnöllä.
//
// Budjetti luetaan moduulin latauksessa, joten se asetetaan ennen requirea.
// 2 = kaksi Omaha5-kokoista taulukkoa (pienin sallittu arvo), jotta häätö
// oikeasti laukeaa testeissä - oletuksella 10 mikään ei häätyisi koskaan.
process.env.PREFLOP_CACHE_TABLES = '2';

const test = require('node:test');
const assert = require('node:assert');
const preflopTables = require('../preflopTables');

// Välimuistiosuma palauttaa saman objektin; uudelleenlataus levyltä uuden.
// Viiteidentiteetti on siis suora havainto siitä, häätyikö taulukko.

test('halvat taulukot eivät häädä kallista (painotettu LRU)', () => {
    const big = preflopTables.loadTable('omaha5', 2);
    assert.ok(big, 'omaha5-taulukon on löydyttävä');
    for (let p = 2; p <= 10; p++) assert.ok(preflopTables.loadTable('holdem', p));
    for (let p = 2; p <= 9; p++) assert.ok(preflopTables.loadTable('omaha', p));
    // 18 taulukkoa ladattu päälle - kappalepohjainen raja olisi häätänyt
    // omaha5:n ajat sitten. Painotettuna kaikki Hold'em- ja Omaha-taulukot
    // yhteensä painavat alle yhden Omaha5:n, joten se pysyy muistissa.
    assert.strictEqual(preflopTables.loadTable('omaha5', 2), big);
});

test('budjetin ylittyessä häätyy pisimpään käyttämättä ollut', () => {
    const a = preflopTables.loadTable('omaha5', 2);
    const b = preflopTables.loadTable('omaha5', 3);
    // Kolmas Omaha5 ylittää kahden taulukon budjetin - vanhin (a) häätyy,
    // tuoreemmat säilyvät
    const c = preflopTables.loadTable('omaha5', 4);
    assert.strictEqual(preflopTables.loadTable('omaha5', 4), c);
    assert.strictEqual(preflopTables.loadTable('omaha5', 3), b);
    assert.notStrictEqual(preflopTables.loadTable('omaha5', 2), a);
});

test('warmCache käy kaikki yhdistelmät läpi ja raportoi määrän', async () => {
    // Hold'em 2-10 (9) + Omaha 2-9 (8) + Omaha5 2-9 (8) + Omaha Hi/Lo 2-9 (8).
    // Hi/Lo:n taulukkotiedostoja ei vielä ole, mutta yhdistelmät käydään
    // läpi silti - taulukot tulevat käyttöön pelkillä datatiedostoilla.
    const count = await new Promise(resolve => preflopTables.warmCache(resolve));
    assert.strictEqual(count, 33);
    // Lämmityksen jälkeen haut osuvat välimuistiin budjetin rajoissa:
    // viimeisimmät taulukot palautuvat ilman uudelleenlatausta
    const warm = preflopTables.loadTable('omaha5', 9);
    assert.strictEqual(preflopTables.loadTable('omaha5', 9), warm);
});
