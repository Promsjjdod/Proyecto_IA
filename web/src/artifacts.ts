export type CodeArtifact = {
  id: string;
  filename: string;
  language: string;
  kind: 'html-document' | 'html-fragment' | 'css' | 'javascript' | 'code';
  content: string;
};

const explanatoryContext = /\b(?:ejemplo|examples?|por ejemplo|snippet|fragmento|fragment)\b/i;

function isCompleteHtmlDocument(value: string) {
  const html = value.trimStart().replace(/^\uFEFF/, '');
  return /^(?:<!doctype\s+html\b[^>]*>\s*)?<html(?:\s|>)[\s\S]*<\/html\s*>\s*$/i.test(html)
    && /<body(?:\s|>)[\s\S]*<\/body\s*>/i.test(html);
}

function languageForFence(info: string): { language: string; kind: CodeArtifact['kind'] } | null {
  const value = info.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (!value || !/^[a-z0-9.+#-]{1,20}$/.test(value)) return null;
  if (['html', 'htm', 'xhtml'].includes(value)) return { language: 'html', kind: 'html-fragment' };
  if (value === 'css') return { language: 'css', kind: 'css' };
  if (['js', 'javascript', 'mjs', 'cjs'].includes(value)) return { language: 'javascript', kind: 'javascript' };
  return { language: value, kind: 'code' };
}

function detectUnfencedArtifact(content: string): CodeArtifact | null {
  const value = content.trim();
  if (isCompleteHtmlDocument(value)) return artifactFor('html', content, 1);
  if (/^<(?:!--|!doctype\b|html\b|head\b|body\b|div\b|main\b|section\b|article\b|header\b|footer\b|nav\b|p\b|h[1-6]\b|ul\b|ol\b|li\b|table\b|form\b|button\b|style\b|script\b)/i.test(value)
    && /<\/?[a-z][^>]*>/i.test(value)) return artifactFor('html', content, 1);
  if (/^(?:@media\b|@import\b|@keyframes\b|:root\b|[.#*a-z][\w.#:[\]="'(),\s-]*\{)/i.test(value)
    && /{[\s\S]*}/.test(value)) return artifactFor('css', content, 1);
  if (/^(?:['"]use strict['"];?\s*)?(?:\/\/[^\n]*\n\s*)*(?:const|let|var|function|class|import|export|document\.|window\.|console\.|(?:async\s+)?(?:\(\s*\)|[A-Za-z_$][\w$]*)\s*=>)/.test(value)) {
    return artifactFor('javascript', content, 1);
  }
  return null;
}

function artifactFor(language: string, content: string, index: number, detectedKind?: CodeArtifact['kind']): CodeArtifact {
  const completeHtml = language === 'html' && isCompleteHtmlDocument(content);
  const fallbackKind: CodeArtifact['kind'] = language === 'html' ? 'html-fragment' : language === 'css' ? 'css' : language === 'javascript' ? 'javascript' : 'code';
  const kind: CodeArtifact['kind'] = completeHtml ? 'html-document' : detectedKind || fallbackKind;
  const baseName = kind === 'html-document' ? 'index' : kind === 'html-fragment' ? 'fragment' : kind === 'css' ? 'styles' : kind === 'javascript' ? 'script' : 'code';
  const codeExtensions: Record<string, string> = { python: 'py', typescript: 'ts', shell: 'sh', bash: 'sh', yaml: 'yml', markdown: 'md' };
  const extension = language === 'javascript' ? 'js' : kind === 'code' ? codeExtensions[language] || language.replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'txt' : language;
  const suffix = index > 1 ? `-${index}` : '';
  return { id: `${language}-${index}`, filename: `${baseName}${suffix}.${extension}`, language, kind, content };
}

export function detectCodeArtifacts(content: string): CodeArtifact[] {
  if (!content) return [];
  const matches: { language: string; kind: CodeArtifact['kind']; content: string; start: number; end: number }[] = [];
  const fencePattern = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\r\n]*)\r?\n([\s\S]*?)\r?\n[ \t]{0,3}\2[ \t]*(?=\r?\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(content))) {
    const detected = languageForFence(match[3]);
    if (detected) {
      const prefixLength = match[1].length;
      matches.push({ ...detected, content: match[4], start: match.index + prefixLength, end: fencePattern.lastIndex });
    }
  }

  if (!matches.length) {
    const artifact = detectUnfencedArtifact(content);
    return artifact ? [artifact] : [];
  }

  const surroundingText = matches.map((item, index) => {
    const start = index === 0 ? 0 : matches[index - 1].end;
    return content.slice(start, item.start);
  }).join(' ') + content.slice(matches[matches.length - 1].end);
  if (explanatoryContext.test(surroundingText)) return [];

  const counts = new Map<string, number>();
  return matches.map((item) => {
    const index = (counts.get(item.language) || 0) + 1;
    counts.set(item.language, index);
    return artifactFor(item.language, item.content, index, item.kind);
  });
}

export function textFromCodeChildren(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return `${value}`;
  if (Array.isArray(value)) return value.map(textFromCodeChildren).join('');
  return '';
}

export function artifactDownload(artifact: CodeArtifact, content = artifact.content) {
  const mimeType = artifact.language === 'html' ? 'text/html;charset=utf-8'
    : artifact.language === 'css' ? 'text/css;charset=utf-8'
      : artifact.language === 'javascript' ? 'text/javascript;charset=utf-8'
        : artifact.language === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
  return { filename: artifact.filename, mimeType, content };
}

export function artifactPreviewDocument(artifact: CodeArtifact, content = artifact.content) {
  if (artifact.kind === 'html-document') return content;
  const policy = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>Vista previa</title></head><body>${content}</body></html>`;
}

export const artifactPreviewSandbox = 'allow-scripts';
