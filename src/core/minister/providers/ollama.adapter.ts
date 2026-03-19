import { OpenAIProvider } from './openai.adapter';

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_OLLAMA_MODEL = 'llama3';

/**
 * Ollama adapter — uses OpenAI-compatible /v1/chat/completions endpoint.
 * Works with any model available via `ollama list`.
 */
export class OllamaProvider extends OpenAIProvider {
  constructor(model?: string, baseURL?: string) {
    super(
      'ollama',
      model || DEFAULT_OLLAMA_MODEL,
      baseURL || DEFAULT_OLLAMA_BASE_URL,
    );
  }
}
