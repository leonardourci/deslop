export function editorContract({ findingsFile }: { findingsFile: string }) {
  return `Review and edit files only. Never run checks, commit, stage, push, merge, change branches, edit git state or delegate. Deslop owns all commands, git operations and markers. Fix every finding. Add all of your findings, as plain text in any form, to the end of ${findingsFile}, keeping what it already holds; you may edit that file even though it is outside the project.`;
}
