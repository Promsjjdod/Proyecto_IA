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
  LOW: { outputTokens: 512, inputContextTokens: 3_000, label: 'Rápido y económico' },
  MEDIO: { outputTokens: 1_200, inputContextTokens: 6_000, label: 'Equilibrado · recomendado' },
  ALTO: { outputTokens: 2_400, inputContextTokens: 12_000, label: 'Más profundidad' },
  EXTRA: { outputTokens: 4_000, inputContextTokens: 20_000, label: 'Programación y análisis' },
  MAX: { outputTokens: 6_000, inputContextTokens: 32_000, label: 'Máxima configuración disponible' },
} as const;
export type UsageMode = keyof typeof MODE_POLICIES;

export function budgetForMode(mode: UsageMode, modelContextTokens?: number | null) {
  const requested = MODE_POLICIES[mode] || MODE_POLICIES.MEDIO;
  const context = Number.isFinite(Number(modelContextTokens)) && Number(modelContextTokens) > 0 ? Math.floor(Number(modelContextTokens)) : 8192;
  const outputTokens = Math.min(requested.outputTokens, context - 512);
  return { outputTokens: Math.max(0, outputTokens), inputContextTokens: Math.max(0, Math.min(requested.inputContextTokens, context - Math.max(0, outputTokens))) };
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
