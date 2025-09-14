export type OrchestratorEvent = { type: string; detail?: any };

export type TriageDecision = {
  needsData: boolean;
  needsMetadata: boolean;
  limit?: number;
};

