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
| `GET` | `/photos?count=12` | A batch of random landscape photos. Query, orientation and filter are fixed server-side. |
| `POST` | `/download` | Body `{"downloadLocation": "https://api.unsplash.com/photos/<id>/download"}`. Records the download, as the guidelines require. |
| `GET` | `/health` | Liveness. Needs no origin, returns no data. |

Everything else is `404`. Requests must carry an `Origin` of the form
`chrome-extension://<32 chars>`; web pages get `403`.

## Limits worth knowing

**Unsplash's Demo quota is the hard ceiling, and caching only partly helps.**

| Endpoint | Upstream cost | Why |
|---|---|---|
| `GET /photos` | ~12 requests/hour, **regardless of user count** | Cached at the edge for 30 min across 6 buckets (6 buckets x 2 refreshes/hour). Simulated: 5 to 10,000 calls/hour all settle at ~12 upstream/hour. |
| `POST /download` | **1 per photo per user** | Deliberately NOT cached or de-duplicated. |

Demo allows 50 requests/hour in total, shared by every user. That leaves about
38/hour for `/download`. As a rough guide, with each user viewing about 3 new
photos a day, **the Demo tier supports roughly 100 daily-active users**; at 12
new photos a day per user it supports only a few dozen.

Why `/download` is not de-duplicated: Unsplash's
[guideline](https://help.unsplash.com/api-guidelines/guideline-triggering-a-download)
describes the endpoint as an event counter, "very similarly to the pageview
event in Google Analytics", that feeds photographers' download numbers.
Collapsing many users' use of one photo into a single call would under-report
their work. The guideline does not permit it, so the Worker does not do it.

Going beyond roughly 100 users therefore requires **Production status**
(1,000 requests/hour), which Unsplash grants on review, and that review is also
where the "wallpaper app" rule above is applied.

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

Wrangler prints the Worker's URL (`https://quiet-tab-unsplash-proxy.<subdomain>.workers.dev`).

Then build the extension against it, with **no** Access Key in the environment:

```bash
# .env.local
VITE_UNSPLASH_PROXY_URL=https://quiet-tab-unsplash-proxy.<subdomain>.workers.dev
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
