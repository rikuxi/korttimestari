# Esilasketut preflop-taulukot

*Read this in English: [README.en.md](README.en.md)*

Taulukot kattavat jokaisen käsiluokan jokaisella pelaajamäärällä:
Hold'em (169 luokkaa, 2–10 pelaajaa), Omaha (16 432 luokkaa,
2–9 pelaajaa), viisikorttinen Omaha (134 459 luokkaa, 2–9 pelaajaa)
ja Omaha Hi/Lo 8-or-better (16 432 luokkaa, heads-up) —
equity-arvoineen, keskivirheineen ja sijaepävarmuuksineen. Data on
vapaasti käytettävissä [CC BY 4.0](LICENSE) -lisenssillä.

Tämän hakemiston juuressa on **vain ne taulukot joita sivusto käyttää**.
Palvelin lataa ne käynnistyksen jälkeen kerran ja tarjoilee `/preflop`-haulla
([preflopTables.js](../preflopTables.js)).

Jokainen taulukko on sama asia kahdessa muodossa: `.json` koodille ja `.csv`
ihmiselle. Menetelmä ja tarkkuus ovat tiedoston `meta`-lohkossa.

## Tuotannossa

| Tiedosto | Peli | Pelaajia | Menetelmä | Tarkkuus (mediaani) |
|---|---|---|---|---|
| `preflop-holdem-2max-exact` | Hold'em | 2 | eksakti | **tarkka murtoluku** |
| `preflop-holdem-3max-hybrid` | Hold'em | 3 | hybridi | ± 0.0013 pp |
| `preflop-holdem-4max-hybrid` | Hold'em | 4 | hybridi | ± 0.0010 pp |
| `preflop-holdem-5max-hybrid` | Hold'em | 5 | hybridi | ± 0.0008 pp |
| `preflop-holdem-6max-hybrid` | Hold'em | 6 | hybridi | ± 0.0007 pp |
| `preflop-holdem-7max-hybrid` | Hold'em | 7 | hybridi | ± 0.0007 pp |
| `preflop-holdem-8max-hybrid` | Hold'em | 8 | hybridi | ± 0.0007 pp |
| `preflop-holdem-9max-hybrid` | Hold'em | 9 | hybridi | ± 0.0006 pp |
| `preflop-holdem-10max-hybrid` | Hold'em | 10 | hybridi | ± 0.0005 pp |
| `preflop-omaha-2max-exact` | Omaha | 2 | eksakti | **tarkka murtoluku** |
| `preflop-omaha-3max-hybrid` | Omaha | 3 | hybridi | ± 0.0046 pp |
| `preflop-omaha-4max-hybrid` | Omaha | 4 | hybridi | ± 0.0037 pp |
| `preflop-omaha-5max-hybrid` | Omaha | 5 | hybridi | ± 0.0034 pp |
| `preflop-omaha-6max-hybrid` | Omaha | 6 | hybridi | ± 0.0030 pp |
| `preflop-omaha-7max-hybrid` | Omaha | 7 | hybridi | ± 0.0025 pp |
| `preflop-omaha-8max-hybrid` | Omaha | 8 | hybridi | ± 0.0022 pp |
| `preflop-omaha-9max-hybrid` | Omaha | 9 | hybridi | ± 0.0019 pp |
| `preflop-omaha5-2max-hybrid` | Omaha5 | 2 | hybridi | ± 0.0103 pp |
| `preflop-omaha5-3max-hybrid` | Omaha5 | 3 | hybridi | ± 0.0095 pp |
| `preflop-omaha5-4max-hybrid` | Omaha5 | 4 | hybridi | ± 0.0125 pp |
| `preflop-omaha5-5max-hybrid` | Omaha5 | 5 | hybridi | ± 0.0106 pp |
| `preflop-omaha5-6max-hybrid` | Omaha5 | 6 | hybridi | ± 0.0078 pp |
| `preflop-omaha5-7max-hybrid` | Omaha5 | 7 | hybridi | ± 0.0067 pp |
| `preflop-omaha5-8max-hybrid` | Omaha5 | 8 | hybridi | ± 0.0058 pp |
| `preflop-omaha5-9max-hybrid` | Omaha5 | 9 | hybridi | ± 0.0051 pp |
| `preflop-omahahilo-2max-exact` | Omaha Hi/Lo | 2 | eksakti | **tarkka murtoluku** |

**Eksakti** = kaikki C(52,5) = 2 598 960 pöytää ja kaikki vastustajakädet
käydään läpi; tulos on tarkka murtoluku, ja `winCount`/`tieCount`/`denominator`
ovat mukana tiedostossa. **Hybridi** = eksakti pöytien yli, Monte Carlo vain
vastustajien korttien poiston yli; rivikohtainen keskivirhe on `se`-kentässä.

Hold'emissa on 169 käsiluokkaa, Omahassa 16 432, viisikorttisessa Omahassa
134 459.

### Omaha Hi/Lo (8-or-better)

Hi/Lo:ssa equity on keskimääräinen **osuus jaetusta potista**: puolet
potista parhaalle korkealle kädelle ja puolet parhaalle kelvolliselle
low'lle (viisi eri arvoa, kaikki korkeintaan 8, ässä matalana); jos
kukaan ei tee low'ta, korkea käsi vie koko potin. Taulukossa on
`equity`-sarakkeen lisäksi `hiEquity` ja `loEquity` (CSV:
`hi_equity_pct`/`lo_equity_pct`): hi-osuus sisältää koko potin niiltä
pöydiltä joilla kumpikaan ei tehnyt low'ta, joten hiEquity + loEquity =
equity. Osoittajat `hiNumerator`/`loNumerator` ovat neljännespotin
kokonaislukuyksiköissä ja `denominator` = kombot × C(48,5) × C(43,4) × 4,
joten tulos on tarkistettavissa ilman uudelleenlaskentaa.

### Sija-alue `rankLow`/`rankHigh` (CSV: `rank_low`/`rank_high`)

`rank` yksinään esittäisi järjestyksen tarkempana kuin se on: hybridissä
naapurikäsien erot ovat usein pienempiä kuin keskivirhe. Sija-alue kertoo,
millä sijoilla käsi voi keskivirheiden puitteissa olla: naapuri kuuluu
alueeseen jos equity-ero on alle `2·sqrt(se_i² + se_j²)`, ja aluetta
kasvatetaan kunnes ehto katkeaa (`scripts/rankBounds.js`, generaattorit
kutsuvat samaa funktiota). Eksakteissa taulukoissa alue on aina
`[rank, rank]`.

Mitatut leveydet: Hold'em keskimäärin ~1 sija (käytännössä naulattu),
Omaha ~20–24 sijaa, Omaha5 ~300–540 sijaa. Listojen kärjet ja hännät ovat
naulattuja kaikissa.

### Kaksi keskivirhettä: `se` ja `seCmp` (CSV: `std_error_pp`/`std_error_cmp_pp`)

`se` on yksittäisen equity-luvun absoluuttinen keskivirhe. Saman ajon
toistot jakavat kuitenkin pienen yhteisen siirtymän, joka **kumoutuu kahta
kättä vertailtaessa** — siksi naiivi `sqrt(se_i² + se_j²)` yliarvioi erojen
epävarmuuden noin 20 % (mitattu eksaktia heads-up-taulukkoa vasten: parien
erojen RMS z 0.815 vs yksittäisten käsien 0.996). `seCmp` on
vertailukeskivirhe, josta siirtymä on poistettu: käytä sitä järjestys- ja
erokysymyksiin, `se`:tä absoluuttiseen equityyn
(`scripts/replicateStats.js`).

`seCmp` lasketaan toistokohtaisista summista, joita ei tallenneta
tulostiedostoihin — siksi sitä **ei voi laskea jälkikäteen** eikä sitä ole
nykyisissä taulukoissa. Kenttä ilmestyy kun taulukko ajetaan seuraavan
kerran uudelleen. `rankLow`/`rankHigh` on laskettu `se`:stä, eli alueet
ovat hienoisesti leveämpiä (varovaisempia) kuin `seCmp`:llä laskettuna.

Omaha-taulukoissa on kaksi nimisaraketta. `label` on luettava ('AAJJT (ds)')
mutta **ei yksilöi luokkaa**: viisikorttisessa 134 459 luokalle on vain
28 496 nimeä. `notation` merkitsee saman maan kortit sulkuihin
('(AJ)(AJ)T') ja on yksikäsitteinen. Yksilöivä tunniste on aina `hand`.

Merkintä noudattaa ProPokerToolsin julkaisemaa muotoa: ryhmät arvojärjestyksessä
laskevasti, tasatilanteessa pidempi ensin - siis 'AA(JT)' eikä '(JT)AA'.
Sääntö on verifioitu heidän 16 432 rivin listaansa vastaan, jonka se toistaa
merkki merkiltä. Huomaa ettei tämä ole sama kuin ProPokerToolsin
*kyselysyntaksi*, jossa sulut ryhmittävät vaihtoehtoja.

### Riittääkö tarkkuus järjestämään listan?

| | ennen (10⁶ sim/käsi) | nyt |
|---|---|---|
| Hold'em 2max | 88/168 peräkkäistä paria erotettu | **168/168** (eksakti) |
| Hold'em 6max | 81/168 | **164/168** |
| Hold'em 9max | 61/168 | **168/168** |

Omahassa 16 432 käden lista ei ratkea kokonaan millään saavutettavalla
tarkkuudella - peräkkäisten erot ovat pienempiä kuin keskivirhe.

## Puuttuu

| Peli | Puuttuvat pelaajamäärät |
|---|---|
| Hold'em | - (kaikki 2-10 laskettu) |
| Omaha | - (kaikki 2-9 laskettu) |
| Omaha5 | - (kaikki 2-9 laskettu) |

Omaha5:lle ei ole eksaktia taulukkoa millään pelaajamäärällä (laskenta
olisi liian raskas) - sivusto näyttää sille aina hybridiarvon
keskivirheineen.

## Miten taulukot syntyvät

```bash
# Eksakti heads-up
node scripts/exactHoldem.js      # 9 s
node scripts/exactOmaha.js       # 40 min

# Moninpeli, mikä tahansa pelaajamäärä
node scripts/hybridHoldem.js --players 6 --configs 512 --replicates 16   # 3 min
node scripts/hybridOmaha.js  --players 6 --configs 128 --replicates 16   # 20 min
node scripts/hybridOmaha5.js --players 6 --configs 64  --replicates 8    # 37 min

# Vanha Monte Carlo -eräajo (ei enää käytössä, säilytetty vertailua varten)
npm run precompute:holdem
npm run precompute:omaha
```

`--configs` on skaalattava pelaajamäärän mukaan: yksi konfiguraatio pisteyttää
`C(47 - 4·(pelaajat-1), 4)` kättä, mikä vaihtelee 60-kertaisesti (123 410
kädestä kahdella pelaajalla 1 365:een yhdeksällä). Käytetyt arvot, jotka
antavat kaikille suunnilleen saman työmäärän ja tarkkuuden:

| pelaajia | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|
| Omaha `--configs` | 32 | 48 | 64 | 128 | 256 | 576 | 1648 | - |
| Hold'em `--configs` | 384 | 416 | 464 | 512 | 576 | 640 | 736 | 848 |
| Omaha5 `--configs` | 8 | 8 | 16 | 64 | 272 | 2128 | 80256 | - |

Omaha5:ssä 2 ja 3 pelaajan ajot ovat raskaimmat, koska yksi konfiguraatio
pisteyttää 850 668 kättä (kuudella pelaajalla 26 334, kahdeksalla vain 792).
Konfiguraatioita ei voi laskea alle toistojen määrän, joten ne tekevät
väistämättä 2-4-kertaisen työn.

Tarkkuutta ohjaa konfiguraatioiden lukumäärä, ei käsien määrä konfiguraatiota
kohti: yhden konfiguraation sisällä näytteet ovat vahvasti korreloituneita
(sama pöytä, samat vastustajat). Siksi 8 pelaajan taulukko on tarkin
(± 0.0058 pp, 2 128 konfiguraatiota) ja 4 pelaajan epätarkin (± 0.0125 pp,
8 konfiguraatiota) - vaikka edellinen pisteyttää vain 792 kättä kerrallaan ja
jälkimmäinen 201 376.

Suurilla pelaajamäärillä konfiguraatiokohtainen yleiskustannus alkaa painaa:
8 pelaajan ajossa jokaista konfiguraatiota kohti sekoitetaan 35 korttia ja
arvioidaan seitsemän vastustajan kädet, mutta pisteytettäviä heron käsiä on
vain 792. Se venytti ajon 1 h 35 min:iin kun 7 pelaajan ajo vei 59 min.
Äärimmillään tämä näkyy 9 pelaajan ajossa: 80 256 konfiguraatiota per pöytä
pisteyttää vain 21 kättä kerrallaan, ja ajo kesti 4 h 28 min - mutta koska
tarkkuus seuraa konfiguraatioiden määrää, siitä tuli perheen tarkin taulukko
(± 0.0051 pp).

Hold'emissa hajonta on pieni (903 kädestä 406:een), Omahassa 60-kertainen.
Ajoaika: Hold'em 3 min, Omaha 17-39 min per pelaajamäärä (30 workeria).

Omaha5:n ajo on **keskeytettävissä**: se kirjoittaa checkpointin kahden
minuutin välein, ja saman komennon ajaminen uudelleen jatkaa siitä mihin
jäätiin. `--max-minutes N` katkaisee siististi, `--restart` aloittaa alusta.
Muut ajot ovat niin lyhyitä ettei sitä tarvita.

Menetelmien perustelut ja tarkkuusanalyysi on tiivistetty sivuston
menetelmäsivulle (`/menetelmat`, englanniksi `/en/methods`).

## Vanhat ajot

Repossa oli aiemmin `archive/`-hakemisto, jossa säilytettiin korvatut
Monte Carlo -taulukot ja hybridimenetelmän validointiajot. Ne on poistettu
reposta turhana painolastina — kaikki ajot voi toistaa tämän hakemiston
skripteillä, ja validointien tulokset (mm. RMS z = 0.996) on dokumentoitu
taulukoiden `meta`-lohkoissa ja menetelmäkuvauksissa.
