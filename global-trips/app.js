(() => {
  const STORE = 'jtqx-global-trips-v01';
  const body = document.body;
  const source = body.dataset.tripSource || './trip.json';
  let trip;
  let state;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const money = value => `¥${Number(value || 0).toLocaleString('zh-CN')}`;
  const packingLabels = { owned: '已有', bought: '已买', to_buy: '待买', optional: '可选', not_needed: '不需要' };

  function readState(defaultBudgets) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
      const budgets = { ...defaultBudgets, ...(saved.budgets || {}) };
      const oldHotelAutoPrice = Number(saved.hotelPrice || 0) * 3;
      const wasAutoHotelDraft = trip.hotels.bangkok.status === 'confirmed' && saved.hotel && oldHotelAutoPrice > 0 && Number(budgets.bkkhotel) === oldHotelAutoPrice;
      if (wasAutoHotelDraft) budgets.bkkhotel = '';
      return {
        mode: saved.mode || 'plan',
        hotel: saved.hotel || '',
        hotelPrice: Number(saved.hotelPrice || 0),
        checks: saved.checks || {},
        packingStates: saved.packingStates || {},
        notes: saved.notes || {},
        budgets,
        legacyHotelDraft: saved.legacyHotelDraft || (wasAutoHotelDraft ? { name: saved.hotel, estimatedCny: oldHotelAutoPrice } : null)
      };
    } catch {
      return { mode: 'plan', hotel: '', hotelPrice: 0, checks: {}, packingStates: {}, notes: {}, budgets: { ...defaultBudgets }, legacyHotelDraft: null };
    }
  }

  function saveState() {
    localStorage.setItem(STORE, JSON.stringify(state));
  }

  function statusClass(status) {
    return status === 'confirmed' ? 'ok' : status === 'deciding' ? 'warn' : '';
  }

  function renderHeader() {
    document.title = `JT & QX's Global Trips · ${trip.title}`;
    $('#tripEyebrow').textContent = `${trip.number} · ${trip.subtitle}`;
    $('#tripTitle').textContent = trip.title;
    $('#tripDescription').textContent = `${trip.dates.display} · ${trip.route.map(item => item.city).join(' → ')}。${trip.summary}`;
    $('#mobileNumber').textContent = trip.number;
    $('#mobileTitle').textContent = trip.title;
    $('#mobileDates').textContent = trip.dates.display;
    $('#overviewDates').textContent = `${trip.dates.display} · ${trip.dates.days} 天`;
    $('#overviewRoute').textContent = trip.route.map(item => item.city).join(' → ');

    const confirmed = trip.statusItems.filter(item => item.status === 'confirmed');
    $('#heroMeta').innerHTML = [
      ...confirmed.map(item => `<span class="pill ok">✓ ${escapeHtml(item.label)}已确认</span>`),
      ...(trip.hotels.bangkok.status === 'confirmed' ? [] : ['<span class="pill warn" id="bangkokHotelPill">○ 曼谷酒店待定</span>']),
      '<span class="pill warn">○ 新护照信息待更新</span>'
    ].join('');

    const positions = [{ left: '15%', top: '44%' }, { left: '48%', top: '70%' }, { left: '82%', top: '48%' }];
    $('#routeStops').innerHTML = trip.route.map((item, index) => `<div class="stop" style="left:${positions[index]?.left || '50%'};top:${positions[index]?.top || '50%'}"><div class="dot"></div><strong>${escapeHtml(item.city)}</strong><span>${escapeHtml(item.note || item.code)}</span></div>`).join('');
    $('#mobileRoute').innerHTML = trip.route.map(item => `<div class="mobile-stop"><b>${escapeHtml(item.code)}</b>${escapeHtml(item.city)}</div>`).join('');
    renderCountdown();
  }

  function renderCountdown() {
    const now = new Date();
    const start = new Date(`${trip.dates.start}T00:00:00+08:00`);
    const end = new Date(`${trip.dates.end}T23:59:59+08:00`);
    let text;
    if (now < start) text = `距出发 ${Math.max(1, Math.ceil((start - now) / 86400000))} 天`;
    else if (now <= end) text = '旅途中';
    else text = '已完成';
    $('#mobileCountdown').textContent = text;
  }

  function renderStatus() {
    $('#statusList').innerHTML = trip.statusItems.map(item => `<div class="status-row" data-status-key="${escapeHtml(item.key)}"><div class="status-icon">${escapeHtml(item.icon)}</div><div><b>${escapeHtml(item.label)}</b><span class="status-summary">${escapeHtml(item.summary)}</span></div><div class="badge ${statusClass(item.status)}">${escapeHtml(item.statusLabel)}</div></div>`).join('');
    $('#mobileStatus').innerHTML = trip.statusItems.map(item => `<div class="mobile-status-item" data-mobile-status-key="${escapeHtml(item.key)}"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.statusLabel)}</span></div>`).join('');
  }

  function renderTimeline() {
    $('#timeline').innerHTML = trip.timeline.map(item => `<div class="t-node"><div class="t-date">${escapeHtml(item.date)}</div><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.detail)}</span></div>`).join('');
  }

  function renderItinerary() {
    $('#dayList').innerHTML = trip.itinerary.map(item => `<div class="day"><div class="date">${escapeHtml(item.date)}<small>${escapeHtml(item.weekday)}</small></div><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.detail)}</p></div></div>`).join('');
    $('#principles').innerHTML = `<h4>这次旅行的原则</h4><ul>${trip.principles.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }

  function renderHotels() {
    const maldives = trip.hotels.maldives;
    $('#maldivesBooking').innerHTML = `<h4>✓ Maldives · ${escapeHtml(maldives.name)} <span class="pill ok" style="float:right">${escapeHtml(maldives.statusLabel)}</span></h4><div>${escapeHtml(maldives.dateDisplay)} · ${escapeHtml(maldives.summary)} · 合同价 ${money(maldives.priceCny)}</div><div class="room-seq">${maldives.rooms.map(room => `<div class="room"><b>${escapeHtml(room.dates)}</b><br>${escapeHtml(room.name)}</div>`).join('')}</div>`;
    const bangkok = trip.hotels.bangkok;
    $('#bangkokPriceNote').textContent = bangkok.status === 'confirmed' ? '已确认预订；房费未提供，不用旧候选估价代替。' : bangkok.priceNote;
    $('#hotelGrid').innerHTML = bangkok.status === 'confirmed'
      ? `<div class="known-booking hotel-confirmed"><h4>✓ ${escapeHtml(bangkok.name)} <span class="pill ok">${escapeHtml(bangkok.statusLabel)}</span></h4><p>${escapeHtml(bangkok.dateDisplay)} · ${bangkok.nights} 晚</p><p>${escapeHtml(bangkok.summary)}</p></div>`
      : bangkok.candidates.map(hotel => `<div class="hotel-card" data-hotel="${escapeHtml(hotel.name)}" data-price="${hotel.priceCny}"><div><h4>${escapeHtml(hotel.displayName)}</h4><div class="rate">${money(hotel.priceCny)} / 晚</div></div><span class="pill">${escapeHtml(hotel.tier)}</span><p>${escapeHtml(hotel.note)}</p><button class="select-hotel">本机试选</button></div>`).join('');
    $('#decisionNote').hidden = bangkok.status === 'confirmed';
    if (bangkok.status !== 'confirmed') $('#decisionNote').innerHTML = `<b>Marriott Platinum Challenge · 决策项</b><br>${escapeHtml(bangkok.decisionNote)}`;
  }

  function packingItem(item) {
    if (item.kind === 'task') return checkItem(item);
    const options = Object.entries(packingLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    return `<div class="packing-item"><div class="packing-main"><span class="packing-name">${escapeHtml(item.label)}${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}</span><span class="owner">${escapeHtml(item.owner)}</span></div><div class="packing-controls"><select data-packing-status="${escapeHtml(item.key)}" aria-label="${escapeHtml(item.label)}的采购状态"><option value="">待标记</option>${options}</select><label class="packed-toggle"><input type="checkbox" data-key="${escapeHtml(item.key)}">已打包</label></div></div>`;
  }

  function checkItem(item, owner) {
    return `<label class="check-item"><input type="checkbox" data-key="${escapeHtml(item.key)}"><span>${escapeHtml(item.label)}</span><span class="owner">${escapeHtml(item.owner || owner)}</span></label>`;
  }

  function renderPackingAndTodos() {
    $('#packingGroups').innerHTML = trip.packing.map(group => `<div class="check-group"><h4>${escapeHtml(group.group)}</h4>${group.items.map(item => packingItem(item)).join('')}</div>`).join('');
    $('#todoGroups').innerHTML = trip.todos.map(group => `<div class="check-group"><h4>${escapeHtml(group.owner)}</h4>${group.items.map(item => checkItem(item, group.owner)).join('')}</div>`).join('');
  }

  function renderBudgetAndMemories() {
    $('#budgetList').innerHTML = trip.budget.items.map(item => `<div class="budget-row"><span>${escapeHtml(item.label)}</span><input type="number" inputmode="numeric" class="budget-input" data-budget="${escapeHtml(item.key)}" ${item.key === 'bkkhotel' ? 'id="bkkHotelBudget"' : ''} placeholder="${item.defaultCny === null ? '待录入' : ''}"></div>`).join('');
    $('#budgetNote').textContent = trip.hotels.bangkok.status === 'confirmed'
      ? `${trip.budget.note}曼谷酒店已订，实际房费请手动录入；旧候选自动估价不会当作实付。`
      : `${trip.budget.note}选定曼谷酒店草稿后会按 ${trip.hotels.bangkok.nights} 晚自动计入。`;
    $('#memoryGrid').innerHTML = trip.memoryPrompts.map(item => `<div class="memory-card"><h4>${escapeHtml(item.title)}</h4><textarea data-note="${escapeHtml(item.key)}" placeholder="${escapeHtml(item.placeholder)}"></textarea></div>`).join('');
  }

  function bindState() {
    $$('select[data-packing-status]').forEach(select => {
      const item = trip.packing.flatMap(group => group.items).find(entry => entry.key === select.dataset.packingStatus);
      const selected = state.packingStates[select.dataset.packingStatus] ?? item?.status ?? '';
      select.value = packingLabels[selected] ? selected : '';
      select.dataset.state = select.value || 'unset';
      select.addEventListener('change', () => {
        state.packingStates[select.dataset.packingStatus] = select.value;
        select.dataset.state = select.value || 'unset';
        saveState();
        updateProgress();
      });
    });
    $$('input[type=checkbox][data-key]').forEach(input => {
      input.checked = Boolean(state.checks[input.dataset.key]);
      input.addEventListener('change', () => {
        state.checks[input.dataset.key] = input.checked;
        saveState();
        updateProgress();
      });
    });
    $$('textarea[data-note]').forEach(textarea => {
      textarea.value = state.notes[textarea.dataset.note] || '';
      textarea.addEventListener('input', () => {
        state.notes[textarea.dataset.note] = textarea.value;
        saveState();
      });
    });
    $$('.hotel-card').forEach(card => card.querySelector('.select-hotel').addEventListener('click', () => {
      state.hotel = card.dataset.hotel;
      state.hotelPrice = Number(card.dataset.price);
      state.budgets.bkkhotel = state.hotelPrice * trip.hotels.bangkok.nights;
      saveState();
      $('#bkkHotelBudget').value = state.budgets.bkkhotel;
      renderHotelState();
      renderBudgetTotal();
      updateProgress();
    }));
    $$('.budget-input').forEach(input => {
      const key = input.dataset.budget;
      input.value = state.budgets[key] ?? '';
      input.addEventListener('input', () => {
        state.budgets[key] = input.value === '' ? '' : Number(input.value);
        saveState();
        renderBudgetTotal();
      });
    });
  }

  function renderHotelState() {
    if (trip.hotels.bangkok.status === 'confirmed') return;
    $$('.hotel-card').forEach(card => {
      const selected = card.dataset.hotel === state.hotel;
      card.classList.toggle('selected', selected);
      card.querySelector('.select-hotel').textContent = selected ? '✓ 本机已试选' : '本机试选';
    });
    const row = $('[data-status-key="bangkokHotel"]');
    const mini = $('[data-mobile-status-key="bangkokHotel"] span');
    const pill = $('#bangkokHotelPill');
    if (state.hotel) {
      row.querySelector('.status-summary').textContent = `${state.hotel} · 参考 ${money(state.hotelPrice)}/晚`;
      row.querySelector('.badge').textContent = '本机试选';
      row.querySelector('.badge').className = 'badge ok';
      mini.textContent = state.hotel;
      pill.textContent = `✓ 曼谷酒店草稿：${state.hotel}`;
      pill.className = 'pill ok';
    } else {
      row.querySelector('.status-summary').textContent = '待选择';
      row.querySelector('.badge').textContent = '待定';
      row.querySelector('.badge').className = 'badge warn';
      mini.textContent = '待定';
      pill.textContent = '○ 曼谷酒店待定';
      pill.className = 'pill warn';
    }
  }

  function renderBudgetTotal() {
    $('#budgetTotal').textContent = money(Object.values(state.budgets).reduce((sum, value) => sum + Number(value || 0), 0));
  }

  function updateProgress() {
    const packing = $$('#packingGroups input[type=checkbox]').filter(input => {
      const status = input.closest('.packing-item')?.querySelector('select[data-packing-status]')?.value;
      return status !== 'not_needed' && (status !== 'optional' || input.checked);
    });
    const done = packing.filter(input => input.checked).length;
    const percent = packing.length ? Math.round(done / packing.length * 100) : 0;
    const row = $('[data-status-key="packing"]');
    row.querySelector('.status-summary').textContent = `已完成 ${done} / ${packing.length}`;
    row.querySelector('.badge').textContent = `${percent}%`;
    $('[data-mobile-status-key="packing"] span').textContent = `${percent}%`;
    const majorDone = 2 + (trip.hotels.bangkok.status === 'confirmed' || state.hotel ? 1 : 0);
    const overall = Math.round(((majorDone / 3) * .55 + (percent / 100) * .45) * 100);
    $('#overallPct').textContent = `整体约 ${overall}%`;
  }

  function stageLabel(mode) {
    return mode === 'live' ? '当前：旅途中' : mode === 'memory' ? '当前：纪念册' : '当前：准备期';
  }

  function setMode(mode) {
    state.mode = mode;
    saveState();
    $$('.mode-btn').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
    $('#memoryHero').classList.toggle('active', mode === 'memory');
    $('#liveCard').classList.toggle('active', mode === 'live');
    $('#mobileStage').textContent = stageLabel(mode);
    if (mode === 'live') renderLive();
  }

  function shanghaiDate(date) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function renderLive() {
    const now = new Date();
    const start = new Date(`${trip.dates.start}T00:00:00+08:00`);
    const end = new Date(`${trip.dates.end}T23:59:59+08:00`);
    $('#liveDate').textContent = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    if (now < start) {
      $('#countdownPill').textContent = `距离出发 ${Math.max(1, Math.ceil((start - now) / 86400000))} 天`;
      $('#liveContent').innerHTML = '<div class="live-now"><b>还没出发。</b><br>先把酒店、护照、保险和打包收尾。</div>';
      return;
    }
    if (now > end) {
      $('#countdownPill').textContent = '旅行已结束';
      $('#liveContent').innerHTML = `<div class="live-now"><b>${escapeHtml(trip.number)} 已完成。</b><br>切到 Memory，把照片、花费和两个人的评价补进去。</div>`;
      return;
    }
    const today = shanghaiDate(now);
    const item = trip.itinerary.find(entry => `${trip.dates.start.slice(0, 4)}-${entry.date.replace('.', '-')}` === today);
    $('#countdownPill').textContent = 'Live';
    $('#liveContent').innerHTML = `<div class="live-now"><b>${escapeHtml(item?.liveTitle || '自由日')}</b><br>${escapeHtml(item?.liveDetail || '按当天状态走。')}</div>`;
  }

  function activatePanel(name, shouldScroll = false) {
    $$('.plan-tab').forEach(button => button.classList.toggle('active', button.dataset.panel === name));
    $$('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${name}`));
    $$('.mobile-nav button').forEach(button => button.classList.toggle('active', button.dataset.panel === name));
    if (shouldScroll) $('#planner').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function bindNavigation() {
    $$('.mode-btn').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
    $$('.plan-tab').forEach(button => button.addEventListener('click', () => activatePanel(button.dataset.panel)));
    $$('[data-jump-panel]').forEach(button => button.addEventListener('click', () => activatePanel(button.dataset.jumpPanel, true)));
    $$('.mobile-nav button').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.action === 'overview') {
        $$('.mobile-nav button').forEach(item => item.classList.toggle('active', item === button));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else activatePanel(button.dataset.panel, true);
    }));
    $('#printBtn').addEventListener('click', () => window.print());
    $('#resetBtn').addEventListener('click', () => {
      if (confirm('清空这个浏览器里的采购状态、打包勾选、预算草稿和旅行笔记？')) {
        localStorage.removeItem(STORE);
        location.reload();
      }
    });
  }

  async function init() {
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Trip Data 读取失败：${response.status}`);
    trip = await response.json();
    if (!trip.id || !trip.dates || !trip.hotels) throw new Error('Trip Data 结构不完整');
    const defaultBudgets = Object.fromEntries(trip.budget.items.map(item => [item.key, item.defaultCny ?? '']));
    state = readState(defaultBudgets);
    renderHeader();
    renderStatus();
    renderTimeline();
    renderItinerary();
    renderHotels();
    renderPackingAndTodos();
    renderBudgetAndMemories();
    bindState();
    bindNavigation();
    renderHotelState();
    renderBudgetTotal();
    updateProgress();
    setMode(state.mode || 'plan');
    document.documentElement.dataset.ready = 'true';
  }

  init().catch(error => {
    console.error(error);
    $('#appError').hidden = false;
    $('#appError').textContent = `页面数据加载失败：${error.message}`;
  });
})();
