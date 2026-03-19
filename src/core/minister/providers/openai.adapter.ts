import OpenAI from 'openai';
import { ILLMProvider, NormalizedLLMResponse } from './provider.interface';

export class OpenAIProvider implements ILLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = "gpt-4o-mini", baseURL?: string) {
    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    this.model = model;
  }

  async generateText(input: string, systemPrompt?: string): Promise<string> {
    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: input });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.2, // Consistent planning preferred
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI failed to generate a text response.");
    
    return content;
  }

  async generateStructured<T>(input: string, systemPrompt?: string): Promise<NormalizedLLMResponse> {
    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: input });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const content = response.choices[0]?.message?.content;
    const finishReason = response.choices[0]?.finish_reason;
    if (!content) throw new Error("OpenAI failed to generate a structured response.");

    let parsedJson: unknown;
    const warnings: string[] = [];
    
    try {
      // Basic Normalization - Strip Markdown fences if LLM ignored response_format constraints somewhat
      let cleaned = content.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.substring(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.substring(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.substring(0, cleaned.length - 3);
      
      parsedJson = JSON.parse(cleaned.trim());
    } catch (e: any) {
      warnings.push(`JSON Parse Failed: ${e.message}`);
    }

    return {
      provider: "openai",
      model: this.model,
      rawText: content,
      parsedJson,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      finishReason,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
}
