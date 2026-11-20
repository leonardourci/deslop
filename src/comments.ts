import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import ts from 'typescript';
import { git } from './process.ts';
import { regularFile } from './scope.ts';

type CommentSyntax = {
  prefix: RegExp;
  opensBlock?: RegExp;
  closesBlock?: RegExp;
};
type CommentLine = {
  line: number;
  text: string;
};
const hashComments = { prefix: /^\s*#/ };
const dashComments = { prefix: /^\s*--/ };
const markupComments = {
  prefix: /^\s*<!--/,
  opensBlock: /^\s*<!--(?!.*-->)/,
  closesBlock: /-->/,
};
const blockComments = {
  prefix: /^\s*\/\*/,
  opensBlock: /^\s*\/\*(?!.*\*\/)/,
  closesBlock: /\*\//,
};
const slashComments = {
  ...blockComments,
  prefix: /^\s*(\/\/|\/\*)/,
};
const commentSyntax: Record<string, CommentSyntax> = {
  '.py': hashComments,
  '.rb': hashComments,
  '.sh': hashComments,
  '.bash': hashComments,
  '.zsh': hashComments,
  '.yml': hashComments,
  '.yaml': hashComments,
  '.toml': hashComments,
  '.r': hashComments,
  '.sql': dashComments,
  '.lua': dashComments,
  '.html': markupComments,
  '.xml': markupComments,
  '.css': blockComments,
  '.scss': slashComments,
};
for (const extension of ['.c', '.h', '.cpp', '.hpp', '.cs', '.java', '.go', '.rs', '.swift', '.kt', '.kts', '.dart', '.php'])
  commentSyntax[extension] = slashComments;

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
    return text.slice(range.pos, range.end).split(/\r?\n/).map((lineText, index) => ({
      line: start + index + 1,
      text: lineText.trim(),
    }));
  });
}

function prefixedComments(text: string, syntax: CommentSyntax) {
  const comments: CommentLine[] = [];
  let insideBlock = false;
  for (const [index, lineText] of text.split(/\r?\n/).entries()) {
    if (insideBlock) insideBlock = !syntax.closesBlock.test(lineText);
    else if (syntax.prefix.test(lineText)) insideBlock = syntax.opensBlock?.test(lineText) ?? false;
    else continue;
    comments.push({
      line: index + 1,
      text: lineText.trim(),
    });
  }
  return comments;
}

async function addedLineRanges({
  cwd,
  base,
  head,
  path,
}: {
  cwd: string;
  base: string;
  head: string;
  path: string;
}) {
  const diff = await git({
    cwd,
    args: ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0', '--inter-hunk-context=0', base, head, '--', `:(literal)${path}`],
  });
  return [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({
    start: Number(match[1]),
    end: Number(match[1]) + Number(match[2] ?? 1),
  }));
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
  head: string;
}) {
  const comments: string[] = [];
  for (const path of [...paths].sort()) {
    const javaScriptOrTypeScript = /\.[cm]?[jt]sx?$/i.test(path);
    const syntax = commentSyntax[extname(path).toLowerCase()];
    if (!javaScriptOrTypeScript && !syntax) continue;
    const absolute = regularFile({
      cwd,
      path,
    });
    if (!absolute) continue;
    const bytes = readFileSync(absolute);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    const found = javaScriptOrTypeScript
      ? typescriptComments(path, text)
      : prefixedComments(text, syntax);
    if (!found.length) continue;
    const added = base
      ? await addedLineRanges({
        cwd,
        base,
        head,
        path,
      })
      : undefined;
    for (const comment of found)
      if (!added || added.some(({
        start,
        end,
      }) => comment.line >= start && comment.line < end))
        comments.push(`${path}:${comment.line}: ${comment.text}`);
  }
  return comments;
}
