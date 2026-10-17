# Fantasy Premier League (FPL) API Documentation

The Fantasy Premier League (FPL) API provides JSON endpoints to retrieve data about
players, teams, fixtures, managers, and leagues. All endpoints return structured JSON
data and can be accessed directly via HTTPS.

> **Note:** This is the *official game's* API, but it is **not officially documented
> or supported** by the Premier League. It can change without warning.
>
> This file is just a reference gathered on various subreddits and external links,
> kept here so we don't have to hunt for it again.

**Base URL:**

```
https://fantasy.premierleague.com/api/
```

---

## General Information

### Bootstrap Static

Returns global FPL data including players, teams, fixtures, and settings.

**Endpoint:**

```
/bootstrap-static/
```

Includes:

- All 38 gameweeks summary
- Game settings
- Basic info for all PL teams
- Total FPL users and chip usage
- Player data
- Stats definitions
- Positions

### Fixtures

Retrieve data on all past and upcoming fixtures.

**Endpoint:**

```
/fixtures/
```

Includes per match:

- Goals, assists, cards
- Saves, penalties missed/saved
- Bonus points
- Own goals

---

## Players

### Player Summary

Detailed info for an individual player. Requires `player-id` from `/bootstrap-static/`.

**Endpoint:**

```
/element-summary/{player-id}/
```

Includes:

- Upcoming fixtures (kickoff time, GW, home/away, difficulty)
- Past performance (minutes, goals, assists, cards, bonus, xG, xA, value)
- Transfer deltas

### Gameweek Live Data

Performance data for all players in a given gameweek.

**Endpoint:**

```
/event/{GW}/live/
```

---

## Managers

### Manager Info

General data about a specific manager (use `team-id`).

**Endpoint:**

```
/entry/{team-id}/
```

Includes:

- Manager & team name
- Favorite PL team
- GW started
- Overall rank, points, transfers
- League info

### Transfers

History of transfers by a manager.

**Endpoint:**

```
/entry/{team-id}/transfers/
```

### Picks

The squad selection for a given gameweek.

**Endpoint:**

```
/entry/{team-id}/event/{GW}/picks/
```

Includes:

- GW stats (points, rank, team value, transfers)
- Player details (IDs, captain/vice, position)

### Manager History

Career and GW-by-GW history.

**Endpoint:**

```
/entry/{team-id}/history/
```

Includes:

- GW data: points, rank, transfers, chips
- Past season history: overall points & rank

---

## Leagues

### Classic League Standings

Manager rankings in a classic league.

**Endpoint:**

```
/leagues-classic/{league-id}/standings/
```

Supports pagination with:

```
?page_standings={number}
```

### Head-to-Head League Matches

Head-to-head league standings and results.

**Endpoint:**

```
/leagues-h2h-matches/league/{league-id}/
```

Includes:

- League details (ID, name, type, scoring, created date)
- Standings (rank, points, results per player)

---

## Code Examples

### JavaScript

```javascript
fetch("https://fantasy.premierleague.com/api/bootstrap-static/")
  .then(res => res.json())
  .then(result => {
    let currentWeek = 1;
    result.events.forEach(e => {
      if (e.finished) currentWeek = e.id;
    });
    console.log("Current GW:", currentWeek);
  });
```

### Python

```python
import requests, json
from pprint import pprint

url = 'https://fantasy.premierleague.com/api/bootstrap-static/'
r = requests.get(url).json()
pprint(r, indent=2, depth=1, compact=True)
```

### PHP / Curl

```php
$fplUrl = 'https://fantasy.premierleague.com/api/leagues-classic/' . $league_id . '/standings/';

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $fplUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
$league_data = json_decode($response, true);
curl_close($ch);
```

---

## Notes for this project

How `scripts/build.mjs` uses the endpoints above to build `data.json`:

| Endpoint | Why we call it |
| --- | --- |
| `/bootstrap-static/` | Find the current gameweek (`is_current`), whether it's `finished`, and map player IDs → names, club short names and positions. |
| `/leagues-classic/{LEAGUE_ID}/standings/` | Every manager in the mini-league (paginated) and `league.cup_league` for the cup. |
| `/entry/{team-id}/history/` | Per-manager GW points, transfer hit cost and chip usage. |
| `/entry/{team-id}/transfers/` | Per-manager transfers, filtered to the current GW. |
| `/entry/{team-id}/event/{GW}/picks/` | The lineup: 15 picks with position, multiplier, captain/vice and `automatic_subs`. |
| `/event/{GW}/live/` | Live points for every player this GW (one call, shared by all lineups). |
| `/fixtures/?event={GW}` | Per-match BPS, to add *provisional* bonus before FPL confirms it. |
| `/leagues-h2h-matches/league/{cup_league}/?event=38` | The league cup final, to find the cup winner. |

The league ID lives in `scripts/build.mjs` as `const LEAGUE_ID = ...`. The GitHub
Action in `.github/workflows/fpl-update.yaml` runs the script every 3 hours (and on
demand via **Run workflow**) and commits the refreshed `data.json`.

### Two gotchas worth remembering

**1. Pre-season, members live in `new_entries`, not `standings.results`.**
A classic league's `/standings/` response has two buckets: `standings.results` holds
managers who already have a rank (only after a gameweek is scored), while `new_entries`
holds managers who have joined but aren't ranked yet. Before the season starts,
*everyone* is in `new_entries`, so `standings.results` comes back empty even though the
league is full. Our script currently reads only `standings.results`.

**2. Datacenter / cloud IPs get blocked (HTTP 403).**
The API sits behind Cloudflare, which blocks requests from many cloud servers. A `403`
from such an environment does **not** mean the API is down — it means that particular IP
is blocked. GitHub Actions runners and normal home internet connections generally work
fine. To sanity-check the API is alive, open an endpoint directly in a browser, e.g.
`https://fantasy.premierleague.com/api/bootstrap-static/`.

**3. Live player points can lag behind the league table.**
`/event/{GW}/live/` `total_points` only includes bonus once FPL confirms it (about an hour
after a match), while classic league totals already count provisional bonus. The build adds
provisional bonus itself from each started fixture's `bps` stat: top 3 get 3/2/1, ties share
(1,1,3 → 3,3,1; 1,2,2 → 3,2,2; 1,2,3,3 → 3,2,1,1). Skip a fixture once its `bonus` stat is filled.

**4. Standings responses are cached and can briefly disagree.**
Mid-gameweek, `/standings/` is served from a cache, and two requests a minute apart can
return different totals (we saw one manager at 500, then 492). The next scheduled run
fixes it; don't treat one odd number as a bug.

**5. Picks only exist from the GW deadline onward.**
`/entry/{id}/event/{GW}/picks/` returns 404 for a gameweek whose deadline hasn't passed, and
`multiplier` / `automatic_subs` only reflect auto-subs after FPL processes them. Points in
`entry_history` lag, so use live points × `multiplier` instead.

**6. The league cup doesn't exist until late in the season.**
`league.cup_league` is `null` (even with `has_cup: true`) until FPL creates the cup, around
GW34. After that it's an H2H league; the final is in GW38 and each match has a `winner`
(entry ID).

