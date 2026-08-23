const db = require('./db');

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function randomWalk(value, step, min, max) {
  const next = value + (Math.random() * 2 - 1) * step;
  return clamp(next, min, max);
}

const getStat = db.prepare('SELECT value FROM stats WHERE key = ?');
const setStat = db.prepare('UPDATE stats SET value = ?, delta = ? WHERE key = ?');
const getHotspots = db.prepare('SELECT * FROM hotspots');
const setHotspotIntensity = db.prepare('UPDATE hotspots SET intensity = ? WHERE id = ?');
const insertInsight = db.prepare(`
  INSERT INTO insights (icon, category, title, body, created_at) VALUES (?, ?, ?, ?, ?)
`);
const insertAlert = db.prepare('INSERT INTO alerts (severity, message, created_at) VALUES (?, ?, ?)');
const getUnresolvedReports = db.prepare("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'");

const INSIGHT_TEMPLATES = [
  { icon: '🚦', category: 'traffic', title: 'Traffic pattern shift', body: 'Congestion near NH-65 moved {pct}% versus the last hour average.' },
  { icon: '🌧️', category: 'water', title: 'Rainfall update', body: 'Flood risk model updated for low-lying zones, current confidence {pct}%.' },
  { icon: '🗑️', category: 'waste', title: 'Collection route update', body: 'Ward 18 complaint volume changed by {pct}% in the last cycle.' },
];

function tick() {
  const traffic = getStat.get('traffic').value;
  const nextTraffic = randomWalk(traffic, 3, 20, 98);
  setStat.run(nextTraffic, +(nextTraffic - traffic).toFixed(1), 'traffic');

  const water = getStat.get('water_health').value;
  const nextWater = randomWalk(water, 0.6, 70, 99.9);
  setStat.run(nextWater, +(nextWater - water).toFixed(1), 'water_health');

  const cityHealth = getStat.get('city_health').value;
  const nextCityHealth = clamp(randomWalk(cityHealth, 1, 55, 99), 0, 100);
  setStat.run(nextCityHealth, +(nextCityHealth - cityHealth).toFixed(1), 'city_health');

  const unresolved = getStat.get('reports_unresolved').value;
  const nextUnresolved = Math.round(randomWalk(unresolved, 4, 30, 400));
  setStat.run(nextUnresolved, nextUnresolved - unresolved, 'reports_unresolved');

  if (Math.random() < 0.3) {
    const total = getStat.get('reports_total').value;
    setStat.run(total + Math.round(Math.random() * 5), Math.round(Math.random() * 5), 'reports_total');
  }

  for (const hs of getHotspots.all()) {
    const next = randomWalk(hs.intensity, 0.08, 0.1, 1);
    setHotspotIntensity.run(next, hs.id);
  }

  if (Math.random() < 0.12) {
    const t = INSIGHT_TEMPLATES[Math.floor(Math.random() * INSIGHT_TEMPLATES.length)];
    const pct = Math.floor(Math.random() * 40) + 5;
    insertInsight.run(t.icon, t.category, t.title, t.body.replace('{pct}', pct), Date.now());
  }

  if (Math.random() < 0.05) {
    const severities = ['high', 'medium', 'low'];
    const messages = [
      'New congestion spike detected on ring road',
      'Sensor reports rising water levels',
      'Spike in citizen complaints in a ward',
      'Air quality index degraded in industrial zone',
    ];
    insertAlert.run(
      severities[Math.floor(Math.random() * severities.length)],
      messages[Math.floor(Math.random() * messages.length)],
      Date.now()
    );
  }
}

function start(io) {
  setInterval(() => {
    tick();
    if (io) io.broadcast();
  }, 4000);
}

module.exports = { start, tick };
