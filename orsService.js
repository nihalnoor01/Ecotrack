/**
 * OpenRouteService API Service Module
 * ====================================
 *
 * Handles all ORS API calls:
 *   - Matrix API   → NxN real road distance matrix
 *   - Directions API → Road geometry for map rendering
 *
 * Returns null on failure so the optimizer can fall back to Euclidean.
 */

const ORS_BASE = 'https://api.openrouteservice.org';

/**
 * Get the ORS API key from environment.
 * @returns {string|null}
 */
function getApiKey() {
  return process.env.ORS_API_KEY || null;
}

// ──────────────────────────────────────────────
//  1. Matrix API — Real Road Distance Matrix
// ──────────────────────────────────────────────

/**
 * Fetch NxN road distance matrix from ORS Matrix API.
 *
 * @param {Array} nodes - Array of { id, lat, lng }
 * @returns {Promise<Object|null>} Distance matrix { nodeId: { nodeId: distanceKm } } or null
 */
async function fetchRoadDistanceMatrix(nodes) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log('⚠️  ORS_API_KEY not set — skipping road distance matrix');
    return null;
  }

  try {
    // ORS expects coordinates as [lng, lat] (GeoJSON order)
    const locations = nodes.map(n => [n.lng, n.lat]);

    const url = `${ORS_BASE}/v2/matrix/driving-car`;
    const body = JSON.stringify({
      locations,
      metrics: ['distance'],
      units: 'km',
    });

    console.log(`\n🛣️  Fetching ${nodes.length}×${nodes.length} road distance matrix from ORS...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ ORS Matrix API error (${response.status}): ${errText}`);
      return null;
    }

    const data = await response.json();
    const distances = data.distances; // 2D array [i][j] in km

    if (!distances || distances.length === 0) {
      console.error('❌ ORS Matrix API returned empty distances');
      return null;
    }

    // Convert 2D array to { nodeId: { nodeId: distance } } format
    const matrix = {};
    for (let i = 0; i < nodes.length; i++) {
      matrix[nodes[i].id] = {};
      for (let j = 0; j < nodes.length; j++) {
        matrix[nodes[i].id][nodes[j].id] = distances[i][j];
      }
    }

    console.log(`✅ ORS road distance matrix complete (${nodes.length}×${nodes.length})`);
    return matrix;

  } catch (err) {
    console.error('❌ ORS Matrix API request failed:', err.message);
    return null;
  }
}

// ──────────────────────────────────────────────
//  2. Directions API — Road Geometry
// ──────────────────────────────────────────────

/**
 * Fetch actual road geometry from ORS Directions API.
 *
 * @param {Array} orderedRoute - Ordered array of { id, lat, lng } (including depot at start/end)
 * @returns {Promise<Object|null>} { geometry: [[lat,lng],...], distanceKm, durationMin } or null
 */
async function fetchRouteGeometry(orderedRoute) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log('⚠️  ORS_API_KEY not set — skipping road geometry');
    return null;
  }

  try {
    // ORS expects coordinates as [lng, lat]
    const coordinates = orderedRoute.map(n => [n.lng, n.lat]);

    const url = `${ORS_BASE}/v2/directions/driving-car`;
    const body = JSON.stringify({
      coordinates,
    });

    console.log(`🗺️  Fetching road geometry for ${orderedRoute.length} waypoints from ORS...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/geo+json',
      },
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ ORS Directions API error (${response.status}): ${errText}`);
      return null;
    }

    const data = await response.json();

    // Extract geometry from GeoJSON response
    if (!data.routes || data.routes.length === 0) {
      console.error('❌ ORS Directions API returned no routes');
      return null;
    }

    const route = data.routes[0];
    const summary = route.summary;
    const distanceKm = parseFloat((summary.distance / 1000).toFixed(2));
    const durationMin = parseFloat((summary.duration / 60).toFixed(1));

    // Decode geometry — ORS returns encoded polyline by default
    // With GeoJSON format, it returns coordinates directly
    let geometry = [];

    if (route.geometry) {
      if (typeof route.geometry === 'string') {
        // Encoded polyline — decode it
        geometry = decodePolyline(route.geometry);
      } else if (route.geometry.coordinates) {
        // GeoJSON format — coordinates are [lng, lat], convert to [lat, lng]
        geometry = route.geometry.coordinates.map(c => [c[1], c[0]]);
      }
    }

    console.log(`✅ Road geometry: ${geometry.length} points, ${distanceKm} km, ${durationMin} min`);

    return {
      geometry,      // Array of [lat, lng] for Leaflet
      distanceKm,
      durationMin,
    };

  } catch (err) {
    console.error('❌ ORS Directions API request failed:', err.message);
    return null;
  }
}

// ──────────────────────────────────────────────
//  3. Polyline Decoder (Google Encoded Polyline)
// ──────────────────────────────────────────────

/**
 * Decode a Google Encoded Polyline string to array of [lat, lng].
 * ORS uses this format by default for geometry.
 *
 * @param {string} encoded - Encoded polyline string
 * @returns {Array} Array of [lat, lng]
 */
function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let b, shift = 0, result = 0;

    // Decode latitude
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    // Decode longitude
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

// ──────────────────────────────────────────────
//  Exports
// ──────────────────────────────────────────────

module.exports = {
  fetchRoadDistanceMatrix,
  fetchRouteGeometry,
};
