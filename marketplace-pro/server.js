// Marketplace Pro - backend
// Pure Node.js, no external dependencies. Data stored as JSON files in ./data
// Images are stored as base64 data URLs directly in the JSON records (simple, zero-dependency).

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const url = require("url");

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

const FILES = {
  users: path.join(DATA_DIR, "users.json"),
  sessions: path.join(DATA_DIR, "sessions.json"),
  products: path.join(DATA_DIR, "products.json"),
  reviews: path.join(DATA_DIR, "reviews.json"),
  messages: path.join(DATA_DIR, "messages.json"),
  offers: path.join(DATA_DIR, "offers.json"),
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
for (const f of Object.values(FILES)) {
  if (!fs.existsSync(f)) fs.writeFileSync(f, "[]", "utf8");
}

const MAX_PHOTOS = 12;

// ---------- storage helpers ----------

function readDb(key) {
  try {
    return JSON.parse(fs.readFileSync(FILES[key], "utf8") || "[]");
  } catch (e) {
    return [];
  }
}
function writeDb(key, data) {
  fs.writeFileSync(FILES[key], JSON.stringify(data, null, 2), "utf8");
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

function getAuthUser(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const sessions = readDb("sessions");
  const session = sessions.find((s) => s.token === token);
  if (!session) return null;
  const users = readDb("users");
  const user = users.find((u) => u.id === session.userId);
  return user || null;
}

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, email, ...safe } = u;
  return safe;
}

function userRatingSummary(userId) {
  const reviews = readDb("reviews").filter((r) => r.targetUserId === userId);
  const count = reviews.length;
  const avg = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
  return { ratingAvg: Math.round(avg * 10) / 10, ratingCount: count };
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

// ---------- API ----------

async function handleApi(req, res, pathname, query) {
  const method = req.method;

  // ---- AUTH ----
  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await readBody(req);
    const { name, email, password } = body;
    if (!name || !String(name).trim()) return sendJson(res, 400, { error: "Name is required" });
    if (!isEmail(email)) return sendJson(res, 400, { error: "A valid email is required" });
    if (!password || String(password).length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters" });

    const users = readDb("users");
    if (users.find((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
      return sendJson(res, 409, { error: "An account with this email already exists" });
    }

    const user = {
      id: crypto.randomBytes(8).toString("hex"),
      name: String(name).trim().slice(0, 80),
      email: String(email).trim().toLowerCase(),
      passwordHash: hashPassword(password),
      photo: null,
      bio: "",
      location: "",
      createdAt: Date.now(),
    };
    users.push(user);
    writeDb("users", users);

    const token = crypto.randomBytes(24).toString("hex");
    const sessions = readDb("sessions");
    sessions.push({ token, userId: user.id, createdAt: Date.now() });
    writeDb("sessions", sessions);

    return sendJson(res, 201, { token, user: publicUser(user) });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(req);
    const { email, password } = body;
    const users = readDb("users");
    const user = users.find((u) => u.email.toLowerCase() === String(email || "").toLowerCase());
    if (!user || !verifyPassword(password || "", user.passwordHash)) {
      return sendJson(res, 401, { error: "Invalid email or password" });
    }
    const token = crypto.randomBytes(24).toString("hex");
    const sessions = readDb("sessions");
    sessions.push({ token, userId: user.id, createdAt: Date.now() });
    writeDb("sessions", sessions);
    return sendJson(res, 200, { token, user: publicUser(user) });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const auth = req.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (token) {
      const sessions = readDb("sessions").filter((s) => s.token !== token);
      writeDb("sessions", sessions);
    }
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    return sendJson(res, 200, { user: { ...publicUser(me), ...userRatingSummary(me.id) } });
  }

  // ---- USERS / PROFILES ----
  const userMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && userMatch) {
    const users = readDb("users");
    const u = users.find((x) => x.id === userMatch[1]);
    if (!u) return sendJson(res, 404, { error: "User not found" });
    return sendJson(res, 200, { ...publicUser(u), ...userRatingSummary(u.id) });
  }

  if (method === "PUT" && pathname === "/api/users/me") {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const users = readDb("users");
    const idx = users.findIndex((u) => u.id === me.id);
    if (body.name !== undefined) users[idx].name = String(body.name).trim().slice(0, 80);
    if (body.bio !== undefined) users[idx].bio = String(body.bio).slice(0, 500);
    if (body.location !== undefined) users[idx].location = String(body.location).slice(0, 150);
    if (body.photo !== undefined) users[idx].photo = body.photo;
    writeDb("users", users);
    return sendJson(res, 200, { user: { ...publicUser(users[idx]), ...userRatingSummary(users[idx].id) } });
  }

  // ---- REVIEWS ----
  const userReviewsMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9]+)\/reviews$/);
  if (method === "GET" && userReviewsMatch) {
    const reviews = readDb("reviews")
      .filter((r) => r.targetUserId === userReviewsMatch[1])
      .sort((a, b) => b.createdAt - a.createdAt);
    const users = readDb("users");
    const withAuthor = reviews.map((r) => {
      const author = users.find((u) => u.id === r.authorUserId);
      return { ...r, authorName: author ? author.name : "Deleted user", authorPhoto: author ? author.photo : null };
    });
    return sendJson(res, 200, withAuthor);
  }

  if (method === "POST" && userReviewsMatch) {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const targetId = userReviewsMatch[1];
    if (targetId === me.id) return sendJson(res, 400, { error: "You cannot review yourself" });
    const users = readDb("users");
    if (!users.find((u) => u.id === targetId)) return sendJson(res, 404, { error: "User not found" });

    const body = await readBody(req);
    const rating = Number(body.rating);
    if (!rating || rating < 1 || rating > 5) return sendJson(res, 400, { error: "Rating must be between 1 and 5" });

    const reviews = readDb("reviews");
    const review = {
      id: crypto.randomBytes(8).toString("hex"),
      targetUserId: targetId,
      authorUserId: me.id,
      rating,
      comment: String(body.comment || "").slice(0, 1000),
      createdAt: Date.now(),
    };
    reviews.push(review);
    writeDb("reviews", reviews);
    return sendJson(res, 201, review);
  }

  // ---- PRODUCTS ----
  if (method === "GET" && pathname === "/api/products") {
    let products = readDb("products");
    const { category, q, country, state, city } = query;

    if (category && category !== "all") products = products.filter((p) => p.category === category);
    if (country) products = products.filter((p) => (p.country || "").toLowerCase() === String(country).toLowerCase());
    if (state) products = products.filter((p) => (p.state || "").toLowerCase() === String(state).toLowerCase());
    if (city) products = products.filter((p) => (p.city || "").toLowerCase().includes(String(city).toLowerCase()));
    if (q) {
      const needle = String(q).toLowerCase();
      products = products.filter(
        (p) => p.title.toLowerCase().includes(needle) || (p.description || "").toLowerCase().includes(needle)
      );
    }

    const users = readDb("users");
    const safe = products
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((p) => {
        const seller = users.find((u) => u.id === p.sellerId);
        return {
          ...p,
          photos: p.photos && p.photos[0] ? [p.photos[0]] : [], // list view: only first photo, keep payload light
          sellerName: seller ? seller.name : "Unknown",
          sellerPhoto: seller ? seller.photo : null,
          ...(seller ? { sellerRating: userRatingSummary(seller.id) } : {}),
        };
      });
    return sendJson(res, 200, safe);
  }

  const productMatch = pathname.match(/^\/api\/products\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && productMatch) {
    const products = readDb("products");
    const p = products.find((x) => x.id === productMatch[1]);
    if (!p) return sendJson(res, 404, { error: "Product not found" });
    const users = readDb("users");
    const seller = users.find((u) => u.id === p.sellerId);
    return sendJson(res, 200, {
      ...p,
      sellerName: seller ? seller.name : "Unknown",
      sellerPhoto: seller ? seller.photo : null,
      sellerRating: seller ? userRatingSummary(seller.id) : { ratingAvg: 0, ratingCount: 0 },
    });
  }

  if (method === "POST" && pathname === "/api/products") {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const body = await readBody(req);
    const { title, description, price, category, country, state, city, allowOffers, allowReturn } = body;

    if (!title || !String(title).trim()) return sendJson(res, 400, { error: "Title is required" });
    if (!CATEGORIES.includes(category)) return sendJson(res, 400, { error: "Invalid category" });

    let photos = Array.isArray(body.photos) ? body.photos : [];
    photos = photos.filter((p) => typeof p === "string" && p.startsWith("data:image/")).slice(0, MAX_PHOTOS);

    const products = readDb("products");
    const product = {
      id: crypto.randomBytes(8).toString("hex"),
      sellerId: me.id,
      title: String(title).trim().slice(0, 140),
      description: String(description || "").slice(0, 3000),
      price: price ? Number(price) || 0 : 0,
      category,
      photos,
      country: String(country || "").slice(0, 80),
      state: String(state || "").slice(0, 80),
      city: String(city || "").slice(0, 80),
      allowOffers: !!allowOffers,
      allowReturn: !!allowReturn,
      createdAt: Date.now(),
    };
    products.push(product);
    writeDb("products", products);
    return sendJson(res, 201, product);
  }

  if ((method === "PUT" || method === "DELETE") && productMatch) {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const products = readDb("products");
    const idx = products.findIndex((x) => x.id === productMatch[1]);
    if (idx === -1) return sendJson(res, 404, { error: "Product not found" });
    if (products[idx].sellerId !== me.id) return sendJson(res, 403, { error: "You do not own this product" });

    if (method === "DELETE") {
      products.splice(idx, 1);
      writeDb("products", products);
      return sendJson(res, 200, { ok: true });
    }

    const body = await readBody(req);
    const p = products[idx];
    if (body.title !== undefined) p.title = String(body.title).trim().slice(0, 140);
    if (body.description !== undefined) p.description = String(body.description).slice(0, 3000);
    if (body.price !== undefined) p.price = Number(body.price) || 0;
    if (body.category !== undefined && CATEGORIES.includes(body.category)) p.category = body.category;
    if (body.country !== undefined) p.country = String(body.country).slice(0, 80);
    if (body.state !== undefined) p.state = String(body.state).slice(0, 80);
    if (body.city !== undefined) p.city = String(body.city).slice(0, 80);
    if (body.allowOffers !== undefined) p.allowOffers = !!body.allowOffers;
    if (body.allowReturn !== undefined) p.allowReturn = !!body.allowReturn;
    if (Array.isArray(body.photos)) {
      p.photos = body.photos.filter((x) => typeof x === "string" && x.startsWith("data:image/")).slice(0, MAX_PHOTOS);
    }
    writeDb("products", products);
    return sendJson(res, 200, p);
  }

  // ---- OFFERS ----
  const productOffersMatch = pathname.match(/^\/api\/products\/([a-zA-Z0-9]+)\/offers$/);
  if (method === "POST" && productOffersMatch) {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const products = readDb("products");
    const product = products.find((p) => p.id === productOffersMatch[1]);
    if (!product) return sendJson(res, 404, { error: "Product not found" });
    if (product.sellerId === me.id) return sendJson(res, 400, { error: "You cannot make an offer on your own listing" });

    const body = await readBody(req);
    const type = body.type === "buy" ? "buy" : "offer";
    const amount = type === "buy" ? product.price : Number(body.amount);
    if (type === "offer" && (!amount || amount <= 0)) return sendJson(res, 400, { error: "Enter a valid offer amount" });

    const offers = readDb("offers");
    const offer = {
      id: crypto.randomBytes(8).toString("hex"),
      productId: product.id,
      sellerId: product.sellerId,
      buyerId: me.id,
      type,
      amount,
      message: String(body.message || "").slice(0, 500),
      status: "pending",
      createdAt: Date.now(),
    };
    offers.push(offer);
    writeDb("offers", offers);
    return sendJson(res, 201, offer);
  }

  if (method === "GET" && productOffersMatch) {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const products = readDb("products");
    const product = products.find((p) => p.id === productOffersMatch[1]);
    if (!product) return sendJson(res, 404, { error: "Product not found" });
    if (product.sellerId !== me.id) return sendJson(res, 403, { error: "Only the seller can view offers" });
    const users = readDb("users");
    const offers = readDb("offers")
      .filter((o) => o.productId === product.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => {
        const buyer = users.find((u) => u.id === o.buyerId);
        return { ...o, buyerName: buyer ? buyer.name : "Unknown" };
      });
    return sendJson(res, 200, offers);
  }

  if (method === "GET" && pathname === "/api/offers/mine") {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const products = readDb("products");
    const offers = readDb("offers")
      .filter((o) => o.buyerId === me.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => {
        const product = products.find((p) => p.id === o.productId);
        return { ...o, productTitle: product ? product.title : "Deleted listing" };
      });
    return sendJson(res, 200, offers);
  }

  const offerMatch = pathname.match(/^\/api\/offers\/([a-zA-Z0-9]+)$/);
  if (method === "PUT" && offerMatch) {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const offers = readDb("offers");
    const idx = offers.findIndex((o) => o.id === offerMatch[1]);
    if (idx === -1) return sendJson(res, 404, { error: "Offer not found" });
    if (offers[idx].sellerId !== me.id) return sendJson(res, 403, { error: "Only the seller can respond to this offer" });
    const body = await readBody(req);
    if (!["accepted", "rejected"].includes(body.status)) return sendJson(res, 400, { error: "Invalid status" });
    offers[idx].status = body.status;
    writeDb("offers", offers);
    return sendJson(res, 200, offers[idx]);
  }

  // ---- MESSAGES ----
  if (method === "GET" && pathname === "/api/conversations") {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const messages = readDb("messages").filter((m) => m.fromUserId === me.id || m.toUserId === me.id);
    const users = readDb("users");

    const byOther = {};
    for (const m of messages) {
      const otherId = m.fromUserId === me.id ? m.toUserId : m.fromUserId;
      if (!byOther[otherId] || m.createdAt > byOther[otherId].createdAt) {
        byOther[otherId] = m;
      }
    }
    const list = Object.keys(byOther).map((otherId) => {
      const other = users.find((u) => u.id === otherId);
      const last = byOther[otherId];
      return {
        userId: otherId,
        userName: other ? other.name : "Deleted user",
        userPhoto: other ? other.photo : null,
        lastMessage: last.text,
        lastAt: last.createdAt,
        unread: messages.some((m) => m.fromUserId === otherId && m.toUserId === me.id && !m.read),
      };
    });
    list.sort((a, b) => b.lastAt - a.lastAt);
    return sendJson(res, 200, list);
  }

  const convoMatch = pathname.match(/^\/api\/conversations\/([a-zA-Z0-9]+)$/);
  if (method === "GET" && convoMatch) {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const otherId = convoMatch[1];
    const messages = readDb("messages")
      .filter(
        (m) =>
          (m.fromUserId === me.id && m.toUserId === otherId) ||
          (m.fromUserId === otherId && m.toUserId === me.id)
      )
      .sort((a, b) => a.createdAt - b.createdAt);

    let changed = false;
    for (const m of messages) {
      if (m.toUserId === me.id && !m.read) {
        m.read = true;
        changed = true;
      }
    }
    if (changed) {
      const all = readDb("messages");
      for (const m of messages) {
        const idx = all.findIndex((x) => x.id === m.id);
        if (idx !== -1) all[idx].read = true;
      }
      writeDb("messages", all);
    }

    return sendJson(res, 200, messages);
  }

  if (method === "POST" && convoMatch) {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: "Not authenticated" });
    const otherId = convoMatch[1];
    const users = readDb("users");
    if (!users.find((u) => u.id === otherId)) return sendJson(res, 404, { error: "User not found" });

    const body = await readBody(req);
    if (!body.text || !String(body.text).trim()) return sendJson(res, 400, { error: "Message text is required" });

    const messages = readDb("messages");
    const message = {
      id: crypto.randomBytes(8).toString("hex"),
      fromUserId: me.id,
      toUserId: otherId,
      text: String(body.text).trim().slice(0, 2000),
      productId: body.productId || null,
      read: false,
      createdAt: Date.now(),
    };
    messages.push(message);
    writeDb("messages", messages);
    return sendJson(res, 201, message);
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
      sendJson(res, 500, { error: "Internal server error: " + e.message });
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
