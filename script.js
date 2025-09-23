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

  // Header meta: current GW + last update (with a span so we can style it later if we want)
  const currentGW = data.currentGW;
  const lastUpdated = new Date(data.generatedAt);
  document.querySelector('.meta').innerHTML =
    `GW ${currentGW} • Last update: <span id="last-update">${lastUpdated.toLocaleString()}</span>`;

  const thead = document.getElementById('thead');

  // Columns: Rank | Team | Total | GW1..GW(current) | Activated Chips | Latest Transfers
  const columns = [
    { key: 'rank', label: 'Rank' },
    { key: 'teamName', label: 'Team' },
    { key: 'total', label: 'Total' },
    ...Array.from({ length: currentGW }, (_, i) => ({ key: `gw_${i + 1}`, label: `GW${i + 1}` })),
    { key: 'chips', label: 'Activated Chips' },
    { key: 'latest', label: 'Latest Transfers' }
  ];

  // Render header
  thead.innerHTML = `<tr>${columns.map(c => `<th data-key="${c.key}">${c.label}</th>`).join('')}</tr>`;

  // Build rows from payload
  let rows = (data.managers || []).map(m => {
    const row = {
      teamName: m.teamName,
      total: m.total,
      latest: m.latestGwTransfers,
      chips: m.chips || null
    };
    (m.gwPoints || []).forEach((p, idx) => { row[`gw_${idx + 1}`] = p; });
    return row;
  });

  // Default sort by Total desc
  rows.sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity));
  // compute rank and chips (if present in data)
  rows.forEach((r, i) => {
    r.rank = i + 1;
    if (Array.isArray(r.chips)) {
      const chip = r.chips.find(c => Number(c.event) === Number(currentGW));
      r.chips = chip ? chip.name : '';
    }
  });
  render(rows, columns);

  // Click-to-sort by any column
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th) return;

    const key = th.dataset.key;
    const isNumeric = key === 'total' || key.startsWith('gw_');
    const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';

    // Toggle sort direction indicator
    [...thead.querySelectorAll('th')].forEach(h => delete h.dataset.dir);
    th.dataset.dir = dir;

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

    rows.forEach((r, i) => { r.rank = i + 1; });
    render(rows, columns);
  });
}

function render(rows, columns) {
  const tbody = document.getElementById('tbody');

  // Build table body
  tbody.innerHTML = rows.map(r => `
    <tr>
      ${columns.map(c => {
        if (c.key === 'latest') {
          const txt = (r.latest && r.latest.length)
            ? r.latest.map(t =>
                `<span class="badge"><strong>in:</strong> ${t.in.name}</span> <span class="badge"><strong>out:</strong> ${t.out.name}</span>`
              ).join(' ')
            : '<span class="badge">—</span>';
          return `<td class="transfers">${txt}</td>`;
        }
        if (c.key === 'chips') {
          const v = r.chips ?? '';
          return `<td>${v}</td>`;
        }
        const v = r[c.key];
        return `<td>${v ?? ''}</td>`;
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