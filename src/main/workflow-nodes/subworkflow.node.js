'use strict';

module.exports = {
  type:     'workflow/subworkflow',
  title:    'Sub-workflow',
  desc:     'Appeler un autre workflow',
  color:    'purple',
  width:    220,
  category: 'flow',
  icon:     'subworkflow',

  inputs:  [{ name: 'In', type: 'exec' }],
  outputs: [
    { name: 'Done',    type: 'exec'    },
    { name: 'Error',   type: 'exec'    },
    { name: 'outputs', type: 'object'  },
    { name: 'runId',   type: 'string'  },
  ],

  props: { workflow: '', inputVars: '', waitForCompletion: true },

  fields: [
    { type: 'subworkflow-picker', key: 'workflow', label: 'wfn.subworkflow.label' },
  ],

  badge: (n) => n.properties.workflow ? n.properties.workflow.slice(0, 12).toUpperCase() : 'WORKFLOW',

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

    const workflowService = ctx?.workflowService;
    const workflowRef = resolveVars(config.workflow || '', vars);
    if (!workflowRef) throw new Error('Sub-workflow: missing workflow name or ID');

    let extraVars = {};
    if (config.inputVars) {
      const raw = resolveVars(config.inputVars, vars);
      try {
        extraVars = typeof raw === 'object' ? raw : JSON.parse(raw);
      } catch {
        for (const pair of raw.split(',')) {
          const [k, v] = pair.split('=').map(s => s.trim());
          if (k) extraVars[k] = v ?? '';
        }
      }
    }

    const waitForCompletion = config.waitForCompletion !== false && config.waitForCompletion !== 'no' && config.waitForCompletion !== 'false';

    if (!workflowService) {
      // No workflow service available — fire-and-forget via sendFn
      if (ctx?.sendFn) ctx.sendFn('workflow-trigger-subworkflow', { workflow: workflowRef, extraVars });
      return { triggered: true, runId: null, waited: false };
    }

    const runId = await workflowService.trigger(workflowRef, 'subworkflow', { parent: true, extraVars });

    if (!waitForCompletion) {
      return { triggered: true, runId, waited: false };
    }

    // Poll for completion (max 10 minutes)
    const start   = Date.now();
    const TIMEOUT = 10 * 60 * 1000;
    const POLL    = 1000;

    while (Date.now() - start < TIMEOUT) {
      await new Promise(r => setTimeout(r, POLL));
      const run = workflowService.getRunById(runId);
      if (!run) break;
      if (run.status === 'success') {
        return { success: true, runId, outputs: run.outputs || {}, waited: true };
      }
      if (run.status === 'failed' || run.status === 'cancelled') {
        throw new Error(`Sub-workflow "${workflowRef}" ${run.status}`);
      }
    }

    throw new Error(`Sub-workflow "${workflowRef}" timed out after 10 minutes`);
  },
};
