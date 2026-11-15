export interface Config {
  commands: Record<string, string>;
  kinds: { name: string; match: string[]; commands: string[]; checks: string[]; instructions?: string[] }[];
  instructions?: Record<string, string>;
  checkFixAttempts?: number;
  reviewerModels?: Record<string, { model?: string; effort?: string }>;
  reviewers?: Record<string, { command: string[]; resume?: string[] }>;
}
export function validateConfig(input: {config: Config; root: string}): Config;
export function select(input: {config: Config; paths: string[]}): {kinds: string[]; commands: string[]; checks: string[]; instructions: string[]};
