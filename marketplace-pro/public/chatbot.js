// ---------------- HieloIce Assistant (free, rule-based FAQ chat widget) ----------------
// No external AI API is used here — this matches common questions against a
// keyword list and returns a pre-written bilingual answer. Zero running cost.

const CHATBOT_FAQS = [
  {
    keywords: ["comprar", "compra", "como compro", "buy", "purchase", "how do i buy"],
    en: "To buy an item, open its listing and tap \"Buy Now\", or \"Make an Offer\" if the seller accepts offers. You'll message the seller directly to arrange payment and delivery.",
    es: "Para comprar un producto, abre el aviso y toca \"Comprar Ahora\", o \"Hacer una Oferta\" si el vendedor acepta ofertas. Te pondras en contacto directo con el vendedor para coordinar el pago y la entrega.",
  },
  {
    keywords: ["vender", "publicar", "post ad", "sell", "publish", "aviso", "how do i sell"],
    en: "To sell, log in and tap \"Post an Ad\". Add a title, description, price, category, location and photos. Posting is free.",
    es: "Para vender, inicia sesion y toca \"Publicar Aviso\". Agrega titulo, descripcion, precio, categoria, ubicacion y fotos. Publicar es gratis.",
  },
  {
    keywords: ["gratis", "costo", "cuesta", "precio de usar", "fee", "cost", "free", "comision", "comisión"],
    en: "HieloIce is currently free to use — there are no fees to post listings or to buy/sell items.",
    es: "HieloIce es gratis por el momento — no hay costos por publicar avisos ni por comprar o vender.",
  },
  {
    keywords: ["cuenta", "registrar", "registro", "account", "sign up", "crear cuenta", "iniciar sesion", "iniciar sesión", "log in", "login"],
    en: "Tap \"Sign Up\" to create a free account with your email, or continue with Google or Facebook. You must accept the Terms & Conditions and Privacy Policy to register.",
    es: "Toca \"Registrarse\" para crear una cuenta gratis con tu correo, o continua con Google o Facebook. Debes aceptar los Terminos y Condiciones y la Politica de Privacidad para registrarte.",
  },
  {
    keywords: ["categoria", "categoría", "categories", "que puedo vender", "que vendo", "what can i sell"],
    en: "You can post listings in many categories: Vehicles, Auto Parts, Heavy Machinery, Food, Clothing, Video Games, Cell Phones, Computers & Technology, Real Estate, Generators & Solar Panels, Art & Crafts, Airplanes & Jets, Construction Materials, Appliances, Jewelry, Toys, and more.",
    es: "Puedes publicar en muchas categorias: Vehiculos, Repuestos, Maquinaria Pesada, Comida, Ropa, Videojuegos, Celulares, Computadoras y Tecnologia, Bienes Raices, Generadores y Paneles Solares, Arte y Manualidades, Aviones y Jets, Materiales de Construccion, Electrodomesticos, Joyas, Juguetes, y mas.",
  },
  {
    keywords: ["devolucion", "devolución", "return", "reembolso", "refund"],
    en: "Returns depend on each seller — check the \"Returns accepted\" badge on the listing, and message the seller directly to arrange any return.",
    es: "Las devoluciones dependen de cada vendedor — revisa la insignia de \"Acepta devoluciones\" en el aviso, y contacta al vendedor directamente para coordinar cualquier devolucion.",
  },
  {
    keywords: ["disputa", "estafa", "problema con", "fraude", "scam", "dispute", "fraud", "problem with my order"],
    en: "HieloIce is only a free platform connecting buyers and sellers — we are not part of any transaction and can't mediate disputes. Please deal only with people you trust, meet in safe public places, and review our Terms & Conditions for details.",
    es: "HieloIce es solo una plataforma gratuita que conecta compradores y vendedores — no somos parte de ninguna transaccion y no podemos mediar disputas. Trata solo con personas de confianza, reunete en lugares publicos seguros, y revisa nuestros Terminos y Condiciones para mas detalles.",
  },
  {
    keywords: ["mensaje", "contactar vendedor", "message seller", "chat con vendedor", "how do i message"],
    en: "Use the \"Message Seller\" button on any listing, or check your Messages inbox from the top menu.",
    es: "Usa el boton \"Mensaje al Vendedor\" en cualquier aviso, o revisa tu bandeja de Mensajes en el menu superior.",
  },
  {
    keywords: ["terminos", "términos", "privacidad", "privacy", "terms", "politica", "política"],
    en: "You can read our full Terms & Conditions and Privacy Policy at the bottom of any page (footer links).",
    es: "Puedes leer nuestros Terminos y Condiciones y Politica de Privacidad completos al final de cualquier pagina (enlaces en el pie de pagina).",
  },
  {
    keywords: ["contacto", "contact", "soporte", "support", "ayuda humana", "correo", "email"],
    en: "For anything this assistant can't help with, email us at info@hieloice.com.",
    es: "Para todo lo que este asistente no pueda resolver, escribenos a info@hieloice.com.",
  },
  {
    keywords: ["que es hieloice", "qué es hieloice", "what is hieloice", "que es esto", "about hieloice"],
    en: "HieloIce is a free online marketplace where you can buy and sell almost anything, anywhere.",
    es: "HieloIce es un marketplace en linea gratuito donde puedes comprar y vender casi cualquier cosa, en cualquier lugar.",
  },
  {
    keywords: ["oferta", "hacer una oferta", "offer", "negociar"],
    en: "If a seller accepts offers (check the listing), tap \"Make an Offer\", enter your amount and an optional message, and the seller can accept or reject it.",
    es: "Si el vendedor acepta ofertas (revisa el aviso), toca \"Hacer una Oferta\", ingresa tu monto y un mensaje opcional, y el vendedor puede aceptarla o rechazarla.",
  },
  {
    keywords: ["resena", "reseña", "calificacion", "calificación", "review", "rating"],
    en: "You can leave a review and star rating on a seller's profile after interacting with them, to help other buyers.",
    es: "Puedes dejar una resena y calificacion en el perfil de un vendedor despues de interactuar con el, para ayudar a otros compradores.",
  },
];

const CHATBOT_FALLBACK = {
  en: "I'm not sure about that yet — for anything I can't answer, please email info@hieloice.com and we'll help you directly.",
  es: "No tengo una respuesta para eso todavia — para lo que no pueda resolver, escribenos a info@hieloice.com y te ayudamos directamente.",
};

const CHATBOT_GREETING = {
  en: "Hi! I'm the HieloIce assistant. Ask me about buying, selling, categories, accounts, or anything else about the platform.",
  es: "Hola! Soy el asistente de HieloIce. Preguntame sobre como comprar, vender, categorias, cuentas, o cualquier otra cosa sobre la plataforma.",
};

const CHATBOT_PLACEHOLDER = {
  en: "Type your question...",
  es: "Escribe tu pregunta...",
};

function chatbotLang() {
  try {
    return typeof I18N !== "undefined" && I18N.lang === "es" ? "es" : "en";
  } catch (e) {
    return "en";
  }
}

function chatbotFindAnswer(text) {
  const q = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  CHATBOT_FAQS.forEach((faq) => {
    let score = 0;
    faq.keywords.forEach((kw) => {
      if (q.indexOf(kw) !== -1) score++;
    });
    if (score > bestScore) {
      bestScore = score;
      best = faq;
    }
  });
  const lang = chatbotLang();
  if (best) return best[lang];
  return CHATBOT_FALLBACK[lang];
}

function chatbotInit() {
  if (document.getElementById("chatbot-widget")) return;

  const wrap = document.createElement("div");
  wrap.id = "chatbot-widget";
  wrap.innerHTML =
    '<button id="chatbot-toggle" aria-label="Chat" type="button">💬</button>' +
    '<div id="chatbot-panel" class="chatbot-panel hidden">' +
    '<div class="chatbot-header">' +
    '<span>HieloIce Assistant</span>' +
    '<button id="chatbot-close" aria-label="Close" type="button">✕</button>' +
    "</div>" +
    '<div id="chatbot-messages" class="chatbot-messages"></div>' +
    '<form id="chatbot-form" class="chatbot-form">' +
    '<input id="chatbot-input" type="text" autocomplete="off" />' +
    '<button type="submit" aria-label="Send">➤</button>' +
    "</form>" +
    "</div>";
  document.body.appendChild(wrap);

  const toggleBtn = document.getElementById("chatbot-toggle");
  const panel = document.getElementById("chatbot-panel");
  const closeBtn = document.getElementById("chatbot-close");
  const messagesEl = document.getElementById("chatbot-messages");
  const form = document.getElementById("chatbot-form");
  const input = document.getElementById("chatbot-input");

  let greeted = false;

  function addMessage(text, who) {
    const div = document.createElement("div");
    div.className = "chatbot-msg " + (who === "bot" ? "chatbot-msg-bot" : "chatbot-msg-user");
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function refreshPlaceholder() {
    input.placeholder = CHATBOT_PLACEHOLDER[chatbotLang()];
  }

  function openPanel() {
    panel.classList.remove("hidden");
    refreshPlaceholder();
    if (!greeted) {
      addMessage(CHATBOT_GREETING[chatbotLang()], "bot");
      greeted = true;
    }
    input.focus();
  }

  toggleBtn.addEventListener("click", function () {
    if (panel.classList.contains("hidden")) {
      openPanel();
    } else {
      panel.classList.add("hidden");
    }
  });

  closeBtn.addEventListener("click", function () {
    panel.classList.add("hidden");
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMessage(text, "user");
    input.value = "";
    setTimeout(function () {
      addMessage(chatbotFindAnswer(text), "bot");
    }, 300);
  });

  refreshPlaceholder();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", chatbotInit);
} else {
  chatbotInit();
}
