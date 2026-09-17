(() => {
  const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  fetch('./data/trips.json', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      document.getElementById('trips').innerHTML = data.trips.map(trip => `<a class="trip" href="${escapeHtml(trip.path)}" aria-label="打开 ${escapeHtml(trip.number)} ${escapeHtml(trip.title)}"><div class="copy"><div class="number">${escapeHtml(trip.number)} · ${escapeHtml(trip.subtitle)}</div><h3>${escapeHtml(trip.title)}</h3><div class="route">${escapeHtml(trip.dateDisplay)}<br>${escapeHtml(trip.routeDisplay)}</div><div class="meta"><span class="pill status">${escapeHtml(trip.statusLabel)}</span><span class="pill">${escapeHtml(trip.durationLabel)}</span><span class="pill">${escapeHtml(trip.subtitle)}</span></div><div class="open">打开旅程 →</div></div><div class="art" aria-hidden="true"><div class="sun"></div><div class="water"></div><div class="island"></div><div class="city"></div><div class="route-line"></div><div class="plane">✈</div></div></a>`).join('');
      document.documentElement.dataset.ready = 'true';
    })
    .catch(error => {
      console.error(error);
      document.getElementById('trips').innerHTML = `<div class="trip-error">旅行数据加载失败：${escapeHtml(error.message)}</div>`;
    });
})();
