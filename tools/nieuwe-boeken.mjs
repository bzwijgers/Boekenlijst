// Maandelijkse controle: heeft een van de schrijvers uit Peet's boekenkast een nieuw boek aangekondigd?
// Bron: Apple Books (Nederlandse winkel), die ook nog niet verschenen boeken met verschijningsdatum toont.
// Resultaat: data-nieuw.js, dat de app toont onder het tabblad "Binnenkort".
import fs from "node:fs";
import vm from "node:vm";

globalThis.window = {};
const dataFiles = fs.readdirSync(".").filter(f => /^data-(boeken-\d|wensen)/.test(f));
for (const f of dataFiles) vm.runInThisContext(fs.readFileSync(f, "utf8"));

const plain = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tkey = s => plain(s).trim().replace(/^(the|a|de|het|een)\s+/, "").replace(/[^a-z0-9]/g, "");
const nice = a => { const i = a.indexOf(","); return i < 0 ? a : (a.slice(i + 1).trim() + " " + a.slice(0, i).trim()).trim(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ALIAS = { "Preston & Child": ["Douglas Preston", "Lincoln Child"], "Börjlind, Cilla & Rolf": ["Börjlind"], "Koontz, Dean R.": ["Dean Koontz"], "Andrews, Virginia": ["V.C. Andrews"], "Lescroart, John T.": ["John Lescroart"], "Sasson, Jean P.": ["Jean Sasson"] };
const SKIP = new Set(["Brink, Noortje", "Craig, Robert", "Lucas, John", "Lathrop, John"]);
const BAD = /\b(box ?set|bundel|bundle|omnibus|collection|sampler|samenvatting|summary|boxset|\d+-book|trilogie compleet)\b/i;

const authors = [...new Set([...window.BOEKEN.map(b => b.a.trim()), ...window.WENSEN.map(w => w[0].trim())])].filter(a => !SKIP.has(a));
const today = new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const horizon = addDays(today, 900), keepFrom = addDays(today, -60);

async function search(term) {
  const url = "https://itunes.apple.com/search?media=ebook&entity=ebook&attribute=authorTerm&limit=200&country=NL&term=" + encodeURIComponent(term);
  for (let i = 0; i < 4; i++) {
    await sleep(3500);
    try {
      const r = await fetch(url);
      if (r.ok) return (await r.json()).results || [];
      console.log(`  HTTP ${r.status}, even wachten`);
    } catch (e) { console.log("  netwerkfout, even wachten"); }
    await sleep(45000);
  }
  return null;
}

const found = new Map(); let failed = 0;
for (const a of authors) {
  for (const name of ALIAS[a] || [nice(a)]) {
    const toks = plain(name).replace(/[^a-z ]/g, " ").split(/\s+/).filter(w => w.length > 2 && !["van", "der", "den"].includes(w));
    const res = await search(name);
    if (!res) { failed++; console.log("MISLUKT " + a); continue; }
    for (const x of res) {
      const d = String(x.releaseDate || "").slice(0, 10), artist = plain(x.artistName);
      if (d <= today || d > horizon || BAD.test(x.trackName) || !toks.every(t => artist.includes(t))) continue;
      const k = a + "|" + tkey(x.trackName);
      if (!found.has(k)) { found.set(k, { a, t: x.trackName, d, c: x.artworkUrl100.replace("100x100bb", "400x600bb"), u: x.trackViewUrl }); console.log(`${d}  ${name}: ${x.trackName}`); }
    }
  }
}
if (failed > authors.length / 2) { console.error(`Te veel mislukte zoekopdrachten (${failed}); bestand niet bijgewerkt.`); process.exit(1); }

// Eerder gevonden boeken blijven staan tot 60 dagen na verschijnen ("net verschenen")
let oud = [];
try { const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync("data-nieuw.js", "utf8"), ctx); oud = ctx.window.NIEUW.boeken || []; } catch (e) { /* eerste keer */ }
for (const b of oud) { const k = b.a + "|" + tkey(b.t); if (!found.has(k) && b.d >= keepFrom) found.set(k, b); }

const boeken = [...found.values()].sort((x, y) => x.d.localeCompare(y.d) || x.a.localeCompare(y.a));
fs.writeFileSync("data-nieuw.js", "/* Automatisch gemaakt door tools/nieuwe-boeken.mjs: aangekondigde boeken van de schrijvers. */\nwindow.NIEUW = " + JSON.stringify({ gecontroleerd: today, boeken }, null, 0) + ";\n");
console.log(`Klaar: ${boeken.length} boeken, ${authors.length} schrijvers, ${failed} mislukt.`);
