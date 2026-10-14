import type { Feature, LineString, Point, Polygon } from 'geojson';

export type SupportedGeometry = Point | LineString | Polygon;
export type FloodFeature = Feature<SupportedGeometry, Record<string, unknown>>;
export type ZoneProperties = {
  FLD_ZONE?: string;
  ZONE_SUBTY?: string | null;
  SFHA_TF?: string | null;
  DFIRM_ID?: string | null;
};
export type ZoneFeature = Feature<Polygon, ZoneProperties>;
export type ZoneSummary = {
  zone: string;
  subtype: string | null;
  sfha: string | null;
  featureCount: number;
  areaM2: number;
};
export type SourceMetadata = {
  name: string;
  url: string | null;
  attribution: string;
  confidence: string;
  retrievedAt: string;
  spatialReference: string;
  maxResolution: string;
  effectiveDate: string;
};
export type AnalysisResult = {
  geometry: FloodFeature;
  zones: ZoneFeature[];
  intersectingCount: number;
  mappedAreaM2: number;
  byClass: ZoneSummary[];
  source: SourceMetadata;
  mode: 'live' | 'synthetic';
  cached: boolean;
};
