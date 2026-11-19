# Question-map API

FastAPI backend for the "AI kérdés-válasz kommentár" button in the right panel. It runs the
[meforshim](../meforshim) pipeline (git submodule) on demand and caches results in `meforshim/out/`.

```
git clone --recurse-submodules <repo>      # or: git submodule update --init
python -m venv venv && venv/bin/pip install -r api/requirements.txt
cp meforshim/.env.example meforshim/.env   # add the LLM keys
cd api && ../venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001
```

Talmud segments work the same way (`Berakhot.2a.5`, used by [../talmud](../talmud)).

Endpoints: `GET/POST /api/map/Genesis.17.17` (status/start), `GET /api/map/Genesis.17.17/html`.
Env: `MAX_PARALLEL_JOBS` (2), `MAX_NEW_PER_DAY` (200), `MEFORSHIM_OUT`, `ALLOWED_ORIGINS` (dev CORS).
The frontend uses `/api` (nginx proxy, see `deploy/`); override with `NEXT_PUBLIC_API_BASE`.

The question-map source links open a separate reader. It retrieves the exact linked
Hebrew/Aramaic source from Sefaria and translates it into Hungarian on the server
using the existing LLM configuration in `meforshim/.env`. The translation is
identified as AI-generated and cached under `MEFORSHIM_OUT` by source text and
model. `SOURCE_TRANSLATION_MODEL` selects an `llm.py` model (default: `gpt-6-luna`);
`MAX_SOURCE_TRANSLATIONS_PER_DAY` limits new translation attempts per API process
(default: 200). Existing cached translations do not count against this limit.
The source must appear in the latest question-map result. The API process needs
write access to the output directory and network access to Sefaria and the model
provider. The separate daily limit, like the map limit, resets on process restart.
The translation request can take longer than map status polls; configure the
proxy timeout as shown in `deploy/nginx.conf.sample` on existing deployments too.

Production: run it with pm2 (`api/ecosystem.config.js`), see the root README.

## Pocket ID and bookmarks

Create a confidential Pocket ID client and set its **Callback URL** to
`https://esstorah.com/` if that is the frontend's canonical address. The URL
must match the frontend's origin and the API's `OIDC_REDIRECT_URI` exactly,
including the trailing slash. The browser uses its current origin: redirect
`www.esstorah.com` to the canonical domain before login, or use a separately
configured client and API for that origin. Pocket ID manages
account creation/invitations; this application does not create accounts itself.
Set these variables in the API process environment (for pm2, in the local
ecosystem config's `env` object), then restart the API:

```
OIDC_ISSUER=https://auth.binjomin.hu
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
OIDC_REDIRECT_URI=https://esstorah.com/
BOOKMARKS_DATABASE_PATH=/path/to/persistent/bookmarks.sqlite3
```

Never put the secret in `NEXT_PUBLIC_*` or a committed file. The issuer and
client ID are exposed to the browser by `/api/auth/config`; the secret is used
only by the token proxy. The frontend and Pocket ID discovery endpoint must be
reachable from the browser, and Pocket ID must allow discovery CORS.
For local development register `http://localhost:3000/` as a separate exact
redirect and use that value in the API. Point `NEXT_PUBLIC_API_BASE` at the
backend's `/api` URL (for example `http://localhost:8001/api`); set
`ALLOWED_ORIGINS=http://localhost:3000` in the API. Without `ALLOWED_ORIGINS`
cross-origin access is disabled; same-origin nginx proxying needs no CORS.

The API verifies JWT signatures, issuer, expiry and subject against Pocket ID's
JWKS. Set `OIDC_AUDIENCE` to the access-token audience when the provider issues
one; if unset, audience validation is disabled as in the setup guide. Access
and refresh tokens are stored in browser localStorage, so an XSS in the main
site can expose them. Generated map pages are sandboxed, including when opened
directly, to isolate their scripts from the site's storage. Serve the site over
HTTPS in production.

The SQLite database defaults to `api/data/bookmarks.sqlite3`; its directory must
be writable by the API user. Keep it outside ephemeral deployments and back it
up. Bookmarks are tied to the OIDC subject and contain the selected full
question or answer, the parasha and verse reference. They remain available
even if a map is regenerated; updated text can be saved as a new bookmark.
`GET/POST /api/bookmarks` and `DELETE /api/bookmarks/{id}` require a bearer
access token.
