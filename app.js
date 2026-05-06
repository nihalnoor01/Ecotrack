// ==========================================
// EcoTrack – LPU Campus Smart Waste System
// ==========================================

const API_URL = 'https://eco-track-smartbin-system.onrender.com/api';
const LOCAL_API_URL = 'http://localhost:3000/api';
let binsData = [];
let mainMap, miniMap;
let mainTileLayer, miniTileLayer;
let mainMarkers = {}, miniMarkers = {};
let routeLayer = null;
let _vehicleMarker = null;

// REWARD SYSTEM STATE
const currentUser = localStorage.getItem('ecoTrack_user') || 'guest';
let userPoints = parseInt(localStorage.getItem(`ecoTrack_points_${currentUser}`)) || 0;
let rewardHistory = JSON.parse(localStorage.getItem(`ecoTrack_history_${currentUser}`)) || [];
console.log(`[USER SESSION] Active User: ${currentUser}`); // Debug log
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
  // Apply theme FIRST so maps get correct tiles
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-mode');
    const icon = document.querySelector('#themeToggleBtn i');
    if (icon) icon.className = 'fas fa-sun';
  }

  checkAuth();
  updateClock();
  setInterval(updateClock, 1000);
  initMaps();
  setTimeout(() => {
    console.log("[CHART DEBUG] Initializing charts...");
    initCharts();
  }, 300); // Small delay to ensure library is ready
  fetchBinsData();
  updateRewardsUI();
  fetchLeaderboard();
  setInterval(fetchBinsData, 5000);
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
  
  // Close sidebar on mobile after navigation
  if (window.innerWidth <= 1024) {
    document.getElementById('sidebar').classList.remove('remove'); // Fix: should be remove('open')
    document.getElementById('sidebar').classList.remove('open');
  }

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
let currentRole = null;

function checkAuth() {
  const role = localStorage.getItem('ecoTrack_role') || 'citizen';
  const user = localStorage.getItem('ecoTrack_user') || 'Resident';
  currentRole = role;
  
  // Display name: extract part before @ or use full string
  const displayName = user.includes('@') ? user.split('@')[0] : user;
  const welcomeEl = document.getElementById('userWelcome');
  if (welcomeEl) {
    welcomeEl.innerText = `Hi, ${displayName.charAt(0).toUpperCase() + displayName.slice(1)}`;
  }
  
  applyRBAC(role);
}

function applyRBAC(role) {
  if (role === 'citizen' || role === 'user') {
    // Resident role: only Dashboard, Rewards, Leaderboard
    const toHide = ['nav-bins', 'nav-map', 'nav-analytics', 'nav-esp32'];
    toHide.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  } else if (role === 'collector' || role === 'admin') {
    // Collector role: Dashboard, Bin Monitor, Route Map
    const toHide = ['nav-rewards', 'nav-leaderboard'];
    toHide.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }
}

function logout() {
  localStorage.removeItem('ecoTrack_role');
  localStorage.removeItem('ecoTrack_user'); // Fix: clear user on logout
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
    const res = await fetch(`${API_URL}/bins`, { 
      signal: AbortSignal.timeout(3000),
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    
    data.forEach(remoteBin => {
      const index = binsData.findIndex(b => b.deviceId === remoteBin.deviceId);
      if (index !== -1) {
        const prevFill = lastKnownFills[remoteBin.deviceId];
        const newFill = remoteBin.fill;

        // Detection logic for rewards (only if there was an increase)
        if (prevFill !== undefined && newFill > prevFill) {
          checkFillSpikeIntent(binsData[index], newFill - prevFill, newFill);
        }
        
        // Update local state
        binsData[index].fill = newFill;
        binsData[index].status = remoteBin.status;
        binsData[index].lastUpdated = remoteBin.lastUpdated;
        lastKnownFills[remoteBin.deviceId] = newFill;
      } else {
        binsData.push(remoteBin);
        lastKnownFills[remoteBin.deviceId] = remoteBin.fill;
      }
    });

    document.getElementById('connDot').style.background = '#00ff88';
    document.getElementById('connStatus').innerText = '⚡ ESP32-LIVE Connected';
    _demoMode = false;
  } catch (err) {
    console.warn('[FETCH ERROR]', err.message);
    if (binsData.length === 0) {
      binsData = JSON.parse(JSON.stringify(DEMO_BINS));
    }
    _demoMode = true;
    document.getElementById('connDot').style.background = '#eab308';
    document.getElementById('connStatus').innerText = '⚠ Server Offline (Demo Mode)';
  }

  updateUI();
}

function updateUI() {
  if (typeof updateCharts === "function") updateCharts();
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
      <div class="bin-detail-card" style="border-color:${bin.isLive ? '#ffffff' : 'var(--border)'}">
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
  const isLight = document.body.classList.contains('light-mode');
  const style = isLight ? 'light_all' : 'dark_all';
  return L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
    attribution: '© OpenStreetMap & Carto | LPU EcoTrack',
    maxZoom: 20
  });
}

function initMaps() {
  miniMap = L.map('miniMap', { zoomControl: false, dragging: false, scrollWheelZoom: false })
    .setView(LPU_CENTER, LPU_ZOOM - 1);
  miniTileLayer = makeTileLayer().addTo(miniMap);

  mainMap = L.map('mainMap').setView(LPU_CENTER, LPU_ZOOM);
  mainTileLayer = makeTileLayer().addTo(mainMap);
  
  // Add campus landmark labels
  LPU_LANDMARKS.forEach(lm => {
    L.marker([lm.lat, lm.lng], {
      icon: L.divIcon({
        html: '<div style="font-size:11px;color:var(--text2);white-space:nowrap;text-shadow:0 0 4px rgba(0,0,0,0.8);">' + lm.icon + ' ' + lm.name + '</div>',
        className: '',
        iconSize: [100, 20],
        iconAnchor: [50, 10]
      })
    }).addTo(mainMap);
  });
}

function updateMaps() {
  // Clear existing markers
  Object.values(mainMarkers).forEach(m => mainMap.removeLayer(m));
  Object.values(miniMarkers).forEach(m => miniMap.removeLayer(m));
  mainMarkers = {};
  miniMarkers = {};

  binsData.forEach(bin => {
    if (!bin.lat || !bin.lng) return;
    const sc = statusColor(bin.fill);
    const binNum = bin.id.split('_')[1] || '';
    const html = `<div class="map-marker-fill" style="border-color:${sc};">
                    <div class="fill-level" style="height:${bin.fill}%; background:${sc};"></div>
                    <div class="marker-number">${binNum}</div>
                  </div>`;
    const icon = L.divIcon({ html, className: '', iconSize: [36, 48], iconAnchor: [18, 48] });
    
    const popupContent = `
      <div style="font-family:'Inter',sans-serif; min-width:200px;">
        <h3 style="margin:0 0 5px 0; font-size:16px;">${bin.name}</h3>
        <p style="margin:0 0 10px 0; font-size:12px; color:var(--text2);">${bin.location}</p>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; font-size:24px; color:${sc}">${bin.fill}%</span>
          <span style="padding:4px 8px; border-radius:4px; font-size:10px; font-weight:700; background:var(--surface2); color:${sc}">${bin.status}</span>
        </div>
      </div>`;

    mainMarkers[bin.id] = L.marker([bin.lat, bin.lng], { icon }).addTo(mainMap).bindPopup(popupContent);
    miniMarkers[bin.id] = L.marker([bin.lat, bin.lng], { icon }).addTo(miniMap);
  });
}

async function optimizeRoute() {
  const thresholdEl = document.getElementById('routeThreshold');
  const thresholdVal = thresholdEl ? parseInt(thresholdEl.value) : 80;
  
  // Only collect bins that meet threshold
  const pickups = binsData.filter(b => b.fill >= thresholdVal);
  if (!pickups.length) {
    showToast(`No bins (≥${thresholdVal}%) need collection right now!`, 'info');
    return;
  }

  showToast('Optimizing route via OpenRouteService...', 'info');

  const btn = document.querySelector('.map-ctrl-btn.green');
  if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Optimizing...</span>';

  try {
    console.log('[ROUTE] Sending optimization request to Local Server...');
    const depot = window._customDepot || { lat: LPU_CENTER[0], lng: LPU_CENTER[1] };
    const response = await fetch(`${LOCAL_API_URL}/route`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ threshold: thresholdVal, depot, bins: binsData })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[ROUTE API ERROR] ${response.status}:`, errText);
      throw new Error(`API Request Failed (${response.status}): ${errText}`);
    }
    
    const result = await response.json();
    
    if (result.route.length <= 1) {
       showToast(result.message || 'No optimal route found', 'info');
       if (btn) btn.innerHTML = '<i class="fas fa-route"></i><span>Optimize Route</span>';
       return;
    }

    if (routeLayer) mainMap.removeLayer(routeLayer);
    
    // Check if we received road geometry (ORS) or Euclidean fallback
    let latlngs = [];
    if (result.geometry && result.geometry.length > 0) {
      latlngs = result.geometry;
    } else {
      latlngs = result.route.map(n => [n.lat, n.lng]);
    }

    // Draw solid glowing road route
    routeLayer = L.polyline(latlngs, {
      color: '#ffffff', weight: 10, opacity: 0.1
    }).addTo(mainMap);
    
    // Add white core
    const routeCore = L.polyline(latlngs, {
      color: '#ffffff', weight: 2, opacity: 0.8
    }).addTo(mainMap);
    
    // Group them for removal
    routeLayer = L.layerGroup([routeLayer, routeCore]).addTo(mainMap);

    mainMap.fitBounds(L.polyline(latlngs).getBounds(), { padding: [50, 50] });

    // Place Draggable truck at the start of the route
    if (!_vehicleMarker) {
      const truckIcon = L.divIcon({ html: '<div style="font-size:32px;filter:drop-shadow(0 0 8px #ffffff); cursor: grab;">🚛</div>', className: '', iconSize: [40, 40], iconAnchor: [20, 20] });
      _vehicleMarker = L.marker([LPU_CENTER[0], LPU_CENTER[1]], { 
        icon: truckIcon,
        draggable: true,
        zIndexOffset: 1000
      }).addTo(mainMap).bindPopup('<b>🚛 Collection Truck</b><br>Drag me to set starting position!');
      
      _vehicleMarker.on('dragend', function(event) {
        const marker = event.target;
        const position = marker.getLatLng();
        showToast('Truck position updated! Re-optimizing route...', 'info');
        window._customDepot = { lat: position.lat, lng: position.lng };
        optimizeRoute();
      });
    }

    // Start Truck Animation along the route
    if (!window._customDepot) {
      _vehicleMarker.setLatLng(latlngs[0]);
    }
    
    // Smooth animate truck
    let currentStep = 0;
    function animateTruck() {
      if (currentStep >= latlngs.length) return;
      _vehicleMarker.setLatLng(latlngs[currentStep]);
      currentStep++;
      setTimeout(animateTruck, 40); // 40ms per point is very smooth and a bit slower
    }
    animateTruck();

    // Update stats panel
    document.getElementById('routeStats').style.display = 'grid';
    document.getElementById('routeBinCount').innerText  = result.binCount;
    document.getElementById('routeDist').innerText      = result.totalDistance.toFixed(2) + ' km';
    // Use ORS duration if available, otherwise calculate using 20km/h
    const duration = result.durationMin || Math.round((result.totalDistance / 20) * 60);
    document.getElementById('routeTime').innerText      = duration + ' min';

    let html = `<div class="route-item" style="border:1px solid var(--accent)">
      <div class="route-num" style="background:var(--accent);color:#000">🏭</div>
      <div class="route-info"><strong>LPU Waste Depot</strong><span>Departure point</span></div>
    </div>`;
    
    result.route.slice(1, -1).forEach((node, i) => {
      const bin = binsData.find(b => b.id === node.id) || node;
      const fill = bin.fill || 0;
      const sc = fill >= 95 ? 'var(--red)' : 'var(--yellow)';
      const urg = fill >= 95 ? '🔴 URGENT' : '🟡 Critical';
      
      html += `<div class="route-item">
        <div class="route-num" style="background:${fill>=95?'#ef4444':'#eab308'}">${i+1}</div>
        <div class="route-info">
          <strong>${bin.name || bin.id}</strong>
          <span>${bin.location || ''}</span>
          <span style="font-size:10px;margin-top:2px">${urg}</span>
        </div>
        <div class="route-fill" style="color:${sc};font-size:16px;font-weight:900">${fill}%</div>
      </div>`;
    });
    
    html += `<div class="route-item" style="border:1px solid #ffffff">
      <div class="route-num" style="background:#ffffff">🏁</div>
      <div class="route-info"><strong>Return to Depot</strong><span>Route complete</span></div>
    </div>`;
    
    document.getElementById('routeList').innerHTML = html;
    showToast(`Road Route optimized — ${result.binCount} bins, ${result.totalDistance.toFixed(2)} km`, 'success');

  } catch (err) {
    console.error(err);
    showToast('Failed to optimize route using API', 'error');
  } finally {
    if (btn) btn.innerHTML = '<i class="fas fa-route"></i><span>Optimize Route</span>';
  }
}

function awardPoints(bin, increase) {
  userPoints += increase; // 1 point per 1% fill
  const history = {
    time: new Date().toLocaleString('en-IN'),
    binName: bin.name,
    volume: increase + '%',
    points: increase,
    status: 'Earned'
  };
  rewardHistory.unshift(history);
  localStorage.setItem(`ecoTrack_points_${currentUser}`, userPoints);
  localStorage.setItem(`ecoTrack_history_${currentUser}`, JSON.stringify(rewardHistory));
  updateRewardsUI();
  showToast(`EcoPoints Earned! +${increase} for cleaning ${bin.name}`, 'success');
}

function updateRewardsUI() {
  const pointsVal = document.getElementById('pointsVal');
  const levelVal  = document.getElementById('levelVal');
  const levelProgress = document.getElementById('levelProgress');
  const totalEarned = document.getElementById('totalEarned');
  
  if (pointsVal) pointsVal.innerText = userPoints;
  if (totalEarned) totalEarned.innerText = userPoints;
  
  // Calculate Level (1000 pts per level)
  const level = Math.floor(userPoints / 1000) + 1;
  const nextLevelPts = level * 1000;
  const currentLevelPts = (level - 1) * 1000;
  const progress = ((userPoints - currentLevelPts) / (nextLevelPts - currentLevelPts)) * 100;
  
  if (levelVal) levelVal.innerText = 'Level ' + level;
  if (levelProgress) levelProgress.style.width = progress + '%';

  // Render History
  const list = document.getElementById('rewardHistoryList');
  if (list) {
    if (rewardHistory.length === 0) {
      list.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text2); opacity:0.5">No history yet.</div>';
    } else {
      list.innerHTML = rewardHistory.map(h => `
        <div class="reward-history-item" style="display:flex; justify-content:space-between; align-items:center; padding:15px; border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:500; font-size:14px;">${h.binName} Disposal</div>
            <div style="font-size:11px; color:var(--text2); margin-top:4px;">${h.time} • ${h.volume} waste</div>
          </div>
          <div style="color:var(--green); font-weight:600; font-size:14px;">+${h.points} pts</div>
        </div>
      `).join('');
    }
  }
}

// SIMULATION FOR TESTING
function simulateWasteDisposal() {
  if (currentRole !== 'citizen') return;
  handleQRSuccess("ecotrack:bin:bin_1");
  setTimeout(() => {
    const bin1 = binsData.find(b => b.id === 'bin_1');
    if (bin1) {
      const inc = Math.floor(Math.random() * 10) + 5;
      bin1.fill = Math.min(100, bin1.fill + inc);
      checkFillSpikeIntent(bin1, inc);
    }
  }, 3000);
}

// ==========================================
// CHARTS
// ==========================================
let donutChart = null;

function initCharts() {
  const ctx = document.getElementById('donutChart');
  if (!ctx) return;

  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Critical', 'Warning', 'Normal', 'Empty'],
      datasets: [{
        data: [0, 0, 0, 0],
        backgroundColor: ['#ef4444', '#f59e0b', '#10b981', 'rgba(255,255,255,0.05)'],
        borderWidth: 0,
        hoverOffset: 10
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '80%',
      plugins: {
        legend: { display: false }
      }
    }
  });
  updateCharts();
}

function updateCharts() {
  if (!donutChart) return;
  
  const critical = binsData.filter(b => b.fill >= 80).length;
  const warning  = binsData.filter(b => b.fill >= 60 && b.fill < 80).length;
  const normal   = binsData.filter(b => b.fill > 0 && b.fill < 60).length;
  const empty    = binsData.filter(b => b.fill === 0).length;

  donutChart.data.datasets[0].data = [critical, warning, normal, empty];
  donutChart.update();

  // Update legend
  const legend = document.getElementById('donutLegend');
  if (legend) {
    legend.innerHTML = `
      <div class="legend-item"><span class="dot" style="background:#ef4444"></span> Critical: ${critical}</div>
      <div class="legend-item"><span class="dot" style="background:#f59e0b"></span> Warning: ${warning}</div>
      <div class="legend-item"><span class="dot" style="background:#10b981"></span> Normal: ${normal}</div>
      <div class="legend-item"><span class="dot" style="background:rgba(255,255,255,0.2)"></span> Empty: ${empty}</div>
    `;
  }
}

// ── QR SCANNING (WEB) ─────────────────────
let html5QrCode = null;

function startQRScanner() {
  if (currentRole !== 'citizen') return;
  const readerEl = document.getElementById('qr-reader');
  if (!readerEl) return;
  readerEl.style.display = 'block';
  showToast("Initializing Camera...", "info");
  html5QrCode = new Html5Qrcode("qr-reader");
  html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => { handleQRSuccess(decodedText); },
    (err) => {}
  ).catch(err => {
    console.error("QR Error:", err);
    showToast("Camera Error or Permission Denied", "error");
  });
}

function handleQRSuccess(text) {
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      document.getElementById('qr-reader').style.display = 'none';
      let scannedBinId = "bin_1";
      if (text.startsWith("ecotrack:bin:")) {
        scannedBinId = text.split(":")[2].trim(); // Added .trim() to fix newline issue
      } else {
        scannedBinId = text.trim(); 
        showToast(`Non-standard QR. Using: ${scannedBinId}`, "info");
      }
      
      const bin = binsData.find(b => b.id === scannedBinId) || { name: scannedBinId, id: scannedBinId, fill: 0 };
      
      // Captured Intent with the fill level at the moment of scan
      activeIntent = { 
        binId: scannedBinId, 
        startTime: Date.now(),
        initialFill: bin.fill 
      };
      
      showToast(`Linked to ${bin.name}. Please deposit your waste now.`, "info");
      const resultsEl = document.getElementById('qr-reader-results');
      if (resultsEl) {
        resultsEl.innerHTML = `
          <div id="active-reward-status" style="padding: 15px; background: rgba(34, 197, 94, 0.1); border: 1px solid var(--green); color: var(--green); border-radius: 8px; margin-top: 15px; font-weight: 500;">
            <i class="fas fa-spinner fa-spin"></i> Connected to ${bin.name}. Waiting for waste (90s timeout)...
          </div>`;
      }
      
      setTimeout(() => {
        if (activeIntent && activeIntent.binId === scannedBinId) {
          activeIntent = null;
          if (resultsEl) {
            resultsEl.innerHTML = `
              <div style="padding: 15px; background: rgba(239, 68, 68, 0.1); border: 1px solid var(--red); color: var(--red); border-radius: 8px; margin-top: 15px; font-weight: 500;">
                Timeout: No waste detected. Please scan again.
              </div>`;
          }
        }
      }, 90000);

    });
  }
}

// ==========================================
// CHARTS
// ==========================================
let distChart;

function initCharts() {
  try {
  const ctx = document.getElementById('distributionChart');
  if (!ctx) return;
  
  distChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Critical (≥80%)', 'Warning (60-79%)', 'Normal (1-59%)', 'Empty (0%)'],
      datasets: [{
        data: [0, 0, 0, 0],
        backgroundColor: [
          '#ef4444', // Red
          '#eab308', // Yellow
          '#22c55e', // Green
          '#64748b'  // Gray
        ],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '75%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(0,0,0,0.8)',
          titleFont: { size: 14, family: "'Inter', sans-serif" },
          bodyFont: { size: 14, family: "'Inter', sans-serif" },
          padding: 12,
          cornerRadius: 8,
          displayColors: true
        }
      }
    }
  });
  } catch(e) { console.error("Chart init failed", e); setTimeout(initCharts, 500); }
}

function updateCharts() {
  if (!distChart) return;
  
  let critical = 0, warning = 0, normal = 0, empty = 0;
  binsData.forEach(b => {
    if (b.fill >= 80) critical++;
    else if (b.fill >= 60) warning++;
    else if (b.fill > 0) normal++;
    else empty++;
  });
  
  distChart.data.datasets[0].data = [critical, warning, normal, empty];
  distChart.update();
  
  // Update Center Text
  const centerText = document.getElementById('chartCenterText');
  if (centerText) {
    const totalFill = binsData.reduce((sum, b) => sum + b.fill, 0);
    const avgFill = binsData.length ? Math.round(totalFill / binsData.length) : 0;
    centerText.innerHTML = `<div style="text-align:center">
      <div style="font-size:24px;font-weight:700;color:var(--text)">${avgFill}%</div>
      <div style="font-size:12px;color:var(--text2)">Average</div>
    </div>`;
  }
}


// ==========================================
// ALERTS & FILTERS
// ==========================================

function generateAlerts() {
  const alertsContainer = document.getElementById('alertsList');
  if (!alertsContainer) return;
  
  const criticalBins = binsData.filter(b => b.fill >= 80);
  
  const alertBadge = document.getElementById('alertBadge');
  if (alertBadge) alertBadge.innerText = criticalBins.length;
  
  if (criticalBins.length === 0) {
    alertsContainer.innerHTML = '<div class="alert-card"><i class="fas fa-check-circle" style="color:var(--green)"></i><div class="alert-info"><h4>All clear</h4><p>No critical bins</p></div></div>';
    return;
  }
  
  let html = '';
  criticalBins.forEach(bin => {
    html += `<div class="alert-card">
      <i class="fas fa-exclamation-triangle" style="color:var(--red)"></i>
      <div class="alert-info">
        <h4>${bin.name} Critical</h4>
        <p>${bin.fill}% full — Needs collection</p>
      </div>
    </div>`;
  });
  alertsContainer.innerHTML = html;
}

let _currentFilter = 'all';
function filterBins(type, btn) {
  _currentFilter = type;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  applyFilters();
}

let _searchTerm = '';
function searchBins(term) {
  _searchTerm = term.toLowerCase();
  applyFilters();
}

function applyFilters() {
  const cards = document.querySelectorAll('#binDetailGrid .bin-detail-card');
  cards.forEach(card => {
    const fillEl = card.querySelector('.bin-detail-fill');
    if (!fillEl) return;
    const fill = parseInt(fillEl.innerText);
    const nameEl = card.querySelector('.bin-detail-name');
    const name = nameEl ? nameEl.innerText.toLowerCase() : '';
    
    let typeMatch = false;
    if (_currentFilter === 'all') typeMatch = true;
    else if (_currentFilter === 'critical' && fill >= 80) typeMatch = true;
    else if (_currentFilter === 'warning' && fill >= 60 && fill < 80) typeMatch = true;
    else if (_currentFilter === 'normal' && fill > 0 && fill < 60) typeMatch = true;
    else if (_currentFilter === 'empty' && fill === 0) typeMatch = true;
    
    const searchMatch = name.includes(_searchTerm);
    
    if (typeMatch && searchMatch) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });
}

// ==========================================
// REWARDS (INTENT SYSTEM)
// ==========================================

let activeIntent = null;
function checkFillSpikeIntent(bin, increase, currentFill) {
  console.log(`[REWARD DEBUG] Checking spike for ${bin.id}. Increase: ${increase}, Current: ${currentFill}`);
  
  if (typeof currentRole !== 'undefined' && currentRole !== 'citizen') {
    console.warn(`[REWARD DEBUG] Skipped: Role is ${currentRole}, not citizen.`);
    return;
  }
  
  if (activeIntent && activeIntent.binId === bin.id) {
    const elapsed = Date.now() - activeIntent.startTime;
    console.log(`[REWARD DEBUG] Active intent found for ${bin.id}. Elapsed: ${Math.round(elapsed/1000)}s`);
    
    // Only valid if within 90s
    if (elapsed < 90000) {
      const initial = Number(activeIntent.initialFill) || 0;
      const current = Number(currentFill) || 0;
      const realIncrease = current - initial;
      
      console.log(`[REWARD DEBUG] Math: ${current} (current) - ${initial} (initial) = ${realIncrease} (realIncrease)`);

      if (realIncrease > 0) {
        showToast(`Waste detected! +${realIncrease} points!`, "success");
        console.log(`[REWARD SUCCESS] Awarding ${realIncrease} points for ${bin.id}`);
        
        activeIntent = null;
        
        const statusEl = document.getElementById('active-reward-status');
        if (statusEl) {
          statusEl.innerHTML = `<i class="fas fa-check-circle"></i> Waste detected! +${realIncrease} points credited.`;
          statusEl.style.borderColor = '#22c55e';
          statusEl.style.background = 'rgba(34, 197, 94, 0.1)';
          setTimeout(() => { 
            if (statusEl.parentElement) statusEl.parentElement.innerHTML = ''; 
          }, 8000);
        }
        
        if (typeof awardPoints === 'function') awardPoints(bin, realIncrease);
      } else {
        console.log(`[REWARD DEBUG] No real increase from initial level (${initial}).`);
      }
    } else {
      console.warn(`[REWARD DEBUG] Intent expired for ${bin.id}`);
      activeIntent = null;
    }
  } else {
    if (activeIntent) console.log(`[REWARD DEBUG] Intent mismatch: Waiting for ${activeIntent.binId}, but got spike on ${bin.id}`);
  }
}


// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'info-circle';
  if (type === 'success') icon = 'check-circle';
  if (type === 'warning') icon = 'exclamation-triangle';
  if (type === 'error') icon = 'times-circle';
  
  toast.innerHTML = `<i class="fas fa-${icon}"></i> ${message}`;
  toast.style.padding = '12px 20px';
  toast.style.background = 'var(--surface2)';
  toast.style.borderLeft = `4px solid var(--${type === 'error' ? 'red' : type === 'warning' ? 'yellow' : type === 'success' ? 'green' : 'accent'})`;
  toast.style.borderRadius = '4px';
  toast.style.marginBottom = '10px';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
  toast.style.color = 'var(--text)';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '10px';
  toast.style.fontSize = '14px';
  toast.style.animation = 'slideIn 0.3s ease-out forwards';
  
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}


// ==========================================
// THEME
// ==========================================
function toggleTheme() {
  document.body.classList.toggle('light-mode');
  const isLight = document.body.classList.contains('light-mode');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  const icon = document.querySelector('#themeToggleBtn i');
  if (icon) {
    icon.className = isLight ? 'fas fa-sun' : 'fas fa-moon';
  }
  
  // Update map tiles
  const style = isLight ? 'light_all' : 'dark_all';
  const url = `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`;
  if (mainTileLayer) mainTileLayer.setUrl(url);
  if (miniTileLayer) miniTileLayer.setUrl(url);
}


// ==========================================
// MAP CONTROLS
// ==========================================
function clearRoute() {
  if (routeLayer) {
    mainMap.removeLayer(routeLayer);
    routeLayer = null;
  }
  
  if (_vehicleMarker) {
    _vehicleMarker.setLatLng([LPU_CENTER[0], LPU_CENTER[1]]);
  }
  window._customDepot = null;
  
  const btn = document.querySelector('.map-ctrl-btn.green');
  if (btn) btn.innerHTML = '<i class="fas fa-route"></i><span>Optimize Route</span>';
  
  document.getElementById('routeStats').style.display = 'none';
  
  document.getElementById('routeList').innerHTML = `
    <div class="empty-state" style="padding:20px;text-align:center;color:var(--text2)">
      <i class="fas fa-route" style="font-size:32px;margin-bottom:10px;opacity:0.3"></i>
      <p>No active route.<br>Click "Optimize Route" to generate one.</p>
    </div>
  `;
}

// ==========================================
// MAP FILTER & FULLSCREEN
// ==========================================
function mapFilter(type, btn) {
  document.querySelectorAll('.map-controls .map-ctrl-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  
  Object.entries(mainMarkers).forEach(([id, marker]) => {
    const bin = binsData.find(b => b.id === id);
    if (!bin) return;
    if (type === 'all') {
      marker.setOpacity(1);
    } else if (type === 'pickup') {
      marker.setOpacity(bin.fill >= 60 ? 1 : 0.2);
    }
  });
}

function toggleMapFullscreen() {
  const layout = document.getElementById('mapLayout');
  const header = document.getElementById('mapPageHeader');
  const controls = document.getElementById('mapControls');
  const btn = document.getElementById('fsBtn');
  
  if (!layout) return;
  layout.classList.toggle('map-fullscreen');
  document.body.classList.toggle('map-is-fullscreen');
  
  const isFS = layout.classList.contains('map-fullscreen');
  if (header) header.style.display = isFS ? 'none' : '';
  
  if (controls) {
    if (isFS) {
      controls.classList.add('map-fullscreen-controls');
    } else {
      controls.classList.remove('map-fullscreen-controls');
    }
  }
  
  if (btn) {
    btn.innerHTML = isFS
      ? '<i class="fas fa-compress"></i>'
      : '<i class="fas fa-expand"></i>';
    btn.title = isFS ? 'Exit Fullscreen' : 'Fullscreen';
  }
    
  setTimeout(() => { if (mainMap) mainMap.invalidateSize(); }, 200);
}

// ──────────────────────────────────────────────
//  MISSING UI FUNCTIONS
// ──────────────────────────────────────────────
function filterAlerts(type, btn) {
  document.querySelectorAll('#page-alerts .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  generateAlerts(); // Filter logic can be improved later
}

function clearAlerts() {
  const container = document.getElementById('alertsList');
  if (container) {
    container.innerHTML = '<div class="empty-state" style="padding:40px; text-align:center; color:var(--text2)"><i class="fas fa-check-circle" style="font-size:32px; margin-bottom:10px; color:var(--green); opacity:0.3"></i><p>All alerts cleared.</p></div>';
  }
  const badge = document.getElementById('alertBadge');
  if (badge) badge.innerText = '0';
}

function fetchLeaderboard() {
  const icon = document.getElementById('lbRefreshIcon');
  const lbBody = document.getElementById('leaderboardBody');
  if (icon) icon.classList.add('fa-spin');
  
  // Mock leaderboard data
  const mockLB = [
    { rank: 1, user: "Rohan_LPU", points: 4520, badge: "🏆 Champ" },
    { rank: 2, user: "Simran_K", points: 3890, badge: "⭐ Elite" },
    { rank: 3, user: "Nihal_Eco", points: userPoints, badge: "🔥 You" },
    { rank: 4, user: "Amit_99", points: 2150, badge: "🌱 Pro" },
    { rank: 5, user: "Sneha_02", points: 1840, badge: "🍃 Active" }
  ].sort((a, b) => b.points - a.points);

  setTimeout(() => {
    if (icon) icon.classList.remove('fa-spin');
    if (lbBody) {
      lbBody.innerHTML = mockLB.map((u, i) => `
        <tr ${u.user.includes('You') ? 'style="background:rgba(255,255,255,0.05)"' : ''}>
          <td data-label="Rank" style="font-weight:700">${i + 1}</td>
          <td data-label="Resident">
            <div style="display:flex; align-items:center; gap:10px">
              <div class="user-avatar" style="width:28px; height:28px; font-size:12px">${u.user.charAt(0)}</div>
              <div>
                <div style="font-weight:600; font-size:13px">${u.user}</div>
                <div style="font-size:10px; color:var(--text2)">${u.badge}</div>
              </div>
            </div>
          </td>
          <td data-label="Points" style="font-weight:700; color:var(--accent)">${u.points.toLocaleString()}</td>
        </tr>
      `).join('');
    }
    showToast("Leaderboard updated!", "success");
    updateRewardsUI();
  }, 800);
}

function awardPoints(bin, increase) {
  userPoints += increase; // 1 point per 1% fill
  const history = {
    time: new Date().toLocaleString('en-IN'),
    binName: bin.name,
    volume: increase + '%',
    points: increase,
    status: 'Earned'
  };
  rewardHistory.unshift(history);
  if (rewardHistory.length > 20) rewardHistory.pop();
  
  localStorage.setItem(`ecoTrack_points_${currentUser}`, userPoints);
  localStorage.setItem(`ecoTrack_history_${currentUser}`, JSON.stringify(rewardHistory));
  updateRewardsUI();
  showToast(`EcoPoints Earned! +${increase} for cleaning ${bin.name}`, 'success');
}

function updateRewardsUI() {
  const ptsEl = document.getElementById('userPoints');
  const historyBody = document.getElementById('rewardHistoryBody');

  if (ptsEl) {
    ptsEl.innerText = userPoints.toLocaleString();
    ptsEl.classList.add('pulse'); // Visual feedback
    setTimeout(() => ptsEl.classList.remove('pulse'), 500);
  }

  if (historyBody) {
    if (rewardHistory.length === 0) {
      historyBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:40px; color:var(--text2)">No disposal history yet. Start cleaning!</td></tr>';
    } else {
      historyBody.innerHTML = rewardHistory.map(h => `
        <tr>
          <td data-label="Date">${h.time}</td>
          <td data-label="Bin">${h.binName}</td>
          <td data-label="Volume">${h.volume}</td>
          <td data-label="Points" style="color:var(--green); font-weight:700">+${h.points}</td>
        </tr>
      `).join('');
    }
  }
}

