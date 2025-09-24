// PERIOD CONFIG (skip "Pole Position")
// Each period shows ALL its GWs once the period has started.
// Sum column at the end of each period is a running total (so far).
const PERIODS = [
  { key: 'here_we_go',       name: 'Here We Go!',        start: 1,  end: 3 },
  { key: 'early_wildcard',   name: 'Early Wildcard',     start: 4,  end: 7 },
  { key: 'false_9',          name: 'False 9',            start: 8,  end: 11 },
  { key: 'black_friday',     name: 'Black Friday',       start: 12, end: 13 },
  { key: 'remembering_jota', name: 'Remembering Jota',   start: 14, end: 16 },
  { key: 'afcon_drama',      name: 'AFCON Drama',        start: 17, end: 22 },
  { key: 'valentines',       name: 'Valentines',         start: 23, end: 26 },
  { key: 'ramadan_kareem',   name: 'Ramadan Kareem',     start: 27, end: 31 },
  { key: 'flowers',          name: 'Flowers Everywhere', start: 32, end: 36 },
  { key: 'fergie_time',      name: 'Fergie Time',        start: 37, end: 38 }
];

async function load() {
  // Fetch data.json (no caching so we always see the latest Action run)
  const res = await fetch('data.json', { cache: 'no-store' });
  if (!res.ok) {
    console.error('Failed to load data.json', res.status, res.statusText);
    document.querySelector('.meta').textContent = 'Error loading data';
    document.getElementById('tbody').innerHTML = `<tr><td>Error loading data</td></tr>`;
    return;
  }
  const data = await res.json();

  // Header meta: current GW + last update
  const currentGW = data.currentGW;
  const lastUpdated = new Date(data.generatedAt);
  document.querySelector('.meta').innerHTML =
    `GW ${currentGW} • Last update: <span id="last-update">${lastUpdated.toLocaleString()}</span>`;

  // Build dynamic columns list (keys and labels) in the order to render.
  // We keep a flat 'columns' array for rendering/sorting,
  // and also compute a two-tier header structure for grouping.
  const columns = [
    { key: 'rank', label: 'Rank', kind: 'static' },
    { key: 'teamName', label: 'Team', kind: 'static' },
    { key: 'total', label: 'Total', kind: 'numeric' }
  ];

  // Visible periods: only those that have started.
  const visiblePeriods = PERIODS.filter(p => p.start <= currentGW);

  // For grouping header:
  // topHeader: [{label, colspan, isBoundary}]
  // subHeader: [{key, label, isFuture, boundaryLeft, isSum}]
  const topHeader = [];
  const subHeader = [];

  visiblePeriods.forEach((p, idx) => {
    // Include ALL GWs of the period (even future), but mark future for styling/parentheses.
    const gwKeys = [];
    for (let gw = p.start; gw <= p.end; gw++) {
      const key = `gw_${gw}`;
      columns.push({ key, label: `GW${gw}`, kind: 'numeric' });
      gwKeys.push({ key, gw, isFuture: gw > currentGW });
    }
    // Period sum column key
    const sumKey = `sum_${p.key}`;
    columns.push({ key: sumKey, label: `${idx === 0 ? 'Sum' : 'Sum'}`, kind: 'numeric' });

    // GROUP HEADER rows
    topHeader.push({
      label: p.name,
      colspan: gwKeys.length + 1, // all GWs + Sum
      boundaryLeft: idx > 0 // add a separator before periods after the first
    });

    // subheader cells for this period
    gwKeys.forEach((g, gIdx) => {
      subHeader.push({
        key: g.key,
        label: g.isFuture ? `(GW${g.gw})` : `GW${g.gw}`,
        isFuture: g.isFuture,
        boundaryLeft: gIdx === 0 && idx > 0,
        isSum: false
      });
    });
    subHeader.push({
      key: sumKey,
      label: 'Sum',
      isFuture: false,
      boundaryLeft: false,
      isSum: true
    });
  });

  // Finally, chips and latest columns
  columns.push({ key: 'chips', label: 'Activated Chips', kind: 'static' });
  columns.push({ key: 'latest', label: 'Latest Transfers', kind: 'static' });

  // Render thead (two-tier)
  const thead = document.getElementById('thead');
  thead.innerHTML = [
    // First row: static columns + grouped period headers + trailing static columns
    `<tr>
      <th rowspan="2" data-key="rank">Rank</th>
      <th rowspan="2" data-key="teamName" class="sep-left-after">Team</th>
      <th rowspan="2" data-key="total" class="sep-left">Total</th>
      ${topHeader.map(h => `<th colspan="${h.colspan}" class="${h.boundaryLeft ? 'sep-left' : ''}">${h.label}</th>`).join('')}
      <th rowspan="2" data-key="chips" class="sep-left">Activated Chips</th>
      <th rowspan="2" data-key="latest">Latest Transfers</th>
    </tr>`,
    // Second row: GW labels and Sum cells for each visible period
    `<tr>
      ${subHeader.map(h =>
        `<th data-key="${h.key}" class="${[
          h.boundaryLeft ? 'sep-left' : '',
          h.isSum ? 'sum-col' : '',
          h.isFuture ? 'future' : ''
        ].join(' ').trim()}">${h.label}</th>`
      ).join('')}
    </tr>`
  ].join('');

  // Build rows from payload
  let rows = (data.managers || []).map(m => {
    const row = {
      teamName: m.teamName,
      total: m.total,
      latest: m.latestGwTransfers,
      chips: m.chips || null
    };
    // put raw GWs into row
    (m.gwPoints || []).forEach((p, idx) => { row[`gw_${idx + 1}`] = p; });
    return row;
  });

  // Default sort by Total desc, then compute rank and chips (current GW)
  rows.sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity));
  rows.forEach((r, i) => {
    r.rank = i + 1;
    if (Array.isArray(r.chips)) {
      const chip = r.chips.find(c => Number(c.event) === Number(currentGW));
      r.chips = chip ? chip.name : '';
    }
  });

  // Compute period sums per row (running total up to currentGW)
  rows.forEach(r => {
    visiblePeriods.forEach(p => {
      let sum = 0;
      for (let gw = p.start; gw <= Math.min(p.end, currentGW); gw++) {
        const v = r[`gw_${gw}`];
        sum += Number.isFinite(v) ? v : 0;
      }
      r[`sum_${p.key}`] = sum;
    });
  });

  render(rows, columns, subHeader);

  // Sorting handler: allow sort by any column (GW or Sum or Total/Team)
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th) return;

    const key = th.dataset.key;
    if (!key) return;

    // find descriptor
    const desc = columns.find(c => c.key === key);
    const isNumeric = key === 'total' || key === 'rank' || key.startsWith('gw_') || key.startsWith('sum_');

    // Toggle dir per header
    const dir = th.dataset.dir ? (th.dataset.dir === 'asc' ? 'desc' : 'asc') : 'desc';
    // clear other headers' dir flags
    thead.querySelectorAll('th[data-key]').forEach(h => { if (h !== th) h.removeAttribute('data-dir'); });
    th.setAttribute('data-dir', dir);

    rows.sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (isNumeric) {
        const na = Number.isFinite(va) ? va : -Infinity;
        const nb = Number.isFinite(vb) ? vb : -Infinity;
        return dir === 'asc' ? na - nb : nb - na;
      }
      const sa = (va ?? '').toString();
      const sb = (vb ?? '').toString();
      return dir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });

    // recompute rank after sort
    rows.forEach((r, i) => { r.rank = i + 1; });
    render(rows, columns, subHeader);
  });
}

function render(rows, columns, subHeader) {
  const tbody = document.getElementById('tbody');

  // Map for fast lookup of period boundaries to add separators to TDs
  const boundaryLeftKeys = new Set(subHeader.filter(h => h.boundaryLeft).map(h => h.key));

  tbody.innerHTML = rows.map(r => `
    <tr>
      ${columns.map((c, idx) => {
        if (c.key === 'latest') {
          const txt = (r.latest && r.latest.length)
            ? r.latest.map(t =>
                `<span class="badge in"><strong>in:</strong> ${t.in.name}</span> <span class="badge out"><strong>out:</strong> ${t.out.name}</span>`
              ).join(' ')
            : '<span class="badge">—</span>';
          return `<td class="transfers">${txt}</td>`;
        }
        if (c.key === 'chips') {
          const v = r.chips ?? '';
          const html = v ? `<span class="badge chip">${v}</span>` : '<span class="badge">—</span>';
          // Add a separator to chips since it follows the last period sum
          return `<td class="sep-left">${html}</td>`;
        }
        // Normal cells, with extra border on period boundaries
        const v = r[c.key];
        const boundaryClass = boundaryLeftKeys.has(c.key) ? 'sep-left' : '';
        const isSumCell = c.key && c.key.startsWith('sum_');
        const classList = [boundaryClass, isSumCell ? 'sum-col' : ''].filter(Boolean).join(' ');
        return `<td class="${classList}">${v ?? ''}</td>`;
      }).join('')}
    </tr>
  `).join('');
}

// Kick off
load().catch(err => {
  console.error(err);
  document.querySelector('.meta').textContent = 'Error loading data';
  document.getElementById('tbody').innerHTML = `<tr><td>Error loading data</td></tr>`;
});