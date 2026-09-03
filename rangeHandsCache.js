// Laajennettujen käsialueiden välimuisti palvelimen /simulate-polulle.
//
// Jokainen /simulate-pyyntö käynnistää uuden worker-säikeen, jossa engine.js
// ladataan tyhjästä, joten moottorin oma välimuisti ei koskaan osu. Alueen
// laajennus avaimista komboiksi maksaa Omaha5:llä 60-170 ms per vastustaja.
// Worker laajentaa alueen SharedArrayBufferiin ja palauttaa sen tänne;
// seuraava pyyntö saa saman puskurin workerDatassa ilman kopiota ja ilman
// laajennusta.
//
// Muisti: yksi merkintä on jopa 47 MB (Omaha5 top 90 %), joten välimuistilla
// on tavubudjetti (RANGE_CACHE_MB, oletus 96; 0 poistaa käytöstä) ja
// vanhimmasta käytetystä häädetään. Puskurit ovat vain luettavia: workerit
// eivät kirjoita niihin, joten sama puskuri voi olla usealla säikeellä.

'use strict';

const DEFAULT_MB = 96;

function parseBudget(value) {
    if (value === undefined || value === '') return DEFAULT_MB * 1024 * 1024;
    const mb = Number(value);
    if (!Number.isFinite(mb) || mb < 0) return DEFAULT_MB * 1024 * 1024;
    return Math.floor(mb * 1024 * 1024);
}

function createCache(budgetBytes) {
    const entries = new Map();   // id -> SharedArrayBuffer, lisäysjärjestys = käyttöjärjestys
    let bytes = 0;

    function get(id) {
        const buf = entries.get(id);
        if (buf === undefined) return undefined;
        // Siirrä viimeksi käytetyksi
        entries.delete(id);
        entries.set(id, buf);
        return buf;
    }

    function set(id, buf) {
        if (!(buf instanceof SharedArrayBuffer)) return false;
        if (buf.byteLength > budgetBytes) return false;
        if (entries.has(id)) {
            bytes -= entries.get(id).byteLength;
            entries.delete(id);
        }
        while (bytes + buf.byteLength > budgetBytes && entries.size > 0) {
            const oldest = entries.keys().next().value;
            bytes -= entries.get(oldest).byteLength;
            entries.delete(oldest);
        }
        entries.set(id, buf);
        bytes += buf.byteLength;
        return true;
    }

    return {
        get, set,
        has: id => entries.has(id),
        size: () => entries.size,
        bytes: () => bytes,
        budget: () => budgetBytes,
        clear() { entries.clear(); bytes = 0; }
    };
}

module.exports = Object.assign(createCache(parseBudget(process.env.RANGE_CACHE_MB)), { createCache, parseBudget });
