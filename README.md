# Korttimestari — Monte Carlo -pokerisimulaattori

**Sivusto: <https://www.korttimestari.com/>**
(englanniksi: <https://www.korttimestari.com/en/>)

*Read this in English: [README.en.md](README.en.md)*

Selainpohjainen työkalu pokerikäsien voittotodennäköisyyksien laskentaan
Monte Carlo -simulaatiolla. Tukee Texas Hold'emia, Omahaa (4 korttia),
Omaha5:tä (5 korttia) ja Omaha Hi/Lo:ta (8-or-better, jaettu potti),
2–10 pelaajaa (Omahat enintään 9).

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
| Omaha Hi/Lo (8-or-better) | 16 432 | 2–6 (heads-up eksakti) |

Taulukot kattavat jokaisen käsiluokan jokaisella pelaajamäärällä —
equity-arvoineen, keskivirheineen ja sijaepävarmuuksineen. Hi/Lo-taulukoissa
on lisäksi hi- ja low-osuudet, puoliskojen voitto- ja tasapelitaajuudet
sekä scoop-, osapotti-, kvartautumis- ja low-taajuudet. Menetelmät ja
virherajat on dokumentoitu tiedostossa [data/README.md](data/README.md).

## Ominaisuudet

- Kortit asetellaan raahaamalla tai tuplaklikkaamalla pakasta
- Voitto-, tasapeli- ja equity-prosentit jokaiselle pelaajalle
- Heron käsijakauma (pari, väri, suora, ...) palkkikaaviona
- **Valitut vastustajat**: kaikkien pelaajien kortit tunnetaan
- **Tuntemattomat vastustajat**: vain heron kortit tunnetaan; vastustajille
  arvotaan uudet kädet joka jaossa. Vastustajien luvut näytetään:
  satunnainen käsi on käsialueen 100 % ja perustaso, johon tiukemmat
  alueet vertautuvat
- **Esilaskettu preflop-arvo**: tuntemattomia vastustajia vastaan ilman
  pöytäkortteja heron tarkka tai hybridilaskettu equity haetaan taulukosta
  simulaation rinnalle, sija ja top-% ilmoitukseen; kun kaikki kädet tai
  alueet tunnetaan ja tapauksia on vähän, tulos enumeroidaan tarkasti
- **Omaha Hi/Lo (8-or-better)**: potti jaetaan parhaan hi-käden ja parhaan
  low-käden kesken (low vaatii viisi eri arvoa kahdeksikosta alaspäin; ilman
  low'ta hi vie koko potin). Tulokset erittelevät hi- ja low-osuudet sekä
  puoliskojen voitto- ja tasapelitaajuudet, ja heron low-tilastot kerrotaan
  erikseen
- **Käsialueet**: tuntemattomalle vastustajalle voi antaa alueen "top X %"
  pelaajamäärän preflop-rankingista, jokaiselle omansa (liukusäädin
  korttien päällä, Hold'emissa 13×13-chart ponnahdusikkunassa). Useiden
  alueiden kädet arvotaan riippumattomasti ja törmäävät kierrokset
  hylätään, joten yhteisjakauma on tasainen; pienissä tapauksissa alueet
  enumeroidaan tarkasti
- Pöytäkortit (flop/turn/river) voi asettaa tai arpoa
- Foldaus, korttien arvonta, 2- ja 4-värinen pakka
- Vaalea ja tumma tila: oletus tulee käyttöjärjestelmän asetuksesta,
  ja oma valinta muistetaan selaimessa
- **Rankingsivu** (`/rankingit`): selaa esilaskettuja
  preflop-rankingeja tai hae osittaiskädellä; sijat epävarmuusväleineen,
  equityt keskivirheineen, top-X %:n aluechart ja CSV-lataus. Hi/Lo:ssa
  hi- ja low-sarakkeet sekä käden detaljipaneelissa puoliskojen taajuudet
  ja potinosuuden jakauma

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
| `PREFLOP_CACHE_TABLES` | `10` | Taulukkovälimuistin budjetti Omaha5-kokoisina taulukoina (~40 MB heapia kpl). Oletus pitää kaikki 30 taulukkoa muistissa (mitattu ~700 MB RSS lämmityksen jälkeen). Muistiahtaassa ympäristössä rajaa voi pudottaa; alle 8:lla Omaha5:n käsivertailu alkaa lukea levyltä. |
| `RANGE_CACHE_MB` | `96` | Laajennettujen käsialueiden (`rangePct`) välimuistin tavubudjetti megatavuina. Worker laajentaa alueen kerran jaettuun muistiin ja seuraavat `/simulate`-pyynnöt käyttävät sitä sellaisenaan (Omaha5 top 30 %: 386 ms → 98 ms). Yksi merkintä on enintään ~47 MB (Omaha5 top 90 %); `0` poistaa välimuistin käytöstä. |
| `PREFLOP_PRELOAD` | päällä | Taulukoiden esilämmitys käynnistyksessä, ettei ensimmäinen kävijä maksa synkronisia levylatauksia. `off` poistaa käytöstä — käytä yhdessä matalan `PREFLOP_CACHE_TABLES`-arvon kanssa. |
| `TRUST_PROXY_IPS` | Cloudflaren alueet | Luotetut käänteisproxyt: pilkulla tai välilyönnillä eroteltu lista osoitteita ja CIDR-alueita. Arvo `off` jättää `X-Forwarded-For`-otsakkeen huomiotta — käytä sitä kun palvelu **ei** ole proxyn takana, koska silloin otsake on väärennettävissä. Kelvoton arvo kaataa käynnistyksen. |

## Arkkitehtuuri

| Tiedosto | Rooli |
|---|---|
| `public/js/games.js` | Pelimuotorekisteri (kortit per pelaaja, hi/lo, maksimipelaajat, avainkuvio, taulukkopäätteet, kustannukset) — ladataan selaimessa ja palvelimella ennen moottoria |
| `public/js/engine.js` | Laskentamoottori — **sama tiedosto** ajetaan selaimessa ja palvelimella; Monte Carlo, tarkka enumerointi, käsialueiden laajennus, Hi/Lo:n jaettu potti |
| `public/js/script.js` | Simulaattorin käyttöliittymä |
| `public/js/ranges.js` | Käsialueiden säätimet ja ponnahdusikkuna; hakee alueen avaimet |
| `public/js/rankings.js` | Rankingsivu: taulukko, käsihaku, detaljipaneeli, aluechart |
| `public/js/i18n.js` | Käyttöliittymätekstien katalogit (fi/en); kieli tulee `<html lang>`-attribuutista |
| `public/js/theme.js` | Vaalean ja tumman tilan valinta; ladataan `<head>`:ssä ennen sivun piirtoa |
| `public/js/poker-worker.js` | Simulaatio selaimen Web Workerissa (ensisijainen laskentapolku) |
| `server.js` | Express-palvelin: staattiset tiedostot, `POST /simulate` -varapolku, `/preflop`- ja `/rankings`-reitit |
| `worker.js` | Palvelimen worker-säie, joka ajaa simulaation (requiroi `public/js/engine.js`) |
| `preflopTables.js` | Esilaskettujen taulukoiden lataus, välimuisti ja top-X %:n alueet |
| `handSearch.js`, `canonical.js` | Käsihaun kyselykieli ja käsiluokkien kanoniset avaimet |
| `rangeHandsCache.js` | Laajennettujen käsialueiden välimuisti palvelimen `/simulate`-polulle |
| `trustProxy.js` | Luotettujen käänteisproxyjen lista (`TRUST_PROXY_IPS`) |
| `pokerUtils.js` | Kortin validointi ja legacy-apurit (poker-evaluator vain vanhassa eräajopolussa) |
| `scripts/` | Taulukoiden eräajot (eksakti ja hybridi) ja niiden varmennukset; yhteiset apurit `batchCommon.js` |

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
  "gameType": "holdem | omaha | omaha5 | omahahilo",
  "randomOpponents": true,
  "playerHandsData": [
    { "hand": ["As", "Ks"], "isFolded": false },
    { "hand": [], "isFolded": false, "rangePct": 30 }
  ],
  "communityCards": { "flop": ["2h", "7d", "Jc"], "turn": null, "river": null }
}
```

Kortit muodossa `<arvo><maa>`: arvo `2-9, T, J, Q, K, A`, maa `s, h, d, c`.
`rangePct` (valinnainen, 1–100) rajaa tuntemattoman vastustajan kädet
aktiivisen pelaajamäärän preflop-rankingin parhaisiin X prosenttiin;
palvelin ratkaisee alueen itse taulukosta. Kenttä vaikuttaa vain, kun
`randomOpponents` on `true` ja pelaaja ei ole hero (ensimmäinen alkio):
muualla se validoidaan mutta ohitetaan. Tyhjä alue (400, `range_empty`)
tarkoittaa, ettei prosenttiin osu yhtään kättä tai että pöytä ja muiden
kortit vievät kaikki sen kädet; `range_conflict` sitä, etteivät usean
alueen kädet mahdu jakoon yhtä aikaa. `GET /rankings/range?...&keys=1`
palauttaa saman alueen luokka-avaimet selaimen laskentaa varten.

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
`combos` ja kombopainotettu `topPct`; Hi/Lo-riveillä lisäksi `hiEquity`,
`loEquity`, `hiWin`, `hiTie`, `loWin` ja `loTie`. Koko taulukon saa CSV:nä:
`/rankings/csv?gameType=…&players=…`.

## Muut reitit

| Reitti | Vastaus |
|---|---|
| `GET /preflop?gameType=…&players=…&hand=As,Ks` | Heron esilaskettu preflop-equity tuntemattomia vastustajia vastaan: `equity`, `exact` (tarkka vai hybridi), `standardError`, sija epävarmuusväleineen ja `topPct`; Hi/Lo:ssa myös hi/lo-osuudet ja puoliskojen taajuudet |
| `GET /preflop/available` | Mille pelimuoto–pelaajamäärä-yhdistelmille taulukko on olemassa |
| `GET /rankings/hand?gameType=…&key=…` | Yksi käsiluokka kaikilla pelaajamäärillä; Hi/Lo:ssa lisäksi `scoop`, `partPot`, `quarter`, `scoopedOn`, `lowMade` ja `nutLow` |
| `GET /rankings/range?gameType=…&players=…&pct=…[&keys=1]` | Top-X %:n alueen luokka- ja kombomäärät sekä heikoin mukana oleva käsi; `keys=1` palauttaa myös luokka-avaimet |

Pelimuoto (`gameType`) on aina `holdem`, `omaha`, `omaha5` tai `omahahilo`.
Virhevastauksissa on koneluettava `code`-kenttä, jonka käyttöliittymä kääntää.

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
