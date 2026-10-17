# İşte Promiyer Lig — FPL mini-league dashboard

A tiny, zero-dependency website for a Fantasy Premier League **classic mini-league**:
live standings, gameweek points, period races with prizes, and every manager's lineup —
hosted for free on GitHub Pages and refreshed automatically by GitHub Actions.

**Live:** https://merbil.github.io/iste-promiyer-lig/

## Features

- **League table** — total, GW-by-GW points (net of transfer hits), running sum per
  prize period, rank movement since last GW, GW wins ("GW Leads", ties split).
- **Leaders highlighted** — current period leader and current GW leader.
- **Lineups** — tap a team name to see the starting XI on a pitch (club-coloured
  shirts), bench, captain/vice and auto-subs. A compact *Kadro* pill shows captain
  points and bench points at a glance.
- **Chips & transfers** — chip played this GW as a tag next to the team (TC / BB / FH /
  WC), plus this GW's transfers.
- **Hall of Fame** — live winners for every prize period, overall top 5, most GW wins,
  highest single-GW score and the FPL league cup, with prize amounts.
- **Rules (Kurallar)** popup, **LIVE** marker while a GW is in progress, dark mode,
  mobile-first layout.

## How it works

```
GitHub Actions (every 3 h)          GitHub Pages (static)
┌──────────────────────────┐        ┌──────────────────────────────┐
│ node scripts/build.mjs   │        │ index.html + script.js       │
│  ├─ calls the FPL API    │ commit │  ├─ fetch('data.json')       │
│  └─ writes data.json  ───┼───────►│  └─ renders table + popups   │
└──────────────────────────┘        └──────────────────────────────┘
```

No server, no database, no API keys. The browser never talks to FPL directly — it only
reads `data.json`, which the Action rebuilds and commits.

| File | What it does |
| --- | --- |
| `scripts/build.mjs` | Fetches league, history, transfers, picks, live points and cup data from the FPL API and writes `data.json`. |
| `.github/workflows/fpl-update.yaml` | Runs the build every 3 hours (and on demand) and commits `data.json` if it changed. |
| `index.html`, `styles.css`, `script.js` | The page. All calculations (sums, ranks, leaders, Hall of Fame) happen in the browser from `data.json`. |
| `mock-lineups.js` | Fake lineups for previewing the UI: open the page with `?mock`. Not used otherwise. |
| `fpl-api.md` | Notes on the (unofficial, undocumented) FPL API and the gotchas we hit. |

## Use it for your own league

1. **Fork** this repo (or copy the files into a new one).
2. **Set your league ID** in `scripts/build.mjs`:
   ```js
   const LEAGUE_ID = 162916;   // the number in your league's URL on fantasy.premierleague.com
   ```
3. **Adjust the league setup** in `script.js`:
   - `PERIODS` — your prize periods (name and GW range).
   - `PERIOD_PRIZES`, `CHAMPION_PRIZES`, `GW_LEADER_PRIZE`, `TOP_SCORER_PRIZE`, `CUP` —
     prize amounts shown in the Hall of Fame.
   - The page title, heading and the rules list live in `index.html`.
4. **Turn on Pages:** *Settings → Pages → Deploy from a branch → `main` / root*.
5. Run the workflow once by hand (*Actions → Update FPL Data → Run workflow*) so
   `data.json` is filled straight away. The workflow asks for permission to commit
   (`permissions: contents: write`), so the repo's default Actions settings are enough.

> **Privacy:** `data.json` and the page show managers' team names and real names as FPL
> returns them, and anyone with the link can see them. The page carries
> `<meta name="robots" content="noindex">` to keep it out of search results, but that is a
> request, not access control. Make sure your league is fine with that before publishing.

## Run it locally

```bash
node scripts/build.mjs          # refresh data.json from the FPL API (Node 18+)
python3 -m http.server 8000     # then open http://localhost:8000
```

Open `http://localhost:8000/?mock` to preview the lineup UI with fake data.

## `data.json` shape

```jsonc
{
  "leagueId": 162916,
  "generatedAt": "2026-10-17T16:16:24.881Z",
  "currentGW": 7,
  "currentGWFinished": false,          // drives the LIVE marker
  "cup": { "started": false, "winner": null },
  "managers": [{
    "teamName": "…", "playerName": "…", "entryId": 123, "total": 492,
    "gwPoints": [68, 93, 67, 110, 56, 67, 31],   // net of transfer hits; sum == total
    "chips": [{ "event": 1, "name": "bboost" }],
    "latestGwTransfers": [{ "in": { "id": 1, "name": "Saka" }, "out": { "id": 2, "name": "Palmer" } }],
    "lineup": {
      "formation": "3-4-3", "points": 31, "benchPoints": 9, "transferCost": 0,
      "picks": [                       // 11 starters (GKP → FWD), then 4 bench in order
        { "name": "Haaland", "team": "MCI", "pos": "FWD", "pts": 13, "mult": 2,
          "c": true, "vc": false, "bench": false, "subIn": false, "subOut": false }
      ]
    }
  }]
}
```

## About the FPL API

The Fantasy Premier League API is what the official site uses. It's public (no login
needed for anything here) but **unofficial and undocumented**: it can change between
seasons without notice. Everything we learned is in [`fpl-api.md`](fpl-api.md): the
endpoints, what each returns, which ones this project uses, and the traps (pre-season
`new_entries`, cloud IPs getting 403s, provisional bonus, cached standings, the cup).

Please be polite to it: the build script waits 300 ms between requests and only runs
every 3 hours.

## Credits

Built for the İşte Promiyer Lig mini-league. Not affiliated with the Premier League or
Fantasy Premier League.
