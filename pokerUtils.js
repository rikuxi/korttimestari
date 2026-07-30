const pokerEvaluator = require('poker-evaluator');
// Perusmääritykset tulevat cards.js:stä, jotta palvelin voi käyttää niitä
// lataamatta poker-evaluatoria; tämä moduuli vain välittää ne eteenpäin
const { RANKS, SUITS, isValidCard } = require('./cards');

// Pelityyppien korttimäärät
const CARDS_PER_PLAYER = {
    'holdem': 2,
    'omaha': 4,
    'omaha5': 5
};

/**
 * Palauttaa korttimäärän pelityypille
 * @param {string} gameType - 'holdem' | 'omaha' | 'omaha5'
 * @returns {number} - Korttien määrä
 */
function getCardsPerPlayer(gameType) {
    return CARDS_PER_PLAYER[gameType] || 2;
}

/**
 * Luo uuden 52 kortin pakan
 * @returns {string[]} - 52 kortin pakka
 */
function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push(rank + suit);
        }
    }
    return deck;
}

/**
 * Sekoittaa pakan käyttäen Fisher-Yates algoritmia
 * @param {string[]} deck - Pakka
 * @returns {string[]} - Sekoitettu pakka
 */
function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Generoi kaikki k-kokoiset kombinaatiot taulukosta
 * @param {any[]} arr - Taulukko
 * @param {number} k - Kombinaation koko
 * @returns {any[][]} - Kaikki kombinaatiot
 */
function getCombinations(arr, k) {
    if (k < 0 || k > arr.length) {
        return [];
    }
    
    const result = [];
    
    function combine(start, combo) {
        if (combo.length === k) {
            result.push([...combo]);
            return;
        }
        
        for (let i = start; i < arr.length; i++) {
            combo.push(arr[i]);
            combine(i + 1, combo);
            combo.pop();
        }
    }
    
    combine(0, []);
    return result;
}

/**
 * Evalueoi Omaha-käden (2 korttia kädestä, 3 pöydästä)
 * Toimii sekä 4- että 5-kortin Omahalle
 * @param {string[]} hand - Pelaajan 4 tai 5 korttia
 * @param {string[]} board - Pöydän 5 korttia
 * @returns {object} - Paras käsi
 */
function evaluateOmahaHand(hand, board) {
    if (!hand || (hand.length !== 4 && hand.length !== 5)) {
        return { value: 0, handName: 'invalid' };
    }
    if (!board || board.length !== 5) {
        return { value: 0, handName: 'invalid' };
    }
    
    let bestHand = { value: 0 };
    
    // Generoi kaikki mahdolliset 2 kortin yhdistelmät kädestä
    // 4 korttia -> 6 yhdistelmää, 5 korttia -> 10 yhdistelmää
    const handCombinations = getCombinations(hand, 2);
    
    // Generoi kaikki mahdolliset 3 kortin yhdistelmät pöydästä (5 korttia -> 10 yhdistelmää)
    const boardCombinations = getCombinations(board, 3);
    
    // Etsi paras 5 kortin yhdistelmä
    for (const handCombo of handCombinations) {
        for (const boardCombo of boardCombinations) {
            const fiveCards = [...handCombo, ...boardCombo];
            const evalResult = pokerEvaluator.evalHand(fiveCards);
            
            if (evalResult.value > bestHand.value) {
                bestHand = evalResult;
            }
        }
    }
    
    return bestHand;
}

/**
 * Flatten ja suodata kädet pakan poistoa varten
 * @param {Array} hands - Pelaajien kädet (voi olla sisäkkäisiä taulukoita)
 * @returns {string[]} - Kaikki kortit yhdessä taulukossa
 */
function flattenHands(hands) {
    const cards = [];
    for (const hand of hands) {
        if (Array.isArray(hand)) {
            for (const card of hand) {
                if (card && typeof card === 'string') {
                    cards.push(card);
                }
            }
        }
    }
    return cards;
}

/**
 * Rakenna pöytäkortit ja lisää käytettyihin kortteihin
 * @param {object} communityCards - Pöytäkortit
 * @param {string[]} usedCards - Käytetyt kortit (mutatoidaan)
 * @returns {string[]} - Pöytäkortit
 */
function buildBoard(communityCards, usedCards) {
    const board = [];
    
    if (communityCards && communityCards.flop && Array.isArray(communityCards.flop)) {
        for (const card of communityCards.flop) {
            if (card && typeof card === 'string') {
                board.push(card);
                usedCards.push(card);
            }
        }
    }
    if (communityCards && communityCards.turn && typeof communityCards.turn === 'string') {
        board.push(communityCards.turn);
        usedCards.push(communityCards.turn);
    }
    if (communityCards && communityCards.river && typeof communityCards.river === 'string') {
        board.push(communityCards.river);
        usedCards.push(communityCards.river);
    }
    
    return board;
}

/**
 * Esilaskee simulaatiokierrosten vakio-osat: pohjapöydän ja jäljellä
 * olevan pakan. Nämä eivät muutu kierrosten välillä, joten ne kannattaa
 * laskea vain kerran per pyyntö (ei 50 000 kertaa).
 * @param {object} communityCards - Pöytäkortit
 * @param {Array} knownHands - Tunnetut kädet pakan poistoa varten
 * @returns {{baseBoard: string[], baseDeck: string[]}}
 */
function prepareSimulationBase(communityCards, knownHands) {
    const usedCards = flattenHands(knownHands);
    const baseBoard = buildBoard(communityCards, usedCards);
    const baseDeck = createDeck().filter(card => !usedCards.includes(card));
    return { baseBoard, baseDeck };
}

/**
 * Suorittaa yhden Texas Hold'em -kierroksen kiinteillä käsillä
 * @param {string[][]} activePlayerHands - Aktiivisten pelaajien kädet
 * @param {string[]} baseBoard - Esilasketut pöytäkortit (prepareSimulationBase)
 * @param {string[]} baseDeck - Esilaskettu jäljellä oleva pakka
 * @returns {object} - Simulaation tulos
 */
function runSingleSimulation(activePlayerHands, baseBoard, baseDeck) {
    const deck = shuffleDeck(baseDeck);
    let board = baseBoard;

    const neededCards = 5 - board.length;
    if (neededCards > 0) {
        if (deck.length < neededCards) {
            throw new Error('Not enough cards in deck');
        }
        board = [...board, ...deck.slice(0, neededCards)];
    }

    const handRankings = activePlayerHands.map(hand => {
        const sevenCards = [...hand, ...board];
        return pokerEvaluator.evalHand(sevenCards);
    });

    const highestRank = Math.max(...handRankings.map(h => h.value));
    const winners = handRankings.map((hand, index) => hand.value === highestRank ? index : -1)
                                .filter(index => index !== -1);

    const handNames = handRankings.map(h => h.handName);

    return { winners, handRankings, handNames };
}

/**
 * Suorittaa yhden Omaha-kierroksen kiinteillä käsillä (4 tai 5 korttia)
 * @param {string[][]} activePlayerHands - Aktiivisten pelaajien kädet
 * @param {string[]} baseBoard - Esilasketut pöytäkortit (prepareSimulationBase)
 * @param {string[]} baseDeck - Esilaskettu jäljellä oleva pakka
 * @returns {object} - Simulaation tulos
 */
function runSingleOmahaSimulation(activePlayerHands, baseBoard, baseDeck) {
    const deck = shuffleDeck(baseDeck);
    let board = baseBoard;

    const neededCards = 5 - board.length;
    if (neededCards > 0) {
        if (deck.length < neededCards) {
            throw new Error('Not enough cards in deck');
        }
        board = [...board, ...deck.slice(0, neededCards)];
    }

    const handRankings = activePlayerHands.map(hand => {
        return evaluateOmahaHand(hand, board);
    });

    const highestValue = Math.max(...handRankings.map(h => h.value));
    const winners = handRankings.map((h, index) => h.value === highestValue ? index : -1)
                              .filter(index => index !== -1);

    const handNames = handRankings.map(h => h.handName);

    return { winners, handRankings, handNames };
}

/**
 * Suorittaa yhden simulaation, jossa vastustajille arvotaan uudet kädet
 * @param {string[]} heroHand - Heron kortit
 * @param {number} opponentCount - Vastustajien määrä
 * @param {string[]} baseBoard - Esilasketut pöytäkortit (prepareSimulationBase)
 * @param {string[]} baseDeck - Esilaskettu jäljellä oleva pakka
 * @param {string} gameType - 'holdem' | 'omaha' | 'omaha5'
 * @returns {object} - Simulaation tulos
 */
function runSingleSimulationRandomOpponents(heroHand, opponentCount, baseBoard, baseDeck, gameType) {
    const cardsPerPlayer = getCardsPerPlayer(gameType);
    const deck = shuffleDeck(baseDeck);
    let board = baseBoard;

    const neededForOpponents = opponentCount * cardsPerPlayer;
    const neededForBoard = 5 - board.length;
    if (deck.length < neededForOpponents + neededForBoard) {
        throw new Error('Not enough cards in deck');
    }

    const opponentHands = [];
    let deckIndex = 0;
    for (let i = 0; i < opponentCount; i++) {
        opponentHands.push(deck.slice(deckIndex, deckIndex + cardsPerPlayer));
        deckIndex += cardsPerPlayer;
    }

    if (neededForBoard > 0) {
        board = [...board, ...deck.slice(deckIndex, deckIndex + neededForBoard)];
    }

    const allHands = [heroHand, ...opponentHands];

    let handRankings;
    if (gameType === 'omaha' || gameType === 'omaha5') {
        handRankings = allHands.map(hand => evaluateOmahaHand(hand, board));
    } else {
        handRankings = allHands.map(hand => {
            const sevenCards = [...hand, ...board];
            return pokerEvaluator.evalHand(sevenCards);
        });
    }

    const highestRank = Math.max(...handRankings.map(h => h.value));
    const winners = handRankings.map((hand, index) => hand.value === highestRank ? index : -1)
                                .filter(index => index !== -1);

    const heroHandName = handRankings[0] ? handRankings[0].handName : null;

    return { winners, handRankings, heroHandName };
}

module.exports = {
    isValidCard,
    createDeck,
    shuffleDeck,
    getCombinations,
    evaluateOmahaHand,
    prepareSimulationBase,
    runSingleSimulation,
    runSingleOmahaSimulation,
    runSingleSimulationRandomOpponents,
    getCardsPerPlayer,
    RANKS,
    SUITS,
    CARDS_PER_PLAYER
};