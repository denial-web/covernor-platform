You are building the Minister–Governor Platform.

This system separates planning, governance, and execution into four strict roles:

Minister: Responsible for planning and proposing strategies.
Critic: Responsible for structural validation and fast LLM sanity-checking against hallucinations or prompt injections.
Governor: Responsible for policy validation, capability authorization, risk classification, and approval decisions.
Operator: Responsible for executing approved actions using signed cryptographic tokens.

Authority Rules

Minister cannot approve actions.
Critic cannot authorize execution.
Governor cannot generate strategies.
Operator cannot make decisions.

Governor decision types must always be one of:

APPROVE
APPROVE_WITH_CONSTRAINTS
REJECT_AND_REPLAN
BLOCK_AND_ESCALATE
HUMAN_OVERRIDE_APPROVED
PENDING_SECOND_APPROVAL

System Rules

All actions and errors must be securely logged into an immutable hash chain (AuditLog).
Replanning loops must be strictly bounded (MAX_REPLAN_ATTEMPTS = 3).
Governor is the only component allowed to classify risk.
Operator executes only Governor-approved plans with valid KMS signatures.

Design Principles

Keep the system modular and tenant-isolated.
Avoid mixing planning, policy, and execution logic down to the file level.
All schemas must be strongly typed and validated (e.g., via Zod).
