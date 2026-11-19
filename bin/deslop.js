#!/usr/bin/env node
import { createJiti } from 'jiti';

await createJiti(import.meta.url).import('../src/cli.ts');
