import net from 'node:net';
import { RouterOSAPI } from 'node-routeros';
import { config } from '../config/env.js';

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error('TCP connection timed out'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sanitizeError(error) {
  const code = String(error?.code || error?.errno || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();

  if (code === 'ECONNREFUSED') return { code: 'CONNECTION_REFUSED', message: 'Router API connection was refused.' };
  if (['ETIMEDOUT', 'SOCKTMOUT'].includes(code) || message.includes('timed out')) {
    return { code: 'CONNECTION_TIMEOUT', message: 'Router API connection timed out.' };
  }
  if (['CANTLOGIN', 'EAUTH'].includes(code) || message.includes('cannot log in') || message.includes('invalid user name or password')) {
    return { code: 'AUTHENTICATION_FAILED', message: 'Router API authentication failed.' };
  }
  if (['EACCES', 'EPERM'].includes(code) || message.includes('permission denied')) {
    return { code: 'PERMISSION_DENIED', message: 'The RouterOS account lacks permission for this read-only query.' };
  }
  if (message.includes('no such command') || message.includes('unknown command') || message.includes('bad command name')) {
    return { code: 'COMMAND_UNSUPPORTED', message: 'The RouterOS command is unsupported.' };
  }
  return { code: 'ROUTER_API_ERROR', message: 'The RouterOS API request failed.' };
}

function firstRow(response) {
  return Array.isArray(response) && response.length > 0 && response[0] && typeof response[0] === 'object'
    ? response[0]
    : null;
}

function timed(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Router API request timed out'), { code: 'ETIMEDOUT' })), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

export function createMikrotikApiService({
  settings = config,
  Api = RouterOSAPI,
  probe = tcpProbe,
  now = () => new Date()
} = {}) {
  let inFlight;
  let lastSuccessfulCheckAt = null;

  async function check() {
    if (!settings.mikrotikEnabled) {
      return { enabled: false, tcpConnected: false, authenticated: false, connected: false, lastSuccessfulCheckAt };
    }
    if (!settings.MIKROTIK_HOST || !settings.MIKROTIK_USERNAME || !settings.MIKROTIK_PASSWORD) {
      return {
        enabled: true, tcpConnected: false, authenticated: false, connected: false, lastSuccessfulCheckAt,
        error: { code: 'INVALID_CONFIGURATION', message: 'Router API host and credentials must be configured.' }
      };
    }

    if (inFlight) return inFlight;
    inFlight = runCheck().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function runCheck() {
    const timeoutMs = settings.MIKROTIK_CONNECT_TIMEOUT_MS;
    const result = {
      enabled: true,
      tcpConnected: false,
      authenticated: false,
      connected: false,
      identity: null,
      version: null,
      model: null,
      routerboardSupported: null,
      lastSuccessfulCheckAt
    };
    let client;
    let failure;

    try {
      await probe(settings.MIKROTIK_HOST, settings.MIKROTIK_PORT, timeoutMs);
      result.tcpConnected = true;

      client = new Api({
        host: settings.MIKROTIK_HOST,
        port: settings.MIKROTIK_PORT,
        user: settings.MIKROTIK_USERNAME,
        password: settings.MIKROTIK_PASSWORD,
        timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
        keepalive: false
      });
      await timed(client.connect(), timeoutMs);
      result.authenticated = true;

      const identity = firstRow(await timed(client.write('/system/identity/print'), timeoutMs));
      const resource = firstRow(await timed(client.write('/system/resource/print'), timeoutMs));
      if (!identity || typeof identity.name !== 'string' || !resource || typeof resource.version !== 'string') {
        throw Object.assign(new Error('Unexpected RouterOS response'), { code: 'INVALID_RESPONSE' });
      }

      result.identity = identity.name;
      result.version = resource.version;
      result.model = typeof resource['board-name'] === 'string' ? resource['board-name'] : null;
      try {
        const routerboard = firstRow(await timed(client.write('/system/routerboard/print'), timeoutMs));
        result.routerboardSupported = Boolean(routerboard);
        if (typeof routerboard?.model === 'string') result.model = routerboard.model;
        if (!routerboard) {
          result.routerboardError = {
            code: 'NO_ROUTERBOARD_DATA',
            message: 'Routerboard information was not returned by the optional query.'
          };
        }
      } catch (error) {
        result.routerboardSupported = false;
        result.routerboardError = sanitizeError(error);
      }
      result.connected = true;
      lastSuccessfulCheckAt = now().toISOString();
      result.lastSuccessfulCheckAt = lastSuccessfulCheckAt;
    } catch (error) {
      failure = error?.code === 'INVALID_RESPONSE'
        ? { code: 'INVALID_RESPONSE', message: 'The RouterOS API returned an unexpected response.' }
        : sanitizeError(error);
    }

    if (client?.connected) {
      try {
        await timed(client.close(), timeoutMs);
      } catch {
        result.connected = false;
        failure = { code: 'CONNECTION_CLOSE_FAILED', message: 'The RouterOS API connection could not be closed cleanly.' };
      }
    }
    if (failure) result.error = failure;
    return result;
  }

  return { check };
}

const mikrotikApi = createMikrotikApiService();

export const checkMikrotikApi = mikrotikApi.check;
export const routerHealth = checkMikrotikApi;
