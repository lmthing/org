/**
 * SystemPromptConfig — named object for system prompt assembly.
 *
 * Replaces 12 positional parameters with a single configuration object,
 * making prompt assembly more maintainable and less error-prone.
 */
interface SystemPromptConfig {
    /** Function signatures from catalog and user code */
    functionSignatures?: string;
    /** Form component signatures */
    formSignatures?: string;
    /** View component signatures */
    viewSignatures?: string;
    /** Class signatures with methods */
    classSignatures?: string;
    /** Current scope table ({{SCOPE}} block) */
    scope: string;
    /** Additional instructions to append to system prompt */
    instruct?: string;
    /** Knowledge tree formatted for prompt */
    knowledgeTree?: string;
    /** Agent tree formatted for prompt */
    agentTree?: string;
    /** Knowledge namespace formatted for prompt */
    knowledgeNamespacePrompt?: string;
    /** Pinned memory block ({{PINNED}}) */
    pinnedBlock?: string;
    /** Memo memory block ({{MEMO}}) */
    memoBlock?: string;
    /** Focus sections to keep expanded (null = all expanded) */
    focusSections?: Set<string> | null;
}
/**
 * Section names for targeted rebuilding.
 */
type SectionName$1 = 'role' | 'globals' | 'scope' | 'components' | 'functions' | 'agents' | 'knowledge' | 'rules' | 'instruct';

/**
 * SystemPromptBuilder — composable, section-cached prompt assembly.
 *
 * Replaces the monolithic 575-line buildSystemPrompt() with a modular,
 * section-based approach that enables targeted updates without rebuilding
 * the entire prompt.
 */

declare class SystemPromptBuilder {
    private config;
    private focus;
    private cachedPrompt;
    constructor(config: SystemPromptConfig);
    /**
     * Build the complete system prompt.
     */
    build(): string;
    /**
     * Update scope-related sections and return updated prompt.
     */
    updateScope(scope: string, pinned?: string, memo?: string): string;
    /**
     * Update agents section and return updated prompt.
     */
    updateAgents(agentTree: string): string;
    /**
     * Update knowledge section and return updated prompt.
     */
    updateKnowledge(knowledgeTree: string): string;
    /**
     * Set focus sections and return updated prompt.
     */
    setFocus(focusSections: Set<string> | null): string;
}
/**
 * Build a system prompt from the given configuration.
 *
 * This is the main entry point that replaces the old buildSystemPrompt function.
 */
declare function buildSystemPromptFromConfig(config: SystemPromptConfig): string;

/**
 * FocusController — manages section collapse/expand state.
 *
 * When focus is active, only specified sections are expanded;
 * others are collapsed to a one-line summary.
 */
type SectionName = 'globals' | 'scope' | 'components' | 'functions' | 'classes' | 'agents' | 'knowledge' | 'rules';
declare class FocusController {
    private focusSections;
    constructor(focusSections?: Set<SectionName> | Set<string> | null);
    /**
     * Check if a section should be expanded.
     * If no focus is set, all sections are expanded.
     * Otherwise, only focused sections are expanded.
     */
    isExpanded(section: SectionName): boolean;
    /**
     * Collapse a section's content into a one-line summary.
     */
    collapse(sectionName: SectionName, content: string, label: string): string;
    /**
     * Update focus sections and return new instance.
     */
    update(focusSections: Set<SectionName> | null): FocusController;
    /**
     * Get current focus sections.
     */
    getSections(): Set<SectionName> | null;
}

export { FocusController as F, type SectionName$1 as S, SystemPromptBuilder as a, type SystemPromptConfig as b, buildSystemPromptFromConfig as c, type SectionName as d };
