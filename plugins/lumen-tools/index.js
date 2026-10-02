/**
 * Herramientas de Lumen — plugin real que se ejecuta aislado en un Worker.
 *
 * Usa únicamente la API `lumen` que expone el host y los permisos declarados en `plugin.json`:
 * leer y escribir en el editor, escribir en la consola, leer y escribir ajustes, y mostrar un
 * elemento en la barra de estado. Si intentara algo sin permiso, el host rechazaría la llamada y
 * el error aparecería en la consola: no hay forma de saltarse el aislamiento desde aquí.
 */

export default function activate(lumen) {
  const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  lumen.commands.register(
    {
      id: 'insertHeader',
      title: 'Insertar cabecera de script',
      description: 'Añade un bloque de comentario con el nombre del archivo, el dialecto y la fecha.',
      category: 'Plugin: Herramientas de Lumen',
      icon: 'file-code',
      keywords: ['cabecera', 'header', 'plantilla'],
    },
    async () => {
      const document = await lumen.editor.getActive();
      if (!document?.active) {
        lumen.console.log('No hay ningún documento activo donde insertar la cabecera.', null, 'warning');
        return { ok: false, reason: 'sin documento activo' };
      }
      const header = [
        '--[[',
        `  ${document.name}`,
        `  Dialecto: ${document.dialect}`,
        `  Generado: ${stamp()}`,
        '  Creado con Lumen Studio — plugin «Herramientas de Lumen»',
        ']]',
        '',
      ].join('\n');
      await lumen.editor.insertText(header);
      lumen.console.log(`Cabecera insertada en ${document.name} (${header.length} caracteres).`, null, 'success');
      return { ok: true, inserted: header.length };
    },
  );

  lumen.commands.register(
    {
      id: 'sessionReport',
      title: 'Informe de la sesión (plugin)',
      description: 'Escribe en la consola el estado real del documento activo y de los ajustes relevantes.',
      category: 'Plugin: Herramientas de Lumen',
      icon: 'activity',
    },
    async () => {
      const document = await lumen.editor.getActive();
      const scripts = await lumen.scripts.list();
      const wrap = await lumen.settings.get('editor.wordWrap');
      const analysis = await lumen.settings.get('editor.analysisMode');
      const lines = [
        `Documento activo: ${document?.active ? `${document.name} (${document.dialect}, ${document.length} caracteres)` : 'ninguno'}`,
        `Scripts guardados: ${scripts.total}`,
        `Ajustes: ajuste de línea ${wrap ? 'activado' : 'desactivado'}, análisis «${analysis ?? 'desconocido'}»`,
      ];
      for (const line of lines) lumen.console.log(line, null, 'info');
      lumen.notifications.show({ message: 'Informe escrito en la consola', severity: 'success', durationMs: 2600 });
      return { ok: true, lines: lines.length };
    },
  );

  lumen.commands.register(
    {
      id: 'toggleWordWrap',
      title: 'Alternar ajuste de línea (plugin)',
      description: 'Cambia el ajuste de línea del editor usando el permiso settings:write.',
      category: 'Plugin: Herramientas de Lumen',
      icon: 'format',
      keywords: ['wrap', 'ajuste'],
    },
    async () => {
      const current = await lumen.settings.get('editor.wordWrap');
      const next = !current;
      await lumen.settings.set('editor.wordWrap', next);
      lumen.console.log(`Ajuste de línea ${next ? 'activado' : 'desactivado'} por el plugin.`, null, 'info');
      return { ok: true, wordWrap: next };
    },
  );

  lumen.statusbar.set({ id: 'tools', text: 'Herramientas activas', tooltip: 'Plugin «Herramientas de Lumen» en ejecución', severity: 'success' });

  lumen.events.on('onExecutionFinished', (payload) => {
    if (!payload || payload.state !== 'SUCCESS') return;
    lumen.console.log(`[plugin] ejecución completada: ${payload.name ?? 'script'} en ${payload.durationMs ?? '—'} ms`, null, 'debug');
  });

  lumen.console.log('Plugin «Herramientas de Lumen» listo: 3 comandos registrados.', null, 'success');
}
