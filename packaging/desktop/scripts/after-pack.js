// electron-builder afterPack hook.
// macOS: Apple Silicon refuses to run apps without a signature. Unless a real Developer ID certificate
// is configured (CSC_LINK), give the app an "ad-hoc" signature so it opens (users still confirm it once
// in System Settings → Privacy & Security, see docs/manual/install-macos.md).
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.CSC_LINK) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${app}`);
};
