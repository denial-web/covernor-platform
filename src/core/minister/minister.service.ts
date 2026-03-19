import { prisma } from '../../db/client';
import { AuditLogger } from '../../db/audit.logger';
import { LLMProvider } from './llm.provider';
import { logger } from '../../utils/logger';

export class MinisterService {
  /**
   * Minister interprets an objective and generates a proposal with recommended and fallback options.
   * In a real implementation, this would involve LLM calls or complex planning engines.
   */
  async generateProposal(taskId: string, objective: string, context: any, tenantId: string = 'default_tenant', parentProposalId?: string) {
    let recommendedOption: any;
    let fallbackOptions: any[] = [];

    try {
       const llm = new LLMProvider();
       const aiResponse = await llm.generateStrategy(objective, context, tenantId);
       recommendedOption = aiResponse.recommendedOption;
       fallbackOptions = aiResponse.fallbackOptions;
    } catch (llmError: any) {
       logger.warn("[Minister] LLM call failed, falling back to mock strategy.", { error: llmError.message });
       if (context && context.source === 'DEMO_ESCALATE') {
         recommendedOption = { actionType: "TRANSFER_FUNDS", parameters: { amount: 1000, recipient: "user_4492" }, riskEstimate: "HIGH" };
         fallbackOptions = [];
       } else {
         recommendedOption = { actionType: "READ_DATABASE", parameters: { query: objective }, riskEstimate: "LOW" };
         fallbackOptions = [{ actionType: "READ_DATABASE", parameters: { query: "SELECT default" }, riskEstimate: "LOW" }];
       }
    }
    
    const proposal = await prisma.proposal.create({
      data: {
        tenantId,
        taskId,
        parentProposalId,
        recommendedOption,
        fallbackOptions,
        contextSignals: context ?? {},
        status: 'PENDING',
      },
    });

    await AuditLogger.logAction({
      tenantId,
      proposalId: proposal.id,
      actionDetails: {
        actor: 'Minister',
        action: 'generate_proposal',
        objective,
        context
      }
    });

    return proposal;
  }
}
