import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['bin/oxc-audit.ts', 'src/index.ts'],
  format: ['esm'],
  // Generate .d.ts via tsgo (the native TypeScript port). typescript@7 exposes no `.` main
  // export, so rolldown-plugin-dts's default TS-based mode cannot resolve it. [Experimental]
  dts: { tsgo: true },
  sourcemap: false,
  clean: true,
  // Package-manifest and type-resolution gates. `esm-only` is correct: this package is
  // `type: module` with a single ESM export, so CJS/Node10 failures are expected.
  publint: true,
  attw: { profile: 'esm-only' },
})
