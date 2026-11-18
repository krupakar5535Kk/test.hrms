import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import http from 'node:http';

test('GET /api/v1/health returns 200 OK with valid health status payload', async () => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert(address && typeof address === 'object', 'Server must have an address object');
  const port = address.port;

  try {
    const response = await fetch(`http://localhost:${port}/api/v1/health`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'ok');
    assert.equal(body.data.service, 'hrms-api');
    assert.equal(typeof body.data.uptimeSeconds, 'number');
    assert.equal(typeof body.data.timestamp, 'string');
    assert(body.data.memory.rssMb > 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('POST /api/v1/auth/login rejects legacy DEMO scaffold in all environments', async () => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const port = address.port;

  try {
    const response = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationCode: 'DEMO',
        phoneNumber: '9876543210',
        password: 'Password123!',
      }),
    });

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'INVALID_CREDENTIALS');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('POST /api/v1/auth/login blocks hardcoded DEMO scaffold when NODE_ENV=production', async () => {
  const previousNodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const port = address.port;

  try {
    const response = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationCode: 'DEMO',
        phoneNumber: '9876543210',
        password: 'Password123!',
      }),
    });

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'INVALID_CREDENTIALS');
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = previousNodeEnv;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('POST /api/v1/auth/login rejects invalid credentials with uniform 401 INVALID_CREDENTIALS', async () => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const port = address.port;

  try {
    const response = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationCode: 'NONEXISTENT',
        phoneNumber: '9876543210',
        password: 'Password123!',
      }),
    });

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'INVALID_CREDENTIALS');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('POST /api/v1/auth/login rejects missing or malformed fields with 400 VALIDATION_ERROR', async () => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const port = address.port;

  try {
    const response = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationCode: 'bad code with spaces',
        phoneNumber: '123',
        password: 'short',
      }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert(Array.isArray(body.error.details));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('GET non-existent endpoint returns 404 NOT_FOUND ApiErrorResponse', async () => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const port = address.port;

  try {
    const response = await fetch(`http://localhost:${port}/api/v1/undefined-endpoint-test`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'NOT_FOUND');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
