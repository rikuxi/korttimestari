// Käänteisproxyn luottamusasetuksen testit.
//
// Asetuksella on tietoturvamerkitys (ks. trustProxy.js), joten testataan
// sekä jäsennys että se, että server.js oikeasti lukee ympäristömuuttujan.
// Ympäristömuuttuja asetetaan ennen server.js:n lataamista - node --test
// ajaa jokaisen testitiedoston omassa prosessissaan, joten tämä ei vuoda
// muihin testeihin.

process.env.TRUST_PROXY_IPS = '203.0.113.0/24, 198.51.100.7';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { CLOUDFLARE_IPS, resolveTrustProxy } = require('../trustProxy');
const app = require('../server');

test('asettamaton muuttuja antaa Cloudflaren oletusalueet', () => {
    assert.deepStrictEqual(resolveTrustProxy(undefined), CLOUDFLARE_IPS);
    assert.deepStrictEqual(resolveTrustProxy(null), CLOUDFLARE_IPS);
});

test('tyhjä tai pelkkiä tyhjämerkkejä sisältävä arvo antaa oletusalueet', () => {
    assert.deepStrictEqual(resolveTrustProxy(''), CLOUDFLARE_IPS);
    assert.deepStrictEqual(resolveTrustProxy('   \n  '), CLOUDFLARE_IPS);
});

test('pilkulla eroteltu lista jäsennetään', () => {
    assert.deepStrictEqual(
        resolveTrustProxy('10.0.0.0/8,192.168.0.1'),
        ['10.0.0.0/8', '192.168.0.1']
    );
});

test('välilyönnit ja rivinvaihdot kelpaavat erottimina', () => {
    assert.deepStrictEqual(
        resolveTrustProxy('  10.0.0.0/8 ,\n 192.168.0.1\t'),
        ['10.0.0.0/8', '192.168.0.1']
    );
});

test("'off' poistaa luottamuksen kokonaan", () => {
    assert.strictEqual(resolveTrustProxy('off'), false);
    assert.strictEqual(resolveTrustProxy('OFF'), false);
    assert.strictEqual(resolveTrustProxy('  Off  '), false);
});

test('oletuslistassa on sekä IPv4- että IPv6-alueita', () => {
    // Ilman IPv6-alueita dual-stack-originissa X-Forwarded-For jäisi
    // huomiotta ja rate limitit laskettaisiin edge-nodea kohti
    assert.ok(CLOUDFLARE_IPS.some(range => range.includes(':')), 'IPv6-alueita ei ole');
    assert.ok(CLOUDFLARE_IPS.some(range => !range.includes(':')), 'IPv4-alueita ei ole');
});

test('Express hyväksyy jokaisen oletusalueen', () => {
    // Vartioi kirjoitusvirheitä listassa: proxy-addr hylkää kelvottoman
    // CIDR-alueen heti, joten rikkinäinen lista näkyy tässä eikä vasta
    // tuotannossa
    for (const range of CLOUDFLARE_IPS) {
        assert.doesNotThrow(
            () => express().set('trust proxy', [range]),
            `kelvoton alue: ${range}`
        );
    }
});

test('kelvoton arvo hylätään Expressissä eikä vaienneta oletuksiin', () => {
    assert.throws(() => express().set('trust proxy', resolveTrustProxy('ei-ole-ip')));
});

test('server.js lukee luotetut proxyt ympäristömuuttujasta', () => {
    assert.deepStrictEqual(app.get('trust proxy'), ['203.0.113.0/24', '198.51.100.7']);
});
