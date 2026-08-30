const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const watchMarkerPlugin = {
  name: 'watch-marker',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`> ${location ? `${location.file}:${location.line}:${location.column}: ` : ''}error: ${text}`);
      }
      console.log('[watch] build finished');
    });
  },
};

async function main() {
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    sourcemap: !production,
    minify: production,
    logLevel: 'silent',
    plugins: [watchMarkerPlugin],
  });

  const webviewCtx = await esbuild.context({
    entryPoints: ['media/main.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: 'dist/webview.js',
    sourcemap: !production,
    minify: production,
    logLevel: 'silent',
    plugins: [watchMarkerPlugin],
  });

  const testCtx = await esbuild.context({
    entryPoints: ['src/test/extension.test.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outfile: 'dist/test/extension.test.js',
    external: ['vscode', 'mocha'],
    sourcemap: true,
    logLevel: 'silent',
    plugins: [watchMarkerPlugin],
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), webviewCtx.watch(), testCtx.watch()]);
  } else {
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild(), testCtx.rebuild()]);
    await Promise.all([extensionCtx.dispose(), webviewCtx.dispose(), testCtx.dispose()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
