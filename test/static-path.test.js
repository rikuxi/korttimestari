// Regressiotesti: staattiset tiedostot tarjoillaan vaikka palvelin
// käynnistetään muusta työhakemistosta. express.static('public') haki
// polun työhakemistosta, jolloin systemd/pm2/Docker-käynnistys ilman
// oikeaa WorkingDirectorya 404:si koko sivuston - mutta API toimi,
// mikä teki oireesta hämäävän. Polku tulee nyt __dirname:stä.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

test('staattinen etusivu tarjoillaan työhakemistosta riippumatta', async () => {
    const port = 3300 + (process.pid % 200);
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        cwd: os.tmpdir(),                       // tahallaan väärä työhakemisto
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore'
    });
    try {
        let res = null;
        for (let i = 0; i < 40 && !res; i++) {
            await new Promise(r => setTimeout(r, 250));
            try { res = await fetch(`http://127.0.0.1:${port}/`); } catch (e) { /* ei vielä ylhäällä */ }
        }
        assert.ok(res, 'palvelin ei käynnistynyt');
        assert.strictEqual(res.status, 200);
        const html = await res.text();
        assert.ok(html.includes('Korttimestari'), 'etusivun sisältö puuttuu');
    } finally {
        child.kill();
    }
});
