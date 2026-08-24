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

const HISTORY_KEYS = ['traffic', 'reports_unresolved', 'waste_management'];

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
    .toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const tick = () => { el('clock-label').textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); };
  tick();
  setInterval(tick, 30000);
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
  renderSparkline('spark-waste_management', history.waste_management, 'var(--orange)');
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

  const waste = stats.waste_management;
  el('stat-waste').textContent = `${Math.round(waste.value)}/100`;
  el('progress-waste').style.width = `${Math.round(waste.value)}%`;
  el('delta-waste').textContent = `${waste.delta >= 0 ? '↑' : '↓'} ${Math.abs(waste.delta).toFixed(1)}`;

  el('sidebar-score').textContent = Math.round(waste.value);
  const sideDelta = el('sidebar-score-delta');
  sideDelta.textContent = `${waste.delta >= 0 ? '+' : ''}${waste.delta.toFixed(1)}`;
  sideDelta.style.color = waste.delta >= 0 ? '#34d399' : '#f87171';
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
const CATEGORY_ICON = {
  traffic: '<path d="M4 16V11l2-5h12l2 5v5"/><path d="M4 16h16"/><circle cx="7.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="16.5" r="1.5"/>',
  water: '<path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z"/>',
  waste: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
};
const ICON_CHECK = '<path d="M4 12l5 5L20 6"/>';

function svgIcon(pathMarkup) {
  return `<svg class="icon" viewBox="0 0 24 24">${pathMarkup}</svg>`;
}

function renderInsights(insights) {
  const list = el('insights-list');
  if (!insights.length) {
    list.innerHTML = '<div class="empty-state">No insights yet — the AI is watching the city.</div>';
    return;
  }
  list.innerHTML = insights.map((i) => `
    <div class="insight">
      <div class="insight-icon ${CATEGORY_BG[i.category] || 'blue-bg'}">${svgIcon(CATEGORY_ICON[i.category] || CATEGORY_ICON.water)}</div>
      <div>
        <strong>${escapeHtml(i.title)}</strong>
        <p>${escapeHtml(i.body)}</p>
        <span class="time">${timeAgo(i.created_at)}</span>
      </div>
    </div>
  `).join('');
}

// ---------- Current Traffic Situation ----------
function renderTrafficDetail(overallPct, hotspots) {
  const overallEl = el('traffic-overall');
  overallEl.textContent = `${Math.round(overallPct)}%`;
  overallEl.className = 'score ' + (overallPct >= 70 ? 'danger' : overallPct >= 45 ? 'warning' : 'success');
  const corridors = hotspots.filter((h) => h.type === 'traffic');
  if (!corridors.length) {
    el('traffic-bars').innerHTML = '<div class="empty-state">No traffic corridors reporting right now.</div>';
    return;
  }
  el('traffic-bars').innerHTML = corridors.map((h) => {
    const pct = Math.round(h.intensity * 100);
    return `
    <div class="health-row">
      <span>${escapeHtml(h.label)}</span>
      <div class="bar"><i class="${pct >= 70 ? 'yellow-bar' : ''}" style="width:${pct}%"></i></div>
      <b>${pct}%</b>
    </div>
  `;
  }).join('');
}

// ---------- Actions ----------
function renderActions(actions) {
  const list = el('actions-list');
  if (!actions.length) {
    list.innerHTML = '<div class="empty-state">No open recommended actions right now.</div>';
    return;
  }
  list.innerHTML = actions.map((a) => `
    <div class="action" data-id="${a.id}">
      <div class="priority ${a.priority}">${a.priority.toUpperCase()}</div>
      <div class="action-content">
        <strong>${escapeHtml(a.title)}</strong>
        <p>${escapeHtml(a.detail)}</p>
      </div>
      <button data-dismiss="${a.id}" title="Mark done">${svgIcon(ICON_CHECK)}</button>
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
  el('bell-dot').hidden = alerts.length === 0;
  if (!el('alerts-modal').hidden) renderAlertsModal();
}

function renderAlertsModal() {
  const list = el('alerts-list');
  if (!state.latestAlerts.length) {
    list.innerHTML = '<div class="empty-state">No active alerts right now.</div>';
    return;
  }
  list.innerHTML = state.latestAlerts.map((a) => `
    <div class="alert-row" data-id="${a.id}">
      <div class="priority ${SEVERITY_CLASS[a.severity] || 'low'}">${a.severity.toUpperCase()}</div>
      <div class="alert-content">
        <p>${escapeHtml(a.message)}</p>
        <span class="time">${timeAgo(a.created_at)}</span>
      </div>
      <button data-resolve="${a.id}" title="Resolve">${svgIcon(ICON_CHECK)}</button>
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

// ---------- Manage reports (status lifecycle) ----------
const STATUS_LABEL = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved' };
const STATUS_ORDER = ['open', 'in_progress', 'resolved'];

async function renderManageReports() {
  const list = el('manage-reports-list');
  list.innerHTML = '<div class="empty-state">Loading…</div>';
  const { data, error } = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(30);
  if (error) {
    list.innerHTML = '<div class="empty-state">Could not load reports.</div>';
    return;
  }
  if (!data.length) {
    list.innerHTML = '<div class="empty-state">No citizen reports yet.</div>';
    return;
  }
  list.innerHTML = data.map((r) => `
    <div class="report-row" data-id="${r.id}">
      <div class="report-content">
        <span class="status-pill ${r.status}">${STATUS_LABEL[r.status] || r.status}</span>
        <p style="margin-top:6px"><strong>${escapeHtml(r.category)}</strong> — ${escapeHtml(r.location)}</p>
        <p>${escapeHtml(r.description)}</p>
        <span class="report-meta">${timeAgo(r.created_at)}</span>
      </div>
      <div class="status-actions">
        <select class="status-select" data-id="${r.id}">
          ${STATUS_ORDER.map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.getAttribute('data-id');
      const newStatus = sel.value;
      sel.disabled = true;
      const { error: updateError } = await supabase.from('reports').update({ status: newStatus }).eq('id', id);
      sel.disabled = false;
      if (updateError) {
        showToast('Could not update status — try again');
        return;
      }
      const row = list.querySelector(`.report-row[data-id="${id}"] .status-pill`);
      if (row) { row.className = `status-pill ${newStatus}`; row.textContent = STATUS_LABEL[newStatus]; }
      showToast('Report status updated');
    });
  });
}

function openManageReportsModal() {
  el('report-modal').hidden = true;
  el('manage-reports-modal').hidden = false;
  renderManageReports();
}
function closeManageReportsModal() {
  el('manage-reports-modal').hidden = true;
}

// ---------- Map ----------
const TYPE_COLOR = { traffic: '#ff5d69', water: '#4ca5ff', waste: '#ffad4d' };

function initMap() {
  state.map = L.map('map', {
    zoomControl: true,
    attributionControl: false,
  }).setView([17.4239, 78.4738], 12);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
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
    const popupHtml = `<div class="civic-popup"><b>${escapeHtml(hs.label)}</b>${escapeHtml(hs.detail)}</div>`;
    const tooltipHtml = `<b>${escapeHtml(hs.label)}</b><br>${escapeHtml(hs.detail)}`;
    if (state.markers[hs.id]) {
      state.markers[hs.id].setIcon(markerIcon(hs.type, hs.intensity));
      state.markers[hs.id].setLatLng([hs.lat, hs.lng]);
      state.markers[hs.id].setPopupContent(popupHtml);
      state.markers[hs.id].setTooltipContent(tooltipHtml);
      const layerVisible = state.map.hasLayer(state.markers[hs.id]);
      if (visible && !layerVisible) state.markers[hs.id].addTo(state.map);
      if (!visible && layerVisible) state.map.removeLayer(state.markers[hs.id]);
    } else {
      const marker = L.marker([hs.lat, hs.lng], { icon: markerIcon(hs.type, hs.intensity) });
      marker.bindPopup(popupHtml);
      marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -6] });
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
    match: /report/i,
    respond(ctx) {
      return `There are currently ${ctx.openReportsCount} citizen reports open in the system, and ${Math.round(ctx.stats.reports_unresolved.value)} unresolved issues city-wide.`;
    },
  },
];

function ruleBasedAnswer(question, ctx) {
  const q = (question || '').trim();
  if (!q) return 'Ask me about traffic, flood risk, garbage complaints, or emergency hotspots.';
  for (const rule of AI_RULES) {
    if (rule.match.test(q)) return rule.respond(ctx);
  }
  return `I don't have a specific model for that yet, but here's a quick snapshot: traffic is at ${ctx.stats.traffic.value.toFixed(0)}%, and waste management score is ${Math.round(ctx.stats.waste_management.value)}/100. Try asking about traffic, flooding, garbage, or emergencies.`;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Real Gemini via the Vercel serverless function when it's reachable and
// configured; silently falls back to the rule-based pattern matcher
// otherwise (local dev with `npm run dev`, GitHub Pages, or Vercel before
// GEMINI_API_KEY is set — none of those have a working /api route).
async function callAI(mode, payload) {
  try {
    const res = await fetch('/api/ask-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, ...payload }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function askAI(question) {
  const answerBox = el('ai-answer');
  const safeQuestion = escapeHtml(question);
  answerBox.hidden = false;
  answerBox.innerHTML = `<span class="q">${safeQuestion}</span>Thinking…`;
  if (!state.latestSummary) {
    await sleep(350);
    answerBox.innerHTML = `<span class="q">${safeQuestion}</span>Still loading live city data — try again in a second.`;
    return;
  }

  const real = await callAI('ask', { question, context: state.latestSummary });
  if (real && real.answer) {
    answerBox.innerHTML = `<span class="q">${safeQuestion}</span>${escapeHtml(real.answer)}`;
    return;
  }

  await sleep(200);
  const answer = ruleBasedAnswer(question, state.latestSummary);
  answerBox.innerHTML = `<span class="q">${safeQuestion}</span>${escapeHtml(answer)}`;
}

// ---------- AI: generate an insight from real 6h trends ----------

const TREND_META = {
  traffic: { label: 'Traffic congestion', icon: 'traffic', category: 'traffic', unit: '%' },
  reports_unresolved: { label: 'Unresolved citizen reports', icon: 'reports', category: 'reports', unit: '' },
  waste_management: { label: 'Waste management score', icon: 'waste', category: 'waste', unit: '/100' },
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

  const real = await callAI('insight', { trends: state.latestSummary.history, context: state.latestSummary });
  let insight = real && real.title && real.body ? real : null;

  if (!insight) {
    const t = biggestTrend(state.latestSummary.history);
    if (!t) {
      insight = { icon: 'general', category: 'general', title: 'Not enough data yet', body: 'The trend history is still warming up — click Sync a few times or check back shortly.' };
    } else {
      const dir = t.pctChange >= 0 ? 'up' : 'down';
      insight = {
        icon: t.icon,
        category: t.category,
        title: `${t.label} trending ${dir}`,
        body: `${t.label} moved from ${t.first.toFixed(1)}${t.unit} to ${t.last.toFixed(1)}${t.unit} over the last 6 hours (${t.pctChange >= 0 ? '+' : ''}${t.pctChange.toFixed(1)}%).`,
      };
    }
  }

  const { error } = await supabase.from('insights').insert({
    icon: insight.icon, category: insight.category, title: insight.title, body: insight.body,
  });
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

// ---------- Real data sync ----------
// No mock generator. Every number written here comes from either a real
// public API (Open-Meteo — weather and air quality, both free and keyless)
// or real citizen-submitted reports already in Supabase. The two exceptions
// are documented inline: a time-of-day traffic baseline (a standard urban
// heuristic, not a live sensor feed — see TRAFFIC below) and the
// Infrastructure/Public Safety sub-scores, which have no free public API for
// any city and are deliberately left static rather than faked into motion.

const CITY_CENTER = { lat: 17.4239, lng: 78.4738 };
const HOTSPOT_COORDS = {
  'hs-1': { lat: 17.4483, lng: 78.3915, type: 'traffic' }, // NH-65
  'hs-2': { lat: 17.4239, lng: 78.4738, type: 'water' },   // Flood Risk Zone
  'hs-3': { lat: 17.3850, lng: 78.4867, type: 'waste' },   // Ward 18
  'hs-4': { lat: 17.4399, lng: 78.4482, type: 'traffic' }, // Begumpet Junction
  'hs-5': { lat: 17.4239, lng: 78.4738, type: 'water' },   // Hussain Sagar
};

async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=precipitation,rain,weather_code,shortwave_radiation,temperature_2m&hourly=precipitation_probability&timezone=Asia%2FKolkata&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo weather ${res.status}`);
  const data = await res.json();
  const nowHour = new Date().getHours();
  const probs = data.hourly?.precipitation_probability || [];
  return {
    rainMm: data.current?.precipitation ?? 0,
    rainProbPct: probs[nowHour] ?? probs[0] ?? 0,
    localHour: new Date(data.current.time).getHours(),
    solarRadiation: data.current?.shortwave_radiation ?? 0,
    temperature: data.current?.temperature_2m ?? 28,
  };
}

async function fetchAirQuality(lat, lng) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo air quality ${res.status}`);
  const data = await res.json();
  return { aqi: data.current?.us_aqi ?? 60 };
}

// A standard "typical urban traffic by hour" pattern, not a live sensor —
// used only when TomTom is unavailable (no key, quota exhausted, network
// error), then adjusted by real citizen Traffic reports below.
function trafficBaselineForHour(hour) {
  if (hour >= 8 && hour <= 10) return 78;   // morning rush
  if (hour >= 17 && hour <= 20) return 82;  // evening rush
  if (hour >= 11 && hour <= 16) return 48;  // midday
  if (hour >= 21 && hour <= 23) return 30;  // evening wind-down
  return 15;                                // late night / early morning
}

// Real live traffic congestion, per road segment, from TomTom's Traffic
// Flow API — the actual current-speed-vs-free-flow-speed ratio for the
// exact coordinates. Returns null (not a fake number) if there's no key,
// the quota is exhausted, or the request fails for any reason — callers
// fall back to the time-of-day pattern in that case.
async function fetchTrafficFlow(lat, lng) {
  const key = window.CIVIC_TWIN_CONFIG?.tomtomApiKey;
  if (!key) return null;
  try {
    const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lng}&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const seg = data.flowSegmentData;
    if (!seg || !seg.freeFlowSpeed) return null;
    return clamp(Math.round((1 - seg.currentSpeed / seg.freeFlowSpeed) * 100), 0, 100);
  } catch (e) {
    console.warn('[sync] TomTom fetch failed, falling back to time-of-day pattern:', e.message);
    return null;
  }
}

async function recentReportCount(category, hours) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { count } = await supabase
    .from('reports').select('id', { count: 'exact' }).eq('category', category).gte('created_at', since).limit(1);
  return count || 0;
}

async function recentInsightExists(category, hours) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { count } = await supabase
    .from('insights').select('id', { count: 'exact' }).eq('category', category).gte('created_at', since).limit(1);
  return (count || 0) > 0;
}

async function unresolvedAlertExists(message) {
  const { count } = await supabase
    .from('alerts').select('id', { count: 'exact' }).eq('message', message).eq('resolved', false).limit(1);
  return (count || 0) > 0;
}

async function openActionExists(title) {
  const { count } = await supabase
    .from('actions').select('id', { count: 'exact' }).eq('title', title).eq('dismissed', false).limit(1);
  return (count || 0) > 0;
}

// ---------- Energy Optimization: real solar irradiance + temperature ----------

function computeEnergyReadout(weather) {
  const solarPct = clamp(Math.round((weather.solarRadiation / 900) * 100), 0, 100);
  const coolingDemandPct = clamp(Math.round((weather.temperature - 20) * 7), 0, 100);
  const gridStressPct = clamp(Math.round(coolingDemandPct * 0.7 - solarPct * 0.3 + 30), 0, 100);
  return { solarPct, coolingDemandPct, gridStressPct, solarRadiation: weather.solarRadiation, temperature: weather.temperature };
}

function renderEnergy(e) {
  el('energy-overall').textContent = `${e.solarPct}%`;
  el('energy-bars').innerHTML = [
    ['Solar generation potential', e.solarPct],
    ['Cooling demand', e.coolingDemandPct],
    ['Grid stress estimate', e.gridStressPct],
  ].map(([label, pct]) => `
    <div class="health-row">
      <span>${label}</span>
      <div class="bar"><i class="${pct >= 70 ? 'red-bar' : pct >= 45 ? 'yellow-bar' : ''}" style="width:${pct}%"></i></div>
      <b>${pct}%</b>
    </div>
  `).join('');
  const note = e.solarPct >= 55
    ? `Real irradiance is ${Math.round(e.solarRadiation)} W/m² right now — good window to shift non-critical loads to solar.`
    : e.coolingDemandPct >= 60
      ? `Real temperature is ${e.temperature.toFixed(1)}°C — expect elevated cooling demand across the grid.`
      : `Real irradiance ${Math.round(e.solarRadiation)} W/m², temperature ${e.temperature.toFixed(1)}°C — no action needed right now.`;
  el('energy-note').textContent = note;
}

// ---------- Water Leak Detection: real anomaly-detection algorithm ----------
// There is no free public water-pipe sensor feed for any city — this is
// the honest gap documented in the plan. What's real here is the
// detection algorithm itself (rolling z-score anomaly scoring); the flow
// readings it runs on are a clearly-labeled simulated sensor network
// standing in for what a real city deployment would provide.

const LEAK_ZONES = [
  { id: 'z1', label: 'Banjara Hills main', baseline: 42 },
  { id: 'z2', label: 'Secunderabad trunk line', baseline: 58 },
  { id: 'z3', label: 'Ward 18 distribution', baseline: 35 },
];

function computeLeakDetection() {
  if (!state.leakHistory) state.leakHistory = {};
  return LEAK_ZONES.map((zone) => {
    if (!state.leakHistory[zone.id]) state.leakHistory[zone.id] = [];
    const hist = state.leakHistory[zone.id];
    const isInjectedAnomaly = Math.random() < 0.12;
    const noise = (Math.random() * 2 - 1) * zone.baseline * 0.06;
    const reading = isInjectedAnomaly ? zone.baseline * (1.4 + Math.random() * 0.5) : zone.baseline + noise;

    const priorHist = hist.slice();
    let flagged = false;
    let zScore = 0;
    if (priorHist.length >= 4) {
      const mean = priorHist.reduce((a, b) => a + b, 0) / priorHist.length;
      const variance = priorHist.reduce((a, b) => a + (b - mean) ** 2, 0) / priorHist.length;
      const stddev = Math.sqrt(variance) || 1;
      zScore = (reading - mean) / stddev;
      flagged = zScore > 2.2;
    }

    hist.push(reading);
    if (hist.length > 20) hist.shift();

    return { ...zone, reading, zScore, flagged };
  });
}

function renderLeakDetection(zones) {
  const flaggedCount = zones.filter((z) => z.flagged).length;
  const overallEl = el('leak-overall');
  overallEl.textContent = flaggedCount > 0 ? `${flaggedCount} ALERT` : 'NORMAL';
  overallEl.className = 'score ' + (flaggedCount > 0 ? 'danger' : 'success');

  el('leak-bars').innerHTML = zones.map((z) => {
    const pct = clamp(Math.round((z.reading / (z.baseline * 1.8)) * 100), 3, 100);
    return `
    <div class="health-row">
      <span>${escapeHtml(z.label)}</span>
      <div class="bar"><i class="${z.flagged ? 'red-bar' : ''}" style="width:${pct}%"></i></div>
      <b>${z.reading.toFixed(1)} L/s</b>
    </div>
  `;
  }).join('');

  const anomalous = zones.find((z) => z.flagged);
  el('leak-note').textContent = anomalous
    ? `Anomaly flagged at ${anomalous.label}: flow is ${anomalous.zScore.toFixed(1)}σ above its rolling baseline — consistent with a leak signature.`
    : 'All zones within normal rolling-baseline range. Detector: z-score > 2.2σ over a 20-reading window.';
}

// ---------- Smart Parking: real predictive occupancy model ----------
// No free public parking-occupancy API exists for Hyderabad, so this
// predicts occupancy from real signals — local time-of-day and the real
// live traffic reading — the same fallback technique real smart-parking
// systems use where sensor coverage is sparse.

const PARKING_ZONES = [
  { id: 'p1', label: 'Banjara Hills Commercial' },
  { id: 'p2', label: 'Begumpet Business District' },
  { id: 'p3', label: 'Secunderabad Station Area' },
];

function parkingBaselineForHour(hour) {
  if (hour >= 10 && hour <= 13) return 75;
  if (hour >= 17 && hour <= 21) return 88;
  if (hour >= 14 && hour <= 16) return 55;
  if (hour >= 22 || hour <= 6) return 20;
  return 45;
}

function computeParkingReadout(weather, trafficPct) {
  const base = parkingBaselineForHour(weather.localHour);
  return PARKING_ZONES.map((z, i) => {
    const spread = (i - 1) * 6;
    const occupancy = clamp(Math.round(base + spread + (trafficPct - 50) * 0.15), 5, 98);
    return { ...z, occupancy };
  });
}

function renderParking(zones) {
  const avg = Math.round(zones.reduce((a, z) => a + z.occupancy, 0) / zones.length);
  el('parking-overall').textContent = `${avg}%`;
  el('parking-bars').innerHTML = zones.map((z) => `
    <div class="health-row">
      <span>${escapeHtml(z.label)}</span>
      <div class="bar"><i class="${z.occupancy >= 80 ? 'red-bar' : z.occupancy >= 55 ? 'yellow-bar' : ''}" style="width:${z.occupancy}%"></i></div>
      <b>${z.occupancy}%</b>
    </div>
  `).join('');
  const fullest = zones.reduce((a, b) => (b.occupancy > a.occupancy ? b : a));
  el('parking-note').textContent = fullest.occupancy >= 80
    ? `${fullest.label} is near capacity (${fullest.occupancy}%) — model driven by real time-of-day pattern + live traffic reading.`
    : 'Predicted from real local time-of-day and the live traffic reading — not a sensor feed.';
}

async function syncRealData() {
  const trafficHotspotIds = Object.entries(HOTSPOT_COORDS).filter(([, m]) => m.type === 'traffic').map(([id]) => id);
  const [{ data: statsRows }, weather, air, trafficReports, wasteReports, ...tomtomReadings] = await Promise.all([
    supabase.from('stats').select('key, value'),
    fetchWeather(CITY_CENTER.lat, CITY_CENTER.lng),
    fetchAirQuality(CITY_CENTER.lat, CITY_CENTER.lng),
    recentReportCount('Traffic', 24),
    recentReportCount('Waste', 24),
    ...trafficHotspotIds.map((id) => fetchTrafficFlow(HOTSPOT_COORDS[id].lat, HOTSPOT_COORDS[id].lng)),
  ]);
  const stats = Object.fromEntries((statsRows || []).map((r) => [r.key, r.value]));
  if (!stats.traffic) return;

  const tomtomByHotspot = Object.fromEntries(trafficHotspotIds.map((id, i) => [id, tomtomReadings[i]]));
  const liveReadings = Object.values(tomtomByHotspot).filter((v) => v !== null);
  const heuristicPct = clamp(trafficBaselineForHour(weather.localHour) + Math.min(trafficReports * 3, 20), 5, 98);
  const trafficPct = liveReadings.length
    ? clamp(Math.round(liveReadings.reduce((a, b) => a + b, 0) / liveReadings.length), 0, 100)
    : heuristicPct;

  const waterHealth = clamp(100 - weather.rainMm * 8 - weather.rainProbPct * 0.15, 55, 100);
  const environmentScore = clamp(Math.round(100 - air.aqi * 0.5), 0, 100);
  const wasteManagement = clamp(Math.round(100 - wasteReports * 12), 20, 100);

  const updates = [
    ['traffic', trafficPct],
    ['water_health', waterHealth],
    ['waste_management', wasteManagement],
  ];
  await Promise.all(updates.map(([key, next]) =>
    supabase.from('stats').update({ value: next, delta: +(next - stats[key]).toFixed(1) }).eq('key', key)
  ));
  await supabase.from('stat_history').insert([
    ...updates.filter(([key]) => key !== 'water_health').map(([key, value]) => ({ key, value })),
    { key: 'reports_unresolved', value: stats.reports_unresolved },
  ]);

  const hotspotUpdates = Object.entries(HOTSPOT_COORDS).map(([id, meta]) => {
    if (meta.type === 'traffic') {
      const live = tomtomByHotspot[id];
      const pct = live !== null && live !== undefined ? live : heuristicPct;
      const source = live !== null && live !== undefined ? 'TomTom live traffic' : `time-of-day pattern + ${trafficReports} recent report${trafficReports === 1 ? '' : 's'}`;
      return { id, intensity: pct / 100, detail: `${Math.round(pct)}% congestion (${source})` };
    }
    if (meta.type === 'water') {
      return { id, intensity: clamp(weather.rainProbPct / 100, 0.05, 1), detail: `${Math.round(weather.rainProbPct)}% real rain probability this hour` };
    }
    return { id, intensity: clamp(0.1 + wasteReports * 0.15, 0.1, 1), detail: `${wasteReports} real waste report${wasteReports === 1 ? '' : 's'} in the last 24h` };
  });
  await Promise.all(hotspotUpdates.map((h) => supabase.from('hotspots').update({ intensity: h.intensity, detail: h.detail }).eq('id', h.id)));

  // Real-threshold-triggered insights/alerts — only when the real number
  // actually crosses a line, and only once per few hours per category, so a
  // 5-minute sync loop doesn't spam duplicates.
  if (weather.rainProbPct >= 60 && !(await recentInsightExists('water', 3))) {
    await supabase.from('insights').insert({
      icon: 'water', category: 'water', title: 'Real rain probability elevated',
      body: `Open-Meteo puts this hour's rain probability at ${Math.round(weather.rainProbPct)}% near the city's flood-risk zones.`,
    });
  }
  if (trafficPct >= 75 && !(await recentInsightExists('traffic', 3))) {
    await supabase.from('insights').insert({
      icon: 'traffic', category: 'traffic', title: 'Traffic pattern crossing rush-hour levels',
      body: `Estimated congestion is at ${Math.round(trafficPct)}% right now (time-of-day pattern${trafficReports ? ` + ${trafficReports} real citizen reports` : ''}).`,
    });
  }
  if (wasteReports >= 3 && !(await recentInsightExists('waste', 3))) {
    await supabase.from('insights').insert({
      icon: 'waste', category: 'waste', title: 'Real waste-report volume climbing',
      body: `${wasteReports} citizens have filed waste reports in the last 24 hours.`,
    });
  }

  if (weather.rainProbPct >= 80) {
    const msg = 'High real rain probability — flood risk elevated';
    if (!(await unresolvedAlertExists(msg))) await supabase.from('alerts').insert({ severity: 'high', message: msg });
  }
  if (trafficPct >= 85) {
    const msg = 'Real-time congestion estimate above 85%';
    if (!(await unresolvedAlertExists(msg))) await supabase.from('alerts').insert({ severity: 'high', message: msg });
  }
  if (air.aqi >= 100) {
    const msg = `Air quality index at ${Math.round(air.aqi)} (real reading) — unhealthy for sensitive groups`;
    if (!(await unresolvedAlertExists(msg))) await supabase.from('alerts').insert({ severity: 'medium', message: msg });
  }

  // Recommended Actions, also real-condition-triggered rather than random,
  // so the panel doesn't sit permanently empty once someone dismisses the
  // seed rows — capped so repeated syncs can't spiral.
  const { count: openActionCount } = await supabase.from('actions').select('id', { count: 'exact' }).eq('dismissed', false).limit(1);
  if ((openActionCount || 0) < 6) {
    if (trafficPct >= 75) {
      const title = 'Deploy traffic management team';
      if (!(await openActionExists(title))) {
        await supabase.from('actions').insert({ priority: 'high', title, detail: `Estimated congestion is at ${Math.round(trafficPct)}% right now.` });
      }
    }
    if (weather.rainProbPct >= 60) {
      const title = 'Inspect drainage in flood-risk zones';
      if (!(await openActionExists(title))) {
        await supabase.from('actions').insert({ priority: 'medium', title, detail: `Real rain probability is ${Math.round(weather.rainProbPct)}% this hour.` });
      }
    }
    if (wasteReports >= 3) {
      const title = 'Dispatch waste collection crew to Ward 18';
      if (!(await openActionExists(title))) {
        await supabase.from('actions').insert({ priority: 'medium', title, detail: `${wasteReports} real waste reports filed in the last 24h.` });
      }
    }
    if (air.aqi >= 100) {
      const title = 'Issue an air quality advisory';
      if (!(await openActionExists(title))) {
        await supabase.from('actions').insert({ priority: 'low', title, detail: `Air quality index reading: ${Math.round(air.aqi)}.` });
      }
    }
  }

  // These three pillars are computed and rendered client-side only (not
  // persisted to Supabase) — see each section's comment above for what's
  // real data versus a documented algorithmic placeholder.
  renderEnergy(computeEnergyReadout(weather));
  renderLeakDetection(computeLeakDetection());
  renderParking(computeParkingReadout(weather, trafficPct));
}

async function runSync(isManual) {
  const btn = el('simulate-btn');
  const label = el('simulate-btn-label');
  if (isManual) { btn.disabled = true; label.textContent = 'Syncing…'; }
  try {
    await syncRealData();
    if (isManual) showToast('Synced real weather, air quality, and report data');
  } catch (e) {
    console.error('[sync] failed:', e);
    if (isManual) showToast('Sync failed — check your connection');
  } finally {
    if (isManual) { btn.disabled = false; label.textContent = 'Sync now'; }
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
  const [statsRes, hotspotsRes, insightsRes, actionsRes, alertsRes, historyRes, openReportsRes] = await Promise.all([
    supabase.from('stats').select('key, value, delta'),
    supabase.from('hotspots').select('*'),
    supabase.from('insights').select('*').order('created_at', { ascending: false }).limit(3),
    supabase.from('actions').select('*').eq('dismissed', false).order('created_at', { ascending: false }),
    supabase.from('alerts').select('*').eq('resolved', false).order('created_at', { ascending: false }),
    supabase.from('stat_history').select('key, value, recorded_at').in('key', HISTORY_KEYS).gte('recorded_at', since).order('recorded_at', { ascending: true }),
    supabase.from('reports').select('id', { count: 'exact' }).eq('status', 'open').limit(1),
  ]);

  const firstError = [statsRes, hotspotsRes, insightsRes, actionsRes, alertsRes, historyRes, openReportsRes].find((r) => r.error);
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
    actions: actionsRes.data,
    alerts: alertsRes.data,
    history,
    openReportsCount: openReportsRes.count || 0,
  };

  state.latestSummary = summary;
  renderStats(summary.stats);
  renderInsights(summary.insights);
  renderTrafficDetail(summary.stats.traffic.value, summary.hotspots);
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
  ['stats', 'hotspots', 'insights', 'actions', 'alerts', 'reports'].forEach((table) => {
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

  const askFromMiniChat = () => {
    const q = el('mini-ai-input').value.trim();
    if (!q) return;
    el('mini-ai-input').value = '';
    document.querySelector('.ai-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
    askAI(q);
  };
  el('mini-ai-ask-btn').addEventListener('click', askFromMiniChat);
  el('mini-ai-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') askFromMiniChat(); });

  el('cmd-search').addEventListener('click', () => {
    document.querySelector('.ai-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
    el('ai-input').focus();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      el('cmd-search').click();
    }
  });

  el('bell-btn').addEventListener('click', openAlertsModal);

  document.querySelectorAll('.map-controls button[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => applyFilter(btn.dataset.filter));
  });

  el('pin-report-btn').addEventListener('click', () => setPinMode(!state.pinMode));

  el('generate-insight-btn').addEventListener('click', async () => {
    const btn = el('generate-insight-btn');
    const label = el('generate-btn-label');
    btn.disabled = true;
    label.textContent = 'Thinking…';
    try {
      await generateInsight();
      showToast('New AI insight generated');
      loadSummary();
    } catch (e) {
      showToast('Could not generate an insight — try again');
    } finally {
      btn.disabled = false;
      label.textContent = 'Generate';
    }
  });

  el('simulate-btn').addEventListener('click', () => runSync(true));

  el('alerts-close').addEventListener('click', closeAlertsModal);
  el('alerts-modal').addEventListener('click', (e) => {
    if (e.target.id === 'alerts-modal') closeAlertsModal();
  });

  el('open-manage-reports').addEventListener('click', openManageReportsModal);
  el('manage-reports-close').addEventListener('click', closeManageReportsModal);
  el('manage-reports-modal').addEventListener('click', (e) => {
    if (e.target.id === 'manage-reports-modal') closeManageReportsModal();
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
      if (target === 'infrastructure') {
        document.querySelector('.pillars-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast('Energy, Water Leak Detection, and Smart Parking — below');
        return;
      }
      if (target === 'analytics') {
        document.querySelector('.insights-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast('Trends and AI Insights — here');
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
const REAL_DATA_SYNC_INTERVAL_MS = 5 * 60 * 1000; // weather/AQI don't meaningfully change faster than this

(async function init() {
  initDate();
  initMap();
  wireEvents();
  await loadSummary();
  connectRealtime();
  runSync(false); // pull real conditions immediately on load, no toast
  setInterval(() => runSync(false), REAL_DATA_SYNC_INTERVAL_MS);
})();
