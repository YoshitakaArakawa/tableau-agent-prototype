import { z } from "zod";

// Aggregation function for fields (normalized to UPPER; COUNTD -> COUNT_DISTINCT)
export const AggFunc = z
  .string()
  .transform((v) => (typeof v === "string" ? v.trim().toUpperCase() : v))
  .refine(
    (v) =>
      v === undefined ||
      ["SUM", "AVG", "MEDIAN", "COUNT", "COUNTD", "COUNT_DISTINCT", "MIN", "MAX"].includes(String(v)),
    { message: "Unsupported aggregation function" }
  )
  .transform((v) => (v === "COUNTD" ? "COUNT_DISTINCT" : v))
  .optional();

export const FieldSpec = z.object({
  fieldCaption: z.string().min(1, "fieldCaption is required"),
  function: AggFunc,
});

export const TopFilter = z.object({
  filterType: z.literal("TOP"),
  howMany: z.number().int().positive(),
  direction: z.enum(["TOP", "BOTTOM"]).default("TOP"),
  fieldToMeasure: z.object({ fieldCaption: z.string().min(1), function: AggFunc }),
});

export const GenericFilter = z
  .object({
    filterType: z.enum(["SET", "MATCH", "QUANTITATIVE_DATE", "QUANTITATIVE_NUMERICAL", "DATE"]).or(z.literal("TOP")),
  })
  .passthrough();

export const QuerySpec = z.object({
  fields: z.array(FieldSpec).min(1, "query.fields must include at least one field"),
  filters: z.array(TopFilter.or(GenericFilter)).default([]),
});

export const OptionsSpec = z.object({
  returnFormat: z.enum(["OBJECTS", "ARRAYS"]).default("OBJECTS"),
  debug: z.boolean().default(false),
  disaggregate: z.boolean().default(false),
});

export const AnalysisStepSpec = z.object({
  id: z.string().min(1, "analysis_plan.steps[].id is required"),
  goal: z.string().min(1, "analysis_plan.steps[].goal is required"),
  hypothesis: z.string().optional(),
  vizql_refinement: z
    .object({
      add_fields: z.array(FieldSpec).optional(),
      adjust_filters: z.array(TopFilter.or(GenericFilter)).optional(),
      note: z.string().optional(),
    })
    .passthrough()
    .optional(),
  ci: z
    .object({
      instructions: z.string().min(1, "analysis_plan.steps[].ci.instructions is required"),
      expected_outputs: z.array(z.string().min(1)).optional(),
      charts: z.array(z.string().min(1)).optional(),
    })
    .passthrough()
    .optional(),
  success_criteria: z.string().optional(),
});

export const AnalysisPlanSpec = z
  .object({
    overview: z.string().optional(),
    metrics: z.array(z.string().min(1)).optional(),
    segments: z.array(z.string().min(1)).optional(),
    steps: z.array(AnalysisStepSpec).min(1, "analysis_plan.steps must include at least one step"),
    assumptions: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

export const AnalysisPlannerOutput = z
  .object({
    analysis_plan: AnalysisPlanSpec,
  })
  .passthrough();

export const PlannerPayload = z
  .object({
    datasource: z.object({ datasourceLuid: z.string().min(1) }),
    query: QuerySpec,
    options: OptionsSpec.default({ returnFormat: "OBJECTS", debug: false, disaggregate: false }),
    analysis_plan: AnalysisPlanSpec.optional(),
  })
  .passthrough();

export type PlanningPayload = z.infer<typeof PlannerPayload>;
export type AnalysisPlan = z.infer<typeof AnalysisPlanSpec>;
export type AnalysisStep = z.infer<typeof AnalysisStepSpec>;
export type AnalysisPlannerOutputType = z.infer<typeof AnalysisPlannerOutput>;
