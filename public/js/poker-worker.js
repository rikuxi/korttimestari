/**
 * Poker Calculator Web Worker
 *
 * Suorittaa simulaation taustasäikeessä. Varsinainen laskenta on
 * engine.js:ssä, jota myös palvelin käyttää - näin molemmat polut
 * antavat saman tuloksen eikä samaa logiikkaa ylläpidetä kahdesti.
 *
 * Monte Carlon jälkeen lasketaan tarkka arvo, jos tilanne on
 * enumeroitavissa järkevässä ajassa. Simulaatio näytetään heti; tarkka
 * arvo saapuu omana viestinään kun se valmistuu.
 */

importScripts('engine.js');

// Kuinka kauan tarkka laskenta saa kestää ennen kuin se jätetään väliin
const EXACT_BUDGET_SECONDS = 10;

self.onmessage = function (e) {
    // runId kuitataan jokaiseen viestiin: pääsäie hylkää viestit joiden
    // tunniste ei ole enää ajankohtainen (uusi ajo ehti alkaa)
    const { data, runId } = e.data;

    try {
        // Syöte valmistellaan kerran (käsialueiden laajennus on kallein osa)
        // ja sama tila annetaan simulaatiolle, suunnitelmalle ja
        // enumeroinnille
        const prepared = PokerEngine.prepare(data);
        const result = PokerEngine.runSimulation(data, (progress) => {
            self.postMessage({ type: 'progress', progress, runId });
        }, prepared);
        self.postMessage({ type: 'result', result, runId });

        const plan = PokerEngine.exactPlan(data, prepared);
        if (plan.feasible && plan.estimatedSeconds <= EXACT_BUDGET_SECONDS) {
            self.postMessage({ type: 'exactStarted', boards: plan.boards, runId });
            const exact = PokerEngine.enumerateExact(data, (progress) => {
                self.postMessage({ type: 'exactProgress', progress, runId });
            }, prepared);
            if (exact) self.postMessage({ type: 'exact', result: exact, runId });
        }
    } catch (error) {
        // code: moottorin käsialuevirheet (range_empty, range_conflict)
        self.postMessage({ type: 'error', error: error.message, code: error.code, runId });
    }
};
