const express = require('express');
const db = require('../db');
const ai = require('./ai');

const router = express.Router();

function statsPayload() {
  const rows = db.prepare('SELECT key, value, delta FROM stats').all();
  const map = {};
  rows.forEach((r) => { map[r.key] = { value: r.value, delta: r.delta }; });
  return map;
}

router.get('/stats', (req, res) => {
  res.json(statsPayload());
});

router.get('/hotspots', (req, res) => {
  res.json(db.prepare('SELECT * FROM hotspots').all());
});

router.get('/insights', (req, res) => {
  const limit = Number(req.query.limit) || 3;
  res.json(db.prepare('SELECT * FROM insights ORDER BY created_at DESC LIMIT ?').all(limit));
});

router.get('/health', (req, res) => {
  const overall = db.prepare("SELECT value FROM stats WHERE key = 'city_health'").get();
  const breakdown = db.prepare('SELECT * FROM health_scores').all();
  res.json({ overall: Math.round(overall.value), breakdown });
});

router.get('/actions', (req, res) => {
  res.json(db.prepare('SELECT * FROM actions WHERE dismissed = 0 ORDER BY created_at DESC').all());
});

router.post('/actions/:id/dismiss', (req, res) => {
  const result = db.prepare('UPDATE actions SET dismissed = 1 WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Action not found' });
  res.json({ ok: true });
});

router.get('/alerts', (req, res) => {
  res.json(db.prepare('SELECT * FROM alerts WHERE resolved = 0 ORDER BY created_at DESC').all());
});

router.get('/reports', (req, res) => {
  res.json(db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all());
});

router.post('/reports', (req, res) => {
  const { category, description, location } = req.body || {};
  if (!category || !description || !location) {
    return res.status(400).json({ error: 'category, description and location are required' });
  }
  const info = db.prepare(`
    INSERT INTO reports (category, description, location, created_at) VALUES (?, ?, ?, ?)
  `).run(String(category).slice(0, 60), String(description).slice(0, 500), String(location).slice(0, 120), Date.now());

  db.prepare("UPDATE stats SET value = value + 1 WHERE key = 'reports_total'").run();
  db.prepare("UPDATE stats SET value = value + 1 WHERE key = 'reports_unresolved'").run();

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(report);
});

router.post('/ai/ask', (req, res) => {
  const { question } = req.body || {};
  const answer = ai.answer(question);
  res.json({ question: question || '', answer });
});

router.get('/summary', (req, res) => {
  res.json({
    stats: statsPayload(),
    hotspots: db.prepare('SELECT * FROM hotspots').all(),
    insights: db.prepare('SELECT * FROM insights ORDER BY created_at DESC LIMIT 3').all(),
    health: {
      overall: Math.round(db.prepare("SELECT value FROM stats WHERE key = 'city_health'").get().value),
      breakdown: db.prepare('SELECT * FROM health_scores').all(),
    },
    actions: db.prepare('SELECT * FROM actions WHERE dismissed = 0 ORDER BY created_at DESC').all(),
    alerts: db.prepare('SELECT * FROM alerts WHERE resolved = 0 ORDER BY created_at DESC').all(),
  });
});

module.exports = router;
