import { z } from 'zod';

export const RiskEstimateSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const ActionSchema = z.object({
  actionType: z.string().describe("The string identifier of the operation to perform (e.g., READ_DATABASE, HTTP_GET)"),
  parameters: z.record(z.string(), z.any()).describe("A key-value map of parameters required by the action type."),
  riskEstimate: RiskEstimateSchema.describe("An assessment of the operational risk of this action.")
});

export const ProposalJSONSchema = z.object({
  version: z.literal("1.0.0").describe("The semantic version of the ProposalJSON schema. Must strictly be '1.0.0'"),
  recommendedOption: ActionSchema.describe("The Minister's primary strategic recommendation."),
  fallbackOptions: z.array(ActionSchema).min(1).describe("At least one fallback strategic option if the Governor rejects the primary.")
});

export type ProposalJSON = z.infer<typeof ProposalJSONSchema>;
export type ActionDefinition = z.infer<typeof ActionSchema>;
export type RiskEstimate = z.infer<typeof RiskEstimateSchema>;
