/**
 * Properties — Minha Morada API proxy for Portuguese real estate listings.
 * Free public API (100 req/hour per IP). Server-side proxy keeps any
 * future API key private and normalizes CORS.
 */
export function propertiesProxy() {
  const API_BASE = 'https://minhamorada.pt/api/v1';
  const cache = new Map();
  const CACHE_TTL = 5 * 60 * 1000;

  const installMiddleware = (server) => {
    server.middlewares.use('/api/properties', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      try {
        const cacheKey = url.pathname + url.search;
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(cached.data));
          return;
        }

        // The middleware strips the matched /api/properties prefix, so
        // req.url is typically just "?params" or "/?params". Reconstruct
        // the full upstream path: /api/v1/properties + query string.
        const upstream = new URL(API_BASE + '/properties' + url.search);
        const resp = await fetch(upstream);
        const rateLimit = resp.headers.get('X-RateLimit-Remaining');
        if (rateLimit !== null) {
          res.setHeader('X-RateLimit-Remaining', rateLimit);
        }
        if (!resp.ok) {
          res.statusCode = resp.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({ error: `Minha Morada API HTTP ${resp.status}` }),
          );
          return;
        }
        const data = await resp.json();
        cache.set(cacheKey, { ts: Date.now(), data });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
      } catch (e) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Properties proxy error',
            detail: e?.message || String(e),
          }),
        );
      }
    });
  };

  return {
    name: 'properties-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
