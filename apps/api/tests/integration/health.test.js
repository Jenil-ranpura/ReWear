/**
 * P1-T1/P1-T4 tests — no database needed: we drive
 * mongoose.connection.readyState directly and check the health mapping plus
 * the global error shape (implementation.md §10/§20).
 * Real mongodb-memory-server integration tests arrive in Phase 3.
 */

import mongoose from 'mongoose';
import request from 'supertest';

import app from '../../src/app.js';

describe('GET /health', () => {
  it('returns 200 { status: ok, db: connected } when mongoose is connected', async () => {
    mongoose.connection.readyState = 1;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'connected' });
  });

  it('returns 503 { status: degraded } when the DB is disconnected', async () => {
    mongoose.connection.readyState = 0;
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', db: 'disconnected' });
  });
});

describe('error shape (§10)', () => {
  it('404 responses use the { error: { code, message } } shape', async () => {
    const res = await request(app).get('/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
  });
});
