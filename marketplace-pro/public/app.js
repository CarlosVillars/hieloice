// Marketplace Pro - frontend app (vanilla JS, hash-based routing)

const state = {
  token: localStorage.getItem("authToken") || null,
  user: JSON.parse(localStorage.getItem("authUser") || "null"),
};

const viewEl = document.getElementById("view");

// ---------------- API helper ----------------

async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && state.token) headers["Authorization"] = "Bearer " + state.token;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  if (!res.ok) {
    const err = new Error((data && data.error) || "Request failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function fmtPrice(price) {
  if (!price) return "$0";
  return "$" + Number(price).toLocaleString("en-US");
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString();
}

function initials(name) {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

function starsMarkup(avg) {
  const full = Math.round(avg || 0);
  let out = "";
  for (let i = 1; i <= 5; i++) out += i <= full ? "★" : "☆";
  return out;
}

function locationLabel(p) {
  return [p.city, p.state, p.country].filter(Boolean).join(", ");
}

// ---------------- Auth ----------------

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  if (token) {
    localStorage.setItem("authToken", token);
    localStorage.setItem("authUser", JSON.stringify(user));
  } else {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
  }
  updateNavUI();
}

async function refreshMe() {
  if (!state.token) return;
  try {
    const data = await api("/api/auth/me", { auth: true });
    state.user = data.user;
    localStorage.setItem("authUser", JSON.stringify(data.user));
  } catch (e) {
    setAuth(null, null);
  }
  updateNavUI();
}

function updateNavUI() {
  const loggedIn = !!state.token;
  document.getElementById("nav-login").style.display = loggedIn ? "none" : "inline";
  document.getElementById("nav-register").style.display = loggedIn ? "none" : "inline";
  document.getElementById("nav-logout").style.display = loggedIn ? "inline" : "none";
  document.getElementById("nav-profile").style.display = loggedIn ? "inline" : "none";
  document.getElementById("nav-messages").style.display = loggedIn ? "inline" : "none";
}

document.getElementById("nav-logout").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", auth: true });
  } catch (e) {}
  setAuth(null, null);
  location.hash = "#/";
});

// ---------------- Language toggle ----------------

function applyStaticI18n() {
  document.getElementById("brand-name").textContent = I18N.t("site.name");
  document.getElementById("global-search").placeholder = I18N.t("home.searchPlaceholder");
  document.getElementById("nav-messages").textContent = I18N.t("nav.messages");
  document.getElementById("nav-profile").textContent = I18N.t("nav.profile");
  document.getElementById("nav-post").textContent = I18N.t("nav.postAd");
  document.getElementById("nav-login").textContent = I18N.t("nav.login");
  document.getElementById("nav-register").textContent = I18N.t("nav.register");
  document.getElementById("nav-logout").textContent = I18N.t("nav.logout");
  document.getElementById("lang-en").classList.toggle("active", I18N.lang === "en");
  document.getElementById("lang-es").classList.toggle("active", I18N.lang === "es");
  document.getElementById("footer-terms").textContent = I18N.t("auth.termsLink");
  document.getElementById("footer-privacy").textContent = I18N.t("auth.privacyLink");
  document.getElementById("footer-bug").textContent = I18N.t("footer.reportBug");
  document.getElementById("footer-rights").textContent = I18N.t("footer.rights");
}

document.getElementById("lang-en").addEventListener("click", () => {
  I18N.setLang("en");
  applyStaticI18n();
  router();
});
document.getElementById("lang-es").addEventListener("click", () => {
  I18N.setLang("es");
  applyStaticI18n();
  router();
});

document.getElementById("global-search-btn").addEventListener("click", doGlobalSearch);
document.getElementById("global-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doGlobalSearch();
});
function doGlobalSearch() {
  const q = document.getElementById("global-search").value.trim();
  location.hash = "#/category/all" + (q ? "?q=" + encodeURIComponent(q) : "");
}

// ---------------- Router ----------------

function parseHash() {
  let hash = location.hash.slice(1) || "/";
  let [path, queryStr] = hash.split("?");
  const parts = path.split("/").filter(Boolean);
  const query = {};
  if (queryStr) {
    for (const pair of queryStr.split("&")) {
      const [k, v] = pair.split("=");
      query[decodeURIComponent(k)] = decodeURIComponent(v || "");
    }
  }
  return { parts, query };
}

async function router() {
  const { parts, query } = parseHash();
  window.scrollTo(0, 0);

  try {
    if (parts.length === 0) return renderHome();
    if (parts[0] === "category" && parts[1]) return renderCategory(parts[1], query);
    if (parts[0] === "product" && parts[1]) return renderProductDetail(parts[1]);
    if (parts[0] === "login") return renderLogin();
    if (parts[0] === "register") return renderRegister();
    if (parts[0] === "terms") return renderLegal("terms");
    if (parts[0] === "privacy") return renderLegal("privacy");
    if (parts[0] === "report-bug") return renderReportBug();
    if (parts[0] === "oauth-callback") return renderOAuthCallback(query);
    if (parts[0] === "post") return renderPostAd();
    if (parts[0] === "edit" && parts[1]) return renderPostAd(parts[1]);
    if (parts[0] === "profile" && parts[1]) return renderProfile(parts[1]);
    if (parts[0] === "profile") return renderProfile(state.user ? state.user.id : null);
    if (parts[0] === "messages" && parts[1]) return renderMessages(parts[1]);
    if (parts[0] === "messages") return renderMessages(null);
    viewEl.innerHTML = "<p>Not found.</p>";
  } catch (e) {
    viewEl.innerHTML = `<p class="form-msg error">${escapeHtml(e.message)}</p>`;
  }
}
window.addEventListener("hashchange", router);

// ---------------- Legal (Terms / Privacy) ----------------

function renderLegal(which) {
  viewEl.dataset.homeMounted = "";
  const doc = (I18N.lang === "es" ? LEGAL_ES : LEGAL_EN)[which];
  viewEl.innerHTML = `
    <a class="back-link" href="#/">&larr; ${I18N.t("category.back")}</a>
    <div class="legal-doc">${doc}</div>
  `;
}

// ---------------- Report a Bug ----------------

function renderReportBug() {
  viewEl.dataset.homeMounted = "";
  viewEl.innerHTML = `
    <a class="back-link" href="#/">&larr; ${I18N.t("category.back")}</a>
    <div class="bug-report-form">
      <h1>${I18N.t("bug.title")}</h1>
      <p>${I18N.t("bug.intro")}</p>
      <form id="bug-form">
        <label>${I18N.t("bug.description")}</label>
        <textarea id="bug-description" rows="6" placeholder="${I18N.t("bug.descriptionPlaceholder")}" required></textarea>
        <label>${I18N.t("bug.email")}</label>
        <input type="email" id="bug-email" />
        <div id="bug-msg" class="form-msg"></div>
        <button type="submit" class="btn btn-gold">${I18N.t("bug.submit")}</button>
      </form>
    </div>
  `;

  const form = document.getElementById("bug-form");
  const msgEl = document.getElementById("bug-msg");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const description = document.getElementById("bug-description").value.trim();
    const email = document.getElementById("bug-email").value.trim();
    if (!description) {
      msgEl.textContent = I18N.t("bug.required");
      msgEl.className = "form-msg error";
      return;
    }
    try {
      await api("/api/report-bug", {
        method: "POST",
        auth: true,
        body: { description, email, pageUrl: location.href },
      });
      msgEl.textContent = I18N.t("bug.sent");
      msgEl.className = "form-msg ok";
      form.reset();
    } catch (err) {
      msgEl.textContent = err.message || I18N.t("common.error");
      msgEl.className = "form-msg error";
    }
  });
}

// ---------------- Home ----------------

function renderHome() {
  // If the ad carousel is already mounted and running, don't tear it down and
  // rebuild it again (this used to happen because router() was invoked twice
  // on page load, which caused the ads to flash and then vanish).
  if (viewEl.dataset.homeMounted === "1" && document.getElementById("featured-carousel")) {
    return;
  }

  const cards = CATEGORY_LIST.map(
    (c) => `
    <a class="category-card" href="#/category/${c.slug}">
      ${
        c.img
          ? `<img class="category-icon category-icon-img" src="${c.img}" alt="" />`
          : `<span class="category-icon">${c.icon}</span>`
      }
      <span class="category-label">${I18N.lang === "es" ? c.es : c.en}</span>
    </a>`
  ).join("");

  viewEl.innerHTML = `
    <div id="featured-carousel" class="featured-carousel" style="display:none;"></div>
    <div class="hero">
      <h1>${escapeHtml(I18N.t("site.name"))}</h1>
      <p>${escapeHtml(I18N.t("site.tagline"))}</p>
    </div>
    <h2 class="section-heading">${I18N.t("home.categoriesHeading")}</h2>
    <div class="category-grid">${cards}</div>
  `;
  viewEl.dataset.homeMounted = "1";
  loadFeaturedCarousel();
}

let featuredRotateTimer = null;
let featuredWatchdog = null;
let featuredLoadToken = 0;

async function loadFeaturedCarousel() {
  const el = document.getElementById("featured-carousel");
  if (!el) return;
  if (featuredRotateTimer) {
    clearInterval(featuredRotateTimer);
    featuredRotateTimer = null;
  }
  if (featuredWatchdog) {
    clearInterval(featuredWatchdog);
    featuredWatchdog = null;
  }
  const myToken = ++featuredLoadToken;
  try {
    const items = await api("/api/featured");
    // If another loadFeaturedCarousel() started after this one, or the home
    // view was unmounted while this request was in flight, bail out so we
    // never write to a stale element or start a duplicate rotation timer.
    if (myToken !== featuredLoadToken) return;
    const liveEl = document.getElementById("featured-carousel");
    if (!liveEl) return;
    if (!items || !items.length) return;
    let idx = 0;
    const draw = () => {
      try {
        const item = items[idx];
        liveEl.innerHTML = `
          <a class="featured-slide" href="${escapeHtml(item.linkUrl || "#")}" target="_blank" rel="noopener">
            <img src="${item.imageUrl}" alt="${escapeHtml(item.advertiserName || "")}" />
            <span class="featured-badge">${I18N.t("ads.sponsored")}${item.advertiserName ? " &middot; " + escapeHtml(item.advertiserName) : ""}</span>
          </a>
          ${
            items.length > 1
              ? `<div class="featured-dots">${items.map((_, i) => `<span class="featured-dot ${i === idx ? "active" : ""}"></span>`).join("")}</div>`
              : ""
          }
        `;
        liveEl.style.display = "block";
      } catch (e) {
        // never let a draw error leave the carousel in a broken state
      }
    };
    draw();
    if (items.length > 1) {
      featuredRotateTimer = setInterval(() => {
        idx = (idx + 1) % items.length;
        draw();
      }, 5000);
    }
    // Self-healing watchdog: a browser extension (ad blocker) or unrelated
    // script can hide or clear this element after it mounts. Periodically
    // verify it's still visible with content and restore it if not, so
    // featured/sponsored listings never stay hidden.
    featuredWatchdog = setInterval(() => {
      const el2 = document.getElementById("featured-carousel");
      if (!el2) return;
      const computedHidden =
        el2.style.display === "none" ||
        getComputedStyle(el2).display === "none" ||
        getComputedStyle(el2).visibility === "hidden" ||
        el2.offsetHeight === 0;
      if (computedHidden || !el2.querySelector(".featured-slide")) {
        el2.removeAttribute("style");
        draw();
      }
    }, 1200);
  } catch (e) {
    // best-effort; ignore failures silently
  }
}

// ---------------- Category listing ----------------

async function renderCategory(slug, query) {
  viewEl.dataset.homeMounted = "";
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;

  const params = new URLSearchParams();
  if (slug !== "all") params.set("category", slug);
  if (query.q) params.set("q", query.q);
  if (query.country) params.set("country", query.country);
  if (query.state) params.set("state", query.state);
  if (query.city) params.set("city", query.city);

  const products = await api("/api/products?" + params.toString());
  const heading = slug === "all" ? (query.q || "") : I18N.categoryName(slug);

  const cards = products.length
    ? products
        .map(
          (p) => `
      <a class="product-card" href="#/product/${p.id}">
        ${
          p.photos && p.photos[0]
            ? `<img class="product-thumb" src="${p.photos[0]}" alt="" />`
            : `<div class="product-thumb-empty">\u{1F4E6}</div>`
        }
        <div class="product-card-body">
          <p class="product-title">${escapeHtml(p.title)}</p>
          <p class="product-price">${fmtPrice(p.price)}</p>
          <p class="product-location">${escapeHtml(locationLabel(p)) || "&nbsp;"}</p>
          <div class="product-seller-row">
            ${p.sellerPhoto ? `<img class="mini-avatar" src="${p.sellerPhoto}" />` : ""}
            <span>${escapeHtml(p.sellerName)}</span>
            ${p.sellerRating ? `<span class="stars">${starsMarkup(p.sellerRating.ratingAvg)}</span>` : ""}
          </div>
        </div>
      </a>`
        )
        .join("")
    : `<div class="empty-state">${I18N.t("category.noResults")}</div>`;

  viewEl.innerHTML = `
    <a class="back-link" href="#/">&larr; ${I18N.t("category.back")}</a>
    <h2 class="section-heading">${I18N.t("category.resultsFor")} ${escapeHtml(heading)}</h2>
    <div class="filters">
      <input type="text" id="f-country" placeholder="${I18N.t("category.filterCountry")}" value="${escapeHtml(query.country || "")}" />
      <input type="text" id="f-state" placeholder="${I18N.t("category.filterState")}" value="${escapeHtml(query.state || "")}" />
      <input type="text" id="f-city" placeholder="${I18N.t("category.filterCity")}" value="${escapeHtml(query.city || "")}" />
      <button id="f-apply">${I18N.t("category.applyFilters")}</button>
    </div>
    <div class="product-grid">${cards}</div>
  `;

  document.getElementById("f-apply").addEventListener("click", () => {
    const p = new URLSearchParams();
    const country = document.getElementById("f-country").value.trim();
    const st = document.getElementById("f-state").value.trim();
    const city = document.getElementById("f-city").value.trim();
    if (query.q) p.set("q", query.q);
    if (country) p.set("country", country);
    if (st) p.set("state", st);
    if (city) p.set("city", city);
    location.hash = `#/category/${slug}` + (p.toString() ? "?" + p.toString() : "");
  });
}

// ---------------- Product detail ----------------

async function renderProductDetail(id) {
  viewEl.dataset.homeMounted = "";
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  let p;
  try {
    p = await api("/api/products/" + id);
  } catch (e) {
    viewEl.innerHTML = `<p class="form-msg error">${I18N.t("product.notFound")}</p>`;
    return;
  }

  const photos = p.photos && p.photos.length ? p.photos : [];
  const mainPhoto = photos[0] || null;
  const isOwner = state.user && state.user.id === p.sellerId;

  viewEl.innerHTML = `
    <a class="back-link" href="#/category/${p.category}">&larr; ${I18N.t("category.back")}</a>
    <div class="product-detail">
      <div>
        ${
          mainPhoto
            ? `<img class="gallery-main" id="gallery-main" src="${mainPhoto}" alt="" />`
            : `<div class="product-thumb-empty" style="aspect-ratio:4/3;border-radius:10px;">\u{1F4E6}</div>`
        }
        ${
          photos.length > 1
            ? `<div class="gallery-thumbs">${photos
                .map((ph, i) => `<img data-src="${ph}" class="${i === 0 ? "active" : ""}" src="${ph}" />`)
                .join("")}</div>`
            : ""
        }
      </div>
      <div class="detail-panel">
        <h1 class="detail-title">${escapeHtml(p.title)}</h1>
        <div class="detail-price">${fmtPrice(p.price)}</div>
        <div class="detail-meta">\u{1F4CD} ${escapeHtml(locationLabel(p)) || "-"} &middot; ${fmtDate(p.createdAt)}</div>
        <div>
          <span class="badge">${escapeHtml(I18N.categoryName(p.category))}</span>
          <span class="badge ${p.allowReturn ? "" : "no"}">${p.allowReturn ? I18N.t("product.returnsAllowed") : I18N.t("product.returnsNotAllowed")}</span>
        </div>
        ${renderShareRow(p)}
        <p style="white-space:pre-wrap;font-size:14px;margin-top:14px;">${escapeHtml(p.description)}</p>

        <a class="seller-card" href="#/profile/${p.sellerId}">
          ${
            p.sellerPhoto
              ? `<img class="seller-avatar" src="${p.sellerPhoto}" />`
              : `<div class="seller-avatar-placeholder">${initials(p.sellerName)}</div>`
          }
          <div>
            <div class="seller-name">${escapeHtml(p.sellerName)}</div>
            <div class="stars">${starsMarkup(p.sellerRating.ratingAvg)} <span style="color:#888;font-size:12px;">(${p.sellerRating.ratingCount})</span></div>
          </div>
        </a>

        ${isOwner ? `<div class="action-row"><button class="btn btn-danger" id="delete-listing">${I18N.t("product.deleteListing")}</button></div>` : ""}
        ${!isOwner ? renderProductActions(p) : ""}
        <div id="offer-area"></div>
      </div>
    </div>
  `;

  document.querySelectorAll(".gallery-thumbs img").forEach((img) => {
    img.addEventListener("click", () => {
      document.getElementById("gallery-main").src = img.dataset.src;
      document.querySelectorAll(".gallery-thumbs img").forEach((i) => i.classList.remove("active"));
      img.classList.add("active");
    });
  });

  if (isOwner) {
    document.getElementById("delete-listing").addEventListener("click", async () => {
      if (!confirm("Delete this listing? / Eliminar este aviso?")) return;
      await api("/api/products/" + p.id, { method: "DELETE", auth: true });
      location.hash = "#/profile";
    });
  } else {
    wireProductActions(p);
  }
}

function renderShareRow(p) {
  const shareUrl = location.origin + "/#/product/" + p.id;
  const shareText = encodeURIComponent(p.title);
  const shareUrlEnc = encodeURIComponent(shareUrl);
  return `
    <div class="share-row">
      <span class="share-label">${I18N.t("product.share")}</span>
      <a class="share-btn share-whatsapp" target="_blank" rel="noopener noreferrer" title="WhatsApp" href="https://wa.me/?text=${shareText}%20-%20${shareUrlEnc}">\u{1F4AC}</a>
      <a class="share-btn share-facebook" target="_blank" rel="noopener noreferrer" title="Facebook" href="https://www.facebook.com/sharer/sharer.php?u=${shareUrlEnc}">\u{1F4D8}</a>
      <a class="share-btn share-x" target="_blank" rel="noopener noreferrer" title="X" href="https://twitter.com/intent/tweet?url=${shareUrlEnc}&text=${shareText}">✖</a>
      <a class="share-btn share-email" title="Email" href="mailto:?subject=${shareText}&body=${shareUrlEnc}">✉️</a>
    </div>
  `;
}

function renderProductActions(p) {
  if (!state.token) {
    return `<p class="form-msg" style="margin-top:14px;">${I18N.t("product.loginToOffer")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
  }
  return `
    <div class="action-row">
      <a class="btn btn-outline" href="#/messages/${p.sellerId}">${I18N.t("product.contactSeller")}</a>
      ${p.allowOffers ? `<button class="btn btn-outline" id="btn-offer">${I18N.t("product.makeOffer")}</button>` : ""}
      <button class="btn btn-gold" id="btn-buy">${I18N.t("product.buyNow")}</button>
    </div>
  `;
}

function wireProductActions(p) {
  const offerArea = document.getElementById("offer-area");
  const btnOffer = document.getElementById("btn-offer");
  const btnBuy = document.getElementById("btn-buy");

  if (btnOffer) {
    btnOffer.addEventListener("click", () => {
      offerArea.innerHTML = `
        <div class="form-group" style="margin-top:14px;">
          <label>${I18N.t("product.offerAmount")}</label>
          <input type="number" id="offer-amount" min="1" />
        </div>
        <div class="form-group">
          <label>${I18N.t("product.offerMessage")}</label>
          <textarea id="offer-message" rows="2"></textarea>
        </div>
        <button class="btn btn-primary" id="offer-submit">${I18N.t("product.submitOffer")}</button>
        <p class="form-msg" id="offer-msg"></p>
      `;
      document.getElementById("offer-submit").addEventListener("click", async () => {
        const amount = Number(document.getElementById("offer-amount").value);
        const message = document.getElementById("offer-message").value;
        const msgEl = document.getElementById("offer-msg");
        try {
          await api(`/api/products/${p.id}/offers`, { method: "POST", auth: true, body: { type: "offer", amount, message } });
          msgEl.textContent = I18N.t("product.offerSent");
          msgEl.className = "form-msg ok";
        } catch (e) {
          msgEl.textContent = e.message;
          msgEl.className = "form-msg error";
        }
      });
    });
  }

  if (btnBuy) {
    btnBuy.addEventListener("click", async () => {
      try {
        await api(`/api/products/${p.id}/offers`, { method: "POST", auth: true, body: { type: "buy" } });
        offerArea.innerHTML = `<p class="form-msg ok">${I18N.t("product.offerSent")}</p>`;
      } catch (e) {
        offerArea.innerHTML = `<p class="form-msg error">${escapeHtml(e.message)}</p>`;
      }
    });
  }
}

// ---------------- Auth views ----------------

function renderLogin() {
  viewEl.dataset.homeMounted = "";
  viewEl.innerHTML = `
    <div class="form-panel">
      <h2 class="section-heading">${I18N.t("auth.loginTitle")}</h2>
      <div class="form-group">
        <label>${I18N.t("auth.email")}</label>
        <input type="email" id="login-email" />
      </div>
      <div class="form-group">
        <label>${I18N.t("auth.password")}</label>
        <input type="password" id="login-password" />
      </div>
      <button class="btn btn-primary" id="login-submit" style="width:100%;">${I18N.t("auth.submitLogin")}</button>
      <p class="form-msg" id="login-msg"></p>
      <div class="oauth-divider"><span>${I18N.t("auth.orContinueWith")}</span></div>
      <a class="btn btn-google" style="width:100%;display:flex;" href="/api/auth/google">${I18N.t("auth.continueGoogle")}</a>
      <a class="btn btn-facebook" style="width:100%;display:flex;margin-top:8px;" href="/api/auth/facebook">${I18N.t("auth.continueFacebook")}</a>
      <p class="legal-consent-note">${I18N.t("auth.oauthConsentPrefix")} <a href="#/terms" target="_blank">${I18N.t("auth.termsLink")}</a> ${I18N.t("auth.and")} <a href="#/privacy" target="_blank">${I18N.t("auth.privacyLink")}</a>.</p>
      <p class="form-footer-link">${I18N.t("auth.needAccount")} <a href="#/register">${I18N.t("auth.goRegister")}</a></p>
    </div>
  `;
  document.getElementById("login-submit").addEventListener("click", async () => {
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const msgEl = document.getElementById("login-msg");
    try {
      const data = await api("/api/auth/login", { method: "POST", body: { email, password } });
      setAuth(data.token, data.user);
      location.hash = "#/";
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
    }
  });
}

function renderRegister() {
  viewEl.dataset.homeMounted = "";
  viewEl.innerHTML = `
    <div class="form-panel">
      <h2 class="section-heading">${I18N.t("auth.registerTitle")}</h2>
      <div class="form-group">
        <label>${I18N.t("auth.name")}</label>
        <input type="text" id="reg-name" />
      </div>
      <div class="form-group">
        <label>${I18N.t("auth.email")}</label>
        <input type="email" id="reg-email" />
      </div>
      <div class="form-group">
        <label>${I18N.t("auth.password")}</label>
        <input type="password" id="reg-password" />
      </div>
      <div class="form-group">
        <label>${I18N.t("auth.phone")}</label>
        <input type="tel" id="reg-phone" placeholder="+1 555 555 5555" />
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="reg-accept" />
        <label for="reg-accept">${I18N.t("auth.acceptTermsPrefix")} <a href="#/terms" target="_blank">${I18N.t("auth.termsLink")}</a> ${I18N.t("auth.and")} <a href="#/privacy" target="_blank">${I18N.t("auth.privacyLink")}</a>.</label>
      </div>
      <button class="btn btn-primary" id="reg-submit" style="width:100%;" disabled>${I18N.t("auth.submitRegister")}</button>
      <p class="form-msg" id="reg-msg"></p>
      <div class="oauth-divider"><span>${I18N.t("auth.orContinueWith")}</span></div>
      <a class="btn btn-google" style="width:100%;display:flex;" href="/api/auth/google" id="reg-oauth-google">${I18N.t("auth.continueGoogle")}</a>
      <a class="btn btn-facebook" style="width:100%;display:flex;margin-top:8px;" href="/api/auth/facebook" id="reg-oauth-facebook">${I18N.t("auth.continueFacebook")}</a>
      <p class="form-footer-link">${I18N.t("auth.haveAccount")} <a href="#/login">${I18N.t("auth.goLogin")}</a></p>
    </div>
  `;
  const acceptBox = document.getElementById("reg-accept");
  const submitBtn = document.getElementById("reg-submit");
  const msgEl = document.getElementById("reg-msg");
  acceptBox.addEventListener("change", () => {
    submitBtn.disabled = !acceptBox.checked;
    if (acceptBox.checked) {
      msgEl.textContent = "";
      msgEl.className = "form-msg";
    }
  });
  function guardOAuthClick(e) {
    if (!acceptBox.checked) {
      e.preventDefault();
      msgEl.textContent = I18N.t("auth.mustAccept");
      msgEl.className = "form-msg error";
    }
  }
  document.getElementById("reg-oauth-google").addEventListener("click", guardOAuthClick);
  document.getElementById("reg-oauth-facebook").addEventListener("click", guardOAuthClick);
  document.getElementById("reg-submit").addEventListener("click", async () => {
    if (!acceptBox.checked) {
      msgEl.textContent = I18N.t("auth.mustAccept");
      msgEl.className = "form-msg error";
      return;
    }
    const name = document.getElementById("reg-name").value;
    const email = document.getElementById("reg-email").value;
    const password = document.getElementById("reg-password").value;
    const phone = document.getElementById("reg-phone").value;
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: { name, email, password, phone, acceptedTerms: true },
      });
      setAuth(data.token, data.user);
      location.hash = "#/";
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
    }
  });
}

async function renderOAuthCallback(query) {
  viewEl.dataset.homeMounted = "";
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  const token = query.token;
  if (!token) {
    location.hash = "#/login";
    return;
  }
  state.token = token;
  try {
    const data = await api("/api/auth/me", { auth: true });
    setAuth(token, data.user);
  } catch (e) {
    setAuth(null, null);
  }
  location.hash = "#/";
}

// ---------------- Post / Edit Ad ----------------

let photoBuffer = [];

async function renderPostAd(editId) {
  viewEl.dataset.homeMounted = "";
  if (!state.token) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("postAd.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
    return;
  }

  let existing = null;
  if (editId) {
    existing = await api("/api/products/" + editId);
    if (!state.user || existing.sellerId !== state.user.id) {
      viewEl.innerHTML = `<p class="form-msg error">Not authorized.</p>`;
      return;
    }
  }
  photoBuffer = existing ? existing.photos.slice() : [];

  const categoryOptions = CATEGORY_LIST.map(
    (c) => `<option value="${c.slug}" ${existing && existing.category === c.slug ? "selected" : ""}>${I18N.lang === "es" ? c.es : c.en}</option>`
  ).join("");

  viewEl.innerHTML = `
    <div class="form-panel wide">
      <h2 class="section-heading">${I18N.t("postAd.title")}</h2>
      <div class="form-group">
        <label>${I18N.t("postAd.titleField")}</label>
        <input type="text" id="p-title" maxlength="140" value="${existing ? escapeHtml(existing.title) : ""}" />
      </div>
      <div class="form-group">
        <label>${I18N.t("postAd.descriptionField")}</label>
        <textarea id="p-description" rows="4" maxlength="3000">${existing ? escapeHtml(existing.description) : ""}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${I18N.t("postAd.priceField")}</label>
          <input type="number" id="p-price" min="0" value="${existing ? existing.price : ""}" />
        </div>
        <div class="form-group">
          <label>${I18N.t("postAd.categoryField")}</label>
          <select id="p-category">${categoryOptions}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${I18N.t("postAd.countryField")}</label>
          <input type="text" id="p-country" value="${existing ? escapeHtml(existing.country) : ""}" />
        </div>
        <div class="form-group">
          <label>${I18N.t("postAd.stateField")}</label>
          <input type="text" id="p-state" value="${existing ? escapeHtml(existing.state) : ""}" />
        </div>
        <div class="form-group">
          <label>${I18N.t("postAd.cityField")}</label>
          <input type="text" id="p-city" value="${existing ? escapeHtml(existing.city) : ""}" />
        </div>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="p-offers" ${!existing || existing.allowOffers ? "checked" : ""} />
        <label for="p-offers">${I18N.t("postAd.allowOffers")}</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="p-return" ${existing && existing.allowReturn ? "checked" : ""} />
        <label for="p-return">${I18N.t("postAd.allowReturn")}</label>
      </div>
      <div class="form-group">
        <label>${I18N.t("postAd.photosField")}</label>
        <div class="photo-upload-grid" id="photo-grid"></div>
        <input type="file" id="p-photos" accept="image/*" multiple style="font-size:12px;" />
      </div>
      <button class="btn btn-primary" id="p-submit" style="width:100%;margin-top:10px;">${I18N.t("postAd.publish")}</button>
      <p class="form-msg" id="p-msg"></p>
    </div>
  `;

  renderPhotoGrid();

  document.getElementById("p-photos").addEventListener("change", (e) => {
    const files = Array.from(e.target.files).slice(0, MAX_PHOTOS - photoBuffer.length);
    let remaining = files.length;
    if (remaining === 0) return;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (photoBuffer.length < MAX_PHOTOS) photoBuffer.push(reader.result);
        renderPhotoGrid();
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  });

  document.getElementById("p-submit").addEventListener("click", async () => {
    const msgEl = document.getElementById("p-msg");
    const body = {
      title: document.getElementById("p-title").value,
      description: document.getElementById("p-description").value,
      price: document.getElementById("p-price").value,
      category: document.getElementById("p-category").value,
      country: document.getElementById("p-country").value,
      state: document.getElementById("p-state").value,
      city: document.getElementById("p-city").value,
      allowOffers: document.getElementById("p-offers").checked,
      allowReturn: document.getElementById("p-return").checked,
      photos: photoBuffer,
    };
    try {
      let result;
      if (existing) {
        result = await api("/api/products/" + existing.id, { method: "PUT", auth: true, body });
      } else {
        result = await api("/api/products", { method: "POST", auth: true, body });
      }
      msgEl.textContent = I18N.t("postAd.published");
      msgEl.className = "form-msg ok";
      setTimeout(() => (location.hash = "#/product/" + result.id), 500);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
    }
  });
}

const MAX_PHOTOS = 12;

function renderPhotoGrid() {
  const grid = document.getElementById("photo-grid");
  if (!grid) return;
  let html = "";
  for (let i = 0; i < MAX_PHOTOS; i++) {
    if (photoBuffer[i]) {
      html += `<div class="photo-slot"><img src="${photoBuffer[i]}" /><button class="remove-photo" data-i="${i}">&times;</button></div>`;
    } else {
      html += `<div class="photo-slot">+</div>`;
    }
  }
  grid.innerHTML = html;
  grid.querySelectorAll(".remove-photo").forEach((btn) => {
    btn.addEventListener("click", () => {
      photoBuffer.splice(Number(btn.dataset.i), 1);
      renderPhotoGrid();
    });
  });
}

// ---------------- Profile ----------------

async function renderProfile(userId) {
  viewEl.dataset.homeMounted = "";
  if (!userId) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("messages.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
    return;
  }
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;

  const [profile, reviews, products] = await Promise.all([
    api("/api/users/" + userId),
    api("/api/users/" + userId + "/reviews"),
    api("/api/products?category=all").then((list) => list.filter((p) => p.sellerId === userId)),
  ]);

  const isMe = state.user && state.user.id === userId;

  viewEl.innerHTML = `
    <div class="profile-header">
      ${
        profile.photo
          ? `<img class="profile-avatar" src="${profile.photo}" />`
          : `<div class="profile-avatar-placeholder">${initials(profile.name)}</div>`
      }
      <div>
        <p class="profile-name">${escapeHtml(profile.name)}</p>
        <div class="stars">${starsMarkup(profile.ratingAvg)} <span style="color:#888;font-size:12px;">(${profile.ratingCount})</span></div>
        <p class="profile-sub">${I18N.t("profile.buyerAndSeller")} &middot; ${I18N.t("profile.memberSince")} ${fmtDate(profile.createdAt)}</p>
        ${profile.location ? `<p class="profile-sub">\u{1F4CD} ${escapeHtml(profile.location)}</p>` : ""}
        ${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
      </div>
      <div class="profile-actions">
        ${isMe ? `<button class="btn btn-outline" id="btn-edit-profile">${I18N.t("profile.editProfile")}</button>` : ""}
        ${isMe ? `<a class="btn btn-gold" href="#/post">${I18N.t("profile.postNewListing")}</a>` : ""}
        ${!isMe && state.token ? `<a class="btn btn-primary" href="#/messages/${profile.id}">${I18N.t("profile.messageButton")}</a>` : ""}
      </div>
    </div>

    <div class="tabs">
      <button class="tab-btn active" data-tab="listings">${I18N.t("profile.myListings")}</button>
      <button class="tab-btn" data-tab="reviews">${I18N.t("profile.reviews")}</button>
      ${isMe ? `<button class="tab-btn" data-tab="offers">${I18N.t("profile.myOffers")}</button>` : ""}
      ${isMe && state.user && state.user.isOwner ? `<button class="tab-btn" data-tab="ads">${I18N.t("ads.manageAds")}</button>` : ""}
    </div>

    <div id="tab-listings">
      <div class="product-grid">
        ${
          products.length
            ? products
                .map(
                  (p) => `
          <a class="product-card" href="#/product/${p.id}">
            ${p.photos && p.photos[0] ? `<img class="product-thumb" src="${p.photos[0]}" />` : `<div class="product-thumb-empty">\u{1F4E6}</div>`}
            <div class="product-card-body">
              <p class="product-title">${escapeHtml(p.title)}</p>
              <p class="product-price">${fmtPrice(p.price)}</p>
            </div>
          </a>`
                )
                .join("")
            : `<div class="empty-state">${I18N.t("profile.noListings")}</div>`
        }
      </div>
    </div>

    <div id="tab-reviews" style="display:none;">
      ${
        !isMe && state.token
          ? `
        <div class="form-panel" style="margin-bottom:20px;">
          <label>${I18N.t("profile.leaveReview")}</label>
          <div id="star-input" style="margin:8px 0;"></div>
          <textarea id="review-comment" rows="2" placeholder="${I18N.t("profile.comment")}"></textarea>
          <button class="btn btn-primary" id="review-submit" style="margin-top:8px;">${I18N.t("profile.submitReview")}</button>
          <p class="form-msg" id="review-msg"></p>
        </div>`
          : ""
      }
      ${
        reviews.length
          ? reviews
              .map(
                (r) => `
          <div class="review-card">
            <div class="review-head">
              <span class="review-author">${escapeHtml(r.authorName)}</span>
              <span class="stars">${starsMarkup(r.rating)}</span>
              <span class="review-date">${fmtDate(r.createdAt)}</span>
            </div>
            <div class="review-comment">${escapeHtml(r.comment)}</div>
          </div>`
              )
              .join("")
          : `<div class="empty-state">${I18N.t("profile.noReviews")}</div>`
      }
    </div>

    ${isMe ? `<div id="tab-offers" style="display:none;"></div>` : ""}
    ${isMe && state.user && state.user.isOwner ? `<div id="tab-ads" style="display:none;"></div>` : ""}
  `;

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ["listings", "reviews", "offers", "ads"].forEach((t) => {
        const el = document.getElementById("tab-" + t);
        if (el) el.style.display = t === btn.dataset.tab ? "block" : "none";
      });
      if (btn.dataset.tab === "offers" && isMe) await renderMyOffers();
      if (btn.dataset.tab === "ads" && isMe && state.user && state.user.isOwner) await renderAdsManager();
    });
  });

  if (isMe) {
    document.getElementById("btn-edit-profile").addEventListener("click", () =>
      openEditProfileModal({ ...profile, phone: state.user ? state.user.phone : "" })
    );
  }

  if (!isMe && state.token) {
    let selectedRating = 5;
    const starInput = document.getElementById("star-input");
    function drawStars() {
      starInput.innerHTML = [1, 2, 3, 4, 5]
        .map((n) => `<span class="star-input ${n <= selectedRating ? "filled" : ""}" data-n="${n}">★</span>`)
        .join("");
      starInput.querySelectorAll(".star-input").forEach((s) => {
        s.addEventListener("click", () => {
          selectedRating = Number(s.dataset.n);
          drawStars();
        });
      });
    }
    drawStars();

    document.getElementById("review-submit").addEventListener("click", async () => {
      const comment = document.getElementById("review-comment").value;
      const msgEl = document.getElementById("review-msg");
      try {
        await api(`/api/users/${userId}/reviews`, { method: "POST", auth: true, body: { rating: selectedRating, comment } });
        location.hash = "#/profile/" + userId;
        router();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = "form-msg error";
      }
    });
  }
}

async function renderMyOffers() {
  const el = document.getElementById("tab-offers");
  el.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  const offers = await api("/api/offers/mine", { auth: true });
  el.innerHTML = offers.length
    ? offers
        .map(
          (o) => `
      <div class="review-card">
        <div class="review-head">
          <span class="review-author">${escapeHtml(o.productTitle)}</span>
          <span class="review-date">${fmtDate(o.createdAt)}</span>
        </div>
        <div class="review-comment">${o.type === "buy" ? I18N.t("product.buyNow") : fmtPrice(o.amount)} &middot; ${I18N.t("profile.status." + o.status)}</div>
      </div>`
        )
        .join("")
    : `<div class="empty-state">${I18N.t("profile.noOffers")}</div>`;
}

async function renderAdsManager() {
  const el = document.getElementById("tab-ads");
  if (!el) return;
  el.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  let ads = [];
  try {
    ads = await api("/api/featured?all=1", { auth: true });
  } catch (e) {
    el.innerHTML = `<p class="form-msg error">${escapeHtml(e.message)}</p>`;
    return;
  }

  el.innerHTML = `
    <div class="form-panel" style="margin-bottom:20px;max-width:none;">
      <div class="form-group">
        <label>${I18N.t("ads.advertiserName")}</label>
        <input type="text" id="ad-name" />
      </div>
      <div class="form-group">
        <label>${I18N.t("ads.imageUrl")}</label>
        <input type="text" id="ad-image" placeholder="https://..." />
      </div>
      <div class="form-group">
        <label>${I18N.t("ads.linkUrl")}</label>
        <input type="text" id="ad-link" placeholder="https://..." />
      </div>
      <button class="btn btn-primary" id="ad-add">${I18N.t("ads.addAd")}</button>
      <p class="form-msg" id="ad-msg"></p>
    </div>
    ${
      ads.length
        ? ads
            .map(
              (a) => `
      <div class="review-card" style="display:flex;align-items:center;gap:12px;">
        <img src="${a.imageUrl}" style="width:90px;height:56px;object-fit:cover;border-radius:6px;background:#eee;" />
        <div style="flex:1;min-width:0;">
          <div class="review-author">${escapeHtml(a.advertiserName || "-")}${a.active ? "" : " (paused)"}</div>
          <div class="review-comment" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(a.linkUrl || "")}</div>
        </div>
        <button class="btn btn-outline" data-toggle="${a.id}" data-active="${a.active}">${a.active ? I18N.t("ads.pause") : I18N.t("ads.activate")}</button>
        <button class="btn btn-danger" data-remove="${a.id}">${I18N.t("ads.remove")}</button>
      </div>`
            )
            .join("")
        : `<div class="empty-state">${I18N.t("ads.noAds")}</div>`
    }
  `;

  document.getElementById("ad-add").addEventListener("click", async () => {
    const msgEl = document.getElementById("ad-msg");
    try {
      await api("/api/featured", {
        method: "POST",
        auth: true,
        body: {
          advertiserName: document.getElementById("ad-name").value,
          imageUrl: document.getElementById("ad-image").value,
          linkUrl: document.getElementById("ad-link").value,
        },
      });
      await renderAdsManager();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
    }
  });

  el.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/featured/" + btn.dataset.remove, { method: "DELETE", auth: true });
      await renderAdsManager();
    });
  });
  el.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const active = btn.dataset.active === "true";
      await api("/api/featured/" + btn.dataset.toggle, { method: "PUT", auth: true, body: { active: !active } });
      await renderAdsManager();
    });
  });
}

function openEditProfileModal(profile) {
  let photoDataUrl = profile.photo;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <h2 class="section-heading">${I18N.t("profile.editProfile")}</h2>
      <div class="form-group">
        <label>${I18N.t("profile.photo")}</label><br/>
        <img id="edit-photo-preview" src="${photoDataUrl || ""}" style="width:70px;height:70px;border-radius:50%;object-fit:cover;background:#ddd;display:${photoDataUrl ? "block" : "none"};margin-bottom:6px;" />
        <input type="file" id="edit-photo-input" accept="image/*" />
      </div>
      <div class="form-group">
        <label>${I18N.t("profile.name")}</label>
        <input type="text" id="edit-name" value="${escapeHtml(profile.name)}" />
      </div>
      <div class="form-group">
        <label>${I18N.t("profile.location")}</label>
        <input type="text" id="edit-location" value="${escapeHtml(profile.location || "")}" />
      </div>
      <div class="form-group">
        <label>${I18N.t("auth.phone")}</label>
        <input type="tel" id="edit-phone" value="${escapeHtml(profile.phone || "")}" />
      </div>
      <div class="form-group">
        <label>${I18N.t("profile.bio")}</label>
        <textarea id="edit-bio" rows="3">${escapeHtml(profile.bio || "")}</textarea>
      </div>
      <div class="action-row">
        <button class="btn btn-primary" id="edit-save">${I18N.t("profile.save")}</button>
        <button class="btn btn-secondary" id="edit-cancel">${I18N.t("common.cancel")}</button>
      </div>
      <p class="form-msg" id="edit-msg"></p>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("edit-photo-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      photoDataUrl = reader.result;
      const img = document.getElementById("edit-photo-preview");
      img.src = photoDataUrl;
      img.style.display = "block";
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("edit-cancel").addEventListener("click", () => overlay.remove());
  document.getElementById("edit-save").addEventListener("click", async () => {
    const msgEl = document.getElementById("edit-msg");
    try {
      const data = await api("/api/users/me", {
        method: "PUT",
        auth: true,
        body: {
          name: document.getElementById("edit-name").value,
          location: document.getElementById("edit-location").value,
          phone: document.getElementById("edit-phone").value,
          bio: document.getElementById("edit-bio").value,
          photo: photoDataUrl,
        },
      });
      state.user = { ...state.user, ...data.user };
      localStorage.setItem("authUser", JSON.stringify(state.user));
      overlay.remove();
      router();
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
    }
  });
}

// ---------------- Messages ----------------

let convoPollTimer = null;

async function renderMessages(otherUserId) {
  viewEl.dataset.homeMounted = "";
  if (!state.token) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("messages.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
    return;
  }
  if (convoPollTimer) clearInterval(convoPollTimer);

  viewEl.innerHTML = `
    <h2 class="section-heading">${I18N.t("messages.inbox")}</h2>
    <div class="messages-layout">
      <div class="convo-list" id="convo-list"></div>
      <div class="chat-panel" id="chat-panel"></div>
    </div>
  `;

  await loadConvoList(otherUserId);
  if (otherUserId) await loadChat(otherUserId);

  convoPollTimer = setInterval(async () => {
    await loadConvoList(otherUserId);
    if (otherUserId) await loadChat(otherUserId, true);
  }, 4000);
}

async function loadConvoList(activeId) {
  const list = document.getElementById("convo-list");
  if (!list) return;
  const convos = await api("/api/conversations", { auth: true });
  list.innerHTML = convos.length
    ? convos
        .map(
          (c) => `
      <a class="convo-item ${c.userId === activeId ? "active" : ""}" href="#/messages/${c.userId}">
        ${c.userPhoto ? `<img class="mini-avatar" style="width:32px;height:32px;" src="${c.userPhoto}" />` : `<div class="seller-avatar-placeholder" style="width:32px;height:32px;font-size:13px;">${initials(c.userName)}</div>`}
        <div>
          <div class="convo-name">${escapeHtml(c.userName)}</div>
          <div class="convo-preview">${escapeHtml(c.lastMessage)}</div>
        </div>
        ${c.unread ? `<span class="convo-dot"></span>` : ""}
      </a>`
        )
        .join("")
    : `<p style="padding:16px;color:#888;font-size:13px;">${I18N.t("messages.noConversations")}</p>`;
}

async function loadChat(otherUserId, silent) {
  const panel = document.getElementById("chat-panel");
  if (!panel) return;
  if (!silent) panel.innerHTML = `<div class="chat-messages" id="chat-messages"></div><div class="chat-input-row"><input id="chat-text" placeholder="${I18N.t("messages.typeMessage")}" /><button class="btn btn-primary" id="chat-send">${I18N.t("messages.send")}</button></div>`;

  const messages = await api("/api/conversations/" + otherUserId, { auth: true });
  const other = await api("/api/users/" + otherUserId);
  const container = document.getElementById("chat-messages");
  if (container) {
    container.innerHTML = messages
      .map(
        (m) =>
          `<div class="chat-bubble ${m.fromUserId === state.user.id ? "mine" : "theirs"}">${escapeHtml(m.text)}</div>`
      )
      .join("");
    container.scrollTop = container.scrollHeight;
  }

  const sendBtn = document.getElementById("chat-send");
  if (sendBtn && !sendBtn.dataset.wired) {
    sendBtn.dataset.wired = "1";
    const send = async () => {
      const input = document.getElementById("chat-text");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      await api("/api/conversations/" + otherUserId, { method: "POST", auth: true, body: { text } });
      await loadChat(otherUserId, true);
      await loadConvoList(otherUserId);
    };
    sendBtn.addEventListener("click", send);
    document.getElementById("chat-text").addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });
  }
}

// ---------------- Init ----------------

applyStaticI18n();
updateNavUI();
router();
refreshMe();
