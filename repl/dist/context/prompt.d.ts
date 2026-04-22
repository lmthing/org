import { b as SystemPromptConfig, F as FocusController } from '../focus-Du18EYz5.js';
export { d as FocusSectionName, S as SectionName, a as SystemPromptBuilder, c as buildSystemPromptFromConfig } from '../focus-Du18EYz5.js';

/**
 * Role section — "You are an agent..." introduction.
 */
declare function buildRoleSection(): string;

/**
 * Globals section — all global function documentation.
 *
 * This contains the ~400 lines of documentation for stop, display, ask,
 * tasklist, etc. Extracted from the monolithic buildSystemPrompt function.
 */

declare function buildGlobalsSection(config: SystemPromptConfig, focus: FocusController): string;

/**
 * Scope section — workspace variables, pinned memory, and agent memos.
 */

declare function buildScopeSection(scope: string, pinnedBlock?: string, memoBlock?: string, focus?: FocusController): string;

/**
 * Components section — form and view component signatures.
 */

declare function buildComponentsSection(formSignatures?: string, viewSignatures?: string, focus?: FocusController): string;

/**
 * Functions section — function signatures and class signatures.
 */

declare function buildFunctionsSection(functionSignatures?: string, classSignatures?: string, focus?: FocusController): string;

/**
 * Agents section — agent spawning, respond, knowledge writer, and agent tree.
 */

declare function buildAgentsSection(agentTree?: string, knowledgeNamespacePrompt?: string, focus?: FocusController): string;

/**
 * Knowledge section — knowledge tree with domain collapse support.
 */

declare function buildKnowledgeSection(knowledgeTree?: string, focus?: FocusController): string;

/**
 * Rules section — execution rules for the agent.
 */

declare function buildRulesSection(focus?: FocusController): string;

/**
 * Instruct section — custom instructions for agent behavior.
 */
declare function buildInstructSection(instruct?: string): string;

export { FocusController, SystemPromptConfig, buildAgentsSection, buildComponentsSection, buildFunctionsSection, buildGlobalsSection, buildInstructSection, buildKnowledgeSection, buildRoleSection, buildRulesSection, buildScopeSection };
