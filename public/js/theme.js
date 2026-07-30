// Vaalean ja tumman tilan hallinta.
//
// Ladataan <head>:ssä synkronisesti ennen sivun piirtoa, jotta tallennettu
// teema ehtii <html data-theme>-attribuuttiin ennen ensimmäistä ruutupäivitystä
// - muuten tumma tila välähtäisi valkoisena jokaisella sivunlatauksella.
//
// Omana tiedostonaan siksi, että helmetin script-src 'self' estää inline-
// skriptit; tavanomainen "no-flash snippet" <head>:ssä ei siis kelpaa.
//
// Oletus on käyttöjärjestelmän asetus (prefers-color-scheme). Sitä seurataan
// niin kauan kuin käyttäjä ei ole tehnyt omaa valintaa; ensimmäisen klikkauksen
// jälkeen valinta on tallessa localStoragessa ja voittaa järjestelmän.

(function () {
    'use strict';

    var KEY = 'km-theme';
    var root = document.documentElement;
    var media = window.matchMedia('(prefers-color-scheme: dark)');

    // localStorage voi heittää privaatti-istunnossa tai kun evästeet on
    // estetty - teeman pitää toimia silti, vain muistamatta valintaa
    function stored() {
        try {
            var v = localStorage.getItem(KEY);
            return v === 'dark' || v === 'light' ? v : null;
        } catch (e) {
            return null;
        }
    }

    function save(value) {
        try {
            localStorage.setItem(KEY, value);
        } catch (e) {
            /* ei mitään: teema toimii istunnon ajan ilman tallennusta */
        }
    }

    function effectiveTheme() {
        return stored() || (media.matches ? 'dark' : 'light');
    }

    function apply(theme) {
        root.dataset.theme = theme;
        // Nappia ei ole olemassa vielä <head>:ssä ajettaessa
        var button = document.getElementById('themeToggle');
        if (button) button.setAttribute('aria-pressed', String(theme === 'dark'));
    }

    apply(effectiveTheme());

    media.addEventListener('change', function () {
        if (!stored()) apply(effectiveTheme());
    });

    document.addEventListener('DOMContentLoaded', function () {
        var button = document.getElementById('themeToggle');
        if (!button) return;
        button.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
        button.addEventListener('click', function () {
            var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
            save(next);
            apply(next);
        });
    });
})();
