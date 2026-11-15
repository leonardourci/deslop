export const DEFAULT_INSTRUCTIONS = {
  code: 'Trace changed behavior through success, failure, empty inputs, concurrency and permissions. Fix concrete bugs. Prefer deletion and reuse; keep each rule in one place.',
  tests:
    'Judge whether the tests catch a breakage by reading the code and tests. Add missing behavioral coverage for fixes. Treat reported probes as context; never demand evidence the tool cannot produce.',
  writing:
    'Use plain, precise words. Remove narrating comments, filler and needless complexity. Preserve meaning and useful explanations of non-obvious constraints.',
};
export const EDITOR_CONTRACT =
  'Review and edit files only. Never run checks, commit, stage, push, merge, change branches, edit git state or delegate. Deslop owns all commands, git operations and markers. Fix what you find and return JSON with items: [{id, where, problem, fixed}].';
