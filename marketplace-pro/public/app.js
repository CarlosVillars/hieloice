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

function safeParseStoredUser() {
  // If a stale/corrupted value ever ends up in localStorage under
  // "authUser" (e.g. leftover from an older app version), an unguarded
  // JSON.parse() throws synchronously at script load time and silently
  // aborts the ENTIRE app.js execution - every click handler wired further
  // down (including the "+" create button and the Marketplace dropdown)
  // simply never gets attached, with no visible error to the user. Clearing
  // browser cache/cookies does NOT clear localStorage, so that bug survives
  // a cache clear. Guard against it here so a bad value just logs the user
  // out instead of breaking the whole page.
  try {
    return JSON.parse(localStorage.getItem("authUser") || "null");
  } catch (e) {
    localStorage.removeItem("authUser");
    localStorage.removeItem("authToken");
    return null;
  }
}

const state = {
  token: localStorage.getItem("authToken") || null,
  user: safeParseStoredUser(),
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

// Automatic, free, client-side photo "cleanup" for listing photos: an
// auto-levels contrast/brightness stretch (per RGB channel, clipped at the
// 1st/99th percentile) that fixes the most common problem with phone
// snapshots of a book - dim, washed-out, or slightly yellow-tinted lighting.
// This runs entirely in the browser with no AI/paid API involved, so it's
// applied automatically to every photo with no extra cost or user action.
// It is not full AI photo editing (no background removal/retouching) - that
// would require a separate paid image-editing service.
function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
function autoEnhanceImage(dataUrl) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          if (!canvas.width || !canvas.height) return resolve(dataUrl);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          const histR = new Array(256).fill(0);
          const histG = new Array(256).fill(0);
          const histB = new Array(256).fill(0);
          for (let i = 0; i < data.length; i += 4) {
            histR[data[i]]++;
            histG[data[i + 1]]++;
            histB[data[i + 2]]++;
          }
          const total = data.length / 4;
          function bounds(hist) {
            const cut = total * 0.01;
            let sum = 0, lo = 0, hi = 255;
            for (let v = 0; v < 256; v++) {
              sum += hist[v];
              if (sum >= cut) { lo = v; break; }
            }
            sum = 0;
            for (let v = 255; v >= 0; v--) {
              sum += hist[v];
              if (sum >= cut) { hi = v; break; }
            }
            if (hi <= lo) hi = lo + 1;
            return [lo, hi];
          }
          const [rLo, rHi] = bounds(histR);
          const [gLo, gHi] = bounds(histG);
          const [bLo, bHi] = bounds(histB);
          for (let i = 0; i < data.length; i += 4) {
            data[i] = clamp255(((data[i] - rLo) / (rHi - rLo)) * 255);
            data[i + 1] = clamp255(((data[i + 1] - gLo) / (gHi - gLo)) * 255);
            data[i + 2] = clamp255(((data[i + 2] - bLo) / (bHi - bLo)) * 255);
          }
          ctx.putImageData(imgData, 0, 0);
          resolve(canvas.toDataURL("image/jpeg", 0.9));
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch (e) {
      resolve(dataUrl);
    }
  });
}

// Small reusable "coming soon" / status toast, shown bottom-center for a
// couple seconds then removed - used by nav features that aren't built yet.
function showAppToast(msg) {
  const existing = document.getElementById("app-toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "app-toast";
  el.className = "app-toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
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
  // Task #234 - the chat WebSocket is app-wide (live typing/presence/message
  // delivery need to work even when #/messages isn't the open route), so it
  // opens/closes on login/logout rather than only when a thread is open.
  // See connectChatSocket()/disconnectChatSocket() further down.
  if (token) connectChatSocket();
  else disconnectChatSocket();
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

function setDisplay(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.display = value;
}

function updateNavUI() {
  const loggedIn = !!state.token;
  setDisplay("nav-login", loggedIn ? "none" : "inline");
  setDisplay("nav-register", loggedIn ? "none" : "inline");
  setDisplay("nav-logout", loggedIn ? "inline" : "none");
  setDisplay("nav-profile", loggedIn ? "inline" : "none");
  setDisplay("nav-messages", loggedIn ? "inline" : "none");
  setDisplay("nav-notifications", loggedIn ? "inline" : "none");
  const navAdmin = document.getElementById("nav-admin");
  if (navAdmin) {
    const canAdmin = loggedIn && state.user && (state.user.role === "admin" || state.user.isOwner);
    navAdmin.style.display = canAdmin ? "inline" : "none";
  }
  // The bottom/top icon bar stays visible for guests too (not just logged-in
  // users) so a first-time visitor can still find Marketplace, International
  // and Communities - those live inside the Marketplace dropdown. Only the
  // items that require an account (Friends, Moments/Clips, Create) are
  // hidden until the person logs in. Notifications moved into the top
  // Profile/Messages row (task #237) and is hidden/shown there instead.
  const iconNav = document.getElementById("icon-nav");
  if (iconNav) iconNav.style.display = "flex";
  setDisplay("icon-nav-friends", loggedIn ? "flex" : "none");
  setDisplay("icon-nav-clips", loggedIn ? "flex" : "none");
  const createWrap = document.getElementById("icon-nav-create");
  if (createWrap) createWrap.style.display = loggedIn ? "flex" : "none";
  if (!loggedIn) {
    setUnreadBadge(0);
    setIconNavBadge(0);
  }
}

const navLogoutBtn = document.getElementById("nav-logout");
if (navLogoutBtn) {
  navLogoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST", auth: true });
    } catch (e) {}
    setAuth(null, null);
    location.hash = "#/";
  });
}

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
  setText("brand-tagline", I18N.t("site.tagline"));
  updateGlobalSearchPlaceholder();
  setText("nav-messages", I18N.t("nav.messages"));
  setText("nav-profile", I18N.t("nav.profile"));
  const navNotifEl = document.getElementById("nav-notifications");
  if (navNotifEl) {
    const notifLabel = I18N.t("iconnav.notifications");
    navNotifEl.title = notifLabel;
    navNotifEl.setAttribute("aria-label", notifLabel);
  }
  setText("nav-post", I18N.t("nav.postAd"));
  setText("nav-login", I18N.t("nav.login"));
  setText("nav-register", I18N.t("nav.register"));
  setText("nav-logout", I18N.t("nav.logout"));
  const langEnBtnEl = document.getElementById("lang-en");
  if (langEnBtnEl) langEnBtnEl.classList.toggle("active", I18N.lang === "en");
  const langEsBtnEl = document.getElementById("lang-es");
  if (langEsBtnEl) langEsBtnEl.classList.toggle("active", I18N.lang === "es");
  setText("icon-nav-home-label", I18N.t("iconnav.home"));
  setText("icon-nav-friends-label", I18N.t("iconnav.friends"));
  setText("icon-nav-clips-label", I18N.t("iconnav.clips"));
  setText("icon-nav-marketplace-label", I18N.t("iconnav.marketplace"));
  setText("icon-nav-dropdown-marketplace", "🛒 " + I18N.t("iconnav.dropdownMarketplace"));
  setText("icon-nav-dropdown-intl", "🌎 " + I18N.t("iconnav.dropdownIntl"));
  setText("icon-nav-dropdown-groups", "💬 " + I18N.t("iconnav.dropdownGroups"));
  setText("icon-nav-create-label", I18N.t("iconnav.create"));
  setText("icon-nav-create-camera-label", I18N.t("iconnav.createCamera"));
  setText("icon-nav-create-record-label", I18N.t("iconnav.createRecord"));
  setText("icon-nav-create-upload-moment-label", I18N.t("iconnav.createUploadMoment"));
  setText("icon-nav-create-upload-picture-label", I18N.t("iconnav.createUploadPicture"));
  setText("icon-nav-create-loop-label", I18N.t("iconnav.createLoop"));
  setText("icon-nav-create-video-label", I18N.t("iconnav.createVideo"));
  setText("icon-nav-create-product-label", I18N.t("iconnav.createProduct"));
  setText("icon-nav-books-sell-label", I18N.t("iconnav.booksSell"));
  setText("icon-nav-book-club-label", I18N.t("iconnav.bookClub"));
  setText("icon-nav-videos-label", I18N.t("iconnav.dropdownVideos"));
  setText("icon-nav-dropdown-soon-label", I18N.t("iconnav.comingSoon"));
  setText("icon-nav-books-exchange-label", I18N.t("iconnav.booksExchange"));
  setText("icon-nav-books-recommend-label", I18N.t("iconnav.booksRecommend"));
  setText("icon-nav-books-auction-label", I18N.t("iconnav.booksAuction"));
  setText("icon-nav-books-exchange-soon", I18N.t("iconnav.booksSoonTag"));
  setText("icon-nav-books-recommend-soon", I18N.t("iconnav.booksSoonTag"));
  setText("icon-nav-books-auction-soon", I18N.t("iconnav.booksSoonTag"));
}

const langEnBtn = document.getElementById("lang-en");
if (langEnBtn) {
  langEnBtn.addEventListener("click", () => {
    I18N.setLang("en");
    applyStaticI18n();
    router();
  });
}
const langEsBtn = document.getElementById("lang-es");
if (langEsBtn) {
  langEsBtn.addEventListener("click", () => {
    I18N.setLang("es");
    applyStaticI18n();
    router();
  });
}

// Normal-tier dark mode toggle (hidden for premium accounts - see
// applyUserTheme()). Clicking these when hidden is harmless since the
// wrapper is display:none for premium users.
const themeNormalLightBtn = document.getElementById("theme-normal-light");
if (themeNormalLightBtn) {
  themeNormalLightBtn.addEventListener("click", () => applyNormalThemePref("light"));
}
const themeNormalDarkBtn = document.getElementById("theme-normal-dark");
if (themeNormalDarkBtn) {
  themeNormalDarkBtn.addEventListener("click", () => applyNormalThemePref("dark"));
}

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

const globalSearchBtn = document.getElementById("global-search-btn");
if (globalSearchBtn) globalSearchBtn.addEventListener("click", doGlobalSearch);
const globalSearchInput = document.getElementById("global-search");
if (globalSearchInput) {
  globalSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doGlobalSearch();
  });
}
const globalSearchScanBtn = document.getElementById("global-search-scan-btn");
if (globalSearchScanBtn) {
  globalSearchScanBtn.addEventListener("click", () => {
    openBarcodeScanner((code) => {
      const searchInput = document.getElementById("global-search");
      if (searchInput) searchInput.value = code;
      doGlobalSearch();
    });
  });
}
function doGlobalSearch() {
  const searchInput = document.getElementById("global-search");
  const q = searchInput ? searchInput.value.trim() : "";
  location.hash = "#/category/all" + (q ? "?q=" + encodeURIComponent(q) : "");
}

// One physical search bar in the topbar, everywhere - only its placeholder
// text changes depending on the section, instead of duplicating a second
// search bar inside Marketplace. "Books section" = anywhere browsing/buying/
// selling books; everywhere else keeps the general people/books placeholder.
const BOOKS_SECTION_ROUTES = ["marketplace", "category", "product", "post", "edit"];
function updateGlobalSearchPlaceholder() {
  const searchEl = document.getElementById("global-search");
  if (!searchEl) return;
  const { parts } = parseHash();
  const inBooksSection = BOOKS_SECTION_ROUTES.includes(parts[0]);
  searchEl.placeholder = I18N.t(inBooksSection ? "home.searchPlaceholder" : "topbar.searchPlaceholder");
}

// ---------------- Icon nav (Home / Friends / Marketplace / Notifications) ----------------

(function wireIconNav() {
  const marketplaceBtn = document.getElementById("icon-nav-marketplace");
  const dropdown = document.getElementById("icon-nav-marketplace-dropdown");
  const createBtn = document.getElementById("icon-nav-create");
  const createDropdown = document.getElementById("icon-nav-create-dropdown");
  const allDropdowns = [dropdown, createDropdown];
  function closeAllDropdowns(except) {
    allDropdowns.forEach((d) => {
      if (d && d !== except) d.style.display = "none";
    });
  }
  if (marketplaceBtn && dropdown) {
    marketplaceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = dropdown.style.display !== "block";
      closeAllDropdowns();
      dropdown.style.display = willOpen ? "block" : "none";
      const icon = marketplaceBtn.querySelector(".icon-nav-cartbooks");
      if (icon) {
        icon.classList.remove("pop");
        void icon.offsetWidth; // restart the animation even on rapid re-clicks
        icon.classList.add("pop");
      }
    });
    dropdown.addEventListener("click", (e) => e.stopPropagation());
    // Vender/Publicar close and navigate normally; Exchange/Recommend/Auction
    // are on the roadmap but not built yet - show a friendly "coming soon"
    // toast instead of a dead link.
    ["exchange", "recommend", "auction"].forEach((key) => {
      const link = document.getElementById("icon-nav-books-" + key);
      if (link) {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          dropdown.style.display = "none";
          showAppToast(I18N.t("iconnav.booksComingSoon"));
        });
      }
    });
    ["sell", "publish"].forEach((key) => {
      const link = document.getElementById("icon-nav-books-" + key);
      if (link) link.addEventListener("click", () => { dropdown.style.display = "none"; });
    });
  }
  if (createBtn && createDropdown) {
    createBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      const willOpen = createDropdown.style.display !== "block";
      closeAllDropdowns();
      createDropdown.style.display = willOpen ? "block" : "none";
    });
    createDropdown.addEventListener("click", (e) => e.stopPropagation());
    // "Camera" and "Record a Moment" both open the same live-camera screen:
    // it already supports tap-for-photo / hold-for-video in one shutter
    // button (see the "tap and hold" hint shown there), so there's no
    // separate photo-only vs video-only capture mode to route to.
    const cameraLink = document.getElementById("icon-nav-create-camera");
    if (cameraLink) {
      cameraLink.addEventListener("click", (e) => {
        e.preventDefault();
        createDropdown.style.display = "none";
        openCreateWizard();
      });
    }
    const recordLink = document.getElementById("icon-nav-create-record");
    if (recordLink) {
      recordLink.addEventListener("click", (e) => {
        e.preventDefault();
        createDropdown.style.display = "none";
        openCreateWizard();
      });
    }
    // "Upload a Moment" / "Upload a Picture" open the same wizard but skip
    // straight to the device's file picker instead of the live camera,
    // pre-filtered to video or image files respectively.
    const uploadMomentLink = document.getElementById("icon-nav-create-upload-moment");
    if (uploadMomentLink) {
      uploadMomentLink.addEventListener("click", (e) => {
        e.preventDefault();
        createDropdown.style.display = "none";
        openCreateWizard();
        const fileInput = document.getElementById("wizard-file-media");
        if (fileInput) {
          fileInput.accept = "video/*";
          fileInput.click();
        }
      });
    }
    const uploadPictureLink = document.getElementById("icon-nav-create-upload-picture");
    if (uploadPictureLink) {
      uploadPictureLink.addEventListener("click", (e) => {
        e.preventDefault();
        createDropdown.style.display = "none";
        openCreateWizard();
        const fileInput = document.getElementById("wizard-file-media");
        if (fileInput) {
          fileInput.accept = "image/*";
          fileInput.click();
        }
      });
    }
    // "Loop" opens the same camera-wizard flow as "Camera"/"Record a Moment"
    // (see openCreateWizard() below) - it takes an optional target argument
    // that tells the wizard's final publish step which endpoint to post to
    // (POST /api/loops instead of POST /api/moments) rather than this
    // needing its own separate capture UI.
    const loopLink = document.getElementById("icon-nav-create-loop");
    if (loopLink) {
      loopLink.addEventListener("click", (e) => {
        e.preventDefault();
        createDropdown.style.display = "none";
        openCreateWizard("loop");
      });
    }
    // "Upload video" (task #231) opens the same wizard with target:"video" -
    // the long-form Videos hub - and jumps straight to the gallery file
    // picker pre-filtered to video files, same idiom as "Upload a Moment"
    // above, since a 20-minute hold-to-record capture isn't a realistic UX.
    const videoLink = document.getElementById("icon-nav-create-video");
    if (videoLink) {
      videoLink.addEventListener("click", (e) => {
        e.preventDefault();
        createDropdown.style.display = "none";
        openCreateWizard("video");
        const fileInput = document.getElementById("wizard-file-media");
        if (fileInput) {
          fileInput.accept = "video/*";
          fileInput.click();
        }
      });
    }
    const productLink = document.getElementById("icon-nav-create-product");
    if (productLink) {
      productLink.addEventListener("click", () => {
        createDropdown.style.display = "none";
      });
    }
  }
  document.addEventListener("click", () => closeAllDropdowns());
})();

function setIconNavBadge(count) {
  // Task #237 - the bell moved out of the bottom icon bar into the top
  // Profile/Messages/Notifications row, so this now writes to
  // nav-notifications-badge instead of the old icon-nav-badge element.
  const badge = document.getElementById("nav-notifications-badge");
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
  updateGlobalSearchPlaceholder();

  try {
    if (parts.length === 0) return renderHome();
    if (parts[0] === "marketplace") return renderMarketplaceHome();
    if (parts[0] === "friends") return renderFriendsPage();
    if (parts[0] === "clips") return renderClips();
    if (parts[0] === "videos" && parts[1]) return renderVideoWatch(parts[1]);
    if (parts[0] === "videos") return renderVideosFeed();
    if (parts[0] === "groups" && parts[1]) return renderGroupDetail(parts[1]);
    if (parts[0] === "groups") return renderGroupsHome();
    if (parts[0] === "book-club" && parts[1]) return renderBookClubDetail(parts[1]);
    if (parts[0] === "book-club") return renderBookClubHome();
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
    viewEl.innerHTML = `<div class="not-found-state"><p>${I18N.t("common.notFound")}</p><a href="#/" class="btn btn-primary">${I18N.t("common.goHome")}</a></div>`;
  } catch (e) {
    viewEl.innerHTML = `<div class="not-found-state"><p class="form-msg error">${escapeHtml(e.message)}</p><a href="#/" class="btn btn-primary">${I18N.t("common.goHome")}</a></div>`;
  }
}
window.addEventListener("hashchange", router);

// ---------------- Home ----------------

// Horizontal genre-tab row shown above marketplace results (like a
// bookstore's shelf tabs) - all categories scroll sideways, the one being
// browsed is underlined. activeSlug is "all" on the unfiltered/search view.
function categoryTabsHtml(activeSlug) {
  const allTab = `
    <a class="category-tab-pill${activeSlug === "all" ? " active" : ""}" href="#/category/all">${I18N.t("category.allTab")}</a>`;
  return `<div class="category-tabs-row">${allTab}${CATEGORY_LIST.map(
    (c) => `
    <a class="category-tab-pill${activeSlug === c.slug ? " active" : ""}" href="#/category/${c.slug}">${c.icon} ${I18N.lang === "es" ? c.es : c.en}</a>`
  ).join("")}</div>`;
}

function categoryCardsHtml() {
  return CATEGORY_LIST.map(
    (c) => `
    <a class="category-card" href="#/category/${c.slug}">
      ${c.img ? `<img class="category-icon category-icon-img" src="${c.img}" alt="" />` : `<span class="category-icon">${c.icon}</span>`}
      <span class="category-label">${I18N.lang === "es" ? c.es : c.en}</span>
    </a>`
  ).join("");
}

// Home ("#/"): a single ranked vertical feed mixing every author's video AND
// photo moments (Facebook-style focus on sharing, TikTok-style continuous
// swipe), falling back to the marketplace grid for guests who have nothing
// to see in a feed yet. Two pieces, both fed by real endpoints:
//   (a) a thin "stories" strip - genuinely ephemeral "Loops" (24h,
//       tap-through viewer, seen/unseen ring), NOT the (now-permanent)
//       Moments below - loadHomeStoriesStrip() below. Moments were made
//       permanent on 2026-08-18 (see server.js), which is exactly why this
//       strip no longer shows them: a "stories" rail stops making sense once
//       its content never expires. Loops exists as a separate feature/table
//       (see server.js's "LOOPS" section) specifically to keep that Stories
//       mechanic alive under its own name.
//   (b) the full swipe feed itself, sharing its render/gesture engine with
//       the full-screen Clips player - see drawSwipeItem()/
//       wireSwipeGestures() above and loadHomeSwipeFeed() below.
// This replaces the old design (stories bar -> chronological list of
// friends' posts -> a "Suggested" section): that content is now folded
// into the single ranked feed instead of being three separate lists.
function renderHome() {
  if (!state.token) return renderMarketplaceHome();

  // No ad-carousel here on purpose: Home is now a full-bleed content feed,
  // and a banner above it would eat into the swipe viewport and compete
  // with the feed the same way the old friends-post list used to. Ads still
  // run on Marketplace (renderMarketplaceHome), which is the shopping-intent
  // page where they belong.
  viewEl.innerHTML = `
    <div class="home-stories-strip" id="home-stories-strip">
      <div class="moments-bar" id="home-loops-bar"></div>
    </div>
    <div class="home-swipe-feed" id="home-swipe-feed"><p style="color:var(--text-secondary);text-align:center;padding:40px 0;">${I18N.t("common.loading")}</p></div>
  `;
  // Draw the "your Loop" circle (colored ring if you have an unviewed-by-
  // someone-else Loop live, plain "+" to add one otherwise) immediately,
  // from data already in memory - don't wait on the /api/loops/feed round
  // trip for it, and don't let a failed/slow fetch hide it later (see
  // loadHomeStoriesStrip()'s catch below). Mirrors how the old permanent-
  // Moments version of this strip drew its own-circle placeholder eagerly.
  renderLoopGroupsBar(document.getElementById("home-loops-bar"), [], {
    ownUserId: state.user.id,
    ownPhoto: state.user.photo,
    ownName: state.user.name,
  });
  wireHomeSwipeFeedResize();
  sizeHomeSwipeFeed();
  loadHomeStoriesStrip();
  loadHomeSwipeFeed();
}

// Thin "stories" strip at the top of Home - the caller's own Loop (if any)
// plus friends'/followed-pages' Loops from GET /api/loops/feed, grouped by
// author, rect layout (sized down via .home-stories-strip in style.css).
// Distinct from the permanent Moments feed below it - see the comment above
// renderHome().
async function loadHomeStoriesStrip() {
  const el = document.getElementById("home-loops-bar");
  if (!el) return;
  try {
    const data = await api("/api/loops/feed", { auth: true });
    el.style.display = "flex";
    renderLoopGroupsBar(el, data.groups || [], {
      ownUserId: state.user.id,
      ownPhoto: state.user.photo,
      ownName: state.user.name,
    });
  } catch (e) {
    // Best-effort: leave the "your Loop" circle drawn by renderHome() as-is
    // rather than wiping the strip - a failed fetch shouldn't make the
    // add-a-Loop entry point disappear too.
  }
}

// The unified ranked Home feed - video AND photo moments from every author,
// friend/follow-boosted but not friend-filtered (see the comment on
// /api/moments/videos/feed in server.js), rendered via the same
// drawSwipeItem()/wireSwipeGestures() engine the full-screen Clips player
// uses, just mounted inline in normal document flow (see .home-swipe-feed
// in style.css and sizeHomeSwipeFeed() below) instead of a fixed overlay,
// so the topbar and bottom nav stay visible around it.
async function loadHomeSwipeFeed() {
  const container = document.getElementById("home-swipe-feed");
  if (!container) return;
  let items = [];
  try {
    items = await api("/api/moments/videos/feed", { auth: true });
  } catch (e) {}
  if (!items.length) {
    // Only happens on a genuinely empty platform (or every moment expired) -
    // this endpoint isn't friend-filtered, so a normal account with zero
    // friends still gets content. Same friendly empty state the old
    // home-feed-posts list used instead of leaving a blank scroller.
    container.innerHTML = `
      <div class="empty-state home-feed-empty">
        <p>${I18N.t("home.feedEmpty")}</p>
        <div class="home-feed-empty-actions">
          <a href="#/friends" class="btn btn-secondary">${I18N.t("home.feedEmptyFindPeople")}</a>
          <a href="#/marketplace" class="btn btn-secondary">${I18N.t("home.feedEmptyBrowse")}</a>
        </div>
      </div>
    `;
    return;
  }
  homeSwipeState = { videos: items, index: 0, rootEl: container, closable: false };
  drawSwipeItem(homeSwipeState);
  wireSwipeGestures(container, homeSwipeState);
}

// The Home swipe feed sits in normal document flow (not a full-screen fixed
// overlay like Clips) so the topbar and bottom icon-nav stay visible around
// it - which means its height can't be a fixed vh value, it's "whatever
// vertical space is actually left" after that chrome, and that differs by
// screen size (icon-nav moves to a fixed bottom bar under 640px - see the
// media query in style.css - and the topbar's own height varies with the
// tagline text wrapping). Measuring it live is simpler and more correct
// than trying to hardcode every combination in CSS.
function sizeHomeSwipeFeed() {
  const container = document.getElementById("home-swipe-feed");
  if (!container) return;
  const top = container.getBoundingClientRect().top;
  const mobileBottomNav = window.innerWidth <= 640;
  const iconNavEl = document.getElementById("icon-nav");
  const bottomReserved = mobileBottomNav && iconNavEl ? iconNavEl.offsetHeight : 0;
  const h = Math.max(320, window.innerHeight - top - bottomReserved);
  container.style.height = h + "px";
}

// Wired once ever (idempotent), not per Home visit: renderHome() replaces
// #home-swipe-feed's own DOM on every visit, but a window-level resize
// listener added inside renderHome() would otherwise pile up a new one on
// every navigation back to Home. The handler itself re-queries the DOM
// fresh each time, so it's a no-op whenever Home isn't the current route.
let homeSwipeFeedResizeWired = false;
function wireHomeSwipeFeedResize() {
  if (homeSwipeFeedResizeWired) return;
  homeSwipeFeedResizeWired = true;
  window.addEventListener("resize", sizeHomeSwipeFeed);
  window.addEventListener("orientationchange", sizeHomeSwipeFeed);
}

// ---------------- Full-screen overlay back-button support ----------------
// Camera-style overlays (Moments capture, guided product photo capture,
// the barcode scanner) are plain DOM overlays stacked on top of the current
// route, not routes themselves - so the phone/browser Back button used to
// do nothing about them: it silently changed the underlying page while the
// camera stayed stuck on screen, leaving the on-screen X as the only way
// out. We push one throwaway history entry when an overlay opens and
// consume it on popstate, so Back and X close the overlay the same way.
let overlayBackGuard = null; // { closeFn } for whichever overlay is open

function guardOverlayForBack(closeFn) {
  overlayBackGuard = { closeFn };
  history.pushState({ hiOverlay: true }, "", location.href);
}

function closeOverlayViaBack(closeFn) {
  // Used by an overlay's own X/cancel control. If we're still holding the
  // history entry pushed for it, consume it so a later Back press doesn't
  // land on a dead state; either way, run the real close logic now.
  if (overlayBackGuard && overlayBackGuard.closeFn === closeFn) {
    overlayBackGuard = null;
    history.back();
  }
  closeFn();
}

window.addEventListener("popstate", () => {
  if (overlayBackGuard) {
    const fn = overlayBackGuard.closeFn;
    overlayBackGuard = null;
    fn();
  }
});

// ---------------- Barcode / ISBN scanner (Marketplace search + listing form) ----------------
// Shared full-screen scanner reused from two places: the Marketplace search
// bar (scan a book's barcode to search for it) and the "Post a listing" form
// (scan a book's ISBN barcode to auto-fill the title via Open Library).
// Uses the ZXing browser library (loaded in index.html) since the native
// BarcodeDetector API isn't available on iOS Safari.
let barcodeScannerControls = null;

function closeBarcodeScanner() {
  if (barcodeScannerControls) {
    try {
      barcodeScannerControls.stop();
    } catch (e) {}
    barcodeScannerControls = null;
  }
  const overlay = document.getElementById("barcode-scanner-overlay");
  if (overlay) overlay.remove();
}

function openBarcodeScanner(onDetected) {
  if (!state.token) {
    location.hash = "#/login";
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "barcode-scanner-overlay";
  overlay.id = "barcode-scanner-overlay";
  overlay.innerHTML = `
    <div class="barcode-scanner-video-wrap">
      <video id="barcode-scanner-video" autoplay playsinline muted></video>
      <div class="barcode-scanner-frame"></div>
      <div class="barcode-scanner-topbar">
        <button class="wizard-fs-icon-btn" id="barcode-scanner-close" aria-label="${I18N.t("common.cancel")}">&times;</button>
      </div>
    </div>
    <div class="barcode-scanner-bottom">
      <p class="barcode-scanner-hint">${I18N.t("market.scanHint")}</p>
      <a href="#" class="barcode-scanner-manual-link" id="barcode-scanner-manual">${I18N.t("market.enterManually")}</a>
    </div>
  `;
  document.body.appendChild(overlay);
  guardOverlayForBack(closeBarcodeScanner);

  document.getElementById("barcode-scanner-close").addEventListener("click", () => closeOverlayViaBack(closeBarcodeScanner));
  document.getElementById("barcode-scanner-manual").addEventListener("click", (e) => {
    e.preventDefault();
    closeOverlayViaBack(closeBarcodeScanner);
    const manual = prompt(I18N.t("market.enterIsbnPrompt"));
    if (manual && manual.trim()) onDetected(manual.trim());
  });

  const showUnavailable = () => {
    const wrap = overlay.querySelector(".barcode-scanner-video-wrap");
    if (wrap) wrap.insertAdjacentHTML("beforeend", `<div class="wizard-fs-fallback">${I18N.t("market.scannerUnavailable")}</div>`);
  };

  if (!window.ZXingBrowser || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showUnavailable();
    return;
  }

  const videoEl = document.getElementById("barcode-scanner-video");
  const codeReader = new window.ZXingBrowser.BrowserMultiFormatReader();
  // A book usually has more than one barcode on the back cover (the main
  // ISBN/EAN-13 barcode, and sometimes a second price/add-on barcode) - any
  // one of them decoding successfully is a valid result, so no format
  // restriction is applied here (BrowserMultiFormatReader tries all
  // supported 1D/2D formats by default).
  let detected = false; // guard: the decode callback fires on every frame, so
                         // without this a near-simultaneous double-decode
                         // could call onDetected() twice for one scan.
  codeReader
    .decodeFromConstraints(
      {
        video: {
          facingMode: { ideal: "environment" },
          // Higher resolution + continuous autofocus so the camera can
          // actually resolve fine barcode lines up close, instead of
          // defaulting to a low-res, fixed-focus stream that only happens
          // to work when the phone's default focus distance lines up.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: "continuous" }],
        },
      },
      videoEl,
      (result, err, controls) => {
        barcodeScannerControls = controls;
        if (result && !detected) {
          detected = true;
          const text = result.getText();
          try {
            controls.stop();
          } catch (e2) {}
          closeOverlayViaBack(closeBarcodeScanner);
          onDetected(text);
        }
      }
    )
    .catch(() => showUnavailable());

  // Tap anywhere on the video to re-trigger autofocus - phone cameras often
  // focus on whatever was in frame when the stream opened, which can leave
  // a close-up barcode blurry until something asks it to refocus.
  videoEl.addEventListener("click", () => {
    try {
      const track = videoEl.srcObject && videoEl.srcObject.getVideoTracks && videoEl.srcObject.getVideoTracks()[0];
      if (track && track.getCapabilities && track.getCapabilities().focusMode) {
        track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
      }
    } catch (e3) {}
  });
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
    <a href="#/post" class="sell-books-banner">
      <span class="sell-books-banner-icon">&#128218;</span>
      <span class="ai-listing-banner-text">
        <strong>${I18N.t("home.sellBannerTitle")}</strong>
        <span>${I18N.t("home.sellBannerSubtitle")}</span>
      </span>
      <span class="sell-books-banner-arrow">&#8250;</span>
    </a>
    ${categoryTabsHtml("all")}
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

// ---- AI auto-clip (task #160) trim-window playback helper ------------------
// A Moment video may carry a trim_start_sec/trim_end_sec window (set by the
// creator from an AI suggestion in the create wizard - see wireWizardAiClip()
// below). This is metadata only, never a physically cut file (MVP - no
// server-side re-encoding), so every place a Moment video plays has to
// enforce it itself: start playback at the trim start, and loop back there
// once playback reaches the trim end, instead of ever showing the raw full
// clip. Shared by the Home feed cards, the full-screen Moments viewer, and
// the Shorts/Clips swipe feed so the behavior is identical everywhere.
function momentTrimWindow(m) {
  if (!m || m.trimStartSec === undefined || m.trimStartSec === null || m.trimEndSec === undefined || m.trimEndSec === null) return null;
  const start = Number(m.trimStartSec);
  const end = Number(m.trimEndSec);
  if (!isFinite(start) || !isFinite(end) || !(end > start)) return null;
  return { start, end };
}

// Wires `videoEl` to respect m's trim window, if any. No-op (returns null)
// for moments without one, so callers can wire this unconditionally without
// branching. `onLoop` (optional) fires each time playback loops back to the
// start - callers use it to keep other UI (e.g. a progress bar) in sync.
function wireMomentTrimLoop(videoEl, m, onLoop) {
  const trim = momentTrimWindow(m);
  if (!videoEl || !trim) return null;
  const seekToStart = () => {
    try {
      videoEl.currentTime = trim.start;
    } catch (e) {}
  };
  if (videoEl.readyState >= 1) seekToStart();
  else videoEl.addEventListener("loadedmetadata", seekToStart, { once: true });
  videoEl.addEventListener("timeupdate", () => {
    if (videoEl.currentTime >= trim.end) {
      seekToStart();
      if (onLoop) onLoop();
    }
  });
  return trim;
}

function formatClipTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}

// ---- Friends' moments rendered as inline, playable feed cards on Home -----
// (in addition to the circle bar above). Each card carries the full Reels-
// style action rail (like/comment/share/repost/save); tapping the media
// opens the full-screen story viewer starting on that exact moment.

function buildHomeFeedItems(groups) {
  const items = [];
  for (const g of groups) {
    for (const m of g.moments) {
      // Mutate the SAME object reference from group.moments (do NOT spread-copy).
      // The full-screen viewer (openMomentsViewer/drawMomentViewer) reads
      // group.moments via homeFeedGroupsById, while this list feeds the inline
      // feed cards. If they were distinct objects, a like/save tap on one
      // surface wouldn't be reflected on the other. Keeping them as the same
      // reference means either surface's mutation is instantly visible on both.
      Object.assign(m, { userId: g.userId, userName: g.userName, userPhoto: g.userPhoto, isPage: g.isPage });
      items.push(m);
    }
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  return items;
}

// Task #204 - renders the text/sticker overlays a creator dragged onto a
// VIDEO capture (see createWizard.overlays / server.js's mkt_moments.overlay_json)
// as a plain absolutely-positioned HTML layer on top of the <video> element,
// at every place a video with overlays is actually played back. Photos never
// call this - their overlays are baked straight into the JPEG pixels at
// publish time instead (see bakeWizardOverlays()), so there's nothing left
// to render as a separate layer for them.
function renderMediaOverlayLayer(overlays) {
  if (!overlays || !overlays.length) return "";
  return `<div class="media-overlay-layer">${overlays
    .map((ov) => {
      const sizeClass = "size-" + (ov.size || "md");
      const colorStyle = ov.type === "text" ? `color:${ov.color || "#FFD84D"};` : "";
      return `<div class="media-overlay-item ${ov.type === "sticker" ? "sticker" : "text"} ${sizeClass}" style="left:${ov.xPct}%;top:${ov.yPct}%;${colorStyle}">${escapeHtml(ov.value || "")}</div>`;
    })
    .join("")}</div>`;
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
            ? `<video class="feed-moment-media" src="${m.mediaUrl}" muted loop playsinline autoplay></video>${renderMediaOverlayLayer(m.overlays)}`
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
    // A brand-new account with zero friends used to just make this whole
    // section vanish, leaving Home looking blank/broken on first login.
    // Show a friendly prompt with somewhere useful to go instead.
    el.style.display = "flex";
    el.innerHTML = `
      <div class="empty-state home-feed-empty">
        <p>${I18N.t("home.feedEmpty")}</p>
        <div class="home-feed-empty-actions">
          <a href="#/friends" class="btn btn-secondary">${I18N.t("home.feedEmptyFindPeople")}</a>
          <a href="#/marketplace" class="btn btn-secondary">${I18N.t("home.feedEmptyBrowse")}</a>
        </div>
      </div>
    `;
    return;
  }
  el.style.display = "flex";
  el.innerHTML = items.map(feedMomentCardHtml).join("");
  items.forEach((m) => {
    if (m.mediaType !== "video") return;
    const card = el.querySelector('[data-moment-id="' + m.id + '"]');
    const vid = card && card.querySelector(".feed-moment-media");
    wireMomentTrimLoop(vid, m);
  });
  wireHomeFeedPostsDelegation();
}

// Single delegated listener (wired once, survives re-renders since the
// container itself is never replaced) so we don't need per-card unique ids
// the way the single-instance Stories/Clips overlays do.
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
    ${categoryTabsHtml(slug)}
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
    <div id="product-related-videos"></div>
  `;

  // "Related videos" (task #231) - fetched separately after the main
  // product paint so a slow/failed videos lookup never blocks or breaks the
  // product page itself; the container simply stays empty (no section
  // rendered at all) if there are none, per the feature's own spec.
  api("/api/videos/by-product/" + id)
    .then((videos) => {
      const el = document.getElementById("product-related-videos");
      if (el && videos && videos.length) el.innerHTML = relatedVideosStripHtml(videos);
    })
    .catch(() => {});

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
    <p class="buy-safety-note">${I18N.t("product.buySafetyNote")}</p>
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
        <input type="password" id="reg-password" minlength="6" />
        <p class="form-field-hint">${I18N.t("auth.passwordHint")}</p>
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
      <div class="post-ad-header-row">
        <h2 class="section-heading">${I18N.t("postAd.title")}</h2>
        <a href="#/marketplace" class="post-ad-cancel-link" id="post-ad-cancel">${I18N.t("common.cancel")}</a>
      </div>
      <button type="button" class="ai-listing-banner" id="ai-listing-banner">
        <span class="ai-listing-banner-icon">&#10024;</span>
        <span class="ai-listing-banner-text">
          <strong>${I18N.t("postAd.aiBannerTitle")}</strong>
          <span>${I18N.t("postAd.aiBannerSubtitle")}</span>
        </span>
      </button>
      <div class="form-group">
        <label>${I18N.t("postAd.isbnField")}</label>
        <div class="post-isbn-row">
          <input type="text" id="p-isbn" maxlength="17" placeholder="${I18N.t("postAd.isbnPlaceholder")}" value="${existing && existing.isbn ? escapeHtml(existing.isbn) : ""}" />
          <button type="button" class="market-scan-btn" id="p-isbn-scan" title="${I18N.t("market.scanBarcode")}">&#128247;</button>
        </div>
        <p class="post-isbn-lookup-hint" id="p-isbn-hint"></p>
      </div>
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
        <button type="button" class="btn btn-secondary" id="p-guided-capture" style="margin-top:8px;">&#128247; ${I18N.t("postAd.guidedCaptureBtn")}</button>
        <button type="button" class="btn btn-ai-suggest" id="p-ai-suggest" style="margin-top:8px;">&#10024; ${I18N.t("postAd.aiSuggest")}</button>
        <p class="post-isbn-lookup-hint" id="p-ai-hint"></p>
      </div>
      <button class="btn btn-primary" id="p-submit" style="width:100%;margin-top:10px;">${I18N.t("postAd.publish")}</button>
      <p class="form-msg" id="p-msg"></p>
    </div>
  `;

  renderPhotoGrid();

  const isbnHintEl = document.getElementById("p-isbn-hint");
  async function isbnLookupAndFill(rawIsbn) {
    const cleanIsbn = rawIsbn.replace(/[^0-9Xx]/g, "");
    if (!cleanIsbn) {
      isbnHintEl.textContent = "";
      return;
    }
    isbnHintEl.textContent = I18N.t("postAd.isbnLooking");
    isbnHintEl.className = "post-isbn-lookup-hint";
    try {
      const data = await api("/api/isbn/" + encodeURIComponent(cleanIsbn));
      const titleEl = document.getElementById("p-title");
      if (data.found) {
        if (titleEl && !titleEl.value.trim()) titleEl.value = data.title;
        const authors = Array.isArray(data.authors) && data.authors.length ? " — " + data.authors.join(", ") : "";
        isbnHintEl.textContent = I18N.t("postAd.isbnFound") + ": " + data.title + authors;
        isbnHintEl.className = "post-isbn-lookup-hint ok";
      } else {
        isbnHintEl.textContent = I18N.t("postAd.isbnNotFound");
        isbnHintEl.className = "post-isbn-lookup-hint error";
      }
    } catch (e) {
      isbnHintEl.textContent = "";
    }
  }
  document.getElementById("p-isbn-scan").addEventListener("click", () => {
    openBarcodeScanner((code) => {
      document.getElementById("p-isbn").value = code;
      isbnLookupAndFill(code);
      // Keep the seller moving in one continuous flow: scan -> photograph.
      // If they haven't added photos yet, jump straight into guided capture
      // instead of leaving them to hunt for the button themselves.
      if (photoBuffer.length === 0) openGuidedPhotoCapture();
    });
  });
  document.getElementById("p-isbn").addEventListener("blur", (e) => isbnLookupAndFill(e.target.value.trim()));
  document.getElementById("p-guided-capture").addEventListener("click", openGuidedPhotoCapture);

  const aiHintEl = document.getElementById("p-ai-hint");
  const aiSuggestBtn = document.getElementById("p-ai-suggest");
  const aiBanner = document.getElementById("ai-listing-banner");
  let aiPendingAfterUpload = false;

  async function runAiSuggest() {
    if (!photoBuffer.length) {
      aiHintEl.textContent = I18N.t("postAd.aiNeedsPhoto");
      aiHintEl.className = "post-isbn-lookup-hint error";
      return;
    }
    aiSuggestBtn.disabled = true;
    aiBanner.disabled = true;
    aiHintEl.textContent = I18N.t("postAd.aiThinking");
    aiHintEl.className = "post-isbn-lookup-hint";
    try {
      const data = await api("/api/ai/analyze-book-photo", {
        method: "POST",
        auth: true,
        body: { image: photoBuffer[0], locale: I18N.lang },
      });
      if (data.title) document.getElementById("p-title").value = data.title;
      if (data.description) document.getElementById("p-description").value = data.description;
      if (data.category) document.getElementById("p-category").value = data.category;
      if (data.suggestedPrice) document.getElementById("p-price").value = data.suggestedPrice;
      let hint = data.title ? I18N.t("postAd.aiSuggestedReview") : I18N.t("postAd.aiNoMatch");
      if (data.suggestedPrice && data.priceReasoning) hint += " " + data.priceReasoning;
      aiHintEl.textContent = hint;
      aiHintEl.className = "post-isbn-lookup-hint " + (data.title ? "ok" : "error");
      aiHintEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      aiHintEl.textContent = err.message || I18N.t("postAd.aiError");
      aiHintEl.className = "post-isbn-lookup-hint error";
    } finally {
      aiSuggestBtn.disabled = false;
      aiBanner.disabled = false;
    }
  }
  aiSuggestBtn.addEventListener("click", runAiSuggest);

  // Big, impossible-to-miss entry point at the top of the form: if there's
  // already a photo, run the AI right away; if not, open the photo picker
  // first and run automatically as soon as a photo comes back.
  aiBanner.addEventListener("click", () => {
    if (photoBuffer.length) {
      runAiSuggest();
    } else {
      aiPendingAfterUpload = true;
      document.getElementById("p-photos").click();
    }
  });

  document.getElementById("p-photos").addEventListener("change", (e) => {
    const files = Array.from(e.target.files).slice(0, MAX_PHOTOS - photoBuffer.length);
    let remaining = files.length;
    if (remaining === 0) return;
    let loaded = 0;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = async () => {
        // Automatically clean up the photo (auto contrast/brightness) before
        // it's stored - no button, no wait, it just happens.
        const cleaned = await autoEnhanceImage(reader.result);
        if (photoBuffer.length < MAX_PHOTOS) photoBuffer.push(cleaned);
        renderPhotoGrid();
        loaded++;
        if (loaded === files.length && aiPendingAfterUpload) {
          aiPendingAfterUpload = false;
          runAiSuggest();
        }
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
      isbn: document.getElementById("p-isbn").value.trim(),
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
      html += `<div class="photo-slot"><img src="${photoBuffer[i]}" /><button class="remove-photo" data-i="${i}" aria-label="${I18N.t("postAd.removePhoto")}">&times;</button></div>`;
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

// ---------------- Guided photo capture (product mode) ----------------
// Walks a seller through a fixed shot sequence (front cover, back cover,
// spine, optional damage close-up) instead of one loose photo at a time -
// this is the highest-leverage camera improvement for book listings per the
// C2C-books strategy: it directly improves listing quality/speed, which is
// the "logistics" half of "easy to use + great logistics."
const GUIDED_SHOT_SEQUENCE = [
  { key: "front", required: true },
  { key: "back", required: true },
  { key: "spine", required: false },
  { key: "damage", required: false },
];

let guidedCapture = null;

function openGuidedPhotoCapture() {
  if (photoBuffer.length >= MAX_PHOTOS) {
    alert(I18N.t("postAd.guidedMaxReached"));
    return;
  }
  guidedCapture = {
    index: 0,
    stream: null,
    shots: GUIDED_SHOT_SEQUENCE.map((s) => ({ ...s, dataUrl: null })),
  };
  const overlay = document.createElement("div");
  overlay.id = "guided-capture-overlay";
  overlay.className = "guided-capture-overlay";
  document.body.appendChild(overlay);
  guardOverlayForBack(closeGuidedCapture);
  drawGuidedCapture();
  startGuidedStream();
}

function startGuidedStream() {
  if (!guidedCapture || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return;
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "environment" } })
    .then((stream) => {
      if (!guidedCapture) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      guidedCapture.stream = stream;
      const video = document.getElementById("guided-video");
      if (video) video.srcObject = stream;
    })
    .catch(() => {
      const hint = document.getElementById("guided-capture-hint");
      if (hint) hint.textContent = I18N.t("create.cameraUnavailable");
    });
}

function closeGuidedCapture() {
  if (guidedCapture && guidedCapture.stream) guidedCapture.stream.getTracks().forEach((t) => t.stop());
  const overlay = document.getElementById("guided-capture-overlay");
  if (overlay) overlay.remove();
  guidedCapture = null;
}

function guidedCaptureShot() {
  const video = document.getElementById("guided-video");
  if (!video || !video.srcObject) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 900;
  canvas.height = video.videoHeight || 900;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  guidedCapture.shots[guidedCapture.index].dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  drawGuidedCapture();
}

function guidedRetake() {
  guidedCapture.shots[guidedCapture.index].dataUrl = null;
  drawGuidedCapture();
}

function guidedAdvance() {
  if (guidedCapture.index < guidedCapture.shots.length - 1) {
    guidedCapture.index += 1;
    drawGuidedCapture();
  } else {
    finishGuidedCapture();
  }
}

async function finishGuidedCapture() {
  const captured = guidedCapture.shots.filter((s) => s.dataUrl);
  for (const s of captured) {
    if (photoBuffer.length >= MAX_PHOTOS) break;
    const cleaned = await autoEnhanceImage(s.dataUrl);
    photoBuffer.push(cleaned);
  }
  renderPhotoGrid();
  closeOverlayViaBack(closeGuidedCapture);
}

function drawGuidedCapture() {
  const overlay = document.getElementById("guided-capture-overlay");
  if (!overlay || !guidedCapture) return;
  const shot = guidedCapture.shots[guidedCapture.index];
  const n = guidedCapture.shots.length;
  const stepLabel = I18N.t("postAd.guidedStepOf")
    .replace("{i}", String(guidedCapture.index + 1))
    .replace("{n}", String(n));
  const shotLabel = I18N.t("postAd.guidedShot_" + shot.key);
  const thumbsHtml = guidedCapture.shots
    .map(
      (s, i) =>
        `<span class="guided-thumb ${i === guidedCapture.index ? "current" : ""} ${s.dataUrl ? "done" : ""}">${
          s.dataUrl ? `<img src="${s.dataUrl}" />` : ""
        }</span>`
    )
    .join("");

  overlay.innerHTML = `
    <div class="guided-capture-topbar">
      <button class="wizard-fs-icon-btn" id="guided-close" aria-label="${I18N.t("common.cancel")}">&times;</button>
      <span class="guided-capture-step">${stepLabel}: ${shotLabel}${shot.required ? "" : " (" + I18N.t("postAd.guidedOptional") + ")"}</span>
    </div>
    <div class="guided-capture-video-wrap">
      ${
        shot.dataUrl
          ? `<img class="guided-capture-preview" src="${shot.dataUrl}" />`
          : `<video id="guided-video" autoplay playsinline muted></video><p class="wizard-fs-hint" id="guided-capture-hint"></p>`
      }
    </div>
    <div class="guided-capture-thumbs">${thumbsHtml}</div>
    <div class="guided-capture-controls">
      ${
        shot.dataUrl
          ? `<button class="btn btn-secondary" id="guided-retake">${I18N.t("postAd.guidedRetake")}</button>
             <button class="btn btn-primary" id="guided-next">${guidedCapture.index === n - 1 ? I18N.t("postAd.guidedFinish") : I18N.t("postAd.guidedNext")}</button>`
          : `<div class="wizard-fs-capture-wrap"><button class="wizard-fs-capture-btn" id="guided-shutter" aria-label="${I18N.t("create.capturePhoto")}"></button></div>`
      }
    </div>
    ${!shot.dataUrl && !shot.required ? `<p class="guided-capture-skip"><a href="#" id="guided-skip">${I18N.t("postAd.guidedSkip")}</a></p>` : ""}
  `;

  const video = document.getElementById("guided-video");
  if (video && guidedCapture.stream) video.srcObject = guidedCapture.stream;

  document.getElementById("guided-close").addEventListener("click", () => closeOverlayViaBack(closeGuidedCapture));
  if (shot.dataUrl) {
    document.getElementById("guided-retake").addEventListener("click", guidedRetake);
    document.getElementById("guided-next").addEventListener("click", guidedAdvance);
  } else {
    const shutter = document.getElementById("guided-shutter");
    if (shutter) shutter.addEventListener("click", guidedCaptureShot);
    const skip = document.getElementById("guided-skip");
    if (skip) {
      skip.addEventListener("click", (e) => {
        e.preventDefault();
        guidedAdvance();
      });
    }
  }
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

// ---------------- Book Club ("#/book-club", "#/book-club/:slug") ----------------
// Task #240 - reuses the exact same mkt_groups/mkt_group_posts backend as
// Communities (see groupOut()/POST/GET /api/groups in server.js), just
// filtered to isBookClub groups and with book-specific extras: a required
// book title, an optional link to the seller's own listing, a free group
// video call (Jitsi Meet, no account/API key needed - see POST
// /api/groups/:slug/video-room), and a "Pick of the Month" author-rights
// panel that stays visible but locked until Carlos finishes the legal
// agreement (task #242, AUTHOR_PICK_PROGRAM_ENABLED in server.js).

let bookClubConfigCache = null;
async function getBookClubConfig() {
  if (bookClubConfigCache) return bookClubConfigCache;
  try {
    bookClubConfigCache = await api("/api/book-club/config");
  } catch (e) {
    bookClubConfigCache = { authorPickEnabled: false };
  }
  return bookClubConfigCache;
}

async function renderBookClubHome() {
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  const groups = await api("/api/groups?bookClub=true");

  const listHtml = groups.length
    ? `<div class="groups-grid bookclub-grid">${groups
        .map(
          (g) => `
      <a class="group-card bookclub-card" href="#/book-club/${g.slug}">
        <p class="bookclub-card-book">&#128214; ${escapeHtml(g.bookTitle || "")}</p>
        <p class="group-card-name">${escapeHtml(g.name)}</p>
        <p class="group-card-meta">${[g.city].filter(Boolean).map(escapeHtml).join(" · ")}</p>
        ${g.description ? `<p class="group-card-desc">${escapeHtml(g.description)}</p>` : ""}
      </a>`
        )
        .join("")}</div>`
    : `<div class="empty-state">${I18N.t("bookClub.empty")}</div>`;

  viewEl.innerHTML = `
    <div class="groups-header">
      <h2 class="section-heading">${I18N.t("bookClub.heading")}</h2>
      ${state.token ? `<button class="btn btn-primary" id="bookclub-create-btn">${I18N.t("bookClub.create")}</button>` : ""}
    </div>
    <p class="groups-subtitle">${I18N.t("bookClub.subtitle")}</p>
    <div id="bookclub-create-form" style="display:none;"></div>
    ${listHtml}
  `;

  const createBtn = document.getElementById("bookclub-create-btn");
  if (createBtn) {
    createBtn.addEventListener("click", () => {
      const formWrap = document.getElementById("bookclub-create-form");
      if (formWrap.style.display !== "none") {
        formWrap.style.display = "none";
        return;
      }
      formWrap.style.display = "block";
      formWrap.innerHTML = `
        <form id="bookclub-create-form-el" class="stacked-form">
          <label>${I18N.t("bookClub.bookTitle")}<input type="text" name="bookTitle" required maxlength="200" placeholder="${I18N.t("bookClub.bookTitlePlaceholder")}" /></label>
          <label>${I18N.t("groups.name")}<input type="text" name="name" required maxlength="100" placeholder="${I18N.t("bookClub.namePlaceholder")}" /></label>
          <label>${I18N.t("groups.city")}<input type="text" name="city" maxlength="80" placeholder="${I18N.t("bookClub.cityPlaceholder")}" /></label>
          <label>${I18N.t("groups.description")}<textarea name="description" maxlength="1000"></textarea></label>
          <button type="submit" class="btn btn-primary">${I18N.t("bookClub.createSubmit")}</button>
          <p class="form-msg" id="bookclub-create-msg"></p>
        </form>
      `;
      document.getElementById("bookclub-create-form-el").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const msgEl = document.getElementById("bookclub-create-msg");
        try {
          const g = await api("/api/groups", {
            method: "POST",
            auth: true,
            body: {
              isBookClub: true,
              bookTitle: fd.get("bookTitle"),
              name: fd.get("name"),
              city: fd.get("city"),
              description: fd.get("description"),
            },
          });
          location.hash = "#/book-club/" + g.slug;
        } catch (err) {
          msgEl.textContent = err.message;
          msgEl.className = "form-msg error";
        }
      });
    });
  }
}

function openBookClubVideoOverlay(roomName) {
  const overlay = document.createElement("div");
  overlay.className = "bookclub-video-overlay";
  overlay.innerHTML = `
    <div class="bookclub-video-topbar">
      <span>${I18N.t("bookClub.videoCallLive")}</span>
      <button class="bookclub-video-close" id="bookclub-video-close" aria-label="${I18N.t("common.cancel")}">&times;</button>
    </div>
    <iframe class="bookclub-video-frame" src="https://meet.jit.si/${encodeURIComponent(roomName)}#config.prejoinPageEnabled=true" allow="camera; microphone; fullscreen; display-capture; autoplay"></iframe>
  `;
  document.body.appendChild(overlay);
  document.getElementById("bookclub-video-close").addEventListener("click", () => overlay.remove());
}

// Task #242 - navigable-but-inert "Pick of the Month" submission preview.
// Opens a real modal with a real form; submitting calls the real endpoint,
// which (while AUTHOR_PICK_PROGRAM_ENABLED is false) always answers with
// { ok:false, comingSoon:true } and never touches the database. We treat
// that response as success-of-the-preview, not an error, so the flow feels
// complete end to end.
function openAuthorPickModal(slug, group) {
  const overlay = document.createElement("div");
  overlay.className = "bookclub-authorpick-modal-overlay";
  overlay.id = "bookclub-authorpick-modal-overlay";
  overlay.innerHTML = `
    <div class="bookclub-authorpick-modal">
      <button type="button" class="bookclub-authorpick-modal-close" id="bookclub-authorpick-modal-close" aria-label="${I18N.t("bookClub.authorPickClose")}">&times;</button>
      <h3 class="bookclub-authorpick-modal-title">&#127942; ${I18N.t("bookClub.authorPickModalTitle")}</h3>
      <p class="bookclub-authorpick-modal-intro">${I18N.t("bookClub.authorPickModalIntro")}</p>
      <form id="bookclub-authorpick-form" class="stacked-form">
        <label>${I18N.t("bookClub.authorPickBookLabel")}
          <input type="text" name="bookTitle" required maxlength="200" value="${escapeHtml(group.bookTitle || "")}" />
        </label>
        <label>${I18N.t("bookClub.authorPickPitchLabel")}
          <textarea name="pitch" maxlength="2000" placeholder="${I18N.t("bookClub.authorPickPitchPlaceholder")}"></textarea>
        </label>
        <button type="submit" class="btn btn-primary" id="bookclub-authorpick-form-submit">${I18N.t("bookClub.authorPickModalSubmit")}</button>
        <p class="form-msg" id="bookclub-authorpick-form-msg"></p>
      </form>
      <div class="bookclub-authorpick-thanks" id="bookclub-authorpick-thanks" style="display:none;">
        <p class="bookclub-authorpick-thanks-title">&#10024; ${I18N.t("bookClub.authorPickThanksTitle")}</p>
        <p class="bookclub-authorpick-thanks-desc">${I18N.t("bookClub.authorPickThanksDesc")}</p>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  document.getElementById("bookclub-authorpick-modal-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const form = document.getElementById("bookclub-authorpick-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.token) {
      location.hash = "#/login";
      return;
    }
    const submitBtn = document.getElementById("bookclub-authorpick-form-submit");
    const msgEl = document.getElementById("bookclub-authorpick-form-msg");
    submitBtn.disabled = true;
    try {
      await api("/api/groups/" + encodeURIComponent(slug) + "/author-pick", { method: "POST", auth: true });
      form.style.display = "none";
      document.getElementById("bookclub-authorpick-thanks").style.display = "";
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.className = "form-msg error";
      submitBtn.disabled = false;
    }
  });
}

async function renderBookClubDetail(slug) {
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  let group, posts, bcConfig;
  try {
    [group, posts, bcConfig] = await Promise.all([
      api("/api/groups/" + encodeURIComponent(slug)),
      api("/api/groups/" + encodeURIComponent(slug) + "/posts", state.token ? { auth: true } : {}),
      getBookClubConfig(),
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

  // Task #242 - the "Pick of the Month" panel is always rendered AND its
  // button is always real/clickable (per Carlos: "dejalo visual y navegable
  // pero sin poder accionar" - let people click all the way through the
  // flow so they can get familiar with it and he can react to the UX), but
  // nothing is actually submitted while AUTHOR_PICK_PROGRAM_ENABLED is off:
  // the modal opened below is clearly labeled as a preview, and its submit
  // handler always ends in the friendly "thanks for trying it, nothing was
  // sent" state instead of a real confirmation, because the backend never
  // writes to the database until that flag is flipped.
  const authorPickHtml = `
    <div class="bookclub-authorpick">
      <div class="bookclub-authorpick-headrow">
        <p class="bookclub-authorpick-title">&#127942; ${I18N.t("bookClub.authorPickTitle")}</p>
        ${!bcConfig.authorPickEnabled ? `<span class="bookclub-authorpick-badge">${I18N.t("bookClub.authorPickPreviewBadge")}</span>` : ""}
      </div>
      <p class="bookclub-authorpick-desc">${I18N.t("bookClub.authorPickDesc")}</p>
      <button type="button" class="btn btn-primary" id="bookclub-authorpick-btn">${I18N.t("bookClub.authorPickSubmit")}</button>
    </div>
  `;

  viewEl.innerHTML = `
    <a href="#/book-club" class="back-link">&larr; ${I18N.t("bookClub.backToList")}</a>
    <div class="bookclub-detail-header">
      <div>
        <p class="bookclub-detail-book">&#128214; ${escapeHtml(group.bookTitle || "")}</p>
        <h2 class="section-heading">${escapeHtml(group.name)}</h2>
        <p class="groups-subtitle">${[group.city].filter(Boolean).map(escapeHtml).join(" · ")}</p>
      </div>
      <button class="btn btn-primary bookclub-video-btn" id="bookclub-video-btn">&#128249; ${I18N.t("bookClub.joinVideoCall")}</button>
    </div>
    ${group.description ? `<p class="group-detail-desc">${escapeHtml(group.description)}</p>` : ""}
    ${authorPickHtml}
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

  const videoBtn = document.getElementById("bookclub-video-btn");
  if (videoBtn) {
    videoBtn.addEventListener("click", async () => {
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      videoBtn.disabled = true;
      try {
        const { videoRoomName } = await api("/api/groups/" + encodeURIComponent(slug) + "/video-room", { method: "POST", auth: true });
        openBookClubVideoOverlay(videoRoomName);
      } catch (err) {
        alert(err.message);
      } finally {
        videoBtn.disabled = false;
      }
    });
  }

  const authorPickBtn = document.getElementById("bookclub-authorpick-btn");
  if (authorPickBtn) {
    authorPickBtn.addEventListener("click", () => {
      if (!state.token) {
        location.hash = "#/login";
        return;
      }
      openAuthorPickModal(slug, group);
    });
  }

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
        renderBookClubDetail(slug);
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
      ${isMe ? `<button class="photo-remove-btn" data-id="${p.id}" aria-label="${I18N.t("postAd.removePhoto")}">&times;</button>` : ""}
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

// Renders the Loops "stories" strip on Home (see the .home-stories-strip
// comment on renderHome()). Deliberately a separate function from
// renderMomentGroupsBar() above rather than a third opts-flag on it: the
// data shape differs (groups carry `loops` + a per-loop `viewed` flag
// instead of `moments`), the ring needs a seen/unseen state Moments never
// had once they went permanent, and the "own" affordance opens the create
// wizard directly instead of the Moments-specific upload modal - trying to
// thread all of that through one shared function would leave more
// conditionals than shared code. Own dedicated CSS classes too
// (.loop-rect-*, mirroring .moment-rect-*) for the same reason.
function renderLoopGroupsBar(containerEl, groups, opts) {
  const mine = opts && opts.ownUserId ? groups.find((g) => g.userId === opts.ownUserId) : null;
  const hasOwn = !!(mine && mine.loops.length);
  let html = "";
  if (opts && opts.ownUserId) {
    const thumb = hasOwn && mine.loops[0].mediaType === "photo" ? mine.loops[0].mediaUrl : opts.ownPhoto;
    html += `
      <div class="loop-rect-wrap loop-rect-add" id="loop-add-circle" style="${thumb ? `background-image:url('${thumb}')` : ""}">
        ${!thumb ? `<div class="loop-rect-placeholder">${initials(opts.ownName || "")}</div>` : ""}
        <span class="loop-rect-shade"></span>
        <span class="loop-rect-add-badge" id="loop-add-badge" title="${I18N.t("loops.add")}">+</span>
        <span class="loop-rect-name">${I18N.t("loops.yourLoop")}</span>
      </div>`;
  }
  const others = opts && opts.ownUserId ? groups.filter((g) => g.userId !== opts.ownUserId) : groups;
  others.forEach((g) => {
    // Ring reads "unviewed" (colored/gold, same treatment the always-gold
    // .moment-rect-avatar border used to signal "new") as long as ANY of
    // this author's Loops hasn't been seen by the current viewer yet, and
    // flips to a plain/gray ring only once every one of them has - same
    // all-or-nothing rule Instagram/FB Stories use for a person's ring.
    const allViewed = g.loops.every((l) => l.viewed);
    const thumb = g.loops[0] && g.loops[0].mediaType === "photo" ? g.loops[0].mediaUrl : g.userPhoto;
    html += `
      <div class="loop-rect-wrap" data-uid="${g.userId}" style="${thumb ? `background-image:url('${thumb}')` : ""}">
        ${!thumb ? `<div class="loop-rect-placeholder">${initials(g.userName)}</div>` : ""}
        <span class="loop-rect-shade"></span>
        <div class="loop-rect-avatar ${allViewed ? "loop-rect-avatar-viewed" : "loop-rect-avatar-unviewed"}">
          ${g.userPhoto ? `<img src="${g.userPhoto}" />` : `<div class="loop-rect-avatar-placeholder">${initials(g.userName)}</div>`}
        </div>
        <span class="loop-rect-name">${escapeHtml(g.userName)}</span>
      </div>`;
  });
  containerEl.innerHTML = html;

  if (opts && opts.ownUserId) {
    const addCircle = document.getElementById("loop-add-circle");
    if (addCircle) {
      addCircle.addEventListener("click", () => {
        if (mine && mine.loops.length) {
          openLoopsViewer(mine.loops, 0, mine);
        } else {
          openCreateWizard("loop");
        }
      });
    }
    // The small "+" badge always opens the capture flow to add another Loop,
    // even if the user already has active ones - tapping the rest of the
    // circle views your current Loop(s), same split as the Moments bar's
    // add badge vs. circle.
    const addBadge = document.getElementById("loop-add-badge");
    if (addBadge) {
      addBadge.addEventListener("click", (e) => {
        e.stopPropagation();
        openCreateWizard("loop");
      });
    }
  }
  containerEl.querySelectorAll(".loop-rect-wrap[data-uid]").forEach((wrap) => {
    wrap.addEventListener("click", () => {
      const g = groups.find((x) => x.userId === wrap.dataset.uid);
      if (g) openLoopsViewer(g.loops, 0, g);
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

// Vertical-video-style action rail icons for the Moments story viewer: white
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
  if (context === "clips") pauseClipsPlayback();
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
  if (context === "clips") resumeClipsPlayback();
  else resumeMomentViewerPlayback();
}

function pauseClipsPlayback() {
  const videoEl = document.getElementById("clips-video");
  if (videoEl) videoEl.pause();
}

function resumeClipsPlayback() {
  const videoEl = document.getElementById("clips-video");
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
        <button class="moment-comments-close" id="moment-comments-close" aria-label="${I18N.t("common.close")}">&times;</button>
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
        <button class="moment-viewer-close" id="moment-viewer-close" aria-label="${I18N.t("common.close")}">&times;</button>
      </div>
      ${
        m.mediaType === "video"
          ? `<video class="moment-viewer-media" id="moment-viewer-media" src="${m.mediaUrl}" autoplay playsinline></video>${renderMediaOverlayLayer(m.overlays)}`
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
      const startProgressAnim = (durationMs) => {
        if (!fill) return;
        fill.style.transition = "none";
        fill.style.width = "0%";
        requestAnimationFrame(() => {
          fill.style.transition = "width " + durationMs + "ms linear";
          fill.style.width = "100%";
        });
      };
      // AI auto-clip (task #160): a trimmed Moment loops within its
      // suggested window instead of auto-advancing to the next story on
      // "ended" (it never reaches its real end - see wireMomentTrimLoop()).
      const trim = wireMomentTrimLoop(videoEl, m, () => startProgressAnim((trim.end - trim.start) * 1000));
      if (trim) {
        videoEl.addEventListener("loadedmetadata", () => startProgressAnim((trim.end - trim.start) * 1000));
      } else {
        videoEl.addEventListener("loadedmetadata", () => {
          if (videoEl.duration && isFinite(videoEl.duration)) startProgressAnim(videoEl.duration * 1000);
        });
        videoEl.addEventListener("ended", () => stepMomentViewer(1));
      }
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

// ---------------- Loops full-screen viewer ----------------
// Its own function rather than a second mode bolted onto
// openMomentsViewer()/drawMomentViewer() above: the interaction model is
// genuinely different (tap-to-advance + auto-advance timing vs. that
// viewer's like/message/share/repost/save action rail and follow button),
// and Loops has no equivalent of any of those social actions in v1 (see the
// scope note in the PR/report - out of scope for now, tap-through +
// seen/unseen + owner view count + delete is the full v1 feature set).
// Reuses the same overlay-back-button pattern (guardOverlayForBack /
// closeOverlayViaBack) as every other full-screen overlay in the app.
let loopViewerState = null; // { loops, index, group, viewedIds: Set<loopId> }
let loopViewerTimer = null; // photo auto-advance timer - always cleared before being reassigned or on close, so it can never leak or double-fire
const LOOP_PHOTO_DURATION_MS = 5000; // same fixed "how long a photo stays up" as the Moments viewer uses

function openLoopsViewer(loops, startIndex, group) {
  if (!loops || !loops.length) return;
  loopViewerState = { loops: loops.slice(), index: startIndex || 0, group, viewedIds: new Set() };
  const overlay = document.createElement("div");
  overlay.className = "loop-viewer-overlay";
  overlay.id = "loop-viewer-overlay";
  document.body.appendChild(overlay);
  guardOverlayForBack(closeLoopsViewer);
  drawLoopViewer();
}

function closeLoopsViewer() {
  if (loopViewerTimer) {
    clearTimeout(loopViewerTimer);
    loopViewerTimer = null;
  }
  const overlay = document.getElementById("loop-viewer-overlay");
  if (overlay) overlay.remove();
  loopViewerState = null;
}

function drawLoopViewer() {
  const overlay = document.getElementById("loop-viewer-overlay");
  if (!overlay || !loopViewerState) return;
  // Always clear any still-pending photo-advance timer before redrawing -
  // drawLoopViewer() is called both on navigation and after an in-place
  // mutation (delete), so without this a stale timer from the previous
  // loop could fire after the DOM (and its progress bar) has moved on.
  if (loopViewerTimer) {
    clearTimeout(loopViewerTimer);
    loopViewerTimer = null;
  }
  const { loops, index, group } = loopViewerState;
  const m = loops[index];
  const isOwn = state.user && m.userId === state.user.id;

  // Record the view once per loop per viewer-session (the endpoint is
  // idempotent server-side too, but no need to re-fire it every time the
  // user steps back and forth over the same loop in one sitting).
  if (!loopViewerState.viewedIds.has(m.id)) {
    loopViewerState.viewedIds.add(m.id);
    api("/api/loops/" + m.id + "/view", { method: "POST", auth: true }).catch(() => {});
  }

  const bars = loops
    .map((_, i) => `<div class="loop-viewer-progress-bar ${i < index ? "done" : ""}"><div class="loop-viewer-progress-fill" id="loop-progress-fill-${i}"></div></div>`)
    .join("");

  overlay.innerHTML = `
    <div class="loop-viewer-media-wrap">
      <div class="loop-viewer-progress">${bars}</div>
      <div class="loop-viewer-head">
        <button class="loop-viewer-head-link" id="loop-viewer-head-link" ${group && group.userId ? "" : "disabled"}>
          ${group && group.userPhoto ? `<img src="${group.userPhoto}" />` : ""}
          <span class="loop-viewer-head-name">${escapeHtml((group && group.userName) || "")}${group && group.isPage ? ` <span class="page-badge-inline">${I18N.t("pages.badge")}</span>` : ""}</span>
        </button>
        ${isOwn ? `<span class="loop-viewer-view-count" title="${I18N.t("loops.views")}">&#128065; ${m.viewCount || 0}</span>` : ""}
        <button class="loop-viewer-close" id="loop-viewer-close" aria-label="${I18N.t("common.close")}">&times;</button>
      </div>
      ${
        m.mediaType === "video"
          ? `<video class="loop-viewer-media" id="loop-viewer-media" src="${m.mediaUrl}" autoplay playsinline></video>`
          : `<img class="loop-viewer-media" id="loop-viewer-media" src="${m.mediaUrl}" />`
      }
      ${m.caption ? `<div class="loop-viewer-caption">${linkifyHashtags(escapeHtml(m.caption))}</div>` : ""}
      ${isOwn ? `<button class="loop-viewer-delete" id="loop-viewer-delete">${I18N.t("loops.delete")}</button>` : ""}
      <button class="loop-viewer-nav prev" id="loop-viewer-prev"></button>
      <button class="loop-viewer-nav next" id="loop-viewer-next"></button>
    </div>
  `;

  document.getElementById("loop-viewer-close").addEventListener("click", () => closeOverlayViaBack(closeLoopsViewer));
  document.getElementById("loop-viewer-prev").addEventListener("click", () => stepLoopViewer(-1));
  document.getElementById("loop-viewer-next").addEventListener("click", () => stepLoopViewer(1));
  const headLink = document.getElementById("loop-viewer-head-link");
  if (headLink && !headLink.disabled) {
    headLink.addEventListener("click", () => {
      const uid = group && group.userId;
      if (!uid) return;
      closeOverlayViaBack(closeLoopsViewer);
      location.hash = "#/profile/" + uid;
    });
  }
  const delBtn = document.getElementById("loop-viewer-delete");
  if (delBtn) {
    delBtn.addEventListener("click", async () => {
      if (!confirm(I18N.t("loops.confirmDelete"))) return;
      try {
        await api("/api/loops/" + m.id, { method: "DELETE", auth: true });
        loopViewerState.loops.splice(index, 1);
        if (!loopViewerState.loops.length) {
          closeOverlayViaBack(closeLoopsViewer);
          router();
          return;
        }
        loopViewerState.index = Math.min(index, loopViewerState.loops.length - 1);
        drawLoopViewer();
      } catch (e) {
        alert(e.message);
      }
    });
  }

  const fill = document.getElementById("loop-progress-fill-" + index);
  if (m.mediaType === "video") {
    const videoEl = document.getElementById("loop-viewer-media");
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
      videoEl.addEventListener("ended", () => stepLoopViewer(1));
    }
  } else {
    if (fill) {
      requestAnimationFrame(() => {
        fill.style.transition = "width " + LOOP_PHOTO_DURATION_MS + "ms linear";
        fill.style.width = "100%";
      });
    }
    loopViewerTimer = setTimeout(() => stepLoopViewer(1), LOOP_PHOTO_DURATION_MS);
  }
}

function stepLoopViewer(dir) {
  if (!loopViewerState) return;
  const next = loopViewerState.index + dir;
  if (next < 0) return;
  if (next >= loopViewerState.loops.length) {
    closeLoopsViewer();
    return;
  }
  loopViewerState.index = next;
  drawLoopViewer();
}

// ---------------- Shared vertical swipe-feed engine ----------------
// Both the full-screen "Clips" player ("#/clips": a TikTok-style takeover
// with the topbar/bottom nav hidden) and the inline Home feed (mixed
// photo+video moments, scrolling in normal document flow with the topbar
// and bottom nav still visible - see renderHome()/loadHomeSwipeFeed() far
// below) show the same ranked list from /api/moments/videos/feed and need
// identical per-item rendering, swipe/wheel gestures, and watch-time
// reporting. Every function here takes an explicit swipe-feed state object
// (called `sw` below - NOT the unrelated global session `state`, which is
// why the param isn't named `state`) shaped like
// { videos, index, rootEl, closable, watchStart, currentDurationMs } so the
// two surfaces run as fully independent instances instead of fighting over
// one global. `clipsState` (the full-screen player) and `homeSwipeState`
// (the inline Home feed) are the two live instances of that shape.

// A photo has no natural "duration" to wait out the way a video does, so a
// swipe-away after roughly this long counts as "watched it", short of that
// counts as a "skip" - the same complete/skip signal the ranking in
// /api/moments/videos/feed already consumes for videos, just fed a fixed
// nominal duration instead of a real one (see reportSwipeWatch()).
const SWIPE_PHOTO_DWELL_MS = 4000;

let clipsState = null;
let homeSwipeState = null;

async function renderClips() {
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  let videos = [];
  try {
    videos = await api("/api/moments/videos/feed", { auth: true });
  } catch (e) {}
  if (!videos.length) {
    viewEl.innerHTML = `<div class="empty-state">${I18N.t("clips.empty")}</div>`;
    return;
  }
  viewEl.innerHTML = "";
  openClipsPlayer(videos, 0);
}

function openClipsPlayer(videos, startIndex) {
  const overlay = document.createElement("div");
  overlay.className = "clips-overlay";
  overlay.id = "clips-overlay";
  document.body.appendChild(overlay);
  clipsState = { videos, index: startIndex || 0, rootEl: overlay, closable: true };
  drawSwipeItem(clipsState);
  wireSwipeGestures(overlay, clipsState);
}

// Shared close path for any closable swipe-feed instance (today only the
// full-screen Clips overlay sets closable:true - the inline Home feed has
// no "X", it just scrolls away). Reports the outgoing item's watch time,
// tears down the overlay DOM, and - only for the Clips instance
// specifically - resets the "#/clips" hash back to Home.
function closeSwipeFeed(sw) {
  reportSwipeWatch(sw);
  if (sw && sw.closable && sw.rootEl) sw.rootEl.remove();
  if (sw === clipsState) {
    clipsState = null;
    if (location.hash.startsWith("#/clips")) location.hash = "#/";
  }
}

function closeClipsPlayer() {
  closeSwipeFeed(clipsState);
}

// ---- Videos hub (task #231) - general-purpose long-form video section,
// reached from the Marketplace nav dropdown (#/videos). Deliberately a
// normal scrollable page (thumbnail grid + a plain watch page below), NOT
// the full-screen swipe player Moments/Clips use - short-form passive
// scroll and long-form active browsing are different mental modes and stay
// visually separate on purpose (see server.js's is_long_video split). Every
// video here really is an mkt_moments row under the hood, so likes/saves/
// comments reuse the exact same /api/moments/:id/... endpoints as Moments -
// the watch page below renders them with the same #moment-viewer-* element
// ids wireMomentViewerActions()/openMomentComments() already know how to
// wire, instead of duplicating that logic. ----

async function renderVideosFeed() {
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  let videos = [];
  try {
    videos = await api("/api/videos/feed");
  } catch (e) {}
  viewEl.innerHTML = `
    <div style="margin:16px;">
      <h1 class="section-heading">${I18N.t("videos.feedTitle")}</h1>
      ${
        videos.length
          ? `<div class="videos-grid">${videos.map(videoCardHtml).join("")}</div>`
          : `<div class="empty-state">${I18N.t("videos.empty")}</div>`
      }
    </div>
  `;
}

function videoCardHtml(v) {
  return `
    <a class="video-card" href="#/videos/${v.id}">
      <div class="video-card-thumb-wrap">
        <video class="video-card-thumb" src="${v.mediaUrl}#t=0.1" muted preload="metadata"></video>
      </div>
      <div class="video-card-body">
        <p class="video-card-title">${escapeHtml(v.title || "")}</p>
        <a class="video-card-channel" href="#/profile/${v.userId}" onclick="event.stopPropagation()">${escapeHtml(v.userName || "")}</a>
        <p class="video-card-meta">\u{2764}\u{FE0F} ${v.likeCount || 0} &middot; ${fmtDate(v.createdAt)}</p>
      </div>
    </a>
  `;
}

// Small horizontal strip used on a product detail page ("Related videos") -
// hidden entirely (returns "") when there are none, per task #231's spec.
function relatedVideosStripHtml(videos) {
  if (!videos || !videos.length) return "";
  return `
    <div class="related-videos-section">
      <h2 class="section-heading" style="margin-bottom:10px;">${I18N.t("videos.relatedTitle")}</h2>
      <div class="related-videos-row">
        ${videos
          .map(
            (v) => `
          <a class="related-video-card" href="#/videos/${v.id}">
            <video class="related-video-thumb" src="${v.mediaUrl}#t=0.1" muted preload="metadata"></video>
            <span class="related-video-title">${escapeHtml(v.title || "")}</span>
          </a>`
          )
          .join("")}
      </div>
    </div>
  `;
}

async function renderVideoWatch(id) {
  viewEl.innerHTML = `<p>${I18N.t("common.loading")}</p>`;
  let v;
  try {
    v = await api("/api/moments/" + id);
  } catch (e) {
    viewEl.innerHTML = `<p class="form-msg error">${I18N.t("videos.notFound")}</p>`;
    return;
  }
  if (!v || !v.isLongVideo) {
    viewEl.innerHTML = `<p class="form-msg error">${I18N.t("videos.notFound")}</p>`;
    return;
  }
  let linkedProduct = null;
  if (v.linkedProductId) {
    try {
      linkedProduct = await api("/api/products/" + v.linkedProductId);
    } catch (e) {}
  }
  const isOwn = state.user && state.user.id === v.userId;

  viewEl.innerHTML = `
    <div class="video-watch-wrap" id="moment-viewer-overlay">
      <div class="video-watch-player-wrap">
        <video class="video-watch-player" id="moment-viewer-media" src="${v.mediaUrl}" controls playsinline></video>
        ${renderMediaOverlayLayer(v.overlays)}
      </div>
      <div class="video-watch-body">
        <h1 class="video-watch-title">${escapeHtml(v.title || "")}</h1>
        <a class="video-watch-channel" href="#/profile/${v.userId}">
          ${v.userPhoto ? `<img class="video-watch-avatar" src="${v.userPhoto}" />` : `<div class="video-watch-avatar-placeholder">${initials(v.userName)}</div>`}
          <span>${escapeHtml(v.userName || "")}${v.isPage ? ` <span class="page-badge-inline">${I18N.t("pages.badge")}</span>` : ""}</span>
        </a>
        <div class="video-watch-actions">
          <button class="video-watch-action-btn ${v.liked ? "active" : ""}" id="moment-viewer-like">${MOMENT_ICON_HEART} <span>${v.likeCount || 0}</span></button>
          <button class="video-watch-action-btn" id="moment-viewer-message">${MOMENT_ICON_MESSAGE} <span>${I18N.t("videos.comments")}</span></button>
          <button class="video-watch-action-btn ${v.saved ? "active" : ""}" id="moment-viewer-save">${MOMENT_ICON_SAVE} <span>${I18N.t("saved.save")}</span></button>
          <button class="video-watch-action-btn" id="moment-viewer-share">${MOMENT_ICON_SHARE} <span>${I18N.t("videos.share")}</span></button>
        </div>
        ${v.caption ? `<p class="video-watch-caption">${linkifyHashtags(escapeHtml(v.caption))}</p>` : ""}
        ${
          linkedProduct
            ? `<a class="video-watch-product-card" href="#/product/${linkedProduct.id}">
                 ${linkedProduct.photos && linkedProduct.photos[0] ? `<img src="${linkedProduct.photos[0]}" />` : `<div class="product-thumb-empty">\u{1F4E6}</div>`}
                 <div>
                   <p class="field-hint">${I18N.t("videos.linkedProductLabel")}</p>
                   <p class="video-watch-product-title">${escapeHtml(linkedProduct.title)}</p>
                   <p class="product-price">${fmtPrice(linkedProduct.price)}</p>
                 </div>
               </a>`
            : ""
        }
        ${isOwn ? `<div class="action-row"><button class="btn btn-danger" id="video-watch-delete">${I18N.t("moments.delete")}</button></div>` : ""}
      </div>
    </div>
  `;
  wireMomentViewerActions(v);
  const delBtn = document.getElementById("video-watch-delete");
  if (delBtn) {
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this video? / ¿Eliminar este video?")) return;
      try {
        await api("/api/moments/" + v.id, { method: "DELETE", auth: true });
        location.hash = "#/profile";
      } catch (e) {
        alert(e.message);
      }
    });
  }
}

// Reports how the viewer engaged with the item currently on screen -
// "complete" if they stuck around for most of it (video loops, so a
// near-full watch counts even without a real "ended" event; photos use the
// fixed SWIPE_PHOTO_DWELL_MS above), "skip" otherwise. Called right before
// we move away from an item, feeding the affinity/popularity signals the
// v2 ranking in /api/moments/videos/feed uses.
function reportSwipeWatch(sw) {
  if (!sw) return;
  const v = sw.videos[sw.index];
  if (!v || !sw.watchStart) return;
  const watchMs = Date.now() - sw.watchStart;
  const durationMs = sw.currentDurationMs || 0;
  const type = durationMs && watchMs >= durationMs * 0.85 ? "complete" : "skip";
  api("/api/moments/" + v.id + "/event", { method: "POST", auth: true, body: { type, watchMs, durationMs } }).catch(() => {});
  sw.watchStart = null;
}

function toggleSwipeLike(sw) {
  if (!sw) return;
  if (!state.token) {
    location.hash = "#/login";
    return;
  }
  const v = sw.videos[sw.index];
  const wasLiked = v.liked;
  v.liked = !wasLiked;
  v.likeCount = Math.max(0, (v.likeCount || 0) + (v.liked ? 1 : -1));
  updateSwipeLikeUI(sw);
  api("/api/moments/" + v.id + "/like", { method: v.liked ? "POST" : "DELETE", auth: true, body: {} }).catch(() => {
    v.liked = wasLiked;
    v.likeCount = Math.max(0, (v.likeCount || 0) + (wasLiked ? 1 : -1));
    updateSwipeLikeUI(sw);
  });
  if (v.liked) {
    api("/api/moments/" + v.id + "/event", { method: "POST", auth: true, body: { type: "like" } }).catch(() => {});
  }
}

function updateSwipeLikeUI(sw) {
  if (!sw) return;
  const v = sw.videos[sw.index];
  const btn = document.getElementById("clips-like");
  const countEl = document.getElementById("clips-like-count");
  if (btn) btn.classList.toggle("active", !!v.liked);
  if (countEl) countEl.textContent = v.likeCount || 0;
}

// Comment/share/repost/save for a swipe-feed item - mirrors
// wireMomentViewerActions() so all three surfaces (story viewer, Clips,
// Home) behave identically (optimistic toggle, revert on failure, same
// icon set and "active" styling).
function wireSwipeActions(sw, v) {
  const msgBtn = document.getElementById("clips-message");
  if (msgBtn) {
    msgBtn.addEventListener("click", () => {
      flashMomentAction(msgBtn);
      openMomentComments(v, sw.rootEl.id, "clips");
    });
  }

  const shareBtn = document.getElementById("clips-share");
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

  const repostBtn = document.getElementById("clips-repost");
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

  const saveBtn = document.getElementById("clips-save");
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

function burstSwipeHeart(sw) {
  const item = sw.rootEl.querySelector(".clips-item");
  if (!item) return;
  const heart = document.createElement("div");
  heart.className = "clips-heart-burst";
  heart.textContent = "❤️";
  item.appendChild(heart);
  setTimeout(() => heart.remove(), 900);
}

// Renders the currently-indexed item of `sw` into sw.rootEl - a photo
// <img> or a video <video>, plus the shared author/caption/action-rail
// chrome. `sw.closable` controls whether the full-screen-only "X" close
// button is included (see closeSwipeFeed() above).
function drawSwipeItem(sw) {
  const root = sw.rootEl;
  if (!root) return;
  const { videos, index } = sw;
  const v = videos[index];
  const isOwn = state.user && v.userId === state.user.id;
  const showFollow = v.isPage && state.token && !isOwn;
  const isPhoto = v.mediaType !== "video";

  root.innerHTML = `
    <div class="clips-item">
      ${
        isPhoto
          ? `<img class="clips-video clips-photo" id="clips-video" src="${v.mediaUrl}" />`
          : `<video class="clips-video" id="clips-video" src="${v.mediaUrl}" autoplay loop playsinline></video>${renderMediaOverlayLayer(v.overlays)}`
      }
      ${sw.closable ? `<button class="clips-close" id="clips-close" aria-label="${I18N.t("common.close")}">&times;</button>` : ""}
      <div class="clips-info">
        <a class="clips-author-link" href="#/profile/${v.userId}">
          ${v.userPhoto ? `<img class="clips-avatar" src="${v.userPhoto}" />` : `<div class="clips-avatar-placeholder">${initials(v.userName)}</div>`}
          <span class="clips-author">${escapeHtml(v.userName)}${v.isPage ? ` <span class="page-badge-inline">${I18N.t("pages.badge")}</span>` : ""}</span>
        </a>
        ${v.caption ? `<p class="clips-caption">${linkifyHashtags(escapeHtml(v.caption))}</p>` : ""}
        ${showFollow ? `<button class="btn-follow-inline clips-follow" id="clips-follow">${I18N.t("subs.subscribe")}</button>` : ""}
      </div>
      <div class="clips-actions-col">
        <div class="clips-action">
          <button class="moment-viewer-action-btn like-btn ${v.liked ? "active" : ""}" id="clips-like" title="${I18N.t("moments.actionLike") || "Like"}">${MOMENT_ICON_HEART}</button>
          <span class="clips-action-count" id="clips-like-count">${v.likeCount || 0}</span>
        </div>
        <div class="clips-action">
          <button class="moment-viewer-action-btn" id="clips-message" title="${I18N.t("moments.actionMessage") || "Message"}">${MOMENT_ICON_MESSAGE}</button>
        </div>
        <div class="clips-action">
          <button class="moment-viewer-action-btn" id="clips-share" title="${I18N.t("moments.actionShare") || "Share"}">${MOMENT_ICON_SHARE}</button>
        </div>
        <div class="clips-action">
          <button class="moment-viewer-action-btn repost-btn" id="clips-repost" title="${I18N.t("moments.actionRepost") || "Repost"}">${MOMENT_ICON_REPOST}</button>
        </div>
        <div class="clips-action">
          <button class="moment-viewer-action-btn save-btn ${v.saved ? "active" : ""}" id="clips-save" title="${I18N.t("moments.actionSave") || "Save"}">${MOMENT_ICON_SAVE}</button>
        </div>
      </div>
    </div>
  `;

  const closeBtn = document.getElementById("clips-close");
  if (closeBtn) closeBtn.addEventListener("click", () => closeSwipeFeed(sw));
  const likeBtn = document.getElementById("clips-like");
  if (likeBtn) likeBtn.addEventListener("click", () => toggleSwipeLike(sw));
  wireSwipeActions(sw, v);

  sw.watchStart = Date.now();
  sw.currentDurationMs = isPhoto ? SWIPE_PHOTO_DWELL_MS : 0;

  const mediaEl = document.getElementById("clips-video");
  if (mediaEl && !isPhoto) {
    mediaEl.muted = false;
    mediaEl.volume = 1;
    mediaEl.addEventListener("loadedmetadata", () => {
      if (sw.videos[sw.index] === v) sw.currentDurationMs = (mediaEl.duration || 0) * 1000;
    });
    // AI auto-clip (task #160): loop within the trim window if this Moment
    // has one, same as everywhere else its video plays.
    wireMomentTrimLoop(mediaEl, v);
  }
  if (mediaEl) {
    let lastTap = 0;
    mediaEl.addEventListener("click", () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        const cur = sw.videos[sw.index];
        if (!cur.liked) toggleSwipeLike(sw);
        burstSwipeHeart(sw);
      }
      lastTap = now;
    });
  }

  const followBtn = document.getElementById("clips-follow");
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

function stepSwipeFeed(sw, dir) {
  if (!sw) return;
  const next = sw.index + dir;
  if (next < 0 || next >= sw.videos.length) return;
  reportSwipeWatch(sw);
  sw.index = next;
  drawSwipeItem(sw);
}

// ---- Vertical swipe navigation (TikTok/Reels style), shared by the
// full-screen Clips overlay and the inline Home feed ----
// The current item visibly follows the finger as you drag, then either
// completes the transition to the next/previous item on release or snaps
// back if the swipe was too short. This (plus the wheel handler) is the
// only way to move between items - there are no up/down arrow buttons.
function wireSwipeGestures(rootEl, sw) {
  rootEl.addEventListener(
    "wheel",
    (e) => {
      if (rootEl.dataset.wheelLock === "1") return;
      rootEl.dataset.wheelLock = "1";
      setTimeout(() => (rootEl.dataset.wheelLock = "0"), 500);
      if (e.deltaY > 30) stepSwipeFeed(sw, 1);
      else if (e.deltaY < -30) stepSwipeFeed(sw, -1);
    },
    { passive: true }
  );

  let touchStartY = null;
  let touchStartX = null;
  let dragging = false;
  let lockedAxis = null; // "y" | "x" | null - decided a few px into the gesture

  rootEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
      dragging = true;
      lockedAxis = null;
      const item = rootEl.querySelector(".clips-item");
      if (item) item.style.transition = "none";
    },
    { passive: true }
  );

  rootEl.addEventListener(
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
      const atFirst = sw.index === 0 && dy > 0;
      const atLast = sw.index === sw.videos.length - 1 && dy < 0;
      const damped = atFirst || atLast ? dy * 0.35 : dy;
      const item = rootEl.querySelector(".clips-item");
      if (item) item.style.transform = `translateY(${damped}px)`;
    },
    { passive: false }
  );

  rootEl.addEventListener(
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
      const item = rootEl.querySelector(".clips-item");
      const THRESHOLD = 60;
      if (dy < -THRESHOLD) {
        stepSwipeFeed(sw, 1);
      } else if (dy > THRESHOLD) {
        stepSwipeFeed(sw, -1);
      } else if (item) {
        item.style.transition = "transform 0.2s ease";
        item.style.transform = "translateY(0)";
      }
    },
    { passive: true }
  );
}

const MAX_ACTIVE_MOMENTS = 3;
const MAX_MOMENT_VIDEO_SECONDS = 90; // matches Instagram Reels cap
// Client-side mirrors of server.js's MAX_ACTIVE_MOMENTS (reused as-is for
// Loops' active-count cap - see server.js) and MAX_LOOP_VIDEO_SECONDS, kept
// in sync by hand the same way MAX_MOMENT_VIDEO_SECONDS above already is.
const MAX_LOOP_VIDEO_SECONDS = 20; // matches Stories-style short clips
// Long-form "Videos" hub (task #231) - client-side mirror of server.js's
// MAX_LONG_VIDEO_SECONDS, kept in sync by hand same as the two above.
const MAX_LONG_VIDEO_SECONDS = 1200;

// Max video length for the current create-wizard target - used everywhere
// the wizard needs to know its own cap (the hold-record ring, the
// gallery-upload duration probe) instead of each call site re-deriving it.
function wizardMaxVideoSeconds() {
  if (createWizard && createWizard.target === "loop") return MAX_LOOP_VIDEO_SECONDS;
  if (createWizard && createWizard.target === "video") return MAX_LONG_VIDEO_SECONDS;
  return MAX_MOMENT_VIDEO_SECONDS;
}

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

  // No more upfront "already have 3 active moments" block - Moments are
  // permanent now and the server no longer caps how many a user can post
  // (see server.js POST /api/moments). MAX_ACTIVE_MOMENTS is kept defined
  // below only because the upcoming "Loops" (24h stories) feature will
  // likely want an equivalent small-active-items cap.

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

const CREATE_WIZARD_STICKERS = ["\u{1F600}", "\u{1F602}", "\u{1F60D}", "\u{1F525}", "\u{1F389}", "\u{1F4DA}", "❤️", "\u{1F44D}", "\u{1F60E}", "✨", "\u{1F973}", "\u{1F4D6}"];

// Task #204 - text overlay preset colors (white/black first so there's
// always a readable choice against any background) and the three-step
// size scale shared by both text and sticker overlays (in the wizard editor
// and again wherever a video with baked-in overlay metadata is played back).
const WIZARD_TEXT_COLORS = ["#FFFFFF", "#000000", "#FFD84D", "#FF3B30", "#34C759", "#0A84FF"];
const WIZARD_OVERLAY_SIZE_STEPS = ["sm", "md", "lg"];
const WIZARD_OVERLAY_SIZE_SCALE = { sm: 0.7, md: 1, lg: 1.4 };

// Task #203 - procedurally-generated (Web Audio API oscillators, not
// licensed/recorded audio - see playWizardSoundPreset()) background sound
// presets offered from the create-wizard's "Add sound" pill.
const WIZARD_SOUND_PRESETS = ["none", "upbeat", "chill", "dramatic", "retro"];

const WIZARD_HOLD_THRESHOLD_MS = 380;
// Below this much accumulated hold time, a press is treated as an oversized
// tap rather than an intentional video, and the shutter falls back to
// taking a photo (see pauseHoldRecording()).
const WIZARD_MIN_INTENTIONAL_HOLD_MS = 500;

// Max hold-record duration for the current wizard session's target - a
// function rather than a fixed constant (the old WIZARD_RING_TARGET_MS)
// specifically so a Loop capture stops recording at MAX_LOOP_VIDEO_SECONDS
// (and, since task #231, a "video" capture at MAX_LONG_VIDEO_SECONDS)
// instead of letting the user hold for the full Moment length.
function wizardRingTargetMs() {
  return wizardMaxVideoSeconds() * 1000;
}

function createWizardFilterCss(id) {
  const f = CREATE_WIZARD_FILTERS.find((x) => x.id === id);
  return f ? f.css : "";
}

// Task #202 - the live camera <video> preview's filter combines the chosen
// look (CREATE_WIZARD_FILTERS) with the manual brightness/exposure slider.
// Photos bake this in at capture time (see takePhoto()'s ctx.filter); video
// recording does NOT bake it in - MediaRecorder here records straight off
// createWizard.stream (the raw camera MediaStream), and a CSS filter on the
// <video> preview element never reaches captureStream()/track data, so for
// video captures this only affects what the creator sees while framing the
// shot, not the saved file. See wireWizardCaptureGesture()/beginHoldRecording().
function wizardLiveFilterCss() {
  const base = createWizardFilterCss(createWizard.filter);
  const brightness = "brightness(" + (createWizard.brightness || 100) + "%)";
  return base ? base + " " + brightness : brightness;
}

let createWizard = null;

function stopCreateWizardCamera() {
  if (createWizard) stopWizardRing();
  if (createWizard && createWizard.stream) {
    createWizard.stream.getTracks().forEach((t) => t.stop());
    createWizard.stream = null;
  }
  if (createWizard && createWizard.recorder && createWizard.recorder.state !== "inactive") {
    try {
      createWizard.recorder.stop();
    } catch (e) {}
  }
  // Safety net for task #203's sound-preset mixing graph - normally already
  // torn down in finalizeWizardVideo()/the discarded-tiny-hold path below,
  // but this covers any exit (e.g. closing the wizard mid-recording).
  stopWizardSoundMix();
}

function closeCreateWizard() {
  stopCreateWizardCamera();
  const overlay = document.getElementById("create-wizard-overlay");
  if (overlay) overlay.remove();
  createWizard = null;
}

// `target` distinguishes what the wizard's final publish step posts to:
// "moment" (default - POST /api/moments), "loop" (POST /api/loops, see the
// "Loop" option in the create dropdown), or "video" (task #231 - the
// long-form Videos hub, still POST /api/moments but with target:"video" in
// the body - see server.js). Every other step of the wizard (capture,
// filters, caption) behaves identically across all three - only the
// publish call, the video-length cap, and a couple of extra fields/steps
// (title, link-to-product) branch on it - see the wizard-publish click
// handler and the step-4 branch in drawCreateWizard().
function openCreateWizard(target) {
  if (!state.token) {
    location.hash = "#/login";
    return;
  }
  const resolvedTarget = target === "loop" ? "loop" : target === "video" ? "video" : "moment";
  createWizard = {
    step: 1, filter: "none", mediaType: null, rawDataUrl: null, recording: false,
    stream: null, recorder: null, chunks: [], durationSeconds: null,
    facingMode: "user", flashOn: false, timerMode: 0,
    recordAccumMs: 0, segmentStartTs: null, holdArmed: false, holdTimer: null, ringRaf: null,
    overlays: [], gridOn: false, target: resolvedTarget,
    // Task #202 - live preview/capture exposure, 50-150%, default 100
    // (no adjustment). Lives on createWizard so it survives multiple shots
    // within one wizard session, and is reset back to 100 automatically
    // every time openCreateWizard() rebuilds a fresh createWizard object.
    brightness: 100,
    // Task #203 - chosen background-sound preset id (see
    // WIZARD_SOUND_PRESETS) and whether the mic track is kept alongside it
    // when mixing into a recorded video. Reset the same way as brightness.
    soundPreset: "none", soundKeepMic: true,
    // AI auto-clip (task #160): the trim window the creator confirmed, if
    // any - both null means "publish the full video". Set from a
    // POST /api/ai/suggest-clip suggestion in step 3; see wireWizardAiClip().
    clipStartSec: null, clipEndSec: null,
    // Long-form Videos hub (task #231, target:"video" only) - title is
    // required, linkedProductId is an optional pointer to one of the
    // poster's own mkt_products rows chosen in the step-4 "link to a
    // listing?" screen (see drawCreateWizardStep4()). myProducts caches
    // that screen's GET /api/products?sellerId=<me> fetch across
    // back/forward navigation within the wizard so it isn't re-fetched
    // every time the user steps back and forward again.
    titleDraft: "", captionDraft: "", hashtagsDraft: "",
    linkedProductId: null, myProducts: null, finalMedia: null,
  };
  const overlay = document.createElement("div");
  overlay.id = "create-wizard-overlay";
  document.body.appendChild(overlay);
  guardOverlayForBack(closeCreateWizard);
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

function wizardFormatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

function stopWizardRing() {
  if (createWizard.ringRaf) cancelAnimationFrame(createWizard.ringRaf);
  createWizard.ringRaf = null;
}

function startWizardRing() {
  const circle = document.getElementById("wizard-fs-ring-circle");
  const timeLabel = document.getElementById("wizard-fs-rec-time");
  const R = 30;
  const C = 2 * Math.PI * R;
  const tick = () => {
    if (!createWizard || !createWizard.recording) return;
    const elapsed = createWizard.recordAccumMs + (Date.now() - createWizard.segmentStartTs);
    const frac = Math.min(1, elapsed / wizardRingTargetMs());
    if (circle) circle.style.strokeDashoffset = String(C * (1 - frac));
    if (timeLabel) timeLabel.textContent = wizardFormatTime(elapsed);
    if (frac >= 1) {
      finalizeWizardRecording();
      return;
    }
    createWizard.ringRaf = requestAnimationFrame(tick);
  };
  tick();
}

function updateWizardSideRailEnabled() {
  const locked = createWizard.recordAccumMs > 0 || createWizard.recording;
  ["flip", "flash", "timer"].forEach((a) => {
    const el = document.getElementById("wizard-rail-" + a);
    if (el) el.disabled = locked;
  });
  // Task #203 - the sound preset/mic choice feeds the audio graph built at
  // the start of a recording (see buildWizardRecordingStream()); changing
  // it mid-clip wouldn't affect audio already recorded, so lock it out
  // while a hold-recording is in progress or accumulating to avoid a
  // misleading "I changed the sound" UI state.
  const soundPill = document.getElementById("wizard-fs-sound-pill");
  if (soundPill) soundPill.disabled = locked;
}

function showWizardRecBadge(show) {
  const el = document.getElementById("wizard-fs-rec-badge");
  if (el) el.style.display = show ? "flex" : "none";
}

function updateWizardHint(text) {
  const el = document.getElementById("wizard-fs-hint");
  if (el) el.textContent = text;
}

function updateWizardFlashSupport() {
  const btn = document.getElementById("wizard-rail-flash");
  if (!btn || !createWizard.stream) return;
  const track = createWizard.stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  btn.style.display = caps && caps.torch ? "flex" : "none";
  if (!(caps && caps.torch)) createWizard.flashOn = false;
}

function wizardToggleGrid() {
  createWizard.gridOn = !createWizard.gridOn;
  const gridEl = document.getElementById("wizard-fs-grid");
  if (gridEl) gridEl.classList.toggle("show", createWizard.gridOn);
  const btn = document.getElementById("wizard-rail-grid");
  if (btn) btn.classList.toggle("active", createWizard.gridOn);
}

// Task #202 - toggles the brightness/exposure slider panel over the live
// camera preview. The slider itself lives in the step-1 markup (see
// drawCreateWizard()) and is wired in wireWizardBrightnessPanel() below.
function wizardToggleBrightnessPanel() {
  const panel = document.getElementById("wizard-fs-brightness-panel");
  if (!panel) return;
  const show = panel.hidden;
  panel.hidden = !show;
  const btn = document.getElementById("wizard-rail-lighting");
  if (btn) btn.classList.toggle("active", show);
}

function wireWizardBrightnessPanel() {
  const slider = document.getElementById("wizard-fs-brightness-slider");
  const valueEl = document.getElementById("wizard-fs-brightness-value");
  if (!slider) return;
  slider.addEventListener("input", () => {
    createWizard.brightness = parseInt(slider.value, 10) || 100;
    if (valueEl) valueEl.textContent = createWizard.brightness + "%";
    const video = document.getElementById("wizard-fs-video");
    if (video) video.style.filter = wizardLiveFilterCss();
  });
}

function wizardToggleFlash() {
  if (!createWizard.stream) return;
  const track = createWizard.stream.getVideoTracks()[0];
  if (!track || !track.getCapabilities || !track.getCapabilities().torch) return;
  createWizard.flashOn = !createWizard.flashOn;
  track.applyConstraints({ advanced: [{ torch: createWizard.flashOn }] }).catch(() => {});
  const btn = document.getElementById("wizard-rail-flash");
  if (btn) btn.classList.toggle("active", createWizard.flashOn);
}

function wizardCycleTimer() {
  createWizard.timerMode = createWizard.timerMode === 0 ? 3 : createWizard.timerMode === 3 ? 10 : 0;
  const btn = document.getElementById("wizard-rail-timer");
  if (btn) {
    btn.classList.toggle("active", createWizard.timerMode !== 0);
    const icon = btn.querySelector(".rail-icon");
    if (icon) icon.innerHTML = createWizard.timerMode === 0 ? "&#9201;" : createWizard.timerMode + "s";
  }
}

function wizardShowToast(text) {
  const wrap = document.getElementById("wizard-fs-video-wrap");
  if (!wrap) return;
  const existing = wrap.querySelector(".wizard-fs-toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "wizard-fs-toast";
  el.textContent = text;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function wizardToggleFilterStrip() {
  const strip = document.querySelector(".wizard-fs-filter-rail");
  if (strip) strip.hidden = !strip.hidden;
}

// ---- Task #203: procedurally-generated sound presets (Web Audio API) ----
// Every preset is built from plain oscillator/gain nodes at call time - no
// audio files, no samples, no third-party/commercial music of any kind, so
// there's no licensing/IP exposure. `destGain` is the GainNode the preset's
// oscillators should feed (either a live speaker preview node, or the
// GainNode inside the recording mix graph built by buildWizardRecordingStream()
// below). Returns a stop() function that tears down every node/timer it
// created; callers are responsible for calling it exactly once when the
// preset should end.
function playWizardSoundPreset(audioCtx, presetId, destGain) {
  if (!presetId || presetId === "none") return () => {};
  const stopFns = [];

  function makeOsc(type, freq) {
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = audioCtx.createGain();
    g.gain.value = 0.0001;
    osc.connect(g).connect(destGain);
    osc.start();
    stopFns.push(() => {
      try { osc.stop(); } catch (e) {}
      try { osc.disconnect(); } catch (e) {}
      try { g.disconnect(); } catch (e) {}
    });
    return { osc, gain: g };
  }

  function pluckLoop(type, notes, stepMs, peakGain, decayMs) {
    const { osc, gain } = makeOsc(type, notes[0]);
    let step = 0;
    const iv = setInterval(() => {
      const t = audioCtx.currentTime;
      const f = notes[step % notes.length];
      osc.frequency.setValueAtTime(f, t);
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(peakGain, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decayMs / 1000);
      step++;
    }, stepMs);
    stopFns.push(() => clearInterval(iv));
  }

  if (presetId === "upbeat") {
    // Bright square-wave arpeggio, quick tempo.
    pluckLoop("square", [330, 392, 440, 392], 260, 0.22, 0.18);
  } else if (presetId === "chill") {
    // Slow sine pad with a gentle volume swell, no percussive beat.
    const { osc, gain } = makeOsc("sine", 220);
    const osc2 = audioCtx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = 330;
    const g2 = audioCtx.createGain();
    g2.gain.value = 0.06;
    osc2.connect(g2).connect(destGain);
    osc2.start();
    stopFns.push(() => {
      try { osc2.stop(); } catch (e) {}
      try { osc2.disconnect(); } catch (e) {}
      try { g2.disconnect(); } catch (e) {}
    });
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 1.5);
    const iv = setInterval(() => {
      const t = audioCtx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0.05, t + 2);
      gain.gain.linearRampToValueAtTime(0.14, t + 4);
    }, 4000);
    stopFns.push(() => clearInterval(iv));
  } else if (presetId === "dramatic") {
    // Low sawtooth drone that slowly bends, tension-building.
    const { osc, gain } = makeOsc("sawtooth", 80);
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 2);
    const iv = setInterval(() => {
      osc.frequency.linearRampToValueAtTime(55 + Math.random() * 45, audioCtx.currentTime + 1.4);
    }, 1500);
    stopFns.push(() => clearInterval(iv));
  } else if (presetId === "retro") {
    // Fast stepped square-wave arpeggio, 8-bit game vibe.
    pluckLoop("square", [440, 523, 587, 659, 523], 150, 0.16, 0.12);
  }

  return () => stopFns.forEach((fn) => fn());
}

// Short (~1.2s) speaker preview of a preset, played through the device's own
// output rather than mixed into any recording - used by the sound picker so
// a creator can hear a preset before committing to it.
function wizardPreviewSoundPreset(presetId) {
  if (!presetId || presetId === "none") return;
  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtxClass) return;
  try {
    const ctx = new AudioCtxClass();
    const gain = ctx.createGain();
    gain.gain.value = 0.3;
    gain.connect(ctx.destination);
    const stop = playWizardSoundPreset(ctx, presetId, gain);
    setTimeout(() => {
      stop();
      ctx.close().catch(() => {});
    }, 1200);
  } catch (e) {}
}

function updateWizardSoundPillLabel() {
  const pill = document.getElementById("wizard-fs-sound-pill");
  if (!pill) return;
  const label = createWizard.soundPreset && createWizard.soundPreset !== "none" ? I18N.t("camera.soundPicker." + createWizard.soundPreset) : I18N.t("create.addSound");
  pill.innerHTML = "&#9835; " + label;
}

function wizardOpenSoundPicker() {
  const existing = document.getElementById("wizard-sound-picker");
  if (existing) {
    existing.remove();
    return;
  }
  const wrap = document.getElementById("wizard-fs-video-wrap");
  if (!wrap) return;
  const panel = document.createElement("div");
  panel.className = "wizard-sound-picker";
  panel.id = "wizard-sound-picker";
  panel.innerHTML = `
    <p class="wizard-sound-picker-title">${I18N.t("camera.soundPicker.title")}</p>
    <div class="wizard-sound-picker-list">
      ${WIZARD_SOUND_PRESETS.map(
        (p) => `<button type="button" class="wizard-sound-preset-btn ${createWizard.soundPreset === p ? "active" : ""}" data-preset="${p}">${I18N.t("camera.soundPicker." + p)}</button>`
      ).join("")}
    </div>
    <label class="wizard-sound-mic-toggle">
      <input type="checkbox" id="wizard-sound-keep-mic" ${createWizard.soundKeepMic ? "checked" : ""} />
      ${I18N.t("camera.soundPicker.keepMic")}
    </label>
    <button type="button" class="wizard-sound-picker-close" id="wizard-sound-picker-close">${I18N.t("common.close")}</button>
  `;
  wrap.appendChild(panel);
  panel.querySelectorAll(".wizard-sound-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      createWizard.soundPreset = btn.dataset.preset;
      panel.querySelectorAll(".wizard-sound-preset-btn").forEach((b) => b.classList.toggle("active", b.dataset.preset === createWizard.soundPreset));
      updateWizardSoundPillLabel();
      wizardPreviewSoundPreset(createWizard.soundPreset);
    });
  });
  const micToggle = document.getElementById("wizard-sound-keep-mic");
  if (micToggle) {
    micToggle.addEventListener("change", (e) => {
      createWizard.soundKeepMic = !!e.target.checked;
    });
  }
  const closeBtn = document.getElementById("wizard-sound-picker-close");
  if (closeBtn) closeBtn.addEventListener("click", () => panel.remove());
}

// Builds the MediaStream actually handed to `new MediaRecorder(...)` when a
// hold-recording starts. When no sound preset is selected this is just
// createWizard.stream unchanged (the mic audio track that was already part
// of the getUserMedia() stream - see startWizardCameraStream()). When a
// preset IS selected, it creates an AudioContext, routes the mic (if
// "keep my voice" is on) and the generated preset both through their own
// GainNode into one MediaStreamAudioDestinationNode, and returns a new
// MediaStream combining the camera's video track(s) with that mixed audio
// track - so the generated sound is genuinely encoded into the saved
// recording, not just played live for vibe. See beginHoldRecording()/
// pauseHoldRecording() for how it's paused/resumed/torn down.
function buildWizardRecordingStream() {
  const camStream = createWizard.stream;
  if (!camStream) return camStream;
  if (!createWizard.soundPreset || createWizard.soundPreset === "none") return camStream;
  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtxClass) return camStream;
  try {
    const audioCtx = new AudioCtxClass();
    const dest = audioCtx.createMediaStreamDestination();
    const micTracks = camStream.getAudioTracks();
    if (createWizard.soundKeepMic && micTracks.length) {
      const micSource = audioCtx.createMediaStreamSource(new MediaStream(micTracks));
      const micGain = audioCtx.createGain();
      micGain.gain.value = 1;
      micSource.connect(micGain).connect(dest);
    }
    const musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.35;
    musicGain.connect(dest);
    const stopMusic = playWizardSoundPreset(audioCtx, createWizard.soundPreset, musicGain);
    createWizard._soundAudioCtx = audioCtx;
    createWizard._soundStopFn = stopMusic;
    createWizard._soundMusicGain = musicGain;
    return new MediaStream([...camStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  } catch (e) {
    return camStream;
  }
}

function stopWizardSoundMix() {
  if (!createWizard) return;
  if (createWizard._soundStopFn) {
    try { createWizard._soundStopFn(); } catch (e) {}
    createWizard._soundStopFn = null;
  }
  if (createWizard._soundAudioCtx) {
    try { createWizard._soundAudioCtx.close().catch(() => {}); } catch (e) {}
    createWizard._soundAudioCtx = null;
  }
  createWizard._soundMusicGain = null;
}

// Right-hand options rail: layout inspired by mainstream camera apps but
// built from our own generic Unicode glyphs (not copied icon assets).
// Tier 1 items show by default; tier 2 items reveal via the "more" toggle,
// matching the collapsed/expanded pattern of similar camera UIs.
const CREATE_WIZARD_RAIL_ITEMS = [
  { action: "grid", tier: 1, icon: "#" },
  { action: "flip", tier: 1, icon: "&#8635;" },
  { action: "timer", tier: 1, icon: "&#9201;" },
  { action: "duration", tier: 1, icon: "&#9203;" },
  { action: "templates", tier: 1, icon: "&#9638;" },
  { action: "effects", tier: 1, icon: "&#10024;" },
  { action: "speed", tier: 1, icon: "1x" },
  { action: "greenscreen", tier: 2, icon: "&#9635;" },
  { action: "retouch", tier: 2, icon: "&#128142;" },
  { action: "filters", tier: 2, icon: "&#127912;" },
  { action: "lighting", tier: 2, icon: "&#9788;" },
  { action: "flash", tier: 2, icon: "&#9889;" },
];

// Task #202 - the "lighting" rail item (already present as an unwired
// tier-2 placeholder) is repurposed as the brightness/exposure toggle
// rather than adding a brand-new rail button, so it inherits the exact
// same rail styling/placement/tap-to-reveal-label behavior as every other
// item (grid, flip, timer, ...) for free. Its label/tooltip uses the
// dedicated camera.brightnessToggle i18n key instead of the generic
// create.rail_lighting one.
const WIZARD_RAIL_LABEL_KEY_OVERRIDE = { lighting: "camera.brightnessToggle" };

function wizardRailItemsHtml() {
  const items = CREATE_WIZARD_RAIL_ITEMS.map((it) => {
    const hiddenStyle = it.action === "flash" ? ' style="display:none;"' : "";
    const labelKey = WIZARD_RAIL_LABEL_KEY_OVERRIDE[it.action] || ("create.rail_" + it.action);
    return `<button class="wizard-fs-rail-item" data-tier="${it.tier}" data-action="${it.action}" id="wizard-rail-${it.action}" title="${I18N.t(labelKey)}"${hiddenStyle}>
      <span class="rail-label">${I18N.t(labelKey)}</span>
      <span class="rail-icon">${it.icon}</span>
    </button>`;
  }).join("");
  const toggle = `<button class="wizard-fs-rail-item" data-rail="toggle" id="wizard-rail-toggle">
      <span class="rail-label" id="wizard-rail-toggle-label">${I18N.t("create.rail_more")}</span>
      <span class="rail-icon" id="wizard-rail-toggle-icon">&#9662;</span>
    </button>`;
  return items + toggle;
}

function wireWizardRail() {
  document.querySelectorAll(".wizard-fs-rail-item[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Show this item's label briefly on tap, then hide it again -
      // labels stay off by default so the rail reads as clean icons only.
      document.querySelectorAll(".wizard-fs-rail-item.show-label").forEach((other) => {
        if (other !== btn) other.classList.remove("show-label");
      });
      btn.classList.add("show-label");
      clearTimeout(btn._railLabelTimer);
      btn._railLabelTimer = setTimeout(() => btn.classList.remove("show-label"), 1600);

      const action = btn.dataset.action;
      if (action === "grid") wizardToggleGrid();
      else if (action === "flip") wizardFlipCamera();
      else if (action === "timer") wizardCycleTimer();
      else if (action === "flash") wizardToggleFlash();
      else if (action === "lighting") wizardToggleBrightnessPanel();
      else if (action === "effects" || action === "filters") wizardToggleFilterStrip();
      else if (action === "duration") wizardShowToast(I18N.t("create.durationHint"));
      else wizardShowToast(I18N.t("create.comingSoon"));
    });
  });
  const toggleBtn = document.getElementById("wizard-rail-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const rail = document.getElementById("wizard-fs-rail");
      const expanded = rail.classList.toggle("expanded");
      document.getElementById("wizard-rail-toggle-label").textContent = I18N.t(expanded ? "create.rail_close" : "create.rail_more");
      document.getElementById("wizard-rail-toggle-icon").innerHTML = expanded ? "&#9652;" : "&#9662;";
    });
  }
}

function wizardRunCountdown(seconds) {
  return new Promise((resolve) => {
    const wrap = document.getElementById("wizard-fs-video-wrap");
    if (!wrap) { resolve(); return; }
    const el = document.createElement("div");
    el.className = "wizard-fs-countdown";
    wrap.appendChild(el);
    let n = seconds;
    el.textContent = String(n);
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(iv);
        el.remove();
        resolve();
      } else {
        el.textContent = String(n);
      }
    }, 1000);
  });
}

function startWizardCameraStream() {
  const video = document.getElementById("wizard-fs-video");
  const fallback = document.getElementById("wizard-fs-fallback");
  if (!video) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    video.style.display = "none";
    if (fallback) fallback.style.display = "flex";
    return;
  }
  const onStream = (stream) => {
    createWizard.stream = stream;
    video.srcObject = stream;
    video.style.display = "";
    if (fallback) fallback.style.display = "none";
    updateWizardFlashSupport();
  };
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: createWizard.facingMode }, audio: true })
    .then(onStream)
    .catch((err) => {
      // Bugfix: requesting video+audio together fails outright on some
      // devices/browsers when the microphone is unavailable or its
      // permission was denied separately from the camera's - which used to
      // leave the whole capture screen with no live stream at all (video
      // stays hidden, fallback message shown) even though the camera itself
      // was fine, making the shutter button look completely dead since
      // takePhoto()/beginHoldRecording() both bail out early on
      // `!video.srcObject`. Retry camera-only before giving up, so a
      // mic-permission problem degrades to "photo/video without your own
      // voice" instead of "capture screen doesn't work at all".
      console.error("getUserMedia(video+audio) failed, retrying video-only:", err);
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: createWizard.facingMode } })
        .then(onStream)
        .catch((err2) => {
          console.error("getUserMedia(video-only) also failed:", err2);
          video.style.display = "none";
          if (fallback) fallback.style.display = "flex";
        });
    });
}

function wizardFlipCamera() {
  if (createWizard.recordAccumMs > 0 || createWizard.recording) return;
  const wrap = document.getElementById("wizard-fs-video-wrap");
  createWizard.facingMode = createWizard.facingMode === "user" ? "environment" : "user";
  if (createWizard.stream) createWizard.stream.getTracks().forEach((t) => t.stop());
  if (wrap) wrap.classList.toggle("mirrored", createWizard.facingMode === "user");
  startWizardCameraStream();
}

function finalizeWizardRecording() {
  stopWizardRing();
  if (createWizard.recorder && createWizard.recorder.state !== "inactive") {
    createWizard.recorder.stop();
  }
}

function finalizeWizardVideo() {
  // Task #203 - tear down the sound-preset audio graph (if any) now that
  // MediaRecorder has flushed its last chunk; leaving the AudioContext/
  // oscillators running past this point would just waste battery/CPU.
  stopWizardSoundMix();
  const blob = new Blob(createWizard.chunks, { type: "video/webm" });
  createWizard.durationSeconds = createWizard.recordAccumMs / 1000;
  const reader = new FileReader();
  reader.onload = () => {
    createWizard.rawDataUrl = reader.result;
    createWizard.mediaType = "video";
    createWizard.step = 2;
    stopCreateWizardCamera();
    drawCreateWizard();
  };
  reader.readAsDataURL(blob);
}

function wireWizardCaptureGesture() {
  const btn = document.getElementById("wizard-fs-capture-btn");
  const video = document.getElementById("wizard-fs-video");
  if (!btn) return;

  const beginHoldRecording = () => {
    if (!createWizard.stream) return;
    if (!createWizard.recorder) {
      // Task #203 - if a sound preset is selected, this returns a MediaStream
      // whose audio track is the generated preset (optionally mixed with
      // the mic) instead of the camera's raw audio track, so the recorded
      // file actually carries the sound - not just the live preview. With
      // no preset selected it's createWizard.stream unchanged (identical to
      // pre-#203 behavior).
      const recordingStream = buildWizardRecordingStream();
      try {
        createWizard.recorder = new MediaRecorder(recordingStream);
      } catch (e) {
        alert(I18N.t("create.cameraUnavailable"));
        return;
      }
      createWizard.chunks = [];
      createWizard.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) createWizard.chunks.push(e.data);
      };
      createWizard.recorder.onstop = finalizeWizardVideo;
      createWizard.recorder.start(250);
    } else if (createWizard.recorder.state === "paused") {
      createWizard.recorder.resume();
      // Resuming a multi-clip hold - bring the sound preset's volume back
      // up from the 0 it was set to when the previous segment paused.
      if (createWizard._soundMusicGain) createWizard._soundMusicGain.gain.value = 0.35;
    }
    createWizard.recording = true;
    createWizard.segmentStartTs = Date.now();
    btn.classList.add("recording");
    showWizardRecBadge(true);
    startWizardRing();
    updateWizardSideRailEnabled();
    updateWizardHint(I18N.t("create.recordingHint"));
  };

  const pauseHoldRecording = () => {
    if (!createWizard.recording) return;
    createWizard.recording = false;
    createWizard.recordAccumMs += Date.now() - createWizard.segmentStartTs;
    if (createWizard.recorder && createWizard.recorder.state === "recording") {
      createWizard.recorder.pause();
    }
    // Task #203 - mute (not tear down) the sound preset between hold
    // segments of the same multi-clip recording; it's brought back up in
    // beginHoldRecording()'s resume branch above.
    if (createWizard._soundMusicGain) createWizard._soundMusicGain.gain.value = 0;
    btn.classList.remove("recording");
    showWizardRecBadge(false);
    stopWizardRing();
    // A real-world tap-and-release routinely takes a bit longer than the
    // hold threshold below, which was silently starting (and then pausing)
    // a throwaway fraction-of-a-second video instead of taking the photo
    // the person actually meant to take - and left recordAccumMs > 0, which
    // made every following tap on the shutter do nothing at all (this was
    // the "press the red button and no photo is taken" bug). If the hold
    // never grew into an intentional clip, discard it and shoot a photo.
    if (createWizard.recordAccumMs < WIZARD_MIN_INTENTIONAL_HOLD_MS) {
      if (createWizard.recorder && createWizard.recorder.state !== "inactive") {
        createWizard.recorder.onstop = null;
        createWizard.recorder.stop();
      }
      // Task #203 - onstop is nulled out above so finalizeWizardVideo() (and
      // its stopWizardSoundMix() call) never runs for this discarded clip;
      // tear the sound graph down explicitly instead.
      stopWizardSoundMix();
      createWizard.recorder = null;
      createWizard.chunks = [];
      createWizard.recordAccumMs = 0;
      const doneBtnReset = document.getElementById("wizard-fs-done-btn");
      if (doneBtnReset) doneBtnReset.setAttribute("disabled", "disabled");
      takePhoto();
      return;
    }
    const doneBtn = document.getElementById("wizard-fs-done-btn");
    if (doneBtn) doneBtn.removeAttribute("disabled");
    updateWizardHint(I18N.t("create.addMoreOrDone"));
    if (createWizard.recordAccumMs >= wizardRingTargetMs()) {
      finalizeWizardRecording();
    }
  };

  const takePhoto = () => {
    if (!video || !video.srcObject) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (createWizard.facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    // Task #202 - bake the manual exposure/brightness adjustment into the
    // still right away (canvas 2D .filter works the same as CSS filter).
    // The style filter (CREATE_WIZARD_FILTERS) stays un-baked here and is
    // applied later at publish time via bakeImageFilter() instead, same as
    // before this task - brightness is captured immediately since, unlike
    // the style filter, there's no later step where it can be re-chosen.
    ctx.filter = "brightness(" + (createWizard.brightness || 100) + "%)";
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    createWizard.rawDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    createWizard.mediaType = "image";
    createWizard.step = 2;
    stopCreateWizardCamera();
    drawCreateWizard();
  };

  const runCaptureFlow = async (isHoldPath) => {
    if (createWizard.timerMode > 0 && createWizard.recordAccumMs === 0) {
      btn.disabled = true;
      await wizardRunCountdown(createWizard.timerMode);
      btn.disabled = false;
      takePhoto();
      return;
    }
    if (isHoldPath) beginHoldRecording();
    else takePhoto();
  };

  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    btn.classList.add("pressed");
    createWizard.holdArmed = true;
    createWizard.holdTimer = setTimeout(() => {
      if (!createWizard.holdArmed) return;
      try {
        runCaptureFlow(true);
      } catch (err) {
        console.error("Camera shutter hold-start failed:", err);
        wizardShowToast(I18N.t("create.cameraUnavailable"));
      }
    }, WIZARD_HOLD_THRESHOLD_MS);
  });

  const release = () => {
    btn.classList.remove("pressed");
    if (!createWizard.holdArmed) return;
    createWizard.holdArmed = false;
    if (createWizard.holdTimer) {
      clearTimeout(createWizard.holdTimer);
      createWizard.holdTimer = null;
    }
    // Defensive: a thrown error inside pauseHoldRecording()/runCaptureFlow()
    // (e.g. from the newer brightness/sound-mixing code added in tasks
    // #202/#203) must never leave the shutter permanently unresponsive -
    // this codebase has a documented history of exactly that failure mode
    // ("every following tap on the shutter does nothing at all"). Catch and
    // log instead of letting it propagate silently.
    try {
      if (createWizard.recording) {
        pauseHoldRecording();
      } else if (createWizard.recordAccumMs === 0) {
        runCaptureFlow(false);
      }
    } catch (err) {
      console.error("Camera shutter release handler failed:", err);
      wizardShowToast(I18N.t("create.cameraUnavailable"));
    }
  };
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointerleave", () => { if (createWizard.recording) release(); });
  btn.addEventListener("pointercancel", release);
}

function wizardHandleMediaFile(file) {
  if (!file) return;
  const isVideo = file.type.startsWith("video/");
  if (!isVideo) {
    // The Videos hub (task #231) is video-only - a photo picked from the
    // gallery button while target:"video" is active isn't a valid upload
    // for it (server.js's POST /api/moments rejects it too).
    if (createWizard.target === "video") {
      alert(I18N.t("videos.mustBeVideo"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      createWizard.rawDataUrl = reader.result;
      createWizard.mediaType = "image";
      createWizard.step = 2;
      stopCreateWizardCamera();
      drawCreateWizard();
    };
    reader.readAsDataURL(file);
    return;
  }
  const probe = document.createElement("video");
  probe.preload = "metadata";
  const objectUrl = URL.createObjectURL(file);
  probe.onloadedmetadata = () => {
    URL.revokeObjectURL(objectUrl);
    if (probe.duration && probe.duration > wizardMaxVideoSeconds()) {
      alert(I18N.t(createWizard.target === "video" ? "videos.videoTooLong" : "moments.videoTooLong"));
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
}

// Task #204 - cycles an overlay's size through WIZARD_OVERLAY_SIZE_STEPS
// (sm -> md -> lg -> sm...), used by the small resize button rendered on
// each overlay in the editor (see renderWizardOverlays() below).
function wizardCycleOverlaySize(ov) {
  const idx = WIZARD_OVERLAY_SIZE_STEPS.indexOf(ov.size || "md");
  ov.size = WIZARD_OVERLAY_SIZE_STEPS[(idx + 1) % WIZARD_OVERLAY_SIZE_STEPS.length];
}

function renderWizardOverlays(interactive) {
  const wrap = document.getElementById("wizard-preview-wrap");
  if (!wrap) return;
  wrap.querySelectorAll(".wizard-overlay-item").forEach((el) => el.remove());
  createWizard.overlays.forEach((ov) => {
    const el = document.createElement("div");
    el.className = "wizard-overlay-item " + ov.type + " size-" + (ov.size || "md");
    el.style.left = ov.xPct + "%";
    el.style.top = ov.yPct + "%";
    const contentSpan = document.createElement("span");
    contentSpan.className = "wizard-overlay-content";
    contentSpan.textContent = ov.value;
    if (ov.type === "text") contentSpan.style.color = ov.color;
    el.appendChild(contentSpan);
    if (interactive) {
      // Small always-visible resize-cycle and remove (×) controls on every
      // overlay, per task #204 - both stop propagation so tapping them
      // doesn't also start a drag (see wireWizardOverlayDrag() below).
      const resizeBtn = document.createElement("button");
      resizeBtn.type = "button";
      resizeBtn.className = "wizard-overlay-resize";
      resizeBtn.title = I18N.t("create.overlayResize");
      resizeBtn.textContent = (ov.size || "md").toUpperCase();
      resizeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        wizardCycleOverlaySize(ov);
        renderWizardOverlays(true);
      });
      el.appendChild(resizeBtn);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "wizard-overlay-remove";
      removeBtn.title = I18N.t("create.removeOverlay");
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        createWizard.overlays = createWizard.overlays.filter((o) => o.id !== ov.id);
        renderWizardOverlays(true);
      });
      el.appendChild(removeBtn);

      wireWizardOverlayDrag(el, wrap, ov);
    }
    wrap.appendChild(el);
  });
}

function wireWizardOverlayDrag(el, wrap, ov) {
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".wizard-overlay-resize") || e.target.closest(".wizard-overlay-remove")) return;
    e.preventDefault();
    el.classList.add("dragging");
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    const move = (ev) => {
      const rect = wrap.getBoundingClientRect();
      let xPct = ((ev.clientX - rect.left) / rect.width) * 100;
      let yPct = ((ev.clientY - rect.top) / rect.height) * 100;
      xPct = Math.max(4, Math.min(96, xPct));
      yPct = Math.max(4, Math.min(96, yPct));
      ov.xPct = xPct;
      ov.yPct = yPct;
      el.style.left = xPct + "%";
      el.style.top = yPct + "%";
    };
    const up = () => {
      el.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function drawWizardStickerPicker() {
  let picker = document.getElementById("wizard-sticker-picker");
  if (picker) {
    picker.remove();
    return;
  }
  picker = document.createElement("div");
  picker.className = "wizard-sticker-picker";
  picker.id = "wizard-sticker-picker";
  picker.innerHTML = CREATE_WIZARD_STICKERS.map((s) => `<button data-emoji="${s}">${s}</button>`).join("");
  const toolbar = document.querySelector(".wizard-edit-toolbar");
  if (!toolbar) return;
  toolbar.insertAdjacentElement("afterend", picker);
  picker.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      createWizard.overlays.push({ id: "s" + Date.now(), type: "sticker", value: btn.dataset.emoji, size: "md", xPct: 50, yPct: 50 });
      renderWizardOverlays(true);
      picker.remove();
    });
  });
}

// Task #204 - replaces the old bare prompt() text-add flow with a small
// composer offering a size toggle (sm/md/lg, shared with stickers - see
// WIZARD_OVERLAY_SIZE_STEPS) and 6 preset colors (WIZARD_TEXT_COLORS,
// white/black first for guaranteed contrast against any background). No
// font-family picker - out of scope per task #204's MVP note.
function drawWizardTextComposer() {
  const existing = document.getElementById("wizard-text-composer");
  if (existing) {
    existing.remove();
    return;
  }
  const toolbar = document.querySelector(".wizard-edit-toolbar");
  if (!toolbar) return;
  const panel = document.createElement("div");
  panel.className = "wizard-text-composer";
  panel.id = "wizard-text-composer";
  panel.innerHTML = `
    <textarea id="wizard-text-input" maxlength="60" rows="2" placeholder="${I18N.t("create.addTextPrompt")}"></textarea>
    <div class="wizard-text-size-row">
      ${WIZARD_OVERLAY_SIZE_STEPS.map((s) => `<button type="button" class="wizard-text-size-btn ${s === "md" ? "active" : ""}" data-size="${s}">${I18N.t("create.textSize_" + s)}</button>`).join("")}
    </div>
    <div class="wizard-text-color-row">
      ${WIZARD_TEXT_COLORS.map(
        (c, i) => `<button type="button" class="wizard-text-color-swatch ${i === 0 ? "active" : ""}" data-color="${c}" style="background:${c};" aria-label="${c}"></button>`
      ).join("")}
    </div>
    <div class="action-row">
      <button type="button" class="btn btn-secondary" id="wizard-text-cancel">${I18N.t("common.cancel")}</button>
      <button type="button" class="btn btn-primary" id="wizard-text-confirm">${I18N.t("create.addText")}</button>
    </div>
  `;
  toolbar.insertAdjacentElement("afterend", panel);

  let chosenSize = "md";
  let chosenColor = WIZARD_TEXT_COLORS[0];
  panel.querySelectorAll(".wizard-text-size-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      chosenSize = btn.dataset.size;
      panel.querySelectorAll(".wizard-text-size-btn").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
  panel.querySelectorAll(".wizard-text-color-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      chosenColor = btn.dataset.color;
      panel.querySelectorAll(".wizard-text-color-swatch").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
  document.getElementById("wizard-text-cancel").addEventListener("click", () => panel.remove());
  document.getElementById("wizard-text-confirm").addEventListener("click", () => {
    const val = document.getElementById("wizard-text-input").value.trim();
    panel.remove();
    if (!val) return;
    createWizard.overlays.push({ id: "t" + Date.now(), type: "text", value: val.slice(0, 60), color: chosenColor, size: chosenSize, xPct: 50, yPct: 35 });
    renderWizardOverlays(true);
  });
}

function drawCreateWizard() {
  const overlay = document.getElementById("create-wizard-overlay");
  if (!overlay || !createWizard) return;

  if (createWizard.step === 1) {
    overlay.className = "wizard-fs-overlay";
    const ringC = 2 * Math.PI * 30;
    overlay.innerHTML = `
      <div class="wizard-fs-video-wrap ${createWizard.facingMode === "user" ? "mirrored" : ""}" id="wizard-fs-video-wrap">
        <video id="wizard-fs-video" autoplay playsinline muted style="filter:${wizardLiveFilterCss()};"></video>
        <div class="wizard-fs-fallback" id="wizard-fs-fallback" style="display:none;">
          <p>${I18N.t("create.cameraUnavailable")}</p>
        </div>
        <div class="wizard-fs-grid ${createWizard.gridOn ? "show" : ""}" id="wizard-fs-grid" aria-hidden="true"></div>
        <div class="wizard-fs-topbar">
          <button class="wizard-fs-icon-btn" id="wizard-fs-close" aria-label="${I18N.t("common.cancel")}">&times;</button>
          <button class="wizard-fs-sound-pill" id="wizard-fs-sound-pill">&#9835; ${
            createWizard.soundPreset && createWizard.soundPreset !== "none" ? I18N.t("camera.soundPicker." + createWizard.soundPreset) : I18N.t("create.addSound")
          }</button>
          <button class="wizard-fs-icon-btn" id="wizard-fs-effects-btn" title="${I18N.t("create.rail_effects")}">&#10024;</button>
        </div>
        <div class="wizard-fs-rec-badge" id="wizard-fs-rec-badge" style="display:none;"><span class="wizard-fs-rec-dot"></span><span id="wizard-fs-rec-time">0:00</span></div>
        <div class="wizard-fs-brightness-panel" id="wizard-fs-brightness-panel" hidden>
          <span class="wizard-fs-brightness-icon" aria-hidden="true">&#9788;</span>
          <input type="range" id="wizard-fs-brightness-slider" min="50" max="150" step="5" value="${createWizard.brightness}" aria-label="${I18N.t("camera.brightnessToggle")}" />
          <span class="wizard-fs-brightness-value" id="wizard-fs-brightness-value">${createWizard.brightness}%</span>
        </div>
        <div class="wizard-fs-rail" id="wizard-fs-rail">${wizardRailItemsHtml()}</div>
      </div>
      <div class="wizard-fs-bottom">
        <p class="wizard-fs-hint" id="wizard-fs-hint">${I18N.t("create.tapHoldHint")}</p>
        <div class="wizard-fs-filter-rail" hidden>${CREATE_WIZARD_FILTERS.map(
          (f) => `<button class="wizard-fs-filter-item ${createWizard.filter === f.id ? "active" : ""}" data-filter="${f.id}">
            <span class="wizard-fs-filter-thumb" style="filter:${f.css};"></span>
            <span class="wizard-fs-filter-label">${I18N.t("create.filter_" + f.id)}</span>
          </button>`
        ).join("")}</div>
        <div class="wizard-fs-controls-row">
          <button class="wizard-fs-gallery-btn" id="wizard-fs-gallery-btn" title="${I18N.t("create.uploadFromGallery")}">&#128247;</button>
          <div class="wizard-fs-capture-wrap">
            <svg class="wizard-fs-capture-ring" viewBox="0 0 70 70" width="76" height="76">
              <circle cx="35" cy="35" r="30" fill="none" stroke="var(--gold)" stroke-width="4" stroke-dasharray="${ringC}" stroke-dashoffset="${ringC}" id="wizard-fs-ring-circle" stroke-linecap="round"></circle>
            </svg>
            <button class="wizard-fs-capture-btn" id="wizard-fs-capture-btn" aria-label="${I18N.t("create.capturePhoto")}"></button>
          </div>
          <button class="wizard-fs-done-btn" id="wizard-fs-done-btn" disabled title="${I18N.t("create.next")}">&#10003;</button>
        </div>
      </div>
      <input type="file" id="wizard-file-media" accept="image/*,video/*" style="display:none;" />
    `;

    startWizardCameraStream();

    document.querySelectorAll(".wizard-fs-filter-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        createWizard.filter = btn.dataset.filter;
        document.querySelectorAll(".wizard-fs-filter-item").forEach((b) => b.classList.toggle("active", b.dataset.filter === createWizard.filter));
        const v = document.getElementById("wizard-fs-video");
        if (v) v.style.filter = wizardLiveFilterCss();
      });
    });

    document.getElementById("wizard-fs-close").addEventListener("click", () => closeOverlayViaBack(closeCreateWizard));
    document.getElementById("wizard-fs-sound-pill").addEventListener("click", wizardOpenSoundPicker);
    document.getElementById("wizard-fs-effects-btn").addEventListener("click", wizardToggleFilterStrip);
    document.getElementById("wizard-fs-gallery-btn").addEventListener("click", () => document.getElementById("wizard-file-media").click());
    document.getElementById("wizard-file-media").addEventListener("change", (e) => wizardHandleMediaFile(e.target.files[0]));
    document.getElementById("wizard-fs-done-btn").addEventListener("click", () => {
      if (createWizard.recordAccumMs > 0) finalizeWizardRecording();
    });
    wireWizardRail();
    wireWizardBrightnessPanel();
    wireWizardCaptureGesture();
    return;
  }

  if (createWizard.step === 2) {
    overlay.className = "modal-overlay create-wizard-overlay";
    overlay.innerHTML = `
      <div class="modal-box wizard-box">
        <h2 class="section-heading">${I18N.t(createWizard.target === "loop" ? "create.step2TitleLoop" : createWizard.target === "video" ? "create.step2TitleVideo" : "create.step2Title")}</h2>
        <div class="wizard-edit-toolbar">
          <button class="wizard-edit-tool-btn" id="wizard-add-text-btn" title="${I18N.t("create.addText")}">Aa</button>
          <button class="wizard-edit-tool-btn" id="wizard-add-sticker-btn" title="${I18N.t("create.addSticker")}">&#128512;</button>
        </div>
        <div class="wizard-preview-wrap" id="wizard-preview-wrap">
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
    renderWizardOverlays(true);
    document.getElementById("wizard-cancel2").addEventListener("click", (e) => {
      e.preventDefault();
      closeOverlayViaBack(closeCreateWizard);
    });
    wireCreateWizardFilterRow(() => {
      const img = document.getElementById("wizard-preview-img");
      const vid = overlay.querySelector(".wizard-preview-media");
      if (img) img.style.filter = createWizardFilterCss(createWizard.filter);
      else if (vid) vid.style.filter = createWizardFilterCss(createWizard.filter);
    });
    document.getElementById("wizard-add-text-btn").addEventListener("click", drawWizardTextComposer);
    document.getElementById("wizard-add-sticker-btn").addEventListener("click", drawWizardStickerPicker);
    document.getElementById("wizard-back").addEventListener("click", () => {
      createWizard.step = 1;
      createWizard.rawDataUrl = null;
      createWizard.mediaType = null;
      createWizard.overlays = [];
      createWizard.recordAccumMs = 0;
      createWizard.recorder = null;
      createWizard.chunks = [];
      // The AI-suggested trim window (if any) belongs to the clip that's
      // about to be discarded - clear it so a fresh capture never inherits
      // a stale window.
      createWizard.clipStartSec = null;
      createWizard.clipEndSec = null;
      drawCreateWizard();
    });
    document.getElementById("wizard-next").addEventListener("click", () => {
      createWizard.step = 3;
      drawCreateWizard();
    });
    return;
  }

  // step 3: title (video only) + caption + hashtags + next/publish
  if (createWizard.step === 3) {
  const isVideoStep3 = createWizard.target === "video";
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
      ${
        createWizard.mediaType === "video" && createWizard.durationSeconds > 20
          ? `<div class="form-group" id="wizard-clip-group">
               <button type="button" class="btn btn-ai-suggest btn-ai-suggest-sm" id="wizard-ai-clip">&#9986;&#65039; ${I18N.t("create.aiSuggestClip")}</button>
               <p class="field-hint" id="wizard-ai-clip-hint"></p>
               <div id="wizard-clip-result" style="display:none;">
                 <p class="field-hint">${I18N.t("create.aiClipSuggested")} <span id="wizard-clip-range"></span></p>
                 <p class="field-hint" id="wizard-clip-reason"></p>
                 <a href="#" id="wizard-clip-reset">${I18N.t("create.aiClipUseFullVideo")}</a>
               </div>
             </div>`
          : ""
      }
      ${
        isVideoStep3
          ? `<div class="form-group">
               <label>${I18N.t("create.videoTitleLabel")}</label>
               <input type="text" id="wizard-video-title" maxlength="120" placeholder="${I18N.t("create.videoTitlePlaceholder")}" value="${escapeHtml(createWizard.titleDraft || "")}" />
             </div>`
          : ""
      }
      <div class="form-group">
        <label>${I18N.t("create.captionLabel")}</label>
        <textarea id="wizard-caption" rows="2" maxlength="130" placeholder="${I18N.t("create.captionPlaceholder")}">${escapeHtml(createWizard.captionDraft || "")}</textarea>
        <p class="field-hint"><span id="wizard-caption-count">${(createWizard.captionDraft || "").length}</span>/130</p>
        ${
          createWizard.mediaType === "image"
            ? `<button type="button" class="btn btn-ai-suggest btn-ai-suggest-sm" id="wizard-ai-suggest">&#10024; ${I18N.t("create.aiSuggestCaption")}</button>
               <p class="field-hint" id="wizard-ai-hint"></p>
               <div class="ai-caption-preview" id="wizard-ai-preview" style="display:none;"></div>`
            : ""
        }
      </div>
      <div class="form-group">
        <label>${I18N.t("create.hashtagsLabel")}</label>
        <input type="text" id="wizard-hashtags" placeholder="${I18N.t("create.hashtagsPlaceholder")}" value="${escapeHtml(createWizard.hashtagsDraft || "")}" />
      </div>
      <div class="action-row">
        <button class="btn btn-secondary" id="wizard-back2">${I18N.t("create.back")}</button>
        <button class="btn btn-primary" id="wizard-publish">${I18N.t(isVideoStep3 ? "create.next" : "create.publish")}</button>
      </div>
      <p style="text-align:center;margin-top:8px;"><a href="#" id="wizard-cancel3">${I18N.t("common.cancel")}</a></p>
      <p class="form-msg" id="wizard-publish-msg"></p>
    </div>
  `;
  document.getElementById("wizard-cancel3").addEventListener("click", (e) => {
    e.preventDefault();
    closeOverlayViaBack(closeCreateWizard);
  });

  const captionEl = document.getElementById("wizard-caption");
  const countEl = document.getElementById("wizard-caption-count");
  captionEl.addEventListener("input", () => {
    countEl.textContent = String(captionEl.value.length);
  });

  // AI-suggest is only offered for photo captures: the wizard never
  // generates a poster/thumbnail frame for video, and sending video data to
  // an image-analysis endpoint would just fail - so the button itself is
  // omitted from the markup above when mediaType isn't "image" rather than
  // shown disabled.
  const wizardAiBtn = document.getElementById("wizard-ai-suggest");
  if (wizardAiBtn) {
    const aiHintEl = document.getElementById("wizard-ai-hint");
    const aiPreviewEl = document.getElementById("wizard-ai-preview");
    const aiBtnLabel = wizardAiBtn.innerHTML;
    wizardAiBtn.addEventListener("click", async () => {
      if (!createWizard.rawDataUrl) return;
      wizardAiBtn.disabled = true;
      wizardAiBtn.textContent = I18N.t("create.aiThinking");
      aiHintEl.textContent = "";
      aiHintEl.className = "field-hint";
      aiPreviewEl.style.display = "none";
      try {
        const data = await api("/api/ai/suggest-caption", {
          method: "POST",
          auth: true,
          body: {
            image: createWizard.rawDataUrl,
            locale: I18N.lang,
            context: createWizard.target === "loop" ? "Loop capture" : "Moment capture",
          },
        });
        const hashtagsStr = Array.isArray(data.hashtags) ? data.hashtags.map((h) => "#" + h).join(" ") : "";
        const hashtagsInput = document.getElementById("wizard-hashtags");
        if (!captionEl.value.trim()) {
          // Field is empty - safe to fill directly, nothing to overwrite.
          captionEl.value = data.caption || "";
          countEl.textContent = String(captionEl.value.length);
          if (hashtagsStr && hashtagsInput && !hashtagsInput.value.trim()) hashtagsInput.value = hashtagsStr;
        } else {
          // User already typed something - never clobber it. Show the
          // suggestion as a dismissible preview they can tap to apply.
          aiPreviewEl.style.display = "block";
          aiPreviewEl.innerHTML = `
            <p class="ai-caption-preview-text">${escapeHtml(data.caption || "")}${hashtagsStr ? " " + escapeHtml(hashtagsStr) : ""}</p>
            <div class="ai-caption-preview-actions">
              <a href="#" id="wizard-ai-apply">${I18N.t("create.aiApplySuggestion")}</a>
              <a href="#" id="wizard-ai-dismiss">${I18N.t("create.aiDismissSuggestion")}</a>
            </div>
          `;
          document.getElementById("wizard-ai-apply").addEventListener("click", (e) => {
            e.preventDefault();
            captionEl.value = data.caption || "";
            countEl.textContent = String(captionEl.value.length);
            if (hashtagsStr && hashtagsInput) hashtagsInput.value = hashtagsStr;
            aiPreviewEl.style.display = "none";
          });
          document.getElementById("wizard-ai-dismiss").addEventListener("click", (e) => {
            e.preventDefault();
            aiPreviewEl.style.display = "none";
          });
        }
      } catch (err) {
        aiHintEl.textContent = err.message || I18N.t("create.aiError");
        aiHintEl.className = "field-hint error";
      } finally {
        wizardAiBtn.disabled = false;
        wizardAiBtn.innerHTML = aiBtnLabel;
      }
    });
  }

  // AI auto-clip (task #160) - only offered for videos over ~20s (the
  // button itself is omitted from the markup above otherwise). Mirrors the
  // caption assistant's loading-state/error-handling pattern above.
  wireWizardAiClip(overlay);

  document.getElementById("wizard-back2").addEventListener("click", () => {
    createWizard.step = 2;
    drawCreateWizard();
  });

  document.getElementById("wizard-publish").addEventListener("click", async () => {
    const publishBtn = document.getElementById("wizard-publish");
    const msgEl = document.getElementById("wizard-publish-msg");
    const isLoop = createWizard.target === "loop";
    const isVideoTarget = createWizard.target === "video";
    let videoTitleVal = "";
    if (isVideoTarget) {
      const titleInput = document.getElementById("wizard-video-title");
      videoTitleVal = titleInput ? titleInput.value.trim() : "";
      if (!videoTitleVal) {
        msgEl.textContent = I18N.t("videos.titleRequired");
        msgEl.className = "form-msg error";
        return;
      }
    }
    publishBtn.disabled = true;
    msgEl.textContent = isVideoTarget ? "" : I18N.t(isLoop ? "loops.uploading" : "moments.uploading");
    msgEl.className = "form-msg";
    try {
      let finalMedia = createWizard.rawDataUrl;
      if (createWizard.mediaType === "image") {
        if (createWizard.filter !== "none") {
          finalMedia = await bakeImageFilter(finalMedia, createWizardFilterCss(createWizard.filter));
        }
        if (createWizard.overlays.length) {
          finalMedia = await bakeWizardOverlays(finalMedia, createWizard.overlays);
        }
      }
      const hashtagsRaw = document.getElementById("wizard-hashtags").value.trim();
      const hashtags = hashtagsRaw
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((h) => (h.startsWith("#") ? h : "#" + h))
        .join(" ");
      const captionText = captionEl.value.trim();
      const fullCaption = hashtags ? (captionText ? captionText + "\n" + hashtags : hashtags) : captionText;
      createWizard.captionDraft = captionText;
      createWizard.hashtagsDraft = hashtagsRaw;

      // Videos hub (task #231) - title + caption/hashtags are ready, but
      // publishing waits for one more optional step: "link to one of your
      // listings?" (see the createWizard.step === 4 branch below, after
      // this function). The actual POST /api/moments call happens there.
      if (isVideoTarget) {
        createWizard.titleDraft = videoTitleVal;
        createWizard.finalMedia = finalMedia;
        createWizard.captionText = fullCaption;
        createWizard.step = 4;
        publishBtn.disabled = false;
        drawCreateWizard();
        return;
      }

      if (isLoop) {
        // server.js's mkt_loops schema uses "photo"/"video" for media_type
        // (not "image"/"video" like Moments) - see POST /api/loops - so the
        // wizard's internal "image" value needs translating at the door.
        await api("/api/loops", {
          method: "POST",
          auth: true,
          body: {
            mediaType: createWizard.mediaType === "video" ? "video" : "photo",
            media: finalMedia,
            caption: fullCaption,
            durationSeconds: createWizard.durationSeconds,
          },
        });
      } else {
        await api("/api/moments", {
          method: "POST",
          auth: true,
          body: {
            mediaType: createWizard.mediaType,
            media: finalMedia,
            caption: fullCaption,
            durationSeconds: createWizard.durationSeconds,
            // AI auto-clip (task #160) - null/null (the default) means
            // "publish the full video"; see POST /api/moments in server.js.
            trimStartSec: createWizard.clipStartSec,
            trimEndSec: createWizard.clipEndSec,
            // Task #204 - only videos send overlay metadata; photo overlays
            // are already baked into `finalMedia`'s pixels above and would
            // just be drawn twice if sent again here.
            overlays: createWizard.mediaType === "video" ? createWizard.overlays : undefined,
          },
        });
      }
      msgEl.textContent = I18N.t(isLoop ? "loops.posted" : "moments.posted");
      msgEl.className = "form-msg ok";
      setTimeout(() => {
        closeOverlayViaBack(closeCreateWizard);
        router();
      }, 700);
    } catch (e) {
      msgEl.textContent = e.message;
      msgEl.className = "form-msg error";
      publishBtn.disabled = false;
    }
  });
  return;
  }

  // step 4 (Videos hub only, task #231): optional "link to one of your
  // listings?" screen shown after caption/title, before the actual publish
  // call. General-purpose across any product category, not book-specific -
  // reuses the same "my listings" endpoint the profile page's own-listings
  // tab already calls (GET /api/products?sellerId=<me>). Linking is never
  // required - "Skip" is the default selection and stays selected unless
  // the creator explicitly taps a listing.
  if (createWizard.step === 4) {
    overlay.className = "modal-overlay create-wizard-overlay";
    overlay.innerHTML = `
      <div class="modal-box wizard-box">
        <h2 class="section-heading">${I18N.t("create.videoLinkProductTitle")}</h2>
        <p class="field-hint">${I18N.t("create.videoLinkProductHint")}</p>
        <div id="wizard-link-product-list"><p>${I18N.t("common.loading")}</p></div>
        <div class="action-row">
          <button class="btn btn-secondary" id="wizard-back3">${I18N.t("create.back")}</button>
          <button class="btn btn-primary" id="wizard-publish-video">${I18N.t("create.publish")}</button>
        </div>
        <p style="text-align:center;margin-top:8px;"><a href="#" id="wizard-cancel4">${I18N.t("common.cancel")}</a></p>
        <p class="form-msg" id="wizard-publish-msg"></p>
      </div>
    `;
    document.getElementById("wizard-cancel4").addEventListener("click", (e) => {
      e.preventDefault();
      closeOverlayViaBack(closeCreateWizard);
    });
    document.getElementById("wizard-back3").addEventListener("click", () => {
      createWizard.step = 3;
      drawCreateWizard();
    });

    const listEl = document.getElementById("wizard-link-product-list");
    function renderLinkProductChoices() {
      const products = createWizard.myProducts || [];
      const skipRow = `
        <label class="wizard-link-product-row">
          <input type="radio" name="wizard-link-product" value="" ${createWizard.linkedProductId ? "" : "checked"} />
          <span>${I18N.t("create.videoSkipLink")}</span>
        </label>`;
      const productRows = products
        .map(
          (p) => `
        <label class="wizard-link-product-row">
          <input type="radio" name="wizard-link-product" value="${p.id}" ${createWizard.linkedProductId === p.id ? "checked" : ""} />
          ${p.photos && p.photos[0] ? `<img class="wizard-link-product-thumb" src="${p.photos[0]}" />` : `<span class="wizard-link-product-thumb wizard-link-product-thumb-empty">\u{1F4E6}</span>`}
          <span class="wizard-link-product-info"><span class="wizard-link-product-title">${escapeHtml(p.title)}</span><span class="wizard-link-product-price">${fmtPrice(p.price)}</span></span>
        </label>`
        )
        .join("");
      listEl.innerHTML = skipRow + (productRows || `<p class="field-hint">${I18N.t("create.videoNoListings")}</p>`);
      listEl.querySelectorAll('input[name="wizard-link-product"]').forEach((input) => {
        input.addEventListener("change", () => {
          createWizard.linkedProductId = input.value || null;
        });
      });
    }

    if (createWizard.myProducts) {
      renderLinkProductChoices();
    } else if (state.user) {
      api("/api/products?sellerId=" + encodeURIComponent(state.user.id))
        .then((products) => {
          createWizard.myProducts = (products || []).filter((p) => p.status !== "sold");
          renderLinkProductChoices();
        })
        .catch(() => {
          createWizard.myProducts = [];
          renderLinkProductChoices();
        });
    } else {
      createWizard.myProducts = [];
      renderLinkProductChoices();
    }

    document.getElementById("wizard-publish-video").addEventListener("click", async () => {
      const publishBtn = document.getElementById("wizard-publish-video");
      const msgEl = document.getElementById("wizard-publish-msg");
      publishBtn.disabled = true;
      msgEl.textContent = I18N.t("moments.uploading");
      msgEl.className = "form-msg";
      try {
        await api("/api/moments", {
          method: "POST",
          auth: true,
          body: {
            target: "video",
            mediaType: "video",
            media: createWizard.finalMedia,
            title: createWizard.titleDraft,
            caption: createWizard.captionText,
            durationSeconds: createWizard.durationSeconds,
            linkedProductId: createWizard.linkedProductId || undefined,
            // AI auto-clip (task #160) - null/null (the default) means
            // "publish the full video"; see POST /api/moments in server.js.
            trimStartSec: createWizard.clipStartSec,
            trimEndSec: createWizard.clipEndSec,
            // Task #204 - long-form Videos-hub uploads are always video, so
            // overlay metadata (if any) always goes along.
            overlays: createWizard.overlays,
          },
        });
        msgEl.textContent = I18N.t("videos.posted");
        msgEl.className = "form-msg ok";
        setTimeout(() => {
          closeOverlayViaBack(closeCreateWizard);
          router();
        }, 700);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = "form-msg error";
        publishBtn.disabled = false;
      }
    });
    return;
  }
}

// ---- AI auto-clip (task #160): wizard step-3 wiring ------------------------
// Wires the "#wizard-ai-clip" button (present only for video captures over
// ~20s - see the markup in drawCreateWizard() above). Mirrors the caption
// assistant's loading-state/error pattern: sample a handful of small frames
// from the raw video client-side, send them to POST /api/ai/suggest-clip,
// then preview the suggested window by looping the step-3 preview video
// between startSec/endSec. The chosen window (or none, if the user resets to
// "use full video") is stored on createWizard.clipStartSec/clipEndSec and
// sent along with the publish call.
function wireWizardAiClip(overlay) {
  const btn = document.getElementById("wizard-ai-clip");
  if (!btn) return;
  const hintEl = document.getElementById("wizard-ai-clip-hint");
  const resultEl = document.getElementById("wizard-clip-result");
  const rangeEl = document.getElementById("wizard-clip-range");
  const reasonEl = document.getElementById("wizard-clip-reason");
  const resetLink = document.getElementById("wizard-clip-reset");
  const btnLabel = btn.innerHTML;
  const previewVideoEl = overlay.querySelector(".wizard-preview-media");

  function stopPreviewLoop() {
    if (previewVideoEl) previewVideoEl.ontimeupdate = null;
  }

  function playPreviewLoop() {
    if (!previewVideoEl || createWizard.clipStartSec == null || createWizard.clipEndSec == null) return;
    const start = createWizard.clipStartSec;
    const end = createWizard.clipEndSec;
    try {
      previewVideoEl.currentTime = start;
    } catch (e) {}
    previewVideoEl.play().catch(() => {});
    previewVideoEl.ontimeupdate = () => {
      if (previewVideoEl.currentTime >= end) {
        try {
          previewVideoEl.currentTime = start;
        } catch (e) {}
      }
    };
  }

  function showResult() {
    rangeEl.textContent = I18N.t("create.aiClipRange")
      .replace("{start}", formatClipTime(createWizard.clipStartSec))
      .replace("{end}", formatClipTime(createWizard.clipEndSec));
    resultEl.style.display = "block";
  }

  if (resetLink) {
    resetLink.addEventListener("click", (e) => {
      e.preventDefault();
      createWizard.clipStartSec = null;
      createWizard.clipEndSec = null;
      stopPreviewLoop();
      resultEl.style.display = "none";
    });
  }

  // Re-show the suggestion (and resume the preview loop) if the user comes
  // back to step 3 after already running auto-clip once.
  if (createWizard.clipStartSec != null && createWizard.clipEndSec != null) {
    showResult();
    reasonEl.textContent = "";
    playPreviewLoop();
  }

  btn.addEventListener("click", async () => {
    if (!createWizard.rawDataUrl || !createWizard.durationSeconds) return;
    btn.disabled = true;
    btn.textContent = I18N.t("create.aiClipThinking");
    hintEl.textContent = "";
    hintEl.className = "field-hint";
    resultEl.style.display = "none";
    stopPreviewLoop();
    try {
      const frames = await sampleVideoFrames(createWizard.rawDataUrl, createWizard.durationSeconds);
      const data = await api("/api/ai/suggest-clip", {
        method: "POST",
        auth: true,
        body: { durationSec: createWizard.durationSeconds, frames },
      });
      createWizard.clipStartSec = data.startSec;
      createWizard.clipEndSec = data.endSec;
      showResult();
      reasonEl.textContent = data.reason || "";
      playPreviewLoop();
    } catch (err) {
      hintEl.textContent = (err && err.message) || I18N.t("create.aiClipError");
      hintEl.className = "field-hint error";
    } finally {
      btn.disabled = false;
      btn.innerHTML = btnLabel;
    }
  });
}

// Samples ~7 small frames evenly across a video (from its raw data URL) for
// the AI auto-clip request above - an offscreen, unattached-from-layout
// <video> is seeked to each timestamp (awaiting the "seeked" event, since
// currentTime writes are asynchronous) and drawn to a small canvas, kept at
// ~320px wide so the request stays light.
function sampleVideoFrames(dataUrl, durationSec, count) {
  count = count || 7;
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.top = "0";
    video.style.width = "1px";
    video.style.height = "1px";
    document.body.appendChild(video);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    function cleanup() {
      try {
        video.pause();
      } catch (e) {}
      video.removeAttribute("src");
      video.load();
      video.remove();
    }

    video.addEventListener("error", () => {
      cleanup();
      reject(new Error("Could not read video"));
    });
    video.addEventListener("loadedmetadata", async () => {
      try {
        const dur = durationSec && durationSec > 0 ? durationSec : video.duration || 0;
        if (!dur) throw new Error("Could not read video duration");
        const w = 320;
        const ratio = video.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 16 / 9;
        canvas.width = w;
        canvas.height = Math.max(1, Math.round(w * ratio));
        const frames = [];
        for (let i = 0; i < count; i++) {
          const t = Math.min(dur - 0.05, Math.max(0, (dur * (i + 0.5)) / count));
          await seekVideoTo(video, t);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push({ t, image: canvas.toDataURL("image/jpeg", 0.6) });
        }
        cleanup();
        resolve(frames);
      } catch (e) {
        cleanup();
        reject(e);
      }
    });
    video.src = dataUrl;
  });
}

function seekVideoTo(video, t) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      reject(new Error("Could not seek video"));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = t;
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

// Draws text/sticker overlays (added in the create-wizard edit step) onto the
// final image so they're part of the published file, not just a DOM overlay.
function bakeWizardOverlays(dataUrl, overlays) {
  if (!overlays || !overlays.length) return Promise.resolve(dataUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      overlays.forEach((ov) => {
        const x = (ov.xPct / 100) * canvas.width;
        const y = (ov.yPct / 100) * canvas.height;
        // Task #204 - the sm/md/lg size picked in the editor scales the same
        // base font sizes used here (WIZARD_OVERLAY_SIZE_SCALE), so what got
        // dragged into place is what ends up baked into the JPEG.
        const scale = WIZARD_OVERLAY_SIZE_SCALE[ov.size] || 1;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (ov.type === "text") {
          const fontSize = Math.round(canvas.width * 0.06 * scale);
          ctx.font = `800 ${fontSize}px sans-serif`;
          ctx.fillStyle = ov.color || "#FFD84D";
          ctx.shadowColor = "rgba(0,0,0,0.5)";
          ctx.shadowBlur = 6;
          ctx.fillText(ov.value, x, y);
          ctx.shadowBlur = 0;
        } else {
          const fontSize = Math.round(canvas.width * 0.12 * scale);
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fillText(ov.value, x, y);
        }
      });
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
  const allMoments = momentsRes.status === "fulfilled" ? momentsRes.value : [];
  // Videos hub (task #231) - GET /api/moments/user/:id intentionally
  // returns both short-form Moments and long-form Videos (they're the same
  // table), so the split happens here, client-side: the "Moments" stories
  // rail only ever gets the short-form ones, and the new "Videos" tab
  // (this user's channel) only gets the long-form ones. This is the
  // client-side half of the short-form/long-form separation server.js
  // already enforces on the main scroll feeds.
  const moments = allMoments.filter((m) => !m.isLongVideo);
  const userVideos = allMoments.filter((m) => m.isLongVideo);
  // GET /api/moments/user/:id doesn't attach author name/photo (it's always
  // the one profile we're already rendering), but videoCardHtml() expects
  // them - fill them in from the profile response we just fetched.
  if (profile) {
    userVideos.forEach((v) => {
      v.userName = profile.name;
      v.userPhoto = profile.photo;
    });
  }

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
        ${isMe || userVideos.length ? `<button class="tab-btn" data-tab="videos">${I18N.t("profile.videosTab")}</button>` : ""}
        ${isMe ? `<button class="tab-btn" data-tab="friends">${I18N.t("profile.friendsTab")}</button>` : ""}
        ${isMe ? `<button class="tab-btn" data-tab="requests">${I18N.t("profile.requestsTab")}</button>` : ""}
        ${isMe ? `<button class="tab-btn" data-tab="saved">${I18N.t("profile.savedTab")}</button>` : ""}
        ${isMe ? `<button class="tab-btn" data-tab="blocked">${I18N.t("profile.blockedTab")}</button>` : ""}
        ${isMe ? `<button class="tab-btn" data-tab="offers">${I18N.t("profile.myOffers")}</button>` : ""}
        ${isMe ? `<button class="tab-btn" data-tab="analytics">${I18N.t("profile.analyticsTab")}</button>` : ""}
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

      ${
        isMe || userVideos.length
          ? `<div id="tab-videos" style="display:none;">
               <div class="videos-grid">
                 ${
                   userVideos.length
                     ? userVideos.map(videoCardHtml).join("")
                     : `<div class="empty-state">${I18N.t("videos.emptyChannel")}</div>`
                 }
               </div>
             </div>`
          : ""
      }
      ${isMe ? `<div id="tab-friends" style="display:none;"></div>` : ""}
      ${isMe ? `<div id="tab-requests" style="display:none;"></div>` : ""}
      ${isMe ? `<div id="tab-saved" style="display:none;"></div>` : ""}
      ${isMe ? `<div id="tab-blocked" style="display:none;"></div>` : ""}
      ${isMe ? `<div id="tab-offers" style="display:none;"></div>` : ""}
      ${isMe ? `<div id="tab-analytics" style="display:none;"></div>` : ""}
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
      ["listings", "photos", "reviews", "videos", "friends", "requests", "saved", "blocked", "offers", "analytics", "notifications", "ads"].forEach((t) => {
        const el = document.getElementById("tab-" + t);
        if (el) el.style.display = t === btn.dataset.tab ? "block" : "none";
      });
      if (btn.dataset.tab === "friends" && isMe) await renderFriendsTab();
      if (btn.dataset.tab === "requests" && isMe) await renderRequestsTab();
      if (btn.dataset.tab === "saved" && isMe) await renderSavedTab();
      if (btn.dataset.tab === "blocked" && isMe) await renderBlockedTab();
      if (btn.dataset.tab === "offers" && isMe) await renderMyOffers();
      if (btn.dataset.tab === "analytics" && isMe) await renderCreatorAnalyticsTab();
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

// Creator Analytics tab: lazy-loaded on first click, same pattern as
// renderSavedTab/renderMyOffers above. Combines lifetime like/save/comment
// counters (see server.js incrementUserStat) with a real
// 7-day-vs-previous-7-day views trend and per-Moment stats for the user's
// most recent Moments (Moments are permanent now, so this is no longer
// filtered to "active"/non-expired ones - see server.js /api/creator/stats).
// The percent-change math for the views trend is computed client-side from
// the raw views7d/views7dPrev counts the backend returns, guarding the
// views7dPrev === 0 case (nothing to compare against).
async function renderCreatorAnalyticsTab() {
  const el = document.getElementById("tab-analytics");
  if (!el) return;
  el.innerHTML = `<p>${I18N.t("common.loading")}</p>`;

  let data;
  try {
    data = await api("/api/creator/stats", { auth: true });
  } catch (e) {
    el.innerHTML = `<p class="form-msg error">${escapeHtml(e.message)}</p>`;
    return;
  }

  const lifetime = data.lifetime || { likesReceived: 0, savesReceived: 0, commentsReceived: 0 };

  let trendHtml;
  if (!data.views7dPrev) {
    trendHtml = I18N.t("analytics.viewsTrendNoPrev").replace("{views}", data.views7d);
  } else {
    const pctChange = ((data.views7d - data.views7dPrev) / data.views7dPrev) * 100;
    const sign = pctChange >= 0 ? "▲" : "▼";
    trendHtml = I18N.t("analytics.viewsTrend")
      .replace("{views}", data.views7d)
      .replace("{sign}", sign)
      .replace("{pct}", Math.abs(Math.round(pctChange)));
  }

  const completionHtml =
    data.completionRate7d === null || data.completionRate7d === undefined
      ? I18N.t("analytics.completionRateUnavailable")
      : Math.round(data.completionRate7d * 100) + "%";

  const recentMoments = data.recentMoments || [];

  el.innerHTML = `
    <div class="form-panel" style="max-width:none;">
      <h3 class="section-subheading">${I18N.t("analytics.sectionTitle")}</h3>
      <p class="analytics-disclaimer">${I18N.t("analytics.disclaimer")}</p>

      <div class="analytics-stat-grid">
        <div class="analytics-stat-card">
          <span class="analytics-stat-value">${data.followerCount || 0}</span>
          <span class="analytics-stat-label">${I18N.t("analytics.followers")}</span>
        </div>
        <div class="analytics-stat-card">
          <span class="analytics-stat-value">${lifetime.likesReceived}</span>
          <span class="analytics-stat-label">${I18N.t("analytics.likesReceived")}</span>
        </div>
        <div class="analytics-stat-card">
          <span class="analytics-stat-value">${lifetime.savesReceived}</span>
          <span class="analytics-stat-label">${I18N.t("analytics.savesReceived")}</span>
        </div>
        <div class="analytics-stat-card">
          <span class="analytics-stat-value">${lifetime.commentsReceived}</span>
          <span class="analytics-stat-label">${I18N.t("analytics.commentsReceived")}</span>
        </div>
      </div>

      <p class="analytics-trend-line">${trendHtml}</p>
      <p class="analytics-trend-line">${I18N.t("analytics.completionRate")}: <strong>${completionHtml}</strong></p>

      <h4 class="section-subheading">${I18N.t("analytics.recentMomentsTitle")}</h4>
      ${
        recentMoments.length
          ? `<div class="analytics-moment-list">
              ${recentMoments
                .map(
                  (m) => `
                <div class="analytics-moment-row">
                  <div class="analytics-moment-meta">
                    <span class="analytics-moment-caption">${escapeHtml(m.caption || (m.mediaType === "video" ? "\u{1F3A5}" : "\u{1F5BC}️"))}</span>
                    <span class="analytics-moment-expires">${I18N.t("analytics.postedOn")}: ${fmtDate(m.createdAt)}</span>
                  </div>
                  <div class="analytics-moment-stats">
                    <span>${I18N.t("analytics.momentViews")}: ${m.viewCount}</span>
                    <span>${I18N.t("analytics.momentLikes")}: ${m.likeCount}</span>
                    <span>${I18N.t("analytics.momentSaves")}: ${m.saveCount}</span>
                    <span>${I18N.t("analytics.momentComments")}: ${m.commentCount}</span>
                  </div>
                </div>`
                )
                .join("")}
            </div>`
          : `<div class="empty-state">${I18N.t("analytics.recentMomentsEmpty")}</div>`
      }
    </div>
  `;
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

// ---------------- Realtime chat (WebSocket client) - task #234 ----------------
// Talks to the wire contract documented in server.js's "realtime chat
// (WebSocket)" section (task #233) - read that doc-comment block first if
// touching anything below. The socket is opened app-wide on login (see
// setAuth() and the bottom "Init" section) and kept alive across page
// navigation, not just while #/messages is open, so presence/typing/live
// delivery and the unread badge all work from anywhere in the app.
//
// Progressive enhancement: the REST endpoints (GET /api/conversations,
// GET /api/conversations/:id) remain the single source of truth and are
// always used for the initial load of any view. The poll loop started in
// renderMessages() below only actually performs a fetch while
// chatSocketConnected is false - i.e. it's a fallback for when the socket
// never connects at all (old browser, blocked WS, flaky network), not a
// second parallel update path once the socket is live.

let chatSocket = null;
let chatSocketConnected = false; // true once THIS socket's "connected" frame arrived
let chatReconnectAttempts = 0;
let chatReconnectTimer = null;
const CHAT_RECONNECT_BASE_MS = 1000;
const CHAT_RECONNECT_MAX_MS = 30000;

const chatState = {
  activeOtherId: null, // otherUserId of the open thread, or null
  otherUser: null, // { id, name, photo } of the open thread's other participant
  messages: [], // open thread's messages, oldest -> newest, id-keyed source of truth
  convos: [], // last loaded conversation list (cache, not authoritative)
  presence: {}, // userId -> { online, lastSeenAt }
  typingTimer: null, // clears the "typing..." indicator if typing:stop never arrives
  replyTarget: null, // message object currently staged as a reply quote, or null
  myTypingActive: false,
  myTypingIdleTimer: null,
  pendingAttachment: null, // { dataUrl, kind: "image"|"video" } staged before sending
};

function chatWsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return proto + "//" + location.host + "/ws?token=" + encodeURIComponent(state.token);
}

function connectChatSocket() {
  if (!state.token) return;
  if (chatSocket && (chatSocket.readyState === WebSocket.OPEN || chatSocket.readyState === WebSocket.CONNECTING)) return;
  if (chatReconnectTimer) { clearTimeout(chatReconnectTimer); chatReconnectTimer = null; }
  let ws;
  try {
    ws = new WebSocket(chatWsUrl());
  } catch (e) {
    scheduleChatReconnect();
    return;
  }
  chatSocket = ws;
  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    handleChatSocketMessage(msg);
  });
  ws.addEventListener("close", () => {
    chatSocketConnected = false;
    if (chatSocket === ws) chatSocket = null;
    if (state.token) scheduleChatReconnect();
  });
  ws.addEventListener("error", () => {
    // The browser always follows "error" with "close" for WebSocket, which
    // does the actual reconnect scheduling above - nothing extra needed here.
  });
}

function scheduleChatReconnect() {
  if (chatReconnectTimer || !state.token) return;
  // Exponential backoff (1s, 2s, 4s, ... capped at 30s) so a dropped
  // connection (mobile network blip, backgrounding) doesn't hammer the
  // server, but chat quietly comes back on its own without the user having
  // to refresh the page.
  const delay = Math.min(CHAT_RECONNECT_BASE_MS * Math.pow(2, chatReconnectAttempts), CHAT_RECONNECT_MAX_MS);
  chatReconnectAttempts++;
  chatReconnectTimer = setTimeout(() => {
    chatReconnectTimer = null;
    connectChatSocket();
  }, delay);
}

function disconnectChatSocket() {
  if (chatReconnectTimer) { clearTimeout(chatReconnectTimer); chatReconnectTimer = null; }
  chatReconnectAttempts = 0;
  chatSocketConnected = false;
  if (chatSocket) {
    // The "close" listener registered in connectChatSocket() will still
    // fire after this - harmless, since it only schedules a reconnect when
    // state.token is set, and setAuth(null, null) always clears the token
    // before calling this on logout.
    try { chatSocket.close(); } catch (e) {}
    chatSocket = null;
  }
}

function wsSendChat(obj) {
  if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
    try { chatSocket.send(JSON.stringify(obj)); } catch (e) {}
  }
}

function handleChatSocketMessage(msg) {
  if (!msg || typeof msg.type !== "string") return;
  if (msg.type === "connected") {
    chatSocketConnected = true;
    chatReconnectAttempts = 0;
    return;
  }
  if (msg.type === "message:new") return onChatMessageNew(msg.message);
  if (msg.type === "message:read") return onChatMessageRead(msg);
  if (msg.type === "reaction:added" || msg.type === "reaction:removed") return onChatReactionChanged(msg);
  if (msg.type === "message:deleted") return onChatMessageDeleted(msg);
  if (msg.type === "presence:update" || msg.type === "presence:result") return onChatPresenceUpdate(msg);
  if (msg.type === "typing") return onChatTyping(msg);
  // Unknown types (pong, auth:error, ...) are ignored client-side too - same
  // forward-compatible convention as the server's envelope contract.
}

function isMessagesRouteOpen() {
  return !!document.getElementById("convo-list");
}

function onChatMessageNew(message) {
  if (!state.user) return;
  const myId = state.user.id;
  const otherId = message.fromUserId === myId ? message.toUserId : message.fromUserId;
  pollUnread();
  if (isMessagesRouteOpen()) loadConvoList(chatState.activeOtherId);
  if (chatState.activeOtherId && otherId === chatState.activeOtherId) {
    // Re-fetch the thread from the server (rather than just appending the
    // pushed message locally) so read-receipts flip correctly - per
    // server.js's documented contract, `read` only flips via a GET
    // /api/conversations/:id call, which this triggers.
    loadChatThread(otherId, { keepSkeleton: true });
  }
}

function onChatMessageRead(msg) {
  if (msg.conversationWith !== chatState.activeOtherId) return;
  let changed = false;
  chatState.messages.forEach((m) => {
    if (msg.messageIds.includes(m.id)) { m.read = true; changed = true; }
  });
  if (changed) renderThreadMessages([]);
}

function onChatReactionChanged(msg) {
  const m = chatState.messages.find((x) => x.id === msg.messageId);
  if (m) {
    m.reactions = msg.reactions;
    renderThreadMessages([]);
  }
}

function onChatMessageDeleted(msg) {
  if (msg.mode === "forEveryone") {
    const m = chatState.messages.find((x) => x.id === msg.messageId);
    if (m) {
      m.deleted = true;
      m.text = "";
      m.attachmentUrl = null;
      m.attachmentType = null;
      m.reactions = {};
      renderThreadMessages([]);
    }
  } else if (msg.mode === "forMe") {
    // Only echoed to the caller's OWN other tabs/sessions (see server.js) -
    // safe to always apply since it can only ever be about our own view.
    const idx = chatState.messages.findIndex((x) => x.id === msg.messageId);
    if (idx !== -1) {
      chatState.messages.splice(idx, 1);
      renderThreadMessages([]);
    }
  }
  if (isMessagesRouteOpen()) loadConvoList(chatState.activeOtherId);
  pollUnread();
}

function onChatPresenceUpdate(msg) {
  chatState.presence[msg.userId] = { online: msg.online, lastSeenAt: msg.lastSeenAt };
  updatePresenceDom(msg.userId);
}

function onChatTyping(msg) {
  if (msg.from !== chatState.activeOtherId) return;
  const row = document.getElementById("chat-typing-row");
  if (!row) return;
  clearTimeout(chatState.typingTimer);
  if (msg.state === "start") {
    row.style.display = "";
    // Safety timeout in case a typing:stop frame is lost (dropped
    // connection mid-type) - the indicator doesn't stick around forever.
    chatState.typingTimer = setTimeout(() => { row.style.display = "none"; }, 6000);
    const container = document.getElementById("chat-messages");
    if (container && container.scrollHeight - container.scrollTop - container.clientHeight < 150) {
      container.scrollTop = container.scrollHeight;
    }
  } else {
    row.style.display = "none";
  }
}

async function fetchPresenceOnce(userId) {
  try {
    const p = await api("/api/users/" + userId + "/presence", { auth: true });
    chatState.presence[userId] = p;
    updatePresenceDom(userId);
  } catch (e) {}
}

function updatePresenceDom(userId) {
  const p = chatState.presence[userId];
  if (!p) return;
  document.querySelectorAll('[data-presence-dot-for="' + userId + '"]').forEach((el) => {
    el.classList.toggle("online", !!p.online);
  });
  if (chatState.activeOtherId === userId) {
    const sub = document.getElementById("chat-thread-presence");
    if (sub) sub.innerHTML = presenceLineHtml(p);
    renderThreadMessages([]); // read-receipt "delivered" state depends on the other user's online-ness
  }
}

function presenceLineHtml(p) {
  if (!p) return I18N.t("messages.offline");
  if (p.online) return `<span class="presence-dot online inline"></span>${I18N.t("messages.online")}`;
  if (p.lastSeenAt) return escapeHtml(I18N.t("messages.lastSeenPrefix") + " " + timeAgoStr(p.lastSeenAt));
  return I18N.t("messages.offline");
}

// ---------------- Messages (conversation list + thread view) ----------------

let convoPollTimer = null;
let presenceRefreshTimer = null;

async function renderMessages(otherUserId) {
  if (!state.token) {
    viewEl.innerHTML = `<p class="form-msg" style="text-align:center;">${I18N.t("messages.loginRequired")} <a href="#/login">${I18N.t("nav.login")}</a></p>`;
    return;
  }
  if (convoPollTimer) { clearInterval(convoPollTimer); convoPollTimer = null; }
  if (presenceRefreshTimer) { clearInterval(presenceRefreshTimer); presenceRefreshTimer = null; }
  chatState.activeOtherId = otherUserId || null;
  chatState.messages = [];
  chatState.replyTarget = null;
  chatState.pendingAttachment = null;

  viewEl.innerHTML = `
    <h2 class="section-heading">${I18N.t("messages.inbox")}</h2>
    <div class="messages-layout">
      <div class="convo-list" id="convo-list"></div>
      <div class="chat-panel" id="chat-panel"></div>
    </div>
  `;

  connectChatSocket(); // no-op if already open/connecting

  await loadConvoList(otherUserId);
  if (otherUserId) await loadChatThread(otherUserId);

  // REST fallback poll - only actually fetches while the socket hasn't
  // connected (see the doc-comment at the top of this section).
  convoPollTimer = setInterval(async () => {
    if (chatSocketConnected) return;
    await loadConvoList(chatState.activeOtherId);
    if (chatState.activeOtherId) await loadChatThread(chatState.activeOtherId, { keepSkeleton: true });
  }, 4000);

  if (otherUserId) {
    presenceRefreshTimer = setInterval(() => {
      if (chatState.activeOtherId) fetchPresenceOnce(chatState.activeOtherId);
    }, 30000);
  }
}

function convoPreviewText(c) {
  if (c.lastMessageDeleted) return I18N.t("messages.deletedTombstone");
  if (c.lastMessageAttachmentType === "audio") return "\u{1F3A4} " + I18N.t("messages.voiceMessage");
  if (c.lastMessageAttachmentType === "video") return "\u{1F3A5} " + I18N.t("messages.video");
  if (c.lastMessageAttachmentType === "image") return "\u{1F4F7} " + I18N.t("messages.photo");
  return c.lastMessage || "";
}

async function loadConvoList(activeId) {
  const list = document.getElementById("convo-list");
  if (!list) return;
  let convos;
  try {
    convos = await api("/api/conversations", { auth: true });
  } catch (e) {
    return;
  }
  chatState.convos = convos;
  setUnreadBadge(convos.filter((c) => c.unread).length);
  list.innerHTML = convos.length
    ? convos
        .map((c) => {
          const presence = chatState.presence[c.userId];
          const online = presence ? presence.online : false;
          return `
      <a class="convo-item ${c.userId === activeId ? "active" : ""} ${c.unread ? "unread" : ""}" href="#/messages/${c.userId}">
        <span class="convo-avatar-wrap">
          ${c.userPhoto ? `<img class="convo-avatar" src="${c.userPhoto}" />` : `<div class="seller-avatar-placeholder convo-avatar">${initials(c.userName)}</div>`}
          <span class="presence-dot ${online ? "online" : ""}" data-presence-dot-for="${c.userId}"></span>
        </span>
        <div class="convo-text">
          <div class="convo-name">${escapeHtml(c.userName)}</div>
          <div class="convo-preview">${escapeHtml(convoPreviewText(c))}</div>
        </div>
        <div class="convo-meta">
          <span class="convo-time">${timeAgoStr(c.lastAt)}</span>
          ${c.unread ? `<span class="convo-unread-badge" aria-label="${I18N.t("messages.unread")}"></span>` : ""}
        </div>
      </a>`;
        })
        .join("")
    : `<div class="empty-state messages-empty">
        <p>${I18N.t("messages.noConversations")}</p>
        <a href="#/marketplace" class="btn btn-secondary">${I18N.t("messages.emptyBrowseCta")}</a>
      </div>`;
  // Best-effort presence for conversation partners not yet covered by a live
  // presence:update - one request per partner, only for what's on screen.
  convos.slice(0, 20).forEach((c) => {
    if (!chatState.presence[c.userId]) fetchPresenceOnce(c.userId);
  });
}

// ---- Thread view ----

function chatPanelSkeletonHtml(other) {
  return `
    <div class="chat-thread-header">
      <a href="#/profile/${other.id}" class="chat-thread-avatar-link">
        ${other.photo ? `<img src="${other.photo}" alt="" />` : `<div class="seller-avatar-placeholder">${initials(other.name)}</div>`}
      </a>
      <div class="chat-thread-headtext">
        <a href="#/profile/${other.id}" class="chat-thread-name">${escapeHtml(other.name || "")}</a>
        <div class="chat-thread-presence" id="chat-thread-presence">${I18N.t("messages.offline")}</div>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-typing-row" id="chat-typing-row" style="display:none;">
      <div class="chat-bubble theirs typing-bubble"><span></span><span></span><span></span></div>
    </div>
    <div class="chat-reply-preview" id="chat-reply-preview" style="display:none;"></div>
    <div class="chat-attach-preview" id="chat-attach-preview" style="display:none;"></div>
    <div class="chat-record-overlay" id="chat-record-overlay" style="display:none;"></div>
    <div class="chat-input-row">
      <button type="button" class="chat-icon-btn" id="chat-attach-btn" title="${I18N.t("messages.attach")}" aria-label="${I18N.t("messages.attach")}">\u{1F4CE}</button>
      <input type="file" id="chat-file-input" accept="image/*,video/*" style="display:none;" />
      <input id="chat-text" placeholder="${I18N.t("messages.typeMessage")}" autocomplete="off" />
      <button type="button" class="chat-icon-btn chat-mic-btn" id="chat-mic-btn" title="${I18N.t("messages.holdToRecord")}" aria-label="${I18N.t("messages.holdToRecord")}">\u{1F3A4}</button>
      <button type="button" class="btn btn-primary chat-send-btn" id="chat-send" style="display:none;">${I18N.t("messages.send")}</button>
    </div>
  `;
}

async function loadChatThread(otherUserId, opts) {
  opts = opts || {};
  const panel = document.getElementById("chat-panel");
  if (!panel) return;

  if (panel.dataset.threadFor !== otherUserId) {
    let other;
    try {
      other = await api("/api/users/" + otherUserId);
    } catch (e) {
      other = { id: otherUserId, name: "?" };
    }
    chatState.otherUser = other;
    panel.dataset.threadFor = otherUserId;
    panel.innerHTML = chatPanelSkeletonHtml(other);
    wireChatPanel(otherUserId);
    fetchPresenceOnce(otherUserId);
  }

  let messages;
  try {
    messages = await api("/api/conversations/" + otherUserId, { auth: true });
  } catch (e) {
    return;
  }
  const prevIds = new Set(chatState.messages.map((m) => m.id));
  chatState.messages = messages;
  const newIds = messages.filter((m) => !prevIds.has(m.id)).map((m) => m.id);
  renderThreadMessages(newIds);
  pollUnread();
  if (isMessagesRouteOpen()) loadConvoList(chatState.activeOtherId);
}

function mergeIncomingMessage(m) {
  const idx = chatState.messages.findIndex((x) => x.id === m.id);
  if (idx === -1) chatState.messages.push(m);
  else chatState.messages[idx] = m;
  chatState.messages.sort((a, b) => a.createdAt - b.createdAt);
  renderThreadMessages([m.id]);
  if (isMessagesRouteOpen()) loadConvoList(chatState.activeOtherId);
}

function renderThreadMessages(newIds) {
  const container = document.getElementById("chat-messages");
  if (!container) return;
  const newSet = new Set(newIds || []);
  const wasEmpty = !container.dataset.everRendered;
  const nearBottom = wasEmpty || container.scrollHeight - container.scrollTop - container.clientHeight < 150;
  container.innerHTML = chatState.messages.map((m) => messageRowHtml(m, newSet.has(m.id))).join("");
  container.dataset.everRendered = "1";
  wireVoicePlayers(container);
  // Only auto-scroll if the user was already near the bottom (or this is
  // the first render) - don't yank them away from history they scrolled up
  // to read, per task #234's UX requirement.
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

const CHAT_REACTION_EMOJIS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}"];

function attachmentPreviewLabel(m) {
  if (m.attachmentType === "audio") return "\u{1F3A4} " + I18N.t("messages.voiceMessage");
  if (m.attachmentType === "video") return "\u{1F3A5} " + I18N.t("messages.video");
  if (m.attachmentType === "image") return "\u{1F4F7} " + I18N.t("messages.photo");
  return "";
}

function truncateText(s, n) {
  s = s || "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function replyQuoteHtml(replyToId) {
  const orig = chatState.messages.find((x) => x.id === replyToId);
  if (!orig) return `<div class="chat-reply-quote" data-scroll-to="${replyToId}">${I18N.t("messages.originalMessage")}</div>`;
  const label = orig.deleted ? I18N.t("messages.deletedTombstone") : orig.text || attachmentPreviewLabel(orig);
  return `<div class="chat-reply-quote" data-scroll-to="${replyToId}">${escapeHtml(truncateText(label, 80))}</div>`;
}

function attachmentHtml(m) {
  if (!m.attachmentType || !m.attachmentUrl) return "";
  if (m.attachmentType === "image") {
    return `<img class="chat-attach-img" src="${m.attachmentUrl}" data-lightbox-url="${m.attachmentUrl}" data-lightbox-type="image" alt="" />`;
  }
  if (m.attachmentType === "video") {
    return `<div class="chat-attach-video" data-lightbox-url="${m.attachmentUrl}" data-lightbox-type="video">
      <video src="${m.attachmentUrl}#t=0.1" preload="metadata" muted playsinline></video>
      <span class="chat-attach-play-badge">▶</span>
    </div>`;
  }
  if (m.attachmentType === "audio") {
    return `<div class="voice-player">
      <audio src="${m.attachmentUrl}" preload="metadata"></audio>
      <button type="button" class="voice-player-btn" aria-label="${I18N.t("messages.play")}">▶</button>
      <div class="voice-player-track"><div class="voice-player-fill"></div></div>
      <span class="voice-player-time">0:00</span>
    </div>`;
  }
  return "";
}

function reactionPillsHtml(m) {
  const entries = Object.entries(m.reactions || {}).filter(([, users]) => users && users.length);
  if (!entries.length) return "";
  const myId = state.user.id;
  return `<div class="chat-reaction-pills">${entries
    .map(
      ([emoji, users]) =>
        `<button type="button" class="chat-reaction-pill ${users.includes(myId) ? "mine" : ""}" data-message-id="${m.id}" data-emoji="${emoji}">${emoji} <span>${users.length}</span></button>`
    )
    .join("")}</div>`;
}

function fmtMsgTime(ts) {
  return new Date(ts).toLocaleTimeString(I18N.lang === "es" ? "es-ES" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

function receiptHtml(m) {
  if (m.read) return `<span class="chat-receipt read" title="${I18N.t("messages.read")}">✓✓</span>`;
  const other = chatState.presence[m.toUserId];
  if (other && other.online) return `<span class="chat-receipt delivered" title="${I18N.t("messages.delivered")}">✓✓</span>`;
  return `<span class="chat-receipt sent" title="${I18N.t("messages.sent")}">✓</span>`;
}

function messageRowHtml(m, isNew) {
  const mine = m.fromUserId === state.user.id;
  const rowClasses = ["chat-msg-row", mine ? "mine" : "theirs"];
  if (isNew) rowClasses.push("msg-enter");
  let inner;
  if (m.deleted) {
    inner = `<div class="chat-bubble ${mine ? "mine" : "theirs"} deleted">${I18N.t("messages.deletedTombstone")}</div>`;
  } else {
    inner = `
      <div class="chat-bubble ${mine ? "mine" : "theirs"} ${!m.text && m.attachmentType ? "media-only" : ""}">
        ${m.replyToId ? replyQuoteHtml(m.replyToId) : ""}
        ${attachmentHtml(m)}
        ${m.text ? `<div class="chat-bubble-text">${escapeHtml(m.text)}</div>` : ""}
        <div class="chat-bubble-meta">
          <span class="chat-bubble-time">${fmtMsgTime(m.createdAt)}</span>
          ${mine ? receiptHtml(m) : ""}
        </div>
      </div>
      ${reactionPillsHtml(m)}
    `;
  }
  return `<div class="${rowClasses.join(" ")}" data-message-id="${m.id}" data-from-id="${m.fromUserId}">${inner}</div>`;
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}

// Minimal custom voice-note player (play/pause + elapsed/total time + a
// slim progress bar) instead of a raw <audio controls> element, matching
// the app's own visual style. `timeupdate`/`loadedmetadata`/`ended` don't
// bubble, so each <audio> needs its own listeners wired once (tracked via
// dataset.wired, same one-time-wiring convention used elsewhere in app.js).
function wireVoicePlayers(container) {
  container.querySelectorAll(".voice-player audio").forEach((audio) => {
    if (audio.dataset.wired) return;
    audio.dataset.wired = "1";
    const wrap = audio.closest(".voice-player");
    const btn = wrap.querySelector(".voice-player-btn");
    const fill = wrap.querySelector(".voice-player-fill");
    const timeEl = wrap.querySelector(".voice-player-time");
    audio.addEventListener("loadedmetadata", () => {
      if (isFinite(audio.duration)) timeEl.textContent = fmtDuration(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
      if (audio.duration) {
        fill.style.width = (audio.currentTime / audio.duration) * 100 + "%";
        timeEl.textContent = fmtDuration(audio.currentTime);
      }
    });
    audio.addEventListener("play", () => { btn.textContent = "⏸"; });
    audio.addEventListener("pause", () => {
      btn.textContent = "▶";
      if (audio.ended) { fill.style.width = "0%"; timeEl.textContent = isFinite(audio.duration) ? fmtDuration(audio.duration) : "0:00"; }
    });
  });
}

function scrollToMessage(id) {
  const row = document.querySelector('.chat-msg-row[data-message-id="' + id + '"]');
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("highlight-flash");
  setTimeout(() => row.classList.remove("highlight-flash"), 1200);
}

function openChatLightbox(url, type) {
  const overlay = document.createElement("div");
  overlay.className = "chat-lightbox-overlay";
  overlay.innerHTML = `
    <button type="button" class="chat-lightbox-close" aria-label="${I18N.t("common.close")}">×</button>
    <div class="chat-lightbox-media-wrap">
      ${
        type === "video"
          ? `<video src="${url}" controls autoplay playsinline class="chat-lightbox-media"></video>`
          : `<img src="${url}" class="chat-lightbox-media" alt="" />`
      }
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".chat-lightbox-close")) overlay.remove();
  });
}

async function toggleMyReaction(messageId, emoji) {
  const m = chatState.messages.find((x) => x.id === messageId);
  if (!m) return;
  const myId = state.user.id;
  const already = !!(m.reactions && m.reactions[emoji] && m.reactions[emoji].includes(myId));
  try {
    const res = await api("/api/messages/" + messageId + "/react", { method: already ? "DELETE" : "POST", auth: true, body: { emoji } });
    m.reactions = res.reactions;
    renderThreadMessages([]);
  } catch (e) {}
}

async function deleteChatMessage(messageId, mode) {
  try {
    await api("/api/messages/" + messageId, { method: "DELETE", auth: true, body: { mode } });
    if (mode === "forMe") {
      const idx = chatState.messages.findIndex((x) => x.id === messageId);
      if (idx !== -1) chatState.messages.splice(idx, 1);
    } else {
      const m = chatState.messages.find((x) => x.id === messageId);
      if (m) {
        m.deleted = true;
        m.text = "";
        m.attachmentUrl = null;
        m.attachmentType = null;
        m.reactions = {};
      }
    }
    renderThreadMessages([]);
    loadConvoList(chatState.activeOtherId);
  } catch (e) {
    alert(e.message);
  }
}

function setReplyTargetById(id) {
  const m = chatState.messages.find((x) => x.id === id);
  if (!m || m.deleted) return;
  chatState.replyTarget = m;
  renderReplyPreview();
  const input = document.getElementById("chat-text");
  if (input) input.focus();
}

function clearReplyTarget() {
  chatState.replyTarget = null;
  renderReplyPreview();
}

function renderReplyPreview() {
  const el = document.getElementById("chat-reply-preview");
  if (!el) return;
  if (!chatState.replyTarget) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  const m = chatState.replyTarget;
  const label = m.text || attachmentPreviewLabel(m);
  el.style.display = "flex";
  el.innerHTML = `
    <div class="chat-reply-preview-bar">
      <span class="chat-reply-preview-text">${escapeHtml(truncateText(label, 90))}</span>
      <button type="button" class="chat-reply-cancel" data-reply-cancel aria-label="${I18N.t("common.close")}">×</button>
    </div>`;
}

function closeMessageActionSheet() {
  const existing = document.getElementById("chat-action-overlay");
  if (existing) existing.remove();
}

function openMessageActionSheet(messageId) {
  const m = chatState.messages.find((x) => x.id === messageId);
  if (!m || m.deleted) return;
  closeMessageActionSheet();
  const mine = m.fromUserId === state.user.id;
  const overlay = document.createElement("div");
  overlay.className = "chat-action-overlay";
  overlay.id = "chat-action-overlay";
  overlay.innerHTML = `
    <div class="chat-action-sheet">
      <div class="chat-reaction-row">
        ${CHAT_REACTION_EMOJIS.map((em) => `<button type="button" class="chat-reaction-choice" data-emoji="${em}">${em}</button>`).join("")}
      </div>
      <button type="button" class="chat-action-item" data-action="reply">${I18N.t("messages.reply")}</button>
      <button type="button" class="chat-action-item" data-action="deleteForMe">${I18N.t("messages.deleteForMe")}</button>
      ${mine ? `<button type="button" class="chat-action-item danger" data-action="deleteForEveryone">${I18N.t("messages.deleteForEveryone")}</button>` : ""}
      <button type="button" class="chat-action-item" data-action="cancel">${I18N.t("common.cancel")}</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", async (e) => {
    if (e.target === overlay) return closeMessageActionSheet();
    const emojiBtn = e.target.closest(".chat-reaction-choice");
    if (emojiBtn) {
      await toggleMyReaction(messageId, emojiBtn.dataset.emoji);
      closeMessageActionSheet();
      return;
    }
    const actionBtn = e.target.closest(".chat-action-item");
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;
    closeMessageActionSheet();
    if (action === "reply") setReplyTargetById(messageId);
    else if (action === "deleteForMe") deleteChatMessage(messageId, "forMe");
    else if (action === "deleteForEveryone") deleteChatMessage(messageId, "forEveryone");
  });
}

// Long-press (mouse+touch, via Pointer Events) opens the reaction/action
// sheet; a short horizontal drag on a bubble is the WhatsApp-style
// swipe-to-reply gesture. Both share one pointerdown->move->up state
// machine per container so they don't fight each other.
function wireLongPressAndSwipe(container) {
  const LONG_PRESS_MS = 450;
  const SWIPE_THRESHOLD = 56;
  let pressTimer = null;
  let pressTarget = null;
  let startX = 0, startY = 0, tracking = false, swiped = false;

  const clearPress = () => { clearTimeout(pressTimer); pressTimer = null; };

  container.addEventListener("pointerdown", (e) => {
    const row = e.target.closest(".chat-msg-row");
    if (!row || row.classList.contains("deleted")) return;
    if (e.target.closest(".chat-reaction-pill, .voice-player-btn, [data-lightbox-url], .chat-reply-quote")) return;
    pressTarget = row;
    startX = e.clientX;
    startY = e.clientY;
    tracking = true;
    swiped = false;
    pressTimer = setTimeout(() => {
      if (!tracking) return;
      openMessageActionSheet(row.dataset.messageId);
      tracking = false;
    }, LONG_PRESS_MS);
  });
  container.addEventListener("pointermove", (e) => {
    if (!tracking || !pressTarget) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 30) {
      clearPress();
      tracking = false;
      pressTarget.classList.remove("swiping");
      pressTarget.style.transform = "";
      return;
    }
    if (dx > 12 && dx < 140) {
      clearPress(); // horizontal drag cancels the long-press timer and becomes a swipe
      pressTarget.classList.add("swiping");
      pressTarget.style.transform = "translateX(" + dx + "px)";
      swiped = dx > SWIPE_THRESHOLD;
    }
  });
  const endPress = () => {
    clearPress();
    if (pressTarget) {
      if (swiped) setReplyTargetById(pressTarget.dataset.messageId);
      pressTarget.classList.remove("swiping");
      pressTarget.style.transform = "";
    }
    tracking = false;
    swiped = false;
    pressTarget = null;
  };
  container.addEventListener("pointerup", endPress);
  container.addEventListener("pointerleave", endPress);
  container.addEventListener("pointercancel", endPress);
}

function toggleComposeButtons() {
  const input = document.getElementById("chat-text");
  const sendBtn = document.getElementById("chat-send");
  const micBtn = document.getElementById("chat-mic-btn");
  if (!input || !sendBtn || !micBtn) return;
  const hasText = input.value.trim().length > 0;
  sendBtn.style.display = hasText ? "" : "none";
  micBtn.style.display = hasText ? "none" : "";
}

function handleMyTyping(otherUserId) {
  if (!chatState.myTypingActive) {
    chatState.myTypingActive = true;
    wsSendChat({ type: "typing:start", to: otherUserId });
  }
  clearTimeout(chatState.myTypingIdleTimer);
  chatState.myTypingIdleTimer = setTimeout(() => stopMyTyping(otherUserId), 3000);
}

function stopMyTyping(otherUserId) {
  clearTimeout(chatState.myTypingIdleTimer);
  chatState.myTypingIdleTimer = null;
  if (chatState.myTypingActive) {
    chatState.myTypingActive = false;
    wsSendChat({ type: "typing:stop", to: otherUserId });
  }
}

async function sendChatText() {
  const input = document.getElementById("chat-text");
  const otherId = chatState.activeOtherId;
  if (!input || !otherId) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  toggleComposeButtons();
  stopMyTyping(otherId);
  const body = { text };
  if (chatState.replyTarget) body.replyToId = chatState.replyTarget.id;
  clearReplyTarget();
  try {
    const sent = await api("/api/conversations/" + otherId, { method: "POST", auth: true, body });
    mergeIncomingMessage(sent);
  } catch (e) {
    alert(e.message);
  }
}

function stageChatAttachment(file) {
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isVideo) return;
  const reader = new FileReader();
  reader.onload = () => {
    chatState.pendingAttachment = { dataUrl: reader.result, kind: isImage ? "image" : "video" };
    renderAttachPreview();
  };
  reader.readAsDataURL(file);
}

function renderAttachPreview() {
  const el = document.getElementById("chat-attach-preview");
  if (!el) return;
  const a = chatState.pendingAttachment;
  if (!a) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  el.style.display = "flex";
  el.innerHTML = `
    <div class="chat-attach-preview-bar">
      ${a.kind === "image" ? `<img src="${a.dataUrl}" class="chat-attach-preview-thumb" />` : `<video src="${a.dataUrl}" class="chat-attach-preview-thumb" muted></video>`}
      <span class="chat-attach-preview-label">${a.kind === "image" ? I18N.t("messages.photo") : I18N.t("messages.video")}</span>
      <button type="button" class="chat-icon-btn" data-attach-cancel aria-label="${I18N.t("common.cancel")}">×</button>
      <button type="button" class="btn btn-primary chat-attach-send-btn" data-attach-send>${I18N.t("messages.send")}</button>
    </div>`;
  el.querySelector("[data-attach-cancel]").addEventListener("click", () => {
    chatState.pendingAttachment = null;
    renderAttachPreview();
  });
  el.querySelector("[data-attach-send]").addEventListener("click", sendChatAttachment);
}

async function sendChatAttachment() {
  const a = chatState.pendingAttachment;
  const otherId = chatState.activeOtherId;
  if (!a || !otherId) return;
  chatState.pendingAttachment = null;
  renderAttachPreview();
  try {
    const up = await api("/api/messages/attachments", { method: "POST", auth: true, body: { media: a.dataUrl, type: a.kind, conversationWith: otherId } });
    const body = { attachmentUrl: up.url, attachmentType: up.type };
    if (chatState.replyTarget) body.replyToId = chatState.replyTarget.id;
    clearReplyTarget();
    const sent = await api("/api/conversations/" + otherId, { method: "POST", auth: true, body });
    mergeIncomingMessage(sent);
  } catch (e) {
    alert(e.message);
  }
}

// Voice-note hold-to-record: pointerdown starts recording immediately (a
// dedicated mic button, so no hold-threshold delay is needed the way the
// camera wizard needs one to disambiguate hold-vs-tap on a shared shutter
// button), pointerup releases + sends, sliding the pointer up past a
// threshold cancels - the standard WhatsApp voice-note gesture. Reuses the
// same MediaRecorder + getUserMedia({audio:true}) approach as
// wireWizardCaptureGesture()/beginHoldRecording() in the camera wizard.
function wireVoiceNoteGesture(micBtn, otherUserId) {
  if (!micBtn) return;
  let recorder = null;
  let chunks = [];
  let stream = null;
  let startTs = 0;
  let durationTimer = null;
  let canceled = false;
  let startY = 0;

  const overlayEl = () => document.getElementById("chat-record-overlay");

  const updateOverlay = (elapsedMs, dragY) => {
    const el = overlayEl();
    if (!el) return;
    const cancelZone = dragY < -70;
    el.classList.toggle("cancel-armed", cancelZone);
    el.innerHTML = `
      <div class="chat-record-pulse"></div>
      <span class="chat-record-time">${fmtDuration(Math.floor(elapsedMs / 1000))}</span>
      <span class="chat-record-hint">${cancelZone ? I18N.t("messages.releaseToCancel") : I18N.t("messages.slideToCancel")}</span>
    `;
  };

  const startRecording = async () => {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      alert(I18N.t("messages.micUnavailable"));
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alert(I18N.t("messages.micUnavailable"));
      return;
    }
    try {
      recorder = new MediaRecorder(stream);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      alert(I18N.t("messages.micUnavailable"));
      return;
    }
    chunks = [];
    canceled = false;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (!canceled && Date.now() - startTs >= 500) {
        finalizeVoiceNote(chunks, recorder.mimeType || "audio/webm", otherUserId);
      }
      chunks = [];
    };
    recorder.start(250);
    startTs = Date.now();
    micBtn.classList.add("recording");
    const el = overlayEl();
    if (el) el.style.display = "flex";
    durationTimer = setInterval(() => updateOverlay(Date.now() - startTs, 0), 200);
    updateOverlay(0, 0);
  };

  const stopRecording = (didCancel) => {
    canceled = didCancel;
    clearInterval(durationTimer);
    durationTimer = null;
    micBtn.classList.remove("recording");
    const el = overlayEl();
    if (el) {
      el.style.display = "none";
      el.classList.remove("cancel-armed");
    }
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  micBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { micBtn.setPointerCapture(e.pointerId); } catch (err) {}
    startY = e.clientY;
    startRecording();
  });
  micBtn.addEventListener("pointermove", (e) => {
    if (!recorder || recorder.state !== "recording") return;
    const dy = e.clientY - startY;
    updateOverlay(Date.now() - startTs, dy);
    if (dy < -90) stopRecording(true);
  });
  const release = () => {
    if (recorder && recorder.state === "recording") stopRecording(false);
  };
  micBtn.addEventListener("pointerup", release);
  micBtn.addEventListener("pointercancel", () => {
    if (recorder && recorder.state === "recording") stopRecording(true);
  });
}

function finalizeVoiceNote(chunks, mimeType, otherUserId) {
  const blob = new Blob(chunks, { type: mimeType.split(";")[0] || "audio/webm" });
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const up = await api("/api/messages/attachments", { method: "POST", auth: true, body: { media: reader.result, type: "audio", conversationWith: otherUserId } });
      const body = { attachmentUrl: up.url, attachmentType: up.type };
      if (chatState.replyTarget) body.replyToId = chatState.replyTarget.id;
      clearReplyTarget();
      const sent = await api("/api/conversations/" + otherUserId, { method: "POST", auth: true, body });
      mergeIncomingMessage(sent);
    } catch (e) {
      alert(e.message);
    }
  };
  reader.readAsDataURL(blob);
}

// One-time wiring for a freshly-built thread panel skeleton (called from
// loadChatThread() only when the panel is rebuilt for a new otherUserId,
// not on every message update - message-level interactions use event
// delegation on #chat-messages so they keep working across re-renders).
function wireChatPanel(otherUserId) {
  const container = document.getElementById("chat-messages");
  const input = document.getElementById("chat-text");
  const sendBtn = document.getElementById("chat-send");
  const micBtn = document.getElementById("chat-mic-btn");
  const attachBtn = document.getElementById("chat-attach-btn");
  const fileInput = document.getElementById("chat-file-input");
  const replyPreview = document.getElementById("chat-reply-preview");

  input.addEventListener("input", () => {
    toggleComposeButtons();
    handleMyTyping(otherUserId);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChatText();
    }
  });
  input.addEventListener("blur", () => stopMyTyping(otherUserId));
  sendBtn.addEventListener("click", sendChatText);

  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) stageChatAttachment(file);
    fileInput.value = "";
  });

  wireVoiceNoteGesture(micBtn, otherUserId);

  container.addEventListener("click", (e) => {
    const reactPill = e.target.closest(".chat-reaction-pill");
    if (reactPill) {
      toggleMyReaction(reactPill.dataset.messageId, reactPill.dataset.emoji);
      return;
    }
    const voiceBtn = e.target.closest(".voice-player-btn");
    if (voiceBtn) {
      const audio = voiceBtn.closest(".voice-player").querySelector("audio");
      if (audio.paused) {
        document.querySelectorAll(".voice-player audio").forEach((a) => {
          if (a !== audio) a.pause();
        });
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
      return;
    }
    const lightboxTarget = e.target.closest("[data-lightbox-url]");
    if (lightboxTarget) {
      openChatLightbox(lightboxTarget.dataset.lightboxUrl, lightboxTarget.dataset.lightboxType);
      return;
    }
    const quote = e.target.closest(".chat-reply-quote");
    if (quote) {
      scrollToMessage(quote.dataset.scrollTo);
      return;
    }
  });

  wireLongPressAndSwipe(container);

  replyPreview.addEventListener("click", (e) => {
    if (e.target.closest("[data-reply-cancel]")) clearReplyTarget();
  });

  toggleComposeButtons();
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

// Structured book-focused services a directory company can offer - keeps
// this list in sync with server.js's INTL_BOOK_SERVICES.
const INTL_BOOK_SERVICES = ["sourcing", "foreign_language", "academic", "logistics", "wholesale"];
function intlBookServiceTagsHtml(bookServices) {
  if (!bookServices || !bookServices.length) return "";
  return `<div class="intl-book-service-tags">${bookServices
    .map((s) => `<span class="intl-book-service-tag">${I18N.t("intl.bookService_" + s)}</span>`)
    .join("")}</div>`;
}

function renderIntlHome() {
  viewEl.innerHTML = `
    <div class="intl-hero">
      <h1>${I18N.t("intl.heroTitle")}</h1>
      <p>${I18N.t("intl.heroSubtitle")}</p>
    </div>
    <p class="intl-intro">${I18N.t("intl.heroIntro")}</p>
    <div class="intl-services-grid">
      ${INTL_BOOK_SERVICES.map(
        (s) => `<div class="intl-service-card"><strong>${I18N.t("intl.bookService_" + s)}</strong><p>${I18N.t("intl.bookServiceDesc_" + s)}</p></div>`
      ).join("")}
    </div>

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
  if (query.bookService) params.set("bookService", query.bookService);

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
        ${intlBookServiceTagsHtml(c.bookServices)}
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
      <select id="if-book-service">
        <option value="" ${!query.bookService ? "selected" : ""}>${I18N.t("intl.bookServiceAll")}</option>
        ${INTL_BOOK_SERVICES.map(
          (s) => `<option value="${s}" ${query.bookService === s ? "selected" : ""}>${I18N.t("intl.bookService_" + s)}</option>`
        ).join("")}
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
    const bookService = document.getElementById("if-book-service").value;
    if (country) p.set("country", country);
    if (industry) p.set("industry", industry);
    if (roleType) p.set("roleType", roleType);
    if (bookService) p.set("bookService", bookService);
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
      ${intlBookServiceTagsHtml(c.bookServices)}
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
        ${intlBookServiceTagsHtml(c.bookServices)}
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
        <label>${I18N.t("intl.bookServicesLabel")}</label>
        <p class="form-field-hint">${I18N.t("intl.bookServicesHint")}</p>
        <div class="intl-book-services-check">
          ${INTL_BOOK_SERVICES.map(
            (s) => `
            <label class="intl-book-service-option">
              <input type="checkbox" name="ic-book-service" value="${s}" ${existing && existing.bookServices && existing.bookServices.includes(s) ? "checked" : ""} />
              ${I18N.t("intl.bookService_" + s)}
            </label>`
          ).join("")}
        </div>
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
      bookServices: Array.from(document.querySelectorAll('input[name="ic-book-service"]:checked')).map((el) => el.value),
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
// Task #234 - open the app-wide chat socket immediately on page load if a
// session already exists (returning visitor), not just right after a fresh
// login via setAuth().
if (state.token) connectChatSocket();
