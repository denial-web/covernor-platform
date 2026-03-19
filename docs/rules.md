# Project Rules

1. **Advisor** is the planner.
2. **Critic** is the internal auditor, validating schemas and sanity checking the Advisor.
3. **Covernor** is the absolute authority and policy firewall. 
4. **Operator** is the strictly-bound executor.

Never merge these responsibilities. 

All decisions must pass through the Covernor. 
The Operator must never execute unapproved actions or actions without a cryptographically signed Approval Token.

## Operational Constraints

- **Max Replan Attempts**: 3
- **Request Body Size Limit**: 100kb
- **Decision Expiry**: 4 hours
- **Token TTL**: 15 minutes (KMS signed approval tokens for Operator)
- **Escalation TTL (Human Review window)**: 24 hours
- **Max Concurrent Queue Operations**: limited per tenant via sliding window (Noisy-Neighbor guards)
- **Operator Velocity Limits**: Action-specific bounds (e.g., 50 financial transactions per minute)
