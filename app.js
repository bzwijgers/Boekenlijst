/* Peet's boekenkast — app-logica
   Basisgegevens staan in data-*.js. Alles wat Petra zelf toevoegt of wijzigt (nieuwe boeken, memo's,
   aanpassingen, bio's) wordt op het apparaat bewaard in localStorage en kan via het menu als backup
   worden opgeslagen en op een ander apparaat worden teruggezet. */
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[‘’'`´]/g, "'").trim();
const sortKey = s => norm(s).replace(/^['"(]+/, "");
function hash(s) { let h = 5381; for (const c of s) h = ((h << 5) + h + c.codePointAt(0)) | 0; return (h >>> 0).toString(36); }
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

/* ---------- Gegevens ---------- */
const STORE_KEY = "pb-data";
let store = Object.assign({ edits: {}, added: [], deleted: [], bios: {}, covers: {} }, lsGet(STORE_KEY, {}));
const saveStore = () => { const ok = lsSet(STORE_KEY, store); if (ok) syncChanged(); return ok; };

const BASE = [];
(window.BOEKEN || []).forEach(b => BASE.push({ id: "b" + hash(b.a + "|" + b.t), a: b.a, t: b.t, o: b.o, s: b.s, n: b.n || 0, g: b.g, j: b.j || 0, z: b.z, memo: b.m || "", w: false }));
(window.WENSEN || []).forEach(r => BASE.push({ id: "w" + hash(r[0] + "|" + r[1]), a: r[0], t: r[1], o: r[2], s: r[3], n: r[4] || 0, g: "", j: 0, z: "", memo: r[5] || "", w: true }));

function tkey(s) { return norm(s).replace(/^(the|a|de|het|een)\s+/, "").replace(/[^a-z0-9]/g, ""); }
let BOOKS = [], BYID = new Map();
function rebuild() {
  const del = new Set(store.deleted);
  BOOKS = BASE.filter(b => !del.has(b.id)).map(b => Object.assign({}, b, store.edits[b.id] || {}))
    .concat(store.added.filter(b => !del.has(b.id)).map(b => Object.assign({}, b, store.edits[b.id] || {})));
  BOOKS.forEach(b => { b.a = (b.a || "").replace(/\s+/g, " ").trim(); b.t = (b.t || "").replace(/\s+/g, " ").trim(); });
  // Een gelezen boek staat nooit meer op de wensenlijst, ook niet als het via een andere weg is toegevoegd
  const gelezen = new Set();
  BOOKS.filter(b => !b.w).forEach(b => [b.t, b.o].forEach(x => { const k = tkey(x); if (k) gelezen.add(norm(b.a) + "|" + k); }));
  BOOKS = BOOKS.filter(b => !b.w || ![b.t, b.o].some(x => { const k = tkey(x); return k && gelezen.has(norm(b.a) + "|" + k); }));
  BYID = new Map(BOOKS.map(b => [b.id, b]));
}
rebuild();

function niceName(a) {               // "King, Stephen" -> "Stephen King"
  const i = a.indexOf(",");
  if (i < 0) return a;
  return (a.slice(i + 1).trim() + " " + a.slice(0, i).trim()).trim();
}
function lastName(a) { const i = a.indexOf(","); return (i < 0 ? a : a.slice(0, i)).trim(); }
const GENRE_COL = { "Thriller": "#9c4a64", "Medische Thriller": "#5d7f8c", "Horror": "#5a4660", "Roman": "#c97b93", "Fictie": "#7d9a84", "Detective": "#806a9c", "Non-Fictie": "#b0876f", "Drama": "#a8628a", "Biografie": "#a88a72" };
const ALT_COL = ["#c97b93", "#9c4a64", "#7d9a84", "#806a9c", "#b0876f", "#a8628a", "#5d7f8c", "#d39a8a", "#8c6e8f"];
const colorFor = b => GENRE_COL[b.g] || ALT_COL[parseInt(hash(b.t), 36) % ALT_COL.length];
function bio(a) { return store.bios[a] ?? (window.SCHRIJVERS || {})[a] ?? ""; }

/* ---------- Omslagen (Google Books, daarna Open Library) ---------- */
const COV_KEY = "pb-covers";
let covers = lsGet(COV_KEY, {});
let covSaveT = 0;
const saveCovers = () => { clearTimeout(covSaveT); covSaveT = setTimeout(() => lsSet(COV_KEY, covers), 400); };
const ckey = b => hash(norm(b.a) + "|" + norm(b.t));
const pending = new Map(), queue = [];
let active = 0;
const olCover = (id, size) => typeof id === "string" ? id : "https://covers.openlibrary.org/b/id/" + id + "-" + (size || "M") + ".jpg";
let BIBIDX = null;
function bibInfo(b) {                                          // omslag en beschrijving-ID uit de bibliografie
  if (!BIBIDX) { BIBIDX = new Map(); Object.entries(window.BIBLIO || {}).forEach(([a, l]) => l.forEach(([t, y, c, k]) => { const key = a + "|" + tkey(t); if (!BIBIDX.has(key)) BIBIDX.set(key, { c, k }); })); }
  return BIBIDX.get(b.a + "|" + tkey(b.o)) || BIBIDX.get(b.a + "|" + tkey(b.t)) || null;
}
function getCover(b) {
  const own = (store.covers || {})[b.id];                      // zelf toegevoegd of geplakt
  if (own) return Promise.resolve(own);
  const fixed = (window.COVERS || {})[b.a + "|" + b.t];        // vooraf opgezocht via Open Library
  if (fixed) return Promise.resolve(typeof fixed === "number" ? olCover(fixed) : fixed);
  const cid = b.cid || (bibInfo(b) || {}).c;
  if (cid) return Promise.resolve(olCover(cid));
  const k = ckey(b), c = covers[k];
  if (c && (c.u || Date.now() - c.d < 14 * 864e5)) return Promise.resolve(c.u || "");
  if (pending.has(k)) return pending.get(k);
  const p = new Promise(res => queue.push({ b, k, res }));
  pending.set(k, p); pump(); return p;
}
function pump() {
  while (active < 2 && queue.length) {
    const job = queue.shift(); active++;
    findCover(job.b).catch(() => null).then(u => {
      if (u !== null) { covers[job.k] = { u: u || "", d: Date.now() }; saveCovers(); }
      job.res(u || ""); pending.delete(job.k);
      setTimeout(() => { active--; pump(); }, 350);        // rustig aan: de gratis diensten begrenzen het aantal verzoeken
    });
  }
}
async function appleFind(title, ln, country) {                // Apple Books: goede bron voor Nederlandse edities
  const r = await fetch(`https://itunes.apple.com/search?media=ebook&limit=15&country=${country}&term=` + encodeURIComponent(title + " " + ln));
  if (!r.ok) throw new Error("apple " + r.status);
  const want = tkey(title), nl = norm(ln);
  return ((await r.json()).results || []).find(x => norm(x.artistName).includes(nl) && (tkey(x.trackName) === want || tkey(String(x.trackName).replace(/\s*[:(].*$/, "")) === want)) || null;
}
async function apple(title, ln, country) { const hit = await appleFind(title, ln, country); return hit ? hit.artworkUrl100.replace("100x100bb", "400x600bb") : ""; }
async function ol(title, author) {
  const r = await fetch("https://openlibrary.org/search.json?limit=5&fields=cover_i&title=" + encodeURIComponent(title) + "&author=" + encodeURIComponent(author));
  if (!r.ok) throw new Error("ol " + r.status);
  const j = await r.json();
  const d = (j.docs || []).find(x => x.cover_i);
  return d ? "https://covers.openlibrary.org/b/id/" + d.cover_i + "-M.jpg" : "";
}
async function findCover(b) {
  const ln = lastName(b.a).replace(/&.*/, "").trim(), t = b.t.replace(/\(.*?\)/g, "").replace(/^.*? \d+ - /, "").trim();
  let u = "", failed = 0;
  const tries = [() => apple(t, ln, "NL")];
  if (b.o && b.o !== "-" && norm(b.o) !== norm(t)) tries.push(() => apple(b.o, ln, "US"));
  tries.push(() => ol(t, ln));
  if (b.o && b.o !== "-") tries.push(() => ol(b.o, ln));
  for (const f of tries) { try { u = await f(); if (u) return u; } catch (e) { failed++; } }
  return failed ? null : "";      // null = (deels) geen antwoord gekregen: later opnieuw proberen, niet onthouden als 'geen omslag'
}
function coverHTML(b) {
  return `<span class="cov" data-id="${b.id}" style="--g:${colorFor(b)}"><span class="ph"><b>${esc(b.t)}</b><i>${esc(niceName(b.a))}</i></span></span>`;
}
const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); fillCover(e.target); } }), { rootMargin: "300px" }) : null;
function hydrate(root) { root.querySelectorAll(".cov:not([data-h])").forEach(el => { el.dataset.h = 1; io ? io.observe(el) : fillCover(el); }); }
function fillCover(el) {
  const b = BYID.get(el.dataset.id); if (!b) return;
  getCover(b).then(u => {
    if (!u) return;
    const img = new Image(); img.alt = ""; img.decoding = "async"; img.referrerPolicy = "no-referrer";
    img.onload = () => { if (img.naturalWidth > 20) { img.className = "ok"; el.classList.add("has"); } else img.remove(); };
    img.onerror = () => img.remove();
    img.src = u; el.appendChild(img);
  });
}

/* ---------- Navigatie ---------- */
const VIEWS = ["start", "lijst", "boek", "schrijver", "nieuw"];
let navDepth = 0, listScroll = 0, current = "", authorScroll = 0, lastAuthor = "";
function show(v) {
  if (current === "lijst" && v !== "lijst") listScroll = window.scrollY;
  if (current === "schrijver" && v !== "schrijver") authorScroll = window.scrollY;
  VIEWS.forEach(x => $("#" + x).classList.toggle("hidden", x !== v));
  current = v;
}
function goBack() { if (navDepth > 0) history.back(); else location.hash = "#/lijst"; }
window.goBack = goBack;
window.addEventListener("hashchange", () => { navDepth++; route(); });
function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const [p, ...rest] = h.split("/"), arg = rest.join("/");
  if (p === "lijst") { show("lijst"); renderList(); requestAnimationFrame(() => window.scrollTo(0, listScroll)); }
  else if (p === "boek" && BYID.has(arg)) { show("boek"); renderBook(BYID.get(arg)); window.scrollTo(0, 0); }
  else if (p === "schrijver" && arg) { show("schrijver"); renderAuthor(arg); const y = arg === lastAuthor ? authorScroll : 0; lastAuthor = arg; requestAnimationFrame(() => window.scrollTo(0, y)); }
  else if (p === "titel" && arg.includes("|")) { const i = arg.indexOf("|"); show("boek"); renderUnread(arg.slice(0, i), arg.slice(i + 1)); window.scrollTo(0, 0); }
  else if (p === "nieuw") { show("nieuw"); renderForm(null); window.scrollTo(0, 0); }
  else if (p === "bewerk" && BYID.has(arg)) { show("nieuw"); renderForm(BYID.get(arg)); window.scrollTo(0, 0); }
  else { show("start"); renderStart(); }
}

/* ---------- Startscherm ---------- */
function renderStart() {
  const read = BOOKS.filter(b => !b.w);
  $("#nB").textContent = read.length;
  $("#nA").textContent = new Set(read.map(b => b.a)).size;
  $("#nW").textContent = BOOKS.length - read.length;
  const lines = [read.length + " boeken verslonden, en de stapel groeit nog.", "Gelezen, genoten en bewaard.", "Thee erbij, telefoon weg, en lezen maar.", "Eén hoofdstuk nog… echt waar."];
  $("#tagline").textContent = lines[Math.random() * lines.length | 0];
  const w = innerWidth, cols = w < 560 ? 4 : w < 1000 ? 6 : 8, rows = Math.ceil((innerHeight * 1.35) / ((w * 1.25 / cols) * 1.5)) + 1;
  const n = cols * rows, shelf = $("#shelf");
  shelf.style.setProperty("--cols", cols);
  const withCover = read.filter(b => (covers[ckey(b)] || {}).u), rest = read.filter(b => !(covers[ckey(b)] || {}).u);
  const pick = shuffle(withCover).concat(shuffle(rest)).slice(0, n);
  shelf.innerHTML = shuffle(pick).map(b => `<div class="c">${coverHTML(b)}</div>`).join("");
  shelf.querySelectorAll(".cov").forEach(el => { el.dataset.h = 1; fillCover(el); });
}
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; }
$("#start").addEventListener("click", e => { if (!e.target.closest(".hero")) location.hash = "#/lijst"; });
$(".hero .tap").addEventListener("click", () => location.hash = "#/lijst");

/* ---------- Overzicht ---------- */
let tab = "gel", genre = "", query = "", openSet = new Set(lsGet("pb-open", [])), listScrollReset = false;
function setQuery(v) { query = v.trim(); $("#q").value = v; $("#qx").classList.toggle("hidden", !v); listScroll = 0; }
function hl(s, q) {
  s = String(s ?? ""); if (!q) return esc(s);
  const ns = norm(s), nq = norm(q); let out = "", i = 0, k;
  while ((k = ns.indexOf(nq, i)) >= 0 && nq) { out += esc(s.slice(i, k)) + "<mark>" + esc(s.slice(k, k + nq.length)) + "</mark>"; i = k + nq.length; }
  return out + esc(s.slice(i));
}
/* Tabblad Binnenkort: aangekondigde boeken uit de maandelijkse controle */
const todayISO = () => new Date().toISOString().slice(0, 10);
const nlDate = iso => new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
const inKast = n => BOOKS.find(b => b.a === n.a && (tkey(b.t) === tkey(n.t) || tkey(b.o) === tkey(n.t)));
const soonItems = () => (((window.NIEUW || {}).boeken) || []).filter(n => { const m = inKast(n); return !m || m.w; });
function renderSoon() {
  const nq = norm(query), today = todayISO(), items = soonItems().filter(n => !nq || norm(n.t).includes(nq) || norm(n.a).includes(nq) || norm(niceName(n.a)).includes(nq));
  const chk = (window.NIEUW || {}).gecontroleerd;
  $("#chips").innerHTML = ""; $("#az").innerHTML = ""; $("#allBtn").classList.add("hidden");
  $("#cnt").textContent = items.length + (items.length === 1 ? " boek" : " boeken") + (chk ? " · gecontroleerd op " + nlDate(chk) : "");
  $("#groups").innerHTML = items.length ? `<div class="au open"><ul>${items.map(n => {
    const m = inKast(n), href = m ? "#/boek/" + m.id : "#/titel/" + encodeURIComponent(n.a + "|" + n.t);
    return `<li><a href="${href}"><span class="th"><img loading="lazy" alt="" referrerpolicy="no-referrer" src="${esc(n.c)}" style="width:100%;height:100%;object-fit:cover;display:block"></span><span class="tt"><b>${hl(n.t, query)}</b><small>${hl(niceName(n.a), query)}</small><span class="ser">${n.d > today ? "Verschijnt " + nlDate(n.d) : "Net verschenen, " + nlDate(n.d)}</span></span>${m ? `<span class="ok w" style="flex:none;font:700 11px/1 var(--f-b);color:#fff;background:var(--gold);border-radius:10px;padding:5px 8px">Wens</span>` : ""}</a></li>`;
  }).join("")}</ul></div>` : `<div class="empty">${query ? "Niets gevonden." : "Er zijn op dit moment geen nieuwe boeken aangekondigd."}<br><br>Elke maand wordt dit automatisch gecontroleerd.</div>`;
  setAzTop();
}
function renderList() {
  if (tab === "soon") { renderSoon(); return; }
  const pool = BOOKS.filter(b => tab === "wens" ? b.w : !b.w);
  const genres = [...new Set(pool.map(b => b.g).filter(Boolean))].sort((x, y) => x.localeCompare(y, "nl"));
  if (genre && !genres.includes(genre)) genre = "";
  $("#chips").innerHTML = genres.length > 1 ? [`<button class="chip" data-g="" aria-pressed="${!genre}">Alle soorten</button>`]
    .concat(genres.map(g => `<button class="chip" data-g="${esc(g)}" aria-pressed="${g === genre}">${esc(g)}</button>`)).join("") : "";
  const nq = norm(query);
  const items = pool.filter(b => (!genre || b.g === genre) && (!nq || norm(b.t).includes(nq) || norm(b.o).includes(nq) || norm(b.a).includes(nq) || norm(niceName(b.a)).includes(nq) || norm(b.s).includes(nq)));
  const groups = new Map();
  items.forEach(b => { if (!groups.has(b.a)) groups.set(b.a, []); groups.get(b.a).push(b); });
  const names = [...groups.keys()].sort((x, y) => sortKey(x).localeCompare(sortKey(y), "nl"));
  $("#cnt").textContent = items.length + (items.length === 1 ? " boek" : " boeken") + " · " + names.length + (names.length === 1 ? " schrijver" : " schrijvers");
  const forceOpen = !!nq;
  let letter = "", letters = [];
  $("#groups").innerHTML = names.length ? names.map(a => {
    const bs = groups.get(a).sort((x, y) => sortKey(x.t).localeCompare(sortKey(y.t), "nl", { numeric: true }));
    const L = sortKey(a).charAt(0).toUpperCase(); let anchor = "";
    if (L !== letter) { letter = L; letters.push(L); anchor = ` id="L-${L}"`; }
    const open = forceOpen || openSet.has(a);
    const total = BOOKS.filter(b => b.a === a && (tab === "wens" ? b.w : !b.w)).length;
    return `<div class="au${open ? " open" : ""}" data-a="${esc(a)}"${anchor}>
      <header role="button" aria-expanded="${open}"><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
      <span class="nm"><b>${hl(a, query)}</b></span><span class="cnt">${bs.length < total ? bs.length + "/" + total : total}</span>
      <a class="bio" href="#/schrijver/${encodeURIComponent(a)}" aria-label="Over ${esc(niceName(a))}: bio en alle boeken" title="Bio en alle boeken"><span>i</span></a></header>
      <ul>${open ? itemsHTML(bs) : ""}</ul></div>`;
  }).join("") : `<div class="empty">Niets gevonden${query ? " voor ‘" + esc(query) + "’" : ""}.<br><br><a class="btn pri" href="#/nieuw" style="display:inline-flex;flex:none">Boek toevoegen</a></div>`;
  $("#az").innerHTML = !forceOpen && letters.length > 6 ? letters.map(L => `<button data-l="${L}">${L}</button>`).join("") : "";
  hydrate($("#groups"));
  const allOpen = names.length && names.every(a => openSet.has(a));
  $("#allBtn").textContent = allOpen ? "Alles dichtklappen" : "Alles openklappen";
  $("#allBtn").classList.toggle("hidden", forceOpen || !names.length);
  $("#allBtn").dataset.names = JSON.stringify(names);
  setAzTop();
}
function setAzTop() { const bar = $("#lijst .bar"); if (bar) document.documentElement.style.setProperty("--azTop", (bar.offsetHeight + 6) + "px"); }
/* Serie-informatie: "De Donkere Toren · deel 1 van 7" */
const SERIES_TOTAL = {
  "Dollanganger": 5, "De Casteel Serie": 5, "Camel Club": 5, "Will Robie": 5, "Robert Langdon": 5, "Andy Brazil": 3,
  "Het Fluistereiland": 4, "Rizzoli & Isles": 13, "Miss": 3, "Jack Caffery": 7, "Cree Black": 2, "David Ash": 3, "De Ratten": 4,
  "Familie Walsh": 6, "De Donkere Toren": 7, "Moonlight Bay": 2, "Millennium": 3, "Timothy Wilde": 3, "Inspector Wexford": 24,
  "Grant County": 6, "Blue Rose": 3, "De Roth Trilogie": 3, "Martin Vail": 3, "Het Wilde Eiland": 3, "Rechercheur De Klerck": 15
};
const hasSeries = b => b.s && b.s !== "-";
function seriesLabel(b) {
  if (!hasSeries(b)) return "";
  const tot = (store.series || {})[b.s] || SERIES_TOTAL[b.s];
  return b.s + (b.n ? " · deel " + b.n + (tot ? " van " + tot : "") : "");
}
const enTitle = b => b.o && b.o !== "-" && norm(b.o) !== norm(b.t) ? b.o : "";
function subHTML(b, q) {
  const en = enTitle(b), s = seriesLabel(b);
  return (en ? `<small class="en">${hl(en, q)}</small>` : "") + (s ? `<span class="ser">${hl(s, q)}</span>` : "");
}
function itemsHTML(bs) {
  return bs.map(b => `<li><a href="#/boek/${b.id}"><span class="th">${coverHTML(b)}</span><span class="tt"><b>${hl(b.t, query)}</b>${subHTML(b, query)}</span>${b.j ? `<span class="yr">${b.j}</span>` : ""}</a></li>`).join("");
}
$("#groups").addEventListener("click", e => {
  if (e.target.closest("a")) return;
  const h = e.target.closest(".au>header"); if (!h) return;
  const box = h.parentNode, a = box.dataset.a, open = !box.classList.contains("open");
  box.classList.toggle("open", open); h.setAttribute("aria-expanded", open);
  if (open) {
    openSet.add(a);
    const nq = norm(query);
    const bs = BOOKS.filter(b => b.a === a && (tab === "wens" ? b.w : !b.w) && (!genre || b.g === genre)).sort((x, y) => sortKey(x.t).localeCompare(sortKey(y.t), "nl", { numeric: true }));
    box.querySelector("ul").innerHTML = itemsHTML(bs); hydrate(box);
  } else openSet.delete(a);
  lsSet("pb-open", [...openSet]);
});
$("#allBtn").addEventListener("click", () => {
  const names = JSON.parse($("#allBtn").dataset.names || "[]"), all = names.every(a => openSet.has(a));
  names.forEach(a => all ? openSet.delete(a) : openSet.add(a)); lsSet("pb-open", [...openSet]); renderList();
});
$("#chips").addEventListener("click", e => { const c = e.target.closest(".chip"); if (!c) return; genre = c.dataset.g; renderList(); });
const TABS = { gel: "#tGel", wens: "#tWens", soon: "#tSoon" };
Object.entries(TABS).forEach(([k, sel]) => $(sel).onclick = () => {
  tab = k; Object.entries(TABS).forEach(([x, s]) => $(s).setAttribute("aria-pressed", x === k));
  renderList(); window.scrollTo(0, 0);
});
{ const n = soonItems().length; if (n) $("#tSoon").textContent = "Binnenkort (" + n + ")"; }
let qT = 0;
$("#q").addEventListener("input", e => { clearTimeout(qT); qT = setTimeout(() => { setQuery(e.target.value); renderList(); window.scrollTo(0, 0); }, 120); });
$("#q").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
$("#qx").onclick = () => { setQuery(""); renderList(); $("#q").focus(); };
function azJump(y) {
  const el = document.elementFromPoint(innerWidth - 12, y), L = el && el.dataset && el.dataset.l;
  const t = L && document.getElementById("L-" + L);
  if (t) window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - $("#lijst .bar").offsetHeight - 8);
}
$("#az").addEventListener("click", e => { if (e.target.dataset.l) azJump(e.clientY); });
$("#az").addEventListener("touchmove", e => { e.preventDefault(); azJump(e.touches[0].clientY); }, { passive: false });

/* ---------- Boek ---------- */
function renderBook(b) {
  $("#bBar").textContent = b.t;
  $("#bEdit").href = "#/bewerk/" + b.id; $("#bEdit").classList.remove("hidden");
  const facts = [];
  if (b.g) facts.push(["Soort boek", b.g]);
  facts.push(["Verschenen", b.j || "onbekend"]);
  facts.push(["Serie", hasSeries(b) ? seriesLabel(b) : "Geen serie"]);
  if (b.w) facts.push(["Status", "Op de wensenlijst"]);
  const others = BOOKS.filter(x => x.a === b.a && x.id !== b.id && x.s && x.s === b.s && b.s !== "-").sort((x, y) => (x.n || 99) - (y.n || 99) || sortKey(x.t).localeCompare(sortKey(y.t)));
  $("#bBody").innerHTML = `
    <div class="top"><div class="big">${coverHTML(b)}</div>
      <div><h1>${esc(b.t)}</h1>${enTitle(b) ? `<p class="orig">${esc(enTitle(b))}</p>` : ""}${hasSeries(b) ? `<div class="tt" style="margin:-4px 0 8px"><span class="ser">${esc(seriesLabel(b))}</span></div>` : ""}
      <a class="by" href="#/schrijver/${encodeURIComponent(b.a)}">${esc(niceName(b.a))}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></a></div></div>
    <div class="facts">${facts.map(f => `<div class="fact"><small>${f[0]}</small><span>${esc(f[1])}</span></div>`).join("")}</div>
    <div class="sec"><h3>Samenvatting</h3>${b.z ? `<p>${esc(b.z)}</p>` : `<p class="none" id="zNone">Nog geen samenvatting. Tik op het potlood om er een toe te voegen.</p>`}</div>
    <div class="sec" id="descSec"><h3>Meer over dit boek</h3><div id="descBox"><p class="none">Beschrijving ophalen…</p></div></div>
    <div class="sec"><h3>Memo</h3><textarea class="memo" id="memo" placeholder="Eigen aantekeningen: wat vond je ervan, cijfer, uitgeleend aan…">${esc(b.memo)}</textarea><div class="saved" id="saved"></div></div>
    ${others.length ? `<div class="sec"><h3>Ook in ${esc(b.s)}</h3><ul class="tl" style="margin-top:0">${others.map(x => `<li><a href="#/boek/${x.id}"><span class="y">${x.n ? "#" + x.n : ""}</span><span class="dot"></span><span class="th">${coverHTML(x)}</span><span class="tt"><b>${esc(x.t)}</b><small>${x.j || ""}${x.w ? " · wensenlijst" : ""}</small></span></a></li>`).join("")}</ul></div>` : ""}
    <div class="acts">${b.w ? `<button class="btn pri" id="markRead">Gelezen!</button>` : ""}<button class="btn" id="covBtn">Omslag toevoegen of plakken</button><a class="btn" href="#/bewerk/${b.id}">Bewerken</a></div>`;
  hydrate($("#bBody"));
  lastBook = b.id;
  $("#covBtn").onclick = () => coverSheet(!!store.covers[b.id], u => { if (setCover(b.id, u)) renderBook(BYID.get(b.id)); });
  loadSummary({ a: b.a, t: b.t, o: enTitle(b), wk: b.wk || (bibInfo(b) || {}).k }, $("#descBox"), {
    onNone: () => { const s = $("#descSec"); if (s) s.remove(); },
    onFound: () => { const n = $("#zNone"); if (n) { n.closest(".sec").remove(); $("#descSec h3").textContent = "Samenvatting"; } }
  });
  let t = 0;
  $("#memo").addEventListener("input", e => {
    clearTimeout(t); $("#saved").textContent = "";
    t = setTimeout(() => { setField(b.id, { memo: e.target.value }); $("#saved").textContent = "✓ Opgeslagen"; }, 500);
  });
  const mr = $("#markRead");
  if (mr) mr.onclick = () => { setField(b.id, { w: false }); toast("Gelezen! Van de wensenlijst gehaald"); renderBook(BYID.get(b.id)); };
}

/* ---------- Eigen omslag: kiezen, plakken of webadres ---------- */
let lastBook = null, pendingCover;
function imgToData(blob) {
  return new Promise((ok, no) => {
    const u = URL.createObjectURL(blob), i = new Image();
    i.onload = () => {
      const sc = Math.min(1, 360 / i.naturalWidth), c = document.createElement("canvas");
      c.width = Math.round(i.naturalWidth * sc); c.height = Math.round(i.naturalHeight * sc);
      c.getContext("2d").drawImage(i, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      ok(c.toDataURL("image/jpeg", .78));
    };
    i.onerror = () => { URL.revokeObjectURL(u); no(new Error("geen afbeelding")); };
    i.src = u;
  });
}
function setCover(id, u) {
  const old = store.covers[id];
  if (u) store.covers[id] = u; else delete store.covers[id];
  if (!saveStore()) { if (old) store.covers[id] = old; else delete store.covers[id]; toast("Het geheugen van dit apparaat is vol"); return false; }
  toast(u ? "Omslag opgeslagen" : "Eigen omslag verwijderd");
  return true;
}
function coverSheet(hasOwn, apply) {
  const use = blob => imgToData(blob).then(apply).catch(() => toast("Dit bestand is geen afbeelding"));
  const s = document.createElement("div"); s.className = "sheet";
  s.innerHTML = `<div class="in"><div class="grab"></div>
    <p style="margin:4px 6px 8px;font:600 19px var(--f-d)">Omslag toevoegen</p>
    <button class="it" data-k="file"><span style="font-size:20px">🖼</span><span>Foto of afbeelding kiezen<small>Uit je galerij of bestanden, of maak een foto van het boek</small></span></button>
    <div class="fld" style="margin:12px 6px 4px"><label for="pz">Plakken op iPad of telefoon: tik in dit vak, tik nog een keer en kies ‘Plakken’</label>
      <div class="pastezone" id="pz" contenteditable="true" role="textbox" aria-label="Plak hier een afbeelding" autocapitalize="off" autocorrect="off" spellcheck="false" data-ph="Plak hier je afbeelding"></div></div>
    <button class="it" data-k="paste"><span style="font-size:20px">📋</span><span>Plakken met één tik<small>Werkt op de computer en de meeste Android-telefoons. Op de computer kan ook Ctrl+V</small></span></button>
    <div class="fld" style="margin:12px 6px 4px"><label for="covUrl">Of plak hier het webadres van een afbeelding</label><div style="display:flex;gap:8px"><input id="covUrl" type="url" placeholder="https://…" autocomplete="off"><button class="btn" data-k="url" style="flex:none">Gebruik</button></div></div>
    ${hasOwn ? `<button class="it" data-k="del"><span style="font-size:20px">×</span><span>Eigen omslag verwijderen</span></button>` : ""}
    <button class="it" data-k="x"><span style="font-size:20px">←</span><span>Annuleren</span></button></div>`;
  s.addEventListener("click", async e => {
    const it = e.target.closest("[data-k]");
    if (e.target === s) { s.remove(); return; }
    if (!it) return;
    const k = it.dataset.k;
    if (k === "url") {
      const v = $("#covUrl").value.trim();
      if (!/^https?:\/\//i.test(v)) { toast("Dat is geen geldig webadres"); return; }
      s.remove(); apply(v); return;
    }
    if (k !== "paste") s.remove();
    if (k === "del") apply(null);
    if (k === "file") { const f = document.createElement("input"); f.type = "file"; f.accept = "image/*"; f.onchange = () => { if (f.files[0]) use(f.files[0]); }; f.click(); }
    if (k === "paste") {
      try {
        for (const item of await navigator.clipboard.read()) {
          const ty = item.types.find(t => t.startsWith("image/"));
          if (ty) { s.remove(); use(await item.getType(ty)); return; }
          if (item.types.includes("text/plain")) { const tx = (await (await item.getType("text/plain")).text()).trim(); if (/^https?:\/\//i.test(tx)) { s.remove(); apply(tx); return; } }
        }
        toast("Er staat geen afbeelding op het klembord");
      } catch (err) { toast("Dit lukt hier niet. Tik in het vak hierboven en kies ‘Plakken’"); }
    }
  });
  /* iPad/iPhone: plakken kan daar alleen betrouwbaar in een invoervak, via het systeemmenu */
  const pz = s.querySelector("#pz");
  const fromImg = img => {
    const src = img.getAttribute("src") || ""; pz.innerHTML = "";
    if (/^https?:/i.test(src)) { s.remove(); apply(src); return; }
    fetch(src).then(r => r.blob()).then(b => { s.remove(); use(b); }).catch(() => toast("Deze afbeelding kan niet geplakt worden. Bewaar hem en kies ‘Foto of afbeelding kiezen’"));
  };
  pz.addEventListener("paste", e => {
    e.stopPropagation();
    const cd = e.clipboardData;
    let file = cd && [...(cd.files || [])].find(f => f.type.startsWith("image/"));
    if (!file && cd) { const it = [...(cd.items || [])].find(i => i.kind === "file" && i.type.startsWith("image/")); if (it) file = it.getAsFile(); }
    if (file) { e.preventDefault(); s.remove(); use(file); return; }
    const tx = cd ? (cd.getData("text/plain") || "").trim() : "";
    if (/^https?:\/\//i.test(tx)) { e.preventDefault(); s.remove(); apply(tx); return; }
    setTimeout(() => { const img = pz.querySelector("img"); if (img) fromImg(img); else { pz.innerHTML = ""; toast("Er staat geen afbeelding op het klembord"); } }, 80);
  });
  pz.addEventListener("input", () => { const img = pz.querySelector("img"); if (img) fromImg(img); });
  document.body.appendChild(s);
}
document.addEventListener("paste", e => {                       // Ctrl+V op de boekpagina of in het formulier
  if ((current !== "boek" || !lastBook) && current !== "nieuw") return;
  const item = [...((e.clipboardData && e.clipboardData.items) || [])].find(i => i.type.startsWith("image/"));
  if (!item) return;
  e.preventDefault();
  imgToData(item.getAsFile()).then(u => {
    if (current === "boek") { if (setCover(lastBook, u)) renderBook(BYID.get(lastBook)); }
    else setFormCover(u);
  }).catch(() => toast("Dit is geen afbeelding"));
});

/* ---------- Langere teksten: Wikipedia (schrijver) en Open Library (boek), opgehaald op het apparaat zelf ---------- */
const textCache = new Map();
/* Vertalen op de pagina zelf. Meerdere diensten achter elkaar: valt er één uit, dan neemt de volgende het over.
   Elke vertaling wordt op het apparaat bewaard, zodat dezelfde tekst maar één keer vertaald hoeft te worden. */
const NL_KEY = "pb-nl", TR_LABEL = "Vertaal naar Nederlands", trButton = `<button type="button" class="link tr">${TR_LABEL}</button>`;
let nlCache = lsGet(NL_KEY, {});
function tfetch(u) { const c = new AbortController(), t = setTimeout(() => c.abort(), 10000); return fetch(u, { signal: c.signal }).finally(() => clearTimeout(t)); }
const unEntity = s => new DOMParser().parseFromString(s, "text/html").documentElement.textContent;
const TRANSLATORS = [
  async s => { const r = await tfetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=nl&dt=t&q=" + encodeURIComponent(s)); if (!r.ok) throw new Error(r.status); return (await r.json())[0].map(x => x[0]).join(""); },
  async s => { const r = await tfetch("https://lingva.ml/api/v1/auto/nl/" + encodeURIComponent(s)); if (!r.ok) throw new Error(r.status); const t = (await r.json()).translation; if (!t) throw new Error("leeg"); return t; },
  async s => {
    const r = await tfetch("https://api.mymemory.translated.net/get?mt=1&langpair=en%7Cnl&q=" + encodeURIComponent(s)); if (!r.ok) throw new Error(r.status);
    const j = await r.json(), t = j.responseData && j.responseData.translatedText;
    if (+j.responseStatus !== 200 || j.quotaFinished || !t || /MYMEMORY WARNING|QUERY LENGTH/i.test(t)) throw new Error("limiet");
    return unEntity(t);
  }
];
function chunkText(t, max) {                                     // in stukken op zinsgrens, want de diensten begrenzen de lengte
  const out = []; let cur = "";
  const add = s => { if (cur && (cur + s).length > max) { out.push(cur.trim()); cur = ""; } cur += s; };
  for (const z of t.match(/[^.!?]+[.!?]*["')\]]*\s*/g) || [t]) { if (z.length <= max) add(z); else z.split(/(?<=\s)/).forEach(add); }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
async function translateAll(parts, progress) {
  const key = hash(parts.join("\n"));
  if (nlCache[key]) return nlCache[key];
  const chunks = parts.map(p => chunkText(p, 450)), total = chunks.reduce((n, c) => n + c.length, 0);
  let done = 0, svc = 0; const result = [];
  for (const list of chunks) {
    const nl = [];
    for (const c of list) {
      for (;;) {
        if (svc >= TRANSLATORS.length) throw new Error("geen dienst beschikbaar");
        try { nl.push(await TRANSLATORS[svc](c)); break; } catch (e) { svc++; }
      }
      progress(++done, total);
    }
    result.push(nl.join(" "));
  }
  nlCache[key] = result;
  if (!lsSet(NL_KEY, nlCache)) { nlCache = { [key]: result }; lsSet(NL_KEY, nlCache); }   // geheugen vol: oude vertalingen wissen
  return result;
}
function wireTranslate(box) {
  const btn = box.querySelector(".tr"); if (!btn) return;
  const els = [...box.querySelectorAll(".wiki p, .wiki h4")], orig = els.map(e => e.textContent);
  let nl = null, showing = false, busy = false;
  btn.onclick = async () => {
    if (busy) return;
    if (showing) { els.forEach((e, i) => e.textContent = orig[i]); showing = false; btn.textContent = TR_LABEL; return; }
    if (!nl) {
      busy = true;
      try { nl = await translateAll(orig, (d, n) => btn.textContent = `Vertalen… ${d} van ${n}`); }
      catch (e) { toast("Vertalen lukt nu even niet. Probeer het later nog eens"); btn.textContent = TR_LABEL; return; }
      finally { busy = false; }
    }
    els.forEach((e, i) => e.textContent = nl[i]); showing = true; btn.textContent = "Toon origineel";
  };
}
const looksDutch = t => { const c = re => (t.match(re) || []).length; return c(/\b(het|een|zijn|naar|voor|haar|wordt)\b/gi) > c(/\b(the|and|was|with|for|her|his)\b/gi); };
/* Samenvatting zoeken: eerst Apple Books (vaak Nederlandse flapteksten), dan Open Library */
function stripHtml(s) { return unEntity(String(s).replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n")).replace(/\n{3,}/g, "\n\n").trim(); }
async function olDescription(key) {
  const r = await tfetch("https://openlibrary.org/works/" + key + ".json");
  if (!r.ok) throw new Error(r.status);
  const j = await r.json(), d = typeof j.description === "string" ? j.description : (j.description && j.description.value) || "";
  return d.split(/\n-{3,}|\n\*{3,}/)[0].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\[\d+\]:\s*\S+/g, "").trim();
}
async function findSummary(q) {
  const key = "s|" + q.a + "|" + q.t;
  if (textCache.has(key)) return textCache.get(key);
  const ln = lastName(q.a).replace(/&.*/, "").trim(); let res = null, failed = false;
  const viaApple = async (t, c) => {
    try { const h = await appleFind(t, ln, c), d = h && h.description ? stripHtml(h.description) : ""; if (d.length > 40) return { t: d, src: "Apple Books", url: h.trackViewUrl }; }
    catch (e) { failed = true; }
    return null;
  };
  res = await viaApple(q.t, "NL");
  if (!res && q.o && tkey(q.o) !== tkey(q.t)) res = await viaApple(q.o, "NL");
  if (!res && q.wk) { try { const d = await olDescription(q.wk); if (d.length > 40) res = { t: d, src: "Open Library", url: "https://openlibrary.org/works/" + q.wk }; } catch (e) { failed = true; } }
  if (!res) res = await viaApple(q.o || q.t, "US");
  if (res || !failed) textCache.set(key, res);       // bij een storing niet onthouden, dan wordt het later opnieuw geprobeerd
  return res;
}
function shortText(t) {                                  // korte versie: de eerste zinnen, tot zo'n 400 tekens
  if (t.replace(/\s+/g, " ").length <= 520) return null;
  let out = "";
  for (const z of t.replace(/\s*\n\s*/g, " ").match(/[^.!?]+[.!?]+["')\]]*\s*/g) || []) { out += z; if (out.length >= 380) break; }
  return out.length >= 80 && out.length < t.length * .9 ? out.trim() : null;
}
async function loadSummary(q, box, opt) {
  const { onNone, onFound } = opt || {};
  let r;
  try { r = await findSummary(q); } catch (e) { r = null; }
  if (!box.isConnected) return;
  if (!r) { if (onNone) onNone(); else box.innerHTML = `<p class="none">Er is nog geen samenvatting van dit boek gevonden.</p>`; return; }
  if (onFound) onFound();
  const sh = shortText(r.t), draw = full => {
    const text = full || !sh ? r.t : sh;
    box.innerHTML = `<div class="wiki">${text.split(/\n\s*\n/).map(p => `<p>${esc(p)}</p>`).join("")}</div>
      <p class="src">${sh && !full ? `<button type="button" class="link more">Lees verder</button> · ` : ""}Bron: <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.src)}</a>${looksDutch(r.t) ? "" : " · " + trButton}</p>`;
    wireTranslate(box);
    const m = box.querySelector(".more"); if (m) m.onclick = () => draw(true);
  };
  draw(false);
}
const WIKI_STOP = /^(bibliografie|bibliography|werken|works|boeken|books|novels|romans|thrillers|externe links?|external links|referenties|references|bronnen|bron|zie ook|see also|publicaties|publications|selected|filmografie|filmography|prijzen|awards|notes|voetnoten|verfilmingen|adaptations|nederlandse vertalingen)\b/i;
async function loadWiki(a, box) {
  const w = (window.WIKI || {})[a]; if (!w) return;
  const [lang, title] = [w.slice(0, 2), w.slice(3)], url = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  try {
    let paras = textCache.get(w);
    if (!paras) {
      const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=extracts&explaintext=1&exsectionformat=plain&redirects=1&titles=${encodeURIComponent(title)}`);
      if (!r.ok) throw new Error(r.status);
      const page = Object.values((await r.json()).query.pages)[0], lines = String(page.extract || "").split("\n").map(s => s.trim()).filter(Boolean);
      paras = []; let n = 0;
      for (const l of lines) {
        const head = l.length < 60 && !/[.!?:]$/.test(l);
        if (head && WIKI_STOP.test(l)) break;
        if (n > 3500 && !head) break;
        paras.push({ h: head, t: l }); if (!head) n += l.length;
      }
      while (paras.length && paras[paras.length - 1].h) paras.pop();
      textCache.set(w, paras);
    }
    if (!box.isConnected || !paras.length) return;
    const total = paras.reduce((s, p) => s + p.t.length, 0), own = store.bios[a] !== undefined;
    if (lang === "nl" && total < bio(a).length * 1.3) { box.innerHTML = `<p class="src"><a href="${url}" target="_blank" rel="noopener">Meer op Wikipedia</a></p>`; return; }
    if (lang === "nl" && !own) $("#bioBox").innerHTML = "";
    box.innerHTML = `<div class="wiki">${paras.map(p => p.h ? `<h4>${esc(p.t)}</h4>` : `<p>${esc(p.t)}</p>`).join("")}</div>
      <p class="src">Bron: <a href="${url}" target="_blank" rel="noopener">Wikipedia</a> (tekst onder CC BY-SA)${lang === "en" ? " · " + trButton : ""}</p>`;
    wireTranslate(box);
  } catch (e) { /* geen verbinding: de korte bio blijft staan */ }
}
function setField(id, obj) {
  const added = store.added.find(x => x.id === id);
  if (added) Object.assign(added, obj); else store.edits[id] = Object.assign(store.edits[id] || {}, obj);
  saveStore(); rebuild();
}

/* ---------- Schrijver ---------- */
let authorFilter = "alle";
/* Alle boeken van een schrijver: Petra's boeken + de bibliografie (Open Library), op jaar */
function authorTimeline(a) {
  const mine = BOOKS.filter(b => b.a === a), used = new Set(), rows = [];
  ((window.BIBLIO || {})[a] || []).forEach(([title, year, c, wk]) => {
    const k = tkey(title);
    const m = mine.find(b => !used.has(b.id) && (tkey(b.o) === k || tkey(b.t) === k));
    if (m) { used.add(m.id); rows.push({ b: m, y: m.j || year }); }
    else if (!rows.some(r => !r.b && tkey(r.title) === k)) rows.push({ title, y: year, c, wk });
  });
  mine.filter(b => !used.has(b.id)).forEach(b => rows.push({ b, y: b.j || 0 }));
  (((window.NIEUW || {}).boeken) || []).filter(n => n.a === a && !inKast(n)).forEach(n => {     // aangekondigde boeken
    const ex = rows.find(r => !r.b && tkey(r.title) === tkey(n.t));
    if (ex) ex.soon = n.d; else rows.push({ title: n.t, y: +n.d.slice(0, 4), c: n.c, wk: "", soon: n.d });
  });
  return rows.sort((x, y) => (x.y || 9999) - (y.y || 9999) || ((x.b && x.b.n) || 0) - ((y.b && y.b.n) || 0));
}
function renderAuthor(a) {
  const bs = BOOKS.filter(b => b.a === a);
  const nm = niceName(a), read = bs.filter(b => !b.w).length;
  const rows = authorTimeline(a), nOther = rows.filter(r => !r.b).length, hasBib = !!(window.BIBLIO || {})[a];
  const shown = rows.filter(r => authorFilter === "alle" || (r.b && !r.b.w));
  const ini = nm.split(/\s+/).filter(w => /^[A-ZÀ-Ý]/.test(w)).map(w => w[0]).slice(0, 1).concat(lastName(a)[0] || "").join("").slice(0, 2).toUpperCase();
  const gs = [...new Set(bs.map(b => b.g).filter(Boolean))];
  $("#sBar").textContent = nm;
  const bt = bio(a);
  $("#sBody").innerHTML = `
    <div class="ahead"><div class="ini">${esc(ini)}</div><h1>${esc(nm)}</h1>
      <div class="meta">${read} gelezen${bs.length > read ? " · " + (bs.length - read) + " op de wensenlijst" : ""}${gs.length ? " · " + esc(gs.join(", ")) : ""}</div></div>
    <div class="sec"><h3>Over de schrijver</h3><div id="bioBox">${bt ? `<p>${esc(bt)}</p>` : `<p class="none">Nog geen bio. Tik op het potlood om er een te schrijven.</p>`}</div><div id="wikiBox"></div></div>
    <div class="sec"><h3>${hasBib ? "Alle boeken op jaar van verschijnen" : "Boeken op jaar van verschijnen"}</h3>
      ${nOther ? `<div class="legend"><span><i style="background:var(--acc2)"></i>Gelezen (${read})</span><span><i style="border:2px solid var(--faint)"></i>Nog niet gelezen (${nOther})</span>${bs.length > read ? `<span><i style="background:var(--gold)"></i>Wensenlijst</span>` : ""}</div>
      <div class="chips" style="padding-top:2px"><button class="chip" data-f="alle" aria-pressed="${authorFilter === "alle"}">Alle boeken</button><button class="chip" data-f="gel" aria-pressed="${authorFilter === "gel"}">Alleen gelezen</button></div>` : ""}
      <ul class="tl">${shown.map((r, i) => r.b ? `<li class="read"><a href="#/boek/${r.b.id}"><span class="y">${r.y || "?"}</span><span class="dot"></span><span class="th">${coverHTML(r.b)}</span><span class="tt"><b>${esc(r.b.t)}</b>${subHTML(r.b, "")}</span>${r.b.w ? `<span class="ok w">Wens</span>` : `<span class="ok">✓ Gelezen</span>`}</a></li>`
        : `<li class="unread"><a href="#/titel/${encodeURIComponent(a + "|" + r.title)}"><span class="y">${r.y || "?"}</span><span class="dot"></span>${r.c ? `<span class="th"><img loading="lazy" alt="" referrerpolicy="no-referrer" src="${olCover(r.c, "S")}"></span>` : `<span class="ph2" data-find="${rows.indexOf(r)}">+</span>`}<span class="tt"><b>${esc(r.title)}</b>${r.soon && r.soon > todayISO() ? `<small>Verschijnt ${nlDate(r.soon)}</small>` : ""}</span></a></li>`).join("")}</ul>
      ${hasBib ? `<p class="src">De niet-gelezen boeken komen uit openbare boekencatalogi. De lijst kan onvolledig zijn of verzamelbundels bevatten. Tik op een titel voor de samenvatting, of om hem als gelezen of als wens toe te voegen.</p>` : ""}</div>`;
  hydrate($("#sBody"));
  loadWiki(a, $("#wikiBox"));
  $("#sBody").querySelectorAll("[data-find]").forEach(el => {     // ongelezen boeken zonder omslag: alsnog opzoeken
    const r = rows[+el.dataset.find];
    getCover({ a, t: r.title, o: r.title }).then(u => {
      if (!u || !el.isConnected) return;
      r.u = u; const th = document.createElement("span"); th.className = "th"; th.innerHTML = `<img alt="" referrerpolicy="no-referrer" src="${esc(u)}">`; el.replaceWith(th);
    });
  });
  $("#sBody").querySelectorAll(".chip[data-f]").forEach(c => c.onclick = () => { authorFilter = c.dataset.f; renderAuthor(a); });
  $("#sEdit").onclick = () => {
    $("#bioBox").innerHTML = `<textarea class="memo" id="bioTa" style="min-height:160px">${esc(bio(a))}</textarea><div class="acts"><button class="btn pri" id="bioOk">Bio opslaan</button></div>`;
    $("#bioTa").focus();
    $("#bioOk").onclick = () => { store.bios[a] = $("#bioTa").value.trim(); saveStore(); toast("Bio opgeslagen"); renderAuthor(a); };
  };
}

/* Pagina van een nog niet gelezen boek uit de bibliografie */
function renderUnread(a, title) {
  const r = authorTimeline(a).find(x => !x.b && tkey(x.title) === tkey(title));
  if (!r) { history.replaceState(null, "", "#/schrijver/" + encodeURIComponent(a)); route(); return; }
  lastBook = null;
  const pseudo = { id: "", a, t: r.title, o: "", g: "", cid: r.c || 0 };
  $("#bBar").textContent = r.title;
  $("#bEdit").classList.add("hidden");
  $("#bBody").innerHTML = `
    <div class="top"><div class="big">${coverHTML(pseudo)}</div>
      <div><h1>${esc(r.title)}</h1>
      <a class="by" href="#/schrijver/${encodeURIComponent(a)}">${esc(niceName(a))}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></a></div></div>
    <div class="facts">${r.soon && r.soon > todayISO() ? `<div class="fact"><small>Verschijnt</small><span>${esc(nlDate(r.soon))}</span></div><div class="fact"><small>Status</small><span>Aangekondigd</span></div>` : `<div class="fact"><small>Verschenen</small><span>${r.y || "onbekend"}</span></div><div class="fact"><small>Status</small><span>Nog niet gelezen</span></div>`}</div>
    <div class="sec"><h3>Samenvatting</h3><div id="descBox"><p class="none">Samenvatting zoeken…</p></div></div>
    <div class="acts"><button class="btn pri" id="uGel">✓ Gelezen</button><button class="btn" id="uWens">♡ Op de wensenlijst</button></div>`;
  const el = $("#bBody .cov");
  getCover(pseudo).then(u => {
    if (!u || !el.isConnected) return;
    const img = new Image(); img.alt = ""; img.referrerPolicy = "no-referrer"; img.onload = () => { if (img.naturalWidth > 20) { img.className = "ok"; el.classList.add("has"); } else img.remove(); }; img.onerror = () => img.remove(); img.src = u; el.appendChild(img);
  });
  loadSummary({ a, t: r.title, o: "", wk: r.wk }, $("#descBox"));
  const add = w => {
    const id = "u" + Date.now().toString(36);
    store.added.push({ id, a, t: r.title, o: r.title, s: "", n: 0, g: "", j: r.y || 0, z: "", memo: "", w, cid: r.c || 0, wk: r.wk || "" });
    saveStore(); rebuild(); openSet.add(a); lsSet("pb-open", [...openSet]);
    if (w) { toast("Op de wensenlijst gezet"); history.replaceState(null, "", "#/boek/" + id); }
    else { fillHint = true; history.replaceState(null, "", "#/bewerk/" + id); }
    route();
  };
  $("#uGel").onclick = () => add(false);
  $("#uWens").onclick = () => add(true);
}

/* ---------- Toevoegen / bewerken ---------- */
let editing = null, fillHint = false;
const allAuthors = () => [...new Set(BOOKS.map(x => x.a))].sort((x, y) => sortKey(x).localeCompare(sortKey(y), "nl"));
function knownNote() {
  const v = norm($("#fA").value), a = allAuthors().find(x => norm(x) === v || norm(niceName(x)) === v);
  const n = a ? BOOKS.filter(b => b.a === a && !b.w).length : 0;
  $("#knownA").classList.toggle("hidden", !a);
  if (a) $("#knownA").textContent = "✓ " + niceName(a) + " staat al in de lijst (" + n + " gelezen)";
}
function suggest() {
  const v = norm($("#fA").value), ul = $("#sgA");
  if (!v) { ul.classList.add("hidden"); knownNote(); return; }
  const hits = allAuthors().filter(a => norm(a).includes(v) || norm(niceName(a)).includes(v)).slice(0, 8);
  const exact = hits.length === 1 && (norm(hits[0]) === v || norm(niceName(hits[0])) === v);
  ul.innerHTML = hits.map((a, i) => `<li><button type="button" data-a="${esc(a)}" class="${i ? "" : "on"}"><span>${esc(niceName(a))}</span><small>${BOOKS.filter(b => b.a === a && !b.w).length} gelezen</small></button></li>`).join("");
  ul.classList.toggle("hidden", !hits.length || exact);
  knownNote();
}
$("#fA").addEventListener("input", suggest);
$("#fA").addEventListener("focus", suggest);
$("#fA").addEventListener("blur", () => setTimeout(() => $("#sgA").classList.add("hidden"), 200));
$("#fA").addEventListener("keydown", e => {
  const ul = $("#sgA"); if (ul.classList.contains("hidden")) return;
  const bs = [...ul.querySelectorAll("button")], i = bs.findIndex(b => b.classList.contains("on"));
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); bs.forEach(b => b.classList.remove("on")); bs[(i + (e.key === "ArrowDown" ? 1 : bs.length - 1)) % bs.length].classList.add("on"); }
  if (e.key === "Enter" && i >= 0) { e.preventDefault(); bs[i].click(); }
});
$("#sgA").addEventListener("mousedown", e => e.preventDefault());
$("#sgA").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  $("#fA").value = b.dataset.a; $("#sgA").classList.add("hidden"); knownNote(); $("#fT").focus();
});
function setFormCover(u) { pendingCover = u; $("#fCov").innerHTML = u ? `<img alt="" referrerpolicy="no-referrer" src="${esc(u)}">` : ""; toast(u ? "Omslag klaargezet, sla het boek op" : "Omslag weggehaald"); }
$("#fCovBtn").onclick = () => coverSheet(!!pendingCover || !!(editing && store.covers[editing.id]), setFormCover);
function renderForm(b) {
  editing = b;
  pendingCover = undefined;
  $("#fCov").innerHTML = b ? coverHTML(b) : ""; if (b) hydrate($("#fCov"));
  $("#fTitle").textContent = b ? (fillHint ? "Boek aanvullen" : "Boek bewerken") : "Boek toevoegen";
  $("#dlS").innerHTML = [...new Set(BOOKS.map(x => x.s).filter(s => s && s !== "-"))].sort().map(s => `<option value="${esc(s)}">`).join("");
  $("#dlG").innerHTML = [...new Set(BOOKS.map(x => x.g).filter(Boolean))].sort().map(s => `<option value="${esc(s)}">`).join("");
  const v = b || { a: "", t: "", o: "", s: "", n: "", g: "", j: "", z: "", memo: "", w: tab === "wens" };
  $("#fA").value = v.a; $("#fT").value = v.t; $("#fO").value = v.o && v.o !== "-" ? v.o : ""; $("#fS").value = v.s && v.s !== "-" ? v.s : "";
  $("#fN").value = v.n || ""; $("#fG").value = v.g || ""; $("#fJ").value = v.j || ""; $("#fZ").value = v.z || ""; $("#fM").value = v.memo || ""; $("#fW").checked = !!v.w;
  $("#fDel").classList.toggle("hidden", !b);
  $("#sgA").classList.add("hidden"); knownNote();
  if (!b) setTimeout(() => $("#fA").focus(), 50);
  if (fillHint) { fillHint = false; toast("Toegevoegd! Vul nu de Nederlandse titel en de rest aan"); setTimeout(() => { $("#fT").focus(); $("#fT").select(); }, 80); }
}
$("#form").addEventListener("submit", e => {
  e.preventDefault();
  const a = $("#fA").value.replace(/\s+/g, " ").trim(), t = $("#fT").value.replace(/\s+/g, " ").trim();
  if (!a || !t) return;
  const d = { a, t, o: $("#fO").value.trim(), s: $("#fS").value.trim(), n: +$("#fN").value || 0, g: $("#fG").value.trim(), j: +$("#fJ").value || 0, z: $("#fZ").value.trim(), memo: $("#fM").value, w: $("#fW").checked };
  let id;
  if (editing) { id = editing.id; setField(id, d); toast("Wijzigingen opgeslagen"); }
  else {
    const dup = BOOKS.find(x => norm(x.a) === norm(a) && norm(x.t) === norm(t));
    if (dup && !confirm("‘" + t + "’ van " + niceName(a) + " staat al in de lijst. Toch toevoegen?")) return;
    id = "u" + Date.now().toString(36); store.added.push(Object.assign({ id }, d)); saveStore(); rebuild();
    toast("‘" + t + "’ toegevoegd");
  }
  if (pendingCover !== undefined) setCover(id, pendingCover);
  openSet.add(a); lsSet("pb-open", [...openSet]);
  history.replaceState(null, "", "#/boek/" + id); route();
});
$("#fDel").onclick = () => {
  if (!editing || !confirm("‘" + editing.t + "’ uit de lijst verwijderen?")) return;
  const id = editing.id;
  if (store.added.some(x => x.id === id)) store.added = store.added.filter(x => x.id !== id);
  else store.deleted.push(id);
  delete store.edits[id]; saveStore(); rebuild(); toast("Verwijderd");
  history.replaceState(null, "", "#/lijst"); route();
};

/* ---------- Menu: backup, thema, omslagen ---------- */
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("on"), 2200); }
const APP = { versie: "1.8", datum: "8 november 2026" };   // bij elke update aanpassen
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>';
const isDark = () => { const t = lsGet("pb-theme", "auto"); return t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches); };
function applyTheme() {
  const t = lsGet("pb-theme", "auto"); if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = t;
  const b = $("#themeBtn"); if (b) { b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${isDark() ? SUN : MOON}</svg>`; b.setAttribute("aria-label", isDark() ? "Lichte weergave" : "Donkere weergave"); }
}
applyTheme();
$("#themeBtn").onclick = () => { lsSet("pb-theme", isDark() ? "light" : "dark"); applyTheme(); };
/* Gelezen boeken naar Excel (.xlsx via SheetJS; zonder internet: .csv die Excel ook opent) */
async function exportExcel(withWishes) {
  const rows = BOOKS.filter(b => withWishes || !b.w).sort((x, y) => sortKey(x.a).localeCompare(sortKey(y.a), "nl") || sortKey(x.t).localeCompare(sortKey(y.t), "nl", { numeric: true }))
    .map(b => ({ "Auteur": b.a, "Nederlandse titel": b.t, "Oorspronkelijke titel": enTitle(b), "Serie": hasSeries(b) ? b.s : "", "Deel": b.n || "", "Genre": b.g || "", "Jaar": b.j || "", "Samenvatting": b.z || "", "Memo": b.memo || "", "Status": b.w ? "Wensenlijst" : "Gelezen" }));
  const name = "Peet's boekenkast " + new Date().toISOString().slice(0, 10);
  try {
    if (!window.XLSX) await new Promise((ok, fail) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [28, 40, 40, 26, 6, 18, 6, 60, 40, 12].map(w => ({ wch: w }));
    ws["!autofilter"] = { ref: ws["!ref"] };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Gelezen boeken");
    XLSX.writeFile(wb, name + ".xlsx");
  } catch (e) {
    const cols = Object.keys(rows[0] || {}), q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const csv = "﻿" + [cols.join(";")].concat(rows.map(r => cols.map(c => q(r[c])).join(";"))).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = name + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  toast(rows.length + " boeken geëxporteerd");
}
$("#menuBtn").onclick = () => {
  const th = lsGet("pb-theme", "auto"), ic = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const s = document.createElement("div"); s.className = "sheet";
  s.innerHTML = `<div class="in"><div class="grab"></div>
    <button class="it" data-k="sync"><span style="font-size:20px">🔄</span><span>Synchroniseren<small>${syncCfg ? esc(syncStatus()) : "Gelijk houden op telefoon, iPad en computer"}</small></span></button>
    <button class="it" data-k="xls">${ic('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M9 13l4 5M13 13l-4 5"/>')}<span>Exporteren naar Excel<small>Alle gelezen boeken met schrijver, titels, serie, jaar en memo</small></span></button>
    <button class="it" data-k="xlsw">${ic('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>')}<span>Exporteren naar Excel, met wensenlijst<small>Gelezen boeken én de wensenlijst in één bestand</small></span></button>
    <button class="it" data-k="exp">${ic('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/>')}<span>Backup opslaan<small>Bewaar memo's, nieuwe boeken en wijzigingen als bestand</small></span></button>
    <button class="it" data-k="imp">${ic('<path d="M12 15V3m0 0L8 7m4-4 4 4M4 17v3h16v-3"/>')}<span>Backup terugzetten<small>Bijvoorbeeld van de telefoon naar de iPad</small></span></button>
    <button class="it" data-k="theme">${ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')}<span>Weergave automatisch${th === "auto" ? " (nu aan)" : ""}<small>Licht of donker volgens de instelling van het apparaat. Met de zon/maan-knop kies je het zelf.</small></span></button>
    <button class="it" data-k="cov">${ic('<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>')}<span>Omslagen opnieuw zoeken<small>Als er een verkeerde of geen voorkant wordt getoond</small></span></button>
    <div class="about"><b>Peet's boekenkast<svg class="lelie" aria-hidden="true"><use href="#lelie"/></svg></b><span>De boeken van Petra Zwijgers</span>
      <span>Versie ${APP.versie} · laatst bijgewerkt ${APP.datum}</span>
      <span>${BOOKS.filter(b => !b.w).length} gelezen boeken · ${new Set(BOOKS.filter(b => !b.w).map(b => b.a)).size} schrijvers · ${BOOKS.filter(b => b.w).length} op de wensenlijst</span>
      <span>Gemaakt met liefde door Barry Zwijgers ♥</span></div></div>`;
  s.addEventListener("click", e => {
    const it = e.target.closest(".it");
    if (e.target === s || it) s.remove();
    if (!it) return;
    const k = it.dataset.k;
    if (k === "sync") openSync();
    if (k === "xls" || k === "xlsw") exportExcel(k === "xlsw");
    if (k === "exp") exportData();
    if (k === "imp") $("#impFile").click();
    if (k === "theme") { lsSet("pb-theme", "auto"); applyTheme(); toast("Weergave volgt nu de instelling van het apparaat"); }
    if (k === "cov") { covers = {}; lsSet(COV_KEY, {}); document.querySelectorAll(".cov").forEach(el => { el.classList.remove("has"); el.querySelectorAll("img").forEach(i => i.remove()); delete el.dataset.h; }); hydrate(document); toast("Omslagen worden opnieuw gezocht"); }
  });
  document.body.appendChild(s);
};
function exportData() {
  const blob = new Blob([JSON.stringify({ app: "petra-boekenlijst", versie: 1, datum: new Date().toISOString(), data: store }, null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "peets-boekenkast-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast("Backup opgeslagen");
}
$("#impFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== "petra-boekenlijst" || !j.data) throw new Error();
    if (!confirm("Backup van " + (j.datum || "").slice(0, 10) + " terugzetten? De huidige aanpassingen op dit apparaat worden vervangen.")) return;
    store = Object.assign({ edits: {}, added: [], deleted: [], bios: {}, covers: {} }, j.data); saveStore(); rebuild(); route(); toast("Backup teruggezet");
  } catch (err) { alert("Dit is geen geldige backup van Peet's boekenkast."); }
});

/* ---------- Synchroniseren tussen apparaten ----------
   Via een bestand in een privé-repository op GitHub, net als de concert-app. De koppelcode (eigenaar/repository/token)
   wordt alleen op het apparaat zelf bewaard. Per onderdeel wint de laatste wijziging. */
const SYNC_FILE = "peets-boekenkast.json", SYNC_KEY = "pb-sync", SYNC_STATE = "pb-sync-state";
let syncCfg = lsGet(SYNC_KEY, null), syncState = Object.assign({ ts: {}, h: {} }, lsGet(SYNC_STATE, {})), syncBusy = false, syncTimer = 0;
function flatStore(st) {
  const m = {};
  Object.entries(st.edits || {}).forEach(([k, v]) => m["e|" + k] = JSON.stringify(v));
  (st.added || []).forEach(v => m["a|" + v.id] = JSON.stringify(v));
  (st.deleted || []).forEach(id => m["d|" + id] = "1");
  Object.entries(st.bios || {}).forEach(([k, v]) => m["b|" + k] = JSON.stringify(v));
  Object.entries(st.covers || {}).forEach(([k, v]) => m["c|" + k] = v);
  return m;
}
function unflatStore(m) {
  const st = { edits: {}, added: [], deleted: [], bios: {}, covers: {} };
  Object.entries(m).forEach(([key, v]) => {
    const i = key.indexOf("|"), t = key.slice(0, i), k = key.slice(i + 1);
    if (t === "e") st.edits[k] = JSON.parse(v); else if (t === "a") st.added.push(JSON.parse(v)); else if (t === "d") st.deleted.push(k);
    else if (t === "b") st.bios[k] = JSON.parse(v); else if (t === "c") st.covers[k] = v;
  });
  return st;
}
function stampChanges() {                                     // onthoudt per onderdeel wanneer het voor het laatst veranderde
  const m = flatStore(store), now = Date.now();
  new Set([...Object.keys(m), ...Object.keys(syncState.h)]).forEach(k => {
    const h = m[k] === undefined ? null : hash(m[k]);
    if ((syncState.h[k] ?? null) !== h) { syncState.h[k] = h; syncState.ts[k] = now; }
  });
  lsSet(SYNC_STATE, syncState);
}
function syncChanged() { stampChanges(); if (syncCfg) { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), 4000); } }
function mergeDoc(doc) {
  stampChanges();
  const mine = flatStore(store), items = doc.items || {}, rts = doc.ts || {}, out = {}, ts = {};
  let localChanged = false, remoteChanged = false;
  new Set([...Object.keys(mine), ...Object.keys(items), ...Object.keys(rts), ...Object.keys(syncState.ts)]).forEach(k => {
    const tl = syncState.ts[k] || 0, tr = rts[k] || 0, remote = tr > tl, v = remote ? items[k] : mine[k];
    ts[k] = Math.max(tl, tr);
    if (v !== undefined) out[k] = v;
    if (remote && items[k] !== mine[k]) localChanged = true;
    if (tl > tr || (!remote && items[k] !== mine[k])) remoteChanged = true;
  });
  syncState.ts = ts;
  if (localChanged) {
    store = unflatStore(out); lsSet(STORE_KEY, store); rebuild();
    syncState.h = {}; Object.entries(out).forEach(([k, v]) => syncState.h[k] = hash(v));
    Object.keys(ts).forEach(k => { if (out[k] === undefined) syncState.h[k] = null; });
  }
  lsSet(SYNC_STATE, syncState);
  return { localChanged, remoteChanged, out };
}
const utf8ToB64 = s => { const b = new TextEncoder().encode(s); let r = ""; for (let i = 0; i < b.length; i += 8192) r += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(r); };
const b64ToUtf8 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0)));
function ghFetch(cfg, path, opt) {
  return fetch("https://api.github.com/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) + path, Object.assign({ cache: "no-store" }, opt, { headers: Object.assign({ Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json" }, (opt || {}).headers) }));
}
async function syncNow(manual) {
  if (!syncCfg || syncBusy) return;
  syncBusy = true; const cfg = syncCfg;
  const finish = err => { syncBusy = false; syncCfg = cfg; if (err) cfg.err = err; else { delete cfg.err; cfg.last = new Date().toISOString(); } lsSet(SYNC_KEY, cfg); if (manual) toast(err || "Gesynchroniseerd"); const st = $("#syncSt"); if (st) st.textContent = syncStatus(); };
  try {
    for (let poging = 0; poging < 2; poging++) {
      const r = await ghFetch(cfg, "/contents/" + SYNC_FILE);
      if (r.status === 401 || r.status === 403) return finish("Geen toegang: controleer de koppelcode");
      if (!r.ok && r.status !== 404) return finish("Synchroniseren lukt nu niet (" + r.status + ")");
      let doc = { items: {}, ts: {} }, sha;
      if (r.ok) {
        const j = await r.json(); sha = j.sha;
        const text = j.content ? b64ToUtf8(j.content) : await (await ghFetch(cfg, "/contents/" + SYNC_FILE, { headers: { Accept: "application/vnd.github.raw+json" } })).text();
        doc = JSON.parse(text);
      }
      const { localChanged, remoteChanged, out } = mergeDoc(doc);
      if (localChanged) { const a = document.activeElement; if (!(a && /INPUT|TEXTAREA/.test(a.tagName)) && !document.querySelector(".sheet")) route(); }
      if (!remoteChanged) return finish();
      const put = await ghFetch(cfg, "/contents/" + SYNC_FILE, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ message: "Boekenkast bijgewerkt", content: utf8ToB64(JSON.stringify({ v: 1, items: out, ts: syncState.ts })) }, sha ? { sha } : {})) });
      if (put.ok) return finish();
      if (put.status !== 409 && put.status !== 422) return finish("Opslaan lukt nu niet (" + put.status + ")");
    }
    finish("Synchroniseren lukt nu niet, probeer het zo nog eens");
  } catch (e) { finish("Geen verbinding met GitHub"); }
}
function syncStatus() { if (!syncCfg) return ""; if (syncCfg.err) return "Laatste poging mislukt: " + syncCfg.err; return syncCfg.last ? "Laatst bijgewerkt: " + new Date(syncCfg.last).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" }) : "Nog niet gesynchroniseerd"; }
function openSync() {
  const s = document.createElement("div"); s.className = "sheet";
  const body = syncCfg
    ? `<p style="margin:0 6px 4px">Gekoppeld met <b>${esc(syncCfg.owner)}/${esc(syncCfg.repo)}</b></p><p class="src" id="syncSt" style="margin:0 6px 12px">${esc(syncStatus())}</p>
       <div class="acts" style="margin:8px 6px"><button class="btn pri" data-s="now">Nu synchroniseren</button></div>
       <button class="it" data-s="copy"><span style="font-size:20px">🔗</span><span>Koppelcode kopiëren<small>Plak die op je andere apparaat. Deel de code met niemand anders.</small></span></button>
       <button class="it" data-s="off"><span style="font-size:20px">×</span><span>Ontkoppelen<small>Je gegevens op dit apparaat blijven gewoon staan</small></span></button>`
    : `<p style="margin:0 6px 10px;color:var(--muted);font-size:14px">Houd memo's, nieuwe boeken, wijzigingen en eigen omslagen gelijk op telefoon, iPad en computer. Dit werkt met een <b>privé</b>-repository op GitHub, net als je concert-app.</p>
       <div class="fld" style="margin:0 6px 8px"><label for="syncCode">Koppelcode: eigenaar/repository/token</label><input id="syncCode" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="eigenaar/repository/github_pat_…"></div>
       <p class="src" id="syncSt" style="margin:0 6px 8px"></p>
       <div class="acts" style="margin:8px 6px"><button class="btn pri" data-s="link">Koppelen</button></div>`;
  s.innerHTML = `<div class="in"><div class="grab"></div><p style="margin:4px 6px 10px;font:600 19px var(--f-d)">Synchroniseren</p>${body}<button class="it" data-s="x"><span style="font-size:20px">←</span><span>Sluiten</span></button></div>`;
  s.addEventListener("click", async e => {
    if (e.target === s) { s.remove(); return; }
    const k = (e.target.closest("[data-s]") || { dataset: {} }).dataset.s; if (!k) return;
    if (k === "x") s.remove();
    if (k === "now") syncNow(true);
    if (k === "copy") { try { await navigator.clipboard.writeText(`${syncCfg.owner}/${syncCfg.repo}/${syncCfg.token}`); toast("Koppelcode gekopieerd"); } catch (err) { toast("Kopiëren lukt hier niet"); } }
    if (k === "off" && confirm("Dit apparaat ontkoppelen?")) { syncCfg = null; localStorage.removeItem(SYNC_KEY); s.remove(); toast("Ontkoppeld"); }
    if (k === "link") {
      const p = $("#syncCode").value.trim().split("/"), st = $("#syncSt");
      if (p.length !== 3 || !p[0] || !p[1] || !p[2]) { st.textContent = "Vul de code in als eigenaar/repository/token"; return; }
      const cfg = { owner: p[0], repo: p[1], token: p[2] };
      st.textContent = "Bezig met controleren…";
      try {
        const r = await ghFetch(cfg, "");
        if (!r.ok) { st.textContent = r.status === 404 || r.status === 401 ? "Repository niet gevonden of token klopt niet" : "GitHub gaf fout " + r.status; return; }
        const j = await r.json();
        if (!j.private) { st.textContent = "Deze repository is openbaar. Kies een privé-repository, anders kan iedereen je memo's en de code lezen."; return; }
        syncCfg = cfg; lsSet(SYNC_KEY, cfg); s.remove(); toast("Gekoppeld"); syncNow(true);
      } catch (err) { st.textContent = "Geen verbinding met GitHub"; }
    }
  });
  document.body.appendChild(s);
}

/* ---------- Start ---------- */
route();
if (syncCfg) setTimeout(() => syncNow(false), 1500);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && syncCfg) syncNow(false); });
let rsT = 0; addEventListener("resize", () => { clearTimeout(rsT); rsT = setTimeout(() => { if (current === "start") renderStart(); }, 300); });
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => { });
