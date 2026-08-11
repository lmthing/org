import { describe, it, expect } from 'vitest';
import { openPlanReminder } from './plan-reminders.js';

const plan = (items: Array<{ content: string; status?: string }>): string => JSON.stringify(items);

describe('openPlanReminder — keep the plan live', () => {
  it('is undefined when there is no plan', () => {
    expect(openPlanReminder(undefined)).toBeUndefined();
    expect(openPlanReminder('[]')).toBeUndefined();
    expect(openPlanReminder('garbage')).toBeUndefined();
  });

  it('is undefined when every task is completed', () => {
    expect(openPlanReminder(plan([{ content: 'a', status: 'completed' }]))).toBeUndefined();
  });

  it('surfaces open tasks with the right checkbox mark', () => {
    const out = openPlanReminder(
      plan([
        { content: 'done one', status: 'completed' },
        { content: 'doing one', status: 'in_progress' },
        { content: 'todo one', status: 'pending' },
        { content: 'broke one', status: 'failed' },
      ]),
    )!;
    expect(out).toContain('## Your plan (keep it live)');
    expect(out).not.toContain('done one'); // completed tasks are dropped
    expect(out).toContain('- [~] doing one');
    expect(out).toContain('- [ ] todo one');
    expect(out).toContain('- [✗] broke one');
  });

  it('re-surfaces a failed task so the agent must address it', () => {
    expect(openPlanReminder(plan([{ content: 'broke', status: 'failed' }]))).toContain('- [✗] broke');
  });
});
