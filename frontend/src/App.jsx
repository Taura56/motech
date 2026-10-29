import React from 'react';
import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { api, downloadPaymentsCsv, paymentHeaders } from './api.js';
import { createIdempotencyKey } from './utils/idempotencyKey.js';

function Header() {
  return <header className="topbar"><Link className="brand" to="/">MOTECH <span>ZONE</span></Link><nav><Link to="/terms">Terms & privacy</Link></nav></header>;
}

function CustomerPortal() {
  const [packages, setPackages] = useState([]);
  const [packagesLoaded, setPackagesLoaded] = useState(false);
  const [phone, setPhone] = useState('');
  const [selected, setSelected] = useState(null);
  const [payment, setPayment] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());

  useEffect(() => {
    api('/packages').then((data) => {
      setPackages(data.packages);
      setPackagesLoaded(true);
    }).catch((reason) => setError(reason.message));
  }, []);

  useEffect(() => {
    const savedToken = sessionStorage.getItem('motech:active-payment-token');
    if (!savedToken) return undefined;
    let active = true;
    api('/payments/status', { headers: paymentHeaders(savedToken) })
      .then((data) => {
        if (!active) return;
        setPayment({ paymentToken: savedToken, orderId: data.orderId, package: data.package });
        setStatus(data);
      })
      .catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!payment?.paymentToken ||
        ['FAILED', 'CANCELLED', 'EXPIRED', 'REVIEW_REQUIRED'].includes(status?.status) ||
        (status?.status === 'SUCCESS' && ['ACTIVE', 'EXPIRED'].includes(status?.access?.status))) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const next = await api('/payments/status', { headers: paymentHeaders(payment.paymentToken) });
        if (active) setStatus(next);
      } catch (reason) { if (active) setError(reason.message); }
    };
    poll();
    const timer = window.setInterval(poll, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [payment, status?.status, status?.access?.status]);

  useEffect(() => {
    if (!status?.access?.expiresAt) return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status?.access?.expiresAt]);

  async function purchase(event) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true); setError(''); setStatus(null);
    try {
      const storageKey = `motech:purchase:${selected._id}:${phone}`;
      const idempotencyKey = sessionStorage.getItem(storageKey) || createIdempotencyKey();
      sessionStorage.setItem(storageKey, idempotencyKey);
      const result = await api('/payments/initiate', {
        method: 'POST',
        body: JSON.stringify({ phone, packageId: selected._id, idempotencyKey })
      });
      sessionStorage.setItem('motech:active-payment-token', result.paymentToken);
      setPayment(result);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  function reset() {
    if (selected) sessionStorage.removeItem(`motech:purchase:${selected._id}:${phone}`);
    sessionStorage.removeItem('motech:active-payment-token');
    setSelected(null); setPayment(null); setStatus(null); setError('');
  }

  async function logoutAccess() {
    if (!payment?.paymentToken || busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/access/logout', {
        method: 'POST',
        headers: paymentHeaders(payment.paymentToken)
      });
      window.location.assign('http://login.motechzone.local/logout?erase-cookie=on-logout');
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  const access = status?.access;
  const paymentIsTerminal = ['FAILED', 'CANCELLED', 'EXPIRED'].includes(status?.status);
  const remainingSeconds = access?.expiresAt
    ? Math.max(0, Math.ceil((new Date(access.expiresAt).getTime() - clockNow) / 1000))
    : 0;
  return <main className="container">
    <section className="hero">
      <div className="eyebrow">FAST. SIMPLE. CONNECTED.</div>
      <h1>Reliable Wi-Fi,<br /><span>on your terms.</span></h1>
      <p>Choose a package, pay securely with M-Pesa, and connect.</p>
    </section>
    {error && <div role="alert" className="notice error">{error}</div>}
    {payment ? <section className="panel customer-status">
      <div className={status?.status === 'SUCCESS' ? 'success-mark' : 'pending-mark'}>{status?.status === 'SUCCESS' ? '✓' : '…'}</div>
      <h2>{status?.status === 'SUCCESS'
        ? access?.status === 'ACTIVE' ? 'Payment confirmed · Connected' : access?.status === 'SCHEDULED' ? 'Payment confirmed · Scheduled' : access?.status === 'EXPIRED' ? 'Access time ended' : 'Payment confirmed · Preparing access'
        : status?.status === 'FAILED' || status?.status === 'CANCELLED' ? 'Payment not completed'
          : status?.status === 'EXPIRED' ? 'Payment timed out'
            : status?.status === 'REVIEW_REQUIRED' ? 'Payment needs review' : 'Check your phone'}</h2>
      <div className="order-summary"><span>{status?.package?.name || payment.package?.name || 'Selected package'}</span><strong>KES {status?.package?.priceKes ?? payment.package?.priceKes ?? '—'}</strong></div>
      <dl className="customer-status-details">
        <div><dt>Payment status</dt><dd>{status?.status || 'Pending'}</dd></div>
        <div><dt>Transaction reference</dt><dd>{status?.transactionReference || status?.receiptNumber || payment.orderId || 'Awaiting provider reference'}</dd></div>
        <div><dt>Connection</dt><dd>{access?.status || (status?.status === 'SUCCESS' ? 'Preparing' : 'Not activated')}</dd></div>
        {access?.startsAt && <div><dt>Access starts</dt><dd>{new Date(access.startsAt).toLocaleString()}</dd></div>}
        {access?.expiresAt && <div><dt>Expires</dt><dd>{new Date(access.expiresAt).toLocaleString()}</dd></div>}
        {access?.expiresAt && access.status !== 'EXPIRED' && <div><dt>Time remaining</dt><dd>{formatRemaining(access.status === 'SCHEDULED' ? access.remainingSeconds : remainingSeconds)}</dd></div>}
      </dl>
      {status?.failureMessage && <p className={status.status === 'REVIEW_REQUIRED' ? 'helper' : 'notice error'}>{status.failureMessage}</p>}
      {access?.status === 'ACTIVE' && access.username && <div className="credentials"><span>Hotspot username</span><strong>{access.username}</strong><span>Hotspot password</span><strong>{access.password}</strong></div>}
      {access?.logoutAvailable && <button className="button secondary wide" onClick={logoutAccess} disabled={busy}>{busy ? 'Logging out…' : 'Log out of Wi-Fi'}</button>}
      {access?.status === 'ACTIVE' && <a className="text-button" href="http://login.motechzone.local/login?motech-login=1">Return to Wi-Fi login</a>}
      {paymentIsTerminal && status?.status !== 'REVIEW_REQUIRED' && <button className="button secondary wide" onClick={reset}>Start another purchase</button>}
      {status?.status === 'SUCCESS' && ['ACTIVE', 'EXPIRED'].includes(access?.status) && <button className="button secondary wide" onClick={reset}>Buy another package</button>}
    </section> : selected ? <section className="panel">
      <button className="back-button" onClick={() => setSelected(null)}>← Packages</button>
      <h2>Pay with M-Pesa</h2>
      <div className="order-summary"><span>{selected.name} · {Math.round(selected.durationSeconds / 3600)} hours</span><strong>KES {selected.priceKes}</strong></div>
      <form onSubmit={purchase}>
        <label htmlFor="phone">M-Pesa phone number</label>
        <input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={phone} onChange={(event) => setPhone(event.target.value)} required minLength={9} maxLength={20} />
        <p className="helper">We’ll send an M-Pesa prompt to this number. Your number is used to match payment and access records.</p>
        <button className="button primary wide" disabled={busy}>{busy ? 'Starting payment…' : `Pay KES ${selected.priceKes}`}</button>
      </form>
    </section> : <section>
      <div className="section-heading"><div><div className="eyebrow">PICK YOUR PLAN</div><h2>Wi-Fi packages</h2></div><span className="secure-label">Secure M-Pesa payment</span></div>
      {packages.length ? <div className="package-grid">{packages.map((item) => <article key={item._id} className="package-card">
        <div className="package-time">{durationLabel(item.durationSeconds)}</div>
        <div className="package-title-row"><h3>{item.name}</h3><div className="price"><small>KES</small> {item.priceKes}</div></div>
        <p>{item.description || 'Wi-Fi access'}</p>
        <p className="package-speed">{item.downloadMbps && item.uploadMbps
          ? `Download ${item.downloadMbps} Mbps · Upload ${item.uploadMbps} Mbps`
          : item.speedProfile ? `Speed profile: ${item.speedProfile}` : 'Speed limit not configured'}</p>
        <button className="button secondary wide" onClick={() => setSelected(item)}>Choose package</button>
      </article>)}</div> : <div className="panel empty">{error ? 'Packages could not be loaded.' : packagesLoaded ? 'No Wi-Fi packages are available right now.' : 'Loading available packages…'}</div>}
      <p className="renewal-note">If you buy while access is active, your new package starts when the current paid time ends.</p>
    </section>}
    <footer>By continuing, you agree to our <Link to="/terms">terms and privacy notice</Link>. <a href="http://login.motechzone.local/login?motech-login=1">Return to Wi-Fi login</a></footer>
  </main>;
}

function formatRemaining(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`, `${remainingSeconds}s`].filter(Boolean).join(' ');
}

function durationLabel(seconds) {
  if (seconds % 604800 === 0) return `${seconds / 604800} week${seconds === 604800 ? '' : 's'}`;
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  return `${Math.round(seconds / 60)} minutes`;
}

function Terms() {
  return <main className="container narrow"><section className="panel"><div className="eyebrow">MOTECH ZONE</div><h1>Terms & privacy</h1>
    <h3>Access terms</h3><p>Wi-Fi access is time-limited to the package purchased. Package time is scheduled from payment confirmation and extends after any unexpired access. Do not misuse the network or attempt to disrupt other users.</p>
    <h3>Privacy notice</h3><p>We process your phone number, selected package, payment status and receipt reference to verify payment, provide access, prevent duplicate activation and support reconciliation. Access credentials and session expiry are stored to operate the hotspot. Payment and audit records are retained only as long as needed for service, legal and accounting obligations.</p>
    <p>We do not request your M-Pesa PIN. Never share it with anyone. Contact the network operator for support without sharing passwords or PINs.</p><Link className="button secondary" to="/">Back to packages</Link>
  </section></main>;
}

function Admin() {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [packages, setPackages] = useState([]);
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [editingPackage, setEditingPackage] = useState(null);
  const [packageForm, setPackageForm] = useState({ name: '', slug: '', description: '', priceKes: '', durationHours: '', downloadMbps: '', uploadMbps: '', speedProfile: '', sortOrder: 0 });
  const [activeSection, setActiveSection] = useState('overview');
  const [administrators, setAdministrators] = useState([]);
  const [administratorsLoading, setAdministratorsLoading] = useState(false);
  const [administratorError, setAdministratorError] = useState('');
  const [administratorNotice, setAdministratorNotice] = useState('');
  const [administratorDialogOpen, setAdministratorDialogOpen] = useState(false);
  const [editingAdministrator, setEditingAdministrator] = useState(null);
  const [administratorForm, setAdministratorForm] = useState({
    fullName: '', email: '', password: '', confirmPassword: '', active: true
  });
  const [resetAdministrator, setResetAdministrator] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/admin/auth/me', { admin: true }).then((data) => setAdmin(data.admin)).catch(() => setAdmin(null)); }, []);
  useEffect(() => {
    if (!admin) return;
    Promise.all([
      api('/admin/dashboard', { admin: true }),
      api('/admin/packages', { admin: true }),
      api('/admin/payments?limit=20', { admin: true }),
      api('/admin/customers', { admin: true }),
      api('/admin/sessions', { admin: true })
    ]).then(([overview, packageData, paymentData, customerData, sessionData]) => {
      setDashboard(overview); setPackages(packageData.packages); setPayments(paymentData.payments);
      setCustomers(customerData.customers); setSessions(sessionData.sessions);
    }).catch((reason) => setError(reason.message));
  }, [admin]);

  useEffect(() => {
    if (!admin || activeSection !== 'administrators') return undefined;
    let active = true;
    setAdministratorsLoading(true);
    setAdministratorError('');
    api('/admin/administrators', { admin: true })
      .then((data) => { if (active) setAdministrators(data.administrators); })
      .catch((reason) => { if (active) setAdministratorError(reason.message); })
      .finally(() => { if (active) setAdministratorsLoading(false); });
    return () => { active = false; };
  }, [admin, activeSection]);

  async function refreshAdminData() {
    const [overview, paymentData, sessionData] = await Promise.all([
      api('/admin/dashboard', { admin: true }),
      api('/admin/payments?limit=20', { admin: true }),
      api('/admin/sessions', { admin: true })
    ]);
    setDashboard(overview);
    setPayments(paymentData.payments);
    setSessions(sessionData.sessions);
  }

  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api('/admin/auth/login', { method: 'POST', admin: true, body: JSON.stringify({ email, password }) });
      setAdmin(result.admin); setPassword('');
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  function openAdministratorDialog(administrator = null) {
    setEditingAdministrator(administrator);
    setAdministratorForm({
      fullName: administrator?.fullName || '',
      email: administrator?.email || '',
      password: '',
      confirmPassword: '',
      active: administrator?.active ?? true
    });
    setAdministratorError('');
    setAdministratorNotice('');
    setAdministratorDialogOpen(true);
  }

  function closeAdministratorDialog() {
    setAdministratorDialogOpen(false);
    setEditingAdministrator(null);
    setAdministratorForm({ fullName: '', email: '', password: '', confirmPassword: '', active: true });
  }

  async function refreshAdministrators() {
    const data = await api('/admin/administrators', { admin: true });
    setAdministrators(data.administrators);
  }

  async function saveAdministrator(event) {
    event.preventDefault();
    setAdministratorError('');
    setAdministratorNotice('');
    if (administratorForm.password !== administratorForm.confirmPassword) {
      setAdministratorError('Passwords do not match.');
      return;
    }
    if (!editingAdministrator && administratorForm.password.length < 14) {
      setAdministratorError('Password must be at least 14 characters.');
      return;
    }
    const body = {
      fullName: administratorForm.fullName,
      email: administratorForm.email
    };
    if (editingAdministrator) {
      await runAdministratorAction(async () => {
        await api(`/admin/administrators/${editingAdministrator._id}`, {
          method: 'PATCH', admin: true, body: JSON.stringify(body)
        });
        await refreshAdministrators();
        closeAdministratorDialog();
        setAdministratorNotice('Administrator details updated.');
      });
      return;
    }
    await runAdministratorAction(async () => {
      await api('/admin/administrators', {
        method: 'POST',
        admin: true,
        body: JSON.stringify({
          ...body,
          password: administratorForm.password,
          confirmPassword: administratorForm.confirmPassword,
          active: administratorForm.active
        })
      });
      await refreshAdministrators();
      closeAdministratorDialog();
      setAdministratorNotice('Administrator created successfully.');
    });
  }

  async function runAdministratorAction(action) {
    setBusy(true);
    try { await action(); }
    catch (reason) { setAdministratorError(reason.message); }
    finally { setBusy(false); }
  }

  async function changeAdministratorStatus(administrator) {
    const nextActive = !administrator.active;
    if (!nextActive && !window.confirm(`Deactivate ${administrator.fullName || administrator.email}? They will no longer be able to sign in.`)) return;
    setAdministratorError('');
    setAdministratorNotice('');
    await runAdministratorAction(async () => {
      await api(`/admin/administrators/${administrator._id}/status`, {
        method: 'PATCH', admin: true, body: JSON.stringify({ active: nextActive })
      });
      await refreshAdministrators();
      setAdministratorNotice(`Administrator ${nextActive ? 'activated' : 'deactivated'}.`);
    });
  }

  async function submitPasswordReset(event) {
    event.preventDefault();
    setAdministratorError('');
    if (resetPassword !== confirmResetPassword) {
      setAdministratorError('Passwords do not match.');
      return;
    }
    if (resetPassword.length < 14) {
      setAdministratorError('Password must be at least 14 characters.');
      return;
    }
    await runAdministratorAction(async () => {
      await api(`/admin/administrators/${resetAdministrator._id}/password`, {
        method: 'PUT', admin: true, body: JSON.stringify({ password: resetPassword, confirmPassword: confirmResetPassword })
      });
      setResetAdministrator(null);
      setResetPassword('');
      setConfirmResetPassword('');
      setAdministratorNotice('Administrator password reset successfully.');
    });
  }

  async function togglePackage(item) {
    setError('');
    try {
      const result = await api(`/admin/packages/${item._id}`, {
        method: 'PATCH', admin: true,
        body: JSON.stringify({ enabled: !item.enabled })
      });
      setPackages((existing) => existing.map((pkg) => pkg._id === item._id ? result.package : pkg));
    } catch (reason) { setError(reason.message); }
  }

  function startEditPackage(item) {
    setEditingPackage(item._id);
    setPackageForm({
      name: item.name, slug: item.slug, description: item.description || '',
      priceKes: item.priceKes, durationHours: item.durationSeconds / 3600,
      downloadMbps: item.downloadMbps ?? '', uploadMbps: item.uploadMbps ?? '',
      speedProfile: item.speedProfile || '', sortOrder: item.sortOrder || 0
    });
  }

  function packageField(event) {
    const { name, value } = event.target;
    setPackageForm((current) => ({ ...current, [name]: value }));
  }

  async function savePackage(event) {
    event.preventDefault(); setError('');
    const body = {
      name: packageForm.name,
      slug: packageForm.slug || packageForm.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      description: packageForm.description,
      priceKes: Number(packageForm.priceKes),
      durationSeconds: Math.round(Number(packageForm.durationHours) * 3600),
      ...(packageForm.downloadMbps !== '' ? { downloadMbps: Number(packageForm.downloadMbps) } : {}),
      ...(packageForm.uploadMbps !== '' ? { uploadMbps: Number(packageForm.uploadMbps) } : {}),
      speedProfile: packageForm.speedProfile,
      sortOrder: Number(packageForm.sortOrder),
      enabled: editingPackage ? packages.find((item) => item._id === editingPackage)?.enabled ?? true : true
    };
    try {
      const result = await api(editingPackage ? `/admin/packages/${editingPackage}` : '/admin/packages', {
        method: editingPackage ? 'PATCH' : 'POST',
        admin: true,
        body: JSON.stringify(body)
      });
      setPackages((items) => editingPackage
        ? items.map((item) => item._id === editingPackage ? result.package : item)
        : [...items, result.package]);
      setEditingPackage(null);
      setPackageForm({ name: '', slug: '', description: '', priceKes: '', durationHours: '', downloadMbps: '', uploadMbps: '', speedProfile: '', sortOrder: 0 });
    } catch (reason) { setError(reason.message); }
  }

  async function exportCsv() {
    try { await downloadPaymentsCsv(); }
    catch (reason) { setError(reason.message); }
  }

  async function reconcilePayment(item) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/admin/payments/${item._id}/reconcile`, { method: 'POST', admin: true });
      await refreshAdminData();
      setNotice(result.status === 'SUCCESS'
        ? `Payment ${item.orderId} was verified successfully.`
        : `Payment ${item.orderId} is still ${result.status}. Check the payment details before retrying.`);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function disconnectSession(item) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/admin/sessions/${item._id}/disconnect`, { method: 'POST', admin: true });
      setNotice(`Hotspot session for ${item.phoneNumber} was disconnected.`);
      await refreshAdminData();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function logout() {
    await api('/admin/auth/logout', { method: 'POST', admin: true });
    setAdmin(null); setDashboard(null); navigate('/admin');
  }

  if (admin === undefined) return <main className="container"><p>Checking administrator session…</p></main>;
  if (!admin) return <main className="container narrow"><section className="panel"><div className="eyebrow">RESTRICTED AREA</div><h1>Administrator login</h1>
    {error && <div className="notice error">{error}</div>}
    <form onSubmit={login}><label htmlFor="admin-email">Email</label><input id="admin-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <label htmlFor="admin-password">Password</label><input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      <button className="button primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form>
    <p className="small">First administrator setup: configure <code>backend\.env</code>, then run <code>npm run admin:create</code> from the project folder in a private terminal. Public administrator registration is disabled.</p>
    </section></main>;

  return <main className="container admin-page">
    <div className="admin-heading"><div><div className="eyebrow">MANAGEMENT</div><h1>Overview</h1><p>Signed in as {admin.email}</p></div><button className="button secondary" onClick={logout}>Sign out</button></div>
    {error && <div className="notice error">{error}</div>}
    {notice && <div className="notice success-notice" role="status">{notice}</div>}
    <nav className="admin-section-nav" aria-label="Administrator sections">
      <button className={`small-button ${activeSection === 'overview' ? 'selected' : ''}`} onClick={() => setActiveSection('overview')}>Overview & packages</button>
      {admin.role === 'admin' && <button className={`small-button ${activeSection === 'administrators' ? 'selected' : ''}`} onClick={() => setActiveSection('administrators')}>Admin Management</button>}
    </nav>
    {activeSection === 'administrators' ? <section className="panel">
      <div className="section-heading admin-management-heading">
        <div><h2>Admin Management</h2><p className="small">Manage administrator access. Passwords are never displayed.</p></div>
        <button className="button primary" onClick={() => openAdministratorDialog()}>Create Administrator</button>
      </div>
      {administratorError && <div className="notice error" role="alert">{administratorError}</div>}
      {administratorNotice && <div className="notice success-notice" role="status">{administratorNotice}</div>}
      <p className="small">Active administrators: {administrators.filter((item) => item.active).length} / 2</p>
      {administratorsLoading ? <p className="empty">Loading administrators…</p> : administrators.length === 0 ? <p className="empty">No administrator accounts found.</p> : <div className="table-scroll">
        <table><thead><tr><th>Full name</th><th>Email</th><th>Role</th><th>Status</th><th>Date created</th><th>Actions</th></tr></thead>
          <tbody>{administrators.map((item) => <tr key={item._id}>
            <td>{item.fullName || '—'}</td><td>{item.email}</td><td>Administrator</td>
            <td><span className={`status ${item.active ? 'active' : 'inactive'}`}>{item.active ? 'Active' : 'Inactive'}</span></td>
            <td>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}</td>
            <td className="admin-actions">
              <button className="small-button" onClick={() => openAdministratorDialog(item)}>Edit</button>
              <button className="small-button" disabled={item._id === admin.id || (item.active && administrators.filter((account) => account.active).length <= 1) || busy} onClick={() => changeAdministratorStatus(item)}>{item.active ? 'Deactivate' : 'Activate'}</button>
              <button className="small-button" onClick={() => { setResetAdministrator(item); setResetPassword(''); setConfirmResetPassword(''); setAdministratorError(''); }}>Reset password</button>
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
      {administratorDialogOpen && <div className="dialog-backdrop" role="presentation">
        <section className="panel admin-dialog" role="dialog" aria-modal="true" aria-labelledby="administrator-dialog-title">
          <h2 id="administrator-dialog-title">{editingAdministrator ? 'Edit Administrator' : 'Create Administrator'}</h2>
          <form onSubmit={saveAdministrator}>
            <label htmlFor="administrator-name">Full name</label>
            <input id="administrator-name" value={administratorForm.fullName} onChange={(event) => setAdministratorForm((form) => ({ ...form, fullName: event.target.value }))} autoComplete="name" minLength={2} maxLength={80} required />
            <label htmlFor="administrator-email">Username or email</label>
            <input id="administrator-email" type="email" value={administratorForm.email} onChange={(event) => setAdministratorForm((form) => ({ ...form, email: event.target.value }))} autoComplete="email" maxLength={254} required />
            <label htmlFor="administrator-role">Role</label>
            <select id="administrator-role" value="admin" disabled><option value="admin">Administrator</option></select>
            {!editingAdministrator && <>
              <label htmlFor="administrator-status">Account status</label>
              <select id="administrator-status" value={administratorForm.active ? 'active' : 'inactive'} onChange={(event) => setAdministratorForm((form) => ({ ...form, active: event.target.value === 'active' }))}>
                <option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
              <label htmlFor="administrator-password">Password (minimum 14 characters)</label>
              <input id="administrator-password" type="password" autoComplete="new-password" value={administratorForm.password} onChange={(event) => setAdministratorForm((form) => ({ ...form, password: event.target.value }))} minLength={14} maxLength={200} required />
              <label htmlFor="administrator-confirm-password">Confirm password</label>
              <input id="administrator-confirm-password" type="password" autoComplete="new-password" value={administratorForm.confirmPassword} onChange={(event) => setAdministratorForm((form) => ({ ...form, confirmPassword: event.target.value }))} minLength={14} maxLength={200} required />
            </>}
            {administratorError && <div className="notice error" role="alert">{administratorError}</div>}
            <div className="form-actions"><button className="button primary" disabled={busy}>{busy ? 'Saving…' : editingAdministrator ? 'Save changes' : 'Create Administrator'}</button><button className="button secondary" type="button" onClick={closeAdministratorDialog}>Cancel</button></div>
          </form>
        </section>
      </div>}
      {resetAdministrator && <div className="dialog-backdrop" role="presentation">
        <section className="panel admin-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
          <h2 id="reset-password-title">Reset password</h2>
          <p>Set a new password for {resetAdministrator.email}. The current password cannot be viewed.</p>
          <form onSubmit={submitPasswordReset}>
            <label htmlFor="reset-admin-password">New password (minimum 14 characters)</label>
            <input id="reset-admin-password" type="password" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} minLength={14} maxLength={200} required />
            <label htmlFor="confirm-reset-admin-password">Confirm new password</label>
            <input id="confirm-reset-admin-password" type="password" autoComplete="new-password" value={confirmResetPassword} onChange={(event) => setConfirmResetPassword(event.target.value)} minLength={14} maxLength={200} required />
            {administratorError && <div className="notice error" role="alert">{administratorError}</div>}
            <div className="form-actions"><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</button><button className="button secondary" type="button" onClick={() => setResetAdministrator(null)}>Cancel</button></div>
          </form>
        </section>
      </div>}
    </section> : <>
    <div className="metric-grid">{[
      ['Payments today', dashboard?.paymentsToday ?? '—'],
      ['Successful amount', `KES ${dashboard?.successfulAmountKesToday ?? '—'}`],
      ['Pending payments', dashboard?.pendingPayments ?? '—'],
      ['Active sessions', dashboard?.activeSessions ?? '—']
    ].map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <section className="panel">
      <div className="section-heading"><h2>Packages</h2><span className="small">Package speed limits apply to new hotspot access.</span></div>
      <form className="package-form" onSubmit={savePackage}>
        <h3>{editingPackage ? 'Edit package' : 'Add package'}</h3>
        <div className="form-grid">
          <label>Name<input name="name" value={packageForm.name} onChange={packageField} required maxLength={60} /></label>
          <label>Slug<input name="slug" value={packageForm.slug} onChange={packageField} placeholder="generated from name" maxLength={64} /></label>
          <label>Price (KES)<input name="priceKes" type="number" min="1" step="1" value={packageForm.priceKes} onChange={packageField} required /></label>
          <label>Duration (hours)<input name="durationHours" type="number" min="0.02" step="0.01" value={packageForm.durationHours} onChange={packageField} required /></label>
          <label>Download speed (Mbps)<input name="downloadMbps" type="number" min="1" max="1000" step="1" value={packageForm.downloadMbps} onChange={packageField} required={!editingPackage} /></label>
          <label>Upload speed (Mbps)<input name="uploadMbps" type="number" min="1" max="1000" step="1" value={packageForm.uploadMbps} onChange={packageField} required={!editingPackage} /></label>
          <label>Speed profile<input name="speedProfile" value={packageForm.speedProfile} onChange={packageField} maxLength={64} /></label>
          <label>Sort order<input name="sortOrder" type="number" step="1" value={packageForm.sortOrder} onChange={packageField} /></label>
          <label className="form-wide">Description<input name="description" value={packageForm.description} onChange={packageField} maxLength={240} /></label>
        </div>
        <div className="form-actions"><button className="button primary">{editingPackage ? 'Save changes' : 'Create package'}</button>{editingPackage && <button className="button secondary" type="button" onClick={() => setEditingPackage(null)}>Cancel</button>}</div>
      </form>
      <div className="table-scroll"><table><thead><tr><th>Package</th><th>Price</th><th>Duration</th><th>Download / upload</th><th>Enabled</th><th>Action</th></tr></thead><tbody>
        {packages.map((item) => <tr key={item._id}><td>{item.name}</td><td>KES {item.priceKes}</td><td>{durationLabel(item.durationSeconds)}</td><td>{item.downloadMbps && item.uploadMbps ? `${item.downloadMbps} / ${item.uploadMbps} Mbps` : 'Not configured'}</td><td>{item.enabled ? 'Yes' : 'No'}</td><td><button className="small-button" onClick={() => startEditPackage(item)}>Edit</button> <button className="small-button" onClick={() => togglePackage(item)}>{item.enabled ? 'Disable' : 'Enable'}</button></td></tr>)}
      </tbody></table></div>
    </section>
    <section className="panel"><div className="section-heading"><h2>Recent payments</h2><button className="small-button" onClick={exportCsv}>Export CSV</button></div>
      <div className="table-scroll"><table><thead><tr><th>Date</th><th>Phone</th><th>Package</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {payments.map((item) => <tr key={item._id}><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.phoneNumber}</td><td>{item.packageSnapshot?.name}</td><td>KES {item.amountKes}</td><td><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></td><td>{['PENDING', 'REVIEW_REQUIRED'].includes(item.status) && <button className="small-button" disabled={busy} onClick={() => reconcilePayment(item)}>{busy ? 'Checking…' : 'Verify payment'}</button>}</td></tr>)}
      </tbody></table></div>
    </section>
    <section className="panel"><h2>Customers</h2><div className="table-scroll"><table><thead><tr><th>Phone</th><th>Payments</th><th>Successful</th><th>Last purchase</th></tr></thead><tbody>
      {customers.map((item) => <tr key={item.phoneNumber}><td>{item.phoneNumber}</td><td>{item.paymentCount}</td><td>{item.successfulPayments}</td><td>{new Date(item.lastPurchaseAt).toLocaleString()}</td></tr>)}
    </tbody></table></div></section>
    <section className="panel"><h2>Access sessions</h2><div className="table-scroll"><table><thead><tr><th>Phone</th><th>Username</th><th>Starts</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {sessions.map((item) => <tr key={item._id}><td>{item.phoneNumber}</td><td>{item.username}</td><td>{new Date(item.startsAt).toLocaleString()}</td><td>{new Date(item.expiresAt).toLocaleString()}</td><td><span className={`status ${item.routerState.toLowerCase()}`}>{item.routerState}</span></td><td>{item.routerState === 'ACTIVE' && <button className="small-button" disabled={busy || !dashboard?.router?.enabled} onClick={() => disconnectSession(item)}>Disconnect</button>}</td></tr>)}
      {!sessions.length && <tr><td colSpan="6" className="empty">No access sessions yet.</td></tr>}
    </tbody></table></div></section>
    <p className="small">Router: {dashboard?.router?.enabled ? (dashboard.router.connected ? `Connected · ${dashboard.router.version}` : 'Not connected') : 'Integration disabled'} · Daraja status is visible from payment initiation and callback processing.</p>
    </>}
  </main>;
}

export default function App() {
  return <><Header /><Routes><Route path="/" element={<CustomerPortal />} /><Route path="/terms" element={<Terms />} /><Route path="/admin/*" element={<Admin />} /></Routes></>;
}
