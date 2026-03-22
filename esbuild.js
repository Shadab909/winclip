import { build } from 'esbuild';

const common = {
  bundle: true,
  format: 'esm',
  target: 'firefox115',
  external: ['gi://*', 'resource://*'],
  treeShaking: true,
  logLevel: 'info',
};

// Build extension.js (runs inside gnome-shell process)
await build({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
});

// Build prefs.js (runs in separate GTK process)
await build({
  ...common,
  entryPoints: ['src/prefs.ts'],
  outfile: 'dist/prefs.js',
});

console.log('Build complete.');
