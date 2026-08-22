// Marketplace Pro - backend
// Node.js. Data stored in Supabase (Postgres) via its REST API.
// Single external dependency: web-push (for Web Push notifications, RFC 8291/8292).

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const url = require("url");
const webpush = require("web-push");
const WebSocket = require("ws"); // real-time 1:1 chat delivery (task #233) - see the "realtime chat" section below

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY environment variables.");
}

const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || "";
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").trim().toLowerCase();

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:info@hieloice.com";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.error("Missing VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY - push notifications disabled.");
}

// AI features (photo -> listing suggestion, and the AI help assistant) use
// the Anthropic API. Both are no-ops (return a clear "unavailable" error)
// if this key isn't configured, rather than crashing the server.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
// Task #243 - Jamendo (jamendo.com) is a catalog of real, properly-licensed
// royalty-free/Creative-Commons music that independent creators can legally
// use, unlike a random third-party/commercial track. Free client_id, get one
// at https://devportal.jamendo.com (sign up -> "Create a new application").
// Until this is set, /api/music/search just answers { configured: false }
// and the camera falls back to its own generated sound presets (task #203).
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID || "";
if (!ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY - AI photo analysis and AI assistant disabled.");
}

const MAX_PHOTOS = 12;
// MAX_ACTIVE_MOMENTS used to cap how many of a user's ephemeral 24h Moments
// could be live at once. Moments are now permanent (see the "Moments
// permanence" note above the moment-cleanup interval near the bottom of this
// file, and PROJECT.md) so a small fixed cap on total posts no longer makes
// sense there - it is not enforced against the main /api/moments create/
// repost flows anymore. The name/value is reused as-is (not renamed) by the
// "Loops" feature below (see POST /api/loops), which is the genuinely
// ephemeral Stories-style feature this cap always made sense for.
const MAX_ACTIVE_MOMENTS = 3;
const MAX_MOMENT_VIDEO_SECONDS = 90; // matches Instagram Reels cap - enforced client-side (no server-side video parsing)
const MAX_LOOP_VIDEO_SECONDS = 20; // matches Stories-style short clips - enforced client-side same as MAX_MOMENT_VIDEO_SECONDS (no server-side video parsing)
const MAX_PRODUCT_VIDEO_SECONDS = 20; // enforced client-side (no server-side video parsing)
// Long-form "Videos" hub (task #231) - a general-purpose, YouTube-like
// video feature, NOT limited to book reviews. Reuses the mkt_moments table
// (see the "is_long_video" columns added by the mkt_moments_video_hub_columns
// migration) rather than a parallel table, so it inherits the same
// likes/saves/comments/view-tracking infra Moments already has. A long
// video is just a moment row with is_long_video=true, a title, and an
// optional linked_product_id - see POST /api/moments below, which branches
// on body.target === "video". 20 minutes is a generous ceiling for
// long-form content, enforced client-side same as every other video cap in
// this file (no server-side video parsing exists here).
const MAX_LONG_VIDEO_SECONDS = 1200;

// Reused keep-alive HTTPS agent so every outbound call (Supabase REST,
// Supabase Storage, OAuth token exchanges) reuses pooled TCP+TLS connections
// instead of paying a fresh handshake on every single request. A page like
// the profile view fires 8-10 backend calls, each of which fires 1-3
// Supabase calls - without this, that's dozens of cold handshakes per load.
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

// ---------- Supabase REST helpers ----------

function sbRequest(method, pathAndQuery, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(SUPABASE_URL + "/rest/v1/" + pathAndQuery);
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
    };
    if (method === "POST" || method === "PATCH" || method === "DELETE") {
      headers["Prefer"] = "return=representation";
    }
    if (data) headers["Content-Length"] = Buffer.byteLength(data);

    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method,
        headers,
        agent: keepAliveAgent,
      },
      (res) => {
        let chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch (e) {
              parsed = raw;
            }
          }
          if (res.statusCode >= 400) {
            const err = new Error(
              (parsed && parsed.message) || "Database error (" + res.statusCode + ")"
            );
            err.status = res.statusCode;
            return reject(err);
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => k + "=" + v)
    .join("&");
}
function enc(s) {
  return encodeURIComponent(s);
}

function formEncode(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
    .join("&");
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function baseUrl(req) {
  if (APP_URL) return APP_URL;
  const proto = req.headers["x-forwarded-proto"] || "http";
  return proto + "://" + req.headers.host;
}

// Generic HTTPS JSON request helper used for OAuth token/profile exchanges.
function httpsRequestJson(method, urlStr, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const target = new URL(urlStr);
    const data = opts.body !== undefined ? opts.body : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) headers["Content-Length"] = Buffer.byteLength(data);
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method,
        headers,
        agent: keepAliveAgent,
      },
      (res) => {
        let chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error("Unexpected response from " + target.hostname + ": " + raw.slice(0, 200)));
          }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ---------- Anthropic Claude (AI photo-to-listing + AI help assistant) ----------
function callClaude(payload) {
  if (!ANTHROPIC_API_KEY) {
    return Promise.reject(Object.assign(new Error("AI features are not configured on this server yet."), { status: 503 }));
  }
  return httpsRequestJson("POST", "https://api.anthropic.com/v1/messages", {
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  }).then((data) => {
    if (data && data.type === "error") {
      const err = new Error((data.error && data.error.message) || "AI request failed");
      err.status = 502;
      throw err;
    }
    return data;
  });
}
function claudeText(data) {
  if (!data || !Array.isArray(data.content)) return "";
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const db = {
  select(table, params) {
    return sbRequest("GET", table + (params ? "?" + qs(params) : ""));
  },
  insert(table, row) {
    return sbRequest("POST", table, row).then((r) => (Array.isArray(r) ? r[0] : r));
  },
  update(table, params, patch) {
    return sbRequest("PATCH", table + "?" + qs(params), patch);
  },
  remove(table, params) {
    return sbRequest("DELETE", table + "?" + qs(params));
  },
  // Calls a Postgres function through PostgREST's /rpc/ endpoint. The plain
  // CRUD helpers above can't express "column = column + 1" in a PATCH body
  // (PostgREST PATCH only accepts literal values), so this is the one escape
  // hatch to a real SQL function - used for the creator-stat counters below,
  // where a JS read-then-write would lose updates under concurrent likes.
  rpc(fnName, args) {
    return sbRequest("POST", "rpc/" + fnName, args || {});
  },
};

// ---------- Supabase Storage (photos / moment videos) ----------
// Uploads a data: URL to a public Storage bucket using the service_role key
// (the backend is the only thing that ever touches Storage - no client-side
// Supabase access - so bucket/object RLS is not a concern here).
function sbStorageUpload(bucket, path, dataUrl) {
  return new Promise((resolve, reject) => {
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
    if (!match) return reject(new Error("Invalid file data"));
    const mime = match[1];
    const buffer = Buffer.from(match[2], "base64");
    const target = new URL(SUPABASE_URL + "/storage/v1/object/" + bucket + "/" + path);
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname,
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: "Bearer " + SUPABASE_KEY,
          "Content-Type": mime,
          "Content-Length": buffer.length,
          "x-upsert": "true",
        },
        agent: keepAliveAgent,
      },
      (res) => {
        let chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            return reject(new Error("Upload failed (" + res.statusCode + "): " + Buffer.concat(chunks).toString().slice(0, 200)));
          }
          resolve(SUPABASE_URL + "/storage/v1/object/public/" + bucket + "/" + path);
        });
      }
    );
    req.on("error", reject);
    req.write(buffer);
    req.end();
  });
}

// ---------- auth helpers ----------

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(password, stored) {
  const [salt] = stored.split(":");
  return hashPassword(password, salt) === stored;
}

// Very short-lived cache so a single page load that fires several
// authenticated requests in a burst (e.g. the profile page's friend/follow/
// block-status calls) doesn't redo the same 2 sequential DB round-trips per
// request. TTL is intentionally tiny (a few seconds) so login/suspension
// changes still take effect almost immediately.
const authUserCache = new Map(); // token -> { promise, expires }
const AUTH_CACHE_TTL_MS = 5000;

// Shared by HTTP auth (getAuthUser below, reading the "Authorization: Bearer
// <token>" header) AND WebSocket auth (see the "realtime chat" section
// further down, reading ?token= or a first {"type":"auth"} frame) - both
// paths use the exact same mkt_sessions token, so this is the one place
// that resolves a token to a user.
async function getUserByToken(token) {
  if (!token) return null;

  const cached = authUserCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.promise;

  const promise = (async () => {
    const sessions = await db.select("mkt_sessions", { token: "eq." + enc(token), select: "user_id" });
    if (!sessions || !sessions[0]) return null;
    const users = await db.select("mkt_users", { id: "eq." + enc(sessions[0].user_id), select: "*" });
    const user = (users && users[0]) || null;
    // Suspended accounts are treated as logged-out for every authenticated
    // action app-wide (their public listings/profile stay visible to others).
    if (user && user.suspended) return null;
    // Chat presence (GET /api/users/:id/presence, WS presence:update) is
    // driven off mkt_users.last_seen_at. Bumping it here (throttled - see
    // touchLastSeen in the realtime chat section) means EVERY authenticated
    // HTTP request keeps a user's presence fresh, not just chat-specific
    // ones or WS traffic - simplest option given getAuthUser/getUserByToken
    // already run on nearly every request.
    if (user) touchLastSeen(user.id);
    return user;
  })();

  authUserCache.set(token, { promise, expires: Date.now() + AUTH_CACHE_TTL_MS });
  promise.catch(() => authUserCache.delete(token)); // don't cache failures
  return promise;
}

async function getAuthUser(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return getUserByToken(token);
}

function publicUser(u) {
  if (!u) return null;
  const { password_hash, email, phone, google_id, facebook_id, ...safe } = u;
  return toCamelUser(safe);
}

// Full view of a user's own account (used for login/register/me responses).
function ownUser(u) {
  if (!u) return null;
  const { password_hash, google_id, facebook_id, ...safe } = u;
  const camel = toCamelUser(safe);
  camel.isOwner = !!(OWNER_EMAIL && u.email && u.email.toLowerCase() === OWNER_EMAIL);
  return camel;
}

function toCamelUser(u) {
  if (!u) return u;
  const { created_at, cover_photo, chat_privacy, is_page, page_category, subscription_mode, suspended_reason, suspended_at, is_premium, ...rest } = u;
  return {
    ...rest,
    createdAt: created_at,
    coverPhoto: cover_photo,
    chatPrivacy: chat_privacy,
    isPage: !!is_page,
    pageCategory: page_category || "",
    subscriptionMode: subscription_mode || "manual",
    role: u.role || "user",
    suspendedReason: suspended_reason || "",
    suspendedAt: suspended_at || null,
    isPremium: !!is_premium,
  };
}

function isOwner(user) {
  return !!(user && OWNER_EMAIL && user.email && user.email.toLowerCase() === OWNER_EMAIL);
}

// Admins/moderators/support staff: role stored on mkt_users.role. The legacy
// OWNER_EMAIL account is always treated as admin too, even if its role
// column was never explicitly set.
function isAdmin(user) {
  return !!(user && (user.role === "admin" || isOwner(user)));
}

async function isFriendsWith(userIdA, userIdB) {
  const rows = await db.select("mkt_friendships", {
    status: "eq.accepted",
    or:
      "(and(requester_id.eq." + enc(userIdA) + ",addressee_id.eq." + enc(userIdB) + "),and(requester_id.eq." + enc(userIdB) + ",addressee_id.eq." + enc(userIdA) + "))",
    select: "id",
  });
  return !!(rows && rows.length);
}

// Returns true if either user has blocked the other (blocking is one-directional
// to create but its effect — no contact — applies both ways).
async function isBlockedEitherWay(userIdA, userIdB) {
  const rows = await db.select("mkt_user_blocks", {
    or:
      "(and(blocker_id.eq." + enc(userIdA) + ",blocked_id.eq." + enc(userIdB) + "),and(blocker_id.eq." + enc(userIdB) + ",blocked_id.eq." + enc(userIdA) + "))",
    select: "id",
  });
  return !!(rows && rows.length);
}

// Platform-wide 18+ requirement (Carlos: "para utilizar nuestra plataforma
// las personas deben ser mayores de edad"). This is self-attestation
// (user-entered birthdate), not ID/KYC verification - a disclosed
// limitation, not a guarantee. Every place that needs an age check should
// recompute from mkt_users.birthdate via these helpers rather than trusting
// any client-supplied "I'm 18+" flag.
const MIN_AGE_YEARS = 18;

function ageFromBirthdateMs(birthdateMs, nowMs) {
  const now = new Date(nowMs);
  const dob = new Date(birthdateMs);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

// Parses a strict "YYYY-MM-DD" date input into a UTC-midnight epoch-ms
// timestamp, or null if invalid/out of sane bounds. Strict format avoids the
// timezone drift that comes from loose `new Date(string)` parsing.
function parseBirthdateInput(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw || "").trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(ms)) return null;
  const now = Date.now();
  if (ms > now) return null; // no future birthdates
  if (now - ms > 120 * 365.25 * 24 * 60 * 60 * 1000) return null; // no implausible ages
  return ms;
}

// True only if the user has a birthdate on file AND it computes to 18+.
// Accounts created before this feature (or via Google/Facebook) will have
// no birthdate yet, so this correctly returns false for them until they
// complete the one-time #/confirm-age gate.
function isAdultUser(user) {
  return !!(user && user.birthdate && ageFromBirthdateMs(user.birthdate, Date.now()) >= MIN_AGE_YEARS);
}

async function findOrCreateOAuthUser({ provider, providerId, email, name, photo }) {
  const idField = provider === "google" ? "google_id" : "facebook_id";
  let rows = await db.select("mkt_users", { [idField]: "eq." + enc(providerId), select: "*" });
  if (rows && rows[0]) return rows[0];

  const emailLower = email ? String(email).trim().toLowerCase() : null;
  if (emailLower) {
    rows = await db.select("mkt_users", { email: "eq." + enc(emailLower), select: "*" });
    if (rows && rows[0]) {
      const updated = await db.update("mkt_users", { id: "eq." + enc(rows[0].id) }, { [idField]: providerId });
      return updated[0];
    }
  }

  const newUser = {
    id: crypto.randomBytes(8).toString("hex"),
    name: String(name || "New user").trim().slice(0, 80),
    email: emailLower,
    password_hash: hashPassword(crypto.randomBytes(20).toString("hex")),
    photo: photo || null,
    bio: "",
    location: "",
    phone: "",
    [idField]: providerId,
    created_at: Date.now(),
  };
  await db.insert("mkt_users", newUser);
  return newUser;
}

async function userRatingSummary(userId) {
  const reviews = await db.select("mkt_reviews", {
    target_user_id: "eq." + enc(userId),
    select: "rating",
  });
  const count = reviews.length;
  const avg = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
  return { ratingAvg: Math.round(avg * 10) / 10, ratingCount: count };
}

// Batched version of userRatingSummary for lists of sellers (product grids,
// profile listings) - does ONE query instead of one query per seller, which
// was previously causing multi-second load times on pages with many sellers.
async function userRatingSummariesBatch(userIds) {
  const ids = [...new Set(userIds)];
  const out = {};
  if (!ids.length) return out;
  const reviews = await db.select("mkt_reviews", {
    target_user_id: "in.(" + ids.map(enc).join(",") + ")",
    select: "target_user_id,rating",
  });
  const bySeller = {};
  for (const r of reviews) {
    (bySeller[r.target_user_id] = bySeller[r.target_user_id] || []).push(r.rating);
  }
  for (const id of ids) {
    const list = bySeller[id] || [];
    const count = list.length;
    const avg = count ? list.reduce((s, r) => s + r, 0) / count : 0;
    out[id] = { ratingAvg: Math.round(avg * 10) / 10, ratingCount: count };
  }
  return out;
}

// LinkedIn-style trust profile: sales history (completed = seller marked the
// listing "sold", the strongest signal we have without an escrow system yet)
// plus a small "recent sales" preview for the profile page.
async function userTrustSummary(userId) {
  const sold = await db.select("mkt_products", {
    seller_id: "eq." + enc(userId),
    status: "eq.sold",
    select: "id,title,price",
    order: "created_at.desc",
  });
  return { salesCount: sold.length, recentSales: sold.slice(0, 5) };
}

// Auto-computed "Verified Seller" badge - no manual review queue (that
// overhead is reserved for the higher-stakes International companies
// section). A seller earns it once they've added a phone number, have a
// real track record on the platform, and have been a member for a while -
// simple, defensible signals rather than a subjective admin call.
function computeVerifiedSeller(u, salesCount) {
  const ageDays = (Date.now() - (u.created_at || 0)) / (24 * 60 * 60 * 1000);
  return !!(u.phone && salesCount >= 3 && ageDays >= 30);
}

// ---------- rate limiting (in-memory, per-IP, no external service) ----------

const rateLimitBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

// Returns true if the request is allowed, false if the limit was exceeded.
function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count++;
  return bucket.count <= limit;
}

// Periodic cleanup so the Map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (now - bucket.start > 60 * 60 * 1000) rateLimitBuckets.delete(key);
  }
}, 15 * 60 * 1000).unref();

// ---------- creator lifetime stat counters ----------
// stat_likes_received / stat_saves_received / stat_comments_received live on
// mkt_users (not on the moments themselves) specifically so Creator Analytics
// numbers survive the hourly cleanup that hard-deletes expired moments -
// mkt_moment_likes/saves/comments are keyed only by moment_id, so once the
// moment row is gone there's no way to attribute an orphaned like/save/
// comment back to its author. Views/completion rate don't need this: those
// come from mkt_moment_events, which is denormalized with moment_author_id
// and never deleted, so it's queried live instead (see GET /api/creator/stats).
//
// Requires a one-time Supabase migration adding the columns and the
// mkt_increment_user_stat() SQL function (see PROJECT.md / deploy notes) -
// PostgREST's PATCH endpoint only accepts literal values, so an atomic
// increment has to go through a real SQL function via db.rpc() rather than
// a JS read-then-write, which would lose updates if two viewers liked the
// same moment at the same instant.
async function incrementUserStat(userId, column, delta) {
  if (!userId) return;
  try {
    await db.rpc("mkt_increment_user_stat", { p_user_id: userId, p_column: column, p_delta: delta });
  } catch (e) {
    console.error("incrementUserStat failed:", column, e.message);
  }
}

// ---------- moderation helpers (auto-flag after repeated reports) ----------

const FLAG_THRESHOLD = 3;

async function maybeAutoFlag(targetType, targetId) {
  const openReports = await db.select("mkt_reports", {
    target_type: "eq." + enc(targetType),
    target_id: "eq." + enc(targetId),
    status: "eq.open",
    select: "id",
  });
  if (!openReports || openReports.length < FLAG_THRESHOLD) return;
  const table = targetType === "product" ? "mkt_products" : "mkt_users";
  await db.update(table, { id: "eq." + enc(targetId) }, { flagged: true });
}

// ---------- push notifications (Web Push, opt-in, revocable) ----------

const NOTIF_CATEGORIES = ["offers", "flashSales", "newProducts", "reminders", "messages"];

async function sendPushToSubscriptions(subs, payload) {
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      );
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        await db.remove("mkt_push_subscriptions", { id: "eq." + enc(sub.id) }).catch(() => {});
      }
    }
  }
}

// Notify a single user, respecting their master opt-in and per-category preference.
async function notifyUser(userId, category, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const users = await db.select("mkt_users", { id: "eq." + enc(userId), select: "id,push_enabled,notif_prefs" });
  const u = users && users[0];
  if (!u || !u.push_enabled) return;
  const prefs = u.notif_prefs || {};
  if (prefs[category] === false) return;
  const subs = await db.select("mkt_push_subscriptions", { user_id: "eq." + enc(userId), select: "*" });
  if (!subs || !subs.length) return;
  await sendPushToSubscriptions(subs, payload);
}

// Notify every opted-in user for a category, optionally filtered (e.g. by followed category).
async function notifyAllOptedIn(category, payload, filterFn) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const users = await db.select("mkt_users", {
    push_enabled: "eq.true",
    select: "id,notif_prefs,followed_categories",
  });
  for (const u of users) {
    const prefs = u.notif_prefs || {};
    if (prefs[category] === false) continue;
    if (filterFn && !filterFn(u)) continue;
    const subs = await db.select("mkt_push_subscriptions", { user_id: "eq." + enc(u.id), select: "*" });
    if (!subs || !subs.length) continue;
    await sendPushToSubscriptions(subs, payload);
  }
}

// ---------- realtime chat (WebSocket) ----------
//
// Task #233. Everything below is the COMPLETE real-time contract for 1:1
// messaging - written for whoever builds the frontend (task #234) with no
// other context. The REST endpoints under "MESSAGES" further down keep
// working unchanged for any client that isn't using the socket at all
// (progressive enhancement, not a hard requirement): every socket action
// below writes to mkt_messages first, so polling GET /api/conversations/:id
// always reflects the full truth regardless of whether either side has a
// live connection.
//
// CONNECTING
//   Open a WebSocket to   wss://<host>/ws?token=<session token>
//   `token` is the exact same opaque string normally sent as
//   `Authorization: Bearer <token>` on every other API call (the one
//   returned by /api/auth/login, /api/auth/register, etc). It has to travel
//   as a query param because browsers can't set custom headers on a
//   WebSocket handshake.
//   If you'd rather not put the token in the URL (query strings can end up
//   in logs), connect to wss://<host>/ws with no query param and send an
//   auth frame as the very first message instead:
//     -> {"type":"auth","token":"<session token>"}
//   Either way: the server closes the socket (code 4401) if the token is
//   invalid, or if no valid token arrives within 10 seconds of connecting.
//   On success the server sends:
//     <- {"type":"connected","userId":"<your user id>"}
//   A user can have several sockets open at once (multiple tabs/devices) -
//   every event below is delivered to ALL of a user's open sockets.
//
// ENVELOPE
//   Every frame, both directions, is one JSON object with a "type" field.
//   Unknown or malformed frames are silently ignored (no error echoed), so
//   new client->server types can be added later without breaking old
//   servers/clients.
//
// CLIENT -> SERVER
//   {"type":"auth","token":"..."}
//       Only needed as the first message when ?token= wasn't given on
//       connect. Ignored once a connection is already authenticated.
//   {"type":"typing:start","to":"<otherUserId>"}
//   {"type":"typing:stop","to":"<otherUserId>"}
//       Ephemeral - never written to the DB. Forwarded ONLY to `to`'s open
//       sockets, as a {"type":"typing",...} frame (see below).
//   {"type":"presence:query","userId":"<userId>"}
//       Ask whether a specific user is online right now. Server replies to
//       the requester only, with presence:result (below). The exact same
//       info is also available over REST via GET /api/users/:id/presence
//       for clients that aren't running the socket.
//   {"type":"ping"}
//       Optional app-level heartbeat; server replies {"type":"pong"}. (The
//       server also runs its own low-level WS ping/pong every 30s to reap
//       dead connections - this app-level ping is just for client code that
//       wants an explicit round-trip signal.)
//
// SERVER -> CLIENT
//   {"type":"connected","userId":"..."}
//       Sent once, immediately after successful auth.
//   {"type":"auth:error","error":"..."}
//       Sent right before the socket is closed if auth fails.
//   {"type":"message:new","message":{...}}
//       A brand-new message in a conversation you're part of. Sent to BOTH
//       the sender's and recipient's open sockets (so every open tab/device
//       for either side stays in sync). The `message` object has the exact
//       same shape as one entry from GET /api/conversations/:id - see the
//       shapeMessage() shape documented in the MESSAGES section below
//       (id, fromUserId, toUserId, text, productId, replyToId,
//       attachmentUrl, attachmentType, reactions, deleted, read, createdAt).
//   {"type":"message:read","conversationWith":"<userId>","messageIds":["..."],"readAt":1234567890}
//       Sent to the ORIGINAL SENDER when the other participant reads their
//       messages (i.e. opens/polls GET /api/conversations/:id).
//       `messageIds` are the ids that just flipped read:true.
//   {"type":"reaction:added","messageId":"...","emoji":"👍","userId":"...","reactions":{...}}
//   {"type":"reaction:removed","messageId":"...","emoji":"👍","userId":"...","reactions":{...}}
//       Sent to both participants whenever POST/DELETE
//       /api/messages/:id/react changes a message's reactions map.
//       `reactions` is the FULL updated map (not a diff) - replace your
//       local copy with it rather than patching.
//   {"type":"message:deleted","messageId":"...","mode":"forMe"|"forEveryone","conversationWith":"<otherUserId>"}
//       "forEveryone": sent to BOTH participants - the message is now a
//       tombstone for both of them (see DELETE /api/messages/:id below).
//       "forMe": echoed back ONLY to the caller's own other sockets/tabs,
//       since it doesn't change what the other participant sees at all.
//   {"type":"presence:update","userId":"...","online":true,"lastSeenAt":1234567890}
//       Broadcast whenever a user connects (all sockets were closed, now
//       one is open) or fully disconnects (their last open socket closed).
//       Only sent to that user's CONVERSATION PARTNERS (anyone they've ever
//       exchanged a message with) - not a global broadcast.
//   {"type":"presence:result","userId":"...","online":true,"lastSeenAt":1234567890}
//       Reply to a presence:query, sent to the requester only.
//   {"type":"pong"}
//       Reply to an app-level {"type":"ping"}.
//
// SCALING NOTE (read before "fixing" presence/delivery that seems flaky):
// connections live in an in-memory Map on THIS ONE Node process (see
// wsConnections below) - there is no cross-process pub/sub. That is fine
// for Render's current single-instance setup for this service. If this
// service is ever moved to multiple instances/autoscaling, this whole layer
// silently stops seeing sockets connected to other instances and needs a
// shared broker (e.g. Redis pub/sub) behind it. Nothing in the current
// deploy config suggests that's imminent, so it's intentionally not built
// here - don't add that complexity until it's actually needed.

const WS_PATH = "/ws";
const WS_AUTH_TIMEOUT_MS = 10000;

// userId -> Set<WebSocket>. A user can have multiple open sockets (tabs/devices).
const wsConnections = new Map();

function isUserOnline(userId) {
  const set = wsConnections.get(userId);
  return !!(set && set.size);
}

function wsSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      // A send failing here means the socket is on its way out; the
      // close/error handlers below take care of removing it from
      // wsConnections, so there's nothing else to do.
    }
  }
}

// Sends `payload` to every open socket belonging to `userId`. 0 sockets
// (user not connected right now) is a silent no-op - callers never need to
// check isUserOnline() first, this is always safe to call.
function wsSendToUser(userId, payload) {
  const set = wsConnections.get(userId);
  if (!set || !set.size) return;
  for (const ws of set) wsSend(ws, payload);
}

// Every user `userId` has ever exchanged a message with - the scope for
// presence broadcasts (WhatsApp/Messenger-style: only people you've
// actually talked to see when you come online, not the whole userbase).
async function conversationPartnerIds(userId) {
  const [fromMe, toMe] = await Promise.all([
    db.select("mkt_messages", { from_user_id: "eq." + enc(userId), select: "to_user_id" }),
    db.select("mkt_messages", { to_user_id: "eq." + enc(userId), select: "from_user_id" }),
  ]);
  const ids = new Set();
  for (const m of fromMe) ids.add(m.to_user_id);
  for (const m of toMe) ids.add(m.from_user_id);
  ids.delete(userId);
  return [...ids];
}

async function broadcastPresence(userId, online) {
  try {
    const partners = await conversationPartnerIds(userId);
    if (!partners.length) return;
    const users = await db.select("mkt_users", { id: "eq." + enc(userId), select: "last_seen_at" });
    const lastSeenAt = (users && users[0] && users[0].last_seen_at) || null;
    const payload = { type: "presence:update", userId, online, lastSeenAt };
    for (const p of partners) wsSendToUser(p, payload);
  } catch (e) {
    console.error("broadcastPresence failed:", e.message);
  }
}

// Throttled last_seen_at writes. Called from getUserByToken (every
// authenticated HTTP request - see the auth helpers above) AND from every
// WS connect/message below, so "online"/lastSeenAt stays accurate for both
// socket clients and REST-polling-only clients. Throttled to at most one DB
// write per user per 30s so this doesn't turn into a write on every single
// request/message.
const lastSeenThrottle = new Map(); // userId -> last write timestamp (ms)
const LAST_SEEN_WRITE_INTERVAL_MS = 30000;
function touchLastSeen(userId) {
  const now = Date.now();
  const last = lastSeenThrottle.get(userId) || 0;
  if (now - last < LAST_SEEN_WRITE_INTERVAL_MS) return;
  lastSeenThrottle.set(userId, now);
  db.update("mkt_users", { id: "eq." + enc(userId) }, { last_seen_at: now }).catch(() => {});
}

function wsRegister(userId, ws) {
  let set = wsConnections.get(userId);
  if (!set) {
    set = new Set();
    wsConnections.set(userId, set);
  }
  const wasOffline = set.size === 0;
  set.add(ws);
  ws.userId = userId;
  ws.isAlive = true;
  lastSeenThrottle.set(userId, Date.now()); // force-write on connect, bypassing the throttle, so presence flips online immediately
  db.update("mkt_users", { id: "eq." + enc(userId) }, { last_seen_at: Date.now() }).catch(() => {});
  if (wasOffline) broadcastPresence(userId, true);
}

function wsUnregister(ws) {
  if (!ws.userId) return;
  const set = wsConnections.get(ws.userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    wsConnections.delete(ws.userId);
    lastSeenThrottle.set(ws.userId, Date.now()); // force-write on disconnect too, same reasoning as wsRegister
    db.update("mkt_users", { id: "eq." + enc(ws.userId) }, { last_seen_at: Date.now() }).catch(() => {});
    broadcastPresence(ws.userId, false);
  }
}

const wss = new WebSocket.Server({ noServer: true });

wss.on("connection", (ws, req) => {
  const parsedUrl = url.parse(req.url, true);
  const queryToken = parsedUrl.query && parsedUrl.query.token;
  let authTimer = null;

  async function tryAuth(token) {
    try {
      const user = await getUserByToken(token);
      if (!user) {
        wsSend(ws, { type: "auth:error", error: "Invalid or expired session" });
        ws.close(4401, "Unauthorized");
        return;
      }
      if (authTimer) clearTimeout(authTimer);
      wsRegister(user.id, ws);
      wsSend(ws, { type: "connected", userId: user.id });
    } catch (e) {
      wsSend(ws, { type: "auth:error", error: "Authentication failed" });
      ws.close(4401, "Unauthorized");
    }
  }

  if (queryToken) {
    tryAuth(String(queryToken));
  } else {
    authTimer = setTimeout(() => {
      if (!ws.userId) {
        wsSend(ws, { type: "auth:error", error: "Authentication timeout" });
        ws.close(4401, "Unauthorized");
      }
    }, WS_AUTH_TIMEOUT_MS);
  }

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return; // ignore malformed frames
    }
    if (!msg || typeof msg.type !== "string") return;

    if (!ws.userId) {
      if (msg.type === "auth" && msg.token) await tryAuth(String(msg.token));
      return; // no other message types are processed before auth succeeds
    }

    touchLastSeen(ws.userId);

    if (msg.type === "ping") {
      wsSend(ws, { type: "pong" });
      return;
    }
    if (msg.type === "typing:start" || msg.type === "typing:stop") {
      const to = msg.to && String(msg.to);
      if (!to) return;
      wsSendToUser(to, { type: "typing", from: ws.userId, state: msg.type === "typing:start" ? "start" : "stop" });
      return;
    }
    if (msg.type === "presence:query") {
      const targetId = msg.userId && String(msg.userId);
      if (!targetId) return;
      let lastSeenAt = null;
      try {
        const users = await db.select("mkt_users", { id: "eq." + enc(targetId), select: "last_seen_at" });
        lastSeenAt = (users && users[0] && users[0].last_seen_at) || null;
      } catch (e) {}
      wsSend(ws, { type: "presence:result", userId: targetId, online: isUserOnline(targetId), lastSeenAt });
      return;
    }
    // Unknown type: ignored, per the envelope contract documented above.
  });

  ws.on("close", () => {
    if (authTimer) clearTimeout(authTimer);
    wsUnregister(ws);
  });
  ws.on("error", () => {
    if (authTimer) clearTimeout(authTimer);
    wsUnregister(ws);
  });
});

// Low-level heartbeat (distinct from the app-level {"type":"ping"} above):
// terminates sockets that stop responding to WS-protocol pings, so a client
// that vanishes without a clean close (phone locked, wifi dropped mid-air)
// doesn't linger forever in wsConnections and quietly break presence.
setInterval(() => {
  for (const set of wsConnections.values()) {
    for (const ws of set) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (e) {}
    }
  }
}, 30000).unref();

// ---------- http helpers ----------

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    const LIMIT = 320 * 1024 * 1024; // 320MB - enough for photos and up to ~3min moment videos as base64
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > LIMIT) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(fullPath).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    // The app is under active development and pushes frequent fixes. Without
    // explicit headers, mobile browsers apply heuristic caching to app.js/
    // style.css/index.html and can keep serving a stale (pre-fix) copy for a
    // while after a deploy - including across a pull-to-refresh reload. Force
    // revalidation on every load for the core app files so fixes always land
    // immediately; static assets (icons, images) stay cacheable as before.
    if ([".html", ".js", ".css"].includes(ext)) {
      headers["Cache-Control"] = "no-cache, must-revalidate";
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

// ---------- validation helpers ----------

function isEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Book genres, ordered by C2C used-book resale demand (see CATEGORY_LIST
// in public/i18n.js, which must stay in sync with these slugs).
const CATEGORIES = [
  "bestsellers-fiction", "mystery-thriller", "romance", "fantasy",
  "science-fiction", "horror", "textbooks-academic", "self-help",
  "nonfiction", "children", "young-adult", "comics-manga",
  "biography-memoir", "history", "classics-literature", "poetry",
  "cooking", "health-wellness", "business-finance", "religion-spirituality",
  "art-photography", "travel", "rare-collectible", "other-books",
];

const REPORT_REASONS = ["spam", "prohibited", "inappropriate", "fraud", "other", "harassment", "fake_profile", "underage_concern"];

function productOut(p) {
  const { seller_id, allow_offers, allow_return, created_at, cover_is_video, video_duration_seconds, ...rest } = p;
  return {
    ...rest,
    sellerId: seller_id,
    allowOffers: allow_offers,
    allowReturn: allow_return,
    createdAt: created_at,
    coverIsVideo: !!cover_is_video,
    videoDurationSeconds: video_duration_seconds != null ? Number(video_duration_seconds) : null,
  };
}

// ---------- API ----------

async function handleApi(req, res, pathname, query) {
  const method = req.method;

  // ---- AUTH ----
  if (method === "POST" && pathname === "/api/auth/register") {
    const ip = getClientIp(req);
    if (!checkRateLimit("register:" + ip, 5, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: "Too many registration attempts. Please try again later." });
    }
    const body = await readBody(req);
    const { name, email, password, phone, birthdate } = body;
    if (!name || !String(name).trim()) return sendJson(res, 400, { error: "Name is required" });
    if (!isEmail(email)) return sendJson(res, 400, { error: "A valid email is required" });
    if (!password || String(password).length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters" });

    // Platform-wide 18+ requirement (Carlos's instruction: adults only,
    // for the whole platform, not just Dating). Self-attestation only.
    const birthdateMs = parseBirthdateInput(birthdate);
    if (!birthdateMs) return sendJson(res, 400, { error: "A valid date of birth is required." });
    if (ageFromBirthdateMs(birthdateMs, Date.now()) < MIN_AGE_YEARS) {
      return sendJson(res, 403, { error: "You must be at least 18 years old to create a HieloIce account." });
    }

    const emailLower = String(email).trim().toLowerCase();
    const existing = await db.select("mkt_users", { email: "eq." + enc(emailLower), select: "id" });
    if (existing && existing[0]) {
      return sendJson(res, 409, { error: "An account with this email already exists" });
    }

    const user = {
      id: crypto.randomBytes(8).toString("hex"),
      name: String(name).trim().slice(0, 80),
      email: emailLower,
      password_hash: hashPassword(password),
      photo: null,
      bio: "",
      location: "",
      phone: String(phone || "").trim().slice(0, 30),
      birthdate: birthdateMs,
      created_at: Date.now(),
    };
    await db.insert("mkt_users", user);

    const token = crypto.randomBytes(24).toString("hex");
    await db.insert("mkt_sessions", { token, user_id: user.id, created_at: Date.now() });

    return sendJson(res, 201, { token, user: ownUser(user) });
  }

  // One-time "confirm your birthdate" gate for accounts that don't have one
  // on file yet (Google/Facebook signups, or any pre-existing account from
  // before this feature existed). Also reused by the Dating opt-in flow.
  if (method === "PUT" && pathname === "/api/auth/birthdate") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const birthdateMs = parseBirthdateInput(body.birthdate);
    if (!birthdateMs) return sendJson(res, 400, { error: "Enter a valid date of birth." });
    if (ageFromBirthdateMs(birthdateMs, Date.now()) < MIN_AGE_YEARS) {
      return sendJson(res, 403, { error: "You must be at least 18 years old to use HieloIce." });
    }
    const updated = await db.update("mkt_users", { id: "eq." + enc(me.id) }, { birthdate: birthdateMs });
    return sendJson(res, 200, { user: ownUser(updated[0]) });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const ip = getClientIp(req);
    if (!checkRateLimit("login:" + ip, 8, 10 * 60 * 1000)) {
      return sendJson(res, 429, { error: "Too many login attempts. Please try again in a few minutes." });
    }
    const body = await readBody(req);
    const { email, password } = body;
    const emailLower = String(email || "").trim().toLowerCase();
    const users = await db.select("mkt_users", { email: "eq." + enc(emailLower), select: "*" });
    const user = users && users[0];
    if (!user || !verifyPassword(password || "", user.password_hash)) {
      return sendJson(res, 401, { error: "Invalid email or password" });
    }
    if (user.suspended) {
      return sendJson(res, 403, { error: "This account has been suspended." + (user.suspended_reason ? " Reason: " + user.suspended_reason : "") });
    }
    const token = crypto.randomBytes(24).toString("hex");
    await db.insert("mkt_sessions", { token, user_id: user.id, created_at: Date.now() });
    return sendJson(res, 200, { token, user: ownUser(user) });
  }

  if (method === "GET" && pathname === "/api/auth/google") {
    if (!GOOGLE_CLIENT_ID) return sendJson(res, 500, { error: "Google login is not configured yet." });
    const redirectUri = baseUrl(req) + "/api/auth/google/callback";
    const authUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?" +
      formEncode({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        prompt: "select_account",
      });
    return redirect(res, authUrl);
  }

  if (method === "GET" && pathname === "/api/auth/google/callback") {
    try {
      const code = query.code;
      if (!code) return redirect(res, "/#/login?error=google");
      const redirectUri = baseUrl(req) + "/api/auth/google/callback";
      const tokenRes = await httpsRequestJson("POST", "https://oauth2.googleapis.com/token", {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formEncode({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.access_token) return redirect(res, "/#/login?error=google");
      const profile = await httpsRequestJson("GET", "https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: "Bearer " + tokenRes.access_token },
      });
      const user = await findOrCreateOAuthUser({
        provider: "google",
        providerId: profile.sub,
        email: profile.email,
        name: profile.name,
        photo: profile.picture,
      });
      const token = crypto.randomBytes(24).toString("hex");
      await db.insert("mkt_sessions", { token, user_id: user.id, created_at: Date.now() });
      return redirect(res, "/#/oauth-callback?token=" + token);
    } catch (e) {
      return redirect(res, "/#/login?error=google");
    }
  }

  if (method === "GET" && pathname === "/api/auth/facebook") {
    if (!FACEBOOK_APP_ID) return sendJson(res, 500, { error: "Facebook login is not configured yet." });
    const redirectUri = baseUrl(req) + "/api/auth/facebook/callback";
    const authUrl =
      "https://www.facebook.com/v19.0/dialog/oauth?" +
      formEncode({
        client_id: FACEBOOK_APP_ID,
        redirect_uri: redirectUri,
        scope: "email,public_profile",
        response_type: "code",
      });
    return redirect(res, authUrl);
  }

  if (method === "GET" && pathname === "/api/auth/facebook/callback") {
    try {
      const code = query.code;
      if (!code) return redirect(res, "/#/login?error=facebook");
      const redirectUri = baseUrl(req) + "/api/auth/facebook/callback";
      const tokenRes = await httpsRequestJson(
        "GET",
        "https://graph.facebook.com/v19.0/oauth/access_token?" +
          formEncode({
            client_id: FACEBOOK_APP_ID,
            redirect_uri: redirectUri,
            client_secret: FACEBOOK_APP_SECRET,
            code,
          })
      );
      if (!tokenRes.access_token) return redirect(res, "/#/login?error=facebook");
      const profile = await httpsRequestJson(
        "GET",
        "https://graph.facebook.com/me?" +
          formEncode({ fields: "id,name,email,picture.type(large)", access_token: tokenRes.access_token })
      );
      const user = await findOrCreateOAuthUser({
        provider: "facebook",
        providerId: profile.id,
        email: profile.email,
        name: profile.name,
        photo: profile.picture && profile.picture.data ? profile.picture.data.url : null,
      });
      const token = crypto.randomBytes(24).toString("hex");
      await db.insert("mkt_sessions", { token, user_id: user.id, created_at: Date.now() });
      return redirect(res, "/#/oauth-callback?token=" + token);
    } catch (e) {
      return redirect(res, "/#/login?error=facebook");
    }
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const auth = req.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (token) {
      await db.remove("mkt_sessions", { token: "eq." + enc(token) });
    }
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rating = await userRatingSummary(me.id);
    return sendJson(res, 200, { user: { ...ownUser(me), ...rating } });
  }

  // ---- USERS / PROFILES ----
  // Excludes "search" so it can never shadow the GET /api/users/search route
  // below - previously this generic :id route ran first, matched "search" as
  // a literal user id, and made /api/users/search always 404 with "User not
  // found" instead of ever running the real search handler.
  const userMatch = pathname.match(/^\/api\/users\/(?!search$)([a-zA-Z0-9]+)$/);
  if (method === "GET" && userMatch) {
    const users = await db.select("mkt_users", { id: "eq." + enc(userMatch[1]), select: "*" });
    const u = users && users[0];
    if (!u) return sendJson(res, 404, { error: "User not found" });
    const [rating, trust] = await Promise.all([userRatingSummary(u.id), userTrustSummary(u.id)]);
    const verified = computeVerifiedSeller(u, trust.salesCount);
    return sendJson(res, 200, { ...publicUser(u), ...rating, ...trust, verified });
  }

  if (method === "PUT" && pathname === "/api/users/me") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 80);
    if (body.bio !== undefined) patch.bio = String(body.bio).slice(0, 500);
    if (body.location !== undefined) patch.location = String(body.location).slice(0, 150);
    if (body.photo !== undefined) patch.photo = body.photo;
    if (body.phone !== undefined) patch.phone = String(body.phone).trim().slice(0, 30);
    if (body.coverPhoto !== undefined) patch.cover_photo = body.coverPhoto;
    if (body.hometown !== undefined) patch.hometown = String(body.hometown).slice(0, 150);
    if (body.interests !== undefined) patch.interests = String(body.interests).slice(0, 300);
    if (body.education !== undefined) patch.education = String(body.education).slice(0, 200);
    if (body.work !== undefined) patch.work = String(body.work).slice(0, 200);
    if (body.chatPrivacy !== undefined && ["everyone", "friends"].includes(body.chatPrivacy)) {
      patch.chat_privacy = body.chatPrivacy;
    }
    if (body.isPage !== undefined) patch.is_page = !!body.isPage;
    if (body.pageCategory !== undefined) patch.page_category = String(body.pageCategory).slice(0, 80);
    if (body.subscriptionMode !== undefined && ["auto", "manual"].includes(body.subscriptionMode)) {
      patch.subscription_mode = body.subscriptionMode;
    }
    const updated = await db.update("mkt_users", { id: "eq." + enc(me.id) }, patch);
    const u = updated && updated[0];
    const rating = await userRatingSummary(u.id);
    return sendJson(res, 200, { user: { ...ownUser(u), ...rating } });
  }

  // Account deletion (Google Play "Data safety" account-deletion requirement).
  // Scrubs personally identifying fields, invalidates the password/social login,
  // and logs the user out everywhere. Non-identifying content that other users
  // can already see (e.g. a review someone left about a transaction) is left in
  // place attributed to "Usuario eliminado" rather than hard-deleted, so we don't
  // silently break other people's chat history/records.
  if (method === "DELETE" && pathname === "/api/users/me") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req).catch(() => ({}));
    // Accounts created via Google/Facebook never have a password the user
    // knows (they get a random unusable one at signup - see findOrCreateOAuthUser),
    // so only require re-entering the password for email/password accounts.
    // A valid session token from the OAuth login flow is proof enough for those.
    const isOAuthOnly = !!(me.google_id || me.facebook_id);
    if (!isOAuthOnly && !verifyPassword(body.password || "", me.password_hash)) {
      return sendJson(res, 403, { error: "Incorrect password" });
    }
    const anonEmail = "deleted-" + me.id + "@hieloice.deleted";
    await db.update("mkt_users", { id: "eq." + enc(me.id) }, {
      name: "Usuario eliminado",
      email: anonEmail,
      phone: null,
      photo: null,
      cover_photo: null,
      bio: "",
      location: "",
      hometown: "",
      interests: "",
      education: "",
      work: "",
      password_hash: hashPassword(crypto.randomBytes(24).toString("hex")),
      google_id: null,
      facebook_id: null,
      suspended: true,
      suspended_reason: "Account deleted by user request",
      suspended_at: Date.now(),
    });
    await db.remove("mkt_sessions", { user_id: "eq." + enc(me.id) });
    await db.remove("mkt_push_subscriptions", { user_id: "eq." + enc(me.id) });
    return sendJson(res, 200, { ok: true });
  }

  // ---- PUSH NOTIFICATIONS (opt-in, always revocable) ----
  if (method === "GET" && pathname === "/api/push/vapid-public-key") {
    return sendJson(res, 200, { publicKey: VAPID_PUBLIC_KEY });
  }

  if (method === "POST" && pathname === "/api/push/subscribe") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return sendJson(res, 400, { error: "Invalid push subscription" });
    }
    const existing = await db.select("mkt_push_subscriptions", { endpoint: "eq." + enc(sub.endpoint), select: "id" });
    if (existing && existing[0]) {
      await db.update("mkt_push_subscriptions", { id: "eq." + enc(existing[0].id) }, {
        user_id: me.id,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
      });
    } else {
      await db.insert("mkt_push_subscriptions", {
        id: crypto.randomBytes(8).toString("hex"),
        user_id: me.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        created_at: Date.now(),
      });
    }
    await db.update("mkt_users", { id: "eq." + enc(me.id) }, { push_enabled: true });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/push/unsubscribe") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    if (body.endpoint) {
      await db.remove("mkt_push_subscriptions", { endpoint: "eq." + enc(body.endpoint) });
    } else {
      await db.remove("mkt_push_subscriptions", { user_id: "eq." + enc(me.id) });
    }
    const remaining = await db.select("mkt_push_subscriptions", { user_id: "eq." + enc(me.id), select: "id" });
    if (!remaining || !remaining.length) {
      await db.update("mkt_users", { id: "eq." + enc(me.id) }, { push_enabled: false });
    }
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/notifications/preferences") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const users = await db.select("mkt_users", {
      id: "eq." + enc(me.id),
      select: "push_enabled,notif_prefs,followed_categories",
    });
    const u = users && users[0];
    return sendJson(res, 200, {
      pushEnabled: !!(u && u.push_enabled),
      prefs: (u && u.notif_prefs) || {},
      followedCategories: (u && u.followed_categories) || [],
    });
  }

  if (method === "PUT" && pathname === "/api/notifications/preferences") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const patch = {};
    if (body.prefs && typeof body.prefs === "object") {
      const prefs = {};
      for (const cat of NOTIF_CATEGORIES) prefs[cat] = body.prefs[cat] !== false;
      patch.notif_prefs = prefs;
    }
    if (Array.isArray(body.followedCategories)) {
      patch.followed_categories = body.followedCategories.filter((c) => CATEGORIES.includes(c));
    }
    const updated = await db.update("mkt_users", { id: "eq." + enc(me.id) }, patch);
    const u = updated && updated[0];
    return sendJson(res, 200, {
      pushEnabled: !!(u && u.push_enabled),
      prefs: (u && u.notif_prefs) || {},
      followedCategories: (u && u.followed_categories) || [],
    });
  }

  // ---- REVIEWS ----
  const userReviewsMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9]+)\/reviews$/);
  if (method === "GET" && userReviewsMatch) {
    const reviews = await db.select("mkt_reviews", {
      target_user_id: "eq." + enc(userReviewsMatch[1]),
      order: "created_at.desc",
      select: "*",
    });
    const authorIds = [...new Set(reviews.map((r) => r.author_user_id))];
    let authors = [];
    if (authorIds.length) {
      authors = await db.select("mkt_users", {
        id: "in.(" + authorIds.map(enc).join(",") + ")",
        select: "id,name,photo",
      });
    }
    const withAuthor = reviews.map((r) => {
      const author = authors.find((u) => u.id === r.author_user_id);
      return {
        id: r.id,
        targetUserId: r.target_user_id,
        authorUserId: r.author_user_id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.created_at,
        authorName: author ? author.name : "Deleted user",
        authorPhoto: author ? author.photo : null,
      };
    });
    return sendJson(res, 200, withAuthor);
  }

  if (method === "POST" && userReviewsMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const targetId = userReviewsMatch[1];
    if (targetId === me.id) return sendJson(res, 400, { error: "You cannot review yourself" });
    const targets = await db.select("mkt_users", { id: "eq." + enc(targetId), select: "id" });
    if (!targets || !targets[0]) return sendJson(res, 404, { error: "User not found" });

    const body = await readBody(req);
    const rating = Number(body.rating);
    if (!rating || rating < 1 || rating > 5) return sendJson(res, 400, { error: "Rating must be between 1 and 5" });

    const review = {
      id: crypto.randomBytes(8).toString("hex"),
      target_user_id: targetId,
      author_user_id: me.id,
      rating,
      comment: String(body.comment || "").slice(0, 1000),
      created_at: Date.now(),
    };
    await db.insert("mkt_reviews", review);
    return sendJson(res, 201, {
      id: review.id,
      targetUserId: review.target_user_id,
      authorUserId: review.author_user_id,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.created_at,
    });
  }

  // ---- REPORTS (report a listing or a user for moderation) ----
  if (method === "POST" && pathname === "/api/reports") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const targetType = body.targetType;
    if (!["product", "user"].includes(targetType)) {
      return sendJson(res, 400, { error: "Invalid report target type" });
    }
    const targetId = String(body.targetId || "").trim();
    if (!targetId) return sendJson(res, 400, { error: "Missing target id" });
    const reason = String(body.reason || "").trim();
    if (!REPORT_REASONS.includes(reason)) return sendJson(res, 400, { error: "Invalid reason" });

    const report = {
      id: crypto.randomBytes(8).toString("hex"),
      reporter_user_id: me.id,
      target_type: targetType,
      target_id: targetId,
      reason,
      description: String(body.description || "").slice(0, 1000),
      status: "open",
      created_at: Date.now(),
    };
    await db.insert("mkt_reports", report);
    await maybeAutoFlag(targetType, targetId);
    return sendJson(res, 201, { ok: true });
  }

  // ---- PRODUCTS ----
  if (method === "GET" && pathname === "/api/products") {
    const me = await getAuthUser(req);
    const { category, q, country, state, city, minPrice, maxPrice, sort, sellerId } = query;
    const params = { select: "*" };
    if (sellerId) params.seller_id = "eq." + enc(sellerId);
    if (category && category !== "all") params.category = "eq." + enc(category);
    if (country) params.country = "ilike." + enc(country);
    if (state) params.state = "ilike." + enc(state);
    if (city) params.city = "ilike.*" + enc(city) + "*";
    if (q) {
      const qDigits = String(q).replace(/[^0-9Xx]/g, "");
      const isbnClause = qDigits.length >= 6 ? ",isbn.ilike.*" + enc(qDigits) + "*" : "";
      params.or = "(title.ilike.*" + enc(q) + "*,description.ilike.*" + enc(q) + "*" + isbnClause + ")";
    }
    const min = minPrice !== undefined && minPrice !== "" ? Number(minPrice) : null;
    const max = maxPrice !== undefined && maxPrice !== "" ? Number(maxPrice) : null;
    const hasMin = min !== null && !Number.isNaN(min);
    const hasMax = max !== null && !Number.isNaN(max);
    if (hasMin && hasMax) {
      params.and = "(price.gte." + min + ",price.lte." + max + ")";
    } else if (hasMin) {
      params.price = "gte." + min;
    } else if (hasMax) {
      params.price = "lte." + max;
    }

    if (sort === "price_asc") params.order = "price.asc";
    else if (sort === "price_desc") params.order = "price.desc";
    else params.order = "created_at.desc";

    const allProducts = await db.select("mkt_products", params);
    const products = allProducts.filter((p) => !p.flagged || (me && me.id === p.seller_id));
    const sellerIds = [...new Set(products.map((p) => p.seller_id))];
    const [sellers, ratings] = await Promise.all([
      sellerIds.length
        ? db.select("mkt_users", { id: "in.(" + sellerIds.map(enc).join(",") + ")", select: "id,name,photo" })
        : Promise.resolve([]),
      userRatingSummariesBatch(sellerIds),
    ]);

    const safe = products.map((p) => {
      const seller = sellers.find((u) => u.id === p.seller_id);
      const out = productOut(p);
      out.photos = out.photos && out.photos[0] ? [out.photos[0]] : [];
      out.video = null; // full video omitted from list responses to keep payload light - fetched on detail view
      out.sellerName = seller ? seller.name : "Unknown";
      out.sellerPhoto = seller ? seller.photo : null;
      out.sellerRating = ratings[p.seller_id];
      return out;
    });
    return sendJson(res, 200, safe);
  }

  const productMatch = pathname.match(/^\/api\/products\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && productMatch) {
    const products = await db.select("mkt_products", { id: "eq." + enc(productMatch[1]), select: "*" });
    const p = products && products[0];
    if (!p) return sendJson(res, 404, { error: "Product not found" });
    if (p.flagged) {
      const me = await getAuthUser(req);
      if (!me || me.id !== p.seller_id) return sendJson(res, 404, { error: "Product not found" });
    }
    const sellers = await db.select("mkt_users", { id: "eq." + enc(p.seller_id), select: "id,name,photo,phone,created_at" });
    const seller = sellers && sellers[0];
    const [rating, trust] = await Promise.all([userRatingSummary(p.seller_id), userTrustSummary(p.seller_id)]);
    const savedRows = await db.select("mkt_saved_items", { product_id: "eq." + enc(p.id), select: "user_id" });
    const out = productOut(p);
    out.sellerName = seller ? seller.name : "Unknown";
    out.sellerPhoto = seller ? seller.photo : null;
    out.sellerRating = rating;
    out.sellerSalesCount = trust.salesCount;
    out.sellerVerified = seller ? computeVerifiedSeller(seller, trust.salesCount) : false;
    out.saveCount = (savedRows || []).length;
    const me = await getAuthUser(req);
    out.saved = !!(me && savedRows.some((r) => r.user_id === me.id));
    return sendJson(res, 200, out);
  }

  // ---- ISBN lookup (barcode scan -> book title/author/cover via Open Library) ----
  const isbnMatch = pathname.match(/^\/api\/isbn\/([0-9Xx-]{8,20})$/);
  if (method === "GET" && isbnMatch) {
    const cleanIsbn = isbnMatch[1].replace(/[^0-9Xx]/g, "");
    try {
      const data = await httpsRequestJson(
        "GET",
        "https://openlibrary.org/api/books?bibkeys=ISBN:" + enc(cleanIsbn) + "&format=json&jscmd=data",
        { headers: { "User-Agent": "HieloIce/1.0 (+https://hieloice.com)" } }
      );
      const book = data && data["ISBN:" + cleanIsbn];
      if (!book) return sendJson(res, 200, { found: false, isbn: cleanIsbn });
      return sendJson(res, 200, {
        found: true,
        isbn: cleanIsbn,
        title: book.title || "",
        authors: Array.isArray(book.authors) ? book.authors.map((a) => a.name).filter(Boolean) : [],
        cover: (book.cover && (book.cover.medium || book.cover.large || book.cover.small)) || null,
      });
    } catch (e) {
      return sendJson(res, 200, { found: false, isbn: cleanIsbn });
    }
  }

  // ---- AI: analyze a book photo and suggest title/description/category ----
  // The seller always reviews and can edit before publishing - this endpoint
  // only ever produces a *suggestion*, never publishes anything itself.
  // It also researches real-world used-book prices via Claude's web search
  // tool (a handful of well-known resale sites) so the suggested price is
  // grounded in actual comparable listings, not a guess.
  if (method === "POST" && pathname === "/api/ai/analyze-book-photo") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    if (!ANTHROPIC_API_KEY) return sendJson(res, 503, { error: "AI features are not configured on this server yet." });
    // Lower limit than a plain chat message: this call also runs a handful
    // of billed web searches, so it costs meaningfully more per use.
    if (!checkRateLimit("ai-photo:" + me.id, 12, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: "Too many AI requests. Please try again in a bit." });
    }

    const body = await readBody(req);
    const image = typeof body.image === "string" ? body.image : "";
    const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return sendJson(res, 400, { error: "Please provide a JPEG, PNG, or WEBP photo." });
    const [, mediaType, base64Data] = m;
    if (base64Data.length > 8 * 1024 * 1024) {
      return sendJson(res, 400, { error: "Photo is too large." });
    }
    const locale = body.locale === "es" ? "es" : "en";

    try {
      const data = await callClaude({
        model: "claude-sonnet-5",
        max_tokens: 1200,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 4,
            allowed_domains: [
              "abebooks.com", "thriftbooks.com", "betterworldbooks.com",
              "ebay.com", "amazon.com", "biblio.com", "worldofbooks.com",
            ],
          },
        ],
        system:
          "You are a listing assistant for HieloIce, a marketplace for used and secondhand books. " +
          "You will be shown a photo of a book (cover, spine, or barcode). Steps: " +
          "1) Identify the exact book (and edition, if visible). " +
          "2) Use the web_search tool to look up what this book typically resells for used on sites like " +
          "AbeBooks, ThriftBooks, Better World Books, eBay, Amazon, Biblio, or World of Books - run 2-4 " +
          "searches if needed to find real comparable used prices. " +
          "3) Write a short, honest, appealing resale listing. " +
          "After you finish searching, your FINAL message must be ONLY a single JSON object, no markdown " +
          "fences, no text before or after it, in this exact shape: " +
          '{"title": "...", "description": "...", "category": "...", "suggestedPriceUsd": 0, "priceReasoning": "..."}. ' +
          "The title should be the book's real title (and author, if confident), under 100 characters. " +
          "The description should be 2-4 sentences, written " + (locale === "es" ? "in Spanish" : "in English") +
          ", describing the book and its visible condition (cover wear, edge yellowing, etc.) based on the " +
          "photo - do not invent condition details you can't see. The category MUST be exactly one of these " +
          "slugs: " + CATEGORIES.join(", ") + ". suggestedPriceUsd must be a plain number (US dollars, no " +
          "symbol) - a reasonable used-book resale price based on what you found, adjusted down a bit for a " +
          "typical used C2C listing versus a professional seller. priceReasoning must be 1-2 short sentences " +
          (locale === "es" ? "in Spanish " : "in English ") +
          "explaining what comparable prices you found and where. If you cannot identify the book at all, or " +
          "found no pricing data, set title to \"\", suggestedPriceUsd to 0, and category to \"other-books\".",
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
              { type: "text", text: "Identify this book, research its typical used resale price, and return the JSON listing suggestion." },
            ],
          },
        ],
      });
      const textBlocks = Array.isArray(data.content) ? data.content.filter((b) => b.type === "text") : [];
      const raw = textBlocks.length ? textBlocks[textBlocks.length - 1].text : "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI did not return JSON");
      const parsed = JSON.parse(jsonMatch[0]);
      const category = CATEGORIES.includes(parsed.category) ? parsed.category : "other-books";
      const suggestedPrice = Number(parsed.suggestedPriceUsd);
      return sendJson(res, 200, {
        title: String(parsed.title || "").slice(0, 140),
        description: String(parsed.description || "").slice(0, 3000),
        category,
        suggestedPrice: Number.isFinite(suggestedPrice) && suggestedPrice > 0 ? Math.round(suggestedPrice * 100) / 100 : null,
        priceReasoning: String(parsed.priceReasoning || "").slice(0, 500),
      });
    } catch (e) {
      console.error("AI photo analysis failed:", e && e.message);
      return sendJson(res, 502, { error: "AI could not analyze this photo right now. Please try again or fill it in manually." });
    }
  }

  // ---- AI: suggest a short social caption + hashtags for a Moment/Loop photo ----
  // Same shape as analyze-book-photo above (auth, 503-if-unconfigured, rate
  // limit, base64 validation, "final message is pure JSON" contract) but
  // cheaper: no web_search tool, smaller max_tokens, higher rate limit. v1 is
  // image-only - the client is expected to only offer this for photo
  // captures (or a video's poster frame, if one is ever generated
  // client-side); there is no server-side video frame extraction here.
  if (method === "POST" && pathname === "/api/ai/suggest-caption") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    if (!ANTHROPIC_API_KEY) return sendJson(res, 503, { error: "AI features are not configured on this server yet." });
    // Cheaper than the book-photo analysis (no web search tool), so a
    // higher hourly ceiling than "ai-photo:" is fine.
    if (!checkRateLimit("ai-caption:" + me.id, 20, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: "Too many AI requests. Please try again in a bit." });
    }

    const body = await readBody(req);
    const image = typeof body.image === "string" ? body.image : "";
    const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return sendJson(res, 400, { error: "Please provide a JPEG, PNG, or WEBP photo." });
    const [, mediaType, base64Data] = m;
    if (base64Data.length > 8 * 1024 * 1024) {
      return sendJson(res, 400, { error: "Photo is too large." });
    }
    const locale = body.locale === "es" ? "es" : "en";
    const context = typeof body.context === "string" ? body.context.slice(0, 120) : "";

    try {
      const data = await callClaude({
        model: "claude-sonnet-5",
        max_tokens: 500,
        system:
          "You are a social caption writer for HieloIce, a marketplace and social app. " +
          "You will be shown a photo" + (context ? " (" + context + ")" : "") + ". Write a short, engaging " +
          "social caption for it - 1-2 sentences, casual and authentic in tone, the way a real person captions " +
          "a photo on Instagram or TikTok, NOT a formal product description. Write it " +
          (locale === "es" ? "in Spanish. " : "in English. ") +
          "Also suggest 3-5 relevant hashtag words (no # symbol, just the words - the app will add the # itself). " +
          "Your FINAL message must be ONLY a single JSON object, no markdown fences, no text before or after it, " +
          'in this exact shape: {"caption": "...", "hashtags": ["...", "..."]}.',
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
              { type: "text", text: "Write a short social caption and hashtags for this photo, and return the JSON." },
            ],
          },
        ],
      });
      const textBlocks = Array.isArray(data.content) ? data.content.filter((b) => b.type === "text") : [];
      const raw = textBlocks.length ? textBlocks[textBlocks.length - 1].text : "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI did not return JSON");
      const parsed = JSON.parse(jsonMatch[0]);
      const hashtags = Array.isArray(parsed.hashtags)
        ? parsed.hashtags.filter((h) => typeof h === "string" && h.trim()).slice(0, 5).map((h) => h.trim().replace(/^#/, "").slice(0, 30))
        : [];
      return sendJson(res, 200, {
        caption: String(parsed.caption || "").slice(0, 200),
        hashtags,
      });
    } catch (e) {
      console.error("AI caption suggestion failed:", e && e.message);
      return sendJson(res, 502, { error: "AI could not suggest a caption right now. Please try again or write your own." });
    }
  }

  // ---- AI: "auto-clip" - suggest the best highlight window for a video Moment ----
  // MVP: no server-side video re-encoding/ffmpeg. The client samples ~6-8
  // small frames evenly across the raw video (see wizard-ai-clip in app.js)
  // and sends them here with their timestamps; Claude picks the single most
  // engaging contiguous window for a short-form vertical video. The result
  // is stored as trim_start_sec/trim_end_sec metadata on the moment (see
  // POST /api/moments below) and enforced client-side at playback time
  // (seek to the start, loop back once the end is reached) - never an
  // actual cut file. Same shape as suggest-caption above (auth, 503-if-
  // unconfigured, rate limit, "final message is pure JSON" contract).
  if (method === "POST" && pathname === "/api/ai/suggest-clip") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    if (!ANTHROPIC_API_KEY) return sendJson(res, 503, { error: "AI features are not configured on this server yet." });
    // Similar budget to suggest-caption: a handful of small images, no web
    // search tool.
    if (!checkRateLimit("ai-clip:" + me.id, 20, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: "Too many AI requests. Please try again in a bit." });
    }

    const body = await readBody(req);
    const durationSec = Number(body.durationSec);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return sendJson(res, 400, { error: "A valid video duration is required." });
    }
    const framesIn = Array.isArray(body.frames) ? body.frames : [];
    if (!framesIn.length) return sendJson(res, 400, { error: "At least one sampled frame is required." });

    const frames = [];
    for (const f of framesIn.slice(0, 8)) {
      const t = Number(f && f.t);
      const fm = typeof (f && f.image) === "string" ? f.image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/) : null;
      if (!Number.isFinite(t) || !fm) continue;
      const [, frameMediaType, base64Data] = fm;
      if (base64Data.length > 2 * 1024 * 1024) continue; // frames are meant to be thumbnail-sized
      frames.push({ t, mediaType: frameMediaType, base64Data });
    }
    if (!frames.length) return sendJson(res, 400, { error: "No valid frames were provided." });
    frames.sort((a, b) => a.t - b.t);

    const MIN_CLIP_SEC = 8;
    const MAX_CLIP_SEC = 45;
    const content = [];
    frames.forEach((f) => {
      content.push({ type: "text", text: "Frame at t=" + f.t.toFixed(1) + "s:" });
      content.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.base64Data } });
    });
    content.push({
      type: "text",
      text:
        "The video is " + durationSec.toFixed(1) + " seconds long in total. Based on these sampled frames, pick the " +
        "single most engaging contiguous highlight window to publish as a short-form vertical video (think " +
        "Reels/TikTok/Shorts hook quality - a strong opening moment, visual interest, and a natural stopping " +
        "point). Return the JSON now.",
    });

    try {
      const data = await callClaude({
        model: "claude-sonnet-5",
        max_tokens: 500,
        system:
          "You are a short-form video editor assistant for HieloIce, a marketplace and social app. You will be " +
          "shown a handful of frames sampled evenly across a raw video clip, each labeled with its timestamp in " +
          "seconds. Choose the best contiguous highlight window (startSec/endSec) to publish, between " + MIN_CLIP_SEC +
          " and " + MAX_CLIP_SEC + " seconds long, fully within [0, " + durationSec.toFixed(1) + "]. Your FINAL " +
          "message must be ONLY a single JSON object, no markdown fences, no text before or after it, in this " +
          'exact shape: {"startSec": 0, "endSec": 0, "reason": "..."}. reason must be a short (under 140 ' +
          "characters) plain-English explanation of why that window is the strongest highlight.",
        messages: [{ role: "user", content }],
      });
      const textBlocks = Array.isArray(data.content) ? data.content.filter((b) => b.type === "text") : [];
      const raw = textBlocks.length ? textBlocks[textBlocks.length - 1].text : "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI did not return JSON");
      const parsed = JSON.parse(jsonMatch[0]);

      let startSec = Number(parsed.startSec);
      let endSec = Number(parsed.endSec);
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) throw new Error("AI returned an invalid window");
      // Clamp (rather than reject) if the model overshoots slightly - be lenient here.
      startSec = Math.max(0, Math.min(startSec, durationSec));
      endSec = Math.max(0, Math.min(endSec, durationSec));
      if (endSec <= startSec) throw new Error("AI returned an invalid window");
      let clipLen = endSec - startSec;
      if (clipLen < MIN_CLIP_SEC) {
        endSec = Math.min(durationSec, startSec + MIN_CLIP_SEC);
        clipLen = endSec - startSec;
      }
      if (clipLen > 60) {
        endSec = startSec + 60;
        clipLen = 60;
      }
      if (endSec > durationSec) {
        endSec = durationSec;
        startSec = Math.max(0, endSec - clipLen);
      }

      return sendJson(res, 200, {
        startSec: Math.round(startSec * 10) / 10,
        endSec: Math.round(endSec * 10) / 10,
        reason: String(parsed.reason || "").slice(0, 140),
      });
    } catch (e) {
      console.error("AI clip suggestion failed:", e && e.message);
      return sendJson(res, 502, { error: "AI could not suggest a highlight clip right now. Please try again or use the full video." });
    }
  }

  // ---- AI: help assistant chatbot (replaces the old rule-based FAQ widget) ----
  if (method === "POST" && pathname === "/api/ai/chat") {
    if (!ANTHROPIC_API_KEY) return sendJson(res, 503, { error: "AI features are not configured on this server yet." });
    const ip = getClientIp(req);
    if (!checkRateLimit("ai-chat:" + ip, 40, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: "Too many messages. Please try again in a bit." });
    }

    const body = await readBody(req);
    const locale = body.locale === "es" ? "es" : "en";
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    const messages = incoming
      .filter((x) => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
      .slice(-12)
      .map((x) => ({ role: x.role, content: String(x.content).slice(0, 2000) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return sendJson(res, 400, { error: "Missing user message." });
    }

    try {
      const data = await callClaude({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system:
          "You are the HieloIce help assistant, embedded as a chat widget on hieloice.com, a marketplace and " +
          "social network for buying, selling, and discussing used/secondhand books. Reply " +
          (locale === "es" ? "in Spanish" : "in English") + ", in 2-5 short sentences, in a warm, helpful, " +
          "concise tone - no markdown headers or bullet lists, just plain conversational text. " +
          "Proactively GUIDE users through how to do things step by step (don't just answer narrowly) - for " +
          "example if someone asks about selling, briefly walk them through: tap Create (+) or 'Post an Ad', " +
          "add photos or scan the ISBN/barcode to auto-fill details (or use 'Analyze with AI' to draft the " +
          "title/description for them to review), set a price and category, and publish. " +
          "Key features you can explain: Marketplace (browse/search/filter used books, ISBN barcode scanning, " +
          "AI-assisted listings the seller always reviews before publishing), Moments (24h photo/video stories), " +
          "Clips (full-screen video feed), Friends & People, Groups/Communities, Messages, saved items, " +
          "seller ratings and verified-seller badges, notifications, light/dark theme, and account settings. " +
          "If asked something you genuinely don't know (e.g. specific account/order details, refunds, payment " +
          "disputes, or legal questions), say so honestly and suggest they use 'Report a Bug' or the Contact " +
          "link (info@hieloice.com). Never claim to take actions yourself (you cannot post listings, send " +
          "money, or change account settings) - only guide the user to do it.",
        messages,
      });
      const reply = claudeText(data) || (locale === "es" ? "Lo siento, no pude generar una respuesta. Intenta de nuevo." : "Sorry, I couldn't generate a reply. Please try again.");
      return sendJson(res, 200, { reply });
    } catch (e) {
      console.error("AI chat failed:", e && e.message);
      return sendJson(res, 502, { error: locale === "es" ? "El asistente de IA no está disponible ahora mismo." : "The AI assistant is unavailable right now." });
    }
  }

  if (method === "POST" && pathname === "/api/products") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const { title, description, price, category, country, state, city, allowOffers, allowReturn, isbn } = body;

    if (!title || !String(title).trim()) return sendJson(res, 400, { error: "Title is required" });
    if (!CATEGORIES.includes(category)) return sendJson(res, 400, { error: "Invalid category" });

    let photos = Array.isArray(body.photos) ? body.photos : [];
    photos = photos.filter((p) => typeof p === "string" && p.startsWith("data:image/")).slice(0, MAX_PHOTOS);

    const video = typeof body.video === "string" && body.video.startsWith("data:video/") ? body.video : null;
    const videoDurationSeconds = video && typeof body.videoDurationSeconds === "number" ? body.videoDurationSeconds : null;
    if (video && videoDurationSeconds != null && videoDurationSeconds > MAX_PRODUCT_VIDEO_SECONDS + 1) {
      return sendJson(res, 400, { error: "Video must be " + MAX_PRODUCT_VIDEO_SECONDS + " seconds or less" });
    }

    const product = {
      id: crypto.randomBytes(8).toString("hex"),
      seller_id: me.id,
      title: String(title).trim().slice(0, 140),
      description: String(description || "").slice(0, 3000),
      price: price ? Number(price) || 0 : 0,
      category,
      isbn: isbn ? String(isbn).replace(/[^0-9Xx]/g, "").slice(0, 13) : null,
      photos,
      video,
      video_duration_seconds: videoDurationSeconds,
      cover_is_video: !!(body.coverIsVideo && video),
      country: String(country || "").slice(0, 80),
      state: String(state || "").slice(0, 80),
      city: String(city || "").slice(0, 80),
      allow_offers: !!allowOffers,
      allow_return: !!allowReturn,
      status: "active",
      created_at: Date.now(),
      status_changed_at: Date.now(),
    };
    const inserted = await db.insert("mkt_products", product);
    notifyAllOptedIn(
      "newProducts",
      {
        title: "Nuevo producto en tu categoría",
        body: product.title,
        url: "/#/product/" + inserted.id,
      },
      (u) => Array.isArray(u.followed_categories) && u.followed_categories.includes(product.category)
    ).catch(() => {});
    return sendJson(res, 201, productOut(inserted));
  }

  if ((method === "PUT" || method === "DELETE") && productMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const products = await db.select("mkt_products", { id: "eq." + enc(productMatch[1]), select: "*" });
    const p = products && products[0];
    if (!p) return sendJson(res, 404, { error: "Product not found" });
    if (p.seller_id !== me.id) return sendJson(res, 403, { error: "You do not own this product" });

    if (method === "DELETE") {
      await db.remove("mkt_products", { id: "eq." + enc(p.id) });
      return sendJson(res, 200, { ok: true });
    }

    const body = await readBody(req);
    const patch = {};
    if (body.title !== undefined) patch.title = String(body.title).trim().slice(0, 140);
    if (body.description !== undefined) patch.description = String(body.description).slice(0, 3000);
    if (body.price !== undefined) patch.price = Number(body.price) || 0;
    if (body.category !== undefined && CATEGORIES.includes(body.category)) patch.category = body.category;
    if (body.isbn !== undefined) patch.isbn = body.isbn ? String(body.isbn).replace(/[^0-9Xx]/g, "").slice(0, 13) : null;
    if (body.country !== undefined) patch.country = String(body.country).slice(0, 80);
    if (body.state !== undefined) patch.state = String(body.state).slice(0, 80);
    if (body.city !== undefined) patch.city = String(body.city).slice(0, 80);
    if (body.allowOffers !== undefined) patch.allow_offers = !!body.allowOffers;
    if (body.allowReturn !== undefined) patch.allow_return = !!body.allowReturn;
    if (body.status !== undefined && ["active", "reserved", "sold"].includes(body.status)) {
      patch.status = body.status;
      patch.status_changed_at = Date.now();
      patch.reminder_sent_at = null;
    }
    if (Array.isArray(body.photos)) {
      patch.photos = body.photos.filter((x) => typeof x === "string" && x.startsWith("data:image/")).slice(0, MAX_PHOTOS);
    }
    if (body.video !== undefined) {
      patch.video = typeof body.video === "string" && body.video.startsWith("data:video/") ? body.video : null;
      if (!patch.video) {
        patch.video_duration_seconds = null;
        patch.cover_is_video = false;
      } else if (typeof body.videoDurationSeconds === "number") {
        if (body.videoDurationSeconds > MAX_PRODUCT_VIDEO_SECONDS + 1) {
          return sendJson(res, 400, { error: "Video must be " + MAX_PRODUCT_VIDEO_SECONDS + " seconds or less" });
        }
        patch.video_duration_seconds = body.videoDurationSeconds;
      }
    }
    if (body.coverIsVideo !== undefined) {
      const willHaveVideo = patch.video !== undefined ? !!patch.video : !!p.video;
      patch.cover_is_video = !!(body.coverIsVideo && willHaveVideo);
    }
    const updated = await db.update("mkt_products", { id: "eq." + enc(p.id) }, patch);
    return sendJson(res, 200, productOut(updated[0]));
  }

  // ---- SAVED ITEMS (Pinterest-style "Guardar" - collections + demand signal for sellers) ----

  function savedItemOut(s) {
    const { user_id, product_id, created_at, ...rest } = s;
    return { ...rest, userId: user_id, productId: product_id, createdAt: created_at };
  }

  const productSaveMatch = pathname.match(/^\/api\/products\/([a-zA-Z0-9]+)\/save$/);
  if (method === "POST" && productSaveMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const products = await db.select("mkt_products", { id: "eq." + enc(productSaveMatch[1]), select: "id" });
    if (!products || !products[0]) return sendJson(res, 404, { error: "Product not found" });
    const body = await readBody(req);
    const collection = String(body.collection || "Favoritos").trim().slice(0, 60) || "Favoritos";
    const existing = await db.select("mkt_saved_items", {
      user_id: "eq." + enc(me.id),
      product_id: "eq." + enc(productSaveMatch[1]),
      select: "*",
    });
    if (existing && existing[0]) {
      const updated = await db.update(
        "mkt_saved_items",
        { id: "eq." + enc(existing[0].id) },
        { collection }
      );
      return sendJson(res, 200, savedItemOut(updated[0]));
    }
    const saved = {
      id: crypto.randomBytes(8).toString("hex"),
      user_id: me.id,
      product_id: productSaveMatch[1],
      collection,
      created_at: Date.now(),
    };
    await db.insert("mkt_saved_items", saved);
    return sendJson(res, 201, savedItemOut(saved));
  }

  if (method === "DELETE" && productSaveMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    await db.remove("mkt_saved_items", { user_id: "eq." + enc(me.id), product_id: "eq." + enc(productSaveMatch[1]) });
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/saved - the logged-in user's saved products, grouped by
  // collection on the client. Includes a live product summary so a sold or
  // edited listing always shows current info instead of a stale snapshot.
  if (method === "GET" && pathname === "/api/saved") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_saved_items", { user_id: "eq." + enc(me.id), select: "*", order: "created_at.desc" });
    if (!rows.length) return sendJson(res, 200, []);
    const productIds = [...new Set(rows.map((r) => r.product_id))];
    const products = await db.select("mkt_products", {
      id: "in.(" + productIds.map(enc).join(",") + ")",
      select: "id,title,price,photos,status",
    });
    const out = rows.map((r) => {
      const p = products.find((x) => x.id === r.product_id);
      return {
        ...savedItemOut(r),
        productTitle: p ? p.title : "Deleted listing",
        productPrice: p ? p.price : null,
        productPhoto: p && p.photos && p.photos[0] ? p.photos[0] : null,
        productStatus: p ? p.status : null,
      };
    });
    return sendJson(res, 200, out);
  }

  // ---- OFFERS ----
  const productOffersMatch = pathname.match(/^\/api\/products\/([a-zA-Z0-9]+)\/offers$/);
  if (method === "POST" && productOffersMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const products = await db.select("mkt_products", { id: "eq." + enc(productOffersMatch[1]), select: "*" });
    const product = products && products[0];
    if (!product) return sendJson(res, 404, { error: "Product not found" });
    if (product.seller_id === me.id) return sendJson(res, 400, { error: "You cannot make an offer on your own listing" });

    const body = await readBody(req);
    const type = body.type === "buy" ? "buy" : "offer";
    const amount = type === "buy" ? product.price : Number(body.amount);
    if (type === "offer" && (!amount || amount <= 0)) return sendJson(res, 400, { error: "Enter a valid offer amount" });

    const offer = {
      id: crypto.randomBytes(8).toString("hex"),
      product_id: product.id,
      seller_id: product.seller_id,
      buyer_id: me.id,
      type,
      amount,
      message: String(body.message || "").slice(0, 500),
      status: "pending",
      created_at: Date.now(),
    };
    await db.insert("mkt_offers", offer);
    notifyUser(product.seller_id, "offers", {
      title: "Nueva oferta en HieloIce",
      body: type === "buy" ? "Alguien quiere comprar tu publicación" : "Te ofrecieron " + amount + " por tu publicación",
      url: "/#/product/" + product.id,
    }).catch(() => {});
    return sendJson(res, 201, {
      id: offer.id,
      productId: offer.product_id,
      sellerId: offer.seller_id,
      buyerId: offer.buyer_id,
      type: offer.type,
      amount: offer.amount,
      message: offer.message,
      status: offer.status,
      createdAt: offer.created_at,
    });
  }

  if (method === "GET" && productOffersMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const products = await db.select("mkt_products", { id: "eq." + enc(productOffersMatch[1]), select: "*" });
    const product = products && products[0];
    if (!product) return sendJson(res, 404, { error: "Product not found" });
    if (product.seller_id !== me.id) return sendJson(res, 403, { error: "Only the seller can view offers" });

    const offers = await db.select("mkt_offers", {
      product_id: "eq." + enc(product.id),
      order: "created_at.desc",
      select: "*",
    });
    const buyerIds = [...new Set(offers.map((o) => o.buyer_id))];
    let buyers = [];
    if (buyerIds.length) {
      buyers = await db.select("mkt_users", { id: "in.(" + buyerIds.map(enc).join(",") + ")", select: "id,name" });
    }
    const out = offers.map((o) => {
      const buyer = buyers.find((u) => u.id === o.buyer_id);
      return {
        id: o.id,
        productId: o.product_id,
        sellerId: o.seller_id,
        buyerId: o.buyer_id,
        type: o.type,
        amount: o.amount,
        message: o.message,
        status: o.status,
        createdAt: o.created_at,
        buyerName: buyer ? buyer.name : "Unknown",
      };
    });
    return sendJson(res, 200, out);
  }

  if (method === "GET" && pathname === "/api/offers/mine") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const offers = await db.select("mkt_offers", {
      buyer_id: "eq." + enc(me.id),
      order: "created_at.desc",
      select: "*",
    });
    const productIds = [...new Set(offers.map((o) => o.product_id))];
    let products = [];
    if (productIds.length) {
      products = await db.select("mkt_products", {
        id: "in.(" + productIds.map(enc).join(",") + ")",
        select: "id,title",
      });
    }
    const out = offers.map((o) => {
      const product = products.find((p) => p.id === o.product_id);
      return {
        id: o.id,
        productId: o.product_id,
        sellerId: o.seller_id,
        buyerId: o.buyer_id,
        type: o.type,
        amount: o.amount,
        message: o.message,
        status: o.status,
        createdAt: o.created_at,
        productTitle: product ? product.title : "Deleted listing",
      };
    });
    return sendJson(res, 200, out);
  }

  const offerMatch = pathname.match(/^\/api\/offers\/([a-zA-Z0-9]+)$/);
  if (method === "PUT" && offerMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const offers = await db.select("mkt_offers", { id: "eq." + enc(offerMatch[1]), select: "*" });
    const o = offers && offers[0];
    if (!o) return sendJson(res, 404, { error: "Offer not found" });
    if (o.seller_id !== me.id) return sendJson(res, 403, { error: "Only the seller can respond to this offer" });
    const body = await readBody(req);
    if (!["accepted", "rejected"].includes(body.status)) return sendJson(res, 400, { error: "Invalid status" });
    const updated = await db.update("mkt_offers", { id: "eq." + enc(o.id) }, { status: body.status });
    const u = updated[0];
    notifyUser(u.buyer_id, "offers", {
      title: body.status === "accepted" ? "¡Tu oferta fue aceptada!" : "Tu oferta fue rechazada",
      body: "Revisa los detalles en HieloIce",
      url: "/#/product/" + u.product_id,
    }).catch(() => {});
    return sendJson(res, 200, {
      id: u.id,
      productId: u.product_id,
      sellerId: u.seller_id,
      buyerId: u.buyer_id,
      type: u.type,
      amount: u.amount,
      message: u.message,
      status: u.status,
      createdAt: u.created_at,
    });
  }

  // ---- MESSAGES ----
  //
  // Message shape returned by shapeMessage() below - this is THE canonical
  // shape used by GET /api/conversations/:id, the POST send response, and
  // every WS "message:new" frame. Documented once here for the frontend:
  //   {
  //     id, fromUserId, toUserId,
  //     text: string,                                // "" for an attachment-only message, or a deleted-for-everyone message
  //     productId: string|null,                       // unchanged from before - optional link to a listing
  //     replyToId: string|null,                        // soft reference to another message's id (not validated/FK'd - same convention as productId)
  //     attachmentUrl: string|null, attachmentType: "image"|"video"|"audio"|null,
  //     reactions: { [emoji]: string[] },              // e.g. { "👍": ["userId1","userId2"] } - userIds who reacted with that emoji
  //     deleted: boolean,                               // true = "deleted for everyone" tombstone. When true, text/attachment*/reactions above are already cleared - render a placeholder ("This message was deleted"), don't rely on the client to hide content.
  //     read: boolean, createdAt: number (epoch ms),
  //   }
  // Messages the CALLER deleted "for me" are simply absent from the list -
  // no tombstone, they don't exist from that user's point of view.

  function messageHiddenForUser(m, userId) {
    const hiddenFor = Array.isArray(m.deleted_for_user_ids) ? m.deleted_for_user_ids : [];
    return hiddenFor.includes(userId);
  }

  function shapeMessage(m) {
    const deleted = !!m.deleted_for_everyone;
    return {
      id: m.id,
      fromUserId: m.from_user_id,
      toUserId: m.to_user_id,
      text: deleted ? "" : m.text || "",
      productId: m.product_id,
      replyToId: deleted ? null : m.reply_to_id || null,
      attachmentUrl: deleted ? null : m.attachment_url || null,
      attachmentType: deleted ? null : m.attachment_type || null,
      reactions: deleted ? {} : m.reactions || {},
      deleted,
      read: !!m.read,
      createdAt: m.created_at,
    };
  }

  if (method === "GET" && pathname === "/api/conversations") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const [fromMe, toMe] = await Promise.all([
      db.select("mkt_messages", { from_user_id: "eq." + enc(me.id), select: "*" }),
      db.select("mkt_messages", { to_user_id: "eq." + enc(me.id), select: "*" }),
    ]);
    const messages = [...fromMe, ...toMe].filter((m) => !messageHiddenForUser(m, me.id));

    const byOther = {};
    for (const m of messages) {
      const otherId = m.from_user_id === me.id ? m.to_user_id : m.from_user_id;
      if (!byOther[otherId] || m.created_at > byOther[otherId].created_at) {
        byOther[otherId] = m;
      }
    }
    const otherIds = Object.keys(byOther);
    let others = [];
    if (otherIds.length) {
      others = await db.select("mkt_users", { id: "in.(" + otherIds.map(enc).join(",") + ")", select: "id,name,photo" });
    }
    const list = otherIds.map((otherId) => {
      const other = others.find((u) => u.id === otherId);
      const last = byOther[otherId];
      const lastDeleted = !!last.deleted_for_everyone;
      return {
        userId: otherId,
        userName: other ? other.name : "Deleted user",
        userPhoto: other ? other.photo : null,
        // lastMessage is "" (not the deleted text) when lastMessageDeleted
        // is true - render your own bilingual "message was deleted" label
        // client-side, same tombstone convention as the full history below.
        lastMessage: lastDeleted ? "" : last.text,
        lastMessageDeleted: lastDeleted,
        lastMessageAttachmentType: lastDeleted ? null : last.attachment_type || null,
        lastAt: last.created_at,
        unread: messages.some((m) => m.from_user_id === otherId && m.to_user_id === me.id && !m.read),
      };
    });
    list.sort((a, b) => b.lastAt - a.lastAt);
    return sendJson(res, 200, list);
  }

  const convoMatch = pathname.match(/^\/api\/conversations\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && convoMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const otherId = convoMatch[1];
    const [sent, received] = await Promise.all([
      db.select("mkt_messages", { from_user_id: "eq." + enc(me.id), to_user_id: "eq." + enc(otherId), select: "*" }),
      db.select("mkt_messages", { from_user_id: "eq." + enc(otherId), to_user_id: "eq." + enc(me.id), select: "*" }),
    ]);
    const messages = [...sent, ...received]
      .filter((m) => !messageHiddenForUser(m, me.id))
      .sort((a, b) => a.created_at - b.created_at);

    const unreadIds = received.filter((m) => !m.read && !messageHiddenForUser(m, me.id)).map((m) => m.id);
    if (unreadIds.length) {
      await db.update("mkt_messages", { id: "in.(" + unreadIds.map(enc).join(",") + ")" }, { read: true });
      // Tell the sender (otherId) their message(s) were just read, live -
      // no-op if they have no open socket right now.
      wsSendToUser(otherId, {
        type: "message:read",
        conversationWith: me.id,
        messageIds: unreadIds,
        readAt: Date.now(),
      });
    }

    const out = messages.map((m) => {
      const shaped = shapeMessage(m);
      if (unreadIds.includes(m.id)) shaped.read = true;
      return shaped;
    });
    return sendJson(res, 200, out);
  }

  if (method === "POST" && convoMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const otherId = convoMatch[1];
    const others = await db.select("mkt_users", { id: "eq." + enc(otherId), select: "id,chat_privacy" });
    if (!others || !others[0]) return sendJson(res, 404, { error: "User not found" });

    if (otherId !== me.id && (await isBlockedEitherWay(me.id, otherId))) {
      return sendJson(res, 403, { error: "You can't message this user." });
    }

    if (otherId !== me.id && others[0].chat_privacy === "friends") {
      const areFriends = await isFriendsWith(me.id, otherId);
      if (!areFriends) {
        return sendJson(res, 403, { error: "This user only accepts messages from friends." });
      }
    }

    // Body: { text?: string, productId?: string, replyToId?: string,
    //         attachmentUrl?: string, attachmentType?: "image"|"video"|"audio" }
    // At least one of text / attachmentUrl is required (an attachment-only
    // message, e.g. a photo or voice note with no caption, is valid -
    // Instagram/WhatsApp/Messenger all allow this).
    const body = await readBody(req);
    const text = body.text ? String(body.text).trim().slice(0, 2000) : "";
    const attachmentType = ["image", "video", "audio"].includes(body.attachmentType) ? body.attachmentType : null;
    const attachmentUrl = body.attachmentUrl ? String(body.attachmentUrl).trim().slice(0, 1000) : null;
    if (attachmentUrl && !attachmentType) {
      return sendJson(res, 400, { error: "attachmentType is required when attachmentUrl is set" });
    }
    if (!text && !attachmentUrl) {
      return sendJson(res, 400, { error: "Message text or attachment is required" });
    }

    const message = {
      id: crypto.randomBytes(8).toString("hex"),
      from_user_id: me.id,
      to_user_id: otherId,
      text,
      product_id: body.productId || null,
      reply_to_id: body.replyToId ? String(body.replyToId) : null, // soft reference, not validated - see productId above for precedent
      attachment_url: attachmentUrl,
      attachment_type: attachmentType,
      reactions: {},
      deleted_for_everyone: false,
      deleted_for_user_ids: [],
      read: false,
      created_at: Date.now(),
    };
    await db.insert("mkt_messages", message);

    const shaped = shapeMessage(message);
    // Deliver instantly over WS to anyone with an open tab/device right now
    // (both sides, so the sender's own other tabs also get it immediately).
    wsSendToUser(otherId, { type: "message:new", message: shaped });
    wsSendToUser(me.id, { type: "message:new", message: shaped });

    // ...AND always fire the push notification too (same helper/category
    // every other push in this app uses) - if the recipient has a live
    // socket they'll just get both and the client is expected to dedupe by
    // message id; if they don't, push is the only way they find out.
    const pushBody =
      text ||
      (attachmentType === "audio" ? "🎤 Voice note" : attachmentType === "video" ? "🎥 Video" : attachmentType === "image" ? "📷 Photo" : "New message");
    notifyUser(otherId, "messages", {
      type: "message",
      tag: "message-" + me.id,
      title: (me.name || "Alguien") + " te envió un mensaje",
      body: pushBody,
      url: "/#/messages/" + me.id,
    }).catch(() => {});

    return sendJson(res, 201, shaped);
  }

  // Thin upload endpoint for chat attachments (images, video clips, voice
  // notes). Deliberately NOT reusing /api/users/me/photos or the
  // moments/loops upload code paths - those each carry feature-specific
  // validation (video-length caps, own-listing checks, image-only, etc.)
  // that doesn't apply here. This calls the exact same sbStorageUpload()
  // helper everything else in the app uses - no new storage mechanism,
  // just a different bucket path prefix ("chat/<conversationKey>/...").
  //
  // Request:  POST /api/messages/attachments
  //   { "media": "data:<mime>;base64,<...>", "type": "image"|"video"|"audio", "conversationWith": "<otherUserId>" }
  // Response: 200 { "url": "<public Storage URL>", "type": "image"|"video"|"audio" }
  //
  // Typical flow: upload here first to get `url`, then POST
  // /api/conversations/:otherId with { attachmentUrl: url, attachmentType: type }.
  if (method === "POST" && pathname === "/api/messages/attachments") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const type = body.type;
    if (!["image", "video", "audio"].includes(type)) {
      return sendJson(res, 400, { error: "type must be image, video, or audio" });
    }
    const media = body.media;
    const match = typeof media === "string" && /^data:([^;]+);base64,/.exec(media);
    if (!match) return sendJson(res, 400, { error: "A valid media data URL is required" });
    const mimePrefix = { image: "image/", video: "video/", audio: "audio/" }[type];
    if (!match[1].startsWith(mimePrefix)) {
      return sendJson(res, 400, { error: "media MIME type doesn't match the declared type" });
    }
    const extByMime = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "video/mp4": ".mp4",
      "video/webm": ".webm",
      "video/quicktime": ".mov",
      "audio/webm": ".webm",
      "audio/mpeg": ".mp3",
      "audio/mp4": ".m4a",
      "audio/ogg": ".ogg",
      "audio/wav": ".wav",
    };
    const ext = extByMime[match[1]] || (type === "image" ? ".jpg" : type === "video" ? ".mp4" : ".webm");
    // Both directions of a conversation share one folder so an admin/DB
    // browse of Storage shows a whole chat's media together.
    const otherId = body.conversationWith ? String(body.conversationWith) : "misc";
    const conversationKey = [me.id, otherId].sort().join("_");
    let mediaUrl;
    try {
      mediaUrl = await sbStorageUpload("media", "chat/" + conversationKey + "/" + crypto.randomBytes(8).toString("hex") + ext, media);
    } catch (e) {
      return sendJson(res, 500, { error: "Could not upload attachment" });
    }
    return sendJson(res, 200, { url: mediaUrl, type });
  }

  // POST   /api/messages/:id/react   body { emoji: "👍" }  -> adds caller's userId to reactions[emoji]
  // DELETE /api/messages/:id/react   body { emoji: "👍" }  -> removes caller's userId from reactions[emoji]
  // Both respond 200 { id, reactions } with the FULL updated reactions map,
  // and broadcast reaction:added / reaction:removed to both participants
  // over WS (see the realtime chat section above for the exact frame shape).
  const reactMatch = pathname.match(/^\/api\/messages\/([a-zA-Z0-9]+)\/react$/);
  if ((method === "POST" || method === "DELETE") && reactMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const msgId = reactMatch[1];
    const rows = await db.select("mkt_messages", { id: "eq." + enc(msgId), select: "*" });
    const m = rows && rows[0];
    if (!m) return sendJson(res, 404, { error: "Message not found" });
    if (m.from_user_id !== me.id && m.to_user_id !== me.id) {
      return sendJson(res, 403, { error: "Not part of this conversation" });
    }
    if (m.deleted_for_everyone) return sendJson(res, 400, { error: "This message was deleted" });

    const body = await readBody(req);
    const emoji = body.emoji ? String(body.emoji).slice(0, 8) : "";
    if (!emoji) return sendJson(res, 400, { error: "emoji is required" });

    const reactions = Object.assign({}, m.reactions || {});
    const reactedUsers = new Set(reactions[emoji] || []);
    if (method === "POST") {
      reactedUsers.add(me.id);
    } else {
      reactedUsers.delete(me.id);
    }
    if (reactedUsers.size) {
      reactions[emoji] = [...reactedUsers];
    } else {
      delete reactions[emoji]; // keep the map clean once an emoji has no reactors left
    }
    await db.update("mkt_messages", { id: "eq." + enc(msgId) }, { reactions });

    const otherId = m.from_user_id === me.id ? m.to_user_id : m.from_user_id;
    const payload = {
      type: method === "POST" ? "reaction:added" : "reaction:removed",
      messageId: msgId,
      emoji,
      userId: me.id,
      reactions,
    };
    wsSendToUser(otherId, payload);
    wsSendToUser(me.id, payload);

    return sendJson(res, 200, { id: msgId, reactions });
  }

  // DELETE /api/messages/:id   body { mode: "forMe" | "forEveryone" }
  //   "forMe": hides the message from the CALLER's own view only (added to
  //     deleted_for_user_ids) - the other participant's view is untouched.
  //     No WS broadcast to the other side (nothing changed for them); only
  //     echoed back to the caller's own other sockets so their other tabs
  //     hide it too.
  //   "forEveryone": only the ORIGINAL SENDER (from_user_id) may do this.
  //     The row is kept (not hard-deleted) but flagged
  //     deleted_for_everyone=true with text/attachment_url/attachment_type/
  //     reactions cleared server-side - so the content is actually gone
  //     from every future API response, not just hidden client-side.
  //     Broadcast to BOTH participants over WS as message:deleted.
  const deleteMsgMatch = pathname.match(/^\/api\/messages\/([a-zA-Z0-9]+)$/);
  if (method === "DELETE" && deleteMsgMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const msgId = deleteMsgMatch[1];
    const rows = await db.select("mkt_messages", { id: "eq." + enc(msgId), select: "*" });
    const m = rows && rows[0];
    if (!m) return sendJson(res, 404, { error: "Message not found" });
    if (m.from_user_id !== me.id && m.to_user_id !== me.id) {
      return sendJson(res, 403, { error: "Not part of this conversation" });
    }
    const body = await readBody(req);
    const mode = body.mode;
    if (mode !== "forMe" && mode !== "forEveryone") {
      return sendJson(res, 400, { error: 'mode must be "forMe" or "forEveryone"' });
    }
    const otherId = m.from_user_id === me.id ? m.to_user_id : m.from_user_id;

    if (mode === "forEveryone") {
      if (m.from_user_id !== me.id) {
        return sendJson(res, 403, { error: "Only the sender can delete a message for everyone" });
      }
      await db.update(
        "mkt_messages",
        { id: "eq." + enc(msgId) },
        { deleted_for_everyone: true, text: "", attachment_url: null, attachment_type: null, reactions: {} }
      );
      const payload = { type: "message:deleted", messageId: msgId, mode: "forEveryone", conversationWith: otherId };
      wsSendToUser(otherId, payload);
      wsSendToUser(me.id, payload);
      return sendJson(res, 200, { ok: true });
    }

    // mode === "forMe"
    const hidden = new Set(Array.isArray(m.deleted_for_user_ids) ? m.deleted_for_user_ids : []);
    hidden.add(me.id);
    await db.update("mkt_messages", { id: "eq." + enc(msgId) }, { deleted_for_user_ids: [...hidden] });
    wsSendToUser(me.id, { type: "message:deleted", messageId: msgId, mode: "forMe", conversationWith: otherId });
    return sendJson(res, 200, { ok: true });
  }

  // ---- MUSIC (Jamendo royalty-free library, task #243) ----
  // Proxies Jamendo's public catalog search so the camera can offer real,
  // properly-licensed background music instead of only the generated tones
  // from task #203. We proxy (rather than call Jamendo directly from the
  // browser) so the client_id never has to live in public JS. Every track
  // Jamendo returns here is Creative-Commons licensed for reuse; the client
  // stores name/artist/licenseUrl and shows a credit line automatically
  // (see wizardApplyJamendoTrack() in app.js) so attribution requirements
  // are met without the creator having to think about it.
  if (method === "GET" && pathname === "/api/music/search") {
    if (!JAMENDO_CLIENT_ID) return sendJson(res, 200, { configured: false, tracks: [] });
    const q = String(query.q || "").trim().slice(0, 80);
    // Task: "que se despliegue una lista de toda la musica royalty free...
    // para que la gente sepa" - the browsable #/music library page (see
    // renderMusicLibrary() in app.js) passes a genre tag here so people can
    // filter by style, not just free-text search. Jamendo's own vocabulary
    // (its /tracks endpoint takes any of these directly as tags=).
    const tag = String(query.tag || "").trim().slice(0, 40);
    const limit = Math.min(60, Math.max(1, Number(query.limit) || 24));
    const params = [
      "client_id=" + encodeURIComponent(JAMENDO_CLIENT_ID),
      "format=json",
      "limit=" + limit,
      "audioformat=mp32",
      "include=musicinfo",
      q ? "search=" + encodeURIComponent(q) : "boost=popularity_total",
    ];
    if (tag) params.push("tags=" + encodeURIComponent(tag));
    try {
      const data = await httpsRequestJson("GET", "https://api.jamendo.com/v3.0/tracks/?" + params.join("&"));
      // Some Jamendo results come back with an empty/missing `audio` stream
      // URL (licensing/CDN gaps on their end, not something we control) -
      // those looked selectable in the library but produced no sound at all
      // when played. Filtering them out here means every track the browser
      // ever sees is guaranteed to actually have a working preview URL.
      const tracks = (data.results || [])
        .filter((t) => typeof t.audio === "string" && t.audio.trim().length > 0)
        .map((t) => ({
          id: t.id,
          name: t.name,
          artist: t.artist_name,
          durationSec: t.duration,
          audioUrl: t.audio,
          image: t.image || t.album_image || null,
          licenseUrl: t.license_ccurl || null,
          genres: (t.musicinfo && t.musicinfo.tags && t.musicinfo.tags.genres) || [],
        }));
      return sendJson(res, 200, { configured: true, tracks });
    } catch (e) {
      return sendJson(res, 200, { configured: true, tracks: [] });
    }
  }

  // ---- USER PHOTOS (gallery) ----

  function photoOut(p) {
    const { user_id, created_at, ...rest } = p;
    return { ...rest, userId: user_id, createdAt: created_at };
  }

  // Task: "que se puedan ver las fotos de perfil y que se les pueda dar
  // like y comentar" - mirrors attachMomentEngagement() above, one batched
  // query per list instead of N+1 per-photo lookups.
  async function attachPhotoEngagement(photoList, meId) {
    if (!photoList || !photoList.length) return photoList;
    const idsIn = "in.(" + photoList.map((p) => enc(p.id)).join(",") + ")";
    const [likeRows, commentRows] = await Promise.all([
      db.select("mkt_photo_likes", { photo_id: idsIn, select: "photo_id,user_id" }),
      db.select("mkt_photo_comments", { photo_id: idsIn, select: "photo_id" }),
    ]);
    const likeCounts = {};
    const likedSet = new Set();
    for (const l of likeRows) {
      likeCounts[l.photo_id] = (likeCounts[l.photo_id] || 0) + 1;
      if (meId && l.user_id === meId) likedSet.add(l.photo_id);
    }
    const commentCounts = {};
    for (const c of commentRows) commentCounts[c.photo_id] = (commentCounts[c.photo_id] || 0) + 1;
    for (const p of photoList) {
      p.likesCount = likeCounts[p.id] || 0;
      p.likedByMe = likedSet.has(p.id);
      p.commentsCount = commentCounts[p.id] || 0;
    }
    return photoList;
  }

  if (method === "POST" && pathname === "/api/users/me/photos") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    if (!body.photo || typeof body.photo !== "string" || !body.photo.startsWith("data:image/")) {
      return sendJson(res, 400, { error: "A photo is required" });
    }
    let photoUrl;
    try {
      photoUrl = await sbStorageUpload("media", "photos/" + me.id + "/" + crypto.randomBytes(8).toString("hex") + ".jpg", body.photo);
    } catch (e) {
      return sendJson(res, 500, { error: "Could not upload photo" });
    }
    const photo = {
      id: crypto.randomBytes(8).toString("hex"),
      user_id: me.id,
      url: photoUrl,
      caption: String(body.caption || "").slice(0, 300),
      created_at: Date.now(),
    };
    await db.insert("mkt_user_photos", photo);
    return sendJson(res, 201, photoOut(photo));
  }

  const userPhotosMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9]+)\/photos$/);
  if (method === "GET" && userPhotosMatch) {
    const meForPhotos = await getAuthUser(req).catch(() => null);
    const photos = await db.select("mkt_user_photos", {
      user_id: "eq." + enc(userPhotosMatch[1]),
      order: "created_at.desc",
      select: "*",
    });
    const out = photos.map(photoOut);
    await attachPhotoEngagement(out, meForPhotos ? meForPhotos.id : null);
    return sendJson(res, 200, out);
  }

  const photoMatch = pathname.match(/^\/api\/photos\/([a-zA-Z0-9]+)$/);
  if (method === "DELETE" && photoMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_user_photos", { id: "eq." + enc(photoMatch[1]), select: "*" });
    const p = rows && rows[0];
    if (!p) return sendJson(res, 404, { error: "Photo not found" });
    if (p.user_id !== me.id) return sendJson(res, 403, { error: "You do not own this photo" });
    await db.remove("mkt_user_photos", { id: "eq." + enc(p.id) });
    await db.remove("mkt_photo_likes", { photo_id: "eq." + enc(p.id) });
    await db.remove("mkt_photo_comments", { photo_id: "eq." + enc(p.id) });
    return sendJson(res, 200, { ok: true });
  }

  // Like toggle on a profile gallery photo - mirrors POST/DELETE
  // /api/moments/:id/like above, separate table since photos aren't moments.
  const photoLikeMatch = pathname.match(/^\/api\/photos\/([a-zA-Z0-9]+)\/like$/);
  if (method === "POST" && photoLikeMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const existing = await db.select("mkt_photo_likes", {
      photo_id: "eq." + enc(photoLikeMatch[1]),
      user_id: "eq." + enc(me.id),
      select: "id",
    });
    if (!existing || !existing[0]) {
      await db.insert("mkt_photo_likes", {
        id: crypto.randomBytes(8).toString("hex"),
        photo_id: photoLikeMatch[1],
        user_id: me.id,
        created_at: Date.now(),
      });
    }
    return sendJson(res, 200, { ok: true });
  }
  if (method === "DELETE" && photoLikeMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    await db.remove("mkt_photo_likes", { photo_id: "eq." + enc(photoLikeMatch[1]), user_id: "eq." + enc(me.id) });
    return sendJson(res, 200, { ok: true });
  }

  // Public comments on a profile gallery photo - mirrors the moment comments
  // block above (flat list + one level of replies via parent_comment_id).
  const photoCommentsMatch = pathname.match(/^\/api\/photos\/([a-zA-Z0-9]+)\/comments$/);
  if (method === "GET" && photoCommentsMatch) {
    const rows = await db.select("mkt_photo_comments", {
      photo_id: "eq." + enc(photoCommentsMatch[1]),
      order: "created_at.asc",
      select: "*",
    });
    if (!rows.length) return sendJson(res, 200, []);
    const authorIds = [...new Set(rows.map((r) => r.user_id))];
    const authors = await db.select("mkt_users", {
      id: "in.(" + authorIds.map(enc).join(",") + ")",
      select: "id,name,photo",
    });
    const out = rows.map((r) => {
      const a = authors.find((x) => x.id === r.user_id);
      return {
        id: r.id,
        photoId: r.photo_id,
        userId: r.user_id,
        userName: a ? a.name : "Unknown",
        userPhoto: a ? a.photo : null,
        parentCommentId: r.parent_comment_id || null,
        text: r.text,
        createdAt: r.created_at,
      };
    });
    return sendJson(res, 200, out);
  }
  if (method === "POST" && photoCommentsMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const text = String(body.text || "").trim().slice(0, 500);
    if (!text) return sendJson(res, 400, { error: "Comment text is required" });
    let parentCommentId = null;
    if (body.parentCommentId) {
      const parentRows = await db.select("mkt_photo_comments", {
        id: "eq." + enc(body.parentCommentId),
        photo_id: "eq." + enc(photoCommentsMatch[1]),
        select: "id",
      });
      if (parentRows && parentRows[0]) parentCommentId = body.parentCommentId;
    }
    const comment = {
      id: crypto.randomBytes(8).toString("hex"),
      photo_id: photoCommentsMatch[1],
      user_id: me.id,
      parent_comment_id: parentCommentId,
      text,
      created_at: Date.now(),
    };
    await db.insert("mkt_photo_comments", comment);
    return sendJson(res, 201, {
      id: comment.id,
      photoId: comment.photo_id,
      userId: me.id,
      userName: me.name,
      userPhoto: me.photo || null,
      parentCommentId: comment.parent_comment_id,
      text: comment.text,
      createdAt: comment.created_at,
    });
  }

  const photoCommentDeleteMatch = pathname.match(/^\/api\/photos\/([a-zA-Z0-9]+)\/comments\/([a-zA-Z0-9]+)$/);
  if (method === "DELETE" && photoCommentDeleteMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_photo_comments", { id: "eq." + enc(photoCommentDeleteMatch[2]), select: "user_id" });
    const c = rows && rows[0];
    if (!c) return sendJson(res, 404, { error: "Comment not found" });
    if (c.user_id !== me.id) return sendJson(res, 403, { error: "You do not own this comment" });
    await db.remove("mkt_photo_comments", { id: "eq." + enc(photoCommentDeleteMatch[2]) });
    return sendJson(res, 200, { ok: true });
  }

  // Lightweight engagement lookup for a single photo id. Unlike
  // attachPhotoEngagement() above (batched for a list of real mkt_user_photos
  // rows), this works for ANY id string - including synthetic ones like
  // "profile-<userId>" or "cover-<userId>" that the frontend uses to let
  // people like/comment on someone's profile picture without that picture
  // needing its own row in mkt_user_photos. mkt_photo_likes/mkt_photo_comments
  // never enforce a foreign key back to mkt_user_photos (see the other photo
  // routes above), so this is safe with zero schema changes.
  const photoEngagementMatch = pathname.match(/^\/api\/photos\/([a-zA-Z0-9-]+)\/engagement$/);
  if (method === "GET" && photoEngagementMatch) {
    const meForEngagement = await getAuthUser(req).catch(() => null);
    const id = photoEngagementMatch[1];
    const [likeRows, commentRows] = await Promise.all([
      db.select("mkt_photo_likes", { photo_id: "eq." + enc(id), select: "user_id" }),
      db.select("mkt_photo_comments", { photo_id: "eq." + enc(id), select: "id" }),
    ]);
    return sendJson(res, 200, {
      likesCount: likeRows.length,
      likedByMe: !!(meForEngagement && likeRows.some((l) => l.user_id === meForEngagement.id)),
      commentsCount: commentRows.length,
    });
  }

  // ---- FRIENDS ----

  function friendshipOut(f) {
    const { requester_id, addressee_id, created_at, responded_at, ...rest } = f;
    return { ...rest, requesterId: requester_id, addresseeId: addressee_id, createdAt: created_at, respondedAt: responded_at };
  }

  if (method === "POST" && pathname === "/api/friends/request") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const targetId = String(body.userId || "").trim();
    if (!targetId || targetId === me.id) return sendJson(res, 400, { error: "Invalid user" });
    const targets = await db.select("mkt_users", { id: "eq." + enc(targetId), select: "id" });
    if (!targets || !targets[0]) return sendJson(res, 404, { error: "User not found" });

    const existing = await db.select("mkt_friendships", {
      or:
        "(and(requester_id.eq." + enc(me.id) + ",addressee_id.eq." + enc(targetId) + "),and(requester_id.eq." + enc(targetId) + ",addressee_id.eq." + enc(me.id) + "))",
      select: "*",
    });
    const existingRow = existing && existing[0];
    if (existingRow) {
      if (existingRow.status === "accepted") return sendJson(res, 409, { error: "You are already friends" });
      if (existingRow.requester_id === targetId) {
        const updated = await db.update("mkt_friendships", { id: "eq." + enc(existingRow.id) }, { status: "accepted", responded_at: Date.now() });
        return sendJson(res, 200, friendshipOut(updated[0]));
      }
      return sendJson(res, 409, { error: "Friend request already sent" });
    }

    const friendship = {
      id: crypto.randomBytes(8).toString("hex"),
      requester_id: me.id,
      addressee_id: targetId,
      status: "pending",
      created_at: Date.now(),
      responded_at: null,
    };
    await db.insert("mkt_friendships", friendship);
    return sendJson(res, 201, friendshipOut(friendship));
  }

  const friendAcceptMatch = pathname.match(/^\/api\/friends\/([a-zA-Z0-9]+)\/accept$/);
  if (method === "POST" && friendAcceptMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_friendships", { id: "eq." + enc(friendAcceptMatch[1]), select: "*" });
    const f = rows && rows[0];
    if (!f) return sendJson(res, 404, { error: "Request not found" });
    if (f.addressee_id !== me.id) return sendJson(res, 403, { error: "Not authorized" });
    const updated = await db.update("mkt_friendships", { id: "eq." + enc(f.id) }, { status: "accepted", responded_at: Date.now() });
    return sendJson(res, 200, friendshipOut(updated[0]));
  }

  const friendRejectMatch = pathname.match(/^\/api\/friends\/([a-zA-Z0-9]+)\/reject$/);
  if (method === "POST" && friendRejectMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_friendships", { id: "eq." + enc(friendRejectMatch[1]), select: "*" });
    const f = rows && rows[0];
    if (!f) return sendJson(res, 404, { error: "Request not found" });
    if (f.addressee_id !== me.id && f.requester_id !== me.id) return sendJson(res, 403, { error: "Not authorized" });
    await db.remove("mkt_friendships", { id: "eq." + enc(f.id) });
    return sendJson(res, 200, { ok: true });
  }

  const friendRemoveMatch = pathname.match(/^\/api\/friends\/user\/([a-zA-Z0-9]+)$/);
  if (method === "DELETE" && friendRemoveMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const targetId = friendRemoveMatch[1];
    const rows = await db.select("mkt_friendships", {
      status: "eq.accepted",
      or:
        "(and(requester_id.eq." + enc(me.id) + ",addressee_id.eq." + enc(targetId) + "),and(requester_id.eq." + enc(targetId) + ",addressee_id.eq." + enc(me.id) + "))",
      select: "id",
    });
    if (rows && rows[0]) await db.remove("mkt_friendships", { id: "eq." + enc(rows[0].id) });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/friends") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_friendships", {
      status: "eq.accepted",
      or: "(requester_id.eq." + enc(me.id) + ",addressee_id.eq." + enc(me.id) + ")",
      select: "*",
    });
    const friendIds = rows.map((f) => (f.requester_id === me.id ? f.addressee_id : f.requester_id));
    let users = [];
    if (friendIds.length) {
      users = await db.select("mkt_users", { id: "in.(" + friendIds.map(enc).join(",") + ")", select: "id,name,photo" });
    }
    const out = rows.map((f) => {
      const friendId = f.requester_id === me.id ? f.addressee_id : f.requester_id;
      const u = users.find((x) => x.id === friendId);
      return { friendshipId: f.id, userId: friendId, name: u ? u.name : "Unknown", photo: u ? u.photo : null };
    });
    return sendJson(res, 200, out);
  }

  if (method === "GET" && pathname === "/api/friends/requests") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_friendships", {
      status: "eq.pending",
      addressee_id: "eq." + enc(me.id),
      select: "*",
      order: "created_at.desc",
    });
    const requesterIds = rows.map((f) => f.requester_id);
    let users = [];
    if (requesterIds.length) {
      users = await db.select("mkt_users", { id: "in.(" + requesterIds.map(enc).join(",") + ")", select: "id,name,photo" });
    }
    const out = rows.map((f) => {
      const u = users.find((x) => x.id === f.requester_id);
      return { friendshipId: f.id, userId: f.requester_id, name: u ? u.name : "Unknown", photo: u ? u.photo : null, createdAt: f.created_at };
    });
    return sendJson(res, 200, out);
  }

  const friendStatusMatch = pathname.match(/^\/api\/friends\/status\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && friendStatusMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const targetId = friendStatusMatch[1];
    if (targetId === me.id) return sendJson(res, 200, { status: "self" });
    const rows = await db.select("mkt_friendships", {
      or:
        "(and(requester_id.eq." + enc(me.id) + ",addressee_id.eq." + enc(targetId) + "),and(requester_id.eq." + enc(targetId) + ",addressee_id.eq." + enc(me.id) + "))",
      select: "*",
    });
    const f = rows && rows[0];
    if (!f) return sendJson(res, 200, { status: "none" });
    if (f.status === "accepted") return sendJson(res, 200, { status: "friends", friendshipId: f.id });
    if (f.requester_id === me.id) return sendJson(res, 200, { status: "pending_sent", friendshipId: f.id });
    return sendJson(res, 200, { status: "pending_received", friendshipId: f.id });
  }

  // ---- BLOCKED USERS ----
  // Blocking is one-directional to record (blocker -> blocked) but its effect
  // is mutual: once blocked, neither side can message the other, and the
  // blocker no longer sees the blocked user's products/moments/profile in
  // their own feeds (best-effort filtering, not exhaustive).

  const blockUserMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9]+)\/block$/);
  if (method === "POST" && blockUserMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const targetId = blockUserMatch[1];
    if (!targetId || targetId === me.id) return sendJson(res, 400, { error: "Invalid user" });
    const targets = await db.select("mkt_users", { id: "eq." + enc(targetId), select: "id" });
    if (!targets || !targets[0]) return sendJson(res, 404, { error: "User not found" });

    const existing = await db.select("mkt_user_blocks", {
      blocker_id: "eq." + enc(me.id),
      blocked_id: "eq." + enc(targetId),
      select: "id",
    });
    if (existing && existing[0]) return sendJson(res, 200, { ok: true, alreadyBlocked: true });

    await db.insert("mkt_user_blocks", {
      id: crypto.randomBytes(8).toString("hex"),
      blocker_id: me.id,
      blocked_id: targetId,
      created_at: Date.now(),
    });
    // Blocking implicitly ends any friendship between the two users.
    const friendRows = await db.select("mkt_friendships", {
      status: "eq.accepted",
      or:
        "(and(requester_id.eq." + enc(me.id) + ",addressee_id.eq." + enc(targetId) + "),and(requester_id.eq." + enc(targetId) + ",addressee_id.eq." + enc(me.id) + "))",
      select: "id",
    });
    if (friendRows && friendRows[0]) await db.remove("mkt_friendships", { id: "eq." + enc(friendRows[0].id) });
    return sendJson(res, 200, { ok: true });
  }

  const unblockUserMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9]+)\/unblock$/);
  if (method === "POST" && unblockUserMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const targetId = unblockUserMatch[1];
    await db.remove("mkt_user_blocks", { blocker_id: "eq." + enc(me.id), blocked_id: "eq." + enc(targetId) });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/users/blocked") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_user_blocks", { blocker_id: "eq." + enc(me.id), select: "*", order: "created_at.desc" });
    const blockedIds = rows.map((r) => r.blocked_id);
    let users = [];
    if (blockedIds.length) {
      users = await db.select("mkt_users", { id: "in.(" + blockedIds.map(enc).join(",") + ")", select: "id,name,photo" });
    }
    const out = rows.map((r) => {
      const u = users.find((x) => x.id === r.blocked_id);
      return { userId: r.blocked_id, name: u ? u.name : "Deleted user", photo: u ? u.photo : null, blockedAt: r.created_at };
    });
    return sendJson(res, 200, out);
  }

  const blockStatusMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9]+)\/block-status$/);
  if (method === "GET" && blockStatusMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const targetId = blockStatusMatch[1];
    const rows = await db.select("mkt_user_blocks", {
      blocker_id: "eq." + enc(me.id),
      blocked_id: "eq." + enc(targetId),
      select: "id",
    });
    return sendJson(res, 200, { blocked: !!(rows && rows[0]) });
  }

  // GET /api/users/:id/presence -> { online: boolean, lastSeenAt: number|null }
  // Part of task #233 (chat). "online" is true if the user has at least one
  // open WebSocket right now (see isUserOnline/wsConnections in the
  // realtime chat section above), OR their last_seen_at was within the
  // last 60 seconds - that window absorbs brief reconnects/tab-switches/
  // network blips without the badge visibly flapping offline/online, while
  // still going stale quickly if they've actually left. lastSeenAt is
  // always returned (even while online) so the client can show "Active
  // Xm ago" once online flips false, Instagram/Messenger-style.
  const presenceMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9]+)\/presence$/);
  if (method === "GET" && presenceMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const targetId = presenceMatch[1];
    const users = await db.select("mkt_users", { id: "eq." + enc(targetId), select: "id,last_seen_at" });
    if (!users || !users[0]) return sendJson(res, 404, { error: "User not found" });
    const lastSeenAt = users[0].last_seen_at || null;
    const PRESENCE_WINDOW_MS = 60000;
    const online = isUserOnline(targetId) || !!(lastSeenAt && Date.now() - lastSeenAt < PRESENCE_WINDOW_MS);
    return sendJson(res, 200, { online, lastSeenAt });
  }

  // ---- FOLLOW (one-directional, only for "Public Page" accounts - separate from friends) ----

  // Subscribing to a Page sends a request that stays "pending" until the
  // owner accepts it, unless the owner has switched their subscription_mode
  // to "auto" (settable from their own profile), in which case it's accepted
  // immediately - same instant behavior the old plain "Follow" used to have.
  const followMatch = pathname.match(/^\/api\/follow\/([a-zA-Z0-9]+)$/);
  if (method === "POST" && followMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const targetId = followMatch[1];
    if (targetId === me.id) return sendJson(res, 400, { error: "You cannot follow yourself" });
    const targets = await db.select("mkt_users", { id: "eq." + enc(targetId), select: "id,name,is_page,subscription_mode" });
    const target = targets && targets[0];
    if (!target) return sendJson(res, 404, { error: "User not found" });
    if (!target.is_page) return sendJson(res, 400, { error: "Only public pages can be followed" });
    const existing = await db.select("mkt_follows", {
      follower_id: "eq." + enc(me.id),
      followed_id: "eq." + enc(targetId),
      select: "id,status",
    });
    if (existing && existing[0]) {
      return sendJson(res, 200, { ok: true, status: existing[0].status === "accepted" ? "accepted" : "pending" });
    }
    const auto = target.subscription_mode === "auto";
    await db.insert("mkt_follows", {
      id: crypto.randomBytes(8).toString("hex"),
      follower_id: me.id,
      followed_id: targetId,
      status: auto ? "accepted" : "pending",
      created_at: Date.now(),
    });
    if (auto) {
      notifyUser(targetId, "follows", { title: "Nuevo suscriptor", body: (me.name || "Alguien") + " se suscribió a tu página.", url: "/#/profile/" + me.id }).catch(() => {});
    } else {
      notifyUser(targetId, "follows", { title: "Solicitud de suscripción", body: (me.name || "Alguien") + " quiere suscribirse a tu página.", url: "/#/profile" }).catch(() => {});
    }
    return sendJson(res, 201, { ok: true, status: auto ? "accepted" : "pending" });
  }

  if (method === "DELETE" && followMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    await db.remove("mkt_follows", { follower_id: "eq." + enc(me.id), followed_id: "eq." + enc(followMatch[1]) });
    return sendJson(res, 200, { ok: true, status: "none" });
  }

  const followStatusMatch = pathname.match(/^\/api\/follow\/status\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && followStatusMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const targetId = followStatusMatch[1];
    const rows = await db.select("mkt_follows", {
      follower_id: "eq." + enc(me.id),
      followed_id: "eq." + enc(targetId),
      select: "id,status",
    });
    const row = rows && rows[0];
    const status = row ? (row.status === "accepted" ? "accepted" : "pending") : "none";
    const followerCount = await db.select("mkt_follows", { followed_id: "eq." + enc(targetId), status: "eq.accepted", select: "id" });
    return sendJson(res, 200, { following: status === "accepted", pending: status === "pending", status, followerCount: (followerCount || []).length });
  }

  // Pending subscription requests waiting on the current user's decision
  // (only relevant if they own a Page and haven't switched to auto-accept).
  if (method === "GET" && pathname === "/api/follow/requests") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_follows", { followed_id: "eq." + enc(me.id), status: "eq.pending", select: "*", order: "created_at.desc" });
    if (!rows.length) return sendJson(res, 200, []);
    const requesterIds = [...new Set(rows.map((r) => r.follower_id))];
    const requesters = await db.select("mkt_users", { id: "in.(" + requesterIds.map(enc).join(",") + ")", select: "id,name,photo" });
    return sendJson(
      res,
      200,
      rows.map((r) => {
        const u = requesters.find((x) => x.id === r.follower_id);
        return { id: r.id, userId: r.follower_id, name: u ? u.name : "Unknown", photo: u ? u.photo : null };
      })
    );
  }

  const followReqAcceptMatch = pathname.match(/^\/api\/follow\/requests\/([a-zA-Z0-9]+)\/accept$/);
  if (method === "POST" && followReqAcceptMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_follows", { id: "eq." + enc(followReqAcceptMatch[1]), select: "*" });
    const row = rows && rows[0];
    if (!row || row.followed_id !== me.id) return sendJson(res, 404, { error: "Request not found" });
    await db.update("mkt_follows", { id: "eq." + enc(row.id) }, { status: "accepted" });
    notifyUser(row.follower_id, "follows", { title: "Suscripción aceptada", body: (me.name || "La página") + " aceptó tu suscripción.", url: "/#/profile/" + me.id }).catch(() => {});
    return sendJson(res, 200, { ok: true });
  }

  const followReqRejectMatch = pathname.match(/^\/api\/follow\/requests\/([a-zA-Z0-9]+)\/reject$/);
  if (method === "POST" && followReqRejectMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_follows", { id: "eq." + enc(followReqRejectMatch[1]), select: "*" });
    const row = rows && rows[0];
    if (!row || row.followed_id !== me.id) return sendJson(res, 404, { error: "Request not found" });
    await db.remove("mkt_follows", { id: "eq." + enc(row.id) });
    return sendJson(res, 200, { ok: true });
  }

  // Simple name search used by the Friends page's "Search friends/products" bar.
  if (method === "GET" && pathname === "/api/users/search") {
    const me = await getAuthUser(req);
    const q = (query.q || "").trim();
    if (!q) return sendJson(res, 200, []);
    const rows = await db.select("mkt_users", { name: "ilike.*" + enc(q) + "*", select: "id,name,photo", limit: "20" });
    const results = rows.filter((u) => !me || u.id !== me.id);

    // Attach each result's friendship status (none/pending_sent/pending_received/friends)
    // so the client can render the same Add-Friend / Request-Sent / Accept-Decline /
    // Friends button used everywhere else, straight from the search results.
    let friendshipByUser = {};
    if (me && results.length) {
      const friendRows = await db.select("mkt_friendships", {
        or: "(requester_id.eq." + enc(me.id) + ",addressee_id.eq." + enc(me.id) + ")",
        select: "*",
      });
      for (const f of friendRows) {
        const otherId = f.requester_id === me.id ? f.addressee_id : f.requester_id;
        if (f.status === "accepted") {
          friendshipByUser[otherId] = { status: "friends", friendshipId: f.id };
        } else {
          friendshipByUser[otherId] = { status: f.requester_id === me.id ? "pending_sent" : "pending_received", friendshipId: f.id };
        }
      }
    }
    return sendJson(
      res,
      200,
      results.map((u) => ({
        userId: u.id,
        name: u.name,
        photo: u.photo,
        friendStatus: friendshipByUser[u.id] || { status: "none" },
      }))
    );
  }

  if (method === "GET" && pathname === "/api/pages/suggested") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const following = await db.select("mkt_follows", { follower_id: "eq." + enc(me.id), select: "followed_id" });
    const followingIds = following.map((f) => f.followed_id);
    const params = { is_page: "eq.true", select: "id,name,photo,page_category", order: "created_at.desc", limit: "20" };
    const pages = await db.select("mkt_users", params);
    const candidates = pages.filter((p) => p.id !== me.id && !followingIds.includes(p.id));
    return sendJson(res, 200, candidates.map((p) => ({ userId: p.id, name: p.name, photo: p.photo, pageCategory: p.page_category || "" })));
  }

  // ---- GROUPS / COMMUNITIES (category/city groups, Reddit-style posts + votes) ----
  // v1 is deliberately open: no join/membership step, anyone can post or vote
  // in any group. This is the trust-layer differentiator a plain marketplace
  // (like Facebook Marketplace) lacks - questions, seller reviews, and scam
  // warnings ranked by community vote instead of a corporate algorithm.

  function slugify(s) {
    return (
      String(s || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 60) || "group"
    );
  }

  // Task #240/#242 - Book Club is a specialized flavor of the existing
  // Communities groups system (not a parallel table): is_book_club just
  // marks a group so the frontend can route it into the Book Club UI, and
  // video_room_name/book_title/book_product_id/author_pick_* are nullable
  // extras only book-club groups use. Regular Communities groups are
  // unaffected (is_book_club defaults false).
  function groupOut(g) {
    const { created_by, created_at, is_book_club, video_room_name, book_title, book_product_id, author_pick_status, author_pick_agreed_at, ...rest } = g;
    return {
      ...rest,
      createdBy: created_by,
      createdAt: created_at,
      isBookClub: !!is_book_club,
      videoRoomName: video_room_name || null,
      bookTitle: book_title || null,
      bookProductId: book_product_id || null,
      authorPickStatus: author_pick_status || "not_available",
      authorPickAgreedAt: author_pick_agreed_at || null,
    };
  }

  // Task #242 - flip this to true (and wire up a real terms-of-participation
  // agreement) once Carlos has finalized the legal side of the "Pick of the
  // Month" author-rights program. Until then the UI for it stays visible
  // (so the space is ready) but shows a "coming soon" locked state instead
  // of a working submit action - see GET /api/book-club/config below.
  const AUTHOR_PICK_PROGRAM_ENABLED = false;

  function groupPostOut(p) {
    const { group_id, author_id, post_type, created_at, ...rest } = p;
    return { ...rest, groupId: group_id, authorId: author_id, postType: post_type, createdAt: created_at };
  }

  const GROUP_POST_TYPES = ["discussion", "question", "review", "warning"];

  if (method === "POST" && pathname === "/api/groups") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    if (!body.name || !String(body.name).trim()) return sendJson(res, 400, { error: "Group name is required" });
    let slug = slugify(body.name);
    const existing = await db.select("mkt_groups", { slug: "eq." + enc(slug), select: "id" });
    if (existing && existing[0]) slug = slug + "-" + crypto.randomBytes(3).toString("hex");
    const isBookClub = body.isBookClub === true || body.isBookClub === "true";
    const group = {
      id: crypto.randomBytes(8).toString("hex"),
      slug,
      name: String(body.name).trim().slice(0, 100),
      category: body.category && CATEGORIES.includes(body.category) ? body.category : null,
      city: String(body.city || "").trim().slice(0, 80) || null,
      description: String(body.description || "").slice(0, 1000),
      created_by: me.id,
      created_at: Date.now(),
      is_book_club: isBookClub,
      // Task #240 - book title is the whole point of a book-club group (what
      // you're discussing); bookProductId optionally links it to one of the
      // seller's own mkt_products listings so readers can jump straight to
      // buying the copy being discussed. Both are ignored for a plain
      // Communities group (isBookClub false).
      book_title: isBookClub ? String(body.bookTitle || "").trim().slice(0, 200) || null : null,
      book_product_id: isBookClub && body.bookProductId ? String(body.bookProductId) : null,
    };
    await db.insert("mkt_groups", group);
    return sendJson(res, 201, groupOut(group));
  }

  if (method === "GET" && pathname === "/api/groups") {
    const { category, city, q, bookClub } = query;
    const params = { select: "*", order: "created_at.desc" };
    if (category) params.category = "eq." + enc(category);
    if (city) params.city = "ilike.*" + enc(city) + "*";
    if (q) params.name = "ilike.*" + enc(q) + "*";
    // Task #240 - Book Club and Communities are the same underlying table,
    // split purely by this flag so the two sections never bleed into each
    // other's listings.
    if (bookClub === "true") params.is_book_club = "eq.true";
    else if (bookClub === "false") params.is_book_club = "eq.false";
    const groups = await db.select("mkt_groups", params);
    return sendJson(res, 200, groups.map(groupOut));
  }

  // GET /api/book-club/config - lets the frontend know whether the "Pick of
  // the Month" author-rights program (task #242) is live yet. See
  // AUTHOR_PICK_PROGRAM_ENABLED above for how this gets turned on.
  if (method === "GET" && pathname === "/api/book-club/config") {
    return sendJson(res, 200, { authorPickEnabled: AUTHOR_PICK_PROGRAM_ENABLED });
  }

  // POST /api/groups/:slug/video-room - lazily creates (once) and returns a
  // Jitsi Meet room name for this group's video call. Jitsi's public
  // meet.jit.si server needs no API key/account and is free to embed, so
  // this works today without waiting on Carlos to set up a paid provider
  // (Daily.co/Twilio/Agora) - see PROJECT.md for the trade-off if a more
  // branded/controlled experience is wanted later. The room name is
  // randomized once and reused by everyone in the group, not regenerated
  // per-call, so members always land in the same room.
  const groupVideoRoomMatch = pathname.match(/^\/api\/groups\/([a-zA-Z0-9-]+)\/video-room$/);
  if (method === "POST" && groupVideoRoomMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_groups", { slug: "eq." + enc(groupVideoRoomMatch[1]), select: "*" });
    const g = rows && rows[0];
    if (!g) return sendJson(res, 404, { error: "Group not found" });
    let roomName = g.video_room_name;
    if (!roomName) {
      roomName = "hieloice-" + g.slug + "-" + crypto.randomBytes(4).toString("hex");
      await db.update("mkt_groups", { id: "eq." + enc(g.id) }, { video_room_name: roomName });
    }
    return sendJson(res, 200, { videoRoomName: roomName });
  }

  // POST /api/groups/:slug/author-pick - task #242. The full submission
  // screen is real and navigable on the frontend (per Carlos's request:
  // "visual y navegable pero sin poder accionar" - let people click through
  // and get familiar with it) but this endpoint always answers with a
  // friendly "not live yet" response while AUTHOR_PICK_PROGRAM_ENABLED is
  // false, and never writes anything to the database - nobody can
  // accidentally create a real submission before the legal terms exist.
  // Flip the flag above once that's ready; the rest of this handler already
  // does the real write.
  const authorPickMatch = pathname.match(/^\/api\/groups\/([a-zA-Z0-9-]+)\/author-pick$/);
  if (method === "POST" && authorPickMatch) {
    if (!AUTHOR_PICK_PROGRAM_ENABLED) {
      return sendJson(res, 200, { ok: false, comingSoon: true });
    }
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_groups", { slug: "eq." + enc(authorPickMatch[1]), select: "*" });
    const g = rows && rows[0];
    if (!g) return sendJson(res, 404, { error: "Group not found" });
    await db.update("mkt_groups", { id: "eq." + enc(g.id) }, { author_pick_status: "submitted", author_pick_agreed_at: Date.now() });
    return sendJson(res, 200, { ok: true });
  }

  const groupMatch = pathname.match(/^\/api\/groups\/([a-zA-Z0-9-]+)$/);
  if (method === "GET" && groupMatch) {
    const rows = await db.select("mkt_groups", { slug: "eq." + enc(groupMatch[1]), select: "*" });
    const g = rows && rows[0];
    if (!g) return sendJson(res, 404, { error: "Group not found" });
    return sendJson(res, 200, groupOut(g));
  }

  const groupPostsMatch = pathname.match(/^\/api\/groups\/([a-zA-Z0-9-]+)\/posts$/);
  if (method === "GET" && groupPostsMatch) {
    const groups = await db.select("mkt_groups", { slug: "eq." + enc(groupPostsMatch[1]), select: "id" });
    const g = groups && groups[0];
    if (!g) return sendJson(res, 404, { error: "Group not found" });
    const sort = query.sort === "new" ? "created_at.desc" : "score.desc,created_at.desc";
    const posts = await db.select("mkt_group_posts", { group_id: "eq." + enc(g.id), select: "*", order: sort });
    const authorIds = [...new Set(posts.map((p) => p.author_id))];
    let authors = [];
    if (authorIds.length) {
      authors = await db.select("mkt_users", { id: "in.(" + authorIds.map(enc).join(",") + ")", select: "id,name,photo" });
    }
    let myVotes = {};
    const me = await getAuthUser(req);
    if (me && posts.length) {
      const votes = await db.select("mkt_group_post_votes", {
        user_id: "eq." + enc(me.id),
        post_id: "in.(" + posts.map((p) => enc(p.id)).join(",") + ")",
        select: "post_id,value",
      });
      for (const v of votes) myVotes[v.post_id] = v.value;
    }
    const out = posts.map((p) => {
      const author = authors.find((u) => u.id === p.author_id);
      return {
        ...groupPostOut(p),
        authorName: author ? author.name : "Unknown",
        authorPhoto: author ? author.photo : null,
        myVote: myVotes[p.id] || 0,
      };
    });
    return sendJson(res, 200, out);
  }

  if (method === "POST" && groupPostsMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const groups = await db.select("mkt_groups", { slug: "eq." + enc(groupPostsMatch[1]), select: "id" });
    const g = groups && groups[0];
    if (!g) return sendJson(res, 404, { error: "Group not found" });
    const ip = getClientIp(req);
    if (!checkRateLimit("grouppost:" + ip, 20, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: "Too many posts. Please try again later." });
    }
    const body = await readBody(req);
    if (!body.title || !String(body.title).trim()) return sendJson(res, 400, { error: "Title is required" });
    const postType = GROUP_POST_TYPES.includes(body.postType) ? body.postType : "discussion";
    const post = {
      id: crypto.randomBytes(8).toString("hex"),
      group_id: g.id,
      author_id: me.id,
      title: String(body.title).trim().slice(0, 200),
      body: String(body.body || "").slice(0, 5000),
      post_type: postType,
      score: 0,
      created_at: Date.now(),
    };
    await db.insert("mkt_group_posts", post);
    return sendJson(res, 201, { ...groupPostOut(post), authorName: me.name, authorPhoto: me.photo, myVote: 0 });
  }

  // POST /api/posts/:id/vote  body: { value: 1 | -1 }  - upsert the caller's
  // vote and recompute the post's denormalized score (PostgREST has no
  // simple GROUP BY via REST, so we keep a running total instead of
  // aggregating on every read). Voting the same way again toggles the vote off.
  const postVoteMatch = pathname.match(/^\/api\/posts\/([a-zA-Z0-9]+)\/vote$/);
  if (method === "POST" && postVoteMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const posts = await db.select("mkt_group_posts", { id: "eq." + enc(postVoteMatch[1]), select: "*" });
    const post = posts && posts[0];
    if (!post) return sendJson(res, 404, { error: "Post not found" });
    const body = await readBody(req);
    const value = Number(body.value);
    if (![1, -1].includes(value)) return sendJson(res, 400, { error: "Vote value must be 1 or -1" });

    const existing = await db.select("mkt_group_post_votes", {
      post_id: "eq." + enc(post.id),
      user_id: "eq." + enc(me.id),
      select: "*",
    });
    const prev = existing && existing[0];
    let delta;
    if (prev && prev.value === value) {
      await db.remove("mkt_group_post_votes", { id: "eq." + enc(prev.id) });
      delta = -value;
    } else if (prev) {
      await db.update("mkt_group_post_votes", { id: "eq." + enc(prev.id) }, { value });
      delta = value - prev.value;
    } else {
      await db.insert("mkt_group_post_votes", {
        id: crypto.randomBytes(8).toString("hex"),
        post_id: post.id,
        user_id: me.id,
        value,
        created_at: Date.now(),
      });
      delta = value;
    }
    const newScore = post.score + delta;
    await db.update("mkt_group_posts", { id: "eq." + enc(post.id) }, { score: newScore });
    const myVote = prev && prev.value === value ? 0 : value;
    return sendJson(res, 200, { score: newScore, myVote });
  }

  const postDeleteMatch = pathname.match(/^\/api\/posts\/([a-zA-Z0-9]+)$/);
  if (method === "DELETE" && postDeleteMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const posts = await db.select("mkt_group_posts", { id: "eq." + enc(postDeleteMatch[1]), select: "*" });
    const post = posts && posts[0];
    if (!post) return sendJson(res, 404, { error: "Post not found" });
    if (post.author_id !== me.id) return sendJson(res, 403, { error: "You do not own this post" });
    await db.remove("mkt_group_posts", { id: "eq." + enc(post.id) });
    return sendJson(res, 200, { ok: true });
  }

  // ---- MOMENTS (photo/video posts, permanent - see cleanup note below) ----
  // Moments used to be ephemeral 24h stories. As of the "make Moments
  // permanent" product decision they no longer expire or get deleted by age -
  // they accumulate likes/saves/comments/views indefinitely, like a normal
  // feed post. `expires_at` is still written at creation time (see POST
  // /api/moments below) and still returned as `expiresAt` for now, but it is
  // no longer read anywhere to filter/hide/delete moments. It's kept around
  // unused rather than dropped because the separate, still-unbuilt "Loops"
  // feature (24h stories, Instagram/FB-Stories-style) will want an equivalent
  // column soon, and re-adding a dropped column is wasted churn.

  function momentOut(m) {
    const { user_id, media_url, media_type, created_at, expires_at, repost_of, trim_start_sec, trim_end_sec, title, linked_product_id, is_long_video, overlay_json, ...rest } = m;
    return {
      ...rest,
      userId: user_id,
      mediaUrl: media_url,
      mediaType: media_type,
      createdAt: created_at,
      expiresAt: expires_at,
      repostOf: repost_of || null,
      // AI auto-clip trim window (task #160) - both null means "play the
      // whole thing". See wireMomentTrimLoop() in app.js for the client-side
      // bounded-loop playback that enforces this.
      trimStartSec: trim_start_sec != null ? Number(trim_start_sec) : null,
      trimEndSec: trim_end_sec != null ? Number(trim_end_sec) : null,
      // Long-form "Videos" hub (task #231) - title is only ever set for
      // long videos (short-form Moments don't have one); linkedProductId is
      // an optional, unenforced cross-reference to one of the poster's own
      // mkt_products rows (same "plain text id, no FK constraint" style as
      // repost_of above) so a video can double as a review/demo on a
      // listing's page without requiring one.
      title: title || null,
      linkedProductId: linked_product_id || null,
      isLongVideo: !!is_long_video,
      // Text/sticker overlay metadata (task #204) - only ever set for VIDEO
      // captures (photo overlays are baked directly into the JPEG pixels
      // client-side before upload, so they never need this). Rendered as an
      // absolutely-positioned HTML layer on top of the <video> wherever one
      // plays - see renderMediaOverlayLayer() in app.js.
      overlays: Array.isArray(overlay_json) ? overlay_json : [],
    };
  }

  // Task #204 - server-side allowlist/clamp for overlay metadata coming from
  // the create wizard, applied before it's ever written to mkt_moments.
  // Caps the list length and each field's size/range so a malicious client
  // can't stuff arbitrarily large or malformed data into overlay_json.
  function sanitizeOverlayList(raw) {
    if (!Array.isArray(raw) || !raw.length) return null;
    const out = raw
      .slice(0, 20)
      .map((ov) => {
        if (!ov || typeof ov !== "object") return null;
        // Task: Moment editor voice-over (a mic-only clip attached alongside
        // the video, played back in sync client-side - see
        // wireMomentVoiceoverSync() in app.js) and tagged products (shown as
        // tappable pills, not baked into the video). Both ride in this same
        // flexible overlays array rather than needing their own DB columns,
        // but need their own validation - the generic text/sticker branch
        // below would truncate a voice-over's data URL to 60 characters and
        // render the garbled remainder as visible on-screen text.
        if (ov.type === "voiceover") {
          const value = String(ov.value || "");
          if (!value.startsWith("data:audio/")) return null;
          // ~8MB of base64 is a generous cap for a short voice note, not a
          // way to smuggle large arbitrary payloads through this field.
          if (value.length > 8 * 1024 * 1024) return null;
          return { type: "voiceover", value };
        }
        if (ov.type === "product") {
          const productId = String(ov.productId || "").slice(0, 64);
          if (!productId) return null;
          return { type: "product", productId, value: String(ov.value || "").slice(0, 120) };
        }
        const value = String(ov.value || "").slice(0, 60);
        if (!value) return null;
        const type = ov.type === "sticker" ? "sticker" : "text";
        const size = ov.size === "sm" || ov.size === "lg" ? ov.size : "md";
        const xPct = Number(ov.xPct);
        const yPct = Number(ov.yPct);
        const entry = {
          type,
          value,
          size,
          xPct: Number.isFinite(xPct) ? Math.max(0, Math.min(100, xPct)) : 50,
          yPct: Number.isFinite(yPct) ? Math.max(0, Math.min(100, yPct)) : 50,
        };
        if (type === "text") entry.color = typeof ov.color === "string" ? ov.color.slice(0, 20) : "#FFD84D";
        if (ov.caption) {
          entry.caption = true;
          entry.captionStyle = typeof ov.captionStyle === "string" ? ov.captionStyle.slice(0, 20) : "classic";
        }
        return entry;
      })
      .filter(Boolean);
    return out.length ? out : null;
  }

  // Decorates a list of already-momentOut()'d moments in place with
  // likeCount/liked/saved, sharing one batched query per list instead of
  // N+1 per-moment lookups. `liked`/`saved` are false/omitted-meaningful
  // when meId is null (guest viewer).
  async function attachMomentEngagement(momentList, meId) {
    if (!momentList || !momentList.length) return momentList;
    const idsIn = "in.(" + momentList.map((m) => enc(m.id)).join(",") + ")";
    const [likeRows, saveRows] = await Promise.all([
      db.select("mkt_moment_likes", { moment_id: idsIn, select: "moment_id,user_id" }),
      meId ? db.select("mkt_moment_saves", { moment_id: idsIn, user_id: "eq." + enc(meId), select: "moment_id" }) : Promise.resolve([]),
    ]);
    const likeCounts = {};
    const likedSet = new Set();
    for (const l of likeRows) {
      likeCounts[l.moment_id] = (likeCounts[l.moment_id] || 0) + 1;
      if (meId && l.user_id === meId) likedSet.add(l.moment_id);
    }
    const savedSet = new Set(saveRows.map((s) => s.moment_id));
    for (const m of momentList) {
      m.likeCount = likeCounts[m.id] || 0;
      m.liked = likedSet.has(m.id);
      m.saved = savedSet.has(m.id);
    }
    return momentList;
  }

  if (method === "POST" && pathname === "/api/moments") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const ip = getClientIp(req);
    if (!checkRateLimit("moment:" + ip, 20, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: "Too many moments posted. Please try again later." });
    }
    // No cap on total moments per user anymore - Moments are permanent posts
    // now (see the "Moments" section comment above), so bounding a user to a
    // handful of "active" ones no longer makes sense. The per-IP rate limit
    // above still guards against spam/abuse.
    const body = await readBody(req);
    // Long-form "Videos" hub (task #231) - the create wizard signals a
    // long-form upload with target:"video" in the payload, the same idiom
    // openCreateWizard()/drawCreateWizard() already use client-side to pick
    // which endpoint/shape to post (see the "loop" target for /api/loops).
    // Everything else about the row is a normal mkt_moments insert; only
    // the duration cap, the required title, and the optional product link
    // differ from a regular Moment.
    const isLongVideo = body.target === "video";
    const mediaType = body.mediaType === "video" ? "video" : "image";
    const prefix = mediaType === "video" ? "data:video/" : "data:image/";
    if (!body.media || typeof body.media !== "string" || !body.media.startsWith(prefix)) {
      return sendJson(res, 400, { error: "Valid media is required" });
    }
    if (isLongVideo && mediaType !== "video") {
      return sendJson(res, 400, { error: "Videos must be a video file." });
    }
    let title = null;
    if (isLongVideo) {
      title = String(body.title || "").trim().slice(0, 120);
      if (!title) return sendJson(res, 400, { error: "A title is required for videos." });
    }
    const maxVideoSeconds = isLongVideo ? MAX_LONG_VIDEO_SECONDS : MAX_MOMENT_VIDEO_SECONDS;
    if (mediaType === "video" && body.durationSeconds !== undefined) {
      const dur = Number(body.durationSeconds);
      if (dur && dur > maxVideoSeconds) {
        return sendJson(res, 400, {
          error: isLongVideo
            ? "Videos can be at most " + Math.round(MAX_LONG_VIDEO_SECONDS / 60) + " minutes long."
            : "Videos can be at most " + MAX_MOMENT_VIDEO_SECONDS / 60 + " minutes long.",
        });
      }
    }
    // Optional link to one of the poster's OWN listings (any category, not
    // book-specific) - task #231 explicitly scopes this to the owner's own
    // products only, not third-party review tooling. Silently ignored if
    // missing/not-owned would hide a mistake from the client, so this
    // rejects instead of dropping it.
    let linkedProductId = null;
    if (isLongVideo && body.linkedProductId) {
      const ownProducts = await db.select("mkt_products", {
        id: "eq." + enc(body.linkedProductId),
        seller_id: "eq." + enc(me.id),
        select: "id",
      });
      if (!ownProducts || !ownProducts[0]) {
        return sendJson(res, 400, { error: "You can only link a video to your own listing." });
      }
      linkedProductId = body.linkedProductId;
    }
    const ext = mediaType === "video" ? ".mp4" : ".jpg";
    let mediaUrl;
    try {
      mediaUrl = await sbStorageUpload("media", "moments/" + me.id + "/" + crypto.randomBytes(8).toString("hex") + ext, body.media);
    } catch (e) {
      return sendJson(res, 500, { error: "Could not upload moment" });
    }
    // AI auto-clip trim window (task #160, optional) - only meaningful for
    // videos. Stored as plain metadata (no server-side re-encoding); null
    // means "play the whole thing". See POST /api/ai/suggest-clip above and
    // wireMomentTrimLoop() in app.js.
    let trimStartSec = null;
    let trimEndSec = null;
    if (mediaType === "video" && body.trimStartSec !== undefined && body.trimEndSec !== undefined && body.trimStartSec !== null && body.trimEndSec !== null) {
      const ts = Number(body.trimStartSec);
      const te = Number(body.trimEndSec);
      if (Number.isFinite(ts) && Number.isFinite(te) && ts >= 0 && te > ts) {
        trimStartSec = ts;
        trimEndSec = te;
      }
    }
    // Text/sticker overlay metadata (task #204, video only - photo overlays
    // are baked into the JPEG client-side before upload and never sent
    // here). sanitizeOverlayList() clamps/allowlists every field so this
    // never trusts the client's shape/size directly.
    const overlayJson = mediaType === "video" ? sanitizeOverlayList(body.overlays) : null;
    const now = Date.now();
    const moment = {
      id: crypto.randomBytes(8).toString("hex"),
      user_id: me.id,
      media_url: mediaUrl,
      media_type: mediaType,
      caption: String(body.caption || "").slice(0, 300),
      created_at: now,
      expires_at: now + 24 * 60 * 60 * 1000,
      trim_start_sec: trimStartSec,
      trim_end_sec: trimEndSec,
      title,
      linked_product_id: linkedProductId,
      is_long_video: isLongVideo,
      overlay_json: overlayJson,
    };
    await db.insert("mkt_moments", moment);
    return sendJson(res, 201, momentOut(moment));
  }

  // Feed algorithm v1: your own moments, then friends' moments (recency), then
  // moments from Pages you follow, then a small set of suggested Pages you
  // don't follow yet (ranked by follower count as a simple popularity proxy).
  // This is intentionally simple while the community is small - upgradeable
  // to a real ranking model once we have the data volume/infra to justify it.
  if (method === "GET" && pathname === "/api/moments/feed") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });

    const [friendRows, followRows] = await Promise.all([
      db.select("mkt_friendships", {
        status: "eq.accepted",
        or: "(requester_id.eq." + enc(me.id) + ",addressee_id.eq." + enc(me.id) + ")",
        select: "requester_id,addressee_id",
      }),
      db.select("mkt_follows", { follower_id: "eq." + enc(me.id), status: "eq.accepted", select: "followed_id" }),
    ]);
    const friendIds = friendRows.map((f) => (f.requester_id === me.id ? f.addressee_id : f.requester_id));
    const followedPageIds = followRows.map((f) => f.followed_id);

    // Suggested pages: public pages not already followed, ranked by follower count.
    const allPages = await db.select("mkt_users", { is_page: "eq.true", select: "id,name,photo,page_category" });
    const suggestedCandidates = allPages.filter((p) => p.id !== me.id && !followedPageIds.includes(p.id));
    let suggestedPageIds = [];
    if (suggestedCandidates.length) {
      const allFollows = await db.select("mkt_follows", {
        followed_id: "in.(" + suggestedCandidates.map((p) => enc(p.id)).join(",") + ")",
        status: "eq.accepted",
        select: "followed_id",
      });
      const counts = {};
      for (const f of allFollows) counts[f.followed_id] = (counts[f.followed_id] || 0) + 1;
      suggestedPageIds = suggestedCandidates
        .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))
        .slice(0, 10)
        .map((p) => p.id);
    }

    const userIds = [...new Set([me.id, ...friendIds, ...followedPageIds, ...suggestedPageIds])];
    if (!userIds.length) return sendJson(res, 200, { friends: [], suggested: [] });

    const moments = await db.select("mkt_moments", {
      user_id: "in.(" + userIds.map(enc).join(",") + ")",
      // No expires_at filter - Moments are permanent now, so every
      // non-deleted moment from these users is included.
      // is_long_video=eq.false - long-form Videos hub uploads (task #231)
      // live in this same table but never belong in the short-form scroll
      // feed; they have their own GET /api/videos/feed. This is a
      // deliberate product decision, not an oversight - short-form passive
      // scroll and long-form active search are different mental modes and
      // must stay visually/contextually separate.
      is_long_video: "eq.false",
      order: "created_at.asc",
      select: "*",
    });
    const authors = await db.select("mkt_users", {
      id: "in.(" + userIds.map(enc).join(",") + ")",
      select: "id,name,photo,is_page,page_category",
    });
    const grouped = {};
    for (const m of moments) {
      if (!grouped[m.user_id]) {
        const u = authors.find((x) => x.id === m.user_id);
        grouped[m.user_id] = {
          userId: m.user_id,
          userName: u ? u.name : "Unknown",
          userPhoto: u ? u.photo : null,
          isPage: !!(u && u.is_page),
          pageCategory: (u && u.page_category) || "",
          moments: [],
        };
      }
      grouped[m.user_id].moments.push(momentOut(m));
    }
    await attachMomentEngagement(
      Object.values(grouped).flatMap((g) => g.moments),
      me.id
    );

    const friendsSection = [];
    if (grouped[me.id]) friendsSection.push(grouped[me.id]);
    for (const uid of friendIds) if (grouped[uid]) friendsSection.push(grouped[uid]);

    const suggestedSection = [];
    for (const uid of followedPageIds) if (grouped[uid]) suggestedSection.push(grouped[uid]);
    for (const uid of suggestedPageIds) if (grouped[uid]) suggestedSection.push(grouped[uid]);

    return sendJson(res, 200, { friends: friendsSection, suggested: suggestedSection });
  }

  // Unified ranked feed v2: every active moment on the platform - video AND
  // photo - ranked by a blend of TikTok-style behavior signals and the same
  // social graph bonuses from v1. Originally video-only (the endpoint name
  // is kept as-is so the existing "#/clips" route doesn't need to change),
  // now also backs the merged photo+video swipe feed on Home. Works for
  // guests too (falls back to recency + global popularity) so the section
  // always has content; personalization kicks in once authenticated. Not
  // filtered by the friend graph, only boosted by it, so it already covers
  // the zero-friends cold-start case without a separate fallback path. Still
  // JS-computed like v1 - the "real ranker" upgrade path is to move this
  // into a proper feature store once volume justifies it, but the signal set
  // (completion, skip, like, per-author affinity) is now the same shape a
  // production ranker would use, just simpler math.
  if (method === "GET" && pathname === "/api/moments/videos/feed") {
    const me = await getAuthUser(req);
    let friendIds = [];
    let followedIds = [];
    if (me) {
      const [friendRows, followRows] = await Promise.all([
        db.select("mkt_friendships", {
          status: "eq.accepted",
          or: "(requester_id.eq." + enc(me.id) + ",addressee_id.eq." + enc(me.id) + ")",
          select: "requester_id,addressee_id",
        }),
        db.select("mkt_follows", { follower_id: "eq." + enc(me.id), status: "eq.accepted", select: "followed_id" }),
      ]);
      friendIds = friendRows.map((f) => (f.requester_id === me.id ? f.addressee_id : f.requester_id));
      followedIds = followRows.map((f) => f.followed_id);
    }

    const videos = await db.select("mkt_moments", {
      // No expires_at filter - Moments are permanent now, so the pool of
      // candidates is every moment on the platform (bounded by the limit
      // below), not just ones posted in the last 24h.
      // is_long_video=eq.false - this backs the short-form swipe feed
      // (#/clips) - see the identical exclusion + comment on GET
      // /api/moments/feed above. Long videos belong in GET /api/videos/feed
      // instead (task #231).
      is_long_video: "eq.false",
      order: "created_at.desc",
      select: "*",
      limit: "200",
    });
    if (!videos.length) return sendJson(res, 200, []);

    const authorIds = [...new Set(videos.map((v) => v.user_id))];
    const videoIds = videos.map((v) => v.id);
    const [authors, likeRows, eventRows, myEventRows, mySaveRows] = await Promise.all([
      db.select("mkt_users", { id: "in.(" + authorIds.map(enc).join(",") + ")", select: "id,name,photo,is_page" }),
      db.select("mkt_moment_likes", { moment_id: "in.(" + videoIds.map(enc).join(",") + ")", select: "moment_id,user_id" }),
      db.select("mkt_moment_events", {
        moment_id: "in.(" + videoIds.map(enc).join(",") + ")",
        type: "in.(complete,skip)",
        select: "moment_id,type",
      }),
      me
        ? db.select("mkt_moment_events", {
            user_id: "eq." + enc(me.id),
            type: "in.(complete,skip,like)",
            order: "created_at.desc",
            limit: "500",
            select: "moment_author_id,type",
          })
        : Promise.resolve([]),
      // The viewer's own saves for these videos, so the save/bookmark icon can
      // render pre-filled on load instead of always starting unpressed - this
      // was previously missing entirely, which made a saved video look
      // unsaved every time the feed was reloaded.
      me
        ? db.select("mkt_moment_saves", {
            moment_id: "in.(" + videoIds.map(enc).join(",") + ")",
            user_id: "eq." + enc(me.id),
            select: "moment_id",
          })
        : Promise.resolve([]),
    ]);

    // Global popularity per video: how often people who see it watch it all
    // the way through or skip it, plus raw like count.
    const popByMoment = {};
    for (const e of eventRows) {
      if (!popByMoment[e.moment_id]) popByMoment[e.moment_id] = { complete: 0, skip: 0 };
      popByMoment[e.moment_id][e.type]++;
    }
    const likesByMoment = {};
    const myLikedSet = new Set();
    for (const l of likeRows) {
      likesByMoment[l.moment_id] = (likesByMoment[l.moment_id] || 0) + 1;
      if (me && l.user_id === me.id) myLikedSet.add(l.moment_id);
    }
    const mySavedSet = new Set(mySaveRows.map((s) => s.moment_id));

    // Per-author affinity for this viewer, built from their own recent watch
    // history (independent of whether those older moments are still live) -
    // this is the "you tend to finish/like this creator's videos" signal.
    const affinityByAuthor = {};
    for (const e of myEventRows) {
      if (!e.moment_author_id) continue;
      if (!affinityByAuthor[e.moment_author_id]) affinityByAuthor[e.moment_author_id] = { complete: 0, skip: 0, like: 0 };
      affinityByAuthor[e.moment_author_id][e.type]++;
    }

    const scored = videos.map((v) => {
      const author = authors.find((a) => a.id === v.user_id);
      const pop = popByMoment[v.id] || { complete: 0, skip: 0 };
      const affinity = affinityByAuthor[v.user_id] || { complete: 0, skip: 0, like: 0 };

      let score = v.created_at / 1e13; // small recency baseline, doesn't dominate the bonuses below
      if (friendIds.includes(v.user_id)) score += 300;
      if (followedIds.includes(v.user_id)) score += 200;
      if (author && author.is_page) score += 50;

      // Author affinity: reward creators this viewer tends to finish/like,
      // lightly penalize ones they tend to skip. Capped so one very-watched
      // creator can't fully crowd out everything else.
      score += Math.min(250, affinity.complete * 20 + affinity.like * 35);
      score -= Math.min(150, affinity.skip * 15);

      // Global popularity: completion rate and raw likes as a cold-start
      // fallback signal for videos/creators this viewer has no history with.
      score += Math.min(100, pop.complete * 3);
      score -= Math.min(80, pop.skip * 2);
      score += Math.min(80, (likesByMoment[v.id] || 0) * 5);

      return {
        ...momentOut(v),
        userName: author ? author.name : "Unknown",
        userPhoto: author ? author.photo : null,
        isPage: !!(author && author.is_page),
        likeCount: likesByMoment[v.id] || 0,
        liked: myLikedSet.has(v.id),
        saved: mySavedSet.has(v.id),
        score,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    return sendJson(res, 200, scored.map(({ score, ...rest }) => rest));
  }

  // Behavior event: the client reports how a viewer engaged with a moment
  // (watched it fully, skipped it early, or liked it via a plain event log
  // in addition to the toggleable like below) so the ranking above can learn
  // from it. Accepts anonymous/guest events (user_id null) so they still
  // count toward the video's global popularity signal, just not toward any
  // per-viewer affinity.
  const momentEventMatch = pathname.match(/^\/api\/moments\/([a-zA-Z0-9]+)\/event$/);
  if (method === "POST" && momentEventMatch) {
    const me = await getAuthUser(req);
    const body = await readBody(req);
    const type = ["complete", "skip", "like"].includes(body.type) ? body.type : null;
    if (!type) return sendJson(res, 400, { error: "Invalid event type" });
    const momentRows = await db.select("mkt_moments", { id: "eq." + enc(momentEventMatch[1]), select: "user_id" });
    const authorId = momentRows && momentRows[0] ? momentRows[0].user_id : null;
    await db.insert("mkt_moment_events", {
      id: crypto.randomBytes(8).toString("hex"),
      moment_id: momentEventMatch[1],
      user_id: me ? me.id : null,
      moment_author_id: authorId,
      type,
      watch_ms: body.watchMs ? Number(body.watchMs) : null,
      duration_ms: body.durationMs ? Number(body.durationMs) : null,
      created_at: Date.now(),
    });
    return sendJson(res, 201, { ok: true });
  }

  // Like toggle (double-tap or button) - separate from the event log above so
  // the UI has a simple current-state boolean to render, with a unique
  // constraint preventing duplicate likes from the same viewer.
  const momentLikeMatch = pathname.match(/^\/api\/moments\/([a-zA-Z0-9]+)\/like$/);
  if (method === "POST" && momentLikeMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const existing = await db.select("mkt_moment_likes", {
      moment_id: "eq." + enc(momentLikeMatch[1]),
      user_id: "eq." + enc(me.id),
      select: "id",
    });
    if (!existing || !existing[0]) {
      await db.insert("mkt_moment_likes", {
        id: crypto.randomBytes(8).toString("hex"),
        moment_id: momentLikeMatch[1],
        user_id: me.id,
        created_at: Date.now(),
      });
      // Lifetime counter on the moment's author, not the actor - see
      // incrementUserStat. Fire-and-forget so a stats hiccup never blocks
      // the like itself, same as the notifyUser() calls elsewhere.
      const ownerRows = await db.select("mkt_moments", { id: "eq." + enc(momentLikeMatch[1]), select: "user_id" });
      const ownerId = ownerRows && ownerRows[0] && ownerRows[0].user_id;
      if (ownerId) incrementUserStat(ownerId, "stat_likes_received", 1);
    }
    return sendJson(res, 200, { ok: true });
  }
  if (method === "DELETE" && momentLikeMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const existing = await db.select("mkt_moment_likes", {
      moment_id: "eq." + enc(momentLikeMatch[1]),
      user_id: "eq." + enc(me.id),
      select: "id",
    });
    await db.remove("mkt_moment_likes", { moment_id: "eq." + enc(momentLikeMatch[1]), user_id: "eq." + enc(me.id) });
    if (existing && existing[0]) {
      const ownerRows = await db.select("mkt_moments", { id: "eq." + enc(momentLikeMatch[1]), select: "user_id" });
      const ownerId = ownerRows && ownerRows[0] && ownerRows[0].user_id;
      if (ownerId) incrementUserStat(ownerId, "stat_likes_received", -1);
    }
    return sendJson(res, 200, { ok: true });
  }

  // Save toggle (bookmark icon in the story viewer) - separate table from
  // mkt_saved_items, which is specifically for marketplace products.
  const momentSaveMatch = pathname.match(/^\/api\/moments\/([a-zA-Z0-9]+)\/save$/);
  if (method === "POST" && momentSaveMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const existing = await db.select("mkt_moment_saves", {
      moment_id: "eq." + enc(momentSaveMatch[1]),
      user_id: "eq." + enc(me.id),
      select: "id",
    });
    if (!existing || !existing[0]) {
      await db.insert("mkt_moment_saves", {
        id: crypto.randomBytes(8).toString("hex"),
        moment_id: momentSaveMatch[1],
        user_id: me.id,
        created_at: Date.now(),
      });
      // Lifetime counter on the moment's author - see incrementUserStat.
      const ownerRows = await db.select("mkt_moments", { id: "eq." + enc(momentSaveMatch[1]), select: "user_id" });
      const ownerId = ownerRows && ownerRows[0] && ownerRows[0].user_id;
      if (ownerId) incrementUserStat(ownerId, "stat_saves_received", 1);
    }
    return sendJson(res, 200, { ok: true });
  }
  if (method === "DELETE" && momentSaveMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const existing = await db.select("mkt_moment_saves", {
      moment_id: "eq." + enc(momentSaveMatch[1]),
      user_id: "eq." + enc(me.id),
      select: "id",
    });
    await db.remove("mkt_moment_saves", { moment_id: "eq." + enc(momentSaveMatch[1]), user_id: "eq." + enc(me.id) });
    if (existing && existing[0]) {
      const ownerRows = await db.select("mkt_moments", { id: "eq." + enc(momentSaveMatch[1]), select: "user_id" });
      const ownerId = ownerRows && ownerRows[0] && ownerRows[0].user_id;
      if (ownerId) incrementUserStat(ownerId, "stat_saves_received", -1);
    }
    return sendJson(res, 200, { ok: true });
  }

  // Repost: creates a brand-new moment in the reposter's own feed, copying
  // the original media/caption and tagging repost_of so the client can show
  // "Reposted from X" if desired. No longer subject to a MAX_ACTIVE_MOMENTS
  // cap - see the "No cap on total moments" comment in POST /api/moments.
  const momentRepostMatch = pathname.match(/^\/api\/moments\/([a-zA-Z0-9]+)\/repost$/);
  if (method === "POST" && momentRepostMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const origRows = await db.select("mkt_moments", { id: "eq." + enc(momentRepostMatch[1]), select: "*" });
    const orig = origRows && origRows[0];
    if (!orig) return sendJson(res, 404, { error: "Moment not found" });
    const now = Date.now();
    const moment = {
      id: crypto.randomBytes(8).toString("hex"),
      user_id: me.id,
      media_url: orig.media_url,
      media_type: orig.media_type,
      caption: orig.caption || "",
      created_at: now,
      expires_at: now + 24 * 60 * 60 * 1000,
      repost_of: orig.id,
    };
    await db.insert("mkt_moments", moment);
    return sendJson(res, 201, momentOut(moment));
  }

  // Public comments on a moment (shown in the story viewer via the message
  // icon, not a private DM) - flat list with parent_comment_id for one level
  // of replies, resolved client-side into threads. Anyone can read; posting
  // requires auth.
  const momentCommentsMatch = pathname.match(/^\/api\/moments\/([a-zA-Z0-9]+)\/comments$/);
  if (method === "GET" && momentCommentsMatch) {
    const rows = await db.select("mkt_moment_comments", {
      moment_id: "eq." + enc(momentCommentsMatch[1]),
      order: "created_at.asc",
      select: "*",
    });
    if (!rows.length) return sendJson(res, 200, []);
    const authorIds = [...new Set(rows.map((r) => r.user_id))];
    const authors = await db.select("mkt_users", {
      id: "in.(" + authorIds.map(enc).join(",") + ")",
      select: "id,name,photo",
    });
    const out = rows.map((r) => {
      const a = authors.find((x) => x.id === r.user_id);
      return {
        id: r.id,
        momentId: r.moment_id,
        userId: r.user_id,
        userName: a ? a.name : "Unknown",
        userPhoto: a ? a.photo : null,
        parentCommentId: r.parent_comment_id || null,
        text: r.text,
        createdAt: r.created_at,
      };
    });
    return sendJson(res, 200, out);
  }
  if (method === "POST" && momentCommentsMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const text = String(body.text || "").trim().slice(0, 500);
    if (!text) return sendJson(res, 400, { error: "Comment text is required" });
    let parentCommentId = null;
    if (body.parentCommentId) {
      const parentRows = await db.select("mkt_moment_comments", {
        id: "eq." + enc(body.parentCommentId),
        moment_id: "eq." + enc(momentCommentsMatch[1]),
        select: "id",
      });
      if (parentRows && parentRows[0]) parentCommentId = body.parentCommentId;
    }
    const comment = {
      id: crypto.randomBytes(8).toString("hex"),
      moment_id: momentCommentsMatch[1],
      user_id: me.id,
      parent_comment_id: parentCommentId,
      text,
      created_at: Date.now(),
    };
    await db.insert("mkt_moment_comments", comment);
    // Lifetime counter on the moment's author - see incrementUserStat.
    // Comments aren't "un-commented" the way likes/saves toggle, so this
    // only ever increments here; the matching decrement lives in the
    // DELETE /comments/:id handler below.
    const commentOwnerRows = await db.select("mkt_moments", { id: "eq." + enc(momentCommentsMatch[1]), select: "user_id" });
    const commentOwnerId = commentOwnerRows && commentOwnerRows[0] && commentOwnerRows[0].user_id;
    if (commentOwnerId) incrementUserStat(commentOwnerId, "stat_comments_received", 1);
    return sendJson(res, 201, {
      id: comment.id,
      momentId: comment.moment_id,
      userId: me.id,
      userName: me.name,
      userPhoto: me.photo || null,
      parentCommentId: comment.parent_comment_id,
      text: comment.text,
      createdAt: comment.created_at,
    });
  }

  const momentCommentDeleteMatch = pathname.match(/^\/api\/moments\/([a-zA-Z0-9]+)\/comments\/([a-zA-Z0-9]+)$/);
  if (method === "DELETE" && momentCommentDeleteMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_moment_comments", { id: "eq." + enc(momentCommentDeleteMatch[2]), select: "user_id,moment_id" });
    const c = rows && rows[0];
    if (!c) return sendJson(res, 404, { error: "Comment not found" });
    if (c.user_id !== me.id) return sendJson(res, 403, { error: "You do not own this comment" });
    await db.remove("mkt_moment_comments", { id: "eq." + enc(momentCommentDeleteMatch[2]) });
    const commentOwnerRows = await db.select("mkt_moments", { id: "eq." + enc(c.moment_id), select: "user_id" });
    const commentOwnerId = commentOwnerRows && commentOwnerRows[0] && commentOwnerRows[0].user_id;
    if (commentOwnerId) incrementUserStat(commentOwnerId, "stat_comments_received", -1);
    return sendJson(res, 200, { ok: true });
  }

  const userMomentsMatch = pathname.match(/^\/api\/moments\/user\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && userMomentsMatch) {
    const me = await getAuthUser(req);
    const moments = await db.select("mkt_moments", {
      user_id: "eq." + enc(userMomentsMatch[1]),
      // No expires_at filter - Moments are permanent now.
      order: "created_at.asc",
      select: "*",
    });
    const out = moments.map(momentOut);
    await attachMomentEngagement(out, me ? me.id : null);
    return sendJson(res, 200, out);
  }

  const momentMatch = pathname.match(/^\/api\/moments\/([a-zA-Z0-9]+)$/);
  // Single-moment fetch, public (no auth required) - added for the Videos
  // hub watch page (task #231, GET /#/videos/:id), which needs to load one
  // specific moment by id directly (e.g. from a shared link) rather than
  // finding it inside a feed page. Works for any moment, short or long form.
  if (method === "GET" && momentMatch) {
    const rows = await db.select("mkt_moments", { id: "eq." + enc(momentMatch[1]), select: "*" });
    const m = rows && rows[0];
    if (!m) return sendJson(res, 404, { error: "Moment not found" });
    const authorRows = await db.select("mkt_users", { id: "eq." + enc(m.user_id), select: "id,name,photo,is_page" });
    const author = authorRows && authorRows[0];
    const out = momentOut(m);
    out.userName = author ? author.name : "Unknown";
    out.userPhoto = author ? author.photo : null;
    out.isPage = !!(author && author.is_page);
    const me = await getAuthUser(req);
    await attachMomentEngagement([out], me ? me.id : null);
    return sendJson(res, 200, out);
  }
  if (method === "DELETE" && momentMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_moments", { id: "eq." + enc(momentMatch[1]), select: "*" });
    const m = rows && rows[0];
    if (!m) return sendJson(res, 404, { error: "Moment not found" });
    if (m.user_id !== me.id) return sendJson(res, 403, { error: "You do not own this moment" });
    await db.remove("mkt_moments", { id: "eq." + enc(m.id) });
    return sendJson(res, 200, { ok: true });
  }

  // ---- VIDEOS (long-form video hub, task #231 - "Videos", plain and
  // general-purpose, NOT limited to book reviews and NOT named after any
  // other platform's short-form feature). Every long video is just an
  // mkt_moments row with is_long_video=true, a title, and an optional
  // linked_product_id - see POST /api/moments above (target:"video") and
  // momentOut() for the shape. This section only adds the two read
  // endpoints the Videos hub needs on top of that; like/save/comment/delete
  // all reuse the existing /api/moments/:id/... endpoints unchanged, since
  // these rows really are moments under the hood. ----

  // Reverse-chronological "home" feed for the Videos hub - deliberately
  // simple (no ranking algorithm) for MVP, unlike the Moments v2 feed.
  // Works for guests too (like/saved just come back false) so the section
  // is always browsable, matching how the rest of the app treats browsing
  // vs. the auth-gated write actions.
  if (method === "GET" && pathname === "/api/videos/feed") {
    const me = await getAuthUser(req);
    const limitNum = Math.min(60, Math.max(1, Number(query.limit) || 30));
    const offsetNum = Math.max(0, Number(query.offset) || 0);
    const videos = await db.select("mkt_moments", {
      is_long_video: "eq.true",
      order: "created_at.desc",
      select: "*",
      limit: String(limitNum),
      offset: String(offsetNum),
    });
    if (!videos.length) return sendJson(res, 200, []);
    const authorIds = [...new Set(videos.map((v) => v.user_id))];
    const authors = await db.select("mkt_users", { id: "in.(" + authorIds.map(enc).join(",") + ")", select: "id,name,photo,is_page" });
    const out = videos.map((v) => {
      const author = authors.find((a) => a.id === v.user_id);
      return {
        ...momentOut(v),
        userName: author ? author.name : "Unknown",
        userPhoto: author ? author.photo : null,
        isPage: !!(author && author.is_page),
      };
    });
    await attachMomentEngagement(out, me ? me.id : null);
    return sendJson(res, 200, out);
  }

  // Long videos linked to a given product listing - rendered as a "Related
  // videos" strip on that product's detail page. Public (no auth required),
  // same as the product detail endpoint itself.
  const videosByProductMatch = pathname.match(/^\/api\/videos\/by-product\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && videosByProductMatch) {
    const me = await getAuthUser(req);
    const videos = await db.select("mkt_moments", {
      is_long_video: "eq.true",
      linked_product_id: "eq." + enc(videosByProductMatch[1]),
      order: "created_at.desc",
      select: "*",
    });
    if (!videos.length) return sendJson(res, 200, []);
    const authorIds = [...new Set(videos.map((v) => v.user_id))];
    const authors = await db.select("mkt_users", { id: "in.(" + authorIds.map(enc).join(",") + ")", select: "id,name,photo,is_page" });
    const out = videos.map((v) => {
      const author = authors.find((a) => a.id === v.user_id);
      return {
        ...momentOut(v),
        userName: author ? author.name : "Unknown",
        userPhoto: author ? author.photo : null,
        isPage: !!(author && author.is_page),
      };
    });
    await attachMomentEngagement(out, me ? me.id : null);
    return sendJson(res, 200, out);
  }

  // ---- LOOPS (genuinely ephemeral 24h stories, Instagram/FB-Stories-style) ----
  // Separate feature from Moments (see the "MOMENTS" section above) and its
  // own table (mkt_loops) - Moments were made permanent on 2026-08-18 and
  // no longer fit the "disappears after a day, tap-through viewer, seen/
  // unseen ring" Stories mechanic, so Loops exists to carry that mechanic
  // forward under its own name/branding instead of overloading Moments with
  // two different lifecycle behaviors. Requires a one-time Supabase
  // migration creating mkt_loops and mkt_loop_views (see PROJECT.md / deploy
  // notes) - not run automatically by this server the same way the rest of
  // the schema isn't either.

  function loopOut(l) {
    const { user_id, media_url, media_type, created_at, expires_at, ...rest } = l;
    return {
      ...rest,
      userId: user_id,
      mediaUrl: media_url,
      mediaType: media_type,
      createdAt: created_at,
      expiresAt: expires_at,
    };
  }

  // Decorates a list of already-loopOut()'d loops in place with `viewed`
  // (has meId got a row in mkt_loop_views for this loop - drives the seen/
  // unseen ring on the author's avatar) and `viewCount` (total distinct
  // viewers - only actually shown to the loop's own author in the UI, but
  // cheap enough to attach unconditionally rather than branching the query
  // per-caller). One batched query for the whole list, same idiom as
  // attachMomentEngagement above.
  async function attachLoopViewState(loopList, meId) {
    if (!loopList || !loopList.length) return loopList;
    const idsIn = "in.(" + loopList.map((l) => enc(l.id)).join(",") + ")";
    const viewRows = await db.select("mkt_loop_views", { loop_id: idsIn, select: "loop_id,viewer_id" });
    const countByLoop = {};
    const viewedSet = new Set();
    for (const v of viewRows) {
      countByLoop[v.loop_id] = (countByLoop[v.loop_id] || 0) + 1;
      if (meId && v.viewer_id === meId) viewedSet.add(v.loop_id);
    }
    for (const l of loopList) {
      l.viewCount = countByLoop[l.id] || 0;
      l.viewed = viewedSet.has(l.id);
    }
    return loopList;
  }

  if (method === "POST" && pathname === "/api/loops") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const ip = getClientIp(req);
    if (!checkRateLimit("loop:" + ip, 20, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: "Too many Loops posted. Please try again later." });
    }
    // Small active-count cap DOES make sense here, unlike the now-permanent
    // Moments - Loops are the Stories-style feature that cap was originally
    // written for (see the MAX_ACTIVE_MOMENTS comment near the top of this
    // file). Counts only currently-live (not yet expired) Loops, so it
    // naturally frees up as old ones expire without any extra bookkeeping.
    const activeLoops = await db.select("mkt_loops", {
      user_id: "eq." + enc(me.id),
      expires_at: "gt." + Date.now(),
      select: "id",
    });
    if (activeLoops.length >= MAX_ACTIVE_MOMENTS) {
      return sendJson(res, 400, { error: "You already have " + MAX_ACTIVE_MOMENTS + " active Loops. Wait for one to expire or delete one first." });
    }
    const body = await readBody(req);
    const mediaType = body.mediaType === "video" ? "video" : "photo";
    const prefix = mediaType === "video" ? "data:video/" : "data:image/";
    if (!body.media || typeof body.media !== "string" || !body.media.startsWith(prefix)) {
      return sendJson(res, 400, { error: "Valid media is required" });
    }
    if (mediaType === "video" && body.durationSeconds !== undefined) {
      const dur = Number(body.durationSeconds);
      if (dur && dur > MAX_LOOP_VIDEO_SECONDS) {
        return sendJson(res, 400, { error: "Loop videos can be at most " + MAX_LOOP_VIDEO_SECONDS + " seconds long." });
      }
    }
    const ext = mediaType === "video" ? ".mp4" : ".jpg";
    let mediaUrl;
    try {
      mediaUrl = await sbStorageUpload("media", "loops/" + me.id + "/" + crypto.randomBytes(8).toString("hex") + ext, body.media);
    } catch (e) {
      return sendJson(res, 500, { error: "Could not upload Loop" });
    }
    const now = Date.now();
    const loop = {
      id: crypto.randomBytes(8).toString("hex"),
      user_id: me.id,
      media_url: mediaUrl,
      media_type: mediaType,
      caption: String(body.caption || "").slice(0, 300),
      created_at: now,
      expires_at: now + 24 * 60 * 60 * 1000,
    };
    await db.insert("mkt_loops", loop);
    return sendJson(res, 201, loopOut(loop));
  }

  // Own Loops (if any) + friends'/followed-pages' Loops, grouped by author -
  // same relationship rules as GET /api/moments/feed above (friends via
  // mkt_friendships, pages via mkt_follows) but WITHOUT that endpoint's
  // "suggested pages you don't follow" fan-out: Loops is a Stories strip,
  // not a discovery feed, so only people/pages you already have a
  // relationship with belong here. Unlike Moments, this endpoint DOES filter
  // by expires_at - Loops that have expired are gone from the strip even if
  // the hourly cleanup cron hasn't swept them yet.
  if (method === "GET" && pathname === "/api/loops/feed") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });

    const [friendRows, followRows] = await Promise.all([
      db.select("mkt_friendships", {
        status: "eq.accepted",
        or: "(requester_id.eq." + enc(me.id) + ",addressee_id.eq." + enc(me.id) + ")",
        select: "requester_id,addressee_id",
      }),
      db.select("mkt_follows", { follower_id: "eq." + enc(me.id), status: "eq.accepted", select: "followed_id" }),
    ]);
    const friendIds = friendRows.map((f) => (f.requester_id === me.id ? f.addressee_id : f.requester_id));
    const followedPageIds = followRows.map((f) => f.followed_id);

    const userIds = [...new Set([me.id, ...friendIds, ...followedPageIds])];
    const loops = await db.select("mkt_loops", {
      user_id: "in.(" + userIds.map(enc).join(",") + ")",
      expires_at: "gt." + Date.now(),
      order: "created_at.asc",
      select: "*",
    });
    const authors = await db.select("mkt_users", {
      id: "in.(" + userIds.map(enc).join(",") + ")",
      select: "id,name,photo,is_page,page_category",
    });
    const grouped = {};
    for (const l of loops) {
      if (!grouped[l.user_id]) {
        const u = authors.find((x) => x.id === l.user_id);
        grouped[l.user_id] = {
          userId: l.user_id,
          userName: u ? u.name : "Unknown",
          userPhoto: u ? u.photo : null,
          isPage: !!(u && u.is_page),
          pageCategory: (u && u.page_category) || "",
          loops: [],
        };
      }
      grouped[l.user_id].loops.push(loopOut(l));
    }
    await attachLoopViewState(
      Object.values(grouped).flatMap((g) => g.loops),
      me.id
    );

    // Own group first (if present), then friends, then followed pages -
    // mirrors the Moments feed's friends-first ordering. Flat array (not
    // split into friends/suggested sections like Moments) since there's no
    // suggested content here.
    const groups = [];
    if (grouped[me.id]) groups.push(grouped[me.id]);
    for (const uid of friendIds) if (grouped[uid]) groups.push(grouped[uid]);
    for (const uid of followedPageIds) if (grouped[uid]) groups.push(grouped[uid]);

    return sendJson(res, 200, { groups });
  }

  const loopViewMatch = pathname.match(/^\/api\/loops\/([a-zA-Z0-9]+)\/view$/);
  if (method === "POST" && loopViewMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const loopId = loopViewMatch[1];
    const rows = await db.select("mkt_loops", { id: "eq." + enc(loopId), select: "id,user_id" });
    const loop = rows && rows[0];
    if (!loop) return sendJson(res, 404, { error: "Loop not found" });
    // Skip recording the author viewing their own Loop - same "don't count
    // yourself" behavior real Stories-style viewers have, so the view count
    // shown back to the author reflects other people, not their own preview.
    if (loop.user_id === me.id) return sendJson(res, 200, { ok: true });
    // Idempotent: check-before-insert rather than relying on the DB unique
    // constraint to reject a duplicate, since sbRequest() treats any 4xx as
    // a thrown error and the caller shouldn't see an error for "I already
    // saw this Loop" - repeat views are expected (re-opening a friend's
    // Loops re-plays already-seen ones).
    const existing = await db.select("mkt_loop_views", {
      loop_id: "eq." + enc(loopId),
      viewer_id: "eq." + enc(me.id),
      select: "id",
    });
    if (!existing || !existing.length) {
      await db.insert("mkt_loop_views", { loop_id: loopId, viewer_id: me.id, created_at: Date.now() });
    }
    return sendJson(res, 200, { ok: true });
  }

  const loopMatch = pathname.match(/^\/api\/loops\/([a-zA-Z0-9]+)$/);
  if (method === "DELETE" && loopMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("mkt_loops", { id: "eq." + enc(loopMatch[1]), select: "*" });
    const l = rows && rows[0];
    if (!l) return sendJson(res, 404, { error: "Loop not found" });
    if (l.user_id !== me.id) return sendJson(res, 403, { error: "You do not own this Loop" });
    await db.remove("mkt_loops", { id: "eq." + enc(l.id) });
    return sendJson(res, 200, { ok: true });
  }

  // ---- CREATOR ANALYTICS ----
  // Always scoped to the authenticated caller (me.id) - never accepts a
  // client-supplied user id, same idiom as PUT /api/users/me. Combines four
  // kinds of data:
  //  - lifetime: the stat_*_received counters on mkt_users (see
  //    incrementUserStat) - cumulative totals, maintained incrementally.
  //    Originally these existed because per-moment likes/saves/comments were
  //    lost once a moment hard-deleted at 24h; now that Moments are
  //    permanent (see the "Moments" section comment above) that data loss
  //    can't happen anymore, but the lifetime counters are kept as-is since
  //    they're still a cheap true total and per-moment counts are still
  //    live-queried below anyway.
  //  - followerCount: live count from mkt_follows, same query as
  //    GET /api/follow/status - not duplicated/cached anywhere.
  //  - views7d/views7dPrev/completionRate7d: real week-over-week trend data,
  //    computed straight from mkt_moment_events. That table is denormalized
  //    with moment_author_id and is never deleted.
  //  - recentMoments (formerly "activeMoments"): per-moment breakdown for
  //    this creator's most recent moments. Renamed because Moments no longer
  //    expire, so the old "active" (= not-yet-expired) framing and its
  //    expires_at filter no longer mean anything - every moment is "active"
  //    now. Capped to the most recent MAX_CREATOR_STATS_MOMENTS so this
  //    endpoint stays cheap for creators who have posted a lot over time.
  if (method === "GET" && pathname === "/api/creator/stats") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });

    const MAX_CREATOR_STATS_MOMENTS = 50;
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * DAY_MS;
    const fourteenDaysAgo = now - 14 * DAY_MS;

    const [userRows, followerRows, recentMomentRows, eventsLast7d, eventsPrev7d] = await Promise.all([
      db.select("mkt_users", { id: "eq." + enc(me.id), select: "stat_likes_received,stat_saves_received,stat_comments_received" }),
      db.select("mkt_follows", { followed_id: "eq." + enc(me.id), status: "eq.accepted", select: "id" }),
      db.select("mkt_moments", {
        user_id: "eq." + enc(me.id),
        // No expires_at filter - every moment is included, most recent first.
        order: "created_at.desc",
        select: "*",
        limit: String(MAX_CREATOR_STATS_MOMENTS),
      }),
      db.select("mkt_moment_events", { moment_author_id: "eq." + enc(me.id), created_at: "gte." + sevenDaysAgo, select: "type" }),
      // PostgREST can't express two conditions on the same column as two
      // plain query keys (an object can only have one "created_at" key), so
      // the previous-7-days window goes through an and=(...) compound filter.
      db.select("mkt_moment_events", {
        moment_author_id: "eq." + enc(me.id),
        and: "(created_at.gte." + fourteenDaysAgo + ",created_at.lt." + sevenDaysAgo + ")",
        select: "id",
      }),
    ]);

    const userRow = userRows && userRows[0];
    const lifetime = {
      likesReceived: (userRow && userRow.stat_likes_received) || 0,
      savesReceived: (userRow && userRow.stat_saves_received) || 0,
      commentsReceived: (userRow && userRow.stat_comments_received) || 0,
    };

    // "Views" = total logged interaction events (complete/skip/like) in the
    // window - each represents one tracked watch of one of this creator's
    // moments. Not a deduplicated unique-viewer count.
    const views7d = eventsLast7d.length;
    const views7dPrev = eventsPrev7d.length;
    let completeCount = 0;
    let skipCount = 0;
    for (const e of eventsLast7d) {
      if (e.type === "complete") completeCount++;
      else if (e.type === "skip") skipCount++;
    }
    const completionDenom = completeCount + skipCount;
    const completionRate7d = completionDenom > 0 ? completeCount / completionDenom : null;

    // Per-moment breakdown for this creator's most recent moments - one
    // batched query per engagement table across all of them rather than N+1.
    let recentMoments = recentMomentRows.map(momentOut);
    if (recentMoments.length) {
      const idsIn = "in.(" + recentMoments.map((m) => enc(m.id)).join(",") + ")";
      const [likeRows, saveRows, commentRows, eventRows] = await Promise.all([
        db.select("mkt_moment_likes", { moment_id: idsIn, select: "moment_id" }),
        db.select("mkt_moment_saves", { moment_id: idsIn, select: "moment_id" }),
        db.select("mkt_moment_comments", { moment_id: idsIn, select: "moment_id" }),
        db.select("mkt_moment_events", { moment_id: idsIn, select: "moment_id" }),
      ]);
      const tally = (rows) => {
        const out = {};
        for (const r of rows) out[r.moment_id] = (out[r.moment_id] || 0) + 1;
        return out;
      };
      const likeCounts = tally(likeRows);
      const saveCounts = tally(saveRows);
      const commentCounts = tally(commentRows);
      const viewCounts = tally(eventRows);
      recentMoments = recentMoments.map((m) => ({
        id: m.id,
        mediaType: m.mediaType,
        caption: m.caption,
        createdAt: m.createdAt,
        viewCount: viewCounts[m.id] || 0,
        likeCount: likeCounts[m.id] || 0,
        saveCount: saveCounts[m.id] || 0,
        commentCount: commentCounts[m.id] || 0,
      }));
    }

    return sendJson(res, 200, {
      lifetime,
      followerCount: (followerRows || []).length,
      views7d,
      views7dPrev,
      completionRate7d,
      recentMoments,
    });
  }

  // ---- INTERNATIONAL COMPANIES (producer/distributor cross-border matching) ----

  const INTL_ROLE_TYPES = ["producer", "distributor"];
  const INTL_STATUSES = ["pending", "in_review", "verified", "rejected"];
  // Structured book-focused service tags a company can offer - lets the
  // directory be filtered by what a buyer/seller actually needs (sourcing a
  // rare title, shipping books abroad, buying in bulk) instead of a vague
  // free-text "industry" field. Stored as a comma-joined string.
  const INTL_BOOK_SERVICES = ["sourcing", "foreign_language", "academic", "logistics", "wholesale"];
  function sanitizeBookServices(input) {
    const arr = Array.isArray(input) ? input : String(input || "").split(",");
    return arr.map((s) => String(s).trim()).filter((s) => INTL_BOOK_SERVICES.includes(s)).join(",");
  }

  // Full view - includes internal verification notes. Only ever sent to the
  // owner of the profile or an admin (isOwner), never to the public directory.
  function companyOut(c) {
    const { owner_user_id, company_name, role_type, contact_email, contact_phone, logo_url, verification_notes, verified_at, created_at, book_services, ...rest } = c;
    return {
      ...rest,
      ownerUserId: owner_user_id,
      companyName: company_name,
      roleType: role_type,
      contactEmail: contact_email,
      contactPhone: contact_phone,
      logoUrl: logo_url,
      verificationNotes: verification_notes,
      verifiedAt: verified_at,
      createdAt: created_at,
      bookServices: book_services ? book_services.split(",").filter(Boolean) : [],
    };
  }

  // Public directory view - deliberately omits contact_email/contact_phone and
  // verification_notes. Contact happens through our own messaging system
  // (ownerUserId), so we stay the intermediary rather than leaking direct
  // contact info, and internal verification notes are never public.
  function companyPublicOut(c) {
    const full = companyOut(c);
    const { contactEmail, contactPhone, verificationNotes, ...safe } = full;
    return safe;
  }

  // POST /api/intl/companies - register a company profile (producer or distributor).
  // Starts life as status "pending" and is invisible in the public directory
  // until an agent/admin verifies it via PUT /api/intl/companies/:id/status.
  if (method === "POST" && pathname === "/api/intl/companies") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const ip = getClientIp(req);
    if (!checkRateLimit("intlcompany:" + ip, 5, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: "Too many submissions. Please try again later." });
    }
    const body = await readBody(req);
    const { companyName, roleType, country, industry, description, contactEmail, contactPhone, website, bookServices } = body;

    if (!companyName || !String(companyName).trim()) return sendJson(res, 400, { error: "Company name is required" });
    if (!INTL_ROLE_TYPES.includes(roleType)) return sendJson(res, 400, { error: "Invalid role type" });
    if (!country || !String(country).trim()) return sendJson(res, 400, { error: "Country is required" });

    const company = {
      id: crypto.randomBytes(8).toString("hex"),
      owner_user_id: me.id,
      company_name: String(companyName).trim().slice(0, 140),
      role_type: roleType,
      country: String(country).trim().slice(0, 80),
      industry: String(industry || "").trim().slice(0, 80),
      description: String(description || "").slice(0, 3000),
      contact_email: String(contactEmail || "").trim().slice(0, 200),
      contact_phone: String(contactPhone || "").trim().slice(0, 40),
      website: String(website || "").trim().slice(0, 300),
      logo_url: "",
      book_services: sanitizeBookServices(bookServices),
      status: "pending",
      verification_notes: "",
      verified_at: null,
      created_at: Date.now(),
    };
    const inserted = await db.insert("mkt_intl_companies", company);
    return sendJson(res, 201, companyOut(inserted));
  }

  // GET /api/intl/companies - three modes depending on query params:
  //   (default)  public verified directory, filterable by country/industry/roleType
  //   ?mine=1    the logged-in user's own profiles, any status
  //   ?all=1     every profile regardless of status - admin/agent only (verification queue)
  if (method === "GET" && pathname === "/api/intl/companies") {
    const me = await getAuthUser(req);

    if (query.mine === "1") {
      if (!me) return sendJson(res, 401, { error: "Not authenticated" });
      const mine = await db.select("mkt_intl_companies", { owner_user_id: "eq." + enc(me.id), select: "*", order: "created_at.desc" });
      return sendJson(res, 200, mine.map(companyOut));
    }

    if (query.all === "1") {
      if (!isOwner(me)) return sendJson(res, 403, { error: "Not authorized" });
      const params = { select: "*", order: "created_at.desc" };
      if (query.status && INTL_STATUSES.includes(query.status)) params.status = "eq." + enc(query.status);
      const all = await db.select("mkt_intl_companies", params);
      return sendJson(res, 200, all.map(companyOut));
    }

    const params = { status: "eq.verified", select: "*", order: "created_at.desc" };
    if (query.country) params.country = "ilike.*" + enc(query.country) + "*";
    if (query.industry) params.industry = "ilike.*" + enc(query.industry) + "*";
    if (query.roleType && INTL_ROLE_TYPES.includes(query.roleType)) params.role_type = "eq." + enc(query.roleType);
    if (query.bookService && INTL_BOOK_SERVICES.includes(query.bookService)) {
      params.book_services = "ilike.*" + enc(query.bookService) + "*";
    }
    const verified = await db.select("mkt_intl_companies", params);
    return sendJson(res, 200, verified.map(companyPublicOut));
  }

  const companyMatch = pathname.match(/^\/api\/intl\/companies\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && companyMatch) {
    const companies = await db.select("mkt_intl_companies", { id: "eq." + enc(companyMatch[1]), select: "*" });
    const c = companies && companies[0];
    if (!c) return sendJson(res, 404, { error: "Company not found" });
    const me = await getAuthUser(req);
    const canSeeFull = me && (me.id === c.owner_user_id || isOwner(me));
    if (c.status !== "verified" && !canSeeFull) return sendJson(res, 404, { error: "Company not found" });
    return sendJson(res, 200, canSeeFull ? companyOut(c) : companyPublicOut(c));
  }

  // PUT /api/intl/companies/:id - the owner edits their own profile.
  // Editing never changes status - only the admin/agent verification endpoint does.
  if (method === "PUT" && companyMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const companies = await db.select("mkt_intl_companies", { id: "eq." + enc(companyMatch[1]), select: "*" });
    const c = companies && companies[0];
    if (!c) return sendJson(res, 404, { error: "Company not found" });
    if (c.owner_user_id !== me.id) return sendJson(res, 403, { error: "You do not own this profile" });

    const body = await readBody(req);
    const patch = {};
    if (body.companyName !== undefined) patch.company_name = String(body.companyName).trim().slice(0, 140);
    if (body.roleType !== undefined && INTL_ROLE_TYPES.includes(body.roleType)) patch.role_type = body.roleType;
    if (body.country !== undefined) patch.country = String(body.country).trim().slice(0, 80);
    if (body.industry !== undefined) patch.industry = String(body.industry).trim().slice(0, 80);
    if (body.description !== undefined) patch.description = String(body.description).slice(0, 3000);
    if (body.contactEmail !== undefined) patch.contact_email = String(body.contactEmail).trim().slice(0, 200);
    if (body.contactPhone !== undefined) patch.contact_phone = String(body.contactPhone).trim().slice(0, 40);
    if (body.website !== undefined) patch.website = String(body.website).trim().slice(0, 300);
    if (body.logoUrl !== undefined) patch.logo_url = String(body.logoUrl).trim().slice(0, 1000);
    if (body.bookServices !== undefined) patch.book_services = sanitizeBookServices(body.bookServices);
    const updated = await db.update("mkt_intl_companies", { id: "eq." + enc(c.id) }, patch);
    return sendJson(res, 200, companyOut(updated[0]));
  }

  // PUT /api/intl/companies/:id/status - admin/agent verification decision.
  // This is the ONLY way a profile becomes visible in the public directory.
  const companyStatusMatch = pathname.match(/^\/api\/intl\/companies\/([a-zA-Z0-9]+)\/status$/);
  if (method === "PUT" && companyStatusMatch) {
    const me = await getAuthUser(req);
    if (!isOwner(me)) return sendJson(res, 403, { error: "Not authorized" });
    const companies = await db.select("mkt_intl_companies", { id: "eq." + enc(companyStatusMatch[1]), select: "*" });
    const c = companies && companies[0];
    if (!c) return sendJson(res, 404, { error: "Company not found" });

    const body = await readBody(req);
    if (!INTL_STATUSES.includes(body.status)) return sendJson(res, 400, { error: "Invalid status" });
    const patch = {
      status: body.status,
      verification_notes: body.verificationNotes !== undefined ? String(body.verificationNotes).slice(0, 3000) : c.verification_notes,
    };
    if (body.status === "verified") patch.verified_at = Date.now();
    const updated = await db.update("mkt_intl_companies", { id: "eq." + enc(c.id) }, patch);
    if (body.status === "verified") {
      notifyUser(c.owner_user_id, "offers", {
        title: "Perfil verificado en HieloIce Internacional",
        body: '"' + c.company_name + '" ya está verificado y visible en el directorio internacional.',
        url: "/#/intl/company/" + c.id,
      }).catch(() => {});
    }
    return sendJson(res, 200, companyOut(updated[0]));
  }

  // ---- ORIGINAL WORKS ("Publish a Book" - task #244, Reese Witherspoon-
  // style independent-author pipeline: write with AI co-writing help ->
  // submit -> automated AI first-pass review -> human team review. Nothing
  // in this whole flow ever creates a public/purchasable listing - see
  // ORIGINAL_BOOK_PROGRAM_ENABLED below - so both authors and our team can
  // use the real end-to-end flow before any legal/monetization terms exist.
  // Distinct from POST /api/products (selling a used physical book, C2C
  // Marketplace) and from the Book Club "Pick of the Month" panel. ----
  const ORIGINAL_BOOK_PROGRAM_ENABLED = false;

  function originalWorkOut(w) {
    return {
      id: w.id,
      authorId: w.author_id,
      title: w.title,
      genre: w.genre,
      synopsis: w.synopsis,
      chapters: Array.isArray(w.chapters) ? w.chapters : [],
      coverImageUrl: w.cover_image_url || null,
      status: w.status,
      aiReviewVerdict: w.ai_review_verdict || null,
      aiReviewNotes: w.ai_review_notes || null,
      teamDecision: w.team_decision || null,
      teamDecisionNotes: w.team_decision_notes || null,
      submittedAt: w.submitted_at || null,
      aiReviewedAt: w.ai_reviewed_at || null,
      teamDecisionAt: w.team_decision_at || null,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    };
  }

  if (method === "GET" && pathname === "/api/original-works/config") {
    return sendJson(res, 200, { programEnabled: ORIGINAL_BOOK_PROGRAM_ENABLED });
  }

  if (method === "GET" && pathname === "/api/original-works/mine") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("original_works", { author_id: "eq." + enc(me.id), order: "updated_at.desc", select: "*" });
    return sendJson(res, 200, (rows || []).map(originalWorkOut));
  }

  if (method === "POST" && pathname === "/api/original-works") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const title = String(body.title || "").trim().slice(0, 200);
    if (!title) return sendJson(res, 400, { error: "Title is required" });
    const now = Date.now();
    const work = {
      id: crypto.randomBytes(8).toString("hex"),
      author_id: me.id,
      title,
      genre: String(body.genre || "").trim().slice(0, 60),
      synopsis: String(body.synopsis || "").trim().slice(0, 2000),
      chapters: [],
      status: "draft",
      created_at: now,
      updated_at: now,
    };
    const created = await db.insert("original_works", work);
    return sendJson(res, 201, originalWorkOut(created));
  }

  const workMatch = pathname.match(/^\/api\/original-works\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && workMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("original_works", { id: "eq." + enc(workMatch[1]), select: "*" });
    const w = rows && rows[0];
    if (!w) return sendJson(res, 404, { error: "Not found" });
    if (w.author_id !== me.id && !isAdmin(me)) return sendJson(res, 403, { error: "Not authorized" });
    return sendJson(res, 200, originalWorkOut(w));
  }

  if (method === "PATCH" && workMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("original_works", { id: "eq." + enc(workMatch[1]), select: "*" });
    const w = rows && rows[0];
    if (!w) return sendJson(res, 404, { error: "Not found" });
    if (w.author_id !== me.id) return sendJson(res, 403, { error: "Not authorized" });
    if (!["draft", "needs_revision"].includes(w.status)) {
      return sendJson(res, 400, { error: "This book can't be edited while it's under review." });
    }
    const body = await readBody(req);
    const patch = { updated_at: Date.now() };
    if (body.title !== undefined) patch.title = String(body.title).trim().slice(0, 200);
    if (body.genre !== undefined) patch.genre = String(body.genre).trim().slice(0, 60);
    if (body.synopsis !== undefined) patch.synopsis = String(body.synopsis).trim().slice(0, 2000);
    if (Array.isArray(body.chapters)) {
      patch.chapters = body.chapters.slice(0, 60).map((c) => ({
        title: String((c && c.title) || "").trim().slice(0, 150),
        content: String((c && c.content) || "").slice(0, 20000),
      }));
    }
    const updated = await db.update("original_works", { id: "eq." + enc(w.id) }, patch);
    return sendJson(res, 200, originalWorkOut(updated[0]));
  }

  // POST /api/original-works/:id/ai-assist { instruction, currentText, locale }
  // A co-writing helper for one chapter at a time - the author stays the
  // author, this just drafts/continues/polishes on request.
  const aiAssistMatch = pathname.match(/^\/api\/original-works\/([a-zA-Z0-9]+)\/ai-assist$/);
  if (method === "POST" && aiAssistMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    if (!checkRateLimit("book-ai-assist:" + me.id, 30, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: "Too many AI requests. Please try again in a bit." });
    }
    const rows = await db.select("original_works", { id: "eq." + enc(aiAssistMatch[1]), select: "*" });
    const w = rows && rows[0];
    if (!w) return sendJson(res, 404, { error: "Not found" });
    if (w.author_id !== me.id) return sendJson(res, 403, { error: "Not authorized" });

    const body = await readBody(req);
    const locale = body.locale === "es" ? "es" : "en";
    const instruction = String(body.instruction || "").trim().slice(0, 500);
    const currentText = String(body.currentText || "").slice(0, 8000);
    if (!instruction) return sendJson(res, 400, { error: "Tell the AI what you'd like help with." });

    try {
      const data = await callClaude({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        system:
          "You are a collaborative fiction/nonfiction co-writing assistant embedded in HieloIce's " +
          "'Publish a Book' tool, helping an independent author draft or improve one chapter of their " +
          "own original, unpublished book. Reply " + (locale === "es" ? "in Spanish" : "in English") + ". " +
          "Write only the requested prose/content itself - no preamble, no meta-commentary, no markdown " +
          "headers, just text the author can paste directly into their chapter. Match the tone and style " +
          "already present in their existing text if any is provided. Never reproduce real, copyrighted " +
          "passages from existing published books - only generate original text.",
        messages: [
          {
            role: "user",
            content:
              "Book title: " + (w.title || "(untitled)") + "\nGenre: " + (w.genre || "(unspecified)") +
              (currentText ? "\n\nCurrent chapter text so far:\n" + currentText : "\n\n(This chapter is currently empty.)") +
              "\n\nWhat I need help with: " + instruction,
          },
        ],
      });
      const suggestion = claudeText(data);
      if (!suggestion) throw new Error("Empty AI response");
      return sendJson(res, 200, { suggestion });
    } catch (e) {
      console.error("Book AI-assist failed:", e && e.message);
      return sendJson(res, 502, { error: locale === "es" ? "El asistente de IA no está disponible ahora mismo." : "The AI assistant is unavailable right now." });
    }
  }

  // POST /api/original-works/:id/submit - runs an automated AI first-pass
  // review, and if it looks like genuine original writing, queues the book
  // for our team's human review. Either outcome stays entirely internal -
  // see ORIGINAL_BOOK_PROGRAM_ENABLED - nothing becomes public here.
  const submitMatch = pathname.match(/^\/api\/original-works\/([a-zA-Z0-9]+)\/submit$/);
  if (method === "POST" && submitMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("original_works", { id: "eq." + enc(submitMatch[1]), select: "*" });
    const w = rows && rows[0];
    if (!w) return sendJson(res, 404, { error: "Not found" });
    if (w.author_id !== me.id) return sendJson(res, 403, { error: "Not authorized" });
    if (!["draft", "needs_revision"].includes(w.status)) {
      return sendJson(res, 400, { error: "This book has already been submitted." });
    }

    const chapters = Array.isArray(w.chapters) ? w.chapters : [];
    const totalWords = chapters.reduce(
      (sum, c) => sum + String((c && c.content) || "").trim().split(/\s+/).filter(Boolean).length,
      0
    );
    if (!w.title || !w.synopsis || chapters.length === 0 || totalWords < 300) {
      return sendJson(res, 400, { error: "Add a title, synopsis, and at least one chapter (300+ words) before submitting." });
    }

    const body = await readBody(req);
    const locale = body.locale === "es" ? "es" : "en";
    const manuscript = chapters
      .map((c, i) => "Chapter " + (i + 1) + (c.title ? ": " + c.title : "") + "\n" + (c.content || ""))
      .join("\n\n")
      .slice(0, 12000);

    let verdict = "needs_revision";
    let notes =
      locale === "es"
        ? "No se pudo completar la revisión automática. Intenta de nuevo."
        : "Automated review couldn't complete. Please try again.";
    try {
      const data = await callClaude({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system:
          "You are a first-pass editorial screener for HieloIce's independent-author publishing program. " +
          "Given a manuscript draft, respond with exactly two lines: the first line is either PASS or " +
          "NEEDS_REVISION, and the second line is 2-3 sentences of constructive feedback " +
          (locale === "es" ? "in Spanish" : "in English") + ". PASS means it reads like a genuine, coherent, " +
          "original piece of writing worth a human editor's time (it does not need to be perfect or " +
          "finished). NEEDS_REVISION means it's empty/placeholder text, incoherent, extremely short, or " +
          "appears to be copied verbatim from a well-known published work rather than original writing.",
        messages: [
          {
            role: "user",
            content: "Title: " + w.title + "\nGenre: " + w.genre + "\nSynopsis: " + w.synopsis + "\n\n" + manuscript,
          },
        ],
      });
      const text = claudeText(data);
      const firstLine = (text.split("\n")[0] || "").trim().toUpperCase();
      verdict = firstLine.startsWith("PASS") ? "pass" : "needs_revision";
      notes = text.split("\n").slice(1).join(" ").trim() || notes;
    } catch (e) {
      console.error("Book AI review failed:", e && e.message);
    }

    const now = Date.now();
    const patch = {
      status: verdict === "pass" ? "team_review" : "needs_revision",
      ai_review_verdict: verdict,
      ai_review_notes: notes,
      submitted_at: now,
      ai_reviewed_at: now,
      updated_at: now,
    };
    const updated = await db.update("original_works", { id: "eq." + enc(w.id) }, patch);
    return sendJson(res, 200, originalWorkOut(updated[0]));
  }

  // POST /api/original-works/:id/publish - the genuine final "make it
  // public and for sale" action, only reachable after our team approved
  // the book (status === approved_pending_legal). The whole rest of the
  // journey up to this point is real (writing, AI co-writing, AI review,
  // team review) - per Carlos: "necesito todo el recorrido... pero al
  // momento final... que no se pueda accionar" - so this exact click is
  // the one that stays inert while ORIGINAL_BOOK_PROGRAM_ENABLED is false:
  // it always answers with a friendly "not yet" and never flips the status
  // to published or creates any public/purchasable listing. Flip the flag
  // above once the author program's legal/monetization terms are final;
  // the real publish logic already below is ready to go.
  const publishMatch = pathname.match(/^\/api\/original-works\/([a-zA-Z0-9]+)\/publish$/);
  if (method === "POST" && publishMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("original_works", { id: "eq." + enc(publishMatch[1]), select: "*" });
    const w = rows && rows[0];
    if (!w) return sendJson(res, 404, { error: "Not found" });
    if (w.author_id !== me.id) return sendJson(res, 403, { error: "Not authorized" });
    if (w.status !== "approved_pending_legal") {
      return sendJson(res, 400, { error: "This book isn't approved for publishing yet." });
    }
    if (!ORIGINAL_BOOK_PROGRAM_ENABLED) {
      return sendJson(res, 200, { ok: false, comingSoon: true });
    }
    const updated = await db.update("original_works", { id: "eq." + enc(w.id) }, { status: "published", updated_at: Date.now() });
    return sendJson(res, 200, { ok: true, work: originalWorkOut(updated[0]) });
  }

  // ---- ADS (advertiser carousel) ----
  function adOut(a) {
    const { image_url, link_url, advertiser_name, sort_order, created_at, ...rest } = a;
    return {
      ...rest,
      imageUrl: image_url,
      linkUrl: link_url,
      advertiserName: advertiser_name,
      sortOrder: sort_order,
      createdAt: created_at,
    };
  }

  if (method === "GET" && pathname === "/api/ads") {
    const wantAll = query.all === "1";
    let me = null;
    if (wantAll) me = await getAuthUser(req);
    const params = { order: "sort_order.asc,created_at.desc", select: "*" };
    if (!(wantAll && isOwner(me))) params.active = "eq.true";
    const ads = await db.select("mkt_ads", params);
    return sendJson(res, 200, ads.map(adOut));
  }

  if (method === "POST" && pathname === "/api/ads") {
    const me = await getAuthUser(req);
    if (!isOwner(me)) return sendJson(res, 403, { error: "Not authorized" });
    const body = await readBody(req);
    if (!body.imageUrl || !String(body.imageUrl).trim()) {
      return sendJson(res, 400, { error: "Image URL is required" });
    }
    const ad = {
      id: crypto.randomBytes(8).toString("hex"),
      advertiser_name: String(body.advertiserName || "").trim().slice(0, 80),
      image_url: String(body.imageUrl).trim().slice(0, 1000),
      link_url: String(body.linkUrl || "").trim().slice(0, 1000),
      active: true,
      sort_order: Number(body.sortOrder) || 0,
      created_at: Date.now(),
    };
    await db.insert("mkt_ads", ad);
    notifyAllOptedIn("flashSales", {
      title: ad.advertiser_name ? "Promoción de " + ad.advertiser_name : "Nueva promoción en HieloIce",
      body: "Hay una nueva oferta destacada, ¡échale un vistazo!",
      url: "/#/",
    }).catch(() => {});
    return sendJson(res, 201, adOut(ad));
  }

  const adMatch = pathname.match(/^\/api\/ads\/([a-zA-Z0-9]+)$/);
  if ((method === "PUT" || method === "DELETE") && adMatch) {
    const me = await getAuthUser(req);
    if (!isOwner(me)) return sendJson(res, 403, { error: "Not authorized" });

    if (method === "DELETE") {
      await db.remove("mkt_ads", { id: "eq." + enc(adMatch[1]) });
      return sendJson(res, 200, { ok: true });
    }

    const body = await readBody(req);
    const patch = {};
    if (body.advertiserName !== undefined) patch.advertiser_name = String(body.advertiserName).trim().slice(0, 80);
    if (body.imageUrl !== undefined) patch.image_url = String(body.imageUrl).trim().slice(0, 1000);
    if (body.linkUrl !== undefined) patch.link_url = String(body.linkUrl).trim().slice(0, 1000);
    if (body.active !== undefined) patch.active = !!body.active;
    if (body.sortOrder !== undefined) patch.sort_order = Number(body.sortOrder) || 0;
    const updated = await db.update("mkt_ads", { id: "eq." + enc(adMatch[1]) }, patch);
    return sendJson(res, 200, adOut(updated[0]));
  }

  // GET /api/users/me/media - the logged-in user's own moments + loops,
  // trimmed to just what a picker needs. Built for the podcast episode
  // composer's "turn one of my videos into an episode" option below, but
  // generic enough to reuse anywhere a "pick one of my own clips" UI is
  // needed later.
  if (method === "GET" && pathname === "/api/users/me/media") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const [moments, loops] = await Promise.all([
      db.select("mkt_moments", { user_id: "eq." + enc(me.id), order: "created_at.desc", limit: "40", select: "id,media_url,media_type,caption,title,created_at,is_long_video" }),
      db.select("mkt_loops", { user_id: "eq." + enc(me.id), order: "created_at.desc", limit: "40", select: "id,media_url,media_type,caption,created_at" }),
    ]);
    const out = [
      ...(moments || []).map((m) => ({
        id: m.id,
        source: m.is_long_video ? "video" : "moment",
        mediaType: m.media_type,
        label: m.title || m.caption || "",
        createdAt: m.created_at,
      })),
      ...(loops || []).map((l) => ({
        id: l.id,
        source: "loop",
        mediaType: l.media_type,
        label: l.caption || "",
        createdAt: l.created_at,
      })),
    ].sort((a, b) => b.createdAt - a.createdAt);
    return sendJson(res, 200, out);
  }

  // ---- PODCASTS ----
  // Creating a channel and publishing episodes is 100% free for every user -
  // this is a reach/growth feature (get thousands of people creating and
  // listening), not a paid-hosting one. Real creator monetization (tips,
  // paid memberships, ad-revenue share - the things Spotify/YouTube offer
  // their partners) is intentionally NOT built here yet: it needs its own
  // payment-processor decision (see task #58, still open) and will ship
  // later as an honest "coming soon" state, the same pattern already used
  // for AI-cover-generation and Amazon/eBay Connect elsewhere in the wizard.
  // An episode can be either a freshly uploaded audio/video file, or a reuse
  // of one of the creator's own existing moments/loops/videos (media_url is
  // simply copied over - no re-encoding), so the whole video ecosystem
  // (Moments, Loops, Videos) can feed a podcast channel without re-uploading.
  function podcastChannelOut(c) {
    return {
      id: c.id,
      userId: c.user_id,
      name: c.name,
      description: c.description,
      category: c.category,
      coverImage: c.cover_image,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      followerCount: c.follower_count,
      episodeCount: c.episode_count,
    };
  }

  function podcastEpisodeOut(e) {
    return {
      id: e.id,
      channelId: e.channel_id,
      title: e.title,
      description: e.description,
      mediaType: e.media_type,
      mediaUrl: e.media_url,
      sourceMomentId: e.source_moment_id,
      coverImage: e.cover_image,
      durationSeconds: e.duration_seconds,
      createdAt: e.created_at,
      status: e.status,
      viewCount: e.view_count,
      likeCount: e.like_count,
    };
  }

  async function attachPodcastOwners(channels) {
    const ownerIds = [...new Set(channels.map((c) => c.user_id))];
    if (!ownerIds.length) return channels.map((c) => ({ ...podcastChannelOut(c), ownerName: "", ownerPhoto: null }));
    const owners = await db.select("mkt_users", { id: "in.(" + ownerIds.map(enc).join(",") + ")", select: "id,name,photo" });
    const ownerMap = {};
    (owners || []).forEach((o) => (ownerMap[o.id] = o));
    return channels.map((c) => ({
      ...podcastChannelOut(c),
      ownerName: (ownerMap[c.user_id] || {}).name || "",
      ownerPhoto: (ownerMap[c.user_id] || {}).photo || null,
    }));
  }

  // GET /api/podcasts/mine - the logged-in user's own channel, or null
  if (method === "GET" && pathname === "/api/podcasts/mine") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("podcast_channels", { user_id: "eq." + enc(me.id), select: "*" });
    return sendJson(res, 200, { channel: rows && rows[0] ? podcastChannelOut(rows[0]) : null });
  }

  // GET /api/podcasts?q=&category=&sort=popular|new - the Podcast Library
  if (method === "GET" && pathname === "/api/podcasts") {
    const params = { select: "*", limit: "40" };
    const q = String(query.q || "").trim();
    const category = String(query.category || "").trim();
    if (category) params.category = "eq." + enc(category);
    params.order = query.sort === "new" ? "created_at.desc" : "follower_count.desc,created_at.desc";
    let rows = await db.select("podcast_channels", params);
    if (q) {
      const needle = q.toLowerCase();
      rows = (rows || []).filter((c) => c.name.toLowerCase().includes(needle) || (c.description || "").toLowerCase().includes(needle));
    }
    return sendJson(res, 200, await attachPodcastOwners(rows || []));
  }

  // POST /api/podcasts - create my channel (one per account, always free)
  if (method === "POST" && pathname === "/api/podcasts") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const existing = await db.select("podcast_channels", { user_id: "eq." + enc(me.id), select: "id" });
    if (existing && existing[0]) return sendJson(res, 409, { error: "You already have a podcast channel" });
    const body = await readBody(req);
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return sendJson(res, 400, { error: "A podcast name is required" });
    let coverImage = null;
    if (body.coverImage && String(body.coverImage).startsWith("data:")) {
      try {
        coverImage = await sbStorageUpload("media", "podcasts/covers/" + me.id + "/" + crypto.randomBytes(8).toString("hex") + ".jpg", body.coverImage);
      } catch (e) {
        return sendJson(res, 500, { error: "Could not upload cover image" });
      }
    }
    const now = Date.now();
    const channel = {
      id: crypto.randomBytes(8).toString("hex"),
      user_id: me.id,
      name,
      description: String(body.description || "").trim().slice(0, 500),
      category: String(body.category || "").trim().slice(0, 40),
      cover_image: coverImage,
      created_at: now,
      updated_at: now,
      follower_count: 0,
      episode_count: 0,
    };
    await db.insert("podcast_channels", channel);
    return sendJson(res, 201, podcastChannelOut(channel));
  }

  // GET /api/podcasts/:id - channel detail (enriched with owner + my follow state)
  const podcastChannelMatch = pathname.match(/^\/api\/podcasts\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && podcastChannelMatch) {
    const rows = await db.select("podcast_channels", { id: "eq." + enc(podcastChannelMatch[1]), select: "*" });
    const channel = rows && rows[0];
    if (!channel) return sendJson(res, 404, { error: "Not found" });
    const me = await getAuthUser(req);
    const [owners, myFollow] = await Promise.all([
      db.select("mkt_users", { id: "eq." + enc(channel.user_id), select: "id,name,photo" }),
      me ? db.select("podcast_follows", { channel_id: "eq." + enc(channel.id), user_id: "eq." + enc(me.id), select: "id" }) : Promise.resolve([]),
    ]);
    const owner = (owners || [])[0] || {};
    return sendJson(res, 200, {
      ...podcastChannelOut(channel),
      ownerName: owner.name || "",
      ownerPhoto: owner.photo || null,
      isMine: !!(me && me.id === channel.user_id),
      isFollowing: !!(myFollow && myFollow[0]),
    });
  }

  // PUT /api/podcasts/:id - update my channel
  if (method === "PUT" && podcastChannelMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("podcast_channels", { id: "eq." + enc(podcastChannelMatch[1]), select: "*" });
    const channel = rows && rows[0];
    if (!channel) return sendJson(res, 404, { error: "Not found" });
    if (channel.user_id !== me.id) return sendJson(res, 403, { error: "Not authorized" });
    const body = await readBody(req);
    const patch = { updated_at: Date.now() };
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 80);
      if (!name) return sendJson(res, 400, { error: "A podcast name is required" });
      patch.name = name;
    }
    if (body.description !== undefined) patch.description = String(body.description).trim().slice(0, 500);
    if (body.category !== undefined) patch.category = String(body.category).trim().slice(0, 40);
    if (body.coverImage !== undefined && String(body.coverImage).startsWith("data:")) {
      try {
        patch.cover_image = await sbStorageUpload("media", "podcasts/covers/" + me.id + "/" + crypto.randomBytes(8).toString("hex") + ".jpg", body.coverImage);
      } catch (e) {
        return sendJson(res, 500, { error: "Could not upload cover image" });
      }
    }
    const updated = await db.update("podcast_channels", { id: "eq." + enc(channel.id) }, patch);
    return sendJson(res, 200, podcastChannelOut(updated[0]));
  }

  // POST /api/podcasts/:id/follow - toggle follow/unfollow
  const podcastFollowMatch = pathname.match(/^\/api\/podcasts\/([a-zA-Z0-9]+)\/follow$/);
  if (method === "POST" && podcastFollowMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const channelId = podcastFollowMatch[1];
    const existing = await db.select("podcast_follows", { channel_id: "eq." + enc(channelId), user_id: "eq." + enc(me.id), select: "id" });
    if (existing && existing[0]) {
      await db.remove("podcast_follows", { id: "eq." + enc(existing[0].id) });
      await db.rpc("podcast_increment_counter", { p_table: "podcast_channels", p_id: channelId, p_column: "follower_count", p_delta: -1 });
      return sendJson(res, 200, { following: false });
    }
    await db.insert("podcast_follows", {
      id: crypto.randomBytes(8).toString("hex"),
      channel_id: channelId,
      user_id: me.id,
      created_at: Date.now(),
    });
    await db.rpc("podcast_increment_counter", { p_table: "podcast_channels", p_id: channelId, p_column: "follower_count", p_delta: 1 });
    return sendJson(res, 200, { following: true });
  }

  // GET /api/podcasts/:id/episodes - a channel's episode list
  const podcastEpisodesMatch = pathname.match(/^\/api\/podcasts\/([a-zA-Z0-9]+)\/episodes$/);
  if (method === "GET" && podcastEpisodesMatch) {
    const rows = await db.select("podcast_episodes", {
      channel_id: "eq." + enc(podcastEpisodesMatch[1]),
      status: "eq.published",
      order: "created_at.desc",
      select: "*",
    });
    return sendJson(res, 200, (rows || []).map(podcastEpisodeOut));
  }

  // POST /api/podcasts/:id/episodes - publish a new episode (owner only)
  // Body is either { title, description, mediaType, media (data: URL) } for a
  // fresh upload, or { title, description, sourceMomentId } to reuse an
  // existing moment/loop/video the creator already owns.
  if (method === "POST" && podcastEpisodesMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const channelRows = await db.select("podcast_channels", { id: "eq." + enc(podcastEpisodesMatch[1]), select: "*" });
    const channel = channelRows && channelRows[0];
    if (!channel) return sendJson(res, 404, { error: "Podcast not found" });
    if (channel.user_id !== me.id) return sendJson(res, 403, { error: "Not authorized" });
    const body = await readBody(req);
    const title = String(body.title || "").trim().slice(0, 120);
    if (!title) return sendJson(res, 400, { error: "An episode title is required" });

    let mediaType, mediaUrl, durationSeconds = null, coverImage = null, sourceMomentId = null;

    if (body.sourceMomentId) {
      // Reuse an existing moment/loop/video the creator already owns -
      // no re-encoding, just point the episode at the same media_url.
      let source = (await db.select("mkt_moments", { id: "eq." + enc(body.sourceMomentId), select: "*" }))[0];
      if (!source) source = (await db.select("mkt_loops", { id: "eq." + enc(body.sourceMomentId), select: "*" }))[0];
      if (!source) return sendJson(res, 404, { error: "That video/moment/loop was not found" });
      if (source.user_id !== me.id) return sendJson(res, 403, { error: "You can only turn your own videos/moments/loops into episodes" });
      mediaType = source.media_type === "video" ? "video" : "audio";
      mediaUrl = source.media_url;
      sourceMomentId = source.id;
      durationSeconds = source.trim_end_sec && source.trim_start_sec !== undefined ? source.trim_end_sec - source.trim_start_sec : null;
    } else {
      mediaType = body.mediaType === "video" ? "video" : "audio";
      if (!body.media || !String(body.media).startsWith("data:")) {
        return sendJson(res, 400, { error: "Audio or video file is required" });
      }
      const ext = mediaType === "video" ? ".mp4" : ".mp3";
      try {
        mediaUrl = await sbStorageUpload("media", "podcasts/" + me.id + "/" + crypto.randomBytes(8).toString("hex") + ext, body.media);
      } catch (e) {
        return sendJson(res, 500, { error: "Could not upload episode media" });
      }
      if (body.durationSeconds !== undefined) {
        const d = Number(body.durationSeconds);
        if (Number.isFinite(d) && d > 0) durationSeconds = d;
      }
    }
    if (body.coverImage && String(body.coverImage).startsWith("data:")) {
      try {
        coverImage = await sbStorageUpload("media", "podcasts/covers/" + me.id + "/" + crypto.randomBytes(8).toString("hex") + ".jpg", body.coverImage);
      } catch (e) {
        // Non-fatal - falls back to the channel's own cover client-side.
      }
    }
    const episode = {
      id: crypto.randomBytes(8).toString("hex"),
      channel_id: channel.id,
      title,
      description: String(body.description || "").trim().slice(0, 1000),
      media_type: mediaType,
      media_url: mediaUrl,
      source_moment_id: sourceMomentId,
      cover_image: coverImage,
      duration_seconds: durationSeconds,
      created_at: Date.now(),
      status: "published",
      view_count: 0,
      like_count: 0,
    };
    await db.insert("podcast_episodes", episode);
    await db.rpc("podcast_increment_counter", { p_table: "podcast_channels", p_id: channel.id, p_column: "episode_count", p_delta: 1 });
    return sendJson(res, 201, podcastEpisodeOut(episode));
  }

  // GET /api/podcast-episodes/feed?sort=trending|new - cross-channel discovery
  // feed for the Podcast Library's home tab.
  if (method === "GET" && pathname === "/api/podcast-episodes/feed") {
    const order = query.sort === "trending" ? "view_count.desc,created_at.desc" : "created_at.desc";
    const rows = await db.select("podcast_episodes", { status: "eq.published", order, limit: "40", select: "*" });
    const channelIds = [...new Set((rows || []).map((e) => e.channel_id))];
    let channelMap = {};
    if (channelIds.length) {
      const channels = await db.select("podcast_channels", { id: "in.(" + channelIds.map(enc).join(",") + ")", select: "*" });
      const enriched = await attachPodcastOwners(channels || []);
      enriched.forEach((c) => (channelMap[c.id] = c));
    }
    return sendJson(
      res,
      200,
      (rows || []).map((e) => ({ ...podcastEpisodeOut(e), channel: channelMap[e.channel_id] || null }))
    );
  }

  // GET /api/podcast-episodes/:id - single episode detail
  const podcastEpisodeMatch = pathname.match(/^\/api\/podcast-episodes\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && podcastEpisodeMatch) {
    const rows = await db.select("podcast_episodes", { id: "eq." + enc(podcastEpisodeMatch[1]), select: "*" });
    const episode = rows && rows[0];
    if (!episode) return sendJson(res, 404, { error: "Not found" });
    const me = await getAuthUser(req);
    const [channelRows, myLike] = await Promise.all([
      db.select("podcast_channels", { id: "eq." + enc(episode.channel_id), select: "*" }),
      me ? db.select("podcast_episode_likes", { episode_id: "eq." + enc(episode.id), user_id: "eq." + enc(me.id), select: "id" }) : Promise.resolve([]),
    ]);
    const channel = (channelRows || [])[0];
    const channelOut = channel ? (await attachPodcastOwners([channel]))[0] : null;
    return sendJson(res, 200, {
      ...podcastEpisodeOut(episode),
      channel: channelOut,
      likedByMe: !!(myLike && myLike[0]),
    });
  }

  // DELETE /api/podcast-episodes/:id - owner only
  if (method === "DELETE" && podcastEpisodeMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("podcast_episodes", { id: "eq." + enc(podcastEpisodeMatch[1]), select: "*" });
    const episode = rows && rows[0];
    if (!episode) return sendJson(res, 404, { error: "Not found" });
    const channelRows = await db.select("podcast_channels", { id: "eq." + enc(episode.channel_id), select: "*" });
    const channel = channelRows && channelRows[0];
    if (!channel || channel.user_id !== me.id) return sendJson(res, 403, { error: "Not authorized" });
    await db.remove("podcast_episodes", { id: "eq." + enc(episode.id) });
    await db.rpc("podcast_increment_counter", { p_table: "podcast_channels", p_id: channel.id, p_column: "episode_count", p_delta: -1 });
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/podcast-episodes/:id/view - plays count as views (like a
  // moment/loop watch event, not deduplicated per-viewer - a replay is
  // another view, same as YouTube/Spotify).
  const podcastEpisodeViewMatch = pathname.match(/^\/api\/podcast-episodes\/([a-zA-Z0-9]+)\/view$/);
  if (method === "POST" && podcastEpisodeViewMatch) {
    const me = await getAuthUser(req);
    const episodeId = podcastEpisodeViewMatch[1];
    await db.insert("podcast_episode_views", {
      episode_id: episodeId,
      viewer_id: me ? me.id : null,
      created_at: Date.now(),
    });
    await db.rpc("podcast_increment_counter", { p_table: "podcast_episodes", p_id: episodeId, p_column: "view_count", p_delta: 1 });
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/podcast-episodes/:id/like - toggle like
  const podcastEpisodeLikeMatch = pathname.match(/^\/api\/podcast-episodes\/([a-zA-Z0-9]+)\/like$/);
  if (method === "POST" && podcastEpisodeLikeMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const episodeId = podcastEpisodeLikeMatch[1];
    const existing = await db.select("podcast_episode_likes", { episode_id: "eq." + enc(episodeId), user_id: "eq." + enc(me.id), select: "id" });
    if (existing && existing[0]) {
      await db.remove("podcast_episode_likes", { id: "eq." + enc(existing[0].id) });
      await db.rpc("podcast_increment_counter", { p_table: "podcast_episodes", p_id: episodeId, p_column: "like_count", p_delta: -1 });
      return sendJson(res, 200, { liked: false });
    }
    await db.insert("podcast_episode_likes", {
      id: crypto.randomBytes(8).toString("hex"),
      episode_id: episodeId,
      user_id: me.id,
      created_at: Date.now(),
    });
    await db.rpc("podcast_increment_counter", { p_table: "podcast_episodes", p_id: episodeId, p_column: "like_count", p_delta: 1 });
    return sendJson(res, 200, { liked: true });
  }

  // ---- DATING ----
  // Separate, opt-in profile (Carlos's explicit choice: not merged into the
  // main HieloIce profile, off by default). Hard 18+ enforced on every
  // route below by recomputing from mkt_users.birthdate - never trusted
  // from the client. Blocking reuses the existing generic
  // mkt_user_blocks/isBlockedEitherWay infrastructure and reporting reuses
  // the existing POST /api/reports (targetType "user") - no new
  // block/report endpoints needed for Dating specifically. Messaging
  // between matches reuses the existing mkt_messages system
  // (#/messages/:id), which already supports photo/video attachments.

  function datingProfileOut(p) {
    return {
      userId: p.user_id,
      bio: p.bio || "",
      photos: p.photos || [],
      interests: p.interests || [],
      gender: p.gender || "",
      seeking: p.seeking || [],
      active: !!p.active,
      hasLocation: typeof p.lat === "number" && typeof p.lng === "number",
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }

  // Haversine distance in km between two lat/lng points.
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Carlos's explicit choice: only approximate distance is ever sent to the
  // client - raw lat/lng of other users must never be exposed, and even
  // this rounds down into coarse buckets rather than a precise number.
  function approximateDistanceLabel(km) {
    if (km < 1) return "<1 km";
    if (km < 50) return Math.round(km) + " km";
    return "50+ km";
  }

  // GET /api/dating/profile - my own Dating profile (or null if never set up)
  if (method === "GET" && pathname === "/api/dating/profile") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("dating_profiles", { user_id: "eq." + enc(me.id), select: "*" });
    return sendJson(res, 200, {
      profile: rows && rows[0] ? datingProfileOut(rows[0]) : null,
      isAdult: isAdultUser(me),
      needsBirthdate: !me.birthdate,
    });
  }

  // PUT /api/dating/profile - create/update/activate my Dating profile.
  // Body: { bio, photos: [dataUrl|url,...], interests: [], gender, seeking: [], lat, lng, active }
  if (method === "PUT" && pathname === "/api/dating/profile") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    if (!isAdultUser(me)) {
      return sendJson(res, 403, { error: "You must confirm you are 18+ before using Dating.", needsBirthdate: !me.birthdate });
    }
    const body = await readBody(req);
    const existingRows = await db.select("dating_profiles", { user_id: "eq." + enc(me.id), select: "*" });
    const existing = existingRows && existingRows[0];

    // Photos: keep already-hosted URLs as-is, upload new data: URLs to
    // Storage - same incremental-photo pattern used elsewhere in the app.
    let photos = existing ? existing.photos || [] : [];
    if (Array.isArray(body.photos)) {
      const uploaded = [];
      for (const p of body.photos.slice(0, 6)) {
        if (typeof p !== "string") continue;
        if (p.startsWith("data:")) {
          try {
            uploaded.push(await sbStorageUpload("media", "dating/" + me.id + "/" + crypto.randomBytes(8).toString("hex") + ".jpg", p));
          } catch (e) {
            // skip a photo that fails to upload rather than failing the whole save
          }
        } else {
          uploaded.push(p.slice(0, 1000));
        }
      }
      photos = uploaded;
    }

    const now = Date.now();
    const patch = {
      bio: String(body.bio || "").trim().slice(0, 500),
      photos,
      interests: Array.isArray(body.interests)
        ? body.interests.map((s) => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 15)
        : existing
          ? existing.interests
          : [],
      gender: String(body.gender || (existing ? existing.gender : "") || "").slice(0, 30),
      seeking: Array.isArray(body.seeking) ? body.seeking.map((s) => String(s).slice(0, 30)).slice(0, 5) : existing ? existing.seeking : [],
      active: body.active !== undefined ? !!body.active : existing ? existing.active : true,
      updated_at: now,
    };
    if (typeof body.lat === "number" && typeof body.lng === "number" && Number.isFinite(body.lat) && Number.isFinite(body.lng)) {
      patch.lat = body.lat;
      patch.lng = body.lng;
    }

    let saved;
    if (existing) {
      const updated = await db.update("dating_profiles", { user_id: "eq." + enc(me.id) }, patch);
      saved = updated[0];
    } else {
      saved = { user_id: me.id, created_at: now, lat: null, lng: null, ...patch };
      await db.insert("dating_profiles", saved);
    }
    return sendJson(res, 200, { profile: datingProfileOut(saved) });
  }

  // POST /api/dating/deactivate - turn Dating off (hide from discovery),
  // keeps existing matches/data intact so re-activating restores everything.
  if (method === "POST" && pathname === "/api/dating/deactivate") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    await db.update("dating_profiles", { user_id: "eq." + enc(me.id) }, { active: false, updated_at: Date.now() });
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/dating/discover - candidate cards to swipe on, ranked by
  // shared interests. Excludes: myself, anyone already swiped, blocked
  // (either direction), or already matched. Distance is always the coarse
  // approximate label, never raw coordinates.
  if (method === "GET" && pathname === "/api/dating/discover") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    if (!isAdultUser(me)) return sendJson(res, 403, { error: "You must confirm you are 18+ before using Dating." });

    const myRows = await db.select("dating_profiles", { user_id: "eq." + enc(me.id), select: "*" });
    const myProfile = myRows && myRows[0];
    if (!myProfile || !myProfile.active) return sendJson(res, 200, []);

    const [swipedRows, blockedRows, matchedRows] = await Promise.all([
      db.select("dating_swipes", { swiper_id: "eq." + enc(me.id), select: "target_id" }),
      db.select("mkt_user_blocks", { or: "(blocker_id.eq." + enc(me.id) + ",blocked_id.eq." + enc(me.id) + ")", select: "blocker_id,blocked_id" }),
      db.select("dating_matches", { or: "(user_a_id.eq." + enc(me.id) + ",user_b_id.eq." + enc(me.id) + ")", unmatched_at: "is.null", select: "user_a_id,user_b_id" }),
    ]);
    const excludeIds = new Set([me.id]);
    (swipedRows || []).forEach((r) => excludeIds.add(r.target_id));
    (blockedRows || []).forEach((r) => {
      excludeIds.add(r.blocker_id);
      excludeIds.add(r.blocked_id);
    });
    (matchedRows || []).forEach((r) => {
      excludeIds.add(r.user_a_id);
      excludeIds.add(r.user_b_id);
    });

    const candidateRows = await db.select("dating_profiles", { active: "eq.true", limit: "200", select: "*" });
    const candidates = (candidateRows || []).filter((c) => !excludeIds.has(c.user_id));

    const userIds = candidates.map((c) => c.user_id);
    let userMap = {};
    if (userIds.length) {
      const users = await db.select("mkt_users", { id: "in.(" + userIds.map(enc).join(",") + ")", select: "id,name,photo,birthdate" });
      (users || []).forEach((u) => (userMap[u.id] = u));
    }

    const myInterests = new Set((myProfile.interests || []).map((s) => String(s).toLowerCase()));
    const scored = candidates
      .map((c) => {
        const u = userMap[c.user_id];
        // Re-verify 18+ on the candidate too - never rely on a stored
        // profile alone for this guarantee.
        if (!u || !u.birthdate || ageFromBirthdateMs(u.birthdate, Date.now()) < MIN_AGE_YEARS) return null;
        let distanceLabel = null;
        if (typeof myProfile.lat === "number" && typeof myProfile.lng === "number" && typeof c.lat === "number" && typeof c.lng === "number") {
          distanceLabel = approximateDistanceLabel(haversineKm(myProfile.lat, myProfile.lng, c.lat, c.lng));
        }
        const sharedInterestCount = (c.interests || []).filter((i) => myInterests.has(String(i).toLowerCase())).length;
        return {
          userId: c.user_id,
          name: u.name,
          bio: c.bio || "",
          photos: c.photos && c.photos.length ? c.photos : u.photo ? [u.photo] : [],
          interests: c.interests || [],
          distance: distanceLabel,
          sharedInterestCount,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.sharedInterestCount - a.sharedInterestCount);

    return sendJson(res, 200, scored.slice(0, 30));
  }

  // POST /api/dating/swipe { targetId, direction: 'like'|'pass' }
  // Creates a mutual match (and notification-worthy event) when both sides
  // have liked each other.
  if (method === "POST" && pathname === "/api/dating/swipe") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    if (!isAdultUser(me)) return sendJson(res, 403, { error: "You must confirm you are 18+ before using Dating." });
    const body = await readBody(req);
    const targetId = String(body.targetId || "");
    const direction = body.direction;
    if (!targetId || !["like", "pass"].includes(direction)) return sendJson(res, 400, { error: "Invalid swipe" });
    if (targetId === me.id) return sendJson(res, 400, { error: "Invalid target" });
    if (await isBlockedEitherWay(me.id, targetId)) return sendJson(res, 403, { error: "Not available" });

    const existing = await db.select("dating_swipes", { swiper_id: "eq." + enc(me.id), target_id: "eq." + enc(targetId), select: "id" });
    if (existing && existing[0]) {
      await db.update("dating_swipes", { id: "eq." + enc(existing[0].id) }, { direction, created_at: Date.now() });
    } else {
      await db.insert("dating_swipes", { id: crypto.randomBytes(8).toString("hex"), swiper_id: me.id, target_id: targetId, direction, created_at: Date.now() });
    }

    let matched = false;
    let matchId = null;
    if (direction === "like") {
      const theirSwipe = await db.select("dating_swipes", { swiper_id: "eq." + enc(targetId), target_id: "eq." + enc(me.id), direction: "eq.like", select: "id" });
      if (theirSwipe && theirSwipe[0]) {
        const [a, b] = [me.id, targetId].sort();
        const already = await db.select("dating_matches", { user_a_id: "eq." + enc(a), user_b_id: "eq." + enc(b), select: "id,unmatched_at" });
        if (already && already[0] && !already[0].unmatched_at) {
          matched = true;
          matchId = already[0].id;
        } else if (already && already[0]) {
          // Re-matching after a prior unmatch: revive the same row.
          await db.update("dating_matches", { id: "eq." + enc(already[0].id) }, { unmatched_at: null, unmatched_by: null, created_at: Date.now() });
          matched = true;
          matchId = already[0].id;
        } else {
          const match = { id: crypto.randomBytes(8).toString("hex"), user_a_id: a, user_b_id: b, created_at: Date.now(), unmatched_at: null, unmatched_by: null };
          await db.insert("dating_matches", match);
          matched = true;
          matchId = match.id;
        }
      }
    }
    return sendJson(res, 200, { matched, matchId });
  }

  // GET /api/dating/matches - my active (not-unmatched) matches, with the
  // other person's basic info, newest first.
  if (method === "GET" && pathname === "/api/dating/matches") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("dating_matches", {
      or: "(user_a_id.eq." + enc(me.id) + ",user_b_id.eq." + enc(me.id) + ")",
      unmatched_at: "is.null",
      order: "created_at.desc",
      select: "*",
    });
    const otherIds = (rows || []).map((m) => (m.user_a_id === me.id ? m.user_b_id : m.user_a_id));
    let userMap = {};
    if (otherIds.length) {
      const users = await db.select("mkt_users", { id: "in.(" + otherIds.map(enc).join(",") + ")", select: "id,name,photo" });
      (users || []).forEach((u) => (userMap[u.id] = u));
    }
    const out = (rows || [])
      .map((m) => {
        const otherId = m.user_a_id === me.id ? m.user_b_id : m.user_a_id;
        const u = userMap[otherId];
        if (!u) return null;
        return { matchId: m.id, userId: otherId, name: u.name, photo: u.photo, matchedAt: m.created_at };
      })
      .filter(Boolean);
    return sendJson(res, 200, out);
  }

  // POST /api/dating/matches/:id/unmatch - either side can end a match at
  // any time; this does not block or report the other person, just ends
  // the connection (blocking/reporting are separate, existing actions).
  const datingUnmatchMatch = pathname.match(/^\/api\/dating\/matches\/([a-zA-Z0-9]+)\/unmatch$/);
  if (method === "POST" && datingUnmatchMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const rows = await db.select("dating_matches", { id: "eq." + enc(datingUnmatchMatch[1]), select: "*" });
    const match = rows && rows[0];
    if (!match) return sendJson(res, 404, { error: "Not found" });
    if (match.user_a_id !== me.id && match.user_b_id !== me.id) return sendJson(res, 403, { error: "Not authorized" });
    await db.update("dating_matches", { id: "eq." + enc(match.id) }, { unmatched_at: Date.now(), unmatched_by: me.id });
    return sendJson(res, 200, { ok: true });
  }

  // ---- ADMIN (role === 'admin' only, or the legacy OWNER_EMAIL account) ----
  if (pathname.startsWith("/api/admin/")) {
    const me = await getAuthUser(req);
    if (!isAdmin(me)) return sendJson(res, 403, { error: "Not authorized" });

    // GET /api/admin/users?q=&suspended=true&flagged=true
    if (method === "GET" && pathname === "/api/admin/users") {
      const q = String(query.q || "").trim();
      const params = {
        select: "id,name,email,phone,photo,role,suspended,suspended_reason,flagged,created_at",
        order: "created_at.desc",
        limit: "50",
      };
      if (q) params.or = "(name.ilike.*" + enc(q) + "*,email.ilike.*" + enc(q) + "*)";
      if (query.suspended === "true") params.suspended = "eq.true";
      if (query.flagged === "true") params.flagged = "eq.true";
      const rows = await db.select("mkt_users", params);
      return sendJson(
        res,
        200,
        (rows || []).map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone || "",
          photo: u.photo || null,
          role: u.role || "user",
          suspended: !!u.suspended,
          suspendedReason: u.suspended_reason || "",
          flagged: !!u.flagged,
          createdAt: u.created_at,
        }))
      );
    }

    // PUT /api/admin/users/:id  { role?, suspended?, suspendedReason? }
    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9]+)$/);
    if (method === "PUT" && adminUserMatch) {
      const targetId = adminUserMatch[1];
      const body = await readBody(req);
      const patch = {};
      if (body.role !== undefined) {
        if (!["user", "moderator", "support", "admin"].includes(body.role)) {
          return sendJson(res, 400, { error: "Invalid role" });
        }
        if (targetId === me.id && body.role !== "admin") {
          return sendJson(res, 400, { error: "You cannot remove your own admin role" });
        }
        patch.role = body.role;
      }
      if (body.suspended !== undefined) {
        if (targetId === me.id && body.suspended) {
          return sendJson(res, 400, { error: "You cannot suspend your own account" });
        }
        patch.suspended = !!body.suspended;
        patch.suspended_reason = body.suspended ? String(body.suspendedReason || "").slice(0, 300) : null;
        patch.suspended_at = body.suspended ? Date.now() : null;
      }
      if (!Object.keys(patch).length) return sendJson(res, 400, { error: "Nothing to update" });
      const updated = await db.update("mkt_users", { id: "eq." + enc(targetId) }, patch);
      if (!updated || !updated[0]) return sendJson(res, 404, { error: "User not found" });
      const u = updated[0];
      return sendJson(res, 200, {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role || "user",
        suspended: !!u.suspended,
        suspendedReason: u.suspended_reason || "",
      });
    }

    // GET /api/admin/products?q=&status=&flagged=true
    if (method === "GET" && pathname === "/api/admin/products") {
      const q = String(query.q || "").trim();
      const params = {
        select: "id,title,price,category,status,flagged,seller_id,created_at",
        order: "created_at.desc",
        limit: "50",
      };
      if (q) params.title = "ilike.*" + enc(q) + "*";
      if (query.status) params.status = "eq." + enc(query.status);
      if (query.flagged === "true") params.flagged = "eq.true";
      const rows = await db.select("mkt_products", params);
      const sellerIds = [...new Set((rows || []).map((r) => r.seller_id))];
      let sellers = [];
      if (sellerIds.length) {
        sellers = await db.select("mkt_users", { id: "in.(" + sellerIds.map(enc).join(",") + ")", select: "id,name,email" });
      }
      const sellerMap = {};
      (sellers || []).forEach((s) => {
        sellerMap[s.id] = s;
      });
      return sendJson(
        res,
        200,
        (rows || []).map((p) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          category: p.category,
          status: p.status,
          flagged: !!p.flagged,
          createdAt: p.created_at,
          sellerId: p.seller_id,
          sellerName: sellerMap[p.seller_id] ? sellerMap[p.seller_id].name : "Unknown",
          sellerEmail: sellerMap[p.seller_id] ? sellerMap[p.seller_id].email : "",
        }))
      );
    }

    // PUT/DELETE /api/admin/products/:id (bypasses the ownership check regular sellers are subject to)
    const adminProductMatch = pathname.match(/^\/api\/admin\/products\/([a-zA-Z0-9]+)$/);
    if ((method === "PUT" || method === "DELETE") && adminProductMatch) {
      const products = await db.select("mkt_products", { id: "eq." + enc(adminProductMatch[1]), select: "*" });
      const p = products && products[0];
      if (!p) return sendJson(res, 404, { error: "Product not found" });

      if (method === "DELETE") {
        await db.remove("mkt_products", { id: "eq." + enc(p.id) });
        return sendJson(res, 200, { ok: true });
      }

      const body = await readBody(req);
      const patch = {};
      if (body.title !== undefined) patch.title = String(body.title).trim().slice(0, 140);
      if (body.description !== undefined) patch.description = String(body.description).slice(0, 3000);
      if (body.price !== undefined) patch.price = Number(body.price) || 0;
      if (body.category !== undefined && CATEGORIES.includes(body.category)) patch.category = body.category;
      if (body.status !== undefined && ["active", "reserved", "sold"].includes(body.status)) {
        patch.status = body.status;
        patch.status_changed_at = Date.now();
      }
      if (body.flagged !== undefined) patch.flagged = !!body.flagged;
      const updated = await db.update("mkt_products", { id: "eq." + enc(p.id) }, patch);
      return sendJson(res, 200, productOut(updated[0]));
    }

    // GET /api/admin/reports?status=open
    if (method === "GET" && pathname === "/api/admin/reports") {
      const params = { select: "*", order: "created_at.desc", limit: "50" };
      params.status = "eq." + enc(query.status || "open");
      const rows = await db.select("mkt_reports", params);

      const reporterIds = [...new Set((rows || []).map((r) => r.reporter_user_id))];
      let reporters = [];
      if (reporterIds.length) {
        reporters = await db.select("mkt_users", { id: "in.(" + reporterIds.map(enc).join(",") + ")", select: "id,name" });
      }
      const reporterMap = {};
      (reporters || []).forEach((u) => {
        reporterMap[u.id] = u.name;
      });

      const productIds = [...new Set((rows || []).filter((r) => r.target_type === "product").map((r) => r.target_id))];
      const userTargetIds = [...new Set((rows || []).filter((r) => r.target_type === "user").map((r) => r.target_id))];
      let targetProducts = [];
      let targetUsers = [];
      if (productIds.length) {
        targetProducts = await db.select("mkt_products", { id: "in.(" + productIds.map(enc).join(",") + ")", select: "id,title" });
      }
      if (userTargetIds.length) {
        targetUsers = await db.select("mkt_users", { id: "in.(" + userTargetIds.map(enc).join(",") + ")", select: "id,name" });
      }
      const productMap = {};
      (targetProducts || []).forEach((p) => {
        productMap[p.id] = p.title;
      });
      const userMap = {};
      (targetUsers || []).forEach((u) => {
        userMap[u.id] = u.name;
      });

      return sendJson(
        res,
        200,
        (rows || []).map((r) => ({
          id: r.id,
          reporterUserId: r.reporter_user_id,
          reporterName: reporterMap[r.reporter_user_id] || "Unknown",
          targetType: r.target_type,
          targetId: r.target_id,
          targetLabel:
            r.target_type === "product"
              ? productMap[r.target_id] || "(deleted listing)"
              : userMap[r.target_id] || "(deleted user)",
          reason: r.reason,
          description: r.description || "",
          status: r.status,
          resolutionNote: r.resolution_note || "",
          createdAt: r.created_at,
          resolvedAt: r.resolved_at || null,
        }))
      );
    }

    // PUT /api/admin/reports/:id  { status: 'resolved'|'dismissed'|'open', resolutionNote? }
    const adminReportMatch = pathname.match(/^\/api\/admin\/reports\/([a-zA-Z0-9]+)$/);
    if (method === "PUT" && adminReportMatch) {
      const body = await readBody(req);
      if (!["resolved", "dismissed", "open"].includes(body.status)) {
        return sendJson(res, 400, { error: "Invalid status" });
      }
      const patch = {
        status: body.status,
        resolution_note: String(body.resolutionNote || "").slice(0, 500),
        resolved_at: body.status === "open" ? null : Date.now(),
        resolved_by: body.status === "open" ? null : me.id,
      };
      const updated = await db.update("mkt_reports", { id: "eq." + enc(adminReportMatch[1]) }, patch);
      if (!updated || !updated[0]) return sendJson(res, 404, { error: "Report not found" });
      return sendJson(res, 200, { ok: true });
    }

    // GET /api/admin/original-works?status=team_review (defaults to team_review)
    if (method === "GET" && pathname === "/api/admin/original-works") {
      const params = { select: "*", order: "submitted_at.desc", limit: "50" };
      params.status = "eq." + enc(String(query.status || "team_review"));
      const rows = await db.select("original_works", params);
      const authorIds = [...new Set((rows || []).map((w) => w.author_id))];
      let authorMap = {};
      if (authorIds.length) {
        const authors = await db.select("mkt_users", { id: "in.(" + authorIds.map(enc).join(",") + ")", select: "id,name,email" });
        (authors || []).forEach((a) => {
          authorMap[a.id] = { name: a.name, email: a.email };
        });
      }
      return sendJson(
        res,
        200,
        (rows || []).map((w) => ({
          ...originalWorkOut(w),
          authorName: (authorMap[w.author_id] || {}).name || "Unknown",
          authorEmail: (authorMap[w.author_id] || {}).email || "",
        }))
      );
    }

    // POST /api/admin/original-works/:id/decision { decision: 'approve'|'reject', notes? }
    // "approve" never makes the book public or purchasable - see
    // ORIGINAL_BOOK_PROGRAM_ENABLED above - it only tells the author the
    // team liked it, and moves status to approved_pending_legal.
    const adminWorkDecisionMatch = pathname.match(/^\/api\/admin\/original-works\/([a-zA-Z0-9]+)\/decision$/);
    if (method === "POST" && adminWorkDecisionMatch) {
      const body = await readBody(req);
      if (!["approve", "reject"].includes(body.decision)) return sendJson(res, 400, { error: "Invalid decision" });
      const rows = await db.select("original_works", { id: "eq." + enc(adminWorkDecisionMatch[1]), select: "*" });
      const w = rows && rows[0];
      if (!w) return sendJson(res, 404, { error: "Not found" });
      const now = Date.now();
      const patch = {
        status: body.decision === "approve" ? "approved_pending_legal" : "rejected",
        team_decision: body.decision,
        team_decision_notes: String(body.notes || "").slice(0, 1000),
        team_decision_by: me.id,
        team_decision_at: now,
        updated_at: now,
      };
      const updated = await db.update("original_works", { id: "eq." + enc(w.id) }, patch);
      return sendJson(res, 200, originalWorkOut(updated[0]));
    }

    return sendJson(res, 404, { error: "Route not found" });
  }

  return sendJson(res, 404, { error: "Route not found" });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, pathname, parsed.query);
    } catch (e) {
      sendJson(res, e.status || 500, { error: e.message || "Internal server error" });
    }
    return;
  }

  if (req.method === "GET") {
    return serveStatic(req, res, pathname);
  }

  sendJson(res, 405, { error: "Method not allowed" });
});

// Attach the chat WebSocket server (see "realtime chat" section above) to
// this SAME http.Server/port - Render only exposes one port per service, so
// this deliberately reuses the existing server instance rather than
// listening separately. Any upgrade request to a path other than /ws (i.e.
// everything else) is left alone/destroyed, never handled here.
server.on("upgrade", (req, socket, head) => {
  const pathname = url.parse(req.url).pathname;
  if (pathname !== WS_PATH) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// Reminder sweep: nudge sellers whose listing has been "reserved" for 3+ days.
// No external cron needed - this Node process runs continuously on Render.
setInterval(async () => {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
    const threshold = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const stale = await db.select("mkt_products", {
      status: "eq.reserved",
      status_changed_at: "lt." + threshold,
      reminder_sent_at: "is.null",
      select: "id,seller_id,title",
    });
    for (const p of stale) {
      await notifyUser(p.seller_id, "reminders", {
        title: "Recordatorio de HieloIce",
        body: '"' + p.title + '" lleva reservado varios días. ¿Ya se concretó la venta?',
        url: "/#/product/" + p.id,
      });
      await db.update("mkt_products", { id: "eq." + enc(p.id) }, { reminder_sent_at: Date.now() }).catch(() => {});
    }
  } catch (e) {
    console.error("reminder sweep failed:", e.message);
  }
}, 6 * 60 * 60 * 1000).unref();

// Moment cleanup - PERMANENT MOMENTS (2026-08-18): this used to hard-delete
// mkt_moments rows past their 24h expires_at every hour, the same way
// Instagram/FB Stories or Snapchat expire content. Product decision: the
// main Moments feed (the swipe feed on Home + the #/clips route) is now
// permanent, YouTube-Shorts/Reels/TikTok-style, so content can accumulate
// views/likes over time instead of disappearing after a day. The deletion
// query below is intentionally a no-op for mkt_moments - do not re-enable it
// for this table.
//
// The setInterval scaffold itself was left in place (rather than deleted)
// for exactly this reason: "Loops" (24h stories, Instagram/FB-Stories-style,
// tracked separately from Moments) is now built and reuses this same
// interval, scoped to its own mkt_loops table, instead of the deletion
// query above. mkt_loop_views rows for a deleted loop are cleaned up too via
// the loop_id foreign key's ON DELETE CASCADE (see the mkt_loop_views
// migration) rather than a second explicit delete here.
setInterval(async () => {
  try {
    // Intentional no-op: Moments no longer expire. See comment above.
  } catch (e) {
    console.error("moment cleanup failed:", e.message);
  }
  try {
    await db.remove("mkt_loops", { expires_at: "lt." + Date.now() });
  } catch (e) {
    console.error("loop cleanup failed:", e.message);
  }
}, 60 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log("Marketplace Pro running at http://localhost:" + PORT);
});
