import { tool } from 'ai';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { z } from 'zod';
import { listDirRecursive, resolveWithinDir } from '../project-store';

/**
 * The file tools SdkAgentService gives a model - the minimal set needed to
 * discover, read, and write a project's own files, each scoped to `cwd`
 * and guarded by the same traversal check the preview server and content
 * uploads already use (resolveWithinDir).
 *
 * Names are snake_case deliberately, not the camelCase this codebase
 * otherwise uses - that's the convention tool-calling training data
 * actually uses, and live testing showed a model's first (non-hallucinated)
 * guess at an unnamed tool lands on snake_case, not camelCase.
 */
export function createAgentTools(cwd: string) {
  return {
    list_files: tool({
      description:
        'List every file currently in the project directory (recursive). Call this first, before writing anything, to see what already exists from earlier work.',
      inputSchema: z.object({}),
      execute: async () => ({ files: listDirRecursive(cwd, '.') }),
    }),
    read_file: tool({
      description:
        'Read the contents of an existing file in the project, given a path relative to the project root (e.g. "index.html" or "content/site.json").',
      inputSchema: z.object({
        path: z.string().describe('Relative path from the project root'),
      }),
      execute: async ({ path }: { path: string }) => {
        const target = resolveWithinDir(cwd, path);
        if (!existsSync(target) || statSync(target).isDirectory()) {
          return { error: `No such file: ${path}` };
        }
        return { content: readFileSync(target, 'utf8') };
      },
    }),
    write_file: tool({
      description:
        'Create or overwrite a file in the project, given a path relative to the project root and its complete new content.',
      inputSchema: z.object({
        path: z.string().describe('Relative path from the project root'),
        content: z.string().describe('The complete file content'),
      }),
      execute: async ({ path, content }: { path: string; content: string }) => {
        const target = resolveWithinDir(cwd, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, 'utf8');
        return { written: path };
      },
    }),
    done: tool({
      description:
        "Call this once the site is complete and every file it needs has been written - don't stop without calling it.",
      inputSchema: z.object({
        summary: z.string().describe('A short summary of what was built'),
      }),
      execute: async ({ summary }: { summary: string }) => ({
        completed: true,
        summary,
      }),
    }),
  };
}
