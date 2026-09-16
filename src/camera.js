import * as Cesium from 'cesium';

/**
 * Camera presets for notable locations.
 * Phase 1 default: fly to Austin, TX on load.
 */
export const CAMERA_PRESETS = {
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Set camera over a city on load with a cinematic fly-in.
 */
export function flyToCity(viewer, { lng, lat }) {
  // Start from a high altitude, then fly down
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, 25000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  // Cinematic fly-in after a brief pause
  setTimeout(() => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, 600),
      orientation: {
        heading: Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(-30),
        roll: 0.0,
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
}

export function flyToAustin(viewer) {
  flyToCity(viewer, { lng: -97.7431, lat: 30.2672 });
}

/**
 * Pre-load 3D tiles for a city by flying through waypoints at decreasing
 * altitudes. This forces the tile provider to fetch and cache tiles for
 * the area in the browser's HTTP cache, so subsequent loads are instant.
 *
 * The sweep visits the city center and its bounds at three altitudes
 * (high overview → mid approach → low detail), with a slow orbit at the
 * lowest altitude to capture surrounding tiles.
 *
 * @param {Cesium.Viewer} viewer
 * @param {{lng: number, lat: number, label?: string}} center
 * @param {{sw: {lat: number, lng: number}, ne: {lat: number, lng: number}}} [bounds]
 * @returns {Promise<boolean>} True when the sweep completed; false when the
 *   user interrupted it (any waypoint flyTo cancelled), so callers can stop
 *   the chain instead of dragging the camera away from wherever the user went.
 */
export function preloadArea(viewer, center, bounds) {
  const { lng, lat, label } = center;
  const sw = bounds?.sw || { lat: lat - 0.03, lng: lng - 0.03 };
  const ne = bounds?.ne || { lat: lat + 0.03, lng: lng + 0.03 };

  // Waypoints: high overview → corners → center at decreasing altitude
  const waypoints = [
    { lng, lat, alt: 8000, pitch: -90, heading: 0, dur: 0 },      // snap to high overview
    { lng: sw.lng, lat: sw.lat, alt: 3000, pitch: -45, heading: 30, dur: 3 },  // SW corner
    { lng: ne.lng, lat: ne.lat, alt: 2000, pitch: -40, heading: 120, dur: 3 }, // NE corner
    { lng: sw.lng, lat: ne.lat, alt: 1500, pitch: -35, heading: 210, dur: 3 }, // NW corner
    { lng: ne.lng, lat: sw.lat, alt: 1500, pitch: -35, heading: 300, dur: 3 }, // SE corner
    { lng, lat, alt: 800, pitch: -30, heading: 0, dur: 3 },      // center low
  ];

  console.info(`[Preload] Pre-loading 3D tiles for ${label || 'area'} (${lng.toFixed(3)}, ${lat.toFixed(3)})`);

  return new Promise((resolve) => {
    let i = 0;
    const flyNext = () => {
      if (i >= waypoints.length) {
        console.info('[Preload] Sweep complete');
        resolve(true);
        return;
      }
      const wp = waypoints[i++];
      const dest = Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.alt);
      if (wp.dur === 0) {
        viewer.camera.setView({
          destination: dest,
          orientation: {
            heading: Cesium.Math.toRadians(wp.heading),
            pitch: Cesium.Math.toRadians(wp.pitch),
            roll: 0,
          },
        });
        setTimeout(flyNext, 300);
      } else {
        viewer.camera.flyTo({
          destination: dest,
          orientation: {
            heading: Cesium.Math.toRadians(wp.heading),
            pitch: Cesium.Math.toRadians(wp.pitch),
            roll: 0,
          },
          duration: wp.dur,
          easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
          complete: () => setTimeout(flyNext, 200),
          cancel: () => {
            console.info('[Preload] Sweep cancelled by user input');
            resolve(false);
          },
        });
      }
    };
    flyNext();
  });
}
