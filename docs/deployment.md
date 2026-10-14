# Deployment

FloodSense has a single Node server and a static Vite build. There is no database, login, secret, paid data product, or separate spatial service. The repository includes a production Dockerfile; use any host only after checking that its current terms and cost fit your needs. This project has not been deployed publicly.

## Run the production container

```sh
docker build -t floodsense .
docker run --rm -p 4173:4173 -e PORT=4173 floodsense
```

Visit `http://localhost:4173`. Put a production instance behind HTTPS. If the browser frontend is served from a different exact origin, configure `ALLOWED_ORIGIN` to that origin. Keep the API and frontend same-origin where possible. Do not use `*` for CORS. Only trust proxy headers when the app is behind a proxy you operate.

## Health and operations

- `GET /api/health` returns a small readiness response; it does not verify third-party availability.
- Check live FEMA behavior through the app’s visible source state, not the health endpoint.
- FEMA result cache and request counters are per-process, in-memory, and lost at restart. No scheduled refresh runs. Each new uncached query retrieves current service data; the UI displays retrieval time and cached status.
- Monitor provider errors and rate-limit responses without recording search strings, AOI coordinates, or request bodies.
- Recheck FEMA/Census/OSM terms and API behavior before increasing limits or adding a source.
- Do not enable public hosting or attach a paid service without explicit authorization. TLS and public availability depend on the selected operator/host.
