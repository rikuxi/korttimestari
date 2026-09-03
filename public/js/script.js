document.addEventListener('DOMContentLoaded', () => {
    // Käyttöliittymätekstit ja numeroiden locale (katso i18n.js; kieli
    // tulee sivun <html lang> -attribuutista)
    const { t, locale } = window.I18N;

    // Hand colors configuration
    const handColors = {
        "high card": "#95a5a6",
        "one pair": "#3498db",
        "two pairs": "#2980b9",
        "three of a kind": "#1abc9c",
        "straight": "#2ecc71",
        "flush": "#9b59b6",
        "full house": "#e67e22",
        "four of a kind": "#e74c3c",
        "straight flush": "#f1c40f"
    };

    // DOM Elements
    const playerCountSelect = document.getElementById('playerCount');
    const simulationCountInput = document.getElementById('simulationCount');
    const playersContainer = document.getElementById('playersContainer');
    const runSimulationButton = document.getElementById('runSimulation');
    const randomizeCardsButton = document.getElementById('randomizeCards');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const cancelSimulationButton = document.getElementById('cancelSimulation');
    const simulationNotice = document.getElementById('simulationNotice');
    const cardDeck = document.getElementById('cardDeck');
    const gameTypeRadios = document.querySelectorAll('input[name="gameType"]');
    const deckColorRadios = document.querySelectorAll('input[name="deckColor"]');
    const opponentModeRadios = document.querySelectorAll('input[name="opponentMode"]');

    // Current game type
    let currentGameType = 'holdem';

    // Used cards tracking
    const usedCards = new Set();
    
    // Track board card state
    let boardState = 'none';
    
    // Current deck color tracking
    let currentDeckColor = 'standard';
    
    // Selainlaskennan katto. Palvelin on vain varapolku eikä sitä kuormiteta
    // samalla määrällä, joten sillä on oma matalampi rajansa.
    const MAX_SIMULATIONS = 1000000;
    const SERVER_MAX_SIMULATIONS = 50000;

    // Web Worker
    let pokerWorker = null;

    // Ajotunniste: workerin ja /preflop-haun vastaukset kuitataan tällä,
    // jotta edellisen ajon myöhässä saapuvat tulokset eivät kirjoitu uuden
    // ajon lukujen päälle
    let currentRunId = 0;
    // Onko tarkka enumerointi kesken workerissa - uusi ajo katkaisee sen,
    // muuten sen viesti jonottaisi enumeroinnin takana jopa ~10 s
    let exactInFlight = false;
    // Käsialueiden avainhaku on asynkroninen: uusi käynnistys mitätöi vanhan
    let rangeFetchToken = 0;

    // Tallenna playerHandsData simulaation ajaksi
    let currentPlayerHandsData = null;
    // Tarkka tulos saapuu simulaation jälkeen, jolloin currentPlayerHandsData
    // on jo nollattu - pidetään erillinen viittaus näyttöä varten
    let lastPlayerHandsData = null;

    // Palvelin-fallbackin peruutus
    let serverAbortController = null;

    // Helper to get cards per player based on game type
    function getCardsPerPlayer() {
        if (currentGameType === 'holdem') return 2;
        if (currentGameType === 'omaha5') return 5;
        return 4; // omaha ja omahahilo
    }

    // Omaha Hi/Lo: potti jaetaan hi- ja low-puoliskoihin, joten tulokset
    // esitetään eri riveillä (scoop/osapotti + hi/lo-erittely)
    function isHiLoGame() {
        return currentGameType === 'omahahilo';
    }

    /**
     * Pöytäkortin mitat pelimuodolle.
     *
     * Koot ovat CSS:n tokeneissa eikä niitä kirjoiteta tänne uudelleen:
     * kortin kasvattaminen tyylitiedostossa levittää pelaajaruudun ja
     * pöydän automaattisesti. Omaha5 käyttää omia, pienempiä tokeneita -
     * katso perustelu style.css:stä --card-w-omaha5:n kohdalta.
     *
     * @param {number} cardsPerPlayer - 2 (Hold'em), 4 (Omaha) tai 5 (Omaha5)
     * @returns {{w: number, h: number}} leveys ja korkeus pikseleinä
     */
    function cardMetrics(cardsPerPlayer) {
        const cs = getComputedStyle(document.documentElement);
        const suffix = cardsPerPlayer === 5 ? '-omaha5' : '';
        return {
            w: parseFloat(cs.getPropertyValue('--card-w' + suffix)) || 40,
            h: parseFloat(cs.getPropertyValue('--card-h' + suffix)) || 60
        };
    }

    /**
     * Pelaajaruudun leveys korttien todellisista mitoista. Palautettu luku
     * menee sekä ruudun tyyliin että pöydän säteen laskentaan, joten CSS:n
     * ja JS:n arvot eivät voi ajautua erilleen.
     *
     * @param {number} cardsPerPlayer - 2 (Hold'em), 4 (Omaha) tai 5 (Omaha5)
     * @returns {number} leveys pikseleinä
     */
    function seatWidth(cardsPerPlayer) {
        // .card-inputs: gap 4 px, mutta .card-inputs.omaha5: gap 3 px
        const gap = cardsPerPlayer === 5 ? 3 : 4;
        const PADDING = 8 * 2;  // .player-input padding molemmin puolin
        const SLACK = 6;        // ettei kortti hipo ruudun reunaa
        return Math.ceil(cardsPerPlayer * cardMetrics(cardsPerPlayer).w
            + (cardsPerPlayer - 1) * gap + PADDING + SLACK);
    }

    // Helper to get max players based on game type
    function getMaxPlayers() {
        if (currentGameType === 'holdem') return 10;
        return 9; // omaha ja omaha5
    }

    // Helper to check if random mode is active
    function isRandomOpponentsMode() {
        const checked = document.querySelector('input[name="opponentMode"]:checked');
        return checked && checked.value === 'random';
    }

    // Vastustajien käsialueet (ranges.js). Rankingtaulukko valitaan
    // aktiivisen pelaajamäärän mukaan - sama kuin /preflop-haussa: hero +
    // foldaamattomat vastustajat.
    function activePlayerCount() {
        const playerCount = parseInt(playerCountSelect.value);
        let n = 0;
        for (let i = 0; i < playerCount; i++) {
            const playerDiv = document.querySelector(`.player-input[data-player-index="${i}"]`);
            if (!playerDiv || !playerDiv.classList.contains('folded')) n++;
        }
        return n;
    }
    const RangeUI = window.RangeUI;
    RangeUI.init({
        getContext: () => ({ gameType: currentGameType, players: activePlayerCount() }),
        onChange: () => { if (isRandomOpponentsMode() && checkAllPlayersHaveCards()) runSimulation(); }
    });
    RangeUI.attachGlobal(document.getElementById('rangeAll'), document.getElementById('rangeAllValue'));
    const rangeSetting = document.getElementById('rangeSetting');

    const handOrder = [
        "high card", "one pair", "two pairs", "three of a kind",
        "straight", "flush", "full house", "four of a kind",
        "straight flush"
    ];

    /** Kortin puhenimi ruudunlukijaa varten, esim. "pata ässä" / "ace of spades" */
    function cardAriaName(rank, suitCode) {
        const rankName = 'TJQKA'.includes(rank) ? t('card.rank.' + rank) : rank;
        return t('card.aria', { suit: t('card.suit.' + suitCode), rank: rankName });
    }

    /** Poistonappi pudotetulle kortille - fokusoitava ja näppäimistökäyttöinen */
    function createRemoveButton(dropZone) {
        const removeBtn = document.createElement('div');
        removeBtn.classList.add('remove-card');
        removeBtn.textContent = '×';
        removeBtn.tabIndex = 0;
        removeBtn.setAttribute('role', 'button');
        removeBtn.setAttribute('aria-label', t('sim.removeCard'));
        removeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            removeCardFromDropZone(dropZone);
        });
        removeBtn.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                removeCardFromDropZone(dropZone);
            }
        });
        return removeBtn;
    }
    
    // Alusta Web Worker
    function initWorker() {
        if (window.Worker) {
            try {
                // Absoluuttinen polku: suhteellinen hajoaisi /en/-sivuilla
                pokerWorker = new Worker('/js/poker-worker.js');
                
                pokerWorker.onmessage = function(e) {
                    const { type, result, progress, error, code, runId } = e.data;

                    // Vanhentuneen ajon viesti - uusi ajo on jo alkanut
                    if (runId !== currentRunId) return;

                    if (type === 'progress') {
                        updateLoadingProgress(progress);
                    } else if (type === 'result') {
                        handleSimulationResult(result);
                    } else if (type === 'exactStarted') {
                        exactInFlight = true;
                        showExactPending();
                    } else if (type === 'exactProgress') {
                        // tarkka laskenta jatkuu taustalla, simulaatio on jo näkyvissä
                    } else if (type === 'exact') {
                        exactInFlight = false;
                        displayExact(result);
                    } else if (type === 'error') {
                        exactInFlight = false;
                        if (code === 'range_conflict' || code === 'range_empty') {
                            // Käyttäjän asetus, ei laskentavika: palvelin
                            // päätyisi samaan
                            showNotice(t(code === 'range_empty' ? 'sim.rangeEmpty' : 'sim.rangeConflict'));
                            finishSimulation();
                            return;
                        }
                        console.error('Worker error:', error);
                        // Fallback to server - kerro käyttäjälle
                        showNotice(t('sim.browserFallback'));
                        runServerSimulation();
                    }
                };
                
                pokerWorker.onerror = function(error) {
                    console.error('Worker initialization error:', error);
                    pokerWorker = null;
                    // Jos simulaatio oli käynnissä, älä jätä lataustilaa jumiin
                    if (currentPlayerHandsData) {
                        showNotice(t('sim.browserFallback'));
                        runServerSimulation();
                    }
                };
            } catch (e) {
                console.warn('Web Worker not supported, using server-side calculation');
                pokerWorker = null;
            }
        }
    }
    
    // Päivitä latausedistyminen
    function updateLoadingProgress(progress) {
        const progressElem = document.querySelector('.loading-progress');
        if (progressElem) {
            progressElem.textContent = ` (${progress.toFixed(0)}%)`;
        }
    }
    
    // Käsittele simulaation tulos
    function handleSimulationResult(result) {
        if (currentPlayerHandsData) {
            displayResults(result, currentPlayerHandsData);
        }
        finishSimulation();
    }
    
    // Lopeta simulaatio
    function finishSimulation() {
        runSimulationButton.disabled = false;
        loadingIndicator.classList.add('invisible');
        cancelSimulationButton.classList.add('invisible');
        const progressElem = document.querySelector('.loading-progress');
        if (progressElem) progressElem.textContent = '';
        currentPlayerHandsData = null;
    }

    // Näytä ilmoitus käyttäjälle (esim. fallback palvelimelle).
    // Elementillä on kiinteä korkeus, joten teksti ei hypäytä asettelua.
    function showNotice(message) {
        simulationNotice.textContent = message;
    }

    function clearNotice() {
        simulationNotice.textContent = '';
    }

    // Peruuta käynnissä oleva simulaatio
    function cancelSimulation() {
        // Mitätöi myös lennossa olevat vastaukset (worker, /preflop-haku)
        // ja kesken oleva käsialueiden avainhaku, joka muuten käynnistäisi
        // ajon peruutuksen jälkeen
        currentRunId++;
        rangeFetchToken++;
        exactInFlight = false;
        if (pokerWorker) {
            // terminate tappaa workerin kesken laskennan - luodaan uusi tilalle
            pokerWorker.terminate();
            pokerWorker = null;
            initWorker();
        }
        if (serverAbortController) {
            serverAbortController.abort();
        }
        finishSimulation();
    }

    
    // Kortin etupuoli: arvo ylhäällä ja iso maasymboli sen alla, molemmat
    // keskitettyinä. Yksi iso merkkipari kulmaindeksien sijaan, koska kortit
    // ovat pieniä ja luettavuus menee aitouden edelle.
    // Yhteinen kaikille kolmelle rakennuspaikalle (pakka, raahaus, arvonta),
    // jottei kortti pääse näyttämään pöydällä eri kortilta kuin pakassa.
    function buildCardFace(cardElement, rank, suitSymbol) {
        cardElement.innerHTML = '';

        const rankElem = document.createElement('div');
        rankElem.classList.add('rank');
        rankElem.textContent = rank;

        const suitElem = document.createElement('div');
        suitElem.classList.add('suit');
        suitElem.textContent = suitSymbol;

        cardElement.appendChild(rankElem);
        cardElement.appendChild(suitElem);
    }

    // Create the card deck
    function createCardDeck() {
        cardDeck.innerHTML = '';
        cardDeck.classList.toggle('fourcolor', currentDeckColor === 'fourcolor');

        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
        const suits = [
            { code: 's', symbol: '♠', name: 'spades' },
            { code: 'h', symbol: '♥', name: 'hearts' },
            { code: 'd', symbol: '♦', name: 'diamonds' },
            { code: 'c', symbol: '♣', name: 'clubs' }
        ];
        
        for (const suit of suits) {
            const suitRow = document.createElement('div');
            suitRow.classList.add('suit-row');
            
            const suitLabel = document.createElement('div');
            // Väri tulee CSS:stä (.suit-label.suit-X) eikä tyyliattribuutista,
            // jotta teemanvaihto hallitsee sen
            suitLabel.classList.add('suit-label', 'suit-' + suit.code);
            suitLabel.textContent = suit.symbol;
            suitLabel.setAttribute('aria-hidden', 'true');

            suitRow.appendChild(suitLabel);
            
            for (const rank of ranks) {
                const card = document.createElement('div');
                card.classList.add('deck-card', suit.name);
                
                if (currentDeckColor === 'fourcolor') {
                    card.classList.add('fourcolor');
                }
                
                buildCardFace(card, rank, suit.symbol);

                card.setAttribute('data-card', rank + suit.code);
                card.setAttribute('draggable', 'true');

                // Näppäimistöpolku: kortti on fokusoitava ja Enter/välilyönti
                // vastaa tuplaklikkausta - ilman tätä kortteja ei voi valita
                // lainkaan ilman hiirtä
                card.tabIndex = 0;
                card.setAttribute('role', 'button');
                card.setAttribute('aria-label', cardAriaName(rank, suit.code));
                card.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        this.dispatchEvent(new Event('dblclick'));
                    }
                });

                card.addEventListener('dragstart', handleDragStart);
                card.addEventListener('dragend', handleDragEnd);
                
                card.addEventListener('dblclick', function() {
                    if (this.classList.contains('used')) {
                        return; 
                    }
                    
                    const cardValue = this.getAttribute('data-card');
                    const firstAvailableSlot = findFirstAvailableSlot();
                    
                    if (firstAvailableSlot) {
                        const playerInputDiv = firstAvailableSlot.closest('.player-input');
                        if (playerInputDiv && playerInputDiv.classList.contains('folded')) {
                            playerInputDiv.classList.remove('folded');
                            playerInputDiv.setAttribute('data-folded', 'false');
                        }
                        
                        usedCards.add(cardValue);
                        this.classList.add('used');
                        simulateCardDrop(firstAvailableSlot, cardValue);
                        
                        if (checkAllPlayersHaveCards()) {
                            runSimulation();
                        }
                    }
                });
                
                suitRow.appendChild(card);
            }
            cardDeck.appendChild(suitRow);
        }
    }
    
    // Drag handlers
    function handleDragStart(e) {
        if (this.classList.contains('used')) {
            e.preventDefault();
            return false;
        }
        e.dataTransfer.setData('text/plain', this.getAttribute('data-card'));
        const dragImage = this.cloneNode(true);
        dragImage.style.width = '36px';
        dragImage.style.height = '50px';
        dragImage.style.position = 'absolute';
        dragImage.style.top = '-1000px';
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, 18, 25);
        setTimeout(() => { document.body.removeChild(dragImage); }, 0);
        e.dataTransfer.effectAllowed = 'move';
        // Lähtökortti himmenee raahauksen ajaksi, jotta näkee mistä
        // kortti on lähdössä. Luokka pois myös peruutetusta raahauksesta.
        this.classList.add('dragging');
    }

    function handleDragEnd() {
        this.classList.remove('dragging');
    }
    
    function handleDragOver(e) { e.preventDefault(); this.classList.add('hover'); return false; }
    function handleDragEnter(e) { this.classList.add('hover'); }
    function handleDragLeave(e) { this.classList.remove('hover'); }
    
    function handleDrop(e) {
        e.preventDefault();
        this.classList.remove('hover');
        const cardValue = e.dataTransfer.getData('text/plain');

        // Kelpuuta vain oikea kortti ja tarkista duplikaatti ENNEN kuin ruudun
        // tilaa kosketaan. Tähän käsittelijään päätyy myös selaimen ulkopuolelta
        // raahattu teksti: roska menisi ruutuun asti, ja käytetty kortti
        // vapauttaisi ruudun vanhan kortin kirjanpidosta vaikka pudotus
        // hylätään - jolloin sama kortti voisi päätyä peliin kahdesti.
        if (!/^[2-9TJQKA][shdc]$/.test(cardValue)) return false;
        if (usedCards.has(cardValue) && this.getAttribute('data-card') !== cardValue) {
            return false;
        }

        if (this.classList.contains('filled')) {
            const oldCard = this.getAttribute('data-card');
            if (oldCard) {
                usedCards.delete(oldCard);
                const oldDeckCard = document.querySelector(`.deck-card[data-card="${oldCard}"]`);
                if (oldDeckCard) oldDeckCard.classList.remove('used');
            }
        }
        
        const playerInputDiv = this.closest('.player-input');
        if (playerInputDiv && playerInputDiv.classList.contains('folded')) {
            playerInputDiv.classList.remove('folded');
            playerInputDiv.setAttribute('data-folded', 'false');
        }
        
        usedCards.add(cardValue);
        this.classList.add('filled');
        this.setAttribute('data-card', cardValue);
        
        this.innerHTML = '';
        const cardElement = document.createElement('div');
        cardElement.classList.add('dropped-card');
        
        const rank = cardValue[0];
        const suit = cardValue[1];
        let suitName, suitSymbol;
        if (suit === 's') { suitName = 'spades'; suitSymbol = '♠'; }
        else if (suit === 'h') { suitName = 'hearts'; suitSymbol = '♥'; }
        else if (suit === 'd') { suitName = 'diamonds'; suitSymbol = '♦'; }
        else if (suit === 'c') { suitName = 'clubs'; suitSymbol = '♣'; }
        
        cardElement.classList.add(suitName);
        if (currentDeckColor === 'fourcolor') cardElement.classList.add('fourcolor');

        buildCardFace(cardElement, rank, suitSymbol);

        cardElement.appendChild(createRemoveButton(this));
        this.appendChild(cardElement);
        
        const inputId = this.getAttribute('data-input-id');
        const inputField = document.getElementById(inputId);
        if (inputField) inputField.value = cardValue;
        
        const deckCard = document.querySelector(`.deck-card[data-card="${cardValue}"]`);
        if (deckCard) deckCard.classList.add('used');
        return false;
    }
    
    function removeCardFromDropZone(dropZone) {
        const cardValue = dropZone.getAttribute('data-card');
        if (cardValue) {
            usedCards.delete(cardValue);
            const deckCard = document.querySelector(`.deck-card[data-card="${cardValue}"]`);
            if (deckCard) deckCard.classList.remove('used');
        }
        dropZone.innerHTML = '';
        dropZone.classList.remove('filled');
        dropZone.removeAttribute('data-card');
        const inputId = dropZone.getAttribute('data-input-id');
        const inputField = document.getElementById(inputId);
        if (inputField) inputField.value = '';
    }

    // Update player count options based on game type
    function updatePlayerCountOptions() {
        const maxPlayers = getMaxPlayers();
        const currentValue = parseInt(playerCountSelect.value);
        
        Array.from(playerCountSelect.options).forEach(option => {
            const value = parseInt(option.value);
            if (value > maxPlayers) {
                option.disabled = true;
                option.style.display = 'none';
            } else {
                option.disabled = false;
                option.style.display = '';
            }
        });
        
        if (currentValue > maxPlayers) {
            playerCountSelect.value = maxPlayers;
        }
    }
    
    // Initialize player inputs
    function initializePlayerInputs() {
        const playerCount = parseInt(playerCountSelect.value);
        playersContainer.innerHTML = '';
        usedCards.clear();
        RangeUI.reset();
        // Kesken oleva avainhaku koskee vanhaa pöytää: älä anna sen käynnistää
        // ajoa uutta pöytää vasten
        rangeFetchToken++;
        const allDeckCards = document.querySelectorAll('.deck-card');
        allDeckCards.forEach(card => card.classList.remove('used'));
        
        const pokerTableContainer = document.createElement('div');
        pokerTableContainer.classList.add('poker-table-container');
        if (currentGameType !== 'holdem') {
            pokerTableContainer.classList.add('omaha-mode');
        }
        if (currentGameType === 'omaha5') {
            pokerTableContainer.classList.add('omaha5-mode');
        }
        
        const pokerTable = document.createElement('div');
        pokerTable.classList.add('poker-table');
        
        const communityCards = document.createElement('div');
        communityCards.classList.add('community-cards');
        const communityCardsRow = document.createElement('div');
        communityCardsRow.classList.add('community-cards-row');
        
        // Flop
        const flopSection = document.createElement('div');
        flopSection.classList.add('section-container');
        const flopLabel = document.createElement('div');
        flopLabel.classList.add('community-label');
        flopLabel.textContent = 'Flop';
        flopSection.appendChild(flopLabel);
        const flopContainer = document.createElement('div');
        flopContainer.classList.add('flop-container');
        for (let i = 0; i < 3; i++) {
            const dropZone = document.createElement('div');
            dropZone.classList.add('community-drop-zone');
            dropZone.setAttribute('data-input-id', `flop${i}`);
            dropZone.addEventListener('dragover', handleDragOver);
            dropZone.addEventListener('dragenter', handleDragEnter);
            dropZone.addEventListener('dragleave', handleDragLeave);
            dropZone.addEventListener('drop', handleDrop);
            flopContainer.appendChild(dropZone);
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = `flop${i}`;
            flopContainer.appendChild(hiddenInput);
        }
        flopSection.appendChild(flopContainer);
        communityCardsRow.appendChild(flopSection);
        
        // Turn
        const turnSection = document.createElement('div');
        turnSection.classList.add('section-container');
        const turnLabel = document.createElement('div');
        turnLabel.classList.add('community-label');
        turnLabel.textContent = 'Turn';
        turnSection.appendChild(turnLabel);
        const turnDropZone = document.createElement('div');
        turnDropZone.classList.add('community-drop-zone');
        turnDropZone.setAttribute('data-input-id', 'turn');
        turnDropZone.addEventListener('dragover', handleDragOver);
        turnDropZone.addEventListener('dragenter', handleDragEnter);
        turnDropZone.addEventListener('dragleave', handleDragLeave);
        turnDropZone.addEventListener('drop', handleDrop);
        const turnInput = document.createElement('input');
        turnInput.type = 'hidden';
        turnInput.id = 'turn';
        const turnContainer = document.createElement('div');
        turnContainer.appendChild(turnDropZone);
        turnContainer.appendChild(turnInput);
        turnSection.appendChild(turnContainer);
        communityCardsRow.appendChild(turnSection);
        
        // River
        const riverSection = document.createElement('div');
        riverSection.classList.add('section-container');
        const riverLabel = document.createElement('div');
        riverLabel.classList.add('community-label');
        riverLabel.textContent = 'River';
        riverSection.appendChild(riverLabel);
        const riverDropZone = document.createElement('div');
        riverDropZone.classList.add('community-drop-zone');
        riverDropZone.setAttribute('data-input-id', 'river');
        riverDropZone.addEventListener('dragover', handleDragOver);
        riverDropZone.addEventListener('dragenter', handleDragEnter);
        riverDropZone.addEventListener('dragleave', handleDragLeave);
        riverDropZone.addEventListener('drop', handleDrop);
        const riverInput = document.createElement('input');
        riverInput.type = 'hidden';
        riverInput.id = 'river';
        const riverContainer = document.createElement('div');
        riverContainer.appendChild(riverDropZone);
        riverContainer.appendChild(riverInput);
        riverSection.appendChild(riverContainer);
        communityCardsRow.appendChild(riverSection);
        
        // Shuffle Button
        const shuffleButtonContainer = document.createElement('div');
        shuffleButtonContainer.classList.add('shuffle-button-container');
        const boardShuffleButton = document.createElement('button');
        boardShuffleButton.className = 'player-shuffle-button board-shuffle';
        boardShuffleButton.title = t('sim.shuffleBoard');
        boardShuffleButton.setAttribute('aria-label', t('sim.shuffleBoard'));
        boardShuffleButton.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12,4V1L8,5L12,9V6C15.31,6 18,8.69 18,12C18,13.01 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12C20,7.58 16.42,4 12,4Z"></path><path d="M12,18C8.69,18 6,15.31 6,12C6,10.99 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12C4,16.42 7.58,20 12,20V23L16,19L12,15V18Z"></path></svg>`;
        boardShuffleButton.addEventListener('click', () => {
            randomizeBoardCards();
            if (checkAllPlayersHaveCards()) runSimulation();
        });
        shuffleButtonContainer.appendChild(boardShuffleButton);
        communityCardsRow.appendChild(shuffleButtonContainer);
        
        communityCards.appendChild(communityCardsRow);
        pokerTable.appendChild(communityCards);
        pokerTableContainer.appendChild(pokerTable);
        playersContainer.appendChild(pokerTableContainer);

        // Hero Stats Container
        const heroStatsContainer = document.createElement('div');
        heroStatsContainer.id = 'heroStatsContainer';
        heroStatsContainer.className = 'hero-stats-container';
        heroStatsContainer.innerHTML = `
            <div class="hero-stats-title">${t('sim.heroDistribution')}</div>
            <div id="heroStatsTrack" class="hero-bar-track"></div>
            <div id="heroStatsLegend" class="hero-stats-legend"></div>
            ${isHiLoGame() ? '<div id="heroLowLine" class="hero-low-line"></div>' : ''}
        `;
        playersContainer.appendChild(heroStatsContainer);
        // Täytä placeholder heti, jotta palkki ja selite varaavat tilansa alusta asti
        displayHeroStats(null);
        displayHeroLowLine(null, 0);
        
        const cardsPerPlayer = getCardsPerPlayer();
        
        // Pelaajat asetetaan ellipsille. Pystysäde määräytyy siitä, että
        // vierekkäisten ruutujen pitää mahtua allekkain: mitä enemmän
        // pelaajia, sitä pienempi kulmaero ja sitä enemmän sädettä tarvitaan.
        // Otsikko + kortit + 5 tilastoriviä + palkki. Korttien osuus luetaan
        // tokenista, jotta korkeampi kortti kasvattaa myös pystysäteen.
        // Hi/Lo:ssa rivejä on kolme enemmän (osuus, voitot ja tasapelit
        // puoliskoittain), joten ruutu on sen verran korkeampi.
        const HILO_EXTRA_ROWS = 3;
        const STAT_ROW_HEIGHT = 18;
        const NON_CARD_BOX_HEIGHT = 136 + (isHiLoGame() ? HILO_EXTRA_ROWS * STAT_ROW_HEIGHT : 0);
        const PLAYER_BOX_HEIGHT = NON_CARD_BOX_HEIGHT + cardMetrics(cardsPerPlayer).h;
        // Sekoitus- ja fold-napit istuvat ruudun oikean reunan ulkopuolella:
        // CSS asettaa ne right: -24px, ja .player-input:n 8 px padding syö
        // siitä osan, joten näkyvä ala on 16 px ruutua leveämpi. Ilman tätä
        // napit jäävät naapuriruudun alle.
        const BUTTON_OVERHANG = 16;
        // Ruudun leveys johdetaan korttien mitoista: kortit + niiden välit +
        // .player-input:n 8 px padding molemmin puolin + pieni pelivara.
        // Sama luku menee sekä säteen laskentaan että ruudun tyyliin, joten
        // CSS:n ja JS:n arvot eivät voi ajautua erilleen.
        const playerBoxWidth = seatWidth(cardsPerPlayer);
        const playerVisualWidth = playerBoxWidth + BUTTON_OVERHANG;

        let radiusX, radiusY;
        if (playerCount <= 4) { radiusX = 300; radiusY = 200; }
        else if (playerCount <= 6) { radiusX = 320; radiusY = 225; }
        else if (playerCount <= 8) { radiusX = 340; radiusY = 260; }
        else { radiusX = 360; radiusY = 300; }

        if (currentGameType === 'omaha5') {
            radiusX += 50;
        }

        // Kasvata ellipsiä kunnes vierekkäiset ruudut eivät enää osu toisiinsa.
        // Ehto lasketaan ruudun mitoista, joten asettelu korjaa itsensä jos
        // tilastoruutuun lisätään myöhemmin rivejä.
        //
        // Molempia säteitä kasvatetaan yhdessä: osa pareista erkanee halvemmin
        // vaakasuunnassa (pöydän ylä- ja alalaidassa) ja osa pystysuunnassa
        // (sivuilla). Pelkkä pystykasvatus venyttäisi pöydän kohtuuttoman
        // korkeaksi - yhdeksän Omaha5-pelaajan pöydästä tuli 1070 px.
        const stepAngle = (2 * Math.PI) / playerCount;
        for (let guard = 0; guard < 60; guard++) {
            let collides = false;
            for (let i = 0; i < playerCount; i++) {
                const a1 = -i * stepAngle;
                const a2 = -(i + 1) * stepAngle;
                const dx = Math.abs(Math.sin(a1) - Math.sin(a2)) * radiusX;
                const dy = Math.abs(Math.cos(a1) - Math.cos(a2)) * radiusY;
                if (dx < playerVisualWidth && dy < PLAYER_BOX_HEIGHT) { collides = true; break; }
            }
            if (!collides) break;
            radiusX += 8;
            radiusY += 8;
        }

        // Pöydän koko johdetaan samasta geometriasta kuin pelaajien paikat,
        // jotta ruudut mahtuvat vihreälle alueelle kaikilla pelaajamäärillä.
        // Mobiilissa asettelu on pystysuora lista, joten kokoa ei aseteta.
        if (window.innerWidth > 767) {
            pokerTableContainer.style.maxWidth = (2 * radiusX + playerVisualWidth + 40) + 'px';
            pokerTableContainer.style.height = (2 * radiusY + PLAYER_BOX_HEIGHT) + 'px';
        }

        for (let i = 0; i < playerCount; i++) {
            const startAngle = 0;
            const angleStep = (2 * Math.PI) / playerCount;
            const angle = startAngle - i * angleStep;
            
            const x = Math.sin(angle) * radiusX;
            const y = Math.cos(angle) * radiusY;
            
            const playerPosition = document.createElement('div');
            playerPosition.classList.add('player-position');
            playerPosition.style.width = playerBoxWidth + 'px';
            playerPosition.style.top = '50%';
            playerPosition.style.left = '50%';
            playerPosition.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
            
            const playerDiv = document.createElement('div');
            playerDiv.classList.add('player-input');
            playerDiv.setAttribute('data-player-index', i);
            if (i === 0) playerDiv.classList.add('hero-player');
            
            const cardInputsDiv = document.createElement('div');
            cardInputsDiv.classList.add('card-inputs');
            if (cardsPerPlayer === 4) cardInputsDiv.classList.add('omaha');
            if (currentGameType === 'omaha5') cardInputsDiv.classList.add('omaha5');
            
            const cardDropZones = [];
            for (let j = 0; j < cardsPerPlayer; j++) {
                const cardDropZone = document.createElement('div');
                cardDropZone.classList.add('card-drop-zone');
                cardDropZone.setAttribute('data-input-id', `player${i}card${j+1}`);
                cardDropZone.addEventListener('dragover', handleDragOver);
                cardDropZone.addEventListener('dragenter', handleDragEnter);
                cardDropZone.addEventListener('dragleave', handleDragLeave);
                cardDropZone.addEventListener('drop', handleDrop);
                cardDropZones.push(cardDropZone);
                cardInputsDiv.appendChild(cardDropZone);
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.id = `player${i}card${j+1}`;
                cardInputsDiv.appendChild(hiddenInput);
            }
            
            const playerStats = document.createElement('div');
            playerStats.classList.add('player-stats');
            playerStats.id = `player${i}Stats`;
            // Hi/Lo:ssa "voitto" tarkoittaa koko potin scooppaamista ja
            // "tasapeli" mitä tahansa osapottia. Puoliskoista näytetään
            // kaksi eri suuretta omilla riveillään: osuus potista (mistä
            // equity muodostuu) ja voittotaajuus (kuinka usein puolisko
            // voitetaan yksin tai jaetaan). Kaikilla kolmella rivillä
            // ensimmäinen luku on hi ja toinen lo.
            const hiloRows = isHiLoGame() ? `
                <div class="stat-row aux-row"><span class="label">${t('sim.stat.hiloShare')}</span> <span class="value hilo-value">-</span></div>
                <div class="stat-row aux-row"><span class="label">${t('sim.stat.hiloWin')}</span> <span class="value hilowin-value">-</span></div>
                <div class="stat-row aux-row"><span class="label">${t('sim.stat.hiloTie')}</span> <span class="value hilotie-value">-</span></div>` : '';
            playerStats.innerHTML = `
                <div class="stat-row"><span class="label">${t(isHiLoGame() ? 'sim.stat.scoop' : 'sim.stat.win')}</span> <span class="value win-value">-</span></div>
                <div class="stat-row"><span class="label">${t(isHiLoGame() ? 'sim.stat.split' : 'sim.stat.tie')}</span> <span class="value tie-value">-</span></div>
                <div class="stat-row"><span class="label">${t('sim.stat.equity')}</span> <span class="value equity-value">-</span></div>
                ${hiloRows}
                <div class="stat-row aux-row"><span class="label">${t('sim.stat.se')}</span> <span class="value se-value">-</span></div>
                <div class="stat-row aux-row"><span class="label">${t('sim.stat.exact')}</span> <span class="value exact-value">-</span></div>
                <div class="mini-progress-container"><div class="mini-progress-bar"></div></div>
            `;
            
            const cardContainer = document.createElement('div');
            cardContainer.style.position = 'relative';
            cardContainer.appendChild(cardInputsDiv);
            
            // Shuffle
            const shuffleButton = document.createElement('button');
            shuffleButton.className = 'player-shuffle-button';
            shuffleButton.title = t('sim.shufflePlayer');
            shuffleButton.setAttribute('aria-label', t('sim.shufflePlayerAria', { n: i + 1 }));
            shuffleButton.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12,4V1L8,5L12,9V6C15.31,6 18,8.69 18,12C18,13.01 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12C20,7.58 16.42,4 12,4Z"></path><path d="M12,18C8.69,18 6,15.31 6,12C6,10.99 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12C4,16.42 7.58,20 12,20V23L16,19L12,15V18Z"></path></svg>`;
            shuffleButton.addEventListener('click', (e) => {
                e.preventDefault();
                const playerDiv = e.target.closest('.player-input');
                const playerIndex = parseInt(playerDiv.getAttribute('data-player-index'));
                
                if (isRandomOpponentsMode() && playerIndex !== 0) return;

                playerDiv.classList.remove('folded');
                playerDiv.setAttribute('data-folded', 'false');
                
                const dropZones = Array.from(cardInputsDiv.querySelectorAll('.card-drop-zone'));
                dropZones.forEach(zone => {
                    if (zone.classList.contains('filled')) removeCardFromDropZone(zone);
                });
                
                const playerCards = [];
                for (let j = 0; j < cardsPerPlayer; j++) {
                    const card = getRandomUnusedCard();
                    if (!card) break;
                    playerCards.push(card);
                    usedCards.add(card);
                }
                
                if (playerCards.length === cardsPerPlayer) {
                    for (let j = 0; j < cardsPerPlayer; j++) {
                        simulateCardDrop(dropZones[j], playerCards[j]);
                    }
                }
                if (checkAllPlayersHaveCards()) runSimulation();
            });
            cardContainer.appendChild(shuffleButton);

            // Fold
            const foldButton = document.createElement('button');
            foldButton.className = 'player-fold-button';
            foldButton.title = t('sim.fold');
            foldButton.setAttribute('aria-label', t('sim.foldAria', { n: i + 1 }));
            foldButton.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path></svg>`;
            foldButton.addEventListener('click', (e) => {
                e.preventDefault();
                const playerDiv = e.target.closest('.player-input');
                const playerIndex = parseInt(playerDiv.getAttribute('data-player-index'));
                
                if (isRandomOpponentsMode() && playerIndex !== 0) return;

                const isFolded = playerDiv.classList.toggle('folded');
                playerDiv.setAttribute('data-folded', isFolded);
                if (checkAllPlayersHaveCards()) runSimulation();
            });
            cardContainer.appendChild(foldButton);

            // Käsialueen säädin korttien päälle (näkyy vain tuntemattomien
            // vastustajien tilassa, ks. CSS .random-opponent .range-control)
            if (i > 0) RangeUI.mount(i, cardContainer);

            playerDiv.appendChild(cardContainer);
            playerDiv.appendChild(playerStats);
            playerPosition.appendChild(playerDiv);
            pokerTableContainer.appendChild(playerPosition);
        }
        
        toggleRandomOpponentsMode();
    }
    
    function toggleRandomOpponentsMode() {
        const isRandom = isRandomOpponentsMode();
        const playerInputs = document.querySelectorAll('.player-input');
        
        playerInputs.forEach((playerDiv, index) => {
            if (index === 0) return;
            
            const dropZones = playerDiv.querySelectorAll('.card-drop-zone');
            
            if (isRandom) {
                dropZones.forEach(zone => {
                    if (zone.classList.contains('filled')) {
                        removeCardFromDropZone(zone);
                    }
                });
                playerDiv.classList.add('random-opponent');
            } else {
                playerDiv.classList.remove('random-opponent');
            }
        });
        rangeSetting.hidden = !isRandom;
        if (!isRandom) RangeUI.hidePopover();

        if (isRandom && checkAllPlayersHaveCards()) {
            runSimulation();
        }
    }

    // Valitsimien liukuva korostus seuraa valittua vaihtoehtoa CSS:ssä
    // (:has), joten tässä ei ylläpidetä luokkia
    opponentModeRadios.forEach(radio => {
        radio.addEventListener('change', () => toggleRandomOpponentsMode());
    });

    function collectPlayerHands() {
        const playerCount = parseInt(playerCountSelect.value);
        const playerHands = [];
        const cardsPerPlayer = getCardsPerPlayer();
        const isRandomOpponents = isRandomOpponentsMode();
        
        for (let i = 0; i < playerCount; i++) {
            const hand = [];
            const playerDiv = document.querySelector(`.player-input[data-player-index="${i}"]`);
            const isFolded = playerDiv ? playerDiv.classList.contains('folded') : false;
            
            for (let j = 1; j <= cardsPerPlayer; j++) {
                const cardInput = document.getElementById(`player${i}card${j}`);
                const card = cardInput ? cardInput.value.trim() : '';

                if (isRandomOpponents) {
                    if (i === 0 && !isFolded && !card) {
                        showNotice(t('sim.heroCardsMissing'));
                        return null;
                    }
                } else {
                    if (!isFolded && !card) {
                        showNotice(t('sim.playerCardsMissing', { n: i + 1 }));
                        return null;
                    }
                }
                
                hand.push(card || '');
            }

            const entry = { hand, isFolded };
            // Käsialue: vain tuntemattomille vastustajille; 100 = kaikki
            // kädet, jolloin kenttää ei lähetetä lainkaan
            if (isRandomOpponents && i > 0 && !isFolded) {
                const pct = RangeUI.pctFor(i);
                if (pct < 100) entry.rangePct = pct;
            }
            playerHands.push(entry);
        }

        return playerHands;
    }

    // Kuvaus vastustajien alueista ilmoitusriville, esim. "P2 top 10 %, P3 top 40 %"
    function describeRanges(playerHandsData) {
        return playerHandsData
            .map((p, i) => (i > 0 && !p.isFolded && p.rangePct < 100) ? `P${i + 1} ${t('sim.rangeTop', { pct: p.rangePct }).toLowerCase()}` : null)
            .filter(Boolean)
            .join(', ');
    }
    
    function collectCommunityCards() {
        const communityCards = { flop: [], turn: null, river: null };
        for (let i = 0; i < 3; i++) {
            const val = document.getElementById(`flop${i}`).value.trim();
            if (val) communityCards.flop.push(val);
        }
        const t = document.getElementById('turn').value.trim(); if(t) communityCards.turn = t;
        const r = document.getElementById('river').value.trim(); if(r) communityCards.river = r;
        return communityCards;
    }
    
    async function runSimulation() {
        const playerHandsData = collectPlayerHands();
        if (!playerHandsData) return;

        const activePlayers = playerHandsData.filter(p => !p.isFolded);
        const isRandomOpponents = isRandomOpponentsMode();

        if (!isRandomOpponents && activePlayers.length < 2) {
            showNotice(t('sim.needTwoPlayers'));
            return;
        }
        if (isRandomOpponents && playerHandsData[0].isFolded) {
            showNotice(t('sim.heroFolded'));
            return;
        }

        // Käsialueet: hae luokka-avaimet ennen ajoa (välimuistista heti
        // ensimmäisen jälkeen). Haku on asynkroninen, joten uusi käynnistys
        // sen aikana mitätöi tämän - muuten kaksi ajoa lähtisi peräkkäin.
        // Token kasvatetaan jokaisella käynnistyksellä (myös ilman alueita),
        // peruutuksella ja pöydän uudelleenrakennuksella, jotta odottava ajo
        // ei koskaan lähde vanhentuneilla tiedoilla.
        const token = ++rangeFetchToken;
        const hasRanges = isRandomOpponents && RangeUI.anyRange(playerHandsData);
        if (hasRanges) {
            try {
                await RangeUI.attachKeys(playerHandsData, currentGameType, activePlayers.length);
            } catch (e) {
                if (token !== rangeFetchToken) return;
                showNotice(e && e.status === 404 ? t('sim.rangeNoTable') : t('sim.rangeFetchFailed'));
                return;
            }
            if (token !== rangeFetchToken) return;
        }

        let simulationCount = parseInt(simulationCountInput.value);
        if (simulationCount < 100) { simulationCount = 100; simulationCountInput.value = 100; }
        // Selaimessa laskee oma kone, joten katto voi olla korkea. Palvelin
        // rajaa oman polkunsa erikseen (SERVER_MAX_SIMULATIONS).
        if (simulationCount > MAX_SIMULATIONS) {
            simulationCount = MAX_SIMULATIONS;
            simulationCountInput.value = MAX_SIMULATIONS;
        }
        
        const communityCards = collectCommunityCards();

        clearNotice();
        if (hasRanges) showNotice(t('sim.rangeNote', { list: describeRanges(playerHandsData) }));
        // Karkea kestoarvio (mitatut yksikkökustannukset, selain ~1.5x Node).
        // Omaha5 on ~80x Hold'emia raskaampi per kierros, joten sama
        // kierrosmäärä voi olla 0.7 s tai lähes minuutin - isosta ajosta
        // kerrotaan etukäteen eikä anneta sen yllättää.
        const SIM_COST_PER_PLAYER = { holdem: 1.0e-7, omaha: 4.8e-6, omaha5: 8.0e-6, omahahilo: 6.5e-6 };
        const estSeconds = simulationCount * activePlayers.length *
            SIM_COST_PER_PLAYER[currentGameType];
        if (estSeconds > 4) {
            showNotice(t('sim.bigRun', {
                n: simulationCount.toLocaleString(locale),
                s: Math.round(estSeconds)
            }));
        }
        resetExactRows();
        runSimulationButton.disabled = true;
        loadingIndicator.classList.remove('invisible');
        cancelSimulationButton.classList.remove('invisible');

        // Edellinen ajo (simulaatio tai tarkka enumerointi) on kesken: tapa
        // worker, muuten uuden ajon viesti jonottaisi sen takana jopa ~10 s.
        // Worker käsittelee viestit peräkkäin eikä keskeneräistä laskentaa
        // voi keskeyttää muuten.
        if (pokerWorker && (currentPlayerHandsData || exactInFlight)) {
            pokerWorker.terminate();
            pokerWorker = null;
            initWorker();
        }
        exactInFlight = false;
        // Keskeytä myös mahdollinen edellisen ajon palvelinpyyntö
        if (serverAbortController) {
            serverAbortController.abort();
        }
        const runId = ++currentRunId;

        // Tallenna playerHandsData workerin tuloksen käsittelyä varten
        currentPlayerHandsData = playerHandsData;

        // Käytä Web Workeria jos saatavilla
        if (pokerWorker) {
            const data = {
                playerHandsData,
                communityCards,
                simulationCount,
                gameType: currentGameType,
                randomOpponents: isRandomOpponents
            };

            pokerWorker.postMessage({ data, runId });
            // Käsialueita vastaan taulukon equity ei päde ("vs. satunnaiset
            // kädet"), mutta sija näytetään silti - selvästi merkittynä
            fetchPreflopExact(playerHandsData, communityCards,
                hasRanges ? describeRanges(playerHandsData) : null);
            return;
        }
        
        // Fallback: käytä palvelinta
        await runServerSimulation();
    }
    
    async function runServerSimulation() {
        const playerHandsData = currentPlayerHandsData || collectPlayerHands();
        if (!playerHandsData) {
            finishSimulation();
            return;
        }
        
        const requested = parseInt(simulationCountInput.value);
        let simulationCount = requested;
        if (simulationCount > SERVER_MAX_SIMULATIONS) {
            // Varapolulla laskenta tapahtuu palvelimella, joten määrä rajataan
            simulationCount = SERVER_MAX_SIMULATIONS;
        }
        const communityCards = collectCommunityCards();
        const isRandomOpponents = isRandomOpponentsMode();

        serverAbortController = new AbortController();
        try {
            const response = await fetch('/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // Avaimet jäävät pois: palvelin ratkaisee alueen itse
                    // rangePct:stä (eikä Omaha5:n 40 000 avainta kulje verkossa)
                    playerHandsData: playerHandsData.map(({ hand, isFolded, rangePct }) =>
                        rangePct !== undefined ? { hand, isFolded, rangePct } : { hand, isFolded }),
                    communityCards,
                    simulationCount,
                    gameType: currentGameType,
                    randomOpponents: isRandomOpponents
                }),
                signal: serverAbortController.signal
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(window.I18N.apiError(errorData, 'sim.requestFailed'));
            }

            const data = await response.json();
            displayResults(data.results, playerHandsData);
            if (requested > SERVER_MAX_SIMULATIONS) {
                // Älä pudota kierrosmäärää hiljaa - keskivirhe on isompi
                // kuin käyttäjän pyytämällä määrällä olisi ollut
                showNotice(t('sim.serverTruncated', {
                    count: SERVER_MAX_SIMULATIONS.toLocaleString(locale),
                    requested: requested.toLocaleString(locale)
                }));
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                showNotice(t('sim.errorPrefix', { msg: error.message }));
            }
        } finally {
            serverAbortController = null;
            finishSimulation();
        }
    }
    
    // Esilaskettujen preflop-vastausten välimuisti: sama käsi ja
    // pelaajamäärä haetaan palvelimelta vain kerran per istunto - säästää
    // hakureitin rate limitiä, kun simulaatioita ajetaan peräkkäin
    const preflopCache = new Map();

    /** Näytä esilaskettu preflop-arvo tilastorivillä ja ilmoituksessa */
    function renderPreflopInfo(data, rangeList) {
        // Sija näytetään välinä jos keskivirhe ei riitä naulaamaan sitä:
        // esim. Omaha5:n keskivaiheilla todellinen sija voi olla ±sadat
        const fmt = n => n.toLocaleString(locale);
        const rankText = (data.rankHigh > data.rankLow)
            ? t('sim.rankRange', { rank: fmt(data.rank), low: fmt(data.rankLow), high: fmt(data.rankHigh) })
            : t('sim.rank', { rank: fmt(data.rank) });
        // Kombopainotettu top-%: sama esitys kuin rankingsivulla (parhaat
        // kädet tarvitsevat kaksi desimaalia, AA = 0,45 %)
        const top = typeof data.topPct === 'number'
            ? data.topPct.toLocaleString(locale, {
                minimumFractionDigits: data.topPct < 10 ? 2 : 1,
                maximumFractionDigits: data.topPct < 10 ? 2 : 1
            }) + ' %'
            : '?';

        if (rangeList) {
            // Käsialueita vastaan taulukon equity ei päde (se on vs.
            // satunnaiset kädet), joten "Tarkka"-riville ei kirjoiteta
            // mitään. Sija kertoo silti käden vahvuuden kaikkiin käsiin
            // nähden - näytetään ilmoituksessa selvästi merkittynä.
            showNotice(t('sim.rangeNoteRank', {
                list: rangeList, rank: rankText, classes: fmt(data.handClasses), top
            }));
            return;
        }

        const playerStats = document.getElementById('player0Stats');
        const el = playerStats && playerStats.querySelector('.exact-value');
        if (el) el.textContent = `${data.equity.toFixed(2)}%`;
        showNotice(data.exact
            ? t('sim.preflopExact', {
                equity: data.equity.toFixed(4), rank: rankText, classes: fmt(data.handClasses), top
            })
            : t('sim.preflopHybrid', {
                equity: data.equity.toFixed(4), se: data.standardError.toFixed(4),
                rank: rankText, classes: fmt(data.handClasses), top
            }));
    }

    /**
     * Preflop tuntemattomia vastustajia vastaan ei ole enumeroitavissa, mutta
     * vastaus on esilaskettu levylle. Haetaan se simulaation rinnalle.
     * Omahan heads-up on eksakti, muut kertovat oman keskivirheensä.
     */
    async function fetchPreflopExact(playerHandsData, communityCards, rangeList) {
        if (!isRandomOpponentsMode()) return;
        if (!['holdem', 'omaha', 'omaha5', 'omahahilo'].includes(currentGameType)) return;

        const hasBoard = (communityCards.flop && communityCards.flop.length > 0) ||
            communityCards.turn || communityCards.river;
        if (hasBoard) return;

        const hero = playerHandsData[0];
        if (!hero || hero.isFolded) return;
        const heroCards = hero.hand.filter(c => c);
        if (heroCards.length !== getCardsPerPlayer()) return;

        // Foldanneet eivät ole vastustajia
        const players = 1 + playerHandsData.filter((p, i) => i > 0 && !p.isFolded).length;

        // Sama kysely on voitu tehdä jo - kortit lajitellaan, jotta
        // järjestys ei tuota eri avainta samalle kädelle
        const cacheKey = `${currentGameType}:${players}:${heroCards.slice().sort().join(',')}`;
        if (preflopCache.has(cacheKey)) {
            const cached = preflopCache.get(cacheKey);
            if (cached) renderPreflopInfo(cached, rangeList);
            return;
        }

        // Kuittaa vastaus vain jos sama ajo on yhä käynnissä - muuten
        // edellisen ajon myöhässä saapuva arvo kirjoittuisi uuden päälle
        const runId = currentRunId;
        try {
            const params = new URLSearchParams({
                gameType: currentGameType,
                players: String(players),
                hand: heroCards.join(',')
            });
            const response = await fetch(`/preflop?${params}`);
            if (!response.ok) {
                // Puuttuva taulukko on pysyvä tila - merkitään ettei kysytä
                // uudelleen; muut virheet (esim. rate limit) saavat yrittää
                if (response.status === 404) preflopCache.set(cacheKey, null);
                return;
            }
            const data = await response.json();
            preflopCache.set(cacheKey, data);
            if (runId !== currentRunId) return;   // uusi ajo ehti alkaa
            renderPreflopInfo(data, rangeList);
        } catch (e) {
            // Haku on lisätieto - jos se ei onnistu, simulaatio riittää
        }
    }

    // Tyhjennä tarkan arvon rivit uuden ajon alkaessa
    function resetExactRows() {
        document.querySelectorAll('.exact-value').forEach(el => { el.textContent = '-'; });
    }

    function showExactPending() {
        document.querySelectorAll('.exact-value').forEach(el => { el.textContent = '…'; });
    }

    /**
     * Näytä tarkka, enumeroimalla laskettu equity simulaation rinnalla.
     * Simulaatio on jo näkyvissä; tämä täydentää sen.
     */
    function displayExact(result) {
        if (!lastPlayerHandsData) return;
        const isRandomOpponents = isRandomOpponentsMode();

        lastPlayerHandsData.forEach((playerData, index) => {
            const playerStats = document.getElementById(`player${index}Stats`);
            if (!playerStats) return;
            const el = playerStats.querySelector('.exact-value');
            if (!el) return;
            // Käsialueen vastustajalle tarkka arvo näytetään kuten kiinteälle
            if (playerData.isFolded || (isRandomOpponents && index > 0 && !(playerData.rangePct < 100))) {
                el.textContent = '-';
            } else {
                el.textContent = `${result.equityPercentages[index].toFixed(2)}%`;
            }
        });

        showNotice(result.rangeCombos > 1
            ? t('sim.exactDoneRange', { c: result.rangeCombos.toLocaleString(locale), n: result.boards.toLocaleString(locale) })
            : t('sim.exactDone', { n: result.boards.toLocaleString(locale) }));
    }

    function displayResults(results, playerHandsData) {
        const { winCounts, tieCounts, winPercentages, tiePercentages, equityPercentages, simulationCount, heroHandStats } = results;
        const isRandomOpponents = isRandomOpponentsMode();

        // Equity tulee laskentamoottorilta valmiina, koska jaetun potin osuus
        // on 1/voittajien määrä. Vanha kaava voitto + tasapeli/2 yliarvioi
        // equityn aina kun potti jakautuu useammalle kuin kahdelle.
        const equityAt = index => (Array.isArray(equityPercentages) && equityPercentages[index] !== undefined)
            ? equityPercentages[index]
            : winPercentages[index] + tiePercentages[index] / 2;
        // Keskivirhe kertoo kuinka paljon tulos heiluisi uudella ajolla.
        // Se on Monte Carlon olennaisin luku, joten se näytetään equityn vieressä.
        const seAt = index => (Array.isArray(results.standardErrors) && results.standardErrors[index] !== undefined)
            ? results.standardErrors[index]
            : 0;

        lastPlayerHandsData = playerHandsData;

        playerHandsData.forEach((playerData, index) => {
            const playerStats = document.getElementById(`player${index}Stats`);
            if (playerStats) {
                const hiloEls = ['.hilo-value', '.hilowin-value', '.hilotie-value']
                    .map(s => playerStats.querySelector(s));
                const clearHiLo = () => hiloEls.forEach(el => { if (el) el.textContent = '-'; });
                if (playerData.isFolded) {
                    playerStats.querySelector('.win-value').textContent = t('sim.folded');
                    playerStats.querySelector('.tie-value').textContent = '-';
                    playerStats.querySelector('.equity-value').textContent = '-';
                    playerStats.querySelector('.se-value').textContent = '-';
                    clearHiLo();
                    playerStats.querySelector('.mini-progress-bar').style.width = '0%';
                } else if (isRandomOpponents && index > 0 && !(playerData.rangePct < 100)) {
                    // Tuntemattomien vastustajien todennäköisyyksiä ei näytetä:
                    // kädet vaihtuvat joka jaossa, joten prosentit eivät kerro mitään.
                    // Käsialueen vastustajalle ne näytetään: "top 10 %:n käsi
                    // voittaa X %" on mielekäs luku.
                    playerStats.querySelector('.win-value').textContent = '-';
                    playerStats.querySelector('.tie-value').textContent = '-';
                    playerStats.querySelector('.equity-value').textContent = '-';
                    playerStats.querySelector('.se-value').textContent = '-';
                    clearHiLo();
                    playerStats.querySelector('.mini-progress-bar').style.width = '0%';
                } else {
                    const winPercent = winPercentages[index].toFixed(2);
                    const tiePercent = tiePercentages[index].toFixed(2);
                    const totalEquity = equityAt(index).toFixed(2);

                    playerStats.querySelector('.win-value').textContent = `${winPercent}%`;
                    playerStats.querySelector('.tie-value').textContent = `${tiePercent}%`;
                    const se = seAt(index);
                    playerStats.querySelector('.equity-value').textContent = `${totalEquity}%`;
                    playerStats.querySelector('.se-value').textContent =
                        se > 0 ? `± ${se.toFixed(2)}` : '-';

                    // Hi/Lo-rivit. Osuus: kuinka suuren osan koko potista
                    // pelaaja saa kummankin puoliskon kautta (hi sisältää
                    // koko potin kun low'ta ei syntynyt, joten hi + lo =
                    // equity). Voitto/tasan: kuinka usein puolisko voitetaan
                    // yksin tai jaetaan - eri suure, koska hi-voitto tuo
                    // koko potin vain low-kelvottomalla pöydällä.
                    const pair = (a, b) => `${a[index].toFixed(1)} / ${b[index].toFixed(1)}`;
                    if (hiloEls[0] && Array.isArray(results.hiEquityPercentages)) {
                        hiloEls[0].textContent = pair(results.hiEquityPercentages, results.loEquityPercentages);
                    }
                    if (hiloEls[1] && Array.isArray(results.hiWinPercentages)) {
                        hiloEls[1].textContent = pair(results.hiWinPercentages, results.loWinPercentages);
                        hiloEls[2].textContent = pair(results.hiTiePercentages, results.loTiePercentages);
                    }

                    const progressBar = playerStats.querySelector('.mini-progress-bar');
                    if (progressBar) progressBar.style.width = `${totalEquity}%`;
                }
                playerStats.classList.add('visible');
            }
        });

        displayHeroStats(heroHandStats || null);
        displayHeroLowLine(results.hiLoStats || null, simulationCount);
    }

    // Heron low-rivi käsijakauman alla: kuinka usein hero sai kelvollisen
    // low'n ja kuinka usein pöytä jäi kokonaan ilman low'ta. Low-puoliskon
    // voittaminen ja jakaminen näkyvät pelaajaruudun omilla riveillään,
    // joten niitä ei toisteta tässä. Näytetään vain Hi/Lo-pelissä.
    function displayHeroLowLine(hiLoStats, simulationCount) {
        const el = document.getElementById('heroLowLine');
        if (!el) return;
        if (!hiLoStats || !simulationCount) {
            el.textContent = t('sim.lowLineEmpty');
            return;
        }
        const pct = x => ((100 * x) / simulationCount).toFixed(1);
        el.textContent = t('sim.lowLine', {
            made: pct(hiLoStats.heroLowMade),
            nolow: pct(hiLoStats.noLowRounds)
        });
    }

    // Näytä heron käsijakauma. Ilman tuloksia (null/tyhjä) näytetään
    // placeholder: tyhjä harmaa palkki ja kaikki käsityypit viivalla.
    // Selitteessä on aina kaikki käsityypit, jotta sen koko ei muutu.
    function displayHeroStats(heroHandStats) {
        const track = document.getElementById('heroStatsTrack');
        const legend = document.getElementById('heroStatsLegend');
        if (!track || !legend) return;

        track.innerHTML = '';
        legend.innerHTML = '';

        const totalHands = heroHandStats
            ? Object.values(heroHandStats).reduce((a, b) => a + b, 0)
            : 0;
        const hasResults = totalHands > 0;

        handOrder.forEach(handName => {
            const count = hasResults ? (heroHandStats[handName] || 0) : 0;
            const percentage = hasResults ? (count / totalHands) * 100 : 0;
            const translatedName = t('hand.' + handName);
            const color = handColors[handName] || '#999';

            if (percentage > 0) {
                const segment = document.createElement('div');
                segment.className = 'hero-bar-segment';
                segment.style.width = `${percentage.toFixed(1)}%`;
                segment.style.backgroundColor = color;
                segment.setAttribute('data-tooltip', `${translatedName}: ${percentage.toFixed(1)}%`);
                if (percentage > 5) segment.textContent = `${percentage.toFixed(1)}%`;
                track.appendChild(segment);
            }

            const legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            const dot = document.createElement('div');
            dot.className = 'legend-dot';
            dot.style.backgroundColor = color;
            const text = document.createElement('span');
            text.textContent = hasResults
                ? `${translatedName} (${percentage.toFixed(1)}%)`
                : `${translatedName} (–)`;

            legendItem.appendChild(dot);
            legendItem.appendChild(text);
            legend.appendChild(legendItem);
        });
    }
    
    function resetPlayerStats() {
        const statElements = document.querySelectorAll('.player-stats');
        statElements.forEach(element => {
            element.classList.remove('visible');
            element.querySelector('.win-value').textContent = '-';
            element.querySelector('.tie-value').textContent = '-';
            element.querySelector('.equity-value').textContent = '-';
            element.querySelector('.se-value').textContent = '-';
            element.querySelector('.exact-value').textContent = '-';
            element.querySelectorAll('.hilo-value, .hilowin-value, .hilotie-value')
                .forEach(el => { el.textContent = '-'; });
            element.querySelector('.mini-progress-bar').style.width = '0%';
        });
        // Palauta käsijakauma placeholder-tilaan (harmaa palkki, viivat)
        displayHeroStats(null);
        displayHeroLowLine(null, 0);
    }
    
    function getRandomUnusedCard() {
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
        const suits = ['s', 'h', 'd', 'c'];
        const allCards = [];
        for (const suit of suits) for (const rank of ranks) { const c = rank+suit; if(!usedCards.has(c)) allCards.push(c); }
        if (allCards.length === 0) return null;
        return allCards[Math.floor(Math.random() * allCards.length)];
    }
    
    function randomizePlayerCards() {
        const allDropZones = document.querySelectorAll('.card-drop-zone, .community-drop-zone');
        allDropZones.forEach(zone => { if (zone.classList.contains('filled')) removeCardFromDropZone(zone); });
        
        const allPlayerDivs = document.querySelectorAll('.player-input');
        allPlayerDivs.forEach(div => { div.classList.remove('folded'); div.setAttribute('data-folded', 'false'); });

        const playerCount = parseInt(playerCountSelect.value);
        const cardsPerPlayer = getCardsPerPlayer();
        const isRandomOpponents = isRandomOpponentsMode();

        for (let i = 0; i < playerCount; i++) {
            if (isRandomOpponents && i > 0) continue;

            const dropZones = [];
            for (let j = 1; j <= cardsPerPlayer; j++) {
                dropZones.push(document.querySelector(`[data-input-id="player${i}card${j}"]`));
            }
            const playerCards = [];
            for (let j = 0; j < cardsPerPlayer; j++) {
                const card = getRandomUnusedCard();
                if (!card) { playerCards.forEach(c => usedCards.delete(c)); break; }
                playerCards.push(card);
                usedCards.add(card);
            }
            if (playerCards.length === cardsPerPlayer) {
                for (let j = 0; j < cardsPerPlayer; j++) simulateCardDrop(dropZones[j], playerCards[j]);
            }
        }
        boardState = 'none';
    }
    
    function simulateCardDrop(dropZone, cardValue) {
        if (!dropZone || !cardValue) return;
        dropZone.classList.add('filled');
        dropZone.setAttribute('data-card', cardValue);
        dropZone.innerHTML = '';
        const cardElement = document.createElement('div');
        cardElement.classList.add('dropped-card');
        const rank = cardValue[0];
        const suit = cardValue[1];
        let suitName, suitSymbol;
        if (suit === 's') { suitName = 'spades'; suitSymbol = '♠'; }
        else if (suit === 'h') { suitName = 'hearts'; suitSymbol = '♥'; }
        else if (suit === 'd') { suitName = 'diamonds'; suitSymbol = '♦'; }
        else if (suit === 'c') { suitName = 'clubs'; suitSymbol = '♣'; }
        
        cardElement.classList.add(suitName);
        if (currentDeckColor === 'fourcolor') cardElement.classList.add('fourcolor');

        buildCardFace(cardElement, rank, suitSymbol);

        cardElement.appendChild(createRemoveButton(dropZone));
        dropZone.appendChild(cardElement);
        
        const inputId = dropZone.getAttribute('data-input-id');
        const inputField = document.getElementById(inputId);
        if (inputField) inputField.value = cardValue;
        
        const deckCard = document.querySelector(`.deck-card[data-card="${cardValue}"]`);
        if (deckCard) deckCard.classList.add('used');
    }
    
    function randomizeBoardCards() {
        const flopDropZones = [
            document.querySelector('[data-input-id="flop0"]'),
            document.querySelector('[data-input-id="flop1"]'),
            document.querySelector('[data-input-id="flop2"]')
        ];
        const turnDropZone = document.querySelector('[data-input-id="turn"]');
        const riverDropZone = document.querySelector('[data-input-id="river"]');
        const communityDropZones = document.querySelectorAll('.community-drop-zone');

        if (boardState === 'none' || boardState === 'cleared') {
            boardState = 'none';
            for (let i = 0; i < 3; i++) {
                const card = getRandomUnusedCard();
                if (!card) return;
                usedCards.add(card);
                simulateCardDrop(flopDropZones[i], card);
            }
            boardState = 'flop';
        } else if (boardState === 'flop') {
            if (turnDropZone.classList.contains('filled')) removeCardFromDropZone(turnDropZone);
            const card = getRandomUnusedCard();
            if (!card) return;
            usedCards.add(card);
            simulateCardDrop(turnDropZone, card);
            boardState = 'turn';
        } else if (boardState === 'turn') {
            if (riverDropZone.classList.contains('filled')) removeCardFromDropZone(riverDropZone);
            const card = getRandomUnusedCard();
            if (!card) return;
            usedCards.add(card);
            simulateCardDrop(riverDropZone, card);
            boardState = 'river';
        } else if (boardState === 'river') {
            communityDropZones.forEach(zone => { if (zone.classList.contains('filled')) removeCardFromDropZone(zone); });
            boardState = 'cleared';
        }
    }
    
    function findFirstAvailableSlot() {
        const playerCount = parseInt(playerCountSelect.value);
        const cardsPerPlayer = getCardsPerPlayer();
        const isRandomOpponents = isRandomOpponentsMode();

        for (let i = 0; i < playerCount; i++) {
            if (isRandomOpponents && i > 0) continue;

            for (let j = 1; j <= cardsPerPlayer; j++) {
                const slotId = `player${i}card${j}`;
                const inputField = document.getElementById(slotId);
                if (inputField && !inputField.value) return document.querySelector(`[data-input-id="${slotId}"]`);
            }
        }
        
        for (let i = 0; i < 3; i++) {
            const slotId = `flop${i}`;
            const inputField = document.getElementById(slotId);
            if (inputField && !inputField.value) return document.querySelector(`[data-input-id="${slotId}"]`);
        }
        const turnInput = document.getElementById('turn'); 
        if (turnInput && !turnInput.value) return document.querySelector('[data-input-id="turn"]');
        const riverInput = document.getElementById('river'); 
        if (riverInput && !riverInput.value) return document.querySelector('[data-input-id="river"]');
        return null;
    }
    
    function checkAllPlayersHaveCards() {
        const playerCount = parseInt(playerCountSelect.value);
        const cardsPerPlayer = getCardsPerPlayer();
        const isRandomOpponents = isRandomOpponentsMode();

        for (let i = 0; i < playerCount; i++) {
            if (isRandomOpponents && i > 0) continue;

            const playerDiv = document.querySelector(`.player-input[data-player-index="${i}"]`);
            const isFolded = playerDiv ? playerDiv.classList.contains('folded') : false;
            if (!isFolded) {
                for (let j = 1; j <= cardsPerPlayer; j++) {
                    const cardInput = document.getElementById(`player${i}card${j}`);
                    const card = cardInput ? cardInput.value.trim() : '';
                    if (!card) return false;
                }
            }
        }
        return true;
    }
    
    function handleGameTypeChange() {
        const selectedRadio = document.querySelector('input[name="gameType"]:checked');
        currentGameType = selectedRadio.value;
        updatePlayerCountOptions();
        initializePlayerInputs();
        resetPlayerStats();
        boardState = 'none';
    }
    
    function updateDeckColors(color) {
        const allCards = document.querySelectorAll('.deck-card, .dropped-card');
        allCards.forEach(card => {
            if (color === 'fourcolor') card.classList.add('fourcolor');
            else card.classList.remove('fourcolor');
        });
        // Maatunnukset saavat värinsä CSS:stä: pakan .fourcolor-luokka
        // riittää kertomaan kumpi väritys on käytössä
        cardDeck.classList.toggle('fourcolor', color === 'fourcolor');
    }
    
    playerCountSelect.addEventListener('change', () => { 
        initializePlayerInputs(); 
        resetPlayerStats(); 
        boardState = 'none'; 
    });
    
    runSimulationButton.addEventListener('click', async () => {
        resetPlayerStats();
        await runSimulation();
    });

    cancelSimulationButton.addEventListener('click', () => {
        cancelSimulation();
    });
    
    randomizeCardsButton.addEventListener('click', async () => {
        randomizePlayerCards();
        resetPlayerStats();
        await runSimulation();
    });
    
    gameTypeRadios.forEach(radio => {
        radio.addEventListener('change', () => handleGameTypeChange());
    });
    
    deckColorRadios.forEach(radio => { 
        radio.addEventListener('change', (e) => { 
            currentDeckColor = e.target.value; 
            updateDeckColors(currentDeckColor); 
        }); 
    });
    
    function initUI() {
        cardDeck.innerHTML = ''; 
        playersContainer.innerHTML = '';
        createCardDeck(); 
        updatePlayerCountOptions();
        initializePlayerInputs(); 
        checkMobileView();
        initWorker();
        updateDeckColors(currentDeckColor);
    }
    
    function checkMobileView() {
        const isMobile = window.innerWidth <= 767;
        const playersContainer = document.getElementById('playersContainer');
        if (isMobile) {
            playersContainer.classList.add('mobile-layout');
            const pokerTableContainer = document.querySelector('.poker-table-container');
            if (pokerTableContainer) { 
                pokerTableContainer.style.display = 'flex'; 
                pokerTableContainer.style.flexDirection = 'column'; 
                // Työpöydän geometriasta johdettu koko ei päde pystylistassa
                pokerTableContainer.style.maxWidth = '';
                pokerTableContainer.style.height = '';
            }
            const playerStats = document.querySelectorAll('.player-stats');
            playerStats.forEach(statContainer => {
                statContainer.style.display = 'block';
                const statRows = statContainer.querySelectorAll('.stat-row');
                statRows.forEach(row => {
                    row.style.display = 'flex'; 
                    row.style.flexDirection = 'row'; 
                    row.style.justifyContent = 'space-between'; 
                    row.style.alignItems = 'center'; 
                    row.style.marginBottom = '5px'; 
                    row.style.lineHeight = '1.2';
                    const label = row.querySelector('.label'); 
                    const value = row.querySelector('.value');
                    if (label) { 
                        label.style.display = 'inline-block'; 
                        label.style.width = 'auto'; 
                        label.style.textAlign = 'left'; 
                        label.style.verticalAlign = 'middle'; 
                    }
                    if (value) { 
                        value.style.display = 'inline-block'; 
                        value.style.width = 'auto'; 
                        value.style.textAlign = 'right'; 
                        value.style.verticalAlign = 'middle'; 
                        value.style.fontWeight = 'bold'; 
                    }
                });
            });
        } else {
            playersContainer.classList.remove('mobile-layout');
            const pokerTableContainer = document.querySelector('.poker-table-container'); 
            if (pokerTableContainer) { 
                pokerTableContainer.style.display = ''; 
                pokerTableContainer.style.flexDirection = ''; 
            }
            const playerStats = document.querySelectorAll('.player-stats');
            playerStats.forEach(statContainer => {
                statContainer.style.display = '';
                const statRows = statContainer.querySelectorAll('.stat-row');
                statRows.forEach(row => {
                    row.style.display = ''; 
                    row.style.flexDirection = ''; 
                    row.style.alignItems = ''; 
                    row.style.marginBottom = '';
                    const label = row.querySelector('.label'); 
                    const value = row.querySelector('.value');
                    if (label) { 
                        label.style.width = ''; 
                        label.style.textAlign = ''; 
                        label.style.display = ''; 
                    }
                    if (value) { 
                        value.style.width = ''; 
                        value.style.textAlign = ''; 
                        value.style.display = ''; 
                        value.style.marginBottom = ''; 
                        value.style.fontWeight = ''; 
                    }
                });
            });
        }
    }
    
    // Throttlattu: checkMobileView kirjoittaa kymmeniä inline-tyylejä,
    // eikä sitä kannata ajaa jokaisella resize-tapahtumalla
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (resizeTimer) return;
        resizeTimer = setTimeout(() => {
            resizeTimer = null;
            checkMobileView();
        }, 150);
    });
    initUI();
    setTimeout(checkMobileView, 100);
});