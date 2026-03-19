export class GovernorRejectionError extends Error {
  public rejectionReason: string;
  public suggestedAlternative?: string;
  public proposalId: string;

  constructor(proposalId: string, reason: string, alternative?: string) {
    super(`Governor Rejected Proposal ${proposalId}: ${reason}`);
    this.name = 'GovernorRejectionError';
    this.proposalId = proposalId;
    this.rejectionReason = reason;
    this.suggestedAlternative = alternative;
  }
}

export class GovernorEscalationError extends Error {
  public proposalId: string;
  public escalationReason: string;

  constructor(proposalId: string, reason: string) {
    super(`Governor Escalated Proposal ${proposalId} for Manual Review: ${reason}`);
    this.name = 'GovernorEscalationError';
    this.proposalId = proposalId;
    this.escalationReason = reason;
  }
}

export class OperatorExecutionError extends Error {
  public decisionId: string;
  public failureCode: string;
  public failedStep: string;

  constructor(decisionId: string, failureCode: string, failedStep: string) {
    super(`Operator Execution Failed on Decision ${decisionId}: ${failureCode}`);
    this.name = 'OperatorExecutionError';
    this.decisionId = decisionId;
    this.failureCode = failureCode;
    this.failedStep = failedStep;
  }
}
