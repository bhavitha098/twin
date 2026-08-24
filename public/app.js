import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const { supabaseUrl, supabaseAnonKey } = window.CIVIC_TWIN_CONFIG || {};
if (!supabaseUrl || !supabaseAnonKey) {
  document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#f2f7fc;background:#07111f">Missing public/config.js — copy config.example.js and fill in your Supabase project URL + anon key.</div>';
  throw new Error('Missing Supabase config');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const el = (id) => document.getElementById(id);

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

const HISTORY_KEYS = ['traffic', 'water_health', 'city_health', 'reports_unresolved'];

const state = {
  filter: 'all',
  markers: {},
  map: null,
  reportPhotoFile: null,
  reportPin: null,
  pinMode: false,
  latestAlerts: [],
  latestSummary: null,
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

// ---------- Sparklines ----------
function renderSparkline(id, values, color) {
  const svg = el(id);
  if (!svg || !values || values.length < 2) {
    if (svg) svg.innerHTML = '';
    return;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 22 - ((v - min) / range) * 20;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  svg.innerHTML = `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke" />`;
}

function renderHistory(history) {
  if (!history) return;
  renderSparkline('spark-traffic', history.traffic, 'var(--red)');
  renderSparkline('spark-reports_unresolved', history.reports_unresolved, 'var(--orange)');
  renderSparkline('spark-water_health', history.water_health, 'var(--blue)');
  renderSparkline('spark-city_health', history.city_health, 'var(--green)');
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
  const diffMs = Date.now() - new Date(ts).getTime();
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
        <strong>${escapeHtml(i.title)}</strong>
        <p>${escapeHtml(i.body)}</p>
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
      <span>${escapeHtml(row.category)}</span>
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
        <strong>${escapeHtml(a.title)}</strong>
        <p>${escapeHtml(a.detail)}</p>
      </div>
      <button data-dismiss="${a.id}" title="Mark done">✓</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-dismiss]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-dismiss');
      const card = list.querySelector(`.action[data-id="${id}"]`);
      card.classList.add('dismissing');
      const { error } = await supabase.from('actions').update({ dismissed: true }).eq('id', id);
      if (error) {
        showToast('Could not reach Supabase — try again');
        card.classList.remove('dismissing');
      } else {
        showToast('Action marked done');
        loadSummary();
      }
    });
  });
}

// ---------- Alerts ----------
const SEVERITY_CLASS = { high: 'high', medium: 'medium', low: 'low' };

function renderAlerts(alerts) {
  state.latestAlerts = alerts;
  el('alert-badge').textContent = alerts.length;
  if (!el('alerts-modal').hidden) renderAlertsModal();
}

function renderAlertsModal() {
  const list = el('alerts-list');
  if (!state.latestAlerts.length) {
    list.innerHTML = '<div class="empty-state">No active alerts 🎉</div>';
    return;
  }
  list.innerHTML = state.latestAlerts.map((a) => `
    <div class="alert-row" data-id="${a.id}">
      <div class="priority ${SEVERITY_CLASS[a.severity] || 'low'}">${a.severity.toUpperCase()}</div>
      <div class="alert-content">
        <p>${escapeHtml(a.message)}</p>
        <span class="time">${timeAgo(a.created_at)}</span>
      </div>
      <button data-resolve="${a.id}" title="Resolve">✓</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-resolve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-resolve');
      btn.disabled = true;
      const { error } = await supabase.from('alerts').update({ resolved: true }).eq('id', id);
      if (error) {
        showToast('Could not resolve alert — try again');
        btn.disabled = false;
      } else {
        state.latestAlerts = state.latestAlerts.filter((a) => String(a.id) !== id);
        renderAlertsModal();
        el('alert-badge').textContent = state.latestAlerts.length;
        showToast('Alert resolved');
      }
    });
  });
}

function openAlertsModal() {
  renderAlertsModal();
  el('alerts-modal').hidden = false;
}
function closeAlertsModal() {
  el('alerts-modal').hidden = true;
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

  state.map.on('click', (e) => {
    if (!state.pinMode) return;
    setPinMode(false);
    state.reportPin = { lat: e.latlng.lat, lng: e.latlng.lng };
    openReportModal();
  });
}

function setPinMode(on) {
  state.pinMode = on;
  el('pin-report-btn').classList.toggle('active', on);
  el('map').classList.toggle('pin-mode', on);
  if (on) showToast('Click a spot on the map to pin a report location');
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
      state.markers[hs.id].setPopupContent(`<div class="civic-popup"><b>${escapeHtml(hs.label)}</b>${escapeHtml(hs.detail)}</div>`);
      const layerVisible = state.map.hasLayer(state.markers[hs.id]);
      if (visible && !layerVisible) state.markers[hs.id].addTo(state.map);
      if (!visible && layerVisible) state.map.removeLayer(state.markers[hs.id]);
    } else {
      const marker = L.marker([hs.lat, hs.lng], { icon: markerIcon(hs.type, hs.intensity) });
      marker.bindPopup(`<div class="civic-popup"><b>${escapeHtml(hs.label)}</b>${escapeHtml(hs.detail)}</div>`);
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
  document.querySelectorAll('.map-controls button[data-filter]').forEach((b) => {
    b.classList.toggle('selected', b.dataset.filter === filter);
  });
  if (state.latestSummary) renderHotspots(state.latestSummary.hotspots);
}

// ---------- AI: rule-based, grounded in whatever is currently loaded ----------
// No server means no place to safely hold an LLM API key, so this is a
// live-data pattern-matcher, not a real LLM call — kept honest rather than
// dressed up. See README for how to add a real model back (Edge Function).

const AI_RULES = [
  {
    match: /traffic|congestion|nh-?65|road/i,
    respond(ctx) {
      const traffic = ctx.stats.traffic;
      const hs = ctx.hotspots.filter((h) => h.type === 'traffic').sort((a, b) => b.intensity - a.intensity)[0];
      return `Traffic congestion is currently at ${traffic.value.toFixed(0)}% (${traffic.delta >= 0 ? '+' : ''}${traffic.delta.toFixed(1)}% vs last reading). ` +
        (hs ? `The worst hotspot is ${hs.label} — ${hs.detail}.` : 'No major hotspots reported right now.');
    },
  },
  {
    match: /flood|water|rain|drainage/i,
    respond(ctx) {
      const water = ctx.stats.water_health;
      const hs = ctx.hotspots.filter((h) => h.type === 'water').sort((a, b) => b.intensity - a.intensity)[0];
      return `Water network health is at ${water.value.toFixed(1)}%. ` +
        (hs ? `Highest flood-risk zone: ${hs.label} — ${hs.detail}.` : 'No active flood risk zones detected.');
    },
  },
  {
    match: /garbage|waste|trash|complaint/i,
    respond(ctx) {
      const hs = ctx.hotspots.filter((h) => h.type === 'waste').sort((a, b) => b.intensity - a.intensity)[0];
      const insight = ctx.insights.find((i) => i.category === 'waste');
      return (hs ? `Highest waste-complaint area: ${hs.label} — ${hs.detail}. ` : '') +
        (insight ? insight.body : 'No recent waste collection issues reported.');
    },
  },
  {
    match: /emergency|hotspot|urgent|critical/i,
    respond(ctx) {
      const top = [...ctx.hotspots].sort((a, b) => b.intensity - a.intensity).slice(0, 3);
      if (!top.length) return 'No active emergency hotspots right now.';
      return 'Top active hotspots right now: ' + top.map((h) => `${h.label} (${Math.round(h.intensity * 100)}% intensity)`).join(', ') + '.';
    },
  },
  {
    match: /health|score|overall/i,
    respond(ctx) {
      return `Overall city health score is ${Math.round(ctx.stats.city_health.value)}/100. Breakdown: ` +
        ctx.health.map((c) => `${c.category} ${c.score}`).join(', ') + '.';
    },
  },
  {
    match: /report/i,
    respond(ctx) {
      return `There are currently ${ctx.openReportsCount} citizen reports open in the system, and ${Math.round(ctx.stats.reports_unresolved.value)} unresolved issues city-wide.`;
    },
  },
];

function ruleBasedAnswer(question, ctx) {
  const q = (question || '').trim();
  if (!q) return 'Ask me about traffic, flood risk, garbage complaints, emergency hotspots, or overall city health.';
  for (const rule of AI_RULES) {
    if (rule.match.test(q)) return rule.respond(ctx);
  }
  return `I don't have a specific model for that yet, but here's a quick snapshot: traffic is at ${ctx.stats.traffic.value.toFixed(0)}%, and overall city health is ${Math.round(ctx.stats.city_health.value)}/100. Try asking about traffic, flooding, garbage, emergencies, or health score.`;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function askAI(question) {
  const answerBox = el('ai-answer');
  const safeQuestion = escapeHtml(question);
  answerBox.hidden = false;
  answerBox.innerHTML = `<span class="q">${safeQuestion}</span>Thinking…`;
  await sleep(350);
  if (!state.latestSummary) {
    answerBox.innerHTML = `<span class="q">${safeQuestion}</span>Still loading live city data — try again in a second.`;
    return;
  }
  const answer = ruleBasedAnswer(question, state.latestSummary);
  answerBox.innerHTML = `<span class="q">${safeQuestion}</span>${escapeHtml(answer)}`;
}

// ---------- AI: generate an insight from real 6h trends ----------

const TREND_META = {
  traffic: { label: 'Traffic congestion', icon: '🚦', category: 'traffic', unit: '%' },
  water_health: { label: 'Water network health', icon: '💧', category: 'water', unit: '%' },
  city_health: { label: 'City health score', icon: '🏙️', category: 'health', unit: '/100' },
  reports_unresolved: { label: 'Unresolved citizen reports', icon: '📋', category: 'reports', unit: '' },
};

function biggestTrend(history) {
  let best = null;
  for (const key of HISTORY_KEYS) {
    const points = history[key] || [];
    if (points.length < 2) continue;
    const first = points[0];
    const last = points[points.length - 1];
    const pctChange = first === 0 ? 0 : ((last - first) / Math.abs(first)) * 100;
    if (!best || Math.abs(pctChange) > Math.abs(best.pctChange)) {
      best = { key, ...TREND_META[key], first, last, pctChange };
    }
  }
  return best;
}

async function generateInsight() {
  if (!state.latestSummary) return;
  const t = biggestTrend(state.latestSummary.history);
  let insight;
  if (!t) {
    insight = { icon: '🤖', category: 'general', title: 'Not enough data yet', body: 'The trend history is still warming up — click Simulate a few times or check back shortly.' };
  } else {
    const dir = t.pctChange >= 0 ? 'up' : 'down';
    insight = {
      icon: t.icon,
      category: t.category,
      title: `${t.label} trending ${dir}`,
      body: `${t.label} moved from ${t.first.toFixed(1)}${t.unit} to ${t.last.toFixed(1)}${t.unit} over the last 6 hours (${t.pctChange >= 0 ? '+' : ''}${t.pctChange.toFixed(1)}%).`,
    };
  }
  const { error } = await supabase.from('insights').insert(insight);
  if (error) throw error;
}

// ---------- Reports modal ----------
function openReportModal() {
  const note = el('report-pin-note');
  if (state.reportPin) {
    el('report-location').value = `${state.reportPin.lat.toFixed(5)}, ${state.reportPin.lng.toFixed(5)}`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }
  el('report-modal').hidden = false;
}
function closeReportModal() {
  el('report-modal').hidden = true;
  el('report-location').value = '';
  el('report-description').value = '';
  el('report-photo').value = '';
  state.reportPhotoFile = null;
  state.reportPin = null;
  el('report-photo-preview').hidden = true;
  el('report-pin-note').hidden = true;
}

async function uploadReportPhoto(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('report-photos').upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('report-photos').getPublicUrl(path);
  return data.publicUrl;
}

async function submitReport() {
  const category = el('report-category').value;
  const location = el('report-location').value.trim();
  const description = el('report-description').value.trim();
  if (!location || !description) {
    showToast('Please fill in location and description');
    return;
  }
  const submitBtn = el('report-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';
  try {
    let photoUrl = null;
    if (state.reportPhotoFile) {
      try {
        photoUrl = await uploadReportPhoto(state.reportPhotoFile);
      } catch (e) {
        showToast('Photo upload failed — submitting report without it');
      }
    }
    const { error } = await supabase.from('reports').insert({
      category: String(category).slice(0, 60),
      description: String(description).slice(0, 500),
      location: String(location).slice(0, 120),
      photo_url: photoUrl,
      lat: state.reportPin ? state.reportPin.lat : null,
      lng: state.reportPin ? state.reportPin.lng : null,
    });
    if (error) throw error;
    await supabase.rpc('increment_report_stats');
    closeReportModal();
    showToast('Report submitted — thank you!');
    loadSummary();
  } catch (e) {
    showToast('Could not submit report — try again');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Report';
  }
}

// ---------- Simulate: on-demand mock data generator, direct to Supabase ----------
// There is no background process. Nothing moves until this runs. That's
// deliberate — a manual trigger is a more reliable demo than a timer that
// might do nothing interesting at the moment you're on stage.

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function randomWalk(value, step, min, max) { return clamp(value + (Math.random() * 2 - 1) * step, min, max); }

function hotspotDetail(type, intensity) {
  const pct = Math.round(intensity * 100);
  if (type === 'traffic') return `${pct}% congestion`;
  if (type === 'water') {
    if (intensity >= 0.6) return 'High flood-risk probability';
    if (intensity >= 0.3) return 'Moderate flood-risk probability';
    return 'Low risk, monitoring';
  }
  if (type === 'waste') return `${pct}% above normal complaint volume`;
  return `${pct}% intensity`;
}

const INSIGHT_TEMPLATES = [
  { icon: '🚦', category: 'traffic', title: 'Traffic pattern shift', body: 'Congestion near NH-65 moved {pct}% versus the last hour average.' },
  { icon: '🌧️', category: 'water', title: 'Rainfall update', body: 'Flood risk model updated for low-lying zones, current confidence {pct}%.' },
  { icon: '🗑️', category: 'waste', title: 'Collection route update', body: 'Ward 18 complaint volume changed by {pct}% in the last cycle.' },
];

const ALERT_MESSAGES = [
  { severity: 'high', message: 'New congestion spike detected on ring road' },
  { severity: 'medium', message: 'Sensor reports rising water levels' },
  { severity: 'medium', message: 'Spike in citizen complaints in a ward' },
  { severity: 'low', message: 'Air quality index degraded in industrial zone' },
];

const ACTION_TEMPLATES = [
  { priority: 'high', title: 'Deploy traffic management team', detail: 'Congestion on a major corridor is rapidly increasing.' },
  { priority: 'medium', title: 'Inspect drainage in flood-risk zone', detail: 'Flood probability model is trending upward.' },
  { priority: 'medium', title: 'Dispatch waste collection crew', detail: 'Complaint volume is above normal in one ward.' },
  { priority: 'low', title: 'Schedule routine infrastructure audit', detail: 'Due for periodic review this cycle.' },
];

async function simulateOneTick() {
  const { data: statsRows } = await supabase.from('stats').select('key, value');
  const stats = Object.fromEntries((statsRows || []).map((r) => [r.key, r.value]));
  if (!stats.traffic) return;

  const updates = [
    ['traffic', randomWalk(stats.traffic, 3, 20, 98)],
    ['water_health', randomWalk(stats.water_health, 0.6, 70, 99.9)],
    ['city_health', randomWalk(stats.city_health, 1, 55, 99)],
    ['reports_unresolved', Math.round(randomWalk(stats.reports_unresolved, 4, 30, 400))],
  ];
  await Promise.all(updates.map(([key, next]) =>
    supabase.from('stats').update({ value: next, delta: +(next - stats[key]).toFixed(1) }).eq('key', key)
  ));
  await supabase.from('stat_history').insert(updates.map(([key, value]) => ({ key, value })));

  if (Math.random() < 0.3) {
    const nextTotal = stats.reports_total + Math.round(Math.random() * 5);
    await supabase.from('stats').update({ value: nextTotal, delta: nextTotal - stats.reports_total }).eq('key', 'reports_total');
  }

  const { data: hotspots } = await supabase.from('hotspots').select('id, type, intensity');
  if (hotspots) {
    await Promise.all(hotspots.map((hs) => {
      const next = randomWalk(hs.intensity, 0.08, 0.1, 1);
      return supabase.from('hotspots').update({ intensity: next, detail: hotspotDetail(hs.type, next) }).eq('id', hs.id);
    }));
  }

  if (Math.random() < 0.4) {
    const t = INSIGHT_TEMPLATES[Math.floor(Math.random() * INSIGHT_TEMPLATES.length)];
    const pct = Math.floor(Math.random() * 40) + 5;
    await supabase.from('insights').insert({
      icon: t.icon, category: t.category, title: t.title, body: t.body.replace('{pct}', pct),
    });
  }

  if (Math.random() < 0.15) {
    const { count } = await supabase.from('alerts').select('id', { count: 'exact' }).eq('resolved', false).limit(1);
    if ((count || 0) < 8) {
      const a = ALERT_MESSAGES[Math.floor(Math.random() * ALERT_MESSAGES.length)];
      await supabase.from('alerts').insert(a);
    }
  }

  if (Math.random() < 0.15) {
    const { count } = await supabase.from('actions').select('id', { count: 'exact' }).eq('dismissed', false).limit(1);
    if ((count || 0) < 5) {
      const a = ACTION_TEMPLATES[Math.floor(Math.random() * ACTION_TEMPLATES.length)];
      await supabase.from('actions').insert(a);
    }
  }
}

async function runSimulate() {
  const btn = el('simulate-btn');
  btn.disabled = true;
  btn.textContent = '🎲 Simulating…';
  try {
    for (let i = 0; i < 4; i += 1) {
      await simulateOneTick();
    }
    showToast('Simulated new city activity');
  } catch (e) {
    showToast('Simulate failed — check your connection to Supabase');
  } finally {
    btn.disabled = false;
    btn.textContent = '🎲 Simulate';
  }
  // Realtime should already push these changes, but refresh directly too
  // in case this tab's own writes race the subscription callback.
  loadSummary();
}

// ---------- Data loading ----------
// Simulate/realtime/explicit refreshes can all fire in a tight burst;
// coalesce overlapping calls into one in-flight fetch instead of racing
// several full reloads (and their in-flight requests) against each other.
let summaryInFlight = null;
let summaryReloadQueued = false;

function loadSummary() {
  if (summaryInFlight) {
    summaryReloadQueued = true;
    return summaryInFlight;
  }
  summaryInFlight = fetchAndRenderSummary().finally(() => {
    summaryInFlight = null;
    if (summaryReloadQueued) {
      summaryReloadQueued = false;
      loadSummary();
    }
  });
  return summaryInFlight;
}

async function fetchAndRenderSummary() {
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const [statsRes, hotspotsRes, insightsRes, healthRes, actionsRes, alertsRes, historyRes, openReportsRes] = await Promise.all([
    supabase.from('stats').select('key, value, delta'),
    supabase.from('hotspots').select('*'),
    supabase.from('insights').select('*').order('created_at', { ascending: false }).limit(3),
    supabase.from('health_scores').select('*'),
    supabase.from('actions').select('*').eq('dismissed', false).order('created_at', { ascending: false }),
    supabase.from('alerts').select('*').eq('resolved', false).order('created_at', { ascending: false }),
    supabase.from('stat_history').select('key, value, recorded_at').in('key', HISTORY_KEYS).gte('recorded_at', since).order('recorded_at', { ascending: true }),
    supabase.from('reports').select('id', { count: 'exact' }).eq('status', 'open').limit(1),
  ]);

  const firstError = [statsRes, hotspotsRes, insightsRes, healthRes, actionsRes, alertsRes, historyRes, openReportsRes].find((r) => r.error);
  if (firstError) {
    console.error('[loadSummary]', firstError.error);
    setStatus(false);
    return;
  }

  const stats = {};
  statsRes.data.forEach((r) => { stats[r.key] = { value: r.value, delta: r.delta }; });

  const history = {};
  HISTORY_KEYS.forEach((k) => { history[k] = []; });
  historyRes.data.forEach((r) => { history[r.key].push(r.value); });

  const summary = {
    stats,
    hotspots: hotspotsRes.data,
    insights: insightsRes.data,
    health: { overall: Math.round(stats.city_health.value), breakdown: healthRes.data },
    actions: actionsRes.data,
    alerts: alertsRes.data,
    history,
    openReportsCount: openReportsRes.count || 0,
  };

  state.latestSummary = summary;
  renderStats(summary.stats);
  renderInsights(summary.insights);
  renderHealth(summary.health);
  renderActions(summary.actions);
  renderAlerts(summary.alerts);
  renderHotspots(summary.hotspots);
  renderHistory(summary.history);
  setStatus(true);
}

// ---------- Realtime ----------
let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadSummary, 400);
}

function connectRealtime() {
  const channel = supabase.channel('civic-twin-live');
  ['stats', 'hotspots', 'insights', 'health_scores', 'actions', 'alerts', 'reports'].forEach((table) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh);
  });
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') setStatus(true);
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setStatus(false);
  });
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

  document.querySelectorAll('.map-controls button[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => applyFilter(btn.dataset.filter));
  });

  el('pin-report-btn').addEventListener('click', () => setPinMode(!state.pinMode));

  el('generate-insight-btn').addEventListener('click', async () => {
    const btn = el('generate-insight-btn');
    btn.disabled = true;
    btn.textContent = 'Thinking…';
    try {
      await generateInsight();
      showToast('New AI insight generated');
      loadSummary();
    } catch (e) {
      showToast('Could not generate an insight — try again');
    } finally {
      btn.disabled = false;
      btn.textContent = '🧠 Generate';
    }
  });

  el('simulate-btn').addEventListener('click', runSimulate);

  el('alerts-close').addEventListener('click', closeAlertsModal);
  el('alerts-modal').addEventListener('click', (e) => {
    if (e.target.id === 'alerts-modal') closeAlertsModal();
  });

  el('refresh-btn').addEventListener('click', () => {
    loadSummary();
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
        openAlertsModal();
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
    const { data, error } = await supabase.from('insights').select('*').order('created_at', { ascending: false }).limit(20);
    if (!error) renderInsights(data);
    showToast('Showing all recent insights');
  });

  el('report-cancel').addEventListener('click', closeReportModal);
  el('report-submit').addEventListener('click', submitReport);
  el('report-modal').addEventListener('click', (e) => {
    if (e.target.id === 'report-modal') closeReportModal();
  });

  el('report-photo').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    const preview = el('report-photo-preview');
    if (!file) {
      state.reportPhotoFile = null;
      preview.hidden = true;
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Photo is too large — max 5MB');
      e.target.value = '';
      state.reportPhotoFile = null;
      preview.hidden = true;
      return;
    }
    state.reportPhotoFile = file;
    el('report-photo-preview-img').src = URL.createObjectURL(file);
    preview.hidden = false;
  });
}

// ---------- Init ----------
(async function init() {
  initDate();
  initMap();
  wireEvents();
  await loadSummary();
  connectRealtime();
})();
