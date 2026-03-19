import { Request, Response, Router } from 'express';

import { EncryptionService } from '../core/crypto/encryption.service';
import { requireAuth, requireRole } from './auth.middleware';
import { OpenAIProvider } from '../core/minister/providers/openai.adapter';
import { AnthropicProvider } from '../core/minister/providers/anthropic.adapter';
import { OllamaProvider } from '../core/minister/providers/ollama.adapter';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { prisma } from '../db/client';

export const settingsRouter = Router();

const SaveSettingsSchema = z.object({
  active_provider: z.enum(['openai', 'anthropic', 'ollama', 'custom']),
  openai_key: z.string().optional(),
  anthropic_key: z.string().optional(),
  model: z.string().optional(),
  base_url: z.string().optional(),
});

settingsRouter.use(requireAuth);
settingsRouter.use(requireRole('admin'));

// GET /api/settings/llm
// Returns current active provider and whether keys are set (but NOT the raw keys)
settingsRouter.get('/llm', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    
    // Fetch settings for this tenant 
    const settings = await prisma.systemSettings.findMany({
      where: { tenantId, category: 'llm_providers' }
    });

    const config: Record<string, string | boolean> = {
      active_provider: 'openai',
      has_openai_key: false,
      has_anthropic_key: false,
      model: '',
      base_url: '',
    };

    for (const s of settings) {
      switch (s.key) {
        case 'active_provider': config.active_provider = s.value; break;
        case 'openai_key':      if (s.value) config.has_openai_key = true; break;
        case 'anthropic_key':   if (s.value) config.has_anthropic_key = true; break;
        case 'model':           config.model = s.value; break;
        case 'base_url':        config.base_url = s.value; break;
      }
    }

    res.json(config);
  } catch (error) {
    logger.error('Failed to fetch LLM settings', { error });
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// POST /api/settings/llm/save
// Encrypts and saves keys
settingsRouter.post('/llm/save', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const data = SaveSettingsSchema.parse(req.body);

    const upsertSetting = async (key: string, value: string) => {
      await prisma.systemSettings.upsert({
        where: {
          tenantId_category_key: {
            tenantId,
            category: 'llm_providers',
            key
          }
        },
        update: { value },
        create: {
          tenantId,
          category: 'llm_providers',
          key,
          value
        }
      });
    };

    await upsertSetting('active_provider', data.active_provider);

    if (data.openai_key && data.openai_key.trim() !== '') {
      await upsertSetting('openai_key', EncryptionService.encrypt(data.openai_key));
    }

    if (data.anthropic_key && data.anthropic_key.trim() !== '') {
      await upsertSetting('anthropic_key', EncryptionService.encrypt(data.anthropic_key));
    }

    if (data.model !== undefined) {
      await upsertSetting('model', data.model);
    }

    if (data.base_url !== undefined) {
      await upsertSetting('base_url', data.base_url);
    }

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error: any) {
    logger.error('Failed to save LLM settings', { error: error.message });
    res.status(400).json({ error: 'Failed to save settings' });
  }
});

// POST /api/settings/llm/test
// Tests connection to the specified provider
settingsRouter.post('/llm/test', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const { provider, key } = req.body;
    
    let apiKey = key;
    
    // If key not provided in test request, try to fetch existing one
    if (!apiKey) {
      const setting = await prisma.systemSettings.findUnique({
        where: {
          tenantId_category_key: { tenantId, category: 'llm_providers', key: `${provider}_key` }
        }
      });
      if (setting) {
         apiKey = EncryptionService.decrypt(setting.value);
      }
    }

    if (!apiKey && provider !== 'ollama') {
      res.status(400).json({ error: 'No API key available to test.' });
      return;
    }

    const { model: reqModel, base_url: reqBaseURL } = req.body;

    let result;
    const testPrompt = 'Say exactly "Connection Successful" and nothing else.';
    switch (provider) {
      case 'anthropic': {
        const p = new AnthropicProvider(apiKey, reqModel || undefined, reqBaseURL || undefined);
        result = await p.generateText(testPrompt);
        break;
      }
      case 'ollama': {
        const p = new OllamaProvider(reqModel || undefined, reqBaseURL || undefined);
        result = await p.generateText(testPrompt);
        break;
      }
      case 'custom':
      case 'openai':
      default: {
        const p = new OpenAIProvider(apiKey, reqModel || undefined, reqBaseURL || undefined);
        result = await p.generateText(testPrompt);
        break;
      }
    }

    res.json({ success: true, message: result });
  } catch (error: any) {
    logger.error('Provider test failed', { error: error.message });
    res.status(400).json({ error: 'Provider connection failed.' });
  }
});
