const test = require('node:test');
const assert = require('node:assert');
const {
    canonicalizeHoldem,
    enumerateHoldemCanonical,
    canonicalizeOmaha,
    enumerateOmahaCanonical,
    describeOmahaKey,
    keyToHand,
    canonicalizeOmaha5,
    omahaNotation
} = require('../canonical');
const { simulateHandClass, simulateOmahaHandClass } = require('../scripts/precomputeWorker');

test('canonicalizeHoldem kanonisoi parit, suited- ja offsuit-kädet', () => {
    assert.strictEqual(canonicalizeHoldem(['As', 'Ks']), 'AKs');
    assert.strictEqual(canonicalizeHoldem(['Kh', 'Ad']), 'AKo');
    assert.strictEqual(canonicalizeHoldem(['7c', '7d']), '77');
    assert.strictEqual(canonicalizeHoldem(['2s', '3s']), '32s');
    assert.strictEqual(canonicalizeHoldem(['Td', 'Jd']), 'JTs');
    // Korttien järjestys ei saa vaikuttaa avaimeen
    assert.strictEqual(canonicalizeHoldem(['Ks', 'As']), canonicalizeHoldem(['As', 'Ks']));
});

test('canonicalizeHoldem palauttaa null virheelliselle syötteelle', () => {
    assert.strictEqual(canonicalizeHoldem(null), null);
    assert.strictEqual(canonicalizeHoldem(['As']), null);
    assert.strictEqual(canonicalizeHoldem(['As', 'As']), null); // duplikaatti
    assert.strictEqual(canonicalizeHoldem(['As', 'Xx']), null);
    assert.strictEqual(canonicalizeHoldem(['As', 'Ks', 'Qs']), null);
});

test('enumerateHoldemCanonical tuottaa 169 uniikkia luokkaa, kombot yhteensä 1326', () => {
    const classes = enumerateHoldemCanonical();
    assert.strictEqual(classes.length, 169);
    assert.strictEqual(new Set(classes.map(c => c.key)).size, 169);

    const totalCombos = classes.reduce((sum, c) => sum + c.combos, 0);
    assert.strictEqual(totalCombos, 1326); // C(52,2)

    const pairs = classes.filter(c => c.key.length === 2);
    const suited = classes.filter(c => c.key.endsWith('s'));
    const offsuit = classes.filter(c => c.key.endsWith('o'));
    assert.strictEqual(pairs.length, 13);
    assert.strictEqual(suited.length, 78);
    assert.strictEqual(offsuit.length, 78);
    assert.ok(pairs.every(c => c.combos === 6));
    assert.ok(suited.every(c => c.combos === 4));
    assert.ok(offsuit.every(c => c.combos === 12));
});

test('enumerateHoldemCanonical: edustajakäsi kanonisoituu omaan avaimeensa', () => {
    for (const cls of enumerateHoldemCanonical()) {
        assert.strictEqual(canonicalizeHoldem(cls.hand), cls.key,
            `edustajakäsi ${cls.hand} ei vastaa avainta ${cls.key}`);
    }
});

test('canonicalizeOmaha: väripermutaatio ja korttijärjestys eivät vaikuta avaimeen', () => {
    // Sama käsi eri väreillä (s<->h, d<->c vaihdettu) -> sama luokka
    const a = canonicalizeOmaha(['As', 'Kh', 'Qd', 'Jc']);
    const b = canonicalizeOmaha(['Ah', 'Ks', 'Qc', 'Jd']);
    assert.strictEqual(a, b);

    // Korttien järjestys taulukossa ei vaikuta
    const c = canonicalizeOmaha(['Jc', 'Qd', 'As', 'Kh']);
    assert.strictEqual(a, c);

    // Väripatterni erottaa luokat: double-suited != rainbow
    const doubleSuited = canonicalizeOmaha(['As', 'Ks', 'Qh', 'Jh']);
    const rainbow = canonicalizeOmaha(['As', 'Kh', 'Qd', 'Jc']);
    assert.notStrictEqual(doubleSuited, rainbow);
});

test('canonicalizeOmaha palauttaa null virheelliselle syötteelle', () => {
    assert.strictEqual(canonicalizeOmaha(null), null);
    assert.strictEqual(canonicalizeOmaha(['As', 'Ks']), null);
    assert.strictEqual(canonicalizeOmaha(['As', 'As', 'Kh', 'Qd']), null); // duplikaatti
    assert.strictEqual(canonicalizeOmaha(['As', 'Kh', 'Qd', 'Xx']), null);
});

test('enumerateOmahaCanonical tuottaa 16432 uniikkia luokkaa, kombot yhteensä 270725', () => {
    const classes = enumerateOmahaCanonical();
    assert.strictEqual(classes.length, 16432);
    assert.strictEqual(new Set(classes.map(c => c.key)).size, 16432);

    const totalCombos = classes.reduce((sum, c) => sum + c.combos, 0);
    assert.strictEqual(totalCombos, 270725); // C(52,4)

    // Edustajakäsi kanonisoituu omaan avaimeensa (otanta joka 100:s luokka,
    // täysi tarkistus olisi tarpeettoman hidas testiin)
    for (let i = 0; i < classes.length; i += 100) {
        const cls = classes[i];
        assert.strictEqual(canonicalizeOmaha(cls.hand), cls.key);
        assert.deepStrictEqual(keyToHand(cls.key), cls.hand);
    }
});

test('describeOmahaKey tunnistaa väripatternit', () => {
    // Suora avain: AAKK double-suited
    assert.strictEqual(describeOmahaKey('AdAcKdKc'), 'AAKK (ds)');

    // Muut patternit kanonisoinnin kautta - varmistaa että describe toimii
    // juuri niille avaimille joita enumerointi tuottaa
    assert.strictEqual(describeOmahaKey(canonicalizeOmaha(['As', 'Kh', 'Qd', 'Jc'])), 'AKQJ (r)');
    assert.strictEqual(describeOmahaKey(canonicalizeOmaha(['As', 'Ah', 'Ks', 'Kd'])), 'AAKK (ss)');
    assert.strictEqual(describeOmahaKey(canonicalizeOmaha(['As', 'Ks', 'Qs', 'Jh'])), 'AKQJ (3s)');
    assert.strictEqual(describeOmahaKey(canonicalizeOmaha(['As', 'Ks', 'Qs', 'Js'])), 'AKQJ (m)');

    // Arvot tulevat avaimesta suurin ensin
    assert.strictEqual(describeOmahaKey(canonicalizeOmaha(['2s', '5h', '3d', '4c'])), '5432 (r)');
});

test('describeOmahaKey palauttaa null virheelliselle avaimelle', () => {
    assert.strictEqual(describeOmahaKey(null), null);
    assert.strictEqual(describeOmahaKey(''), null);
    assert.strictEqual(describeOmahaKey('AdAcKd'), null);      // liian lyhyt
    assert.strictEqual(describeOmahaKey('AdAcKdXx'), null);    // epäkelpo kortti
});

test('simulateOmahaHandClass on deterministinen ja tuottaa järkevän equityn', () => {
    const a = simulateOmahaHandClass(['As', 'Ah', 'Ks', 'Kh'], 5, 2000, 99);
    const b = simulateOmahaHandClass(['As', 'Ah', 'Ks', 'Kh'], 5, 2000, 99);
    assert.deepStrictEqual(a, b);

    // AAKK double-suited heads-up vs. satunnainen käsi: equity ~68-69 %
    const aakk = simulateOmahaHandClass(['As', 'Ah', 'Ks', 'Kh'], 1, 10000, 7);
    const equity = 100 * aakk.equitySum / 10000;
    assert.ok(equity > 64 && equity < 73, `AAKKds heads-up equity ${equity}%`);
    assert.ok(aakk.equitySum >= aakk.wins && aakk.equitySum <= aakk.wins + aakk.ties);
});

test('simulateHandClass on deterministinen samalla seedillä', () => {
    const a = simulateHandClass(['As', 'Kh'], 5, 5000, 12345);
    const b = simulateHandClass(['As', 'Kh'], 5, 5000, 12345);
    assert.deepStrictEqual(a, b);

    const c = simulateHandClass(['As', 'Kh'], 5, 5000, 54321);
    assert.notDeepStrictEqual(a, c); // eri seed -> eri satunnaisjono
});

test('simulateHandClass tuottaa järkevän equityn tunnetuille käsille', () => {
    // AA heads-up vs. satunnainen käsi: equity ~85 %
    const aa = simulateHandClass(['As', 'Ah'], 1, 20000, 7);
    const aaEquity = 100 * aa.equitySum / 20000;
    assert.ok(aaEquity > 82 && aaEquity < 88, `AA heads-up equity ${aaEquity}%`);

    // 72o heads-up vs. satunnainen käsi: equity ~35 %
    const trash = simulateHandClass(['7s', '2h'], 1, 20000, 7);
    const trashEquity = 100 * trash.equitySum / 20000;
    assert.ok(trashEquity > 31 && trashEquity < 39, `72o heads-up equity ${trashEquity}%`);

    // Equity on aina välillä [wins, wins + ties] (tasapelit jaetaan)
    assert.ok(aa.equitySum >= aa.wins && aa.equitySum <= aa.wins + aa.ties);
});

test('canonicalizeOmaha5 on riippumaton korttien järjestyksestä', () => {
    const a = canonicalizeOmaha5(['As', 'Ks', 'Qh', 'Jh', 'Td']);
    const b = canonicalizeOmaha5(['Td', 'Jh', 'Qh', 'Ks', 'As']);
    assert.strictEqual(a, b);
    assert.strictEqual(canonicalizeOmaha5(['As', 'Ks', 'Qh', 'Jh']), null, 'neljä korttia ei kelpaa');
    assert.strictEqual(canonicalizeOmaha5(['As', 'As', 'Qh', 'Jh', 'Td']), null, 'kaksoiskappale ei kelpaa');
});

test('canonicalizeOmaha5 tunnistaa väri-isomorfian', () => {
    // Sama käsi eri maissa -> sama luokka
    const a = canonicalizeOmaha5(['As', 'Ks', 'Qh', 'Jh', 'Td']);
    const b = canonicalizeOmaha5(['Ad', 'Kd', 'Qc', 'Jc', 'Th']);
    assert.strictEqual(a, b);
    // Eri väripatterni -> eri luokka
    const c = canonicalizeOmaha5(['As', 'Ks', 'Qs', 'Jh', 'Td']);
    assert.notStrictEqual(a, c);
});

test('describeOmahaKey nimeää 5 kortin väripatternit', () => {
    const name = h => describeOmahaKey(canonicalizeOmaha5(h));
    assert.strictEqual(name(['As', 'Ks', 'Qs', 'Js', 'Ts']), 'AKQJT (m)');
    assert.strictEqual(name(['As', 'Ks', 'Qs', 'Js', 'Td']), 'AKQJT (4s)');
    assert.strictEqual(name(['As', 'Ks', 'Qs', 'Jh', 'Th']), 'AKQJT (3s2)');
    assert.strictEqual(name(['As', 'Ks', 'Qs', 'Jh', 'Td']), 'AKQJT (3s)');
    assert.strictEqual(name(['As', 'Ks', 'Qh', 'Jh', 'Td']), 'AKQJT (ds)');
    assert.strictEqual(name(['As', 'Ks', 'Qh', 'Jd', 'Tc']), 'AKQJT (ss)');
    // Nelikorttiset nimet eivät muuttuneet
    assert.strictEqual(describeOmahaKey('AdAcKdKc'), 'AAKK (ds)');
});

test('omahaNotation yksilöi luokan toisin kuin describeOmahaKey', () => {
    // Kaksi eri luokkaa, sama nimi - merkinnän pitää erottaa ne
    const a = canonicalizeOmaha5(['Ad', 'Ac', 'Jd', 'Jc', 'Th']);
    const b = canonicalizeOmaha5(['Ad', 'Ac', 'Jh', 'Jc', 'Td']);
    assert.notStrictEqual(a, b);
    assert.strictEqual(describeOmahaKey(a), describeOmahaKey(b), 'nimi on sama');
    assert.notStrictEqual(omahaNotation(a), omahaNotation(b), 'merkintä eroaa');

    assert.strictEqual(omahaNotation(a), '(AJ)(AJ)T');
    assert.strictEqual(omahaNotation(canonicalizeOmaha(['Ad', 'Ac', 'Kd', 'Kc'])), '(AK)(AK)');
    assert.strictEqual(omahaNotation(canonicalizeOmaha5(['As', 'Ks', 'Qs', 'Js', 'Ts'])), '(AKQJT)');
    assert.strictEqual(omahaNotation(canonicalizeOmaha(['As', 'Kh', 'Qd', 'Jc'])), 'AKQJ');
});

test('omahaNotation järjestää ryhmät arvon eikä koon mukaan', () => {
    // ProPokerToolsin järjestys: ässä on jättiä korkeampi, joten yksittäiset
    // ässät tulevat ennen (JT)-ryhmää. Tällä säännöllä merkinnät vastaavat
    // heidän julkaisemaansa 16 432 rivin listaa merkki merkiltä.
    assert.strictEqual(omahaNotation(canonicalizeOmaha(['As', 'Ah', 'Jd', 'Td'])), 'AA(JT)');
    assert.strictEqual(omahaNotation(canonicalizeOmaha(['As', 'Ah', 'Kd', 'Qd'])), 'AA(KQ)');
    // Tasatilanteessa pidempi ryhmä ensin
    assert.strictEqual(omahaNotation(canonicalizeOmaha(['As', 'Ts', 'Ah', 'Td'])), '(AT)AT');
});

test('omahaNotation on yksikäsitteinen kaikille nelikorttisille luokille', () => {
    const seen = new Set();
    for (const c of enumerateOmahaCanonical()) seen.add(omahaNotation(c.key));
    assert.strictEqual(seen.size, 16432, 'jokaisella luokalla oma merkintä');
});
