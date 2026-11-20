import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import ts from 'typescript';
import { git } from './process.ts';
import { regularFile } from './scope.ts';

const commentPrefixes: Record<string, RegExp> = {
  '.py': /^\s*#/,
  '.rb': /^\s*#/,
  '.sh': /^\s*#/,
  '.bash': /^\s*#/,
  '.zsh': /^\s*#/,
  '.yml': /^\s*#/,
  '.yaml': /^\s*#/,
  '.toml': /^\s*#/,
  '.r': /^\s*#/,
  '.sql': /^\s*--/,
  '.lua': /^\s*--/,
  '.html': /^\s*<!--/,
  '.xml': /^\s*<!--/,
  '.css': /^\s*(\/\*|\*(?!\/))/,
  '.scss': /^\s*(\/\/|\/\*|\*(?!\/))/,
};
const slashComment = /^\s*(\/\/|\/\*|\*(?!\/))/;
for (const extension of ['.c', '.h', '.cpp', '.hpp', '.cs', '.java', '.go', '.rs', '.swift', '.kt', '.kts', '.dart', '.php'])
  commentPrefixes[extension] = slashComment;

function typescriptComments(path: string, text: string) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const ranges = new Map<number, ts.CommentRange>();
  function visit(node: ts.Node) {
    const children = node.getChildren(source);
    if (children.length) {
      for (const child of children) visit(child);
      return;
    }
    for (const range of [
      ...ts.getLeadingCommentRanges(text, node.pos) || [],
      ...ts.getTrailingCommentRanges(text, node.pos) || [],
    ])
      if (range.end <= node.getStart(source)) ranges.set(range.pos, range);
  }
  visit(source);
  return [...ranges.values()].sort((left, right) => left.pos - right.pos).flatMap((range) => {
    const start = source.getLineAndCharacterOfPosition(range.pos).line;
    return text.slice(range.pos, range.end).split(/\r?\n/).map((text, index) => ({
      line: start + index + 1,
      text: text.trim(),
    }));
  });
}

export async function reviewedComments({
  cwd,
  paths,
  base,
  head,
}: {
  cwd: string;
  paths: string[];
  base?: string;
  head?: string;
}) {
  const comments: string[] = [];
  for (const path of [...new Set(paths)].sort()) {
    const absolute = regularFile({
      cwd,
      path
    });
    if (!absolute) continue;
    const bytes = readFileSync(absolute);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    const extension = extname(path).toLowerCase();
    const prefix = commentPrefixes[extension];
    const lines = /\.[cm]?[jt]sx?$/i.test(path)
      ? typescriptComments(path, text)
      : text.split(/\r?\n/).flatMap((text, index) => prefix?.test(text)
        ? [{
          line: index + 1,
          text: text.trim()
        }]
        : []);
    if (!lines.length) continue;
    let added: {
      start: number;
      end: number
    }[] | undefined;
    if (base) {
      const diff = await git({
        cwd,
        args: ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0', '--inter-hunk-context=0', base, head, '--', `:(literal)${path}`],
      });
      added = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({
        start: Number(match[1]),
        end: Number(match[1]) + Number(match[2] ?? 1),
      }));
    }
    for (const comment of lines)
      if (!added || added.some(({
        start,
        end
      }) => comment.line >= start && comment.line < end))
        comments.push(`${path}:${comment.line}: ${comment.text}`);
  }
  return comments;
}
