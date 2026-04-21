import { getRating } from "./api/getRating";

const PROCESSED_ATTR = "data-vivino-processed";
const BADGE_CLASS = "vivino-rating-badge";

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

let lastUrl = "";

function checkUrlChange() {
  if (location.href === lastUrl) return false;
  lastUrl = location.href;
  resetBadges();
  return true;
}

function scan() {
  checkUrlChange();
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
