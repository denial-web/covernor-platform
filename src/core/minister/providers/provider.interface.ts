export interface NormalizedLLMResponse {
  provider: "openai" | "anthropic" | "ollama" | "custom";
  model: string;
  rawText: string;
  parsedJson?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
  warnings?: string[];
}

export interface ILLMProvider {
  /**
   * Generates a raw text response
   */
  generateText(input: string, systemPrompt?: string): Promise<string>;

  /**
   * Generates structured data corresponding to a known schema
   */
  generateStructured<T>(input: string, systemPrompt?: string): Promise<NormalizedLLMResponse>;
}
