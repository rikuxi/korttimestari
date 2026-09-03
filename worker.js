const { parentPort, workerData } = require('worker_threads');
const PokerEngine = require('./public/js/engine');

try {
    const { playerHandsData, simulationCount, gameType, randomOpponents } = workerData;

    // Validoi syötteet workerissa
    if (!Array.isArray(playerHandsData) || playerHandsData.length < 2 || playerHandsData.length > 10) {
        throw new Error('Invalid player data');
    }
    if (typeof simulationCount !== 'number' || simulationCount < 100 || simulationCount > 50000) {
        throw new Error('Invalid simulation count');
    }
    if (gameType !== 'holdem' && gameType !== 'omaha' && gameType !== 'omaha5' && gameType !== 'omahahilo') {
        throw new Error('Invalid game type');
    }

    const cardsPerPlayer = gameType === 'holdem' ? 2 : (gameType === 'omaha5' ? 5 : 4);

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

    // Laskenta on yhteinen selaimen kanssa: public/js/engine.js
    const results = PokerEngine.runSimulation(workerData);

    parentPort.postMessage({ results });

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
