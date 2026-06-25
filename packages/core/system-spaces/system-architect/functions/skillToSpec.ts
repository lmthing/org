/**
 * Deterministically convert a parsed Claude Code skill/plugin (see parseSkill) into a
 * FLAT ScaffoldSpec ready for scaffoldSpace(). Doing this in a function — rather than
 * asking a less-capable model to construct the spec by hand — is the robustness lever:
 * the model only decides WHAT to import; the exact spec shape is generated here.
 *
 * Mapping:
 *  - skill.name        → agentTitle + agentSlug (slugified)
 *  - skill.description → a brief (≤2 sentence) systemPrompt persona
 *  - skill.instructions → a knowledge option "playbook" (loaded at runtime via
 *    loadKnowledge) so the full, possibly-long body never bloats the systemPrompt
 *    literal (which would crash the TS parser).
 *  - one `run` action + tasklist whose task loads the playbook and executes it.
 *
 * A plugin with N bundled skills produces one space whose default agent's playbook is
 * the concatenation, plus a knowledge option per skill so each is individually loadable.
 */
export function skillToSpec(skill: {
  kind?: string;
  name: string;
  description: string;
  instructions: string;
  skills?: Array<{ name: string; description: string; instructions: string }>;
}): Record<string, unknown> {
  const slugify = (s: string): string =>
    (s || 'skill').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'skill';

  const agentSlug = slugify(skill.name);
  const desc = (skill.description || skill.name || 'Imported skill').trim();
  const brief = desc.length > 240 ? desc.slice(0, 237) + '…' : desc;

  // Build knowledge options: one per bundled skill (plugin) or a single "playbook".
  const units = (skill.skills && skill.skills.length > 0)
    ? skill.skills
    : [{ name: skill.name, description: skill.description, instructions: skill.instructions }];

  const options = units.map((u) => ({
    slug: slugify(u.name),
    content: `# ${u.name}\n\n${u.description}\n\n${u.instructions}`.trim(),
  }));

  return {
    agentSlug,
    agentTitle: skill.name || 'Imported Skill',
    systemPrompt:
      `You are "${skill.name}", an agent imported from a Claude Code skill. ${brief} ` +
      `When given a task, load your playbook knowledge and follow its instructions precisely, then resolve a concise result.`,
    knowledge: [
      {
        domain: 'skill',
        field: 'playbook',
        type: 'string',
        variable: 'playbook',
        default: options[0]!.slug,
        description: `Imported instructions for ${skill.name}`,
        options,
      },
    ],
    tasklists: [
      {
        name: 'run',
        tasks: [
          {
            id: 'run',
            instruction:
              `Load the playbook with \`const playbook = await loadKnowledge("skill/playbook/${options[0]!.slug}.md")\`, ` +
              `then carry out the user's request (available as the \`query\` variable) by following the playbook's instructions. ` +
              `When done, call currentTask.resolve({ result: <your concise answer or summary of what you did> }).`,
            output: { result: 'string' },
            goal: true,
          },
        ],
      },
    ],
    actions: [
      {
        id: 'run',
        label: `Run ${skill.name}`,
        description: brief,
        tasklist: 'run',
      },
    ],
  };
}
