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

The question-map source links open a full-screen reader that closes back to the
unchanged map. A directly opened map uses the reader's back button instead.
It retrieves the exact linked
Hebrew/Aramaic source from Sefaria and translates it into Hungarian on the server
using the existing LLM configuration in `meforshim/.env`. The translation is
identified as AI-generated. Hebrew text and navigation data are cached under
`MEFORSHIM_OUT` per map and reference; translations are cached by reference, source
text, model and translation format. Long translations are divided into aligned
Hebrew/Hungarian paragraph pairs; short texts remain a single pair. Older
translation caches are regenerated in the aligned format. Reopening a cached source does not require Sefaria or the model.
The reader's previous/next buttons follow Sefaria's neighboring commentary segments
and sections. To refresh a saved source, remove its entry from that map's
`source-texts` directory; a changed text will receive a new translation.
`SOURCE_TRANSLATION_MODEL` selects an `llm.py` model (default: `gpt-6-luna`);
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
Login opens Pocket ID in a popup; the callback returns its authorization result
to the original window, which exchanges the code. If popups are blocked, login
uses a full-page redirect. The popup must retain its opener across the provider
redirect.

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

## Admin commentary upload

The login requests the `groups` scope. Pocket ID returns group **names** in
userinfo; create a group named exactly `admins` and add the uploaders to it.
See [Pocket ID scopes and claims](https://pocket-id.org/docs/guides/scopes-and-claims).
Existing sessions created before the scope was added must log out and back in.
If the client uses custom claim mappings, ensure `groups` is released to
userinfo. Every preview and upload verifies the access token's signature,
issuer, expiry and audience (`OIDC_AUDIENCE`, or `OIDC_CLIENT_ID` by default),
then asks Pocket ID's userinfo endpoint for the current groups and checks the
subject. Userinfo must be reachable from the API server.

The API resolves `CONTENT_PATH` with the same Next.js environment loading
order as the static build. Configure it for the API process, or use the
project's `.env.local`; the API needs read/write permission to that persistent
directory. Literal paths need no Node.js subprocess; environment variable
expansion and other complex `.env` syntax require Node.js and the installed
Next.js dependencies. If `NODE_ENV` is set on the API, use the same value as
for the build. Uploaded Markdown sections
are written exclusively under the destination parasha's `perusim` as
`web-*.md`, without overwriting existing files. The public live-commentary
API exposes these notes immediately, without a build; a later build also
includes them. The browser reports an error if the live feed is unavailable.

This is server-side storage, not two-way vault sync: back up the server's
content directory. Existing FTP sync does not download the web uploads, and
reserves `perusim/web-*.md` to avoid overwriting them from a local vault.
Rendered web-upload Markdown does not execute raw HTML or unsafe links.

### Inline content editing

The same verified `admins` group may edit individual Hungarian verses and
commentary titles and bodies. `GET/PUT /api/admin/content/{slug}/{kind}/{item}`
requires admin authentication; saves reject stale revisions. The public
`GET /api/content-edits/{slug}` supplies the saved overrides immediately.
Overrides are stored in `CONTENT_PATH/.mytorah-edits.sqlite3`, independently
of the source Markdown. Back up this database together with the content
directory (including hidden files). FTP sync and static builds do not remove
or update these overrides; an override continues to take precedence if its
source is later changed or a web commentary is re-uploaded. Edits are not
synced back to the local vault. If the live API is unavailable, the page
reports the error and displays its static build instead.
