export type ModelChoice = {
  model?: string;
  effort?: string;
};
export type Provider = {
  command: string[];
  resume?: string[];
};
export type Kind = {
  name: string;
  match: string[];
  commands: string[];
  checks: string[];
  instructions?: string[];
  ciRequired?: boolean;
};
export type Config = {
  commands: Record<string, string>;
  kinds: Kind[];
  instructions?: Record<string, string | false>;
  checkFixAttempts?: number;
  reviewerModels?: Record<string, ModelChoice>;
  agentTimeoutMinutes?: number;
  reviewers?: Record<string, Provider>;
  publishLocal?: boolean;
  fallbackLint?: boolean;
};
export type Settings = {
  reviewer?: string | string[];
  reviewerModels?: Record<string, ModelChoice>;
  agentTimeoutMinutes?: number;
};
export type Selection = {
  kinds: string[];
  commands: string[];
  checks: string[];
  requiredChecks: string[];
  instructions: string[];
};
export type Places = {
  root: string;
  common: string;
  home: string;
  repoHome: string;
  lock: string;
};
export type Session = {
  provider: string;
  id?: string;
  choice?: ModelChoice;
  commits?: string[];
  context?: {
    findings: string;
    paths: string[];
  };
};
export type Scope = {
  instructionFiles: string[];
  protectedInstructions: string[];
  excluded: string[];
  normalDirectories: string[];
  configured: string[];
};
export type RunOptions = {
  paths?: string[];
  base?: string;
  intent?: string;
  local?: boolean;
  reviewer?: string;
  reviewerModel?: string;
  reviewerEffort?: string;
  agentTimeoutMinutes?: number;
};
export type Failure = {
  test: string;
  message: string;
  excerpt: string;
};
export type Check = {
  name: string;
  ok: boolean;
  log: string;
  failures: Failure[];
  fixable?: boolean;
};
export type RunData = {
  id: string;
  date: string;
  repo: string;
  branch: string;
  pr?: number;
  mode: 'run' | 'clean';
  paths?: string[];
  intent: {
    source: 'file' | 'pr' | 'none';
    path?: string;
    pr?: number;
  };
  verdict: string;
  initialHead: string;
  head: string;
  checks: Check[];
  commits: string[];
  newFiles: string[];
  findings: string;
  workflowEdits?: string[];
  unstableCommands?: string[];
  remoteWarning?: string;
  published?: boolean;
  publicationError?: string;
  statusReason?: string;
  error?: {
    code: string;
    message: string;
  };
  unpushed?: boolean;
  left?: string[];
};
