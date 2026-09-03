# Korttimestari — Monte Carlo Poker Simulator

**Live site: <https://www.korttimestari.com/en/>**
(in Finnish: <https://www.korttimestari.com/>)

*Read this in Finnish: [README.md](README.md)*

A browser-based tool for computing poker hand win probabilities with
Monte Carlo simulation. Supports Texas Hold'em, Omaha (4 cards) and
Omaha5 (5 cards), 2–10 players (Omaha variants up to 9).

The UI is bilingual: Finnish at the site root, English under `/en/`.

## Open data: full preflop rankings

The preflop equity tables behind the site's rankings are published in
this repository as open data ([data/](data/), CC BY 4.0):

| Game | Hand classes | Player counts |
|---|---|---|
| Texas Hold'em | 169 | 2–10 (heads-up exact) |
| Omaha | 16,432 | 2–9 (heads-up exact) |
| Omaha5 (5 cards) | 134,459 | 2–9 |

The tables cover every hand class at every player count — with
equities, standard errors and rank uncertainty ranges. Methods and
error bounds are documented in [data/README.en.md](data/README.en.md).

## Features

- Place cards by dragging or double-clicking them from the deck
- Win, tie and equity percentages for every player
- Hero's hand distribution (pair, flush, straight, …) as a bar chart
- **Selected opponents**: every player's cards are known
- **Unknown opponents**: only hero's cards are known; opponents get new
  random hands every deal (opponent percentages are not shown because
  they carry no information)
- **Hand ranges**: an unknown opponent can be limited to the "top X %" of
  the preflop ranking for the player count, each opponent with its own
  range (a slider over the cards; in Hold'em a 13×13 chart in a popover).
  Hands for several ranges are drawn independently and clashing rounds
  are rejected, so the joint distribution is uniform; small cases are
  enumerated exactly
- Board cards (flop/turn/river) can be set or dealt at random
- Folding, random deals, 2- and 4-color decks
- Light and dark theme: defaults to the operating system setting, and
  an explicit choice is remembered in the browser
- **Rankings page** (`/en/rankings`): browse precomputed preflop
  rankings or search with a partial hand; ranks with uncertainty
  ranges, equities with standard errors, a top-X % range chart and CSV
  download

## Getting started

```bash
npm install
npm start          # http://localhost:3002 (port: PORT env variable)
npm run dev        # nodemon development mode
npm test           # tests (Node's built-in test runner)
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | Server port |
| `PREFLOP_CACHE_TABLES` | `10` | Table cache budget in Omaha5-sized tables (~40 MB heap each). The default keeps all 25 tables in memory (measured ~600 MB RSS after warmup). Lower it in memory-constrained environments; below 8 the Omaha5 hand comparison starts re-reading from disk. |
| `PREFLOP_PRELOAD` | on | Warm the table cache at startup so the first visitor does not pay for synchronous disk loads. `off` disables it — use together with a low `PREFLOP_CACHE_TABLES`. |
| `TRUST_PROXY_IPS` | Cloudflare ranges | Trusted reverse proxies: a comma- or space-separated list of addresses and CIDR ranges. The value `off` makes the server ignore `X-Forwarded-For` — use it when the service is **not** behind a proxy, since the header is spoofable there. An invalid value aborts startup. |

## Architecture

| File | Role |
|---|---|
| `public/js/engine.js` | Calculation engine — the **same file** runs in the browser and on the server |
| `public/js/script.js` | User interface |
| `public/js/i18n.js` | UI text catalogs (fi/en); language comes from `<html lang>` |
| `public/js/theme.js` | Light/dark theme selection; loaded in `<head>` before first paint |
| `public/js/poker-worker.js` | Simulation in a browser Web Worker (the primary calculation path) |
| `server.js` | Express server: static files, `POST /simulate` fallback, `GET /preflop` |
| `worker.js` | Server-side worker thread that runs the simulation (requires `public/js/engine.js`) |
| `pokerUtils.js` | Card validation and legacy helpers (poker-evaluator only in the old batch path) |

The simulation runs primarily in the browser. If a Web Worker is not
available or crashes, the browser falls back to the server's
`/simulate` API.

Both paths use the same engine (`public/js/engine.js`), so they cannot
diverge. The engine's `eval5` has been verified against the
poker-evaluator library on all C(52,5) = 2,598,960 hands
(0 ordering conflicts), and the tests watch both paths.

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

Cards use the format `<rank><suit>`: rank `2-9, T, J, Q, K, A`, suit
`s, h, d, c`. `rangePct` (optional, 1–100) limits an unknown opponent to
the top X per cent of the preflop ranking for the active player count; the
server resolves the range from its own table. The field only takes effect
when `randomOpponents` is `true` and the player is not the hero (first
entry); elsewhere it is validated but ignored. An empty range (400,
`range_empty`) means no hand falls within the percentage, or the board and
the other players' cards use up all of its hands; `range_conflict` means
the hands of several ranges cannot be dealt at the same time. `GET /rankings/range?...&keys=1`
returns the same range as class keys for in-browser computation.

## GET /rankings

Browse the ranking table or search with a partial hand (used by the
rankings pages):

```
/rankings?gameType=omaha5&players=6&q=(AJ)(AJ)&offset=0&limit=100
```

An empty `q` browses the whole list in rank order. Query language
([handSearch.js](handSearch.js)): plain ranks (`AAJ`, suits
unconstrained), parenthesised groups (`(AJ)(AJ)` = same suit, separate
groups in different suits), concrete suits (`AsKs`), and `AKs`/`AKo`
for Hold'em. Response rows carry the rank with its uncertainty range
(`rank`, `rankLow`, `rankHigh`), `equity`, `se`, `combos` and the
combo-weighted `topPct`. The full table is available as CSV:
`/rankings/csv?gameType=…&players=…`.

## License and citation

The code is licensed under the [MIT license](LICENSE). The precomputed
preflop tables (`data/*.json`, `data/*.csv`) are licensed separately
under [CC BY 4.0](data/LICENSE): free to use, share and adapt — also
commercially — with attribution.

Suggested citation for the data:

> Korttimestari preflop equity tables (Riku, 2026).
> https://github.com/rikuxi/korttimestari — CC BY 4.0.

Methods and error bounds are documented in each table's `meta` block
and in [data/README.en.md](data/README.en.md).

## Security

- Helmet (CSP, HSTS, X-Frame-Options etc.) on every response
- Input validation: card format, duplicate cards, player and
  simulation count limits, request body capped at 10 kB
- Per-route rate limits (100/15 min for simulations, 600/15 min for
  table lookups, 30/15 min for CSV downloads), at most 4 concurrent
  simulation threads, 30 s simulation timeout
- `trust proxy` defaults to Cloudflare's IP ranges (`trustProxy.js`).
  The default list goes stale over time, but it does not need a code
  change: `TRUST_PROXY_IPS` overrides it (see below). The current list
  is published at <https://www.cloudflare.com/ips/>.
