export interface CapabilityDefinition {
    id: string; // e.g., 'financial.transfer', 'database.read'
    boundTools: string[]; // e.g., ['TRANSFER_FUNDS']
    description: string;
    requiresHumanReview: boolean;
    defaultScopeLimits?: Record<string, any>;
}

/**
 * A static, deterministic registry of all high-level capabilities the system supports.
* The Covernor uses this to authorize actions, rather than authorizing raw tool executions.
   * This prevents the Advisor from directly calling side-effecting tools without going through an authorized Capability layer.
 */
export const CAPABILITY_REGISTRY: Record<string, CapabilityDefinition> = {
    'database.read': {
        id: 'database.read',
        boundTools: ['READ_DATABASE', 'POSTGRESQL_QUERY'],
        description: 'Allows reading analytical or operational data without mutation.',
        requiresHumanReview: false,
        defaultScopeLimits: {
            maxRows: 1000
        }
    },
    'database.modify': {
        id: 'database.modify',
        boundTools: ['MODIFY_DATABASE'],
        description: 'Allows mutating database tables.',
        requiresHumanReview: true, 
    },
    'financial.transfer': {
        id: 'financial.transfer',
        boundTools: ['TRANSFER_FUNDS'],
        description: 'Allows moving real money between accounts.',
        requiresHumanReview: true,
        defaultScopeLimits: {
             maxAmount: 1000,
             currency: 'USD'
        }
    },
    'network.http': {
        id: 'network.http',
        boundTools: ['HTTP_REQUEST'],
        description: 'Allows making external HTTP requests to specific domains.',
        requiresHumanReview: true,
    },
    'system.filesystem': {
        id: 'system.filesystem',
        boundTools: ['FILE_SYSTEM_OPERATOR'],
        description: 'Allows reading/writing to the local sandbox filesystem.',
        requiresHumanReview: false,
    },
    'communication.slack': {
        id: 'communication.slack',
        boundTools: ['SLACK_OPERATOR'],
        description: 'Allows sending messages to internal Slack channels.',
        requiresHumanReview: false,
    },
    'support.zendesk': {
        id: 'support.zendesk',
        boundTools: ['ZENDESK_OPERATOR'],
        description: 'Allows interacting with the Zendesk ticketing system.',
        requiresHumanReview: false,
    }
};

export class CapabilityService {
    /**
     * Finds the capability that governs a specific raw tool action.
     */
    static getCapabilityForTool(actionType: string): CapabilityDefinition | undefined {
         return Object.values(CAPABILITY_REGISTRY).find(c => c.boundTools.includes(actionType));
    }
}
