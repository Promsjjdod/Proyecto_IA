import { z } from 'zod';
import { badRequest } from './errors.js';

export { z };

/** Validate `data` against a zod schema or throw a 400 AppError with field details. */
export function parse(schema, data, label = 'input') {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.') || '(root)',
      message: i.message,
    }));
    throw badRequest(`Invalid ${label}.`, details);
  }
  return result.data;
}

/** Safe filename: strips path separators and dangerous characters. */
export function safeFileName(name) {
  return String(name || 'file')
    .replace(/[/\\]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/[<>:"|?*\x00-\x1f]/g, '')
    .slice(0, 180) || 'file';
}

export const idSchema = z.string().min(1).max(64);

export const chatCreateSchema = z.object({
  title: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  providerId: z.string().max(64).optional(),
  agentId: z.string().max(64).nullable().optional(),
  folder: z.string().max(120).optional(),
  systemPrompt: z.string().max(8000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(200000).optional(),
});

export const chatUpdateSchema = chatCreateSchema.partial().extend({
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export const messageSendSchema = z.object({
  content: z.string().min(0).max(200000),
  model: z.string().max(200).optional(),
  providerId: z.string().max(64).optional(),
  agentId: z.string().max(64).nullable().optional(),
  attachments: z.array(z.object({
    fileId: z.string().max(64),
    name: z.string().max(200),
    mime: z.string().max(120),
    size: z.number().int().nonnegative().optional(),
  })).max(10).optional(),
  regenerate: z.boolean().optional(),
  editMessageId: z.string().max(64).optional(),
});

export const providerSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(['openai-compatible', 'ollama', 'custom', 'demo']),
  baseUrl: z.string().max(500).optional().default(''),
  apiVersion: z.string().max(40).optional().default(''),
  apiKey: z.string().max(2000).optional().default(''),
  headers: z.record(z.string(), z.string().max(2000)).optional().default({}),
  bodyParams: z.record(z.string(), z.unknown()).optional().default({}),
  contextWindow: z.number().int().min(1).max(10000000).optional().default(128000),
  tags: z.array(z.string().max(40)).max(20).optional().default([]),
  icon: z.string().max(8).optional().default('◆'),
  pricingInput: z.number().min(0).optional().default(0),
  pricingOutput: z.number().min(0).optional().default(0),
  enabled: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
  responseMode: z.enum(['openai-sse', 'json-text', 'ndjson-ollama']).optional().default('openai-sse'),
  chatPath: z.string().max(200).optional().default('/chat/completions'),
});

export const agentSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000).optional().default(''),
  avatar: z.string().max(8).optional().default('◈'),
  model: z.string().max(200).optional().default(''),
  providerId: z.string().max(64).optional().default(''),
  systemPrompt: z.string().max(20000).optional().default(''),
  tools: z.array(z.string().max(80)).max(60).optional().default([]),
  plugins: z.array(z.string().max(80)).max(60).optional().default([]),
  memory: z.object({
    conversation: z.boolean().default(true),
    agent: z.boolean().default(true),
    workspace: z.boolean().default(false),
    retention: z.enum(['session', 'persistent']).default('persistent'),
  }).optional().default({ conversation: true, agent: true, workspace: false, retention: 'persistent' }),
  contextWindow: z.number().int().min(512).max(10000000).optional().default(128000),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().int().min(1).max(200000).optional().default(4096),
  permissions: z.array(z.string().max(40)).max(10).optional().default(['READ_FILES']),
  enabled: z.boolean().optional().default(true),
});

export const taskCreateSchema = z.object({
  prompt: z.string().min(1).max(50000),
  agentId: z.string().max(64).optional(),
  chatId: z.string().max(64).optional(),
  title: z.string().max(200).optional(),
});

export const settingsUpdateSchema = z.record(z.string().max(80), z.unknown());

export const imageGenSchema = z.object({
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(2000).optional().default(''),
  aspect: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional().default('1:1'),
  resolution: z.enum(['512', '768', '1024']).optional().default('1024'),
  count: z.number().int().min(1).max(4).optional().default(1),
  style: z.string().max(80).optional().default('auto'),
});

export const videoGenSchema = z.object({
  prompt: z.string().min(1).max(4000),
  duration: z.number().min(1).max(60).optional().default(5),
  resolution: z.enum(['480p', '720p', '1080p']).optional().default('720p'),
  aspect: z.enum(['16:9', '9:16', '1:1']).optional().default('16:9'),
  style: z.string().max(80).optional().default('auto'),
});
