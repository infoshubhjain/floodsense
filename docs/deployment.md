# Deployment

FloodSense is live at [floodsense-rosy.vercel.app](https://floodsense-rosy.vercel.app/). Vercel serves the Vite frontend from `public/` and runs the Express API as a Vercel Function; `npm run build:vercel` creates both outputs. The API and browser are same-origin. There is no database, login, secret, or paid data product. The older Render service remains deployed for comparison but its FEMA requests failed from that region in the last check; it is not part of the public Vercel request path or a verified live fallback. The Vercel deployment is connected to GitHub `main`.

Vercel Functions have a [4.5 MB request/response payload limit](https://vercel.com/docs/functions/limitations), so FloodSense rejects analysis responses above 4 MB and restricts request bodies to 1.2 MB. Function instances are ephemeral and can scale independently: the five-minute FEMA cache, 30-request limiter, and four-query concurrency guard apply per instance, not globally. This is suitable for a small public demo, not a shared operational quota. Vercel's [Hobby limits](https://vercel.com/docs/plans/hobby) and third-party FEMA availability still apply.

## Run the production container

```sh
docker build -t floodsense .
docker run --rm -p 4173:4173 -e PORT=4173 floodsense
```

Visit `http://localhost:4173`. `VITE_TILE_URL` configures one HTTPS XYZ tile template (defaults to OpenStreetMap); the backend Content Security Policy allows that template origin and the UI retains tile attribution. If changed, set the same value at frontend build and runtime. A tile failure shows an on-map message and does not disable analysis. Put a production instance behind HTTPS. Same-origin checks use the request protocol; if TLS terminates at your reverse proxy, configure `TRUST_PROXY_HOPS` to its exact trusted hop count (usually `1`) and prevent clients from bypassing that proxy. It defaults to `0` and accepts only `0`–`5`. If the browser frontend is served from a different exact origin, configure `ALLOWED_ORIGIN` to that origin. Keep the API and frontend same-origin where possible. Do not use `*` for CORS.

## Health and operations

- `GET /api/health` returns a small readiness response; it does not verify third-party availability.
- Check live FEMA behavior through the app’s visible source state, not the health endpoint.
- FEMA result cache and request counters are per-instance, in-memory, and lost at restart. No scheduled refresh runs. Each new uncached query retrieves current service data; the UI displays retrieval time and cached status.
- Monitor provider errors and rate-limit responses without recording search strings, AOI coordinates, or request bodies.
- Recheck FEMA/Census/OSM terms and API behavior before increasing limits or adding a source.
- The included Render blueprint remains available for Docker hosting. Do not attach a paid service without the user's approval. TLS and public availability depend on the selected operator/host; deployment still needs a user-owned host connection.
