/**
 * Thin fetch wrapper. Every mutating call carries the anti-CSRF header.
 *
 * The same calls work against a clinic server over the network or against the
 * copy of the server running inside this phone; `mode.js` decides which, and
 * nothing above this file needs to know.
 */
import { isLocalMode } from './mode.js';

async function request(method, path, body, options = {}) {
  if (isLocalMode()) return localCall(method, path, body, options);

  // X-Clinic-Request is the header the server checks. X-Requested-With is sent
  // too for older builds, but Android's WebView overwrites that one, so it can
  // never be the only proof a request came from this app.
  const headers = { 'X-Clinic-Request': '1', 'X-Requested-With': 'clinic-app' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (options.raw) {
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res;
  }

  let payload = null;
  try { payload = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    const err = new ApiError(res.status, payload?.error || `Request failed (${res.status})`);
    err.details = payload?.details;
    throw err;
  }
  return payload;
}

/** The in-phone server, reached through a worker instead of the network. */
async function localCall(method, path, body, options) {
  const { localRequest } = await import('./local/client.js');
  const res = await localRequest(method, path, body);

  if (options.raw) {
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res;
  }

  let payload = null;
  try { payload = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    const err = new ApiError(res.status, payload?.error || `Request failed (${res.status})`);
    err.details = payload?.details;
    throw err;
  }
  return payload;
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const str = search.toString();
  return str ? `?${str}` : '';
};

export const api = {
  // auth
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  logout: () => request('POST', '/api/auth/logout', {}),
  me: () => request('GET', '/api/auth/me'),
  changePassword: (body) => request('POST', '/api/auth/password', body),

  // dashboard + reports
  dashboard: (params) => request('GET', `/api/dashboard${qs(params)}`),
  financialReport: (params) => request('GET', `/api/reports/financial${qs(params)}`),
  receivables: () => request('GET', '/api/reports/receivables'),
  appointmentReport: (params) => request('GET', `/api/reports/appointments${qs(params)}`),
  exportUrl: (kind, params) => `/api/reports/export/${kind}${qs(params)}`,

  // patients
  patients: (params) => request('GET', `/api/patients${qs(params)}`),
  patient: (id) => request('GET', `/api/patients/${id}`),
  patientSummary: (id) => request('GET', `/api/patients/${id}/summary`),
  createPatient: (body) => request('POST', '/api/patients', body),
  updatePatient: (id, body) => request('PUT', `/api/patients/${id}`, body),
  archivePatient: (id) => request('DELETE', `/api/patients/${id}`),

  // odontogram
  chart: (id) => request('GET', `/api/patients/${id}/chart`),
  setTooth: (id, tooth, body) => request('PUT', `/api/patients/${id}/chart/${tooth}`, body),

  // appointments
  appointments: (params) => request('GET', `/api/appointments${qs(params)}`),
  createAppointment: (body) => request('POST', '/api/appointments', body),
  updateAppointment: (id, body) => request('PUT', `/api/appointments/${id}`, body),
  setAppointmentStatus: (id, body) => request('PATCH', `/api/appointments/${id}/status`, body),
  deleteAppointment: (id) => request('DELETE', `/api/appointments/${id}`),

  // catalogue + treatments
  procedures: (params) => request('GET', `/api/procedures${qs(params)}`),
  createProcedure: (body) => request('POST', '/api/procedures', body),
  updateProcedure: (id, body) => request('PUT', `/api/procedures/${id}`, body),
  retireProcedure: (id) => request('DELETE', `/api/procedures/${id}`),
  treatments: (params) => request('GET', `/api/treatments${qs(params)}`),
  createTreatment: (body) => request('POST', '/api/treatments', body),
  updateTreatment: (id, body) => request('PUT', `/api/treatments/${id}`, body),
  deleteTreatment: (id) => request('DELETE', `/api/treatments/${id}`),

  // money
  invoices: (params) => request('GET', `/api/invoices${qs(params)}`),
  invoice: (id) => request('GET', `/api/invoices/${id}`),
  createInvoice: (body) => request('POST', '/api/invoices', body),
  updateInvoice: (id, body) => request('PUT', `/api/invoices/${id}`, body),
  issueInvoice: (id, body) => request('POST', `/api/invoices/${id}/issue`, body || {}),
  voidInvoice: (id, body) => request('POST', `/api/invoices/${id}/void`, body),
  invoicePending: (patientId) => request('POST', `/api/patients/${patientId}/invoice-pending`, {}),
  payments: (params) => request('GET', `/api/payments${qs(params)}`),
  createPayment: (body) => request('POST', '/api/payments', body),
  deletePayment: (id) => request('DELETE', `/api/payments/${id}`),
  expenses: (params) => request('GET', `/api/expenses${qs(params)}`),
  createExpense: (body) => request('POST', '/api/expenses', body),
  updateExpense: (id, body) => request('PUT', `/api/expenses/${id}`, body),
  deleteExpense: (id) => request('DELETE', `/api/expenses/${id}`),

  // messaging
  messageTemplates: () => request('GET', '/api/messages/templates'),
  saveTemplate: (key, body) => request('PUT', `/api/messages/templates/${key}`, body),
  createTemplate: (body) => request('POST', '/api/messages/templates', body),
  deleteTemplate: (key) => request('DELETE', `/api/messages/templates/${key}`),
  previewMessage: (body) => request('POST', '/api/messages/preview', body),
  sendMessage: (body) => request('POST', '/api/messages/send', body),
  messages: (params) => request('GET', `/api/messages${qs(params)}`),
  dueReminders: (params) => request('GET', `/api/messages/due-reminders${qs(params)}`),

  // syncing between devices
  syncDevices: () => request('GET', '/api/sync/devices'),

  attachments: (patientId) => request('GET', `/api/patients/${patientId}/attachments`),
  attachment: (id) => request('GET', `/api/attachments/${id}`),
  addAttachment: (patientId, body) =>
    request('POST', `/api/patients/${patientId}/attachments`, body),
  updateAttachment: (id, body) => request('PATCH', `/api/attachments/${id}`, body),
  deleteAttachment: (id) => request('DELETE', `/api/attachments/${id}`),

  myDevices: () => request('GET', '/api/auth/devices'),
  signOutDevice: (id) => request('DELETE', `/api/auth/devices/${id}`),

  licence: () => request('GET', '/api/licence'),
  activateLicence: (key) => request('POST', '/api/licence', { key }),
  startPairing: () => request('POST', '/api/sync/pair', {}),
  revokeSyncDevice: (id) => request('DELETE', `/api/sync/devices/${id}`),

  // admin
  users: (params) => request('GET', `/api/users${qs(params)}`),
  createUser: (body) => request('POST', '/api/users', body),
  updateUser: (id, body) => request('PUT', `/api/users/${id}`, body),
  resetUserPassword: (id, body) => request('POST', `/api/users/${id}/password`, body),
  settings: () => request('GET', '/api/settings'),
  network: () => request('GET', '/api/network'),
  saveSettings: (body) => request('PUT', '/api/settings', body),
};
