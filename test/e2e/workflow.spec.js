import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('sample area → explicit demo source → metadata → provenance export', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Flood exposure' })).toBeVisible();
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
