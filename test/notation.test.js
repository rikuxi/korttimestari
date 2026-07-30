// omahaNotation-järjestyssäännön regressiotestit.
//
// data/README lupaa, että merkintä toistaa ProPokerToolsin julkaiseman
// muodon merkilleen. Alkuperäinen vertailu kaikkia 16 432 riviä vasten oli
// kertaluontoinen - tämä testi pinnaa säännön 85 rivin otoksella
// (test/fixtures/ppt-notation-sample.txt), jotta säännön muuttaminen
// laukaisee hälytyksen. Viisikorttisille ei ole ulkoista lähdettä, joten
// niiden pinnit on poimittu omasta varmennetusta taulukosta.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalizeOmaha, canonicalizeOmaha5, omahaNotation } = require('../canonical');

/**
 * PPT-merkintä konkreettiseksi kädeksi: sulkuryhmän kortit jakavat maan,
 * ryhmien välillä maat eroavat. Ryhmiä on korkeintaan neljä, joten maat
 * riittävät aina.
 */
function pptToHand(notation) {
    const groups = [];
    let i = 0;
    while (i < notation.length) {
        if (notation[i] === '(') {
            const end = notation.indexOf(')', i);
            assert.ok(end > i, `pariton sulku: ${notation}`);
            groups.push(notation.slice(i + 1, end).split(''));
            i = end + 1;
        } else {
            groups.push([notation[i]]);
            i++;
        }
    }
    const suits = ['s', 'h', 'd', 'c'];
    assert.ok(groups.length <= suits.length, `liikaa ryhmiä: ${notation}`);
    const hand = [];
    groups.forEach((ranks, g) => {
        for (const r of ranks) hand.push(r + suits[g]);
    });
    return hand;
}

test('omahaNotation toistaa ProPokerToolsin merkinnän (85 rivin otos)', () => {
    const fixture = path.join(__dirname, 'fixtures', 'ppt-notation-sample.txt');
    const lines = fs.readFileSync(fixture, 'utf8').split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
    assert.ok(lines.length >= 80, `otoksessa vain ${lines.length} riviä`);

    for (const ppt of lines) {
        const hand = pptToHand(ppt);
        assert.strictEqual(hand.length, 4, `väärä korttimäärä: ${ppt}`);
        const key = canonicalizeOmaha(hand);
        assert.ok(key, `kanonisointi epäonnistui: ${ppt}`);
        assert.strictEqual(omahaNotation(key), ppt, `merkintä poikkeaa PPT:stä: ${ppt}`);
    }
});

test('omahaNotation-pinnit viisikorttisille (kaikki maapatternit)', () => {
    // 5 kortin kädessä on korkeintaan 4 maata, joten sateenkaarta ei ole -
    // patternit ovat ss, ds, 3s, 3s2, 4s ja m. Odotusarvot on poimittu
    // varmennetusta taulukosta data/preflop-omaha5-6max-hybrid.json.
    const pins = [
        ['AdAcJdJcTh', '(AJ)(AJ)T'],    // ds  (2+2+1)
        ['AdAcJdJcTc', '(AJT)(AJ)'],    // 3s2 (3+2)
        ['AdAcJhJcTs', '(AJ)AJT'],      // ss  (2+1+1+1)
        ['AdAcJhJcTc', '(AJT)AJ'],      // 3s  (3+1+1)
        ['AdAcQcJcTc', '(AQJT)A'],      // 4s  (4+1)
        ['AcKcQcJcTc', '(AKQJT)']       // m   (5)
    ];
    for (const [key, expected] of pins) {
        assert.strictEqual(omahaNotation(key), expected, `avain ${key}`);
        // sama tulos konkreettisen käden kautta kanonisoituna
        assert.strictEqual(omahaNotation(canonicalizeOmaha5(key.match(/.{2}/g))), expected);
    }
});
