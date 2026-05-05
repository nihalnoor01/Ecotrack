// ==========================================
// EcoTrack – LPU Campus Smart Waste System
// ==========================================

const API_URL = 'https://eco-track-smartbin-system.onrender.com/api';
let binsData = [];
let mainMap, miniMap;
let mainMarkers = {}, miniMarkers = {};
let routeLayer = null;

// REWARD SYSTEM STATE
let userPoints = parseInt(localStorage.getItem('ecoTrack_points')) || 0;
let rewardHistory = JSON.parse(localStorage.getItem('ecoTrack_history')) || [];
let lastKnownFills = {}; // deviceId -> fill

// LPU Campus centre
const LPU_CENTER = [31.2536, 75.7037];
const LPU_ZOOM   = 16;

// Campus landmarks (not bins – just labels on the map)
const LPU_LANDMARKS = [
  { name: "Main Gate",          lat: 31.2556, lng: 75.7065, icon: "🏛️" },
  { name: "UniMall",            lat: 31.2548, lng: 75.7015, icon: "🛍️" },
  { name: "Uni Hospital",       lat: 31.2530, lng: 75.7055, icon: "🏥" },
  { name: "Open Audi",          lat: 31.2535, lng: 75.7002, icon: "🎭" },
  { name: "Block 26",           lat: 31.2540, lng: 75.7028, icon: "🏫" },
  { name: "Block 28",           lat: 31.2543, lng: 75.7042, icon: "🏫" },
  { name: "Block 30",           lat: 31.2562, lng: 75.7048, icon: "🏫" },
  { name: "Block 32",           lat: 31.2558, lng: 75.7033, icon: "🏫" },
  { name: "Block 35",           lat: 31.2545, lng: 75.7068, icon: "🏫" },
  { name: "Block 14",           lat: 31.2522, lng: 75.7060, icon: "🏫" },
  { name: "LPU Library",        lat: 31.2538, lng: 75.7020, icon: "📚" },
  { name: "Boys Hostel",        lat: 31.2510, lng: 75.7015, icon: "🏠" },
  { name: "Girls Hostel",       lat: 31.2515, lng: 75.7055, icon: "🏠" },
  { name: "Sports Complex",     lat: 31.2528, lng: 75.7080, icon: "⚽" },
  { name: "Parking Area",       lat: 31.2560, lng: 75.7010, icon: "🅿️" }
];

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  updateClock();
  setInterval(updateClock, 1000);
  initMaps();
  initCharts();
  fetchBinsData();
  updateRewardsUI();
  setInterval(fetchBinsData, 5000); // Fetch live hardware data every 5s

  // Simulation for the other 5 bins (change every 30s)
  setInterval(() => {
    binsData.forEach((bin, index) => {
      if (index > 0) { // Don't simulate Bin 1 (the live ESP32 bin)
        bin.fill = Math.floor(Math.random() * 100);
        bin.status = bin.fill >= 80 ? "Critical" : bin.fill >= 60 ? "Warning" : "Normal";
        bin.lastUpdated = new Date().toISOString();
      }
    });
    updateUI();
  }, 30000);
});

// ==========================================
// NAVIGATION
// ==========================================
function showPage(pageId, element) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + pageId).classList.add('active');
  if (element) element.classList.add('active');
  const span = element ? element.querySelector('span') : null;
  document.getElementById('pageTitle').innerText = span ? span.innerText : pageId;
  if (pageId === 'map'       && mainMap) setTimeout(() => mainMap.invalidateSize(), 150);
  if (pageId === 'dashboard' && miniMap) setTimeout(() => miniMap.invalidateSize(), 150);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function updateClock() {
  document.getElementById('clock').innerText = new Date().toLocaleString('en-IN');
}

// ── AUTH & RBAC ──────────────────────────
function checkAuth() {
  const role = localStorage.getItem('ecoTrack_role');
  if (!role) {
    window.location.href = 'login.html';
    return;
  }
  applyRBAC(role);
}

function applyRBAC(role) {
  if (role === 'user') {
    // Resident role: only Dashboard and Rewards
    const toHide = ['nav-bins', 'nav-map', 'nav-analytics', 'nav-esp32'];
    toHide.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }
}

function logout() {
  localStorage.removeItem('ecoTrack_role');
  window.location.href = 'login.html';
}

// ── DEMO DATA (used when server is offline) ──────────
const DEMO_BINS = [
  { id:"bin_1", name:"UniMall, LPU",          location:"Lovely Professional University UniMall",    lat:31.2548, lng:75.7015, deviceId:"ESP32-LIVE", fill:0,  status:"Empty",  isLive:true  },
  { id:"bin_2", name:"Block 30 – Admissions", location:"Block 30 Admissions, LPU, Phagwara",        lat:31.2562, lng:75.7048, deviceId:"SIM-002",    fill:96,  status:"Critical", isLive:false },
  { id:"bin_3", name:"Block 35",              location:"Block 35, LPU, Phagwara",                    lat:31.2545, lng:75.7068, deviceId:"SIM-003",    fill:45,  status:"Normal",   isLive:false },
  { id:"bin_4", name:"LPU Open Audi",         location:"LPU Open Audi Road, Punjab",                 lat:31.2535, lng:75.7002, deviceId:"SIM-004",    fill:98,  status:"Critical", isLive:false },
  { id:"bin_5", name:"Khajurla Gate Area",    location:"7P44+JRR, Khajurla, Punjab",                 lat:31.2505, lng:75.6998, deviceId:"SIM-005",    fill:22,  status:"Normal",   isLive:false },
  { id:"bin_6", name:"LPU South Zone",        location:"7P44+855, Phagwara, Punjab",                 lat:31.2518, lng:75.7040, deviceId:"SIM-006",    fill:91,  status:"Critical", isLive:false }
];
let _demoMode = false;

// ==========================================
// DATA FETCHING
// ==========================================
async function fetchBinsData() {
  try {
    const res = await fetch(`${API_URL}/bins`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error('bad response');
    const data = await res.json();
    
    // Merge live data with existing data to preserve local simulation states of other bins
    // Merge live data with existing data to preserve local simulation states of other bins
    data.forEach(remoteBin => {
      const index = binsData.findIndex(b => b.deviceId === remoteBin.deviceId);
      if (index !== -1) {
        // Detect increase BEFORE updating for rewards
        const prevFill = lastKnownFills[remoteBin.deviceId];
        if (prevFill !== undefined && remoteBin.fill > prevFill) {
          handleWasteDisposed(binsData[index], remoteBin.fill - prevFill);
        }
        
        binsData[index].fill = remoteBin.fill;
        binsData[index].status = remoteBin.status;
        binsData[index].lastUpdated = remoteBin.lastUpdated;
      } else {
        binsData.push(remoteBin);
      }
      lastKnownFills[remoteBin.deviceId] = remoteBin.fill;
    });

    _demoMode = false;
    document.getElementById('connDot').style.background = 'var(--green)';
    document.getElementById('connStatus').innerText = '⚡ ESP32-LIVE Connected';
    updateUI();
  } catch (err) {
    console.warn('[FETCH ERROR]', err);
    // Server offline → use demo data only if we don't have data yet
    if (binsData.length === 0) {
      binsData = JSON.parse(JSON.stringify(DEMO_BINS)); // initial load
      _demoMode = true;
    }
    
    // Simulate small fill changes ONLY for non-live bins, preserve Bin 1's last value
    binsData.forEach(b => {
      if (!b.isLive) {
        const prevFill = b.fill;
        b.fill = Math.min(100, Math.max(0, b.fill + Math.floor(Math.random() * 3 - 1)));
        b.status = b.fill >= 80 ? 'Critical' : b.fill >= 60 ? 'Warning' : b.fill > 0 ? 'Normal' : 'Empty';
        
        // Detect increase in simulation too
        if (b.fill > prevFill) {
          handleWasteDisposed(b, b.fill - prevFill);
        }
      }
    });
    
    document.getElementById('connDot').style.background = 'var(--yellow)';
    document.getElementById('connStatus').innerText = '⚠ ESP32 Offline / CORS Issue';
  }
  updateUI();
}

function updateUI() {
  updateDashboardKPIs();
  renderBinCards();
  updateMaps();
  updateCharts();
  updateRewardsUI();
}

// ==========================================
// KPIs
// ==========================================
function updateDashboardKPIs() {
  const total    = binsData.length;
  const critical = binsData.filter(b => b.fill >= 80).length;
  const avg      = binsData.reduce((a, b) => a + b.fill, 0) / (total || 1);
  const pickups  = binsData.filter(b => b.fill >= 60).length;
  document.getElementById('kpiTotal').innerText    = total;
  document.getElementById('kpiCritical').innerText = critical;
  document.getElementById('kpiAvg').innerText      = Math.round(avg) + '%';
  document.getElementById('kpiRoute').innerText    = pickups;
  document.getElementById('donutPercent').innerText = Math.round(avg) + '%';
  document.getElementById('alertBadge').innerText  = critical;
  document.getElementById('notifCount').innerText  = critical;
  generateAlerts();
}

// ==========================================
// BIN CARDS
// ==========================================
function statusColor(fill) {
  if (fill >= 80) return 'var(--red)';
  if (fill >= 60) return 'var(--yellow)';
  return 'var(--green)';
}

function renderBinCards() {
  const grid       = document.getElementById('binCardsGrid');
  const detailGrid = document.getElementById('binDetailGrid');
  const tableBody  = document.getElementById('binTableBody');
  grid.innerHTML = detailGrid.innerHTML = '';
  if (tableBody) tableBody.innerHTML = '';

  binsData.forEach(bin => {
    const sc  = statusColor(bin.fill);
    const liveTag = bin.isLive
      ? `<span style="background:#00ff88;color:#000;font-size:9px;padding:2px 7px;border-radius:10px;font-weight:700;margin-left:6px;">⚡ LIVE</span>`
      : '';

    // Dashboard mini card
    grid.innerHTML += `
      <div class="bin-mini-card">
        <div class="bin-mini-header">
          <span class="bin-mini-name">${bin.name}${liveTag}</span>
          <span class="bin-mini-status status-${bin.status.toLowerCase()}">${bin.status}</span>
        </div>
        <div class="bin-fill-bar">
          <div class="bin-fill-inner" style="width:${bin.fill}%;background:${sc}"></div>
        </div>
        <div class="bin-mini-percent" style="color:${sc}">${bin.fill}%</div>
        <div class="bin-mini-loc">${bin.location || ''}</div>
      </div>`;

    // Bin Monitor detail card
    detailGrid.innerHTML += `
      <div class="bin-detail-card" style="border-color:${bin.isLive ? '#00ff88' : 'var(--border)'}">
        <div class="bin-detail-header">
          <span class="bin-detail-name">${bin.name}${liveTag}</span>
          <span class="bin-status-pill status-${bin.status.toLowerCase()}">${bin.status}</span>
        </div>
        <div class="bin-location"><i class="fas fa-map-marker-alt"></i> ${bin.location || bin.lat + ', ' + bin.lng}</div>
        <div class="bin-gauge">
          <div class="gauge-track">
            <div class="gauge-fill" style="width:${bin.fill}%;background:${sc}"></div>
          </div>
          <div class="gauge-labels"><span>0%</span><span>50%</span><span>100%</span></div>
        </div>
        <div class="bin-percent-big" style="color:${sc}">${bin.fill}%</div>
        <div class="bin-meta">
          <div class="bin-meta-item"><label>Device ID</label><span>${bin.deviceId}</span></div>
          <div class="bin-meta-item"><label>Type</label><span>${bin.isLive ? '⚡ ESP32 Live' : 'Simulated'}</span></div>
        </div>
      </div>`;

    // ESP32 config table
    if (tableBody) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${bin.id}</td>
        <td>${bin.name}</td>
        <td>${bin.location || '-'}</td>
        <td>${bin.deviceId}</td>
        <td style="color:${sc};font-weight:700">${bin.fill}%</td>
        <td><span class="bin-status-pill status-${bin.status.toLowerCase()}">${bin.status}</span></td>
        <td><button class="del-btn" onclick="deleteBin('${bin.id}')">Remove</button></td>`;
      tableBody.appendChild(tr);
    }
  });
}

async function deleteBin(id) {
  binsData = binsData.filter(b => b.id !== id);
  renderBinCards();
  updateDashboardKPIs();
}

// ==========================================
// MAPS – LPU CAMPUS
// ==========================================
function makeTileLayer() {
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap & Carto | LPU EcoTrack',
    maxZoom: 20
  });
}

function initMaps() {
  miniMap = L.map('miniMap', { zoomControl: false, dragging: false, scrollWheelZoom: false })
    .setView(LPU_CENTER, LPU_ZOOM - 1);
  makeTileLayer().addTo(miniMap);

  mainMap = L.map('mainMap').setView(LPU_CENTER, LPU_ZOOM);
  makeTileLayer().addTo(mainMap);

  // Add campus boundary rectangle
  const campusBounds = [[31.2495, 75.6985], [31.2570, 75.7090]];
  L.rectangle(campusBounds, {
    color: '#00ff88', weight: 2, fill: false, dashArray: '6 4', opacity: 0.5
  }).addTo(mainMap).bindPopup('<b>LPU Campus Boundary</b>');

  // Add landmark labels on main map
  LPU_LANDMARKS.forEach(lm => {
    const lmIcon = L.divIcon({
      html: `<div style="background:rgba(0,0,0,0.75);border:1px solid #00ff8860;color:#fff;font-size:11px;padding:3px 7px;border-radius:6px;white-space:nowrap;">${lm.icon} ${lm.name}</div>`,
      className: '', iconAnchor: [40, 14]
    });
    L.marker([lm.lat, lm.lng], { icon: lmIcon }).addTo(mainMap)
      .bindPopup(`<b>${lm.icon} ${lm.name}</b><br>LPU Campus`);
  });

  // Depot marker
  const depotIcon = L.divIcon({
    html: `<div style="background:#7c3aed;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;border:3px solid #fff;box-shadow:0 0 10px #7c3aed;">🏭</div>`,
    className: '', iconSize: [34, 34], iconAnchor: [17, 17]
  });
  L.marker(LPU_CENTER, { icon: depotIcon }).addTo(mainMap)
    .bindPopup('<b>🏭 LPU Waste Depot</b><br>Route start / end point');
}

function binMarkerHtml(bin) {
  const sc = bin.fill >= 80 ? '#ef4444' : bin.fill >= 60 ? '#f59e0b' : '#10b981';
  const ring = bin.isLive ? `box-shadow:0 0 0 3px #00ff88,0 0 14px #00ff88;` : '';
  return `<div style="background:${sc};width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;border:3px solid #fff;${ring}cursor:pointer;">🗑️</div>`;
}

function popupHtml(bin) {
  const sc  = bin.fill >= 80 ? '#ef4444' : bin.fill >= 60 ? '#f59e0b' : '#10b981';
  const live = bin.isLive ? `<span style="background:#00ff88;color:#000;padding:1px 8px;border-radius:8px;font-weight:700;font-size:11px;">⚡ LIVE ESP32</span>` : '';
  return `<div style="min-width:180px">
    <b style="font-size:14px">${bin.name}</b> ${live}<br>
    <small style="color:#94a3b8">${bin.location}</small><br>
    <div style="margin:8px 0;background:#222;border-radius:6px;overflow:hidden;height:10px">
      <div style="width:${bin.fill}%;background:${sc};height:100%"></div>
    </div>
    <b style="color:${sc};font-size:20px">${bin.fill}%</b>
    <span style="color:#94a3b8;margin-left:6px">${bin.status}</span>
  </div>`;
}

// 15 m in degrees (approx)
const MAX_DRAG_M = 15;
const DEG_PER_M  = 1 / 111320;

function metersBetween(a, b) { return haversine(a, b) * 1000; }

function updateMaps() {
  binsData.forEach(bin => {
    const icon = L.divIcon({ html: binMarkerHtml(bin), className: '', iconSize: [38, 38], iconAnchor: [19, 19] });

    if (mainMarkers[bin.id]) {
      mainMarkers[bin.id].setIcon(icon).setPopupContent(popupHtml(bin));
    } else {
      const origin = { lat: bin.lat, lng: bin.lng };
      const m = L.marker([bin.lat, bin.lng], { icon, draggable: true })
        .addTo(mainMap).bindPopup(popupHtml(bin));

      // Draw 15 m dashed radius circle
      const circle = L.circle([origin.lat, origin.lng], {
        radius: MAX_DRAG_M, color: '#00d4ff', weight: 1,
        fill: true, fillOpacity: 0.06, dashArray: '4 4'
      }).addTo(mainMap);

      m.on('dragend', () => {
        const pos  = m.getLatLng();
        const dist = metersBetween(origin, { lat: pos.lat, lng: pos.lng });
        if (dist > MAX_DRAG_M) {
          // Snap back to edge of 15 m circle
          const bearing = Math.atan2(pos.lng - origin.lng, pos.lat - origin.lat);
          const newLat  = origin.lat + Math.cos(bearing) * MAX_DRAG_M * DEG_PER_M;
          const newLng  = origin.lng + Math.sin(bearing) * MAX_DRAG_M * DEG_PER_M;
          m.setLatLng([newLat, newLng]);
          showToast('Bin snapped — max 15 m radius reached', 'warning');
        }
        const lp = m.getLatLng();
        bin.lat = lp.lat; bin.lng = lp.lng;
        showToast(`${bin.name} moved to new position`, 'info');
      });

      mainMarkers[bin.id] = m;
    }

    if (miniMarkers[bin.id]) {
      miniMarkers[bin.id].setIcon(icon);
    } else {
      const mi = L.divIcon({ html: binMarkerHtml(bin), className: '', iconSize: [28, 28], iconAnchor: [14, 14] });
      miniMarkers[bin.id] = L.marker([bin.lat, bin.lng], { icon: mi })
        .addTo(miniMap).bindPopup(`<b>${bin.name}</b><br>${bin.fill}%`);
    }
  });
}

// ==========================================
// DIJKSTRA ROUTE OPTIMIZATION
// ==========================================
function haversine(a, b) {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lng - a.lng);
  const x = Math.sin(dLat/2)**2 +
            Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

function dijkstraNearest(nodes, depot) {
  // Build full distance matrix (Dijkstra shortest edges)
  const all = [depot, ...nodes];
  const dist = Array.from({ length: all.length }, (_, i) =>
    all.map((_, j) => haversine(all[i], all[j]))
  );
  // Nearest-neighbor TSP on the precomputed Dijkstra distance matrix
  let visited = new Array(all.length).fill(false);
  let path = [0]; visited[0] = true;
  let totalDist = 0;
  for (let step = 0; step < nodes.length; step++) {
    const curr = path[path.length - 1];
    let nearest = -1, minD = Infinity;
    for (let j = 1; j < all.length; j++) {
      if (!visited[j] && dist[curr][j] < minD) { minD = dist[curr][j]; nearest = j; }
    }
    totalDist += minD;
    visited[nearest] = true;
    path.push(nearest);
  }
  totalDist += dist[path[path.length - 1]][0]; // return to depot
  return { path: path.map(i => all[i]), totalDist };
}

// ── Vehicle animation state ────────────────────────
function optimizeRoute() {
  // Only collect CRITICAL bins (>= 80%) for the route
  const pickups = binsData.filter(b => b.fill >= 80)
    .sort((a, b) => b.fill - a.fill); // highest fill first

  if (!pickups.length) {
    showToast('No critical bins (≥80%) need collection right now!', 'info');
    return;
  }

  const depot = { name: 'LPU Waste Depot', lat: LPU_CENTER[0], lng: LPU_CENTER[1] };
  const { path, totalDist } = dijkstraNearest(pickups, depot);
  const routeNodes = path.slice(1);

  if (routeLayer) mainMap.removeLayer(routeLayer);
  const latlngs = path.map(n => [n.lat, n.lng]);
  latlngs.push([depot.lat, depot.lng]);

  // Draw glowing route line
  routeLayer = L.polyline(latlngs, {
    color: '#00ff88', weight: 5, dashArray: '14 7', opacity: 0.95
  }).addTo(mainMap);
  mainMap.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });

  // Place static truck between the first two critical bins (or depot and first bin)
  if (_vehicleMarker) mainMap.removeLayer(_vehicleMarker);
  const truckIcon = L.divIcon({ html: '<div style="font-size:26px;filter:drop-shadow(0 0 8px #00ff88);">🚛</div>', className: '', iconSize: [32, 32], iconAnchor: [16, 16] });
  let truckLat = latlngs[0][0], truckLng = latlngs[0][1];
  if (latlngs.length > 2) {
    // halfway between first bin and second bin
    truckLat = (latlngs[1][0] + latlngs[2][0]) / 2;
    truckLng = (latlngs[1][1] + latlngs[2][1]) / 2;
  } else if (latlngs.length > 1) {
    truckLat = (latlngs[0][0] + latlngs[1][0]) / 2;
    truckLng = (latlngs[0][1] + latlngs[1][1]) / 2;
  }
  _vehicleMarker = L.marker([truckLat, truckLng], { icon: truckIcon }).addTo(mainMap)
    .bindPopup('<b>🚛 Waste Collection Truck</b><br>Currently en route between critical bins.');

  // Update stats panel
  document.getElementById('routeStats').style.display = 'grid';
  document.getElementById('routeBinCount').innerText  = routeNodes.length;
  document.getElementById('routeDist').innerText      = totalDist.toFixed(3) + ' km';
  document.getElementById('routeTime').innerText      = Math.round(totalDist * 60 / 3) + ' min';

  let html = `<div class="route-item" style="border:1px solid var(--accent)">
    <div class="route-num" style="background:var(--accent);color:#000">🏭</div>
    <div class="route-info"><strong>LPU Waste Depot</strong><span>Departure point</span></div>
  </div>`;
  routeNodes.forEach((bin, i) => {
    const sc = bin.fill >= 95 ? 'var(--red)' : 'var(--yellow)';
    const urg = bin.fill >= 95 ? '🔴 URGENT' : '🟡 Critical';
    html += `<div class="route-item">
      <div class="route-num" style="background:${bin.fill>=95?'#ef4444':'#f59e0b'}">${i+1}</div>
      <div class="route-info">
        <strong>${bin.name}</strong>
        <span>${bin.location || ''}</span>
        <span style="font-size:10px;margin-top:2px">${urg}</span>
      </div>
      <div class="route-fill" style="color:${sc};font-size:16px;font-weight:900">${bin.fill}%</div>
    </div>`;
  });
  html += `<div class="route-item" style="border:1px solid #7c3aed">
    <div class="route-num" style="background:#7c3aed">🏁</div>
    <div class="route-info"><strong>Return to Depot</strong><span>Route complete</span></div>
  </div>`;
  document.getElementById('routeList').innerHTML = html;
  showToast(`Route optimized — ${routeNodes.length} bins, ${totalDist.toFixed(2)} km`, 'success');
}

function clearRoute() {
  if (routeLayer) { mainMap.removeLayer(routeLayer); routeLayer = null; }
  if (_vehicleMarker) { mainMap.removeLayer(_vehicleMarker); _vehicleMarker = null; }
  document.getElementById('routeStats').style.display = 'none';
  document.getElementById('routeList').innerHTML = '<p class="route-empty">Click "Optimize Route" to generate the optimal collection sequence.</p>';
  showToast('Route cleared', 'info');
}

function mapFilter(type, el) {
  document.querySelectorAll('.map-ctrl-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  Object.keys(mainMarkers).forEach(id => {
    const bin = binsData.find(b => b.id === id);
    if (!bin) return;
    const show = type === 'all' || (type === 'pickup' && bin.fill >= 60);
    show ? mainMap.addLayer(mainMarkers[id]) : mainMap.removeLayer(mainMarkers[id]);
  });
}

// ==========================================
// CHARTS
// ==========================================
let donutChart, barChart, lineChart;
const _history = {}; // bin id → array of {t, fill}

function initCharts() {
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = "'Inter', sans-serif";

  donutChart = new Chart(document.getElementById('donutChart').getContext('2d'), {
    type: 'doughnut',
    data: { labels: ['Critical', 'Warning', 'Normal', 'Empty'],
            datasets: [{ data: [0,0,0,0], backgroundColor: ['#ef4444','#f59e0b','#10b981','#334155'], borderWidth: 0, cutout: '75%' }] },
    options: { plugins: { legend: { display: false } } }
  });

  barChart = new Chart(document.getElementById('barChart').getContext('2d'), {
    type: 'bar',
    data: { labels: [], datasets: [{ label: 'Fill Level %', data: [], backgroundColor: [], borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } }
  });

  const lctx = document.getElementById('lineChart');
  if (lctx) {
    lineChart = new Chart(lctx.getContext('2d'), {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 }, x: { ticks: { maxTicksLimit: 8 } } },
        plugins: { legend: { position: 'bottom' } },
        elements: { point: { radius: 2 } }
      }
    });
  }
}

function updateCharts() {
  const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Record history
  binsData.forEach(b => {
    if (!_history[b.id]) _history[b.id] = [];
    _history[b.id].push({ t: now, fill: b.fill });
    if (_history[b.id].length > 20) _history[b.id].shift();
  });

  if (donutChart) {
    donutChart.data.datasets[0].data = [
      binsData.filter(b => b.fill >= 80).length,
      binsData.filter(b => b.fill >= 60 && b.fill < 80).length,
      binsData.filter(b => b.fill > 0 && b.fill < 60).length,
      binsData.filter(b => b.fill === 0).length
    ];
    donutChart.update();
  }

  if (barChart) {
    barChart.data.labels = binsData.map(b => b.name.split(',')[0]);
    barChart.data.datasets[0].data = binsData.map(b => b.fill);
    barChart.data.datasets[0].backgroundColor = binsData.map(b =>
      b.fill >= 80 ? '#ef4444' : b.fill >= 60 ? '#f59e0b' : '#10b981'
    );
    barChart.update();
  }

  updateLineChart();
  updateStatsList();
}

function updateLineChart() {
  if (!lineChart || !binsData.length) return;
  const colors = ['#00ff88','#00d4ff','#f59e0b','#ef4444','#a78bfa','#fb7185'];
  const labels = _history[binsData[0].id] ? _history[binsData[0].id].map(p => p.t) : [];
  lineChart.data.labels = labels;
  lineChart.data.datasets = binsData.map((b, i) => ({
    label: b.name.split(',')[0],
    data: (_history[b.id] || []).map(p => p.fill),
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length] + '22',
    fill: false, tension: 0.3, borderWidth: 2
  }));
  lineChart.update();
}

function updateStatsList() {
  const el = document.getElementById('statsList');
  if (!el || !binsData.length) return;
  const avg   = binsData.reduce((a, b) => a + b.fill, 0) / binsData.length;
  const max   = binsData.reduce((a, b) => b.fill > a.fill ? b : a);
  const min   = binsData.reduce((a, b) => b.fill < a.fill ? b : a);
  el.innerHTML = `
    <div class="stat-item"><label>Average Fill</label><span>${avg.toFixed(1)}%</span></div>
    <div class="stat-item"><label>Fullest Bin</label><span>${max.name.split(',')[0]} (${max.fill}%)</span></div>
    <div class="stat-item"><label>Emptiest Bin</label><span>${min.name.split(',')[0]} (${min.fill}%)</span></div>
    <div class="stat-item"><label>Total Bins</label><span>${binsData.length}</span></div>
    <div class="stat-item"><label>Critical</label><span style="color:var(--red)">${binsData.filter(b=>b.fill>=80).length}</span></div>
    <div class="stat-item"><label>Need Pickup</label><span style="color:var(--yellow)">${binsData.filter(b=>b.fill>=60).length}</span></div>
    <div class="stat-item"><label>Data Mode</label><span>${_demoMode ? '⚠ Demo' : '⚡ Live'}</span></div>
    <div class="stat-item"><label>Campus</label><span>LPU, Phagwara</span></div>`;
}

function refreshData() {
  const icon = document.getElementById('refreshIcon');
  if (icon) icon.classList.add('spinning');
  fetchBinsData().then(() => {
    if (icon) icon.classList.remove('spinning');
  }).catch(() => {
    if (icon) icon.classList.remove('spinning');
  });
}

// ==========================================
// MODALS & FORMS
// ==========================================
function showAddBinModal() { document.getElementById('addBinModal').classList.add('open'); }
function closeModal()       { document.getElementById('addBinModal').classList.remove('open'); }

async function addNewBin() {
  const name     = document.getElementById('newBinName').value.trim();
  const location = document.getElementById('newBinLocation').value.trim();
  const lat      = parseFloat(document.getElementById('newBinLat').value);
  const lng      = parseFloat(document.getElementById('newBinLng').value);
  const deviceId = document.getElementById('newBinDeviceId').value.trim();
  if (!name || !lat || !lng || !deviceId) { showToast('Please fill all fields!', 'error'); return; }
  try {
    await fetch(`${API_URL}/bins`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, location, lat, lng, deviceId })
    });
    closeModal(); fetchBinsData();
    showToast(`Bin "${name}" registered!`, 'success');
  } catch { showToast('Could not add bin – server offline.', 'error'); }
}

// ESP32 Config helpers
function testConnection() {
  const ep = document.getElementById('apiEndpoint').value;
  document.getElementById('connTestResult').innerHTML = `<span style="color:var(--yellow)">Testing ${ep}…</span>`;
  fetch(ep.replace('/api/update', '/api/bins')).then(() => {
    document.getElementById('connTestResult').innerHTML = `<span style="color:var(--green)">✓ Connection successful!</span>`;
  }).catch(() => {
    document.getElementById('connTestResult').innerHTML = `<span style="color:var(--red)">✗ Connection failed. Check URL & server.</span>`;
  });
}

function saveConfig()       { showToast('Configuration saved!', 'success'); }
function saveSensorConfig() { showToast('Sensor config applied!', 'success'); }

function copyCode() {
  const code = document.getElementById('esp32Code').innerText;
  navigator.clipboard.writeText(code).then(() => showToast('ESP32 code copied!', 'success'));
}

function filterBins(type, el) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.bin-detail-card').forEach((card, i) => {
    const bin = binsData[i];
    if (!bin) return;
    const show = type === 'all'
      || (type === 'critical' && bin.fill >= 80)
      || (type === 'warning'  && bin.fill >= 60 && bin.fill < 80)
      || (type === 'normal'   && bin.fill > 0 && bin.fill < 60)
      || (type === 'empty'    && bin.fill === 0);
    card.style.display = show ? '' : 'none';
  });
}

function searchBins(q) {
  document.querySelectorAll('.bin-detail-card').forEach((card, i) => {
    const bin = binsData[i];
    card.style.display = bin && bin.name.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

function clearFeed() { document.getElementById('activityFeed').innerHTML = ''; }
// ==========================================
// ALERTS & NOTIFICATIONS
// ==========================================
function generateAlerts() {
  const list = document.getElementById('alertsList');
  if (!list) return;
  let html = '';
  binsData.forEach(bin => {
    if (bin.fill >= 95) {
      html += `<div class="activity-item error alert-card" data-type="critical">
        <i class="fas fa-exclamation-triangle" style="color:var(--red); font-size:20px;"></i>
        <div><strong>URGENT: ${bin.name}</strong><span>Bin is ${bin.fill}% full! Dispatch collection immediately.</span></div>
      </div>`;
    } else if (bin.fill >= 80) {
      html += `<div class="activity-item warning alert-card" data-type="critical">
        <i class="fas fa-exclamation-circle" style="color:var(--yellow); font-size:20px;"></i>
        <div><strong>Critical: ${bin.name}</strong><span>Bin is ${bin.fill}% full. Route optimization needed.</span></div>
      </div>`;
    } else if (bin.fill >= 60) {
      html += `<div class="activity-item warning alert-card" data-type="warning">
        <i class="fas fa-exclamation-circle" style="color:var(--yellow); font-size:20px;"></i>
        <div><strong>Warning: ${bin.name}</strong><span>Bin is ${bin.fill}% full. Monitor status.</span></div>
      </div>`;
    }
  });
  if (html === '') {
    html = `<div style="padding:20px; color:var(--text2); text-align:center;">No active alerts at this time.</div>`;
  }
  list.innerHTML = html;
}

function filterAlerts(type, el) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.alert-card').forEach(card => {
    if (type === 'all' || card.getAttribute('data-type') === type) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });
}

function clearAlerts() { 
  document.getElementById('alertsList').innerHTML = '<div style="padding:20px; color:var(--text2); text-align:center;">All alerts cleared.</div>';
  document.getElementById('alertBadge').innerText = '0';
  document.getElementById('notifCount').innerText = '0';
}

function refreshData() {
  document.getElementById('refreshIcon').classList.add('spinning');
  fetchBinsData().finally(() => setTimeout(() => document.getElementById('refreshIcon').classList.remove('spinning'), 600));
}

function switchMode(val) { showToast(`Mode switched to: ${val}`, 'info'); }

// Toast
function showToast(msg, type = 'info') {
  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ESP32 code snippet (displayed in config page)
window.addEventListener('DOMContentLoaded', () => {
  const codeEl = document.getElementById('esp32Code');
  if (codeEl) codeEl.textContent = `// ── ESP32 UniMall Bin Firmware ──
#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

const char* ssid     = "VN_PG_GROUND_FLOOR-2.4G";
const char* password = "Liwa@123";
const char* serverIP = "https://eco-track-smartbin-system.onrender.com/api/update";
const char* deviceId = "ESP32-LIVE";

const int TRIG = 5, ECHO = 18;
const float BIN_H = 25.0;

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

void setup() {
  Serial.begin(115200);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED not found");
    while (true);
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void loop() {
  // Ultrasonic trigger
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);

  float dist = pulseIn(ECHO, HIGH) * 0.01715;
  int fill = constrain((int)((BIN_H - dist) / BIN_H * 100), 0, 100);

  // ---------------- OLED DISPLAY ----------------
  display.clearDisplay();

  // Title (top)
  display.setTextSize(1);
  display.setCursor(25, 0);
  display.println("Trash level");

  // Percentage (CENTER)
  display.setTextSize(3);
  display.setCursor(40, 20);
  display.print(fill);
  display.print("%");

  // Alert (bottom)
  if (fill >= 85) {
    display.setTextSize(1);
    display.setCursor(5, 56);
    display.setTextColor(SSD1306_BLACK, SSD1306_WHITE);
    display.println(" Alert:bin is full");
    display.setTextColor(SSD1306_WHITE);
  }

  display.display();
  // ------------------------------------------------

  // Send to server
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverIP); // Render uses HTTPS
    http.addHeader("Content-Type", "application/json");

    String payload = "{\\"deviceId\\":\\"" + String(deviceId) + "\\",\\"fill\\":" + fill + "}";
    int httpResponseCode = http.POST(payload);
    
    if (httpResponseCode > 0) Serial.println("Success: " + String(httpResponseCode));
    else Serial.println("Error: " + String(httpResponseCode));

    http.end();
  }
  delay(5000);
}`;
});
// ==========================================
// REWARD SYSTEM LOGIC
// ==========================================

function handleWasteDisposed(bin, increase) {
  // Points = % increase
  const pointsEarned = increase;
  if (pointsEarned <= 0) return;

  console.log(`[REWARD] Waste detected in ${bin.name}: +${pointsEarned} points`);

  // Show Reward Modal with QR
  const pointsText = document.getElementById('rewardPointsValue');
  const qrImg = document.getElementById('qrCodeImg');
  
  if (pointsText) pointsText.innerText = `+${pointsEarned} Points`;
  
  // Generate QR Code URL (points data encoded)
  // We use qrserver.com to generate a QR that encodes the reward info
  const qrData = encodeURIComponent(`EcoTrackReward:${pointsEarned}:${Date.now()}`);
  if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${qrData}&color=00ff88&bgcolor=ffffff`;

  document.getElementById('rewardModal').classList.add('open');

  // Add to temporary storage to be claimed
  window._pendingReward = {
    binName: bin.name,
    points: pointsEarned,
    volume: increase + '%',
    time: new Date().toLocaleString('en-IN')
  };
}

function closeRewardModal() {
  if (window._pendingReward) {
    const r = window._pendingReward;
    userPoints += r.points;
    
    // Add to history
    rewardHistory.unshift({
      time: r.time,
      binName: r.binName,
      volume: r.volume,
      points: r.points,
      status: 'Claimed'
    });

    if (rewardHistory.length > 20) rewardHistory.pop();

    // Save to localStorage
    localStorage.setItem('ecoTrack_points', userPoints);
    localStorage.setItem('ecoTrack_history', JSON.stringify(rewardHistory));

    showToast(`Successfully claimed ${r.points} EcoPoints!`, 'success');
    window._pendingReward = null;
  }

  document.getElementById('rewardModal').classList.remove('open');
  updateRewardsUI();
}

function updateRewardsUI() {
  const ptsEl = document.getElementById('userPoints');
  const walletEl = document.getElementById('walletBalance');
  const progressEl = document.getElementById('withdrawProgress');
  const progressText = document.getElementById('progressText');
  const withdrawBtn = document.getElementById('withdrawBtn');
  const historyBody = document.getElementById('rewardHistoryBody');

  if (!ptsEl) return;

  // Update Points & Wallet (1000 pts = 50 INR)
  ptsEl.innerText = userPoints.toLocaleString();
  const balance = (userPoints / 1000) * 50;
  walletEl.innerText = `₹${balance.toFixed(2)}`;

  // Update Progress (Goal: 5000 pts)
  const progress = Math.min(100, (userPoints / 5000) * 100);
  progressEl.style.width = `${progress}%`;
  progressText.innerText = `${userPoints} / 5000 pts`;

  // Update Withdrawal Button
  if (userPoints >= 5000) {
    withdrawBtn.disabled = false;
    withdrawBtn.style.opacity = '1';
    withdrawBtn.style.cursor = 'pointer';
  } else {
    withdrawBtn.disabled = true;
    withdrawBtn.style.opacity = '0.5';
    withdrawBtn.style.cursor = 'not-allowed';
  }

  // Update History Table
  if (rewardHistory.length > 0) {
    historyBody.innerHTML = rewardHistory.map(h => `
      <tr>
        <td>${h.time}</td>
        <td>${h.binName}</td>
        <td>${h.volume}</td>
        <td style="color:var(--accent); font-weight:700">+${h.points}</td>
        <td><span class="bin-status-pill status-normal">${h.status}</span></td>
      </tr>
    `).join('');
  }
}

function withdrawPoints() {
  if (userPoints < 5000) {
    showToast('Minimum 5000 points required to withdraw!', 'warning');
    return;
  }

  const amount = (userPoints / 1000) * 50;
  if (confirm(`Do you want to withdraw ₹${amount.toFixed(2)} to your UPI?`)) {
    showToast(`Withdrawal of ₹${amount.toFixed(2)} initiated!`, 'success');
    userPoints = 0;
    rewardHistory.unshift({
      time: new Date().toLocaleString('en-IN'),
      binName: 'System Withdrawal',
      volume: '-',
      points: -5000,
      status: 'Withdrawn'
    });
    localStorage.setItem('ecoTrack_points', userPoints);
    localStorage.setItem('ecoTrack_history', JSON.stringify(rewardHistory));
    updateRewardsUI();
  }
}

// SIMULATION FOR TESTING
function simulateWasteDisposal() {
  const randomBin = binsData[Math.floor(Math.random() * binsData.length)] || DEMO_BINS[0];
  const increase = Math.floor(Math.random() * 20) + 10; // 10-30% increase
  
  showToast(`Simulating waste disposal in ${randomBin.name}...`, 'info');
  
  // Trigger reward flow
  setTimeout(() => {
    handleWasteDisposed(randomBin, increase);
  }, 1000);
}

// ── QR SCANNING (WEB) ─────────────────────
let html5QrCode = null;

function startQRScanner() {
  const readerEl = document.getElementById('qr-reader');
  if (!readerEl) return;
  
  readerEl.style.display = 'block';
  showToast("Initializing Camera...", "info");

  html5QrCode = new Html5Qrcode("qr-reader");
  const config = { fps: 10, qrbox: { width: 250, height: 250 } };

  html5QrCode.start(
    { facingMode: "environment" }, 
    config,
    (decodedText) => {
      handleQRSuccess(decodedText);
    },
    (err) => { /* ignore silent errors */ }
  ).catch(err => {
    console.error("QR Scan Error:", err);
    showToast("Camera Error or Permission Denied", "error");
  });
}

function handleQRSuccess(text) {
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      document.getElementById('qr-reader').style.display = 'none';
      
      // Parse: EcoTrackReward:points:timestamp
      if (text.includes("EcoTrackReward:")) {
        const pts = parseInt(text.split(":")[1]) || 25;
        showToast(`QR Recognized! +${pts} Points`, "success");
        handleWasteDisposed({ name: "Hardware Bin" }, pts);
      } else {
        showToast("Unrecognized QR Format", "warning");
      }
    });
  }
}
