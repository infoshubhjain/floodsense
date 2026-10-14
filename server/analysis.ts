import area from '@turf/area';
import booleanValid from '@turf/boolean-valid';
import booleanIntersects from '@turf/boolean-intersects';
import kinks from '@turf/kinks';
import { feature, featureCollection } from '@turf/helpers';
import intersect from '@turf/intersect';
import union from '@turf/union';
import type { Feature, Geometry } from 'geojson';
import type { FloodFeature, SupportedGeometry, ZoneFeature, ZoneSummary } from '../shared/types.js';

export const LIMITS = { bytes: 64_000, vertices: 500, areaM2: 5_000_000_000, features: 500 };

const unionArea = (features: Feature<Geometry>[]) =>
  area(
    (features.length === 1 ? features[0] : union(featureCollection(features) as never)!) as never
  );

export function validateGeometry(input: unknown): FloodFeature {
  const candidate = input as FloodFeature;
  if (
    !candidate ||
    candidate.type !== 'Feature' ||
    !candidate.geometry ||
    !['Point', 'LineString', 'Polygon'].includes(candidate.geometry.type)
  ) {
    throw new Error('Use a GeoJSON Point, LineString, or Polygon.');
  }
  const geometry = candidate.geometry;
  const points =
    geometry.type === 'Point'
      ? [geometry.coordinates]
      : geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.coordinates.flat();
  if (points.length > LIMITS.vertices || points.length === 0)
    throw new Error(`Geometry must contain 1–${LIMITS.vertices} vertices.`);
  for (const point of points) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1]) ||
      point[0] < -180 ||
      point[0] > 180 ||
      point[1] < -90 ||
      point[1] > 90
    ) {
      throw new Error('Coordinates must be longitude, latitude in EPSG:4326.');
    }
  }
  if (
    ['LineString', 'Polygon'].includes(geometry.type) &&
    (!booleanValid(candidate as never) || kinks(candidate as never).features.length > 0)
  )
    throw new Error('Geometry is invalid or self-intersecting.');
  if (geometry.type === 'LineString' && geometry.coordinates.length < 2)
    throw new Error('A line needs at least two points.');
  if (geometry.type === 'Polygon' && area(candidate) > LIMITS.areaM2)
    throw new Error('Area must be no larger than 5,000 km².');
  const [minX, minY, maxX, maxY] =
    geometry.type === 'Point'
      ? [...geometry.coordinates.slice(0, 2), ...geometry.coordinates.slice(0, 2)]
      : points.reduce(
          (b, [x, y]) => [
            Math.min(b[0], x),
            Math.min(b[1], y),
            Math.max(b[2], x),
            Math.max(b[3], y)
          ],
          [180, 90, -180, -90]
        );
  if (maxX - minX > 5 || maxY - minY > 5)
    throw new Error('Area of interest must fit within a 5° by 5° envelope.');
  return candidate;
}

export function summarize(geometry: FloodFeature, zones: ZoneFeature[]) {
  if (!Array.isArray(zones) || zones.length > LIMITS.features)
    throw new Error('FEMA returned too many features; reduce the area and try again.');
  const byClass = new Map<string, ZoneSummary>();
  const groupedOverlaps = new Map<string, Feature<Geometry>[]>();
  const mappedOverlaps: Feature<Geometry>[] = [];
  let mappedAreaM2 = 0;
  let intersectingCount = 0;
  for (const zone of zones) {
    if (!zone?.geometry || !zone?.properties) continue;
    const z = feature(zone.geometry, zone.properties);
    if (!booleanIntersects(geometry, z)) continue;
    intersectingCount++;
    const attrs = zone.properties;
    const key = `${attrs.FLD_ZONE || 'Unknown'}${attrs.ZONE_SUBTY ? ` · ${attrs.ZONE_SUBTY}` : ''}`;
    const item = byClass.get(key) || {
      zone: attrs.FLD_ZONE || 'Unknown',
      subtype: attrs.ZONE_SUBTY || null,
      sfha: attrs.SFHA_TF || null,
      featureCount: 0,
      areaM2: 0
    };
    item.featureCount++;
    if (geometry.geometry.type === 'Polygon') {
      const overlap = intersect(
        featureCollection([geometry, z]) as never
      ) as Feature<Geometry> | null;
      if (overlap) {
        mappedOverlaps.push(overlap);
        const overlaps = groupedOverlaps.get(key) || [];
        overlaps.push(overlap);
        groupedOverlaps.set(key, overlaps);
      }
    }
    byClass.set(key, item);
  }
  if (mappedOverlaps.length) mappedAreaM2 = unionArea(mappedOverlaps);
  for (const [key, overlaps] of groupedOverlaps) {
    const item = byClass.get(key);
    if (item) item.areaM2 = unionArea(overlaps);
  }
  return { intersectingCount, mappedAreaM2, byClass: [...byClass.values()] };
}

export function toEsriGeometry(geometry: SupportedGeometry) {
  const wkid = 4326;
  if (geometry.type === 'Point')
    return { x: geometry.coordinates[0], y: geometry.coordinates[1], spatialReference: { wkid } };
  if (geometry.type === 'LineString')
    return { paths: [geometry.coordinates], spatialReference: { wkid } };
  if (geometry.type === 'Polygon')
    return { rings: geometry.coordinates, spatialReference: { wkid } };
  throw new Error(
    'The live FEMA service currently supports Point, LineString, and Polygon analyses.'
  );
}
