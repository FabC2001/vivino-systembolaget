import { getRating } from "./api/getRating";

const PROCESSED_ATTR = "data-vivino-processed";
const BADGE_CLASS = "vivino-rating-badge";
const PRODUCT_CARD_ID = "vivino-product-card";
const PRODUCT_PAGE_RE = /^\/produkt\/vin\/[^/]+\/?$/;

// All wine product URLs are /produkt/vin/<slug>-<productNumber>/ regardless
// of color, sparkling, fortified, etc.
const WINE_HREF_RE = /^\/produkt\/vin\//;

// Systembolaget renders three anchors per product, all sharing the same
// href: (1) the full card, (2) the image, (3) a "details" anchor with
// exactly three <p> children — name / grapes+year / "Nr 123456".
// The details anchor is the reliable source for a Vivino query; the card
// anchor is where we attach the badge.
function findProductGroups() {
  const anchors = Array.from(document.querySelectorAll('a[href*="/produkt/"]'));
  const groups = new Map();
  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    if (!WINE_HREF_RE.test(href)) continue;
    if (!groups.has(href)) groups.set(href, []);
    groups.get(href).push(a);
  }
  return groups;
}

function parseDetails(anchors) {
  for (const a of anchors) {
    const ps = a.querySelectorAll("p");
    if (ps.length < 2) continue;
    const last = ps[ps.length - 1].innerText.trim();
    if (!/^Nr\s+\d+/i.test(last)) continue;
    const name = ps[0].innerText.trim();
    const grapesYear = ps[1].innerText.trim();
    if (name) return { name, grapesYear };
  }
  return null;
}

// The big card anchor's innerText has a category line like
// "MOUSSERANDE VIN, VITT TORRT" or "RÖTT VIN, FRUKTIGT & SMAKRIKT".
// We use it to constrain the Vivino search to the right wine type and
// (for sparkling) the right color.
function parseTypeAndColor(cardText) {
  const line =
    cardText
      .split("\n")
      .map((s) => s.trim())
      .find((s) => /\b(VIN|STARKVIN|DESSERTVIN|FRUKTVIN|ROSEVIN|ROSÉVIN)\b/i.test(s)) || "";
  const upper = line.toUpperCase();

  let typeId = null;
  if (/^MOUSSERANDE/.test(upper) || /\bMOUSSERANDE\b/.test(upper)) typeId = 3;
  else if (/^ROSÉVIN\b|^ROSEVIN\b/.test(upper)) typeId = 4;
  else if (/^RÖTT\b|^ROTT\b/.test(upper)) typeId = 1;
  else if (/^VITT\b/.test(upper)) typeId = 2;
  else if (/^STARKVIN\b/.test(upper)) typeId = 24;
  else if (/^DESSERTVIN\b/.test(upper)) typeId = 7;

  let color = "";
  if (typeId === 3) {
    if (/ROSÉ|ROSE\b/.test(upper)) color = "rose";
    else if (/\bVITT\b|BLANC/.test(upper)) color = "white";
    else if (/RÖTT|ROTT/.test(upper)) color = "red";
  } else if (typeId === 4) color = "rose";
  else if (typeId === 2) color = "white";
  else if (typeId === 1) color = "red";

  return { typeId, color };
}

function pickCardAnchor(anchors) {
  // The big card anchor has the longest text content.
  let best = anchors[0];
  for (const a of anchors) {
    if (a.innerText.length > best.innerText.length) best = a;
  }
  return best;
}

function buildQuery(details) {
  if (!details) return { query: "", year: "" };
  // grapesYear looks like "Cabernet Sauvignon Shiraz Carmenère, 2025".
  // Split off the year so Algolia matches the name without year noise,
  // while letting the background pick the right vintage stats.
  const yearMatch = details.grapesYear.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : "";
  const grapesNoYear = details.grapesYear
    .replace(/,?\s*\b(19|20)\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const query = `${details.name} ${grapesNoYear}`.replace(/\s+/g, " ").trim();
  return { query, year };
}

const GENERIC_WINE_TOKENS = new Set([
  "vin", "vino", "wine", "wein", "rott", "rod", "roda", "rode", "rouge", "red",
  "vitt", "vita", "white", "blanc", "blancs", "blanco", "branco",
  "rose", "rosado", "rosato", "mousserande", "sparkling",
  "brut", "sec", "demi", "extra", "dry", "semi", "doux",
  "reserva", "reserve", "gran", "grande", "riserva", "classico", "superiore",
  "doc", "docg", "aoc", "dop", "igt", "igp", "qba", "ava",
  "spatlese", "kabinett", "auslese", "cuvee", "selection", "estate",
  "vintage", "old", "vines", "vieilles",
  "chianti", "barolo", "rioja", "ribera", "duero", "valpolicella", "amarone",
  "bordeaux", "burgundy", "bourgogne", "champagne", "prosecco", "cava",
  "sauvignon", "cabernet", "merlot", "pinot", "noir", "noirs", "grigio", "gris",
  "chardonnay", "riesling", "syrah", "shiraz", "grenache", "tempranillo",
  "sangiovese", "nebbiolo", "barbera", "malbec", "zinfandel", "viognier",
  "gewurztraminer", "blend", "gsm", "douro", "carmenere",
  "tinto", "tinta",
  "eko", "ekologisk", "organic", "bio", "biodynamic", "vegan",
  "box", "bag", "bib", "nv",
]);

function tokenize(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

function distinctive(tokens) {
  return tokens.filter((t) => !GENERIC_WINE_TOKENS.has(t));
}

function isLikelyMatch(wineName, vivinoName) {
  if (!vivinoName) return false;
  const qAll = tokenize(wineName);
  const nAll = tokenize(vivinoName);
  if (!qAll.length || !nAll.length) return false;

  const qDist = distinctive(qAll);
  const nDist = new Set(distinctive(nAll));
  const nSet = new Set(nAll);

  // The wine NAME on Systembolaget is the distinctive field (producer /
  // brand / cuvée). At least one distinctive token from the name must
  // appear in the Vivino result, otherwise we've matched on grape/region
  // alone — i.e. the "same category, wrong producer" case.
  if (qDist.length > 0) {
    const hit = qDist.some((t) => nDist.has(t));
    if (!hit) return false;
  }

  let hits = 0;
  qAll.forEach((t) => {
    if (nSet.has(t)) hits++;
  });
  return hits >= 2;
}

function buildBadge({ score, numOfReviews, url }, matched, href) {
  const badge = document.createElement("a");
  badge.className = BADGE_CLASS;
  badge.setAttribute("data-vivino-href", href);
  badge.href = url;
  badge.target = "_blank";
  badge.rel = "noopener noreferrer";
  badge.innerText = `★ ${score.toFixed(1)} (${numOfReviews})${
    matched ? "" : " ?"
  }`;
  badge.title = matched
    ? "Vivino rating"
    : "Vivino rating (uncertain match — click to verify)";
  badge.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:4px",
    "margin:4px 8px",
    "padding:3px 8px",
    `background:${matched ? "#7c1e3e" : "#888"}`,
    "color:#fff",
    "border-radius:4px",
    "font-size:12px",
    "font-weight:600",
    "text-decoration:none",
    "line-height:1.4",
    "z-index:5",
    "position:relative",
    "align-self:flex-start",
  ].join(";");
  badge.addEventListener("click", (e) => e.stopPropagation());
  return badge;
}

async function processGroup(href, anchors) {
  const card = pickCardAnchor(anchors);

  // React recycles anchor DOM across SPA navigations, keeping our badge
  // attached with stale data. If the badge's stamped href no longer matches
  // the anchor's current href, strip it and re-process.
  const existingBadge = card.querySelector(`.${BADGE_CLASS}`);
  if (existingBadge) {
    if (existingBadge.getAttribute("data-vivino-href") === href) return;
    existingBadge.remove();
    card.removeAttribute(PROCESSED_ATTR);
  }

  if (card.getAttribute(PROCESSED_ATTR) === href) return;
  card.setAttribute(PROCESSED_ATTR, href);

  const details = parseDetails(anchors);
  const { query, year } = buildQuery(details);
  if (!query || query.length < 3) return;

  const { typeId, color } = parseTypeAndColor(card.innerText || "");

  try {
    const rating = await getRating({ query, year, typeId, color });
    if (!rating || !rating.score) return;
    // Anchor may have been recycled during the fetch — bail if href changed.
    if ((card.getAttribute("href") || "") !== href) return;
    const stale = card.querySelector(`.${BADGE_CLASS}`);
    if (stale) stale.remove();

    const matched = isLikelyMatch(details.name, rating.name);
    card.appendChild(buildBadge(rating, matched, href));
  } catch (_) {
    // wine not found or network error — stay silent
  }
}

// === Product detail page ===
//
// On /produkt/vin/<slug>-<id>/ pages we render a richer floating card with
// region, tasting notes and a label thumbnail. Wine identity is pulled from
// the page's `__NEXT_DATA__` blob, which exposes the same fields the list
// page renders (`productNameBold`, `productNameThin`, `vintage`, category
// levels). Reusing the same fields + the same `buildQuery` / parseTypeAndColor
// helpers guarantees the product-page query is byte-identical to the list
// query, so we hit the same cache entry and the same Vivino match.

const COUNTRY_NAMES = {
  fr: "France", it: "Italy", es: "Spain", pt: "Portugal", de: "Germany",
  at: "Austria", ch: "Switzerland", us: "USA", ar: "Argentina", cl: "Chile",
  za: "South Africa", au: "Australia", nz: "New Zealand", gr: "Greece",
  hu: "Hungary", ro: "Romania", bg: "Bulgaria", lb: "Lebanon", il: "Israel",
  ge: "Georgia", uy: "Uruguay", br: "Brazil", mx: "Mexico", ca: "Canada",
  hr: "Croatia", si: "Slovenia", tr: "Turkey", cn: "China", jp: "Japan",
  gb: "UK", se: "Sweden",
};

function findInNextData(obj, predicate, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== "object") return null;
  if (predicate(obj)) return obj;
  for (const k of Object.keys(obj)) {
    const r = findInNextData(obj[k], predicate, depth + 1);
    if (r) return r;
  }
  return null;
}

// Extract product number from /produkt/vin/<slug>-<number>/ — used to verify
// __NEXT_DATA__ actually refers to the page we're looking at.
function productNumberFromPath() {
  const m = location.pathname.match(/-(\d+)\/?$/);
  return m ? m[1] : "";
}

function parseProductFromNextData() {
  const script = document.getElementById("__NEXT_DATA__");
  if (!script) return null;
  let json;
  try { json = JSON.parse(script.textContent || ""); } catch (_) { return null; }
  const expected = productNumberFromPath();
  const p = findInNextData(json, (o) =>
    typeof o.productNameBold === "string" &&
    (!expected || String(o.productNumber || "") === expected)
  );
  if (!p) return null;
  const name = (p.productNameBold || "").trim();
  if (!name) return null;
  const thin = (p.productNameThin || "").trim();
  const year = (p.vintage || "").toString().trim();
  const categoryLine = [p.categoryLevel2, p.categoryLevel3]
    .filter(Boolean).join(", ").toUpperCase();
  return { name, grapesYear: thin, year, categoryLine };
}

// SPA navigations (clicking a tile) DO update the URL and `document.title`
// but DO NOT replace `__NEXT_DATA__`. In that case we fall back to parsing
// the page title — same shape the list-page query uses ("name grapes, year"),
// minus the year — so the resulting Algolia query is identical to what the
// list card built.
function parseProductFromTitle() {
  const t =
    document.querySelector('meta[property="og:title"]')?.content ||
    document.title.replace(/\s*\|\s*Systembolaget\s*$/i, "");
  if (!t) return null;
  const yearMatch = t.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : "";
  const name = t
    .replace(/,?\s*\b(19|20)\d{2}\b/g, "")
    .replace(/\s*\|\s*Systembolaget\s*$/i, "")
    .trim();
  if (!name) return null;
  // No clean bold/thin split available — pass the full title as `name` and
  // leave grapesYear empty; buildQuery just joins them.
  return { name, grapesYear: "", year, categoryLine: parseCategoryFromBreadcrumb() };
}

function parseCategoryFromBreadcrumb() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    try {
      const j = JSON.parse(s.textContent || "");
      if (j["@type"] !== "BreadcrumbList") continue;
      const names = (j.itemListElement || []).map((x) => x.name || "");
      // Skip the first two crumbs ("Startsida", "Sortiment") so the result
      // looks like the list-page category line: "Rosévin, Friskt & Bärigt".
      return names.slice(2).filter(Boolean).join(", ").toUpperCase();
    } catch (_) {}
  }
  return "";
}

function buildProductCard(rating, matched) {
  const card = document.createElement("div");
  card.id = PRODUCT_CARD_ID;
  card.style.cssText = [
    "position:fixed",
    "right:20px",
    "bottom:20px",
    "z-index:9999",
    "width:320px",
    "max-width:calc(100vw - 40px)",
    "background:#fff",
    "border:1px solid #d4d4d4",
    `border-left:4px solid ${matched ? "#7c1e3e" : "#888"}`,
    "border-radius:6px",
    "box-shadow:0 4px 16px rgba(0,0,0,.12)",
    "padding:14px",
    "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif",
    "font-size:13px",
    "color:#222",
    "line-height:1.45",
  ].join(";");

  const close = document.createElement("button");
  close.innerText = "×";
  close.title = "Hide";
  close.style.cssText = "position:absolute;top:6px;right:8px;background:none;border:none;font-size:18px;color:#888;cursor:pointer;padding:0;line-height:1";
  close.addEventListener("click", () => card.remove());
  card.appendChild(close);

  const header = document.createElement("div");
  header.style.cssText = "display:flex;gap:12px;margin-bottom:8px";

  if (rating.image) {
    const img = document.createElement("img");
    img.src = rating.image;
    img.alt = "";
    img.style.cssText = "width:48px;height:64px;object-fit:contain;flex-shrink:0";
    img.referrerPolicy = "no-referrer";
    header.appendChild(img);
  }

  const titleBlock = document.createElement("div");
  titleBlock.style.cssText = "flex:1;min-width:0";

  const title = document.createElement("div");
  title.style.cssText = "font-weight:600;font-size:14px;line-height:1.3;margin-bottom:2px;padding-right:18px";
  title.innerText = rating.name;
  titleBlock.appendChild(title);

  const subParts = [];
  if (rating.region) subParts.push(rating.region);
  if (rating.country && COUNTRY_NAMES[rating.country]) subParts.push(COUNTRY_NAMES[rating.country]);
  if (subParts.length) {
    const sub = document.createElement("div");
    sub.style.cssText = "color:#666;font-size:12px;margin-bottom:4px";
    sub.innerText = subParts.join(", ");
    titleBlock.appendChild(sub);
  }
  header.appendChild(titleBlock);
  card.appendChild(header);

  const ratingRow = document.createElement("div");
  ratingRow.style.cssText = "display:flex;align-items:baseline;gap:6px;margin:8px 0";
  ratingRow.innerHTML =
    `<span style="font-size:22px;font-weight:700;color:${matched ? "#7c1e3e" : "#666"}">★ ${rating.score.toFixed(1)}</span>` +
    `<span style="color:#666;font-size:12px">${rating.numOfReviews.toLocaleString()} ratings on Vivino</span>`;
  card.appendChild(ratingRow);

  if (rating.description) {
    const desc = document.createElement("div");
    desc.style.cssText = "color:#444;font-size:12px;margin:8px 0;max-height:96px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical";
    desc.innerText = rating.description;
    card.appendChild(desc);
  }

  if (!matched) {
    const warn = document.createElement("div");
    warn.style.cssText = "color:#888;font-size:11px;font-style:italic;margin:6px 0";
    warn.innerText = "Match uncertain — click through to verify on Vivino.";
    card.appendChild(warn);
  }

  const link = document.createElement("a");
  link.href = rating.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.innerText = "Open on Vivino →";
  link.style.cssText = `display:inline-block;margin-top:6px;color:${matched ? "#7c1e3e" : "#555"};font-weight:600;text-decoration:none`;
  card.appendChild(link);

  return card;
}

let productCardLoadedFor = "";

async function processProductPage() {
  if (!PRODUCT_PAGE_RE.test(location.pathname)) return;
  if (productCardLoadedFor === location.pathname) return;

  // Prefer __NEXT_DATA__ (clean bold/thin split). On SPA-navigated pages
  // it's stale or missing — fall back to the page title.
  const product = parseProductFromNextData() || parseProductFromTitle();
  if (!product) return;

  // Lock to the path we're fetching for so a slow response from a previous
  // product page can't end up rendered on a later one.
  const startedFor = location.pathname;
  productCardLoadedFor = startedFor;

  const { query, year } = buildQuery({
    name: product.name,
    grapesYear: product.grapesYear + (product.year ? `, ${product.year}` : ""),
  });
  const { typeId, color } = parseTypeAndColor(product.categoryLine);

  try {
    const rating = await getRating({ query, year, typeId, color });
    if (!rating || !rating.score) return;
    if (location.pathname !== startedFor) return;
    const matched = isLikelyMatch(product.name, rating.name);
    document.getElementById(PRODUCT_CARD_ID)?.remove();
    document.body.appendChild(buildProductCard(rating, matched));
  } catch (_) {}
}

function removeProductCard() {
  document.getElementById(PRODUCT_CARD_ID)?.remove();
  productCardLoadedFor = "";
}

let lastUrl = "";

function checkUrlChange() {
  if (location.href === lastUrl) return false;
  lastUrl = location.href;
  resetBadges();
  removeProductCard();
  return true;
}

function scan() {
  checkUrlChange();
  if (PRODUCT_PAGE_RE.test(location.pathname)) {
    processProductPage();
    return;
  }
  const groups = findProductGroups();
  groups.forEach((anchors, href) => processGroup(href, anchors));
}

let scheduled = false;
function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    scan();
  }, 400);
}

function resetBadges() {
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach((n) => n.remove());
  document
    .querySelectorAll(`[${PROCESSED_ATTR}]`)
    .forEach((n) => n.removeAttribute(PROCESSED_ATTR));
}

function initialize() {
  lastUrl = location.href;
  scan();

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("scroll", scheduleScan, { passive: true });
  window.addEventListener("popstate", scheduleScan);

  // Independent URL-change poll: clears stale badges the instant the SPA
  // router changes the URL, without waiting for the debounced scan tick.
  // Cheap (one string compare per 250ms) and immune to isolated-world
  // issues that stopped the pushState monkey-patch from working.
  setInterval(() => {
    if (checkUrlChange()) scheduleScan();
  }, 250);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
