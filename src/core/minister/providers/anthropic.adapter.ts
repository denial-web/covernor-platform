import Anthropic from '@anthropic-ai/sdk';
import { ILLMProvider, NormalizedLLMResponse } from './provider.interface';

export class AnthropicProvider implements ILLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = "claude-3-haiku-20240307", baseURL?: string) {
    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    this.model = model;
  }

  async generateText(input: string, systemPrompt?: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      system: systemPrompt,
      messages: [{ role: "user", content: input }],
      max_tokens: 4096,
      temperature: 0.2, // Consistent planning preferred
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error("Anthropic failed to generate a text response.");
    
    return content.text;
  }

  async generateStructured<T>(input: string, systemPrompt?: string): Promise<NormalizedLLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      system: (systemPrompt ?? "") + "\n\nCRITICAL: Respond ONLY with valid JSON. Do not return markdown, fences, or preamble text.",
      messages: [{ role: "user", content: input }],
      max_tokens: 4096,
      temperature: 0.2,
    });

    const contentBlock = response.content[0];
    if (contentBlock.type !== 'text') throw new Error("Anthropic failed to generate a structured response.");
    
    const content = contentBlock.text;
    const finishReason = response.stop_reason;

    let parsedJson: unknown;
    const warnings: string[] = [];
    
    try {
      // Basic Normalization - Strip Markdown fences if LLM ignored instructions
      let cleaned = content.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.substring(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.substring(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.substring(0, cleaned.length - 3);
      
      parsedJson = JSON.parse(cleaned.trim());
    } catch (e: any) {
      warnings.push(`JSON Parse Failed: ${e.message}`);
    }

    return {
      provider: "anthropic",
      model: this.model,
      rawText: content,
      parsedJson,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      finishReason: finishReason as string,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
}
