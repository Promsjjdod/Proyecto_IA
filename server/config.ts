import path from 'node:path';

export const PORT = Number(process.env.PORT || 4000);
export const HOST = process.env.HOST || '0.0.0.0';
export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const DB_FILE = path.join(DATA_DIR, 'nexus.sqlite');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const PROJECT_DIR = path.join(DATA_DIR, 'projects');
export const isProduction = process.env.NODE_ENV === 'production';

export const DEFAULT_PROVIDER_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434/v1',
  'openai-compatible': '',
  custom: '',
};

export const ALLOWED_PROVIDER_TYPES = (process.env.ALLOWED_PROVIDER_TYPES || 'openai,anthropic,google,deepseek,ollama,openai-compatible,custom')
  .split(',').map((v) => v.trim()).filter(Boolean);

export const MODE_POLICIES = {
  LOW: { effort: 'low', label: 'Rápido y directo', instruction: 'Resuelve la solicitud directamente con la planificación mínima necesaria. No reduzcas ni omitas contenido que el usuario haya pedido.' },
  MEDIO: { effort: 'balanced', label: 'Equilibrado · recomendado', instruction: 'Equilibra la planificación, la verificación y la explicación según la complejidad de la solicitud.' },
  HIGH: { effort: 'high', label: 'Más profundidad y planificación', instruction: 'Analiza los requisitos, planifica los pasos y verifica las partes importantes antes de concluir.' },
  MAX: { effort: 'maximum', label: 'Máxima profundidad disponible', instruction: 'Usa la planificación y verificación más exhaustivas que permita el modelo; completa el trabajo sin abreviarlo por el modo.' },
} as const;
export const DEFAULT_TASK_TOKEN_BUDGET = 1_000_000;
export const MAX_TASK_TOKENS = DEFAULT_TASK_TOKEN_BUDGET;
const configuredTaskBudget = Number(process.env.TASK_TOKEN_BUDGET ?? DEFAULT_TASK_TOKEN_BUDGET);
export const TASK_TOKEN_BUDGET = Number.isSafeInteger(configuredTaskBudget) && configuredTaskBudget > 0 && configuredTaskBudget <= MAX_TASK_TOKENS
  ? configuredTaskBudget
  : DEFAULT_TASK_TOKEN_BUDGET;
export type UsageMode = keyof typeof MODE_POLICIES;
export type ModelTokenLimits = { contextTokens?: number | null; maxInputTokens?: number | null; maxOutputTokens?: number | null };
export type OutputTokenLimitSource = 'provider-metadata' | 'user-configured' | 'unknown';

function validModelOutputLimit(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveModelOutputLimit(providerMetadataLimit?: unknown, configuredLimit?: unknown) {
  const providerLimit = validModelOutputLimit(providerMetadataLimit);
  if (providerLimit !== null) return { maxOutputTokens: providerLimit, source: 'provider-metadata' as const };
  const userLimit = validModelOutputLimit(configuredLimit);
  if (userLimit !== null) return { maxOutputTokens: userLimit, source: 'user-configured' as const };
  return { maxOutputTokens: null, source: 'unknown' as const };
}

export function normalizeUsageMode(value: unknown): UsageMode | null {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'ALTO' || normalized === 'EXTRA') return 'HIGH';
  return normalized in MODE_POLICIES ? normalized as UsageMode : null;
}

function positiveTokenLimit(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Applies provider/model limits only; work modes do not set input or output token caps. */
export function budgetForMode(_mode: UsageMode, limits: ModelTokenLimits = {}) {
  const configuredContext = positiveTokenLimit(limits.contextTokens);
  const configuredInput = positiveTokenLimit(limits.maxInputTokens);
  const configuredOutput = positiveTokenLimit(limits.maxOutputTokens);
  return { outputTokens: configuredOutput, inputContextTokens: configuredInput ?? configuredContext };
}

export function outputLimitForRequest(limits: ModelTokenLimits, remainingTaskTokens: number, estimatedInputTokens: number) {
  const modelLimit = positiveTokenLimit(limits.maxOutputTokens);
  if (modelLimit === null) return null;
  const remaining = positiveTokenLimit(remainingTaskTokens);
  if (remaining === null) return 0;
  const input = Math.max(0, estimatedInputTokens);
  const maxInput = positiveTokenLimit(limits.maxInputTokens);
  if (maxInput !== null && input > maxInput) return 0;
  const context = positiveTokenLimit(limits.contextTokens);
  const contextRemaining = context === null ? Number.POSITIVE_INFINITY : Math.max(0, context - input);
  return Math.max(0, Math.min(modelLimit, remaining, contextRemaining));
}

export const BUILTIN_AGENTS = [
  { name: 'Asistente general', description: 'Ayuda cotidiana, clara y práctica.', icon: 'sparkles', mode: 'MEDIO', tools: [] as string[], prompt: 'Ayuda con claridad. Si algo es incierto, dilo explícitamente.' },
  { name: 'Programación', description: 'Diseña, implementa y revisa código.', icon: 'code', mode: 'EXTRA', tools: ['read_files', 'write_files'], prompt: 'Eres un ingeniero de software cuidadoso. Comprende el contexto, propone cambios mínimos, escribe código funcional y explica cómo verificarlo. Usa las herramientas de archivos autorizadas cuando estén disponibles.' },
  { name: 'Desarrollo web', description: 'Crea experiencias web completas y accesibles.', icon: 'globe', mode: 'EXTRA', tools: ['read_files', 'write_files'], prompt: 'Eres especialista en desarrollo web. Prioriza accesibilidad, responsive design, rendimiento y código mantenible. Si se te autoriza acceso a archivos, úsalo para crear una solución verificable.' },
  { name: 'Creador de juegos', description: 'Diseño de mecánicas, scripts y prototipos.', icon: 'gamepad', mode: 'ALTO', tools: ['read_files', 'write_files'], prompt: 'Diseña sistemas de juego claros, modulares y probables. Explica dependencias y cómo integrar cada archivo.' },
  { name: 'Roblox Studio', description: 'Asistencia para Luau y arquitectura Roblox.', icon: 'blocks', mode: 'EXTRA', tools: ['read_files', 'write_files'], prompt: 'Eres especialista en Roblox Studio y Luau. Distingue Script, LocalScript y ModuleScript, usa APIs de Roblox conocidas y explica exactamente dónde ubicar cada archivo. No inventes APIs.' },
  { name: 'Análisis de documentos', description: 'Resume y estructura documentos proporcionados.', icon: 'file-search', mode: 'ALTO', tools: ['read_files'], prompt: 'Analiza únicamente los documentos y datos proporcionados. Diferencia hechos, inferencias e información ausente.' },
  { name: 'Automatizaciones', description: 'Diseña flujos claros y con manejo de errores.', icon: 'workflow', mode: 'EXTRA', tools: ['read_files', 'write_files'], prompt: 'Descompón automatizaciones en pasos verificables, con validación, límites y manejo explícito de errores.' },
];
