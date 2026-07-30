// Siistit URLit: sivut tarjoillaan ilman .html-päätettä ja vanhat
// .html-osoitteet ohjataan pysyvästi (301) uusiin. Testaa myös ettei
// /rankings-API-reitti (JSON) törmää sivupolkuihin - englanninkielinen
// sivu on /en/rankings, mutta törmäysregressio olisi hiljainen: sivu
// alkaisi vastata JSONia tai API HTML:ää.

const test = require('node:test');
const assert = require('node:assert');
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

test('päätteettömät osoitteet tarjoilevat HTML-sivut oikein otsakkein', async () => {
    for (const p of ['/rankingit', '/menetelmat', '/en/rankings', '/en/methods']) {
        const res = await fetch(`${baseUrl}${p}`);
        assert.strictEqual(res.status, 200, `${p} palautti ${res.status}`);
        assert.ok((res.headers.get('content-type') || '').includes('text/html'),
            `content-type: ${p}`);
        assert.strictEqual(res.headers.get('cache-control'), 'no-cache', `cache: ${p}`);
        assert.ok(res.headers.get('link'), `hreflang-otsake puuttuu: ${p}`);
    }
});

test('vanhat .html-osoitteet ohjataan pysyvästi päätteettömiin', async () => {
    const cases = [
        ['/index.html', '/'],
        ['/rankingit.html', '/rankingit'],
        ['/menetelmat.html', '/menetelmat'],
        ['/en/index.html', '/en/'],
        ['/en/rankings.html', '/en/rankings'],
        ['/en/methods.html', '/en/methods']
    ];
    for (const [from, to] of cases) {
        const res = await fetch(`${baseUrl}${from}`, { redirect: 'manual' });
        assert.strictEqual(res.status, 301, `${from} palautti ${res.status}`);
        assert.strictEqual(res.headers.get('location'), to, `location: ${from}`);
    }
    // Query string säilyy ohjauksessa
    const q = await fetch(`${baseUrl}/rankingit.html?gameType=omaha`, { redirect: 'manual' });
    assert.strictEqual(q.headers.get('location'), '/rankingit?gameType=omaha');
});

test('/rankings-API vastaa edelleen JSONilla eikä sivulla', async () => {
    const res = await fetch(`${baseUrl}/rankings?gameType=holdem&players=2&limit=1`);
    assert.strictEqual(res.status, 200);
    assert.ok((res.headers.get('content-type') || '').includes('application/json'));
    const data = await res.json();
    assert.strictEqual(data.gameType, 'holdem');
    assert.ok(Array.isArray(data.hands));
});
