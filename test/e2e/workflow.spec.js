import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('sample area → explicit demo source → metadata → provenance export', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Flood atlas' })).toBeVisible();
  await expect(page.getByText('SYNTHETIC DEMO · NOT FEMA DATA')).toBeVisible();
  await expect(page.getByText('Area within synthetic demo shapes')).toBeVisible();
  const zone = page.locator('.zone-select').first();
  await zone.click();
  await expect(zone).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.selected-map-class')).toContainText('Highlight: Zone');
  await expect(page.locator('.leaflet-overlay-pane path[stroke="#a04424"]')).toHaveCount(1);
  expect((await page.locator('.map-wrap').boundingBox()).y).toBeGreaterThanOrEqual(0);
  await page.getByRole('button', { name: 'Clear zone highlight ×' }).click();
  await expect(zone).toHaveAttribute('aria-pressed', 'false');
  await zone.focus();
  await page.keyboard.press('Enter');
  await expect(zone).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Clear zone highlight ×' }).click();
  await page.locator('.leaflet-control-layers-toggle').click({ force: true });
  await page.getByLabel('Satellite imagery').check();
  await page.getByLabel('Street map').check();
  await page.getByLabel('DATA SOURCE').selectOption('synthetic');
  await expect(page.getByText('SYNTHETIC DEMO · NOT FEMA DATA')).toBeVisible();
  await expect(page.getByText('FloodSense synthetic demonstration shapes')).toBeVisible();
  await expect(page.getByText('Illustrative only; no source authority')).toBeVisible();
  await expect(page.getByText('Area within synthetic demo shapes')).toBeVisible();

  const screenshot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../docs/screenshots/demo.png'
  );
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export GeoJSON/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('floodsense-screening.geojson');
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.properties.coordinateReferenceSystem).toContain('EPSG:4326');
  expect(exported.properties.source.name).toContain('synthetic');
  expect(exported.properties.disclaimer).toContain('not an official flood determination');
  expect(exported.features[0].geometry.type).toBe('Polygon');
  expect(pageErrors).toEqual([]);
});

test('zone classes with the same code remain independently selectable', async ({ page }) => {
  await page.route('**/api/analyze', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.zones.push({
      ...data.zones[0],
      properties: { ...data.zones[0].properties, ZONE_SUBTY: 'Alternate subtype' }
    });
    data.byClass.push({ ...data.byClass[0], subtype: 'Alternate subtype' });
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  const rows = page.locator('.zone-select').filter({ hasText: 'Zone AE' });
  await expect(rows).toHaveCount(2);
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(rows.last()).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.leaflet-overlay-pane path[stroke="#a04424"]')).toHaveCount(1);
  await page.locator('.leaflet-overlay-pane path[stroke="#087e89"]').last().click();
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(rows.last()).toHaveAttribute('aria-pressed', 'true');
});

test('map polygons select their exact zone class', async ({ page }) => {
  await page.goto('/');
  const zone = page.locator('.leaflet-overlay-pane path[stroke="#087e89"]').first();
  await expect(zone).toBeVisible();
  await zone.click();
  await expect(page.locator('.zone-select').filter({ hasText: 'Zone AE' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.locator('.selected-map-class')).toContainText('Zone AE');
  await page.screenshot({ path: 'docs/screenshots/zone-inspection.png', fullPage: true });
  await page.locator('.map-tool-row .tool').filter({ hasText: 'Point' }).click();
  await page.locator('.leaflet-overlay-pane path[stroke="#a04424"]').first().click();
  await expect(page.getByText('Map point')).toBeVisible();
});

test('text alternative accepts a point and the zone overlay control works', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('DATA SOURCE').selectOption('synthetic');
  await expect(page.getByText('FloodSense synthetic demonstration shapes')).toBeVisible();
  const overlay = page.locator('.leaflet-overlay-pane path');
  await expect(overlay).toHaveCount(3);
  await page.getByLabel('Show zone overlay').uncheck();
  await expect(overlay).toHaveCount(1);
  await page.getByLabel('Show zone overlay').check();
  await expect(overlay).toHaveCount(3);

  await page.getByRole('button', { name: '⌘ GeoJSON', exact: true }).click();
  await page
    .getByLabel('Geometry editor · EPSG:4326 GeoJSON')
    .fill(JSON.stringify({ type: 'Point', coordinates: [-93.265, 44.98] }));
  await page.getByRole('button', { name: 'Apply geometry' }).click();
  await expect(page.getByText('Intersecting synthetic demo shapes')).toBeVisible();
  await expect(page.getByText('synthetic demo polygons intersect this geometry')).toBeVisible();
});

test('uploaded asset GeoJSON is screened against the selected demo zones', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('DATA SOURCE').selectOption('synthetic');
  await expect(page.getByText('FloodSense synthetic demonstration shapes')).toBeVisible();
  await expect(page.getByText('Area within synthetic demo shapes')).toBeVisible();
  await page.locator('#asset-file').setInputFiles({
    name: 'assets.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Test facility' },
            geometry: { type: 'Point', coordinates: [-93.265, 44.98] }
          }
        ]
      })
    )
  });
  await expect(page.getByText('1 user-supplied assets loaded')).toBeVisible();
  await expect(page.getByText('ASSET-LEVEL SCREENING')).toBeVisible();
  await expect(page.getByText('USER DATA · SYNTHETIC ZONES')).toBeVisible();
  await expect(page.getByText('1 uploaded · 0 outside the selected area')).toBeVisible();
});

test('first visit is a labeled working example and fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto('/');
  await expect(page.getByText('SYNTHETIC DEMO · NOT FEMA DATA')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(720);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('SYNTHETIC DEMO · NOT FEMA DATA')).toBeVisible();
  await expect(page.getByText('Area within synthetic demo shapes')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.leaflet-tile')].filter(
        (tile) => tile.complete && tile.naturalWidth > 0
      ).length >= 5,
    { timeout: 12000 }
  );
  await page.screenshot({ path: 'docs/screenshots/mobile.png', fullPage: true });
});
