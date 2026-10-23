# Frontend release audit — FloodSense civic flood atlas

Checked 2026-10-23 against the previous committed redesign (`HEAD` before this release) and the current working build.

## Product and information architecture

- Primary user job: explore a labeled example, adjust or select the domain input, inspect a defensible result, and export enough provenance to reproduce it.
- Reading order: Source status and analysis map lead; class table, provenance, export, and interpretation follow.
- Interaction corrected in this release: Selecting a class scrolls to the map and highlights only matching zone code and subtype; the map displays the active class and a clear control.
- Technical implementation: existing frontend and API architecture was retained. The Vite build no longer recycles generated `public/` assets, so only the current bundle ships. No new runtime dependency was added.

## Evidence

| Check                     | Result                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Previous build JavaScript | 120380 gzip bytes                                                                                           |
| Current build JavaScript  | 120545 gzip bytes (+165)                                                                                    |
| Current build CSS         | 12395 gzip bytes                                                                                            |
| Browser and API checks    | 17 API/analysis tests and 5 browser tests passed, including duplicate zone-code subtypes and mobile layout. |
| Screenshots               | See the README linked desktop and mobile captures generated from the current browser flow.                  |

Bundle measurements sum the compressed generated `assets/*.js` and `assets/*.css` files. They do not measure first-load latency, network transfer on a specific host, or main-thread work. The previous build was reproduced from the prior commit in an isolated temporary checkout with the same installed dependencies.

## Accessibility and responsive review

- Core controls use visible labels or accessible names. The new selection state uses native buttons/slider controls or an explicit map clear button.
- Browser checks exercise the core flow and phone/tablet widths; existing full-page screenshots are kept with the repo.
- Data remain available in text, tables, or exports when charts or maps cannot be interpreted.
- A formal WCAG audit with assistive technology and automated contrast/axe tooling has not been completed. This remains a release follow-up before claiming accessibility conformance.

## Scientific and operational limits

Demo polygons are synthetic, and FEMA flood-zone screening is not a parcel-level risk forecast. Live provider availability varies. No screenshot, synthetic example, or model output is evidence of field validation. Public hosting and external data availability are tracked in the README/deployment docs.

## Release checks

- [x] Displayed selection and chart/data agree in browser tests.
- [x] Existing unit/API tests and production build pass.
- [x] Responsive browser workflow passes.
- [ ] Repeat a manual screen-reader review and public-host latency measurement after deployment.
