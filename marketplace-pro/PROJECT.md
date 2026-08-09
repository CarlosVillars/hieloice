# HieloIce — Project Documentation

This file is the single source of truth for the HieloIce project: what it is, how
it's built, how to deploy it, and where it's headed. It lives in the repo on
purpose — the code and this file should always travel together, independent of
any particular chat tool or AI assistant. If you're picking this project back up
(a new developer, a new AI session, or Carlos himself six months from now),
start here.

## 1. What HieloIce is

HieloIce (hieloice.com) is a hybrid marketplace + social platform: a
Facebook Marketplace–style buy/sell site with a social layer growing around it
(profiles, friends, Moments/stories, followable public Pages, messaging,
notifications, ratings). Bilingual (Spanish/English) from the start. There is
also a separate "International" section: a directory of international
companies/vendors with an admin verification workflow.

The long-term product direction (see section 5, Roadmap) is to selectively fold
in the specific mechanics that make Facebook, Instagram, TikTok, Reddit,
Pinterest and LinkedIn effective — filtered through "does this help someone buy
or sell with more trust and better discovery," not feature-for-feature parity
with any one app.

## 2. Tech stack & architecture

- **Backend**: Plain Node.js (`http` module, no framework) — `marketplace-pro/server.js`.
  One file, hand-rolled router matching on `pathname`/`method`.
- **Frontend**: Vanilla JS single-page app, hash-based routing (no build step,
  no framework) — `marketplace-pro/public/app.js`, `index.html`, `style.css`,
  `i18n.js`, `legal.js`, `chatbot.js`, `sw.js`.
- **Database**: Supabase (hosted Postgres), accessed via its REST API
  (PostgREST) using the `service_role` key from the backend only. The frontend
  never talks to Supabase directly — every DB call goes through `server.js`.
  RLS (row-level security) is intentionally disabled on all `mkt_*` tables;
  access control is enforced in application code (`server.js`), not in Postgres
  policies. This is a deliberate simplicity trade-off for a single-backend app,
  not an oversight.
- **File storage**: Supabase Storage (photos, moment videos), uploaded from the
  backend as base64 data URLs converted to buffers.
- **Auth**: Custom token-based sessions (not JWT). On login/register, the
  server generates a random token (`crypto.randomBytes(24)`), stores it in the
  `mkt_sessions` table linked to `user_id`, and returns it to the client. The
  client stores it in `localStorage` (`authToken`) and sends it as
  `Authorization: Bearer <token>` on every authenticated request. Sessions do
  **not** expire automatically — they only end on explicit logout (or manual
  deletion from the DB). Google and Facebook OAuth are also supported,
  producing the same kind of session token at the end of the flow.
- **Push notifications**: Web Push (VAPID), no third-party push service.
- **Hosting**: Render (auto-deploys from GitHub `main` on every push).
- **Repo**: `github.com/CarlosVillars/hieloice`. `server.js` lives at
  `marketplace-pro/server.js`; everything else (frontend, this file) lives
  under `marketplace-pro/public/` and `marketplace-pro/`.

## 3. How to deploy

Auto-deploy is set up: **any push to `main` on GitHub triggers a Render
deploy automatically.** No manual Render step is normally needed.

Because the automated upload tools available to the AI assistant in this
project have been unreliable, changes have been deployed via GitHub's web
"Upload files" UI instead of `git push`. This works fine and is worth knowing
about even once that tooling is fixed:

1. Edit the file(s) locally (in the connected project folder).
2. Go to `https://github.com/CarlosVillars/hieloice/upload/main/marketplace-pro`
   to replace `server.js`, or
   `https://github.com/CarlosVillars/hieloice/upload/main/marketplace-pro/public`
   to replace any frontend file (`app.js`, `index.html`, `style.css`,
   `i18n.js`, etc.).
3. Click **"choose your files"**, select the updated file(s) from the local
   folder (not drag-and-drop of a whole folder — that has caused nested-path
   bugs before), and commit directly to `main`.
4. Render redeploys automatically within roughly a minute. Static assets
   (`.html`/`.js`/`.css`) are served with `Cache-Control: no-cache,
   must-revalidate`, so browsers always revalidate against the server instead
   of serving a stale cached copy after a deploy.

If normal `git` access is available instead, that obviously works too — this
workflow exists only because of a tooling limitation on the assistant's side,
not because it's the "correct" way to deploy.

## 4. Environment variables (set on Render)

Names only — the actual values live in Render's environment settings and
should also be kept somewhere safe outside of any chat (a password manager),
since they're never something an AI assistant should need to see or store.

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project REST URL |
| `SUPABASE_KEY` | Supabase `service_role` key (backend-only, full DB access) |
| `APP_URL` | Public base URL of the app (used for OAuth redirects, etc.) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth login |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Facebook OAuth login |
| `OWNER_EMAIL` | Marks that account as the platform owner (`isOwner` flag, used for admin-only screens like the international-company verification queue) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push notification signing |
| `PORT` | Set automatically by Render |

## 5. What's built (feature inventory)

**Marketplace core**: categories, listings, product detail, offers, search
with price/sort filters, Sold/Reserved status, ratings & reviews, report
listings/users with auto-flagging on repeated reports, rotating ad carousel.

**Accounts & trust**: email/password + Google/Facebook OAuth, phone field,
rate limiting on login/register, mandatory Terms & Privacy acceptance at
signup, bilingual legal pages, "Report a Bug" flow.

**Social layer**: Facebook-style profile (cover photo, avatar, photo gallery,
about section), mutual Friends system (request/accept), Moments — 24h
photo/video stories, video up to 3 minutes with audio, max 3 active moments
per user, chat privacy settings, unread-message badge, in-app notifications
with push.

**Pages & Follow**: any user can mark their own profile as a public "Page"
(`is_page` + `page_category`); Pages are followable via a separate
one-directional Follow system (distinct from mutual Friends).

**Discovery feed**: Home feed with two sections — friends' Moments, and a
"suggested" section (followed Pages first, then other Pages ranked by
follower count). A dedicated full-screen vertical video feed ("Moments" in
the UI, `shorts` internally in code/routes) showing all video Moments
platform-wide, ranked by a v1 score: recency + friend bonus + followed-page
bonus + page bonus.

**International section**: company directory with registration, admin
verification queue, public filtered directory, company detail pages, legal
intermediary-disclaimer clause.

**Navigation**: top icon-nav bar (Home / Friends / Moments / Marketplace
dropdown [Marketplace + International] / Notifications), designed
deliberately narrow in scope to avoid overwhelming a first-time user.

**Not yet built**: escrow/held payment processing (task pending — needs a
processor decision first) is the one open item from the original build.

## 6. Roadmap — the "what to borrow from each app" analysis

This is the result of an explicit strategy discussion (see chat history for
full reasoning), prioritized for a marketplace, not a general social network.
Decided/in-progress items:

1. **Reddit-style communities** (highest priority): category/city-based
   groups (e.g. "Autos usados Santo Domingo") with upvote/downvote-ranked
   posts — questions, seller reviews, scam warnings. This is the piece
   Facebook Marketplace itself lacks (no community-driven trust signal),
   so it's a genuine differentiator, not a copy.
2. **Pinterest-style saved boards**: a "Guardar" action on product
   cards/detail pages, collections under the user's Profile (e.g. "Favoritos",
   "Para mi casa"), and a "N people saved this" demand signal surfaced to the
   seller. Cheap to build on the existing schema — new `mkt_saved_items`
   table + a handful of endpoints. Deliberately not a new top-level nav icon,
   to keep the icon-nav bar simple.
3. **Moments algorithm v2, TikTok mechanics + Instagram aesthetic**: evolve
   the existing v1 recency/social-graph score toward real engagement signals
   (watch time, replays, shares) — that's what makes TikTok's discovery feel
   "sticky." Explicitly paired with Instagram's visual restraint (typography,
   spacing, muted palette, card polish) rather than TikTok's denser visual
   style — Carlos's call, agreed.
4. **LinkedIn-style seller trust profile**: package the existing Pages +
   ratings data into a formal "trust profile" (tenure, verified badge, visible
   sales history) so evaluating a seller feels like reviewing a professional
   profile, not a bare listing. Agreed, not yet built.

Explicitly deprioritized (for now): Snapchat-style AR filters (expensive,
low ROI for a marketplace) and an open Twitter/X-style public real-time feed
(moderation/spam risk without a clear marketplace benefit). YouTube-style
long-form video is a "maybe later" — only if there's real demand for video
tours on high-value listings (cars, real estate).

## 7. Cost / infrastructure ceiling

Everything currently runs on free or already-committed tiers: Supabase free
tier (500MB DB, 1GB storage, 2GB bandwidth/month), GitHub free, Google/
Facebook OAuth free, Web Push free. All roadmap items in section 6 are pure
code changes on this same infrastructure — no new paid dependency required to
build them. The real ceiling is **usage volume**, not features: video Moments
will consume the 1GB Storage / 2GB bandwidth caps first as real users show up.
The plan is to finish polishing the product on free tiers and only upgrade
(Supabase Pro, ~$25/mo, being the first likely upgrade) once actual traffic
demands it — not before launch.

## 8. Known issues / lessons learned worth remembering

- A past bug: `refreshMe()` in `app.js` used to clear the user's session on
  *any* failed `/api/auth/me` call, including transient network errors — now
  fixed to only clear on a genuine HTTP 401.
- A more serious past bug: `applyStaticI18n()` in `app.js` referenced DOM
  elements (`nav-intl-label`, `nav-messages-label`) that had been removed from
  `index.html` during the icon-nav redesign. Since it wasn't wrapped in a
  try/catch, it threw on every fresh page load and silently aborted the rest
  of the init sequence (`refreshMe()`, `router()` never ran) — which looked
  exactly like being logged out, even though the auth token was never
  touched. Fixed by making `applyStaticI18n()` null-safe (a `setText()`
  helper that no-ops instead of throwing if an id doesn't exist) — this
  should prevent this whole class of bug from breaking the app again if
  markup and JS drift out of sync in a future edit.
- Static assets are served with `Cache-Control: no-cache, must-revalidate` in
  `serveStatic()` specifically so mobile browsers (where pull-to-refresh
  doesn't always force a true cache bypass) always get the latest deployed
  code.
- Sessions in `mkt_sessions` never expire server-side by design (only
  explicit logout removes them) — this was a deliberate simplicity choice,
  not an oversight, worth knowing if session-related bugs come up again.
