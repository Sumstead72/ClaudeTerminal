'use strict';

module.exports = {
  type:     'workflow/wait',
  title:    'Wait',
  desc:     'Temporisation',
  color:    'muted',
  width:    200,
  category: 'flow',
  icon:     'wait',

  inputs:  [{ name: 'In', type: 'exec' }],
  outputs: [{ name: 'Done', type: 'exec' }],

  props: { mode: 'duration', duration: '5s', timeout: '' },

  fields: [
    { type: 'select', key: 'mode',     label: 'wfn.wait.mode.label',     options: ['duration', 'approval'] },
    { type: 'text',   key: 'duration', label: 'wfn.wait.duration.label', placeholder: '5s', showIf: (p) => !p.mode || p.mode === 'duration' },
    { type: 'text',   key: 'timeout',  label: 'wfn.wait.timeout.label',  placeholder: '60s', showIf: (p) => p.mode === 'approval' },
  ],

  badge: (n) => n.properties.mode === 'approval' ? 'APPROVAL' : (n.properties.duration || '5s').toUpperCase(),

  async run(config, vars, signal, ctx) {
    const parseMs = (value) => {
      if (typeof value === 'number') return value;
      if (typeof value !== 'string') return 60_000;
      const match = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
      if (!match) return parseInt(value, 10) || 60_000;
      const [, n, unit] = match;
      const num = parseFloat(n);
      const multipliers = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
      return Math.round(num * (multipliers[unit] || 1000));
    };

    const sleep = (ms, signal) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Cancelled'));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Cancelled')); }, { once: true });
    });

    const duration = config.duration;
    if (duration) {
      const ms = parseMs(duration);
      await sleep(ms, signal);
      return { waited: ms, timedOut: false };
    }

    // Approval mode: wait for human callback or timeout
    return new Promise((resolve, reject) => {
      const runId  = ctx?.runId  || 'unknown';
      const stepId = ctx?.stepId || `step_${Date.now()}`;
      const key    = `${runId}::${stepId}`;
      const timeoutMs = config.timeout ? parseMs(config.timeout) : null;

      const done = (result) => {
        if (ctx?.waitCallbacks) ctx.waitCallbacks.delete(key);
        clearTimeout(timer);
        resolve(result);
      };

      if (ctx?.waitCallbacks) ctx.waitCallbacks.set(key, done);

      const timer = timeoutMs
        ? setTimeout(() => done({ timedOut: true, approved: false }), timeoutMs)
        : null;

      const onAbort = () => {
        if (ctx?.waitCallbacks) ctx.waitCallbacks.delete(key);
        clearTimeout(timer);
        reject(new Error('Cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  },
};
