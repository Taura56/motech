import { normalizeKenyanPhone } from '../utils/phone.js';

function normalizedPhone(value) {
  if (value === undefined || value === null) return '';
  try { return normalizeKenyanPhone(String(value)); } catch { return ''; }
}

export function parseDarajaCallback(body) {
  const callback = body?.Body?.stkCallback;
  const resultCode = callback?.ResultCode;
  const validResultCode = Number.isInteger(resultCode) ||
    (typeof resultCode === 'string' && /^\d{1,8}$/.test(resultCode));
  if (!callback || typeof callback.CheckoutRequestID !== 'string' || callback.CheckoutRequestID.length > 128 ||
      typeof callback.MerchantRequestID !== 'string' || callback.MerchantRequestID.length > 128 ||
      !validResultCode ||
      typeof callback.ResultDesc !== 'string') return null;

  const values = {};
  const items = callback.CallbackMetadata?.Item;
  for (const item of Array.isArray(items) ? items : []) {
    if (item && typeof item.Name === 'string') values[item.Name] = item.Value;
  }
  const amount = Number(values.Amount);
  return {
    checkoutRequestId: callback.CheckoutRequestID,
    merchantRequestId: callback.MerchantRequestID,
    resultCode: Number(resultCode),
    resultDescription: callback.ResultDesc.slice(0, 250),
    amountKes: Number.isFinite(amount) ? amount : undefined,
    phoneNumber: normalizedPhone(values.PhoneNumber),
    receiptNumber: typeof values.MpesaReceiptNumber === 'string' ? values.MpesaReceiptNumber.slice(0, 40) : ''
  };
}
