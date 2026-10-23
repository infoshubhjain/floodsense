# Methodology and limitations

## Analysis

FloodSense sends a validated GeoJSON Point, LineString, or Polygon to a fixed FEMA NFHL query endpoint. The provider filters to mapped flood-zone polygons that intersect the user’s selection. Each returned feature is intersected in application code:

- For polygon selections, report the geodesic area of the union of intersecting mapped zone polygons, by `FLD_ZONE` and `ZONE_SUBTY`. Unioning prevents duplicate features from inflating area. Different zone classes can overlap, so their individual areas are not necessarily additive.
- For line and point selections, report the count of intersecting mapped features by zone class. Do not assign an area to a line or point.
- Preserve the source’s `SFHA_TF` flag (`T`/`F`) as a separate category attribute. Zone X includes areas of minimal flood hazard and must not be read as the same mapped designation as an SFHA zone.

Optional user-supplied GeoJSON assets are validated individually and bounded to 500 features / 1 MB. A point, line, or polygon asset is counted as inside when it intersects the selected area, and as exposed when it also intersects one or more returned mapped zone polygons. Results include zone counts and inspectable feature labels; this is not a building-level depth, damage, or risk estimate. Uploaded assets are not cached or stored. Synthetic mode clearly reports intersections with illustrative shapes instead of FEMA.

Coordinates are accepted only as two-dimensional longitude/latitude in EPSG:4326. FEMA stores the source layer in EPSG:4269 (NAD83); the query requests its service output in EPSG:4326 and area is calculated geodesically on that output. The server-side service reprojection is not a survey-grade datum transformation. This application does not calculate raster depth, rainfall, terrain, vertical datum, nodata, model uncertainty, or a universal probability. It does not combine incompatible sources into an index.

## Limits

| Boundary                        |                                             Limit |
| ------------------------------- | ------------------------------------------------: |
| Selected geometry               |                                             64 KB |
| Request body (including assets) |                                            1.2 MB |
| User asset collection           |                               500 features / 1 MB |
| Geometry vertices               |                                               500 |
| Polygon area                    |                                         5,000 km² |
| Geometry envelope               |                                           5° × 5° |
| Returned FEMA features          |      500; larger/truncated responses are rejected |
| Provider response body          |                                              8 MB |
| Analysis response body          |                                              5 MB |
| Provider timeout                |              8 seconds total, including one retry |
| Concurrent live FEMA queries    |                              4 per server process |
| API requests                    |              30 per minute per observed client IP |
| FEMA response cache             | 5 minutes, at most 100 entries, in process memory |

An area exceeding a limit fails visibly and must be narrowed; there is no background broad-area query. The provider is not called with user-supplied URLs. Service failures return a safe message and never switch to synthetic data unless the user opts into demo mode.

## What this result cannot establish

NFHL coverage is not uniform and effective study dates vary by map panel. The layer’s vector scale, source studies, and positional detail vary; FloodSense does not infer parcel-level precision from the map display. Effective maps can omit locations and may not capture all local studies. Levees and structures have study-specific assumptions. Maps change as studies become effective. Climate, land use, channel conditions, and drainage can change after mapping. FEMA mapped zones do not represent every pluvial/rainfall-driven event, and an unmapped or minimal-hazard designation is not a guarantee against flooding.

The Census Geocoder returns an address-range coordinate, not a survey-quality building location. A search result therefore selects a small illustrative screening AOI around that matched point; users should inspect and adjust the geometry themselves.

This application does not provide life-safety guidance. Consult official FEMA maps and local authorities for decisions and current conditions. This is not an official FEMA determination, forecast, insurance decision, or engineering analysis.

## Validation record

Tests use small synthetic GeoJSON fixtures and Turf operations. They cover coordinate limits, self-crossing polygons, area/vertex/envelope caps, geometry boundary contact, point/polygon intersection, class metadata, duplicate-zone area union, asset collection limits and zone intersections, malformed provider features, provider errors, provider transfer limits, and source-mode requirements. One polygon fixture is compared with an independent Lambert Azimuthal Equal-Area projection reference calculation; the absolute area tolerance is 1 m². The live Minneapolis sample also returned Zone X and AE polygons. The live-area result is a screening overlay, not an independent official determination; no separate desktop GIS result was available.

# Live geometry transfer

FloodSense requests FEMA polygons with a maximum generalization offset of 0.000005 degrees in EPSG:4326 (about 0.6 m north–south). This reduces transfer size and server work; mapped boundaries and calculated overlap areas may differ slightly from the full precision service geometry. Treat the output as screening, and use the effective FEMA panel for parcel decisions.
