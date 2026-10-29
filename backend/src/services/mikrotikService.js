import axios from 'axios';
import https from 'node:https';
import { config } from '../config/env.js';
import { routerUptime } from '../utils/time.js';
import { AppError } from '../utils/errors.js';

function routerClient() {
  if (!config.mikrotikEnabled) throw new AppError(503, 'ROUTER_DISABLED', 'Router access is not enabled.');
  const agent = new https.Agent({ rejectUnauthorized: config.mikrotikTlsRejectUnauthorized });
  return axios.create({
    baseURL: `https://${config.MIKROTIK_HOST}:${config.MIKROTIK_REST_PORT}/rest`,
    auth: { username: config.MIKROTIK_USERNAME, password: config.MIKROTIK_PASSWORD },
    httpsAgent: agent,
    timeout: config.MIKROTIK_CONNECT_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function safeRouterOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'ROUTER_OPERATION_FAILED', 'The RouterOS operation did not complete.');
  }
}

export function formatRouterRateLimit({ downloadMbps, uploadMbps }) {
  if (downloadMbps === undefined && uploadMbps === undefined) return undefined;
  if (!Number.isInteger(downloadMbps) || !Number.isInteger(uploadMbps) ||
      downloadMbps < 1 || uploadMbps < 1 || downloadMbps > 1000 || uploadMbps > 1000) {
    throw new AppError(400, 'INVALID_SPEED_LIMIT', 'Package download and upload speeds must be between 1 and 1000 Mbps.');
  }
  // RouterOS Hotspot rate-limit is rx/tx from the router's perspective: client upload/download.
  return `${uploadMbps}M/${downloadMbps}M`;
}

export async function provisionHotspotUser({ username, password, durationSeconds, speedProfile, downloadMbps, uploadMbps }) {
  return safeRouterOperation(async () => {
    const client = routerClient();
    const { data: existing } = await client.get('/ip/hotspot/user', { params: { name: username } });
    const user = Array.isArray(existing) ? existing.find((item) => item.name === username) : null;
    const body = {
      name: username,
      password,
      profile: speedProfile || config.MIKROTIK_DEFAULT_PROFILE,
      'limit-uptime': routerUptime(durationSeconds),
      disabled: 'true',
      comment: 'MOTECH ZONE paid access'
    };
    const rateLimit = formatRouterRateLimit({ downloadMbps, uploadMbps });
    if (rateLimit) body['rate-limit'] = rateLimit;
    if (user) {
      await client.patch(`/ip/hotspot/user/${encodeURIComponent(user['.id'])}`, body);
      return user['.id'];
    }
    const { data } = await client.put('/ip/hotspot/user', body);
    if (data?.['.id']) return data['.id'];
    const { data: createdUsers } = await client.get('/ip/hotspot/user', { params: { name: username } });
    return Array.isArray(createdUsers) ? createdUsers.find((item) => item.name === username)?.['.id'] || '' : '';
  });
}

export async function activateHotspotUser(username) {
  return safeRouterOperation(async () => {
    const client = routerClient();
    const { data } = await client.get('/ip/hotspot/user', { params: { name: username } });
    const user = Array.isArray(data) ? data.find((item) => item.name === username) : null;
    if (!user) throw new AppError(404, 'ROUTER_USER_MISSING', 'The paid router user was not found.');
    await client.patch(`/ip/hotspot/user/${encodeURIComponent(user['.id'])}`, { disabled: 'false' });
  });
}

export async function expireHotspotUser(username) {
  return safeRouterOperation(async () => {
    const client = routerClient();
    await disconnectHotspotUser(username);
    const { data } = await client.get('/ip/hotspot/user', { params: { name: username } });
    const user = Array.isArray(data) ? data.find((item) => item.name === username) : null;
    if (!user) return;
    try {
      await client.delete(`/ip/hotspot/user/${encodeURIComponent(user['.id'])}`);
    } catch (error) {
      if (error.response?.status !== 404) throw error;
    }
  });
}

export async function disconnectHotspotUser(username) {
  return safeRouterOperation(async () => {
    const client = routerClient();
    const { data } = await client.get('/ip/hotspot/active', { params: { user: username } });
    await Promise.all((Array.isArray(data) ? data : [data]).filter(Boolean)
      .map((session) => client.delete(`/ip/hotspot/active/${encodeURIComponent(session['.id'])}`)));
  });
}
