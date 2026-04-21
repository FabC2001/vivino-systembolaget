// Vivino's own site search uses Algolia. These credentials are served
// publicly to every Vivino visitor (search-only key, safe to embed).
const ALGOLIA_URL =
  "https://9takgwjuxl-dsn.algolia.net/1/indexes/WINES_prod/query";
const ALGOLIA_APP_ID = "9TAKGWJUXL";
const ALGOLIA_API_KEY = "60c11b2f1068885161d95ca068d3a6ae";

export async function getRating({ query, year, typeId, color }) {
  if (!query) return null;

  const response = await fetch(ALGOLIA_URL, {
    method: "POST",
    credentials: "omit",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-algolia-api-key": ALGOLIA_API_KEY,
      "x-algolia-application-id": ALGOLIA_APP_ID,
    },
    body: JSON.stringify({ query, hitsPerPage: 10 }),
  });

  if (!response.ok) {
    throw new Error(`Vivino search responded ${response.status}`);
  }

  const json = await response.json();
  const hits = json.hits || [];
  if (!hits.length) return null;

  const hit = pickBestHit(hits, typeId, color);
  if (!hit) return null;

  return buildRating(hit, year);
}

// Score each hit: strongly prefer matching wine type, then matching color
// keyword in the name. For sparkling (type 3) Vivino doesn't distinguish
// white vs. rosé via type_id, so color-keyword matching is essential.
function pickBestHit(hits, typeId, color) {
  const scored = hits.map((h, i) => ({ h, score: scoreHit(h, i, typeId, color) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].h;
}

// Scoring philosophy: trust Algolia's text relevance (preserved as the base),
// and only step in to DEMOTE wrong-type or wrong-color hits. Giving positive
// bonuses for same-color keywords would unfairly push less-relevant hits
// above exact-name matches (e.g. "Fariña / Lágrima" lost to "Marina & Oriol /
// Lacrima Roja Tinto" because 'tinto' triggered a color bonus).
function scoreHit(hit, originalIndex, typeId, color) {
  let score = 100 - originalIndex * 10;

  if (typeId && hit.type_id && hit.type_id !== typeId) score -= 1000;

  if (color) {
    // Strip accents before matching — JS regex \b treats 'é' as non-word,
    // so \b(ros[eé])\b fails on "rosé" without normalization.
    const name = String(hit.name || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const hasRose = /\b(rose|rosato|rosado)\b/.test(name);
    const hasWhite = /\b(blanc|blanco|branco)\b/.test(name);
    const hasRed = /\b(rouge|tinto|rosso|noir)\b/.test(name);

    if (color === "rose" && (hasWhite || hasRed) && !hasRose) score -= 500;
    else if (color === "white" && hasRose && !hasWhite) score -= 500;
    else if (color === "red" && hasRose && !hasRed) score -= 500;
  }

  return score;
}

function buildRating(hit, year) {
  const wineryName = hit.winery?.name || "";
  const wineName = hit.name || "";
  const displayName = [wineryName, wineName].filter(Boolean).join(" ");

  const wineStats = hit.statistics || {};
  const wineScore = Number(wineStats.ratings_average) || 0;
  const wineCount = Number(wineStats.ratings_count) || 0;

  let score = wineScore;
  let numOfReviews = wineCount;
  let urlYear = "";

  if (year) {
    const vintage = (hit.vintages || []).find(
      (v) => String(v.year) === String(year)
    );
    const vc = Number(vintage?.statistics?.ratings_count) || 0;
    const va = Number(vintage?.statistics?.ratings_average) || 0;
    if (vc >= 25 && va > 0) {
      score = va;
      numOfReviews = vc;
      urlYear = String(year);
    }
  }

  if (!(score > 0)) return null;

  const url = hit.id
    ? `https://www.vivino.com/w/${hit.id}${urlYear ? `?year=${urlYear}` : ""}`
    : "https://www.vivino.com/";

  return { name: displayName, score, numOfReviews, url };
}
