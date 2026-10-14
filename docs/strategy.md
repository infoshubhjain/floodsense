# Technical strategy

Niche: an auditable vector workflow intersecting user-provided infrastructure GeoJSON with returned FEMA effective mapped flood-zone polygons. Target users are GIS learners, facility analysts and community organizations doing preliminary inventory screening. The contribution is bounded geometry validation, provenance and efficient candidate filtering before exact predicates—not flood-depth or damage modeling.

| Direction                                      |  CS | Domain | Useful | Distinct | Feasible | Verifiable | Accessible | Interview | Total / 40 |
| ---------------------------------------------- | --: | -----: | -----: | -------: | -------: | ---------: | ---------: | --------: | ---------: |
| Traceable asset-to-zone screening **selected** |   5 |      5 |      4 |        5 |        5 |          5 |          5 |         5 |         39 |
| Gage-specific inundation/depth scenario        |   5 |      5 |      5 |        4 |        1 |          2 |          3 |         5 |         30 |
| Nationwide rainfall/terrain pluvial model      |   5 |      3 |      4 |        3 |        1 |          2 |          3 |         5 |         26 |

Alternatives: [FEMA NFHL/Map Service Center](https://msc.fema.gov/portal/home) is the official source for effective mapped products; [USGS Flood Inundation Mapper](https://www.usgs.gov/tools/flood-inundation-mapper) presents studied gage-stage scenarios; [FEMA Hazus](https://www.fema.gov/flood-maps/products-tools/hazus) includes depth/damage methods; [NOAA Atlas 14](https://hdsc.nws.noaa.gov/pfds/pfds_gis.html) provides precipitation-frequency estimates with uncertainty bounds, not direct flood depth. The niche is a small source-aware asset screening and export workflow.

Technical proof: precompute geometry bounds, reject disjoint pairs cheaply, then use exact Turf intersection on candidates. Test indexed-vs-brute-force result equivalence and boundary touches; benchmark candidate reduction and elapsed time on deterministic sparse fixtures.

Scope: FEMA vectors vary in coverage, effective date and mapping detail. Asset-zone intersection does not establish inundation depth, probability, damage, financial exposure, survey-grade accuracy or safety. This is screening, not an official determination.
