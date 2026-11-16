/**
 * @typedef {{model?: string, effort?: string}} ModelChoice
 * @typedef {{command: string[], resume?: string[]}} Provider
 * @typedef {{name: string, match: string[], commands: string[], checks: string[], instructions?: string[], ciRequired?: boolean}} Kind
 * @typedef {{commands: Record<string,string>, kinds: Kind[], instructions?: Record<string,string|false>, checkFixAttempts?: number, reviewerModels?: Record<string,ModelChoice>, reviewers?: Record<string,Provider>, publishLocal?: boolean, fallbackLint?: boolean}} Config
 * @typedef {{reviewer?: string|string[], reviewerModels?: Record<string,ModelChoice>}} Settings
 * @typedef {{kinds: string[], commands: string[], checks: string[], requiredChecks: string[], instructions: string[]}} Selection
 * @typedef {{root: string, common: string, home: string, lock: string}} Places
 * @typedef {{id: string, where: string, problem: string, fixed: boolean}} ReviewItem
 * @typedef {{provider: string, id?: string, choice?: ModelChoice, commits?: string[], context?: {review: ReviewItem[], paths: string[]}}} Session
 * @typedef {{instructionFiles: string[], protectedInstructions: string[], excluded: string[], normalDirectories: string[], configured: string[]}} Scope
 * @typedef {{base?: string, local?: boolean, reviewer?: string, reviewerModel?: string, reviewerEffort?: string}} RunOptions
 * @typedef {{test: string, message: string, excerpt: string}} Failure
 * @typedef {{name: string, ok: boolean, log: string, failures: Failure[], fixable?: boolean}} Check
 * @typedef {{id: string, verdict: string, initialHead: string, head: string, checks: Check[], review: {found: number, fixed: number, items: ReviewItem[]}, commits: string[], checkFixes: {turn: number, items: ReviewItem[]}[], newFiles: string[], workflowEdits?: string[], unstableCommands?: string[], remoteWarning?: string, published?: boolean, publicationError?: string, statusReason?: string, error?: {code: string, message: string}, unpushed?: boolean, left?: string[]}} RunData
 */
export {};
