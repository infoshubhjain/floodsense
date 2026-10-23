import express from 'express';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  analyzeAssets,
  LIMITS,
  summarize,
  toEsriGeometry,
  validateAssets,
  validateGeometry,
  validateProviderZones
} from './analysis.js';
import { syntheticZones } from './synthetic.js';
import type { Request, Response, NextFunction } from 'express';
import type { AnalysisResult, FloodFeature, SourceMetadata, ZoneFeature } from '../shared/types.js';

const app = express();
const dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const FEMA = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const TILE_URL = process.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const tileOrigin = new URL(
  TILE_URL.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0')
).origin;
if (!tileOrigin.startsWith('https://')) throw new Error('VITE_TILE_URL must use HTTPS.');
const tileOrigins = [...new Set([tileOrigin, 'https://server.arcgisonline.com', 'https://tile.openstreetmap.org'])].join(' ');
const cache = new Map<string, { at: number; result: AnalysisResult }>();
const requests = new Map<string, number[]>();
let liveQueries = 0;
const MAX_PROVIDER_BYTES = 8_000_000;
const MAX_ASSET_BYTES = 1_000_000;
const TTL = 5 * 60_000;
const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5)
  throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5.');

export { app };
app.disable('x-powered-by');
app.set('trust proxy', proxyHops);
app.use((req: Request, res: Response, next: NextFunction) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${tileOrigins}; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`
  });
  const origin = req.get('origin');
  const allowed = process.env.ALLOWED_ORIGIN
    ? origin === process.env.ALLOWED_ORIGIN
    : !origin ||
      origin === `${req.protocol}://${req.get('host')}` ||
      origin === 'http://localhost:5173';
  if (!allowed) return res.status(403).json({ error: 'Origin not allowed.' });
  if (origin) res.set('Access-Control-Allow-Origin', origin).set('Vary', 'Origin');
  if (req.method === 'OPTIONS')
    return res
      .set('Access-Control-Allow-Methods', 'GET, POST')
      .set('Access-Control-Allow-Headers', 'Content-Type')
      .sendStatus(204);
  next();
});
app.use(express.json({ limit: '1200kb', type: 'application/json' }));

function withinRateLimit(req: Request) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (requests.get(key) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 30) return false;
  recent.push(now);
  requests.set(key, recent);
  if (requests.size > 10_000) {
    for (const [client, hits] of requests) {
      if (!hits.some((time) => now - time < 60_000)) requests.delete(client);
    }
  }
  return true;
}

export async function getJson(
  url: string | URL,
  timeoutMs = 8_000,
  maxBytes = MAX_PROVIDER_BYTES
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  let response: globalThis.Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(url, {
        signal,
        headers: { Accept: 'application/json' }
      });
      if (![429, 502, 503, 504].includes(response.status) || attempt === 1) break;
    } catch (error) {
      if (attempt === 1 || Date.now() >= deadline) throw error;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(200, Math.max(0, deadline - Date.now())))
    );
  }
  if (!response?.ok || !response.body)
    throw new Error(`Provider returned HTTP ${response?.status ?? 'unknown'}.`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Provider response exceeded the size limit.');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'FloodSense' }));
app.get('/api/geocode', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!withinRateLimit(req))
    return res.status(429).json({ error: 'Search limit reached. Try again in a minute.' });
  const query = String(req.query.q || '').trim();
  const coords = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coords) {
    const lon = Number(coords[1]),
      lat = Number(coords[2]);
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90)
      return res.status(400).json({ error: 'Enter longitude, latitude in valid ranges.' });
    return res.json({
      label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      coordinates: [lon, lat],
      source: 'Coordinates entered by user'
    });
  }
  if (query.length < 5 || query.length > 120)
    return res
      .status(400)
      .json({ error: 'Enter a US street address (5–120 characters) or longitude, latitude.' });
  try {
    const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    url.search = new URLSearchParams({
      address: query,
      benchmark: 'Public_AR_Current',
      format: 'json'
    }).toString();
    const data = await getJson(url, 6_000, 500_000);
    const match = data.result?.addressMatches?.[0];
    if (!match)
      return res
        .status(404)
        .json({
          error:
            'No address match found. Try a more complete US street address or enter coordinates.'
        })
        .toString();
    res.json({
      label: match.matchedAddress,
      coordinates: [match.coordinates.x, match.coordinates.y],
      source: 'U.S. Census Bureau Geocoder; address-range match'
    });
  } catch {
    res.status(502).json({
      error: 'Address search is temporarily unavailable. You can enter coordinates or use the map.'
    });
  }
});

app.post('/api/analyze', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!withinRateLimit(req))
    return res.status(429).json({ error: 'Analysis limit reached. Try again in a minute.' });
  let geometry: FloodFeature;
  try {
    geometry = validateGeometry(req.body?.geometry);
  } catch (error) {
    return res
      .status(400)
      .json({ error: error instanceof Error ? error.message : 'Invalid geometry.' });
  }
  if (Buffer.byteLength(JSON.stringify(req.body?.geometry ?? null)) > LIMITS.bytes)
    return res.status(413).json({ error: 'Selected geometry exceeds the 64 KB limit.' });
  let assets;
  if (req.body?.assets !== undefined) {
    if (Buffer.byteLength(JSON.stringify(req.body.assets)) > MAX_ASSET_BYTES)
      return res.status(413).json({ error: 'Asset GeoJSON must be 1 MB or smaller.' });
    try {
      assets = validateAssets(req.body.assets);
    } catch (error) {
      return res
        .status(400)
        .json({ error: error instanceof Error ? error.message : 'Invalid asset GeoJSON.' });
    }
  }
  const useSynthetic = req.body?.mode === 'synthetic';
  if (req.body?.mode !== 'live' && !useSynthetic)
    return res
      .status(400)
      .json({ error: 'Choose live FEMA data or synthetic demo data explicitly.' });
  if (useSynthetic && summarize(geometry, syntheticZones).intersectingCount === 0)
    return res.status(422).json({
      error:
        'Synthetic examples cover only the Minneapolis sample area. Reset the map selection to use them.'
    });
  const key = createHash('sha256').update(JSON.stringify({ geometry, useSynthetic })).digest('hex');
  const cached = cache.get(key);
  if (!useSynthetic && cached && Date.now() - cached.at < TTL)
    return res.json({
      ...cached.result,
      ...(assets ? { assets: analyzeAssets(geometry, cached.result.zones, assets) } : {}),
      cached: true
    });
  if (!useSynthetic && liveQueries >= 4)
    return res
      .status(503)
      .json({ error: 'FEMA is currently handling other screening requests. Try again shortly.' });
  if (!useSynthetic) liveQueries++;
  try {
    let zones: ZoneFeature[], source: SourceMetadata;
    if (useSynthetic) {
      zones = syntheticZones;
      source = {
        name: 'FloodSense synthetic demonstration shapes',
        url: null,
        attribution: 'Synthetic examples only — not FEMA data',
        confidence: 'Illustrative only; no source authority',
        retrievedAt: new Date().toISOString(),
        spatialReference: 'EPSG:4326 (demo geometry)',
        maxResolution: 'Illustrative vector shapes; no mapped resolution',
        effectiveDate: 'Not applicable'
      };
    } else {
      const params = new URLSearchParams({
        where: '1=1',
        geometry: JSON.stringify(toEsriGeometry(geometry.geometry)),
        geometryType:
          geometry.geometry.type === 'Point'
            ? 'esriGeometryPoint'
            : geometry.geometry.type === 'LineString'
              ? 'esriGeometryPolyline'
              : 'esriGeometryPolygon',
        spatialRel: 'esriSpatialRelIntersects',
        inSR: '4326',
        outSR: '4326',
        outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID',
        returnGeometry: 'true',
        returnExceededLimitFeatures: 'true',
        resultRecordCount: String(LIMITS.features + 1),
        f: 'geojson'
      }).toString();
      const data = (await getJson(`${FEMA}?${params}`, 8_000)) as {
        error?: unknown;
        features?: ZoneFeature[];
        exceededTransferLimit?: boolean;
      };
      if (data.error) throw new Error('FEMA reported a query error.');
      zones = validateProviderZones(data.features);
      if (data.exceededTransferLimit || zones.length > LIMITS.features)
        return res.status(422).json({
          error:
            'This area contains too many mapped zones to analyze safely. Draw a smaller area and try again.'
        });
      source = {
        name: 'FEMA National Flood Hazard Layer (NFHL), Flood Hazard Zones',
        url: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer',
        attribution:
          'Source: FEMA National Flood Hazard Layer (NFHL). Effective mapped data; coverage and effective dates vary by map panel.',
        confidence:
          'Authoritative mapped source; geographic coverage and map currency vary by panel.',
        retrievedAt: new Date().toISOString(),
        spatialReference:
          'Service source EPSG:4269 (NAD83); service output EPSG:4326. Areas are geodesic.',
        maxResolution:
          'Vector polygons; map scale varies by effective panel (not a uniform raster resolution)',
        effectiveDate:
          'Varies by DFIRM map panel; use the FEMA Map Service Center for the effective panel and date.'
      };
    }
    const summary = summarize(geometry, zones);
    const result: AnalysisResult = {
      geometry,
      zones,
      ...summary,
      source,
      mode: useSynthetic ? 'synthetic' : 'live',
      cached: false
    };
    if (assets)
      result.assets = {
        ...analyzeAssets(geometry, zones, assets),
        source: useSynthetic
          ? 'User-supplied GeoJSON intersected with explicitly selected synthetic demonstration polygons'
          : 'User-supplied GeoJSON intersected with FEMA NFHL mapped polygons'
      };
    const bytes = Buffer.byteLength(JSON.stringify(result));
    if (bytes > 5_000_000)
      return res.status(422).json({
        error:
          'Analysis response exceeded the display size limit. Draw a smaller area and try again.'
      });
    if (!useSynthetic) {
      cache.set(key, { at: Date.now(), result });
      if (cache.size > 100) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
    }
    res.json(result);
  } catch {
    res.status(502).json({
      error:
        'FEMA data could not be reached. No substitute data was used. Select synthetic demo mode to view clearly labeled sample shapes.'
    });
  } finally {
    if (!useSynthetic) liveQueries--;
  }
});

const dist = resolve(dir, '../../dist');
app.use(express.static(dist, { index: false, maxAge: '1h' }));
app.get(/.*/, (req, res) =>
  req.path.startsWith('/api/')
    ? res.status(404).json({ error: 'Not found.' })
    : res.sendFile(resolve(dist, 'index.html'))
);
app.use((error: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  res.status(error.status === 413 ? 413 : 400).json({
    error: error.status === 413 ? 'Request exceeds the 64 KB limit.' : 'Invalid request body.'
  });
});
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  app.listen(PORT, () => console.log(`FloodSense API ready on http://localhost:${PORT}`));
}
