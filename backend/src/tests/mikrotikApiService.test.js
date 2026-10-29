import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMikrotikApiService } from '../services/mikrotikApiService.js';

const settings = {
  mikrotikEnabled: true,
  MIKROTIK_HOST: '192.168.10.1',
  MIKROTIK_PORT: 8728,
  MIKROTIK_USERNAME: 'motech-api',
  MIKROTIK_PASSWORD: 'do-not-leak-this',
  MIKROTIK_CONNECT_TIMEOUT_MS: 5000
};

function fakeApi(responses = {}) {
  const instance = {
    connected: false,
    commands: [],
    closeCalls: 0,
    async connect() { this.connected = true; },
    async write(command) {
      this.commands.push(command);
      if (responses[command] instanceof Error) throw responses[command];
      return responses[command];
    },
    async close() { this.closeCalls += 1; this.connected = false; }
  };
  class Api {
    constructor(options) {
      instance.options = options;
      return instance;
    }
  }
  return { Api, instance };
}

const routerResponses = {
  '/system/identity/print': [{ name: 'billing-router' }],
  '/system/resource/print': [{ version: '7.20.8 (long-term)', 'board-name': 'RB951Ui-2HnD' }],
  '/system/routerboard/print': [{ model: 'RB951Ui-2HnD' }]
};

test('disabled MikroTik integration performs no TCP or RouterOS API operations', async () => {
  const { Api } = fakeApi();
  let probes = 0;
  const service = createMikrotikApiService({
    settings: { ...settings, mikrotikEnabled: false },
    Api,
    probe: async () => { probes += 1; }
  });

  assert.deepEqual(await service.check(), {
    enabled: false, tcpConnected: false, authenticated: false, connected: false, lastSuccessfulCheckAt: null
  });
  assert.equal(probes, 0);
});

test('reads identity, resource, and optional routerboard with node-routeros and closes the connection', async () => {
  const { Api, instance } = fakeApi(routerResponses);
  const service = createMikrotikApiService({
    settings,
    Api,
    probe: async (host, port, timeoutMs) => {
      assert.deepEqual([host, port, timeoutMs], ['192.168.10.1', 8728, 5000]);
    },
    now: () => new Date('2026-10-29T12:00:00.000Z')
  });

  const result = await service.check();

  assert.deepEqual(instance.commands, [
    '/system/identity/print',
    '/system/resource/print',
    '/system/routerboard/print'
  ]);
  assert.equal(instance.options.port, 8728);
  assert.equal(instance.options.timeout, 5);
  assert.equal(instance.options.user, 'motech-api');
  assert.equal(instance.options.password, settings.MIKROTIK_PASSWORD);
  assert.equal(instance.options.keepalive, false);
  assert.equal(instance.closeCalls, 1);
  assert.deepEqual(result, {
    enabled: true,
    tcpConnected: true,
    authenticated: true,
    connected: true,
    identity: 'billing-router',
    version: '7.20.8 (long-term)',
    model: 'RB951Ui-2HnD',
    routerboardSupported: true,
    lastSuccessfulCheckAt: '2026-10-29T12:00:00.000Z'
  });
  assert.equal(JSON.stringify(result).includes(settings.MIKROTIK_PASSWORD), false);
});

test('reports authentication failures without exposing library error text or credentials', async () => {
  const { Api, instance } = fakeApi();
  instance.connect = async () => {
    throw Object.assign(new Error('Username or password is invalid'), { errno: 'CANTLOGIN' });
  };
  const service = createMikrotikApiService({ settings, Api, probe: async () => {} });

  const result = await service.check();

  assert.equal(result.tcpConnected, true);
  assert.equal(result.authenticated, false);
  assert.equal(result.error.code, 'AUTHENTICATION_FAILED');
  assert.equal(JSON.stringify(result).includes(settings.MIKROTIK_PASSWORD), false);
});

test('sanitizes TCP refusal and timeout failures without attempting API authentication', async () => {
  const { Api, instance } = fakeApi();
  const refused = createMikrotikApiService({
    settings,
    Api,
    probe: async () => { throw Object.assign(new Error(settings.MIKROTIK_PASSWORD), { code: 'ECONNREFUSED' }); }
  });

  const result = await refused.check();

  assert.equal(result.tcpConnected, false);
  assert.equal(result.authenticated, false);
  assert.equal(result.error.code, 'CONNECTION_REFUSED');
  assert.equal(instance.commands.length, 0);
  assert.equal(JSON.stringify(result).includes(settings.MIKROTIK_PASSWORD), false);

  const timedOut = createMikrotikApiService({
    settings,
    Api,
    probe: async () => { throw Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }); }
  });
  assert.equal((await timedOut.check()).error.code, 'CONNECTION_TIMEOUT');
});

test('sanitizes required-query permission errors and still closes an authenticated connection', async () => {
  const { Api, instance } = fakeApi({
    '/system/identity/print': routerResponses['/system/identity/print'],
    '/system/resource/print': Object.assign(new Error('Permission denied.'), { errno: 'EACCES' })
  });
  const service = createMikrotikApiService({ settings, Api, probe: async () => {} });

  const result = await service.check();

  assert.equal(result.authenticated, true);
  assert.equal(result.connected, false);
  assert.deepEqual(result.error, {
    code: 'PERMISSION_DENIED',
    message: 'The RouterOS account lacks permission for this read-only query.'
  });
  assert.equal(instance.closeCalls, 1);
  assert.equal(JSON.stringify(result).includes(settings.MIKROTIK_PASSWORD), false);
});

test('reports unsupported optional routerboard queries without invalidating successful required reads', async () => {
  const { Api, instance } = fakeApi({
    ...routerResponses,
    '/system/routerboard/print': Object.assign(new Error('no such command prefix'), { errno: 'ENOENT' })
  });
  const service = createMikrotikApiService({ settings, Api, probe: async () => {} });

  const result = await service.check();

  assert.equal(result.connected, true);
  assert.equal(result.routerboardSupported, false);
  assert.equal(result.routerboardError.code, 'COMMAND_UNSUPPORTED');
  assert.equal(instance.closeCalls, 1);
});

test('reports an empty optional routerboard response instead of claiming support', async () => {
  const { Api } = fakeApi({
    ...routerResponses,
    '/system/routerboard/print': []
  });
  const service = createMikrotikApiService({ settings, Api, probe: async () => {} });

  const result = await service.check();

  assert.equal(result.connected, true);
  assert.equal(result.routerboardSupported, false);
  assert.equal(result.routerboardError.code, 'NO_ROUTERBOARD_DATA');
});

test('rejects enabled checks with missing credentials without probing the router', async () => {
  const { Api } = fakeApi();
  let probes = 0;
  const service = createMikrotikApiService({
    settings: { ...settings, MIKROTIK_PASSWORD: '' },
    Api,
    probe: async () => { probes += 1; }
  });

  const result = await service.check();

  assert.equal(result.error.code, 'INVALID_CONFIGURATION');
  assert.equal(probes, 0);
});

test('coalesces overlapping health checks into one API connection', async () => {
  const { Api, instance } = fakeApi(routerResponses);
  let releaseConnect;
  const connectGate = new Promise((resolve) => { releaseConnect = resolve; });
  instance.connect = async () => {
    await connectGate;
    instance.connected = true;
  };
  const service = createMikrotikApiService({ settings, Api, probe: async () => {} });

  const first = service.check();
  const second = service.check();
  releaseConnect();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.connected, true);
  assert.strictEqual(secondResult, firstResult);
  assert.equal(instance.closeCalls, 1);
});

test('configuration refuses enabled integration when API credentials are missing', () => {
  const backendDirectory = fileURLToPath(new URL('../..', import.meta.url));
  const child = spawnSync(process.execPath, [
    '--env-file=.env.test',
    '--input-type=module',
    '-e',
    "import('./src/config/env.js')"
  ], {
    cwd: backendDirectory,
    env: { ...process.env, MIKROTIK_ENABLED: 'true', MIKROTIK_USERNAME: '', MIKROTIK_PASSWORD: '' },
    encoding: 'utf8'
  });

  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /MikroTik API host and credentials are required when MIKROTIK_ENABLED=true/);
  assert.doesNotMatch(child.stderr, /do-not-leak-this/);
});
