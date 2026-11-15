import { createInterface } from 'node:readline/promises';
import { DeslopError } from './process.js';

export async function requiredValue({
  value,
  flag,
  question,
  input = process.stdin,
  output = process.stdout,
}) {
  if (value) return value;
  if (!input.isTTY)
    throw new DeslopError(
      'USAGE',
      `Missing ${flag}; pass it on the command line`,
    );
  const terminal = createInterface({
    input,
    output,
  });
  try {
    const answer = (await terminal.question(`${question}: `)).trim();
    if (!answer) throw new DeslopError('USAGE', `Missing ${flag}`);
    return answer;
  } finally {
    terminal.close();
  }
}
