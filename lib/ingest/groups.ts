import { CANCER_GROUPS, type CancerGroupId } from "@/config/cancer-groups";

const SPECIFIC = CANCER_GROUPS.filter((g) => g.id !== "solid-tumors" && g.id !== "other");
const SOLID = CANCER_GROUPS.find((g) => g.id === "solid-tumors");
const HEME = new Set<CancerGroupId>(["leukemia", "lymphoma", "myeloma"]);
/**
 * Solid-tumor basket wording other than a bare trailing "neoplasm(s)": for a trial whose groups are all blood cancers,
 * "Myeloproliferative Neoplasm" or "T-cell Lymphoproliferative Neoplasms" does not make it a solid-tumor basket.
 */
const EXPLICIT_SOLID = /solid (tumou?r|neoplasm|malignan|cancer|carcinoma)|advanced (malignan|cancer)|metastatic cancer|multiple (cancer|tumor)/i;
/** The registry's own text names a cancer (so its text groups are trusted over a MeSH-only blood-cancer group). */
const NAMES_CANCER = /cancer|carcinoma|tumou?r|neoplas|lymphoma|leuk(a)?emia|myeloma|melanoma|sarcoma|glioma|astrocytoma|blastoma|malignan|myelodysplastic/i;
/** A trial matching this many specific groups is treated as a basket trial. */
const BASKET_THRESHOLD = 4;

/**
 * Map a trial to cancer-type groups from MeSH terms (conditions + ancestors), falling back
 * to free-text conditions. Basket / multi-cancer trials also get "solid-tumors".
 * Trials matching nothing go to "other" so they are still searchable via "not sure".
 */
export function mapGroups(meshTerms: string[], conditions: string[], title = "", officialTitle = ""): CancerGroupId[] {
  const groups = new Set<CancerGroupId>();
  for (const g of SPECIFIC) {
    if (g.mesh.some((re) => meshTerms.some((t) => re.test(t)))) groups.add(g.id);
  }
  // CT.gov's automatic MeSH mapping sometimes files a disease under the wrong blood cancer (e.g. "B Acute Lymphoblastic
  // Leukemia" -> "Burkitt Lymphoma", "Astrocytoma, Grade III" -> "Lymphoma, Follicular"). A blood-cancer group that
  // only MeSH supports is dropped when the registry's own conditions and titles name a cancer and other groups but not
  // this one.
  const ownText = [...conditions, title, officialTitle].join("\n");
  const textGroups = new Set(SPECIFIC.filter((g) => g.text.some((re) => re.test(ownText))).map((g) => g.id));
  if (textGroups.size && NAMES_CANCER.test(ownText)) for (const id of [...groups]) if (HEME.has(id) && !textGroups.has(id)) groups.delete(id);
  if (groups.size === 0) {
    for (const g of SPECIFIC) {
      if (g.text.some((re) => conditions.some((c) => re.test(c)))) groups.add(g.id);
    }
  }
  if (groups.size === 0) {
    // Last resort before "other": the titles often name the disease or an abbreviation (e.g. "in HNSCC").
    const titles = `${title}\n${officialTitle}`;
    for (const g of SPECIFIC) if (g.text.some((re) => re.test(titles))) groups.add(g.id);
  }
  const solidText = SOLID?.text.some((re) => conditions.some((c) => re.test(c)) || re.test(title) || re.test(officialTitle)) ?? false;
  const onlyHeme = groups.size > 0 && [...groups].every((id) => HEME.has(id));
  if (onlyHeme && solidText && !EXPLICIT_SOLID.test(ownText)) return [...groups]; // blood-cancer "... Neoplasms" wording
  if (groups.size >= BASKET_THRESHOLD || solidText) groups.add("solid-tumors");
  if (groups.size === 0) groups.add("other");
  return [...groups];
}
