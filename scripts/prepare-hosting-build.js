const fs = require('fs');
const path = require('path');

const buildDirectory = path.resolve(__dirname, '..', process.env.BUILD_PATH || 'build');
const entryPoint = path.join(buildDirectory, 'index.html');

if (!fs.existsSync(entryPoint)) {
  throw new Error(`Build entry point was not found: ${entryPoint}`);
}

// CRA now emits root-relative asset URLs, so keep its output at the hosting root.
console.log('Hosting entry point: /index.html');
