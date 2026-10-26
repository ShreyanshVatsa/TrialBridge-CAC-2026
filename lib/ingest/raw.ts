import { z } from "zod";

/**
 * zod schema for the subset of a ClinicalTrials.gov API v2 study record that ingestion uses.
 * Lenient on optional modules (records vary); `parseStudy` decides what is required.
 */
const DateStruct = z.object({ date: z.string() }).partial();

export const RawLocationSchema = z.object({
  facility: z.string().optional(),
  status: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  geoPoint: z.object({ lat: z.number(), lon: z.number() }).optional(),
});
export type RawLocation = z.infer<typeof RawLocationSchema>;

const MeshList = z.array(z.object({ id: z.string().optional(), term: z.string() })).optional();

export const RawStudySchema = z.object({
  protocolSection: z.object({
    identificationModule: z.object({
      nctId: z.string().regex(/^NCT\d{8}$/),
      briefTitle: z.string().min(1),
      officialTitle: z.string().optional(),
    }),
    statusModule: z.object({
      overallStatus: z.string().optional(),
      lastUpdatePostDateStruct: DateStruct.optional(),
    }),
    sponsorCollaboratorsModule: z.object({ leadSponsor: z.object({ name: z.string() }).partial().optional() }).optional(),
    descriptionModule: z.object({ briefSummary: z.string().optional() }).optional(),
    conditionsModule: z.object({ conditions: z.array(z.string()).optional(), keywords: z.array(z.string()).optional() }).optional(),
    designModule: z.object({ studyType: z.string().optional(), phases: z.array(z.string()).optional() }).optional(),
    eligibilityModule: z.object({
      eligibilityCriteria: z.string().min(1),
      minimumAge: z.string().optional(),
      maximumAge: z.string().optional(),
      sex: z.string().optional(),
      healthyVolunteers: z.boolean().optional(),
    }),
    contactsLocationsModule: z
      .object({
        centralContacts: z.array(z.object({ name: z.string().optional(), phone: z.string().optional(), email: z.string().optional() })).optional(),
        locations: z.array(RawLocationSchema).optional(),
      })
      .optional(),
  }),
  derivedSection: z
    .object({ conditionBrowseModule: z.object({ meshes: MeshList, ancestors: MeshList }).partial().optional() })
    .optional(),
});
export type RawStudy = z.infer<typeof RawStudySchema>;

/** Fields requested from the API (keeps payloads small). */
export const CTGOV_FIELDS = [
  "protocolSection.identificationModule.nctId",
  "protocolSection.identificationModule.briefTitle",
  "protocolSection.identificationModule.officialTitle",
  "protocolSection.statusModule.overallStatus",
  "protocolSection.statusModule.lastUpdatePostDateStruct",
  "protocolSection.sponsorCollaboratorsModule.leadSponsor",
  "protocolSection.descriptionModule.briefSummary",
  "protocolSection.conditionsModule",
  "protocolSection.designModule.studyType",
  "protocolSection.designModule.phases",
  "protocolSection.eligibilityModule",
  "protocolSection.contactsLocationsModule.centralContacts",
  "protocolSection.contactsLocationsModule.locations",
  "derivedSection.conditionBrowseModule.meshes",
  "derivedSection.conditionBrowseModule.ancestors",
].join(",");
