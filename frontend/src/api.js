const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (options.admin) headers.set('X-Requested-With', 'MOTECH-ZONE-ADMIN');
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include'
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'The request could not be completed.');
  return data;
}

export function paymentHeaders(token) {
  return { 'X-Payment-Token': token };
}

export async function downloadPaymentsCsv() {
  const response = await fetch(`${API_BASE}/admin/reports/payments.csv`, {
    credentials: 'include',
    headers: { 'X-Requested-With': 'MOTECH-ZONE-ADMIN' }
  });
  if (!response.ok) throw new Error('Could not export payments.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'motech-zone-payments.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
