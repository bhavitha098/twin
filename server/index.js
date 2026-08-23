const path = require('path');
const express = require('express');
const cors = require('cors');
const apiRouter = require('./routes/api');
const simulator = require('./simulator');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

const sseClients = new Set();

app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

function summaryPayload() {
  const rows = db.prepare('SELECT key, value, delta FROM stats').all();
  const stats = {};
  rows.forEach((r) => { stats[r.key] = { value: r.value, delta: r.delta }; });
  return {
    stats,
    hotspots: db.prepare('SELECT * FROM hotspots').all(),
    insights: db.prepare('SELECT * FROM insights ORDER BY created_at DESC LIMIT 3').all(),
    health: {
      overall: Math.round(stats.city_health.value),
      breakdown: db.prepare('SELECT * FROM health_scores').all(),
    },
    actions: db.prepare('SELECT * FROM actions WHERE dismissed = 0 ORDER BY created_at DESC').all(),
    alerts: db.prepare('SELECT * FROM alerts WHERE resolved = 0 ORDER BY created_at DESC').all(),
  };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(summaryPayload())}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

simulator.start({ broadcast });

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Civic Twin AI backend running on http://localhost:${PORT}`);
});
