/**
 * Route Optimizer Module — Research Paper Architecture
 * =====================================================
 *
 * Two-phase routing pipeline with REAL ROAD DISTANCES:
 *
 *   Phase 1: ORS Matrix API (or Dijkstra fallback)  →  Distance Matrix
 *   Phase 2: Nearest Neighbor                        →  Build final route
 *   Phase 3: ORS Directions API                      →  Road geometry for map
 *
 * Architecture:
 *   [Critical Bins + Depot]
 *        ↓
 *   fetchRoadDistanceMatrix()  → Real road distances via OpenRouteService
 *        ↓  (fallback: buildGraph() → dijkstra() → Euclidean matrix)
 *        ↓
 *   nearestNeighborRoute()     → Greedy tour using matrix lookups
 *        ↓
 *   fetchRouteGeometry()       → Actual road path for map rendering
 *        ↓
 *   [Optimized Route + Road Geometry]
 */

const { fetchRoadDistanceMatrix, fetchRouteGeometry } = require('./orsService');

// ──────────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────────

/** Depot — LPU Phagwara campus center (collection truck start/end) */
const DEPOT = {
  id: 'depot',
  lat: 31.2559,
  lng: 75.7050,
  label: 'Collection Depot — LPU Phagwara',
};

// ──────────────────────────────────────────────
//  1. Euclidean Distance (fallback)
// ──────────────────────────────────────────────

/**
 * Calculate Euclidean distance between two geographic points.
 * Used as fallback when ORS API is unavailable.
 *
 * @param {Object} a - Point A { lat, lng }
 * @param {Object} b - Point B { lat, lng }
 * @returns {number} Euclidean distance
 */
function euclideanDistance(a, b) {
  const dLat = a.lat - b.lat;
  const dLng = a.lng - b.lng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ──────────────────────────────────────────────
//  2. Graph Construction (Euclidean fallback)
// ──────────────────────────────────────────────

/**
 * Build a complete weighted graph using Euclidean distances.
 * Used when ORS API is unavailable.
 *
 * @param {Array} nodes - Array of { id, lat, lng }
 * @returns {Object} Adjacency list { nodeId: { neighborId: weight } }
 */
function buildGraph(nodes) {
  const graph = {};

  for (const node of nodes) {
    graph[node.id] = {};
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const weight = euclideanDistance(nodes[i], nodes[j]);
      graph[nodes[i].id][nodes[j].id] = weight;
      graph[nodes[j].id][nodes[i].id] = weight;
    }
  }

  return graph;
}

// ──────────────────────────────────────────────
//  3. Dijkstra's Algorithm (Euclidean fallback)
// ──────────────────────────────────────────────

/**
 * Dijkstra's Algorithm — shortest distances from source to all nodes.
 * Used when ORS API is unavailable.
 *
 * @param {Object} graph - Adjacency list
 * @param {string} sourceId - Source node ID
 * @returns {Object} { nodeId: distance }
 */
function dijkstra(graph, sourceId) {
  const distances = {};
  const visited = {};

  for (const nodeId of Object.keys(graph)) {
    distances[nodeId] = Infinity;
    visited[nodeId] = false;
  }
  distances[sourceId] = 0;

  const nodeCount = Object.keys(graph).length;

  for (let i = 0; i < nodeCount; i++) {
    let currentId = null;
    let currentDist = Infinity;

    for (const nodeId of Object.keys(graph)) {
      if (!visited[nodeId] && distances[nodeId] < currentDist) {
        currentId = nodeId;
        currentDist = distances[nodeId];
      }
    }

    if (currentId === null) break;
    visited[currentId] = true;

    for (const [neighborId, weight] of Object.entries(graph[currentId])) {
      if (!visited[neighborId]) {
        const newDist = distances[currentId] + weight;
        if (newDist < distances[neighborId]) {
          distances[neighborId] = newDist;
        }
      }
    }
  }

  console.log(`  📍 Dijkstra from "${sourceId}" → ${Object.keys(distances).length - 1} nodes`);
  return distances;
}

// ──────────────────────────────────────────────
//  4. Euclidean Distance Matrix (fallback)
// ──────────────────────────────────────────────

/**
 * Build NxN distance matrix using Dijkstra on Euclidean graph.
 * Fallback when ORS API is unavailable.
 *
 * @param {Array} nodes - Array of { id, lat, lng }
 * @returns {Object} Distance matrix { nodeId: { nodeId: distance } }
 */
function buildEuclideanDistanceMatrix(nodes) {
  console.log(`\n🔢 Building ${nodes.length}×${nodes.length} Euclidean distance matrix (fallback)...`);

  const graph = buildGraph(nodes);
  const matrix = {};

  for (const node of nodes) {
    matrix[node.id] = dijkstra(graph, node.id);
  }

  console.log(`✅ Euclidean distance matrix complete\n`);
  return matrix;
}

// ──────────────────────────────────────────────
//  5. Nearest Neighbor (Matrix-Based)
// ──────────────────────────────────────────────

/**
 * Nearest Neighbor heuristic using pre-computed distance matrix.
 * Works with both ORS road distances and Euclidean fallback.
 *
 * @param {string} startId - Depot ID
 * @param {Array} nodes - Bins to visit { id, lat, lng }
 * @param {Object} distanceMatrix - NxN distances
 * @returns {Object} { orderedRoute: [ids], totalDistance: number }
 */
function nearestNeighborRoute(startId, nodes, distanceMatrix) {
  const unvisited = nodes.map((n) => n.id);
  const orderedRoute = [startId];
  let currentId = startId;
  let totalDistance = 0;

  console.log(`🚛 Running Nearest Neighbor from "${startId}"...`);

  while (unvisited.length > 0) {
    let nearestId = null;
    let nearestDist = Infinity;

    for (const candidateId of unvisited) {
      const dist = distanceMatrix[currentId][candidateId];
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = candidateId;
      }
    }

    if (nearestId === null) break;

    totalDistance += nearestDist;
    orderedRoute.push(nearestId);
    currentId = nearestId;
    unvisited.splice(unvisited.indexOf(nearestId), 1);

    console.log(`  → ${nearestId} (distance: ${nearestDist.toFixed(4)})`);
  }

  // Return to depot
  const returnDist = distanceMatrix[currentId][startId];
  totalDistance += returnDist;
  orderedRoute.push(startId);

  console.log(`  → back to ${startId} (distance: ${returnDist.toFixed(4)})`);
  console.log(`📏 Total route distance: ${totalDistance.toFixed(4)}\n`);

  return { orderedRoute, totalDistance };
}

// ──────────────────────────────────────────────
//  6. Main Entry Point (ASYNC)
// ──────────────────────────────────────────────

/**
 * Compute the optimized waste collection route.
 *
 * Full pipeline:
 *   1. Filter bins above the fill threshold
 *   2. Try ORS Matrix API for real road distances
 *   3. Fall back to Dijkstra + Euclidean if ORS fails
 *   4. Run Nearest Neighbor using distance matrix
 *   5. Fetch road geometry from ORS for map rendering
 *   6. Return route with geometry
 *
 * @param {Array} allBins - Array of all bin objects from DB
 * @param {number} [threshold=80] - Fill % threshold for bin collection
 * @param {Object} [depotOverride] - Dynamic depot { lat, lng } from truck position
 * @returns {Promise<Object>} Route data with waypoints, distance, geometry
 */
async function computeOptimizedRoute(allBins, threshold = 80, depotOverride = null) {
  // Use dynamic depot if provided, otherwise default
  const depot = depotOverride
    ? { id: 'depot', lat: depotOverride.lat, lng: depotOverride.lng, label: 'Collection Truck Start' }
    : DEPOT;
  // Filter bins dynamically using the threshold
  const targetBins = allBins.filter((bin) => bin.fill >= threshold);

  console.log('═══════════════════════════════════════════');
  console.log('🗺️  ROUTE OPTIMIZATION — Road Network Pipeline');
  console.log('═══════════════════════════════════════════');
  console.log(`📊 Threshold: ${threshold}% | Bins matching: ${targetBins.length}`);

  // No matching bins → return early
  if (targetBins.length === 0) {
    console.log('⚡ No bins above threshold — skipping route computation.\n');
    return {
      route: [depot],
      totalDistance: 0,
      message: `No bins to collect. All bins are below ${threshold}% fill.`,
      binCount: 0,
      threshold,
      algorithm: 'none',
      geometry: null,
      distanceSource: 'none',
    };
  }

  // ── Step 1: Assemble all nodes (depot + target bins) ──
  const allNodes = [depot, ...targetBins];
  console.log(`📌 Nodes in graph: ${allNodes.length} (1 depot + ${targetBins.length} bins)`);

  // ── Step 2: Get distance matrix (ORS road distances → Euclidean fallback) ──
  let distanceMatrix = null;
  let distanceSource = 'euclidean';

  // Try ORS Matrix API first
  distanceMatrix = await fetchRoadDistanceMatrix(allNodes);

  if (distanceMatrix) {
    distanceSource = 'openrouteservice';
    console.log('🛣️  Using REAL road distances from OpenRouteService');
  } else {
    // Fallback to Euclidean + Dijkstra
    distanceMatrix = buildEuclideanDistanceMatrix(allNodes);
    console.log('📐 Using Euclidean distances (ORS unavailable)');
  }

  // ── Step 3: Run Nearest Neighbor ──
  const { orderedRoute, totalDistance } = nearestNeighborRoute(
    depot.id,
    targetBins,
    distanceMatrix
  );

  // ── Step 4: Build full route with bin data ──
  const nodeMap = {};
  for (const node of allNodes) {
    nodeMap[node.id] = node;
  }
  const fullRoute = orderedRoute.map((id) => nodeMap[id]);

  // ── Step 5: Fetch road geometry for map rendering ──
  let geometry = null;
  let routeDistanceKm = null;
  let routeDurationMin = null;

  const geometryResult = await fetchRouteGeometry(fullRoute);

  if (geometryResult) {
    geometry = geometryResult.geometry;
    routeDistanceKm = geometryResult.distanceKm;
    routeDurationMin = geometryResult.durationMin;
  }

  // ── Step 6: Also compute Euclidean for comparison ──
  const euclideanDist = computeDirectNNDistance(targetBins, depot);

  console.log('📊 COMPARISON:');
  console.log(`  Distance source:          ${distanceSource}`);
  if (distanceSource === 'openrouteservice') {
    console.log(`  Road distance (NN total): ${totalDistance.toFixed(4)} km`);
    console.log(`  Road distance (actual):   ${routeDistanceKm || 'N/A'} km`);
    console.log(`  Estimated duration:       ${routeDurationMin || 'N/A'} min`);
  }
  console.log(`  Euclidean NN (baseline):  ${euclideanDist.toFixed(6)} (coordinate units)`);
  console.log('═══════════════════════════════════════════\n');

  // Build distance display string
  const distanceDisplay = routeDistanceKm
    ? `${routeDistanceKm} km`
    : `${totalDistance.toFixed(4)} ${distanceSource === 'openrouteservice' ? 'km' : 'units'}`;

  const durationDisplay = routeDurationMin
    ? ` (~${routeDurationMin} min)`
    : '';

  return {
    route: fullRoute,
    totalDistance: parseFloat(totalDistance.toFixed(6)),
    routeDistanceKm,
    routeDurationMin,
    geometry,        // Array of [lat, lng] for actual road path (or null)
    message: `Optimized route: ${targetBins.length} bin(s), ${distanceDisplay}${durationDisplay} via ${distanceSource === 'openrouteservice' ? 'road network' : 'Euclidean'}. (threshold: ${threshold}%)`,
    binCount: targetBins.length,
    algorithm: 'dijkstra+nn',
    threshold,
    distanceSource,
    nodesInGraph: allNodes.length,
  };
}

// ──────────────────────────────────────────────
//  7. Direct NN (for comparison only)
// ──────────────────────────────────────────────

/**
 * Old-style direct Euclidean NN distance for comparison/debugging.
 */
function computeDirectNNDistance(criticalBins, depot = DEPOT) {
  const unvisited = [...criticalBins];
  let current = depot;
  let totalDist = 0;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const d = euclideanDistance(current, unvisited[i]);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    current = unvisited[nearestIdx];
    totalDist += nearestDist;
    unvisited.splice(nearestIdx, 1);
  }

  totalDist += euclideanDistance(current, depot);
  return totalDist;
}

// ──────────────────────────────────────────────
//  Exports
// ──────────────────────────────────────────────

module.exports = {
  computeOptimizedRoute,
  DEPOT,
  euclideanDistance,
  buildGraph,
  dijkstra,
  buildEuclideanDistanceMatrix,
  nearestNeighborRoute,
};
