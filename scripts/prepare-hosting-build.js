const fs = require('fs');
const path = require('path');

const accessPathSegment = 'agtmagtm';
const buildDirectory = path.resolve(__dirname, '..', 'build');
const destinationDirectory = path.join(buildDirectory, accessPathSegment);
const destinationPath = path.join(destinationDirectory, 'index.html');

if (!fs.existsSync(path.join(buildDirectory, 'index.html'))) {
  throw new Error(`Build entry point was not found: ${path.join(buildDirectory, 'index.html')}`);
}

fs.mkdirSync(destinationDirectory, { recursive: true });

for (const entry of fs.readdirSync(buildDirectory, { withFileTypes: true })) {
  if (entry.name === accessPathSegment) {
    continue;
  }

  fs.renameSync(
    path.join(buildDirectory, entry.name),
    path.join(destinationDirectory, entry.name)
  );
}

if (!fs.existsSync(destinationPath)) {
  throw new Error(`Prepared hosting entry point was not found: ${destinationPath}`);
}

console.log(`Hosting entry point: /${accessPathSegment}/index.html`);
