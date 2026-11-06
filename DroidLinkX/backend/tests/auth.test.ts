import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, registerOwner, resetDatabase } from './helpers.js';

describe('authentication', () => {
  beforeAll(async () => {
    await resetDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  it('registers an owner account and returns usable tokens', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email: 'Owner@DroidLinkX.test', password: 'Str0ngPassword123', displayName: 'Farhan' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('owner@droidlinkx.test');
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tokens.refreshToken).toBeTruthy();
    expect(res.body.tokens.tokenType).toBe('Bearer');

    const me = await api().get('/api/auth/me').set('authorization', `Bearer ${res.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.displayName).toBe('Farhan');
    expect(me.body.counts).toEqual({ devices: 0, online: 0 });
  });

  it('rejects duplicate accounts and weak passwords', async () => {
    await registerOwner('-dup');
    const email = `dup-${Date.now()}@droidlinkx.test`;
    const first = await api()
      .post('/api/auth/register')
      .send({ email, password: 'Str0ngPassword123', displayName: 'Owner' });
    expect(first.status).toBe(201);
    const duplicate = await api()
      .post('/api/auth/register')
      .send({ email: email.toUpperCase(), password: 'Str0ngPassword123', displayName: 'Owner' });
    expect(duplicate.status).toBe(409);

    const weak = await api()
      .post('/api/auth/register')
      .send({ email: 'weak@droidlinkx.test', password: 'short', displayName: 'Owner' });
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    const owner = await registerOwner('-login');
    const ok = await api().post('/api/auth/login').send({ email: owner.email, password: owner.password });
    expect(ok.status).toBe(200);
    expect(ok.body.tokens.accessToken).toBeTruthy();

    const bad = await api().post('/api/auth/login').send({ email: owner.email, password: 'WrongPassword123' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe('Invalid email or password');

    const unknown = await api().post('/api/auth/login').send({ email: 'nobody@droidlinkx.test', password: 'WrongPassword123' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
  });

  it('rotates refresh tokens and revokes the family on token reuse', async () => {
    const owner = await registerOwner('-refresh');
    const first = await api().post('/api/auth/refresh').send({ refreshToken: owner.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.tokens.refreshToken).not.toBe(owner.refreshToken);

    const reuse = await api().post('/api/auth/refresh').send({ refreshToken: owner.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.message).toContain('already been used');

    const afterReuse = await api().post('/api/auth/refresh').send({ refreshToken: first.body.tokens.refreshToken });
    expect(afterReuse.status).toBe(401);
  });

  it('invalidates the access token on logout and on password change', async () => {
    const owner = await registerOwner('-logout');
    const logout = await api()
      .post('/api/auth/logout')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ refreshToken: owner.refreshToken });
    expect(logout.status).toBe(204);

    const afterLogout = await api().get('/api/auth/me').set('authorization', `Bearer ${owner.accessToken}`);
    expect(afterLogout.status).toBe(401);

    const fresh = await api().post('/api/auth/login').send({ email: owner.email, password: owner.password });
    const changed = await api()
      .post('/api/auth/password')
      .set('authorization', `Bearer ${fresh.body.tokens.accessToken}`)
      .send({ currentPassword: owner.password, newPassword: 'N3wStrongPassword' });
    expect(changed.status).toBe(204);

    const oldRefresh = await api().post('/api/auth/refresh').send({ refreshToken: fresh.body.tokens.refreshToken });
    expect(oldRefresh.status).toBe(401);

    const oldPassword = await api().post('/api/auth/login').send({ email: owner.email, password: owner.password });
    expect(oldPassword.status).toBe(401);
    const newPassword = await api().post('/api/auth/login').send({ email: owner.email, password: 'N3wStrongPassword' });
    expect(newPassword.status).toBe(200);
  });

  it('rejects malformed and missing bearer tokens', async () => {
    const missing = await api().get('/api/auth/me');
    expect(missing.status).toBe(401);
    const malformed = await api().get('/api/auth/me').set('authorization', 'Bearer not.a.jwt');
    expect(malformed.status).toBe(401);
    const wrongScheme = await api().get('/api/auth/me').set('authorization', 'Basic abc');
    expect(wrongScheme.status).toBe(401);
  });
});
