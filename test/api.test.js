import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../server/index.js';

const nativeFetch = globalThis.fetch;
let server, origin;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  globalThis.fetch = nativeFetch;
  server?.close();
});

const input = {
  geometry: {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [-93.265, 44.98] }
  },
  mode: 'live'
};

test('API reports provider failure without substituting synthetic data', async () => {
  globalThis.fetch = async (url) =>
    String(url).includes('hazards.fema.gov')
      ? new Response('offline', { status: 503 })
      : nativeFetch(url);
  const response = await nativeFetch(`${origin}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /No substitute data was used/);
});

test('API rejects provider results beyond the bounded feature limit', async () => {
  globalThis.fetch = async (url) =>
    String(url).includes('hazards.fema.gov')
      ? new Response(
          JSON.stringify({ type: 'FeatureCollection', features: [], exceededTransferLimit: true }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      : nativeFetch(url);
  const response = await nativeFetch(`${origin}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /too many mapped zones/);
});

test('live adapter pins FEMA fields and requests NAD83 source output in EPSG:4326', async () => {
  let providerUrl;
  globalThis.fetch = async (url) => {
    providerUrl = new URL(String(url));
    return new Response(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T', DFIRM_ID: '27053C' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-93.27, 44.97],
                  [-93.26, 44.97],
                  [-93.26, 44.99],
                  [-93.27, 44.99],
                  [-93.27, 44.97]
                ]
              ]
            }
          }
        ]
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  };
  const response = await nativeFetch(`${origin}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(providerUrl.hostname, 'hazards.fema.gov');
  assert.equal(providerUrl.searchParams.get('inSR'), '4326');
  assert.equal(providerUrl.searchParams.get('outSR'), '4326');
  assert.equal(providerUrl.searchParams.get('geometryType'), 'esriGeometryPoint');
  assert.equal(providerUrl.searchParams.get('outFields'), 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID');
  assert.deepEqual(result.zones[0].geometry.coordinates[0][0], [-93.27, 44.97]);
  assert.equal(result.byClass[0].sfha, 'T');
});

test('API validates geometry and requires explicit source mode', async () => {
  const invalid = await nativeFetch(`${origin}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      geometry: { ...input.geometry, geometry: { type: 'Point', coordinates: [200, 44] } }
    })
  });
  assert.equal(invalid.status, 400);
  const noMode = await nativeFetch(`${origin}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geometry: input.geometry })
  });
  assert.equal(noMode.status, 400);
});
