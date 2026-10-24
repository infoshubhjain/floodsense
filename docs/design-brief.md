# FloodSense: product design brief

## Audit and direction

1. **Difference:** A source-aware vector screening atlas intersects selected geometry and optional assets with effective mapped flood-zone polygons.
2. **User:** A GIS learner, facility analyst, or community group performing preliminary inventory screening.
3. **Concept:** A civic atlas with a full-width map, map-key typography, source ledger, and a restrained cyan/violet zone vocabulary. The map is the workspace, not a decorative hero.
4. **Primary action:** Search or draw a place, choose explicit demo/live source, inspect mapped classes and assets, then export geometry with provenance.
5. **Technical proof:** Per-class area, feature counts, source metadata, geometry type, and validated asset intersections connect the visible map to the analysis API.
6. **Visualization:** Map polygons keyed by SFHA and class; a zone ledger with matching code/subtype selection; source and limitation details beside the result.
7. **Remove:** Generic dashboard cards, implied parcel-level risk, and stale generated bundles. The previous release removed the bundle recycling path.
8. **Complete it:** Allow a polygon click on the map to select the same class as the ledger, without interrupting geometry-drawing mode. Keep the ledger and map selection synchronized.

## Implementation map

`src/main.tsx` owns the Leaflet map, source and geometry controls, class ledger, assets, and export. `server/index.ts` validates requests and uses fixed FEMA/Census providers; `server/analysis.ts` performs bounded spatial intersections; `shared/types.ts` defines API output. React, Leaflet, Express, and Turf are existing dependencies. The page is one spatial analysis workflow rather than several hollow routes.

The first visit uses clearly labeled synthetic polygons. Live FEMA coverage and map tiles vary by provider availability. Uploaded assets are bounded and not stored. The current baseline is 17 API/geometry tests and five browser flows; JavaScript was 120,545 gzip bytes before this pass. Leaflet and Turf account for meaningful weight; no replacement library is justified without a measured first-load target.

## Feature and route inventory

- **Screen:** One map-first analysis workspace with place/GeoJSON selection, source mode, class ledger, optional asset upload, provenance, and export. No fake secondary pages or shared UI package.
- **API:** `GET /api/health` and `/api/geocode`; `POST /api/analyze`. The latter validates geometry and requires explicit live or synthetic source mode.
- **Working controls:** Address/coordinate lookup, point/line/area drawing, keyboard GeoJSON editor, zone overlay and basemap, source switch, asset import, zone selection, and GeoJSON export.
- **Presentation only:** OSM/Esri tiles, brand mark, and map legend. Flood-zone boundaries and class counts come from analysis results; tiles do not determine exposure.
- **Constraint:** Live provider latency/coverage vary; validation and feature limits bound spatial work. First-load Leaflet weight is measurable, but this pass does not establish a latency bottleneck.

## Priorities and acceptance

- **P1 completed:** Clicking a zone polygon selects the exact code and subtype and updates the ledger; while drawing, clicks still add geometry points. Verify the map-to-ledger path in a browser test.
- **P2:** Preserve synthetic/live separation, geometry validation, keyboard GeoJSON alternative, source metadata, and phone layout.
- **Out of scope:** Depth, damage, probability, insurance, or safety determinations are unsupported by this vector screening model.
