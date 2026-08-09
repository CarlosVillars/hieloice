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

function ratingMarkup(rating) {
  if (!rating || !rating.ratingCount) return "";
  return `<span class="stars" title="${rating.ratingAvg}/5">${starsMarkup(rating.ratingAvg)} <span class="rating-count">(${rating.ratingCount})</span></span>`;
}

function statusBadgeMarkup(status) {
  if (!status || status === "active") return "";
  return `<span class="status-badge status-${status}">${I18N.t("product.status." + status)}</span>`;
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
  pollUnread();
}

async function refreshMe() {
  if (!state.token) return;
  try {
    const data = await api("/api/auth/me", { auth: true });
    state.user = data.user;
    localStorage.setItem("authUser", JSON.stringify(data.user));
  } catch (e) {
    // Only clear the session on a genuine "not authenticated" rejection
    // (HTTP 401) from the server. A network hiccup - e.g. right after a
    // mobile pull-to-refresh reload, or a brief connectivity blip - must
    // never log the user out; just keep the existing token/user as-is.
    if (e.status === 401) {
      setAuth(null, null);
    }
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
  const iconNav = document.getElementById("icon-nav");
  if (iconNav) iconNav.style.display = loggedIn ? "flex" : "none";
  if (!loggedIn) {
    setUnreadBadge(0);
    setIconNavBadge(0);
  }
}

document.getElementById("nav-logout").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", auth: true });
  } catch (e) {}
  setAuth(null, null);
  location.hash = "#/";
});

// ---------------- Unread messages badge ----------------

let unreadPollTimer = null;

function setUnreadBadge(count) {
  const badge = document.getElementById("nav-messages-badge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

async function pollUnread() {
  if (!state.token) {
    setUnreadBadge(0);
    setIconNavBadge(0);
    return;
  }
  try {
    const convos = await api("/api/conversations", { auth: true });
    const count = convos.filter((c) => c.unread).length;
    setUnreadBadge(count);
    let requestCount = 0;
    try {
      const requests = await api("/api/friends/requests", { auth: true });
      requestCount = requests.length;
    } catch (e) {}
    setIconNavBadge(count + requestCount);
  } catch (e) {
    // best-effort; ignore failures silently
  }
}

// ---------------- Language toggle ----------------

// Null-safe: a mismatch between an id referenced here and the actual DOM
// (e.g. a markup element renamed/removed during a UI refactor) must never
// throw and abort the rest of the app's init sequence - that previously
// caused refreshMe()/router() to never run on a real page load, which
// looked exactly like the user being logged out (the auth token itself was
// never touched - the UI just froze in its pre-JS default state).
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function applyStaticI18n() {
  setText("brand-name", I18N.t("site.name"));
  const searchEl = document.getElementById("global-search");
  if (searchEl) searchEl.placeholder = I18N.t("home.searchPlaceholder");
  setText("nav-messages", I18N.t("nav.messages"));
  setText("nav-profile", I18N.t("nav.profile"));
  setText("nav-post", I18N.t("nav.postAd"));
  setText("nav-login", I18N.t("nav.login"));
  setText("nav-register", I18N.t("nav.register"));
  setText("nav-logout", I18N.t("nav.logout"));
  document.getElementById("lang-en").classList.toggle("active", I18N.lang === "en");
  document.getElementById("lang-es").classList.toggle("active", I18N.lang === "es");
  setText("icon-nav-home-label", I18N.t("iconnav.home"));
  setText("icon-nav-friends-label", I18N.t("iconnav.friends"));
  setText("icon-nav-shorts-label", I18N.t("iconnav.shorts"));
  setText("icon-nav-marketplace-label", I18N.t("iconnav.marketplace"));
  setText("icon-nav-notifications-label", I18N.t("iconnav.notifications"));
  setText("icon-nav-dropdown-marketplace", "🛒 " + I18N.t("iconnav.dropdownMarketplace"));
  setText("icon-nav-dropdown-intl", "🌎 " + I18N.t("iconnav.dropdownIntl"));
  setText("icon-nav-dropdown-groups", "💬 " + I18N.t("iconnav.dropdownGroups"));
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

// ---------------- Icon nav (Home / Friends / Marketplace / Notifications) ----------------

(function wireIconNav() {
  const marketplaceBtn = document.getElementById("icon-nav-marketplace");
  const dropdown = document.getElementById("icon-nav-marketplace-dropdown");
  if (!marketplaceBtn || !dropdown) return;
  marketplaceBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
  });
  document.addEventListener("click", () => {
    dropdown.style.display = "none";
  });
  dropdown.addEventListener("click", (e) => e.stopPropagation());
})();

function setIconNavBadge(count) {
  const badge = document.getElementById("icon-nav-badge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
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
    if (parts[0] === "marketplace") return renderMarketplaceHome();
    if (parts[0] === "friends") return renderFriendsPage();
    if (parts[0] === "shorts") return renderShorts();
    if (parts[0] === "groups" && parts[1]) return renderGroupDetail(parts[1]);
    if (parts[0] === "groups") return renderGroupsHome();
    if (parts[0] === "notifications") return renderNotificationsPage();
    if (parts[0] === "category" && parts[1]) return renderCategory(parts[1], query);
    if (parts[0] === "product" && parts[1]) return renderProductDetail(parts[1]);
    if (parts[0] === "login") return renderLogin();
    if (parts[0] === "register") return renderRegister();
    if (parts[0] === "oauth-callback") return renderOAuthCallback(query);
    if (parts[0] === "post") return renderPostAd();
    if (parts[0] === "edit" && parts[1]) return renderPostAd(parts[1]);
    if (parts[0] === "profile" && parts[1]) return renderProfile(parts[1]);
    if (parts[0] === "profile") return renderProfile(state.user ? state.user.id : null);
    if (parts[0] === "messages" && parts[1]) return renderMessages(parts[1]);
    if (parts[0] === "messages") return renderMessages(null);
    if (parts[0] === "intl" && parts[1] === "register") return renderIntlForm(null);
    if (parts[0] === "intl" && parts[1] === "edit" && parts[2]) return renderIntlForm(parts[2]);
    if (parts[0] === "intl" && parts[1] === "directory") return renderIntlDirectory(query);
    if (parts[0] === "intl" && parts[1] === "company" && parts[2]) return renderIntlCompanyDetail(parts[2]);
    if (parts[0] === "intl" && parts[1] === "mine") return renderIntlMyCompanies();
    if (parts[0] === "intl" && parts[1] === "admin") return renderIntlAdminQueue();
    if (parts[0] === "intl") return renderIntlHome();
    viewEl.innerHTML = "<p>Not found.</p>";
  } catch (e) {
    viewEl.innerHTML = `<p class="form-msg error">${escapeHtml(e.message)}</p>`;
  }
}
window.addEventListener("hashchange", router);

// ---------------- Home ----------------

function categoryCardsHtml() {
  return CATEGORY_LIST.map(
    (c) => `
    <a class="category-card" href="#/category/${c.slug}">
      ${c.img ? `<img class="category-icon category-icon-img" src="${c.img}" alt="" />` : `<span class="category-icon">${c.icon}</span>`}
      <span class="category-label">${I18N.lang === "es" ? c.es : c.en}</span>
    </a>`
  ).join("");
}

// Home ("#/"): the moments feed for logged-in users (Facebook-style focus on
// sharing), falling back to the marketplace grid for guests who have nothing
// to see in a feed yet.
function renderHome() {
  if (!state.token) return renderMarketplaceHome();

  viewEl.innerHTML = `
    <div class="feed-section" id="feed-section-friends">
      <h2 class="section-heading">${I18N.t("feed.friendsHeading")}</h2>
      <div class="moments-bar" id="home-moments-bar-friends" style="display:none;"></div>
    </div>
    <div class="feed-section" id="feed-section-suggested" style="display:none;">
      <h2 class="section-heading">${I18N.t("feed.suggestedHeading")}</h2>
      <div class="moments-bar" id="home-moments-bar-suggested" style="display:none;"></div>
    </div>
    <div id="ad-carousel" class="ad-carousel" style="display:none;"></div>
    <h2 class="section-heading">${I18N.t("home.categoriesHeading")}</h2>
    <div class="category-grid">${categoryCardsHtml()}</div>
  `;
  loadAdCarousel();
  loadHomeFeed();
}

// "#/marketplace": the classic category-grid landing page, also reachable by
// guests at "#/" and by logged-in users via the Marketplace icon-nav button.
function renderMarketplaceHome() {
  viewEl.innerHTML = `
    <div id="ad-carousel" class="ad-carousel" style="display:none;"></div>
    <div class="hero">
      <h1>${escapeHtml(I18N.t("site.name"))}</h1>
      <p>${escapeHtml(I18N.t("site.tagline"))}</p>
    </div>
    <h2 class="section-heading">${I18N.t("home.categoriesHeading")}</h2>
    <div class="category-grid">${categoryCardsHtml()}</div>
  `;
  loadAdCarousel();
}

async function loadHomeFeed() {
  const elFriends = document.getElementById("home-moments-bar-friends");
  const suggestedSection = document.getElementById("feed-section-suggested");
  const elSuggested = document.getElementById("home-moments-bar-suggested");
  if (!elFriends) return;
  try {
    const data = await api("/api/moments/feed", { auth: true });
    elFriends.style.display = "flex";
    renderMomentGroupsBar(elFriends, data.friends || [], {
      showAddForUserId: state.user.id,
      ownPhoto: state.user.photo,
      ownName: state.user.name,
    });
    if (data.suggested && data.suggested.length) {
      suggestedSection.style.display = "block";
      elSuggested.style.display = "flex";
      renderMomentGroupsBar(elSuggested, data.suggested, {});
    } else {
      suggestedSection.style.display = "none";
    }
  } catch (e) {
    elFriends.style.display = "none";
    suggestedSection.style.display = "none";
  }
}

let adRotateTimer = null;

async function loadAdCarousel() {
  const el = document.getElementById("ad-carousel");
  if (!el) return;
  if (adRotateTimer) {
    clearInterval(adRotateTimer);
    adRotateTimer = null;
  }
  try {
    const ads = await api("/api/ads");
    if (!ads || !ads.length) return;
    let idx = 0;
    const draw = () => {
      const ad = ads[idx];
      el.innerHTML = `
        <a class="ad-slide" href="${escapeHtml(ad.linkUrl || "#")}" target="_blank" rel="noopener">
          <img src="${ad.imageUrl}" alt="${escapeHtml(ad.advertiserName || "")}" />
          <span class="ad-badge">${I18N.t("ads.sponsored")}${ad.advertiserName ? " &middot; " + escapeHtml(ad.advertiserName) : ""}</span>
        </a>
        ${
          ads.length > 1
            ? `<div class="ad-dots">${ads.map((_, i) => `<span class="ad-dot ${i === idx ? "active" : ""}"></span>`).join("")}</div>`
            : ""
        }
      `;
    };
    draw();
    el.style.display = "block";
    if (ads.length > 1) {
      adRotateTimer = setInterval(() => {
        idx = (idx + 1) % ads.length;
        draw();
      }, 5000);
    }
  } catch (e) {
    // ads are best-effort; ignore failures silently
  }
}

// ---------------- Category listing ----------------

async function renderCategory(slug, query) {
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;

  const params = new URLSearchParams();
  if (slug !== "all") params.set("category", slug);
  if (query.q) params.set("q", query.q);
  if (query.country) params.set("country", query.country);
  if (query.state) params.set("state", query.state);
  if (query.city) params.set("city", query.city);
  if (query.minPrice) params.set("minPrice", query.minPrice);
  if (query.maxPrice) params.set("maxPrice", query.maxPrice);
  if (query.sort) params.set("sort", query.sort);

  const products = await api("/api/products?" + params.toString());
  const heading = slug === "all" ? (query.q || "") : I18N.categoryName(slug);

  const cards = products.length
    ? products
        .map(
          (p) => `
      <a class="product-card" href="#/product/${p.id}">
        <div class="product-thumb-wrap">
          ${
            p.photos && p.photos[0]
              ? `<img class="product-thumb" src="${p.photos[0]}" alt="" />`
              : `<div class="product-thumb-empty">\u{1F4E6}</div>`
          }
          ${statusBadgeMarkup(p.status)}
        </div>
        <div class="product-card-body">
          <p class="product-title">${escapeHtml(p.title)}</p>
          <p class="product-price">${fmtPrice(p.price)}</p>
          <p class="product-location">${escapeHtml(locationLabel(p)) || "&nbsp;"}</p>
          <div class="product-seller-row">
            ${p.sellerPhoto ? `<img class="mini-avatar" src="${p.sellerPhoto}" />` : ""}
            <span>${escapeHtml(p.sellerName)}</span>
            ${ratingMarkup(p.sellerRating)}
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
      <input type="number" id="f-min-price" min="0" placeholder="${I18N.t("category.filterMinPrice")}" value="${escapeHtml(query.minPrice || "")}" />
      <input type="number" id="f-max-price" min="0" placeholder="${I18N.t("category.filterMaxPrice")}" value="${escapeHtml(query.maxPrice || "")}" />
      <select id="f-sort">
        <option value="" ${!query.sort ? "selected" : ""}>${I18N.t("category.sortNewest")}</option>
        <option value="price_asc" ${query.sort === "price_asc" ? "selected" : ""}>${I18N.t("category.sortPriceAsc")}</option>
        <option value="price_desc" ${query.sort === "price_desc" ? "selected" : ""}>${I18N.t("category.sortPriceDesc")}</option>
      </select>
      <button id="f-apply">${I18N.t("category.applyFilters")}</button>
    </div>
    <div class="product-grid">${cards}</div>
  `;

  document.getElementById("f-apply").addEventListener("click", () => {
    const p = new URLSearchParams();
    const country = document.getElementById("f-country").value.trim();
    const st = document.getElementById("f-state").value.trim();
    const city = document.getElementById("f-city").value.trim();
    const minPrice = document.getElementById("f-min-price").value.trim();
    const maxPrice = document.getElementById("f-max-price").value.trim();
    const sort = document.getElementById("f-sort").value;
    if (query.q) p.set("q", query.q);
    if (country) p.set("country", country);
    if (st) p.set("state", st);
    if (city) p.set("city", city);
    if (minPrice) p.set("minPrice", minPrice);
    if (maxPrice) p.set("maxPrice", maxPrice);
    if (sort) p.set("sort", sort);
    location.hash = `#/category/${slug}` + (p.toString() ? "?" + p.toString() : "");
  });
}

// ---------------- Product detail ----------------

async function renderProductDetail(id) {
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
  const isOwnerOfListing = state.user && state.user.id === p.sellerId;

  viewEl.innerHTML = `
    <a class="back-link" href="#/category/${p.category}">&larr; ${I18N.t("category.back")}</a>
    <div class="product-detail">
      <div>
        ${statusBadgeMarkup(p.status)}
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
        <div class="detail-price-row">
          <div class="detail-price">${fmtPrice(p.price)}</div>
          ${
            isOwnerOfListing
              ? `<span class="save-count-badge">\u{1F516} ${I18N.t("saved.countLabel").replace("{n}", p.saveCount || 0)}</span>`
              : `<button class="save-btn ${p.saved ? "active" : ""}" id="save-toggle-btn" data-id="${p.id}">
                  <span id="save-btn-icon">${p.saved ? "\u{1F516}" : "\u{1F5A4}"}</span>
                  <span id="save-btn-label">${p.saved ? I18N.t("saved.saved") : I18N.t("saved.save")}</span>
                  <span id="save-btn-count">(${p.saveCount || 0})</span>
                </button>`
          }
        </div>
        <div class="detail-meta">\u{1F4CD} ${escapeHtml(locationLabel(p)) || "-"} &middot; ${fmtDate(p.createdAt)}</div>
        <div>
          <span class="badge">${escapeHtml(I18N.categoryName(p.category))}</span>
          <span class="badge ${p.allowReturn ? "" : "no"}">${p.allowReturn ? I18N.t("product.returnsAllowed") : I18N.t("product.returnsNotAllowed")}</span>
        </div>
        <p style="white-space:pre-wrap;font-size:14px;margin-top:14px;">${escapeHtml(p.description)}</p>

        <a class="seller-card" href="#/profile/${p.sellerId}">
          ${
            p.sellerPhoto
              ? `<img class="seller-avatar" src="${p.sellerPhoto}" />`
              : `<div class="seller-avatar-placeholder">${initials(p.sellerName)}</div>`
          }
          <div>
            <div class="seller-name">${escapeHtml(p.sellerName)}${p.sellerVerified ? ` <span class="verified-badge-inline" title="${I18N.t("profile.verifiedBadge")}">\u{2713}</span>` : ""}</div>
            <div class="stars">${starsMarkup(p.sellerRating.ratingAvg)} <span style="color:#888;font-size:12px;">(${p.sellerRating.ratingCount})</span></div>
            <div class="seller-sales-count">\u{1F91D} ${I18N.t("profile.salesCountLabel").replace("{n}", p.sellerSalesCount || 0)}</div>
          </div>
        </a>

        ${
          isOwnerOfListing
            ? `<div class="action-row" id="status-controls">
                <button class="btn btn-outline" data-status="active" ${p.status === "active" || !p.status ? "disabled" : ""}>${I18N.t("product.markActive")}</button>
                <button class="btn btn-outline" data-status="reserved" ${p.status === "reserved" ? "disabled" : ""}>${I18N.t("product.markReserved")}</button>
                <button class="btn btn-outline" data-status="sold" ${p.status === "sold" ? "disabled" : ""}>${I18N.t("product.markSold")}</button>
              </div>
              <div class="action-row"><button class="btn btn-danger" id="delete-listing">${I18N.t("product.deleteListing")}</button></div>`
            : ""
        }
        ${!isOwnerOfListing ? renderProductActions(p) : ""}
        <div id="offer-area"></div>
        ${
          !isOwnerOfListing
            ? `<p style="margin-top:14px;"><a href="#" id="report-listing-link" class="report-link">${I18N.t("report.reportListing")}</a></p>`
            : ""
        }
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

  if (isOwnerOfListing) {
    document.getElementById("delete-listing").addEventListener("click", async () => {
      if (!confirm("Delete this listing? / Eliminar este aviso?")) return;
      await api("/api/products/" + p.id, { method: "DELETE", auth: true });
      location.hash = "#/profile";
    });
    document.querySelectorAll("#status-controls [data-status]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("/api/products/" + p.id, { method: "PUT", auth: true, body: { status: btn.dataset.status } });
          router();
        } catch (e) {
          alert(e.message);
        }
      });
    });
  } else {
    wireProductActions(p);
    const reportLink = document.getElementById("report-listing-link");
    if (reportLink) {
      reportLink.addEventListener("click", (e) => {
        e.preventDefault();
        openReportModal("product", p.id);
      });
    }
  }

  const saveBtn = document.getElementById("save-toggle-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      const nowSaved = !saveBtn.classList.contains("active");
      try {
        if (nowSaved) {
          await api("/api/products/" + saveBtn.dataset.id + "/save", { method: "POST", auth: true, body: {} });
        } else {
          await api("/api/products/" + saveBtn.dataset.id + "/save", { method: "DELETE", auth: true });
        }
        saveBtn.classList.toggle("active", nowSaved);
        document.getElementById("save-btn-icon").textContent = nowSaved ? "\u{1F516}" : "\u{1F5A4}";
        document.getElementById("save-btn-label").textContent = nowSaved ? I18N.t("saved.saved") : I18N.t("saved.save");
        const countEl = document.getElementById("save-btn-count");
        const current = Number(countEl.textContent.replace(/[()]/g, "")) || 0;
        countEl.textContent = "(" + (nowSaved ? current + 1 : Math.max(0, current - 1)) + ")";
      } catch (e) {
        alert(e.message);
      }
    });
  }
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

// ---------------- Report modal (report a listing or a user) ----------------

function openReportModal(targetType, targetId) {
  if (!state.token) {
    location.hash = "#/login";
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <h2 class="section-heading">${targetType === "user" ? I18N.t("report.reportUser") : I18N.t("report.reportListing")}</h2>
      <div class="form-group">
        <label>${I18N.t("report.reasonLabel")}</label>
        <select id="report-reason">
          <option value="">${I18N.t("report.reasonSelect")}</option>
          <option value="spam">${I18N.t("report.reasonSpam")}</option>
          <option value="prohibited">${I18N.t("report.reasonProhibited")}</option>
          <option value="inappropriate">${I18N.t("report.reasonInappropriate")}</option>
          <option value="fraud">${I18N.t("report.reasonFraud")}</option>
          <option value="other">${I18N.t("report.reasonOther")}</option>
        </select>
      </div>
      <div class="form-group">
        <label>${I18N.t("report.descriptionLabel")}</label>
        <textarea id="report-description" rows="3"></textarea>
      </div>
      <div class="action-row">
        <button class="btn btn-primary" id="report-submit">${I18N.t("report.submit")}</button>
        <button class="btn btn-secondary" id="report-cancel">${I18N.t("common.cancel")}</button>
      </div>
      <p class="form-msg" id="report-msg"></p>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("report-cancel").addEventListener("click", () => overlay.remove());
  document.getElementById("report-submit").addEventListener("click", async () => {
    const reason = document.getElementById("report-reason").value;
    const msgEl = document.getElementById("report-msg");
    if (!reason) {
      msgEl.textContent = I18N.t("report.selectReason");
      msgEl.className = "form-msg error";
      return;
    }
    const description = document.getElementById("report-description").value;
    try {
      await api("/api/reports", {
        method: "POST",
        auth: true,
        body: { targetType, targetId, reason, description },
      });
      overlay.querySelector(".modal-box").innerHTML = `<p class="form-msg ok">${I18N.t("report.sent")}</p>`;
      setTimeout(() => overlay.remove(), 1800);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
    }
  });
}

// ---------------- Auth views ----------------

function renderLogin() {
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
      <button class="btn btn-primary" id="reg-submit" style="width:100%;">${I18N.t("auth.submitRegister")}</button>
      <p class="form-msg" id="reg-msg"></p>
      <div class="oauth-divider"><span>${I18N.t("auth.orContinueWith")}</span></div>
      <a class="btn btn-google" style="width:100%;display:flex;" href="/api/auth/google">${I18N.t("auth.continueGoogle")}</a>
      <a class="btn btn-facebook" style="width:100%;display:flex;margin-top:8px;" href="/api/auth/facebook">${I18N.t("auth.continueFacebook")}</a>
      <p class="form-footer-link">${I18N.t("auth.haveAccount")} <a href="#/login">${I18N.t("auth.goLogin")}</a></p>
    </div>
  `;
  document.getElementById("reg-submit").addEventListener("click", async () => {
    const name = document.getElementById("reg-name").value;
    const email = document.getElementById("reg-email").value;
    const password = document.getElementById("reg-password").value;
    const phone = document.getElementById("reg-phone").value;
    const msgEl = document.getElementById("reg-msg");
    try {
      const data = await api("/api/auth/register", { method: "POST", body: { name, email, password, phone } });
      setAuth(data.token, data.user);
      location.hash = "#/";
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
    }
  });
}

async function renderOAuthCallback(query) {
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

// ---------------- Friends ----------------

function friendActionMarkup(fs) {
  if (!state.token) {
    return `<a class="btn btn-outline" href="#/login">${I18N.t("friends.addFriend")}</a>`;
  }
  if (!fs || fs.status === "none") {
    return `<button class="btn btn-outline" id="btn-friend-add">${I18N.t("friends.addFriend")}</button>`;
  }
  if (fs.status === "pending_sent") {
    return `<button class="btn btn-friend-status" id="btn-friend-cancel" data-fid="${fs.friendshipId}">${I18N.t("friends.requestSent")}</button>`;
  }
  if (fs.status === "pending_received") {
    return `
      <button class="btn btn-primary" id="btn-friend-accept" data-fid="${fs.friendshipId}">${I18N.t("friends.accept")}</button>
      <button class="btn btn-secondary" id="btn-friend-decline" data-fid="${fs.friendshipId}">${I18N.t("friends.decline")}</button>
    `;
  }
  if (fs.status === "friends") {
    return `<button class="btn btn-friend-status" id="btn-friend-remove">${I18N.t("friends.friendsBadge")}</button>`;
  }
  return "";
}

// Follow button for "Public Page" profiles - separate from the friend system,
// one-directional, no acceptance required.
function pageFollowMarkup(fs) {
  if (!state.token) {
    return `<a class="btn btn-outline" href="#/login">${I18N.t("pages.follow")}</a>`;
  }
  if (fs && fs.following) {
    return `<button class="btn btn-friend-status" id="btn-page-unfollow">${I18N.t("pages.following")}</button>`;
  }
  return `<button class="btn btn-primary" id="btn-page-follow">${I18N.t("pages.follow")}</button>`;
}

function wirePageFollowButton(otherUserId) {
  const followBtn = document.getElementById("btn-page-follow");
  if (followBtn) {
    followBtn.addEventListener("click", async () => {
      try {
        await api("/api/follow/" + otherUserId, { method: "POST", auth: true });
        router();
      } catch (e) {
        alert(e.message);
      }
    });
  }
  const unfollowBtn = document.getElementById("btn-page-unfollow");
  if (unfollowBtn) {
    unfollowBtn.addEventListener("click", async () => {
      try {
        await api("/api/follow/" + otherUserId, { method: "DELETE", auth: true });
        router();
      } catch (e) {
        alert(e.message);
      }
    });
  }
}

function wireFriendActionButtons(otherUserId) {
  const addBtn = document.getElementById("btn-friend-add");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      try {
        await api("/api/friends/request", { method: "POST", auth: true, body: { userId: otherUserId } });
        router();
      } catch (e) {
        alert(e.message);
      }
    });
  }
  const cancelBtn = document.getElementById("btn-friend-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", async () => {
      try {
        await api("/api/friends/" + cancelBtn.dataset.fid + "/reject", { method: "POST", auth: true });
        router();
      } catch (e) {
        alert(e.message);
      }
    });
  }
  const acceptBtn = document.getElementById("btn-friend-accept");
  if (acceptBtn) {
    acceptBtn.addEventListener("click", async () => {
      try {
        await api("/api/friends/" + acceptBtn.dataset.fid + "/accept", { method: "POST", auth: true });
        router();
      } catch (e) {
        alert(e.message);
      }
    });
  }
  const declineBtn = document.getElementById("btn-friend-decline");
  if (declineBtn) {
    declineBtn.addEventListener("click", async () => {
      try {
        await api("/api/friends/" + declineBtn.dataset.fid + "/reject", { method: "POST", auth: true });
        router();
      } catch (e) {
        alert(e.message);
      }
    });
  }
  const removeBtn = document.getElementById("btn-friend-remove");
  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      if (!confirm(I18N.t("friends.confirmRemove"))) return;
      try {
        await api("/api/friends/user/" + otherUserId, { method: "DELETE", auth: true });
        router();
      } catch (e) {
        alert(e.message);
      }
    });
  }
}

async function renderFriendsTab() {
  const el = document.getElementById("tab-friends");
  if (!el) return;
  el.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  const friends = await api("/api/friends", { auth: true });
  el.innerHTML = friends.length
    ? `<div class="friends-grid">${friends
        .map(
          (f) => `
      <div class="friend-card">
        <a href="#/profile/${f.userId}">
          ${f.photo ? `<img class="friend-card-photo" src="${f.photo}" />` : `<div class="friend-card-photo-placeholder">${initials(f.name)}</div>`}
        </a>
        <div class="friend-card-body">
          <p class="friend-card-name">${escapeHtml(f.name)}</p>
          <button class="friend-card-remove" data-uid="${f.userId}">${I18N.t("friends.removeFriend")}</button>
        </div>
      </div>`
        )
        .join("")}</div>`
    : `<div class="empty-state">${I18N.t("friends.noFriends")}</div>`;

  el.querySelectorAll(".friend-card-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(I18N.t("friends.confirmRemove"))) return;
      await api("/api/friends/user/" + btn.dataset.uid, { method: "DELETE", auth: true });
      renderFriendsTab();
    });
  });
}

async function renderRequestsTab() {
  const el = document.getElementById("tab-requests");
  if (!el) return;
  el.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  const requests = await api("/api/friends/requests", { auth: true });
  el.innerHTML = requests.length
    ? requests
        .map(
          (r) => `
      <div class="friend-request-row">
        ${r.photo ? `<img class="mini-avatar" style="width:36px;height:36px;" src="${r.photo}" />` : `<div class="seller-avatar-placeholder" style="width:36px;height:36px;">${initials(r.name)}</div>`}
        <span class="friend-request-name">${escapeHtml(r.name)}</span>
        <button class="btn btn-primary" data-accept="${r.friendshipId}">${I18N.t("friends.accept")}</button>
        <button class="btn btn-secondary" data-decline="${r.friendshipId}">${I18N.t("friends.decline")}</button>
      </div>`
        )
        .join("")
    : `<div class="empty-state">${I18N.t("friends.noRequests")}</div>`;

  el.querySelectorAll("[data-accept]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/friends/" + btn.dataset.accept + "/accept", { method: "POST", auth: true });
      renderRequestsTab();
      pollUnread();
    });
  });
  el.querySelectorAll("[data-decline]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/friends/" + btn.dataset.decline + "/reject", { method: "POST", auth: true });
      renderRequestsTab();
    });
  });
}

// ---------------- Friends page ("#/friends", reached from the icon nav) ----------------

async function renderFriendsPage() {
  if (!state.token) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("messages.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
    return;
  }
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;

  const [requests, friends] = await Promise.all([
    api("/api/friends/requests", { auth: true }),
    api("/api/friends", { auth: true }),
  ]);

  const requestsHtml = requests.length
    ? requests
        .map(
          (r) => `
      <div class="friend-request-row">
        ${r.photo ? `<img class="mini-avatar" style="width:36px;height:36px;" src="${r.photo}" />` : `<div class="seller-avatar-placeholder" style="width:36px;height:36px;">${initials(r.name)}</div>`}
        <span class="friend-request-name">${escapeHtml(r.name)}</span>
        <button class="btn btn-primary" data-accept="${r.friendshipId}">${I18N.t("friends.accept")}</button>
        <button class="btn btn-secondary" data-decline="${r.friendshipId}">${I18N.t("friends.decline")}</button>
      </div>`
        )
        .join("")
    : `<div class="empty-state">${I18N.t("friends.noRequests")}</div>`;

  const friendsHtml = friends.length
    ? `<div class="friends-grid">${friends
        .map(
          (f) => `
      <div class="friend-card">
        <a href="#/profile/${f.userId}">
          ${f.photo ? `<img class="friend-card-photo" src="${f.photo}" />` : `<div class="friend-card-photo-placeholder">${initials(f.name)}</div>`}
        </a>
        <div class="friend-card-body">
          <p class="friend-card-name">${escapeHtml(f.name)}</p>
          <button class="friend-card-remove" data-uid="${f.userId}">${I18N.t("friends.removeFriend")}</button>
        </div>
      </div>`
        )
        .join("")}</div>`
    : `<div class="empty-state">${I18N.t("friends.noFriends")}</div>`;

  viewEl.innerHTML = `
    <h2 class="section-heading">${I18N.t("friendsPage.title")}</h2>
    <h3 class="section-subheading">${I18N.t("friendsPage.requestsHeading")}</h3>
    <div id="friends-page-requests">${requestsHtml}</div>
    <h3 class="section-subheading">${I18N.t("friendsPage.friendsHeading")}</h3>
    <div id="friends-page-friends">${friendsHtml}</div>
  `;

  document.querySelectorAll("[data-accept]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/friends/" + btn.dataset.accept + "/accept", { method: "POST", auth: true });
      renderFriendsPage();
      pollUnread();
    });
  });
  document.querySelectorAll("[data-decline]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/friends/" + btn.dataset.decline + "/reject", { method: "POST", auth: true });
      renderFriendsPage();
    });
  });
  document.querySelectorAll(".friend-card-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(I18N.t("friends.confirmRemove"))) return;
      await api("/api/friends/user/" + btn.dataset.uid, { method: "DELETE", auth: true });
      renderFriendsPage();
    });
  });
}

// ---------------- Communities ("#/groups", "#/groups/:slug") ----------------
// Reddit-style category/city groups: open posting (no join step, v1), ranked
// by community upvote/downvote instead of a corporate algorithm. This is the
// trust-layer piece a plain marketplace (Facebook Marketplace included)
// doesn't have - scam warnings, seller reviews, and questions surfaced by
// what the community actually values, not by who paid or who you follow.

function categoryLabel(slug) {
  const c = CATEGORY_LIST.find((x) => x.slug === slug);
  if (!c) return slug || "";
  return I18N.lang === "es" ? c.es : c.en;
}

async function renderGroupsHome() {
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  const groups = await api("/api/groups");

  const listHtml = groups.length
    ? `<div class="groups-grid">${groups
        .map(
          (g) => `
      <a class="group-card" href="#/groups/${g.slug}">
        <p class="group-card-name">${escapeHtml(g.name)}</p>
        <p class="group-card-meta">${[g.category ? categoryLabel(g.category) : "", g.city]
          .filter(Boolean)
          .map(escapeHtml)
          .join(" · ")}</p>
        ${g.description ? `<p class="group-card-desc">${escapeHtml(g.description)}</p>` : ""}
      </a>`
        )
        .join("")}</div>`
    : `<div class="empty-state">${I18N.t("groups.empty")}</div>`;

  viewEl.innerHTML = `
    <div class="groups-header">
      <h2 class="section-heading">${I18N.t("groups.heading")}</h2>
      ${state.token ? `<button class="btn btn-primary" id="groups-create-btn">${I18N.t("groups.create")}</button>` : ""}
    </div>
    <p class="groups-subtitle">${I18N.t("groups.subtitle")}</p>
    <div id="groups-create-form" style="display:none;"></div>
    ${listHtml}
  `;

  const createBtn = document.getElementById("groups-create-btn");
  if (createBtn) {
    createBtn.addEventListener("click", () => {
      const formWrap = document.getElementById("groups-create-form");
      if (formWrap.style.display !== "none") {
        formWrap.style.display = "none";
        return;
      }
      formWrap.style.display = "block";
      formWrap.innerHTML = `
        <form id="group-create-form" class="stacked-form">
          <label>${I18N.t("groups.name")}<input type="text" name="name" required maxlength="100" /></label>
          <label>${I18N.t("groups.category")}
            <select name="category">
              <option value="">${I18N.t("groups.categoryAny")}</option>
              ${CATEGORY_LIST.map((c) => `<option value="${c.slug}">${escapeHtml(I18N.lang === "es" ? c.es : c.en)}</option>`).join("")}
            </select>
          </label>
          <label>${I18N.t("groups.city")}<input type="text" name="city" maxlength="80" /></label>
          <label>${I18N.t("groups.description")}<textarea name="description" maxlength="1000"></textarea></label>
          <button type="submit" class="btn btn-primary">${I18N.t("groups.createSubmit")}</button>
          <p class="form-msg" id="group-create-msg"></p>
        </form>
      `;
      document.getElementById("group-create-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const msgEl = document.getElementById("group-create-msg");
        try {
          const g = await api("/api/groups", {
            method: "POST",
            auth: true,
            body: {
              name: fd.get("name"),
              category: fd.get("category") || undefined,
              city: fd.get("city"),
              description: fd.get("description"),
            },
          });
          location.hash = "#/groups/" + g.slug;
        } catch (err) {
          msgEl.textContent = err.message;
          msgEl.className = "form-msg error";
        }
      });
    });
  }
}

async function renderGroupDetail(slug) {
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  let group, posts;
  try {
    [group, posts] = await Promise.all([
      api("/api/groups/" + encodeURIComponent(slug)),
      api("/api/groups/" + encodeURIComponent(slug) + "/posts", state.token ? { auth: true } : {}),
    ]);
  } catch (e) {
    viewEl.innerHTML = `<p class="form-msg error">${escapeHtml(e.message)}</p>`;
    return;
  }

  const postsHtml = posts.length
    ? posts
        .map(
          (p) => `
      <div class="group-post" data-post="${p.id}">
        <div class="group-post-votes">
          <button class="vote-btn vote-up ${p.myVote === 1 ? "active" : ""}" data-vote="${p.id}" data-value="1">&#9650;</button>
          <span class="vote-score">${p.score}</span>
          <button class="vote-btn vote-down ${p.myVote === -1 ? "active" : ""}" data-vote="${p.id}" data-value="-1">&#9660;</button>
        </div>
        <div class="group-post-body">
          <span class="group-post-type group-post-type-${p.postType}">${I18N.t("groups.postType." + p.postType)}</span>
          <p class="group-post-title">${escapeHtml(p.title)}</p>
          ${p.body ? `<p class="group-post-text">${escapeHtml(p.body)}</p>` : ""}
          <p class="group-post-meta">${escapeHtml(p.authorName)} &middot; ${fmtDate(p.createdAt)}</p>
        </div>
      </div>`
        )
        .join("")
    : `<div class="empty-state">${I18N.t("groups.noPosts")}</div>`;

  viewEl.innerHTML = `
    <a href="#/groups" class="back-link">&larr; ${I18N.t("groups.backToList")}</a>
    <h2 class="section-heading">${escapeHtml(group.name)}</h2>
    <p class="groups-subtitle">${[group.category ? categoryLabel(group.category) : "", group.city].filter(Boolean).map(escapeHtml).join(" · ")}</p>
    ${group.description ? `<p class="group-detail-desc">${escapeHtml(group.description)}</p>` : ""}
    <div id="group-post-form-wrap">${
      state.token
        ? `
      <form id="group-post-form" class="stacked-form">
        <label>${I18N.t("groups.postTitleLabel")}<input type="text" name="title" required maxlength="200" /></label>
        <label>${I18N.t("groups.postBodyLabel")}<textarea name="body" maxlength="5000"></textarea></label>
        <label>${I18N.t("groups.postTypeLabel")}
          <select name="postType">
            <option value="discussion">${I18N.t("groups.postType.discussion")}</option>
            <option value="question">${I18N.t("groups.postType.question")}</option>
            <option value="review">${I18N.t("groups.postType.review")}</option>
            <option value="warning">${I18N.t("groups.postType.warning")}</option>
          </select>
        </label>
        <button type="submit" class="btn btn-primary">${I18N.t("groups.postSubmit")}</button>
        <p class="form-msg" id="group-post-msg"></p>
      </form>`
        : `<p class="form-msg" style="text-align:center;">${I18N.t("messages.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`
    }</div>
    <div id="group-posts-list">${postsHtml}</div>
  `;

  const postForm = document.getElementById("group-post-form");
  if (postForm) {
    postForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const msgEl = document.getElementById("group-post-msg");
      try {
        await api("/api/groups/" + encodeURIComponent(slug) + "/posts", {
          method: "POST",
          auth: true,
          body: {
            title: fd.get("title"),
            body: fd.get("body"),
            postType: fd.get("postType"),
          },
        });
        renderGroupDetail(slug);
      } catch (err) {
        msgEl.textContent = err.message;
        msgEl.className = "form-msg error";
      }
    });
  }

  document.querySelectorAll("[data-vote]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      try {
        const result = await api("/api/posts/" + btn.dataset.vote + "/vote", {
          method: "POST",
          auth: true,
          body: { value: Number(btn.dataset.value) },
        });
        const postEl = btn.closest(".group-post");
        postEl.querySelector(".vote-score").textContent = result.score;
        postEl.querySelectorAll(".vote-btn").forEach((b) => b.classList.remove("active"));
        if (result.myVote !== 0) {
          postEl.querySelector('[data-value="' + result.myVote + '"]').classList.add("active");
        }
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

// ---------------- Notifications page ("#/notifications", reached from the icon nav) ----------------

async function renderNotificationsPage() {
  if (!state.token) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("messages.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
    return;
  }
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;

  const [requests, convos] = await Promise.all([
    api("/api/friends/requests", { auth: true }),
    api("/api/conversations", { auth: true }),
  ]);
  const unreadConvos = convos.filter((c) => c.unread);

  const requestsHtml = requests.length
    ? requests
        .map(
          (r) => `
      <div class="friend-request-row">
        ${r.photo ? `<img class="mini-avatar" style="width:36px;height:36px;" src="${r.photo}" />` : `<div class="seller-avatar-placeholder" style="width:36px;height:36px;">${initials(r.name)}</div>`}
        <span class="friend-request-name">${escapeHtml(r.name)}</span>
        <button class="btn btn-primary" data-accept="${r.friendshipId}">${I18N.t("friends.accept")}</button>
        <button class="btn btn-secondary" data-decline="${r.friendshipId}">${I18N.t("friends.decline")}</button>
      </div>`
        )
        .join("")
    : "";

  const convosHtml = unreadConvos.length
    ? unreadConvos
        .map(
          (c) => `
      <a class="friend-request-row" href="#/messages/${c.userId}">
        ${c.userPhoto ? `<img class="mini-avatar" style="width:36px;height:36px;" src="${c.userPhoto}" />` : `<div class="seller-avatar-placeholder" style="width:36px;height:36px;">${initials(c.userName)}</div>`}
        <span class="friend-request-name">${escapeHtml(c.userName)}</span>
        <span style="color:#888;font-size:13px;">${escapeHtml(c.lastMessage || "")}</span>
      </a>`
        )
        .join("")
    : "";

  viewEl.innerHTML = `
    <h2 class="section-heading">${I18N.t("notifPage.title")}</h2>
    ${requests.length ? `<h3 class="section-subheading">${I18N.t("notifPage.requestsHeading")}</h3><div>${requestsHtml}</div>` : ""}
    ${unreadConvos.length ? `<h3 class="section-subheading">${I18N.t("notifPage.messagesHeading")}</h3><div>${convosHtml}</div>` : ""}
    ${!requests.length && !unreadConvos.length ? `<div class="empty-state">${I18N.t("notifPage.empty")}</div>` : ""}
  `;

  document.querySelectorAll("[data-accept]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/friends/" + btn.dataset.accept + "/accept", { method: "POST", auth: true });
      renderNotificationsPage();
      pollUnread();
    });
  });
  document.querySelectorAll("[data-decline]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/friends/" + btn.dataset.decline + "/reject", { method: "POST", auth: true });
      renderNotificationsPage();
    });
  });
}

// ---------------- Photo gallery (profile Photos tab) ----------------

function renderPhotosGalleryTab(photos, isMe) {
  const el = document.getElementById("tab-photos");
  if (!el) return;
  const tiles = photos
    .map(
      (p) => `
    <div class="photo-gallery-item" data-id="${p.id}">
      <img src="${p.url}" />
      ${isMe ? `<button class="photo-remove-btn" data-id="${p.id}">&times;</button>` : ""}
    </div>`
    )
    .join("");
  const addTile = isMe
    ? `<label class="photo-gallery-add">+ ${I18N.t("profile.addPhotoBtn")}<input type="file" id="gallery-photo-input" accept="image/*" /></label>`
    : "";
  el.innerHTML = `<div class="photo-gallery-grid">${addTile}${tiles}</div>${
    !photos.length && !isMe ? `<div class="empty-state">${I18N.t("profile.noPhotos")}</div>` : ""
  }`;

  if (isMe) {
    const input = document.getElementById("gallery-photo-input");
    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await api("/api/users/me/photos", { method: "POST", auth: true, body: { photo: reader.result } });
          router();
        } catch (err) {
          alert(err.message);
        }
      };
      reader.readAsDataURL(file);
    });
    el.querySelectorAll(".photo-remove-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(I18N.t("common.delete") + "?")) return;
        try {
          await api("/api/photos/" + btn.dataset.id, { method: "DELETE", auth: true });
          router();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }
}

// ---------------- Moments (stories: photo/video, visible 24h) ----------------

function renderMomentGroupsBar(containerEl, groups, opts) {
  let html = "";
  if (opts && opts.showAddForUserId) {
    const mine = groups.find((g) => g.userId === opts.showAddForUserId);
    const hasOwn = !!(mine && mine.moments.length);
    html += `
      <div class="moment-circle-wrap" id="moment-add-circle">
        <div class="moment-circle">
          <div class="moment-circle-inner">
            ${opts.ownPhoto ? `<img src="${opts.ownPhoto}" />` : `<div class="moment-circle-placeholder">${initials(opts.ownName || "")}</div>`}
          </div>
          <span class="moment-circle-add-badge">+</span>
        </div>
        <span class="moment-circle-label">${I18N.t("moments.yourMoment")}</span>
      </div>`;
    if (!hasOwn) {
      // nothing else to add here; handled by click handler below
    }
  }
  const others = opts && opts.showAddForUserId ? groups.filter((g) => g.userId !== opts.showAddForUserId) : groups;
  others.forEach((g) => {
    html += `
      <div class="moment-circle-wrap" data-uid="${g.userId}">
        <div class="moment-circle">
          <div class="moment-circle-inner">
            ${g.userPhoto ? `<img src="${g.userPhoto}" />` : `<div class="moment-circle-placeholder">${initials(g.userName)}</div>`}
          </div>
        </div>
        <span class="moment-circle-label">${escapeHtml(g.userName)}</span>
      </div>`;
  });
  containerEl.innerHTML = html;

  if (opts && opts.showAddForUserId) {
    const addCircle = document.getElementById("moment-add-circle");
    if (addCircle) {
      addCircle.addEventListener("click", () => {
        const mine = groups.find((g) => g.userId === opts.showAddForUserId);
        if (mine && mine.moments.length) {
          openMomentsViewer(mine.moments, 0, mine);
        } else {
          openMomentUploadModal();
        }
      });
    }
  }
  containerEl.querySelectorAll(".moment-circle-wrap[data-uid]").forEach((wrap) => {
    wrap.addEventListener("click", () => {
      const g = groups.find((x) => x.userId === wrap.dataset.uid);
      if (g) openMomentsViewer(g.moments, 0, g);
    });
  });
}


function renderProfileMomentsBar(userId, userName, userPhoto, moments, isMe) {
  const el = document.getElementById("profile-moments-bar");
  if (!el) return;
  if (!moments.length && !isMe) {
    el.innerHTML = `<p style="color:#888;font-size:13px;">${I18N.t("moments.noMoments")}</p>`;
    return;
  }
  const group = { userId, userName, userPhoto, moments };
  const groups = moments.length ? [group] : [];
  renderMomentGroupsBar(el, groups, isMe ? { showAddForUserId: userId, ownPhoto: userPhoto, ownName: userName } : undefined);
}

let momentViewerState = null;
let momentViewerTimer = null;

function openMomentsViewer(moments, startIndex, group) {
  if (!moments || !moments.length) return;
  momentViewerState = { moments: moments.slice(), index: startIndex || 0, group, following: null };
  const overlay = document.createElement("div");
  overlay.className = "moment-viewer-overlay";
  overlay.id = "moment-viewer-overlay";
  document.body.appendChild(overlay);
  drawMomentViewer();

  const canFollow = group && group.isPage && state.token && !(state.user && group.userId === state.user.id);
  if (canFollow) {
    api("/api/follow/status/" + group.userId, { auth: true })
      .then((st) => {
        if (momentViewerState) {
          momentViewerState.following = !!st.following;
          drawMomentViewer();
        }
      })
      .catch(() => {});
  }
}

function closeMomentsViewer() {
  if (momentViewerTimer) {
    clearTimeout(momentViewerTimer);
    momentViewerTimer = null;
  }
  const overlay = document.getElementById("moment-viewer-overlay");
  if (overlay) overlay.remove();
  momentViewerState = null;
}

function drawMomentViewer() {
  const overlay = document.getElementById("moment-viewer-overlay");
  if (!overlay || !momentViewerState) return;
  if (momentViewerTimer) {
    clearTimeout(momentViewerTimer);
    momentViewerTimer = null;
  }
  const { moments, index, group } = momentViewerState;
  const m = moments[index];
  const isOwn = state.user && m.userId === state.user.id;
  const canFollow = group && group.isPage && state.token && !isOwn;

  const bars = moments
    .map((_, i) => `<div class="moment-viewer-progress-bar ${i < index ? "done" : ""}"><div class="moment-viewer-progress-fill" id="progress-fill-${i}"></div></div>`)
    .join("");

  overlay.innerHTML = `
    <div class="moment-viewer-media-wrap">
      <div class="moment-viewer-progress">${bars}</div>
      <div class="moment-viewer-head">
        ${group && group.userPhoto ? `<img src="${group.userPhoto}" />` : ""}
        <span class="moment-viewer-head-name">${escapeHtml((group && group.userName) || "")}${group && group.isPage ? ` <span class="page-badge-inline">${I18N.t("pages.badge")}</span>` : ""}</span>
        ${
          canFollow && momentViewerState.following !== null
            ? `<button class="btn-follow-inline" id="moment-viewer-follow">${momentViewerState.following ? I18N.t("pages.following") : I18N.t("pages.follow")}</button>`
            : ""
        }
        <button class="moment-viewer-close" id="moment-viewer-close">&times;</button>
      </div>
      ${
        m.mediaType === "video"
          ? `<video class="moment-viewer-media" id="moment-viewer-media" src="${m.mediaUrl}" autoplay playsinline></video>`
          : `<img class="moment-viewer-media" id="moment-viewer-media" src="${m.mediaUrl}" />`
      }
      ${m.caption ? `<div class="moment-viewer-caption">${escapeHtml(m.caption)}</div>` : ""}
      ${isOwn ? `<button class="moment-viewer-delete" id="moment-viewer-delete">${I18N.t("moments.delete")}</button>` : ""}
      <button class="moment-viewer-nav prev" id="moment-viewer-prev"></button>
      <button class="moment-viewer-nav next" id="moment-viewer-next"></button>
    </div>
  `;

  document.getElementById("moment-viewer-close").addEventListener("click", closeMomentsViewer);
  document.getElementById("moment-viewer-prev").addEventListener("click", () => stepMomentViewer(-1));
  document.getElementById("moment-viewer-next").addEventListener("click", () => stepMomentViewer(1));
  const delBtn = document.getElementById("moment-viewer-delete");
  if (delBtn) {
    delBtn.addEventListener("click", async () => {
      if (!confirm(I18N.t("moments.confirmDelete"))) return;
      try {
        await api("/api/moments/" + m.id, { method: "DELETE", auth: true });
        momentViewerState.moments.splice(index, 1);
        if (!momentViewerState.moments.length) {
          closeMomentsViewer();
          router();
          return;
        }
        momentViewerState.index = Math.min(index, momentViewerState.moments.length - 1);
        drawMomentViewer();
      } catch (e) {
        alert(e.message);
      }
    });
  }
  const followBtn = document.getElementById("moment-viewer-follow");
  if (followBtn) {
    followBtn.addEventListener("click", async () => {
      followBtn.disabled = true;
      try {
        if (momentViewerState.following) {
          await api("/api/follow/" + group.userId, { method: "DELETE", auth: true });
          momentViewerState.following = false;
        } else {
          await api("/api/follow/" + group.userId, { method: "POST", auth: true });
          momentViewerState.following = true;
        }
        drawMomentViewer();
      } catch (e) {
        followBtn.disabled = false;
        alert(e.message);
      }
    });
  }

  const fill = document.getElementById("progress-fill-" + index);
  if (m.mediaType === "video") {
    const videoEl = document.getElementById("moment-viewer-media");
    if (videoEl) {
      videoEl.muted = false;
      videoEl.volume = 1;
      videoEl.addEventListener("loadedmetadata", () => {
        if (fill && videoEl.duration && isFinite(videoEl.duration)) {
          requestAnimationFrame(() => {
            fill.style.transition = "width " + videoEl.duration * 1000 + "ms linear";
            fill.style.width = "100%";
          });
        }
      });
      videoEl.addEventListener("ended", () => stepMomentViewer(1));
    }
  } else {
    const duration = 5000;
    if (fill) {
      requestAnimationFrame(() => {
        fill.style.transition = "width " + duration + "ms linear";
        fill.style.width = "100%";
      });
    }
    momentViewerTimer = setTimeout(() => stepMomentViewer(1), duration);
  }
}

function stepMomentViewer(dir) {
  if (!momentViewerState) return;
  const next = momentViewerState.index + dir;
  if (next < 0) return;
  if (next >= momentViewerState.moments.length) {
    closeMomentsViewer();
    return;
  }
  momentViewerState.index = next;
  drawMomentViewer();
}

// ---------------- "Moments" full-screen video feed ("#/shorts") ----------------
// A single vertical stream of every active video Moment on the platform,
// ranked by /api/moments/videos/feed (friends > followed Pages > Pages >
// recency). Distinct from the story-style moments-bar above: this is a
// continuous scroll/swipe feed like Reels/Shorts, browsing all video content.

let shortsState = null;

async function renderShorts() {
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  let videos = [];
  try {
    videos = await api("/api/moments/videos/feed", { auth: true });
  } catch (e) {}
  if (!videos.length) {
    viewEl.innerHTML = `<div class="empty-state">${I18N.t("shorts.empty")}</div>`;
    return;
  }
  viewEl.innerHTML = "";
  openShortsPlayer(videos, 0);
}

function openShortsPlayer(videos, startIndex) {
  shortsState = { videos, index: startIndex || 0 };
  const overlay = document.createElement("div");
  overlay.className = "shorts-overlay";
  overlay.id = "shorts-overlay";
  document.body.appendChild(overlay);
  drawShorts();

  let touchStartY = null;
  overlay.addEventListener(
    "wheel",
    (e) => {
      if (overlay.dataset.wheelLock === "1") return;
      overlay.dataset.wheelLock = "1";
      setTimeout(() => (overlay.dataset.wheelLock = "0"), 500);
      if (e.deltaY > 30) stepShorts(1);
      else if (e.deltaY < -30) stepShorts(-1);
    },
    { passive: true }
  );
  overlay.addEventListener(
    "touchstart",
    (e) => {
      touchStartY = e.touches[0].clientY;
    },
    { passive: true }
  );
  overlay.addEventListener(
    "touchend",
    (e) => {
      if (touchStartY === null) return;
      const diff = touchStartY - e.changedTouches[0].clientY;
      if (diff > 50) stepShorts(1);
      else if (diff < -50) stepShorts(-1);
      touchStartY = null;
    },
    { passive: true }
  );
}

function closeShortsPlayer() {
  reportShortsWatch();
  const overlay = document.getElementById("shorts-overlay");
  if (overlay) overlay.remove();
  shortsState = null;
  if (location.hash.startsWith("#/shorts")) location.hash = "#/";
}

// Reports how the viewer engaged with the video currently on screen -
// "complete" if they stuck around for most of it (it loops, so a near-full
// watch counts even without a real "ended" event), "skip" otherwise. Called
// right before we move away from a video, feeding the affinity/popularity
// signals the v2 ranking in /api/moments/videos/feed uses.
function reportShortsWatch() {
  if (!shortsState) return;
  const v = shortsState.videos[shortsState.index];
  if (!v || !shortsState.watchStart) return;
  const watchMs = Date.now() - shortsState.watchStart;
  const durationMs = shortsState.currentDurationMs || 0;
  const type = durationMs && watchMs >= durationMs * 0.85 ? "complete" : "skip";
  api("/api/moments/" + v.id + "/event", { method: "POST", auth: true, body: { type, watchMs, durationMs } }).catch(() => {});
  shortsState.watchStart = null;
}

function toggleShortsLike() {
  if (!shortsState) return;
  if (!state.token) {
    location.hash = "#/login";
    return;
  }
  const v = shortsState.videos[shortsState.index];
  const wasLiked = v.liked;
  v.liked = !wasLiked;
  v.likeCount = Math.max(0, (v.likeCount || 0) + (v.liked ? 1 : -1));
  updateShortsLikeUI();
  api("/api/moments/" + v.id + "/like", { method: v.liked ? "POST" : "DELETE", auth: true, body: {} }).catch(() => {
    v.liked = wasLiked;
    v.likeCount = Math.max(0, (v.likeCount || 0) + (wasLiked ? 1 : -1));
    updateShortsLikeUI();
  });
  if (v.liked) {
    api("/api/moments/" + v.id + "/event", { method: "POST", auth: true, body: { type: "like" } }).catch(() => {});
  }
}

function updateShortsLikeUI() {
  if (!shortsState) return;
  const v = shortsState.videos[shortsState.index];
  const btn = document.getElementById("shorts-like");
  const countEl = document.getElementById("shorts-like-count");
  if (btn) {
    btn.classList.toggle("active", !!v.liked);
    btn.textContent = v.liked ? "❤️" : "\u{1F90D}";
  }
  if (countEl) countEl.textContent = v.likeCount || 0;
}

function burstShortsHeart() {
  const item = document.querySelector(".shorts-item");
  if (!item) return;
  const heart = document.createElement("div");
  heart.className = "shorts-heart-burst";
  heart.textContent = "❤️";
  item.appendChild(heart);
  setTimeout(() => heart.remove(), 900);
}

function drawShorts() {
  const overlay = document.getElementById("shorts-overlay");
  if (!overlay || !shortsState) return;
  const { videos, index } = shortsState;
  const v = videos[index];
  const isOwn = state.user && v.userId === state.user.id;
  const showFollow = v.isPage && state.token && !isOwn;

  overlay.innerHTML = `
    <div class="shorts-item">
      <video class="shorts-video" id="shorts-video" src="${v.mediaUrl}" autoplay loop playsinline></video>
      <button class="shorts-close" id="shorts-close">&times;</button>
      <div class="shorts-info">
        <a class="shorts-author-link" href="#/profile/${v.userId}">
          ${v.userPhoto ? `<img class="shorts-avatar" src="${v.userPhoto}" />` : `<div class="shorts-avatar-placeholder">${initials(v.userName)}</div>`}
          <span class="shorts-author">${escapeHtml(v.userName)}${v.isPage ? ` <span class="page-badge-inline">${I18N.t("pages.badge")}</span>` : ""}</span>
        </a>
        ${v.caption ? `<p class="shorts-caption">${escapeHtml(v.caption)}</p>` : ""}
        ${showFollow ? `<button class="btn-follow-inline shorts-follow" id="shorts-follow">${I18N.t("pages.follow")}</button>` : ""}
      </div>
      <div class="shorts-actions-col">
        <div class="shorts-action">
          <button class="shorts-action-btn ${v.liked ? "active" : ""}" id="shorts-like">${v.liked ? "❤️" : "\u{1F90D}"}</button>
          <span class="shorts-action-count" id="shorts-like-count">${v.likeCount || 0}</span>
        </div>
      </div>
      <div class="shorts-nav-col">
        <button class="shorts-nav" id="shorts-prev" ${index === 0 ? "disabled" : ""}>▲</button>
        <button class="shorts-nav" id="shorts-next" ${index === videos.length - 1 ? "disabled" : ""}>▼</button>
      </div>
    </div>
  `;

  document.getElementById("shorts-close").addEventListener("click", closeShortsPlayer);
  document.getElementById("shorts-prev").addEventListener("click", () => stepShorts(-1));
  document.getElementById("shorts-next").addEventListener("click", () => stepShorts(1));
  document.getElementById("shorts-like").addEventListener("click", toggleShortsLike);

  shortsState.watchStart = Date.now();
  shortsState.currentDurationMs = 0;

  const videoEl = document.getElementById("shorts-video");
  if (videoEl) {
    videoEl.muted = false;
    videoEl.volume = 1;
    videoEl.addEventListener("loadedmetadata", () => {
      if (shortsState) shortsState.currentDurationMs = (videoEl.duration || 0) * 1000;
    });
    let lastTap = 0;
    videoEl.addEventListener("click", () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        const cur = shortsState.videos[shortsState.index];
        if (!cur.liked) toggleShortsLike();
        burstShortsHeart();
      }
      lastTap = now;
    });
  }

  const followBtn = document.getElementById("shorts-follow");
  if (followBtn) {
    api("/api/follow/status/" + v.userId, { auth: true })
      .then((st) => {
        followBtn.dataset.following = st.following ? "1" : "0";
        followBtn.textContent = st.following ? I18N.t("pages.following") : I18N.t("pages.follow");
      })
      .catch(() => {});
    followBtn.addEventListener("click", async () => {
      const following = followBtn.dataset.following === "1";
      followBtn.disabled = true;
      try {
        if (following) {
          await api("/api/follow/" + v.userId, { method: "DELETE", auth: true });
          followBtn.dataset.following = "0";
          followBtn.textContent = I18N.t("pages.follow");
        } else {
          await api("/api/follow/" + v.userId, { method: "POST", auth: true });
          followBtn.dataset.following = "1";
          followBtn.textContent = I18N.t("pages.following");
        }
      } catch (e) {
        alert(e.message);
      } finally {
        followBtn.disabled = false;
      }
    });
  }
}

function stepShorts(dir) {
  if (!shortsState) return;
  const next = shortsState.index + dir;
  if (next < 0 || next >= shortsState.videos.length) return;
  reportShortsWatch();
  shortsState.index = next;
  drawShorts();
}

const MAX_ACTIVE_MOMENTS = 3;
const MAX_MOMENT_VIDEO_SECONDS = 180;

function openMomentUploadModal() {
  if (!state.token) {
    location.hash = "#/login";
    return;
  }
  let mediaDataUrl = null;
  let mediaType = null;
  let durationSeconds = null;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <h2 class="section-heading">${I18N.t("moments.add")}</h2>
      <p class="moment-upload-hint">${I18N.t("moments.uploadHint")}</p>
      <div id="moment-upload-preview-wrap"></div>
      <div class="moment-upload-choices" id="moment-upload-choices">
        <label>${I18N.t("moments.uploadPhoto")}<input type="file" id="moment-photo-input" accept="image/*" /></label>
        <label>${I18N.t("moments.uploadVideo")}<input type="file" id="moment-video-input" accept="video/*" /></label>
      </div>
      <div class="form-group" style="margin-top:10px;">
        <textarea id="moment-caption" rows="2" placeholder="${I18N.t("moments.captionPlaceholder")}"></textarea>
      </div>
      <div class="action-row">
        <button class="btn btn-primary" id="moment-submit" disabled>${I18N.t("moments.post")}</button>
        <button class="btn btn-secondary" id="moment-cancel">${I18N.t("common.cancel")}</button>
      </div>
      <p class="form-msg" id="moment-upload-msg"></p>
    </div>
  `;
  document.body.appendChild(overlay);

  const previewWrap = document.getElementById("moment-upload-preview-wrap");
  const submitBtn = document.getElementById("moment-submit");
  const photoInput = document.getElementById("moment-photo-input");
  const videoInput = document.getElementById("moment-video-input");
  const msgEl = document.getElementById("moment-upload-msg");

  // Block uploads up front if the user already has 3 active moments.
  api("/api/moments/user/" + state.user.id)
    .then((moments) => {
      if (moments.length >= MAX_ACTIVE_MOMENTS) {
        msgEl.textContent = I18N.t("moments.limitReached");
        msgEl.className = "form-msg error";
        photoInput.disabled = true;
        videoInput.disabled = true;
      }
    })
    .catch(() => {});

  function readAsDataUrl(file, type) {
    const reader = new FileReader();
    reader.onload = () => {
      mediaDataUrl = reader.result;
      mediaType = type;
      previewWrap.innerHTML =
        type === "video"
          ? `<video class="moment-upload-preview" src="${mediaDataUrl}" controls></video>`
          : `<img class="moment-upload-preview" src="${mediaDataUrl}" />`;
      submitBtn.disabled = false;
      msgEl.textContent = "";
      msgEl.className = "form-msg";
    };
    reader.readAsDataURL(file);
  }

  function handleFile(file, type) {
    if (type !== "video") {
      readAsDataUrl(file, type);
      return;
    }
    // Check the video's real duration client-side before reading it into memory.
    const probe = document.createElement("video");
    probe.preload = "metadata";
    const objectUrl = URL.createObjectURL(file);
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      if (probe.duration && probe.duration > MAX_MOMENT_VIDEO_SECONDS) {
        msgEl.textContent = I18N.t("moments.videoTooLong");
        msgEl.className = "form-msg error";
        videoInput.value = "";
        return;
      }
      durationSeconds = probe.duration || null;
      readAsDataUrl(file, type);
    };
    probe.src = objectUrl;
  }

  photoInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0], "image");
  });
  videoInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0], "video");
  });
  document.getElementById("moment-cancel").addEventListener("click", () => overlay.remove());
  submitBtn.addEventListener("click", async () => {
    if (!mediaDataUrl) return;
    submitBtn.disabled = true;
    msgEl.textContent = I18N.t("moments.uploading");
    msgEl.className = "form-msg";
    try {
      await api("/api/moments", {
        method: "POST",
        auth: true,
        body: {
          mediaType,
          media: mediaDataUrl,
          caption: document.getElementById("moment-caption").value,
          durationSeconds,
        },
      });
      msgEl.textContent = I18N.t("moments.posted");
      msgEl.className = "form-msg ok";
      setTimeout(() => {
        overlay.remove();
        router();
      }, 700);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
      submitBtn.disabled = false;
    }
  });
}

// ---------------- Profile ----------------

async function renderProfile(userId) {
  if (!userId) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("messages.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
    return;
  }
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;

  const isMe = state.user && state.user.id === userId;

  const [profile, reviews, products, photos, moments] = await Promise.all([
    api("/api/users/" + userId),
    api("/api/users/" + userId + "/reviews"),
    api("/api/products?category=all").then((list) => list.filter((p) => p.sellerId === userId)),
    api("/api/users/" + userId + "/photos"),
    api("/api/moments/user/" + userId),
  ]);

  let friendStatus = null;
  let followStatus = null;
  if (state.token && !isMe) {
    try {
      friendStatus = await api("/api/friends/status/" + userId, { auth: true });
    } catch (e) {}
    if (profile.isPage) {
      try {
        followStatus = await api("/api/follow/status/" + userId, { auth: true });
      } catch (e) {}
    }
  }

  const aboutRows = [
    profile.hometown ? `<div class="profile-about-row"><span class="profile-about-icon">\u{1F30D}</span>${I18N.t("profile.hometown")}: ${escapeHtml(profile.hometown)}</div>` : "",
    profile.work ? `<div class="profile-about-row"><span class="profile-about-icon">\u{1F4BC}</span>${I18N.t("profile.work")}: ${escapeHtml(profile.work)}</div>` : "",
    profile.education ? `<div class="profile-about-row"><span class="profile-about-icon">\u{1F393}</span>${I18N.t("profile.education")}: ${escapeHtml(profile.education)}</div>` : "",
    profile.interests ? `<div class="profile-about-row"><span class="profile-about-icon">\u{2764}\u{FE0F}</span>${I18N.t("profile.interests")}: ${escapeHtml(profile.interests)}</div>` : "",
  ]
    .filter(Boolean)
    .join("");

  viewEl.innerHTML = `
    <div class="profile-cover-wrap">
      <div class="profile-cover" id="profile-cover" style="${profile.coverPhoto ? `background-image:url('${profile.coverPhoto}')` : ""}">
        ${isMe ? `<button class="profile-cover-edit-btn" id="btn-edit-cover">${I18N.t("profile.changeCover")}</button><input type="file" id="cover-input" class="profile-cover-input" accept="image/*" />` : ""}
      </div>
      <div class="profile-header">
        <div class="profile-avatar-wrap">
          ${
            profile.photo
              ? `<img class="profile-avatar" src="${profile.photo}" />`
              : `<div class="profile-avatar-placeholder">${initials(profile.name)}</div>`
          }
        </div>
        <div>
          <p class="profile-name">${escapeHtml(profile.name)}${profile.isPage ? ` <span class="page-badge-inline">${I18N.t("pages.badge")}</span>` : ""}${profile.verified ? ` <span class="verified-badge-inline" title="${I18N.t("profile.verifiedBadge")}">\u{2713} ${I18N.t("profile.verifiedBadge")}</span>` : ""}</p>
          ${profile.isPage && profile.pageCategory ? `<p class="profile-sub">${escapeHtml(profile.pageCategory)}</p>` : ""}
          <div class="stars">${starsMarkup(profile.ratingAvg)} <span style="color:#888;font-size:12px;">(${profile.ratingCount})</span></div>
          <p class="profile-sub">${I18N.t("profile.memberSince")} ${fmtDate(profile.createdAt)}</p>
          <p class="profile-sub">\u{1F91D} ${I18N.t("profile.salesCountLabel").replace("{n}", profile.salesCount || 0)}</p>
          ${profile.location ? `<p class="profile-sub">\u{1F4CD} ${escapeHtml(profile.location)}</p>` : ""}
          ${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
        </div>
        <div class="profile-actions" id="profile-actions">
          ${isMe ? `<button class="btn btn-outline" id="btn-edit-profile">${I18N.t("profile.editProfile")}</button>` : ""}
          ${isMe ? `<a class="btn btn-gold" href="#/post">${I18N.t("profile.postNewListing")}</a>` : ""}
          ${!isMe && profile.isPage ? pageFollowMarkup(followStatus) : ""}
          ${!isMe ? friendActionMarkup(friendStatus) : ""}
          ${!isMe && state.token ? `<a class="btn btn-primary" href="#/messages/${profile.id}">${I18N.t("profile.messageButton")}</a>` : ""}
        </div>
      </div>
    </div>

    ${aboutRows ? `<div class="profile-about-card"><h2 class="section-heading" style="margin-bottom:10px;">${I18N.t("profile.about")}</h2>${aboutRows}</div>` : ""}

    ${
      profile.recentSales && profile.recentSales.length
        ? `<div class="profile-about-card">
            <h2 class="section-heading" style="margin-bottom:10px;">${I18N.t("profile.salesHistory")}</h2>
            <div class="sales-history-list">
              ${profile.recentSales
                .map(
                  (s) => `
                <div class="sales-history-row">
                  <span class="sales-history-title">${escapeHtml(s.title)}</span>
                  <span class="sales-history-price">${fmtPrice(s.price)}</span>
                </div>`
                )
                .join("")}
            </div>
          </div>`
        : ""
    }

    <div style="margin:0 16px 20px;">
      <h2 class="section-heading" style="margin-bottom:10px;">${I18N.t("moments.title")}</h2>
      <div class="moments-bar" id="profile-moments-bar"></div>
    </div>

    <div style="margin:0 16px;">
      <div class="tabs">
        <button class="tab-btn active" data-tab="listings">${I18N.t("profile.myListings")}</button>
        <button class="tab-btn" data-tab="photos">${I18N.t("profile.photosTab")}</button>
        <button class="tab-btn" data-tab="reviews">${I18N.t("profile.reviews")}</button>
        ${isMe ? `<button class="tab-btn" data-tab="friends">${I18N.t("profile.friendsTab")}</button>` : ""}
        ${isMe ? `<button class="tab-btn" data-tab="requests">${I18N.t("profile.requestsTab")}</button>` : ""}
        ${isMe ? `<button class="tab-btn" data-tab="saved">${I18N.t("profile.savedTab")}</button>` : ""}
        ${isMe ? `<button class="tab-btn" data-tab="offers">${I18N.t("profile.myOffers")}</button>` : ""}
        ${isMe && state.token ? `<button class="tab-btn" data-tab="notifications">${I18N.t("notif.tabTitle")}</button>` : ""}
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
              <div class="product-thumb-wrap">
                ${p.photos && p.photos[0] ? `<img class="product-thumb" src="${p.photos[0]}" />` : `<div class="product-thumb-empty">\u{1F4E6}</div>`}
                ${statusBadgeMarkup(p.status)}
              </div>
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

      <div id="tab-photos" style="display:none;"></div>

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

      ${isMe ? `<div id="tab-friends" style="display:none;"></div>` : ""}
      ${isMe ? `<div id="tab-requests" style="display:none;"></div>` : ""}
      ${isMe ? `<div id="tab-saved" style="display:none;"></div>` : ""}
      ${isMe ? `<div id="tab-offers" style="display:none;"></div>` : ""}
      ${isMe && state.token ? `<div id="tab-notifications" style="display:none;"></div>` : ""}
      ${isMe && state.user && state.user.isOwner ? `<div id="tab-ads" style="display:none;"></div>` : ""}
    </div>
  `;

  renderPhotosGalleryTab(photos, isMe);
  renderProfileMomentsBar(userId, profile.name, profile.photo, moments, isMe);

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ["listings", "photos", "reviews", "friends", "requests", "saved", "offers", "notifications", "ads"].forEach((t) => {
        const el = document.getElementById("tab-" + t);
        if (el) el.style.display = t === btn.dataset.tab ? "block" : "none";
      });
      if (btn.dataset.tab === "friends" && isMe) await renderFriendsTab();
      if (btn.dataset.tab === "requests" && isMe) await renderRequestsTab();
      if (btn.dataset.tab === "saved" && isMe) await renderSavedTab();
      if (btn.dataset.tab === "offers" && isMe) await renderMyOffers();
      if (btn.dataset.tab === "notifications" && isMe && state.token) await renderNotificationSettings();
      if (btn.dataset.tab === "ads" && isMe && state.user && state.user.isOwner) await renderAdsManager();
    });
  });

  if (isMe) {
    document.getElementById("btn-edit-profile").addEventListener("click", () =>
      openEditProfileModal({ ...profile, phone: state.user ? state.user.phone : "" })
    );
    const coverBtn = document.getElementById("btn-edit-cover");
    const coverInput = document.getElementById("cover-input");
    if (coverBtn && coverInput) {
      coverBtn.addEventListener("click", () => coverInput.click());
      coverInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            await api("/api/users/me", { method: "PUT", auth: true, body: { coverPhoto: reader.result } });
            document.getElementById("profile-cover").style.backgroundImage = `url('${reader.result}')`;
          } catch (err) {
            alert(err.message);
          }
        };
        reader.readAsDataURL(file);
      });
    }
  }

  if (!isMe) {
    wireFriendActionButtons(userId);
    if (profile.isPage) wirePageFollowButton(userId);

    const reportUserLink = document.getElementById("report-user-link");
    if (reportUserLink) {
      reportUserLink.addEventListener("click", (e) => {
        e.preventDefault();
        openReportModal("user", profile.id);
      });
    }

    if (state.token) {
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
}

// ---------------- Push notifications ----------------

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (e) {
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function enablePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error(I18N.t("notif.unsupported"));
  }
  const reg = await registerServiceWorker();
  if (!reg) throw new Error(I18N.t("notif.unsupported"));
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(I18N.t("notif.denied"));
  const { publicKey } = await api("/api/push/vapid-public-key");
  if (!publicKey) throw new Error(I18N.t("notif.unavailable"));
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await api("/api/push/subscribe", { method: "POST", auth: true, body: { subscription: sub.toJSON() } });
}

async function disablePushNotifications() {
  let endpoint = null;
  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        endpoint = sub.endpoint;
        await sub.unsubscribe();
      }
    }
  }
  await api("/api/push/unsubscribe", { method: "POST", auth: true, body: endpoint ? { endpoint } : {} });
}

async function renderNotificationSettings() {
  const el = document.getElementById("tab-notifications");
  if (!el) return;
  el.innerHTML = `<p>${I18N.t("common.loading")}</p>`;

  let data;
  try {
    data = await api("/api/notifications/preferences", { auth: true });
  } catch (e) {
    el.innerHTML = `<p class="form-msg error">${escapeHtml(e.message)}</p>`;
    return;
  }

  const prefs = Object.assign({ offers: true, flashSales: true, newProducts: true, reminders: true }, data.prefs || {});
  const followed = data.followedCategories || [];
  const supported = "serviceWorker" in navigator && "PushManager" in window;

  el.innerHTML = `
    <div class="form-panel" style="max-width:none;">
      <p style="margin:0 0 12px;color:#666;font-size:13px;">${I18N.t("notif.explain")}</p>
      ${
        !supported
          ? `<p class="form-msg error">${I18N.t("notif.unsupported")}</p>`
          : `
        <label class="notif-master-row">
          <input type="checkbox" id="notif-master" ${data.pushEnabled ? "checked" : ""} />
          <span>${I18N.t("notif.enableOnDevice")}</span>
        </label>
        <div id="notif-cats" style="${data.pushEnabled ? "" : "display:none;"}margin-top:14px;">
          <label class="notif-cat-row"><input type="checkbox" id="notif-offers" ${prefs.offers ? "checked" : ""} /> ${I18N.t("notif.catOffers")}</label>
          <label class="notif-cat-row"><input type="checkbox" id="notif-flashSales" ${prefs.flashSales ? "checked" : ""} /> ${I18N.t("notif.catFlashSales")}</label>
          <label class="notif-cat-row"><input type="checkbox" id="notif-newProducts" ${prefs.newProducts ? "checked" : ""} /> ${I18N.t("notif.catNewProducts")}</label>
          <label class="notif-cat-row"><input type="checkbox" id="notif-reminders" ${prefs.reminders ? "checked" : ""} /> ${I18N.t("notif.catReminders")}</label>
          <div id="notif-categories-picker" style="${prefs.newProducts ? "" : "display:none;"}margin:10px 0 0 24px;">
            <p style="font-size:12px;color:#888;margin:0 0 6px;">${I18N.t("notif.pickCategories")}</p>
            <div class="notif-category-grid">
              ${CATEGORY_LIST.map(
                (c) => `<label class="notif-category-chip"><input type="checkbox" class="notif-followed-cat" value="${c.slug}" ${followed.includes(c.slug) ? "checked" : ""} /> ${I18N.categoryName(c.slug)}</label>`
              ).join("")}
            </div>
          </div>
        </div>
        <button class="btn btn-primary" id="notif-save" style="margin-top:16px;">${I18N.t("common.save")}</button>
        <p class="form-msg" id="notif-msg"></p>
      `
      }
    </div>
  `;

  if (!supported) return;

  const masterCb = document.getElementById("notif-master");
  const catsBox = document.getElementById("notif-cats");
  const newProductsCb = document.getElementById("notif-newProducts");
  const catPicker = document.getElementById("notif-categories-picker");

  masterCb.addEventListener("change", () => {
    catsBox.style.display = masterCb.checked ? "" : "none";
  });
  newProductsCb.addEventListener("change", () => {
    catPicker.style.display = newProductsCb.checked ? "" : "none";
  });

  document.getElementById("notif-save").addEventListener("click", async () => {
    const msgEl = document.getElementById("notif-msg");
    msgEl.textContent = "";
    msgEl.className = "form-msg";
    try {
      if (masterCb.checked) {
        await enablePushNotifications();
      } else {
        await disablePushNotifications();
      }
      const newPrefs = {
        offers: document.getElementById("notif-offers").checked,
        flashSales: document.getElementById("notif-flashSales").checked,
        newProducts: document.getElementById("notif-newProducts").checked,
        reminders: document.getElementById("notif-reminders").checked,
      };
      const followedCategories = [...document.querySelectorAll(".notif-followed-cat:checked")].map((c) => c.value);
      await api("/api/notifications/preferences", {
        method: "PUT",
        auth: true,
        body: { prefs: newPrefs, followedCategories },
      });
      msgEl.textContent = I18N.t("notif.saved");
      msgEl.className = "form-msg success";
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
    }
  });
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

// Pinterest-style "Guardado" tab: the user's saved products, grouped into
// the collections they chose (default "Favoritos") when saving each item.
async function renderSavedTab() {
  const el = document.getElementById("tab-saved");
  el.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  const items = await api("/api/saved", { auth: true });
  if (!items.length) {
    el.innerHTML = `<div class="empty-state">${I18N.t("saved.empty")}</div>`;
    return;
  }
  const groups = {};
  for (const it of items) {
    const key = it.collection || "Favoritos";
    if (!groups[key]) groups[key] = [];
    groups[key].push(it);
  }
  el.innerHTML = Object.keys(groups)
    .map(
      (collection) => `
    <h3 class="section-subheading">${escapeHtml(collection)}</h3>
    <div class="product-grid">
      ${groups[collection]
        .map(
          (it) => `
        <a class="product-card" href="#/product/${it.productId}">
          <div class="product-thumb-wrap">
            ${it.productPhoto ? `<img class="product-thumb" src="${it.productPhoto}" />` : `<div class="product-thumb-empty">\u{1F4E6}</div>`}
            ${statusBadgeMarkup(it.productStatus)}
          </div>
          <div class="product-card-body">
            <p class="product-title">${escapeHtml(it.productTitle)}</p>
            ${it.productPrice !== null ? `<p class="product-price">${fmtPrice(it.productPrice)}</p>` : ""}
          </div>
        </a>`
        )
        .join("")}
    </div>`
    )
    .join("");
}

async function renderAdsManager() {
  const el = document.getElementById("tab-ads");
  if (!el) return;
  el.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  let ads = [];
  try {
    ads = await api("/api/ads?all=1", { auth: true });
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
      await api("/api/ads", {
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
      await api("/api/ads/" + btn.dataset.remove, { method: "DELETE", auth: true });
      await renderAdsManager();
    });
  });
  el.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const active = btn.dataset.active === "true";
      await api("/api/ads/" + btn.dataset.toggle, { method: "PUT", auth: true, body: { active: !active } });
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
      <div class="form-group">
        <label>${I18N.t("profile.hometown")}</label>
        <input type="text" id="edit-hometown" placeholder="${I18N.t("profile.hometownPlaceholder")}" value="${escapeHtml(profile.hometown || "")}" />
      </div>
      <div class="form-group">
        <label>${I18N.t("profile.work")}</label>
        <input type="text" id="edit-work" placeholder="${I18N.t("profile.workPlaceholder")}" value="${escapeHtml(profile.work || "")}" />
      </div>
      <div class="form-group">
        <label>${I18N.t("profile.education")}</label>
        <input type="text" id="edit-education" placeholder="${I18N.t("profile.educationPlaceholder")}" value="${escapeHtml(profile.education || "")}" />
      </div>
      <div class="form-group">
        <label>${I18N.t("profile.interests")}</label>
        <input type="text" id="edit-interests" placeholder="${I18N.t("profile.interestsPlaceholder")}" value="${escapeHtml(profile.interests || "")}" />
      </div>
      <div class="form-group">
        <label>${I18N.t("settings.chatPrivacyLabel")}</label>
        <select id="edit-chat-privacy">
          <option value="everyone" ${!profile.chatPrivacy || profile.chatPrivacy === "everyone" ? "selected" : ""}>${I18N.t("settings.chatPrivacyEveryone")}</option>
          <option value="friends" ${profile.chatPrivacy === "friends" ? "selected" : ""}>${I18N.t("settings.chatPrivacyFriends")}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="edit-is-page" ${profile.isPage ? "checked" : ""} /> ${I18N.t("pages.isPageLabel")}</label>
        <p class="field-hint">${I18N.t("pages.isPageHint")}</p>
      </div>
      <div class="form-group" id="edit-page-category-wrap" style="display:${profile.isPage ? "block" : "none"};">
        <label>${I18N.t("pages.categoryLabel")}</label>
        <input type="text" id="edit-page-category" placeholder="${I18N.t("pages.categoryPlaceholder")}" value="${escapeHtml(profile.pageCategory || "")}" />
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

  document.getElementById("edit-is-page").addEventListener("change", (e) => {
    document.getElementById("edit-page-category-wrap").style.display = e.target.checked ? "block" : "none";
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
          hometown: document.getElementById("edit-hometown").value,
          work: document.getElementById("edit-work").value,
          education: document.getElementById("edit-education").value,
          interests: document.getElementById("edit-interests").value,
          chatPrivacy: document.getElementById("edit-chat-privacy").value,
          isPage: document.getElementById("edit-is-page").checked,
          pageCategory: document.getElementById("edit-page-category").value,
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
  setUnreadBadge(convos.filter((c) => c.unread).length);
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
      try {
        await api("/api/conversations/" + otherUserId, { method: "POST", auth: true, body: { text } });
        await loadChat(otherUserId, true);
        await loadConvoList(otherUserId);
      } catch (e) {
        alert(e.message);
      }
    };
    sendBtn.addEventListener("click", send);
    document.getElementById("chat-text").addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });
  }
}

// ---------------- International (producer/distributor cross-border matching) ----------------

const INTL_ROLE_TYPES = ["producer", "distributor"];

function intlStatusBadgeMarkup(status) {
  if (status === "verified") return `<span class="intl-badge intl-badge-verified">✓ ${I18N.t("intl.statusVerified")}</span>`;
  if (status === "pending") return `<span class="intl-badge intl-badge-pending">${I18N.t("intl.statusPending")}</span>`;
  if (status === "in_review") return `<span class="intl-badge intl-badge-pending">${I18N.t("intl.statusInReview")}</span>`;
  if (status === "rejected") return `<span class="intl-badge intl-badge-rejected">${I18N.t("intl.statusRejected")}</span>`;
  return "";
}

function intlRoleLabel(roleType) {
  return roleType === "producer" ? I18N.t("intl.roleProducer") : I18N.t("intl.roleDistributor");
}

function renderIntlHome() {
  viewEl.innerHTML = `
    <div class="intl-hero">
      <h1>${I18N.t("intl.heroTitle")}</h1>
      <p>${I18N.t("intl.heroSubtitle")}</p>
    </div>
    <p class="intl-intro">${I18N.t("intl.heroIntro")}</p>

    <div class="intl-cta-row">
      <a class="btn btn-gold" href="#/intl/register">${I18N.t("intl.ctaRegister")}</a>
      <a class="btn btn-outline" href="#/intl/directory">${I18N.t("intl.ctaDirectory")}</a>
      ${state.token ? `<a class="btn btn-secondary" href="#/intl/mine">${I18N.t("intl.ctaMine")}</a>` : ""}
    </div>

    <h2 class="section-heading" style="margin-top:32px;">${I18N.t("intl.howTitle")}</h2>
    <div class="intl-steps">
      <div class="intl-step"><span class="intl-step-num">1</span><p>${I18N.t("intl.howStep1")}</p></div>
      <div class="intl-step"><span class="intl-step-num">2</span><p>${I18N.t("intl.howStep2")}</p></div>
      <div class="intl-step"><span class="intl-step-num">3</span><p>${I18N.t("intl.howStep3")}</p></div>
    </div>

    <p class="intl-disclaimer">${I18N.t("intl.disclaimer")} <a href="#/terms">${I18N.t("auth.termsLink")}</a>.</p>
  `;
}

async function renderIntlDirectory(query) {
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;

  const params = new URLSearchParams();
  if (query.country) params.set("country", query.country);
  if (query.industry) params.set("industry", query.industry);
  if (query.roleType) params.set("roleType", query.roleType);

  const companies = await api("/api/intl/companies?" + params.toString());

  const cards = companies.length
    ? companies
        .map(
          (c) => `
      <a class="intl-card" href="#/intl/company/${c.id}">
        <div class="intl-card-head">
          <span class="intl-role-tag">${intlRoleLabel(c.roleType)}</span>
          ${intlStatusBadgeMarkup(c.status)}
        </div>
        <p class="intl-card-name">${escapeHtml(c.companyName)}</p>
        <p class="intl-card-meta">\u{1F30D} ${escapeHtml(c.country)}${c.industry ? " &middot; " + escapeHtml(c.industry) : ""}</p>
        <p class="intl-card-desc">${escapeHtml((c.description || "").slice(0, 140))}${c.description && c.description.length > 140 ? "…" : ""}</p>
      </a>`
        )
        .join("")
    : `<div class="empty-state">${I18N.t("intl.noResults")}</div>`;

  viewEl.innerHTML = `
    <a class="back-link" href="#/intl">&larr; ${I18N.t("intl.back")}</a>
    <h2 class="section-heading">${I18N.t("intl.directoryTitle")}</h2>
    <div class="filters">
      <input type="text" id="if-country" placeholder="${I18N.t("intl.filterCountry")}" value="${escapeHtml(query.country || "")}" />
      <input type="text" id="if-industry" placeholder="${I18N.t("intl.filterIndustry")}" value="${escapeHtml(query.industry || "")}" />
      <select id="if-role">
        <option value="" ${!query.roleType ? "selected" : ""}>${I18N.t("intl.roleAll")}</option>
        <option value="producer" ${query.roleType === "producer" ? "selected" : ""}>${I18N.t("intl.roleProducer")}</option>
        <option value="distributor" ${query.roleType === "distributor" ? "selected" : ""}>${I18N.t("intl.roleDistributor")}</option>
      </select>
      <button id="if-apply">${I18N.t("intl.applyFilters")}</button>
    </div>
    <div class="intl-grid">${cards}</div>
  `;

  document.getElementById("if-apply").addEventListener("click", () => {
    const p = new URLSearchParams();
    const country = document.getElementById("if-country").value.trim();
    const industry = document.getElementById("if-industry").value.trim();
    const roleType = document.getElementById("if-role").value;
    if (country) p.set("country", country);
    if (industry) p.set("industry", industry);
    if (roleType) p.set("roleType", roleType);
    location.hash = "#/intl/directory" + (p.toString() ? "?" + p.toString() : "");
  });
}

async function renderIntlCompanyDetail(id) {
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  let c;
  try {
    c = await api("/api/intl/companies/" + id, { auth: !!state.token });
  } catch (e) {
    viewEl.innerHTML = `<p class="form-msg error">${I18N.t("intl.detailNotFound")}</p>`;
    return;
  }

  const isMine = state.user && c.ownerUserId === state.user.id;

  viewEl.innerHTML = `
    <a class="back-link" href="#/intl/directory">&larr; ${I18N.t("intl.back")}</a>
    <div class="detail-panel" style="max-width:680px;margin:0 auto;">
      <div class="intl-card-head">
        <span class="intl-role-tag">${intlRoleLabel(c.roleType)}</span>
        ${intlStatusBadgeMarkup(c.status)}
      </div>
      <h1 class="detail-title">${escapeHtml(c.companyName)}</h1>
      <div class="detail-meta">\u{1F30D} ${escapeHtml(c.country)}${c.industry ? " &middot; " + escapeHtml(c.industry) : ""}</div>
      <p style="white-space:pre-wrap;font-size:14px;margin-top:14px;">${escapeHtml(c.description || "")}</p>
      ${c.website ? `<p><a href="${escapeHtml(c.website)}" target="_blank" rel="noopener">${escapeHtml(c.website)}</a></p>` : ""}

      ${
        isMine
          ? `<div class="action-row">
              <a class="btn btn-outline" href="#/intl/edit/${c.id}">${I18N.t("intl.edit")}</a>
            </div>
            ${c.status !== "verified" ? `<p class="form-msg" style="margin-top:10px;">${I18N.t("intl.notVerifiedYet")}</p>` : ""}
            ${c.verificationNotes ? `<p class="form-msg" style="margin-top:6px;"><strong>${I18N.t("intl.verificationNotesLabel")}:</strong> ${escapeHtml(c.verificationNotes)}</p>` : ""}`
          : c.status === "verified"
          ? `<div class="action-row">
              ${state.token ? `<a class="btn btn-gold" href="#/messages/${c.ownerUserId}">${I18N.t("intl.contact")}</a>` : `<a class="btn btn-gold" href="#/login">${I18N.t("nav.login")}</a>`}
            </div>`
          : ""
      }
    </div>
  `;
}

async function renderIntlMyCompanies() {
  if (!state.token) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("intl.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
    return;
  }
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  const mine = await api("/api/intl/companies?mine=1", { auth: true });

  const rows = mine.length
    ? mine
        .map(
          (c) => `
      <a class="intl-card" href="#/intl/company/${c.id}">
        <div class="intl-card-head">
          <span class="intl-role-tag">${intlRoleLabel(c.roleType)}</span>
          ${intlStatusBadgeMarkup(c.status)}
        </div>
        <p class="intl-card-name">${escapeHtml(c.companyName)}</p>
        <p class="intl-card-meta">\u{1F30D} ${escapeHtml(c.country)}${c.industry ? " &middot; " + escapeHtml(c.industry) : ""}</p>
      </a>`
        )
        .join("")
    : `<div class="empty-state">${I18N.t("intl.mineEmpty")}</div>`;

  viewEl.innerHTML = `
    <a class="back-link" href="#/intl">&larr; ${I18N.t("intl.back")}</a>
    <div class="intl-cta-row" style="justify-content:space-between;">
      <h2 class="section-heading" style="margin:0;">${I18N.t("intl.mineTitle")}</h2>
      <a class="btn btn-gold" href="#/intl/register">${I18N.t("intl.mineAddNew")}</a>
    </div>
    <div class="intl-grid">${rows}</div>
  `;
}

async function renderIntlForm(editId) {
  if (!state.token) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("intl.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
    return;
  }

  let existing = null;
  if (editId) {
    existing = await api("/api/intl/companies/" + editId, { auth: true });
    if (!state.user || existing.ownerUserId !== state.user.id) {
      viewEl.innerHTML = `<p class="form-msg error">Not authorized.</p>`;
      return;
    }
  }

  viewEl.innerHTML = `
    <div class="form-panel wide">
      <h2 class="section-heading">${editId ? I18N.t("intl.formTitleEdit") : I18N.t("intl.formTitleNew")}</h2>
      <div class="form-group">
        <label>${I18N.t("intl.companyName")}</label>
        <input type="text" id="ic-name" value="${escapeHtml(existing ? existing.companyName : "")}" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${I18N.t("intl.roleType")}</label>
          <select id="ic-role">
            <option value="producer" ${!existing || existing.roleType === "producer" ? "selected" : ""}>${I18N.t("intl.roleProducer")}</option>
            <option value="distributor" ${existing && existing.roleType === "distributor" ? "selected" : ""}>${I18N.t("intl.roleDistributor")}</option>
          </select>
        </div>
        <div class="form-group">
          <label>${I18N.t("intl.country")}</label>
          <input type="text" id="ic-country" value="${escapeHtml(existing ? existing.country : "")}" />
        </div>
      </div>
      <div class="form-group">
        <label>${I18N.t("intl.industry")}</label>
        <input type="text" id="ic-industry" value="${escapeHtml(existing ? existing.industry : "")}" />
      </div>
      <div class="form-group">
        <label>${I18N.t("intl.description")}</label>
        <textarea id="ic-description" rows="5">${escapeHtml(existing ? existing.description : "")}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${I18N.t("intl.contactEmail")}</label>
          <input type="email" id="ic-email" value="${escapeHtml(existing ? existing.contactEmail : "")}" />
        </div>
        <div class="form-group">
          <label>${I18N.t("intl.contactPhone")}</label>
          <input type="tel" id="ic-phone" value="${escapeHtml(existing ? existing.contactPhone : "")}" />
        </div>
      </div>
      <div class="form-group">
        <label>${I18N.t("intl.website")}</label>
        <input type="text" id="ic-website" placeholder="https://" value="${escapeHtml(existing ? existing.website : "")}" />
      </div>
      <button class="btn btn-primary" id="ic-submit">${editId ? I18N.t("intl.saveChanges") : I18N.t("intl.submit")}</button>
      <p class="form-msg" id="ic-msg"></p>
    </div>
  `;

  document.getElementById("ic-submit").addEventListener("click", async () => {
    const msgEl = document.getElementById("ic-msg");
    const body = {
      companyName: document.getElementById("ic-name").value,
      roleType: document.getElementById("ic-role").value,
      country: document.getElementById("ic-country").value,
      industry: document.getElementById("ic-industry").value,
      description: document.getElementById("ic-description").value,
      contactEmail: document.getElementById("ic-email").value,
      contactPhone: document.getElementById("ic-phone").value,
      website: document.getElementById("ic-website").value,
    };
    try {
      if (editId) {
        await api("/api/intl/companies/" + editId, { method: "PUT", auth: true, body });
        location.hash = "#/intl/company/" + editId;
      } else {
        const created = await api("/api/intl/companies", { method: "POST", auth: true, body });
        msgEl.textContent = I18N.t("intl.registerSuccess");
        msgEl.className = "form-msg ok";
        setTimeout(() => (location.hash = "#/intl/company/" + created.id), 600);
      }
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
    }
  });
}

async function renderIntlAdminQueue() {
  if (!state.user || !state.user.isOwner) {
    viewEl.innerHTML = `<p class="form-msg error">${I18N.t("intl.adminNotAuthorized")}</p>`;
    return;
  }
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  const all = await api("/api/intl/companies?all=1", { auth: true });

  const rows = all.length
    ? all
        .map(
          (c) => `
      <div class="intl-admin-row" id="admin-row-${c.id}">
        <div class="intl-card-head">
          <span class="intl-role-tag">${intlRoleLabel(c.roleType)}</span>
          ${intlStatusBadgeMarkup(c.status)}
        </div>
        <p class="intl-card-name">${escapeHtml(c.companyName)}</p>
        <p class="intl-card-meta">\u{1F30D} ${escapeHtml(c.country)}${c.industry ? " &middot; " + escapeHtml(c.industry) : ""} &middot; ${escapeHtml(c.contactEmail || "")} ${escapeHtml(c.contactPhone || "")}</p>
        <p style="font-size:13px;color:#555;">${escapeHtml(c.description || "")}</p>
        <div class="form-group">
          <label>${I18N.t("intl.adminNotesLabel")}</label>
          <textarea rows="2" data-notes="${c.id}">${escapeHtml(c.verificationNotes || "")}</textarea>
        </div>
        <div class="form-row" style="align-items:flex-end;">
          <div class="form-group">
            <select data-status="${c.id}">
              <option value="pending" ${c.status === "pending" ? "selected" : ""}>${I18N.t("intl.statusPending")}</option>
              <option value="in_review" ${c.status === "in_review" ? "selected" : ""}>${I18N.t("intl.statusInReview")}</option>
              <option value="verified" ${c.status === "verified" ? "selected" : ""}>${I18N.t("intl.statusVerified")}</option>
              <option value="rejected" ${c.status === "rejected" ? "selected" : ""}>${I18N.t("intl.statusRejected")}</option>
            </select>
          </div>
          <button class="btn btn-primary" data-save="${c.id}">${I18N.t("intl.adminSaveStatus")}</button>
        </div>
      </div>`
        )
        .join("")
    : `<div class="empty-state">${I18N.t("intl.adminEmpty")}</div>`;

  viewEl.innerHTML = `
    <a class="back-link" href="#/intl">&larr; ${I18N.t("intl.back")}</a>
    <h2 class="section-heading">${I18N.t("intl.adminTitle")}</h2>
    <div class="intl-admin-list">${rows}</div>
  `;

  document.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.save;
      const status = document.querySelector(`[data-status="${id}"]`).value;
      const verificationNotes = document.querySelector(`[data-notes="${id}"]`).value;
      try {
        await api("/api/intl/companies/" + id + "/status", { method: "PUT", auth: true, body: { status, verificationNotes } });
        renderIntlAdminQueue();
      } catch (e) {
        alert(e.message);
      }
    });
  });
}

// ---------------- Init ----------------

applyStaticI18n();
updateNavUI();
refreshMe().then(router);
router();
pollUnread();
unreadPollTimer = setInterval(pollUnread, 20000);
registerServiceWorker();
