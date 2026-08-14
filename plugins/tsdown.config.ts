import { defineConfig } from 'tsdown'

/**
 * Build every plugin to JavaScript.
 *
 * The sources cannot ship as-is. Oxlint loads a js plugin through Node, and Node refuses to
 * strip types from anything under `node_modules` — `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
 * — so a published package of `.ts` files fails to load for every consumer, however new
 * their Node is. Type stripping only ever applies to a project's own source.
 *
 * Each plugin is bundled rather than transpiled file by file: they import `shared/` and their
 * own rules with explicit `.ts` extensions, which a plain transpile would leave pointing at
 * files that no longer exist.
 *
 * Declarations are not emitted. Nothing imports these plugins as TypeScript — Oxlint loads
 * them at runtime by specifier — so a `.d.ts` would be weight with no reader.
 */
export default defineConfig({
  entry: [
    'src/ai-integrations/index.ts',
    'src/data-layer/index.ts',
    'src/next-react/index.ts',
    'src/slop-stop/index.ts',
    'src/supabase/index.ts',
    'src/ts-tooling/index.ts',
    'src/web-security/index.ts',
  ],
  outDir: 'dist',
  format: 'esm',
  dts: false,
  clean: true,
})
