// AI help assistant widget. Self-contained: builds its own DOM, talks to
// /api/ai/chat directly with fetch (does not depend on app.js, since this
// script loads before app.js in index.html). Reuses the existing
// #chatbot-widget / .chatbot-panel / .chatbot-msg CSS shell in style.css.
(function () {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function t(key) {
    if (typeof I18N !== "undefined" && I18N.t) return I18N.t(key);
    return key;
  }
  function lang() {
    return typeof I18N !== "undefined" && I18N.lang === "es" ? "es" : "en";
  }

  const history = []; // { role: "user"|"assistant", content: string }
  let opened = false;
  let sending = false;

  const QUICK_REPLIES = ["chatbot.quickSell", "chatbot.quickIsbn", "chatbot.quickMoments", "chatbot.quickPayment"];

  function buildWidget() {
    const wrap = document.createElement("div");
    wrap.id = "chatbot-widget";
    wrap.innerHTML = `
      <div class="chatbot-panel hidden" id="chatbot-panel">
        <div class="chatbot-header">
          <span id="chatbot-title"></span>
          <button type="button" id="chatbot-close" aria-label="Close">&times;</button>
        </div>
        <div class="chatbot-messages" id="chatbot-messages"></div>
        <form class="chatbot-form" id="chatbot-form">
          <input type="text" id="chatbot-input" autocomplete="off" />
          <button type="submit">&#10148;</button>
        </form>
      </div>
      <button type="button" id="chatbot-toggle" aria-label="Help">&#128172;</button>
    `;
    document.body.appendChild(wrap);
    return wrap;
  }

  function renderStaticText() {
    const titleEl = document.getElementById("chatbot-title");
    const inputEl = document.getElementById("chatbot-input");
    if (titleEl) titleEl.textContent = t("chatbot.title");
    if (inputEl) inputEl.placeholder = t("chatbot.placeholder");
  }

  function addMessage(role, text) {
    const messagesEl = document.getElementById("chatbot-messages");
    if (!messagesEl) return;
    const bubble = document.createElement("div");
    bubble.className = "chatbot-msg " + (role === "user" ? "chatbot-msg-user" : "chatbot-msg-bot");
    bubble.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addQuickReplies() {
    const messagesEl = document.getElementById("chatbot-messages");
    if (!messagesEl) return;
    const row = document.createElement("div");
    row.className = "chatbot-msg chatbot-msg-bot";
    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.gap = "6px";
    row.style.background = "transparent";
    row.style.padding = "0";
    QUICK_REPLIES.forEach((key) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = t(key);
      btn.style.cssText =
        "border:1px solid var(--border-color);background:var(--bg-surface);color:var(--accent-text);" +
        "border-radius:14px;padding:6px 10px;font-size:12px;cursor:pointer;";
      btn.addEventListener("click", () => sendMessage(t(key)));
      row.appendChild(btn);
    });
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendMessage(text) {
    text = String(text || "").trim();
    if (!text || sending) return;
    sending = true;
    addMessage("user", text);
    history.push({ role: "user", content: text });

    const messagesEl = document.getElementById("chatbot-messages");
    const thinkingBubble = document.createElement("div");
    thinkingBubble.className = "chatbot-msg chatbot-msg-bot";
    thinkingBubble.id = "chatbot-thinking";
    thinkingBubble.textContent = t("chatbot.thinking");
    messagesEl.appendChild(thinkingBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, locale: lang() }),
      });
      const data = await res.json().catch(() => null);
      thinkingBubble.remove();
      if (!res.ok || !data || !data.reply) {
        addMessage("bot", (data && data.error) || t("chatbot.error"));
      } else {
        addMessage("bot", data.reply);
        history.push({ role: "assistant", content: data.reply });
      }
    } catch (e) {
      thinkingBubble.remove();
      addMessage("bot", t("chatbot.error"));
    } finally {
      sending = false;
    }
  }

  function openPanel() {
    const panel = document.getElementById("chatbot-panel");
    if (!panel) return;
    panel.classList.remove("hidden");
    if (!opened) {
      opened = true;
      addMessage("bot", t("chatbot.greeting"));
      addQuickReplies();
    }
    const inputEl = document.getElementById("chatbot-input");
    if (inputEl) inputEl.focus();
  }
  function closePanel() {
    const panel = document.getElementById("chatbot-panel");
    if (panel) panel.classList.add("hidden");
  }

  function init() {
    buildWidget();
    renderStaticText();

    document.getElementById("chatbot-toggle").addEventListener("click", () => {
      const panel = document.getElementById("chatbot-panel");
      if (panel.classList.contains("hidden")) openPanel();
      else closePanel();
    });
    document.getElementById("chatbot-close").addEventListener("click", closePanel);
    document.getElementById("chatbot-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const inputEl = document.getElementById("chatbot-input");
      const text = inputEl.value;
      inputEl.value = "";
      sendMessage(text);
    });

    // The language toggle buttons live in index.html and are wired by
    // app.js, which loads after this file - hook in separately so the
    // widget's own static text updates too when the user switches language.
    const langEn = document.getElementById("lang-en");
    const langEs = document.getElementById("lang-es");
    if (langEn) langEn.addEventListener("click", renderStaticText);
    if (langEs) langEs.addEventListener("click", renderStaticText);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
