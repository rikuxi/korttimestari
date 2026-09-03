const { parentPort, workerData } = require('worker_threads');
const PokerEngine = require('./public/js/engine');
const { isGameType, gameOf } = require('./public/js/games');

try {
    const { playerHandsData, simulationCount, gameType, randomOpponents } = workerData;

    // Validoi syötteet workerissa
    if (!Array.isArray(playerHandsData) || playerHandsData.length < 2 || playerHandsData.length > 10) {
        throw new Error('Invalid player data');
    }
    if (typeof simulationCount !== 'number' || simulationCount < 100 || simulationCount > 50000) {
        throw new Error('Invalid simulation count');
    }
    if (!isGameType(gameType)) {
        throw new Error('Invalid game type');
    }

    const cardsPerPlayer = gameOf(gameType).cardsPerPlayer;

    if (randomOpponents) {
        const heroData = playerHandsData[0];
        if (!heroData || !heroData.hand || heroData.hand.length === 0 || heroData.isFolded) {
            throw new Error('Hero must have cards and not be folded');
        }
        const validHeroCards = heroData.hand.filter(c => c !== null && c !== '');
        if (validHeroCards.length !== cardsPerPlayer) {
            throw new Error(`Hero must have exactly ${cardsPerPlayer} cards for ${gameType}`);
        }
        // Foldanneet eivät ole vastustajia; moottori jättää heidät pois pelistä
        // ja poistaa heidän korttinsa pakasta
        const opponentCount = playerHandsData.filter((p, idx) => idx > 0 && !p.isFolded).length;
        if (opponentCount > 9) {
            throw new Error('Opponent count must be between 1 and 9');
        }
    }

    // Käsialueet: pääprosessin välimuistista tullut puskuri kääritään
    // Int32Arrayksi; muut laajennetaan avaimista SharedArrayBufferiin, joka
    // palautetaan pääprosessille välimuistiin (jaettu muisti, ei kopiota).
    // Jokainen pyyntö käynnistää uuden workerin, joten moottorin oma
    // välimuisti ei koskaan osuisi.
    const rangeHands = [];
    for (const p of playerHandsData) {
        if (!p) continue;
        if (p.rangeHands instanceof SharedArrayBuffer) {
            p.rangeHands = new Int32Array(p.rangeHands);
        } else if (Array.isArray(p.rangeKeys) && p.rangeKeys.length > 0) {
            const combos = PokerEngine.expandRangeKeys(p.rangeKeys, cardsPerPlayer);
            const shared = new Int32Array(new SharedArrayBuffer(combos.byteLength));
            shared.set(combos);
            p.rangeHands = shared;
            if (p.rangeId) rangeHands.push({ id: p.rangeId, buffer: shared.buffer });
        }
    }

    // Laskenta on yhteinen selaimen kanssa: public/js/engine.js
    const results = PokerEngine.runSimulation(workerData);

    parentPort.postMessage({ results, rangeHands });

} catch (error) {
    // Lähetä virheviesti turvallisesti - älä vuoda pinojälkeä.
    // Käsialueen virheet ovat käyttäjän asetus, ei palvelinvika: moottori
    // liittää niihin koodin, joka välitetään käyttöliittymälle sellaisenaan.
    const code = error && error.code;
    const RANGE_ERRORS = {
        range_empty: 'Range has no possible hands',
        range_conflict: 'Ranges cannot all be dealt'
    };
    parentPort.postMessage({
        error: RANGE_ERRORS[code] || 'Simulation failed',
        code: RANGE_ERRORS[code] ? code : undefined
    });
}
