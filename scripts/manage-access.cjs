'use strict';

const { createAdminClient, resolveProject } = require('./firebase-admin-client.cjs');

const HELP = 'Usage:\n' +
  '  node scripts/manage-access.cjs status [--email person@example.com] [--project project-id]\n' +
  '  node scripts/manage-access.cjs allow-email --email person@example.com [--apply] [--project project-id]\n' +
  '  node scripts/manage-access.cjs revoke-email --email person@example.com [--apply] [--project project-id]\n\n' +
  'Changes are dry-run unless --apply is supplied. Google must verify the email at login.\n' +
  'This tool never creates Auth users, changes passwords, or sends email.';

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(value) || value.length > 254) {
    throw new Error('Supply a valid Google account email with --email.');
  }
  return value;
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || 'status';
  const options = { command, apply: false };
  while (args.length) {
    const key = args.shift();
    if (key === '--apply') options.apply = true;
    else if (key === '--email' || key === '--project') {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + key);
      options[key.slice(2)] = value;
    } else throw new Error('Unknown option: ' + key);
  }
  if (!['status', 'allow-email', 'revoke-email', 'help', '--help', '-h'].includes(command)) {
    throw new Error('Unknown command: ' + command);
  }
  if (options.email !== undefined || command === 'allow-email' || command === 'revoke-email') {
    options.email = normalizeEmail(options.email);
  }
  return options;
}

async function run(argv, dependencies = {}) {
  const options = parseArgs(argv);
  const log = dependencies.log || console.log;
  if (['help', '--help', '-h'].includes(options.command)) {
    log(HELP);
    return;
  }
  const projectId = resolveProject(options.project);
  const client = await (dependencies.createAdminClient || createAdminClient)(projectId);
  const authBase = 'https://identitytoolkit.googleapis.com/admin/v2/projects/' + projectId;
  const allowlistBase = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents/allowedEmails';
  const targetUrl = options.email ? allowlistBase + '/' + encodeURIComponent(options.email) : null;

  if (options.command === 'status') {
    const [config, google, target] = await Promise.all([
      client.request(authBase + '/config'),
      client.request(authBase + '/defaultSupportedIdpConfigs/google.com', { allowNotFound: true }),
      targetUrl ? client.request(targetUrl, { allowNotFound: true }) : Promise.resolve(null),
    ]);
    // Explicit allowlist of output fields: never print config.signIn/hashConfig or raw users.
    const result = {
      projectId,
      googleEnabled: google?.enabled === true,
      googleClientConfigured: !!google?.clientId,
      anonymousEnabled: config?.signIn?.anonymous?.enabled === true,
      authorizedDomains: config?.authorizedDomains || [],
      ...(options.email ? {
        email: options.email,
        accessEnabled: target?.fields?.enabled?.booleanValue === true,
      } : {}),
    };
    log(JSON.stringify(result, null, 2));
    return result;
  }

  const target = await client.request(targetUrl, { allowNotFound: true });
  const enabled = options.command === 'allow-email';
  const result = {
    projectId,
    email: options.email,
    previousEnabled: target?.fields?.enabled?.booleanValue === true,
    enabled,
    applied: options.apply,
  };
  if (options.apply) {
    await client.request(targetUrl + '?updateMask.fieldPaths=enabled', {
      method: 'PATCH',
      body: { fields: { enabled: { booleanValue: enabled } } },
    });
  }
  log(JSON.stringify(result, null, 2));
  if (!options.apply) log('Dry-run only. Add --apply to make this change.');
  return result;
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { normalizeEmail, parseArgs, run };
