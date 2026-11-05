'use strict';

const fs = require('node:fs');
const path = require('node:path');

const API_HOSTS = new Set([
  'identitytoolkit.googleapis.com',
  'firestore.googleapis.com',
  'firebaserules.googleapis.com',
]);

function loadFirebaseCliAuth() {
  const candidates = [
    'firebase-tools/lib/auth.js',
    process.env.FIREBASE_TOOLS_PATH && path.join(process.env.FIREBASE_TOOLS_PATH, 'lib/auth.js'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'),
    path.join(path.dirname(process.execPath), 'node_modules/firebase-tools/lib/auth.js'),
    path.join(path.dirname(process.execPath), '../lib/node_modules/firebase-tools/lib/auth.js'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Firebase CLI is required. Install firebase-tools and run firebase login. Set FIREBASE_TOOLS_PATH to its package directory if needed.');
}

function resolveProject(project) {
  const value = project || JSON.parse(fs.readFileSync(path.resolve(__dirname, '../.firebaserc'), 'utf8')).projects.default;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value || '')) {
    throw new Error('A valid Firebase project ID is required.');
  }
  return value;
}

async function createAdminClient(project) {
  const projectId = resolveProject(project);
  const auth = loadFirebaseCliAuth();
  const account = auth.getProjectDefaultAccount(path.resolve(__dirname, '..'));
  if (!account?.tokens?.refresh_token) {
    throw new Error('Run firebase login with a project administrator account first.');
  }
  // Reuse the CLI login; credentials remain in memory and are never logged.
  const tokens = await auth.getAccessToken(account.tokens.refresh_token, [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/firebase',
  ]);
  if (!tokens?.access_token) throw new Error('Firebase CLI authentication did not return an access token.');

  async function request(url, options = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !API_HOSTS.has(parsed.hostname)) {
      throw new Error('Refusing to send administrator credentials to an unsupported host.');
    }
    const response = await fetch(parsed, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + tokens.access_token,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (response.status === 404 && options.allowNotFound) return null;
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      // Do not echo response bodies: auth responses can contain sensitive fields.
      const status = /^[A-Z_]+$/.test(body?.error?.status || '') ? body.error.status : 'REQUEST_FAILED';
      throw new Error('Google API request failed: HTTP ' + response.status + ' ' + status);
    }
    return body;
  }

  return { projectId, request };
}

module.exports = { createAdminClient, resolveProject };
