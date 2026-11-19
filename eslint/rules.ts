import type { Rule } from 'eslint';

export const entriesOnLines: Rule.RuleModule = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: {
      entries:
        'Put each entry of a multi-entry object or type on its own line.',
    },
  },
  create(context) {
    return {
      'ObjectExpression, ObjectPattern, TSTypeLiteral, TSInterfaceBody'(node) {
        const entries = node.properties || node.members || node.body;
        if (entries.length < 2) return;
        const source = context.sourceCode;
        const open = source.getFirstToken(node);
        const close = node.typeAnnotation
          ? source.getTokenBefore(node.typeAnnotation)
          : source.getLastToken(node);
        const previous = [open, ...entries.slice(0, -1)];
        const sameLine = entries.filter(
          (entry, index) =>
            entry.loc.start.line === previous[index].loc.end.line,
        );
        const closeInline =
          entries.at(-1).loc.end.line === close.loc.start.line;
        if (!sameLine.length && !closeInline) return;
        const base = source.lines[open.loc.start.line - 1].match(/^\s*/)[0];
        context.report({
          node,
          messageId: 'entries',
          fix(fixer) {
            const edits = sameLine.map((entry) =>
              fixer.replaceTextRange(
                [
                  source.getTokenBefore(entry, { includeComments: true })
                    .range[1],
                  entry.range[0],
                ],
                `\n${base}  `,
              ),
            );
            if (closeInline)
              edits.push(
                fixer.replaceTextRange(
                  [
                    source.getTokenBefore(close, { includeComments: true })
                      .range[1],
                    close.range[0],
                  ],
                  `\n${base}`,
                ),
              );
            return edits;
          },
        });
      },
    };
  },
};

export const noEmDash: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: { punctuation: 'Replace the em dash with plain punctuation.' },
  },
  create(context) {
    function check(node, text) {
      if (/\u2014/u.test(text))
        context.report({
          node,
          messageId: 'punctuation',
        });
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked || node.value.raw);
      },
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (/\u2014/u.test(comment.value))
            context.report({
              loc: comment.loc,
              messageId: 'punctuation',
            });
        }
      },
    };
  },
};
