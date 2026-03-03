'use strict';

module.exports = {
  type:     'workflow/notify',
  title:    'Notify',
  desc:     'Notification',
  color:    'orange',
  width:    200,
  category: 'actions',
  icon:     'notify',

  inputs:  [{ name: 'In', type: 'exec' }],
  outputs: [{ name: 'Done', type: 'exec' }],

  props: { title: '', message: '' },

  fields: [
    { type: 'text',     key: 'title',   label: 'wfn.notify.title.label',   placeholder: 'Build done' },
    { type: 'textarea', key: 'message', label: 'wfn.notify.message.label',
      hint: 'wfn.notify.message.hint',
      placeholder: '$ctx.project build completed successfully.' },
  ],

  async run(config, vars, signal, ctx) {
    const resolveVars = (value, vars) => {
      if (typeof value !== 'string') return value;
      return value.replace(/\$([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g, (match, key) => {
        const parts = key.split('.');
        let cur = vars instanceof Map ? vars.get(parts[0]) : vars[parts[0]];
        for (let i = 1; i < parts.length && cur != null; i++) cur = cur[parts[i]];
        return cur != null ? String(cur).replace(/[\r\n]+$/, '') : match;
      });
    };

    const title   = resolveVars(config.title   || 'Workflow', vars);
    const message = resolveVars(config.message  || '',         vars);
    const channels = config.channels || ['desktop'];

    const tasks = [];
    for (const ch of channels) {
      if (ch === 'desktop') {
        if (ctx?.sendFn) ctx.sendFn('workflow-notify-desktop', { title, message });
      } else if (typeof ch === 'object') {
        const [type, urlRaw] = Object.entries(ch)[0];
        const url = resolveVars(urlRaw, vars);
        if (!url || url.startsWith('$')) continue;
        let body;
        if (type === 'discord') {
          body = JSON.stringify({ content: message });
        } else if (type === 'slack') {
          body = JSON.stringify({ text: message });
        } else {
          body = JSON.stringify({ message });
        }
        tasks.push(
          fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          }).catch(err => console.warn(`[notify.node] ${type} failed:`, err.message))
        );
      }
    }

    await Promise.allSettled(tasks);
    return { sent: true, message };
  },
};
