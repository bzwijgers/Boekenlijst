/* Petra's Boekenlijst — app-logica
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
let store = Object.assign({ edits: {}, added: [], deleted: [], bios: {} }, lsGet(STORE_KEY, {}));
const saveStore = () => lsSet(STORE_KEY, store);

const BASE = [];
(window.BOEKEN || []).forEach(b => BASE.push({ id: "b" + hash(b.a + "|" + b.t), a: b.a, t: b.t, o: b.o, s: b.s, n: b.n || 0, g: b.g, j: b.j || 0, z: b.z, memo: b.m || "", w: false }));
(window.WENSEN || []).forEach(r => BASE.push({ id: "w" + hash(r[0] + "|" + r[1]), a: r[0], t: r[1], o: r[2], s: r[3], n: r[4] || 0, g: "", j: 0, z: "", memo: r[5] || "", w: true }));

let BOOKS = [], BYID = new Map();
function rebuild() {
  const del = new Set(store.deleted);
  BOOKS = BASE.filter(b => !del.has(b.id)).map(b => Object.assign({}, b, store.edits[b.id] || {}))
    .concat(store.added.filter(b => !del.has(b.id)).map(b => Object.assign({}, b, store.edits[b.id] || {})));
  BOOKS.forEach(b => { b.a = (b.a || "").replace(/\s+/g, " ").trim(); b.t = (b.t || "").replace(/\s+/g, " ").trim(); });
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
function getCover(b) {
  const fixed = (window.COVERS || {})[b.a + "|" + b.t];       // vooraf opgezocht via Open Library
  if (fixed) return Promise.resolve(typeof fixed === "number" ? "https://covers.openlibrary.org/b/id/" + fixed + "-M.jpg" : fixed);
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
let gbPauseUntil = 0;
async function gb(q) {
  if (Date.now() < gbPauseUntil) throw new Error("gb pauze");
  const r = await fetch("https://www.googleapis.com/books/v1/volumes?maxResults=5&printType=books&q=" + encodeURIComponent(q));
  if (r.status === 429) gbPauseUntil = Date.now() + 60000;
  if (!r.ok) throw new Error("gb " + r.status);
  const j = await r.json();
  for (const it of j.items || []) {
    const im = it.volumeInfo && it.volumeInfo.imageLinks;
    if (im && (im.thumbnail || im.smallThumbnail)) return (im.thumbnail || im.smallThumbnail).replace(/^http:/, "https:").replace("&edge=curl", "");
  }
  return "";
}
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
  const tries = [() => gb(`intitle:"${t}" inauthor:${ln}`)];
  if (b.o && b.o !== "-" && norm(b.o) !== norm(t)) tries.push(() => gb(`intitle:"${b.o}" inauthor:${ln}`));
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
let navDepth = 0, listScroll = 0, current = "";
function show(v) {
  if (current === "lijst" && v !== "lijst") listScroll = window.scrollY;
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
  else if (p === "schrijver" && arg) { show("schrijver"); renderAuthor(arg); window.scrollTo(0, 0); }
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
function renderList() {
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
  "Grant County": 6, "Blue Rose": 3, "De Roth Trilogie": 3, "Martin Vail": 3, "Het Wilde Eiland": 3
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
$("#tGel").onclick = () => { tab = "gel"; $("#tGel").setAttribute("aria-pressed", true); $("#tWens").setAttribute("aria-pressed", false); renderList(); window.scrollTo(0, 0); };
$("#tWens").onclick = () => { tab = "wens"; $("#tWens").setAttribute("aria-pressed", true); $("#tGel").setAttribute("aria-pressed", false); renderList(); window.scrollTo(0, 0); };
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
  $("#bEdit").href = "#/bewerk/" + b.id;
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
    <div class="sec"><h3>Samenvatting</h3>${b.z ? `<p>${esc(b.z)}</p>` : `<p class="none">Nog geen samenvatting. Tik op het potlood om er een toe te voegen.</p>`}</div>
    <div class="sec"><h3>Memo</h3><textarea class="memo" id="memo" placeholder="Eigen aantekeningen: wat vond je ervan, cijfer, uitgeleend aan…">${esc(b.memo)}</textarea><div class="saved" id="saved"></div></div>
    ${others.length ? `<div class="sec"><h3>Ook in ${esc(b.s)}</h3><ul class="tl" style="margin-top:0">${others.map(x => `<li><a href="#/boek/${x.id}"><span class="y">${x.n ? "#" + x.n : ""}</span><span class="dot"></span><span class="th">${coverHTML(x)}</span><span class="tt"><b>${esc(x.t)}</b><small>${x.j || ""}${x.w ? " · wensenlijst" : ""}</small></span></a></li>`).join("")}</ul></div>` : ""}
    <div class="acts">${b.w ? `<button class="btn pri" id="markRead">Gelezen!</button>` : ""}<a class="btn" href="#/bewerk/${b.id}">Bewerken</a></div>`;
  hydrate($("#bBody"));
  let t = 0;
  $("#memo").addEventListener("input", e => {
    clearTimeout(t); $("#saved").textContent = "";
    t = setTimeout(() => { setField(b.id, { memo: e.target.value }); $("#saved").textContent = "✓ Opgeslagen"; }, 500);
  });
  const mr = $("#markRead");
  if (mr) mr.onclick = () => { setField(b.id, { w: false }); toast("Verplaatst naar ‘Gelezen’"); renderBook(BYID.get(b.id)); };
}
function setField(id, obj) {
  const added = store.added.find(x => x.id === id);
  if (added) Object.assign(added, obj); else store.edits[id] = Object.assign(store.edits[id] || {}, obj);
  saveStore(); rebuild();
}

/* ---------- Schrijver ---------- */
const tkey = s => norm(s).replace(/^(the|a|de|het|een)\s+/, "").replace(/[^a-z0-9]/g, "");
let authorFilter = "alle";
/* Alle boeken van een schrijver: Petra's boeken + de bibliografie (Open Library), op jaar */
function authorTimeline(a) {
  const mine = BOOKS.filter(b => b.a === a), used = new Set(), rows = [];
  ((window.BIBLIO || {})[a] || []).forEach(([title, year]) => {
    const k = tkey(title);
    const m = mine.find(b => !used.has(b.id) && (tkey(b.o) === k || tkey(b.t) === k));
    if (m) { used.add(m.id); rows.push({ b: m, y: m.j || year }); }
    else if (!rows.some(r => !r.b && tkey(r.title) === k)) rows.push({ title, y: year });
  });
  mine.filter(b => !used.has(b.id)).forEach(b => rows.push({ b, y: b.j || 0 }));
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
    <div class="sec"><h3>Over de schrijver</h3><div id="bioBox">${bt ? `<p>${esc(bt)}</p>` : `<p class="none">Nog geen bio. Tik op het potlood om er een te schrijven.</p>`}</div></div>
    <div class="sec"><h3>${hasBib ? "Alle boeken op jaar van verschijnen" : "Boeken op jaar van verschijnen"}</h3>
      ${nOther ? `<div class="legend"><span><i style="background:var(--acc2)"></i>Gelezen (${read})</span><span><i style="border:2px solid var(--faint)"></i>Nog niet gelezen (${nOther})</span>${bs.length > read ? `<span><i style="background:var(--gold)"></i>Wensenlijst</span>` : ""}</div>
      <div class="chips" style="padding-top:2px"><button class="chip" data-f="alle" aria-pressed="${authorFilter === "alle"}">Alle boeken</button><button class="chip" data-f="gel" aria-pressed="${authorFilter === "gel"}">Alleen gelezen</button></div>` : ""}
      <ul class="tl">${shown.map((r, i) => r.b ? `<li class="read"><a href="#/boek/${r.b.id}"><span class="y">${r.y || "?"}</span><span class="dot"></span><span class="th">${coverHTML(r.b)}</span><span class="tt"><b>${esc(r.b.t)}</b>${subHTML(r.b, "")}</span>${r.b.w ? `<span class="ok w">Wens</span>` : `<span class="ok">✓ Gelezen</span>`}</a></li>`
        : `<li class="unread"><button class="nr" data-i="${rows.indexOf(r)}"><span class="y">${r.y || "?"}</span><span class="dot"></span><span class="ph2">+</span><span class="tt"><b>${esc(r.title)}</b></span><span class="add">Gelezen?</span></button></li>`).join("")}</ul>
      ${hasBib ? `<p class="src">De lijst met niet-gelezen boeken komt van Open Library en kan onvolledig zijn of ook verzamelbundels bevatten. Tik op een titel om hem als gelezen of als wens toe te voegen.</p>` : ""}</div>`;
  hydrate($("#sBody"));
  $("#sBody").querySelectorAll(".chip[data-f]").forEach(c => c.onclick = () => { authorFilter = c.dataset.f; renderAuthor(a); });
  $("#sBody").querySelectorAll("button.nr").forEach(btn => btn.onclick = () => askAdd(a, rows[+btn.dataset.i]));
  $("#sEdit").onclick = () => {
    $("#bioBox").innerHTML = `<textarea class="memo" id="bioTa" style="min-height:160px">${esc(bio(a))}</textarea><div class="acts"><button class="btn pri" id="bioOk">Bio opslaan</button></div>`;
    $("#bioTa").focus();
    $("#bioOk").onclick = () => { store.bios[a] = $("#bioTa").value.trim(); saveStore(); toast("Bio opgeslagen"); renderAuthor(a); };
  };
}

/* Een titel uit de bibliografie toevoegen als gelezen of als wens */
function askAdd(a, r) {
  const s = document.createElement("div"); s.className = "sheet";
  s.innerHTML = `<div class="in"><div class="grab"></div>
    <p style="margin:4px 6px 2px;font:600 19px var(--f-d)">${esc(r.title)}</p>
    <p style="margin:0 6px 10px;color:var(--muted)">${esc(niceName(a))}${r.y ? " · " + r.y : ""}</p>
    <button class="it" data-k="gel"><span style="font-size:20px">✓</span><span>Gelezen<small>Toevoegen aan Petra's lijst en meteen aanvullen</small></span></button>
    <button class="it" data-k="wens"><span style="font-size:20px">♡</span><span>Op de wensenlijst<small>Wil ik nog lezen</small></span></button>
    <button class="it" data-k="x"><span style="font-size:20px">×</span><span>Annuleren</span></button></div>`;
  s.addEventListener("click", e => {
    const it = e.target.closest(".it");
    if (e.target === s || it) s.remove();
    if (!it || it.dataset.k === "x") return;
    const w = it.dataset.k === "wens", id = "u" + Date.now().toString(36);
    store.added.push({ id, a, t: r.title, o: r.title, s: "", n: 0, g: "", j: r.y || 0, z: "", memo: "", w });
    saveStore(); rebuild(); openSet.add(a); lsSet("pb-open", [...openSet]);
    if (w) { toast("Op de wensenlijst gezet"); renderAuthor(a); }
    else { fillHint = true; location.hash = "#/bewerk/" + id; }
  });
  document.body.appendChild(s);
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
function renderForm(b) {
  editing = b;
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
const APP = { versie: "1.1", datum: "7 november 2026" };   // bij elke update aanpassen
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
  const name = "Petra's boekenlijst " + new Date().toISOString().slice(0, 10);
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
    <button class="it" data-k="xls">${ic('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M9 13l4 5M13 13l-4 5"/>')}<span>Exporteren naar Excel<small>Alle gelezen boeken met schrijver, titels, serie, jaar en memo</small></span></button>
    <button class="it" data-k="xlsw">${ic('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>')}<span>Exporteren naar Excel, met wensenlijst<small>Gelezen boeken én de wensenlijst in één bestand</small></span></button>
    <button class="it" data-k="exp">${ic('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/>')}<span>Backup opslaan<small>Bewaar memo's, nieuwe boeken en wijzigingen als bestand</small></span></button>
    <button class="it" data-k="imp">${ic('<path d="M12 15V3m0 0L8 7m4-4 4 4M4 17v3h16v-3"/>')}<span>Backup terugzetten<small>Bijvoorbeeld van de telefoon naar de iPad</small></span></button>
    <button class="it" data-k="theme">${ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')}<span>Weergave automatisch${th === "auto" ? " (nu aan)" : ""}<small>Licht of donker volgens de instelling van het apparaat. Met de zon/maan-knop kies je het zelf.</small></span></button>
    <button class="it" data-k="cov">${ic('<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>')}<span>Omslagen opnieuw zoeken<small>Als er een verkeerde of geen voorkant wordt getoond</small></span></button>
    <div class="about"><b>Boekenlijst Petra Zwijgers</b>
      <span>Versie ${APP.versie} · laatst bijgewerkt ${APP.datum}</span>
      <span>${BOOKS.filter(b => !b.w).length} gelezen boeken · ${new Set(BOOKS.filter(b => !b.w).map(b => b.a)).size} schrijvers · ${BOOKS.filter(b => b.w).length} op de wensenlijst</span>
      <span>Gemaakt met liefde door Barry Zwijgers ♥</span></div></div>`;
  s.addEventListener("click", e => {
    const it = e.target.closest(".it");
    if (e.target === s || it) s.remove();
    if (!it) return;
    const k = it.dataset.k;
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
  a.download = "petra-boekenlijst-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast("Backup opgeslagen");
}
$("#impFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== "petra-boekenlijst" || !j.data) throw new Error();
    if (!confirm("Backup van " + (j.datum || "").slice(0, 10) + " terugzetten? De huidige aanpassingen op dit apparaat worden vervangen.")) return;
    store = Object.assign({ edits: {}, added: [], deleted: [], bios: {} }, j.data); saveStore(); rebuild(); route(); toast("Backup teruggezet");
  } catch (err) { alert("Dit is geen geldige backup van Petra's boekenlijst."); }
});

/* ---------- Start ---------- */
route();
let rsT = 0; addEventListener("resize", () => { clearTimeout(rsT); rsT = setTimeout(() => { if (current === "start") renderStart(); }, 300); });
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => { });
