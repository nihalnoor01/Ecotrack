const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { computeOptimizedRoute } = require('./routeOptimizer');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// DATABASE INITIALIZATION
// ============================================================
// Creates a database.sqlite file in the current folder
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[DB ERROR] Could not connect to database:', err.message);
  } else {
    console.log('[DB] Connected to SQLite database.');
  }
});

// Initialize table and populate default bins if empty
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS bins (
    id TEXT PRIMARY KEY,
    name TEXT,
    location TEXT,
    lat REAL,
    lng REAL,
    deviceId TEXT UNIQUE,
    fill INTEGER,
    status TEXT,
    isLive BOOLEAN,
    lastUpdated TEXT
  )`);

  // Check if table is empty
  db.get(`SELECT count(*) as count FROM bins`, (err, row) => {
    if (row && row.count === 0) {
      console.log('[DB] Populating default LPU bins...');
      const stmt = db.prepare(`INSERT INTO bins (id, name, location, lat, lng, deviceId, fill, status, isLive, lastUpdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      
      const defaultBins = [
        { id: "bin_1", name: "UniMall, LPU", location: "Lovely Professional University UniMall", lat: 31.2548, lng: 75.7015, deviceId: "ESP32-LIVE", fill: 0, status: "Empty", isLive: true },
        { id: "bin_2", name: "Block 30 – Admissions", location: "Block 30 Admissions, LPU, Phagwara", lat: 31.2562, lng: 75.7048, deviceId: "SIM-002", fill: 68, status: "Warning", isLive: false },
        { id: "bin_3", name: "Block 35", location: "Block 35, LPU, Phagwara", lat: 31.2545, lng: 75.7068, deviceId: "SIM-003", fill: 45, status: "Normal", isLive: false },
        { id: "bin_4", name: "LPU Open Audi", location: "LPU Open Audi Road, Punjab", lat: 31.2535, lng: 75.7002, deviceId: "SIM-004", fill: 88, status: "Critical", isLive: false },
        { id: "bin_5", name: "Khajurla Gate Area", location: "7P44+JRR, Khajurla, Punjab", lat: 31.2505, lng: 75.6998, deviceId: "SIM-005", fill: 22, status: "Normal", isLive: false },
        { id: "bin_6", name: "LPU South Zone", location: "7P44+855, Phagwara, Punjab", lat: 31.2518, lng: 75.7040, deviceId: "SIM-006", fill: 91, status: "Critical", isLive: false }
      ];

      defaultBins.forEach(b => {
        stmt.run(b.id, b.name, b.location, b.lat, b.lng, b.deviceId, b.fill, b.status, b.isLive ? 1 : 0, new Date().toISOString());
      });
      stmt.finalize();
      console.log('[DB] Default bins populated successfully.');
    }
  });
});

// Helper to determine status
function getStatus(fill) {
  if (fill >= 80) return "Critical";
  if (fill >= 60) return "Warning";
  if (fill > 0)  return "Normal";
  return "Empty";
}

// ============================================================
// API ROUTES
// ============================================================

// GET  /api/bins  → send all bin data to dashboard from DB
app.get('/api/bins', (req, res) => {
  db.all(`SELECT * FROM bins`, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    // Convert isLive back to boolean
    const bins = rows.map(r => ({ ...r, isLive: r.isLive === 1 }));
    res.json(bins);
  });
});

// POST /api/update  → ESP32 sends { deviceId, fill }
app.post('/api/update', (req, res) => {
  const { deviceId, fill } = req.body;

  if (!deviceId || fill === undefined) {
    return res.status(400).json({ error: "Missing deviceId or fill level" });
  }

  const safeFill = Math.min(100, Math.max(0, parseInt(fill)));
  const status = getStatus(safeFill);
  const now = new Date().toISOString();

  db.run(`UPDATE bins SET fill = ?, status = ?, lastUpdated = ? WHERE deviceId = ?`, 
    [safeFill, status, now, deviceId], 
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        console.warn(`[WARN] Unknown deviceId: "${deviceId}"`);
        return res.status(404).json({ error: "Device not registered." });
      }
      
      console.log(`[ESP32 UPDATE] ${deviceId} → ${safeFill}% — ${status}`);
      res.json({ success: true, message: "Database updated" });
  });
});

// POST /api/bins  → add a new bin from the UI
app.post('/api/bins', (req, res) => {
  const b = req.body;
  b.id = 'bin_' + Date.now(); // Generate unique ID
  b.fill = b.fill || 0;
  b.status = getStatus(b.fill);
  b.isLive = false;
  b.lastUpdated = new Date().toISOString();

  db.run(`INSERT INTO bins (id, name, location, lat, lng, deviceId, fill, status, isLive, lastUpdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.id, b.name, b.location, b.lat, b.lng, b.deviceId, b.fill, b.status, 0, b.lastUpdated],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      console.log(`[NEW BIN] Registered: ${b.name} to Database`);
      res.json({ success: true, bin: b });
  });
});

// POST /api/route → compute optimized route using ORS + Nearest Neighbor
app.post('/api/route', async (req, res) => {
  const threshold = req.body.threshold || 80;
  const depot = req.body.depot || null;    // { lat, lng } from truck position
  const bins = req.body.bins || null;      // Array of bins with current fill levels

  if (!bins || !Array.isArray(bins) || bins.length === 0) {
    return res.status(400).json({ error: 'No bin data provided' });
  }

  if (!depot || !depot.lat || !depot.lng) {
    return res.status(400).json({ error: 'No depot/truck position provided' });
  }

  try {
    const result = await computeOptimizedRoute(bins, threshold, depot);
    res.json(result);
  } catch (routeErr) {
    console.error('[ROUTE ERROR]', routeErr);
    res.status(500).json({ error: 'Route optimization failed: ' + routeErr.message });
  }
});

// Serve static files (index.html, app.js, style.css) from this folder
app.use(express.static(path.join(__dirname)));

// ============================================================
// SIMULATION ENGINE (Randomly fills simulated bins)
// ============================================================
setInterval(() => {
  db.all(`SELECT id, deviceId, fill FROM bins WHERE isLive = 0`, [], (err, rows) => {
    if (err || !rows) return;
    
    rows.forEach(bin => {
      // 70% chance to increase slightly (1-3%)
      if (Math.random() > 0.3) {
        const increase = Math.floor(Math.random() * 3) + 1;
        const newFill = Math.min(100, bin.fill + increase);
        const status = getStatus(newFill);
        const now = new Date().toISOString();

        db.run(`UPDATE bins SET fill = ?, status = ?, lastUpdated = ? WHERE id = ?`, 
          [newFill, status, now, bin.id]);
      }
    });
  });
}, 30000); // Update simulated bins every 30 seconds

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║      EcoTrack – Smart Waste Management System        ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Server Running on PORT: ${PORT}                      ║`);
  console.log(`║  Database   →  SQLite (database.sqlite)              ║`);
  console.log(`║  ESP32 API  →  POST /api/update                      ║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});
