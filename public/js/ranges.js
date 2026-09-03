/**
 * Vastustajien käsialueet ("top X % käsistä") simulaattorissa.
 *
 * Tuntemattomat vastustajat -tilassa jokaisen vastustajan korttien päällä
 * on liukusäädin: 100 % = kaikki kädet (tavallinen satunnainen vastustaja),
 * pienempi luku = vain preflop-rankingin parhaat X % käsistä. Sääntö on
 * sama kuin rankingsivulla ja palvelimen /rankings/range-reitillä: käsi
 * kuuluu alueeseen, jos sen kombopainotettu top-% on korkeintaan X.
 * Ranking valitaan pöydän aktiivisen pelaajamäärän mukaan - sama taulukko
 * jota /preflop-haku käyttää.
 *
 * Säätimen päälle avautuu ponnahdusikkuna: Hold'emissa 13x13-chart (sama
 * kuin rankingsivulla), Omaha-pelimuodoissa alueen tunnusluvut ja
 * heikoin mukana oleva käsi.
 *
 * Simulaatiota varten alue toimitetaan moottorille luokka-avaimina
 * (rangeKeys), jotka moottori laajentaa komboiksi. Hold'emissa avaimet
 * lasketaan selaimessa rankingtaulukosta (169 riviä, haetaan kerran per
 * pelaajamäärä); Omahassa ne haetaan /rankings/range?keys=1-reitiltä ja
 * välimuistitetaan per (peli, pelaajamäärä, prosentti).
 *
 * Tämä tiedosto ei tunne simulaattorin muuta tilaa: script.js kertoo
 * pelimuodon ja pelaajamäärän (getContext) ja saa tiedon säätimen
 * muutoksesta (onChange).
 */
window.RangeUI = (function () {
    'use strict';

    const { t, locale } = window.I18N;
    const CHART_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

    const controls = new Map();     // pelaajaindeksi -> { wrapper, slider, label }
    const handsCache = new Map();   // 'holdem:6' -> Promise<hands[]>
    const rangeCache = new Map();   // 'omaha:6:30' -> Promise<info>
    let getContext = () => ({ gameType: 'holdem', players: 2 });
    let onChange = () => {};
    let globalSlider = null;

    const fmtNum = n => Number(n).toLocaleString(locale);

    function labelText(pct) {
        return pct >= 100 ? t('sim.rangeAll') : t('sim.rangeTop', { pct });
    }

    // --- Data ---------------------------------------------------------------

    /** Hold'emin 169 luokkaa sijajärjestyksessä topPct-kenttineen */
    function holdemHands(players) {
        const key = `holdem:${players}`;
        if (!handsCache.has(key)) {
            const params = new URLSearchParams({ gameType: 'holdem', players: String(players), limit: '500' });
            const p = fetch(`/rankings?${params}`).then(async res => {
                if (!res.ok) throw Object.assign(new Error('rankings'), { status: res.status });
                const data = await res.json();
                return data.hands;
            });
            // Epäonnistunut haku ei jää välimuistiin (esim. rate limit)
            p.catch(() => handsCache.delete(key));
            handsCache.set(key, p);
        }
        return handsCache.get(key);
    }

    /** Omaha-pelimuodot: alueen tunnusluvut ja avaimet palvelimelta */
    function rangeInfo(gameType, players, pct) {
        const key = `${gameType}:${players}:${pct}`;
        if (!rangeCache.has(key)) {
            const params = new URLSearchParams({
                gameType, players: String(players), pct: String(pct), keys: '1'
            });
            const p = fetch(`/rankings/range?${params}`).then(async res => {
                if (!res.ok) throw Object.assign(new Error('range'), { status: res.status });
                return res.json();
            });
            p.catch(() => rangeCache.delete(key));
            rangeCache.set(key, p);
        }
        return rangeCache.get(key);
    }

    // Sama top X % -sääntö kuin palvelimella ja rankingsivulla (games.js)
    const inRange = (hand, pct) => window.PokerGames.inTopPct(hand.topPct, pct);

    /**
     * Alueen tiedot yhtenäisessä muodossa:
     * { keys, classes, combos, totalCombos, lastIncluded, hands? }
     */
    async function resolve(gameType, players, pct) {
        if (gameType === 'holdem') {
            const hands = await holdemHands(players);
            const included = hands.filter(h => inRange(h, pct));
            let combos = 0, totalCombos = 0;
            for (const h of hands) totalCombos += h.combos;
            for (const h of included) combos += h.combos;
            return {
                keys: included.map(h => h.key),
                classes: included.length,
                combos, totalCombos,
                lastIncluded: included.length ? included[included.length - 1] : null,
                hands
            };
        }
        const info = await rangeInfo(gameType, players, pct);
        return {
            keys: info.keys || [],
            classes: info.classes,
            combos: info.combos,
            totalCombos: info.totalCombos,
            lastIncluded: info.lastIncluded,
            hands: null
        };
    }

    // --- Säätimet -----------------------------------------------------------

    function pctFor(playerIndex) {
        const c = controls.get(playerIndex);
        return c ? parseInt(c.slider.value, 10) : 100;
    }

    function anyRange(playerHandsData) {
        return playerHandsData.some((p, i) => i > 0 && !p.isFolded && p.rangePct !== undefined && p.rangePct < 100);
    }

    function setControl(c, pct, fireChange) {
        c.slider.value = String(pct);
        c.label.textContent = labelText(pct);
        c.slider.setAttribute('aria-valuetext', labelText(pct));
        c.wrapper.classList.toggle('has-range', pct < 100);
        if (fireChange) onChange();
    }

    /** Rakenna vastustajan säädin korttialueen päälle */
    function mount(playerIndex, container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'range-control';

        const label = document.createElement('div');
        label.className = 'range-label';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '1';
        slider.max = '100';
        slider.step = '1';
        slider.className = 'range-slider';
        slider.setAttribute('aria-label', t('sim.rangeAria', { n: playerIndex + 1 }));

        wrapper.appendChild(label);
        wrapper.appendChild(slider);
        container.appendChild(wrapper);

        const c = { wrapper, slider, label };
        controls.set(playerIndex, c);
        setControl(c, globalSlider ? parseInt(globalSlider.value, 10) : 100, false);

        // input: elävä päivitys (teksti + ponnahdusikkuna); change: uusi ajo
        slider.addEventListener('input', () => {
            setControl(c, parseInt(slider.value, 10), false);
            showPopover(c);
        });
        slider.addEventListener('change', () => onChange());
        // Piilotus pienellä viiveellä, jotta osoitin ehtii siirtyä
        // ponnahdusikkunan linkkiin
        wrapper.addEventListener('pointerenter', () => showPopover(c));
        wrapper.addEventListener('pointerleave', () => scheduleHide());
        slider.addEventListener('focus', () => showPopover(c));
        slider.addEventListener('blur', () => scheduleHide());
    }

    function reset() {
        controls.clear();
        hidePopover();
    }

    /** Yhteinen säädin asetuksissa: asettaa kaikki vastustajat kerralla */
    function attachGlobal(slider, valueEl) {
        globalSlider = slider;
        const paint = () => {
            const pct = parseInt(slider.value, 10);
            valueEl.textContent = labelText(pct);
            slider.setAttribute('aria-valuetext', labelText(pct));
        };
        paint();
        slider.addEventListener('input', () => {
            paint();
            const pct = parseInt(slider.value, 10);
            for (const c of controls.values()) setControl(c, pct, false);
        });
        slider.addEventListener('change', () => onChange());
    }

    // --- Ponnahdusikkuna ----------------------------------------------------

    let popover = null;
    let popoverChart = null;    // Hold'em-ruudukon solut avaimittain
    let popoverSeq = 0;
    let popoverTimer = null;

    function ensurePopover() {
        if (popover) return;
        popover = document.createElement('div');
        popover.id = 'rangePopover';
        popover.className = 'range-popover';
        popover.setAttribute('role', 'tooltip');
        popover.hidden = true;
        popover.innerHTML = `
            <div class="range-popover-head"></div>
            <div class="range-popover-chart" hidden></div>
            <div class="range-popover-summary"></div>
            <a class="range-popover-link" target="_blank" rel="noopener"></a>`;
        document.body.appendChild(popover);
        popover.addEventListener('pointerenter', () => clearTimeout(hideTimer));
        popover.addEventListener('pointerleave', () => scheduleHide());
        // Ruudukko rakennetaan kerran, vain väritys vaihtuu
        const grid = popover.querySelector('.range-popover-chart');
        popoverChart = new Map();
        for (let row = 0; row < 13; row++) {
            for (let col = 0; col < 13; col++) {
                const key = row === col ? CHART_RANKS[row] + CHART_RANKS[row]
                    : row < col ? CHART_RANKS[row] + CHART_RANKS[col] + 's'
                        : CHART_RANKS[col] + CHART_RANKS[row] + 'o';
                const cell = document.createElement('div');
                cell.className = 'rp-cell' + (row === col ? ' rp-pair' : '');
                cell.textContent = key;
                popoverChart.set(key, cell);
                grid.appendChild(cell);
            }
        }
    }

    function position(c) {
        const r = c.wrapper.getBoundingClientRect();
        const pw = popover.offsetWidth, ph = popover.offsetHeight;
        const margin = 8;
        // Ensisijaisesti säätimen alle, muuten yläpuolelle; vaakasuunnassa
        // keskitettynä mutta näytön sisällä
        let top = r.bottom + margin;
        if (top + ph > window.innerHeight - margin) top = r.top - ph - margin;
        if (top < margin) top = margin;
        let left = r.left + r.width / 2 - pw / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
    }

    function handText(h) {
        if (!h) return '';
        return (h.notation || h.key) + (h.label ? ` (${h.label})` : '');
    }

    function rankingsHref(gameType, players, pct) {
        const page = document.documentElement.lang === 'en' ? '/en/rankings' : '/rankingit';
        const params = new URLSearchParams({ gameType, players: String(players), pct: String(pct) });
        return page + '?' + params;
    }

    function showPopover(c) {
        ensurePopover();
        clearTimeout(hideTimer);
        const pct = parseInt(c.slider.value, 10);
        const { gameType, players } = getContext();
        const head = popover.querySelector('.range-popover-head');
        const grid = popover.querySelector('.range-popover-chart');
        const summary = popover.querySelector('.range-popover-summary');
        const link = popover.querySelector('.range-popover-link');

        head.textContent = t('sim.rangePopHead', { pct, players });
        link.textContent = t('sim.rangePopLink');
        link.href = rankingsHref(gameType, players, pct);
        grid.hidden = gameType !== 'holdem';
        popover.hidden = false;
        position(c);

        // Omahan haku debouncataan liu'utuksen ajaksi; Hold'em piirtyy
        // heti kun taulukko on kerran haettu
        const seq = ++popoverSeq;
        clearTimeout(popoverTimer);
        const run = () => resolve(gameType, players, pct).then(info => {
            if (seq !== popoverSeq || popover.hidden) return;
            if (info.hands) {
                for (const [key, cell] of popoverChart) {
                    const h = info.hands.find(x => x.key === key);
                    cell.classList.toggle('in-range', !!h && inRange(h, pct));
                }
            }
            summary.textContent = t('sim.rangePopSummary', {
                classes: fmtNum(info.classes), combos: fmtNum(info.combos), total: fmtNum(info.totalCombos)
            }) + (info.lastIncluded ? t('sim.rangePopWeakest', { hand: handText(info.lastIncluded) }) : '');
            position(c);
        }).catch(err => {
            if (seq !== popoverSeq || popover.hidden) return;
            summary.textContent = err && err.status === 404 ? t('sim.rangeNoTable') : t('sim.rangeFetchFailed');
            position(c);
        });
        if (gameType === 'holdem' && handsCache.has(`holdem:${players}`)) {
            run();
        } else {
            summary.textContent = t('sim.rangeLoading');
            popoverTimer = setTimeout(run, gameType === 'holdem' ? 0 : 200);
        }
    }

    let hideTimer = null;

    function scheduleHide() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hidePopover, 250);
    }

    function hidePopover() {
        clearTimeout(hideTimer);
        if (!popover) return;
        popoverSeq++;
        clearTimeout(popoverTimer);
        popover.hidden = true;
    }

    // --- Simulaatiota varten ------------------------------------------------

    /**
     * Liitä range-vastustajien avaimet playerHandsData-riveihin. Muokkaa
     * taulukkoa paikallaan; palauttaa saman taulukon. Heittää jos taulukkoa
     * ei ole (status 404) tai haku epäonnistuu.
     */
    async function attachKeys(playerHandsData, gameType, players) {
        // Vastustajien haut ovat riippumattomia, joten ne lähtevät rinnakkain;
        // sama prosentti osuu lupausvälimuistiin eikä hakua toisteta
        const pending = [];
        for (let i = 1; i < playerHandsData.length; i++) {
            const p = playerHandsData[i];
            if (p.isFolded || !(p.rangePct < 100)) continue;
            pending.push(resolve(gameType, players, p.rangePct).then(info => {
                p.rangeKeys = info.keys;
                p.rangeId = `${gameType}:${players}:${p.rangePct}`;
            }));
        }
        await Promise.all(pending);
        return playerHandsData;
    }

    return {
        init({ getContext: gc, onChange: oc }) {
            if (gc) getContext = gc;
            if (oc) onChange = oc;
        },
        mount, reset, pctFor, anyRange, attachGlobal, attachKeys, hidePopover
    };
})();
