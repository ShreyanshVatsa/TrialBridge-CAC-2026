/**
 * `npm run synonyms`: regenerate lib/ingest/synonyms/*.json from three open sources, filtered to the genes, variants,
 * drugs and cancer types that actually occur in our trial snapshot (data/cache/national, else data/seed).
 *   - HGNC complete set (CC0)            -> genes.json    (symbol + aliases / previous symbols)
 *   - CIViC variant summaries (CC0)      -> variants.json (gene + variant name + aliases)
 *   - NCI Thesaurus flat file (NCI EVS)  -> drugs.json    (drug names -> drug class), diseases.json (cancer synonyms)
 * No OncoKB. Downloads are cached in data/cache/synonyms-src/ (gitignored); delete it to refetch.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SRC = "data/cache/synonyms-src";
const OUT = "lib/ingest/synonyms";
const URLS = {
  "hgnc.txt": "https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt",
  "civic-variants.tsv": "https://civicdb.org/downloads/nightly/nightly-VariantSummaries.tsv",
  "ncit.zip": "https://evs.nci.nih.gov/ftp1/NCI_Thesaurus/Thesaurus.FLAT.zip",
} as const;

async function download(): Promise<void> {
  mkdirSync(SRC, { recursive: true });
  for (const [file, url] of Object.entries(URLS)) {
    const p = path.join(SRC, file);
    if (existsSync(p)) continue;
    console.log(`download ${url}`);
    const res = await fetch(url, { headers: { "User-Agent": "TrialBridge-ingest/0.1 (open data use)" }, signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  }
}

// ---- corpus: tokens and condition phrases that occur in our trials -------------------------------------------------
interface Study {
  protocolSection?: {
    identificationModule?: { briefTitle?: string; officialTitle?: string };
    descriptionModule?: { briefSummary?: string };
    conditionsModule?: { conditions?: string[]; keywords?: string[] };
    eligibilityModule?: { eligibilityCriteria?: string };
  };
  derivedSection?: { conditionBrowseModule?: { meshes?: { term: string }[] } };
}

function loadStudies(): Study[] {
  const dir = "data/cache/national";
  if (existsSync(dir)) {
    const pages = readdirSync(dir).filter((f) => /^page-\d+\.json$/.test(f)).sort();
    if (pages.length) return pages.flatMap((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Study[]);
  }
  return (JSON.parse(readFileSync("data/seed/studies.json", "utf8")) as { studies: Study[] }).studies;
}

const splitRaw = (t: string) => t.split(/[\s,;()\[\]{}"'<>=+*]+/).map((x) => x.replace(/^[.:/-]+|[.:/-]+$/g, "")).filter(Boolean);
function tokensOf(text: string): string[] {
  const out = new Set<string>();
  for (const t of splitRaw(text)) {
    out.add(t);
    for (const s of t.split(/[-/]/)) if (s) out.add(s);
  }
  return [...out];
}

// ---- helpers --------------------------------------------------------------------------------------------------------
const tsv = (file: string): { header: string[]; rows: string[][] } => {
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const header = (lines[0] as string).split("\t");
  return { header, rows: lines.slice(1).map((l) => l.split("\t")) };
};

/** Common clinical abbreviations that are also HGNC symbols/aliases; never treated as genes. */
const NOT_GENES = new Set(
  "ECOG HR ER PR CT MRI CNS ALT AST PET ANC WBC INR PT PTT DNA RNA HIV HBV HCV CR PD SD ORR OS PFS MS IV SC PO LVEF MUGA ECG EKG QT QTC BMI GFR CTC TNM NYHA CAR USA FDA NCI WHO AML CLL CML ALL DLBCL NSCLC SCLC GI UK PS KPS LDH CRP ULN LLN SGOT SGPT ANA RBC HGB PLT NCCN RECIST IHC FISH PCR NGS CSF BP HDL LDL TSH AE SAE DLT MTD RP2D BID QD PRN IND IRB ICF GCP COVID TIA CVA MI CHF COPD CKD ESRD AIDS HAART PSA CEA AFP HCG BUN SPECT ECHO PICC ID".split(" "),
);

// ---- genes + variants -----------------------------------------------------------------------------------------------
function civicGenes(): Set<string> {
  const { header, rows } = tsv(path.join(SRC, "civic-variants.tsv"));
  const [iF, iG] = [header.indexOf("feature_name"), header.indexOf("gene")] as [number, number];
  const extra = ["PDCD1", "PDCD1LG2", "LAG3", "TIGIT", "FOLR1", "TACSTD2", "CLDN18", "MET", "NTRK1", "NTRK2", "NTRK3"]; // trial-targeted genes CIViC lacks
  return new Set([...rows.map((r) => (r[iG] || (r[iF] as string).split("::")[0]) as string), ...extra]);
}

/** Genes: HGNC symbol + aliases, limited to cancer genes curated in CIViC and to aliases seen in our trials. */
function buildGenes(raw: Set<string>) {
  const cancer = civicGenes();
  const { header, rows } = tsv(path.join(SRC, "hgnc.txt"));
  const ix = (n: string) => header.indexOf(n);
  const [iS, iA, iP, iSt] = [ix("symbol"), ix("alias_symbol"), ix("prev_symbol"), ix("status")] as [number, number, number, number];
  const claims = new Map<string, Set<string>>(); // name -> symbols claiming it (symbols + aliases + previous)
  const entries: { symbol: string; names: string[] }[] = [];
  for (const r of rows) {
    if (r[iSt] !== "Approved") continue;
    const symbol = r[iS] as string;
    const names = [...new Set([...(r[iA] ?? "").replace(/"/g, "").split("|"), ...(r[iP] ?? "").replace(/"/g, "").split("|")].filter(Boolean))];
    entries.push({ symbol, names });
    for (const n of [symbol, ...names]) (claims.get(n) ?? claims.set(n, new Set()).get(n))!.add(symbol);
  }
  const good = (n: string) => /^[A-Z][A-Z0-9-]*$/.test(n) && /[A-Z]{2}|\d/.test(n) && !NOT_GENES.has(n) && n.length >= 2;
  const genes: { symbol: string; aliases: string[] }[] = [];
  for (const e of entries) {
    if (!cancer.has(e.symbol)) continue;
    // Aliases must be unambiguous across HGNC and appear (exact case) in our trials.
    const aliases = e.names.filter((n) => n.length >= 3 && /[\d-]/.test(n) && good(n) && raw.has(n) && claims.get(n)?.size === 1);
    genes.push({ symbol: e.symbol, aliases: aliases.sort() });
  }
  return genes.filter((g) => g.aliases.length > 0).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function buildVariants(raw: Set<string>) {
  const { header, rows } = tsv(path.join(SRC, "civic-variants.tsv"));
  const ix = (n: string) => header.indexOf(n);
  const [iF, iV, iA, iG] = [ix("feature_name"), ix("variant"), ix("variant_aliases"), ix("gene")] as [number, number, number, number];
  const seen = new Set<string>();
  const out: { gene: string; name: string; aliases: string[] }[] = [];
  const specific = (s: string) => s.length >= 3 && /\d/.test(s) && !/\s/.test(s) && !/^(RS|CA)\d+$/i.test(s) && raw.has(s);
  for (const r of rows) {
    const gene = (r[iG] || r[iF]) as string;
    const name = r[iV] as string;
    const aliases = (r[iA] ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== name);
    const isFusion = /::/.test(name);
    const nameOk = isFusion ? raw.has(name) || aliases.some((a) => raw.has(a)) : specific(name);
    const keepAliases = aliases.filter((a) => (isFusion ? raw.has(a) : specific(a)));
    if (!nameOk && keepAliases.length === 0) continue;
    const key = `${gene}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ gene, name, aliases: keepAliases });
  }
  return out.sort((a, b) => a.gene.localeCompare(b.gene) || a.name.localeCompare(b.name));
}

// ---- NCI Thesaurus: drugs and diseases ------------------------------------------------------------------------------
const GENERIC_CLASS = new Set(
  [
    "pharmacologic substance", "biological agent", "immunotherapeutic agent", "therapeutic agent", "agent", "drug", "antineoplastic agent",
    "chemotherapeutic agent", "monoclonal antibody", "antibody", "protein", "organic chemical", "inorganic chemical", "amino acid, peptide, or protein",
    "drug, food, chemical or biomedical material", "enzyme inhibitor", "inhibitor", "antagonist", "chemical", "small molecule", "immunologic factor",
    "pharmacological substance", "therapeutic or preventive procedure", "biologically active substance", "hormone", "regimen", "chemotherapy regimen",
    "kinase inhibitor", "antimetabolite", "immunoglobulin", "molecular target inhibitor", "targeted therapy agent", "combination chemotherapy",
  ],
);

/** Normalize an NCIt class label: "Anti-PD1 Monoclonal Antibody" -> "anti-PD-1". */
export function normalizeClass(label: string): string {
  let s = label.replace(/\s+monoclonal antibody$/i, "").replace(/\s+antibody$/i, "").trim();
  s = s.replace(/\bPD-?L-?1\b/gi, "PD-L1").replace(/\bPD-?1\b/gi, "PD-1").replace(/\bCTLA-?4\b/gi, "CTLA-4").replace(/\bHER-?2\b/gi, "HER2");
  s = s.replace(/^anti-/i, "anti-").replace(/^anti(?=[A-Z])/, "anti-");
  return /^anti-/i.test(s) ? s : s.toLowerCase().replace(/\b(egfr|alk|vegf|vegfr|braf|mek|mtor|parp|cdk4\/6|cdk|btk|bcl-2|her2|pd-1|pd-l1|ctla-4|jak|pi3k|akt|ret|ros1|kras|met|fgfr|idh1|idh2|flt3|kit|tki|hdac|cd\d+)\b/g, (m) => m.toUpperCase());
}

function buildNcit(corpus: { drugDf: Map<string, number>; phrases: Map<string, number> }) {
  const flat = execFileSync("unzip", ["-p", path.join(SRC, "ncit.zip"), "Thesaurus.txt"], { maxBuffer: 1 << 30, encoding: "utf8" });
  const rows = new Map<string, { parents: string[]; syns: string[]; types: string[] }>();
  for (const line of flat.split("\n")) {
    const f = line.split("\t");
    if (f.length < 8 || !f[0]) continue;
    rows.set(f[0], { parents: (f[2] ?? "").split("|").filter(Boolean), syns: (f[3] ?? "").split("|").filter(Boolean), types: (f[7] ?? "").split("|") });
  }
  const nm = (c: string) => rows.get(c)?.syns[0] ?? c;
  const ancMemo = new Map<string, Set<string>>();
  const anc = (c: string): Set<string> => {
    const hit = ancMemo.get(c);
    if (hit) return hit;
    const s = new Set<string>();
    ancMemo.set(c, s);
    for (const p of rows.get(c)?.parents ?? []) {
      s.add(p);
      for (const a of anc(p)) s.add(a);
    }
    return s;
  };
  const PHARM = "C1909";
  const NEOPLASM = "C3262";

  // Drugs: single-token names present in >= 2 trials (any case), under Pharmacologic Substance, with a specific class.
  const drugs: { name: string; names: string[]; classes: string[] }[] = [];
  for (const [code, r] of rows) {
    if (!anc(code).has(PHARM)) continue;
    const toks = r.syns.filter((s) => /^[A-Za-z][A-Za-z0-9-]{3,39}$/.test(s));
    const seen = toks.filter((s) => (corpus.drugDf.get(s.toLowerCase()) ?? 0) >= 12);
    const display = r.syns[0] as string;
    if (!seen.length || !/^[A-Za-z][A-Za-z0-9-]{3,39}$/.test(display) || (corpus.drugDf.get(display.toLowerCase()) ?? 0) < 12) continue;
    const classes: string[] = [];
    for (const p of r.parents) {
      for (const c of [p, ...(rows.get(p)?.parents ?? [])]) {
        const label = rows.get(c)?.syns[0];
        if (!label || GENERIC_CLASS.has(label.toLowerCase()) || label === display) continue;
        const n = normalizeClass(label);
        if (!classes.includes(n)) classes.push(n);
      }
    }
    if (!classes.length) continue;
    const names = [...new Set(toks.map((s) => s.toLowerCase()))].filter((s) => s !== display.toLowerCase()).sort((a, b) => (corpus.drugDf.get(b) ?? 0) - (corpus.drugDf.get(a) ?? 0) || a.localeCompare(b)).slice(0, 3);
    drugs.push({ name: display.toLowerCase(), names, classes: classes.slice(0, 2) });
  }
  // Two NCIt concepts can share a display name; keep the first.
  const dseen = new Set<string>();
  const drugsOut = drugs.filter((d) => !dseen.has(d.name) && dseen.add(d.name)).sort((a, b) => a.name.localeCompare(b.name));

  // Diseases: neoplasm concepts whose name/synonym equals a condition phrase used by >= 8 trials.
  const groups: string[][] = [];
  for (const [code, r] of rows) {
    if (!anc(code).has(NEOPLASM) && code !== NEOPLASM) continue;
    const syns = [...new Set(r.syns.map((s) => s.toLowerCase().replace(/\s+/g, " ")).filter((s) => s.length >= 2 && s.length <= 60 && !/ajcc|stage|\(|\d/.test(s)))];
    if (syns.length < 2) continue;
    if (!syns.some((s) => (corpus.phrases.get(s) ?? 0) >= 8)) continue;
    const ranked = [...syns].sort((a, b) => Number((corpus.phrases.get(b) ?? 0) > 0) - Number((corpus.phrases.get(a) ?? 0) > 0) || a.length - b.length);
    const g = ranked.slice(0, 3);
    groups.push(g);
  }
  void nm;
  const gseen = new Set<string>();
  const groupsOut = groups.filter((g) => !gseen.has(g.join("|")) && gseen.add(g.join("|"))).sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
  return { drugs: drugsOut, diseases: groupsOut };
}

async function main(): Promise<void> {
  await download();
  const studies = loadStudies();
  console.log(`corpus: ${studies.length} trials`);
  const raw = new Set<string>();
  const drugDf = new Map<string, number>();
  const phrases = new Map<string, number>();
  for (const s of studies) {
    const p = s.protocolSection ?? {};
    const text = [p.identificationModule?.briefTitle, p.identificationModule?.officialTitle, p.descriptionModule?.briefSummary, ...(p.conditionsModule?.conditions ?? []), ...(p.conditionsModule?.keywords ?? []), p.eligibilityModule?.eligibilityCriteria].filter(Boolean).join("\n");
    const toks = tokensOf(text);
    const lower = new Set<string>();
    for (const t of toks) {
      raw.add(t);
      lower.add(t.toLowerCase());
    }
    for (const t of lower) drugDf.set(t, (drugDf.get(t) ?? 0) + 1);
    const ph = new Set([...(p.conditionsModule?.conditions ?? []), ...(p.conditionsModule?.keywords ?? []), ...(s.derivedSection?.conditionBrowseModule?.meshes ?? []).map((m) => m.term)].map((x) => x.toLowerCase().replace(/\s+/g, " ").trim()));
    for (const x of ph) phrases.set(x, (phrases.get(x) ?? 0) + 1);
  }
  const genes = buildGenes(raw);
  const variants = buildVariants(raw);
  const { drugs, diseases } = buildNcit({ drugDf, phrases });
  mkdirSync(OUT, { recursive: true });
  const w = (f: string, d: unknown) => writeFileSync(path.join(OUT, f), `${JSON.stringify(d)}\n`);
  w("genes.json", genes);
  w("variants.json", variants);
  w("drugs.json", drugs);
  w("diseases.json", diseases);
  console.log(`genes ${genes.length}, variants ${variants.length}, drugs ${drugs.length}, disease groups ${diseases.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
