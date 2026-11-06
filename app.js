// Atelier 911 — showroom (comportement).
// 1 rendu par teinte + 1 masque alpha : le nom passe derrière la voiture.
// Choix de la teinte : « L'Éventail », 152 lames laquées autour d'un pivot sous le bord bas ;
// « Le Nuancier » (plein écran) réunit toutes les teintes, la recherche et les favoris.
// Règle unique : la lame au repos sous l'index (en haut, au centre) est la teinte de la voiture.
// Netteté : la « rig » est dimensionnée (pas de transform: scale), le texte n'est jamais rastérisé
// ni tourné ; titres, volet, parallaxe et étiquettes n'écrivent que des px entiers.
// Fluidité : la géométrie est mesurée dans refit()/resize, jamais dans pointermove ni paint().

const IMG_W = 3500, IMG_H = 5000;
const TEXT_Y = 0.452;                  // bas du titre, en fraction de la hauteur image (≈ toit)
const SIZES = [1200, 2000, 3500];
const NEXT_WAIT = 4000;                // attente max du rendu cible avant de passer en aplat
const SWAP_OUT = 260;                  // sortie du nom de l'étiquette (.spec.swap : 240 ms + marge)
const D = { micro: 140, ui: 220, panel: 360, paint: 560, ambient: 900 };   // miroir des tokens CSS
const NOIMG_MSG = "Rendu indisponible — aperçu en aplat";
const FAMILY_ORDER = ["blanc", "gris", "noir", "brun", "rouge", "orange", "jaune", "vert", "bleu", "violet"];
const FAMILIES = [                     // [clé, libellé FR, singulier FR]
  ["blanc", "Blancs", "Blanc"], ["gris", "Gris", "Gris"], ["noir", "Noirs", "Noir"], ["brun", "Bruns", "Brun"],
  ["rouge", "Rouges", "Rouge"], ["orange", "Oranges", "Orange"], ["jaune", "Jaunes", "Jaune"],
  ["vert", "Verts", "Vert"], ["bleu", "Bleus", "Bleu"], ["violet", "Violets", "Violet"],
];
const FAM_EN = {
  vert: ["green"], bleu: ["blue"], rouge: ["red"], gris: ["grey", "gray"], noir: ["black"], blanc: ["white"],
  jaune: ["yellow"], orange: ["orange"], violet: ["purple", "violet"], brun: ["brown"],
};
const famLabel = (k) => FAMILIES.find((f) => f[0] === k)?.[1] ?? "";
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
const ICON_CMP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 7h4v10H5zM15 7h4v10h-4z"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11"/><path d="M5 15V5h10"/></svg>';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const body = document.body;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const coarse = matchMedia("(pointer: coarse)");
const fine = matchMedia("(pointer: fine)");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const heroName = (name) => name.replace(/\s*\(.*?\)/g, "").replace(/\s+Metallic$/i, "").trim() || name;
const isOpen = (id) => !!$(id)?.classList.contains("open");
const anyPanel = () => document.querySelector(".panel.open");
const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;
const metal = (c) => (/metallic/i.test(c.name) ? 1 : 0);

/* ---------- Courbes (miroir de --e-out / --e-inout / --e-in) ---------- */

function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-6) return Y(t);
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 40 && hi - lo > 1e-6; i++) { X(t) < x ? (lo = t) : (hi = t); t = (lo + hi) / 2; }
    return Y(t);
  };
}
const EASE = {
  out: bezier(0.22, 1, 0.36, 1),
  inout: bezier(0.65, 0, 0.35, 1),
  in: bezier(0.55, 0, 1, 0.45),
  linear: (k) => k,
};

/* ---------- État ---------- */

let COLORS = [];
const codeIndex = new Map();   // CODE (majuscules) -> index
let idx = 0;
let p = 0;              // progression du geste : -1 (suivante) … 0 … +1 (précédente)
let busy = false;       // une transition (animation + commit) est en cours
let target = null;      // destination de la transition en cours
let pending = null;     // dernière destination demandée pendant une transition ou un geste
let started = false;    // démarrage terminé : rendu, titres et panneaux en place
let drag = null;

const stage = $("stage"), rig = $("rig"), wipe = $("wipe");
const shotCur = $("shotCur"), shotNext = $("shotNext"), titleCur = $("titleCur"), titleNext = $("titleNext");
const specEl = document.querySelector(".spec");
const beadEl = $("bead"), odoEl = $("specI"), nameL1 = $("specL1"), nameL2 = $("specL2"), nameEl = $("specName");
const flashBand = $("flashBand"), studioLight = $("studioLight");

/* ---------- Géométrie en cache ---------- */

const geo = { sw: 0, sh: 0, rw: 0, rh: 0, z: 1, dpr: 1, key: "" };
let fontGen = 0;
function measure() {
  const s = stage.getBoundingClientRect(), r = rig.getBoundingClientRect();
  geo.z = parseFloat(getComputedStyle(root).getPropertyValue("--z")) || 1;
  geo.sw = s.width || innerWidth; geo.sh = s.height || innerHeight;
  geo.rw = r.width || Math.round(geo.sw * geo.z); geo.rh = r.height || Math.round(geo.sh * geo.z);
  geo.dpr = devicePixelRatio || 1;
  geo.key = `${geo.sw}x${geo.sh}|${geo.rw}x${geo.rh}|${geo.dpr}|${fontGen}`;
}

/* ---------- Place de la voiture : jamais sous l'étiquette ----------
   Silhouette (masque) : carrosserie + roues entre 43,6 % et 56,4 % de la hauteur du rendu, colonnes 21,4 %–85,1 %.
   Contrainte : bas des roues ≥ 20 px au-dessus du haut de l'étiquette (+ 6 px de parallaxe), sauf si la voiture
   est à ≥ 24 px de côté de l'étiquette. On remonte d'abord la rig (--lift), tant que le titre reste sous le bandeau ;
   sinon on réduit --z (la rig est dimensionnée, jamais transformée). Le reflet peut passer sous l'étiquette. */
const CAR = { top: 0.436, bottom: 0.564, left: 0.214, right: 0.851 };
const carFit = { z: 0, lift: 0, gap: 0, ts: 1 };
// Taille du titre : suit la voiture quand celle-ci est réduite (la composition titre/voiture est conservée)
const titleSize = (sh, ts) => Math.max(1, Math.round(sh * 0.17 * ts));
function carBox(z, lift, sw, sh, ts = 1) {
  const rw = Math.round(sw * z), rh = Math.round(sh * z);
  const K = Math.max(rw / IMG_W, rh / IMG_H), iw = IMG_W * K, ih = IMG_H * K;
  const ox = Math.round((sw - rw) / 2) + (rw - iw) / 2, oy = Math.round((sh - rh) / 2) - lift + (rh - ih) / 2;
  return { top: oy + ih * CAR.top, bottom: oy + ih * CAR.bottom, left: ox + iw * CAR.left, right: ox + iw * CAR.right,
    titleTop: oy + ih * TEXT_Y - Math.round(titleSize(sh, ts) * 0.94) };   // haut de la boîte du titre
}
function fitCar() {
  const spec = document.querySelector(".spec"), top = document.querySelector(".top");
  if (!spec) return;
  root.style.removeProperty("--z"); root.style.removeProperty("--lift");
  const cs = getComputedStyle(root);
  const z0 = parseFloat(cs.getPropertyValue("--z")) || 1, lift0 = parseFloat(cs.getPropertyValue("--lift")) || 0;
  const sw = stage.clientWidth || innerWidth, sh = stage.clientHeight || innerHeight;
  const dockB = parseFloat(cs.getPropertyValue("--dock-b")) || 0;
  const padL = parseFloat(getComputedStyle($("dock")).paddingLeft) || 0;
  const lab = { top: sh - dockB - spec.offsetHeight, left: padL, right: padL + spec.offsetWidth };
  const band = top ? top.offsetTop + top.offsetHeight + 8 : 0;
  const limit = lab.top - 20 - 6;
  const zMin = Math.min(z0, 0.62);
  let z = z0, lift = lift0, ts = 1;
  for (;; z = Math.round((z - 0.01) * 100) / 100) {
    if (z < zMin) { z = zMin; break; }
    ts = Math.min(1, z / z0);
    const b = carBox(z, 0, sw, sh, ts);
    const beside = b.left - 6 >= lab.right + 24 || b.right + 6 <= lab.left - 24;
    const need = beside ? 0 : b.bottom - limit;          // remontée nécessaire
    const room = b.titleTop - band;                      // remontée possible sans passer le titre sous le bandeau
    lift = Math.max(Math.min(lift0, room), need);
    if (beside || need <= room) break;
  }
  lift = Math.round(lift);
  carFit.z = z; carFit.lift = lift; carFit.ts = ts; carFit.gap = Math.round(lab.top - carBox(z, lift, sw, sh, ts).bottom);
  if (z !== z0) root.style.setProperty("--z", String(z));
  root.style.setProperty("--lift", lift + "px");
  // Rig plus étroite que l'écran : bords latéraux fondus dans --bg (comme en portrait)
  stage.classList.toggle("narrow", Math.round(sw * z) < sw);
}

/* ---------- Couleur ---------- */

function rgbOf(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); }
function hsl(hex) {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s, l];
}
function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}
// Luminosité perçue (CIE L*), 0…1
function lstar([r, g, b]) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return (Y <= 216 / 24389 ? (Y * 24389) / 27 : 116 * Math.cbrt(Y) - 16) / 100;
}
// Ton sur ton : même teinte, saturation ×0,9, L +0,2/−0,15, avec un écart perçu d'au moins 0,17
const tcCache = new Map();
function titleColor(hex) {
  let out = tcCache.get(hex);
  if (out) return out;
  const [h, s, l] = hsl(hex), s2 = s * 0.9, up = l < 0.5, base = lstar(rgbOf(hex));
  let L = up ? l + 0.2 : l - 0.15;
  for (let i = 0; i < 60 && Math.abs(lstar(hslToRgb(h, s2, L)) - base) < 0.17; i++) {
    const n = L + (up ? 0.01 : -0.01);
    if (n < 0 || n > 1) break;
    L = n;
  }
  out = `hsl(${Math.round(h)} ${(s2 * 100).toFixed(1)}% ${(clamp(L, 0, 1) * 100).toFixed(1)}%)`;
  tcCache.set(hex, out);
  return out;
}

// Ordre du nuancier : par famille (blancs → violets) ; neutres du clair au foncé, couleurs par teinte
function deckOrder(list) {
  const neutral = (f) => f === "blanc" || f === "gris" || f === "noir";
  const key = (c) => {
    const [h, , l] = hsl(c.hex);
    return neutral(c.family) ? [1 - lstar(rgbOf(c.hex)), 0] : [(h + 345) % 360, -l];
  };
  return list.map((c) => [FAMILY_ORDER.indexOf(c.family), key(c), c])
    .sort(([fa, a], [fb, b]) => fa - fb || a[0] - b[0] || a[1] - b[1]).map(([, , c]) => c);
}

const dest = () => pending ?? target ?? idx;     // là où l'utilisateur « est » du point de vue de la navigation

/* ---------- Familles et voisines (l'éventail a deux bouts : pas de bouclage) ---------- */

let famStart = {}, famCount = {};        // par famille : premier indice, nombre (COLORS est trié par famille)
const nb = (from, dir) => clamp(from + dir, 0, COLORS.length - 1);
const step = (dir) => nb(dest(), dir);

/* ---------- Fond échantillonné (--bg) ---------- */

const bgCache = new Map();     // code -> [r, g, b]
let bgCtx = null;
function sampleBg(el, code) {
  if (bgCache.has(code)) return;
  try {
    if (!bgCtx) bgCtx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
    if (!bgCtx || !el.naturalWidth) return;
    bgCtx.clearRect(0, 0, 1, 1);
    bgCtx.drawImage(el, 0, 0, 1, 1, 0, 0, 1, 1);       // pixel en haut à gauche du rendu
    const [r, g, b, a] = bgCtx.getImageData(0, 0, 1, 1).data;
    if (!a) return;
    bgCache.set(code, [r, g, b]);
    if (started && code === COLORS[idx]?.code) applyBg();
  } catch { /* canvas teinté (file://) : pas de --bg, le CSS garde son repli */ }
}
const rgbCss = ([r, g, b]) => `rgb(${r} ${g} ${b})`;
function applyBg() {
  const c = bgCache.get(COLORS[idx]?.code);
  if (c) root.style.setProperty("--bg", rgbCss(c));
  updateInk();
}
// Voile du haut dosé sur le rendu affiché : on mesure la zone la plus claire derrière la barre haute
// et on fonce juste assez pour que le texte blanc y garde un contraste ≥ 4,5:1.
let inkCtx = null;
function updateScrim(c) {
  const el = shotCur;
  if (stage.classList.contains("noimg") || el.dataset.code !== c.code || !el.complete || !el.naturalWidth) return;
  try {
    if (!inkCtx) inkCtx = Object.assign(document.createElement("canvas"), { width: 48, height: 4 }).getContext("2d", { willReadFrequently: true });
    const r = el.getBoundingClientRect(), iw = el.naturalWidth, ih = el.naturalHeight, sc = Math.max(r.width / iw, r.height / ih);
    const ox = r.left + (r.width - iw * sc) / 2, oy = r.top + (r.height - ih * sc) / 2;
    const bx = 16, by = 20, bw = innerWidth - 32, bh = 56;           // bande de la barre haute (repère de la fenêtre)
    inkCtx.clearRect(0, 0, 48, 4);
    inkCtx.drawImage(el, (bx - ox) / sc, (by - oy) / sc, bw / sc, bh / sc, 0, 0, 48, 4);
    const d = inkCtx.getImageData(0, 0, 48, 4).data;
    let v = 0;
    for (let i = 0; i < d.length; i += 4) v = Math.max(v, lstar([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]));
    // v : L* max (0..1), proche de la valeur sRGB ; le texte est vers 64 px, où le voile vaut 70 % de --scrim-t
    const need = v > 0.44 ? (v - 0.44) / (v - 0.04) / 0.7 : 0;
    root.style.setProperty("--scrim-t", clamp(need, 0.45, 0.85).toFixed(2));
  } catch { /* canvas teinté : le voile garde sa valeur par défaut */ }
}
// Aplat clair (sans rendu) : barre haute et fiche passent à l'encre sombre (contraste ≥ 4,5:1)
function updateInk() {
  const c = COLORS[idx];
  if (!c) return;
  updateScrim(c);
  body.classList.toggle("bg-light", stage.classList.contains("noimg") && lstar(rgbOf(c.hex)) > 0.62);
}

/* ---------- Images ---------- */

// Plus petite taille donnant ≥ 1 px image par px physique (object-fit: cover dans la rig).
function imgUrl(code) {
  const k = Math.max((geo.sw * geo.z) / IMG_W, (geo.sh * geo.z) / IMG_H);
  const need = IMG_W * k * geo.dpr;
  const w = SIZES.find((s) => s >= need) ?? SIZES[SIZES.length - 1];
  return `img/${w}/${code}.webp`;
}

// decode() peut ne jamais se résoudre (onglet/vue non rendu) : attente bornée, jamais bloquante.
const decoded = (im) => Promise.race([im.decode ? im.decode().catch(() => {}) : null, sleep(1200)]);

const loaded = new Map();      // url -> Promise<url|null>
const failed = new Set();
function load(url) {
  if (failed.has(url)) return Promise.resolve(null);
  if (!loaded.has(url)) {
    loaded.set(url, new Promise((ok) => {
      const im = new Image();
      im.decoding = "async";
      im.onload = () => decoded(im).then(() => ok(url));
      im.onerror = () => { loaded.delete(url); failed.add(url); ok(null); };
      im.src = url;
    }));
  }
  return loaded.get(url);
}
// Taille voulue, sinon n'importe quelle autre taille (la plus grande d'abord)
async function loadAny(code, url) {
  if (await load(url)) return url;
  for (const s of [...SIZES].reverse()) {
    const u = `img/${s}/${code}.webp`;
    if (u !== url && (await load(u))) return u;
  }
  return null;
}

// Affiche la teinte c dans <img el>. Seule la dernière demande gagne ; tant que la bonne teinte
// n'est pas prête, l'élément est masqué plutôt que de montrer une autre voiture.
// Résout true si el montre c, false sinon (remplacée ou échec). el._done : dernière demande terminée.
function setImg(el, c) {
  const url = imgUrl(c.code);
  el.dataset.want = url;                                   // toujours AVANT tout retour anticipé
  if (el.dataset.src === url && el.dataset.code === c.code) {
    el.style.visibility = "";
    el._done = true;
    return (el._job = Promise.resolve(true));
  }
  if (el.dataset.code !== c.code) el.style.visibility = "hidden";   // jamais une voiture périmée
  el._done = false;
  const job = (async () => {
    try {
      const got = await loadAny(c.code, url);
      if (el.dataset.want !== url) return false;              // une autre demande est passée entre-temps
      if (!got) {
        el.removeAttribute("src");
        el.dataset.src = ""; el.dataset.code = "";
        el.style.visibility = "hidden";
        return false;
      }
      el.src = got;
      el.dataset.src = got === url ? url : "";                // une version de secours sera re-tentée plus tard
      el.dataset.code = c.code;
      el.alt = el === shotCur ? `Porsche 911 en ${c.name}` : "";
      await decoded(el);
      if (el.dataset.want !== url) return false;
      el.style.visibility = "";
      sampleBg(el, c.code);
      return true;
    } finally {
      if (el._job === job) el._done = true;
    }
  })();
  el._job = job;
  return job;
}
const showing = (el, code) => el.dataset.code === code && el.style.visibility !== "hidden" && el.complete;
// Oublie l'image affichée (elle reste en cache) : utilisé pour ne jamais laisser voir une voiture périmée.
function clearImg(el) {
  el.dataset.want = ""; el.dataset.code = ""; el.dataset.src = "";
  el.style.visibility = "hidden";
  el._job = Promise.resolve(false); el._done = true;
}
// Attend que la DERNIÈRE demande de l'élément soit terminée, puis dit s'il montre `code`.
async function shows(el, code, timeout = Infinity) {
  const end = performance.now() + timeout;
  for (;;) {
    const j = el._job;
    const left = end - performance.now();
    if (left <= 0) return false;
    await Promise.race([j, sleep(Math.min(left, 2 ** 31 - 1))]);
    if (j === el._job || performance.now() >= end) break;
  }
  return showing(el, code);
}
// Attente du rendu cible pendant une transition : true prêt, false échec/délai, null abandon (autre demande).
async function waitNext(code) {
  const end = performance.now() + NEXT_WAIT;
  for (;;) {
    if (await shows(shotNext, code, 120)) return true;
    if (shotNext._done && shotNext.dataset.want && !showing(shotNext, code)) return false;   // échec définitif
    if (pending != null) return null;
    if (performance.now() >= end) return false;
  }
}

function setNoImg(el, on) {
  if (!el) return;
  el.classList.toggle("noimg", on);
  if (on) el.dataset.msg = NOIMG_MSG; else delete el.dataset.msg;
  if (el === stage && started) updateInk();
}
// Une fois la dernière demande de shotCur terminée : aplat si elle a échoué, sinon on l'enlève.
function trackCur() {
  const j = shotCur._job, c = COLORS[idx];
  Promise.resolve(j).then(() => {
    if (shotCur._job !== j || COLORS[idx] !== c) return;
    const ok = showing(shotCur, c.code);
    setNoImg(stage, !ok);
    if (ok) applyBg();
    else if (!busy && !drag?.on && shotNext.dataset.code !== c.code) { clearImg(shotNext); peekFor = null; }
  });
}

/* ---------- Titre masqué ---------- */

// Taille constante (17 % de la hauteur de scène) réduite seulement si le nom dépasse 90 % de la largeur.
// Boîte posée à un left entier, line-height entier, --ty entier : texte calé sur la grille de pixels.
// Mesuré sur l'élément qui l'affichera ; mis en cache par teinte et géométrie (rien à mesurer pendant un geste).
const mcache = new Map();
function metrics(c, el) {
  const key = c.code + "|" + geo.key;
  let m = mcache.get(key);
  if (m) return m;
  const text = heroName(c.name);
  const set = (s) => { el.style.fontSize = s + "px"; el.style.lineHeight = Math.max(1, Math.round(s * 0.94)) + "px"; };
  el.textContent = text;
  el.style.right = "auto";
  el.style.marginInline = "0";
  const maxW = geo.sw * 0.9;
  let size = titleSize(geo.sh, carFit.ts || 1);
  set(size);
  let w = el.getBoundingClientRect().width;
  // Poppins : on mesure le rendu réel et on recale jusqu'à tenir
  for (let k = 0; k < 4 && w > maxW && size > 1; k++) {
    size = Math.max(1, Math.min(size - 1, Math.floor((size * maxW) / w)));
    set(size);
    w = el.getBoundingClientRect().width;
  }
  const K = Math.max(geo.rw / IMG_W, geo.rh / IMG_H), oy = (geo.rh - IMG_H * K) / 2;
  m = { text, size, lh: Math.max(1, Math.round(size * 0.94)), left: Math.round((geo.rw - w) / 2), ty: Math.round(oy + IMG_H * K * TEXT_Y) };
  mcache.set(key, m);
  return m;
}
function applyTitle(el, c) {
  const m = metrics(c, el);
  if (el.textContent !== m.text) el.textContent = m.text;
  el.style.fontSize = m.size + "px";
  el.style.lineHeight = m.lh + "px";
  el.style.right = "auto";
  el.style.marginInline = "0";
  el.style.left = m.left + "px";
  el.style.setProperty("--ty", m.ty + "px");
  el.style.setProperty("--c", titleColor(c.hex));
}
// Au repos : prépare les mesures des voisines pour que le geste n'ait rien à mesurer.
const idle = window.requestIdleCallback ? (cb) => requestIdleCallback(cb, { timeout: 400 }) : (cb) => setTimeout(cb, 60);
function prepareNeighbours() {
  idle(() => {
    if (!started || busy || drag) return;
    metrics(COLORS[nb(idx, 1)], titleNext);
    metrics(COLORS[nb(idx, -1)], titleNext);
    peekFor = null;                     // titleNext a servi de règle : le prochain peek le réécrit
  });
}

/* ---------- Rendu d'un état du geste ---------- */

const mix = (a, b, k) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k));
function paint() {
  const W = geo.sw, a = Math.abs(p), side = p < 0 ? 1 : -1;
  const ts = titleCur.style, ns = titleNext.style;
  if (!wipe || reduced.matches) {
    // Fondu enchaîné seul, aucune translation
    if (wipe) wipe.style.translate = "";
    shotCur.style.translate = ""; shotNext.style.translate = "";
    shotCur.style.opacity = a ? (1 - a).toFixed(3) : "";
    ts.setProperty("--tx", "0px"); ns.setProperty("--tx", "0px");
    ts.setProperty("--o", a ? (1 - a).toFixed(3) : "1");
    ns.setProperty("--o", a ? a.toFixed(3) : "0");
  } else {
    // Volet directionnel : la fenêtre glisse, l'image courante reste immobile dedans
    const X = Math.round(a * geo.rw) * (p < 0 ? -1 : 1);
    wipe.style.translate = X ? `${X}px 0` : "";
    shotCur.style.translate = X ? `${-X}px 0` : "";
    shotCur.style.opacity = "";
    const nx = a ? Math.round(side * 24 * (1 - a)) : 0;
    shotNext.style.translate = nx ? `${nx}px 0` : "";
    ts.setProperty("--tx", Math.round(p * W * 0.6) + "px");
    ts.setProperty("--o", a ? clamp(1 - a * 2, 0, 1).toFixed(3) : "1");
    ns.setProperty("--tx", (a ? Math.round(side * W * 0.22 * (1 - a)) : 0) + "px");
    ns.setProperty("--o", a ? clamp(a * 1.6 - 0.25, 0, 1).toFixed(3) : "0");
  }
  // Fond de scène : interpolé pendant le passage (sur #stage), exact au repos (sur :root)
  const bc = a && bgCache.get(COLORS[idx]?.code), bn = a && peekColor && bgCache.get(peekColor.code);
  if (bc && bn) stage.style.setProperty("--bg", rgbCss(mix(bc, bn, a)));
  else stage.style.removeProperty("--bg");
  linkFan();
}
function setMoving(on) { stage.classList.toggle("moving", on); }

let peekFor = null, peekColor = null;
function peek(c) {
  const key = c.code + "|" + geo.key;
  if (peekFor === key) return;
  peekFor = key; peekColor = c;
  setImg(shotNext, c);
  applyTitle(titleNext, c);
}

/* ---------- L'étiquette (.spec) ----------
   Nº + compteur à rouleaux, nom en Poppins (suffixe de finition en italique, ligne 2), filet + perle de laque,
   Famille / Finition. Pendant un changement : le nom sort (.swap), puis au calage le compteur roule et le nom
   se révèle mot à mot. Une nouvelle demande annule tout ce qui est en vol : l'état final est toujours exact. */

const SUFFIX = /\s+((?:Metallic|Pearl|Matte?|Satin)(?:\s*\([^)]*\))?)$/i;   // « Metallic », « Metallic (964) »
const splitName = (name) => { const m = name.match(SUFFIX); return m ? [name.slice(0, m.index), m[1]] : [name, ""]; };
const fmt3 = (i) => String(i + 1).padStart(3, "0");
const label = { i: -1, name: "", odoAnims: [], odoT: 0, nameAnims: [], nameT: 0, dir: 1 };

// Compteur : 3 colonnes, chacune un chiffre ; au changement, l'ancien sort et le nouveau entre (sens de navigation)
function odoBuild() {
  if (odoEl && !odoEl.children.length) odoEl.innerHTML = '<span class="dg"><b>0</b></span>'.repeat(3);
}
function odoSettle() {
  clearTimeout(label.odoT);
  label.odoAnims.forEach((a) => a.cancel());
  label.odoAnims = [];
  odoEl?.querySelectorAll(".dg").forEach((col) => { while (col.children.length > 1) col.firstElementChild.remove(); });
}
function odoSet(i, dir = 0) {
  if (!odoEl) return;
  odoBuild();
  odoSettle();
  const ds = fmt3(i), cols = [...odoEl.children];
  const roll = dir && !reduced.matches && started;
  let k = 0;
  cols.forEach((col, n) => {
    const cur = col.lastElementChild;
    if (cur.textContent === ds[n]) return;
    if (!roll) { cur.textContent = ds[n]; return; }
    const nx = document.createElement("b");
    nx.textContent = ds[n];
    col.append(nx);
    const o = { duration: 520, delay: k * 40, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" };
    const up = dir > 0 ? -100 : 100;
    label.odoAnims.push(cur.animate([{ translate: "0 0" }, { translate: `0 ${up}%` }], { ...o, fill: "forwards" }));
    label.odoAnims.push(nx.animate([{ translate: `0 ${-up}%` }, { translate: "0 0" }], o));
    k++;
  });
  if (label.odoAnims.length) label.odoT = setTimeout(odoSettle, 520 + k * 40 + 80);
  odoEl.parentElement?.setAttribute("aria-label", `Nº ${i + 1} sur ${COLORS.length}`);
}

// Nom : mots enveloppés (masque de débordement) pour la révélation ; taille ajustée à la largeur par mesure
const words = (t) => t.split(/\s+/).filter(Boolean).map((w) => `<span class="w"><span>${esc(w)}</span></span>`).join(" ");
function nameSettle() {
  clearTimeout(label.nameT);
  label.nameAnims.forEach((a) => a.cancel());
  label.nameAnims = [];
}
function nameSet(c, reveal = false) {
  if (!nameEl) return;
  nameSettle();
  const [l1, l2] = splitName(c.name);
  if (label.name !== c.name) {
    nameL1.innerHTML = words(l1);
    nameL2.innerHTML = l2 ? words(l2) : "";
    label.name = c.name;
    fitName();
  }
  if (!reveal || reduced.matches) return;
  const inner = nameEl.querySelectorAll(".w > span");
  inner.forEach((w, n) => label.nameAnims.push(w.animate([{ translate: "0 110%" }, { translate: "0 0" }],
    { duration: 560, delay: n * 60, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" })));
  label.nameT = setTimeout(nameSettle, 560 + inner.length * 60 + 80);
}
// Ligne 1 : au plus 2 lignes et aucun mot plus large que l'étiquette ; sinon la taille descend (px entiers)
function fitName() {
  if (!nameEl) return;
  nameEl.style.fontSize = "";
  const base = Math.round(parseFloat(getComputedStyle(nameEl).fontSize)) || 40;
  const compact = getComputedStyle(nameEl).whiteSpace === "nowrap";
  const min = compact ? 16 : 22;
  const tooBig = (sz) => {
    if (compact) return nameEl.scrollWidth > nameEl.clientWidth + 1;
    const wide = [...nameL1.children, ...nameL2.children].some((w) => w.offsetWidth > nameEl.clientWidth + 1);
    return wide || nameL1.offsetHeight > sz * 2.2;
  };
  let sz = base;
  nameEl.style.fontSize = sz + "px";                   // toujours un px entier (la base CSS dépend de vh)
  while (sz > min && tooBig(sz)) { sz -= 2; nameEl.style.fontSize = sz + "px"; }
}
function setBead(c) {
  if (!beadEl || !c) return;
  beadEl.style.setProperty("--c", c.hex);
  beadEl.style.setProperty("--metal", String(metal(c)));
  beadEl.title = `${c.name} · ≈ ${c.hex.toUpperCase()} (approximation écran)`;
}
// Écrit l'étiquette. reveal : compteur à rouleaux + révélation du nom (au calage d'un changement)
function writeSpec(c, reveal = false) {
  odoSet(c.i, reveal ? label.dir : 0);
  label.i = c.i;
  nameSet(c, reveal);
  const code = $("specCode");
  if (code) { code.textContent = c.code; code.setAttribute("aria-label", `Copier le code ${c.code}`); }
  const fam = $("specFam"); if (fam) fam.textContent = famLabel(c.family);
  const fin = $("specFinish"); if (fin) fin.textContent = metal(c) ? "Métallisé" : "Uni";
  const fp = $("specFamPos");
  if (fp) fp.textContent = `· ${famLabel(c.family)} ${c.i - famStart[c.family] + 1}/${famCount[c.family]}`;
  setBead(c);
}
let swapT0 = 0, swapTimer = 0;
function swapOut() {
  clearTimeout(swapTimer);
  if (!specEl || specEl.classList.contains("swap")) return;
  nameSettle();
  specEl.classList.add("swap");
  swapT0 = performance.now();
}
// Une fois le nom sorti : étiquette de la teinte courante, révélée ; sans changement en cours, écriture directe
function swapIn() {
  clearTimeout(swapTimer);
  if (!specEl || !specEl.classList.contains("swap")) {
    if (COLORS.length && !userScrolling && (label.i !== idx || label.name !== COLORS[idx].name)) writeSpec(COLORS[idx]);
    return;
  }
  const wait = Math.max(0, (reduced.matches ? 0 : SWAP_OUT) - (performance.now() - swapT0));
  swapTimer = setTimeout(() => {
    const c = COLORS[idx];
    label.name = "";                                   // force la réécriture des mots (révélation)
    writeSpec(c, true);
    if (userScrolling && previewI != null) previewSpec(COLORS[previewI]);     // l'utilisateur défile encore
    specEl.classList.remove("swap");
  }, wait);
}
// Pendant la rotation : la perle et le nom montrent la lame de l'index (sans animation) ; null = teinte courante
let previewI = null;
function previewSpec(c) {
  previewI = c ? c.i : null;
  setBead(c ?? COLORS[idx]);
  if (c) { if (!specEl?.classList.contains("swap") && label.name !== c.name) nameSet(c); }
  else revertName();
}
function revertName() {
  if (!specEl?.classList.contains("swap") && COLORS.length && label.name !== COLORS[idx].name) nameSet(COLORS[idx]);
}

/* ---------- Éclat de laque (au calage) et lumière de studio (pointeur fin) ---------- */

function flash(dir) {
  if (!flashBand || reduced.matches || stage.classList.contains("noimg") || drag?.on || userScrolling) return;
  flashBand.getAnimations().forEach((a) => a.cancel());
  const span = Math.round(100 / 0.18) + 100;          // la bande (18 % de la scène) traverse toute la scène
  const [a, b] = dir < 0 ? [`${span - 100}%`, "-100%"] : ["-100%", `${span - 100}%`];
  flashBand.animate([{ translate: `${a} 0`, opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.78 }, { translate: `${b} 0`, opacity: 0 }],
    { duration: 900, easing: "cubic-bezier(.45,0,.2,1)" });
}
const studio = { x: 0, y: 0, tx: 0, ty: 0, raf: 0, on: false, ox: 0, oy: 0 };
function studioMeasure() {
  const r = $("rig")?.getBoundingClientRect();
  if (r) { studio.ox = r.left; studio.oy = r.top; }
}
function studioStep() {
  studio.x += (studio.tx - studio.x) * 0.08;
  studio.y += (studio.ty - studio.y) * 0.08;
  const done = Math.abs(studio.tx - studio.x) < 0.5 && Math.abs(studio.ty - studio.y) < 0.5;
  if (done) { studio.x = studio.tx; studio.y = studio.ty; }
  studioLight.style.translate = `${Math.round(studio.x)}px ${Math.round(studio.y)}px`;
  studio.raf = done ? 0 : requestAnimationFrame(studioStep);
}
function wireStudio() {
  if (!studioLight) return;
  studioMeasure();
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || !fine.matches || reduced.matches) return;
    studio.tx = e.clientX - studio.ox; studio.ty = e.clientY - studio.oy;
    if (!studio.on) {
      studio.on = true; studio.x = studio.tx; studio.y = studio.ty; body.classList.add("lit");
      studioLight.style.translate = `${Math.round(studio.x)}px ${Math.round(studio.y)}px`;
    }
    if (!studio.raf) studio.raf = requestAnimationFrame(studioStep);
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => body.classList.remove("lit"));
  document.documentElement.addEventListener("pointerenter", () => { if (studio.on) body.classList.add("lit"); });
}

/* ---------- État courant ---------- */

function updateFav() {
  if (!COLORS.length) return;
  const n = favs.size, fav = favs.has(COLORS[idx].code), b = $("fav");
  if (b) {
    b.setAttribute("aria-pressed", String(fav));
    b.setAttribute("aria-label", (fav ? "Retirer des favoris" : "Ajouter aux favoris") + (n ? ` (${plural(n, "favori")})` : ""));
    const l = $("favL"); if (l) l.textContent = fav ? "Favori ✓" : "Favori";
  }
  const tn = $("tFavN"); if (tn) tn.textContent = String(n);
  $("tFav")?.setAttribute("aria-label", `Favoris (${n})`);
  const sf = $("segFavN"); if (sf) sf.textContent = String(n);
  const sh = $("shareSel"); if (sh) sh.hidden = !(nu.fav && n > 0);
  const cs = $("cmpSel"); if (cs) cs.hidden = !(nu.fav && n > 0);
}

function writeHash(h) {
  if (location.hash === h) return;
  try { history.replaceState(history.state, "", h); } catch { /* Safari limite replaceState */ }
}

let announceOn = false;
function announce(i) {
  const live = $("fanLive");
  if (!live || !announceOn) return;
  const c = COLORS[i];
  live.textContent = `${c.name}, ${famLabel(c.family)}, ${i + 1} sur ${COLORS.length}`;
}

function applyMeta() {
  const c = COLORS[idx];
  root.style.setProperty("--paint", c.hex);
  root.style.setProperty("--title", titleColor(c.hex));
  applyBg();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", c.hex);
  document.title = `${c.name} — Atelier 911`;
  if (!isOpen("cmpPanel")) writeHash("#" + c.code);
  updateFav();
  if (!userScrolling) previewSpec(null);
  markCurrent();
  centreFan(dest(), { passive: true });
  announce(idx);
  const n1 = nb(idx, 1), p1 = nb(idx, -1);
  [n1, p1, nb(n1, 1), nb(p1, -1)].forEach((i) => load(imgUrl(COLORS[i].code)));   // voisines préchargées
  prepareNeighbours();
}

// Passage à COLORS[i]. ready : shotNext montre déjà c, le passage est instantané, sans flash.
// Sinon on passe quand même, en aplat (.noimg), et le rendu apparaîtra s'il finit par arriver.
async function commit(i, ready) {
  const c = COLORS[i];
  setImg(shotCur, c);
  const ok = ready ? await shows(shotCur, c.code, 1500) : false;
  idx = i;
  applyTitle(titleCur, c);
  p = 0; peekFor = null;
  setNoImg(stage, !ok);
  if (!ok && shotNext.dataset.code !== c.code) clearImg(shotNext);   // jamais une autre voiture sous l'aplat
  paint();
  applyMeta();
  if (!ok) trackCur();
  hideHint();
  if (ok && pending == null) flash(label.dir);
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(8);
}

// rAF, avec repli minuterie si la page n'est pas rendue (onglet caché) : une transition se termine toujours.
function frame(cb) {
  let fired = false;
  const id = requestAnimationFrame((t) => { if (!fired) { fired = true; cb(t); } });
  setTimeout(() => { if (!fired) { fired = true; cancelAnimationFrame(id); cb(performance.now()); } }, 100);
}

function animateTo(to, dur, ease = EASE.inout) {
  if (document.hidden) dur = 1;
  else if (reduced.matches) { dur = 200; ease = EASE.linear; }
  return new Promise((done) => {
    const from = p, t0 = performance.now();
    const stepF = (t) => {
      const k = clamp((t - t0) / dur, 0, 1);
      p = k < 1 ? from + (to - from) * ease(k) : to;
      paint();
      k < 1 ? frame(stepF) : done();
    };
    frame(stepF);
  });
}

// Fin de toute transition : libère l'état, traite la dernière demande en attente, sinon fait revenir la fiche.
function release() {
  busy = false; target = null;
  if (!drag?.on) setMoving(false);
  if (link && !drag?.on) unlink();
  if (pending != null && !drag?.on) {
    const n = pending; pending = null;
    if (n !== idx) return void goTo(n, 320, EASE.out);
  }
  markCurrent();
  swapIn();
}

// Transition complète vers COLORS[i], depuis l'état actuel du geste p.
async function transition(i, dir, dur, ease) {
  busy = true; target = i;
  label.dir = dir || 1;
  setMoving(true);
  swapOut();
  try {
    const c = COLORS[i];
    peek(c);
    const ready = await waitNext(c.code);
    if (ready === null) { if (p) await animateTo(0, 200, EASE.out); return; }   // l'utilisateur est déjà ailleurs
    if (ready) await animateTo(-dir, dur, ease);
    else if (p) await animateTo(0, 200, EASE.out);
    await commit(i, ready);
  } finally {
    release();
  }
}

// Sens du volet : celui de l'éventail (vers la droite = suivante)
const autoDir = (i) => (i >= idx ? 1 : -1);

// Va vers la teinte i. L'éventail tourne tout de suite avec la voiture ; pendant une transition ou un geste,
// seule la dernière demande est gardée (pending).
function goTo(i, dur = D.paint, ease = EASE.inout, dir = 0) {
  if (!started) return;
  i = clamp(Math.round(i), 0, COLORS.length - 1);
  if (busy || drag?.on) {
    pending = i === (target ?? idx) ? null : i;
    markCurrent();
    centreFan(dest());
    return;
  }
  pending = null;
  centreFan(i);
  if (i !== idx) transition(i, dir || autoDir(i), dur, ease);   // pose target de façon synchrone
  markCurrent();
}
function go(dir) {
  const n = step(dir);
  if (n === dest()) return;                         // une seule teinte dans la portée : rien
  goTo(n, D.paint, EASE.inout, dir);
}

/* ---------- Geste (souris + tactile) ---------- */

// Vitesse (px/ms) sur les 100 dernières ms
function velocity(d) {
  const s = d.samples;
  if (s.length < 2) return 0;
  const a = s[0], b = s[s.length - 1], dt = b.t - a.t;
  return dt > 0 ? (b.x - a.x) / dt : 0;
}

stage.addEventListener("pointerdown", (e) => {
  if (busy || drag || e.button > 0 || !started) return;
  const t = performance.now();
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, off: 0, dir: 0, elastic: false, d: 0, on: false, samples: [{ t, x: e.clientX }] };
  try { stage.setPointerCapture(e.pointerId); } catch {}
});

stage.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const now = performance.now(), raw = e.clientX - drag.x0;
  if (!drag.on) {
    if (Math.abs(raw) < 6) return;
    if (Math.abs(e.clientY - drag.y0) > Math.abs(raw)) { drag = null; return; }
    drag.on = true;
    stage.classList.add("dragging");
    setMoving(true);
    closeFloating();
    startLink();
  }
  const s = drag.samples;
  s.push({ t: now, x: e.clientX });
  while (s.length > 2 && now - s[0].t > 100) s.shift();

  const W = geo.sw || 1;
  let d = raw - drag.off;
  const dir = d < 0 ? 1 : -1;
  const ni = nb(idx, dir), self = ni === idx;
  if (!self) peek(COLORS[ni]);
  const live = !self && showing(shotNext, COLORS[ni].code);
  // Le rendu arrive en plein geste : on raccroche le doigt sans saut (p continu)
  if (live && drag.elastic && drag.dir === dir) { drag.off = raw - p * W; d = p * W; }
  drag.elastic = !live; drag.dir = dir; drag.d = d; drag.self = self;
  // Rendu pas encore décodé (ou une seule teinte) : élastique, jamais de fondu au noir
  p = live ? clamp(d / W, -1, 1) : Math.sign(d) * Math.min(0.12, (Math.abs(d) / W) * 0.35);
  Math.abs(live ? p : d / W) > 0.2 && !self ? swapOut() : swapIn();
  paint();
});

const endDrag = async (e) => {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const d = drag; drag = null;
  stage.classList.remove("dragging");
  if (!d.on) return;
  askTilt();
  const W = geo.sw || 1, v = velocity(d), av = Math.abs(v);
  const intent = d.elastic ? Math.abs(d.d) / W : Math.abs(p);
  const flick = av > 0.35 && p !== 0 && Math.sign(v) === Math.sign(p);
  const dir = p < 0 ? 1 : -1, ni = nb(idx, dir);
  if (!busy && e?.type === "pointerup" && p !== 0 && ni !== idx && (intent > 0.2 || (flick && intent > 0.03))) {
    pending = null;                                   // le geste l'emporte sur une demande faite pendant le geste
    const dur = clamp(((1 - Math.abs(p)) * W) / Math.max(av, 0.9), 180, 420);
    return transition(ni, dir, dur, EASE.out);
  }
  if (busy) return;                                   // ne devrait pas arriver : ne rien écrire dans p
  busy = true;
  try {
    if (p) await animateTo(0, clamp((Math.abs(p) * W) / Math.max(av, 0.9), 180, 420), EASE.out);
  } finally { release(); }
};
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);
stage.addEventListener("lostpointercapture", endDrag);

/* ---------- Parallaxe : souris sur ordinateur, inclinaison sur mobile (lerp rAF, px entiers) ---------- */

const par = { x: 0, y: 0, tx: 0, ty: 0, wx: 0, wy: 0, raf: 0, t: 0 };
function setParallax(nx, ny) {
  if (reduced.matches) nx = ny = 0;
  const tx = -nx * 10, ty = -ny * 6;
  if (Math.abs(tx - par.tx) < 0.35 && Math.abs(ty - par.ty) < 0.35) return;   // évite le tremblement des capteurs
  par.tx = tx; par.ty = ty;
  if (!par.raf) { par.t = performance.now(); par.raf = requestAnimationFrame(parStep); }
}
function parStep(now) {
  const k = 1 - Math.pow(1 - 0.09, Math.min(64, now - par.t) / 16.67);
  par.t = now;
  par.x += (par.tx - par.x) * k;
  par.y += (par.ty - par.y) * k;
  const settled = Math.abs(par.tx - par.x) < 0.05 && Math.abs(par.ty - par.y) < 0.05;
  if (settled) { par.x = par.tx; par.y = par.ty; }
  const wx = Math.round(par.x), wy = Math.round(par.y);
  if (wx !== par.wx || wy !== par.wy) {
    par.wx = wx; par.wy = wy;
    rig.style.setProperty("--px", wx + "px");
    rig.style.setProperty("--py", wy + "px");
  }
  par.raf = settled ? 0 : requestAnimationFrame(parStep);
}
addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || drag || panelOpen) return;
  setParallax((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
}, { passive: true });
root.addEventListener("mouseleave", () => setParallax(0, 0));
reduced.addEventListener?.("change", () => { setParallax(0, 0); if (started && !busy && !drag) paint(); });

let tiltAsked = false;
function askTilt() {
  if (tiltAsked || reduced.matches || !("DeviceOrientationEvent" in window) || !coarse.matches) return;
  tiltAsked = true;
  const start = () => addEventListener("deviceorientation", (e) => {
    if (e.gamma != null && !panelOpen) setParallax(clamp(e.gamma / 25, -1, 1), clamp((e.beta - 45) / 30, -1, 1));
  });
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission().then((s) => s === "granted" && start()).catch(() => {});
  } else start();
}

/* =====================================================================
   L'Éventail : 152 lames laquées autour d'un pivot placé sous le bord bas
   Pendant la rotation : une seule écriture par image (transform du conteneur) ; les lames
   ne bougent qu'à la sélection (vague, ouverture), au survol et au dépliage d'arrivée. Un seul reflet
   (.fan-gloss), fixe à l'écran, couvre tout l'arc. Le texte n'est jamais tourné : étiquettes de
   famille et carte d'aperçu sont posées au pixel entier par le calcul.
   Les angles sont en degrés, indépendants du rayon : un redimensionnement garde la lame centrée.
   ===================================================================== */

const FAN = { pitch: 1.15, gap: 0.9, wsel: 2.2 };   // ° d'arc par lame, ° entre familles, largeur de la lame choisie
const DEG = 180 / Math.PI;
const fanEl = $("fan"), fanList = $("fanList"), fanRot = $("fanRot"), fanFams = $("fanFams"), fanCard = $("fanCard");
const cardImg = fanCard?.querySelector("img"), cardName = fanCard?.querySelector("b"), cardCode = fanCard?.querySelector(".fc-txt .mono");
const fan = {
  R: 1100, w: 22, ws: 48, H: 150, tip: 52, out: [26, 12, 6], hover: 8, cx: 720, W: 1440, top: 0, dsel: 0, lh: 14,
  theta: [], famMid: {}, blades: [], labels: {}, lw: {}, side: {}, boxes: [], avoid: [], cardW: 254, cardH: 136, cardSized: false, card: -1, cardMode: null, buzz: 0,
  angle: 0, wa: null, k: -1, s: -1, fam: null, wave: [], anim: null, ptr: null, wheelT: 0, wheelPending: false, prefetchT: 0, hov: null,
};
let userScrolling = false;   // rotation venue de l'utilisateur depuis le dernier repos (la fiche montre la lame de l'index)
let link = null;             // geste sur la voiture : l'éventail suit (mode lié)
let suppressClick = false, suppressT = 0;

const bladeLabel = (c) => `${c.name}, ${c.code}, ${famLabel(c.family)}${favs.has(c.code) ? ", favori" : ""}`;

function buildFan() {
  let a = 0, html = "";
  fan.theta = [];
  COLORS.forEach((c, i) => {
    if (i > 0) a += FAN.pitch + (c.family !== COLORS[i - 1].family ? FAN.gap : 0);
    fan.theta[i] = a;
    html += `<div class="blade" role="option" id="bl-${esc(c.code)}" data-i="${i}" aria-selected="false" aria-label="${esc(bladeLabel(c))}"` +
      ` style="--c:${c.hex};--metal:${metal(c)};--a:${a.toFixed(3)}deg;--k:${i}"></div>`;
  });
  fanRot.innerHTML = html;
  fan.blades = [...fanRot.children];
  let fh = "";
  fan.famMid = {};
  FAMILIES.forEach(([k, label]) => {
    if (!famCount[k]) return;
    fan.famMid[k] = (fan.theta[famStart[k]] + fan.theta[famStart[k] + famCount[k] - 1]) / 2;
    fh += `<button class="fan-fam off" type="button" data-f="${k}" tabindex="-1" aria-label="${label} : aller à la première teinte">${label}</button>`;
  });
  fanFams.innerHTML = fh;
  fan.labels = {};
  fanFams.querySelectorAll("[data-f]").forEach((b) => { fan.labels[b.dataset.f] = b; b._on = false; });
  fanList.setAttribute("aria-label", `Éventail : ${plural(COLORS.length, "teinte")}`);
}

// Géométrie : mesurée au démarrage et au redimensionnement seulement
function measureFan() {
  const cs = getComputedStyle(root), num = (n, d) => { const v = parseFloat(cs.getPropertyValue(n)); return Number.isFinite(v) ? v : d; };
  const W = fanEl.clientWidth || innerWidth;
  fan.W = W; fan.cx = Math.round(W / 2);
  fan.H = Math.round(num("--fan-h", 150));
  fan.tip = Math.round(num("--fan-tip", 52));
  const o = Math.round(num("--fan-out", 26));
  fan.out = [o, Math.round(o * 0.46), Math.round(o * 0.23)];
  fan.hover = Math.round(num("--fan-hover", 8));
  fan.lh = Math.round(num("--fan-lh", 14));
  fan.R = Math.round(Math.max(W * num("--fan-r", 1.05), num("--fan-rmin", 1100)));
  fan.w = Math.max(8, Math.round((fan.R * FAN.pitch) / DEG));
  fan.ws = Math.round(fan.w * FAN.wsel);
  fan.dsel = ((fan.ws - fan.w) / 2 / fan.R) * DEG;      // l'éventail s'ouvre de part et d'autre de la lame choisie
  fanRot.style.left = fan.cx + "px";
  fanRot.style.top = fan.tip + fan.R + "px";
  const s = fanEl.style;                                  // hérité par les lames et le reflet
  s.setProperty("--cx", fan.cx + "px");
  s.setProperty("--hw", Math.round(W / 2) + "px");
  s.setProperty("--R", fan.R + "px");
  s.setProperty("--w", fan.w + "px");
  s.setProperty("--ws", fan.ws + "px");
  s.setProperty("--len", fan.H - fan.tip + o + 64 + "px");
  s.setProperty("--dsel", fan.dsel.toFixed(4) + "deg");
  fan.out.forEach((v, j) => s.setProperty("--o" + j, v + "px"));
  for (const f in fan.labels) fan.lw[f] = fan.labels[f].offsetWidth;

  // Fiche et commandes : posées juste au-dessus de l'arc là où elles se trouvent (l'arc descend vers les bords)
  const dcs = getComputedStyle($("dock")), padL = parseFloat(dcs.paddingLeft) || 0, padR = parseFloat(dcs.paddingRight) || 0;
  const spec = document.querySelector(".spec"), ctrls = document.querySelector(".ctrls");
  const specW = Math.min(spec?.offsetWidth ?? W, W - padL - padR - (ctrls?.offsetWidth ?? 0));
  const ctrlW = ctrls?.offsetWidth ?? 0, rowH = Math.max(spec?.offsetHeight ?? 0, ctrls?.offsetHeight ?? 0);
  const dx = Math.min(W / 2 - padL - specW, W / 2 - padR - ctrlW);
  const arcY = (d) => fan.tip + fan.R - Math.sqrt(Math.max(0, fan.R * fan.R - d * d));
  const dockB = dx <= fan.ws / 2 + 24 ? fan.H + 4 : clamp(Math.round(fan.H - arcY(dx) + 14), 12, fan.H + 4);
  root.style.setProperty("--dock-b", dockB + "px");
  const y1 = fan.H - dockB, y0 = y1 - rowH;                 // zones de la fiche / des commandes, repère de l'éventail
  fan.boxes = y1 > 0 ? [[padL, y0, padL + specW, y1], [W - padR - ctrlW, y0, W - padR, y1]] : [];
  fan.top = Math.round(fanEl.getBoundingClientRect().top);
  // Zones que la carte d'aperçu ne recouvre jamais (repère de la fenêtre)
  const vb = innerHeight - dockB, vt = vb - rowH;
  const ctrlH = ctrls?.offsetHeight ?? rowH;
  fan.avoid = [[padL, vt, padL + specW, vb], [W - padR - ctrlW, vb - ctrlH, W - padR, vb]];
  fan.cardSized = false;                                  // mesurée au premier affichage (polices chargées)
  placeHint(spec, ctrls);
  fan.wa = null;
}

// Angle visuel d'une lame : sa place + l'ouverture autour de la lame choisie
const eff = (k) => fan.theta[k] + (fan.s < 0 ? 0 : Math.sign(k - fan.s) * fan.dsel);
const limits = () => [-eff(COLORS.length - 1), -eff(0)];
// Lame la plus proche de l'index (0°) pour un angle de rotation a
function nearest(a) {
  const t = -a, th = fan.theta;
  let lo = 0, hi = th.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (th[m] < t) lo = m + 1; else hi = m; }
  let best = lo, bd = Infinity;
  for (let j = Math.max(0, lo - 2); j <= Math.min(th.length - 1, lo + 2); j++) {
    const d = Math.abs(eff(j) - t);
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}

// Une image : le transform du conteneur, la lame sous l'index, les étiquettes de famille (px entiers)
function setAngle(a) {
  fan.angle = a;
  if (a !== fan.wa) { fan.wa = a; fanRot.style.transform = `rotate(${a.toFixed(4)}deg)`; }
  const k = nearest(a);
  if (k !== fan.k) onCentred(k);
  placeLabels();
}
function onCentred(k) {
  fan.k = k;
  const f = COLORS[k].family;
  if (f !== fan.fam) {
    fan.labels[fan.fam]?.classList.remove("cur");
    fan.labels[f]?.classList.add("cur");
    fan.fam = f;
  }
  if (!userScrolling) return;
  previewSpec(COLORS[k]);
  showCard(k, "scrub");
  // Cran tactile à chaque lame pendant un glisser au doigt (≥ 40 ms d'écart)
  const now = performance.now();
  if (fan.ptr?.on && fan.ptr.type === "touch" && coarse.matches && !reduced.matches && now - fan.buzz >= 40 &&
    navigator.userActivation?.hasBeenActive) { fan.buzz = now; navigator.vibrate?.(3); }
  clearTimeout(fan.prefetchT);
  fan.prefetchT = setTimeout(() => { if (fan.k === k) load(imgUrl(COLORS[k].code)); }, 80);
}

function placeLabels() {
  const { R, H, W, cx, lh } = fan, rc = R + 10 + lh / 2, py = fan.tip + R, zone = fan.ws / 2 + 10;
  const shown = [];
  for (const f in fan.labels) {
    const el = fan.labels[f], lw = fan.lw[f] || 48;
    const f0 = famStart[f], f1 = f0 + famCount[f] - 1;
    const sh = fan.s < 0 || (fan.s >= f0 && fan.s <= f1) ? 0 : fan.s < f0 ? fan.dsel : -fan.dsel;
    const phi = (fan.angle + fan.famMid[f] + sh) / DEG;
    let ok = Math.abs(phi) < 1.2, L = 0, T = 0;
    if (ok) {
      // Jamais sur l'index : l'étiquette se range à côté de la lame choisie (avec hystérésis)
      let x = cx + rc * Math.sin(phi);
      const d = x - cx, min = lw / 2 + zone;
      let side = d < 0 ? -1 : 1;
      if (Math.abs(d) < min) {
        side = fan.side[f] ?? side;
        if (d * side < -lw / 4) side = -side;
        x = cx + side * min;
      }
      fan.side[f] = side;
      const dx = x - cx, y = py - Math.sqrt(Math.max(0, rc * rc - dx * dx));
      L = Math.round(x - lw / 2); T = Math.round(y - lh / 2);
      ok = L >= 8 && L + lw <= W - 8 && T >= 0 && T + lh <= H - 4 &&
        !fan.boxes.some(([a, b, c, e]) => L < c + 8 && L + lw > a - 8 && T < e + 4 && T + lh > b - 4);
    }
    if (ok) shown.push({ f, el, L, T, lw });
    else if (el._on) { el._on = false; el.classList.add("off"); }
  }
  // Collisions (petites familles, téléphone) : l'étiquette de la famille courante passe d'abord
  shown.sort((a, b) => (b.f === fan.fam) - (a.f === fan.fam) || a.L - b.L);
  const kept = [];
  for (const s of shown) {
    const hit = kept.some((k) => s.L < k.L + k.lw + 12 && s.L + s.lw + 12 > k.L && Math.abs(s.T - k.T) < lh + 4);
    if (hit) { if (s.el._on) { s.el._on = false; s.el.classList.add("off"); } continue; }
    kept.push(s);
    const v = `${s.L}px ${s.T}px`;
    if (s.el._t !== v) { s.el._t = v; s.el.style.translate = v; }
    if (!s.el._on) { s.el._on = true; s.el.classList.remove("off"); }
  }
}

/* ---------- Rotation animée ---------- */

function setFanMoving(on) {
  fanEl.classList.toggle("moving", on);
  if (on && fan.cardMode === "hover") hideTip();
}
function cancelFanAnim() {
  const a = fan.anim;
  if (!a) return;
  a.dead = true;
  cancelAnimationFrame(a.raf);
  clearTimeout(a.t);
  fan.anim = null;
}
// user : rotation voulue par l'utilisateur (glisser, molette) — au repos, la lame de l'index devient la teinte
function animFan(to, dur, { user = false, k = null, ease = EASE.out } = {}) {
  cancelFanAnim();
  if (reduced.matches || document.hidden || dur <= 1) { setAngle(to); fanRest(user); return; }
  const from = fan.angle, t0 = performance.now();
  const a = (fan.anim = { to, user, k, raf: 0, t: 0, dead: false });
  setFanMoving(true);
  const end = () => { if (a.dead) return; a.dead = true; fan.anim = null; setAngle(to); fanRest(user); };
  const stepF = (t) => {
    if (a.dead) return;
    const q = clamp((t - t0) / dur, 0, 1);
    if (q < 1) { setAngle(from + (to - from) * ease(q)); a.raf = requestAnimationFrame(stepF); }
    else end();
  };
  a.raf = requestAnimationFrame(stepF);
  a.t = setTimeout(end, dur + 400);                   // onglet caché : rAF suspendu, on termine quand même
}
function fanRest(user) {
  setFanMoving(!!(fan.ptr?.on || link));
  if (user) onFanSettle();
}
// Repos après un geste : un seul goTo, vers la lame sous l'index
function onFanSettle() {
  if (fan.ptr?.on || link || fan.anim) return;
  userScrolling = false;
  hideTip();
  const k = nearest(fan.angle);
  if (k !== dest()) goTo(k, D.paint);
  else { previewSpec(null); markCurrent(); centreFan(k); }
}
function snapTo(k, { user = true, dur } = {}) {
  k = clamp(k, 0, COLORS.length - 1);
  const to = -eff(k), dist = Math.abs(to - fan.angle) / FAN.pitch;
  animFan(to, dur ?? clamp(Math.round(220 + dist * 24), 240, 900), { user, k });
}
// Amène la teinte i sous l'index (synchronisation depuis la voiture, le clavier, le nuancier…).
// passive : appel automatique (commit) — ne contrarie jamais une rotation de l'utilisateur.
function centreFan(i, { passive = false, dur } = {}) {
  if (!fan.theta.length || link || fan.ptr?.on) return;
  if (passive && userScrolling) return;
  clearTimeout(fan.wheelT);
  if (userScrolling) { userScrolling = false; previewSpec(null); hideTip(); }
  const to = -fan.theta[i];
  if (fan.anim && !fan.anim.user && fan.anim.to === to) return;
  if (!fan.anim && Math.abs(fan.angle - to) < 1e-3) { if (fan.angle !== to) setAngle(to); return; }
  const dist = Math.abs(to - fan.angle) / FAN.pitch;
  animFan(to, dur ?? (dist <= 3 ? 300 : dist <= 40 ? 520 : 760), { user: false, k: i });
}

/* ---------- Sélection : vague, ouverture, aria ---------- */

function markCurrent() {
  if (!COLORS.length) return;
  const i = dest();
  if (i !== fan.s) setSel(i);
  markNuCur(i);
}
function setSel(i) {
  const old = fan.blades[fan.s];
  if (old) old.setAttribute("aria-selected", "false");
  fan.wave.forEach((el) => el.classList.remove("w0", "w1", "w2"));
  fan.wave = [];
  for (let d = -2; d <= 2; d++) {
    const el = fan.blades[i + d];
    if (el) { el.classList.add("w" + Math.abs(d)); fan.wave.push(el); }
  }
  fan.s = i;
  const el = fan.blades[i];
  el.setAttribute("aria-selected", "true");
  fanRot.style.setProperty("--s", String(i));
  fanList.setAttribute("aria-activedescendant", el.id);
  if (fan.cardMode === "hover") hideTip();
  preloadThumbs(i);
}

/* ---------- Mode lié : l'éventail suit le geste de la voiture ---------- */

function startLink() {
  if (reduced.matches || !fan.theta.length) return;
  cancelFanAnim();
  clearTimeout(fan.wheelT);
  if (userScrolling) { userScrolling = false; previewSpec(null); }
  link = {};
  setFanMoving(true);
}
function linkFan() {
  if (!link) return;
  const k0 = idx, kn = peekColor && peekColor.i !== idx ? peekColor.i : null;
  const a = kn != null && Math.abs(kn - k0) === 1 && p !== 0 ? eff(k0) + (eff(kn) - eff(k0)) * Math.abs(p) : eff(k0);
  setAngle(-a);
}
function unlink() {
  link = null;
  setFanMoving(false);
  centreFan(dest());
}

/* ---------- Carte d'aperçu : survol (pointeur fin) et rotation par l'utilisateur ---------- */

// Pointe d'une lame, en coordonnées de la fenêtre
function bladeTip(i, extra = 0) {
  const d = Math.abs(i - fan.s), o = d < 3 && fan.s >= 0 ? fan.out[d] : 0;
  const phi = (fan.angle + eff(i)) / DEG, r = fan.R + o + extra;
  return { x: fan.cx + r * Math.sin(phi), y: fan.top + fan.tip + fan.R - r * Math.cos(phi) };
}
const thumbUrl = (c) => `img/thumb/${c.code}.webp`;
const thumbs = new Map();
function preloadThumbs(i, r = 6) {
  for (let d = -r; d <= r; d++) {
    const c = COLORS[i + d];
    if (!c || thumbs.has(c.code)) continue;
    const im = new Image();
    im.decoding = "async";
    im.src = thumbUrl(c);
    thumbs.set(c.code, im);
  }
}
// mode : "hover" (lame survolée) ou "scrub" (lame sous l'index pendant un glisser / une molette)
function showCard(i, mode) {
  if (!fanCard || !started || anyPanel()) return;
  const c = COLORS[i];
  fan.cardMode = mode;
  if (fan.card !== i) {
    fan.card = i;
    fanCard.style.setProperty("--c", c.hex);
    fanCard.style.setProperty("--metal", String(metal(c)));
    cardImg.src = thumbUrl(c);
    cardName.textContent = c.name;
    cardCode.textContent = c.code;
    if (mode === "scrub") preloadThumbs(i);
  }
  if (!fan.cardSized) { fan.cardW = fanCard.offsetWidth; fan.cardH = fanCard.offsetHeight; fan.cardSized = true; }
  const W = fan.cardW, H = fan.cardH, t = bladeTip(i, (mode === "hover" ? fan.hover : 0) + 12);
  let x = Math.round(clamp(t.x - W / 2, 8, innerWidth - W - 8)), y = Math.round(t.y - H);
  // Jamais sur la fiche ni sur les commandes : glisser de côté (si la pointe reste sous la carte), sinon monter
  for (const [l, tp, r, bt] of fan.avoid) {
    if (!(x < r + 8 && x + W > l - 8 && y < bt && y + H > tp - 8)) continue;
    const nx = t.x > (l + r) / 2 ? r + 8 : l - 8 - W;
    if (nx >= 8 && nx + W <= innerWidth - 8 && t.x > nx + 12 && t.x < nx + W - 12) x = Math.round(nx);
    else y = Math.min(y, Math.round(tp - H - 12));
  }
  y = Math.max(8, y);
  const v = `${x}px|${y}px`;
  if (fanCard._p !== v) { fanCard._p = v; fanCard.style.left = x + "px"; fanCard.style.top = y + "px"; }
  fanCard.classList.add("show");
}
function showTip(b) {
  if (fan.hov === b) return;
  hideTip();
  const i = +b.dataset.i;
  if (i === fan.s) return;                            // la fiche la montre déjà
  fan.hov = b;
  b.classList.add("hov");
  showCard(i, "hover");
}
function hideTip() {
  if (fan.hov) { fan.hov.classList.remove("hov"); fan.hov = null; }
  fan.cardMode = null;
  fanCard?.classList.remove("show");
}

/* ---------- Familles ---------- */

// ↑ / ↓ : famille précédente / suivante (↑ revient d'abord au début de la famille courante)
function famStep(dir) {
  const cur = dest(), f = COLORS[cur].family;
  const present = FAMILY_ORDER.filter((x) => famCount[x]);
  let t;
  if (dir < 0 && famStart[f] !== cur) t = famStart[f];
  else {
    const j = present.indexOf(f) + dir;
    if (j < 0 || j >= present.length) return;            // l'éventail a deux bouts
    t = famStart[present[j]];
  }
  if (t != null && t !== cur) goTo(t, D.paint, EASE.inout, dir);
}

/* ---------- Entrées de l'éventail ---------- */

function wireFan() {
  // Un appui sans glisser sur un éventail en mouvement : il reprend là où il allait
  const resume = (pr) => {
    if (pr.was === "user") snapTo(nearest(fan.angle), { user: true });
    else if (pr.was === "auto") centreFan(dest());
  };
  fanEl.addEventListener("pointerdown", (e) => {
    if (!started || e.button > 0 || fan.ptr || link || e.target.closest(".fan-fam")) return;
    // molette en attente de calage = rotation de l'utilisateur interrompue
    const was = fan.anim ? (fan.anim.user ? "user" : "auto") : fan.wheelPending ? "user" : null;
    cancelFanAnim();
    clearTimeout(fan.wheelT);
    fan.wheelPending = false;
    const t = performance.now(), blade = e.target.closest(".blade");
    const pr = (fan.ptr = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, a0: fan.angle, on: false, was, samples: [{ t, a: fan.angle }], lp: 0 });
    if (blade && e.pointerType !== "mouse") {
      pr.lp = setTimeout(() => {
        if (fan.ptr !== pr || pr.on) return;
        fan.ptr = null;
        fireLongPress(blade);
        resume(pr);
      }, 450);
    }
  });
  fanEl.addEventListener("pointermove", (e) => {
    const pr = fan.ptr;
    if (!pr || e.pointerId !== pr.id) return;
    const dx = e.clientX - pr.x0;
    if (!pr.on) {
      if (Math.abs(e.clientY - pr.y0) > 10) clearTimeout(pr.lp);
      if (Math.abs(dx) < 6) return;
      pr.on = true;
      clearTimeout(pr.lp);
      try { fanEl.setPointerCapture(e.pointerId); } catch {}
      fanEl.classList.add("grabbing");
      userScrolling = true;
      closeFloating();
      hideTip();
      setFanMoving(true);
      showCard(fan.k, "scrub");
    }
    // 1 px de geste ≈ 1 px à la pointe ; au-delà des bouts, résistance élastique
    const [lo, hi] = limits();
    let a = pr.a0 + (dx / fan.R) * DEG;
    if (a > hi) a = hi + (a - hi) * 0.3;
    else if (a < lo) a = lo + (a - lo) * 0.3;
    const now = performance.now(), s = pr.samples;
    s.push({ t: now, a });
    while (s.length > 2 && now - s[0].t > 100) s.shift();
    setAngle(a);
  });
  const up = (e) => {
    const pr = fan.ptr;
    if (!pr || e.pointerId !== pr.id) return;
    fan.ptr = null;
    clearTimeout(pr.lp);
    fanEl.classList.remove("grabbing");
    if (!pr.on) { resume(pr); return; }
    suppressClick = true;
    clearTimeout(suppressT); suppressT = setTimeout(() => (suppressClick = false), 60);
    const s = pr.samples, A = s[0], B = s[s.length - 1];
    const v = e.type === "pointerup" && B.t > A.t && performance.now() - B.t < 80 ? (B.a - A.a) / (B.t - A.t) : 0;   // °/ms
    const [lo, hi] = limits();
    snapTo(nearest(clamp(fan.angle + v * 240, lo, hi)), { user: true });      // élan puis calage sur une lame
  };
  fanEl.addEventListener("pointerup", up);
  fanEl.addEventListener("pointercancel", up);
  fanEl.addEventListener("lostpointercapture", up);
  fanEl.addEventListener("contextmenu", (e) => { if (coarse.matches && e.target.closest(".blade")) e.preventDefault(); });

  // Molette / pavé (deltaX et deltaY) : rotation directe, calage différé ; cran de molette = une lame
  fanEl.addEventListener("wheel", (e) => {
    if (!started || e.ctrlKey) return;
    e.preventDefault();
    if (link || fan.ptr?.on) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    closeFloating();
    if (fan.cardMode === "hover") hideTip();
    userScrolling = true;
    clearTimeout(fan.wheelT);
    const notch = e.deltaMode === 1 || (e.deltaMode === 0 && !e.deltaX && Math.abs(d) >= 50 && Number.isInteger(d));
    if (notch) {
      const base = fan.anim?.user && fan.anim.k != null ? fan.anim.k : nearest(fan.angle);
      snapTo(base + Math.sign(d) * clamp(Math.round(Math.abs(d) / (e.deltaMode === 1 ? 3 : 100)), 1, 6), { user: true, dur: 260 });
      showCard(fan.k, "scrub");
      return;
    }
    cancelFanAnim();
    setFanMoving(true);
    const [lo, hi] = limits(), px = e.deltaMode === 2 ? d * fan.W : d;
    setAngle(clamp(fan.angle - (px / fan.R) * DEG, lo, hi));
    showCard(fan.k, "scrub");
    fan.wheelPending = true;
    fan.wheelT = setTimeout(() => { fan.wheelPending = false; snapTo(nearest(fan.angle), { user: true, dur: 240 }); }, 140);
  }, { passive: false });

  // Survol (souris) : la lame sort de 8 px, sa carte d'aperçu apparaît au-dessus de la pointe
  fanList.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || fan.ptr || fan.anim || link || !started) return;
    const b = e.target.closest(".blade");
    if (b) showTip(b);
  });
  fanList.addEventListener("pointerout", (e) => {
    if (fan.hov && !fan.hov.contains(e.relatedTarget)) hideTip();
  });

  // Clic / toucher sur une lame : l'éventail l'amène sous l'index et la voiture part tout de suite
  fanList.addEventListener("click", (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const b = e.target.closest(".blade");
    if (!b || !started) return;
    const i = +b.dataset.i;
    closeFloating();
    hideTip();
    if (i === dest()) centreFan(i);
    else goTo(i, D.paint);
  });

  // Clavier (← → ↑ ↓ Début Fin F : raccourcis globaux) ; un seul arrêt de tabulation, descendant actif
  fanList.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !started) return;
    const last = COLORS.length - 1;
    let ok = true;
    switch (e.key) {
      case "PageUp": goTo(clamp(dest() - 10, 0, last)); break;
      case "PageDown": goTo(clamp(dest() + 10, 0, last)); break;
      case "Enter": case " ": { const k = nearest(fan.angle); if (k !== dest()) goTo(k); break; }
      default: ok = false;
    }
    if (ok) { e.preventDefault(); e.stopPropagation(); }
  });

  // Étiquettes de famille : l'éventail tourne jusqu'à la première teinte de la famille
  fanFams.addEventListener("click", (e) => {
    const b = e.target.closest(".fan-fam[data-f]");
    if (!b || !started) return;
    closeFloating();
    hideTip();
    const i = famStart[b.dataset.f];
    if (i === dest()) centreFan(i);
    else goTo(i, D.paint);
  });
}

/* =====================================================================
   « Le Nuancier » : toutes les teintes en plein écran, recherche et favoris
   ===================================================================== */

const nuBody = $("nuBody"), qEl = $("q");
const nu = { fav: false, q: "", tiles: [], secs: {}, cur: null, active: null, qT: 0, n: -1 };
const finishOf = (c) => (metal(c) ? "Métallisé" : "Uni");
const tileLabel = (c) => `${c.name}, ${c.code}, ${famLabel(c.family)}, ${finishOf(c).toLowerCase()}${favs.has(c.code) ? ", favori" : ""}`;

function buildNuancier() {
  let html = "";
  FAMILIES.forEach(([k, label]) => {
    if (!famCount[k]) return;
    html += `<section class="nu-sec" data-f="${k}" aria-labelledby="nuh-${k}"><h3 id="nuh-${k}">${label}<small class="mono">${famCount[k]}</small></h3><div class="nu-grid">`;
    for (let i = famStart[k]; i < famStart[k] + famCount[k]; i++) {
      const c = COLORS[i];
      html += `<button class="nu-tile" type="button" id="nu-${esc(c.code)}" data-i="${i}" tabindex="-1" style="--c:${c.hex};--metal:${metal(c)}">` +
        `<span class="nu-thumb lq"><img src="${thumbUrl(c)}" alt="" width="640" height="256" loading="lazy" decoding="async"><span class="nu-fav">${HEART}</span></span>` +
        `<span class="nu-name"><i class="lq" aria-hidden="true"></i><b>${esc(c.name)}</b></span><span class="mono">${esc(c.code)}</span></button>`;
    }
    html += `</div></section>`;
  });
  html += `<div class="nu-empty" id="nuEmpty" hidden></div>`;
  nuBody.innerHTML = html;
  nu.tiles = [];
  nuBody.querySelectorAll(".nu-tile").forEach((t) => (nu.tiles[+t.dataset.i] = t));
  nu.secs = {};
  nuBody.querySelectorAll(".nu-sec").forEach((s) => (nu.secs[s.dataset.f] = s));
  COLORS.forEach((c) => updateTileFav(c.code));
}
// Recherche : nom, code, début d'hex, famille FR/EN (≥ 3 caractères)
function matcher(raw) {
  const q = norm(raw.trim());
  if (!q) return null;
  const famQ = new Set(q.length >= 3 ? FAMILIES.filter(([k, l, s]) =>
    norm(l).startsWith(q) || norm(s).startsWith(q) || k.startsWith(q) || (FAM_EN[k] ?? []).some((t) => t.startsWith(q))).map(([k]) => k) : []);
  const hq = q.replace(/^#/, "");
  return (c) => norm(c.name).includes(q) || norm(c.code).includes(q) || (hq.length >= 2 && c.hex.slice(1).toLowerCase().startsWith(hq)) || famQ.has(c.family);
}
const visibleTiles = () => nu.tiles.filter((t) => !t.hidden);

function nuFilter() {
  const m = matcher(nu.q), inFam = {};
  let n = 0;
  COLORS.forEach((c, i) => {
    const on = (!nu.fav || favs.has(c.code)) && (!m || m(c)), t = nu.tiles[i];
    if (t.hidden === on) t.hidden = !on;
    if (on) { n++; inFam[c.family] = (inFam[c.family] ?? 0) + 1; }
  });
  for (const f in nu.secs) {
    const s = nu.secs[f], k = inFam[f] ?? 0;
    s.hidden = !k;
    s.querySelector("small").textContent = String(k);
  }
  $("segAll")?.setAttribute("aria-pressed", String(!nu.fav));
  $("segFav")?.setAttribute("aria-pressed", String(nu.fav));
  if (n !== nu.n) { nu.n = n; const ct = $("nuCount"); if (ct) ct.textContent = plural(n, "teinte"); }
  const sh = $("shareSel"); if (sh) sh.hidden = !(nu.fav && favs.size > 0);
  const cs = $("cmpSel"); if (cs) cs.hidden = !(nu.fav && favs.size > 0);
  const em = $("nuEmpty");
  if (em) {
    em.hidden = n > 0;
    if (!n) {
      const q = nu.q.trim();
      em.innerHTML = q
        ? `<p>Aucune teinte pour “${esc(q)}”</p><small>Essayez un nom, un code (M5R) ou une famille (vert, blue)</small><button class="btn" type="button" data-act="clear">Effacer la recherche</button>`
        : `<p>Aucun favori — touchez ♥ sur une teinte</p><button class="btn" type="button" data-act="all">Voir les 152 teintes</button>`;
    } else em.textContent = "";
  }
  if (!nu.active || nu.active.hidden) {
    const cur = nu.tiles[dest()];
    setActive(cur && !cur.hidden ? cur : visibleTiles()[0] ?? null, false);
  }
}
// Tabulation itinérante : une seule tuile atteignable par Tab, les flèches déplacent le focus
function setActive(t, focus = true) {
  if (nu.active && nu.active !== t) nu.active.tabIndex = -1;
  nu.active = t;
  if (!t) return;
  t.tabIndex = 0;
  if (focus) { t.focus({ preventScroll: true }); t.scrollIntoView({ block: "nearest" }); }
}
function markNuCur(i) {
  const t = nu.tiles[i];
  if (!t || t === nu.cur) return;
  nu.cur?.classList.remove("is-cur");
  nu.cur?.removeAttribute("aria-current");
  t.classList.add("is-cur");
  t.setAttribute("aria-current", "true");
  nu.cur = t;
}
function updateTileFav(code) {
  const i = codeIndex.get(code.toUpperCase());
  if (i == null) return;
  const c = COLORS[i], t = nu.tiles[i], b = fan.blades[i];
  if (t) { t.classList.toggle("is-fav", favs.has(c.code)); t.setAttribute("aria-label", tileLabel(c)); }
  if (b) b.setAttribute("aria-label", bladeLabel(c));
}
// Ligne suivante / précédente de la grille (toutes familles confondues), tuile la plus proche en x
function verticalTile(t, vis, dir) {
  const r = t.getBoundingClientRect(), cx = r.left + r.width / 2;
  const rects = vis.map((v) => v.getBoundingClientRect());
  let row = null;
  for (const q of rects) {
    if (dir > 0 ? q.top > r.top + 4 && (row == null || q.top < row) : q.top < r.top - 4 && (row == null || q.top > row)) row = q.top;
  }
  if (row == null) return null;
  let best = null, bd = Infinity;
  rects.forEach((q, j) => {
    if (Math.abs(q.top - row) >= 4) return;
    const d = Math.abs(q.left + q.width / 2 - cx);
    if (d < bd) { bd = d; best = vis[j]; }
  });
  return best;
}

function openNuancier({ fav = false, focus = "tile", opener = document.activeElement } = {}) {
  if (!started) return;
  if (isOpen("nuPanel")) {
    if (nu.fav !== fav) { nu.fav = fav; nuFilter(); }
    if (focus === "search") qEl?.focus({ preventScroll: true });
    return;
  }
  closeFloating();
  hideTip();
  clearTimeout(nu.qT);
  nu.fav = fav; nu.q = "";
  if (qEl) qEl.value = "";
  nu.active = null;
  nuFilter();
  markNuCur(dest());
  nuBody.scrollTop = 0;
  openPanel("nuPanel", opener, () => (focus === "search" || !nu.active ? qEl : nu.active));
  nu.active?.scrollIntoView({ block: "center" });
}
function pickTile(i) {
  closePanels();
  if (i === dest()) centreFan(i);
  else goTo(i, D.paint);
}
function flushQuery() {
  clearTimeout(nu.qT);
  if (qEl && qEl.value !== nu.q) { nu.q = qEl.value; nuFilter(); }
}

function wireNuancier() {
  qEl?.addEventListener("input", () => {
    clearTimeout(nu.qT);
    nu.qT = setTimeout(() => { nu.q = qEl.value; nu.active = null; nuFilter(); nuBody.scrollTop = 0; }, 60);
  });
  qEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      flushQuery();
      const v = visibleTiles();
      if (v.length) pickTile(+(nu.q.trim() || !nu.active ? v[0] : nu.active).dataset.i);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      flushQuery();
      if (nu.active) setActive(nu.active);
    }
  });
  $("segAll")?.addEventListener("click", () => { if (nu.fav) { nu.fav = false; nu.active = null; nuFilter(); } });
  $("segFav")?.addEventListener("click", () => { if (!nu.fav) { nu.fav = true; nu.active = null; nuFilter(); } });
  nuBody.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act) {
      if (act.dataset.act === "clear") { if (qEl) qEl.value = ""; nu.q = ""; nuFilter(); qEl?.focus({ preventScroll: true }); }
      else if (act.dataset.act === "all") { nu.fav = false; nuFilter(); nu.active && setActive(nu.active); }
      return;
    }
    const t = e.target.closest(".nu-tile");
    if (t) pickTile(+t.dataset.i);
  });
  nuBody.addEventListener("focusin", (e) => { const t = e.target.closest?.(".nu-tile"); if (t && t !== nu.active) setActive(t, false); });
  nuBody.addEventListener("keydown", (e) => {
    const t = e.target.closest?.(".nu-tile");
    if (!t || e.metaKey || e.ctrlKey || e.altKey) return;
    const vis = visibleTiles(), at = vis.indexOf(t);
    let n;
    switch (e.key) {
      case "ArrowRight": n = vis[at + 1]; break;
      case "ArrowLeft": n = vis[at - 1]; break;
      case "ArrowDown": n = verticalTile(t, vis, 1); break;
      case "ArrowUp":
        n = verticalTile(t, vis, -1);
        if (!n) { e.preventDefault(); qEl?.focus({ preventScroll: true }); return; }
        break;
      case "Home": n = vis[0]; break;
      case "End": n = vis[vis.length - 1]; break;
      case "f": case "F": e.preventDefault(); if (!e.repeat) toggleFav(COLORS[+t.dataset.i].code); return;
      case "g": case "G": e.preventDefault(); closePanels(); return;
      case "/": e.preventDefault(); qEl?.focus({ preventScroll: true }); qEl?.select(); return;
      default: return;
    }
    e.preventDefault();
    if (n) setActive(n);
  });
}

/* ---------- Menu d'une lame (appui long, écrans tactiles) ---------- */

const lpMenu = $("lpMenu");
let lpFor = null;
function openLpMenu(el) {
  if (!lpMenu) return;
  const i = +el.dataset.i, c = COLORS[i];
  lpFor = i;
  const fav = favs.has(c.code);
  lpMenu.innerHTML =
    `<div class="lp-head"><i class="lq" style="--c:${c.hex};--metal:${metal(c)}"></i><span>${esc(c.name)}</span></div>` +
    `<button type="button" role="menuitem" data-a="fav">${HEART}<span>${fav ? "Retirer des favoris" : "Ajouter aux favoris"}</span></button>` +
    `<button type="button" role="menuitem" data-a="cmp"${i === idx ? " disabled" : ""}>${ICON_CMP}<span>Comparer avec la teinte affichée</span></button>` +
    `<button type="button" role="menuitem" data-a="copy">${ICON_COPY}<span>Copier le code ${esc(c.code)}</span></button>`;
  const t = bladeTip(i), w = 240;
  lpMenu.style.left = Math.round(clamp(t.x - w / 2, 8, innerWidth - w - 8)) + "px";
  lpMenu.style.top = "auto";
  lpMenu.style.bottom = Math.round(innerHeight - t.y + 16) + "px";
  lpMenu.style.width = w + "px";
  lpMenu.classList.add("open");
  lpMenu.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
}
function closeLpMenu(restore = false) {
  if (!lpMenu?.classList.contains("open")) return false;
  const had = lpMenu.contains(document.activeElement);
  lpMenu.classList.remove("open");
  lpFor = null;
  if (had || restore) fanList.focus({ preventScroll: true });
  return true;
}
function closeFloating() { closeLpMenu(); }
// Flèches dans un menu : focus d'un élément à l'autre
function menuKeys(e) {
  const items = [...e.currentTarget.querySelectorAll("button:not([disabled])")];
  const at = items.indexOf(document.activeElement);
  const n = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key];
  if (n == null || !items.length) return;
  e.preventDefault(); e.stopPropagation();
  items[(n + items.length) % items.length].focus({ preventScroll: true });
}
function wireLpMenu() {
  lpMenu?.addEventListener("keydown", menuKeys);
  lpMenu?.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b || b.disabled || lpFor == null) return;
    const i = lpFor, c = COLORS[i];
    closeLpMenu();
    if (b.dataset.a === "fav") toggleFav(c.code);
    else if (b.dataset.a === "cmp") openCompare([dest(), i], { opener: fanList });
    else if (b.dataset.a === "copy") toast((await copyText(c.code)) ? `Code ${c.code} copié` : "Copie impossible");
  });
  document.addEventListener("pointerdown", (e) => {
    if (lpMenu?.classList.contains("open") && !lpMenu.contains(e.target)) closeLpMenu();
  });
}
function fireLongPress(el) {
  if (!el.isConnected) return;
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(10);
  suppressClick = true;
  clearTimeout(suppressT); suppressT = setTimeout(() => (suppressClick = false), 800);
  openLpMenu(el);
}

/* ---------- Indice de geste ---------- */

let hinted = (() => { try { return localStorage.getItem("atelier-hinted") === "1"; } catch { return false; } })();
function setHintText() {
  const h = $("hint");
  if (h) h.textContent = coarse.matches ? "Glissez l'éventail" : "Faites tourner l'éventail · ← →";
}
// L'indice se pose au-dessus de l'index ; s'il toucherait l'étiquette ou les actions (téléphone),
// il devient une petite légende pleine posée sur l'éventail, près du bord bas
function placeHint(spec, ctrls) {
  const h = $("hint");
  if (!h || hinted || !spec) return;
  h.classList.remove("on-fan");
  const hr = h.getBoundingClientRect();
  const hit = (b) => b && hr.left < b.right && hr.right > b.left && hr.top < b.bottom + 8 && hr.bottom > b.top - 8;
  if (hit(spec.getBoundingClientRect()) || hit(ctrls?.getBoundingClientRect())) h.classList.add("on-fan");
}
function hideHint() {
  if (hinted) return;
  hinted = true;
  $("hint")?.classList.add("gone");
  try { localStorage.setItem("atelier-hinted", "1"); } catch {}
}
coarse.addEventListener?.("change", setHintText);

/* ---------- Toast ---------- */

let toastT = 0;
function toast(msg, { action = null, duration } = {}) {
  const t = $("toast");
  if (!t) return;
  const span = document.createElement("span");
  span.textContent = msg;
  t.replaceChildren(span);
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = action.label;
    b.addEventListener("click", () => { hideToast(); action.run(); });
    t.append(b);
  }
  t.inert = false;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(hideToast, duration ?? (action ? 5000 : 2200));
}
function hideToast() {
  clearTimeout(toastT);
  const t = $("toast");
  if (!t) return;
  t.classList.remove("show");
  t.inert = true;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

/* ---------- Favoris ---------- */

const favs = new Set((() => {
  try { const v = JSON.parse(localStorage.getItem("atelier-favs") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
})());
function saveFavs() { try { localStorage.setItem("atelier-favs", JSON.stringify([...favs])); } catch {} }
let pulseT = 0;
function pulseFav() {
  const b = $("fav");
  if (!b) return;
  b.classList.remove("fav-pulse");
  void b.offsetWidth;                                  // relance l'animation
  b.classList.add("fav-pulse");
  clearTimeout(pulseT);
  pulseT = setTimeout(() => b.classList.remove("fav-pulse"), 420);
}
function toggleFav(code = COLORS[idx].code) {
  const had = favs.has(code);
  if (had) favs.delete(code); else favs.add(code);
  saveFavs();
  updateFav();
  updateTileFav(code);
  // Nuancier filtré sur les favoris : une teinte retirée reste visible (cœur vide) jusqu'au prochain filtre
  if (!had) {
    if (code === COLORS[idx].code) pulseFav();
    toast(`Ajoutée aux favoris · ${favs.size}`, isOpen("nuPanel") ? {} : { action: { label: "Voir", run: showFavs } });
  } else toast("Retirée des favoris");
}
function showFavs() { openNuancier({ fav: true, opener: $("tFav") }); }
function offerSelection(list) {
  const codes = [...new Set(list.map((i) => COLORS[i].code))];
  if (!codes.length) return;
  const n = codes.length;
  toast(`Sélection partagée · ${plural(n, "teinte")}`, {
    duration: 9000,
    action: {
      label: "Ajouter",
      run: () => {
        let added = 0;
        codes.forEach((c) => { if (!favs.has(c)) { favs.add(c); added++; updateTileFav(c); } });
        saveFavs(); updateFav();
        if (isOpen("nuPanel")) nuFilter();
        toast(added ? `${added} ajoutée${added > 1 ? "s" : ""} aux favoris` : "Déjà dans vos favoris",
          { action: { label: "Voir", run: showFavs } });
      },
    },
  });
}
async function shareSelection() {
  if (!favs.size) return;
  const url = location.href.split("#")[0] + "#sel=" + [...favs].join(".");
  if (navigator.share) {
    try { await navigator.share({ title: "Ma sélection — Atelier 911", url }); return; }
    catch (e) { if (e?.name === "AbortError") return; }
  }
  toast((await copyText(url)) ? "Lien de la sélection copié" : "Copie impossible");
}

/* ---------- « Face à face » : 2 à 4 finalistes, trois modes, quatre décors, loupe synchronisée, repères ----------
   Une seule géométrie pour toutes les finalistes (même échelle, même cadre « voiture seule » 2,5:1).
   Décors autres que Studio : le rendu est découpé par le masque img/{taille}/_car.webp (carrosserie, roues,
   ombre de contact) et posé sur un fond neutre — la laque, elle, reste exactement celle du rendu.
   Images : chaque <img> ne garde que sa dernière demande (data-want), jamais une voiture périmée.
   Mesures : dans cxLayout() (ouverture, changement, redimensionnement), jamais pendant un geste. */

const CX_MODES = ["rideau", "cote", "duel"];
const CX_MODE_L = { rideau: "Rideau", cote: "Côte à côte", duel: "Duel" };
const CX_STUDIOS = ["studio", "gris", "jour", "nuit"];
const CX_STUDIO_L = { studio: "Studio", gris: "Gris neutre", jour: "Plein jour", nuit: "Nuit" };
const CX_GRAD = { gris: [[189, 189, 187], [154, 154, 152]], jour: [[242, 241, 237], [217, 215, 209]], nuit: [[13, 14, 16], [26, 27, 30]] };
const CX_MAX = 4, CX_MIN = 2;
// Cadre « voiture seule », en fractions du rendu : centré sur la silhouette (21,4 %–85,1 % × 43,6 %–56,4 %), 2,5:1
const CROP = { x: 0.1725, w: 0.72 };
CROP.h = (CROP.w * IMG_W) / 2.5 / IMG_H;
CROP.y = 0.5 - CROP.h / 2;
const phonePortrait = matchMedia("(max-width: 640px) and (orientation: portrait)");
const phoneLand = matchMedia("(max-height: 500px) and (orientation: landscape)");
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';

const cx = {
  list: [], mode: "cote", studio: "gris", studioSet: false, pair: [], split: 50, splitPx: 0, splitRun: 0,
  duel: null, gen: 0, W: 0, H: 0, cw: 0, pool: new Map(),
  pop: { open: false, items: [], active: -1 },
  loupe: { toggled: false, shift: false, touch: false, x: -1, y: -1, rects: [], lens: [], need: 0, done: 0, size: 220 },
};
const cxPanel = () => $("cmpPanel");
const cxView = () => $("cxView");
const cxColor = (i) => COLORS[i];
const nativeMax = () => Math.floor((3500 / (devicePixelRatio || 1)) * CROP.w);   // largeur « voiture » max sans agrandir le 3500

/* --- Couleur : CIE L*a*b* (D65) depuis la teinte de référence --- */
function lab([r, g, b]) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
// Repères : clarté (L*), saturation (chroma C*, 130 ≈ le bleu sRGB le plus vif), « au quotidien » (2 notes max)
function marks(c) {
  const [L, a, b] = lab(rgbOf(c.hex));
  const notes = [];
  if (L < 30) notes.push("Montre les micro-rayures et la poussière");
  else if (L > 75) notes.push("Cache la poussière, montre les projections");
  if (metal(c)) notes.push("Le métallisé masque les petites imperfections");
  if (!notes.length) notes.push("Polyvalente au quotidien");
  return { clar: Math.round(clamp(L, 0, 100)), sat: Math.round(clamp((Math.hypot(a, b) / 130) * 100, 0, 100)), notes: notes.slice(0, 2) };
}
const famOne = (k) => FAMILIES.find((f) => f[0] === k)?.[2] ?? "";
const nameHTML = (name) => { const [a, b] = splitName(name); return esc(a) + (b ? ` <em>${esc(b)}</em>` : ""); };

/* --- Images : rendu + masque « voiture seule », course gagnée par la dernière demande --- */
const cxSize = (wi, min = 2000) => SIZES.find((s) => s >= Math.max(min, wi * (devicePixelRatio || 1))) ?? SIZES[SIZES.length - 1];
function cxImg(el, c, size, masked) {
  const url = `img/${size}/${c.code}.webp`, mk = masked ? `img/${size}/_car.webp` : "";
  const want = url + "|" + mk;
  el.dataset.want = want;
  const box = el.closest(".cx-car");
  if (el.dataset.have === want) { el.style.visibility = ""; box?.classList.remove("noimg"); return Promise.resolve(true); }
  if (el.dataset.code !== c.code) el.style.visibility = "hidden";          // jamais la voiture d'une autre teinte
  return (async () => {
    const [got, m] = await Promise.all([loadAny(c.code, url), mk ? load(mk) : Promise.resolve(true)]);
    if (el.dataset.want !== want) return false;
    if (!got) {
      el.removeAttribute("src"); el.dataset.have = ""; el.dataset.code = "";
      el.style.visibility = "hidden";
      box?.classList.add("noimg");
      return false;
    }
    const mask = mk && m ? `url("${mk}")` : "none";
    el.style.webkitMaskImage = mask; el.style.maskImage = mask;
    if (el.getAttribute("src") !== got) el.src = got;
    el.dataset.code = c.code;
    await decoded(el);
    if (el.dataset.want !== want) return false;
    el.dataset.have = got === url && (!mk || m) ? want : "";
    el.style.visibility = "";
    box?.classList.remove("noimg");
    sampleBg(el, c.code);
    const bg = bgCache.get(c.code);
    if (bg) el.closest(".cx-cell, .cx-rs, .cx-verdict")?.style.setProperty("--sbg", rgbCss(bg));
    return true;
  })();
}
function cxPoolImg(code) {
  let im = cx.pool.get(code);
  if (!im) {
    im = new Image();
    im.alt = ""; im.decoding = "async"; im.draggable = false;
    im.style.visibility = "hidden";
    cx.pool.set(code, im);
    if (cx.pool.size > 12) cx.pool.delete(cx.pool.keys().next().value);
  }
  return im;
}

/* --- Finalistes --- */
function defaultFinalists(i = dest()) {
  const f = [...favs].map((code) => codeIndex.get(code.toUpperCase())).filter((j) => j != null && j !== i);
  return f.length ? [i, ...f].slice(0, CX_MAX) : [i, (i + 1) % COLORS.length];
}
function favFinalists() {
  const f = [...favs].map((code) => codeIndex.get(code.toUpperCase())).filter((j) => j != null).slice(0, CX_MAX);
  return f.length ? f : [dest()];
}
function cxNormalise(list) {
  const out = [...new Set(list.filter((i) => i != null && COLORS[i]))].slice(0, CX_MAX);
  if (!out.length) out.push(dest());
  for (let j = (out[out.length - 1] + 1) % COLORS.length; out.length < CX_MIN; j = (j + 1) % COLORS.length) if (!out.includes(j)) out.push(j);
  return out;
}
const defaultStudio = (mode) => (mode === "rideau" ? "studio" : "gris");

function cxHash() {
  if (!isOpen("cmpPanel")) return;
  writeHash(`#cmp=${cx.list.map((i) => COLORS[i].code).join(",")}&m=${cx.mode}&s=${cx.studio}`);
}
function cxSay(msg) { const l = $("cxLive"); if (l) { l.textContent = ""; l.textContent = msg; } }

function cxAdd(i) {
  if (cx.list.length >= CX_MAX || cx.list.includes(i)) return false;
  cx.list.push(i);
  cxChanged(`${COLORS[i].name} ajoutée aux finalistes`);
  return true;
}
function cxRemove(i) {
  if (cx.list.length <= CX_MIN) return false;
  const k = cx.list.indexOf(i);
  if (k < 0) return false;
  cx.list.splice(k, 1);
  cxChanged(`${COLORS[i].name} retirée`);
  return true;
}
function cxMove(i, d) {
  const k = cx.list.indexOf(i), j = k + d;
  if (k < 0 || j < 0 || j >= cx.list.length) return false;
  [cx.list[k], cx.list[j]] = [cx.list[j], cx.list[k]];
  cxChanged(`${COLORS[i].name} en position ${j + 1} sur ${cx.list.length}`);
  return true;
}
// Liste modifiée : la paire du rideau reste valide, le duel repart de zéro
function cxChanged(msg) {
  cx.pair = cx.pair.filter((i) => cx.list.includes(i));
  for (const i of cx.list) if (cx.pair.length < 2 && !cx.pair.includes(i)) cx.pair.push(i);
  if (cx.duel) cx.duel = null;
  cxRender();
  if (msg) cxSay(msg);
}

/* --- Rendu --- */
function cxRender() {
  const panel = cxPanel();
  if (!panel) return;
  cx.gen++;
  cxLoupeOff(true);
  if (!cx.pair.length || cx.pair.some((i) => !cx.list.includes(i))) cx.pair = cx.list.slice(0, 2);
  if (cx.mode === "duel" && !cx.duel) cxDuelStart();
  const verdict = cx.mode === "duel" && cx.duel?.winner != null;
  panel.dataset.mode = verdict ? "verdict" : cx.mode;
  panel.dataset.studio = cx.studio;
  panel.querySelectorAll("[data-m]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === cx.mode)));
  panel.querySelectorAll("[data-s]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.s === cx.studio)));
  const lb = $("cxLoupe");
  if (lb) { lb.disabled = !cxLoupeOk(); lb.setAttribute("aria-pressed", String(cx.loupe.toggled && cxLoupeOk())); }
  const cap = $("cxCap"); if (cap) cap.hidden = cx.studio === "studio";
  cxStrip();
  const v = cxView();
  if (cx.mode === "rideau") cxRideau(v);
  else if (verdict) cxVerdict(v);
  else cxCells(v);
  cxLayout();
  if (cx.loupe.toggled && cxLoupeOk()) cxLoupeUpdate();
  cxHash();
}
const cxLoupeOk = () => (cx.mode === "cote" || (cx.mode === "duel" && cx.duel?.winner == null));

function cxStrip() {
  const ol = $("cxStrip");
  if (!ol) return;
  const n = cx.list.length, out = new Set(cx.duel?.out ?? []);
  ol.innerHTML = cx.list.map((i, k) => {
    const c = COLORS[i];
    return `<li class="cx-fin${out.has(i) ? " out" : ""}${cx.mode === "rideau" && cx.pair.includes(i) ? " in-pair" : ""}" data-i="${i}" style="--c:${c.hex};--metal:${metal(c)}">` +
      `<button class="cx-fin-b" type="button" data-i="${i}" aria-roledescription="finaliste" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight" ` +
      `aria-label="${esc(c.name)}, ${c.code}, finaliste ${k + 1} sur ${n}${out.has(i) ? ", écartée" : ""}. Alt et flèches pour déplacer.">` +
      `<span class="cx-n mono">${String(k + 1).padStart(2, "0")}</span><i class="bead"></i>` +
      `<span class="cx-fin-t"><b>${esc(heroName(c.name))}</b><span class="mono">${c.code}</span></span></button>` +
      `<button class="cx-x" type="button" data-x="${i}" aria-label="Retirer ${esc(c.name)}"${n <= CX_MIN ? " disabled" : ""}>${ICON_X}</button></li>`;
  }).join("") +
    (n < CX_MAX ? `<li class="cx-addw"><button class="cx-add" id="cxAdd" type="button" aria-haspopup="dialog" aria-expanded="${cx.pop.open}" aria-controls="cxPop">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Ajouter</span><span class="mono">${n}/${CX_MAX}</span></button></li>` : "");
}

function cellHTML(i, k, best, extra = "") {
  const c = COLORS[i], m = marks(c);
  const up = (on) => (on ? ' <b class="cx-up" aria-label="le plus élevé">▲</b>' : "");
  return `<div class="cx-cell" data-i="${i}" data-k="${k}" style="--c:${c.hex};--metal:${metal(c)}"${extra}>` +
    `<div class="cx-car"><div class="cx-crop"><span class="cx-shadow"></span></div><span class="cx-flat mono">${esc(NOIMG_MSG)}</span></div>` +
    `<div class="cx-meta">` +
      `<p class="cx-id"><i class="bead"></i><span class="cx-nm">${nameHTML(c.name)}</span><span class="mono">${c.code}</span></p>` +
      `<dl class="cx-rep">` +
        `<div><dt>Famille · Finition</dt><dd>${esc(famOne(c.family))} · ${finishOf(c)}</dd></div>` +
        `<div><dt>Clarté</dt><dd><span class="cx-meter"><i style="width:${m.clar}px"></i></span><span class="mono">${m.clar}${up(best.clar === i)}</span></dd></div>` +
        `<div><dt>Saturation</dt><dd><span class="cx-meter"><i style="width:${m.sat}px"></i></span><span class="mono">${m.sat}${up(best.sat === i)}</span></dd></div>` +
        `<div class="cx-q"><dt>Au quotidien <small>indicatif</small></dt><dd>${m.notes.map(esc).join("<br>")}</dd></div>` +
      `</dl></div></div>`;
}
// ▲ : la plus claire / la plus saturée (aucune en cas d'égalité parfaite)
function cxBest(list) {
  const best = {};
  for (const key of ["clar", "sat"]) {
    const vals = list.map((i) => marks(COLORS[i])[key]), max = Math.max(...vals);
    if (vals.filter((v) => v === max).length === 1 && vals.some((v) => v !== max)) best[key] = list[vals.indexOf(max)];
  }
  return best;
}
function cxFillCell(cell) {
  const i = +cell.dataset.i, crop = cell.querySelector(".cx-crop");
  const im = cxPoolImg(COLORS[i].code);
  crop.append(im);
}
function cxCells(v) {
  const duel = cx.mode === "duel" ? cx.duel : null;
  const shown = duel ? [duel.left, duel.right] : cx.list;
  const best = cxBest(shown);
  const pick = (i, side) => ` role="button" tabindex="0" data-side="${side}" aria-label="Garder ${esc(COLORS[i].name)}"`;
  v.innerHTML = (duel ? `<div class="cx-duel-h"><span class="mono">Duel ${duel.k} / ${duel.total}</span>` +
      `<p>Choisissez<span>, on élimine</span></p><span class="mono cx-hint">${coarse.matches ? "Touchez ou balayez" : "Cliquez ou ← →"}</span></div>` : "") +
    `<div class="cx-grid${duel ? " duel" : ""}" style="--n:${shown.length}">` +
    shown.map((i, k) => cellHTML(i, k, best, duel ? pick(i, k ? "right" : "left") : "")).join("") + `</div>`;
  v.querySelectorAll(".cx-cell").forEach(cxFillCell);
}

function cxRideau(v) {
  const [a, b] = cx.pair.map(cxColor);
  const lab = (c, s) => `<div class="cx-rlab ${s}"><span class="mono">${s.toUpperCase()} · ${c.code}</span><b>${nameHTML(c.name)}</b></div>`;
  const side = (c, s) => `<div class="cx-rs ${s}" style="--c:${c.hex}"><div class="cx-car"><div class="cx-crop"><span class="cx-shadow"></span>` +
    `<img alt="" decoding="async" draggable="false" style="visibility:hidden"></div><span class="cx-flat mono">${esc(NOIMG_MSG)}</span></div></div>`;
  const chips = cx.list.length > 2 ? `<div class="cx-pair" role="group" aria-label="Teintes du rideau">` + cx.list.map((i) => {
    const c = COLORS[i], on = cx.pair.includes(i);
    return `<button type="button" class="cx-pc" data-p="${i}" aria-pressed="${on}" style="--c:${c.hex};--metal:${metal(c)}"><i class="bead"></i>${esc(heroName(c.name))}</button>`;
  }).join("") + `</div>` : "";
  v.innerHTML = `<div class="cx-rideau" id="cxRideau">${side(a, "a")}${side(b, "b")}` +
    `<div class="cx-handle" id="cxHandle" role="slider" tabindex="0" aria-label="Rideau entre ${esc(a.name)} et ${esc(b.name)}" ` +
    `aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(cx.split)}" style="--a:${a.hex};--b:${b.hex}"><span class="cx-knob"></span></div>` +
    lab(a, "a") + lab(b, "b") + chips + `</div>`;
}

function cxVerdict(v) {
  const d = cx.duel, c = COLORS[d.winner], [n1, n2] = splitName(c.name);
  const out = d.out.map((i) => esc(heroName(COLORS[i].name)));
  v.innerHTML = `<div class="cx-verdict" style="--c:${c.hex};--metal:${metal(c)}">` +
    `<div class="cx-car big"><div class="cx-crop"><span class="cx-shadow"></span><img alt="Porsche 911 en ${esc(c.name)}" decoding="async" draggable="false" style="visibility:hidden"></div>` +
    `<span class="cx-flat mono">${esc(NOIMG_MSG)}</span></div>` +
    `<div class="cx-vtxt"><p class="mono">Votre teinte · ${c.code}</p>` +
    `<h3 id="cxWin">${esc(n1)}${n2 ? ` <em>${esc(n2)}</em>` : ""}</h3>` +
    `<p class="cx-vsub">${esc(famOne(c.family))} · ${finishOf(c)}${out.length ? `<span> — devant ${out.join(", ")}</span>` : ""}</p>` +
    `<div class="cx-vbtns"><button class="btn cx-pri" id="cxShow" type="button">L'afficher dans le showroom</button>` +
    `<button class="btn" id="cxAgain" type="button">Recommencer le duel</button>` +
    `<button class="btn" id="cxShare" type="button">${ICON_COPY}<span>Partager</span></button></div></div></div>`;
}

/* --- Géométrie (mesurée ici seulement) --- */
function cxPlace(el, cw) {
  const wi = cxImgW(cw), hi = Math.round((wi * IMG_H) / IMG_W);
  el.style.setProperty("--cw", cw + "px");
  el.style.setProperty("--ch", Math.round(cw / 2.5) + "px");
  el.style.setProperty("--wi", wi + "px");
  el.style.setProperty("--hi", hi + "px");
  el.style.setProperty("--ix", -Math.round(CROP.x * wi) + "px");
  el.style.setProperty("--iy", -Math.round(CROP.y * hi) + "px");
  return wi;
}
const cxImgW = (cw) => Math.round(cw / CROP.w);
function snapPx(el) {
  el.style.translate = "";
  const r = el.getBoundingClientRect();
  const dx = Math.round(r.left) - r.left, dy = Math.round(r.top) - r.top;
  if (dx || dy) el.style.translate = `${dx.toFixed(3)}px ${dy.toFixed(3)}px`;
}
function cxLayout() {
  const v = cxView(), panel = cxPanel();
  if (!v || !panel?.classList.contains("open")) return;
  const cs = getComputedStyle(v);
  const W = Math.floor(v.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  const H = Math.floor(v.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  cx.W = W; cx.H = H;
  const masked = cx.studio !== "studio", pp = phonePortrait.matches, pl = phoneLand.matches;
  const verdict = panel.dataset.mode === "verdict";
  if (cx.mode === "rideau") {
    const rd = $("cxRideau");
    if (!rd) return;
    const vert = pp;
    const cw = Math.max(120, Math.floor(Math.min(W * (vert ? 1 : 0.92), H * 0.9 * 2.5, nativeMax())));
    const ch = Math.round(cw / 2.5);
    const wi = cxPlace(rd, cw);
    const ct = Math.round((H - ch) / 2 - (vert ? 0 : H * 0.04));
    rd.style.setProperty("--cl", Math.round((W - cw) / 2) + "px");
    rd.style.setProperty("--ct", ct + "px");
    rd.style.setProperty("--kt", ct + Math.round(ch / 2) - 18 + "px");       // bouton du rideau : à hauteur de voiture
    rd.style.setProperty("--kl", Math.round(W / 2) - 18 + "px");
    rd.classList.toggle("vert", vert);
    cx.vert = vert;
    cxSplit(cx.split);
    const size = cxSize(wi);
    rd.querySelectorAll(".cx-rs").forEach((s, k) => cxImg(s.querySelector("img"), COLORS[cx.pair[k]], size, masked));
    return;
  }
  if (verdict) {
    const vd = v.querySelector(".cx-verdict");
    if (!vd) return;
    const side = pl || (W > H * 2.6 && W >= 900);
    vd.classList.toggle("side", side);
    const vs = getComputedStyle(vd);
    const VW = W - parseFloat(vs.paddingLeft) - parseFloat(vs.paddingRight), VH = H - parseFloat(vs.paddingTop) - parseFloat(vs.paddingBottom);
    const T = side ? 0 : vd.querySelector(".cx-vtxt").offsetHeight + 24;
    const cw = Math.max(160, Math.floor(Math.min(side ? VW * 0.56 : VW, (VH - T) * 2.5, nativeMax(), 1200)));
    const wi = cxPlace(vd, cw);
    cxImg(vd.querySelector("img"), COLORS[cx.duel.winner], cxSize(wi), masked);
    vd.querySelectorAll(".cx-car, .cx-vtxt").forEach(snapPx);       // centrage flex → calé sur le pixel
    return;
  }
  const grid = v.querySelector(".cx-grid");
  if (!grid) return;
  const cells = [...grid.children], n = cells.length;
  const head = v.querySelector(".cx-duel-h");
  const gx = pp ? 0 : pl ? 16 : 32, gy = pp ? (head ? 20 : 32) : 28;
  const extra = head ? head.offsetHeight + gy : 0;
  const meta = grid.querySelector(".cx-meta");
  const R = meta ? meta.offsetHeight : 0;
  const MW = 280, MG = 24;                            // 2 × 2 « côte » : repères à droite de la voiture
  const rowH = (rows) => (H - extra - (rows - 1) * gy) / rows;
  const fit = (cols) => {
    let cw = (W - (cols - 1) * gx) / cols;
    if (!pp) cw = Math.min(cw, (rowH(Math.ceil(n / cols)) - (pl ? 0 : R)) * 2.5);
    return Math.floor(cw);
  };
  const GS = 72;                                       // 2 × 2 « côte » : colonnes nettement séparées
  const fitSide = (cols) => (rowH(Math.ceil(n / cols)) < R ? 0 : Math.floor(Math.min((W - (cols - 1) * GS) / cols - MG - MW, rowH(Math.ceil(n / cols)) * 2.5)));
  let cols = pp ? 1 : n, side = false;
  if (!pp && !pl && n === 4) {                          // 2 × 2 si la place le permet, sinon une rangée de 4
    const under = fit(2), beside = fitSide(2), row = fit(4);
    if (Math.max(under, beside) >= row * 0.9) { cols = 2; side = beside > under; }
  }
  const cw = Math.max(pp ? Math.min(W, 140) : 140, Math.min(side ? fitSide(cols) : fit(cols), nativeMax(), pp ? W : 720));
  grid.classList.toggle("side", side);
  grid.style.setProperty("--colw", (side ? cw + MG + MW : cw) + "px");
  grid.style.setProperty("--cols", String(cols));
  const gxx = side ? GS : gx;
  grid.style.setProperty("--gx", gxx + "px");
  grid.style.setProperty("--gy", gy + "px");
  const wi = cxPlace(grid, cw);
  cx.cw = cw;
  // Centrage en px entiers (une marge automatique laisserait des demi-pixels)
  const gw = cols * (side ? cw + MG + MW : cw) + (cols - 1) * gxx;
  const ml = Math.max(0, Math.floor((W - gw) / 2));
  grid.style.margin = `0 0 0 ${ml}px`;
  const mt = Math.max(0, Math.floor((H - extra - grid.offsetHeight) / 2));
  if (head) { head.style.margin = `${mt}px 0 ${gy}px ${ml}px`; head.style.width = gw + "px"; }
  else grid.style.marginTop = mt + "px";
  const size = cxSize(wi);
  cells.forEach((cell) => {
    const im = cell.querySelector("img");
    if (im) cxImg(im, COLORS[+cell.dataset.i], size, masked);
  });
}

/* --- Rideau --- */
function cxSplit(pct) {
  cx.split = clamp(pct, 0, 100);
  const rd = $("cxRideau");
  if (!rd) return;
  const len = cx.vert ? cx.H : cx.W;
  const px = Math.round((len * cx.split) / 100);
  cx.splitPx = px;
  rd.style.setProperty("--sp", px + "px");
  const h = $("cxHandle");
  if (h) {
    h.setAttribute("aria-valuenow", String(Math.round(cx.split)));
    const [a, b] = cx.pair.map(cxColor);
    h.setAttribute("aria-valuetext", `${Math.round(cx.split)} % ${a.name}, ${100 - Math.round(cx.split)} % ${b.name}`);
  }
}
function cxSplitTo(pct) {
  const run = ++cx.splitRun, from = cx.split, to = clamp(pct, 0, 100);
  if (reduced.matches || document.hidden) return cxSplit(to);
  const t0 = performance.now(), dur = 420;
  const step = (t) => {
    if (run !== cx.splitRun) return;
    const k = clamp((t - t0) / dur, 0, 1);
    cxSplit(from + (to - from) * EASE.out(k));
    if (k < 1) frame(step);
  };
  frame(step);
}

/* --- Duel : la gagnante reste, la suivante entre --- */
function cxDuelStart() {
  const L = cx.list;
  cx.duel = { left: L[0], right: L[1], next: 2, k: 1, total: L.length - 1, out: [], winner: null, busy: false };
}
function play(el, kf, opt) {
  if (!el?.animate || reduced.matches) return Promise.resolve();
  const a = el.animate(kf, opt);
  return Promise.race([a.finished.catch(() => {}), sleep((opt.duration ?? 0) + (opt.delay ?? 0) + 80)]).then(() => {
    try { a.finish(); } catch {}
    a.cancel();
  });
}
async function cxPick(side) {
  const d = cx.duel;
  if (!d || d.busy || d.winner != null || cx.mode !== "duel") return;
  d.busy = true;
  const gen = cx.gen;
  const win = side === "left" ? d.left : d.right, lose = side === "left" ? d.right : d.left;
  const grid = cxView()?.querySelector(".cx-grid");
  const cells = grid ? [...grid.children] : [];
  const wEl = cells.find((c) => +c.dataset.i === win), lEl = cells.find((c) => +c.dataset.i === lose);
  const vert = phonePortrait.matches, dir = side === "left" ? 1 : -1;
  cxLoupeOff(true);
  wEl?.classList.add("won");
  await play(lEl, [{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: vert ? `0 ${dir * 40}px` : `${dir * 56}px 0` }],
    { duration: 280, easing: "cubic-bezier(.55,0,1,.45)", fill: "forwards" });
  if (gen !== cx.gen || cx.duel !== d) return;
  d.out.push(lose);
  if (d.next >= cx.list.length) {
    d.winner = win; d.busy = false;
    cxRender();
    cxSay(`Votre teinte : ${COLORS[win].name}`);
    $("cxShow")?.focus({ preventScroll: true });
    return;
  }
  const first = wEl?.getBoundingClientRect();
  d.left = win; d.right = cx.list[d.next++]; d.k++;
  // La gagnante glisse vers la place de gauche (FLIP en translation), la nouvelle entre à droite
  const best = cxBest([d.left, d.right]);
  const head = cxView().querySelector(".cx-duel-h .mono");
  if (head) head.textContent = `Duel ${d.k} / ${d.total}`;
  const nEl = document.createElement("div");
  nEl.innerHTML = cellHTML(d.right, 1, best, ` role="button" tabindex="0" data-side="right" aria-label="Garder ${esc(COLORS[d.right].name)}"`);
  const fresh = nEl.firstElementChild;
  const wNew = document.createElement("div");
  wNew.innerHTML = cellHTML(d.left, 0, best, ` role="button" tabindex="0" data-side="left" aria-label="Garder ${esc(COLORS[d.left].name)}"`);
  const wCell = wNew.firstElementChild;
  grid.replaceChildren(wCell, fresh);
  cxFillCell(wCell); cxFillCell(fresh);
  cxLayout();
  cxStrip();
  if (cx.loupe.toggled) cxLoupeUpdate();
  cxSay(`Duel ${d.k} sur ${d.total} : ${COLORS[d.left].name} contre ${COLORS[d.right].name}`);
  const last = wCell.getBoundingClientRect();
  const dx = first ? Math.round(first.left - last.left) : 0, dy = first ? Math.round(first.top - last.top) : 0;
  const focusWas = document.activeElement?.closest?.(".cx-cell");
  if (focusWas || document.activeElement === document.body) wCell.focus({ preventScroll: true });
  await Promise.all([
    (dx || dy) ? play(wCell, [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 380, easing: "cubic-bezier(.22,1,.36,1)" }) : null,
    play(fresh, [{ opacity: 0, translate: vert ? "0 32px" : "48px 0" }, { opacity: 1, translate: "0 0" }], { duration: 360, delay: 90, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" }),
  ]);
  if (cx.duel === d) d.busy = false;
}
function cxShowWinner() {
  const i = cx.duel?.winner;
  if (i == null) return;
  const code = COLORS[i].code;
  closePanels();
  if (!favs.has(code)) toggleFav(code);
  if (i === dest()) centreFan(i);
  else goTo(i, D.paint);
}
async function cxShare() {
  const d = cx.duel, codes = d?.winner != null ? [d.winner, ...cx.list.filter((i) => i !== d.winner)] : cx.list;
  const url = location.href.split("#")[0] + `#cmp=${codes.map((i) => COLORS[i].code).join(",")}&m=cote&s=${cx.studio}`;
  toast((await copyText(url)) ? "Lien du face à face copié" : "Copie impossible");
}

/* --- Loupe synchronisée (rendus 3500, ≥ 1 px image par px physique) --- */
const cxLoupeOn = () => cxLoupeOk() && (cx.loupe.toggled || cx.loupe.shift || cx.loupe.touch);
function cxLoupeUpdate() {
  const L = cx.loupe, panel = cxPanel();
  const on = cxLoupeOn();
  panel?.classList.toggle("loupe", on);
  panel?.classList.toggle("loupe-t", cx.loupe.toggled && cxLoupeOk());
  $("cxLoupe")?.setAttribute("aria-pressed", String(L.toggled && cxLoupeOk()));
  if (!on) { L.lens.forEach((x) => x.el.remove()); L.lens = []; return; }
  if (!L.lens.length) cxLoupeBuild();
  cxLoupeMove(L.x, L.y);
}
function cxLoupeOff(all = false) {
  const L = cx.loupe;
  L.shift = false; L.touch = false;
  if (all && !cxLoupeOk()) L.toggled = false;
  L.lens.forEach((x) => x.el.remove()); L.lens = [];
  cxPanel()?.classList.remove("loupe");
  if (all) cxPanel()?.classList.toggle("loupe-t", L.toggled && cxLoupeOk());
}
function cxLoupeRects() {
  cx.loupe.rects = [...(cxView()?.querySelectorAll(".cx-cell .cx-car") ?? [])].map((car) => ({ car, r: car.getBoundingClientRect() }));
}
function cxLoupeBuild() {
  const L = cx.loupe, masked = cx.studio !== "studio";
  L.size = phonePortrait.matches || phoneLand.matches ? 150 : 220;
  cxLoupeRects();
  const dpr = devicePixelRatio || 1;
  L.lw = Math.max(cxImgW(cx.cw), Math.min(Math.floor(3500 / dpr), Math.round(cxImgW(cx.cw) * 3.5)));   // ≈ ×3,5, jamais au-delà du 3500 natif
  L.lh = Math.round((L.lw * IMG_H) / IMG_W);
  const prog = $("cxProg");
  L.need = L.rects.length; L.done = 0;
  const gen = cx.gen;
  L.lens = L.rects.map(({ car }) => {
    const cell = car.closest(".cx-cell"), c = COLORS[+cell.dataset.i];
    const el = document.createElement("div");
    el.className = "cx-lens";
    el.style.setProperty("--ls", L.size + "px");
    el.innerHTML = `<span class="cx-lw"><img alt="" decoding="async" draggable="false" style="visibility:hidden;width:${L.lw}px;height:${L.lh}px"></span><span class="cx-ln mono">${esc(heroName(c.name))}</span>`;
    el.querySelector(".cx-lw").style.background = masked ? "var(--lbg)" : (bgCache.get(c.code) ? rgbCss(bgCache.get(c.code)) : "var(--c)");
    cell.append(el);
    const img = el.querySelector("img");
    cxImg(img, c, 3500, masked).then(() => {
      if (gen !== cx.gen) return;
      L.done++;
      cxProgress();
    });
    return { el, img, car };
  });
  cxProgress();
  if (prog) prog.hidden = L.done >= L.need;
}
function cxProgress() {
  const L = cx.loupe, prog = $("cxProg");
  if (!prog) return;
  const left = L.need && L.done < L.need && cxLoupeOn();
  prog.hidden = !left;
  prog.firstElementChild?.style.setProperty("width", `${Math.round(((L.done + 0.15) / Math.max(1, L.need)) * 100)}%`);
}
function cxLoupeMove(x, y) {
  const L = cx.loupe;
  if (!L.lens.length) return;
  let hit = L.rects.find(({ r }) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  if (!hit && x < 0) hit = L.rects[0] && { r: L.rects[0].r, centre: true };   // clavier : loupe au centre
  L.lens.forEach((ln) => ln.el.classList.toggle("on", !!hit));
  if (!hit) return;
  const r = hit.r;
  const u = hit.centre ? 0.5 : clamp((x - r.left) / (r.width || 1), 0, 1), v = hit.centre ? 0.5 : clamp((y - r.top) / (r.height || 1), 0, 1);
  const g = CX_GRAD[cx.studio];
  if (g) {
    const lerp = (k) => Math.round(g[0][k] + (g[1][k] - g[0][k]) * v);
    cxView()?.style.setProperty("--lbg", `rgb(${lerp(0)} ${lerp(1)} ${lerp(2)})`);
  }
  const R = L.size / 2, fx = CROP.x + u * CROP.w, fy = CROP.y + v * CROP.h;
  const cw = cx.cw, ch = Math.round(cw / 2.5);
  const lx = Math.round(u * cw - R), ly = Math.round(v * ch - R);
  const ix = Math.round(R - fx * L.lw), iy = Math.round(R - fy * L.lh);
  L.lens.forEach((ln) => {
    ln.el.style.translate = `${lx}px ${ly}px`;
    ln.img.style.translate = `${ix}px ${iy}px`;
  });
}

/* --- Sélecteur de teinte (popover, sans <select>) --- */
function cxPopOpen() {
  const pop = $("cxPop"), add = $("cxAdd");
  if (!pop || !add || cx.list.length >= CX_MAX) return;
  cx.pop.open = true;
  pop.hidden = false;
  add.setAttribute("aria-expanded", "true");
  const q = $("cxQ");
  q.value = "";
  cxPopFill("");
  if (!phonePortrait.matches) {
    const r = add.getBoundingClientRect(), pw = Math.min(380, innerWidth - 32);
    pop.style.left = Math.round(clamp(r.left, 16, innerWidth - pw - 16)) + "px";
    pop.style.bottom = Math.round(innerHeight - r.top + 8) + "px";
    pop.style.maxHeight = Math.min(480, Math.max(200, Math.round(r.top - 96))) + "px";
    pop.style.width = pw + "px";
  } else { pop.removeAttribute("style"); pop.style.maxHeight = Math.round(innerHeight * 0.72) + "px"; }
  q.focus({ preventScroll: true });
}
function cxPopClose(refocus = true) {
  const pop = $("cxPop");
  if (!pop || !cx.pop.open) return false;
  cx.pop.open = false;
  pop.hidden = true;
  const add = $("cxAdd");
  add?.setAttribute("aria-expanded", "false");
  if (refocus) (add ?? cxPanel()?.querySelector(".cx-fin-b"))?.focus({ preventScroll: true });
  return true;
}
function cxPopFill(q) {
  const list = $("cxList"), m = matcher(q);
  if (!list) return;
  const taken = new Set(cx.list);
  const opt = (c, pre) => `<div class="cx-opt" role="option" id="cxo-${pre}${c.code}" data-i="${c.i}" aria-disabled="${taken.has(c.i)}" aria-selected="false" style="--c:${c.hex};--metal:${metal(c)}">` +
    `<i class="bead"></i><span>${esc(c.name)}</span><span class="mono">${taken.has(c.i) ? "déjà là" : c.code}</span></div>`;
  let html = "";
  const fl = [...favs].map((code) => COLORS[codeIndex.get(code.toUpperCase())]).filter((c) => c && (!m || m(c)));
  if (fl.length) html += `<div role="group" aria-labelledby="cxg-f"><p class="cx-gh mono" id="cxg-f">Vos favoris</p>${fl.map((c) => opt(c, "f-")).join("")}</div>`;
  for (const [k, lbl] of FAMILIES) {
    const l = COLORS.filter((c) => c.family === k && (!m || m(c)));
    if (l.length) html += `<div role="group" aria-labelledby="cxg-${k}"><p class="cx-gh mono" id="cxg-${k}">${esc(lbl)}</p>${l.map((c) => opt(c, "")).join("")}</div>`;
  }
  list.innerHTML = html || `<p class="cx-none">Aucune teinte pour « ${esc(q.trim())} »</p>`;
  cx.pop.items = [...list.querySelectorAll('.cx-opt[aria-disabled="false"]')];
  cxPopActive(cx.pop.items.length ? 0 : -1);
}
function cxPopActive(k) {
  const it = cx.pop.items, q = $("cxQ");
  it[cx.pop.active]?.setAttribute("aria-selected", "false");
  it[cx.pop.active]?.classList.remove("cx-on");
  cx.pop.active = k;
  const el = it[k];
  if (!el) { q?.removeAttribute("aria-activedescendant"); return; }
  el.setAttribute("aria-selected", "true");
  el.classList.add("cx-on");
  q?.setAttribute("aria-activedescendant", el.id);
  el.scrollIntoView({ block: "nearest" });
}
function cxPopPick(i) {
  if (!cxAdd(i)) return;
  cxPopClose(false);
  ($("cxAdd") ?? cxPanel().querySelector(`.cx-fin-b[data-i="${i}"]`))?.focus({ preventScroll: true });
}

/* --- Câblage --- */
function buildCompare() {
  const panel = cxPanel(), v = cxView(), strip = $("cxStrip");
  if (!panel || !v || !strip) return null;
  panel.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => cxMode(b.dataset.m)));
  panel.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => cxStudio(b.dataset.s)));
  $("cxLoupe")?.addEventListener("click", () => cxLoupeToggle());

  // Bande des finalistes : retirer, ajouter, rideau (choix de la paire), glisser pour réordonner
  strip.addEventListener("click", (e) => {
    if (strip._dragged) { strip._dragged = false; return; }
    const x = e.target.closest("[data-x]");
    if (x && !x.disabled) {
      const i = +x.dataset.x, k = cx.list.indexOf(i);
      if (cxRemove(i)) {
        const xs = [...strip.querySelectorAll(".cx-x:not(:disabled)")];
        (xs[Math.min(k, xs.length - 1)] ?? $("cxAdd") ?? strip.querySelector(".cx-fin-b"))?.focus({ preventScroll: true });
      }
      return;
    }
    if (e.target.closest("#cxAdd")) { cx.pop.open ? cxPopClose() : cxPopOpen(); return; }
    const b = e.target.closest(".cx-fin-b");
    if (b && cx.mode === "rideau") cxPairPick(+b.dataset.i);
  });
  strip.addEventListener("keydown", (e) => {
    const b = e.target.closest(".cx-fin-b");
    if (!b || !e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault(); e.stopPropagation();
    const i = +b.dataset.i;
    if (cxMove(i, e.key === "ArrowLeft" ? -1 : 1)) strip.querySelector(`.cx-fin-b[data-i="${i}"]`)?.focus({ preventScroll: true });
  });
  wireStripDrag(strip);

  // Vue : rideau (glisser / toucher), duel (choisir / balayer), loupe (Maj, appui long, bouton)
  v.addEventListener("click", (e) => {
    if (v._skipClick) { v._skipClick = false; return; }
    const pc = e.target.closest("[data-p]");
    if (pc) return cxPairPick(+pc.dataset.p);
    if (e.target.closest("#cxShow")) return cxShowWinner();
    if (e.target.closest("#cxAgain")) { cx.duel = null; cxRender(); cxView()?.querySelector(".cx-cell")?.focus({ preventScroll: true }); return; }
    if (e.target.closest("#cxShare")) return void cxShare();
    const cell = e.target.closest(".cx-cell[data-side]");
    if (cell && cx.mode === "duel") cxPick(cell.dataset.side);
  });
  v.addEventListener("keydown", (e) => {
    const cell = e.target.closest?.(".cx-cell[data-side]");
    if (cell && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); cxPick(cell.dataset.side); }
  });
  wireViewPointer(v);
  v.addEventListener("scroll", () => { if (cx.loupe.lens.length) cxLoupeRects(); }, { passive: true });

  // Sélecteur
  const q = $("cxQ"), list = $("cxList");
  q?.addEventListener("input", () => cxPopFill(q.value));
  q?.addEventListener("keydown", (e) => {
    const n = cx.pop.items.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (n) cxPopActive((cx.pop.active + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Home" && e.ctrlKey) { e.preventDefault(); if (n) cxPopActive(0); }
    else if (e.key === "End" && e.ctrlKey) { e.preventDefault(); if (n) cxPopActive(n - 1); }
    else if (e.key === "PageDown" || e.key === "PageUp") { e.preventDefault(); if (n) cxPopActive(clamp(cx.pop.active + (e.key === "PageDown" ? 8 : -8), 0, n - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const el = cx.pop.items[cx.pop.active];
      if (el) cxPopPick(+el.dataset.i);
    } else if (e.key === "Tab") cxPopClose(false);
  });
  list?.addEventListener("pointerdown", (e) => e.preventDefault());              // le champ garde le focus
  list?.addEventListener("click", (e) => {
    const o = e.target.closest('.cx-opt[aria-disabled="false"]');
    if (o) cxPopPick(+o.dataset.i);
  });
  list?.addEventListener("pointermove", (e) => {
    const o = e.target.closest('.cx-opt[aria-disabled="false"]');
    if (o && e.pointerType === "mouse") { const k = cx.pop.items.indexOf(o); if (k !== cx.pop.active) cxPopActive(k); }
  });
  panel.addEventListener("pointerdown", (e) => {
    if (cx.pop.open && !e.target.closest("#cxPop, #cxAdd")) cxPopClose(false);
  });

  // Clavier du panneau : 1/2/3 modes, S décor, L loupe, ←/→ rideau ou duel, Maj loupe ; Tab reste dans le panneau
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Tab") return trapTab(e, panel);
    if (e.key === "Shift" && !e.repeat && cxLoupeOk() && !e.target.closest("input")) { cx.loupe.shift = true; cxLoupeUpdate(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest("input, #cxPop")) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!e.repeat && (key === "1" || key === "2" || key === "3")) { e.preventDefault(); cxMode(CX_MODES[+key - 1]); }
    else if (!e.repeat && key === "s") { e.preventDefault(); cxStudio(CX_STUDIOS[(CX_STUDIOS.indexOf(cx.studio) + 1) % CX_STUDIOS.length]); }
    else if (!e.repeat && key === "l") { e.preventDefault(); cxLoupeToggle(); }
    else if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End") {
      if (cx.mode === "rideau") {
        if (e.target.closest(".cx-pair, .cx-strip") && !e.target.closest("#cxHandle")) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 5, back = key === "ArrowLeft" || key === "ArrowUp";
        if (key === "Home" || key === "End") cxSplitTo(key === "Home" ? 0 : 100);
        else cxSplit(cx.split + (back ? -step : step));
      } else if (cx.mode === "duel" && cx.duel?.winner == null && !e.repeat) {
        if (e.target.closest(".cx-strip")) return;
        const vert = phonePortrait.matches;
        const side = key === "ArrowLeft" || (vert && key === "ArrowUp") ? "left" : key === "ArrowRight" || (vert && key === "ArrowDown") ? "right" : null;
        if (side) { e.preventDefault(); cxPick(side); }
      }
    }
  });
  panel.addEventListener("keyup", (e) => { if (e.key === "Shift" && cx.loupe.shift) { cx.loupe.shift = false; cxLoupeUpdate(); } });
  addEventListener("blur", () => { if (cx.loupe.shift || cx.loupe.touch) { cx.loupe.shift = cx.loupe.touch = false; cxLoupeUpdate(); } });
  const relayout = () => { if (isOpen("cmpPanel")) cxRender(); };
  phonePortrait.addEventListener?.("change", relayout);
  phoneLand.addEventListener?.("change", relayout);

  return {
    open(list, mode, studio) {
      cx.list = cxNormalise(list);
      cx.mode = CX_MODES.includes(mode) ? mode : cx.list.length >= 3 || phonePortrait.matches ? "cote" : "rideau";
      cx.studioSet = CX_STUDIOS.includes(studio);
      cx.studio = cx.studioSet ? studio : defaultStudio(cx.mode);
      cx.pair = cx.list.slice(0, 2); cx.split = 50; cx.duel = null;
      cx.loupe.toggled = false;
      cxPopClose(false);
      cxRender();
    },
    refresh() { if (cx.loupe.lens.length) cxLoupeOff(); cxLayout(); },
    close() { cx.gen++; cxPopClose(false); cx.loupe.toggled = false; cxLoupeOff(true); cx.splitRun++; },
    popClose: () => cxPopClose(),
  };
}
function cxMode(m) {
  if (!CX_MODES.includes(m) || m === cx.mode && !(m === "duel" && cx.duel?.winner != null)) return;
  cx.mode = m;
  if (!cx.studioSet) cx.studio = defaultStudio(m);
  if (m === "duel") cx.duel = null;
  cxPopClose(false);
  cxRender();
  cxSay(`Mode ${CX_MODE_L[m]}`);
}
function cxStudio(s) {
  if (!CX_STUDIOS.includes(s)) return;
  cx.studioSet = true;
  if (s === cx.studio) return;
  cx.studio = s;
  const panel = cxPanel();
  panel.dataset.studio = s;
  panel.querySelectorAll("[data-s]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.s === s)));
  const cap = $("cxCap"); if (cap) cap.hidden = s === "studio";
  const had = cx.loupe.lens.length > 0;
  if (had) { cx.loupe.lens.forEach((x) => x.el.remove()); cx.loupe.lens = []; }
  cxLayout();
  if (had) cxLoupeUpdate();
  cxHash();
  cxSay(`Décor ${CX_STUDIO_L[s]}`);
}
function cxLoupeToggle() {
  if (!cxLoupeOk()) return;
  cx.loupe.toggled = !cx.loupe.toggled;
  cxLoupeUpdate();
  cxSay(cx.loupe.toggled ? "Loupe activée" : "Loupe désactivée");
}
function cxPairPick(i) {
  if (!cx.list.includes(i)) return;
  if (cx.pair.includes(i)) {
    if (cx.list.length === 2) [cx.pair[0], cx.pair[1]] = [cx.pair[1], cx.pair[0]];   // deux teintes : inverser
    else return;
  } else cx.pair = [cx.pair[1], i];                       // la plus ancienne de la paire laisse sa place
  cx.pair.sort((a, b) => cx.list.indexOf(a) - cx.list.indexOf(b));
  const had = document.activeElement?.dataset?.p != null;
  cxRender();
  if (had) cxView()?.querySelector(`[data-p="${i}"]`)?.focus({ preventScroll: true });
  cxSay(`Rideau : ${COLORS[cx.pair[0]].name} et ${COLORS[cx.pair[1]].name}`);
}
function trapTab(e, panel) {
  const els = [...panel.querySelectorAll('button, input, [tabindex="0"], [role="slider"]')]
    .filter((el) => !el.disabled && el.offsetParent !== null && !el.closest("[hidden]") && el.tabIndex >= 0);
  if (!els.length) return;
  const k = els.indexOf(document.activeElement);
  const to = e.shiftKey ? (k <= 0 ? els[els.length - 1] : null) : (k === els.length - 1 || k < 0 ? els[0] : null);
  if (to) { e.preventDefault(); to.focus({ preventScroll: true }); }
}

// Glisser une carte de finaliste (souris : tout de suite ; toucher : après un appui de 280 ms)
function wireStripDrag(strip) {
  let d = null;
  const end = (commit) => {
    if (!d) return;
    const { li, items, from, to, timer } = d;
    clearTimeout(timer);
    if (d.on) {
      items.forEach((x) => { x.style.translate = ""; x.classList.remove("drag", "shift"); });
      strip.classList.remove("dragging");
      strip._dragged = true;
      setTimeout(() => (strip._dragged = false), 0);
      if (commit && to !== from) {
        const i = +li.dataset.i;
        cx.list.splice(from, 1); cx.list.splice(to, 0, i);
        cxChanged(`${COLORS[i].name} en position ${to + 1} sur ${cx.list.length}`);
        strip.querySelector(`.cx-fin-b[data-i="${i}"]`)?.focus({ preventScroll: true });
      }
    }
    d = null;
  };
  strip.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".cx-fin-b");
    if (!b || e.button > 0 || d) return;
    const li = b.closest(".cx-fin"), items = [...strip.querySelectorAll(".cx-fin")];
    d = { id: e.pointerId, li, items, x0: e.clientX, y0: e.clientY, from: items.indexOf(li), to: items.indexOf(li), on: false,
      rects: items.map((x) => x.getBoundingClientRect()), touch: e.pointerType !== "mouse", timer: 0 };
    if (d.touch) d.timer = setTimeout(() => { if (d && !d.on) start(); }, 280);
  });
  const start = () => {
    d.on = true;
    try { d.li.setPointerCapture(d.id); } catch {}
    d.li.classList.add("drag");
    strip.classList.add("dragging");
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(6);
  };
  strip.addEventListener("pointermove", (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.on) {
      if (d.touch) { if (Math.hypot(dx, dy) > 8) end(false); return; }
      if (Math.abs(dx) < 6) return;
      start();
    }
    d.li.style.translate = `${Math.round(dx)}px 0`;
    const r0 = d.rects[d.from], mid = r0.left + r0.width / 2 + dx;
    let to = 0;
    d.rects.forEach((r, k) => { if (k !== d.from && mid > r.left + r.width / 2) to++; });
    d.to = to;
    const w = Math.round(r0.width + 12);
    d.items.forEach((x, k) => {
      if (k === d.from) return;
      const s = k > d.from && k <= to ? -w : k < d.from && k >= to ? w : 0;
      x.style.translate = s ? `${s}px 0` : "";
      x.classList.toggle("shift", !!s);
    });
  });
  strip.addEventListener("pointerup", (e) => { if (d && e.pointerId === d.id) end(true); });
  strip.addEventListener("pointercancel", (e) => { if (d && e.pointerId === d.id) end(false); });
  strip.addEventListener("touchmove", (e) => { if (d?.on && e.cancelable) e.preventDefault(); }, { passive: false });
}

// Pointeur sur la vue : rideau (glisser, ou toucher = saut amorti), duel (balayer = écarter), loupe (appui long)
function wireViewPointer(v) {
  let p = null;
  v.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || p) return;
    if (e.target.closest("button, .cx-pair, .cx-rlab")) return;
    if (cx.mode === "rideau" && e.target.closest("#cxRideau")) {
      const box = $("cxRideau").getBoundingClientRect();
      const pos = (ev) => (cx.vert ? (ev.clientY - box.top) / (box.height || 1) : (ev.clientX - box.left) / (box.width || 1)) * 100;
      const near = Math.abs((cx.vert ? e.clientY - box.top : e.clientX - box.left) - cx.splitPx) < 28;
      p = { kind: "rideau", id: e.pointerId, pos, x0: e.clientX, y0: e.clientY, on: near };
      try { v.setPointerCapture(e.pointerId); } catch {}
      if (near) { cx.splitRun++; cxSplit(pos(e)); }
      return;
    }
    const car = e.target.closest(".cx-cell .cx-car, .cx-cell");
    if (!car) return;
    p = { kind: "cell", id: e.pointerId, cell: e.target.closest(".cx-cell"), x0: e.clientX, y0: e.clientY, touch: e.pointerType !== "mouse", t: 0, lp: false };
    if (p.touch && cxLoupeOk() && !cx.loupe.toggled) {
      p.t = setTimeout(() => {
        if (!p || p.kind !== "cell") return;
        p.lp = true;
        cx.loupe.touch = true; cx.loupe.x = p.x0; cx.loupe.y = p.y0;
        cxLoupeUpdate();
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(8);
      }, 380);
    }
  });
  v.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" || cx.loupe.touch || cx.loupe.toggled) { cx.loupe.x = e.clientX; cx.loupe.y = e.clientY; }
    if (cx.loupe.lens.length) cxLoupeMove(cx.loupe.x, cx.loupe.y);
    if (!p || e.pointerId !== p.id) return;
    const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
    if (p.kind === "rideau") {
      if (!p.on && Math.hypot(dx, dy) > 6) { p.on = true; cx.splitRun++; }
      if (p.on) cxSplit(p.pos(e));
    } else if (!p.lp && Math.hypot(dx, dy) > 8) { clearTimeout(p.t); p.t = 0; }
  });
  const up = (e, cancel) => {
    if (!p || e.pointerId !== p.id) return;
    const q = p; p = null;
    if (q.kind === "rideau") {
      if (!q.on && !cancel) cxSplitTo(q.pos(e));
      v._skipClick = true; setTimeout(() => (v._skipClick = false), 0);
      return;
    }
    clearTimeout(q.t);
    if (q.lp) {
      v._skipClick = true; setTimeout(() => (v._skipClick = false), 0);
      cx.loupe.touch = false; cxLoupeUpdate();
      return;
    }
    const dx = e.clientX - q.x0, dy = e.clientY - q.y0;
    // Balayer une teinte = l'écarter : l'autre gagne
    if (!cancel && cx.mode === "duel" && q.touch && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && q.cell?.dataset.side) {
      v._skipClick = true; setTimeout(() => (v._skipClick = false), 0);
      cxPick(q.cell.dataset.side === "left" ? "right" : "left");
    }
  };
  v.addEventListener("pointerup", (e) => up(e, false));
  v.addEventListener("pointercancel", (e) => up(e, true));
  v.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && cx.loupe.lens.length) cx.loupe.lens.forEach((ln) => ln.el.classList.remove("on")); });
  v.addEventListener("touchmove", (e) => { if ((cx.loupe.touch || p?.kind === "rideau") && e.cancelable) e.preventDefault(); }, { passive: false });
}

let cmp = null;
function openCompare(list = defaultFinalists(), { mode = null, studio = null, opener = $("btnCompare") } = {}) {
  if (!cmp || !started) return;
  openPanel("cmpPanel", opener, () => fine.matches ? cxPanel().querySelector('[data-m][aria-pressed="true"]') : $("closeCmp"));
  cmp.open(list, mode, studio);
}

/* ---------- Panneaux et menu ---------- */

let panelOpen = false;
const background = () => [stage, document.querySelector("header.top"), $("dock"), $("fan")].filter(Boolean);
let lastFocus = null;
// opener : élément qui reçoit le focus à la fermeture (bouton explicite : Safari ne focalise pas un bouton cliqué)
// pickFocus : élément à focaliser à l'ouverture (sinon le premier champ, ou le bouton de fermeture au toucher)
function openPanel(id, opener = document.activeElement, pickFocus = null) {
  const panel = $(id);
  if (!panel) return;
  if (!anyPanel()) lastFocus = opener;
  closeMenu(false);
  closeFloating();
  if (isOpen("cmpPanel") && id !== "cmpPanel") writeHash("#" + COLORS[idx].code);
  document.querySelectorAll(".panel.open").forEach((x) => x !== panel && x.classList.remove("open"));
  panel.classList.add("open");
  panelOpen = true;
  setParallax(0, 0);
  hideTip();
  background().forEach((el) => (el.inert = true));
  const first = () => pickFocus ? pickFocus() : fine.matches
    ? panel.querySelector("input, select, button")
    : panel.querySelector('button[id^="close"]') || panel.querySelector("button");
  let tries = 0;
  const focusIn = () => {
    if (!panel.classList.contains("open") || panel.contains(document.activeElement)) return;
    first()?.focus({ preventScroll: true });
    if (!panel.contains(document.activeElement) && ++tries < 8) setTimeout(focusIn, 50);   // visibilité pas encore appliquée
  };
  frame(focusIn);
}
function closePanels() {
  const any = anyPanel(), wasCmp = isOpen("cmpPanel");
  if (wasCmp) cmp?.close();
  document.querySelectorAll(".panel.open").forEach((x) => x.classList.remove("open"));
  closeMenu(false);
  if (!any) return;
  panelOpen = false;
  if (wasCmp && COLORS.length) writeHash("#" + COLORS[idx].code);
  background().forEach((el) => (el.inert = false));        // avant de rendre le focus (sinon impossible)
  const f = lastFocus && lastFocus.isConnected && lastFocus !== document.body && lastFocus.offsetParent !== null ? lastFocus : fanList;
  lastFocus = null;
  f?.focus?.({ preventScroll: true });
}
const menuOpen = () => !!$("menu")?.classList.contains("open");
function openMenu() {
  closeFloating();
  $("menu")?.classList.add("open");
  $("btnExport")?.setAttribute("aria-expanded", "true");
}
function closeMenu(restoreFocus = true) {
  const menu = $("menu");
  if (!menu) return;
  const had = menu.contains(document.activeElement);
  menu.classList.remove("open");
  $("btnExport")?.setAttribute("aria-expanded", "false");
  if (had && restoreFocus) $("btnExport")?.focus({ preventScroll: true });
}

/* ---------- Export : rendu + nom masqué (destination-in), dessiné en pleine résolution ---------- */

const FORMATS = { story: [1080, 1920, 1.6], square: [2000, 2000, 1.3], wide: [2560, 1440, 1.4] };
const loadImg = (src) => new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ko; im.src = src; });
const TITLE_FONT = (px) => `500 ${px}px "Poppins", "Helvetica Neue", Arial, sans-serif`;
let exporting = false;
function setMenuDisabled(on) { $("menu")?.querySelectorAll("button").forEach((b) => (b.disabled = on)); }

async function exportImage(fmt, c = COLORS[idx]) {
  if (exporting || !FORMATS[fmt]) return;
  exporting = true;
  setMenuDisabled(true);
  try {
    const [W, H, zf] = FORMATS[fmt];
    toast("Préparation…", { duration: 20000 });
    const hero = heroName(c.name);
    const [bg, mask] = await Promise.all([
      loadImg(`img/3500/${c.code}.webp`).catch(() => loadImg(`img/2000/${c.code}.webp`)),
      loadImg("img/3500/_mask.webp"),
      Promise.all([
        document.fonts.load(TITLE_FONT(100), hero),
        document.fonts.load('500 40px "Poppins"', c.name),
        document.fonts.load('400 20px "DM Mono"'),
      ]).catch(() => {}),
    ]);
    const k = Math.max(W / bg.width, H / bg.height) * zf;
    const w = bg.width * k, h = bg.height * k, x = (W - w) / 2, y = (H - h) / 2;
    const out = Object.assign(document.createElement("canvas"), { width: W, height: H });
    const o = out.getContext("2d");
    o.imageSmoothingQuality = "high";
    o.drawImage(bg, x, y, w, h);

    // Nom en Poppins, une seule fois, derrière la voiture
    const txt = Object.assign(document.createElement("canvas"), { width: W, height: H });
    const t = txt.getContext("2d");
    const setTitleFont = (px) => {
      t.font = TITLE_FONT(px);
      if ("letterSpacing" in t) t.letterSpacing = `${(-0.02 * px).toFixed(2)}px`;
    };
    setTitleFont(100);
    let size = Math.min((100 * W * 0.9) / t.measureText(hero).width, H * 0.17);
    setTitleFont(size);
    const wFit = t.measureText(hero).width;                 // opsz auto : recalage si le dessin s'élargit
    if (wFit > W * 0.9) { size *= (W * 0.9) / wFit; setTitleFont(size); }
    t.textAlign = "center"; t.textBaseline = "alphabetic";
    t.fillStyle = titleColor(c.hex);
    t.fillText(hero, W / 2, y + h * TEXT_Y - size * 0.02);
    t.globalCompositeOperation = "destination-in";
    t.imageSmoothingQuality = "high";
    t.drawImage(mask, x, y, w, h);
    o.drawImage(txt, 0, 0);

    const g = o.createLinearGradient(0, H * 0.72, 0, H);
    g.addColorStop(0, "rgba(10,10,11,0)"); g.addColorStop(1, "rgba(10,10,11,.75)");
    o.fillStyle = g; o.fillRect(0, H * 0.72, W, H * 0.28);
    const cs = Math.round(Math.min(W, H) * 0.03), pad = Math.round(Math.min(W, H) * 0.06);
    // Perle de laque + nom en Poppins (le même système que l'étiquette)
    const br = Math.round(cs * 0.9), bx = pad + br, by = H - pad - cs * 1.7;
    const bg2 = o.createRadialGradient(bx - br * 0.35, by - br * 0.45, 0, bx, by, br);
    bg2.addColorStop(0, "rgba(255,255,255,.75)"); bg2.addColorStop(0.2, c.hex); bg2.addColorStop(1, c.hex);
    o.fillStyle = bg2; o.beginPath(); o.arc(bx, by, br, 0, Math.PI * 2); o.fill();
    o.fillStyle = "#f4f2ee"; o.textAlign = "left";
    o.font = `500 ${Math.round(cs * 1.5)}px "Poppins", "Helvetica Neue", Arial, sans-serif`;
    o.fillText(c.name, pad + br * 2 + cs * 0.8, H - pad - cs * 1.2);
    o.fillStyle = "rgba(244,242,238,.6)";
    o.font = `400 ${Math.round(cs * 0.55)}px "DM Mono", monospace`;
    o.fillText(`Nº ${fmt3(c.i)} · ${c.code} · ≈ ${c.hex.toUpperCase()}`, pad + br * 2 + cs * 0.8, H - pad);
    // Logo en haut à gauche (SVG clair, proportions 951 × 318)
    try {
      const logo = new Image();
      logo.src = "logo/atelier911-logo-clair.svg";
      await logo.decode();
      const lw = Math.round(Math.min(W, H) * 0.2);
      o.drawImage(logo, pad, pad, lw, Math.round(lw * 318 / 951));
    } catch {}

    const blob = await new Promise((r) => out.toBlob(r, "image/png"));
    if (!blob) throw new Error("toBlob");
    const name = `911-${c.code}-${fmt}.png`;
    let file = null;
    try { file = new File([blob], name, { type: "image/png" }); } catch {}
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `Porsche 911 en ${c.name}` }); hideToast(); return; }
      catch (e) { if (e?.name === "AbortError") { hideToast(); return; } }   // autre erreur : on télécharge
    }
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Image enregistrée");
  } finally {
    exporting = false;
    setMenuDisabled(false);
  }
}

async function share() {
  const c = COLORS[idx], url = location.href.split("#")[0] + "#" + c.code;
  if (navigator.share) {
    try { await navigator.share({ title: `Porsche 911 en ${c.name}`, text: `${c.name} (${c.code})`, url }); return; }
    catch (e) { if (e?.name === "AbortError") return; }
  }
  toast((await copyText(url)) ? "Lien copié" : "Copie impossible");
}

/* ---------- Liens profonds : #5ZA, #cmp=5ZA,PR0, #sel=5ZA.PR0.6RY (insensibles à la casse) ---------- */

function parseHash(h = location.hash) {
  let s = h.replace(/^#/, "");
  try { s = decodeURIComponent(s); } catch {}
  s = s.trim();
  if (!s) return null;
  const find = (x) => codeIndex.get(x.trim().toUpperCase());
  const m = /^(cmp|sel)=([^&?]*)(.*)$/i.exec(s);
  if (m) {
    const type = m[1].toLowerCase();
    let list = [...new Set(m[2].split(/[.,;\s]+/).map(find).filter((i) => i != null))];
    if (!list.length) return null;
    if (type === "cmp") list = list.slice(0, 4);
    // Options du face à face, lues avec indulgence : &m=duel|rideau|cote, &s=gris|jour|nuit|studio
    let mode = null, studio = null;
    for (const kv of m[3].split(/[&?;]+/)) {
      const [k = "", v = ""] = kv.split("=").map((x) => norm(x.trim()));
      if (/^(m|mode)$/.test(k)) mode = /^du/.test(v) ? "duel" : /^ri|^cu/.test(v) ? "rideau" : /^co|^si|^cote/.test(v) ? "cote" : null;
      else if (/^(s|studio|decor|fond)$/.test(k)) studio = /^gr|^ne/.test(v) ? "gris" : /^jo|^pl|^da/.test(v) ? "jour" : /^nu|^ni/.test(v) ? "nuit" : /^st|^or/.test(v) ? "studio" : null;
    }
    return { type, list, mode, studio };
  }
  const i = find(s);
  return i != null ? { type: "code", i } : null;
}
function onHashChange() {
  if (!started) return;
  const r = parseHash();
  if (!r) return;
  if (r.type === "code") {
    if (anyPanel()) closePanels();
    if (r.i === dest()) { centreFan(r.i); return; }
    goTo(r.i, D.paint);
  } else if (r.type === "cmp") openCompare(r.list, { mode: r.mode, studio: r.studio });
  else if (r.type === "sel") { writeHash("#" + COLORS[idx].code); offerSelection(r.list); }
}

/* ---------- Clavier (enregistré tout de suite ; inactif tant que les teintes ne sont pas chargées) ---------- */

// Échap en cascade : panneaux (Nuancier, face à face) → menus → rotation en cours (retour à la teinte affichée)
function onEscape(e) {
  if (isOpen("cmpPanel") && cmp?.popClose()) { e.preventDefault(); return; }
  if (anyPanel()) { e.preventDefault(); closePanels(); return; }
  if (closeLpMenu(true)) { e.preventDefault(); return; }
  if (menuOpen()) { e.preventDefault(); closeMenu(false); $("btnExport")?.focus({ preventScroll: true }); return; }
  if (userScrolling && !fan.ptr?.on) { e.preventDefault(); centreFan(dest()); }
}

addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || !started) return;
  if (e.key === "Escape") { onEscape(e); return; }
  if (anyPanel()) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const editing = e.target.closest?.('input, select, textarea, [contenteditable]:not([contenteditable="false"])');
  if (drag?.on || editing || e.target.closest?.('[role="slider"], [role="menu"], #handle')) return;
  if (key === "ArrowRight" || key === "ArrowLeft") {
    e.preventDefault();
    go(key === "ArrowRight" ? 1 : -1);             // touche maintenue : l'éventail tourne, la voiture atterrit sur la dernière
  } else if (key === "ArrowDown" || key === "ArrowUp") {
    e.preventDefault();
    famStep(key === "ArrowDown" ? 1 : -1);
  } else if (key === "Home" || key === "End") {
    e.preventDefault();
    goTo(key === "Home" ? 0 : COLORS.length - 1);
  } else if (e.repeat) return;
  else if (key === "/") { e.preventDefault(); openNuancier({ focus: "search", opener: $("tSearch") }); }
  else if (key === "g") { e.preventDefault(); openNuancier(); }
  else if (key === "c") { e.preventDefault(); openCompare(); }
  else if (key === "f") { e.preventDefault(); toggleFav(); }
});

/* ---------- Démarrage ---------- */

function refit() {
  if (!started) return;
  hideTip();
  fitName();                                            // la largeur de l'étiquette a pu changer
  measureFan();                                         // place l'étiquette (--dock-b)
  fitCar();                                             // puis la voiture au-dessus d'elle
  measure();
  mcache.clear();
  applyTitle(titleCur, COLORS[idx]);
  const next = peekColor; peekFor = null;
  if (next && (busy || drag?.on)) peek(next);
  if (!busy) { setImg(shotCur, COLORS[idx]); trackCur(); }   // pendant une transition, commit() s'en charge
  paint();
  // Nouveau rayon, nouvelle bande ; l'angle (en degrés) ne change pas : la lame choisie reste centrée
  studioMeasure();
  setAngle(fan.angle);
  if (isOpen("cmpPanel")) cmp?.refresh();
  if (!busy && !drag) prepareNeighbours();
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on("fav", () => toggleFav());
  on("tSearch", () => openNuancier({ focus: "search", opener: $("tSearch") }));
  on("tFav", () => openNuancier({ fav: true, opener: $("tFav") }));
  on("tAll", () => openNuancier({ opener: $("tAll") }));
  on("closeNu", closePanels);
  on("btnCompare", () => openCompare());
  on("closeCmp", closePanels);
  on("shareSel", shareSelection);
  on("cmpSel", () => openCompare(favFinalists(), { opener: $("cmpSel") }));
  on("specCode", async () => {
    const code = COLORS[idx].code;
    toast((await copyText(code)) ? `Code ${code} copié` : "Copie impossible");
  });
  on("btnExport", (e) => {
    e.stopPropagation();
    if (menuOpen()) return closeMenu();
    openMenu();
    if (e.detail === 0) $("menu")?.querySelector("button:not([disabled])")?.focus({ preventScroll: true });   // ouvert au clavier
  });
  on("menu", (e) => {
    const b = e.target.closest("[data-fmt]"); if (!b || b.disabled) return;
    closeMenu();
    if (b.dataset.fmt === "share") return void share();
    exportImage(b.dataset.fmt).catch(() => toast("Export impossible"));
  });
  document.addEventListener("click", (e) => { if (menuOpen() && !e.target.closest(".menu-wrap")) closeMenu(false); });
  document.querySelector(".menu-wrap")?.addEventListener("focusout", (e) => {
    if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) closeMenu(false);
  });
  addEventListener("hashchange", onHashChange);
  wireFan();
  wireNuancier();
  wireLpMenu();
  wireStudio();

  // Redimensionnement / rotation / changement de densité d'écran : nouvelle taille d'image + titres recalés
  let rt;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(refit, 120); };
  addEventListener("resize", onResize);
  const watchDpr = () => {
    const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    mq.addEventListener?.("change", () => { onResize(); watchDpr(); }, { once: true });
  };
  watchDpr();
  // La police définitive change la largeur du titre et des étiquettes de famille
  document.fonts?.addEventListener?.("loadingdone", () => { fontGen++; onResize(); });
}

async function start(data) {
  COLORS = deckOrder(data
    .filter((c) => c && typeof c.code === "string" && /^#[0-9a-f]{6}$/i.test(c.hex) && c.name)
    .map((c) => ({ ...c, family: c.family === "rose" ? "violet" : FAMILY_ORDER.includes(c.family) ? c.family : "gris" })));
  if (!COLORS.length) throw new Error("colors.json vide");
  codeIndex.clear();
  famStart = {}; famCount = {};
  COLORS.forEach((c, i) => {
    c.i = i; codeIndex.set(c.code.toUpperCase(), i);
    if (famStart[c.family] == null) famStart[c.family] = i;
    famCount[c.family] = (famCount[c.family] ?? 0) + 1;
  });

  measure();
  const r = parseHash();
  let initCmp = null, initSel = null;
  if (r?.type === "code") idx = r.i;
  else if (r?.type === "cmp") { idx = r.list[0]; initCmp = r; }
  else if (r?.type === "sel") { idx = r.list[0]; initSel = r.list; }
  else idx = codeIndex.get("5ZA") ?? 0;

  setHintText();
  if (hinted) $("hint")?.classList.add("gone");
  buildFan();
  buildNuancier();

  await Promise.all([
    setImg(shotCur, COLORS[idx]),
    Promise.race([document.fonts?.load(TITLE_FONT(100), heroName(COLORS[idx].name)).catch(() => {}), sleep(2500)]),
  ]);
  measure();                                                   // la police a pu changer la mise en page du dock
  const ok = showing(shotCur, COLORS[idx].code);
  setNoImg(stage, !ok);
  if (!ok) trackCur();
  applyTitle(titleCur, COLORS[idx]);
  p = 0; paint();
  writeSpec(COLORS[idx]);
  cmp = buildCompare();

  // Éventail calé sur la teinte courante ; à l'apparition, les lames se déplient depuis la lame choisie
  measureFan();
  // Voiture placée au-dessus de l'étiquette, puis titre et taille d'image recalculés pour cette rig
  fitCar();
  measure(); mcache.clear();
  applyTitle(titleCur, COLORS[idx]);
  setImg(shotCur, COLORS[idx]);
  paint();
  const k = idx;
  setSel(k);
  setAngle(-fan.theta[k]);
  started = true;
  applyMeta();
  wire();
  announceOn = true;
  if (!reduced.matches) {
    fanRot.style.setProperty("--s0", String(k));
    fanRot.style.setProperty("--u0", fan.theta[k].toFixed(3) + "deg");
    // seules les lames visibles se déplient ; les autres attendent déjà à leur place, hors champ
    fan.blades.forEach((b, i) => b.classList.toggle("far", Math.abs(i - k) > 28));
    fanEl.classList.add("unfold");
    setTimeout(() => fanEl.classList.remove("unfold"), 1500);
  }

  // Intro, une fois par chargement, déclenchée après le décodage du premier rendu
  body.classList.add("ready", "intro");
  setTimeout(() => body.classList.remove("intro"), reduced.matches ? 400 : 1400);

  if (initCmp) openCompare(initCmp.list, { mode: initCmp.mode, studio: initCmp.studio });
  if (initSel) offerSelection(initSel);
}

/* ---------- Chargement : squelette, erreur et nouvel essai ---------- */

const bootEl = $("boot"), bootHTML = bootEl?.innerHTML ?? "";
let booting = false, attempt = 0;
function bootError() {
  body.classList.add("boot-error");
  if (bootEl) {
    bootEl.innerHTML = `<span class="mono">Les teintes n'ont pas pu être chargées.</span><button class="btn" id="retry" type="button">Réessayer</button>`;
    $("retry")?.focus({ preventScroll: true });
  } else toast("Les teintes n'ont pas pu être chargées.", { duration: 8000, action: { label: "Réessayer", run: boot } });
}
bootEl?.addEventListener("click", (e) => { if (e.target.closest("#retry")) boot(); });

async function boot() {
  if (booting || started) return;
  booting = true;
  body.classList.remove("boot-error");
  if (bootEl && bootEl.innerHTML !== bootHTML) bootEl.innerHTML = bootHTML;
  let data;
  try {
    const res = await fetch("colors.json", attempt++ ? { cache: "reload" } : undefined);
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error("format");
  } catch {
    booting = false;
    bootError();
    return;
  }
  try {
    await start(data);
  } catch (err) {
    console.error(err);
  } finally {
    booting = false;
    body.classList.add("ready");     // .top et .dock ne restent jamais invisibles une fois les teintes reçues
  }
}
boot();
