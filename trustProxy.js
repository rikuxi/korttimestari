// Käänteisproxyn luottamusasetus (Expressin 'trust proxy').
//
// Express päättää tämän perusteella, saako X-Forwarded-For-otsakkeeseen
// luottaa. Asetuksella on suora tietoturvamerkitys: jos luotetaan liikaa,
// kuka tahansa voi väärentää lähde-IP:nsä ja ohittaa rate limitit; jos
// luotetaan liian vähän, kaikki saman edge-noden takaa tulevat käyttäjät
// jakavat samat laskurit.

'use strict';

// Cloudflaren julkaisemat edge-alueet: https://www.cloudflare.com/ips/
//
// Sekä IPv4 että IPv6. Ilman IPv6-alueita dual-stack-originissa
// X-Forwarded-For jäisi huomiotta juuri yllä kuvatulla tavalla.
//
// Tämä lista vanhenee ajan myötä, mutta sitä EI tarvitse muokata koodissa:
// TRUST_PROXY_IPS-ympäristömuuttuja korvaa sen ilman uutta buildia.
const CLOUDFLARE_IPS = [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32'
];

/**
 * Ratkaise Expressin 'trust proxy' -arvo ympäristömuuttujasta.
 *
 * - asettamaton tai tyhjä  -> Cloudflaren oletusalueet
 * - 'off'                  -> false, eli X-Forwarded-For jätetään huomiotta
 *                             (käytä kun palvelu ei ole proxyn takana:
 *                             tällöin otsake on väärennettävissä)
 * - muu                    -> pilkulla tai tyhjämerkeillä eroteltu lista
 *                             osoitteita ja CIDR-alueita
 *
 * Arvojen kelvollisuutta ei tarkisteta täällä: Express itse hylkää
 * virheellisen osoitteen heti app.set-kutsussa, jolloin vika näkyy
 * käynnistyksessä eikä vasta ensimmäisellä pyynnöllä.
 *
 * @param {string|undefined} raw - TRUST_PROXY_IPS sellaisenaan
 * @returns {string[]|false} alueluettelo tai false
 */
function resolveTrustProxy(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return CLOUDFLARE_IPS;

    const value = raw.trim();
    if (value.toLowerCase() === 'off') return false;

    const entries = value.split(/[,\s]+/).filter(Boolean);
    return entries.length > 0 ? entries : CLOUDFLARE_IPS;
}

module.exports = { CLOUDFLARE_IPS, resolveTrustProxy };
