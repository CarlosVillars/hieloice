// Marketplace Pro - backend
// Pure Node.js, no external dependencies. Data stored in Supabase (Postgres) via its REST API.

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const url = require("url");

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

const MAX_PHOTOS = 12;

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
};

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

async function getAuthUser(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const sessions = await db.select("mkt_sessions", { token: "eq." + enc(token), select: "user_id" });
  if (!sessions || !sessions[0]) return null;
  const users = await db.select("mkt_users", { id: "eq." + enc(sessions[0].user_id), select: "*" });
  return (users && users[0]) || null;
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
  const { created_at, ...rest } = u;
  return { ...rest, createdAt: created_at };
}

function isOwner(user) {
  return !!(user && OWNER_EMAIL && user.email && user.email.toLowerCase() === OWNER_EMAIL);
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
    const LIMIT = 60 * 1024 * 1024; // 60MB - enough for up to 12 photos as base64
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
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// ---------- validation helpers ----------

function isEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

const CATEGORIES = [
  "vehicles", "auto-parts", "heavy-machinery", "food", "clothing",
  "video-games", "cell-phones", "computers-tech", "real-estate",
  "generators-solar", "art-crafts", "airplanes-jets",
  "construction-materials", "appliances", "other",
];

const REPORT_REASONS = ["spam", "prohibited", "inappropriate", "fraud", "other"];

function productOut(p) {
  const { seller_id, allow_offers, allow_return, created_at, ...rest } = p;
  return {
    ...rest,
    sellerId: seller_id,
    allowOffers: allow_offers,
    allowReturn: allow_return,
    createdAt: created_at,
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
    const { name, email, password, phone } = body;
    if (!name || !String(name).trim()) return sendJson(res, 400, { error: "Name is required" });
    if (!isEmail(email)) return sendJson(res, 400, { error: "A valid email is required" });
    if (!password || String(password).length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters" });

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
      created_at: Date.now(),
    };
    await db.insert("mkt_users", user);

    const token = crypto.randomBytes(24).toString("hex");
    await db.insert("mkt_sessions", { token, user_id: user.id, created_at: Date.now() });

    return sendJson(res, 201, { token, user: ownUser(user) });
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
  const userMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && userMatch) {
    const users = await db.select("mkt_users", { id: "eq." + enc(userMatch[1]), select: "*" });
    const u = users && users[0];
    if (!u) return sendJson(res, 404, { error: "User not found" });
    const rating = await userRatingSummary(u.id);
    return sendJson(res, 200, { ...publicUser(u), ...rating });
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
    const updated = await db.update("mkt_users", { id: "eq." + enc(me.id) }, patch);
    const u = updated && updated[0];
    const rating = await userRatingSummary(u.id);
    return sendJson(res, 200, { user: { ...ownUser(u), ...rating } });
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
    const { category, q, country, state, city, minPrice, maxPrice, sort } = query;
    const params = { select: "*" };
    if (category && category !== "all") params.category = "eq." + enc(category);
    if (country) params.country = "ilike." + enc(country);
    if (state) params.state = "ilike." + enc(state);
    if (city) params.city = "ilike.*" + enc(city) + "*";
    if (q) {
      params.or = "(title.ilike.*" + enc(q) + "*,description.ilike.*" + enc(q) + "*)";
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
    let sellers = [];
    if (sellerIds.length) {
      sellers = await db.select("mkt_users", {
        id: "in.(" + sellerIds.map(enc).join(",") + ")",
        select: "id,name,photo",
      });
    }
    const ratings = {};
    for (const id of sellerIds) ratings[id] = await userRatingSummary(id);

    const safe = products.map((p) => {
      const seller = sellers.find((u) => u.id === p.seller_id);
      const out = productOut(p);
      out.photos = out.photos && out.photos[0] ? [out.photos[0]] : [];
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
    const sellers = await db.select("mkt_users", { id: "eq." + enc(p.seller_id), select: "id,name,photo" });
    const seller = sellers && sellers[0];
    const rating = await userRatingSummary(p.seller_id);
    const out = productOut(p);
    out.sellerName = seller ? seller.name : "Unknown";
    out.sellerPhoto = seller ? seller.photo : null;
    out.sellerRating = rating;
    return sendJson(res, 200, out);
  }

  if (method === "POST" && pathname === "/api/products") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const { title, description, price, category, country, state, city, allowOffers, allowReturn } = body;

    if (!title || !String(title).trim()) return sendJson(res, 400, { error: "Title is required" });
    if (!CATEGORIES.includes(category)) return sendJson(res, 400, { error: "Invalid category" });

    let photos = Array.isArray(body.photos) ? body.photos : [];
    photos = photos.filter((p) => typeof p === "string" && p.startsWith("data:image/")).slice(0, MAX_PHOTOS);

    const product = {
      id: crypto.randomBytes(8).toString("hex"),
      seller_id: me.id,
      title: String(title).trim().slice(0, 140),
      description: String(description || "").slice(0, 3000),
      price: price ? Number(price) || 0 : 0,
      category,
      photos,
      country: String(country || "").slice(0, 80),
      state: String(state || "").slice(0, 80),
      city: String(city || "").slice(0, 80),
      allow_offers: !!allowOffers,
      allow_return: !!allowReturn,
      status: "active",
      created_at: Date.now(),
    };
    const inserted = await db.insert("mkt_products", product);
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
    if (body.country !== undefined) patch.country = String(body.country).slice(0, 80);
    if (body.state !== undefined) patch.state = String(body.state).slice(0, 80);
    if (body.city !== undefined) patch.city = String(body.city).slice(0, 80);
    if (body.allowOffers !== undefined) patch.allow_offers = !!body.allowOffers;
    if (body.allowReturn !== undefined) patch.allow_return = !!body.allowReturn;
    if (body.status !== undefined && ["active", "reserved", "sold"].includes(body.status)) {
      patch.status = body.status;
    }
    if (Array.isArray(body.photos)) {
      patch.photos = body.photos.filter((x) => typeof x === "string" && x.startsWith("data:image/")).slice(0, MAX_PHOTOS);
    }
    const updated = await db.update("mkt_products", { id: "eq." + enc(p.id) }, patch);
    return sendJson(res, 200, productOut(updated[0]));
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
  if (method === "GET" && pathname === "/api/conversations") {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const [fromMe, toMe] = await Promise.all([
      db.select("mkt_messages", { from_user_id: "eq." + enc(me.id), select: "*" }),
      db.select("mkt_messages", { to_user_id: "eq." + enc(me.id), select: "*" }),
    ]);
    const messages = [...fromMe, ...toMe];

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
      return {
        userId: otherId,
        userName: other ? other.name : "Deleted user",
        userPhoto: other ? other.photo : null,
        lastMessage: last.text,
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
    const messages = [...sent, ...received].sort((a, b) => a.created_at - b.created_at);

    const unreadIds = received.filter((m) => !m.read).map((m) => m.id);
    if (unreadIds.length) {
      await db.update("mkt_messages", { id: "in.(" + unreadIds.map(enc).join(",") + ")" }, { read: true });
    }

    const out = messages.map((m) => ({
      id: m.id,
      fromUserId: m.from_user_id,
      toUserId: m.to_user_id,
      text: m.text,
      productId: m.product_id,
      read: unreadIds.includes(m.id) ? true : m.read,
      createdAt: m.created_at,
    }));
    return sendJson(res, 200, out);
  }

  if (method === "POST" && convoMatch) {
    const me = await getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const otherId = convoMatch[1];
    const others = await db.select("mkt_users", { id: "eq." + enc(otherId), select: "id" });
    if (!others || !others[0]) return sendJson(res, 404, { error: "User not found" });

    const body = await readBody(req);
    if (!body.text || !String(body.text).trim()) return sendJson(res, 400, { error: "Message text is required" });

    const message = {
      id: crypto.randomBytes(8).toString("hex"),
      from_user_id: me.id,
      to_user_id: otherId,
      text: String(body.text).trim().slice(0, 2000),
      product_id: body.productId || null,
      read: false,
      created_at: Date.now(),
    };
    await db.insert("mkt_messages", message);
    return sendJson(res, 201, {
      id: message.id,
      fromUserId: message.from_user_id,
      toUserId: message.to_user_id,
      text: message.text,
      productId: message.product_id,
      read: message.read,
      createdAt: message.created_at,
    });
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

server.listen(PORT, () => {
  console.log("Marketplace Pro running at http://localhost:" + PORT);
});
