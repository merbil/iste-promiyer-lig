// PERIOD CONFIG (skip "Pole Position")
// Each period shows ALL its GWs once the period has started.
// Sum column at the end of each period is a running total (so far).
const PERIODS = [
  { key: 'world_cup_hangover',  name: 'World Cup Hangover', start: 1,  end: 5 },
  { key: 'early_wildcard',      name: 'Early Wildcard',     start: 6,  end: 10 },
  { key: 'black_friday',        name: 'Black Friday 🎁',     start: 11, end: 12 },
  { key: 'get_ready_2027',      name: 'Get Ready for 2027',  start: 13, end: 16 },
  { key: 'boxing_day',          name: 'Boxing Day 🗃️',       start: 17, end: 19 },
  { key: 'rage_wildcard',       name: 'Rage Wildcard',       start: 20, end: 24 },
  { key: 'national_breakup',    name: 'National Break-up',   start: 25, end: 30 },
  { key: 'spring_break_return', name: 'Spring Break Return', start: 31, end: 35 },
  { key: 'fergie_time',         name: 'Fergie Time',         start: 36, end: 38 }
];

// FPL API chip ids -> display names
const CHIP_NAMES = {
  bboost: 'Bench Boost',
  '3xc': 'Triple Captain',
  freehit: 'Free Hit',
  wildcard: 'Wildcard',
  manager: 'Assistant Manager'
};
const chipLabel = (name) => CHIP_NAMES[String(name).toLowerCase()] || String(name);
// Short tags for the pill next to the team name
const CHIP_TAGS = { bboost: 'BB', '3xc': 'TC', freehit: 'FH', wildcard: 'WC', manager: 'AM' };
const chipTag = (name) => CHIP_TAGS[String(name).toLowerCase()] || String(name).slice(0, 2).toUpperCase();

const NUMERIC_KEYS = new Set(['rank', 'total', 'gwLeads']);
const isNumericKey = (key) => NUMERIC_KEYS.has(key) || key.startsWith('gw_') || key.startsWith('sum_');

// Escape text before putting it into innerHTML (team/player names are user-chosen)
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// GW Leads: shared wins split evenly, shown with one decimal (1/3 -> 0.3); whole numbers stay whole
function formatLeads(v) {
  const x = Math.round(v * 10) / 10;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

// Standard competition ranking (1, 2, 2, 4): equal values share a rank
function competitionRanks(rows, getValue) {
  const sorted = [...rows].sort((a, b) => getValue(b) - getValue(a));
  const ranks = new Map();
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    ranks.set(r, prev && getValue(prev) === getValue(r) ? ranks.get(prev) : i + 1);
  });
  return ranks;
}

function formatUpdated(gen) {
  const lastUpdated = new Date(gen);
  try {
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';

    // Date as DD/MM/YYYY
    const dateStr = lastUpdated.toLocaleDateString('en-GB', {
      timeZone: tz,
      day: '2-digit', month: '2-digit', year: 'numeric'
    });

    // Time as HH:MM (24h)
    const timeStr = lastUpdated.toLocaleTimeString('en-GB', {
      timeZone: tz,
      hour: '2-digit', minute: '2-digit', hour12: false
    });

    // Short timezone name (CEST/CET). If not available, fall back to IANA tz.
    let shortTz = '';
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(lastUpdated);
      shortTz = parts.find(p => p.type === 'timeZoneName')?.value || '';
    } catch {}

    return `${dateStr} ${timeStr} ${shortTz || tz}`;
  } catch (e) {
    console.warn('Falling back date formatting:', e);
    return lastUpdated.toLocaleString();
  }
}

async function load() {
  // Fetch data.json (no caching so we always see the latest Action run)
  const res = await fetch('data.json', { cache: 'no-store' });
  if (!res.ok) {
    console.error('Failed to load data.json', res.status, res.statusText);
    showError();
    return;
  }
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse data.json. First 200 chars:', raw.slice(0, 200));
    throw err;
  }

  // Header meta: current GW + last update + legend
  const currentGW = data.currentGW;
  // Only flag LIVE when the build explicitly says the GW isn't finished (older data has no flag)
  const isLive = data.currentGWFinished === false;
  const gen = (typeof data.generatedAt === 'number' || typeof data.generatedAt === 'string')
    ? data.generatedAt
    : Date.now();
  document.getElementById('meta').innerHTML =
    `GW ${esc(currentGW)}${isLive ? ' <span class="live">LIVE</span>' : ''}` +
    `<span class="dot">•</span>Updated ${esc(formatUpdated(gen))}` +
    `<span class="dot">•</span>` +
    `<span class="legend"><span class="swatch period"></span> Period leader</span>` +
    `<span class="dot">•</span>` +
    `<span class="legend"><span class="swatch gw"></span> GW leader</span>`;

  // Build dynamic columns list (keys and labels) in the order to render.
  // We keep a flat 'columns' array for rendering/sorting,
  // and also compute a two-tier header structure for grouping.
  const columns = [
    { key: 'rank', label: 'Rank' },
    { key: 'teamName', label: 'Team' },
    { key: 'total', label: 'Total' },
    { key: 'gwLeads', label: 'GW Leads' }
  ];

  // Visible periods: only those that have started.
  const visiblePeriods = PERIODS.filter(p => p.start <= currentGW);

  // For grouping header:
  // topHeader: [{label, colspan, boundaryLeft}]
  // subHeader: [{key, label, isFuture, isLive, boundaryLeft, isSum}]
  const topHeader = [];
  const subHeader = [];

  visiblePeriods.forEach((p, idx) => {
    // Include ALL GWs of the period (even future), but mark future for styling/parentheses.
    const gwKeys = [];
    for (let gw = p.start; gw <= p.end; gw++) {
      const key = `gw_${gw}`;
      columns.push({ key, label: `GW${gw}` });
      gwKeys.push({ key, gw, isFuture: gw > currentGW });
    }
    // Period sum column key
    const sumKey = `sum_${p.key}`;
    columns.push({ key: sumKey, label: 'Sum' });

    topHeader.push({
      label: p.name,
      colspan: gwKeys.length + 1, // all GWs + Sum
      boundaryLeft: idx > 0 // add a separator before periods after the first
    });

    gwKeys.forEach((g, gIdx) => {
      subHeader.push({
        key: g.key,
        label: g.isFuture ? `(GW${g.gw})` : `GW${g.gw}`,
        isFuture: g.isFuture,
        isLive: isLive && g.gw === currentGW,
        boundaryLeft: gIdx === 0 && idx > 0,
        isSum: false
      });
    });
    subHeader.push({ key: sumKey, label: 'Sum', isFuture: false, boundaryLeft: false, isSum: true });
  });

  // Finally, lineup summary and latest transfers
  columns.push({ key: 'lineup', label: 'Kadro' });
  columns.push({ key: 'latest', label: 'Latest Transfers' });

  // Render thead (two-tier)
  const thead = document.getElementById('thead');
  thead.innerHTML = [
    `<tr>
      <th rowspan="2" data-key="rank">Rank</th>
      <th rowspan="2" data-key="teamName">Team</th>
      <th rowspan="2" data-key="total" class="sep-left">Total</th>
      <th rowspan="2" data-key="gwLeads">GW Leads</th>
      ${topHeader.map(h => `<th colspan="${h.colspan}" class="${h.boundaryLeft ? 'sep-left' : ''}">${esc(h.label)}</th>`).join('')}
      <th rowspan="2" data-key="lineup" class="sep-left">Kadro</th>
      <th rowspan="2" data-key="latest">Latest Transfers</th>
    </tr>`,
    `<tr>
      ${subHeader.map(h =>
        `<th data-key="${h.key}" class="${[
          h.boundaryLeft ? 'sep-left' : '',
          h.isSum ? 'sum-col' : '',
          h.isFuture ? 'future' : ''
        ].join(' ').trim()}">${h.label}${h.isLive ? ' <span class="live">LIVE</span>' : ''}</th>`
      ).join('')}
    </tr>`
  ].join('');

  // Build rows from payload
  const managers = Array.isArray(data.managers) ? data.managers : [];
  const rows = managers.map(m => {
    const allChips = Array.isArray(m.chips) ? m.chips : [];
    const chipNow = allChips.find(c => Number(c.event) === Number(currentGW));
    const row = {
      teamName: m.teamName,
      playerName: m.playerName,
      entryId: m.entryId,
      total: m.total,
      latest: m.latestGwTransfers,
      lineup: m.lineup || null,
      // Display text for this GW's chip; lowercase id kept for logic
      chips: chipNow ? chipLabel(chipNow.name) : '',
      _chipTag: chipNow ? chipTag(chipNow.name) : '',
      _chipThisGW: chipNow ? String(chipNow.name).toLowerCase() : '',
      _chipHistory: [...allChips]
        .sort((a, b) => a.event - b.event)
        .map(c => `${chipLabel(c.name)} (GW${c.event})`)
        .join(', ')
    };
    // put raw GWs into row
    (m.gwPoints || []).forEach((p, idx) => { row[`gw_${idx + 1}`] = p; });
    return row;
  });

  // Preview mode: index.html?mock fills in made-up lineups until the build fetches real picks
  if (new URLSearchParams(location.search).has('mock')) {
    const { mockLineup } = await import('./mock-lineups.js');
    rows.forEach(r => { r.lineup = r.lineup || mockLineup(r); });
  }
  lineupRows = new Map(rows.map(r => [String(r.entryId), r]));
  lineupGW = currentGW;

  // Standing rank by Total, and last GW's rank (Total minus this GW) for movement arrows.
  // The rank stays fixed no matter which column the table is sorted by.
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const ranks = competitionRanks(rows, r => num(r.total));
  const prevRanks = currentGW > 1
    ? competitionRanks(rows, r => num(r.total) - num(r[`gw_${currentGW}`]))
    : null;
  rows.forEach(r => {
    r.rank = ranks.get(r);
    r._move = prevRanks ? prevRanks.get(r) - r.rank : 0;
  });

  // Compute period sums per row (running total up to currentGW)
  rows.forEach(r => {
    visiblePeriods.forEach(p => {
      let sum = 0;
      for (let gw = p.start; gw <= Math.min(p.end, currentGW); gw++) sum += num(r[`gw_${gw}`]);
      r[`sum_${p.key}`] = sum;
    });
  });

  // Compute GW Leads: for each GW up to currentGW, distribute 1 point among top scorers
  rows.forEach(r => { r.gwLeads = 0; });
  for (let gw = 1; gw <= currentGW; gw++) {
    const scores = rows.map(r => r[`gw_${gw}`]).filter(v => Number.isFinite(v));
    if (!scores.length) continue;
    const max = Math.max(...scores);
    const leaders = rows.filter(r => r[`gw_${gw}`] === max);
    leaders.forEach(r => { r.gwLeads += 1 / leaders.length; });
  }

  // Leader flags
  // Latest GW leader(s)
  const gwKey = `gw_${currentGW}`;
  const gwScores = rows.map(r => r[gwKey]).filter(v => Number.isFinite(v));
  const maxGw = gwScores.length ? Math.max(...gwScores) : null;
  rows.forEach(r => { r._isGwLeader = maxGw !== null && r[gwKey] === maxGw; });

  // Current period leader(s) — only the period that contains currentGW
  const currentPeriod = visiblePeriods.find(p => currentGW >= p.start && currentGW <= p.end);
  const periodKey = currentPeriod ? `sum_${currentPeriod.key}` : null;
  const maxPeriod = periodKey ? Math.max(...rows.map(r => r[periodKey])) : null;
  rows.forEach(r => { r._isPeriodLeader = periodKey !== null && rows.length > 0 && r[periodKey] === maxPeriod; });

  renderHallOfFame(rows, currentGW, data.currentGWFinished === true, data.cup);

  console.debug('Loaded rows:', rows.length, 'currentGW:', currentGW);

  // Default order: standing rank, ties by team name
  rows.sort((a, b) => a.rank - b.rank || String(a.teamName).localeCompare(String(b.teamName), 'tr'));
  render(rows, columns, subHeader, currentGW);

  // Sorting handler: allow sort by any column with a data-key
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    const key = th?.dataset.key;
    if (!key) return;

    const isNumeric = isNumericKey(key);
    // First click: rank/team ascending, everything else descending; then toggle
    const firstDir = (key === 'rank' || key === 'teamName') ? 'asc' : 'desc';
    const dir = th.dataset.dir ? (th.dataset.dir === 'asc' ? 'desc' : 'asc') : firstDir;
    thead.querySelectorAll('th[data-key]').forEach(h => { if (h !== th) h.removeAttribute('data-dir'); });
    th.setAttribute('data-dir', dir);

    const sortValue = (r) => (
      key === 'latest' ? (r.latest || []).length
      : key === 'lineup' ? captainPoints(r.lineup)
      : r[key]
    );
    rows.sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      let cmp;
      if (isNumeric || key === 'latest' || key === 'lineup') {
        const na = Number.isFinite(va) ? va : -Infinity;
        const nb = Number.isFinite(vb) ? vb : -Infinity;
        cmp = na - nb;
      } else {
        cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'tr');
      }
      // Stable tie-break by standing rank
      return (dir === 'asc' ? cmp : -cmp) || a.rank - b.rank;
    });

    render(rows, columns, subHeader, currentGW);
  });
}

function render(rows, columns, subHeader, currentGW) {
  const tbody = document.getElementById('tbody');

  // Map for fast lookup of period boundaries to add separators to TDs
  const boundaryLeftKeys = new Set(subHeader.filter(h => h.boundaryLeft).map(h => h.key));
  const emptyBadge = '<span class="badge empty">—</span>';

  tbody.innerHTML = rows.map(r => `
    <tr>
      ${columns.map(c => {
        if (c.key === 'rank') {
          const move = r._move > 0
            ? `<span class="move up" title="Up ${r._move} since last GW">▲${r._move}</span>`
            : r._move < 0
              ? `<span class="move down" title="Down ${-r._move} since last GW">▼${-r._move}</span>`
              : '<span class="move"></span>';
          return `<td class="rank">${r.rank}${move}</td>`;
        }
        if (c.key === 'latest') {
          const chip = r._chipThisGW;
          const suppress = chip === 'wildcard' || chip === 'freehit';
          if (suppress || !r.latest || !r.latest.length) return `<td class="transfers">${emptyBadge}</td>`;
          // One compact pill per transfer (in over out), side by side
          const pill = (t) => `<span class="tr" title="${esc(t.in.name)} ← ${esc(t.out.name)}">` +
            `<span class="tr-in">${esc(t.in.name)}</span><span class="tr-out">${esc(t.out.name)}</span></span>`;
          return `<td class="transfers"><span class="tr-list">${r.latest.map(pill).join('')}</span></td>`;
        }
        if (c.key === 'lineup') {
          // Separator since it follows the last period sum
          return `<td class="lineup sep-left">${lineupSummary(r)}</td>`;
        }

        // Normal cells, with extra border on period boundaries
        const isSumCell = c.key.startsWith('sum_');
        const classList = [boundaryLeftKeys.has(c.key) ? 'sep-left' : '', isSumCell ? 'sum-col' : '']
          .filter(Boolean).join(' ');

        if (c.key === 'gwLeads') {
          const raw = r.gwLeads ?? 0;
          if (!raw) return `<td class="${classList}"></td>`;
          return `<td class="${classList}">${formatLeads(raw)}</td>`;
        }

        if (c.key === 'teamName') {
          const leaderClasses = [
            r._isGwLeader ? 'leader-gw' : '',
            r._isPeriodLeader ? 'leader-period' : ''
          ].filter(Boolean).join(' ');
          const allClasses = [classList, leaderClasses].filter(Boolean).join(' ');
          const name = esc(r.teamName);
          // Team name opens this GW's lineup (when we have one)
          const link = r.lineup?.picks?.length
            ? `<button type="button" class="team-name" data-lineup="${esc(r.entryId)}" title="${name} · kadroyu göster">${name}</button>`
            : `<span class="team-name is-plain">${name}</span>`;
          // Chip played this GW as a small tag (hover: full name + every chip used so far)
          const chipTitle = [r.chips ? `${r.chips} (bu GW)` : '', r._chipHistory ? `Kullanılan: ${r._chipHistory}` : '']
            .filter(Boolean).join(' · ');
          const chip = r._chipTag
            ? `<span class="chip-tag chip-${esc(r._chipTag.toLowerCase())}" title="${esc(chipTitle)}">${esc(r._chipTag)}</span>`
            : '';
          const manager = r.playerName ? `<span class="manager">${esc(r.playerName)}</span>` : '';
          return `<td class="${allClasses}"><span class="team-line">${link}${chip}</span>${manager}</td>`;
        }

        return `<td class="${classList}">${esc(r[c.key])}</td>`;
      }).join('')}
    </tr>
  `).join('');

  measureHeader();
}

// Second header row sticks right under the first; measure its real height
function measureHeader() {
  const firstRow = document.querySelector('#thead tr');
  if (firstRow) {
    document.documentElement.style.setProperty('--hdr1', `${firstRow.getBoundingClientRect().height}px`);
  }
}
window.addEventListener('resize', measureHeader);

// ===== Kadro (starting XI + bench) =====

let lineupRows = new Map();
let lineupGW = null;
const POS_ORDER = ['GKP', 'DEF', 'MID', 'FWD'];

function captainPoints(lineup) {
  const cap = lineup?.picks?.find(p => p.c);
  return cap ? cap.pts * cap.mult : null;
}

// Compact cell: captain with points · bench points (+ auto-sub count); opens the lineup popup
function lineupSummary(r) {
  const l = r.lineup;
  if (!l || !Array.isArray(l.picks) || !l.picks.length) return '<span class="badge empty">—</span>';
  const cap = l.picks.find(p => p.c);
  const subs = l.picks.filter(p => p.subIn).length;
  const bench = r._chipThisGW === 'bboost' ? 'BB' : (Number(l.benchPoints) || 0);
  return `<button type="button" class="lineup-btn" data-lineup="${esc(r.entryId)}" title="Kadroyu göster">
    ${cap ? `<span class="cap"><span class="pc-badge">C</span>${esc(cap.name)} <b>${cap.pts * cap.mult}</b></span>` : ''}
    <span class="bench-pts" title="Yedek kulübesinde kalan puan">🪑 ${bench}</span>
    ${subs ? `<span class="subs" title="Otomatik değişiklik">⇅${subs}</span>` : ''}
  </button>`;
}

function playerCard(p) {
  const shown = p.mult > 1 ? p.pts * p.mult : p.pts;
  const badge = p.c ? '<span class="pc-badge c">C</span>' : p.vc ? '<span class="pc-badge v">V</span>' : '';
  const sub = p.subIn ? '<span class="pc-sub in" title="Oyuna girdi">▲</span>'
    : p.subOut ? '<span class="pc-sub out" title="Oynamadı, çıktı">▼</span>' : '';
  const cls = ['pc', `pos-${p.pos}`, p.subOut ? 'is-out' : '', p.subIn ? 'is-in' : ''].filter(Boolean).join(' ');
  // Shirt in club colours (see .kit-XXX in styles.css)
  const kit = /^[A-Z]{3}$/.test(p.team || '') ? ` kit-${p.team}` : '';
  const multTitle = p.mult > 1 ? ` title="${p.pts} × ${p.mult}"` : '';
  return `<div class="${cls}">
    <div class="pc-shirt${kit}">${esc(p.team || '')}${badge}${sub}</div>
    <div class="pc-name">${esc(p.name)}</div>
    <div class="pc-pts"${multTitle}>${shown}</div>
  </div>`;
}

function openLineup(entryId) {
  const r = lineupRows.get(String(entryId));
  const l = r?.lineup;
  const dlg = document.getElementById('lineup-modal');
  if (!l || !dlg) return;

  const starters = l.picks.filter(p => !p.bench);
  const bench = l.picks.filter(p => p.bench);
  const lines = POS_ORDER.map(pos => starters.filter(p => p.pos === pos));
  const bboost = r._chipThisGW === 'bboost';
  const cap = l.picks.find(p => p.c);
  // Same number as the table (net of hits); falls back to the lineup's own sum
  const cost = Number(l.transferCost) || 0;
  const gwNet = Number.isFinite(r[`gw_${lineupGW}`]) ? r[`gw_${lineupGW}`] : (Number(l.points) || 0) - cost;
  const mock = new URLSearchParams(location.search).has('mock');

  document.getElementById('lineup-title').textContent = `${r.teamName} · GW${lineupGW}`;
  document.getElementById('lineup-body').innerHTML = `
    ${mock ? '<p class="mock-note">Örnek veri — gerçek kadrolar henüz çekilmiyor.</p>' : ''}
    <div class="lineup-stats">
      <span class="stat big"><b>${gwNet}</b> puan${cost ? ` <small class="hit">−${cost}</small>` : ''}</span>
      ${cap ? `<span class="stat"><span class="pc-badge c">C</span> ${esc(cap.name)} <b>${cap.pts * cap.mult}</b></span>` : ''}
      <span class="stat" title="Yedek kulübesinde kalan puan">🪑 <b>${bboost ? 'BB' : Number(l.benchPoints) || 0}</b></span>
      ${r._chipTag ? `<span class="chip-tag chip-${esc(r._chipTag.toLowerCase())}" title="${esc(r.chips)}">${esc(r._chipTag)}</span>` : ''}
    </div>
    <div class="pitch">
      ${lines.map(line => `<div class="pitch-row">${line.map(playerCard).join('')}</div>`).join('')}
    </div>
    <div class="bench${bboost ? ' is-boosted' : ''}">
      <div class="bench-label">Yedekler${bboost ? ' · Bench Boost' : ''}</div>
      <div class="pitch-row">${bench.map(playerCard).join('')}</div>
    </div>
    <p class="lineup-legend"><span class="pc-badge c">C</span> Kaptan <span class="pc-badge v">V</span> Yardımcı
      <span class="pc-sub in">▲</span> Oyuna girdi <span class="pc-sub out">▼</span> Oynamadı</p>`;
  dlg.showModal();
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-lineup]');
  if (btn) openLineup(btn.dataset.lineup);
});

// ===== Hall of Fame (prizes in EUR, winners computed live from net GW points) =====

const PERIOD_PRIZES = {
  world_cup_hangover: 70, early_wildcard: 70, black_friday: 50, get_ready_2027: 60,
  boxing_day: 55, rage_wildcard: 70, national_breakup: 80, spring_break_return: 70, fergie_time: 55
};
const SPECIAL_PERIODS = new Set(['black_friday', 'boxing_day']);

// Pole Position (GW1) is a prize period even though it has no columns in the table
const PRIZE_PERIODS = [
  { key: 'pole_position', name: 'Pole Position 🏎️', start: 1, end: 1, prize: 20, tone: 'pole' },
  ...PERIODS.map(p => ({ ...p, prize: PERIOD_PRIZES[p.key], tone: SPECIAL_PERIODS.has(p.key) ? 'special' : 'period' }))
];

// FPL league cup: knockout, GW34–38. Winner comes from data.cup (filled by the build once the final is played)
const CUP = { name: 'Kupa 🏆', start: 34, end: 38, prize: 60 };

const CHAMPION_PRIZES = [205, 140, 105, 75, 60];
const CHAMPION_ICONS = ['🥇', '🥈', '🥉', '4.', '5.'];
const GW_LEADER_PRIZE = 55;
const TOP_SCORER_PRIZE = 20;

function renderHallOfFame(rows, currentGW, currentGWFinished, cup) {
  const el = document.getElementById('hof-body');
  if (!el) return;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const names = (list) => list.map(r => esc(r.teamName)).join(', ');
  const isDone = (end) => currentGW > end || (currentGW === end && currentGWFinished);
  const seasonDone = isDone(38);
  const devam = '<span class="pill">devam</span>';
  const dash = '<span class="muted">—</span>';
  const cupWinner = cup?.winner ? esc(cup.winner) : '';
  const cupLive = Boolean(cup?.started) && !cupWinner;
  const gwRange = (start, end) => start === end ? `GW ${start}` : `GW ${start}–${end} · ${end - start + 1} hafta`;

  // One row: name (+ sub line) · winner · points · prize. Stacks into two lines on phones.
  const row = ({ tone, state = '', icon = '', name, sub = '', winner, pts = '', prize, single = false }) => `
    <li class="hof-row tone-${tone}${state ? ' is-' + state : ''}${single ? ' is-single' : ''}">
      <div class="hof-name">${icon ? `<span class="hof-icon">${icon}</span>` : ''}<span>${name}${sub ? `<small>${sub}</small>` : ''}</span></div>
      <div class="hof-winner">${winner}</div>
      <div class="hof-pts">${pts}</div>
      <div class="hof-prize"><span class="prize-chip">€${prize}</span></div>
    </li>`;

  // Winner(s) of a GW range: highest net points; ties share
  const rangeWinners = (start, end) => {
    const sums = rows.map(r => {
      let s = 0;
      for (let gw = start; gw <= Math.min(end, currentGW); gw++) s += num(r[`gw_${gw}`]);
      return [r, s];
    });
    const max = Math.max(...sums.map(([, s]) => s));
    return { teams: sums.filter(([, s]) => s === max).map(([r]) => r), points: max };
  };

  const periodRows = PRIZE_PERIODS.map(p => {
    const started = currentGW >= p.start;
    const state = isDone(p.end) ? 'done' : started ? 'live' : 'future';
    const w = started && rows.length ? rangeWinners(p.start, p.end) : null;
    return row({
      tone: p.tone, state, name: esc(p.name), sub: gwRange(p.start, p.end),
      winner: (w ? names(w.teams) : dash) + (state === 'live' ? ' ' + devam : ''),
      pts: w ? w.points : '', prize: p.prize
    });
  }).join('');

  const cupRow = row({
    tone: 'cup', state: cupWinner ? 'done' : cupLive ? 'live' : 'future',
    name: esc(CUP.name), sub: gwRange(CUP.start, CUP.end),
    winner: (cupWinner || dash) + (cupLive ? ' ' + devam : ''), pts: '', prize: CUP.prize
  });

  // Champions: overall standing by total (rank already computed, ties share a position)
  const championRows = CHAMPION_PRIZES.map((prize, i) => {
    const at = rows.filter(r => r.rank === i + 1);
    // Single line: medal · team name(s) · points · prize
    return row({
      tone: 'champ', icon: CHAMPION_ICONS[i], single: true,
      name: at.length ? names(at) : '<span class="muted">↑ eşitlik, ödül paylaşılır</span>',
      winner: '', pts: at.length ? at[0].total : '', prize
    });
  }).join('');

  // GW Lideri: most GW wins (shared wins split)
  const maxLeads = Math.max(0, ...rows.map(r => r.gwLeads));
  const leadTeams = maxLeads > 0 ? rows.filter(r => Math.abs(r.gwLeads - maxLeads) < 1e-9) : [];

  // Top Scorer: highest single-GW net score this season
  let best = null;
  rows.forEach(r => {
    for (let gw = 1; gw <= currentGW; gw++) {
      const v = r[`gw_${gw}`];
      if (!Number.isFinite(v)) continue;
      if (!best || v > best.points) best = { points: v, hits: [{ r, gw }] };
      else if (v === best.points) best.hits.push({ r, gw });
    }
  });

  const awardRows = [
    row({ tone: 'award', icon: '🎖️', name: 'GW Lideri', sub: 'en çok GW birinciliği',
      winner: leadTeams.length ? names(leadTeams) : dash,
      pts: leadTeams.length ? formatLeads(maxLeads) : '', prize: GW_LEADER_PRIZE }),
    row({ tone: 'award', icon: '🔝', name: 'Top Scorer', sub: 'tek GW en yüksek puan',
      winner: best ? best.hits.map(h => `${esc(h.r.teamName)} <span class="muted">GW${h.gw}</span>`).join(', ') : dash,
      pts: best ? best.points : '', prize: TOP_SCORER_PRIZE }),
    row({ tone: 'cup', icon: '🏆', name: 'Kupa', sub: 'FPL lig kupası',
      winner: (cupWinner || dash) + (cupLive ? ' ' + devam : ''), pts: '', prize: CUP.prize })
  ].join('');

  el.innerHTML = `
    <p class="hof-note">Kazananlar net GW puanından canlı hesaplanır. ${devam} henüz bitmedi, anlık lider gösterilir.</p>
    <section class="hof-card">
      <h3 class="hof-title">⭐ Dönemler</h3>
      <ul class="hof-list">${periodRows}${cupRow}</ul>
    </section>
    <section class="hof-card">
      <h3 class="hof-title">🏆 The Champions${seasonDone ? '' : ' ' + devam}</h3>
      <ul class="hof-list">${championRows}</ul>
      <ul class="hof-list awards">${awardRows}</ul>
    </section>`;
}

// Theme switch: follows the system until the viewer picks one; choice is remembered per browser
function currentTheme() {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function syncThemeButton() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const dark = currentTheme() === 'dark';
  btn.textContent = dark ? '☀️' : '🌙';
  btn.setAttribute('aria-label', dark ? 'Açık moda geç' : 'Koyu moda geç');
  btn.title = btn.getAttribute('aria-label');
}
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  syncThemeButton();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeButton);
syncThemeButton();

// Modals: any [data-open="id"] opens <dialog id="id">; click outside or ✕ closes
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open]');
  if (opener) {
    e.preventDefault();
    document.getElementById(opener.dataset.open)?.showModal();
    return;
  }
  if (e.target.closest('[data-close]')) {
    e.target.closest('dialog')?.close();
    return;
  }
  if (e.target instanceof HTMLDialogElement) e.target.close(); // backdrop click
});

function showError() {
  document.getElementById('meta').textContent = 'Error loading data';
  document.getElementById('tbody').innerHTML = '<tr><td>Error loading data</td></tr>';
}

// Kick off
load().catch(err => {
  console.error(err);
  showError();
});
