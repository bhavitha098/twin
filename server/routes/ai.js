const db = require('../db');

const getStat = db.prepare('SELECT value, delta FROM stats WHERE key = ?');
const topHotspotByType = db.prepare('SELECT * FROM hotspots WHERE type = ? ORDER BY intensity DESC LIMIT 1');
const latestInsightByCategory = db.prepare('SELECT * FROM insights WHERE category = ? ORDER BY created_at DESC LIMIT 1');
const countOpenReports = db.prepare("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'");

const RULES = [
  {
    match: /traffic|congestion|nh-?65|road/i,
    respond() {
      const traffic = getStat.get('traffic');
      const hs = topHotspotByType.get('traffic');
      return `Traffic congestion is currently at ${traffic.value.toFixed(0)}% (${traffic.delta >= 0 ? '+' : ''}${traffic.delta.toFixed(1)}% vs last reading). ` +
        (hs ? `The worst hotspot is ${hs.label} — ${hs.detail}.` : 'No major hotspots reported right now.');
    },
  },
  {
    match: /flood|water|rain|drainage/i,
    respond() {
      const water = getStat.get('water_health');
      const hs = topHotspotByType.get('water');
      return `Water network health is at ${water.value.toFixed(1)}%. ` +
        (hs ? `Highest flood-risk zone: ${hs.label} — ${hs.detail}.` : 'No active flood risk zones detected.');
    },
  },
  {
    match: /garbage|waste|trash|complaint/i,
    respond() {
      const hs = topHotspotByType.get('waste');
      const insight = latestInsightByCategory.get('waste');
      return (hs ? `Highest waste-complaint area: ${hs.label} — ${hs.detail}. ` : '') +
        (insight ? insight.body : 'No recent waste collection issues reported.');
    },
  },
  {
    match: /emergency|hotspot|urgent|critical/i,
    respond() {
      const all = db.prepare('SELECT * FROM hotspots ORDER BY intensity DESC LIMIT 3').all();
      if (!all.length) return 'No active emergency hotspots right now.';
      return 'Top active hotspots right now: ' + all.map((h) => `${h.label} (${Math.round(h.intensity * 100)}% intensity)`).join(', ') + '.';
    },
  },
  {
    match: /health|score|overall/i,
    respond() {
      const city = getStat.get('city_health');
      const cats = db.prepare('SELECT * FROM health_scores').all();
      return `Overall city health score is ${Math.round(city.value)}/100. Breakdown: ` +
        cats.map((c) => `${c.category} ${c.score}`).join(', ') + '.';
    },
  },
  {
    match: /report/i,
    respond() {
      const open = countOpenReports.get().c;
      const unresolved = getStat.get('reports_unresolved');
      return `There are currently ${open} citizen reports open in the system, and ${Math.round(unresolved.value)} unresolved issues city-wide.`;
    },
  },
];

function answer(question) {
  const q = (question || '').trim();
  if (!q) {
    return "Ask me about traffic, flood risk, garbage complaints, emergency hotspots, or overall city health.";
  }
  for (const rule of RULES) {
    if (rule.match.test(q)) {
      return rule.respond();
    }
  }
  const traffic = getStat.get('traffic');
  const city = getStat.get('city_health');
  return `I don't have a specific model for that yet, but here's a quick snapshot: traffic is at ${traffic.value.toFixed(0)}%, and overall city health is ${Math.round(city.value)}/100. Try asking about traffic, flooding, garbage, emergencies, or health score.`;
}

module.exports = { answer };
