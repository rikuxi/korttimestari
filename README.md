# Korttimestari — Monte Carlo -pokerisimulaattori

**Sivusto: <https://www.korttimestari.com/>**
(englanniksi: <https://www.korttimestari.com/en/>)

*Read this in English: [README.en.md](README.en.md)*

Selainpohjainen työkalu pokerikäsien voittotodennäköisyyksien laskentaan
Monte Carlo -simulaatiolla. Tukee Texas Hold'emia, Omahaa (4 korttia) ja
Omaha5:tä (5 korttia), 2–10 pelaajaa (Omahat enintään 9).

Käyttöliittymä on kaksikielinen: suomi sivuston juuressa, englanti
`/en/`-polussa.

## Avoin data: täydet preflop-rankingit

Sivuston rankingien pohjana olevat preflop-equity-taulukot julkaistaan
tässä repossa avoimena datana ([data/](data/), CC BY 4.0):

| Peli | Käsiluokkia | Pelaajamäärät |
|---|---|---|
| Texas Hold'em | 169 | 2–10 (heads-up eksakti) |
| Omaha | 16 432 | 2–9 (heads-up eksakti) |
| Omaha5 (5 korttia) | 134 459 | 2–9 |

Taulukot kattavat jokaisen käsiluokan jokaisella pelaajamäärällä —
equity-arvoineen, keskivirheineen ja sijaepävarmuuksineen. Menetelmät ja
virherajat on dokumentoitu tiedostossa [data/README.md](data/README.md).

## Ominaisuudet

- Kortit asetellaan raahaamalla tai tuplaklikkaamalla pakasta
- Voitto-, tasapeli- ja equity-prosentit jokaiselle pelaajalle
- Heron käsijakauma (pari, väri, suora, ...) palkkikaaviona
- **Valitut vastustajat**: kaikkien pelaajien kortit tunnetaan
- **Tuntemattomat vastustajat**: vain heron kortit tunnetaan; vastustajille
  arvotaan uudet kädet joka jaossa (vastustajien prosentteja ei näytetä,
  koska ne eivät kerro mitään)
- Pöytäkortit (flop/turn/river) voi asettaa tai arpoa
- Foldaus, korttien arvonta, 2- ja 4-värinen pakka
- Vaalea ja tumma tila: oletus tulee käyttöjärjestelmän asetuksesta,
  ja oma valinta muistetaan selaimessa
- **Rankingsivu** (`/rankingit`): selaa esilaskettuja
  preflop-rankingeja tai hae osittaiskädellä; sijat epävarmuusväleineen,
  equityt keskivirheineen, top-X %:n aluechart ja CSV-lataus

## Käynnistys

```bash
npm install
npm start          # http://localhost:3002 (portti: ympäristömuuttuja PORT)
npm run dev        # nodemon-kehitystila
npm test           # testit (Noden sisäänrakennettu test runner)
```

### Ympäristömuuttujat

| Muuttuja | Oletus | Selitys |
|---|---|---|
| `PORT` | `3002` | Palvelimen portti |
| `PREFLOP_CACHE_TABLES` | `10` | Taulukkovälimuistin budjetti Omaha5-kokoisina taulukoina (~40 MB heapia kpl). Oletus pitää kaikki 25 taulukkoa muistissa (mitattu ~600 MB RSS lämmityksen jälkeen). Muistiahtaassa ympäristössä rajaa voi pudottaa; alle 8:lla Omaha5:n käsivertailu alkaa lukea levyltä. |
| `PREFLOP_PRELOAD` | päällä | Taulukoiden esilämmitys käynnistyksessä, ettei ensimmäinen kävijä maksa synkronisia levylatauksia. `off` poistaa käytöstä — käytä yhdessä matalan `PREFLOP_CACHE_TABLES`-arvon kanssa. |
| `TRUST_PROXY_IPS` | Cloudflaren alueet | Luotetut käänteisproxyt: pilkulla tai välilyönnillä eroteltu lista osoitteita ja CIDR-alueita. Arvo `off` jättää `X-Forwarded-For`-otsakkeen huomiotta — käytä sitä kun palvelu **ei** ole proxyn takana, koska silloin otsake on väärennettävissä. Kelvoton arvo kaataa käynnistyksen. |

## Arkkitehtuuri

| Tiedosto | Rooli |
|---|---|
| `public/js/engine.js` | Laskentamoottori — **sama tiedosto** ajetaan selaimessa ja palvelimella |
| `public/js/script.js` | Käyttöliittymä |
| `public/js/i18n.js` | Käyttöliittymätekstien katalogit (fi/en); kieli tulee `<html lang>`-attribuutista |
| `public/js/theme.js` | Vaalean ja tumman tilan valinta; ladataan `<head>`:ssä ennen sivun piirtoa |
| `public/js/poker-worker.js` | Simulaatio selaimen Web Workerissa (ensisijainen laskentapolku) |
| `server.js` | Express-palvelin: staattiset tiedostot, `POST /simulate` -varapolku, `GET /preflop` |
| `worker.js` | Palvelimen worker-säie, joka ajaa simulaation (requiroi `public/js/engine.js`) |
| `pokerUtils.js` | Kortin validointi ja legacy-apurit (poker-evaluator vain vanhassa eräajopolussa) |

Simulaatio ajetaan ensisijaisesti selaimessa. Jos Web Worker ei ole
käytettävissä tai se kaatuu, selain käyttää palvelimen `/simulate`-rajapintaa.

Molemmat polut käyttävät samaa moottoria (`public/js/engine.js`), joten ne
eivät voi erota toisistaan. Moottorin `eval5` on varmennettu
poker-evaluator-kirjastoa vasten kaikilla C(52,5) = 2 598 960 kädellä
(0 järjestysristiriitaa), ja testit vahtivat molempia polkuja.

## POST /simulate

```json
{
  "simulationCount": 10000,
  "gameType": "holdem | omaha | omaha5",
  "randomOpponents": false,
  "playerHandsData": [
    { "hand": ["As", "Ks"], "isFolded": false }
  ],
  "communityCards": { "flop": ["2h", "7d", "Jc"], "turn": null, "river": null }
}
```

Kortit muodossa `<arvo><maa>`: arvo `2-9, T, J, Q, K, A`, maa `s, h, d, c`.

## GET /rankings

Rankingtaulukon selaus ja osittaiskäsihaku (`/rankingit` käyttää tätä):

```
/rankings?gameType=omaha5&players=6&q=(AJ)(AJ)&offset=0&limit=100
```

`q` tyhjänä selaa koko listan sijajärjestyksessä. Kyselykieli
([handSearch.js](handSearch.js)): pelkät arvot (`AAJ`, maita ei rajoiteta),
sulkuryhmät (`(AJ)(AJ)` = sama maa, eri ryhmät eri maissa), konkreettiset
maat (`AsKs`), hold'emissa `AKs`/`AKo`. Vastausriveillä on sija
epävarmuusväleineen (`rank`, `rankLow`, `rankHigh`), `equity`, `se`,
`combos` ja kombopainotettu `topPct`. Koko taulukon saa CSV:nä:
`/rankings/csv?gameType=…&players=…`.

## Lisenssi ja siteeraus

Koodi on lisensoitu [MIT-lisenssillä](LICENSE). Esilasketut
preflop-taulukot (`data/*.json`, `data/*.csv`) on lisensoitu erikseen
[CC BY 4.0](data/LICENSE) -lisenssillä: niitä saa käyttää, jakaa ja
muokata vapaasti — myös kaupallisesti — kunhan lähde mainitaan.

Siteerausehdotus datalle:

> Korttimestari preflop-equity-taulukot (Riku, 2026).
> https://github.com/rikuxi/korttimestari — CC BY 4.0.

Menetelmät ja virherajat on dokumentoitu taulukoiden `meta`-lohkoissa,
[data/README.md](data/README.md):ssä ja sivuston menetelmäsivulla
(`/menetelmat`).

## Tietoturva

- Helmet (CSP, HSTS, X-Frame-Options ym.) kaikille vastauksille
- Syötteiden validointi: korttiformaatti, tuplakortit, pelaaja- ja
  simulaatiomäärärajat, pyynnön koko enintään 10 kt
- Reittikohtaiset rate limitit (simulaatiot 100/15 min, taulukkohaut
  600/15 min, CSV-lataukset 30/15 min), enintään 4 samanaikaista
  simulaatiosäiettä, simulaation timeout 30 s
- `trust proxy` on oletuksena Cloudflaren IP-alueissa (`trustProxy.js`).
  Oletuslista vanhenee ajan myötä, mutta sitä ei tarvitse muokata
  koodissa: `TRUST_PROXY_IPS` korvaa sen (ks. alla). Ajantasainen lista
  löytyy osoitteesta <https://www.cloudflare.com/ips/>.
