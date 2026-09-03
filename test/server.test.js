// API-integraatiotestit: app käynnistetään satunnaiseen porttiin ilman
// erillistä prosessia (server.js exporttaa appin).
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server');
const preflopTables = require('../preflopTables');
const rangeHandsCache = require('../rangeHandsCache');
const PokerEngine = require('../public/js/engine');

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

function post(body, raw = false) {
    return fetch(`${baseUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw ? body : JSON.stringify(body)
    });
}

const validBody = (extra = {}) => ({
    simulationCount: 500,
    gameType: 'holdem',
    randomOpponents: false,
    playerHandsData: [
        { hand: ['As', 'Ks'], isFolded: false },
        { hand: ['2d', '7c'], isFolded: false }
    ],
    communityCards: {},
    ...extra
});

test('validi holdem-simulaatio palauttaa 200 ja oikean muotoisen tuloksen', async () => {
    const res = await post(validBody());
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.results.winPercentages));
    assert.strictEqual(data.results.winPercentages.length, 2);
    assert.strictEqual(data.results.simulationCount, 500);
    assert.ok(data.results.heroHandStats);
});

test('validi omahahilo-simulaatio palauttaa 200 ja hi/lo-erittelyn', async () => {
    const res = await post(validBody({
        gameType: 'omahahilo',
        playerHandsData: [
            { hand: ['As', '2s', '3h', '4h'], isFolded: false },
            { hand: ['Ks', 'Kh', 'Qs', 'Jh'], isFolded: false }
        ]
    }));
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.results.equityPercentages.length, 2);
    assert.ok(Array.isArray(data.results.hiEquityPercentages));
    assert.ok(Array.isArray(data.results.loEquityPercentages));
    assert.ok(data.results.hiLoStats);
    // Erittely summautuu kokonaisequityyn
    for (let i = 0; i < 2; i++) {
        const sum = data.results.hiEquityPercentages[i] + data.results.loEquityPercentages[i];
        assert.ok(Math.abs(sum - data.results.equityPercentages[i]) < 1e-9);
    }
    // Puoliskojen voitto- ja tasapelitaajuudet: käyttöliittymän "Voitto
    // hi/lo"- ja "Tasan hi/lo" -rivit lukevat nämä; jos ne putoaisivat
    // JSONista, rivit jäisivät viivaksi ilman virhettä
    for (const k of ['hiWinPercentages', 'hiTiePercentages', 'loWinPercentages', 'loTiePercentages']) {
        const arr = data.results[k];
        assert.ok(Array.isArray(arr) && arr.length === 2, `${k} puuttuu`);
        assert.ok(arr.every(v => typeof v === 'number' && v >= 0 && v <= 100), `${k}: ${arr}`);
    }
    // A234 voittaa low'n usein, KKQJ ei koskaan (ei low-kortteja)
    assert.ok(data.results.loWinPercentages[0] > 0);
    assert.strictEqual(data.results.loWinPercentages[1], 0);
});

test('/rankings ja /rankings/hand palauttavat Hi/Lo-kentät, jotka rankingsivu lukee', async () => {
    // rankings.js lukee taulukkoon hiEquity/loEquity ja detaljipaneeliin
    // hiWin/hiTie/loWin/loTie, scoop/partPot/quarter/scoopedOn sekä
    // eksaktilta riviltä lowMade/nutLow (toLocaleString kaatuisi
    // undefined-arvoon). Datatiedostot 2-6 max ovat olemassa.
    const list = await fetch(`${baseUrl}/rankings?gameType=omahahilo&players=2`);
    if (list.status === 404) return;   // taulukkoa ei ole tässä ympäristössä
    assert.strictEqual(list.status, 200);
    const data = await list.json();
    assert.strictEqual(data.exact, true);
    const top = data.hands[0];
    assert.strictEqual(top.rank, 1);
    for (const k of ['equity', 'hiEquity', 'loEquity', 'hiWin', 'hiTie', 'loWin', 'loTie', 'topPct']) {
        assert.strictEqual(typeof top[k], 'number', `/rankings: ${k} puuttuu`);
    }
    assert.ok(Math.abs(top.hiEquity + top.loEquity - top.equity) < 1e-6);

    const detail = await (await fetch(`${baseUrl}/rankings/hand?gameType=omahahilo&key=${top.key}`)).json();
    assert.ok(detail.byPlayers.length >= 2);
    const exactRow = detail.byPlayers.find(r => r.exact);
    assert.ok(exactRow, 'eksakti heads-up-rivi puuttuu');
    for (const row of detail.byPlayers) {
        for (const k of ['hiEquity', 'loEquity', 'hiWin', 'hiTie', 'loWin', 'loTie', 'scoop', 'partPot', 'quarter', 'scoopedOn']) {
            assert.strictEqual(typeof row[k], 'number', `/rankings/hand ${row.players} pelaajaa: ${k} puuttuu`);
        }
        // Potinosuuden jakauma on täydellinen: scoop + osapotti + ei mitään = 100
        assert.ok(Math.abs(row.scoop + row.partPot + row.scoopedOn - 100) < 0.01,
            `${row.players} pelaajaa: osuudet ${row.scoop} + ${row.partPot} + ${row.scoopedOn}`);
    }
    for (const k of ['lowMade', 'nutLow']) {
        assert.strictEqual(typeof exactRow[k], 'number', `eksakti rivi: ${k} puuttuu`);
    }
    // Väärän muotoinen avain (Hold'em-avain Hi/Lo-taulukkoon) hylätään
    const bad = await fetch(`${baseUrl}/rankings/hand?gameType=omahahilo&key=AA`);
    assert.strictEqual(bad.status, 400);
});

test('Omaha-perheen käsialue: keys=1 antaa avaimet, /simulate laajentaa ne palvelimella', async () => {
    // Käyttöliittymä hakee Omaha-perheen avaimet keys=1-reitiltä (Hold'em
    // lasketaan selaimessa), joten palvelinpuolen Omaha-laajennus on
    // testattava tällä polulla
    for (const gameType of ['omaha', 'omaha5', 'omahahilo']) {
        const r = await fetch(`${baseUrl}/rankings/range?gameType=${gameType}&players=2&pct=5&keys=1`);
        if (r.status === 404) continue;   // taulukkoa ei ole tässä ympäristössä
        const range = await r.json();
        assert.strictEqual(range.keys.length, range.classes, gameType);
        const cardsPerKey = gameType === 'omaha5' ? 5 : 4;
        const pattern = new RegExp(`^([2-9TJQKA][shdc]){${cardsPerKey}}$`);
        assert.ok(range.keys.every(k => pattern.test(k)), `${gameType}: avaimet väärässä muodossa`);

        // Roskakäsi heads-up: mitatusti 32-37 % top 5 %:a vastaan ja
        // 38-45 % kaikkia vastaan (ero 5-9 %-yks., keskivirhe ~0,5)
        const hero = gameType === 'omaha5' ? ['7h', '2d', '9c', '4s', 'Jd'] : ['7h', '2d', '9c', '4s'];
        const body = pct => ({
            simulationCount: 10000, gameType, randomOpponents: true,
            playerHandsData: [
                { hand: hero, isFolded: false },
                { hand: [], isFolded: false, rangePct: pct }
            ],
            communityCards: { flop: [], turn: null, river: null }
        });
        const tight = await post(body(5));
        assert.strictEqual(tight.status, 200, `${gameType}: ${tight.status}`);
        const tightEq = (await tight.json()).results.equityPercentages[0];
        const looseEq = (await (await post(body(100))).json()).results.equityPercentages[0];
        assert.ok(tightEq < looseEq - 3, `${gameType}: top 5 % ${tightEq} vs. kaikki ${looseEq}`);
    }
});

test('/simulate: laajennettu alue jää välimuistiin ja toinen pyyntö käyttää sitä', async () => {
    // Ensimmäinen pyyntö: worker laajentaa avaimet SharedArrayBufferiin ja
    // palauttaa sen pääprosessin välimuistiin; toinen pyyntö saa saman
    // puskurin ilman laajennusta ja antaa saman muotoisen tuloksen
    rangeHandsCache.clear();
    const body = {
        simulationCount: 2000, gameType: 'omaha', randomOpponents: true,
        playerHandsData: [
            { hand: ['7h', '2d', '9c', '4s'], isFolded: false },
            { hand: [], isFolded: false, rangePct: 10 }
        ],
        communityCards: { flop: [], turn: null, river: null }
    };
    const first = await post(body);
    assert.strictEqual(first.status, 200);
    const firstJson = await first.json();
    assert.strictEqual(firstJson.rangeHands, undefined, 'puskurit eivät kuulu vastaukseen');
    const id = 'omaha:2:10';
    assert.ok(rangeHandsCache.has(id), 'alue ei jäänyt välimuistiin');
    const buffer = rangeHandsCache.get(id);
    assert.ok(buffer instanceof SharedArrayBuffer);
    // Puskurin sisältö on täsmälleen avainten laajennus
    const keys = preflopTables.rangeKeys('omaha', 2, 10).keys;
    const expanded = PokerEngine.expandRangeKeys(keys, 4);
    assert.deepStrictEqual(Array.from(new Int32Array(buffer)), Array.from(expanded));

    const second = await post(body);
    assert.strictEqual(second.status, 200);
    const secondJson = await second.json();
    assert.strictEqual(secondJson.results.equityPercentages.length, 2);
    assert.strictEqual(rangeHandsCache.size(), 1, 'sama alue ei saa tulla toiseen kertaan');
    // Molemmat ajot vastaavat samaa asetelmaa: roskakäsi top 10 %:a vastaan
    for (const r of [firstJson, secondJson]) {
        assert.ok(r.results.equityPercentages[0] > 15 && r.results.equityPercentages[0] < 45,
            `equity ${r.results.equityPercentages[0]}`);
    }
});

test('/simulate: rangePct ohitetaan herolla ja kun vastustajat ovat valittuja', async () => {
    // Hero (i = 0): kenttä validoidaan mutta ei rajaa mitään
    const heroPct = {
        simulationCount: 500, gameType: 'holdem', randomOpponents: true,
        playerHandsData: [
            { hand: ['As', 'Ks'], isFolded: false, rangePct: 5 },
            { hand: [], isFolded: false }
        ],
        communityCards: { flop: [], turn: null, river: null }
    };
    let res = await post(heroPct);
    assert.strictEqual(res.status, 200);
    heroPct.playerHandsData[0].rangePct = 150;
    res = await post(heroPct);
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).code, 'invalid_range_pct');

    // Valitut vastustajat: kädet ovat kiinteät, rangePct ei muuta tulosta
    const fixed = validBody({ playerHandsData: [
        { hand: ['As', 'Ks'], isFolded: false },
        { hand: ['2d', '7c'], isFolded: false, rangePct: 1 }
    ] });
    res = await post(fixed);
    assert.strictEqual(res.status, 200);
    const eq = (await res.json()).results.equityPercentages;
    assert.strictEqual(eq.length, 2);
    assert.ok(eq[0] > 55 && eq[0] < 75, `AKs vs. 72o: ${eq[0]}`);
});

test('/preflop palauttaa Hi/Lo:n puoliskoerittelyn ja taajuudet', async () => {
    const res = await fetch(`${baseUrl}/preflop?gameType=omahahilo&players=2&hand=As,3s,Ah,2h`);
    if (res.status === 404) return;   // taulukkoa ei ole tässä ympäristössä
    assert.strictEqual(res.status, 200);
    const d = await res.json();
    assert.strictEqual(d.exact, true);
    // Osuudet summautuvat equityyn
    assert.ok(Math.abs(d.hiEquity + d.loEquity - d.equity) < 1e-6);
    // Taajuudet ovat eri suure kuin osuudet eivätkä ylitä sataa
    for (const k of ['hiWin', 'hiTie', 'loWin', 'loTie']) {
        assert.ok(typeof d[k] === 'number' && d[k] >= 0 && d[k] <= 100, `${k}: ${d[k]}`);
    }
    // A2-kädellä low syntyy usein, joten low voitetaan toisinaan
    assert.ok(d.loWin > 0);
});

test('tuplakortti hylätään (400)', async () => {
    const res = await post(validBody({
        playerHandsData: [
            { hand: ['As', 'As'], isFolded: false },
            { hand: ['2d', '7c'], isFolded: false }
        ]
    }));
    assert.strictEqual(res.status, 400);
});

test('virheellinen korttiformaatti hylätään (400)', async () => {
    const res = await post(validBody({
        playerHandsData: [
            { hand: ['XX', 'Ks'], isFolded: false },
            { hand: ['2d', '7c'], isFolded: false }
        ]
    }));
    assert.strictEqual(res.status, 400);
});

test('virheellinen pelityyppi hylätään (400)', async () => {
    const res = await post(validBody({ gameType: 'razz' }));
    assert.strictEqual(res.status, 400);
});

test('liian suuri simulaatiomäärä hylätään (400)', async () => {
    const res = await post(validBody({ simulationCount: 1000000 }));
    assert.strictEqual(res.status, 400);
});

test('foldatun pelaajan kortit validoidaan (duplikaatti ja formaatti -> 400)', async () => {
    // Foldatun kortit ovat kuolleita kortteja ja vaikuttavat tulokseen -
    // ennen ne ohitettiin validoinnissa ja worker kaatui 500:aan
    const dup = await post(validBody({
        playerHandsData: [
            { hand: ['As', 'Ks'], isFolded: false },
            { hand: ['2d', '7c'], isFolded: false },
            { hand: ['As', 'Qh'], isFolded: true }
        ]
    }));
    assert.strictEqual(dup.status, 400);

    const badFormat = await post(validBody({
        playerHandsData: [
            { hand: ['As', 'Ks'], isFolded: false },
            { hand: ['2d', '7c'], isFolded: false },
            { hand: ['XX', 'Qh'], isFolded: true }
        ]
    }));
    assert.strictEqual(badFormat.status, 400);
});

test('liian vähän aktiivisia pelaajia hylätään (400, ei worker-kaatumista)', async () => {
    const oneActive = await post(validBody({
        playerHandsData: [
            { hand: ['As', 'Ks'], isFolded: false },
            { hand: ['2d', '7c'], isFolded: true }
        ]
    }));
    assert.strictEqual(oneActive.status, 400);

    const foldedHero = await post(validBody({
        randomOpponents: true,
        playerHandsData: [
            { hand: ['As', 'Ks'], isFolded: true },
            {}
        ]
    }));
    assert.strictEqual(foldedHero.status, 400);
});

test('omaha5 sallii enintään 9 pelaajaa (400 kymmenellä)', async () => {
    const opp = { hand: ['', '', '', '', ''], isFolded: false };
    const res = await post(validBody({
        gameType: 'omaha5',
        randomOpponents: true,
        playerHandsData: [
            { hand: ['As', 'Ks', 'Qd', 'Jc', 'Th'], isFolded: false },
            opp, opp, opp, opp, opp, opp, opp, opp, opp
        ]
    }));
    assert.strictEqual(res.status, 400);
});

test('tyhjillä täytetty heron käsi toimii satunnaisia vastustajia vastaan', async () => {
    const res = await post(validBody({
        randomOpponents: true,
        playerHandsData: [
            { hand: ['As', 'Ks', '', ''], isFolded: false },
            {}, {}
        ]
    }));
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    // AKs kolmen pelaajan pöydässä ~48 % - varmistaa ettei tyhjiä kortteja evaluoitu
    assert.ok(data.results.winPercentages[0] > 35 && data.results.winPercentages[0] < 60);
});

test('rikkinäinen JSON palauttaa 400', async () => {
    const res = await post('{invalid', true);
    assert.strictEqual(res.status, 400);
});

test('ylisuuri runko palauttaa 413', async () => {
    const res = await post(validBody({ junk: 'x'.repeat(20000) }));
    assert.strictEqual(res.status, 413);
});

test('tuntematon reitti palauttaa 404 ja turvaotsakkeet', async () => {
    const res = await fetch(`${baseUrl}/nonexistent`);
    assert.strictEqual(res.status, 404);
    assert.ok(res.headers.get('content-security-policy'), 'CSP puuttuu');
    assert.strictEqual(res.headers.get('x-powered-by'), null, 'X-Powered-By vuotaa');
});

test('staattinen etusivu saa turvaotsakkeet', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-security-policy'), 'CSP puuttuu staattiselta sivulta');
    assert.ok(res.headers.get('x-frame-options'), 'X-Frame-Options puuttuu');
});

test('jaettu potti jaetaan voittajien määrällä (palvelinpolku)', async () => {
    // Valmis värisuora pöydässä: kaikki kolme pelaajaa jakavat potin joka jaossa
    const res = await post(validBody({
        simulationCount: 200,
        playerHandsData: [
            { hand: ['2h', '3h'], isFolded: false },
            { hand: ['4d', '5d'], isFolded: false },
            { hand: ['7c', '8c'], isFolded: false }
        ],
        communityCards: { flop: ['As', 'Ks', 'Qs'], turn: 'Js', river: 'Ts' }
    }));
    assert.strictEqual(res.status, 200);
    const { results } = await res.json();

    for (let i = 0; i < 3; i++) {
        assert.strictEqual(results.tiePercentages[i], 100);
        assert.ok(Math.abs(results.equityPercentages[i] - 100 / 3) < 1e-9,
            `pelaajan ${i} equity ${results.equityPercentages[i]}`);
    }
    const sum = results.equityPercentages.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 1e-9, `equityjen summa ${sum}`);
});

test('foldanneen pelaajan kortit ovat kuolleita satunnaisvastustajatilassa', async () => {
    // Hero AsAh, yksi pelissä oleva satunnainen vastustaja ja yksi foldannut
    // jolla AdAc. Kun kaksi muuta ässää on poissa pakasta, hero ei voi tehdä
    // ässänelosia - vain pöydän omat neloset ovat mahdollisia (~0,024 %).
    const res = await post(validBody({
        simulationCount: 20000,
        randomOpponents: true,
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['', ''], isFolded: false },
            { hand: ['Ad', 'Ac'], isFolded: true }
        ],
        communityCards: {}
    }));
    assert.strictEqual(res.status, 200);
    const { results } = await res.json();
    const quads = results.heroHandStats['four of a kind'] || 0;
    assert.ok(quads < 50, `nelosia ${quads}, odotettu alle 50`);
});

test('kaikkien vastustajien foldatessa hero saa potin', async () => {
    const res = await post(validBody({
        simulationCount: 500,
        randomOpponents: true,
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: ['', ''], isFolded: true }
        ],
        communityCards: {}
    }));
    assert.strictEqual(res.status, 200);
    const { results } = await res.json();
    assert.strictEqual(results.winPercentages[0], 100);
    assert.strictEqual(results.equityPercentages[0], 100);
});

test('/preflop palauttaa eksaktin arvon Omahan heads-upiin', async () => {
    const res = await fetch(`${baseUrl}/preflop?gameType=omaha&players=2&hand=Ad,Ac,Kd,Kc`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.exact, true);
    assert.strictEqual(data.standardError, 0);
    assert.ok(Math.abs(data.equity - 70.678075) < 1e-6, `saatiin ${data.equity}`);
    assert.strictEqual(data.rank, 6);
    assert.strictEqual(data.handClasses, 16432);
    // Eksaktissa taulukossa sija on naulattu: alue on [rank, rank]
    assert.strictEqual(data.rankLow, 6);
    assert.strictEqual(data.rankHigh, 6);
    // Kombopainotettu top-%: sama luku kuin /rankings-rivillä (0 < top < 1 %)
    assert.ok(data.topPct > 0 && data.topPct < 1, `topPct ${data.topPct}`);
});

test('/preflop kertoo sija-alueen kun keskivirhe ei naulaa sijaa', async () => {
    // Omaha5:n keskivaiheilla todellinen sija voi olla ±sadat sijat -
    // rankLow/rankHigh kertovat sen rehellisesti
    const res = await fetch(`${baseUrl}/preflop?gameType=omaha5&players=6&hand=Kd,Jc,Th,5s,4s`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Number.isInteger(data.rankLow) && Number.isInteger(data.rankHigh),
        'sija-alue puuttuu');
    assert.ok(data.rankLow <= data.rank && data.rank <= data.rankHigh,
        `alue [${data.rankLow}, ${data.rankHigh}] ei sisällä sijaa ${data.rank}`);
    assert.ok(data.rankHigh - data.rankLow > 50,
        `keskilistan alueen pitäisi olla leveä, oli ${data.rankHigh - data.rankLow}`);
});

test('/preflop: korttien järjestys ei vaikuta tulokseen', async () => {
    const a = await (await fetch(`${baseUrl}/preflop?gameType=omaha&players=2&hand=Ad,Ac,Td,Tc`)).json();
    const b = await (await fetch(`${baseUrl}/preflop?gameType=omaha&players=2&hand=Tc,Ad,Td,Ac`)).json();
    assert.strictEqual(a.equity, b.equity);
    assert.strictEqual(a.rank, 1, 'AATT (ds) on Omahan paras käsi heads-upina');
});

test('/preflop hylkää kelvottomat syötteet', async () => {
    const cases = [
        'gameType=omaha5&players=2&hand=Ad,Ac,Kd,Kc',   // ei taulukkoa
        'gameType=omaha&players=1&hand=Ad,Ac,Kd,Kc',    // liian vähän pelaajia
        'gameType=omaha&players=2&hand=Ad,Ac,Kd',       // väärä korttimäärä
        'gameType=omaha&players=2&hand=Ad,Ac,Kd,Xx',    // kelvoton kortti
        'gameType=omaha&players=2&hand=Ad,Ad,Kd,Kc',    // kaksoiskappale
        'gameType=holdem&players=2'                      // käsi puuttuu
    ];
    for (const q of cases) {
        const res = await fetch(`${baseUrl}/preflop?${q}`);
        assert.ok(res.status === 400 || res.status === 404, `${q} palautti ${res.status}`);
    }
});

test('/preflop palauttaa 404 kokoonpanolle jolle ei ole taulukkoa', async () => {
    // Omahaa ei pelata kymmenen pelaajan pöydässä, joten taulukkoa ei ole
    const res = await fetch(`${baseUrl}/preflop?gameType=omaha&players=10&hand=Ad,Ac,Kd,Kc`);
    assert.strictEqual(res.status, 404);
});

test('/preflop/available kertoo mitä taulukoita on', async () => {
    const res = await fetch(`${baseUrl}/preflop/available`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    // Kaikki pelaajamäärät on laskettu joka pelimuodolle
    assert.deepStrictEqual(data.omaha, [2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepStrictEqual(data.holdem, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepStrictEqual(data.omaha5, [2, 3, 4, 5, 6, 7, 8, 9]);
});

test('/rankings selaa taulukkoa sijajärjestyksessä sivutettuna', async () => {
    const res = await fetch(`${baseUrl}/rankings?gameType=holdem&players=2`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.total, 169);
    assert.strictEqual(data.exact, true);
    assert.strictEqual(data.hands.length, 100);
    assert.strictEqual(data.hands[0].key, 'AA');
    assert.strictEqual(data.hands[0].rank, 1);

    const page2 = await (await fetch(`${baseUrl}/rankings?gameType=holdem&players=2&offset=100`)).json();
    assert.strictEqual(page2.hands.length, 69);
    assert.strictEqual(page2.hands[0].rank, 101);
});

test('/rankings hakee osittaiskädellä', async () => {
    // Hold'em: AK = molemmat luokat sijajärjestyksessä, AKs = vain suited
    const ak = await (await fetch(`${baseUrl}/rankings?gameType=holdem&players=2&q=AK`)).json();
    assert.strictEqual(ak.total, 2);
    assert.deepStrictEqual(ak.hands.map(h => h.key), ['AKs', 'AKo']);
    const aks = await (await fetch(`${baseUrl}/rankings?gameType=holdem&players=2&q=AKs`)).json();
    assert.strictEqual(aks.total, 1);
    assert.strictEqual(aks.hands[0].key, 'AKs');

    // Omaha: (AK)(AK) määrää kaikki neljä korttia -> täsmälleen AAKK ds
    const ds = await (await fetch(`${baseUrl}/rankings?gameType=omaha&players=2&q=${encodeURIComponent('(AK)(AK)')}`)).json();
    assert.strictEqual(ds.total, 1);
    assert.strictEqual(ds.hands[0].rank, 6);
    assert.ok(Math.abs(ds.hands[0].equity - 70.678075) < 1e-6);

    // Omaha5: sulkuryhmitelty koko käsi -> yksikäsitteinen kärki
    const top = await (await fetch(`${baseUrl}/rankings?gameType=omaha5&players=6&q=${encodeURIComponent('(AJ)(AJ)(T)')}`)).json();
    assert.strictEqual(top.total, 1);
    assert.strictEqual(top.hands[0].rank, 1);
    assert.ok(top.hands[0].rankLow <= 1 && top.hands[0].rankHigh >= 1);

    // Kelvoton kysely
    const bad = await fetch(`${baseUrl}/rankings?gameType=omaha&players=2&q=XYZ`);
    assert.strictEqual(bad.status, 400);
    const badLimit = await fetch(`${baseUrl}/rankings?gameType=holdem&players=2&limit=9999`);
    assert.strictEqual(badLimit.status, 400);
});

test('virhevastauksissa on koneluettava code-kenttä UI-käännöstä varten', async () => {
    const game = await (await fetch(`${baseUrl}/rankings?gameType=razz&players=2`)).json();
    assert.strictEqual(game.code, 'invalid_game_type');

    // Kyselyvirheet kertovat koodin ja parametrit (esim. viallinen merkki)
    const badChar = await (await fetch(`${baseUrl}/rankings?gameType=omaha&players=2&q=XYZ`)).json();
    assert.strictEqual(badChar.code, 'query_bad_char');
    assert.deepStrictEqual(badChar.params, { char: 'X' });

    const tooMany = await (await fetch(`${baseUrl}/rankings?gameType=holdem&players=2&q=AKQ`)).json();
    assert.strictEqual(tooMany.code, 'query_too_many_cards');
    assert.deepStrictEqual(tooMany.params, { max: 2 });

    const noTable = await (await fetch(`${baseUrl}/rankings?gameType=omaha&players=10`)).json();
    assert.strictEqual(noTable.code, 'no_table');

    const badPct = await (await fetch(`${baseUrl}/rankings/range?gameType=holdem&players=2&pct=0`)).json();
    assert.strictEqual(badPct.code, 'invalid_pct');
});

test('/rankings kertoo kombopainotetun top-prosentin', async () => {
    const data = await (await fetch(`${baseUrl}/rankings?gameType=holdem&players=2&limit=500`)).json();
    assert.strictEqual(data.hands.length, 169);
    // AA = 6 komboa 1326:sta
    assert.ok(Math.abs(data.hands[0].topPct - 100 * 6 / 1326) < 1e-9,
        `AA topPct ${data.hands[0].topPct}`);
    // topPct kasvaa monotonisesti ja päätyy tasan sataan
    for (let i = 1; i < data.hands.length; i++) {
        assert.ok(data.hands[i].topPct > data.hands[i - 1].topPct);
    }
    assert.ok(Math.abs(data.hands[168].topPct - 100) < 1e-9);
});

test('/rankings/range kertoo top-X %:n alueen tunnusluvut', async () => {
    // pct=100 kattaa koko taulukon
    const all = await (await fetch(`${baseUrl}/rankings/range?gameType=holdem&players=2&pct=100`)).json();
    assert.strictEqual(all.classes, 169);
    assert.strictEqual(all.combos, 1326);
    assert.strictEqual(all.totalCombos, 1326);
    assert.strictEqual(all.firstExcluded, null);

    // Pieni alue: AA (0,45 %) mahtuu yhden prosentin alueeseen, ja rajat
    // ovat sijajärjestyksessä peräkkäiset
    const top1 = await (await fetch(`${baseUrl}/rankings/range?gameType=holdem&players=2&pct=1`)).json();
    assert.ok(top1.classes >= 1 && top1.classes < 10, `classes ${top1.classes}`);
    assert.strictEqual(top1.lastIncluded.rank, top1.classes);
    assert.strictEqual(top1.firstExcluded.rank, top1.classes + 1);
    assert.ok(top1.lastIncluded.topPct <= 1 + 1e-9);
    assert.ok(top1.firstExcluded.topPct > 1);
    assert.strictEqual(top1.equityCutoff, top1.lastIncluded.equity);

    // Toimii myös Omahalle (paneelin datalähde)
    const omaha = await (await fetch(`${baseUrl}/rankings/range?gameType=omaha&players=2&pct=10`)).json();
    assert.strictEqual(omaha.handClasses, 16432);
    assert.strictEqual(omaha.totalCombos, 270725);
    assert.ok(Math.abs(omaha.combos / omaha.totalCombos - 0.1) < 0.001,
        `komboja ${omaha.combos}`);
    assert.ok(omaha.equityCutoff > 0);

    // Kelvottomat prosentit hylätään
    for (const pct of ['0', '-5', '101', 'abc']) {
        const res = await fetch(`${baseUrl}/rankings/range?gameType=holdem&players=2&pct=${pct}`);
        assert.strictEqual(res.status, 400, `pct=${pct}`);
    }
    assert.strictEqual(
        (await fetch(`${baseUrl}/rankings/range?gameType=omaha&players=10&pct=10`)).status, 404);
});

test('/rankings/range?keys=1 palauttaa alueen luokka-avaimet', async () => {
    const r = await (await fetch(`${baseUrl}/rankings/range?gameType=holdem&players=6&pct=10&keys=1`)).json();
    assert.ok(Array.isArray(r.keys));
    assert.strictEqual(r.keys.length, r.classes);
    assert.strictEqual(r.keys[0], 'AA');
    assert.strictEqual(r.keys[r.keys.length - 1], r.lastIncluded.key);
    // Ilman keys=1 avaimia ei lähetetä
    const plain = await (await fetch(`${baseUrl}/rankings/range?gameType=holdem&players=6&pct=10`)).json();
    assert.strictEqual(plain.keys, undefined);
});

test('/simulate: rangePct rajaa vastustajan kädet top-X %:iin', async () => {
    // Hero 72o vs. top 5 %: häviää lähes aina. Vs. kaikki kädet noin 35 %.
    const body = pct => ({
        simulationCount: 20000, gameType: 'holdem', randomOpponents: true,
        playerHandsData: [
            { hand: ['7h', '2d'], isFolded: false },
            { hand: [], isFolded: false, rangePct: pct }
        ],
        communityCards: { flop: [], turn: null, river: null }
    });
    const tight = await (await post(body(5))).json();
    const loose = await (await post(body(100))).json();
    assert.ok(tight.results.equityPercentages[0] < 20, `tight ${tight.results.equityPercentages[0]}`);
    assert.ok(loose.results.equityPercentages[0] > 30, `loose ${loose.results.equityPercentages[0]}`);
});

test('/simulate: rangePct validoidaan ja taulukoton kokoonpano antaa 404', async () => {
    const base = {
        simulationCount: 500, gameType: 'holdem', randomOpponents: true,
        playerHandsData: [{ hand: ['7h', '2d'], isFolded: false }, { hand: [], isFolded: false, rangePct: 150 }],
        communityCards: { flop: [], turn: null, river: null }
    };
    let res = await post(base);
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).code, 'invalid_range_pct');

    base.playerHandsData[1].rangePct = 'abc';
    res = await post(base);
    assert.strictEqual(res.status, 400);

    // Hi/Lo-taulukkoa ei (vielä) ole 9 pelaajalle. Taulukko otetaan
    // käyttöön pelkällä datatiedostolla, joten testi ei kiinnitä sen
    // puuttumista: 404 vain jos tiedostoa ei ole, muuten 200.
    const hilo = {
        simulationCount: 500, gameType: 'omahahilo', randomOpponents: true,
        playerHandsData: [{ hand: ['Ah', '2h', '3d', 'Kc'], isFolded: false }].concat(
            Array.from({ length: 8 }, () => ({ hand: [], isFolded: false, rangePct: 20 }))),
        communityCards: { flop: [], turn: null, river: null }
    };
    res = await post(hilo);
    if (preflopTables.loadTable('omahahilo', 9)) {
        assert.strictEqual(res.status, 200);
    } else {
        assert.strictEqual(res.status, 404);
        assert.strictEqual((await res.json()).code, 'no_table');
    }
});

test('/simulate: keskenään mahdottomat alueet antavat 400 range_conflict', async () => {
    // Top 0,5 % kuudella = pelkkä AA (6 komboa); kolme pelaajaa ei mahdu
    const body = {
        simulationCount: 500, gameType: 'holdem', randomOpponents: true,
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: [], isFolded: false, rangePct: 0.5 },
            { hand: [], isFolded: false, rangePct: 0.5 }
        ],
        communityCards: { flop: [], turn: null, river: null }
    };
    const res = await post(body);
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).code, 'range_conflict');
});

test('/simulate: tyhjä alue antaa 400 range_empty molemmilla poluilla', async () => {
    // 1) Prosenttiin ei osu yhtään kättä: Hold'emin paras käsi AA on
    //    top 0,45 %, joten 0,1 % on tyhjä jo taulukkoviipaleessa
    const noHands = {
        simulationCount: 500, gameType: 'holdem', randomOpponents: true,
        playerHandsData: [
            { hand: ['7h', '2d'], isFolded: false },
            { hand: [], isFolded: false, rangePct: 0.1 }
        ],
        communityCards: { flop: [], turn: null, river: null }
    };
    let res = await post(noHands);
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).code, 'range_empty');

    // 2) Alue on olemassa (top 0,5 % = AA), mutta hero ja pöytä vievät
    //    kaikki ässät: moottori heittää range_empty-koodin workerissa
    const boardEats = {
        simulationCount: 500, gameType: 'holdem', randomOpponents: true,
        playerHandsData: [
            { hand: ['As', 'Ah'], isFolded: false },
            { hand: [], isFolded: false, rangePct: 0.5 }
        ],
        communityCards: { flop: ['Ad', 'Ac', '7h'], turn: null, river: null }
    };
    res = await post(boardEats);
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).code, 'range_empty');
});

test('/rankings/hand kertoo käden kaikilla pelaajamäärillä', async () => {
    // Hold'em AA: rivi jokaiselta pelaajamäärältä, equity laskee monotonisesti
    const aa = await (await fetch(`${baseUrl}/rankings/hand?gameType=holdem&key=AA`)).json();
    assert.strictEqual(aa.byPlayers.length, 9);
    assert.strictEqual(aa.byPlayers[0].players, 2);
    assert.strictEqual(aa.byPlayers[0].exact, true);
    for (let i = 1; i < aa.byPlayers.length; i++) {
        assert.ok(aa.byPlayers[i].equity < aa.byPlayers[i - 1].equity,
            `equity ei laske ${aa.byPlayers[i].players} pelaajalla`);
    }
    // AA on ykkönen kaikilla pelaajamäärillä
    assert.ok(aa.byPlayers.every(r => r.rank === 1));

    // Omaha AATT ds: ykkönen 2-3 pelaajalla, putoaa neljästä alkaen
    const aatt = await (await fetch(`${baseUrl}/rankings/hand?gameType=omaha&key=AdAcTdTc`)).json();
    assert.strictEqual(aatt.label, 'AATT (ds)');
    const byP = new Map(aatt.byPlayers.map(r => [r.players, r]));
    assert.strictEqual(byP.get(2).rank, 1);
    assert.strictEqual(byP.get(3).rank, 1);
    assert.ok(byP.get(4).rank > 1, `4-max sija ${byP.get(4).rank}`);

    // Kelvoton avain ja tuntematon käsi
    assert.strictEqual((await fetch(`${baseUrl}/rankings/hand?gameType=omaha&key=notakey`)).status, 400);
    assert.strictEqual((await fetch(`${baseUrl}/rankings/hand?gameType=omaha&key=AdAdAdAd`)).status, 404);
});

test('/rankings/csv lataa taulukon liitetiedostona', async () => {
    const res = await fetch(`${baseUrl}/rankings/csv?gameType=holdem&players=2`);
    assert.strictEqual(res.status, 200);
    assert.ok((res.headers.get('content-type') || '').includes('text/csv'));
    assert.ok((res.headers.get('content-disposition') || '').includes('attachment'));
    // Isot, harvoin muuttuvat tiedostot: CDN:n on saatava palvella ne
    // reunalta, muuten 30 latausta / 15 min / IP on ~315 MB origin-kaistaa
    assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=86400');
    const body = await res.text();
    assert.ok(body.startsWith('rank,hand,'), 'CSV-otsake puuttuu');
    assert.strictEqual(body.trim().split('\n').length, 170);
});

test('staattisten tiedostojen välimuistiotsakkeet: HTML revalidoidaan, muut tunnin', async () => {
    const html = await fetch(`${baseUrl}/`);
    assert.strictEqual(html.headers.get('cache-control'), 'no-cache');
    const css = await fetch(`${baseUrl}/css/style.css`);
    assert.strictEqual(css.headers.get('cache-control'), 'public, max-age=3600');
});

test('robots.txt ja sitemap.xml rakentuvat pyynnön hostista', async () => {
    const robots = await fetch(`${baseUrl}/robots.txt`);
    assert.strictEqual(robots.status, 200);
    assert.ok((robots.headers.get('content-type') || '').includes('text/plain'));
    const robotsText = await robots.text();
    assert.ok(robotsText.includes('Allow: /'));
    assert.ok(robotsText.includes('/sitemap.xml'));

    const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
    assert.strictEqual(sitemap.status, 200);
    assert.ok((sitemap.headers.get('content-type') || '').includes('xml'));
    const xml = await sitemap.text();
    assert.ok(xml.includes('/rankingit') && xml.includes('/menetelmat'));
    assert.ok(xml.includes(baseUrl), 'sitemapin URLit eivät käytä pyynnön hostia');
});

test('/preflop palvelee myös Omaha5:n taulukoita', async () => {
    const res = await fetch(`${baseUrl}/preflop?gameType=omaha5&players=6&hand=Ad,Ac,Jd,Jc,Th`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.exact, false);
    assert.strictEqual(data.handClasses, 134459);
    assert.strictEqual(data.rank, 1, '(AJ)(AJ)T on Omaha5:n paras käsi 6-max:ssa');
    assert.ok(data.equity > 31 && data.equity < 33, `saatiin ${data.equity}`);

    // Väärä korttimäärä hylätään
    const bad = await fetch(`${baseUrl}/preflop?gameType=omaha5&players=6&hand=Ad,Ac,Jd,Jc`);
    assert.strictEqual(bad.status, 400);

    // Yhdeksän pelaajan taulukko on perheen viimeinen ja tarkin
    const nine = await fetch(`${baseUrl}/preflop?gameType=omaha5&players=9&hand=Ad,Ac,Kh,Kc,Td`);
    assert.strictEqual(nine.status, 200);
    const nineData = await nine.json();
    assert.strictEqual(nineData.rank, 1, '(AK)(AT)K on Omaha5:n paras käsi 9-max:ssa');
    assert.ok(nineData.equity > 25 && nineData.equity < 27, `saatiin ${nineData.equity}`);
});
