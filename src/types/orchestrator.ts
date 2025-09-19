import type { AnalysisPlan } from "../planning/schemas";

export type OrchestratorEvent = { type: string; detail?: any };

export type TriageDecision = {
  needsData: boolean;
  needsMetadata: boolean;
};

export type FilterHint = {
  fieldCaption: string;
  operator?: "IN" | "EQ" | "MATCH" | "CONTAINS";
  values?: string[];
  note?: string;
};

export type TriageContext = {
  brief?: any;
  briefNatural?: string;
  requiredFields?: string[];
  filterHints?: FilterHint[];
  analysisPlan?: AnalysisPlan;
};
