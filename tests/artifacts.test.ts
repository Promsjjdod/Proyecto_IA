import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { providerTextContent } from '../server/providers/content.js';
import {
  artifactDownload,
  artifactPreviewDocument,
  artifactPreviewSandbox,
  detectCodeArtifacts,
  textFromCodeChildren,
} from '../web/src/artifacts.js';
import { ArtifactPreviewFrame, GeneratedArtifactCards } from '../web/src/components/GeneratedArtifactCards.js';

const completeHtml = '<!DOCTYPE html>\n<html>\n<head><title>Solar</title></head>\n<body><h1>Solar system</h1><script>document.body.dataset.ready = "true";</script></body>\n</html>';

test('detects and copies a complete HTML document without Markdown or UI text', () => {
  const [artifact] = detectCodeArtifacts(`## Proyecto Solar\n\n\`\`\`html\n${completeHtml}\n\`\`\``);
  assert.ok(artifact);
  assert.equal(artifact.filename, 'index.html');
  assert.equal(artifact.kind, 'html-document');
  assert.equal(artifactDownload(artifact).content, completeHtml);
});

test('detects separate CSS and JavaScript blocks and downloads their actual code', () => {
  const artifacts = detectCodeArtifacts('Panel:\n\n```css\nbody { color: teal; }\n```\n\n```javascript\nconst ready = true;\n```');
  assert.deepEqual(artifacts.map(({ language, filename, content }) => ({ language, filename, content })), [
    { language: 'css', filename: 'styles.css', content: 'body { color: teal; }' },
    { language: 'javascript', filename: 'script.js', content: 'const ready = true;' },
  ]);
  assert.equal(artifactDownload(artifacts[0]).mimeType, 'text/css;charset=utf-8');
  assert.equal(artifactDownload(artifacts[1]).mimeType, 'text/javascript;charset=utf-8');
});

test('recognizes and downloads other explicitly typed Markdown code', () => {
  const [artifact] = detectCodeArtifacts('```python\nprint("solar")\n```');
  assert.ok(artifact);
  assert.equal(artifact.filename, 'code.py');
  assert.equal(artifact.kind, 'code');
  assert.equal(artifactDownload(artifact).content, 'print("solar")');
});

test('normalizes typed provider content blocks without stringifying objects or metadata', () => {
  const blocks = [
    { type: 'text', text: '<h1>Solar</h1>' },
    { type: 'image', image: { id: 'hidden-metadata' } },
    { type: 'output_text', text: '<p>System</p>' },
    { type: 'text', text: { value: 'not textual' } },
    { type: 'text_delta', text: '!' },
    { type: 'refusal', refusal: 'I cannot help with that request.' },
  ];
  assert.equal(providerTextContent(blocks), '<h1>Solar</h1><p>System</p>!I cannot help with that request.');
  assert.equal(providerTextContent({ type: 'text', text: 'unrecognized object envelope' }), '');
  assert.equal(textFromCodeChildren(['<h1>', ['Solar', 2], { toString: () => '[object Object]' }, null, '</h1>']), '<h1>Solar2</h1>');
});

test('preserves source order when extracting multiple artifact blocks', () => {
  const artifacts = detectCodeArtifacts('```html\n<div>one</div>\n```\n```css\n.one {}\n```\n```html\n<div>two</div>\n```');
  assert.deepEqual(artifacts.map((artifact) => artifact.content), ['<div>one</div>', '.one {}', '<div>two</div>']);
  assert.deepEqual(artifacts.map((artifact) => artifact.filename), ['fragment.html', 'styles.css', 'fragment-2.html']);
});

test('HTML download contains only the original generated document', () => {
  const artifact = detectCodeArtifacts(completeHtml)[0];
  assert.ok(artifact);
  assert.deepEqual(artifactDownload(artifact), {
    filename: 'index.html',
    mimeType: 'text/html;charset=utf-8',
    content: completeHtml,
  });
});

test('renders a complete HTML preview without wrapping or duplicating its document', () => {
  const artifact = detectCodeArtifacts(completeHtml)[0];
  assert.ok(artifact);
  assert.equal(artifactPreviewDocument(artifact), completeHtml);
  const markup = renderToStaticMarkup(createElement(ArtifactPreviewFrame, { artifact, content: completeHtml, onError: () => undefined }));
  assert.match(markup, /<iframe/);
  assert.match(markup, /sandbox="allow-scripts"/);
  assert.match(markup, /referrerPolicy="no-referrer"/);
});

test('Markdown examples are not promoted as standalone artifacts and normal prose stays unchanged', () => {
  const example = 'Un ejemplo de HTML:\n\n```html\n<div>solo una muestra</div>\n```';
  assert.deepEqual(detectCodeArtifacts(example), []);
  const plainText = 'Una respuesta normal con <3 caracteres y una explicación.';
  assert.deepEqual(detectCodeArtifacts(plainText), []);
  assert.equal(plainText, 'Una respuesta normal con <3 caracteres y una explicación.');
});

test('preview card exposes wired preview, code, copy, and download controls', () => {
  const markup = renderToStaticMarkup(createElement(GeneratedArtifactCards, { content: `\`\`\`html\n${completeHtml}\n\`\`\`` }));
  assert.match(markup, /Vista previa/);
  assert.match(markup, /Editar código/);
  assert.match(markup, /Copiar código/);
  assert.match(markup, /Descargar/);
});

test('HTML previews allow scripts but do not grant access to Nexus origin or state', () => {
  assert.equal(artifactPreviewSandbox, 'allow-scripts');
  assert.equal(artifactPreviewSandbox.includes('allow-same-origin'), false);
  assert.equal(artifactPreviewSandbox.includes('allow-top-navigation'), false);
});
