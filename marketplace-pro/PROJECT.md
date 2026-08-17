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

### Strategy — the wedge-product playbook (read this before building anything)

This is the north star for every product decision on HieloIce. Set explicitly
by Carlos on 2026-08-17; any AI session or developer picking this project up
should internalize this before making feature calls.

The real product is two things built together, on purpose, in this order:

1. **A social network for readers** — profiles, friends, Moments, followable
   Pages, communities, messaging. This is the retention/discovery engine a
   plain marketplace never has.
2. **A C2C marketplace, with books as the deliberate first product category**
   — the Amazon/Bezos playbook. Books are the wedge because they're
   universally in demand, standardized by ISBN, low logistical complexity per
   unit, and let us prove out trust mechanics (condition grading, commission,
   escrow-style payment protection, seller reputation) on a simple catalog
   before touching anything harder.

**Sequencing**: focus is 100% on books C2C and connecting readers with shared
interests until HieloIce clearly leads the used/C2C book market. Only then
does phase 2 begin: a second product category, which will bring its own
second audience into the social network (mirroring how Amazon expanded
category by category after owning books).

**What this means for how features get built, right now:**

- Anything built for "books" (categories, condition/product schema,
  commission/escrow, seller verification, moderation, search/discovery)
  should be architected generically enough to reuse for product 2 later —
  not hardcoded to books in ways that would require a rewrite.
- The social layer (profiles, Moments, communities, follow) is the permanent
  differentiator and should keep improving in parallel with the marketplace,
  not be treated as secondary.
- Two things matter above all else and should be the lens for every UX/product
  decision: the app has to be **easy to use**, and the **logistics** (how a
  book actually gets from seller to buyer, safely and simply) have to be
  excellent. When in doubt between a flashier feature and simplifying
  onboarding/listing/checkout/shipping, simplicity and logistics win.
- Continuous improvement is expected — this isn't a "build it once" project;
  treat every session as a chance to push the book-C2C + reader-social core
  forward, even absent a new explicit request.

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
5. When verifying a deploy by fetching raw file content, be aware that
   `raw.githubusercontent.com` sits behind a CDN that can serve a stale cached
   copy for a few minutes after a fresh push, even with a cache-busting query
   string. If a fetched file looks truncated or out of date right after a
   push, check the GitHub blob page itself (`.../blob/main/...`, which shows
   an authoritative line/byte count) or wait a couple minutes and re-fetch
   before assuming the deploy is broken.

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
platform-wide, ranked by the **v2 algorithm** (see below).

**Communities** (Reddit-style, `#/groups`): category/city-scoped groups with
upvote/downvote-ranked posts (discussion, question, seller review, scam
warning). Tables `mkt_groups`, `mkt_group_posts`, `mkt_group_post_votes`.
Reachable from the Marketplace dropdown, not a new top-level nav icon.

**Guardado / Saved** (Pinterest-style): a save toggle on every product
detail page (with a live count), collected under a "Guardado" tab on the
user's own Profile, grouped by collection (defaults to "Favoritos"). Table
`mkt_saved_items`.

**Moments v2 ranking** (TikTok-style behavior signals + Instagram-style
visual restraint on the player): the video feed (`/api/moments/videos/feed`)
now scores each video from recency + friend/follow/page bonuses (v1, kept)
*plus* per-viewer author affinity and global popularity built from real
watch behavior. The client reports a `complete` or `skip` event per video
(based on watch time vs. video duration) to `POST /api/moments/:id/event`,
and likes (double-tap on the video, or the heart button) go through
`POST/DELETE /api/moments/:id/like`. Tables `mkt_moment_events` (event log,
denormalizes the author id so affinity queries don't need the original
moment to still exist) and `mkt_moment_likes` (toggle state). This is still
JS-computed like v1 — same "simple now, upgradeable later" philosophy — but
the signal set (completion, skip, like, per-author affinity) is the same
shape a production ranker would use.

**Seller trust profile** (LinkedIn-style): an auto-computed "Verified Seller"
badge (phone on file + 3+ completed sales + 30+ days on the platform — no
manual review queue, unlike the International section below) shown on the
profile page and on the seller card of every product detail page. Profile
also shows total sales count and a "Sales History" list of the 5 most
recently sold listings. "Sold" (status set by the seller) is the completion
signal used, since there's no escrow system yet to confirm payment.

**Moments story-viewer action rail** (Reels/Shorts-style): the 24h ephemeral
story viewer (distinct from the algorithmic Shorts video feed above) has a
vertical action rail of 5 icons — like (flame), message/comments, share
(winged foot/talaria), repost (recycling triangle + plus), save (arrow into
tray) — sized to match Instagram's icon scale (38px button / 34px svg). The
flame, wing, and repost icons are pixel-traced from reference images Carlos
supplied (OpenCV contour extraction + Catmull-Rom curve smoothing, not
hand-drawn) and render as solid filled shapes (`.icon-solid` CSS class)
rather than the outline/fill toggle used by the simpler message and save
icons. Like and save are persistent per-user toggle state
(`mkt_moment_likes`, `mkt_moment_saves` tables, flame turns orange and save
turns gold when active); share uses the Web Share API (clipboard-copy
fallback); repost creates a new moment in the reposter's own story copying
the original's media/caption (`mkt_moments.repost_of`, subject to the same
3-active-moments cap as a normal post, flashes green on tap). Tapping the
author's avatar/name in the top-left of the viewer navigates to their
profile. Backend: `POST/DELETE /api/moments/:id/save`,
`POST /api/moments/:id/repost`; `/api/moments/feed` and
`/api/moments/user/:id` now also return `likeCount`/`liked`/`saved` per
moment via a shared `attachMomentEngagement()` helper.

**Moments public comments**: the message icon opens a bottom-sheet panel
(`.moment-comments-panel`) over the currently-viewed moment instead of a
private DM — anyone can read, posting requires auth. Flat storage with
`parent_comment_id` for one level of threaded replies, resolved into
threads client-side; each comment shows relative age ("2h", "3d", etc.) via
`timeAgoStr()`. Opening the panel pauses the story's autoplay/video and
resumes it on close. Backend: `GET/POST /api/moments/:id/comments`,
`DELETE /api/moments/:id/comments/:commentId` (author-only delete), backed
by the `mkt_moment_comments` table (`moment_id`, `user_id`,
`parent_comment_id`, `text`, `created_at`).

**Create wizard ("+" nav button)**: a dedicated "+" icon in the top icon-nav
(`#icon-nav-create`) opens a small dropdown with two options — post a Moment
or post a Product — rather than sending everyone down the old single
"Post Ad" path. The "Post Moment" option launches `openCreateWizard()`, a
camera-capture-first flow: take/upload a photo or short video, apply a
simple filter, then write a caption/hashtags before publishing — modeled
loosely on Instagram/TikTok's "capture → adjust → caption → post" sequence,
but intentionally shorter (no multi-step editing suite). The "Post Product"
option routes straight into the existing `#/post` listing form. Wired in
`wireIconNav()` in `app.js`; requires login (redirects to `#/login`
otherwise).

**Subscribe system (replaces plain Follow)**: Pages (see "Pages & Follow"
above) now support two subscription modes chosen by the Page owner:
**manual approval** (default) or **auto-approval**. Subscribing calls
`POST /api/follow/:id`; under manual mode this creates a *pending* request
instead of an immediate follow, and the button shows "Pending" until the
owner acts. Page owners see incoming requests in a dedicated panel
(`loadSubsRequests()`, `#subs-requests-card`) with Accept/Reject buttons
backed by `POST /api/follow/requests/:id/accept` and
`.../reject`; `GET /api/follow/requests` lists the pending queue. The old
one-directional "Follow" button/copy has been replaced everywhere with
"Subscribe" / "Subscribed" / "Pending" (`pageFollowMarkup()`,
i18n keys under `subs.*`). Existing `/api/follow/:id` GET-status and DELETE
(unsubscribe) endpoints are unchanged.

**Friends page redesign ("#/friends")**: replaced the old static
Friends/Requests two-tab layout with a single search-driven page —
`renderFriendsPage()` shows two tabs, **"Search friends"** and
**"Search products"** (`friendsPageTab` state, `.friends-search-tabs`), plus
a debounced (300ms) search input (`#friends-search-input`). With no query,
the "friends" tab falls back to the original pending-requests +
friends-grid view; typing a query calls the new
`GET /api/users/search?q=` endpoint (name search across all users, not just
friends) and swaps in a results grid. The "products" tab searches listings
directly via the existing `GET /api/products?q=` endpoint. All rendering
goes through `runFriendsPageSearch(q)`.

**International section**: company directory with registration, admin
verification queue, public filtered directory, company detail pages, legal
intermediary-disclaimer clause.

**Navigation**: top icon-nav bar (Home / Friends / Moments / Marketplace
dropdown [Marketplace + International + Communities] / Notifications),
designed deliberately narrow in scope to avoid overwhelming a first-time
user.

**Not yet built**: escrow/held payment processing (task pending — needs a
processor decision first).

## 6. Roadmap — the "what to borrow from each app" analysis

This is the result of an explicit strategy discussion (see chat history for
full reasoning), prioritized for a marketplace, not a general social network.

1. ✅ **Reddit-style communities** — built (see section 5).
2. ✅ **Pinterest-style saved boards** — built (see section 5).
3. ✅ **Moments algorithm v2, TikTok mechanics + Instagram aesthetic** — built
   (see section 5). The visual side is intentionally restrained: a slim
   vertical action rail (like button + count) rather than TikTok's denser
   icon stack, matching Carlos's call that Instagram's polish should win over
   TikTok's density.
4. ✅ **LinkedIn-style seller trust profile** — built (see section 5). This
   was the last item on the original "borrow from each app" roadmap; all
   four are now shipped. Next roadmap work should come from real usage data
   once the platform has actual traffic, not from further speculative
   feature-borrowing.

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
- `raw.githubusercontent.com` can serve a stale CDN-cached copy of a file for
  a few minutes right after a push, even with a cache-busting query string —
  don't conclude a deploy is broken/truncated from that alone; check the
  GitHub blob page's line/byte count (authoritative) before assuming a real
  problem.
- The Chrome browser-extension file-upload tool can only upload files already
  shared with the current AI session (chat attachments, or its own
  outputs/uploads scratch folders) — it cannot upload arbitrary files from a
  connected project folder, even if other tools can read them. For large
  files (`app.js` at ~180KB has been the recurring case) that are too big to
  reliably paste into GitHub's web editor either, the working path is asking
  Carlos to drag-and-drop the file himself from his real folder into the
  GitHub "Upload files" page or a Drive folder open in the browser.
- Google Drive backups live in a "HieloIce Backup" folder owned by a
  *specific* Google account (`carlosgerardopadillavillars@gmail.com`), not
  necessarily whichever Google account Chrome happens to be signed into by
  default. If a Drive folder link shows "Necesitas acceso" / "Access denied,"
  check which account owns it (Drive's `get_file_permissions` on the folder
  ID) and have Carlos switch to that account in Chrome (or open the URL with
  a `/u/N/` prefix matching that account's slot) before trying again.
