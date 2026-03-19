/**
 * Utility for sanitizing string payloads before exporting them to LLM fine-tuning datasets.
 * Prevents unintentional leakage of customer PII into model weights.
 */
export class PIIRedactor {
    /**
     * Applies standard Regex sanitization sweeps over a string.
     */
    static redact(text: string): string {
        if (!text) return text;
  
        let sanitized = text;
  
        // 1. Redact Emails (Basic standard regex)
        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
        sanitized = sanitized.replace(emailRegex, '[REDACTED_EMAIL]');
  
        // 2. Redact Phone Numbers (Common formats: +1-800-555-0199, (800) 555-0199, etc)
        // Simplified heuristic for broad North American / Int'l numbers
        const phoneRegex = /(\+?\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
        sanitized = sanitized.replace(phoneRegex, '[REDACTED_PHONE]');
  
        // 3. Redact Financial Amounts ($100, $1,000.50, 50 USD, 500 riel)
        const currencyRegex = /(\$\d{1,3}(,\d{3})*(\.\d{2})?)|(\d{1,3}(,\d{3})*(\.\d{2})?\s*(USD|EUR|GBP|KHR|riel|dollars?))/gi;
        sanitized = sanitized.replace(currencyRegex, '[REDACTED_AMOUNT]');
  
        // 4. Redact Credit Card / Account Numbers (13-19 consecutive digits, ignoring spaces/dashes)
        const ccRegex = /(?:\d[ -]*?){13,19}/g;
        sanitized = sanitized.replace(ccRegex, '[REDACTED_ACCOUNT]');
  
        return sanitized;
    }
    
    /**
     * Recursively redacts all string values in a deeply nested JSON object.
     */
    static redactObject(obj: any): any {
        if (typeof obj === 'string') {
            return this.redact(obj);
        } else if (Array.isArray(obj)) {
            return obj.map(item => this.redactObject(item));
        } else if (obj !== null && typeof obj === 'object') {
            const sanitizedObj: any = {};
            for (const [key, value] of Object.entries(obj)) {
                const lowerKey = key.toLowerCase();
                // If it's a naked number, scrub it based on object key context
                if (typeof value === 'number') {
                    if (lowerKey.includes('amount') || lowerKey.includes('price') || lowerKey.includes('balance') || lowerKey.includes('cost')) {
                        sanitizedObj[key] = '[REDACTED_NUMERIC_AMOUNT]';
                    } else if (lowerKey.includes('account') || lowerKey.includes('card') || lowerKey.includes('phone')) {
                        sanitizedObj[key] = '[REDACTED_COMPLIANCE_NUMBER]';
                    } else {
                        sanitizedObj[key] = value; // Safe non-PII number like 'retryCount'
                    }
                } else {
                    sanitizedObj[key] = this.redactObject(value);
                }
            }
            return sanitizedObj;
        }
        return obj;
    }
  }
  
