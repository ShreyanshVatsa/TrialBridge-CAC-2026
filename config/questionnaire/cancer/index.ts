/** All per-group catalogs, keyed by cancer group. */
import type { CancerGroupId } from "@/config/cancer-groups";
import type { GroupCatalog } from "./shared";
import { bladder } from "./bladder";
import { brain } from "./brain";
import { breast } from "./breast";
import { colorectal } from "./colorectal";
import { gastroesophageal } from "./gastroesophageal";
import { headNeck } from "./head-neck";
import { kidney } from "./kidney";
import { leukemia } from "./leukemia";
import { liver } from "./liver";
import { lung } from "./lung";
import { lymphoma } from "./lymphoma";
import { melanoma } from "./melanoma";
import { myeloma } from "./myeloma";
import { other } from "./other";
import { ovarian } from "./ovarian";
import { pancreatic } from "./pancreatic";
import { prostate } from "./prostate";
import { sarcoma } from "./sarcoma";
import { solidTumors } from "./solid-tumors";
import { thyroid } from "./thyroid";
import { uterineCervical } from "./uterine-cervical";

export const GROUP_CATALOGS: Readonly<Record<CancerGroupId, GroupCatalog>> = {
  breast,
  lung,
  colorectal,
  prostate,
  leukemia,
  lymphoma,
  myeloma,
  melanoma,
  pancreatic,
  ovarian,
  brain,
  bladder,
  kidney,
  liver,
  "head-neck": headNeck,
  gastroesophageal,
  "uterine-cervical": uterineCervical,
  sarcoma,
  thyroid,
  "solid-tumors": solidTumors,
  other,
};

export type { GroupCatalog } from "./shared";
