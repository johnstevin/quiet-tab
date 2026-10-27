# Quiet Tab Unsplash proxy

A small Cloudflare Worker that keeps the Unsplash **Access Key** out of the
published extension.

## Why

[Unsplash's API Guidelines](https://help.unsplash.com/api-guidelines/unsplash-api-guidelines)
require the Access Key to stay confidential, and say that client-side use "may
require using a proxy". A key inlined into an extension bundle can be read by
anyone who unzips it. Here the key lives only as a Worker secret.

This does **not** replace Unsplash's separate rule against wallpaper-style apps
that [replicate Unsplash's core experience](https://help.unsplash.com/api-guidelines/guideline-replicating-unsplash).
Get Unsplash's written answer on that before distributing.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` (extension) / `GET` (explicit Origin) | `/photos?count=12` | Read a batch of landscape photos. Chrome omits Origin on extension GET requests, so the extension uses POST; both methods share the same fixed upstream and cache. |
| `POST` | `/download` | Body `{"downloadLocation": "https://api.unsplash.com/photos/<id>/download"}`. Records the download, as the guidelines require. |
| `GET` | `/health` | Liveness. Needs no origin, returns no data. |

Everything else is `404`. Requests must carry an `Origin` of the form
`chrome-extension://<32 chars>`; web pages get `403`.

## Limits worth knowing

**Unsplash's Demo quota is the hard ceiling, and caching only partly helps.**

| Endpoint | Upstream cost | Why |
|---|---|---|
| `/photos` | Approximately 12 requests/hour **per active edge location and distinct count value**, after warming | Cached for 30 min across 6 buckets. Cache API is local to each Cloudflare edge location; concurrent cold misses can cause additional upstream calls. This is not a global quota limit. |
| `POST /download` | **1 per photo per user** | Deliberately NOT cached or de-duplicated. |

Demo allows 50 requests/hour in total, shared by every user. The remaining
budget for `/download` depends on edge-location spread, batch sizes, cold
misses and peak traffic. Do not infer a guaranteed daily-active-user capacity
from a single-location simulation. Public-scale use needs quota monitoring and
an approved Production application before traffic outgrows the Demo budget.

Why `/download` is not de-duplicated: Unsplash's
[guideline](https://help.unsplash.com/api-guidelines/guideline-triggering-a-download)
describes the endpoint as an event counter, "very similarly to the pageview
event in Google Analytics", that feeds photographers' download numbers.
Collapsing many users' use of one photo into a single call would under-report
their work. The guideline does not permit it, so the Worker does not do it.

**Production status** increases the default allowance (subject to Unsplash's
current approval terms). It does not replace confirmation that this specific
background integration complies with the API guidelines.

Workers Free itself is not the constraint: 100,000 requests/day, 10 ms CPU per
request.

## Deploy

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put UNSPLASH_ACCESS_KEY     # paste the ACCESS key, never the Secret Key
npx wrangler deploy
```

This deployment uses **https://quiet-tab-api.fgglog.ccwu.cc**. The configuration
adds that exact hostname as a Custom Domain, without changing the zone's apex
homepage or other Workers. Cloudflare manages its DNS record and TLS certificate.
`GET /health` should return `{"ok":true}`. Requests to the other endpoints without
an extension Origin intentionally return 403.

Then build the extension against it, with **no** Access Key in the environment:

```bash
# .env.local
VITE_UNSPLASH_PROXY_URL=https://quiet-tab-api.fgglog.ccwu.cc
# VITE_UNSPLASH_ACCESS_KEY must be empty or absent
npm run build
```

The build refuses to run if both variables are set.

### Pin it to your published extension

Until the extension ID is known the Worker accepts any Chrome extension. Once
it is published, restrict it:

```bash
npx wrangler secret put ALLOWED_EXTENSION_IDS    # comma-separated 32-char IDs
```

Note this is a convenience, not strong authentication: an `Origin` header can be
forged by a non-browser client. The real protections are the fixed upstream
request, the SSRF guard on `/download`, and the edge cache.

## Local development

```bash
cp .dev.vars.example .dev.vars    # gitignored; put the key here
npm run dev
npm test
npm run typecheck
```
