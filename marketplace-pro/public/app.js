// Marketplace Pro - frontend app (vanilla JS, hash-based routing)

// ---------------- Account-tier theme (normal / premium) ----------------
// Theme has two independent layers:
//  1. Account tier - derived automatically from the logged-in account's
//     is_premium flag (a paid upgrade). Premium accounts get the exclusive
//     black+gold [data-theme="premium"] skin and this is NOT user-toggleable.
//  2. Normal-tier appearance preference - for everyone else, a user choice
//     between the :root light+blue theme and the [data-theme="dark"]
//     dark+blue theme, persisted in localStorage under "hieloice-theme-pref".
// applyUserTheme() is called wherever the current-user object is set or
// updated (login, register, session restore, logout, profile refresh) so
// the skin always reflects the account's current tier. It also shows/hides
// the normal-tier toggle UI (#theme-toggle-wrap) since premium users don't
// get a choice.
function applyTheme(tier) {
  document.documentElement.setAttribute("data-theme", tier);
}

function applyNormalThemePref(pref) {
  document.documentElement.setAttribute("data-theme", pref);
  localStorage.setItem("hieloice-theme-pref", pref);
  const lightBtn = document.getElementById("theme-normal-light");
  const darkBtn = document.getElementById("theme-normal-dark");
  if (lightBtn && darkBtn) {
    lightBtn.classList.toggle("active", pref === "light");
    darkBtn.classList.toggle("active", pref === "dark");
  }
}

function applyUserTheme(user) {
  const toggleWrap = document.getElementById("theme-toggle-wrap");
  if (user && user.isPremium) {
    applyTheme("premium");
    if (toggleWrap) toggleWrap.style.display = "none";
  } else {
    if (toggleWrap) toggleWrap.style.display = "";
    const pref = localStorage.getItem("hieloice-theme-pref") || "light";
    const lightBtn = document.getElementById("theme-normal-light");
    const darkBtn = document.getElementById("theme-normal-dark");
    if (lightBtn && darkBtn) {
      lightBtn.classList.toggle("active", pref === "light");
      darkBtn.classList.toggle("active", pref === "dark");
    }
    if (pref === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }
}

const state = {
  token: localStorage.getItem("authToken") || null,
  user: JSON.parse(localStorage.getItem("authUser") || "null"),
};

// Set the initial skin as early as possible based on whatever user object
// was restored from localStorage - anonymous browsing / logged-out falls
// through to the normal tier, which in turn honors any saved
// "hieloice-theme-pref" (light/dark) so a returning normal-tier user with a
// saved dark preference doesn't flash light-then-dark. app.js is loaded via
// a <script> tag at the end of <body> (see index.html), so the toggle
// button markup already exists in the DOM at this point.
applyUserTheme(state.user);

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
  applyUserTheme(state.user);
  updateNavUI();
  pollUnread();
}

async function refreshMe() {
  if (!state.token) return;
  try {
    const data = await api("/api/auth/me", { auth: true });
    state.user = data.user;
    localStorage.setItem("authUser", JSON.stringify(data.user));
    applyUserTheme(state.user);
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
  const navAdmin = document.getElementById("nav-admin");
  if (navAdmin) {
    const canAdmin = loggedIn && state.user && (state.user.role === "admin" || state.user.isOwner);
    navAdmin.style.display = canAdmin ? "inline" : "none";
  }
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
  setText("icon-nav-create-label", I18N.t("iconnav.create"));
  setText("icon-nav-create-moment-label", I18N.t("iconnav.createMoment"));
  setText("icon-nav-create-product-label", I18N.t("iconnav.createProduct"));
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

// Normal-tier dark mode toggle (hidden for premium accounts - see
// applyUserTheme()). Clicking these when hidden is harmless since the
// wrapper is display:none for premium users.
document.getElementById("theme-normal-light").addEventListener("click", () => {
  applyNormalThemePref("light");
});
document.getElementById("theme-normal-dark").addEventListener("click", () => {
  applyNormalThemePref("dark");
});

// ---------------- Topbar "..." menu (language + logout) ----------------
// Same open/close-on-outside-click pattern as the icon-nav dropdowns below.
(function wireTopbarMenu() {
  const btn = document.getElementById("topbar-menu-btn");
  const dropdown = document.getElementById("topbar-menu-dropdown");
  if (!btn || !dropdown) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = dropdown.style.display === "block";
    dropdown.style.display = open ? "none" : "block";
    btn.setAttribute("aria-expanded", open ? "false" : "true");
  });
  dropdown.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => {
    dropdown.style.display = "none";
    btn.setAttribute("aria-expanded", "false");
  });
})();

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
  const createBtn = document.getElementById("icon-nav-create");
  const createDropdown = document.getElementById("icon-nav-create-dropdown");
  if (marketplaceBtn && dropdown) {
    marketplaceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (createDropdown) createDropdown.style.display = "none";
      dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
    });
    dropdown.addEventListener("click", (e) => e.stopPropagation());
  }
  if (createBtn && createDropdown) {
    createBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      dropdown.style.display = "none";
      createDropdown.style.display = createDropdown.style.display === "block" ? "none" : "block";
    });
    createDropdown.addEventListener("click", (e) => e.stopPropagation());
    const momentLink = document.getElementById("icon-nav-create-moment");
    if (momentLink) {
      momentLink.addEventListener("click", (e) => {
        e.preventDefault();
        createDropdown.style.display = "none";
        openCreateWizard();
      });
    }
    const productLink = document.getElementById("icon-nav-create-product");
    if (productLink) {
      productLink.addEventListener("click", () => {
        createDropdown.style.display = "none";
      });
    }
  }
  document.addEventListener("click", () => {
    if (dropdown) dropdown.style.display = "none";
    if (createDropdown) createDropdown.style.display = "none";
  });
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
    if (parts[0] === "delete-account") return renderDeleteAccount();
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
    if (parts[0] === "admin" && parts[1]) return renderAdminPanel(parts[1]);
    if (parts[0] === "admin") return renderAdminPanel("reports");
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
    <div id="ad-carousel" class="ad-carousel" style="display:none;"></div>
    <div class="feed-section" id="feed-section-friends">
      <h2 class="section-heading">${I18N.t("feed.friendsHeading")}</h2>
      <div class="moments-bar" id="home-moments-bar-friends"></div>
    </div>
    <div class="home-feed-posts" id="home-feed-posts" style="display:none;"></div>
    <div class="feed-section" id="feed-section-suggested" style="display:none;">
      <h2 class="section-heading">${I18N.t("feed.suggestedHeading")}</h2>
      <div class="moments-bar" id="home-moments-bar-suggested" style="display:none;"></div>
    </div>
  `;
  // Draw the "your moment" circle (yellow ring if you already posted one today,
  // plain "+" to add one otherwise) immediately, from data already in memory -
  // don't wait on the /api/moments/feed round trip for it, and don't let a
  // failed/slow fetch hide it later (see loadHomeFeed()'s catch below). This
  // was previously only drawn after the feed loaded, so on a slow connection
  // or a feed error it silently never appeared at all.
  renderMomentGroupsBar(document.getElementById("home-moments-bar-friends"), [], {
    showAddForUserId: state.user.id,
    ownPhoto: state.user.photo,
    ownName: state.user.name,
    layout: "rect",
  });
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
    <div class="filters" id="marketplace-search-row">
      <input type="text" id="marketplace-search-input" placeholder="${I18N.t("home.searchPlaceholder")}" />
      <button id="marketplace-search-btn">${I18N.t("home.searchBtn")}</button>
    </div>
    <h2 class="section-heading">${I18N.t("home.categoriesHeading")}</h2>
    <div class="category-grid">${categoryCardsHtml()}</div>
  `;
  const doMarketplaceSearch = () => {
    const q = document.getElementById("marketplace-search-input").value.trim();
    location.hash = "#/category/all" + (q ? "?q=" + encodeURIComponent(q) : "");
  };
  document.getElementById("marketplace-search-btn").addEventListener("click", doMarketplaceSearch);
  document.getElementById("marketplace-search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doMarketplaceSearch();
  });
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
      layout: "rect",
    });
    // Friends' actual moments also play inline in the main feed, below the
    // "stories" circle bar - not just as a circle you have to tap. Own
    // moments are excluded here since "Your Moment" is already the circle.
    const friendGroupsForFeed = (data.friends || []).filter((g) => g.userId !== state.user.id);
    renderHomeFeedPosts(friendGroupsForFeed);
    if (data.suggested && data.suggested.length) {
      suggestedSection.style.display = "block";
      elSuggested.style.display = "flex";
      renderMomentGroupsBar(elSuggested, data.suggested, { layout: "rect" });
    } else {
      suggestedSection.style.display = "none";
    }
  } catch (e) {
    // Best-effort: leave the "your moment" circle drawn by renderHome() as-is
    // rather than wiping the whole section - a failed feed fetch shouldn't
    // make the add-a-moment entry point disappear too.
    suggestedSection.style.display = "none";
    const postsEl = document.getElementById("home-feed-posts");
    if (postsEl) postsEl.style.display = "none";
  }
}

// ---- Friends' moments rendered as inline, playable feed cards on Home -----
// (in addition to the circle bar above). Each card carries the full Reels-
// style action rail (like/comment/share/repost/save); tapping the media
// opens the full-screen story viewer starting on that exact moment.

function buildHomeFeedItems(groups) {
  const items = [];
  for (const g of groups) {
    for (const m of g.moments) {
      items.push({ ...m, userId: g.userId, userName: g.userName, userPhoto: g.userPhoto, isPage: g.isPage });
    }
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  return items;
}

function feedMomentCardHtml(m) {
  return `
    <div class="feed-moment-card" data-moment-id="${m.id}">
      <div class="feed-moment-head">
        <a class="feed-moment-author-link" href="#/profile/${m.userId}">
          ${
            m.userPhoto
              ? `<img class="feed-moment-avatar" src="${m.userPhoto}" />`
              : `<div class="feed-moment-avatar-placeholder">${initials(m.userName || "")}</div>`
          }
          <span class="feed-moment-author-name">${escapeHtml(m.userName || "")}${m.isPage ? ` <span class="page-badge-inline">${I18N.t("pages.badge")}</span>` : ""}</span>
        </a>
        <span class="feed-moment-age">${timeAgoStr(m.createdAt)}</span>
      </div>
      <div class="feed-moment-media-wrap">
        ${
          m.mediaType === "video"
            ? `<video class="feed-moment-media" src="${m.mediaUrl}" muted loop playsinline autoplay></video>`
            : `<img class="feed-moment-media" src="${m.mediaUrl}" />`
        }
        <div class="feed-moment-actions">
          <button class="moment-viewer-action-btn like-btn ${m.liked ? "active" : ""}" data-action="like" title="${I18N.t("moments.actionLike") || "Like"}">${MOMENT_ICON_HEART}</button>
          <button class="moment-viewer-action-btn" data-action="comment" title="${I18N.t("moments.actionMessage") || "Message"}">${MOMENT_ICON_MESSAGE}</button>
          <button class="moment-viewer-action-btn" data-action="share" title="${I18N.t("moments.actionShare") || "Share"}">${MOMENT_ICON_SHARE}</button>
          <button class="moment-viewer-action-btn repost-btn" data-action="repost" title="${I18N.t("moments.actionRepost") || "Repost"}">${MOMENT_ICON_REPOST}</button>
          <button class="moment-viewer-action-btn save-btn ${m.saved ? "active" : ""}" data-action="save" title="${I18N.t("moments.actionSave") || "Save"}">${MOMENT_ICON_SAVE}</button>
        </div>
      </div>
      ${m.caption ? `<div class="feed-moment-caption">${linkifyHashtags(escapeHtml(m.caption))}</div>` : ""}
    </div>
  `;
}

function renderHomeFeedPosts(groups) {
  const el = document.getElementById("home-feed-posts");
  if (!el) return;
  homeFeedGroupsById = {};
  groups.forEach((g) => {
    homeFeedGroupsById[g.userId] = g;
  });
  const items = buildHomeFeedItems(groups);
  homeFeedMomentsList = items;
  if (!items.length) {
    el.innerHTML = "";
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";
  el.innerHTML = items.map(feedMomentCardHtml).join("");
  wireHomeFeedPostsDelegation();
}

// Single delegated listener (wired once, survives re-renders since the
// container itself is never replaced) so we don't need per-card unique ids
// the way the single-instance Stories/Shorts overlays do.
function wireHomeFeedPostsDelegation() {
  const el = document.getElementById("home-feed-posts");
  if (!el || el.dataset.wired === "1") return;
  el.dataset.wired = "1";
  el.addEventListener("click", async (e) => {
    const card = e.target.closest("[data-moment-id]");
    if (!card) return;
    const m = homeFeedMomentsList.find((x) => x.id === card.dataset.momentId);
    if (!m) return;
    const actionBtn = e.target.closest("[data-action]");

    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === "like") {
        if (!state.token) {
          location.hash = "#/login";
          return;
        }
        const nowLiked = !m.liked;
        m.liked = nowLiked;
        actionBtn.classList.toggle("active", nowLiked);
        try {
          await api("/api/moments/" + m.id + "/like", { method: nowLiked ? "POST" : "DELETE", auth: true });
        } catch (err) {
          m.liked = !nowLiked;
          actionBtn.classList.toggle("active", m.liked);
        }
      } else if (action === "save") {
        if (!state.token) {
          location.hash = "#/login";
          return;
        }
        const nowSaved = !m.saved;
        m.saved = nowSaved;
        actionBtn.classList.toggle("active", nowSaved);
        try {
          await api("/api/moments/" + m.id + "/save", { method: nowSaved ? "POST" : "DELETE", auth: true });
        } catch (err) {
          m.saved = !nowSaved;
          actionBtn.classList.toggle("active", m.saved);
        }
      } else if (action === "repost") {
        if (!state.token) {
          location.hash = "#/login";
          return;
        }
        flashMomentAction(actionBtn);
        try {
          await api("/api/moments/" + m.id + "/repost", { method: "POST", auth: true });
          actionBtn.classList.add("active");
          setTimeout(() => actionBtn.classList.remove("active"), 1200);
        } catch (err) {
          alert(err.message);
        }
      } else if (action === "share") {
        flashMomentAction(actionBtn);
        const url = location.origin + "/#/profile/" + m.userId;
        try {
          if (navigator.share) {
            await navigator.share({ url, title: "HieloIce" });
          } else if (navigator.clipboard) {
            await navigator.clipboard.writeText(url);
            alert(I18N.t("moments.linkCopied") || "Link copied");
          }
        } catch (err) {}
      } else if (action === "comment") {
        const group = homeFeedGroupsById[m.userId];
        if (!group) return;
        const idx = group.moments.findIndex((x) => x.id === m.id);
        openMomentsViewer(group.moments, idx >= 0 ? idx : 0, group);
        setTimeout(() => openMomentComments(m), 60);
      }
      return;
    }

    if (e.target.closest(".feed-moment-author-link")) return; // let the profile link navigate normally

    const mediaEl = e.target.closest(".feed-moment-media-wrap");
    if (mediaEl) {
      const group = homeFeedGroupsById[m.userId];
      if (!group) return;
      const idx = group.moments.findIndex((x) => x.id === m.id);
      openMomentsViewer(group.moments, idx >= 0 ? idx : 0, group);
    }
  });
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
            ? `<div class="action-row"><a class="btn btn-gold" href="#/edit/${p.id}">${I18N.t("product.editListing")}</a></div>
              <div class="action-row" id="status-controls">
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

// "#/delete-account": a public URL (required by Google Play's Data Safety
// account-deletion policy) that works even for someone who doesn't have the
// app installed - it's just the website. Shows a login form if not
// authenticated, then an explanation + confirmation step that permanently
// scrubs the account's personal data.
function renderDeleteAccount() {
  if (!state.token || !state.user) {
    viewEl.innerHTML = `
      <div class="form-panel">
        <h2 class="section-heading">${I18N.t("deleteAccount.title")}</h2>
        <p>${I18N.t("deleteAccount.loginFirst")}</p>
        <div class="form-group">
          <label>${I18N.t("auth.email")}</label>
          <input type="email" id="del-login-email" />
        </div>
        <div class="form-group">
          <label>${I18N.t("auth.password")}</label>
          <input type="password" id="del-login-password" />
        </div>
        <button class="btn btn-primary" id="del-login-submit" style="width:100%;">${I18N.t("auth.submitLogin")}</button>
        <p class="form-msg" id="del-login-msg"></p>
        <div class="oauth-divider"><span>${I18N.t("auth.orContinueWith")}</span></div>
        <a class="btn btn-google" style="width:100%;display:flex;" href="/api/auth/google">${I18N.t("auth.continueGoogle")}</a>
        <a class="btn btn-facebook" style="width:100%;display:flex;margin-top:8px;" href="/api/auth/facebook">${I18N.t("auth.continueFacebook")}</a>
      </div>
    `;
    document.getElementById("del-login-submit").addEventListener("click", async () => {
      const email = document.getElementById("del-login-email").value;
      const password = document.getElementById("del-login-password").value;
      const msgEl = document.getElementById("del-login-msg");
      try {
        const data = await api("/api/auth/login", { method: "POST", body: { email, password } });
        setAuth(data.token, data.user);
        renderDeleteAccount();
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = "form-msg error";
      }
    });
    return;
  }

  viewEl.innerHTML = `
    <div class="form-panel">
      <h2 class="section-heading">${I18N.t("deleteAccount.title")}</h2>
      <p>${I18N.t("deleteAccount.intro")}</p>
      <p><strong>${I18N.t("deleteAccount.willDeleteHeading")}</strong> ${I18N.t("deleteAccount.willDelete")}</p>
      <p><strong>${I18N.t("deleteAccount.willKeepHeading")}</strong> ${I18N.t("deleteAccount.willKeep")}</p>
      <div class="form-group">
        <label>${I18N.t("deleteAccount.passwordLabel")}</label>
        <input type="password" id="del-password" placeholder="${I18N.t("deleteAccount.passwordPlaceholder")}" />
      </div>
      <label class="checkbox-row">
        <input type="checkbox" id="del-confirm-checkbox" />
        <span>${I18N.t("deleteAccount.confirmCheckbox")}</span>
      </label>
      <button class="btn btn-danger" id="del-confirm-submit" style="width:100%;margin-top:12px;">${I18N.t("deleteAccount.confirmButton")}</button>
      <p class="form-msg" id="del-confirm-msg"></p>
    </div>
  `;
  document.getElementById("del-confirm-submit").addEventListener("click", async () => {
    const msgEl = document.getElementById("del-confirm-msg");
    if (!document.getElementById("del-confirm-checkbox").checked) {
      msgEl.textContent = I18N.t("deleteAccount.mustCheck");
      msgEl.className = "form-msg error";
      return;
    }
    if (!confirm(I18N.t("deleteAccount.finalConfirm"))) return;
    const password = document.getElementById("del-password").value;
    try {
      await api("/api/users/me", { method: "DELETE", auth: true, body: { password } });
      setAuth(null, null);
      viewEl.innerHTML = `<div class="form-panel"><p>${I18N.t("deleteAccount.done")}</p></div>`;
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
    }
  });
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
    viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
    try {
      existing = await api("/api/products/" + editId);
    } catch (e) {
      viewEl.innerHTML = `<p class="form-msg error">${escapeHtml(e.message || "")}</p><p><a href="#/edit/${editId}" id="retry-edit-load">${I18N.t("common.retry") || "Retry"}</a></p>`;
      const retryLink = document.getElementById("retry-edit-load");
      if (retryLink) retryLink.addEventListener("click", (ev) => { ev.preventDefault(); renderPostAd(editId); });
      return;
    }
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

// List-safe variant of friendActionMarkup()/wireFriendActionButtons(): those
// two use element IDs (btn-friend-add, etc.), which only works for a single
// instance per page (a profile page). Search results render one action block
// per row, so duplicate IDs would collide and only the first row's buttons
// would ever respond - this variant uses data-attributes + event delegation
// instead so any number of rows can coexist safely.
function friendActionMarkupList(fs) {
  if (!fs || fs.status === "none") {
    return `<button class="btn btn-outline" data-friend-action="add">${I18N.t("friends.addFriend")}</button>`;
  }
  if (fs.status === "pending_sent") {
    return `<button class="btn btn-friend-status" data-friend-action="cancel" data-fid="${fs.friendshipId}">${I18N.t("friends.requestSent")}</button>`;
  }
  if (fs.status === "pending_received") {
    return `
      <button class="btn btn-primary" data-friend-action="accept" data-fid="${fs.friendshipId}">${I18N.t("friends.accept")}</button>
      <button class="btn btn-secondary" data-friend-action="decline" data-fid="${fs.friendshipId}">${I18N.t("friends.decline")}</button>
    `;
  }
  if (fs.status === "friends") {
    return `<button class="btn btn-friend-status" data-friend-action="remove">${I18N.t("friends.friendsBadge")}</button>`;
  }
  return "";
}

// Wires every [data-friend-action] button inside containerEl via a single
// delegated listener (safe with any number of friend-card rows), then calls
// onDone() to let the caller refresh/re-render after a successful action.
function wireFriendActionButtonsList(containerEl, onDone) {
  containerEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-friend-action]");
    if (!btn || !containerEl.contains(btn)) return;
    const wrap = btn.closest(".friend-card-actions");
    const otherUserId = wrap ? wrap.dataset.uid : null;
    const action = btn.dataset.friendAction;
    const fid = btn.dataset.fid;
    try {
      if (action === "add") {
        await api("/api/friends/request", { method: "POST", auth: true, body: { userId: otherUserId } });
      } else if (action === "cancel" || action === "decline") {
        await api("/api/friends/" + fid + "/reject", { method: "POST", auth: true });
      } else if (action === "accept") {
        await api("/api/friends/" + fid + "/accept", { method: "POST", auth: true });
      } else if (action === "remove") {
        if (!confirm(I18N.t("friends.confirmRemove"))) return;
        await api("/api/friends/user/" + otherUserId, { method: "DELETE", auth: true });
      } else {
        return;
      }
      pollUnread();
      if (onDone) onDone();
    } catch (err) {
      alert(err.message);
    }
  });
}

// Follow button for "Public Page" profiles - separate from the friend system,
// one-directional, no acceptance required.
function pageFollowMarkup(fs) {
  if (!state.token) {
    return `<a class="btn btn-outline" href="#/login">${I18N.t("subs.subscribe")}</a>`;
  }
  if (fs && fs.following) {
    return `<button class="btn btn-friend-status" id="btn-page-unfollow">${I18N.t("subs.subscribed")}</button>`;
  }
  if (fs && fs.pending) {
    return `<button class="btn btn-friend-status" id="btn-page-unfollow">${I18N.t("subs.pending")}</button>`;
  }
  return `<button class="btn btn-primary" id="btn-page-follow">${I18N.t("subs.subscribe")}</button>`;
}

// Loads the pending-subscription-requests list on the current user's own
// Page profile (only relevant when subscriptionMode is "manual", the
// default) and wires the Accept/Reject buttons.
async function loadSubsRequests() {
  const card = document.getElementById("subs-requests-card");
  const list = document.getElementById("subs-requests-list");
  if (!card || !list) return;
  try {
    const reqs = await api("/api/follow/requests", { auth: true });
    if (!reqs.length) {
      card.style.display = "none";
      return;
    }
    card.style.display = "block";
    list.innerHTML = reqs
      .map(
        (r) => `
      <div class="friend-request-row">
        ${r.photo ? `<img class="mini-avatar" style="width:36px;height:36px;" src="${r.photo}" />` : `<div class="seller-avatar-placeholder" style="width:36px;height:36px;">${initials(r.name)}</div>`}
        <span class="friend-request-name">${escapeHtml(r.name)}</span>
        <button class="btn btn-primary" data-subs-accept="${r.id}">${I18N.t("friends.accept")}</button>
        <button class="btn btn-secondary" data-subs-reject="${r.id}">${I18N.t("friends.decline")}</button>
      </div>`
      )
      .join("");
    list.querySelectorAll("[data-subs-accept]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api("/api/follow/requests/" + btn.dataset.subsAccept + "/accept", { method: "POST", auth: true });
        loadSubsRequests();
      });
    });
    list.querySelectorAll("[data-subs-reject]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api("/api/follow/requests/" + btn.dataset.subsReject + "/reject", { method: "POST", auth: true });
        loadSubsRequests();
      });
    });
  } catch (e) {}
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

let friendsPageTab = "friends";

async function renderFriendsPage() {
  if (!state.token) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("messages.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
    return;
  }
  viewEl.innerHTML = `
    <h2 class="section-heading">${I18N.t("friendsPage.title")}</h2>
    <div class="friends-search-tabs">
      <button class="friends-search-tab ${friendsPageTab === "friends" ? "active" : ""}" data-tab="friends">${I18N.t("friendsPage.tabFriends")}</button>
      <button class="friends-search-tab ${friendsPageTab === "people" ? "active" : ""}" data-tab="people">${I18N.t("friendsPage.tabPeople")}</button>
    </div>
    <input type="text" id="friends-search-input" class="friends-search-input" placeholder="${friendsPageTab === "people" ? I18N.t("friendsPage.searchPeoplePlaceholder") : I18N.t("friendsPage.searchFriendsPlaceholder")}" />
    <div id="friends-page-body"><p>${I18N.t("common.loading")}</p></div>
  `;

  document.querySelectorAll(".friends-search-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      friendsPageTab = btn.dataset.tab;
      renderFriendsPage();
    });
  });

  const searchInput = document.getElementById("friends-search-input");
  let debounceTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runFriendsPageSearch(searchInput.value.trim()), 300);
  });

  await runFriendsPageSearch("");
}

async function runFriendsPageSearch(q) {
  const body = document.getElementById("friends-page-body");
  if (!body) return;

  // "people" tab: search every platform user by name (not just existing
  // friends), with Add-Friend/Request-Sent/Accept-Decline/Friends actions
  // straight from the results - the discovery/add-new-people search.
  if (friendsPageTab === "people") {
    if (!q) {
      body.innerHTML = `<div class="empty-state">${I18N.t("friendsPage.searchPeopleHint")}</div>`;
      return;
    }
    body.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
    const users = await api("/api/users/search?q=" + encodeURIComponent(q), { auth: true });
    body.innerHTML = users.length
      ? `<div class="friends-grid">${users
          .map(
            (u) => `
        <div class="friend-card">
          <a href="#/profile/${u.userId}">
            ${u.photo ? `<img class="friend-card-photo" src="${u.photo}" />` : `<div class="friend-card-photo-placeholder">${initials(u.name)}</div>`}
          </a>
          <div class="friend-card-body">
            <p class="friend-card-name">${escapeHtml(u.name)}</p>
            <div class="friend-card-actions" data-uid="${u.userId}">${friendActionMarkupList(u.friendStatus)}</div>
            <a class="btn btn-outline" href="#/profile/${u.userId}">${I18N.t("friendsPage.viewProfile")}</a>
          </div>
        </div>`
          )
          .join("")}</div>`
      : `<div class="empty-state">${I18N.t("friendsPage.noFriendResults")}</div>`;
    // Wire the delegated click listener at most once per render of
    // #friends-page-body - runFriendsPageSearch() only replaces its
    // innerHTML on subsequent searches, so re-wiring here would otherwise
    // stack up a fresh listener (and a fresh handled click) on every
    // keystroke of the debounced search box.
    if (!body.dataset.friendActionsWired) {
      wireFriendActionButtonsList(body, () => {
        const input = document.getElementById("friends-search-input");
        runFriendsPageSearch(input ? input.value.trim() : "");
      });
      body.dataset.friendActionsWired = "1";
    }
    return;
  }

  // "friends" tab, with a query typed: filter the caller's own friends list
  // by name client-side (small list, no need for a dedicated endpoint) -
  // this is a lookup among people you're already connected to, distinct
  // from the "people" tab's platform-wide discovery search above.
  if (q) {
    body.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
    const allFriends = await api("/api/friends", { auth: true });
    const qLower = q.toLowerCase();
    const matches = allFriends.filter((f) => (f.name || "").toLowerCase().includes(qLower));
    body.innerHTML = matches.length
      ? `<div class="friends-grid">${matches
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
      : `<div class="empty-state">${I18N.t("friendsPage.noFriendResults")}</div>`;
    body.querySelectorAll(".friend-card-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(I18N.t("friends.confirmRemove"))) return;
        await api("/api/friends/user/" + btn.dataset.uid, { method: "DELETE", auth: true });
        runFriendsPageSearch(q);
      });
    });
    return;
  }

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

  body.innerHTML = `
    <h3 class="section-subheading">${I18N.t("friendsPage.requestsHeading")}</h3>
    <div id="friends-page-requests">${requestsHtml}</div>
    <h3 class="section-subheading">${I18N.t("friendsPage.friendsHeading")}</h3>
    <div id="friends-page-friends">${friendsHtml}</div>
  `;

  body.querySelectorAll("[data-accept]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/friends/" + btn.dataset.accept + "/accept", { method: "POST", auth: true });
      runFriendsPageSearch("");
      pollUnread();
    });
  });
  body.querySelectorAll("[data-decline]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/friends/" + btn.dataset.decline + "/reject", { method: "POST", auth: true });
      runFriendsPageSearch("");
    });
  });
  body.querySelectorAll(".friend-card-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(I18N.t("friends.confirmRemove"))) return;
      await api("/api/friends/user/" + btn.dataset.uid, { method: "DELETE", auth: true });
      runFriendsPageSearch("");
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
  // "rect" layout renders small Facebook-style rectangular preview cards
  // (actual moment thumbnail as the card background) instead of the
  // Instagram-style circle avatars - used on Home so the strip reads as a
  // wall of content that scales as the community grows, rather than a row
  // of profile pictures. Profile page keeps the classic circle layout.
  const rectLayout = !!(opts && opts.layout === "rect");
  let html = "";
  if (opts && opts.showAddForUserId) {
    const mine = groups.find((g) => g.userId === opts.showAddForUserId);
    const hasOwn = !!(mine && mine.moments.length);
    if (rectLayout) {
      const thumb = hasOwn && mine.moments[0].mediaType === "image" ? mine.moments[0].mediaUrl : opts.ownPhoto;
      html += `
        <div class="moment-rect-wrap moment-rect-add" id="moment-add-circle" style="${thumb ? `background-image:url('${thumb}')` : ""}">
          ${!thumb ? `<div class="moment-rect-placeholder">${initials(opts.ownName || "")}</div>` : ""}
          <span class="moment-rect-shade"></span>
          <span class="moment-rect-add-badge" id="moment-add-badge" title="${I18N.t("moments.add")}">+</span>
          <span class="moment-rect-name">${I18N.t("moments.yourMoment")}</span>
        </div>`;
    } else {
      html += `
        <div class="moment-circle-wrap" id="moment-add-circle">
          <div class="moment-circle">
            <div class="moment-circle-inner">
              ${opts.ownPhoto ? `<img src="${opts.ownPhoto}" />` : `<div class="moment-circle-placeholder">${initials(opts.ownName || "")}</div>`}
            </div>
            <span class="moment-circle-add-badge" id="moment-add-badge" title="${I18N.t("moments.add")}">+</span>
          </div>
          <span class="moment-circle-label">${I18N.t("moments.yourMoment")}</span>
        </div>`;
    }
    if (!hasOwn) {
      // nothing else to add here; handled by click handler below
    }
  }
  const others = opts && opts.showAddForUserId ? groups.filter((g) => g.userId !== opts.showAddForUserId) : groups;
  others.forEach((g) => {
    if (rectLayout) {
      const thumb = g.moments[0] && g.moments[0].mediaType === "image" ? g.moments[0].mediaUrl : g.userPhoto;
      html += `
        <div class="moment-rect-wrap" data-uid="${g.userId}" style="${thumb ? `background-image:url('${thumb}')` : ""}">
          ${!thumb ? `<div class="moment-rect-placeholder">${initials(g.userName)}</div>` : ""}
          <span class="moment-rect-shade"></span>
          <div class="moment-rect-avatar">
            ${g.userPhoto ? `<img src="${g.userPhoto}" />` : `<div class="moment-rect-avatar-placeholder">${initials(g.userName)}</div>`}
          </div>
          <span class="moment-rect-name">${escapeHtml(g.userName)}</span>
        </div>`;
    } else {
      html += `
        <div class="moment-circle-wrap" data-uid="${g.userId}">
          <div class="moment-circle">
            <div class="moment-circle-inner">
              ${g.userPhoto ? `<img src="${g.userPhoto}" />` : `<div class="moment-circle-placeholder">${initials(g.userName)}</div>`}
            </div>
          </div>
          <span class="moment-circle-label">${escapeHtml(g.userName)}</span>
        </div>`;
    }
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
    // The small "+" badge always opens the upload flow, even if the user
    // already has active moments - tapping the rest of the circle views
    // your current story, the badge is the dedicated "add another" target.
    const addBadge = document.getElementById("moment-add-badge");
    if (addBadge) {
      addBadge.addEventListener("click", (e) => {
        e.stopPropagation();
        openMomentUploadModal();
      });
    }
  }
  containerEl.querySelectorAll(".moment-circle-wrap[data-uid], .moment-rect-wrap[data-uid]").forEach((wrap) => {
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
// Flat, chronologically-sorted list of friends' active moments rendered as
// inline feed cards on Home (in addition to the "stories" circle bar above
// them), plus a userId->group lookup so tapping a card's media can open the
// full-screen viewer starting on that exact moment within that friend's set.
let homeFeedMomentsList = [];
let homeFeedGroupsById = {};

// Reels/Shorts-style action rail icons for the Moments story viewer: white
// outline by default, filled via the ".active" CSS class (persistent for
// like/save, momentary for message/share/repost as a press-feedback flash).
const MOMENT_ICON_HEART =
  '<svg viewBox="0 0 24 24" class="icon-solid"><path fill-rule="evenodd" d="M 11.00,0.00 C 10.63,-0.08 10.65,0.10 10.62,0.29 C 10.59,0.48 10.81,0.56 10.81,1.14 C 10.81,1.73 11.17,2.65 10.62,3.81 C 10.06,4.97 8.10,7.14 7.48,8.10 C 6.86,9.05 7.02,9.11 6.90,9.52 C 6.79,9.94 6.87,10.35 6.81,10.57 C 6.75,10.79 6.68,11.00 6.52,10.86 C 6.37,10.71 5.95,10.30 5.86,9.71 C 5.76,9.13 5.97,7.76 5.95,7.33 C 5.94,6.90 5.90,7.16 5.76,7.14 C 5.62,7.13 5.56,6.81 5.10,7.24 C 4.63,7.67 3.54,8.89 3.00,9.71 C 2.46,10.54 2.08,11.16 1.86,12.19 C 1.63,13.22 1.56,14.81 1.67,15.90 C 1.78,17.00 2.25,18.08 2.52,18.76 C 2.79,19.44 2.87,19.49 3.29,20.00 C 3.70,20.51 4.37,21.29 5.00,21.81 C 5.63,22.33 6.44,22.81 7.10,23.14 C 7.75,23.48 8.38,23.68 8.90,23.81 C 9.43,23.94 9.98,23.98 10.24,23.90 C 10.49,23.83 10.65,23.59 10.43,23.33 C 10.21,23.08 9.29,22.70 8.90,22.38 C 8.52,22.06 8.35,21.81 8.14,21.43 C 7.94,21.05 7.75,20.49 7.67,20.10 C 7.59,19.70 7.57,19.48 7.67,19.05 C 7.76,18.62 7.97,17.63 8.24,17.52 C 8.51,17.41 8.94,18.24 9.29,18.38 C 9.63,18.52 10.03,18.48 10.33,18.38 C 10.63,18.29 10.90,18.03 11.10,17.81 C 11.29,17.59 11.48,17.65 11.48,17.05 C 11.48,16.44 11.13,14.78 11.10,14.19 C 11.06,13.60 11.14,13.71 11.29,13.52 C 11.43,13.33 11.75,12.90 11.95,13.05 C 12.16,13.19 11.92,13.68 12.52,14.38 C 13.13,15.08 14.95,16.52 15.57,17.24 C 16.19,17.95 16.13,18.16 16.24,18.67 C 16.35,19.17 16.32,19.84 16.24,20.29 C 16.16,20.73 16.03,20.94 15.76,21.33 C 15.49,21.73 14.90,22.41 14.62,22.67 C 14.33,22.92 14.22,22.73 14.05,22.86 C 13.87,22.98 13.59,23.25 13.57,23.43 C 13.56,23.60 13.73,23.84 13.95,23.90 C 14.17,23.97 14.25,24.03 14.90,23.81 C 15.56,23.59 16.94,23.17 17.86,22.57 C 18.78,21.97 19.81,20.90 20.43,20.19 C 21.05,19.48 21.30,18.84 21.57,18.29 C 21.84,17.73 21.94,17.65 22.05,16.86 C 22.16,16.06 22.29,14.41 22.24,13.52 C 22.19,12.63 21.98,12.16 21.76,11.52 C 21.54,10.89 21.22,10.27 20.90,9.71 C 20.59,9.16 20.33,8.73 19.86,8.19 C 19.38,7.65 18.48,6.75 18.05,6.48 C 17.62,6.21 17.40,6.27 17.29,6.57 C 17.17,6.87 17.49,7.76 17.38,8.29 C 17.27,8.81 16.87,9.46 16.62,9.71 C 16.37,9.97 16.10,9.89 15.86,9.81 C 15.62,9.73 15.33,9.57 15.19,9.24 C 15.05,8.90 14.97,8.51 15.00,7.81 C 15.03,7.11 15.38,5.76 15.38,5.05 C 15.38,4.33 15.21,4.02 15.00,3.52 C 14.79,3.03 14.51,2.56 14.14,2.10 C 13.78,1.63 13.33,1.11 12.81,0.76 C 12.29,0.41 11.37,0.08 11.00,0.00 Z M 12.24,1.62 C 12.51,1.79 13.13,2.33 13.48,2.86 C 13.83,3.38 14.19,4.16 14.33,4.76 C 14.48,5.37 14.40,5.89 14.33,6.48 C 14.27,7.06 13.95,7.73 13.95,8.29 C 13.95,8.84 14.14,9.43 14.33,9.81 C 14.52,10.19 14.87,10.41 15.10,10.57 C 15.32,10.73 15.32,10.76 15.67,10.76 C 16.02,10.76 16.81,10.73 17.19,10.57 C 17.57,10.41 17.76,10.16 17.95,9.81 C 18.14,9.46 18.22,8.73 18.33,8.48 C 18.44,8.22 18.35,8.03 18.62,8.29 C 18.89,8.54 19.60,9.46 19.95,10.00 C 20.30,10.54 20.51,11.00 20.71,11.52 C 20.92,12.05 21.13,12.32 21.19,13.14 C 21.25,13.97 21.17,15.71 21.10,16.48 C 21.02,17.24 21.00,17.14 20.71,17.71 C 20.43,18.29 19.78,19.37 19.38,19.90 C 18.98,20.44 18.78,20.62 18.33,20.95 C 17.89,21.29 16.90,22.00 16.71,21.90 C 16.52,21.81 17.11,20.92 17.19,20.38 C 17.27,19.84 17.25,19.16 17.19,18.67 C 17.13,18.17 17.02,17.84 16.81,17.43 C 16.60,17.02 16.52,16.79 15.95,16.19 C 15.38,15.59 13.87,14.33 13.38,13.81 C 12.89,13.29 13.06,13.43 13.00,13.05 C 12.94,12.67 13.11,11.81 13.00,11.52 C 12.89,11.24 12.68,11.19 12.33,11.33 C 11.98,11.48 11.27,11.98 10.90,12.38 C 10.54,12.78 10.24,12.92 10.14,13.71 C 10.05,14.51 10.41,16.51 10.33,17.14 C 10.25,17.78 9.84,17.52 9.67,17.52 C 9.49,17.52 9.40,17.41 9.29,17.14 C 9.17,16.87 9.14,16.14 9.00,15.90 C 8.86,15.67 8.73,15.49 8.43,15.71 C 8.13,15.94 7.46,16.81 7.19,17.24 C 6.92,17.67 6.87,17.71 6.81,18.29 C 6.75,18.86 6.75,20.11 6.81,20.67 C 6.87,21.22 7.17,21.41 7.19,21.62 C 7.21,21.83 7.29,22.11 6.90,21.90 C 6.52,21.70 5.44,20.90 4.90,20.38 C 4.37,19.86 3.98,19.27 3.67,18.76 C 3.35,18.25 3.17,17.90 3.00,17.33 C 2.83,16.76 2.63,16.19 2.62,15.33 C 2.60,14.48 2.71,13.02 2.90,12.19 C 3.10,11.37 3.44,10.90 3.76,10.38 C 4.08,9.86 4.60,9.05 4.81,9.05 C 5.02,9.05 4.84,9.98 5.00,10.38 C 5.16,10.78 5.48,11.16 5.76,11.43 C 6.05,11.70 6.46,11.90 6.71,12.00 C 6.97,12.10 7.14,12.05 7.29,12.00 C 7.43,11.95 7.44,12.17 7.57,11.71 C 7.70,11.25 7.89,9.81 8.05,9.24 C 8.21,8.67 7.98,9.05 8.52,8.29 C 9.06,7.52 10.75,5.48 11.29,4.67 C 11.83,3.86 11.67,3.90 11.76,3.43 C 11.86,2.95 11.78,2.11 11.86,1.81 C 11.94,1.51 11.97,1.44 12.24,1.62 Z"/></svg>';
const MOMENT_ICON_MESSAGE =
  '<svg viewBox="0 0 24 24"><path d="M3.5 4.5h17v12h-9.2L6.5 20v-3.5h-3v-12z"/></svg>';
const MOMENT_ICON_SHARE =
  '<svg viewBox="0 0 24 24" class="icon-solid"><path fill-rule="evenodd" d="M 23.73,1.55 C 23.60,1.14 23.55,1.08 23.13,1.39 C 22.71,1.70 21.99,2.80 21.22,3.41 C 20.45,4.02 18.90,5.07 18.49,5.05 C 18.08,5.02 18.75,3.59 18.76,3.25 C 18.78,2.90 18.71,3.03 18.60,2.97 C 18.49,2.92 18.30,2.51 18.11,2.92 C 17.92,3.33 17.96,4.84 17.45,5.43 C 16.95,6.02 15.66,6.14 15.05,6.46 C 14.45,6.79 14.12,7.10 13.80,7.39 C 13.48,7.68 13.36,7.79 13.15,8.21 C 12.93,8.63 12.61,9.12 12.49,9.90 C 12.37,10.68 12.53,12.26 12.44,12.90 C 12.35,13.54 12.14,13.54 11.95,13.72 C 11.75,13.90 11.50,13.95 11.29,13.99 C 11.08,14.03 10.92,14.03 10.69,13.94 C 10.46,13.85 9.89,13.91 9.93,13.45 C 9.96,12.98 10.65,12.15 10.91,11.15 C 11.16,10.15 11.35,8.75 11.45,7.45 C 11.56,6.14 11.58,4.05 11.56,3.30 C 11.55,2.55 11.46,2.98 11.35,2.92 C 11.23,2.85 11.01,1.89 10.85,2.92 C 10.70,3.95 10.55,7.76 10.42,9.08 C 10.29,10.40 10.25,10.25 10.09,10.83 C 9.93,11.41 10.44,11.32 9.44,12.57 C 8.44,13.83 5.13,17.31 4.09,18.35 C 3.05,19.40 3.77,18.65 3.22,18.85 C 2.66,19.04 1.25,19.32 0.76,19.50 C 0.27,19.68 0.40,19.69 0.27,19.94 C 0.15,20.18 -0.01,20.65 0.00,20.97 C 0.01,21.29 0.18,21.62 0.33,21.85 C 0.47,22.07 0.62,22.21 0.87,22.34 C 1.13,22.46 0.85,22.58 1.85,22.61 C 2.86,22.64 5.25,22.89 6.93,22.50 C 8.60,22.11 10.48,20.69 11.89,20.26 C 13.30,19.84 14.52,20.10 15.38,19.94 C 16.25,19.77 16.71,19.48 17.07,19.28 C 17.44,19.08 17.42,19.03 17.56,18.74 C 17.71,18.45 17.90,17.95 17.95,17.54 C 17.99,17.13 17.98,16.86 17.84,16.28 C 17.69,15.70 16.87,14.50 17.07,14.05 C 17.27,13.59 18.56,13.72 19.04,13.55 C 19.51,13.39 19.60,13.36 19.91,13.06 C 20.22,12.76 20.68,12.19 20.89,11.75 C 21.10,11.32 20.89,10.89 21.16,10.45 C 21.44,10.00 22.21,9.58 22.53,9.08 C 22.85,8.58 23.00,7.95 23.07,7.45 C 23.15,6.95 22.83,6.67 22.96,6.08 C 23.10,5.49 23.76,4.65 23.89,3.90 C 24.02,3.15 23.85,1.97 23.73,1.55 Z M 16.20,14.26 C 16.29,14.30 16.36,14.44 16.42,14.75 C 16.48,15.08 16.42,15.20 16.58,15.35 C 16.75,15.52 17.00,15.55 17.02,16.55 C 17.05,17.42 16.90,18.14 16.42,18.68 C 15.98,19.10 15.55,19.02 14.18,19.12 C 13.86,19.16 13.85,18.88 13.85,17.75 C 13.90,17.10 14.02,16.99 14.29,16.28 C 14.35,16.10 14.40,16.12 14.51,15.85 C 14.71,15.60 14.85,15.35 14.95,15.25 C 15.30,14.90 15.85,14.44 16.20,14.26 Z M 23.07,2.92 C 23.39,2.92 22.92,4.27 22.75,4.77 C 22.34,5.55 21.75,6.34 21.27,6.68 C 20.42,7.15 18.34,7.90 17.73,8.15 C 17.20,8.44 16.43,8.79 16.58,8.86 C 16.81,9.24 17.00,9.62 17.07,9.57 C 17.55,9.15 17.90,8.92 18.11,8.92 C 18.90,8.55 19.85,8.31 20.40,8.21 C 21.20,7.75 21.96,7.05 22.20,7.12 C 22.44,7.32 21.82,8.59 21.82,8.59 C 21.35,9.20 20.52,9.85 19.58,10.23 C 18.65,10.65 17.40,10.72 17.40,10.72 C 16.55,11.02 16.15,11.20 16.15,11.32 C 15.92,11.53 16.03,11.70 16.20,11.97 C 16.39,12.10 16.64,12.03 16.64,12.03 C 17.20,11.71 17.85,11.36 20.24,10.99 C 20.62,11.20 20.10,11.55 19.96,11.70 C 19.75,12.05 19.25,12.46 19.25,12.46 C 18.50,12.85 17.30,12.85 15.93,13.45 C 15.24,13.74 14.61,14.36 14.35,14.59 C 13.95,14.97 13.53,15.53 13.15,16.88 C 12.93,18.02 13.33,18.75 12.93,19.23 C 12.53,19.70 11.75,19.32 10.75,19.72 C 9.75,20.12 8.43,21.29 6.93,21.63 C 5.43,21.96 2.74,21.80 1.75,21.74 C 0.98,21.55 0.98,21.25 0.98,21.25 C 0.85,20.90 1.20,20.26 1.20,20.26 C 1.65,20.10 3.10,19.80 3.65,19.61 C 4.03,19.42 3.58,20.03 4.53,19.12 C 5.47,18.21 8.37,14.89 9.33,14.15 C 10.28,13.42 9.96,14.58 10.25,14.70 C 10.72,14.86 11.07,14.86 11.07,14.86 C 11.63,14.63 12.08,14.63 12.38,14.48 C 12.68,14.34 12.87,13.99 12.87,13.99 C 13.30,13.30 13.16,10.97 13.31,10.17 C 13.45,9.37 13.72,8.84 14.13,8.32 C 14.54,7.80 14.95,7.49 15.76,7.06 C 16.58,6.64 18.19,6.14 19.04,5.75 C 19.88,5.37 20.16,5.25 20.84,4.77 C 21.51,4.30 22.75,2.92 23.07,2.92 Z"/></svg>';
const MOMENT_ICON_REPOST =
  '<svg viewBox="0 0 24 24" class="icon-solid"><path fill-rule="evenodd" d="M 20.20,9.80 L 16.67,11.82 L 19.97,17.91 L 16.31,17.95 L 16.21,16.85 L 15.66,16.53 L 11.68,19.97 L 12.00,20.61 L 15.66,23.59 L 16.21,23.27 L 16.26,22.21 L 20.24,22.21 L 21.11,21.94 L 21.85,21.16 L 23.91,17.45 L 23.82,16.03 Z M 12.41,20.06 L 15.53,17.45 L 15.62,18.41 L 15.89,18.60 L 22.58,18.55 L 21.25,20.89 L 20.75,21.39 L 20.20,21.57 L 15.76,21.57 L 15.57,21.80 L 15.57,22.67 Z M 17.54,11.95 L 19.74,10.67 L 20.02,10.63 L 23.27,16.40 L 23.31,17.13 L 22.95,17.63 L 22.21,17.91 L 20.79,17.95 L 17.50,12.23 Z M 1.24,11.40 L 1.10,12.09 L 2.02,12.78 L 0.18,15.94 L 0.00,17.18 L 2.47,21.62 L 3.71,22.21 L 10.76,22.12 L 10.72,17.95 L 3.98,17.86 L 5.77,14.79 L 6.64,15.30 L 7.28,15.02 L 6.37,9.89 L 5.73,9.66 Z M 2.75,20.34 L 2.98,19.60 L 3.66,18.55 L 10.26,18.64 L 10.21,21.57 L 3.76,21.57 L 3.21,21.39 L 2.93,21.11 Z M 5.77,10.35 L 6.60,14.43 L 5.73,14.02 L 5.31,14.20 L 2.15,19.83 L 0.64,17.08 L 0.73,16.31 L 2.84,12.60 L 2.75,12.32 L 1.97,11.86 Z M 11.50,9.34 L 11.13,9.48 L 10.81,9.94 L 10.81,11.73 L 8.70,11.91 L 8.38,12.37 L 8.38,13.60 L 8.61,13.97 L 9.02,14.15 L 10.76,14.15 L 10.81,15.98 L 10.99,16.35 L 11.40,16.58 L 12.60,16.58 L 12.96,16.35 L 13.15,15.98 L 13.15,14.20 L 14.93,14.15 L 15.34,13.97 L 15.57,13.60 L 15.57,12.37 L 15.07,11.82 L 13.24,11.82 L 13.15,9.94 L 13.01,9.66 L 12.64,9.39 Z M 11.59,9.98 L 12.50,10.08 L 12.50,12.23 L 12.64,12.41 L 14.93,12.50 L 14.89,13.47 L 12.55,13.60 L 12.41,15.94 L 11.54,15.94 L 11.45,15.80 L 11.45,13.69 L 11.31,13.51 L 9.02,13.42 L 9.07,12.46 L 11.22,12.46 L 11.45,12.27 L 11.45,10.12 Z M 4.81,7.88 L 8.43,9.98 L 12.00,3.80 L 13.88,7.10 L 13.01,7.69 L 12.92,8.29 L 17.95,10.17 L 18.37,9.48 L 19.15,4.90 L 18.64,4.49 L 17.59,5.04 L 15.44,1.24 L 14.70,0.55 L 9.66,0.41 L 8.56,1.19 Z M 10.03,1.05 L 10.67,1.47 L 11.59,3.16 L 8.29,9.02 L 8.06,9.21 L 5.59,7.74 L 9.11,1.56 L 9.48,1.19 Z M 11.27,1.01 L 14.20,1.05 L 14.56,1.24 L 17.22,5.73 L 17.54,5.82 L 18.41,5.40 L 17.68,9.48 L 13.83,8.02 L 14.66,7.42 L 14.66,7.15 L 11.18,1.10 Z"/></svg>';
const MOMENT_ICON_SAVE =
  '<svg viewBox="0 0 24 24"><path fill="none" d="M4,17 L4,20.5 L20,20.5 L20,17"/><path d="M11,3 L13,3 L13,9.5 L16.5,9.5 L12,15 L7.5,9.5 L11,9.5 Z"/></svg>';

// Brief press-feedback: fills the icon for a moment even for actions
// (message/share/repost) that aren't persistent toggle state, so every icon
// visually reacts the same way the like/save ones do.
function flashMomentAction(btn) {
  if (!btn) return;
  btn.classList.add("active");
  setTimeout(() => btn.classList.remove("active"), 420);
}

function wireMomentViewerActions(m) {
  const likeBtn = document.getElementById("moment-viewer-like");
  if (likeBtn) {
    likeBtn.addEventListener("click", async () => {
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      const nowLiked = !m.liked;
      m.liked = nowLiked;
      likeBtn.classList.toggle("active", nowLiked);
      try {
        await api("/api/moments/" + m.id + "/like", { method: nowLiked ? "POST" : "DELETE", auth: true });
      } catch (e) {
        m.liked = !nowLiked;
        likeBtn.classList.toggle("active", m.liked);
      }
    });
  }

  const saveBtn = document.getElementById("moment-viewer-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      const nowSaved = !m.saved;
      m.saved = nowSaved;
      saveBtn.classList.toggle("active", nowSaved);
      try {
        await api("/api/moments/" + m.id + "/save", { method: nowSaved ? "POST" : "DELETE", auth: true });
      } catch (e) {
        m.saved = !nowSaved;
        saveBtn.classList.toggle("active", m.saved);
      }
    });
  }

  const msgBtn = document.getElementById("moment-viewer-message");
  if (msgBtn) {
    msgBtn.addEventListener("click", () => {
      flashMomentAction(msgBtn);
      openMomentComments(m);
    });
  }

  const shareBtn = document.getElementById("moment-viewer-share");
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      flashMomentAction(shareBtn);
      const url = location.origin + "/#/profile/" + m.userId;
      try {
        if (navigator.share) {
          await navigator.share({ url, title: "HieloIce" });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          alert(I18N.t("moments.linkCopied") || "Link copied");
        }
      } catch (e) {}
    });
  }

  const repostBtn = document.getElementById("moment-viewer-repost");
  if (repostBtn) {
    repostBtn.addEventListener("click", async () => {
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      flashMomentAction(repostBtn);
      try {
        await api("/api/moments/" + m.id + "/repost", { method: "POST", auth: true });
        repostBtn.classList.add("active");
        setTimeout(() => repostBtn.classList.remove("active"), 1200);
      } catch (e) {
        alert(e.message);
      }
    });
  }
}

// ---- Moments story-viewer comments (public, threaded one level, like/reply
// pattern from Instagram/YouTube comments - opened via the message icon) ----
let momentCommentsState = null;

function timeAgoStr(ts) {
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return I18N.lang === "es" ? "ahora" : "now";
  if (min < 60) return min + (I18N.lang === "es" ? "m" : "m");
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h";
  const day = Math.floor(hr / 24);
  if (day < 7) return day + "d";
  const wk = Math.floor(day / 7);
  if (wk < 5) return wk + "w";
  return new Date(ts).toLocaleDateString();
}

function pauseMomentViewerPlayback() {
  if (momentViewerTimer) {
    clearTimeout(momentViewerTimer);
    momentViewerTimer = null;
  }
  const videoEl = document.getElementById("moment-viewer-media");
  if (videoEl && videoEl.tagName === "VIDEO") videoEl.pause();
}

function resumeMomentViewerPlayback() {
  const videoEl = document.getElementById("moment-viewer-media");
  if (videoEl && videoEl.tagName === "VIDEO") {
    videoEl.play().catch(() => {});
  } else {
    const duration = 5000;
    const fill = document.getElementById("progress-fill-" + (momentViewerState ? momentViewerState.index : 0));
    if (fill) {
      fill.style.transition = "width " + duration + "ms linear";
      fill.style.width = "100%";
    }
    momentViewerTimer = setTimeout(() => stepMomentViewer(1), duration);
  }
}

async function openMomentComments(m, overlayId, context) {
  overlayId = overlayId || "moment-viewer-overlay";
  context = context || "story";
  if (context === "shorts") pauseShortsPlayback();
  else pauseMomentViewerPlayback();
  momentCommentsState = { momentId: m.id, comments: [], replyTo: null, loading: true, context };
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  const panel = document.createElement("div");
  panel.className = "moment-comments-panel";
  panel.id = "moment-comments-panel";
  overlay.appendChild(panel);
  drawMomentComments();
  try {
    const rows = await api("/api/moments/" + m.id + "/comments");
    if (!momentCommentsState || momentCommentsState.momentId !== m.id) return;
    momentCommentsState.comments = rows;
    momentCommentsState.loading = false;
    drawMomentComments();
  } catch (e) {
    if (momentCommentsState) {
      momentCommentsState.loading = false;
      drawMomentComments();
    }
  }
}

function closeMomentComments() {
  const panel = document.getElementById("moment-comments-panel");
  if (panel) panel.remove();
  const context = momentCommentsState ? momentCommentsState.context : "story";
  momentCommentsState = null;
  if (context === "shorts") resumeShortsPlayback();
  else resumeMomentViewerPlayback();
}

function pauseShortsPlayback() {
  const videoEl = document.getElementById("shorts-video");
  if (videoEl) videoEl.pause();
}

function resumeShortsPlayback() {
  const videoEl = document.getElementById("shorts-video");
  if (videoEl) videoEl.play().catch(() => {});
}

function drawMomentComments() {
  const panel = document.getElementById("moment-comments-panel");
  if (!panel || !momentCommentsState) return;
  const { comments, loading, replyTo } = momentCommentsState;
  const topLevel = comments.filter((c) => !c.parentCommentId);
  const repliesOf = (id) => comments.filter((c) => c.parentCommentId === id);

  const commentRowHtml = (c, isReply) => `
    <div class="moment-comment-row ${isReply ? "is-reply" : ""}" data-cid="${c.id}">
      ${c.userPhoto ? `<img class="moment-comment-avatar" src="${c.userPhoto}" />` : `<div class="moment-comment-avatar moment-comment-avatar-placeholder">${initials(c.userName || "")}</div>`}
      <div class="moment-comment-body">
        <div class="moment-comment-meta"><span class="moment-comment-name">${escapeHtml(c.userName || "")}</span><span class="moment-comment-age">${timeAgoStr(c.createdAt)}</span></div>
        <div class="moment-comment-text">${escapeHtml(c.text)}</div>
        ${!isReply ? `<button class="moment-comment-reply-btn" data-reply-to="${c.id}" data-reply-name="${escapeHtml(c.userName || "")}">${I18N.t("moments.commentReply") || "Reply"}</button>` : ""}
      </div>
    </div>`;

  const listHtml = topLevel.length
    ? topLevel.map((c) => commentRowHtml(c, false) + repliesOf(c.id).map((r) => commentRowHtml(r, true)).join("")).join("")
    : loading
    ? `<div class="moment-comments-empty">${I18N.t("common.loading")}</div>`
    : `<div class="moment-comments-empty">${I18N.t("moments.commentsEmpty") || "No comments yet."}</div>`;

  panel.innerHTML = `
    <div class="moment-comments-backdrop" id="moment-comments-backdrop"></div>
    <div class="moment-comments-sheet">
      <div class="moment-comments-head">
        <span>${I18N.t("moments.commentsTitle") || "Comments"}</span>
        <button class="moment-comments-close" id="moment-comments-close">&times;</button>
      </div>
      <div class="moment-comments-list">${listHtml}</div>
      ${
        replyTo
          ? `<div class="moment-comment-replying-chip">${(I18N.t("moments.replyingTo") || "Replying to")} @${escapeHtml(replyTo.name)} <button id="moment-comment-cancel-reply">&times;</button></div>`
          : ""
      }
      <form class="moment-comments-input-row" id="moment-comments-form">
        <input type="text" id="moment-comments-input" maxlength="500" placeholder="${I18N.t("moments.commentPlaceholder") || "Add a comment..."}" ${state.token ? "" : "disabled"} />
        <button type="submit" ${state.token ? "" : "disabled"}>${I18N.t("messages.send")}</button>
      </form>
    </div>`;

  document.getElementById("moment-comments-backdrop").addEventListener("click", closeMomentComments);
  document.getElementById("moment-comments-close").addEventListener("click", closeMomentComments);
  panel.querySelectorAll(".moment-comment-reply-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      momentCommentsState.replyTo = { id: btn.dataset.replyTo, name: btn.dataset.replyName };
      drawMomentComments();
      const input = document.getElementById("moment-comments-input");
      if (input) input.focus();
    });
  });
  const cancelReplyBtn = document.getElementById("moment-comment-cancel-reply");
  if (cancelReplyBtn) {
    cancelReplyBtn.addEventListener("click", () => {
      momentCommentsState.replyTo = null;
      drawMomentComments();
    });
  }
  const form = document.getElementById("moment-comments-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      const input = document.getElementById("moment-comments-input");
      const text = (input.value || "").trim();
      if (!text) return;
      input.disabled = true;
      try {
        const created = await api("/api/moments/" + momentCommentsState.momentId + "/comments", {
          method: "POST",
          auth: true,
          body: { text, parentCommentId: momentCommentsState.replyTo ? momentCommentsState.replyTo.id : undefined },
        });
        momentCommentsState.comments.push(created);
        momentCommentsState.replyTo = null;
        drawMomentComments();
        const freshInput = document.getElementById("moment-comments-input");
        if (freshInput) freshInput.focus();
      } catch (err) {
        input.disabled = false;
        alert(err.message);
      }
    });
  }
}

function openMomentsViewer(moments, startIndex, group) {
  if (!moments || !moments.length) return;
  momentViewerState = { moments: moments.slice(), index: startIndex || 0, group, following: null, subStatus: null };
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
          momentViewerState.subStatus = st.status || (st.following ? "accepted" : "none");
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
  momentCommentsState = null;
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
        <button class="moment-viewer-head-link" id="moment-viewer-head-link" ${group && group.userId ? "" : "disabled"}>
          ${group && group.userPhoto ? `<img src="${group.userPhoto}" />` : ""}
          <span class="moment-viewer-head-name">${escapeHtml((group && group.userName) || "")}${group && group.isPage ? ` <span class="page-badge-inline">${I18N.t("pages.badge")}</span>` : ""}</span>
        </button>
        ${
          canFollow && momentViewerState.subStatus !== null
            ? `<button class="btn-follow-inline" id="moment-viewer-follow" ${momentViewerState.subStatus === "pending" ? "disabled" : ""}>${
                momentViewerState.subStatus === "accepted" ? I18N.t("subs.subscribed") : momentViewerState.subStatus === "pending" ? I18N.t("subs.pending") : I18N.t("subs.subscribe")
              }</button>`
            : ""
        }
        <button class="moment-viewer-close" id="moment-viewer-close">&times;</button>
      </div>
      ${
        m.mediaType === "video"
          ? `<video class="moment-viewer-media" id="moment-viewer-media" src="${m.mediaUrl}" autoplay playsinline></video>`
          : `<img class="moment-viewer-media" id="moment-viewer-media" src="${m.mediaUrl}" />`
      }
      ${m.caption ? `<div class="moment-viewer-caption">${linkifyHashtags(escapeHtml(m.caption))}</div>` : ""}
      ${isOwn ? `<button class="moment-viewer-delete" id="moment-viewer-delete">${I18N.t("moments.delete")}</button>` : ""}
      <button class="moment-viewer-nav prev" id="moment-viewer-prev"></button>
      <button class="moment-viewer-nav next" id="moment-viewer-next"></button>
      <div class="moment-viewer-actions">
        <button class="moment-viewer-action-btn like-btn ${m.liked ? "active" : ""}" id="moment-viewer-like" title="${I18N.t("moments.actionLike") || "Like"}">${MOMENT_ICON_HEART}</button>
        <button class="moment-viewer-action-btn" id="moment-viewer-message" title="${I18N.t("moments.actionMessage") || "Message"}">${MOMENT_ICON_MESSAGE}</button>
        <button class="moment-viewer-action-btn" id="moment-viewer-share" title="${I18N.t("moments.actionShare") || "Share"}">${MOMENT_ICON_SHARE}</button>
        <button class="moment-viewer-action-btn repost-btn" id="moment-viewer-repost" title="${I18N.t("moments.actionRepost") || "Repost"}">${MOMENT_ICON_REPOST}</button>
        <button class="moment-viewer-action-btn save-btn ${m.saved ? "active" : ""}" id="moment-viewer-save" title="${I18N.t("moments.actionSave") || "Save"}">${MOMENT_ICON_SAVE}</button>
      </div>
    </div>
  `;

  document.getElementById("moment-viewer-close").addEventListener("click", closeMomentsViewer);
  document.getElementById("moment-viewer-prev").addEventListener("click", () => stepMomentViewer(-1));
  document.getElementById("moment-viewer-next").addEventListener("click", () => stepMomentViewer(1));
  const headLink = document.getElementById("moment-viewer-head-link");
  if (headLink && !headLink.disabled) {
    headLink.addEventListener("click", () => {
      const uid = group && group.userId;
      if (!uid) return;
      closeMomentsViewer();
      location.hash = "#/profile/" + uid;
    });
  }
  wireMomentViewerActions(m);
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
        if (momentViewerState.subStatus === "accepted") {
          await api("/api/follow/" + group.userId, { method: "DELETE", auth: true });
          momentViewerState.subStatus = "none";
          momentViewerState.following = false;
        } else {
          const r = await api("/api/follow/" + group.userId, { method: "POST", auth: true });
          momentViewerState.subStatus = r.status || "pending";
          momentViewerState.following = momentViewerState.subStatus === "accepted";
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

  // ---- Vertical swipe navigation (TikTok/Reels style) ----
  // The current video visibly follows the finger as you drag, then either
  // completes the transition to the next/previous video on release or
  // snaps back if the swipe was too short. Replaces the old up/down arrow
  // buttons entirely - this is the only way to move between moments now.
  let touchStartY = null;
  let touchStartX = null;
  let dragging = false;
  let lockedAxis = null; // "y" | "x" | null - decided a few px into the gesture

  overlay.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
      dragging = true;
      lockedAxis = null;
      const item = overlay.querySelector(".shorts-item");
      if (item) item.style.transition = "none";
    },
    { passive: true }
  );

  overlay.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging || touchStartY === null) return;
      const dy = e.touches[0].clientY - touchStartY;
      const dx = e.touches[0].clientX - touchStartX;
      if (!lockedAxis) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        lockedAxis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
      }
      if (lockedAxis !== "y") return;
      e.preventDefault();
      const atFirst = shortsState.index === 0 && dy > 0;
      const atLast = shortsState.index === shortsState.videos.length - 1 && dy < 0;
      const damped = atFirst || atLast ? dy * 0.35 : dy;
      const item = overlay.querySelector(".shorts-item");
      if (item) item.style.transform = `translateY(${damped}px)`;
    },
    { passive: false }
  );

  overlay.addEventListener(
    "touchend",
    (e) => {
      if (!dragging || touchStartY === null) {
        dragging = false;
        return;
      }
      dragging = false;
      const dy = e.changedTouches[0].clientY - touchStartY;
      touchStartY = null;
      touchStartX = null;
      if (lockedAxis !== "y") return;
      const item = overlay.querySelector(".shorts-item");
      const THRESHOLD = 60;
      if (dy < -THRESHOLD) {
        stepShorts(1);
      } else if (dy > THRESHOLD) {
        stepShorts(-1);
      } else if (item) {
        item.style.transition = "transform 0.2s ease";
        item.style.transform = "translateY(0)";
      }
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
  if (btn) btn.classList.toggle("active", !!v.liked);
  if (countEl) countEl.textContent = v.likeCount || 0;
}

// Comment/share/repost/save for the Shorts player - mirrors
// wireMomentViewerActions() so both surfaces behave identically (optimistic
// toggle, revert on failure, same icon set and "active" styling).
function wireShortsActions(v) {
  const msgBtn = document.getElementById("shorts-message");
  if (msgBtn) {
    msgBtn.addEventListener("click", () => {
      flashMomentAction(msgBtn);
      openMomentComments(v, "shorts-overlay", "shorts");
    });
  }

  const shareBtn = document.getElementById("shorts-share");
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      flashMomentAction(shareBtn);
      const url = location.origin + "/#/profile/" + v.userId;
      try {
        if (navigator.share) {
          await navigator.share({ url, title: "HieloIce" });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          alert(I18N.t("moments.linkCopied") || "Link copied");
        }
      } catch (e) {}
    });
  }

  const repostBtn = document.getElementById("shorts-repost");
  if (repostBtn) {
    repostBtn.addEventListener("click", async () => {
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      flashMomentAction(repostBtn);
      try {
        await api("/api/moments/" + v.id + "/repost", { method: "POST", auth: true });
        repostBtn.classList.add("active");
        setTimeout(() => repostBtn.classList.remove("active"), 1200);
      } catch (e) {
        alert(e.message);
      }
    });
  }

  const saveBtn = document.getElementById("shorts-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      const nowSaved = !v.saved;
      v.saved = nowSaved;
      saveBtn.classList.toggle("active", nowSaved);
      try {
        await api("/api/moments/" + v.id + "/save", { method: nowSaved ? "POST" : "DELETE", auth: true });
      } catch (e) {
        v.saved = !nowSaved;
        saveBtn.classList.toggle("active", v.saved);
      }
    });
  }
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
        ${v.caption ? `<p class="shorts-caption">${linkifyHashtags(escapeHtml(v.caption))}</p>` : ""}
        ${showFollow ? `<button class="btn-follow-inline shorts-follow" id="shorts-follow">${I18N.t("subs.subscribe")}</button>` : ""}
      </div>
      <div class="shorts-actions-col">
        <div class="shorts-action">
          <button class="moment-viewer-action-btn like-btn ${v.liked ? "active" : ""}" id="shorts-like" title="${I18N.t("moments.actionLike") || "Like"}">${MOMENT_ICON_HEART}</button>
          <span class="shorts-action-count" id="shorts-like-count">${v.likeCount || 0}</span>
        </div>
        <div class="shorts-action">
          <button class="moment-viewer-action-btn" id="shorts-message" title="${I18N.t("moments.actionMessage") || "Message"}">${MOMENT_ICON_MESSAGE}</button>
        </div>
        <div class="shorts-action">
          <button class="moment-viewer-action-btn" id="shorts-share" title="${I18N.t("moments.actionShare") || "Share"}">${MOMENT_ICON_SHARE}</button>
        </div>
        <div class="shorts-action">
          <button class="moment-viewer-action-btn repost-btn" id="shorts-repost" title="${I18N.t("moments.actionRepost") || "Repost"}">${MOMENT_ICON_REPOST}</button>
        </div>
        <div class="shorts-action">
          <button class="moment-viewer-action-btn save-btn ${v.saved ? "active" : ""}" id="shorts-save" title="${I18N.t("moments.actionSave") || "Save"}">${MOMENT_ICON_SAVE}</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("shorts-close").addEventListener("click", closeShortsPlayer);
  document.getElementById("shorts-like").addEventListener("click", toggleShortsLike);
  wireShortsActions(v);

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
    const applyStatus = (status) => {
      followBtn.dataset.status = status;
      followBtn.disabled = status === "pending";
      followBtn.textContent = status === "accepted" ? I18N.t("subs.subscribed") : status === "pending" ? I18N.t("subs.pending") : I18N.t("subs.subscribe");
    };
    api("/api/follow/status/" + v.userId, { auth: true })
      .then((st) => applyStatus(st.status || (st.following ? "accepted" : "none")))
      .catch(() => {});
    followBtn.addEventListener("click", async () => {
      const status = followBtn.dataset.status;
      followBtn.disabled = true;
      try {
        if (status === "accepted") {
          await api("/api/follow/" + v.userId, { method: "DELETE", auth: true });
          applyStatus("none");
        } else {
          const r = await api("/api/follow/" + v.userId, { method: "POST", auth: true });
          applyStatus(r.status || "pending");
        }
      } catch (e) {
        alert(e.message);
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

// ---------------- Create wizard (nav "+" button: camera capture -> edit/filters -> caption+hashtags -> publish) ----------------
// A 3-step flow reached from the "+" icon in the nav bar, distinct from the
// simpler openMomentUploadModal() (file-picker only) used by the "add" badge
// on the stories bar. Captures live from the device camera when available
// (falls back to a file picker on desktops/denied permissions), lets the
// user preview one of a handful of CSS filters, then write a short caption
// (130 chars) plus hashtags before publishing through the same
// POST /api/moments endpoint the simpler modal uses.

const CREATE_WIZARD_FILTERS = [
  { id: "none", css: "" },
  { id: "bw", css: "grayscale(1)" },
  { id: "vivid", css: "saturate(1.6) contrast(1.15)" },
  { id: "warm", css: "sepia(0.35) saturate(1.2) hue-rotate(-8deg)" },
  { id: "cool", css: "saturate(1.05) contrast(1.05) hue-rotate(8deg) brightness(1.02)" },
  { id: "vintage", css: "sepia(0.4) contrast(0.9) brightness(1.05) saturate(0.85)" },
];

function createWizardFilterCss(id) {
  const f = CREATE_WIZARD_FILTERS.find((x) => x.id === id);
  return f ? f.css : "";
}

let createWizard = null;

function stopCreateWizardCamera() {
  if (createWizard && createWizard.stream) {
    createWizard.stream.getTracks().forEach((t) => t.stop());
    createWizard.stream = null;
  }
  if (createWizard && createWizard.recorder && createWizard.recorder.state !== "inactive") {
    try {
      createWizard.recorder.stop();
    } catch (e) {}
  }
}

function closeCreateWizard() {
  stopCreateWizardCamera();
  const overlay = document.getElementById("create-wizard-overlay");
  if (overlay) overlay.remove();
  createWizard = null;
}

function openCreateWizard() {
  if (!state.token) {
    location.hash = "#/login";
    return;
  }
  createWizard = { step: 1, filter: "none", mediaType: null, rawDataUrl: null, recording: false, stream: null, recorder: null, chunks: [], durationSeconds: null };
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay create-wizard-overlay";
  overlay.id = "create-wizard-overlay";
  document.body.appendChild(overlay);
  drawCreateWizard();
}

function createWizardFilterRow() {
  return `<div class="wizard-filter-row">${CREATE_WIZARD_FILTERS.map(
    (f) => `<button class="wizard-filter-swatch ${createWizard.filter === f.id ? "active" : ""}" data-filter="${f.id}" style="filter:${f.css};" title="${I18N.t("create.filter_" + f.id)}"></button>`
  ).join("")}</div>`;
}

function wireCreateWizardFilterRow(onChange) {
  document.querySelectorAll(".wizard-filter-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      createWizard.filter = btn.dataset.filter;
      onChange();
    });
  });
}

function drawCreateWizard() {
  const overlay = document.getElementById("create-wizard-overlay");
  if (!overlay || !createWizard) return;

  if (createWizard.step === 1) {
    overlay.innerHTML = `
      <div class="modal-box wizard-box">
        <h2 class="section-heading">${I18N.t("create.step1Title")}</h2>
        <div class="wizard-camera-wrap">
          <video id="wizard-camera-video" autoplay playsinline muted style="filter:${createWizardFilterCss(createWizard.filter)};"></video>
          <div class="wizard-camera-fallback" id="wizard-camera-fallback" style="display:none;">
            <p>${I18N.t("create.cameraUnavailable")}</p>
          </div>
        </div>
        ${createWizardFilterRow()}
        <div class="wizard-capture-row">
          <button class="btn btn-secondary" id="wizard-upload-photo-btn">${I18N.t("moments.uploadPhoto")}</button>
          <button class="btn wizard-capture-btn" id="wizard-capture-btn">${I18N.t("create.capturePhoto")}</button>
          <button class="btn btn-secondary" id="wizard-record-btn">${I18N.t("create.startVideo")}</button>
          <button class="btn btn-secondary" id="wizard-upload-video-btn">${I18N.t("create.uploadVideo")}</button>
        </div>
        <p class="field-hint" id="wizard-record-hint"></p>
        <input type="file" id="wizard-file-photo" accept="image/*" style="display:none;" />
        <input type="file" id="wizard-file-video" accept="video/*" style="display:none;" />
        <div class="action-row">
          <button class="btn btn-secondary" id="wizard-cancel">${I18N.t("common.cancel")}</button>
        </div>
      </div>
    `;

    const video = document.getElementById("wizard-camera-video");
    const fallback = document.getElementById("wizard-camera-fallback");
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: true })
        .then((stream) => {
          createWizard.stream = stream;
          video.srcObject = stream;
        })
        .catch(() => {
          video.style.display = "none";
          fallback.style.display = "block";
        });
    } else {
      video.style.display = "none";
      fallback.style.display = "block";
    }

    wireCreateWizardFilterRow(() => {
      if (video) video.style.filter = createWizardFilterCss(createWizard.filter);
    });

    document.getElementById("wizard-capture-btn").addEventListener("click", () => {
      if (!video || !video.srcObject) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      createWizard.rawDataUrl = canvas.toDataURL("image/jpeg", 0.92);
      createWizard.mediaType = "image";
      createWizard.step = 2;
      stopCreateWizardCamera();
      drawCreateWizard();
    });

    const recordBtn = document.getElementById("wizard-record-btn");
    const recordHint = document.getElementById("wizard-record-hint");
    recordBtn.addEventListener("click", () => {
      if (!createWizard.stream) return;
      if (!createWizard.recording) {
        createWizard.chunks = [];
        try {
          createWizard.recorder = new MediaRecorder(createWizard.stream);
        } catch (e) {
          alert(I18N.t("create.cameraUnavailable"));
          return;
        }
        createWizard.recorder.ondataavailable = (e) => {
          if (e.data && e.data.size) createWizard.chunks.push(e.data);
        };
        createWizard.recordStart = Date.now();
        createWizard.recorder.onstop = () => {
          const blob = new Blob(createWizard.chunks, { type: "video/webm" });
          createWizard.durationSeconds = (Date.now() - createWizard.recordStart) / 1000;
          const reader = new FileReader();
          reader.onload = () => {
            createWizard.rawDataUrl = reader.result;
            createWizard.mediaType = "video";
            createWizard.step = 2;
            stopCreateWizardCamera();
            drawCreateWizard();
          };
          reader.readAsDataURL(blob);
        };
        createWizard.recorder.start();
        createWizard.recording = true;
        recordBtn.textContent = I18N.t("create.stopVideo");
        recordHint.textContent = I18N.t("create.recordingHint");
      } else {
        createWizard.recording = false;
        if (createWizard.recorder) createWizard.recorder.stop();
      }
    });

    document.getElementById("wizard-upload-photo-btn").addEventListener("click", () => document.getElementById("wizard-file-photo").click());
    document.getElementById("wizard-upload-video-btn").addEventListener("click", () => document.getElementById("wizard-file-video").click());
    document.getElementById("wizard-file-photo").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        createWizard.rawDataUrl = reader.result;
        createWizard.mediaType = "image";
        createWizard.step = 2;
        stopCreateWizardCamera();
        drawCreateWizard();
      };
      reader.readAsDataURL(file);
    });
    document.getElementById("wizard-file-video").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const probe = document.createElement("video");
      probe.preload = "metadata";
      const objectUrl = URL.createObjectURL(file);
      probe.onloadedmetadata = () => {
        URL.revokeObjectURL(objectUrl);
        if (probe.duration && probe.duration > MAX_MOMENT_VIDEO_SECONDS) {
          alert(I18N.t("moments.videoTooLong"));
          return;
        }
        createWizard.durationSeconds = probe.duration || null;
        const reader = new FileReader();
        reader.onload = () => {
          createWizard.rawDataUrl = reader.result;
          createWizard.mediaType = "video";
          createWizard.step = 2;
          stopCreateWizardCamera();
          drawCreateWizard();
        };
        reader.readAsDataURL(file);
      };
      probe.src = objectUrl;
    });

    document.getElementById("wizard-cancel").addEventListener("click", closeCreateWizard);
    return;
  }

  if (createWizard.step === 2) {
    overlay.innerHTML = `
      <div class="modal-box wizard-box">
        <h2 class="section-heading">${I18N.t("create.step2Title")}</h2>
        <div class="wizard-preview-wrap">
          ${
            createWizard.mediaType === "video"
              ? `<video class="wizard-preview-media" src="${createWizard.rawDataUrl}" style="filter:${createWizardFilterCss(createWizard.filter)};" controls></video>`
              : `<img class="wizard-preview-media" id="wizard-preview-img" src="${createWizard.rawDataUrl}" style="filter:${createWizardFilterCss(createWizard.filter)};" />`
          }
        </div>
        ${createWizardFilterRow()}
        ${createWizard.mediaType === "video" ? `<p class="field-hint">${I18N.t("create.videoFilterHint")}</p>` : ""}
        <div class="action-row">
          <button class="btn btn-secondary" id="wizard-back">${I18N.t("create.back")}</button>
          <button class="btn btn-primary" id="wizard-next">${I18N.t("create.next")}</button>
        </div>
        <p style="text-align:center;margin-top:8px;"><a href="#" id="wizard-cancel2">${I18N.t("common.cancel")}</a></p>
      </div>
    `;
    document.getElementById("wizard-cancel2").addEventListener("click", (e) => {
      e.preventDefault();
      closeCreateWizard();
    });
    wireCreateWizardFilterRow(() => {
      const img = document.getElementById("wizard-preview-img");
      const vid = overlay.querySelector(".wizard-preview-media");
      if (img) img.style.filter = createWizardFilterCss(createWizard.filter);
      else if (vid) vid.style.filter = createWizardFilterCss(createWizard.filter);
    });
    document.getElementById("wizard-back").addEventListener("click", () => {
      createWizard.step = 1;
      createWizard.rawDataUrl = null;
      createWizard.mediaType = null;
      drawCreateWizard();
    });
    document.getElementById("wizard-next").addEventListener("click", () => {
      createWizard.step = 3;
      drawCreateWizard();
    });
    return;
  }

  // step 3: caption + hashtags + publish
  overlay.innerHTML = `
    <div class="modal-box wizard-box">
      <h2 class="section-heading">${I18N.t("create.step3Title")}</h2>
      <div class="wizard-preview-wrap wizard-preview-small">
        ${
          createWizard.mediaType === "video"
            ? `<video class="wizard-preview-media" src="${createWizard.rawDataUrl}" style="filter:${createWizardFilterCss(createWizard.filter)};" muted></video>`
            : `<img class="wizard-preview-media" src="${createWizard.rawDataUrl}" style="filter:${createWizardFilterCss(createWizard.filter)};" />`
        }
      </div>
      <div class="form-group">
        <label>${I18N.t("create.captionLabel")}</label>
        <textarea id="wizard-caption" rows="2" maxlength="130" placeholder="${I18N.t("create.captionPlaceholder")}"></textarea>
        <p class="field-hint"><span id="wizard-caption-count">0</span>/130</p>
      </div>
      <div class="form-group">
        <label>${I18N.t("create.hashtagsLabel")}</label>
        <input type="text" id="wizard-hashtags" placeholder="${I18N.t("create.hashtagsPlaceholder")}" />
      </div>
      <div class="action-row">
        <button class="btn btn-secondary" id="wizard-back2">${I18N.t("create.back")}</button>
        <button class="btn btn-primary" id="wizard-publish">${I18N.t("create.publish")}</button>
      </div>
      <p style="text-align:center;margin-top:8px;"><a href="#" id="wizard-cancel3">${I18N.t("common.cancel")}</a></p>
      <p class="form-msg" id="wizard-publish-msg"></p>
    </div>
  `;
  document.getElementById("wizard-cancel3").addEventListener("click", (e) => {
    e.preventDefault();
    closeCreateWizard();
  });

  const captionEl = document.getElementById("wizard-caption");
  const countEl = document.getElementById("wizard-caption-count");
  captionEl.addEventListener("input", () => {
    countEl.textContent = String(captionEl.value.length);
  });

  document.getElementById("wizard-back2").addEventListener("click", () => {
    createWizard.step = 2;
    drawCreateWizard();
  });

  document.getElementById("wizard-publish").addEventListener("click", async () => {
    const publishBtn = document.getElementById("wizard-publish");
    const msgEl = document.getElementById("wizard-publish-msg");
    publishBtn.disabled = true;
    msgEl.textContent = I18N.t("moments.uploading");
    msgEl.className = "form-msg";
    try {
      let finalMedia = createWizard.rawDataUrl;
      if (createWizard.mediaType === "image" && createWizard.filter !== "none") {
        finalMedia = await bakeImageFilter(createWizard.rawDataUrl, createWizardFilterCss(createWizard.filter));
      }
      const hashtagsRaw = document.getElementById("wizard-hashtags").value.trim();
      const hashtags = hashtagsRaw
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((h) => (h.startsWith("#") ? h : "#" + h))
        .join(" ");
      const captionText = captionEl.value.trim();
      const fullCaption = hashtags ? (captionText ? captionText + "\n" + hashtags : hashtags) : captionText;

      await api("/api/moments", {
        method: "POST",
        auth: true,
        body: {
          mediaType: createWizard.mediaType,
          media: finalMedia,
          caption: fullCaption,
          durationSeconds: createWizard.durationSeconds,
        },
      });
      msgEl.textContent = I18N.t("moments.posted");
      msgEl.className = "form-msg ok";
      setTimeout(() => {
        closeCreateWizard();
        router();
      }, 700);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
      publishBtn.disabled = false;
    }
  });
}

// Bakes a CSS filter string into an actual image (canvas 2D context supports
// .filter the same way CSS does), so the published photo really carries the
// chosen look instead of only looking filtered in the browser preview.
function bakeImageFilter(dataUrl, cssFilter) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.filter = cssFilter;
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Wraps #hashtag tokens in a highlighted span for display. Call on
// already-escaped text (escapeHtml first) since this only touches plain
// #word runs, which is safe post-escaping.
function linkifyHashtags(escapedText) {
  return escapedText.replace(/(^|\s)(#[\w]+)/g, '$1<span class="hashtag-token">$2</span>');
}

// ---------------- Profile ----------------

async function renderProfile(userId) {
  if (!userId) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("messages.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
    return;
  }
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;

  const isMe = state.user && state.user.id === userId;
  const wantsSocialStatus = !!(state.token && !isMe);

  // Everything fires in ONE parallel wave - including friend/follow/block
  // status, which previously waited for `profile` to resolve first (adding
  // a full extra round-trip of latency on top of the main 5 calls). Follow
  // status doesn't actually need to wait for profile.isPage - it's cheap to
  // just always ask and ignore the result if it turns out not to apply.
  const [profileRes, reviewsRes, productsRes, photosRes, momentsRes, friendRes, followRes, blockRes] =
    await Promise.allSettled([
      api("/api/users/" + userId),
      api("/api/users/" + userId + "/reviews"),
      api("/api/products?sellerId=" + encodeURIComponent(userId)),
      api("/api/users/" + userId + "/photos"),
      api("/api/moments/user/" + userId),
      wantsSocialStatus ? api("/api/friends/status/" + userId, { auth: true }) : Promise.resolve(null),
      wantsSocialStatus ? api("/api/follow/status/" + userId, { auth: true }) : Promise.resolve(null),
      wantsSocialStatus ? api("/api/users/" + userId + "/block-status", { auth: true }) : Promise.resolve(null),
    ]);

  const profile = profileRes.status === "fulfilled" ? profileRes.value : null;
  const reviews = reviewsRes.status === "fulfilled" ? reviewsRes.value : [];
  const products = productsRes.status === "fulfilled" ? productsRes.value : [];
  const photos = photosRes.status === "fulfilled" ? photosRes.value : [];
  const moments = momentsRes.status === "fulfilled" ? momentsRes.value : [];

  let friendStatus = null;
  let followStatus = null;
  let isBlocked = false;
  if (wantsSocialStatus) {
    if (friendRes.status === "fulfilled") friendStatus = friendRes.value;
    if (followRes.status === "fulfilled" && profile && profile.isPage) followStatus = followRes.value;
    if (blockRes.status === "fulfilled") isBlocked = !!(blockRes.value && blockRes.value.blocked);
  }

  if (!profile) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("messages.loginRequired")}</p>`;
    return;
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
        ${
          isMe
            ? `<div class="profile-cover-controls">
                <button class="profile-cover-icon-btn" id="btn-edit-cover" title="${I18N.t("profile.changeCover")}" aria-label="${I18N.t("profile.changeCover")}">\u{1F4F7}</button>
                ${profile.coverPhoto ? `<button class="profile-cover-icon-btn profile-cover-icon-btn-danger" id="btn-remove-cover" title="${I18N.t("profile.removeCover")}" aria-label="${I18N.t("profile.removeCover")}">\u{1F5D1}</button>` : ""}
              </div>
              <input type="file" id="cover-input" class="profile-cover-input" accept="image/*" />`
            : ""
        }
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
          ${!isMe && profile.isPage && !isBlocked ? pageFollowMarkup(followStatus) : ""}
          ${!isMe && !isBlocked ? friendActionMarkup(friendStatus) : ""}
          ${!isMe && state.token && !isBlocked ? `<a class="btn btn-primary" href="#/messages/${profile.id}">${I18N.t("profile.messageButton")}</a>` : ""}
          ${!isMe && state.token ? `<button class="btn btn-outline" id="btn-block-user" data-blocked="${isBlocked ? "1" : "0"}">${isBlocked ? I18N.t("profile.unblockUser") : I18N.t("profile.blockUser")}</button>` : ""}
        </div>
      </div>
    </div>

    ${isMe && profile.isPage ? `<div class="profile-about-card" id="subs-requests-card" style="display:none;"><h2 class="section-heading" style="margin-bottom:10px;">${I18N.t("subs.requestsHeading")}</h2><div id="subs-requests-list"></div></div>` : ""}

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
        ${isMe ? `<button class="tab-btn" data-tab="blocked">${I18N.t("profile.blockedTab")}</button>` : ""}
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
      ${isMe ? `<div id="tab-blocked" style="display:none;"></div>` : ""}
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
      ["listings", "photos", "reviews", "friends", "requests", "saved", "blocked", "offers", "notifications", "ads"].forEach((t) => {
        const el = document.getElementById("tab-" + t);
        if (el) el.style.display = t === btn.dataset.tab ? "block" : "none";
      });
      if (btn.dataset.tab === "friends" && isMe) await renderFriendsTab();
      if (btn.dataset.tab === "requests" && isMe) await renderRequestsTab();
      if (btn.dataset.tab === "saved" && isMe) await renderSavedTab();
      if (btn.dataset.tab === "blocked" && isMe) await renderBlockedTab();
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
            router();
          } catch (err) {
            alert(err.message);
          }
        };
        reader.readAsDataURL(file);
      });
    }
    const removeCoverBtn = document.getElementById("btn-remove-cover");
    if (removeCoverBtn) {
      removeCoverBtn.addEventListener("click", async () => {
        if (!confirm(I18N.t("profile.removeCover") + "?")) return;
        try {
          await api("/api/users/me", { method: "PUT", auth: true, body: { coverPhoto: "" } });
          router();
        } catch (err) {
          alert(err.message);
        }
      });
    }
    if (profile.isPage) loadSubsRequests();
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

    const blockBtn = document.getElementById("btn-block-user");
    if (blockBtn) {
      blockBtn.addEventListener("click", async () => {
        const currentlyBlocked = blockBtn.dataset.blocked === "1";
        const confirmMsg = currentlyBlocked ? I18N.t("profile.confirmUnblock") : I18N.t("profile.confirmBlock");
        if (!confirm(confirmMsg)) return;
        try {
          await api("/api/users/" + profile.id + (currentlyBlocked ? "/unblock" : "/block"), { method: "POST", auth: true });
          router();
        } catch (err) {
          alert(err.message);
        }
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

// Web Push has no way to attach a custom sound file to a system
// notification, so while the app is open in the foreground (where the OS
// stays silent for the notification itself) we play our own short two-tone
// chime for incoming chat messages specifically, so they're recognizable
// without opening the tab. sw.js posts this message to every open client
// the moment a push with type:"message" arrives.
function playMessageChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.25, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.32);
    });
  } catch (e) {}
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.kind === "push-received" && event.data.type === "message") {
      playMessageChime();
    }
  });
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

  const prefs = Object.assign({ offers: true, flashSales: true, newProducts: true, reminders: true, messages: true }, data.prefs || {});
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
          <label class="notif-cat-row"><input type="checkbox" id="notif-messages" ${prefs.messages ? "checked" : ""} /> ${I18N.t("notif.catMessages")}</label>
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
        messages: document.getElementById("notif-messages").checked,
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

async function renderBlockedTab() {
  const el = document.getElementById("tab-blocked");
  if (!el) return;
  el.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  let items = [];
  try {
    items = await api("/api/users/blocked", { auth: true });
  } catch (e) {}
  if (!items.length) {
    el.innerHTML = `<div class="empty-state">${I18N.t("profile.blockedEmpty")}</div>`;
    return;
  }
  el.innerHTML = items
    .map(
      (u) => `
    <div class="blocked-user-row" data-user-id="${u.userId}">
      ${u.photo ? `<img class="blocked-user-avatar" src="${u.photo}" />` : `<div class="blocked-user-avatar-placeholder">${initials(u.name)}</div>`}
      <span class="blocked-user-name">${escapeHtml(u.name)}</span>
      <button class="btn btn-outline btn-sm btn-unblock" data-user-id="${u.userId}">${I18N.t("profile.unblockUser")}</button>
    </div>`
    )
    .join("");
  el.querySelectorAll(".btn-unblock").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(I18N.t("profile.confirmUnblock"))) return;
      try {
        await api("/api/users/" + btn.dataset.userId + "/unblock", { method: "POST", auth: true });
        await renderBlockedTab();
      } catch (err) {
        alert(err.message);
      }
    });
  });
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
      <div class="form-group" id="edit-subscription-mode-wrap" style="display:${profile.isPage ? "block" : "none"};">
        <label>${I18N.t("subs.modeLabel")}</label>
        <select id="edit-subscription-mode">
          <option value="manual" ${profile.subscriptionMode !== "auto" ? "selected" : ""}>${I18N.t("subs.modeManual")}</option>
          <option value="auto" ${profile.subscriptionMode === "auto" ? "selected" : ""}>${I18N.t("subs.modeAuto")}</option>
        </select>
        <p class="field-hint">${I18N.t("subs.modeHint")}</p>
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
    document.getElementById("edit-subscription-mode-wrap").style.display = e.target.checked ? "block" : "none";
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
          subscriptionMode: document.getElementById("edit-subscription-mode").value,
        },
      });
      state.user = { ...state.user, ...data.user };
      localStorage.setItem("authUser", JSON.stringify(state.user));
      applyUserTheme(state.user);
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

// ---------------- Admin panel ----------------

function isAdminUser() {
  return !!(state.user && (state.user.role === "admin" || state.user.isOwner));
}

function adminTabsMarkup(active) {
  const tabs = [
    { key: "reports", label: I18N.t("admin.tabReports") },
    { key: "products", label: I18N.t("admin.tabProducts") },
    { key: "users", label: I18N.t("admin.tabUsers") },
  ];
  return `<div class="admin-tabs">${tabs
    .map((t) => `<a href="#/admin/${t.key}" class="admin-tab${active === t.key ? " active" : ""}">${t.label}</a>`)
    .join("")}</div>`;
}

async function renderAdminPanel(section) {
  section = section || "reports";
  if (!isAdminUser()) {
    viewEl.innerHTML = `<p class="form-msg error">${I18N.t("admin.notAuthorized")}</p>`;
    return;
  }
  viewEl.innerHTML = `
    <h2 class="section-heading">${I18N.t("admin.title")}</h2>
    ${adminTabsMarkup(section)}
    <div id="admin-content"><p>${I18N.t("common.loading")}</p></div>
  `;
  if (section === "users") return renderAdminUsers();
  if (section === "products") return renderAdminProducts();
  return renderAdminReports();
}

async function renderAdminReports() {
  const content = document.getElementById("admin-content");
  let reports;
  try {
    reports = await api("/api/admin/reports?status=open", { auth: true });
  } catch (e) {
    content.innerHTML = `<p class="form-msg error">${escapeHtml(e.message)}</p>`;
    return;
  }
  content.innerHTML = reports.length
    ? `<div class="intl-admin-list">${reports
        .map(
          (r) => `
      <div class="intl-admin-row">
        <div class="intl-card-head">
          <span class="intl-role-tag">${escapeHtml(r.targetType)}</span>
          <span class="intl-role-tag">${escapeHtml(r.reason)}</span>
        </div>
        <p class="intl-card-name">${escapeHtml(r.targetLabel)}</p>
        <p class="intl-card-meta">${I18N.t("admin.reportedBy")}: ${escapeHtml(r.reporterName)} &middot; ${fmtDate(r.createdAt)}</p>
        ${r.description ? `<p style="font-size:13px;color:#555;">${escapeHtml(r.description)}</p>` : ""}
        <div class="form-group">
          <label>${I18N.t("admin.resolutionNote")}</label>
          <textarea rows="2" data-note="${r.id}"></textarea>
        </div>
        <div class="form-row" style="align-items:flex-end;flex-wrap:wrap;gap:8px;">
          <button class="btn btn-primary" data-resolve="${r.id}">${I18N.t("admin.resolve")}</button>
          <button class="btn" data-dismiss="${r.id}">${I18N.t("admin.dismiss")}</button>
          <a class="btn" href="#/${r.targetType === "product" ? "product" : "profile"}/${r.targetId}" target="_blank">${I18N.t("admin.viewTarget")}</a>
        </div>
      </div>`
        )
        .join("")}</div>`
    : `<div class="empty-state">${I18N.t("admin.reportsEmpty")}</div>`;

  async function setReportStatus(id, status) {
    const note = document.querySelector(`[data-note="${id}"]`);
    try {
      await api("/api/admin/reports/" + id, { method: "PUT", auth: true, body: { status, resolutionNote: note ? note.value : "" } });
      renderAdminReports();
    } catch (e) {
      alert(e.message);
    }
  }
  document.querySelectorAll("[data-resolve]").forEach((btn) => {
    btn.addEventListener("click", () => setReportStatus(btn.dataset.resolve, "resolved"));
  });
  document.querySelectorAll("[data-dismiss]").forEach((btn) => {
    btn.addEventListener("click", () => setReportStatus(btn.dataset.dismiss, "dismissed"));
  });
}

async function renderAdminProducts() {
  const content = document.getElementById("admin-content");
  content.innerHTML = `
    <div class="admin-search-bar">
      <input type="text" id="admin-product-search" placeholder="${I18N.t("admin.searchProductsPlaceholder")}" />
      <button class="btn" id="admin-product-search-btn">${I18N.t("common.search")}</button>
    </div>
    <div id="admin-products-list"><p>${I18N.t("common.loading")}</p></div>
  `;

  async function load(q) {
    const list = document.getElementById("admin-products-list");
    list.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
    let rows;
    try {
      rows = await api("/api/admin/products" + (q ? "?q=" + encodeURIComponent(q) : ""), { auth: true });
    } catch (e) {
      list.innerHTML = `<p class="form-msg error">${escapeHtml(e.message)}</p>`;
      return;
    }
    list.innerHTML = rows.length
      ? `<div class="intl-admin-list">${rows
          .map(
            (p) => `
        <div class="intl-admin-row">
          <div class="intl-card-head">
            <span class="intl-role-tag">${escapeHtml(p.category)}</span>
            <span class="intl-role-tag">${escapeHtml(p.status)}</span>
            ${p.flagged ? `<span class="intl-role-tag admin-badge-danger">${I18N.t("admin.flagged")}</span>` : ""}
          </div>
          <p class="intl-card-name">${escapeHtml(p.title)} &middot; ${fmtPrice(p.price)}</p>
          <p class="intl-card-meta">${I18N.t("admin.seller")}: ${escapeHtml(p.sellerName)} (${escapeHtml(p.sellerEmail)})</p>
          <div class="form-row" style="align-items:flex-end;flex-wrap:wrap;gap:8px;">
            <a class="btn" href="#/product/${p.id}" target="_blank">${I18N.t("admin.viewTarget")}</a>
            <a class="btn" href="#/edit/${p.id}" target="_blank">${I18N.t("product.editListing")}</a>
            <button class="btn btn-danger" data-delete-product="${p.id}">${I18N.t("common.delete")}</button>
          </div>
        </div>`
          )
          .join("")}</div>`
      : `<div class="empty-state">${I18N.t("admin.noResults")}</div>`;

    document.querySelectorAll("[data-delete-product]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(I18N.t("admin.confirmDeleteProduct"))) return;
        try {
          await api("/api/admin/products/" + btn.dataset.deleteProduct, { method: "DELETE", auth: true });
          load(document.getElementById("admin-product-search").value.trim());
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }

  document.getElementById("admin-product-search-btn").addEventListener("click", () => {
    load(document.getElementById("admin-product-search").value.trim());
  });
  document.getElementById("admin-product-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") load(e.target.value.trim());
  });
  load("");
}

async function renderAdminUsers() {
  const content = document.getElementById("admin-content");
  content.innerHTML = `
    <div class="admin-search-bar">
      <input type="text" id="admin-user-search" placeholder="${I18N.t("admin.searchUsersPlaceholder")}" />
      <button class="btn" id="admin-user-search-btn">${I18N.t("common.search")}</button>
    </div>
    <div id="admin-users-list"><p>${I18N.t("common.loading")}</p></div>
  `;

  async function load(q) {
    const list = document.getElementById("admin-users-list");
    list.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
    let rows;
    try {
      rows = await api("/api/admin/users" + (q ? "?q=" + encodeURIComponent(q) : ""), { auth: true });
    } catch (e) {
      list.innerHTML = `<p class="form-msg error">${escapeHtml(e.message)}</p>`;
      return;
    }
    list.innerHTML = rows.length
      ? `<div class="intl-admin-list">${rows
          .map(
            (u) => `
        <div class="intl-admin-row">
          <div class="intl-card-head">
            <span class="intl-role-tag">${escapeHtml(u.role)}</span>
            ${u.suspended ? `<span class="intl-role-tag admin-badge-danger">${I18N.t("admin.suspended")}</span>` : ""}
            ${u.flagged ? `<span class="intl-role-tag admin-badge-warn">${I18N.t("admin.flagged")}</span>` : ""}
          </div>
          <p class="intl-card-name">${escapeHtml(u.name)}</p>
          <p class="intl-card-meta">${escapeHtml(u.email)}${u.phone ? " &middot; " + escapeHtml(u.phone) : ""}</p>
          ${u.suspended && u.suspendedReason ? `<p style="font-size:13px;color:#9c1f1f;">${I18N.t("admin.suspendedReason")}: ${escapeHtml(u.suspendedReason)}</p>` : ""}
          <div class="form-row" style="align-items:flex-end;flex-wrap:wrap;gap:8px;">
            <div class="form-group" style="min-width:140px;">
              <label>${I18N.t("admin.role")}</label>
              <select data-role="${u.id}">
                <option value="user"${u.role === "user" ? " selected" : ""}>user</option>
                <option value="support"${u.role === "support" ? " selected" : ""}>support</option>
                <option value="moderator"${u.role === "moderator" ? " selected" : ""}>moderator</option>
                <option value="admin"${u.role === "admin" ? " selected" : ""}>admin</option>
              </select>
            </div>
            <button class="btn btn-primary" data-save-role="${u.id}">${I18N.t("admin.saveRole")}</button>
            <a class="btn" href="#/profile/${u.id}" target="_blank">${I18N.t("admin.viewTarget")}</a>
            ${
              u.suspended
                ? `<button class="btn" data-reactivate="${u.id}">${I18N.t("admin.reactivate")}</button>`
                : `<button class="btn btn-danger" data-suspend="${u.id}">${I18N.t("admin.suspend")}</button>`
            }
          </div>
        </div>`
          )
          .join("")}</div>`
      : `<div class="empty-state">${I18N.t("admin.noResults")}</div>`;

    document.querySelectorAll("[data-save-role]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.saveRole;
        const role = document.querySelector(`[data-role="${id}"]`).value;
        try {
          await api("/api/admin/users/" + id, { method: "PUT", auth: true, body: { role } });
          load(document.getElementById("admin-user-search").value.trim());
        } catch (e) {
          alert(e.message);
        }
      });
    });
    document.querySelectorAll("[data-suspend]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.suspend;
        const reason = prompt(I18N.t("admin.suspendReasonPrompt")) || "";
        try {
          await api("/api/admin/users/" + id, { method: "PUT", auth: true, body: { suspended: true, suspendedReason: reason } });
          load(document.getElementById("admin-user-search").value.trim());
        } catch (e) {
          alert(e.message);
        }
      });
    });
    document.querySelectorAll("[data-reactivate]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.reactivate;
        try {
          await api("/api/admin/users/" + id, { method: "PUT", auth: true, body: { suspended: false } });
          load(document.getElementById("admin-user-search").value.trim());
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }

  document.getElementById("admin-user-search-btn").addEventListener("click", () => {
    load(document.getElementById("admin-user-search").value.trim());
  });
  document.getElementById("admin-user-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") load(e.target.value.trim());
  });
  load("");
}

// ---------------- Init ----------------

applyStaticI18n();
updateNavUI();
refreshMe().then(router);
router();
pollUnread();
unreadPollTimer = setInterval(pollUnread, 20000);
registerServiceWorker();
