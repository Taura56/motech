import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import session from 'express-session';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { Admin } from '../models/Admin.js';
import { Package } from '../models/Package.js';
import {
  createInitialAdministrator,
  listAdministrators,
  setAdministratorStatus
} from '../services/adminManagementService.js';

let mongo;
let app;

const firstPassword = 'first-administrator-password';
const secondPassword = 'second-administrator-password';

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Admin.init(), Package.init()]);
  app = createApp({ sessionStore: new session.MemoryStore() });
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function login(email, password) {
  const response = await request(app)
    .post('/api/admin/auth/login')
    .send({ email, password });
  assert.equal(response.status, 200);
  return response.headers['set-cookie'][0].split(';')[0];
}

test('secure bootstrap, two-admin limit, protected management, password reset and package management', async () => {
  const bootstrap = await Promise.allSettled([
    createInitialAdministrator({ fullName: 'First Admin', email: 'first@example.com', password: firstPassword }),
    createInitialAdministrator({ fullName: 'Racing Admin', email: 'racing@example.com', password: 'racing-administrator-password' })
  ]);
  assert.equal(bootstrap.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(bootstrap.filter((result) => result.status === 'rejected')[0].reason.code, 'INITIAL_ADMIN_EXISTS');

  const initialAdmin = (await listAdministrators())[0];
  const storedInitialAdmin = await Admin.findById(initialAdmin._id).select('+passwordHash').lean();
  assert.notEqual(storedInitialAdmin.passwordHash, firstPassword);
  const initialPassword = initialAdmin.email === 'first@example.com' ? firstPassword : 'racing-administrator-password';
  assert.equal(await bcrypt.compare(initialPassword, storedInitialAdmin.passwordHash), true);
  assert.equal(Object.hasOwn(initialAdmin, 'passwordHash'), false);

  const anonymous = await request(app).get('/api/admin/administrators');
  assert.equal(anonymous.status, 401);

  const firstCookie = await login(initialAdmin.email, initialPassword);
  const deniedCreate = await request(app)
    .post('/api/admin/administrators')
    .set('Cookie', firstCookie)
    .send({ fullName: 'No Header', email: 'no-header@example.com', password: 'long-enough-admin-password' });
  assert.equal(deniedCreate.status, 403);

  const createSecond = () => request(app)
    .post('/api/admin/administrators')
    .set('Cookie', firstCookie)
    .set('X-Requested-With', 'MOTECH-ZONE-ADMIN')
    .send({ fullName: 'Second Admin', email: 'second@example.com', password: secondPassword, confirmPassword: secondPassword, active: true });
  const concurrentCreates = await Promise.all([createSecond(), request(app)
    .post('/api/admin/administrators')
    .set('Cookie', firstCookie)
    .set('X-Requested-With', 'MOTECH-ZONE-ADMIN')
    .send({ fullName: 'Third Admin', email: 'third@example.com', password: 'third-administrator-password', confirmPassword: 'third-administrator-password', active: true })]);
  assert.deepEqual(concurrentCreates.map((response) => response.status).sort(), [201, 409]);
  const administrators = await request(app).get('/api/admin/administrators').set('Cookie', firstCookie);
  assert.equal(administrators.status, 200);
  assert.equal(administrators.body.administrators.filter((item) => item.active).length, 2);
  const secondAdmin = administrators.body.administrators.find((item) => item.email === 'second@example.com');
  const thirdAdmin = administrators.body.administrators.find((item) => item.email === 'third@example.com');
  const createdAdmin = secondAdmin || thirdAdmin;
  assert.ok(createdAdmin);
  const createdPassword = createdAdmin.email === 'second@example.com' ? secondPassword : 'third-administrator-password';
  const secondCookie = await login(createdAdmin.email, createdPassword);
  const edited = await request(app)
    .patch(`/api/admin/administrators/${createdAdmin._id}`)
    .set('Cookie', firstCookie)
    .set('X-Requested-With', 'MOTECH-ZONE-ADMIN')
    .send({ fullName: 'Updated Administrator' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.administrator.fullName, 'Updated Administrator');

  const duplicate = await request(app)
    .post('/api/admin/administrators')
    .set('Cookie', firstCookie)
    .set('X-Requested-With', 'MOTECH-ZONE-ADMIN')
    .send({ fullName: 'Duplicate', email: createdAdmin.email.toUpperCase(), password: 'duplicate-administrator-password', confirmPassword: 'duplicate-administrator-password', active: false });
  assert.equal(duplicate.status, 409);

  const packageCreated = await request(app)
    .post('/api/admin/packages')
    .set('Cookie', firstCookie)
    .set('X-Requested-With', 'MOTECH-ZONE-ADMIN')
    .send({ name: 'Admin test package', slug: 'admin-test-package', priceKes: 15, durationSeconds: 7200, downloadMbps: 20, uploadMbps: 5 });
  assert.equal(packageCreated.status, 201);
  const packageUpdated = await request(app)
    .patch(`/api/admin/packages/${packageCreated.body.package._id}`)
    .set('Cookie', secondCookie)
    .set('X-Requested-With', 'MOTECH-ZONE-ADMIN')
    .send({ name: 'Updated by second admin' });
  assert.equal(packageUpdated.status, 200);
  const publicPackages = await request(app).get('/api/packages');
  assert.ok(publicPackages.body.packages.some((item) => item.name === 'Updated by second admin'));

  const tooManyActive = await request(app)
    .post('/api/admin/administrators')
    .set('Cookie', firstCookie)
    .set('X-Requested-With', 'MOTECH-ZONE-ADMIN')
    .send({ fullName: 'Over Limit', email: 'over-limit@example.com', password: 'over-limit-administrator-password', confirmPassword: 'over-limit-administrator-password', active: true });
  assert.equal(tooManyActive.status, 409);

  const reset = await request(app)
    .put(`/api/admin/administrators/${createdAdmin._id}/password`)
    .set('Cookie', firstCookie)
    .set('X-Requested-With', 'MOTECH-ZONE-ADMIN')
    .send({ password: 'new-reset-administrator-password', confirmPassword: 'new-reset-administrator-password' });
  assert.equal(reset.status, 200);
  const passwordResetSession = await request(app).get('/api/admin/administrators').set('Cookie', secondCookie);
  assert.equal(passwordResetSession.status, 401);
  const resetCookie = await login(createdAdmin.email, 'new-reset-administrator-password');
  assert.equal((await request(app).get('/api/admin/administrators').set('Cookie', resetCookie)).status, 200);

  const selfDeactivation = await request(app)
    .patch(`/api/admin/administrators/${initialAdmin._id}/status`)
    .set('Cookie', firstCookie)
    .set('X-Requested-With', 'MOTECH-ZONE-ADMIN')
    .send({ active: false });
  assert.equal(selfDeactivation.status, 409);

  const deactivate = await request(app)
    .patch(`/api/admin/administrators/${createdAdmin._id}/status`)
    .set('Cookie', firstCookie)
    .set('X-Requested-With', 'MOTECH-ZONE-ADMIN')
    .send({ active: false });
  assert.equal(deactivate.status, 200);
  await assert.rejects(() => setAdministratorStatus(initialAdmin._id, false), { code: 'LAST_ACTIVE_ADMIN' });
  assert.equal((await request(app).post('/api/admin/auth/login').send({ email: createdAdmin.email, password: 'new-reset-administrator-password' })).status, 401);

  const reactivate = await request(app)
    .patch(`/api/admin/administrators/${createdAdmin._id}/status`)
    .set('Cookie', firstCookie)
    .set('X-Requested-With', 'MOTECH-ZONE-ADMIN')
    .send({ active: true });
  assert.equal(reactivate.status, 200);
  assert.equal((await login(createdAdmin.email, 'new-reset-administrator-password')).length > 0, true);
});
