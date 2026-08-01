# Precomputed preflop tables

*Read this in Finnish: [README.md](README.md)*

The tables cover every hand class at every player count: Hold'em
(169 classes, 2–10 players), Omaha (16,432 classes, 2–9 players),
five-card Omaha (134,459 classes, 2–9 players) and Omaha Hi/Lo
8-or-better (16,432 classes, 2–3 players) — with equities,
standard errors and rank uncertainty ranges. The data is free to use
under the [CC BY 4.0](LICENSE) license.

The root of this directory contains **only the tables the site uses**.
The server loads them once after startup and serves them via the
`/preflop` lookup ([preflopTables.js](../preflopTables.js)).

Every table exists in two forms of the same content: `.json` for code
and `.csv` for humans. The method and precision are in each file's
`meta` block.

## In production

| File | Game | Players | Method | Precision (median) |
|---|---|---|---|---|
| `preflop-holdem-2max-exact` | Hold'em | 2 | exact | **exact fraction** |
| `preflop-holdem-3max-hybrid` | Hold'em | 3 | hybrid | ± 0.0013 pp |
| `preflop-holdem-4max-hybrid` | Hold'em | 4 | hybrid | ± 0.0010 pp |
| `preflop-holdem-5max-hybrid` | Hold'em | 5 | hybrid | ± 0.0008 pp |
| `preflop-holdem-6max-hybrid` | Hold'em | 6 | hybrid | ± 0.0007 pp |
| `preflop-holdem-7max-hybrid` | Hold'em | 7 | hybrid | ± 0.0007 pp |
| `preflop-holdem-8max-hybrid` | Hold'em | 8 | hybrid | ± 0.0007 pp |
| `preflop-holdem-9max-hybrid` | Hold'em | 9 | hybrid | ± 0.0006 pp |
| `preflop-holdem-10max-hybrid` | Hold'em | 10 | hybrid | ± 0.0005 pp |
| `preflop-omaha-2max-exact` | Omaha | 2 | exact | **exact fraction** |
| `preflop-omaha-3max-hybrid` | Omaha | 3 | hybrid | ± 0.0046 pp |
| `preflop-omaha-4max-hybrid` | Omaha | 4 | hybrid | ± 0.0037 pp |
| `preflop-omaha-5max-hybrid` | Omaha | 5 | hybrid | ± 0.0034 pp |
| `preflop-omaha-6max-hybrid` | Omaha | 6 | hybrid | ± 0.0030 pp |
| `preflop-omaha-7max-hybrid` | Omaha | 7 | hybrid | ± 0.0025 pp |
| `preflop-omaha-8max-hybrid` | Omaha | 8 | hybrid | ± 0.0022 pp |
| `preflop-omaha-9max-hybrid` | Omaha | 9 | hybrid | ± 0.0019 pp |
| `preflop-omaha5-2max-hybrid` | Omaha5 | 2 | hybrid | ± 0.0103 pp |
| `preflop-omaha5-3max-hybrid` | Omaha5 | 3 | hybrid | ± 0.0095 pp |
| `preflop-omaha5-4max-hybrid` | Omaha5 | 4 | hybrid | ± 0.0125 pp |
| `preflop-omaha5-5max-hybrid` | Omaha5 | 5 | hybrid | ± 0.0106 pp |
| `preflop-omaha5-6max-hybrid` | Omaha5 | 6 | hybrid | ± 0.0078 pp |
| `preflop-omaha5-7max-hybrid` | Omaha5 | 7 | hybrid | ± 0.0067 pp |
| `preflop-omaha5-8max-hybrid` | Omaha5 | 8 | hybrid | ± 0.0058 pp |
| `preflop-omaha5-9max-hybrid` | Omaha5 | 9 | hybrid | ± 0.0051 pp |
| `preflop-omahahilo-2max-exact` | Omaha Hi/Lo | 2 | exact | **exact fraction** |
| `preflop-omahahilo-3max-hybrid` | Omaha Hi/Lo | 3 | hybrid | ± 0.0039 pp |

**Exact** = all C(52,5) = 2,598,960 boards and all opponent hands are
enumerated; the result is an exact fraction, and
`winCount`/`tieCount`/`denominator` are included in the file.
**Hybrid** = exact over boards, Monte Carlo only over opponent card
removal; the per-row standard error is in the `se` field.

Hold'em has 169 hand classes, Omaha 16,432, five-card Omaha 134,459.

### Omaha Hi/Lo (8-or-better)

In Hi/Lo the equity is the average **share of the split pot**: half the
pot goes to the best high hand and half to the best qualifying low
(five distinct ranks, all eight or lower, ace playing low); if nobody
makes a low, the high hand takes the whole pot. In addition to the
`equity` column the table has `hiEquity` and `loEquity` (CSV:
`hi_equity_pct`/`lo_equity_pct`): the hi share includes the whole pot
from boards where neither player made a low, so hiEquity + loEquity =
equity. The numerators `hiNumerator`/`loNumerator` are in integer
quarter-pot units and `denominator` = combos × C(48,5) × C(43,4) × 4,
so the result can be checked without recomputation.

Alongside the shares there are **win frequencies**, which answer a
different question: `hiWin`, `hiTie`, `loWin` and `loTie` (CSV:
`hi_win_pct` and so on) say how often a half is taken outright or split.
Share and frequency differ because winning the high half takes the whole
pot only on a board with no qualifying low, and half the pot otherwise.
Their denominator is `deals` = combos × C(48,5) × C(43,4), the number of
(board, opponent) pairs — a quarter of the equity denominator, because the
figure is a share of deals rather than of the pot. The integer counts are
in `hiWinCount`, `hiTieCount`, `loWinCount` and `loTieCount`.

Third comes the **distribution of the whole pot share**: `scoop` (whole pot
alone), `partPot` (some of it but not all), `quarter` (the share drops to a
quarter), `half`, `threeQuarters` and `scoopedOn` (the opponent takes
everything). These sum to 100 %, and weighted by quarters they reproduce the
equity - both are checked during the run. Scoop requires the **joint**
distribution of high and low and does not follow from the other columns:
measured, `scoop / hiWin` ranges from 0.60 to 0.94. KKQQ (ds), for example,
takes the high half more often than the top-ranked hand but scoops far less,
because on a low board it only gets half.

Two columns do not depend on the opponent at all: `lowMade` is how often the
hand makes a qualifying low and `nutLow` how often that low is the best one
available on the board. Their denominator is `boards` = combos × C(48,5),
not the number of (board, opponent) pairs.

`quarter` is the one to watch in hi/lo: it is the **quartering frequency**,
how often the share drops to a quarter of the pot. Against a random hand the
figure is small, but it makes visible the assumption the whole table rests on
(see the note on ranking limits below).

**The multiway hi/lo tables** (`preflop-omahahilo-3max-hybrid`) carry the
same columns with three exceptions. Each share has its own standard error:
`se`/`seCmp` for the equity, `seHi` and `seLo` for the halves.
`threeQuarters` is gone, because multiway the share is not confined to
quarters — a three-way split produces sixths as well — and in its place is
`half`, by far the most common single share. `lowMade` and `nutLow` are
gone because they do not depend on the player count at all; the exact
values are in the heads-up table. Shares are accumulated as integers with
the whole pot as 5040 units: the number is divisible by every tie size
from 2 to 10 players and the quotient is always even, so splitting into
halves is exact as well and no rounding error arises.

### Rank range `rankLow`/`rankHigh` (CSV: `rank_low`/`rank_high`)

`rank` alone would present the ordering as more precise than it is: in
the hybrid tables the differences between neighbouring hands are often
smaller than the standard error. The rank range tells which ranks the
hand could occupy within the error bounds: a neighbour belongs to the
range if the equity difference is less than `2·sqrt(se_i² + se_j²)`,
and the range is grown until the condition breaks
(`scripts/rankBounds.js`; the generators call the same function). In
the exact tables the range is always `[rank, rank]`.

Measured widths: Hold'em on average ~1 rank (effectively pinned),
Omaha ~20–24 ranks, Omaha5 ~300–540 ranks. The tops and tails are
pinned in every list.

### Two standard errors: `se` and `seCmp` (CSV: `std_error_pp`/`std_error_cmp_pp`)

`se` is the absolute standard error of a single equity number. The
replicates of one run, however, share a small common shift that
**cancels out when comparing two hands** — so the naive
`sqrt(se_i² + se_j²)` overestimates the uncertainty of differences by
about 20 % (measured against the exact heads-up table: RMS z of pair
differences 0.815 vs 0.996 for single hands). `seCmp` is the
comparison standard error with the shift removed: use it for ordering
and difference questions, `se` for absolute equity
(`scripts/replicateStats.js`).

`seCmp` is computed from per-replicate sums that are not stored in the
output files — so it **cannot be computed after the fact** and is not
present in the current tables. The field will appear the next time a
table is regenerated. `rankLow`/`rankHigh` is computed from `se`, so
the ranges are slightly wider (more conservative) than they would be
with `seCmp`.

The Omaha tables have two name columns. `label` is readable
('AAJJT (ds)') but **does not identify the class**: in five-card Omaha
the 134,459 classes share only 28,496 names. `notation` puts cards of
the same suit in parentheses ('(AJ)(AJ)T') and is unambiguous. The
unique identifier is always `hand`.

The notation follows the format published by ProPokerTools: groups in
descending rank order, longer group first on ties — so 'AA(JT)', not
'(JT)AA'. The rule has been verified against their 16,432-row list,
which it reproduces character by character. Note that this is not the
same as ProPokerTools' *query syntax*, where parentheses group
alternatives.

### Is the precision enough to order the list?

| | before (10⁶ sims/hand) | now |
|---|---|---|
| Hold'em 2max | 88/168 consecutive pairs separated | **168/168** (exact) |
| Hold'em 6max | 81/168 | **164/168** |
| Hold'em 9max | 61/168 | **168/168** |

In Omaha the 16,432-hand list cannot be fully resolved at any
attainable precision - the differences between consecutive hands are
smaller than the standard error.

### Omaha Hi/Lo: what the ordering measures

The Hi/Lo heads-up table is exact and the three-handed one is a hybrid, so
a rank is hardly limited by precision. What
limits the reading is the **scenario**: equity is computed against a
random hand, and a random hand qualifies for low fairly rarely. Hands
whose value rests on the low half alone - typically a bare A2 with no
high support - therefore rank higher than they deserve against a
realistic set of opponents: at a table where others also play A2 cards
the low gets split and the share drops to a quarter.

The `loTie` column makes this measurable: it says how often the low half
is split **in this scenario**. The three-handed table shows which way the
figure moves: the median rises from 2.00 % to 2.57 % and quartering from
1.13 % to 2.27 %; for the top-ranked AA32 (ds) `loTie` goes from 2.12 % to
4.03 %. Competition for the low does grow with the player count, but
against random hands it grows slowly — at a real table, where the others
also select for A2 cards, the rise is far steeper.

Note that the ordering nevertheless moves the opposite way to the naive
guess: against random opponents, low-leaning hands **rise** three-handed
(5432 climbs more than 8,000 ranks), because one more player competes for
the high half while barely anyone competes for the low. The same effect
read backwards: a bare A2 looks stronger on the list the more players sit
at the table, precisely when its real quartering risk is greatest.

## Missing

| Game | Missing player counts |
|---|---|
| Hold'em | - (all of 2-10 computed) |
| Omaha | - (all of 2-9 computed) |
| Omaha5 | - (all of 2-9 computed) |
| Omaha Hi/Lo | 4-9 (2-3 computed) |

Omaha5 has no exact table at any player count (the computation would
be too heavy) - the site always shows it a hybrid value with its
standard error.

## How the tables are generated

```bash
# Exact heads-up
node scripts/exactHoldem.js      # 9 s
node scripts/exactOmaha.js       # 40 min
node scripts/exactOmahaHilo.js   # 1 h 45 min

# Brute-force verification of the exact Hi/Lo solver before a run
node scripts/verifyExactHilo.js  # 10 s

# Multiway, any player count
node scripts/hybridHoldem.js --players 6 --configs 512 --replicates 16   # 3 min
node scripts/hybridOmaha.js  --players 6 --configs 128 --replicates 16   # 20 min
node scripts/hybridOmaha5.js --players 6 --configs 64  --replicates 8    # 37 min

# Old Monte Carlo batch run (no longer used, kept for comparison)
npm run precompute:holdem
npm run precompute:omaha
```

`--configs` must be scaled with the player count: one configuration
scores `C(47 - 4·(players-1), 4)` hands, which varies 60-fold (from
123,410 hands with two players to 1,365 with nine). The values used,
which give every run roughly the same workload and precision:

| players | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|
| Omaha `--configs` | 32 | 48 | 64 | 128 | 256 | 576 | 1648 | - |
| Hold'em `--configs` | 384 | 416 | 464 | 512 | 576 | 640 | 736 | 848 |
| Omaha5 `--configs` | 8 | 8 | 16 | 64 | 272 | 2128 | 80256 | - |

In Omaha5 the 2- and 3-player runs are the heaviest, because one
configuration scores 850,668 hands (26,334 with six players, only 792
with eight). The number of configurations cannot go below the number
of replicates, so those runs inevitably do 2-4x the work.

Precision is driven by the number of configurations, not by the number
of hands per configuration: within one configuration the samples are
strongly correlated (same board, same opponents). That is why the
8-player table is the most precise (± 0.0058 pp, 2,128 configurations)
and the 4-player table the least (± 0.0125 pp, 8 configurations) -
even though the former scores only 792 hands at a time and the latter
201,376.

At high player counts the per-configuration overhead starts to
dominate: in the 8-player run every configuration shuffles 35 cards
and evaluates seven opponents' hands but scores only 792 hero hands.
That stretched the run to 1 h 35 min while the 7-player run took
59 min. The extreme is the 9-player run: 80,256 configurations per
board score only 21 hands at a time, and the run took 4 h 28 min - but
since precision follows the configuration count, it became the most
precise table in the family (± 0.0051 pp).

In Hold'em the spread is small (903 hands down to 406), in Omaha
60-fold. Runtime: Hold'em 3 min, Omaha 17-39 min per player count
(30 workers).

The Omaha5 run is **resumable**: it writes a checkpoint every two
minutes, and re-running the same command continues where it left off.
`--max-minutes N` stops cleanly, `--restart` starts over. The other
runs are short enough not to need it.

The rationale for the methods and the precision analysis are
summarised on the site's methods page (`/en/methods`, in Finnish
`/menetelmat`).

## Old runs

The repository used to have an `archive/` directory holding the
superseded Monte Carlo tables and the hybrid method's validation runs.
They were removed from the repository as dead weight - every run can
be reproduced with the scripts above, and the validation results
(e.g. RMS z = 0.996) are documented in the tables' `meta` blocks and
in the method descriptions.
