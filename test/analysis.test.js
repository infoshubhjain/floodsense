import test from 'node:test';
import assert from 'node:assert/strict';
import booleanIntersects from '@turf/boolean-intersects';
import {
  analyzeAssets,
  boundsOverlap,
  geometryBounds,
  LIMITS,
  summarize,
  validateAssets,
  validateGeometry,
  validateProviderZones
} from '../server/analysis.js';

const sample = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-93.27, 44.97],
        [-93.26, 44.97],
        [-93.26, 44.98],
        [-93.27, 44.98],
        [-93.27, 44.97]
      ]
    ]
  }
};
const zone = (coordinates, properties = { FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T' }) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Polygon', coordinates }
});

test('validates a bounded GeoJSON asset collection and reports mapped-zone intersections', () => {
  const assets = validateAssets({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Clinic' },
        geometry: { type: 'Point', coordinates: [-93.265, 44.975] }
      },
      {
        type: 'Feature',
        properties: { name: 'Library' },
        geometry: { type: 'Point', coordinates: [-93.255, 44.975] }
      }
    ]
  });
  const zones = [
    zone([
      [
        [-93.27, 44.97],
        [-93.26, 44.97],
        [-93.26, 44.98],
        [-93.27, 44.98],
        [-93.27, 44.97]
      ]
    ])
  ];
  const result = analyzeAssets(sample, zones, assets);
  assert.equal(result.uploadedCount, 2);
  assert.equal(result.withinAreaCount, 1);
  assert.equal(result.intersectingZoneCount, 1);
  assert.deepEqual(result.byZone, [{ zone: 'AE', assetCount: 1 }]);
  assert.equal(result.features[0].label, 'Clinic');
  assert.throws(() => validateAssets({ type: 'FeatureCollection', features: [] }), /1–500/);
});

test('rejects malformed provider flood-zone features rather than treating them as empty data', () => {
  assert.throws(
    () => validateProviderZones([{ type: 'Feature', properties: {}, geometry: null }]),
    /malformed flood-zone/
  );
  assert.deepEqual(validateProviderZones([]), []);
  assert.throws(() => validateProviderZones([zone([])]), /malformed polygon coordinates/);
  assert.throws(
    () =>
      validateProviderZones([
        zone([
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1]
          ]
        ])
      ]),
    /malformed polygon coordinates/
  );
  const detailed = Array.from({ length: 10_000 }, (_, i) => [
    Math.cos((i * 2 * Math.PI) / 10_000),
    Math.sin((i * 2 * Math.PI) / 10_000)
  ]);
  detailed.push(detailed[0]);
  assert.equal(validateProviderZones([zone([detailed])]).length, 1);
});

function laeaReferenceArea(ring) {
  const radians = Math.PI / 180;
  const radius = 6_371_008.8;
  const [lon0, lat0] = ring[0];
  const phi0 = lat0 * radians;
  const originLon = lon0 * radians;
  const projected = ring.map(([lon, lat]) => {
    const phi = lat * radians;
    const deltaLon = lon * radians - originLon;
    const k = Math.sqrt(
      2 / (1 + Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(deltaLon))
    );
    return [
      radius * k * Math.cos(phi) * Math.sin(deltaLon),
      radius *
        k *
        (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(deltaLon))
    ];
  });
  let doubledArea = 0;
  for (let i = 0; i < projected.length - 1; i++) {
    doubledArea += projected[i][0] * projected[i + 1][1] - projected[i + 1][0] * projected[i][1];
  }
  return Math.abs(doubledArea) / 2;
}

test('validates 2D EPSG:4326 point, line, and polygon input', () => {
  assert.equal(
    validateGeometry({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [-93, 44] }
    }).geometry.type,
    'Point'
  );
  assert.doesNotThrow(() =>
    validateGeometry({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [-93, 44],
          [-92, 45]
        ]
      }
    })
  );
  assert.doesNotThrow(() => validateGeometry(sample));
  assert.throws(
    () => validateGeometry({ ...sample, geometry: { type: 'Point', coordinates: [181, 44] } }),
    /Coordinates/
  );
  assert.throws(
    () => validateGeometry({ ...sample, geometry: { type: 'Point', coordinates: [-93, 44, 20] } }),
    /Coordinates/
  );
});

test('rejects self-intersecting, oversized, and over-detailed polygons', () => {
  const bowTie = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [0, 1],
          [1, 0],
          [0, 0]
        ]
      ]
    }
  };
  assert.throws(() => validateGeometry(bowTie), /invalid or self-intersecting/);
  const large = {
    ...sample,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-5, -5],
          [5, -5],
          [5, 5],
          [-5, 5],
          [-5, -5]
        ]
      ]
    }
  };
  assert.throws(() => validateGeometry(large), /5,000 km²/);
  const many = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: Array.from({ length: LIMITS.vertices + 1 }, (_, i) => [-93 + i / 1e7, 44])
    }
  };
  assert.throws(() => validateGeometry(many), /vertices/);
});

test('computes geodesic overlap and preserves source categories', () => {
  const overlap = zone([
    [
      [-93.265, 44.97],
      [-93.26, 44.97],
      [-93.26, 44.98],
      [-93.265, 44.98],
      [-93.265, 44.97]
    ]
  ]);
  const result = summarize(sample, [overlap]);
  assert.equal(result.intersectingCount, 1);
  assert.ok(result.mappedAreaM2 > 0);
  assert.ok(Math.abs(result.mappedAreaM2 - laeaReferenceArea(overlap.geometry.coordinates[0])) < 1);
  assert.equal(result.byClass[0].zone, 'AE');
  assert.equal(result.byClass[0].sfha, 'T');
});

test('does not double-count overlapping polygons or duplicate mapped features', () => {
  const half = zone([
    [
      [-93.265, 44.97],
      [-93.26, 44.97],
      [-93.26, 44.98],
      [-93.265, 44.98],
      [-93.265, 44.97]
    ]
  ]);
  const singleArea = summarize(sample, [half]).mappedAreaM2;
  const duplicateArea = summarize(sample, [half, half]).mappedAreaM2;
  assert.equal(duplicateArea, singleArea);
});

test('counts boundary touches and points without inventing polygon area', () => {
  const adjacent = zone([
    [
      [-93.26, 44.97],
      [-93.25, 44.97],
      [-93.25, 44.98],
      [-93.26, 44.98],
      [-93.26, 44.97]
    ]
  ]);
  const result = summarize(sample, [adjacent]);
  assert.equal(result.intersectingCount, 1);
  assert.equal(result.mappedAreaM2, 0);
  const point = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [-93.265, 44.975] }
  };
  assert.equal(summarize(point, [zone(sample.geometry.coordinates)]).intersectingCount, 1);
  assert.equal(summarize(point, [zone(sample.geometry.coordinates)]).mappedAreaM2, 0);
});

test('enforces a returned-feature ceiling', () => {
  assert.throws(
    () => summarize(sample, Array(LIMITS.features + 1).fill(zone(sample.geometry.coordinates))),
    /too many features/
  );
});

test('bbox prefilter preserves sparse asset intersections and boundary-touch candidates', () => {
  const zones = Array.from({ length: 500 }, (_, i) => {
    const x = -126 + (i % 25) * 0.1;
    const y = 29 + Math.floor(i / 25) * 0.1;
    return zone(
      [
        [
          [x, y],
          [x + 0.04, y],
          [x + 0.04, y + 0.04],
          [x, y + 0.04],
          [x, y]
        ]
      ],
      { FLD_ZONE: 'Z' + i, ZONE_SUBTY: null, SFHA_TF: 'T' }
    );
  });
  const assets = Array.from({ length: 500 }, (_, i) => {
    const x = -126 + (i % 25) * 0.1;
    const y = 29 + Math.floor(i / 25) * 0.1;
    return {
      type: 'Feature',
      properties: { asset_id: 'A' + i },
      geometry: { type: 'Point', coordinates: [x + 0.04, y + 0.02] }
    };
  });
  const candidates = assets.reduce(
    (count, asset) =>
      count +
      zones.filter((z) => boundsOverlap(geometryBounds(asset.geometry), geometryBounds(z.geometry)))
        .length,
    0
  );
  assert.equal(candidates, 500);
  const aoi = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-126.1, 28.9],
          [-123.4, 28.9],
          [-123.4, 31.1],
          [-126.1, 31.1],
          [-126.1, 28.9]
        ]
      ]
    }
  };
  const optimized = analyzeAssets(aoi, zones, assets);
  assert.equal(optimized.withinAreaCount, 500);
  assert.equal(optimized.intersectingZoneCount, 500);
  const reference = assets.map((asset) =>
    zones.filter((z) => booleanIntersects(asset, z)).map((z) => z.properties.FLD_ZONE)
  );
  assert.deepEqual(
    optimized.features.map((f) => f.zones),
    reference
  );
});
