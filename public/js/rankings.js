// Rankingsivun logiikka: selaus, osittaiskäsihaku ja sivutus.
// Palvelinreitti: GET /rankings (katso server.js ja handSearch.js).
document.addEventListener('DOMContentLoaded', () => {
    // Käyttöliittymätekstit ja numeroiden locale (katso i18n.js; kieli
    // tulee sivun <html lang> -attribuutista)
    const { t, apiError, locale } = window.I18N;

    const gameTypeRadios = document.querySelectorAll('input[name="gameType"]');
    const playersSelect = document.getElementById('playersSelect');
    const searchForm = document.getElementById('searchForm');
    const handQuery = document.getElementById('handQuery');
    const clearQuery = document.getElementById('clearQuery');
    const metaEl = document.getElementById('rankingsMeta');
    const errorEl = document.getElementById('rankingsError');
    const bodyEl = document.getElementById('rankingsBody');
    const tableEl = document.querySelector('.rankings-table');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');
    const csvLink = document.getElementById('csvLink');

    // 200 riviä sivulle: Hold'emin kaikki 169 luokkaa mahtuvat yhdelle
    // sivulle ilman erikoistapausta, Omaha-taulukot sivuttuvat normaalisti
    const LIMIT = 200;
    const state = { gameType: 'holdem', players: 2, q: '', offset: 0, total: 0 };
    let available = null;               // /preflop/available -vastaus
    let fetchSeq = 0;                   // vanhentuneiden vastausten hylkäys

    const fmtNum = n => n.toLocaleString(locale);

    // Top-%: parhaiden käsien tarkkuus vaatii desimaaleja (AA = 0,45 %),
    // hännillä yksi riittää
    function fmtTopPct(x) {
        const d = x < 10 ? 2 : 1;
        return x.toLocaleString(locale, {
            minimumFractionDigits: d,
            maximumFractionDigits: d
        }) + ' %';
    }

    function rankText(h) {
        let t = fmtNum(h.rank);
        if (h.rankLow !== undefined && h.rankHigh > h.rankLow) {
            t += ` (${fmtNum(h.rankLow)}–${fmtNum(h.rankHigh)})`;
        }
        return t;
    }

    function updatePlayersOptions() {
        const counts = (available && available[state.gameType]) ||
            (state.gameType === 'holdem' ? [2,3,4,5,6,7,8,9,10] : [2,3,4,5,6,7,8,9]);
        const current = state.players;
        playersSelect.innerHTML = '';
        for (const p of counts) {
            const opt = document.createElement('option');
            opt.value = String(p);
            opt.textContent = String(p);
            playersSelect.appendChild(opt);
        }
        state.players = counts.includes(current) ? current : counts[counts.length - 1];
        playersSelect.value = String(state.players);
    }

    function showError(message) {
        errorEl.textContent = message || '';
    }

    async function fetchResults() {
        const seq = ++fetchSeq;
        showError('');
        metaEl.textContent = t('rk.searching');

        const params = new URLSearchParams({
            gameType: state.gameType,
            players: String(state.players),
            offset: String(state.offset),
            limit: String(LIMIT)
        });
        if (state.q) params.set('q', state.q);

        let data;
        try {
            const res = await fetch(`/rankings?${params}`);
            data = await res.json();
            if (seq !== fetchSeq) return;           // uudempi haku ehti ohi
            if (!res.ok) {
                bodyEl.innerHTML = '';
                metaEl.textContent = '';
                showError(apiError(data, 'rk.searchFailed'));
                renderPager(0);
                return;
            }
        } catch (e) {
            if (seq !== fetchSeq) return;
            bodyEl.innerHTML = '';
            metaEl.textContent = '';
            showError(t('rk.connectionFailed'));
            renderPager(0);
            return;
        }

        state.total = data.total;
        renderMeta(data);
        renderRows(data);
        renderPager(data.total);
        csvLink.href = `/rankings/csv?gameType=${state.gameType}&players=${state.players}`;
    }

    const GAME_NAMES = {
        holdem: "Hold'em", omaha: 'Omaha', omaha5: 'Omaha5', omahahilo: 'Omaha Hi/Lo'
    };

    function renderMeta(data) {
        const game = GAME_NAMES[state.gameType] || state.gameType;
        let text = t('rk.meta', {
            game,
            players: data.players,
            method: t(data.exact ? 'rk.methodExact' : 'rk.methodHybrid'),
            classes: fmtNum(data.handClasses)
        });
        if (state.q) {
            text += t('rk.metaQuery', { q: state.q, total: fmtNum(data.total) });
        }
        metaEl.textContent = text;
    }

    // Koko rivin levyisten solujen (detaljipaneeli, "ei tuloksia") colspan:
    // piilotetut sarakkeet (col-label, col-hilo, col-se) eivät kelpaa lukuun,
    // koska näkyviä sarakkeita suurempi colspan luo table-layout: fixed
    // -asettelussa haamusarakkeita, jotka kaventavat näkyviä sarakkeita
    function visibleColCount() {
        let n = 0;
        for (const th of tableEl.querySelectorAll('thead th')) {
            if (getComputedStyle(th).display !== 'none') n++;
        }
        return n;
    }

    function renderRows(data) {
        const isHoldem = state.gameType === 'holdem';
        tableEl.classList.toggle('no-label-col', isHoldem);
        // Eksaktissa taulukossa keskivirhe on nolla joka rivillä, joten
        // sarake ei kerro mitään - piilotetaan ja jätetään tila muille
        tableEl.classList.toggle('no-se-col', data.exact === true);
        // Pelimuotokohtaiset sarakeleveydet (ks. style.css: Sarakeleveydet)
        tableEl.setAttribute('data-game', state.gameType);
        bodyEl.innerHTML = '';
        for (const h of data.hands) {
            const tr = document.createElement('tr');
            tr.className = 'hand-row';
            tr.tabIndex = 0;
            tr.setAttribute('data-key', h.key);
            tr.title = t('rk.rowTitle');
            tr.addEventListener('click', () => toggleDetail(tr, h));
            tr.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleDetail(tr, h);
                }
            });

            const rank = document.createElement('td');
            rank.className = 'col-rank';
            rank.textContent = rankText(h);
            tr.appendChild(rank);

            const hand = document.createElement('td');
            hand.className = 'col-hand';
            hand.textContent = h.notation || h.key;
            tr.appendChild(hand);

            const label = document.createElement('td');
            label.className = 'col-label';
            label.textContent = h.label || '';
            tr.appendChild(label);

            const equity = document.createElement('td');
            equity.className = 'col-num';
            equity.textContent = h.equity.toFixed(4);
            tr.appendChild(equity);

            // Hi/Lo-erittely: solut luodaan aina, jotta sarakemäärä pysyy
            // samana; CSS piilottaa ne muissa pelimuodoissa
            for (const val of [h.hiEquity, h.loEquity]) {
                const td = document.createElement('td');
                td.className = 'col-num col-hilo';
                td.textContent = typeof val === 'number' ? val.toFixed(2) : '';
                tr.appendChild(td);
            }

            const topPct = document.createElement('td');
            topPct.className = 'col-num';
            topPct.textContent = h.topPct !== undefined ? fmtTopPct(h.topPct) : '';
            tr.appendChild(topPct);

            const se = document.createElement('td');
            se.className = 'col-num col-se';
            se.textContent = h.se > 0 ? `± ${h.se.toFixed(4)}` : t('rk.exactSe');
            tr.appendChild(se);

            const combos = document.createElement('td');
            combos.className = 'col-num';
            combos.textContent = fmtNum(h.combos);
            tr.appendChild(combos);

            bodyEl.appendChild(tr);
        }
        if (data.hands.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = visibleColCount();
            td.className = 'no-results';
            td.textContent = t('rk.noResults');
            tr.appendChild(td);
            bodyEl.appendChild(tr);
        }
    }

    /**
     * Avaa tai sulje rivin alle vertailu: sama käsi kaikilla
     * pelaajamäärillä. Kertoo mm. missä kohtaa AATT ds putoaa
     * AAKK:n taakse pelaajien lisääntyessä.
     */
    let detailSeq = 0;
    async function toggleDetail(tr, hand) {
        const existing = bodyEl.querySelector('.detail-row');
        const wasOpenHere = existing && existing.getAttribute('data-key') === hand.key;
        if (existing) existing.remove();
        bodyEl.querySelectorAll('.hand-row.open').forEach(r => r.classList.remove('open'));
        if (wasOpenHere) return;

        tr.classList.add('open');
        const detail = document.createElement('tr');
        detail.className = 'detail-row';
        detail.setAttribute('data-key', hand.key);
        const td = document.createElement('td');
        td.colSpan = visibleColCount();
        td.textContent = t('rk.loadingDetail');
        detail.appendChild(td);
        tr.after(detail);

        const seq = ++detailSeq;
        let data;
        try {
            const res = await fetch(`/rankings/hand?gameType=${state.gameType}&key=${encodeURIComponent(hand.key)}`);
            data = await res.json();
            if (seq !== detailSeq || !detail.isConnected) return;
            if (!res.ok) {
                td.textContent = apiError(data, 'rk.detailFailed');
                return;
            }
        } catch (e) {
            if (seq !== detailSeq || !detail.isConnected) return;
            td.textContent = t('rk.connectionFailed');
            return;
        }

        td.textContent = '';
        const caption = document.createElement('div');
        caption.className = 'hand-detail-caption';
        caption.textContent = t('rk.detailCaption', {
            hand: (hand.notation || hand.key) + (hand.label ? ` — ${hand.label}` : '')
        });
        td.appendChild(caption);

        const sub = document.createElement('table');
        sub.className = 'hand-detail-table';
        const head = document.createElement('tr');
        for (const col of ['players', 'rank', 'equity', 'top', 'se']) {
            const th = document.createElement('th');
            th.textContent = t('rk.col.' + col);
            head.appendChild(th);
        }
        sub.appendChild(head);
        for (const r of data.byPlayers) {
            const row = document.createElement('tr');
            if (r.players === state.players) row.className = 'current-players';
            const cells = [
                String(r.players),
                rankText(r) + ` / ${fmtNum(r.handClasses)}`,
                r.equity.toFixed(4),
                r.topPct !== undefined ? fmtTopPct(r.topPct) : '',
                r.se > 0 ? `± ${r.se.toFixed(4)}` : t('rk.exactSe')
            ];
            cells.forEach((text, i) => {
                const cell = document.createElement('td');
                cell.textContent = text;
                if (i > 0) cell.className = 'col-num';
                row.appendChild(cell);
            });
            sub.appendChild(row);
        }
        td.appendChild(sub);

        // Hi/Lo: paneelissa on tilaa sille mitä päätaulukkoon ei mahdu -
        // kuinka usein puoliskot voitetaan ja miten koko potinosuus jakautuu.
        // Nämä riippuvat pelaajamäärästä, joten näytetään valitun määrän rivi
        // (tai ensimmäinen jolta luvut löytyvät) ja kerrotaan mikä se on.
        const hl = data.byPlayers.find(r => r.players === state.players && r.scoop !== undefined)
            || data.byPlayers.find(r => r.scoop !== undefined);
        // lowMade ja nutLow eivät riipu pelaajamäärästä lainkaan, joten ne
        // otetaan miltä tahansa riviltä jolla ne ovat (eksakti heads-up).
        const lowRow = data.byPlayers.find(r => r.lowMade !== undefined);
        if (hl) {
            const pct = x => x.toLocaleString(locale,
                { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %';
            const cap = document.createElement('div');
            cap.className = 'hand-detail-extra-caption';
            cap.textContent = t('rk.detailHiloCaption', { players: hl.players });
            td.appendChild(cap);

            const texts = [
                t('rk.detailHalves', {
                    hiWin: pct(hl.hiWin), hiTie: pct(hl.hiTie),
                    loWin: pct(hl.loWin), loTie: pct(hl.loTie)
                }),
                t('rk.detailShares', {
                    scoop: pct(hl.scoop), part: pct(hl.partPot),
                    quarter: pct(hl.quarter), none: pct(hl.scoopedOn)
                })
            ];
            if (lowRow) {
                texts.push(t('rk.detailLow', {
                    made: pct(lowRow.lowMade), nut: pct(lowRow.nutLow)
                }));
            }
            const list = document.createElement('ul');
            list.className = 'hand-detail-extra';
            for (const text of texts) {
                const li = document.createElement('li');
                li.textContent = text;
                list.appendChild(li);
            }
            td.appendChild(list);
        }
    }

    function renderPager(total) {
        const from = total === 0 ? 0 : state.offset + 1;
        const to = Math.min(state.offset + LIMIT, total);
        pageInfo.textContent = `${fmtNum(from)}–${fmtNum(to)} / ${fmtNum(total)}`;
        prevBtn.disabled = state.offset === 0;
        nextBtn.disabled = state.offset + LIMIT >= total;
    }

    function setGameType(game) {
        state.gameType = game;
        const radio = document.querySelector(`input[name="gameType"][value="${game}"]`);
        if (radio && !radio.checked) radio.checked = true;
        const group = document.querySelector('.game-type-group');
        group.classList.remove('second-checked', 'third-checked', 'fourth-checked');
        if (game === 'omaha') group.classList.add('second-checked');
        if (game === 'omaha5') group.classList.add('third-checked');
        if (game === 'omahahilo') group.classList.add('fourth-checked');
        updatePlayersOptions();
    }

    gameTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            setGameType(e.target.value);
            state.offset = 0;
            fetchResults();
            updateChart();
        });
    });

    playersSelect.addEventListener('change', () => {
        state.players = parseInt(playersSelect.value, 10);
        state.offset = 0;
        fetchResults();
        updateChart();
    });

    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        state.q = handQuery.value.trim();
        state.offset = 0;
        fetchResults();
    });

    clearQuery.addEventListener('click', () => {
        handQuery.value = '';
        state.q = '';
        state.offset = 0;
        fetchResults();
    });

    prevBtn.addEventListener('click', () => {
        state.offset = Math.max(0, state.offset - LIMIT);
        fetchResults();
    });

    nextBtn.addEventListener('click', () => {
        if (state.offset + LIMIT < state.total) {
            state.offset += LIMIT;
            fetchResults();
        }
    });

    // ===== Preflop-chart: top-X %:n alue =====
    //
    // Hold'em piirretään perinteisenä 13x13-ruudukkona (parit lävistäjällä,
    // suited yläkolmiossa, offsuit alakolmiossa). Käsi kuuluu alueeseen, jos
    // sen kombopainotettu top-% on korkeintaan säätimen arvo - sama sääntö
    // kuin palvelimen /rankings/range-reitillä, jota Omaha-pelimuotojen
    // tunnuslukupaneeli käyttää (13x13-esitystä ei niille ole).

    const CHART_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
    const rangeSlider = document.getElementById('rangeSlider');
    const rangeValue = document.getElementById('rangeValue');
    const rangeSummary = document.getElementById('rangeSummary');
    const chartEl = document.getElementById('preflopChart');
    const chartWrap = document.querySelector('.preflop-chart-wrap');
    const chartLegend = document.getElementById('chartLegend');
    const rangeInfoPanel = document.getElementById('rangeInfoPanel');

    let rangePct = parseInt(rangeSlider.value, 10);
    const chartCells = new Map();       // 'AKs' -> button-elementti
    const chartCache = new Map();       // players -> /rankings-vastauksen hands
    let chartSeq = 0;                   // vanhentuneiden chart-hakujen hylkäys
    let rangeSeq = 0;                   // sama Omaha-paneelille
    let rangeTimer = null;              // liukusäätimen debounce (Omaha)

    function cellHandKey(row, col) {
        if (row === col) return CHART_RANKS[row] + CHART_RANKS[row];
        if (row < col) return CHART_RANKS[row] + CHART_RANKS[col] + 's';
        return CHART_RANKS[col] + CHART_RANKS[row] + 'o';
    }

    function buildChartGrid() {
        for (let row = 0; row < 13; row++) {
            for (let col = 0; col < 13; col++) {
                const key = cellHandKey(row, col);
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.className = 'pc-cell ' +
                    (row === col ? 'pc-pair' : row < col ? 'pc-suited' : 'pc-offsuit');
                cell.textContent = key;
                cell.addEventListener('click', () => {
                    handQuery.value = key;
                    state.q = key;
                    state.offset = 0;
                    fetchResults();
                    document.querySelector('.table-wrap').scrollIntoView({ behavior: 'smooth' });
                });
                chartCells.set(key, cell);
                chartEl.appendChild(cell);
            }
        }
    }

    function inRange(hand) {
        return hand.topPct !== undefined && hand.topPct <= rangePct + 1e-9;
    }

    function paintChart(hands) {
        const byKey = new Map(hands.map(h => [h.key, h]));
        for (const [key, cell] of chartCells) {
            const h = byKey.get(key);
            const included = h !== undefined && inRange(h);
            cell.classList.toggle('in-range', included);
            if (h) {
                const desc = t('rk.cellDesc', {
                    key, rank: h.rank, equity: h.equity.toFixed(2), top: fmtTopPct(h.topPct)
                }) + (included ? '' : t('rk.cellOut'));
                cell.title = desc;
                cell.setAttribute('aria-label', desc);
            }
        }

        let classes = 0, combos = 0, totalCombos = 0, cutoff = null;
        for (const h of hands) {
            totalCombos += h.combos;
            if (inRange(h)) {
                classes++;
                combos += h.combos;
                if (cutoff === null || h.equity < cutoff) cutoff = h.equity;
            }
        }
        rangeSummary.textContent =
            t('rk.chartSummary', {
                pct: rangePct, classes: fmtNum(classes),
                combos: fmtNum(combos), total: fmtNum(totalCombos)
            }) +
            (cutoff !== null ? t('rk.chartCutoff', { equity: cutoff.toFixed(2) }) : '.');
    }

    async function fetchChartData(players) {
        const seq = ++chartSeq;
        const params = new URLSearchParams({
            gameType: 'holdem',
            players: String(players),
            limit: '500'
        });
        try {
            const res = await fetch(`/rankings?${params}`);
            if (!res.ok) {
                // Ilman tätä "Haetaan…" jäisi näkyviin pysyvästi
                // (esim. rate limit -vastauksessa)
                if (seq === chartSeq && state.gameType === 'holdem') {
                    rangeSummary.textContent = t('rk.chartFailed');
                }
                return;
            }
            const data = await res.json();
            if (seq !== chartSeq) return;
            chartCache.set(players, data.hands);
            if (state.gameType === 'holdem' && state.players === players) {
                paintChart(data.hands);
            }
        } catch (e) {
            // gameType-vahti: myöhässä epäonnistuva Hold'em-haku ei saa
            // kirjoittaa virhettä Omaha-näkymän yhteenvetoriville
            if (seq === chartSeq && state.gameType === 'holdem') {
                rangeSummary.textContent = t('rk.chartFailed');
            }
        }
    }

    function renderRangeInfo(data) {
        rangeInfoPanel.innerHTML = '';
        const game = GAME_NAMES[state.gameType] || state.gameType;
        const share = 100 * data.combos / data.totalCombos;

        const head = document.createElement('p');
        head.className = 'range-info-headline';
        head.textContent = t('rk.rangeHeadline', { game, players: data.players, pct: data.pct });
        rangeInfoPanel.appendChild(head);

        // Käden esitys paneelissa: notaatio + mahdollinen selitenimi
        const handText = h => (h.notation || h.key) + (h.label ? ` (${h.label})` : '');

        const list = document.createElement('ul');
        const items = [
            t('rk.rangeClasses', {
                classes: fmtNum(data.classes), allClasses: fmtNum(data.handClasses),
                combos: fmtNum(data.combos), totalCombos: fmtNum(data.totalCombos),
                share: fmtTopPct(share)
            })
        ];
        if (data.lastIncluded) {
            items.push(t('rk.rangeCutoff', {
                equity: data.equityCutoff.toFixed(2),
                hand: handText(data.lastIncluded),
                rank: fmtNum(data.lastIncluded.rank)
            }));
        }
        if (data.firstExcluded) {
            items.push(t('rk.rangeExcluded', {
                hand: handText(data.firstExcluded),
                rank: fmtNum(data.firstExcluded.rank),
                equity: data.firstExcluded.equity.toFixed(2)
            }));
        }
        for (const text of items) {
            const li = document.createElement('li');
            li.textContent = text;
            list.appendChild(li);
        }
        rangeInfoPanel.appendChild(list);

        if (data.classes > 0) {
            const jump = document.createElement('button');
            jump.type = 'button';
            jump.className = 'secondary-button range-jump-button';
            jump.textContent = t('rk.showCutoff');
            jump.addEventListener('click', () => {
                handQuery.value = '';
                state.q = '';
                state.offset = Math.floor((data.classes - 1) / LIMIT) * LIMIT;
                fetchResults();
                document.querySelector('.table-wrap').scrollIntoView({ behavior: 'smooth' });
            });
            rangeInfoPanel.appendChild(jump);
        }
    }

    async function fetchRangeInfo() {
        const seq = ++rangeSeq;
        const params = new URLSearchParams({
            gameType: state.gameType,
            players: String(state.players),
            pct: String(rangePct)
        });
        try {
            const res = await fetch(`/rankings/range?${params}`);
            const data = await res.json();
            if (seq !== rangeSeq || state.gameType === 'holdem') return;
            if (!res.ok) {
                rangeInfoPanel.textContent = apiError(data, 'rk.rangeFailed');
                return;
            }
            renderRangeInfo(data);
        } catch (e) {
            if (seq === rangeSeq) rangeInfoPanel.textContent = t('rk.connectionFailed');
        }
    }

    function updateChart() {
        rangeValue.textContent = t('rk.rangeValue', { pct: rangePct });
        const isHoldem = state.gameType === 'holdem';
        chartWrap.classList.toggle('hidden', !isHoldem);
        chartLegend.classList.toggle('hidden', !isHoldem);
        rangeInfoPanel.classList.toggle('hidden', isHoldem);

        if (isHoldem) {
            const cached = chartCache.get(state.players);
            if (cached) {
                paintChart(cached);
            } else {
                rangeSummary.textContent = t('rk.searching');
                fetchChartData(state.players);
            }
        } else {
            rangeSummary.textContent = '';
            // Debounce: liukusäädin laukoo input-tapahtumia joka pykälältä,
            // eikä jokaisesta kannata tehdä palvelinhakua
            clearTimeout(rangeTimer);
            rangeTimer = setTimeout(fetchRangeInfo, 250);
        }
    }

    rangeSlider.addEventListener('input', () => {
        rangePct = parseInt(rangeSlider.value, 10);
        updateChart();
    });

    buildChartGrid();

    document.querySelectorAll('.example-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            setGameType(chip.getAttribute('data-game'));
            handQuery.value = chip.getAttribute('data-q');
            state.q = handQuery.value;
            state.offset = 0;
            fetchResults();
            updateChart();
        });
    });

    // Käynnistys: hae saatavilla olevat taulukot ja näytä oletuslista
    (async () => {
        try {
            const res = await fetch('/preflop/available');
            if (res.ok) available = await res.json();
        } catch (e) {
            // lista täytetään oletuksilla
        }
        setGameType(state.gameType);
        fetchResults();
        updateChart();
    })();
});
