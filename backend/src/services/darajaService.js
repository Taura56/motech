import axios from 'axios';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const baseUrl = config.DARAJA_ENV === 'sandbox'
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke';
const client = axios.create({ baseURL: baseUrl, timeout: config.DARAJA_TIMEOUT_MS });
let cachedToken;

function requiredCredentials() {
  const { DARAJA_CONSUMER_KEY: key, DARAJA_CONSUMER_SECRET: secret, DARAJA_SHORTCODE: shortcode, DARAJA_PASSKEY: passkey } = config;
  if (!key || !secret || !shortcode || !passkey) {
    throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Payment service is not configured.');
  }
  return { key, secret, shortcode, passkey };
}

export async function getAccessToken() {
  const { key, secret } = requiredCredentials();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) return cachedToken.value;
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  let data;
  try {
    ({ data } = await client.get('/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${auth}` }
    }));
  } catch {
    throw new AppError(503, 'DARAJA_AUTH_UNAVAILABLE', 'Payment provider authentication could not be completed.');
  }
  if (!data?.access_token) throw new AppError(502, 'DARAJA_AUTH_FAILED', 'Payment provider authentication failed.');
  const expiresIn = Number(data.expires_in) || 3599;
  cachedToken = { value: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  return cachedToken.value;
}

function timestampNow(date = new Date()) {
  const pad = (part) => String(part).padStart(2, '0');
  const nairobiTime = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return `${nairobiTime.getUTCFullYear()}${pad(nairobiTime.getUTCMonth() + 1)}${pad(nairobiTime.getUTCDate())}${pad(nairobiTime.getUTCHours())}${pad(nairobiTime.getUTCMinutes())}${pad(nairobiTime.getUTCSeconds())}`;
}

export async function initiateStkPush({ phoneNumber, amountKes, orderId }) {
  const { shortcode, passkey } = requiredCredentials();
  if (!config.DARAJA_CALLBACK_URL) {
    throw new AppError(503, 'CALLBACK_NOT_CONFIGURED', 'Configure a public HTTPS M-Pesa callback URL before accepting payments.');
  }
  if (!Number.isSafeInteger(amountKes) || amountKes < 1) {
    throw new AppError(400, 'INVALID_PAYMENT_AMOUNT', 'Payment amount must be a positive whole number of Kenyan shillings.');
  }
  const timestamp = timestampNow();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  const accessToken = await getAccessToken();
  const callbackUrl = config.DARAJA_CALLBACK_URL;
  if (config.NODE_ENV === 'production' && !callbackUrl.startsWith('https://')) {
    throw new AppError(503, 'CALLBACK_NOT_SECURE', 'A public HTTPS payment callback is required.');
  }
  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: config.DARAJA_TRANSACTION_TYPE,
    Amount: amountKes,
    PartyA: phoneNumber,
    PartyB: shortcode,
    PhoneNumber: phoneNumber,
    CallBackURL: callbackUrl,
    AccountReference: orderId.slice(0, 12),
    TransactionDesc: 'MOTECH ZONE Wi-Fi'
  };
  let data;
  try {
    ({ data } = await client.post('/mpesa/stkpush/v1/processrequest', payload, {
      headers: { Authorization: `Bearer ${accessToken}` }
    }));
  } catch {
    throw new AppError(503, 'DARAJA_STK_OUTCOME_UNKNOWN', 'Payment request outcome is being checked. Do not submit another payment yet.');
  }
  if (data?.ResponseCode !== '0' || !data?.CheckoutRequestID || !data?.MerchantRequestID) {
    throw new AppError(502, 'STK_REQUEST_REJECTED', 'Payment provider did not accept the STK Push request.');
  }
  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
    customerMessage: data.CustomerMessage || 'Check your phone to complete payment.'
  };
}

export async function queryStkPush(checkoutRequestId) {
  const { shortcode, passkey } = requiredCredentials();
  const timestamp = timestampNow();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  const accessToken = await getAccessToken();
  let data;
  try {
    ({ data } = await client.post('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    }, { headers: { Authorization: `Bearer ${accessToken}` } }));
  } catch {
    throw new AppError(503, 'DARAJA_QUERY_UNAVAILABLE', 'Payment status could not be verified yet.');
  }
  return data;
}

export function resetTokenCacheForTests() {
  cachedToken = undefined;
}
