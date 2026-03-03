'use strict';

module.exports = {
  type:     'workflow/shell',
  title:    'Shell',
  desc:     'Commande bash',
  color:    'blue',
  width:    220,
  category: 'actions',
  icon:     'shell',

  inputs:  [{ name: 'In', type: 'exec' }],
  outputs: [
    { name: 'Done',     type: 'exec'   },
    { name: 'Error',    type: 'exec'   },
    { name: 'stdout',   type: 'string' },
    { name: 'stderr',   type: 'string' },
    { name: 'exitCode', type: 'number' },
  ],

  props: { command: '' },

  fields: [
    { type: 'cwd-picker', key: 'projectId', label: 'wfn.shell.projectId.label',
      hint: 'wfn.shell.projectId.hint' },
    { type: 'textarea', key: 'command', label: 'wfn.shell.command.label', mono: true,
      placeholder: 'npm run build' },
  ],

  badge: () => '$',
  drawExtra: (ctx, n) => {
    const MONO = '"Cascadia Code","Fira Code",monospace';
    if (n.properties.command) {
      ctx.fillStyle = '#444';
      ctx.font = `10px ${MONO}`;
      const cmd = n.properties.command.length > 28
        ? n.properties.command.slice(0, 28) + '...'
        : n.properties.command;
      ctx.textAlign = 'left';
      ctx.fillText('$ ' + cmd, 10, n.size[1] - 6);
    }
  },

  // NOTE: resolveVars is not yet exported from WorkflowRunner (module.exports = WorkflowRunner class only).
  // This run() uses child_process.exec directly and will be wired to WorkflowRunner.runShellStep in Task 9.
  async run(config, vars, signal) {
    const { exec } = require('child_process');

    // Minimal inline var resolution until WorkflowRunner exports resolveVars
    const resolveVars = (value, vars) => {
      if (typeof value !== 'string') return value;
      return value.replace(/\$([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g, (match, key) => {
        const parts = key.split('.');
        let cur = vars instanceof Map ? vars.get(parts[0]) : vars[parts[0]];
        for (let i = 1; i < parts.length && cur != null; i++) cur = cur[parts[i]];
        return cur != null ? String(cur).replace(/[\r\n]+$/, '') : match;
      });
    };

    const raw = resolveVars(config.command || '', vars);
    if (!raw.trim()) throw new Error('No command specified');

    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Aborted'));

      let child;
      const onAbort = () => { try { child?.kill('SIGKILL'); } catch {} };
      signal?.addEventListener('abort', onAbort, { once: true });

      child = exec(raw, { timeout: 60000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) return reject(new Error('Aborted'));
        resolve({
          stdout:   stdout   || '',
          stderr:   stderr   || '',
          exitCode: err ? (err.code ?? 1) : 0,
        });
      });
    });
  },
};
