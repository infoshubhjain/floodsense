import { parentPort, workerData } from 'node:worker_threads';
import { analyzeAssets, summarize } from './analysis.js';
import type { Feature } from 'geojson';
import type { FloodFeature, SupportedGeometry, ZoneFeature } from '../shared/types.js';

const { geometry, zones, assets } = workerData as {
  geometry: FloodFeature;
  zones: ZoneFeature[];
  assets?: Feature<SupportedGeometry>[];
};
parentPort!.postMessage({
  summary: summarize(geometry, zones),
  assets: assets ? analyzeAssets(geometry, zones, assets) : undefined
});
