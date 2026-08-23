const API_BASE = '';

const el = (id) => document.getElementById(id);

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

const state = {
  filter: 'all',
  markers: {},
  map: null,
};

// ---------- Toast ----------
let toastTimer = null;
function showToast(message) {
  const toast = el('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

// ---------- Date ----------
function initDate() {
  const today = new Date();
  el('today-label').textContent = today
    .toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    .toUpperCase();
}

// ---------- Connection status ----------
function setStatus(online) {
  const dot = el('status-dot');
  const text = el('status-text');
  const time = el('status-time');
  dot.classList.toggle('offline', !online);
  text.textContent = online ? 'City Systems Online' : 'Reconnecting…';
  time.textContent = online ? `Updated ${new Date().toLocaleTimeString()}` : 'Last update failed';
}

// ---------- Stats ----------
function renderStats(stats) {
  const traffic = stats.traffic;
  el('stat-traffic').textContent = `${Math.round(traffic.value)}%`;
  el('progress-traffic').style.width = `${Math.round(traffic.value)}%`;
  el('delta-traffic').textContent = `${traffic.delta >= 0 ? '↑' : '↓'} ${Math.abs(traffic.delta).toFixed(1)}%`;

  const total = stats.reports_total;
  const unresolved = stats.reports_unresolved;
  el('stat-reports-total').textContent = Math.round(total.value).toLocaleString();
  el('progress-reports').style.width = `${Math.min(100, Math.round((unresolved.value / total.value) * 100))}%`;
  el('stat-reports-unresolved').textContent = `${Math.round(unresolved.value)} unresolved`;

  const water = stats.water_health;
  el('stat-water').textContent = `${water.value.toFixed(1)}%`;
  el('progress-water').style.width = `${water.value.toFixed(1)}%`;
  el('delta-water').textContent = `${water.delta >= 0 ? '↑' : '↓'} ${Math.abs(water.delta).toFixed(1)}%`;

  const health = stats.city_health;
  el('stat-health').textContent = `${Math.round(health.value)}/100`;
  el('progress-health').style.width = `${Math.round(health.value)}%`;
  const label = health.value >= 80 ? 'Good' : health.value >= 60 ? 'Fair' : 'Needs attention';
  const cls = health.value >= 80 ? 'success' : health.value >= 60 ? 'warning' : 'danger';
  const labelEl = el('health-label');
  labelEl.textContent = label;
  labelEl.className = cls;
}

// ---------- Insights ----------
function timeAgo(ts) {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
}

const CATEGORY_BG = { traffic: 'red-bg', water: 'blue-bg', waste: 'orange-bg' };

function renderInsights(insights) {
  const list = el('insights-list');
  if (!insights.length) {
    list.innerHTML = '<div class="empty-state">No insights yet — the AI is watching the city.</div>';
    return;
  }
  list.innerHTML = insights.map((i) => `
    <div class="insight">
      <div class="insight-icon ${CATEGORY_BG[i.category] || 'blue-bg'}">${i.icon}</div>
      <div>
        <strong>${i.title}</strong>
        <p>${i.body}</p>
        <span class="time">${timeAgo(i.created_at)}</span>
      </div>
    </div>
  `).join('');
}

// ---------- Health ----------
function renderHealth(health) {
  el('score-overall').textContent = health.overall;
  el('health-bars').innerHTML = health.breakdown.map((row) => `
    <div class="health-row">
      <span>${row.category}</span>
      <div class="bar"><i class="${row.score < 75 ? 'yellow-bar' : ''}" style="width:${row.score}%"></i></div>
      <b>${row.score}</b>
    </div>
  `).join('');
}

// ---------- Actions ----------
function renderActions(actions) {
  const list = el('actions-list');
  if (!actions.length) {
    list.innerHTML = '<div class="empty-state">No open recommended actions right now 🎉</div>';
    return;
  }
  list.innerHTML = actions.map((a) => `
    <div class="action" data-id="${a.id}">
      <div class="priority ${a.priority}">${a.priority.toUpperCase()}</div>
      <div class="action-content">
        <strong>${a.title}</strong>
        <p>${a.detail}</p>
      </div>
      <button data-dismiss="${a.id}" title="Mark done">✓</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-dismiss]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-dismiss');
      const card = list.querySelector(`.action[data-id="${id}"]`);
      card.classList.add('dismissing');
      try {
        await fetch(`${API_BASE}/api/actions/${id}/dismiss`, { method: 'POST' });
        showToast('Action marked done');
      } catch (e) {
        showToast('Could not reach server — try again');
      }
    });
  });
}

// ---------- Alerts ----------
function renderAlerts(alerts) {
  el('alert-badge').textContent = alerts.length;
}

// ---------- Map ----------
const TYPE_COLOR = { traffic: '#ff5d69', water: '#4ca5ff', waste: '#ffad4d' };

function initMap() {
  state.map = L.map('map', {
    zoomControl: true,
    attributionControl: false,
  }).setView([17.4239, 78.4738], 12);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(state.map);
}

function markerIcon(type, intensity) {
  const color = TYPE_COLOR[type] || '#4ca5ff';
  const size = 16 + Math.round(intensity * 14);
  return L.divIcon({
    className: '',
    html: `<div class="civic-marker" style="width:${size}px;height:${size}px;background:${color}44;border:2px solid ${color};color:${color};"></div>`,
    iconSize: [size, size],
  });
}

function renderHotspots(hotspots) {
  if (!state.map) return;
  const seen = new Set();
  hotspots.forEach((hs) => {
    seen.add(hs.id);
    const visible = state.filter === 'all' || state.filter === hs.type;
    if (state.markers[hs.id]) {
      state.markers[hs.id].setIcon(markerIcon(hs.type, hs.intensity));
      state.markers[hs.id].setLatLng([hs.lat, hs.lng]);
      const layerVisible = state.map.hasLayer(state.markers[hs.id]);
      if (visible && !layerVisible) state.markers[hs.id].addTo(state.map);
      if (!visible && layerVisible) state.map.removeLayer(state.markers[hs.id]);
    } else {
      const marker = L.marker([hs.lat, hs.lng], { icon: markerIcon(hs.type, hs.intensity) });
      marker.bindPopup(`<div class="civic-popup"><b>${hs.label}</b>${hs.detail}</div>`);
      if (visible) marker.addTo(state.map);
      state.markers[hs.id] = marker;
    }
  });
  Object.keys(state.markers).forEach((id) => {
    if (!seen.has(id)) {
      state.map.removeLayer(state.markers[id]);
      delete state.markers[id];
    }
  });
}

function applyFilter(filter) {
  state.filter = filter;
  document.querySelectorAll('.map-controls button').forEach((b) => {
    b.classList.toggle('selected', b.dataset.filter === filter);
  });
}

// ---------- AI ----------
async function askAI(question) {
  const answerBox = el('ai-answer');
  const safeQuestion = escapeHtml(question);
  answerBox.hidden = false;
  answerBox.innerHTML = `<span class="q">${safeQuestion}</span>Thinking…`;
  try {
    const res = await fetch(`${API_BASE}/api/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();
    answerBox.innerHTML = `<span class="q">${safeQuestion}</span>${escapeHtml(data.answer)}`;
  } catch (e) {
    answerBox.innerHTML = `<span class="q">${safeQuestion}</span>Could not reach the Civic Twin backend. Is the server running?`;
  }
}

// ---------- Reports modal ----------
function openReportModal() {
  el('report-modal').hidden = false;
}
function closeReportModal() {
  el('report-modal').hidden = true;
  el('report-location').value = '';
  el('report-description').value = '';
}
async function submitReport() {
  const category = el('report-category').value;
  const location = el('report-location').value.trim();
  const description = el('report-description').value.trim();
  if (!location || !description) {
    showToast('Please fill in location and description');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, location, description }),
    });
    if (!res.ok) throw new Error('failed');
    closeReportModal();
    showToast('Report submitted — thank you!');
    fetchSummary();
  } catch (e) {
    showToast('Could not submit report — try again');
  }
}

// ---------- Data fetch / SSE ----------
function applySummary(data) {
  renderStats(data.stats);
  renderInsights(data.insights);
  renderHealth(data.health);
  renderActions(data.actions);
  renderAlerts(data.alerts);
  renderHotspots(data.hotspots);
  setStatus(true);
}

async function fetchSummary() {
  try {
    const res = await fetch(`${API_BASE}/api/summary`);
    const data = await res.json();
    applySummary(data);
  } catch (e) {
    setStatus(false);
  }
}

function connectStream() {
  const source = new EventSource(`${API_BASE}/api/stream`);
  source.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      applySummary(data);
    } catch (e) { /* ignore malformed frame */ }
  };
  source.onerror = () => {
    setStatus(false);
  };
}

// ---------- Wiring ----------
function wireEvents() {
  el('ai-ask-btn').addEventListener('click', () => {
    const q = el('ai-input').value.trim();
    if (q) askAI(q);
  });
  el('ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = el('ai-input').value.trim();
      if (q) askAI(q);
    }
  });
  document.querySelectorAll('.suggestions button').forEach((btn) => {
    btn.addEventListener('click', () => askAI(btn.dataset.q));
  });

  document.querySelectorAll('.map-controls button').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyFilter(btn.dataset.filter);
      fetchSummary();
    });
  });

  el('refresh-btn').addEventListener('click', () => {
    fetchSummary();
    showToast('Refreshed');
  });

  el('city-selector').addEventListener('click', () => {
    showToast('More cities coming soon — showing Hyderabad live data');
  });

  document.querySelectorAll('nav a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = a.dataset.nav;
      if (target === 'dashboard') return;
      if (target === 'map') {
        document.querySelector('.map-card').scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (target === 'alerts') {
        showToast(`${el('alert-badge').textContent} active alert(s) — full alerts page coming soon`);
        return;
      }
      if (target === 'reports') {
        openReportModal();
        return;
      }
      showToast('This section is coming soon');
    });
  });

  el('view-all-insights').addEventListener('click', async () => {
    const res = await fetch(`${API_BASE}/api/insights?limit=20`);
    const data = await res.json();
    renderInsights(data);
    showToast('Showing all recent insights');
  });

  el('report-cancel').addEventListener('click', closeReportModal);
  el('report-submit').addEventListener('click', submitReport);
  el('report-modal').addEventListener('click', (e) => {
    if (e.target.id === 'report-modal') closeReportModal();
  });
}

// ---------- Init ----------
(async function init() {
  initDate();
  initMap();
  wireEvents();
  await fetchSummary();
  connectStream();
})();
