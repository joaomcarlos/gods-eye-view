import * as Cesium from 'cesium';
import { registerPickOwner, unregisterPickOwner, isOwnedByOtherLayer } from './pickRegistry.js';
import { bindTrackingClickGesture } from './trackingClickGesture.js';

/**
 * Portuguese real estate listings from the Minha Morada API (free, public).
 * Aggregates ~10,500 listings from Imovirtual, Idealista, and RE/MAX.
 * Updated weekly. 100 requests/hour per IP (proxied + cached server-side).
 *
 * Renders property markers as billboards on the globe. Clicking a marker
 * selects it and pushes the full listing (photos, price, area, typology)
 * to the UI panel via the subscribe() mechanism.
 */

const API_ENDPOINT = '/api/properties';
const PROPERTIES_PREFIX = 'prop:';
const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Green house icon (SVG → data URI)
const HOUSE_ICON = 'data:image/svg+xml;base64,' + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
  '<path d="M16 4 L4 14 L7 14 L7 27 L25 27 L25 14 L28 14 Z" fill="#22c55e" stroke="#16a34a" stroke-width="1.5"/>' +
  '<rect x="13" y="18" width="6" height="9" fill="#16a34a"/>' +
  '</svg>'
);

const HOUSE_ICON_ACTIVE = 'data:image/svg+xml;base64,' + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
  '<path d="M16 4 L4 14 L7 14 L7 27 L25 27 L25 14 L28 14 Z" fill="#facc15" stroke="#eab308" stroke-width="1.5"/>' +
  '<rect x="13" y="18" width="6" height="9" fill="#eab308"/>' +
  '</svg>'
);

const IDLE_COLOR = Cesium.Color.WHITE.withAlpha(0.9);
const ACTIVE_COLOR = Cesium.Color.WHITE.withAlpha(1.0);

let _dataSource = null;
let _billboards = null;
let _billboardByPropId = new Map(); // propId → Billboard
let _clickHandler = null;
let _viewer = null;
let _enabled = false;
let _count = 0;
let _lastUpdate = null;
let _lastError = null;
let _activePropertyId = null;
let _properties = []; // raw listing data keyed by id
let _propertiesById = new Map();
let _listeners = new Set();

function notifyListeners() {
  const state = getUIState();
  for (const cb of _listeners) {
    try { cb(state); } catch { /* no-op */ }
  }
}

function getUIState() {
  const active = _activePropertyId ? _propertiesById.get(_activePropertyId) : null;
  return {
    enabled: _enabled,
    count: _count,
    lastUpdate: _lastUpdate,
    error: _lastError,
    activePropertyId: _activePropertyId,
    activeProperty: active ? formatPropertyForUI(active) : null,
    properties: _properties.slice(0, 200).map(formatPropertyForUI),
  };
}

function formatPropertyForUI(p) {
  return {
    id: p.id,
    title: p.title || '',
    price: p.price || null,
    priceType: p.price_type || 'sale',
    typology: p.typology || '',
    bedrooms: p.bedrooms ?? null,
    bathrooms: p.bathrooms ?? null,
    areaGross: p.area_gross ?? null,
    areaNet: p.area_net ?? null,
    floor: p.floor || null,
    hasElevator: !!p.has_elevator,
    hasParking: !!p.has_parking,
    hasGarden: !!p.has_garden,
    energyCert: p.energy_cert || null,
    condition: p.condition || 'unknown',
    address: p.address || '',
    parish: p.parish || '',
    municipality: p.municipality || '',
    district: p.district || '',
    lat: p.lat,
    lng: p.lng,
    photos: Array.isArray(p.photos) ? p.photos : [],
    url: p.url || '',
    sourceUrl: p.source_url || '',
  };
}

function extractPickedPropertyId(picked) {
  if (!picked) return null;
  const rawId = typeof picked.id === 'string' ? picked.id
    : typeof picked.primitive?.id === 'string' ? picked.primitive.id : null;
  if (!rawId || !rawId.startsWith(PROPERTIES_PREFIX)) return null;
  return rawId.slice(PROPERTIES_PREFIX.length);
}

const propertiesLayer = {
  id: 'properties',
  name: 'Properties (PT)',
  icon: '🏠',
  source: 'Minha Morada',
  updateInterval: UPDATE_INTERVAL,

  init(viewer) {
    _viewer = viewer;
    _dataSource = new Cesium.CustomDataSource('properties');
    _dataSource.show = false;
    viewer.dataSources.add(_dataSource);

    _billboards = new Cesium.BillboardCollection();
    viewer.scene.primitives.add(_billboards);

    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    bindTrackingClickGesture(_clickHandler, (click) => {
      if (!_enabled) return;
      const picked = viewer.scene.pick(click.position);
      const propId = extractPickedPropertyId(picked);
      if (propId) {
        if (isOwnedByOtherLayer('properties', PROPERTIES_PREFIX + propId)) return;
        selectProperty(propId);
        return;
      }
      // Click on empty space deselects
      if (_activePropertyId && !picked) {
        deselectProperty();
      }
    });

    _enabled = false;
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
  },

  enable(viewer) {
    _enabled = true;
    registerPickOwner('properties', (pickedId) => typeof pickedId === 'string' && pickedId.startsWith(PROPERTIES_PREFIX));
    if (_dataSource) _dataSource.show = true;
    if (_billboards) _billboards.show = true;
    notifyListeners();
  },

  disable(viewer) {
    _enabled = false;
    if (_dataSource) _dataSource.show = false;
    if (_billboards) _billboards.show = false;
    unregisterPickOwner('properties');
    _activePropertyId = null;
    notifyListeners();
  },

  async update(viewer, { signal } = {}) {
    if (!_enabled) return false;
    try {
      // Fetch properties for all configured Portuguese districts
      const districts = ['Lisboa', 'Porto', 'Faro', 'Setúbal', 'Braga', 'Coimbra', 'Aveiro', 'Leiria'];
      const allProperties = [];
      const seen = new Set();

      for (const district of districts) {
        if (signal?.aborted) return false;
        const params = new URLSearchParams({
          price_type: 'sale',
          district,
          limit: '50',
          sort: 'scraped_at',
          dir: 'desc',
        });
        const resp = await fetch(`${API_ENDPOINT}?${params}`, { signal });
        if (!resp.ok) continue;
        const data = await resp.json();
        const listings = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
        for (const prop of listings) {
          if (!prop.id || seen.has(prop.id)) continue;
          if (!Number.isFinite(prop.lat) || !Number.isFinite(prop.lng)) continue;
          seen.add(prop.id);
          allProperties.push(prop);
        }
      }

      _properties = allProperties;
      _propertiesById = new Map(allProperties.map((p) => [p.id, p]));

      // Rebuild billboards
      _billboards.removeAll();
      _billboardByPropId.clear();
      for (const prop of allProperties) {
        const position = Cesium.Cartesian3.fromDegrees(prop.lng, prop.lat);
        const bb = _billboards.add({
          id: PROPERTIES_PREFIX + prop.id,
          image: HOUSE_ICON,
          position,
          color: IDLE_COLOR,
          width: 28,
          height: 28,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(500, 1.0, 2_000_000, 0.5),
        });
        _billboardByPropId.set(prop.id, bb);
      }

      _count = allProperties.length;
      _lastUpdate = Date.now();
      _lastError = null;
      notifyListeners();
      return true;
    } catch (e) {
      if (signal?.aborted) return false;
      console.warn('[Data:Properties] Fetch error:', e);
      _lastError = 'Minha Morada network error';
      notifyListeners();
      return false;
    }
  },

  destroy(viewer) {
    _enabled = false;
    unregisterPickOwner('properties');
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (_billboards) {
      viewer.scene.primitives.remove(_billboards);
      _billboards = null;
    }
    if (_dataSource) {
      viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
    }
    _properties = [];
    _propertiesById.clear();
    _billboardByPropId.clear();
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
    _activePropertyId = null;
    _listeners.clear();
  },

  getStats() {
    return {
      count: _count,
      lastUpdate: _lastUpdate,
      error: _lastError,
    };
  },

  subscribe(callback) {
    _listeners.add(callback);
    callback(getUIState());
    return () => _listeners.delete(callback);
  },

  getUIState() {
    return getUIState();
  },

  selectProperty(id) {
    if (!_propertiesById.has(id)) return false;
    // Update billboard icons
    if (_activePropertyId && _activePropertyId !== id) {
      const oldBb = _billboardByPropId.get(_activePropertyId);
      if (oldBb) {
        oldBb.image = HOUSE_ICON;
        oldBb.color = IDLE_COLOR;
      }
    }
    _activePropertyId = id;
    const bb = _billboardByPropId.get(id);
    if (bb) {
      bb.image = HOUSE_ICON_ACTIVE;
      bb.color = ACTIVE_COLOR;
    }
    notifyListeners();
    return true;
  },

  deselectProperty() {
    if (_activePropertyId) {
      const bb = _billboardByPropId.get(_activePropertyId);
      if (bb) {
        bb.image = HOUSE_ICON;
        bb.color = IDLE_COLOR;
      }
    }
    _activePropertyId = null;
    notifyListeners();
  },

  flyToProperty(id, duration = 2.0) {
    const prop = _propertiesById.get(id);
    if (!prop || !_viewer) return false;
    _viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(prop.lng, prop.lat, 800),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-35),
        roll: 0,
      },
      duration,
    });
    return this.selectProperty(id);
  },
};

export function selectProperty(id) {
  return propertiesLayer.selectProperty(id);
}

export function deselectProperty() {
  return propertiesLayer.deselectProperty();
}

export function flyToProperty(id, duration) {
  return propertiesLayer.flyToProperty(id, duration);
}

export default propertiesLayer;
