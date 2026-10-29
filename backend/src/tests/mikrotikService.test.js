import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { config } from '../config/env.js';
import {
  activateHotspotUser,
  disconnectHotspotUser,
  expireHotspotUser,
  formatRouterRateLimit,
  provisionHotspotUser
} from '../services/mikrotikService.js';

test('formats package download/upload speeds for RouterOS rate-limit direction', () => {
  assert.equal(formatRouterRateLimit({ downloadMbps: 20, uploadMbps: 5 }), '5M/20M');
  assert.equal(formatRouterRateLimit({}), undefined);
  assert.throws(() => formatRouterRateLimit({ downloadMbps: 20 }), { code: 'INVALID_SPEED_LIMIT' });
});

test('provisions a disabled, time-limited, speed-limited user and later activates and expires it', async () => {
  const originalCreate = axios.create;
  const originalConfig = {
    enabled: config.mikrotikEnabled,
    host: config.MIKROTIK_HOST,
    restPort: config.MIKROTIK_REST_PORT,
    username: config.MIKROTIK_USERNAME,
    password: config.MIKROTIK_PASSWORD,
    timeout: config.MIKROTIK_CONNECT_TIMEOUT_MS,
    tls: config.mikrotikTlsRejectUnauthorized,
    defaultProfile: config.MIKROTIK_DEFAULT_PROFILE
  };
  const calls = [];
  const users = [{ '.id': '*unrelated', name: 'keep-existing-user' }];
  const active = [{ '.id': '*session1', user: 'paid-user' }];
  const client = {
    async get(path, options = {}) {
      calls.push({ method: 'GET', path, options });
      if (path === '/ip/hotspot/active') return { data: active.filter((item) => item.user === options.params.user) };
      return { data: users.filter((item) => !options.params?.name || item.name === options.params.name) };
    },
    async put(path, body) {
      calls.push({ method: 'PUT', path, body });
      users.push({ '.id': '*paid1', name: body.name, disabled: body.disabled, password: body.password });
      return { data: { '.id': '*paid1' } };
    },
    async patch(path, body) {
      calls.push({ method: 'PATCH', path, body });
      const id = decodeURIComponent(path.split('/').at(-1));
      const user = users.find((item) => item['.id'] === id);
      if (user) Object.assign(user, body);
      return { data: {} };
    },
    async delete(path) {
      calls.push({ method: 'DELETE', path });
      const id = decodeURIComponent(path.split('/').at(-1));
      if (path.startsWith('/ip/hotspot/active/')) {
        const index = active.findIndex((item) => item['.id'] === id);
        if (index >= 0) active.splice(index, 1);
      } else {
        const index = users.findIndex((item) => item['.id'] === id);
        if (index >= 0) users.splice(index, 1);
      }
      return { data: {} };
    }
  };
  axios.create = () => client;
  Object.assign(config, {
    mikrotikEnabled: true,
    MIKROTIK_HOST: '192.0.2.1',
    MIKROTIK_REST_PORT: 443,
    MIKROTIK_USERNAME: 'restricted-test-user',
    MIKROTIK_PASSWORD: 'test-router-password',
    MIKROTIK_CONNECT_TIMEOUT_MS: 5000,
    mikrotikTlsRejectUnauthorized: true,
    MIKROTIK_DEFAULT_PROFILE: 'default'
  });
  try {
    const routerId = await provisionHotspotUser({
      username: 'paid-user', password: 'temporary-hotspot-password', durationSeconds: 7200,
      speedProfile: '', downloadMbps: 20, uploadMbps: 5
    });
    assert.equal(routerId, '*paid1');
    const create = calls.find((call) => call.method === 'PUT');
    assert.equal(create.body.disabled, 'true');
    assert.equal(create.body['limit-uptime'], '2h0s');
    assert.equal(create.body['rate-limit'], '5M/20M');
    assert.equal(users.some((item) => item.name === 'keep-existing-user'), true);

    await activateHotspotUser('paid-user');
    assert.equal(users.find((item) => item.name === 'paid-user').disabled, 'false');

    await disconnectHotspotUser('paid-user');
    assert.equal(active.length, 0);

    active.push({ '.id': '*session2', user: 'paid-user' });
    await expireHotspotUser('paid-user');
    assert.equal(users.some((item) => item.name === 'paid-user'), false);
    assert.equal(users.some((item) => item.name === 'keep-existing-user'), true);
  } finally {
    axios.create = originalCreate;
    config.mikrotikEnabled = originalConfig.enabled;
    config.MIKROTIK_HOST = originalConfig.host;
    config.MIKROTIK_REST_PORT = originalConfig.restPort;
    config.MIKROTIK_USERNAME = originalConfig.username;
    config.MIKROTIK_PASSWORD = originalConfig.password;
    config.MIKROTIK_CONNECT_TIMEOUT_MS = originalConfig.timeout;
    config.mikrotikTlsRejectUnauthorized = originalConfig.tls;
    config.MIKROTIK_DEFAULT_PROFILE = originalConfig.defaultProfile;
  }
});

test('sanitizes RouterOS client errors instead of exposing credentials in exception text', async () => {
  const originalCreate = axios.create;
  const originalEnabled = config.mikrotikEnabled;
  const secret = 'do-not-leak-router-password';
  axios.create = () => ({
    get: async () => { throw new Error(`request failed with ${secret}`); }
  });
  config.mikrotikEnabled = true;
  try {
    await assert.rejects(
      provisionHotspotUser({ username: 'paid-user', password: secret, durationSeconds: 3600 }),
      (error) => error.code === 'ROUTER_OPERATION_FAILED' && !error.message.includes(secret)
    );
  } finally {
    axios.create = originalCreate;
    config.mikrotikEnabled = originalEnabled;
  }
});
