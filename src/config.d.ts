export interface ChangeKind {
  name: string;
  match: string[];
  steps: string[];
  checks: string[] | 'all';
  skills: string[] | 'all';
}
export interface Config {
  mode: 'local' | 'ci';
  localRunCounts?: boolean;
  decline?: 'agent' | 'owner';
  ownerLogins?: string[];
  steps: Record<string, string>;
  skills: Record<string, string>;
  kinds: ChangeKind[];
  reviewerModels?: Record<string, { model?: string; effort?: string }>;
  reviewers?: Record<string, { command: string[] }>;
}
export function select(options: { config: Config; paths: string[] }): {
  kinds: string[];
  steps: string[];
  skills: string[];
  checks: string[] | 'all';
};
export function validateConfig(options: { config: unknown; root: string }): Config;
