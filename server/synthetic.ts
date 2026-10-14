// These illustrative shapes are invented and are never returned unless demo mode is explicitly selected.
import type { ZoneFeature } from '../shared/types.js';

export const syntheticZones: ZoneFeature[] = [
  {
    type: 'Feature',
    properties: {
      FLD_ZONE: 'AE',
      ZONE_SUBTY: 'Synthetic special flood hazard area example',
      SFHA_TF: 'T',
      DFIRM_ID: 'SYNTH'
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-93.268, 44.977],
          [-93.261, 44.977],
          [-93.261, 44.983],
          [-93.268, 44.983],
          [-93.268, 44.977]
        ]
      ]
    }
  },
  {
    type: 'Feature',
    properties: {
      FLD_ZONE: 'X',
      ZONE_SUBTY: 'Synthetic minimal hazard example',
      SFHA_TF: 'F',
      DFIRM_ID: 'SYNTH'
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-93.274, 44.976],
          [-93.269, 44.976],
          [-93.269, 44.984],
          [-93.274, 44.984],
          [-93.274, 44.976]
        ]
      ]
    }
  }
];
