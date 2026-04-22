// src/context/prompt/focus.ts
var FocusController = class _FocusController {
  focusSections = null;
  constructor(focusSections) {
    if (focusSections) {
      const validSections = Array.from(focusSections).filter(
        (s) => s === "globals" || s === "scope" || s === "components" || s === "functions" || s === "classes" || s === "agents" || s === "knowledge"
      );
      this.focusSections = validSections.length > 0 ? new Set(validSections) : null;
    } else {
      this.focusSections = null;
    }
  }
  /**
   * Check if a section should be expanded.
   * If no focus is set, all sections are expanded.
   * Otherwise, only focused sections are expanded.
   */
  isExpanded(section) {
    if (this.focusSections === null) return true;
    return this.focusSections.has(section);
  }
  /**
   * Collapse a section's content into a one-line summary.
   */
  collapse(sectionName, content, label) {
    const lineCount = content.split("\n").length;
    return `[${label}] (${lineCount} lines collapsed)`;
  }
  /**
   * Update focus sections and return new instance.
   */
  update(focusSections) {
    return new _FocusController(focusSections);
  }
  /**
   * Get current focus sections.
   */
  getSections() {
    return this.focusSections;
  }
};

// src/context/prompt/sections/role.ts
function buildRoleSection() {
  return `You are an agent that writes TypeScript code to accomplish tasks.

Your code executes line-by-line in a sandbox environment. You have access to:
- Global functions for control flow (stop, display, ask, async, tasklist, etc.)
- The ability to read/write files, make HTTP requests, and more

When you complete a task or reach a stopping point, call await stop() with your results.`;
}

// src/context/prompt/sections/globals.ts
var STOP_DOCS = `### await stop(...values) \u2014 Pause and read
Suspends your execution. The runtime evaluates each argument, serializes the results, and injects them as a user message prefixed with "\u2190 stop". You resume with knowledge of those values.

Use stop when you need to inspect a runtime value before deciding what to write next.
Example: await stop(x, y) \u2192 you will see: \u2190 stop { x: <value>, y: <value> }

Retention hints: Include a _retain key to control how fast the stop payload decays.
await stop(schema, _retain = "high")  // keeps values at full fidelity 2x longer
await stop(debugLog, _retain = "low") // decays values 2x faster than normal

IMPORTANT: After calling await stop(), STOP writing code. The runtime will pause your stream, read the values, and resume you in a new turn. Do NOT predict or simulate the stop response yourself.`;
var DISPLAY_DOCS = `### display(element) \u2014 Show output to user
Non-blocking. Appends a rendered component to the user's view. Use with display components only.
Example: display(<RecipeCard name="Pasta" cuisine="Italian" ... />)`;
var ASK_DOCS = `### var data = await ask(element) \u2014 Collect user input
Blocking. Renders a form to the user and waits for submission. The host wraps your element in a \`<form>\` with Submit/Cancel buttons \u2014 do NOT add your own \`<form>\` tag.
Each input component must have a \`name\` attribute. The returned object maps name \u2192 submitted value.

ask() resumes silently \u2014 no message is injected into the conversation. You MUST call stop() after ask() to read the submitted values.

Pattern:
var input = await ask(<RequestForm />)
await stop(input)
// \u2190 stop { input: { request: "...", dietary: "..." } }

Multiple inputs:
var prefs = await ask(<div>
  <Select name="cuisine" label="Pick cuisine" options={["italian", "japanese"]} />
  <TextInput name="notes" label="Any notes?" />
</div>)
await stop(prefs)
// \u2190 stop { prefs: { cuisine: "italian", notes: "extra spicy" } }

IMPORTANT:
- Do NOT wrap ask() content in \`<form>\`. The host provides the form wrapper and submit button.
- Always call await stop() right after ask() to see the values. Do NOT use the values before calling stop().
- After stop(), you resume in a new turn with the form data visible.`;
var TASKLIST_DOCS = `### tasklist(tasklistId, description, tasks) \u2014 Declare a task plan with milestones
Before starting any implementation work, declare a plan using tasklist(). This registers milestones with the host under a unique tasklistId. Each task has an id, instructions, and outputSchema describing the result shape. Tasks can optionally declare dependsOn (array of task IDs) for DAG dependencies, condition (JS expression for conditional execution), and optional (boolean, if true failure doesn't block dependents).

When no task has dependsOn, the tasklist behaves sequentially (backward compatible).

You can call tasklist() multiple times per session with different tasklist IDs. It does not block execution.

Example:
tasklist("analyze_data", "Analyze employee data", [
  { id: "load", instructions: "Load the dataset", outputSchema: { count: { type: "number" } } },
  { id: "analyze", instructions: "Compute statistics", outputSchema: { done: { type: "boolean" } }, dependsOn: ["load"] },
  { id: "report", instructions: "Present results", outputSchema: { done: { type: "boolean" } }, dependsOn: ["analyze"] }
])

### completeTask(tasklistId, taskId, output) \u2014 Mark a milestone as complete
When you reach a milestone, call completeTask() with the tasklist ID, task ID, and an output object matching the declared outputSchema. Non-blocking. Task must be in the readyTasks set (all dependencies satisfied).

Example:
completeTask("analyze_data", "load", { count: 10 })`;
var SLEEP_DOCS = `### await sleep(seconds) \u2014 Pause execution
Pauses sandbox execution (not the LLM stream). Async tasks continue during sleep. Use to wait for completeTaskAsync results, then call stop() to read them.

Example:
await sleep(5)
await stop()`;
var PIN_DOCS = `### pin(key, value) \u2014 Pin a value to persistent memory
Saves a value that survives stop-payload decay indefinitely. Pinned values appear in a {{PINNED}} block in the system prompt, visible every turn. Max 10 pins. Use for critical schema info, API keys, or configuration that must persist.

Example:
pin("userSchema", { id: "uuid", name: "string", email: "string" })`;
var MEMO_DOCS = `### memo(key, value?) \u2014 Compressed semantic memory
Write a compressed note (max 500 chars) that persists in the {{MEMO}} block across all turns. Unlike pin() which stores raw values, memo() stores your own distilled summaries. Use it to remember decisions, patterns discovered, or strategy.

Write: memo("data-shape", "Users table: 12 cols. Key: id (uuid), email (unique). FK: org_id \u2192 orgs.")
Read: var note = memo("data-shape") \u2192 returns the string or undefined
Delete: memo("data-shape", null)

Max 20 memos. Memos never decay \u2014 delete them when no longer needed.`;
var FOCUS_DOCS = `### focus(...sections) \u2014 Control prompt section expansion
Collapses unused system prompt sections to save tokens. Sections: 'functions', 'knowledge', 'components', 'classes', 'agents'. Collapsed sections show a one-line summary. Call focus('all') to restore full expansion.

Example:
focus("functions", "knowledge")  // expand only these, collapse others
// ... later, when done with knowledge:
focus("functions")               // collapse knowledge too
focus("all")                     // restore everything`;
var FORK_DOCS = `### await fork({ task, context?, outputSchema?, maxTurns? }) \u2014 Lightweight sub-agent
Runs a focused sub-reasoning task in an isolated context. The child's full reasoning stays separate \u2014 only the final JSON output enters your context. Use for complex analysis that would pollute your main conversation. Default 3 turns.

Example:
var analysis = await fork({
  task: "Analyze this error trace and identify the root cause",
  context: { errorTrace: traceStr, codeSnippet: snippet },
  outputSchema: { rootCause: { type: "string" }, fix: { type: "string" }, confidence: { type: "number" } },
  maxTurns: 2,
})
await stop(analysis)`;
var COMPRESS_DOCS = `### await compress(data, options?) \u2014 LLM-powered data compression
Compresses large data into a token-efficient summary before it enters your context. Use proactively on large API responses or file contents. Options: preserveKeys (keep exact), maxTokens (target ~200), format ("structured"|"prose").

Example:
var summary = await compress(largeApiResponse, { preserveKeys: ["id", "status"], maxTokens: 150 })
await stop(summary)`;
var SPECULATE_DOCS = `### await speculate(branches, options?) \u2014 Parallel hypothesis testing
Run multiple approaches concurrently and compare results. Each branch runs its function in parallel. Failed branches are captured, not thrown. Max 5 branches, default 10s timeout.

Example:
var trial = await speculate([
  { label: "regex", fn: () => data.match(/pattern/g)?.length ?? 0 },
  { label: "split", fn: () => data.split("delimiter").length - 1 },
])
await stop(trial)`;
var REFLECT_DOCS = `### await reflect({ question, context?, criteria? }) \u2014 Self-evaluation
Triggers a separate LLM call to evaluate your current approach. Returns { assessment, scores, suggestions, shouldPivot }. Use when uncertain about correctness, efficiency, or when stuck.`;
var WATCH_DOCS = `### watch(variableName, callback) \u2014 Reactive variable observation
Registers a callback that fires when a sandbox variable's value changes between stop() calls. Returns an unwatch function.`;
var PIPELINE_DOCS = `### await pipeline(data, ...transforms) \u2014 Chained data transformations
Passes data through a sequence of named transforms. Each receives the output of the previous one. Supports async transforms. Stops on first error.`;
var CACHE_FETCH_DOCS = `### await cachedFetch(url, options?) \u2014 HTTP fetch with caching and retry
Fetches a URL with built-in TTL caching, exponential backoff retry, auto JSON/text parsing, and timeout.`;
var SCHEMA_DOCS = `### schema(value) \u2014 Infer JSON schema from a runtime value
Analyzes a runtime value and returns its JSON schema (type, properties, items, required).`;
var VALIDATE_DOCS = `### validate(value, schema) \u2014 Validate against a schema
Checks a value against a JSON-like schema. Returns { valid: true } or { valid: false, errors: ["..."] }.`;
var BROADCAST_DOCS = `### broadcast(channel, message) \u2014 Send data to listeners
Sends a message to all agents listening on a channel (including yourself). Use for event-driven coordination between parallel tasks.

Example:
broadcast("user_count_changed", { from: oldVal, to: newVal })
// Any agent with listen() on this channel receives the message

### listen(channel, callback) \u2014 Subscribe to broadcasts
Registers a callback that fires when any agent broadcasts on the channel. Returns an unsubscribe function.

Example:
var unsub = listen("user_count_changed", (msg) => {
  console.log("User count changed:", msg)
})`;
var DELEGATE_DOCS = `### await delegate(agent, input) \u2014 Delegate to specialist agent
Runs a specialist agent with a focused task. The agent's full reasoning happens separately \u2014 only the final JSON output enters your context. Use for modular problem-solving.`;
var PARALLEL_DOCS = `### await parallel(...tasks) \u2014 Wait for multiple async tasks
Runs multiple async functions concurrently and returns their results. Use with completeTaskAsync or other async work. Returns { label, ok, result/error, durationMs } for each task.`;
var TRACE_DOCS = `### trace() \u2014 Execution profiling snapshot
Returns timing data: turns, LLM calls, token usage, cost estimates, async task status, scope size. Use to optimize performance-critical sections.`;
var PLAN_DOCS = `### await plan(goal, constraints?) \u2014 Generate task plan via LLM
Generates a structured task plan from a natural language goal. Returns array of tasks with id, instructions, and optional dependsOn for DAG.`;
var CRITIQUE_DOCS = `### await critique(output, criteria, context?) \u2014 Quality evaluation
Evaluates output quality against criteria using a separate LLM call. Returns { passed, scores, suggestions }.`;
var LEARN_DOCS = `### await learn(topic, insight, tags?) \u2014 Persist to long-term memory
Saves a learning to the knowledge base for cross-session memory. The insight is compressed and stored as a knowledge option in the memory domain.

Example:
await learn("csv-gotchas", "CSV parsing with split(',') fails on quoted commas. Use regex or a proper parser.", ["csv", "parsing"])`;
var CHECKPOINT_DOCS = `### checkpoint() \u2014 Save current sandbox state
Snapshots all sandbox variables so you can explore risky operations and roll back if needed. Returns a checkpoint ID that you can pass to rollback().

Example:
var snapshot = checkpoint()
try {
  riskyOperation(data)
} catch {
  rollback(snapshot)
  stop("Failed, reverted to checkpoint")
}`;
var ROLLBACK_DOCS = `### rollback(snapshot) \u2014 Restore sandbox state
Restores all variables to a previously saved checkpoint. Use to recover from errors or failed experiments.`;
var VECTORSEARCH_DOCS = `### await vectorSearch(query, topK?) \u2014 Semantic search past reasoning
Searches your comment blocks and code from previous turns for semantically similar content. Uses TF-IDF cosine similarity to find related reasoning patterns.

Example:
var patterns = await vectorSearch("how to aggregate by region")
await stop(patterns)`;
function buildGlobalsSection(config, focus) {
  if (focus.isExpanded("globals")) {
    let content = "<globals>\n<system>";
    content += "\n" + STOP_DOCS;
    content += "\n" + DISPLAY_DOCS;
    content += "\n" + ASK_DOCS;
    content += "\n" + TASKLIST_DOCS;
    content += "\n" + SLEEP_DOCS;
    content += "\n" + PIN_DOCS;
    content += "\n" + MEMO_DOCS;
    content += "\n" + FOCUS_DOCS;
    content += "\n" + FORK_DOCS;
    content += "\n" + COMPRESS_DOCS;
    content += "\n" + SPECULATE_DOCS;
    content += "\n" + REFLECT_DOCS;
    content += "\n" + WATCH_DOCS;
    content += "\n" + PIPELINE_DOCS;
    content += "\n" + CACHE_FETCH_DOCS;
    content += "\n" + SCHEMA_DOCS;
    content += "\n" + VALIDATE_DOCS;
    content += "\n" + BROADCAST_DOCS;
    content += "\n" + DELEGATE_DOCS;
    content += "\n" + PARALLEL_DOCS;
    content += "\n" + TRACE_DOCS;
    content += "\n" + PLAN_DOCS;
    content += "\n" + CRITIQUE_DOCS;
    content += "\n" + LEARN_DOCS;
    content += "\n" + CHECKPOINT_DOCS;
    content += "\n" + ROLLBACK_DOCS;
    content += "\n" + VECTORSEARCH_DOCS;
    if (config.classSignatures) {
      content += "\n" + config.classSignatures;
    }
    content += "\n</system>";
    content += "\n</globals>";
    return content;
  }
  return focus.collapse("globals", "", "Global functions documentation");
}

// src/context/prompt/sections/scope.ts
var FILE_BLOCK_DOCS = `### File Blocks \u2014 Write or patch files
Write files or apply diff patches using four-backtick blocks. These are NOT function calls \u2014 they are special syntax processed directly by the host before the next statement runs.

**Create / overwrite a file:**
\`\`\`\`path/to/output.ts
// full file content goes here
export function greet(name: string) { return \`Hello, \${name}!\` }
\`\`\`\`

**Patch an existing file** (requires a prior \`readFile('path')\` call this session):
\`\`\`\`diff path/to/output.ts
--- a/path/to/output.ts
+++ b/path/to/output.ts
@@ -1,3 +1,3 @@
 // full file content goes here
-export function greet(name: string) { return \`Hello, \${name}!\` }
+export function greet(name: string) { return \`Hello \${name}!\` }
\`\`\`\`

Rules:
- The closing line must be exactly four backticks on its own line.
- Diff patches require a prior \`await readFile('path')\` call on the same path this session.
- If a patch fails (context mismatch or unread file), you will receive a \`\u2190 error [FileError]\` \u2014 adjust and retry.
- Prefer diff patches for targeted edits to large files; use write blocks for new files or full rewrites.
- After a file block, continue writing TypeScript as normal \u2014 no \`await\` needed.`;
function buildScopeSection(scope, pinnedBlock, memoBlock, focus) {
  const isExpanded = focus ? focus.isExpanded("scope") : true;
  let content = "<scope>\n";
  content += "Workspace \u2014 Current Scope\n";
  content += scope || "(no variables declared)";
  if (pinnedBlock) {
    content += "\n\nPinned Memory (survives decay \u2014 use unpin() to free)\n";
    content += pinnedBlock;
  }
  if (memoBlock) {
    content += "\n\nAgent Memos (your compressed notes \u2014 use memo(key, null) to delete)\n";
    content += memoBlock;
  }
  content += "\n\n" + FILE_BLOCK_DOCS;
  content += "\n</scope>";
  return content;
}

// src/context/prompt/sections/components.ts
var FORM_COMPONENTS_HEADER = `Form Components \u2014 use ONLY inside ask()
Render these inside \`var data = await ask(<Component />)\`. Always follow with \`await stop(data)\` to read the values.
Each input must have a \`name\` attribute \u2014 the returned object maps name \u2192 submitted value.
Prefer to use MultiSelect, Select for better user experience.
Do NOT add a \`<form>\` tag \u2014 the host wraps automatically with Submit/Cancel buttons.`;
var DISPLAY_COMPONENTS_HEADER = `Display Components \u2014 use with display()
These components show output to the user. Use them with \`display(<Component ... />)\`. Non-blocking.`;
function buildComponentsSection(formSignatures, viewSignatures, focus) {
  const isExpanded = focus ? focus.isExpanded("components") : true;
  let content = "<components>\n";
  content += FORM_COMPONENTS_HEADER + "\n";
  if (formSignatures && formSignatures !== "(none)") {
    if (isExpanded) {
      content += formSignatures;
    } else {
      const lineCount = formSignatures.split("\n").length;
      content += `(${lineCount} form components available \u2014 use focus("components") to expand)`;
    }
  } else {
    content += "(none)";
  }
  content += "\n\n";
  content += DISPLAY_COMPONENTS_HEADER + "\n";
  if (viewSignatures && viewSignatures !== "(none)") {
    if (isExpanded) {
      content += viewSignatures;
    } else {
      const lineCount = viewSignatures.split("\n").length;
      content += `(${lineCount} display components available \u2014 use focus("components") to expand)`;
    }
  } else {
    content += "(none)";
  }
  content += "\n</components>";
  return content;
}

// src/context/prompt/sections/functions.ts
var AVAILABLE_CLASSES_HEADER = "Available Classes";
function buildFunctionsSection(functionSignatures, classSignatures, focus) {
  const isExpanded = focus ? focus.isExpanded("functions") : true;
  const classesExpanded = focus ? focus.isExpanded("classes") : true;
  let content = "<functions>\n";
  if (functionSignatures && functionSignatures !== "(none)") {
    if (isExpanded) {
      content += functionSignatures;
    } else {
      const lineCount = functionSignatures.split("\n").length;
      content += `(${lineCount} functions available \u2014 use focus("functions") to expand)`;
    }
  } else {
    content += "(none)";
  }
  content += "\n\n";
  content += AVAILABLE_CLASSES_HEADER + "\n";
  if (classSignatures && classSignatures !== "(none)") {
    if (classesExpanded) {
      content += classSignatures;
    } else {
      const lineCount = classSignatures.split("\n").length;
      content += `(${lineCount} classes available \u2014 use focus("classes") to expand)`;
    }
  } else {
    content += "(none)";
  }
  content += "\n</functions>";
  return content;
}

// src/context/prompt/sections/agents.ts
var AGENT_SPAWN_DOCS = `Spawn child agents from loaded spaces. Each call returns a Promise.
Use \`var result = space.agent(params).action(request)\` to track, or omit \`var\` for fire-and-forget.
Chain \`.options({ context: "branch" })\` to give the child your conversation history (default: "empty").

Tracked agents (saved to a variable) can call \`askParent(message, schema)\` to pause and ask you for input.
Their question appears as "? waiting" in {{AGENTS}} with the message and expected schema.
Answer with: \`respond(agentVariable, { key: value, ... })\`
Fire-and-forget agents (no variable) cannot ask questions.`;
var RESPOND_DOCS = `### respond(agentPromise, data) \u2014 Answer a child agent's question
When a tracked spawned agent calls askParent(), it pauses and surfaces a question in {{AGENTS}}.
Call respond() with the agent's variable and a data object matching the question's schema.

Example:
respond(steakInstructions, {
  doneness: "medium-rare",
  thickness_cm: 3,
})

The child resumes execution with the data as the return value of its askParent() call.`;
var KNOWLEDGE_WRITER_DOCS = `### knowledge.writer({ field }) \u2014 Persist knowledge and memories
The \`knowledge\` namespace is always available. Use it to save, update, or delete knowledge entries on disk. Writes are fire-and-forget \u2014 they complete in the background and the updated entries appear in the Knowledge Tree on subsequent turns.

The \`field\` parameter uses "domain/field" notation (e.g., \`"memory/project"\`, \`"cuisine/type"\`). If only one segment is given, it defaults to the \`memory\` domain.

Examples:
\`\`\`ts
// Save a project memory (fire-and-forget, no variable needed)
knowledge.writer({ field: "memory/project" }).save("auth-flow", "Authentication uses SSO codes with 60s TTL.")

// Save feedback
knowledge.writer({ field: "memory/feedback" }).save("testing-approach", "Use integration tests, not mocks.")

// Delete a memory
knowledge.writer({ field: "memory/feedback" }).remove("old-approach")

// Add multiple options from data
knowledge.writer({ field: "cuisine/type" }).addOptions("Store these recipes", recipeData, moreData)

// Load a saved memory (existing loadKnowledge global)
var mem = loadKnowledge({ "knowledge": { memory: { project: { "auth-flow": true } } } })
await stop(mem)
\`\`\``;
function buildAgentsSection(agentTree, knowledgeNamespacePrompt, focus) {
  const isExpanded = focus ? focus.isExpanded("agents") : true;
  if (!agentTree && !knowledgeNamespacePrompt) {
    return "";
  }
  let content = "<agents>\n";
  content += AGENT_SPAWN_DOCS + "\n\n";
  content += RESPOND_DOCS + "\n\n";
  content += KNOWLEDGE_WRITER_DOCS + "\n\n";
  content += "```\n";
  if (isExpanded) {
    const treeParts = [knowledgeNamespacePrompt, agentTree].filter(Boolean);
    if (treeParts.length > 0) {
      content += treeParts.join("\n");
    } else {
      content += "(no agents loaded)";
    }
  } else {
    content += '(agent tree collapsed \u2014 use focus("agents") to expand)';
  }
  content += "\n```\n";
  content += "</agents>";
  return content;
}

// src/context/prompt/sections/knowledge.ts
function buildKnowledgeSection(knowledgeTree, focus) {
  if (!knowledgeTree) {
    return "";
  }
  const isExpanded = focus ? focus.isExpanded("knowledge") : true;
  let content = "<available_knowledge>\n";
  if (isExpanded) {
    content += knowledgeTree;
  } else {
    const domainCount = (knowledgeTree.match(/^  /gm) ?? []).length;
    content += `(${domainCount} knowledge domains available \u2014 use focus("knowledge") to expand)`;
  }
  content += "\n</available_knowledge>";
  return content;
}

// src/context/prompt/sections/instruct.ts
function buildInstructSection(instruct) {
  if (!instruct) {
    return "";
  }
  return "<instructions>\n" + instruct + "\n</instructions>";
}

// src/context/prompt/builder.ts
var SystemPromptBuilder = class {
  config;
  focus;
  cachedPrompt = null;
  constructor(config) {
    this.config = config;
    this.focus = new FocusController(config.focusSections ?? null);
  }
  /**
   * Build the complete system prompt.
   */
  build() {
    const sections = [
      buildRoleSection(),
      "<documentation>",
      buildGlobalsSection(this.config, this.focus),
      buildScopeSection(this.config.scope, this.config.pinnedBlock, this.config.memoBlock, this.focus),
      buildComponentsSection(this.config.formSignatures, this.config.viewSignatures, this.focus),
      buildFunctionsSection(this.config.functionSignatures, this.config.classSignatures, this.focus),
      buildAgentsSection(this.config.agentTree, this.config.knowledgeNamespacePrompt, this.focus),
      buildKnowledgeSection(this.config.knowledgeTree, this.focus),
      "</documentation>",
      buildInstructSection(this.config.instruct)
    ];
    this.cachedPrompt = sections.filter(Boolean).join("\n\n");
    return this.cachedPrompt;
  }
  /**
   * Update scope-related sections and return updated prompt.
   */
  updateScope(scope, pinned, memo) {
    this.config.scope = scope;
    this.config.pinnedBlock = pinned;
    this.config.memoBlock = memo;
    this.cachedPrompt = null;
    return this.build();
  }
  /**
   * Update agents section and return updated prompt.
   */
  updateAgents(agentTree) {
    this.config.agentTree = agentTree;
    this.cachedPrompt = null;
    return this.build();
  }
  /**
   * Update knowledge section and return updated prompt.
   */
  updateKnowledge(knowledgeTree) {
    this.config.knowledgeTree = knowledgeTree;
    this.cachedPrompt = null;
    return this.build();
  }
  /**
   * Set focus sections and return updated prompt.
   */
  setFocus(focusSections) {
    this.config.focusSections = focusSections;
    this.focus = new FocusController(focusSections);
    this.cachedPrompt = null;
    return this.build();
  }
};
function buildSystemPromptFromConfig(config) {
  const builder = new SystemPromptBuilder(config);
  return builder.build();
}

// src/context/prompt/sections/rules.ts
var RULES = `<rule>Output ONLY valid TypeScript. No markdown. No prose outside // comments.</rule>
<rule>Plan before you build \u2014 call tasklist(tasklistId, description, tasks) to declare milestones with optional dependsOn for DAG dependencies, then call completeTask(tasklistId, taskId, output) or completeTaskAsync(tasklistId, taskId, fn) as you complete each one.</rule>
<rule>Await every async call: var x = await fn()</rule>
<rule>Use stop() to read runtime values before branching.</rule>
<rule>Do not use console.log \u2014 use stop() to inspect values.</rule>
<rule>Do not import modules. Do not use export.</rule>
<rule>Use var for all declarations (not const/let) so they persist in the REPL scope across turns.</rule>
<rule>Handle nullability with ?. and ??</rule>
<rule>After calling await stop(...), STOP. Do not write any more code until you receive the stop response.</rule>
<rule>Use loadKnowledge() to load relevant knowledge files before starting domain-specific work. Check the Knowledge Tree to see what is available. NEVER load all files from a domain or space \u2014 only select the specific options that are relevant to the user's request. Loading too much wastes context and degrades your performance.</rule>
<rule>To write a file, use a four-backtick write block (not writeFile()). To patch a file, read it first with readFile() then use a four-backtick diff block. If the host reports a FileError, adjust your diff context and retry.</rule>`;
function buildRulesSection(focus) {
  const isExpanded = focus ? focus.isExpanded("rules") : true;
  if (isExpanded) {
    return "<rules>\n" + RULES + "\n</rules>";
  }
  const ruleCount = RULES.match(/<rule>/g)?.length ?? 11;
  return "<rules>\n(" + ruleCount + " rules \u2014 see documentation)\n</rules>";
}

export {
  FocusController,
  buildRoleSection,
  buildGlobalsSection,
  buildScopeSection,
  buildComponentsSection,
  buildFunctionsSection,
  buildAgentsSection,
  buildKnowledgeSection,
  buildInstructSection,
  SystemPromptBuilder,
  buildSystemPromptFromConfig,
  buildRulesSection
};
