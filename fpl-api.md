# Fantasy Premier League (FPL) API Documentation

The Fantasy Premier League (FPL) API provides JSON endpoints to retrieve data about
players, teams, fixtures, managers, and leagues. All endpoints return structured JSON
data and can be accessed directly via HTTPS.

> **Note:** This is the *official game's* API, but it is **not officially documented
> or supported** by the Premier League. It can change without warning. This file is a
> community-maintained reference kept here so we don't have to hunt for it again.

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
| `/bootstrap-static/` | Find the current gameweek (`is_current`) and map player IDs → names for readable transfers. |
| `/leagues-classic/{LEAGUE_ID}/standings/` | Get every manager in our mini-league (paginated). |
| `/entry/{team-id}/history/` | Per-manager gameweek points and chip usage. |
| `/entry/{team-id}/transfers/` | Per-manager transfers, filtered to the current GW. |
| `/entry/{team-id}/event/{GW}/picks/` | Confirm the *net* current-GW points (points minus any −4 transfer hits). |

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
