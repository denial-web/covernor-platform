import { Proposal } from '@prisma/client';
import { logger } from '../../utils/logger';
import { BaseProposalSchema } from '../policy/schema.validator';

export interface StructCriticResponse {
  isValid: boolean;
  reasonCode: 'APPROVED' | 'HALLUCINATED_TOOL' | 'MISSING_PARAMETERS' | 'VIOLATES_SYSTEM_INSTRUCTIONS' | 'EXCESSIVE_RISK';
  confidence: number;
  details?: string;
}

const SQL_INJECTION_PATTERNS = [
  /(\b(union|select|insert|update|delete|drop|alter|exec|execute)\b\s+(all\s+)?)/i,
  /(\b(or|and)\b\s+\d+\s*=\s*\d+)/i,
  /(--|#|\/\*)/,
  /(\binto\s+outfile\b)/i,
  /(\bload_file\b)/i,
  /(\bchar\s*\()/i,
  /(\bconcat\s*\()/i,
  /(\bhaving\b\s+\d)/i,
  /(\bwaitfor\b\s+\bdelay\b)/i,
  /(\bsleep\s*\()/i,
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /disregard\s+(your|all|the)\s+(instructions|rules|guidelines)/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  /\bdo\s+not\s+follow\b.*\brules\b/i,
  /\boverride\b.*\bsafety\b/i,
  /\bjailbreak\b/i,
  /\bDAN\b/,
  /\bpretend\s+you\b/i,
  /\broleplay\s+as\b/i,
];

const EXFILTRATION_PATTERNS = [
  /https?:\/\/[^\s]+\.(ru|cn|tk|ml|ga|cf)\b/i,
  /\bwebhook\.site\b/i,
  /\brequestbin\b/i,
  /\bngrok\b/i,
  /\bpipedream\b/i,
  /\bbase64\s*(encode|decode)/i,
  /\b(curl|wget|fetch)\s+http/i,
];

const SENSITIVE_DATA_PATTERNS = [
  /\bpassword\b/i,
  /\bsecret\b/i,
  /\bapi[_-]?key\b/i,
  /\btoken\b.*\b(auth|access|refresh|bearer)\b/i,
  /\bprivate[_-]?key\b/i,
  /\b(ssn|social\s*security)\b/i,
  /\bcredit[_-]?card\b/i,
];

export class CriticService {
  /**
   * Evaluates an Advisor's proposal with deterministic pattern analysis
   * before it reaches the Covernor.
   */
  async evaluate(proposal: Proposal, objective: string): Promise<StructCriticResponse> {
    logger.info(`[Critic] Evaluating Proposal ID: ${proposal.id} for Objective: "${objective}"`);

    const recOpt = proposal.recommendedOption as any;

    if (!recOpt || !recOpt.parameters || Object.keys(recOpt.parameters).length === 0) {
      return { isValid: false, reasonCode: 'MISSING_PARAMETERS', confidence: 0.95 };
    }

    const schemaResult = BaseProposalSchema.safeParse(recOpt);
    if (!schemaResult.success) {
      return {
        isValid: false,
        reasonCode: 'HALLUCINATED_TOOL',
        confidence: 0.99,
        details: `Schema violation: ${schemaResult.error.message}`,
      };
    }

    const allText = this.extractAllText(recOpt);

    const sqlMatch = this.scanPatterns(allText, SQL_INJECTION_PATTERNS);
    if (sqlMatch) {
      logger.warn(`[Critic] SQL injection pattern detected in proposal ${proposal.id}`, { match: sqlMatch });
      return {
        isValid: false,
        reasonCode: 'VIOLATES_SYSTEM_INSTRUCTIONS',
        confidence: 0.92,
        details: `SQL injection pattern detected: "${sqlMatch}"`,
      };
    }

    const promptMatch = this.scanPatterns(allText, PROMPT_INJECTION_PATTERNS);
    if (promptMatch) {
      logger.warn(`[Critic] Prompt injection pattern detected in proposal ${proposal.id}`, { match: promptMatch });
      return {
        isValid: false,
        reasonCode: 'VIOLATES_SYSTEM_INSTRUCTIONS',
        confidence: 0.95,
        details: `Prompt injection pattern detected: "${promptMatch}"`,
      };
    }

    const exfilMatch = this.scanPatterns(allText, EXFILTRATION_PATTERNS);
    if (exfilMatch) {
      logger.warn(`[Critic] Data exfiltration pattern detected in proposal ${proposal.id}`, { match: exfilMatch });
      return {
        isValid: false,
        reasonCode: 'EXCESSIVE_RISK',
        confidence: 0.88,
        details: `Potential data exfiltration vector: "${exfilMatch}"`,
      };
    }

    if (recOpt.actionType === 'HTTP_REQUEST' || recOpt.actionType === 'SLACK_OPERATOR') {
      const sensitiveMatch = this.scanPatterns(allText, SENSITIVE_DATA_PATTERNS);
      if (sensitiveMatch) {
        logger.warn(`[Critic] Sensitive data reference in outbound action`, { match: sensitiveMatch, actionType: recOpt.actionType });
        return {
          isValid: false,
          reasonCode: 'EXCESSIVE_RISK',
          confidence: 0.85,
          details: `Sensitive data reference in outbound action: "${sensitiveMatch}"`,
        };
      }
    }

    if (recOpt.actionType === 'POSTGRESQL_QUERY' || recOpt.actionType === 'MODIFY_DATABASE') {
      const query = recOpt.parameters?.query || recOpt.parameters?.sql || '';
      if (typeof query === 'string') {
        if (/\b(DROP|TRUNCATE|ALTER)\s+(TABLE|DATABASE|INDEX|SCHEMA)/i.test(query)) {
          return {
            isValid: false,
            reasonCode: 'EXCESSIVE_RISK',
            confidence: 0.97,
            details: 'Destructive DDL operation (DROP/TRUNCATE/ALTER) detected in query.',
          };
        }
        if (/\bDELETE\b/i.test(query) && !/\bWHERE\b/i.test(query)) {
          return {
            isValid: false,
            reasonCode: 'EXCESSIVE_RISK',
            confidence: 0.93,
            details: 'Unbounded DELETE without WHERE clause detected.',
          };
        }
      }
    }

    return { isValid: true, reasonCode: 'APPROVED', confidence: 0.90 };
  }

  private extractAllText(obj: any, depth = 0): string {
    if (depth > 10) return '';
    if (typeof obj === 'string') return obj + ' ';
    if (Array.isArray(obj)) return obj.map(item => this.extractAllText(item, depth + 1)).join(' ');
    if (obj && typeof obj === 'object') {
      return Object.values(obj).map(val => this.extractAllText(val, depth + 1)).join(' ');
    }
    return String(obj ?? '') + ' ';
  }

  private scanPatterns(text: string, patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    return null;
  }
}
