import { describe, expect, it } from "vitest";
import { mapGroups } from "@/lib/ingest/groups";

const sorted = (g: string[]) => [...g].sort();

describe("mapGroups: registry MeSH mis-mappings and blood-cancer wording", () => {
  it("drops a MeSH-only lymphoma tag when the conditions name leukemia (NCT03150693: B-ALL mapped to Burkitt Lymphoma)", () => {
    expect(mapGroups(["Burkitt Lymphoma", "Lymphoma, B-Cell", "Lymphoma", "Neoplasms"], ["B Acute Lymphoblastic Leukemia"], "Inotuzumab Ozogamicin and Frontline Chemotherapy in Treating Young Adults With Newly Diagnosed B Acute Lymphoblastic Leukemia")).toEqual(["leukemia"]);
  });

  it("drops a MeSH-only lymphoma tag on a glioma trial (NCT05765812: Astrocytoma mapped to Lymphoma, Follicular)", () => {
    expect(mapGroups(["Astrocytoma", "Glioblastoma", "Lymphoma, Follicular", "Glioma", "Lymphoma"], ["Glioblastoma IDH (Isocitrate Dehydrogenase) Wildtype", "Astrocytoma, Grade III"], "A Study of Debio 0123 in Combination With Temozolomide in Adult Participants With Recurrent or Progressive Glioblastoma")).toEqual(["brain"]);
  });

  it("tags T-cell lymphoproliferative neoplasms as lymphoma, not a solid-tumor basket (NCT04858256)", () => {
    expect(mapGroups(["Lymphoproliferative Disorders", "Lymphatic Diseases"], ["T-Cell Neoplasm", "Lymphoproliferative Disorders"], "Pacritinib in Relapsed/Refractory T-cell Lymphoproliferative Neoplasms")).toEqual(["lymphoma"]);
  });

  it("a blood-cancer trial ending in 'Neoplasm' is not a solid-tumor basket, but explicit solid wording still is", () => {
    expect(mapGroups(["Leukemia, Myeloid, Acute", "Leukemia"], ["Acute Myeloid Leukemia", "Myelodysplastic/Myeloproliferative Neoplasm"], "A Study in AML")).toEqual(["leukemia"]);
    expect(sorted(mapGroups(["Lymphoma"], ["Lymphoma", "Malignant Solid Neoplasm"], "A Study in Lymphoma and Solid Tumors"))).toEqual(["lymphoma", "solid-tumors"]);
  });

  it("keeps MeSH blood-cancer tags the conditions support, and keeps MeSH tags when the text names nothing", () => {
    expect(sorted(mapGroups(["Leukemia, Lymphocytic, Chronic, B-Cell", "Leukemia", "Lymphoma"], ["CLL", "Small Lymphocytic Lymphoma"], "A CLL/SLL study"))).toEqual(["leukemia", "lymphoma"]);
    expect(mapGroups(["Lymphoma"], ["Acute Pancreatitis"], "Fluids in Acute Pancreatitis")).toEqual(["lymphoma"]); // no cancer named: not second-guessed here
  });

  it("gall bladder cancer is liver/bile duct, not bladder", () => {
    expect(mapGroups([], ["Gall Bladder Cancer"], "A Study in Gall Bladder Cancer")).toEqual(["liver"]);
    expect(mapGroups(["Gallbladder Neoplasms"], ["GBC"], "A study")).toEqual(["liver"]);
  });

  it("mycosis fungoides is lymphoma", () => {
    expect(mapGroups([], ["Mycosis Fungoides"], "Light Therapy for Mycosis Fungoides")).toEqual(["lymphoma"]);
  });
});
