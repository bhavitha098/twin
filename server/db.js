const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'data', 'civic.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS stats (
  key TEXT PRIMARY KEY,
  value REAL NOT NULL,
  delta REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hotspots (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  detail TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  intensity REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  icon TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS health_scores (
  category TEXT PRIMARY KEY,
  score INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  priority TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
`);

function seedIfEmpty() {
  const statsCount = db.prepare('SELECT COUNT(*) AS c FROM stats').get().c;
  if (statsCount > 0) return;

  const insertStat = db.prepare('INSERT INTO stats (key, value, delta) VALUES (?, ?, ?)');
  const seedStats = db.transaction(() => {
    insertStat.run('traffic', 72, 12);
    insertStat.run('reports_total', 1284, 0);
    insertStat.run('reports_unresolved', 184, 0);
    insertStat.run('water_health', 94.2, 2.4);
    insertStat.run('city_health', 87, 0);
  });
  seedStats();

  const insertHotspot = db.prepare(`
    INSERT INTO hotspots (id, type, label, detail, lat, lng, intensity)
    VALUES (@id, @type, @label, @detail, @lat, @lng, @intensity)
  `);
  const seedHotspots = db.transaction((rows) => {
    rows.forEach((r) => insertHotspot.run(r));
  });
  seedHotspots([
    { id: 'hs-1', type: 'traffic', label: 'NH-65 Traffic Hotspot', detail: '72% congestion', lat: 17.4483, lng: 78.3915, intensity: 0.9 },
    { id: 'hs-2', type: 'water', label: 'Flood Risk Zone', detail: 'High probability', lat: 17.4239, lng: 78.4738, intensity: 0.7 },
    { id: 'hs-3', type: 'waste', label: 'Ward 18 Complaints', detail: '42% more complaints', lat: 17.3850, lng: 78.4867, intensity: 0.6 },
    { id: 'hs-4', type: 'traffic', label: 'Begumpet Junction', detail: 'Moderate congestion', lat: 17.4399, lng: 78.4482, intensity: 0.5 },
    { id: 'hs-5', type: 'water', label: 'Hussain Sagar Overflow Watch', detail: 'Monitoring', lat: 17.4239, lng: 78.4738, intensity: 0.4 },
  ]);

  const insertInsight = db.prepare(`
    INSERT INTO insights (icon, category, title, body, created_at) VALUES (?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  const seedInsights = db.transaction(() => {
    insertInsight.run('🚦', 'traffic', 'Traffic anomaly detected', 'Congestion near NH-65 is 31% higher than the normal evening average.', now - 12 * 60000);
    insertInsight.run('🌧️', 'water', 'Flood risk increasing', 'Heavy rainfall may cause flooding in 3 low-lying zones.', now - 28 * 60000);
    insertInsight.run('🗑️', 'waste', 'Waste collection issue', 'Ward 18 has received 42% more complaints this week.', now - 60 * 60000);
  });
  seedInsights();

  const insertHealth = db.prepare('INSERT INTO health_scores (category, score) VALUES (?, ?)');
  const seedHealth = db.transaction(() => {
    insertHealth.run('Infrastructure', 92);
    insertHealth.run('Environment', 84);
    insertHealth.run('Public Safety', 91);
    insertHealth.run('Transport', 68);
  });
  seedHealth();

  const insertAction = db.prepare(`
    INSERT INTO actions (priority, title, detail, created_at) VALUES (?, ?, ?, ?)
  `);
  const seedActions = db.transaction(() => {
    insertAction.run('high', 'Deploy traffic management team', 'NH-65 congestion is rapidly increasing.', now);
    insertAction.run('medium', 'Inspect Ward 18 drainage', 'Flood probability exceeds 70%.', now);
    insertAction.run('low', 'Review waste collection route', 'Complaints increased this week.', now);
  });
  seedActions();

  const insertAlert = db.prepare('INSERT INTO alerts (severity, message, created_at) VALUES (?, ?, ?)');
  const seedAlerts = db.transaction(() => {
    insertAlert.run('high', 'NH-65 congestion critical', now);
    insertAlert.run('medium', 'Flood risk rising in 3 zones', now);
    insertAlert.run('medium', 'Ward 18 waste complaints spiking', now);
    insertAlert.run('low', 'Water health check due', now);
  });
  seedAlerts();
}

seedIfEmpty();

module.exports = db;
