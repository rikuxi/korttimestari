// Käännöskatalogin eheystestit (public/js/i18n.js).
const test = require('node:test');
const assert = require('node:assert');
const { I18N_CATALOGS, createI18n } = require('../public/js/i18n');

test('fi- ja en-katalogeissa on täsmälleen samat avaimet', () => {
    const fiKeys = Object.keys(I18N_CATALOGS.fi).sort();
    const enKeys = Object.keys(I18N_CATALOGS.en).sort();
    assert.deepStrictEqual(enKeys, fiKeys);
});

test('kaikki tekstit ovat epätyhjiä merkkijonoja', () => {
    for (const lang of ['fi', 'en']) {
        for (const [key, value] of Object.entries(I18N_CATALOGS[lang])) {
            assert.strictEqual(typeof value, 'string', `${lang}:${key} ei ole merkkijono`);
            assert.ok(value.length > 0, `${lang}:${key} on tyhjä`);
        }
    }
});

test('parametrilliset avaimet käyttävät samoja paikkamerkkejä molemmissa kielissä', () => {
    const placeholders = s => (s.match(/\{[a-zA-Z]+\}/g) || []).sort();
    for (const key of Object.keys(I18N_CATALOGS.fi)) {
        assert.deepStrictEqual(
            placeholders(I18N_CATALOGS.en[key]), placeholders(I18N_CATALOGS.fi[key]),
            `avaimen ${key} paikkamerkit eroavat`);
    }
});

test('t() korvaa parametrit ja palauttaa tuntemattoman avaimen sellaisenaan', () => {
    const fi = createI18n('fi');
    const en = createI18n('en');
    assert.strictEqual(fi.t('sim.playerCardsMissing', { n: 3 }),
        'Pelaajalla 3 ei ole kaikkia kortteja valittuna.');
    assert.strictEqual(en.t('sim.playerCardsMissing', { n: 3 }),
        'Player 3 does not have all cards selected.');
    assert.strictEqual(fi.t('ei.ole.olemassa'), 'ei.ole.olemassa');
    assert.strictEqual(fi.locale, 'fi-FI');
    assert.strictEqual(en.locale, 'en-GB');
    // Tuntematon kieli putoaa suomeen
    assert.strictEqual(createI18n('sv').lang, 'fi');
});

test('apiError kääntää tunnetun koodin ja fallbackaa error-tekstiin', () => {
    const fi = createI18n('fi');
    assert.strictEqual(
        fi.apiError({ error: 'Invalid game type', code: 'invalid_game_type' }, 'rk.searchFailed'),
        // Koodilla ei ole käännöstä -> raaka error-teksti
        'Invalid game type');
    assert.strictEqual(
        fi.apiError({ error: "Invalid query: 'x'", code: 'query_bad_char', params: { char: 'x' } }, 'rk.searchFailed'),
        "Merkki 'x' ei kelpaa kyselyssä.");
    assert.strictEqual(fi.apiError(null, 'rk.searchFailed'), 'Haku epäonnistui.');
    assert.strictEqual(fi.apiError({}, 'rk.searchFailed'), 'Haku epäonnistui.');
});
