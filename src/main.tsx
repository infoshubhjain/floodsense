import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import 'leaflet/dist/leaflet.css';
import './style.css';
import type { AnalysisResult, FloodFeature, ZoneFeature } from '../shared/types.js';

type DrawMode = '' | 'point' | 'line' | 'polygon';
type MapHandle = L.Map & { finishFloodSense: () => FloodFeature | null };
type MapProps = {
  geometry: FloodFeature;
  zones: ZoneFeature[];
  selectedZone: string | null;
  center: [number, number];
  zoom: number;
  drawMode: DrawMode;
  onMapPoint: (feature: FloodFeature) => void;
  onMapMove: (center: [number, number]) => void;
  onMapReady: (map: MapHandle) => void;
  tileUrl: string;
  assets: Feature<Geometry>[];
};

const START: FloodFeature = {
  type: 'Feature',
  properties: { label: 'Downtown Minneapolis sample area' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-93.27, 44.976],
        [-93.26, 44.976],
        [-93.26, 44.984],
        [-93.27, 44.984],
        [-93.27, 44.976]
      ]
    ]
  }
};
const fmt = (m2: number) =>
  m2 >= 1_000_000 ? `${(m2 / 1_000_000).toFixed(2)} km²` : `${Math.round(m2).toLocaleString()} m²`;

function FloodMap({
  geometry,
  zones,
  selectedZone,
  center,
  zoom,
  drawMode,
  onMapPoint,
  onMapMove,
  onMapReady,
  tileUrl,
  assets
}: MapProps) {
  const root = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapHandle | null>(null);
  const overlay = useRef<L.GeoJSON | null>(null);
  const drawn = useRef<L.GeoJSON | null>(null);
  const assetOverlay = useRef<L.GeoJSON | null>(null);
  const draft = useRef<L.LayerGroup | null>(null);
  const points = useRef<number[][]>([]);
  const handlers = useRef({ onMapPoint, onMapMove, drawMode });
  const initialView = useRef({ center, zoom });
  const readyCallback = useRef(onMapReady);

  useEffect(() => {
    handlers.current = { onMapPoint, onMapMove, drawMode };
    readyCallback.current = onMapReady;
  }, [onMapPoint, onMapMove, drawMode, onMapReady]);

  useEffect(() => {
    if (!root.current) return;
    const map = L.map(root.current, {
      zoomControl: false,
      doubleClickZoom: false
    }).setView(initialView.current.center, initialView.current.zoom);
    const mapHandle = map as MapHandle;
    mapRef.current = mapHandle;
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const streets = L.tileLayer(tileUrl, {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    const imagery = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution:
          'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community'
      }
    );
    L.control
      .layers({ 'Street map': streets, 'Satellite imagery': imagery }, undefined, {
        collapsed: true
      })
      .addTo(map);
    const tileWarning = new L.Control({ position: 'topright' });
    tileWarning.onAdd = () => {
      const node = L.DomUtil.create('div', 'basemap-warning');
      node.textContent = 'Basemap unavailable · geometry and results remain usable';
      node.hidden = true;
      streets.on('tileerror', () => {
        node.hidden = false;
      });
      streets.on('tileload', () => {
        node.hidden = true;
      });
      imagery.on('tileerror', () => {
        node.hidden = false;
      });
      imagery.on('tileload', () => {
        node.hidden = true;
      });
      return node;
    };
    tileWarning.addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 120 }).addTo(map);
    readyCallback.current(mapHandle);
    map.on('moveend', () => {
      const c = map.getCenter();
      handlers.current.onMapMove([c.lat, c.lng]);
    });
    map.on('click', (e) => {
      if (!handlers.current.drawMode) return;
      const p = [e.latlng.lng, e.latlng.lat];
      if (handlers.current.drawMode === 'point') {
        handlers.current.onMapPoint({
          type: 'Feature',
          properties: { label: 'Map point' },
          geometry: { type: 'Point', coordinates: p }
        });
        return;
      }
      points.current.push(p);
      if (draft.current) map.removeLayer(draft.current);
      const latlngs = points.current.map(([lng, lat]) => [lat, lng] as [number, number]);
      draft.current = L.layerGroup().addTo(map);
      L.polyline(
        handlers.current.drawMode === 'polygon' && latlngs.length > 2
          ? [...latlngs, latlngs[0]]
          : latlngs,
        { color: '#25746d', weight: 3, dashArray: '5 5', fillColor: '#43aa9b', fillOpacity: 0.18 }
      ).addTo(draft.current);
      L.circleMarker(e.latlng, {
        radius: 4,
        color: '#fff',
        weight: 2,
        fillColor: '#25746d',
        fillOpacity: 1
      }).addTo(draft.current);
    });
    mapHandle.finishFloodSense = () => {
      const tool = handlers.current.drawMode;
      if (!tool || points.current.length < (tool === 'line' ? 2 : 3)) return null;
      const coordinates = [...points.current];
      const geometry: FloodFeature['geometry'] =
        tool === 'polygon'
          ? { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }
          : { type: 'LineString', coordinates };
      if (draft.current) map.removeLayer(draft.current);
      draft.current = null;
      points.current = [];
      return { type: 'Feature', properties: { label: `Drawn ${tool}` }, geometry };
    };
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [tileUrl]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setView(center, zoom, { animate: true });
  }, [center, zoom]);

  useEffect(() => {
    points.current = [];
    if (draft.current && mapRef.current) mapRef.current.removeLayer(draft.current);
    draft.current = null;
  }, [drawMode]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (overlay.current) mapRef.current.removeLayer(overlay.current);
    overlay.current = zones?.length
      ? L.geoJSON({ type: 'FeatureCollection', features: zones } as FeatureCollection, {
          style: (f) => ({
            color:
              f?.properties?.FLD_ZONE === selectedZone
                ? '#a04424'
                : f?.properties?.SFHA_TF === 'T'
                  ? '#087e89'
                  : '#9274c5',
            weight: f?.properties?.FLD_ZONE === selectedZone ? 3 : 1.25,
            fillColor: f?.properties?.SFHA_TF === 'T' ? '#41c1c5' : '#a58be0',
            fillOpacity: selectedZone && f?.properties?.FLD_ZONE !== selectedZone ? 0.09 : 0.31
          })
        }).addTo(mapRef.current)
      : null;
  }, [zones, selectedZone]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (assetOverlay.current) mapRef.current.removeLayer(assetOverlay.current);
    assetOverlay.current = assets.length
      ? L.geoJSON({ type: 'FeatureCollection', features: assets } as FeatureCollection, {
          style: { color: '#9e641b', weight: 3, fillColor: '#e7af58', fillOpacity: 0.25 },
          pointToLayer: (_feature, latlng) =>
            L.circleMarker(latlng, {
              radius: 6,
              color: '#9e641b',
              fillColor: '#e7af58',
              fillOpacity: 0.9
            })
        }).addTo(mapRef.current)
      : null;
  }, [assets]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (drawn.current) mapRef.current.removeLayer(drawn.current);
    drawn.current = L.geoJSON(geometry, {
      style: {
        color: '#173b36',
        weight: 2,
        dashArray: '6 4',
        fillColor: '#b7dfd6',
        fillOpacity: 0.14
      },
      pointToLayer: (_f, latlng) =>
        L.circleMarker(latlng, {
          radius: 7,
          color: '#173b36',
          weight: 2,
          fillColor: '#e8c368',
          fillOpacity: 1
        })
    }).addTo(mapRef.current);
  }, [geometry]);

  return (
    <div
      className={`map-shell ${drawMode ? 'is-drawing' : ''}`}
      ref={root}
      role="application"
      aria-label="Flood hazard map. Use the geometry editor or drawing tools to select an area."
    />
  );
}

function App() {
  const [geometry, setGeometry] = useState<FloodFeature>(START);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [mode, setMode] = useState<'live' | 'synthetic'>('synthetic');
  const [showZones, setShowZones] = useState(true);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>('');
  const [center, setCenter] = useState<[number, number]>([44.98, -93.265]);
  const [zoom, setZoom] = useState(13);
  const [map, setMap] = useState<MapHandle | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [geojsonText, setGeojsonText] = useState('');
  const [showGeometry, setShowGeometry] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const [assets, setAssets] = useState<Feature<Geometry>[]>([]);
  const [assetNote, setAssetNote] = useState('');
  const seq = useRef(0);
  const counts = useMemo(() => result?.byClass || [], [result]);

  const analyze = useCallback(
    async (g: FloodFeature = geometry, m: 'live' | 'synthetic' = mode) => {
      const run = ++seq.current;
      setBusy(true);
      setError('');
      setResult(null);
      setSelectedZone(null);
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            geometry: g,
            mode: m,
            ...(assets.length ? { assets: { type: 'FeatureCollection', features: assets } } : {})
          })
        });
        const data = (await res.json()) as AnalysisResult & { error?: string };
        if (!res.ok) throw new Error(data.error || 'Analysis failed.');
        if (run === seq.current) setResult(data);
      } catch (e) {
        if (run === seq.current) {
          setResult(null);
          setError(e instanceof Error ? e.message : 'Analysis failed.');
        }
      } finally {
        if (run === seq.current) setBusy(false);
      }
    },
    [assets, geometry, mode]
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => analyze());
    return () => cancelAnimationFrame(frame);
  }, [analyze]);

  function selectGeometry(next: FloodFeature) {
    setGeometry(next);
    setResult(null);
    setGeojsonText(JSON.stringify(next, null, 2));
    setDrawMode('');
    const b = L.geoJSON(next).getBounds();
    if (b.isValid()) {
      const c = b.getCenter();
      setCenter([c.lat, c.lng]);
      setZoom(next.geometry.type === 'Point' ? 15 : 14);
    }
  }

  function finishDrawing() {
    if (!map || !drawMode) return;
    const next = map.finishFloodSense?.();
    if (next) selectGeometry(next);
    else
      setError(
        `Add at least ${drawMode === 'line' ? 'two points' : 'three corners'} before finishing.`
      );
  }

  async function searchPlace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(search)}`);
      const data = (await res.json()) as {
        coordinates: [number, number];
        label: string;
        source: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error);
      const [lng, lat] = data.coordinates;
      const next: FloodFeature = {
        type: 'Feature',
        properties: { label: data.label, searchSource: data.source },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [lng - 0.004, lat - 0.003],
              [lng + 0.004, lat - 0.003],
              [lng + 0.004, lat + 0.003],
              [lng - 0.004, lat + 0.003],
              [lng - 0.004, lat - 0.003]
            ]
          ]
        }
      };
      selectGeometry(next);
      setSearch(data.label);
      setCenter([lat, lng]);
      setZoom(14);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Address search failed.');
    }
  }

  function setDraw(tool: Exclude<DrawMode, ''>) {
    if (drawMode === tool) setDrawMode('');
    else setDrawMode(tool);
  }

  useEffect(() => {
    if (!map) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawMode('');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [map]);

  function applyGeojson() {
    try {
      const parsed = JSON.parse(geojsonText) as FloodFeature | FloodFeature['geometry'];
      const next: FloodFeature =
        parsed.type === 'Feature' ? parsed : { type: 'Feature', properties: {}, geometry: parsed };
      if (!next.geometry || !['Point', 'LineString', 'Polygon'].includes(next.geometry.type))
        throw new Error('Use a GeoJSON Point, LineString, or Polygon.');
      selectGeometry(next);
      setShowGeometry(false);
    } catch (e) {
      setError(`Geometry not applied: ${e instanceof Error ? e.message : 'Invalid GeoJSON.'}`);
    }
  }

  function exportResult() {
    if (!result) return;
    const output = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'EPSG:4326' } },
      features: [
        geometry,
        ...result.zones,
        ...(result.assets?.features.map((item) => ({
          type: 'Feature' as const,
          geometry: item.geometry,
          properties: {
            featureType: 'user-uploaded-asset',
            label: item.label,
            intersectsMappedZone: item.exposed,
            zones: item.zones
          }
        })) || [])
      ],
      properties: {
        title: 'FloodSense flood exposure screening',
        generatedAt: new Date().toISOString(),
        source: result.source,
        analysis: {
          method:
            result.mode === 'synthetic'
              ? 'Spatial intersection with explicitly selected synthetic illustration polygons'
              : 'Spatial intersection of user-selected geometry with mapped FEMA NFHL flood-zone polygons',
          intersectingFeatureCount: result.intersectingCount,
          mappedIntersectionAreaM2: result.mappedAreaM2,
          categories: result.byClass,
          assetExposure: result.assets || null
        },
        coordinateReferenceSystem: 'EPSG:4326 (output); FEMA source coordinates EPSG:4269 (NAD83)',
        resolution: result.source.maxResolution,
        effectiveDate: result.source.effectiveDate,
        modelVersion:
          result.mode === 'synthetic'
            ? 'FloodSense synthetic illustration; not a hazard model'
            : 'FEMA NFHL live layer; no independent FloodSense risk model',
        disclaimer:
          'Screening and educational use only; not an official flood determination, forecast, insurance decision, engineering study, or safety advice. Mapped coverage is incomplete; absence of mapped hazard is not proof of safety.'
      }
    };
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'floodsense-screening.geojson';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const exposureLabel =
    geometry.geometry.type === 'Polygon'
      ? result?.mode === 'synthetic'
        ? 'Area within synthetic demo shapes'
        : 'Area within mapped NFHL polygons'
      : result?.mode === 'synthetic'
        ? 'Intersecting synthetic demo shapes'
        : 'Intersecting mapped NFHL features';
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="FloodSense home">
          <span className="brand-mark">
            <span />
          </span>
          <span>
            FloodSense<small>FLOOD EXPOSURE INTELLIGENCE</small>
          </span>
        </a>
        <div className="topbar-right">
          <span className="live-indicator">
            <i /> PUBLIC DATA SCREENING
          </span>
          <button
            className="icon-button"
            aria-label="About FloodSense"
            onClick={() => setShowMethod((v) => !v)}
          >
            i
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className="map-column">
          <section className="map-tools" aria-label="Map tools">
            <form className="search-box" onSubmit={searchPlace}>
              <span className="search-icon">⌕</span>
              <input
                aria-label="Search a US address or coordinates"
                placeholder="US address or longitude, latitude"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={120}
              />
              <button type="submit" aria-label="Search">
                Search
              </button>
            </form>
            <p className="search-disclosure">
              Address searches go to the U.S. Census Geocoder; live geometry goes to FEMA; The
              selected basemap receives tile requests. FloodSense does not store selections.
            </p>
            <div className="asset-upload">
              <label htmlFor="asset-file">
                Optional asset GeoJSON · buildings, roads, facilities
              </label>
              <input
                id="asset-file"
                type="file"
                accept=".geojson,.json,application/geo+json,application/json"
                onChange={async (event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (!file) return;
                  if (file.size > 1_000_000) {
                    setAssetNote('Asset GeoJSON must be 1 MB or smaller.');
                    return;
                  }
                  try {
                    const parsed = JSON.parse(await file.text()) as FeatureCollection;
                    if (
                      parsed.type !== 'FeatureCollection' ||
                      !Array.isArray(parsed.features) ||
                      !parsed.features.length ||
                      parsed.features.length > 500
                    )
                      throw new Error(
                        'Choose a GeoJSON FeatureCollection with 1–500 asset features.'
                      );
                    setAssets(parsed.features as Feature<Geometry>[]);
                    setAssetNote(
                      `${parsed.features.length} user-supplied assets loaded; analysis will intersect them with the selected mapped zones.`
                    );
                  } catch (error) {
                    setAssetNote(
                      error instanceof Error ? error.message : 'Could not read this GeoJSON file.'
                    );
                  }
                }}
              />
              {assetNote && <p role="status">{assetNote}</p>}
              {assets.length > 0 && (
                <button
                  className="text-tool"
                  onClick={() => {
                    setAssets([]);
                    setAssetNote('Uploaded assets cleared.');
                  }}
                >
                  Clear asset dataset
                </button>
              )}
              <small>
                EPSG:4326 point, line, or polygon features · max 500 features / 1 MB. Data is sent
                for this analysis and not saved.
              </small>
            </div>
            <div className="map-tool-row">
              <span className="tool-label">SELECT AREA</span>
              <button
                className={drawMode === 'point' ? 'tool active' : 'tool'}
                onClick={() => setDraw('point')}
                aria-pressed={drawMode === 'point'}
              >
                ＋ <span>Point</span>
              </button>
              <button
                className={drawMode === 'line' ? 'tool active' : 'tool'}
                onClick={() => setDraw('line')}
                aria-pressed={drawMode === 'line'}
              >
                ╱ <span>Line</span>
              </button>
              <button
                className={drawMode === 'polygon' ? 'tool active' : 'tool'}
                onClick={() => setDraw('polygon')}
                aria-pressed={drawMode === 'polygon'}
              >
                ◇ <span>Area</span>
              </button>
              {drawMode && (
                <button className="finish-button" onClick={finishDrawing}>
                  Finish selection
                </button>
              )}
              <button
                className="tool text-tool"
                onClick={() => {
                  setGeojsonText(JSON.stringify(geometry, null, 2));
                  setShowGeometry((v) => !v);
                }}
              >
                ⌘ <span>GeoJSON</span>
              </button>
            </div>
            {drawMode && (
              <div className="draw-hint" role="status">
                {drawMode === 'point'
                  ? 'Click the map to place a point.'
                  : `Click the map to add ${drawMode === 'line' ? 'line vertices' : 'area corners'}, then choose Finish selection.`}{' '}
                Press Escape to cancel.
              </div>
            )}
            {showGeometry && (
              <div className="geojson-editor">
                <label htmlFor="geojson">Geometry editor · EPSG:4326 GeoJSON</label>
                <textarea
                  id="geojson"
                  value={geojsonText}
                  onChange={(e) => setGeojsonText(e.target.value)}
                  spellCheck="false"
                />
                <button className="small-primary" onClick={applyGeojson}>
                  Apply geometry
                </button>
              </div>
            )}
          </section>
          <div className="map-wrap">
            <FloodMap
              geometry={geometry}
              zones={showZones ? result?.zones || [] : []}
              selectedZone={selectedZone}
              center={center}
              zoom={zoom}
              drawMode={drawMode}
              onMapPoint={selectGeometry}
              onMapMove={([lat, lng]) =>
                setCenter((prev) =>
                  Math.abs(prev[0] - lat) < 1e-5 && Math.abs(prev[1] - lng) < 1e-5
                    ? prev
                    : [lat, lng]
                )
              }
              onMapReady={setMap}
              tileUrl={
                import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
              }
              assets={
                result?.assets?.features.map((item) => ({
                  type: 'Feature',
                  properties: { label: item.label },
                  geometry: item.geometry
                })) || []
              }
            />
            <div className="map-top-tags">
              <span className="map-tag">
                <i className="tag-dot" />{' '}
                {mode === 'synthetic' ? 'SYNTHETIC DEMO SHAPES' : 'FEMA MAPPED ZONES'}
              </span>
              <span className="map-tag muted-tag">EPSG:4326 · WGS 84</span>
            </div>
            <div className="legend">
              <strong>MAP KEY</strong>
              <span>
                <i className="legend-chip sfha" />{' '}
                {mode === 'synthetic'
                  ? 'Synthetic example (SFHA-shaped)'
                  : 'FEMA special flood hazard area'}
              </span>
              <span>
                <i className="legend-chip minimal" />{' '}
                {mode === 'synthetic' ? 'Other synthetic example' : 'Other mapped zone'}
              </span>
              <span>
                <i className="legend-outline" /> Selected geometry
              </span>
              {result?.assets && (
                <span>
                  <i className="legend-asset" /> User-supplied assets
                </span>
              )}
            </div>
            <div className="map-coordinates">
              {center[0].toFixed(4)}° N&nbsp; {Math.abs(center[1]).toFixed(4)}° W
            </div>
            <div className="synthetic-banner" hidden={mode !== 'synthetic'}>
              SYNTHETIC DEMO · NOT FEMA DATA
            </div>
          </div>
          <div className="map-foot">
            <label className="layer-toggle">
              <input
                type="checkbox"
                checked={showZones}
                onChange={(e) => setShowZones(e.target.checked)}
              />{' '}
              Show zone overlay
            </label>
            <span>Mapped areas are approximate at this scale.</span>
            <a href="https://msc.fema.gov/portal/home" target="_blank" rel="noreferrer">
              Open FEMA Map Service Center ↗
            </a>
          </div>
        </div>
        <aside className="analysis-panel" aria-label="Flood exposure analysis">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PLACE SCREENING</p>
              <h1>Flood atlas</h1>
            </div>
            <button
              className="refresh"
              onClick={() => analyze()}
              disabled={busy}
              aria-label="Refresh analysis"
            >
              ↻
            </button>
          </div>
          <div className="location-card">
            <div className="location-icon">⌖</div>
            <div>
              <strong>
                {typeof geometry.properties?.label === 'string'
                  ? geometry.properties.label
                  : 'Selected area'}
              </strong>
              <small>
                {geometry.geometry.type} · {geometry.geometry.coordinates?.flat?.(2).length || 1}{' '}
                coordinate values
              </small>
            </div>
            <button className="edit-link" onClick={() => setShowGeometry(true)}>
              Edit
            </button>
          </div>
          <div className="source-select">
            <label htmlFor="data-mode">DATA SOURCE</label>
            <div className="select-wrap">
              <select
                id="data-mode"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as 'live' | 'synthetic');
                }}
              >
                <option value="live">FEMA effective flood zones</option>
                <option value="synthetic">Synthetic demo shapes</option>
              </select>
              <span>⌄</span>
            </div>
          </div>
          {busy ? (
            <div className="loading" role="status">
              <span className="spinner" />
              Checking mapped zones…
            </div>
          ) : error ? (
            <div className="error-card" role="alert">
              <span>!</span>
              <div>
                <strong>Source unavailable</strong>
                <p>{error}</p>
                <button
                  onClick={() => {
                    setMode('synthetic');
                  }}
                >
                  View synthetic demo
                </button>
              </div>
            </div>
          ) : result ? (
            <>
              <div className="summary-card">
                <div className="summary-top">
                  <span>{exposureLabel}</span>
                  <span className="summary-check">✓ ANALYZED</span>
                </div>
                <strong className="summary-number">
                  {geometry.geometry.type === 'Polygon'
                    ? fmt(result.mappedAreaM2)
                    : result.intersectingCount}
                </strong>
                <span className="summary-unit">
                  {geometry.geometry.type === 'Polygon'
                    ? result.mode === 'synthetic'
                      ? 'inside invented examples; not a real mapped hazard result'
                      : 'within mapped polygons, including minimal-hazard zones'
                    : result.mode === 'synthetic'
                      ? 'synthetic demo polygons intersect this geometry'
                      : 'FEMA mapped features intersect this geometry'}
                </span>
                <div className="summary-rule" />
                <div className="summary-bottom">
                  <span>
                    {result.intersectingCount} intersecting{' '}
                    {result.mode === 'synthetic' ? 'demo' : 'zone'} features
                  </span>
                  <span>{result.byClass.length} mapped classes</span>
                </div>
              </div>
              {result.assets && (
                <section className="asset-results" aria-labelledby="asset-results-title">
                  <div className="section-title">
                    <span id="asset-results-title">ASSET-LEVEL SCREENING</span>
                    <span>
                      USER DATA · {result.mode === 'synthetic' ? 'SYNTHETIC ZONES' : 'FEMA NFHL'}
                    </span>
                  </div>
                  <p>{result.assets.source}</p>
                  <div className="asset-counts">
                    <strong>{result.assets.intersectingZoneCount}</strong>
                    <span>
                      of {result.assets.withinAreaCount} assets inside the selected area intersect
                      mapped zones
                    </span>
                  </div>
                  <small>
                    {result.assets.uploadedCount} uploaded ·{' '}
                    {result.assets.uploadedCount - result.assets.withinAreaCount} outside the
                    selected area
                  </small>
                  {result.assets.byZone.length > 0 && (
                    <ul>
                      {result.assets.byZone.map((item) => (
                        <li key={item.zone}>
                          Zone {item.zone}: {item.assetCount} asset
                          {item.assetCount === 1 ? '' : 's'}
                        </li>
                      ))}
                    </ul>
                  )}
                  <details>
                    <summary>Inspect asset results ({result.assets.features.length})</summary>
                    <ul>
                      {result.assets.features.slice(0, 100).map((item, index) => (
                        <li key={`${item.label}-${index}`}>
                          <strong>{item.label}</strong> ·{' '}
                          {item.exposed
                            ? `intersects ${item.zones.join(', ')}`
                            : 'no returned zone intersection'}
                        </li>
                      ))}
                    </ul>
                    {result.assets.features.length > 100 && (
                      <small>
                        Showing first 100 assets; full details are included in GeoJSON export.
                      </small>
                    )}
                  </details>
                </section>
              )}
              <div className="class-list">
                <div className="section-title">
                  <span>MAP ZONE INSPECTOR · SELECT A CLASS TO HIGHLIGHT</span>
                  <span>{counts.length} CLASSES</span>
                </div>
                {selectedZone && (
                  <button className="clear-zone" onClick={() => setSelectedZone(null)}>
                    Clear zone highlight ×
                  </button>
                )}
                {counts.length ? (
                  counts.map((item, i) => (
                    <button
                      className="zone-row zone-select"
                      type="button"
                      aria-pressed={selectedZone === item.zone}
                      onClick={() => setSelectedZone(selectedZone === item.zone ? null : item.zone)}
                      key={`${item.zone}-${item.subtype}-${i}`}
                    >
                      <i className={`zone-swatch ${item.sfha === 'T' ? 'sfha' : 'other'}`} />
                      <div className="zone-info">
                        <strong>Zone {item.zone}</strong>
                        <small>
                          {item.subtype ||
                            (item.sfha === 'T'
                              ? 'Special flood hazard area'
                              : 'Other mapped flood zone')}
                        </small>
                      </div>
                      <div className="zone-stat">
                        <strong>
                          {geometry.geometry.type === 'Polygon'
                            ? fmt(item.areaM2)
                            : `${item.featureCount}×`}
                        </strong>
                        {geometry.geometry.type === 'Polygon' && (
                          <small>{item.sfha === 'T' ? 'SFHA' : 'MAPPED'}</small>
                        )}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="no-zones">
                    <span>○</span>
                    <div>
                      <strong>No mapped zone intersects this selection</strong>
                      <p>
                        Unmapped or unmapped-as-hazard areas can still flood. This result does not
                        indicate safety.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="source-card">
                <div className="source-header">
                  <span className="source-icon">◈</span>
                  <div>
                    <strong>{result.source.name}</strong>
                    <small>
                      {result.mode === 'synthetic'
                        ? 'DEMONSTRATION DATA'
                        : 'OFFICIAL MAPPED SOURCE'}
                    </small>
                  </div>
                  <span
                    className={result.mode === 'synthetic' ? 'source-badge demo' : 'source-badge'}
                  >
                    {result.mode === 'synthetic' ? 'DEMO' : 'NFHL'}
                  </span>
                </div>
                <div className="source-meta">
                  <div>
                    <span>Retrieved</span>
                    <strong>
                      {new Date(result.source.retrievedAt).toLocaleString([], {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      })}
                      {result.cached ? ' · cached' : ''}
                    </strong>
                  </div>
                  <div>
                    <span>Reference</span>
                    <strong>{result.source.spatialReference}</strong>
                  </div>
                  <div>
                    <span>Coverage confidence</span>
                    <strong>{result.source.confidence}</strong>
                  </div>
                  <div>
                    <span>Mapped detail</span>
                    <strong>{result.source.maxResolution}</strong>
                  </div>
                  <div>
                    <span>Effective date</span>
                    <strong>{result.source.effectiveDate}</strong>
                  </div>
                </div>
                {result.source.url ? (
                  <a href={result.source.url} target="_blank" rel="noreferrer">
                    Source details ↗
                  </a>
                ) : (
                  <span className="no-source-link">No external source · synthetic fixture</span>
                )}
              </div>
            </>
          ) : null}
          <div className="panel-actions">
            <button className="export-button" onClick={exportResult} disabled={!result}>
              <span>⇩</span> Export GeoJSON <small>with source metadata</small>
            </button>
            <button
              className="text-button"
              onClick={() => setShowMethod((v) => !v)}
              aria-expanded={showMethod}
            >
              How this screening works <span>{showMethod ? '−' : '+'}</span>
            </button>
            {showMethod && (
              <div className="method-copy">
                <p>
                  FloodSense intersects your selected geometry with current FEMA NFHL mapped
                  flood-zone polygons. Polygon summaries use geodesic area on the returned EPSG:4326
                  geometries; point and line selections report intersecting feature counts.
                </p>
                <p>
                  This does not calculate a probability or predict flooding. Effective map coverage
                  varies; zones and dates vary by panel. Levees, unmapped locations, rainfall-driven
                  flooding, changing conditions, terrain resolution, and local studies may not be
                  represented.
                </p>
              </div>
            )}
          </div>
          <div className="disclaimer">
            <span>ⓘ</span>
            <p>
              <strong>Screening only.</strong> Not an official flood determination, emergency
              warning, insurance decision, or engineering study. No mapped hazard is not proof of
              safety. Address lookup uses the Census Geocoder; FloodSense is not endorsed or
              certified by the U.S. Census Bureau.
            </p>
          </div>
        </aside>
      </main>
      <footer className="footer">
        <span>
          FloodSense <i>·</i> Public data, transparently presented
        </span>
        <span>
          <a
            href="https://www.fema.gov/about/glossary/national-flood-hazard-layer-nfhl"
            target="_blank"
            rel="noreferrer"
          >
            About NFHL
          </a>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            © OpenStreetMap
          </a>
          <a
            href="https://support.esri.com/en-us/knowledge-base/what-is-the-correct-way-to-cite-an-arcgis-online-basema-000012040"
            target="_blank"
            rel="noreferrer"
          >
            Imagery © Esri
          </a>
          <a
            href="https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html"
            target="_blank"
            rel="noreferrer"
          >
            Census Geocoder
          </a>
        </span>
      </footer>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(<App />);
