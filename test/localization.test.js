// Kieliversioiden testit: /en/-sivut, hreflang-otsakkeet, sitemap ja
// fi/en-sivuparien rakenteellinen yhtäpitävyys.
//
// Rakennevertailu on tuplaylläpidon turvaverkko: englanninkieliset sivut
// ovat käsin käännettyjä kopioita, ja JS etsii elementtejä id:llä ja
// name/value-attribuuteilla - jos rakenteet ajautuvat erilleen, sivu
// hajoaa hiljaa vain toisella kielellä.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const app = require('../server');

let server;
let baseUrl;

test.before(() => {
    return new Promise(resolve => {
        server = app.listen(0, () => {
            baseUrl = `http://localhost:${server.address().port}`;
            resolve();
        });
    });
});

test.after(() => {
    return new Promise(resolve => server.close(resolve));
});

// fi-tiedosto -> en-tiedosto (englanninkieliset URL-nimet /en/-polussa)
const PAGES = {
    'index.html': 'index.html',
    'rankingit.html': 'rankings.html',
    'menetelmat.html': 'methods.html'
};

function readPage(rel) {
    return fs.readFileSync(path.join(__dirname, '..', 'public', rel), 'utf8');
}

test('englanninkieliset sivut vastaavat 200 ja saavat samat otsakkeet kuin suomi', async () => {
    for (const p of ['/en/', '/en/rankings', '/en/methods']) {
        const res = await fetch(`${baseUrl}${p}`);
        assert.strictEqual(res.status, 200, `${p} palautti ${res.status}`);
        assert.ok(res.headers.get('content-security-policy'), `CSP puuttuu: ${p}`);
        assert.strictEqual(res.headers.get('cache-control'), 'no-cache', `cache: ${p}`);
        const html = await res.text();
        assert.ok(html.includes('<html lang="en">'), `lang-attribuutti: ${p}`);
    }
});

test('kieliversiosivut saavat hreflang-Link-otsakkeen pyynnön hostista', async () => {
    const cases = [
        ['/', '/', '/en/'],
        ['/rankingit', '/rankingit', '/en/rankings'],
        ['/en/rankings', '/rankingit', '/en/rankings'],
        ['/en/', '/', '/en/'],
        ['/menetelmat', '/menetelmat', '/en/methods'],
        ['/en/methods', '/menetelmat', '/en/methods']
    ];
    for (const [reqPath, fiPath, enPath] of cases) {
        const res = await fetch(`${baseUrl}${reqPath}`);
        const link = res.headers.get('link');
        assert.ok(link, `Link-otsake puuttuu: ${reqPath}`);
        assert.ok(link.includes(`<${baseUrl}${fiPath}>; rel="alternate"; hreflang="fi"`),
            `fi-vaihtoehto puuttuu (${reqPath}): ${link}`);
        assert.ok(link.includes(`<${baseUrl}${enPath}>; rel="alternate"; hreflang="en"`),
            `en-vaihtoehto puuttuu (${reqPath}): ${link}`);
        assert.ok(link.includes('hreflang="x-default"'),
            `x-default puuttuu (${reqPath})`);
    }
    // Muut resurssit eivät saa otsaketta
    const css = await fetch(`${baseUrl}/css/style.css`);
    assert.strictEqual(css.headers.get('link'), null);
});

test('sitemap sisältää molempien kielten sivut', async () => {
    const xml = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
    for (const p of ['/', '/rankingit', '/menetelmat',
        '/en/', '/en/rankings', '/en/methods']) {
        assert.ok(xml.includes(`<loc>${baseUrl}${p}</loc>`), `sitemapista puuttuu ${p}`);
    }
});

test('fi- ja en-sivuparien rakenne on yhtäpitävä (id:t, lomakkeet, skriptit)', () => {
    // Sanaraja edessä: ilman sitä 'value' osuisi myös 'data-value':en
    // ja 'max' 'aria-valuemax':iin
    const attr = (tag, name) => {
        const m = tag.match(new RegExp(`[\\s"']${name}="([^"]*)"`));
        return m ? m[1] : undefined;
    };

    for (const [page, enPage] of Object.entries(PAGES)) {
        const fi = readPage(page);
        const en = readPage(path.join('en', enPage));

        // Sama id-joukko samassa järjestyksessä
        const ids = html => [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
        assert.deepStrictEqual(ids(en), ids(fi), `${page}: id-joukot eroavat`);

        // Lomake-elementit: input-tagien type/name/value täsmäävät
        const inputs = html => [...html.matchAll(/<input\b[^>]*>/g)].map(m =>
            ['type', 'name', 'value', 'min', 'max', 'step'].map(a => attr(m[0], a)).join('|'));
        assert.deepStrictEqual(inputs(en), inputs(fi), `${page}: input-elementit eroavat`);

        // Esimerkkinapit ja muut data-attribuutit
        const dataAttrs = html => [...html.matchAll(/ (data-[a-z-]+)="([^"]*)"/g)]
            .map(m => `${m[1]}=${m[2]}`);
        assert.deepStrictEqual(dataAttrs(en), dataAttrs(fi), `${page}: data-attribuutit eroavat`);

        // Samat skriptit samassa järjestyksessä (sallii myös esim. defer-
        // attribuutin ennen src:tä, ettei tagi putoa vertailusta hiljaa)
        const scripts = html => [...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
        assert.deepStrictEqual(scripts(en), scripts(fi), `${page}: skriptilistat eroavat`);

        // Kieli ja hreflang-parin suunta
        assert.ok(fi.includes('<html lang="fi">'), `${page}: fi-sivun lang`);
        assert.ok(en.includes('<html lang="en">'), `${page}: en-sivun lang`);
        assert.ok(fi.includes('lang="en" hreflang="en"'), `${page}: fi-sivulta puuttuu kielivalitsin`);
        assert.ok(en.includes('lang="fi" hreflang="fi"'), `${page}: en-sivulta puuttuu kielivalitsin`);
    }
});
