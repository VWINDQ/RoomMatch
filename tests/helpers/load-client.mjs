import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';

// Run the actual TS/TSX client modules in node:test with Vite's transformer.
const sourceRoot = new URL('../../src/', import.meta.url).href;
const sourceFiles = readdirSync(new URL(sourceRoot), { recursive: true })
  .filter(filename => /\.tsx?$/.test(filename) && !filename.endsWith('.d.ts'));
const compiledModules = new Map(await Promise.all(sourceFiles.map(async relativePath => {
  const filename = resolve(fileURLToPath(sourceRoot), relativePath);
  const { code } = await transformWithOxc(readFileSync(filename, 'utf8'), filename, {
    jsx: { runtime: 'automatic' },
  });
  return [pathToFileURL(filename).href, code];
})));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && !extname(specifier)) {
      for (const extension of ['.ts', '.tsx']) {
        const candidate = new URL(specifier + extension, context.parentURL);
        if (existsSync(candidate)) return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // CSS is handled by Vite in the browser and has no executable behavior in jsdom.
    if (url.startsWith(sourceRoot) && url.endsWith('.css')) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    if (compiledModules.has(url)) {
      return { format: 'module', source: compiledModules.get(url), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
