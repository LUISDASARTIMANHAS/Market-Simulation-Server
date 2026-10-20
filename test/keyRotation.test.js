import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import marketRoutes from '../src/routes/marketRoutes.js';
import { marketSimulator } from '../src/services/marketSimulator.js';
import { marketStateStore } from '../src/services/stateStore.js';

describe('Testes de Regeneração de Chaves (Admin e Usuário)', () => {
  let server;
  let baseUrl;
  let adminApiKey;
  let adminAccount;
  let userApiKey;
  let userAccount;

  before(async () => {
    const state = await marketStateStore.load();
    marketSimulator.initialize(state);

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use('/api', marketRoutes);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        resolve();
      });
    });

    // Cria conta de administrador
    const adminCreated = await marketSimulator.createAccountWithRole({ username: `adm_${Date.now()}` }, true);
    adminApiKey = adminCreated.apiKey;
    adminAccount = adminCreated.account;

    // Cria conta de usuário comum
    const userCreated = await marketSimulator.createAccount({ username: `usr_${Date.now()}` });
    userApiKey = userCreated.apiKey;
    userAccount = userCreated.account;
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('Usuário comum regenera a própria chave via POST /api/account/rotate-key', async () => {
    const res = await fetch(`${baseUrl}/account/rotate-key`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.apiKey);
    assert.notEqual(body.data.apiKey, userApiKey);

    // Antiga chave é revogada
    const oldKeyRes = await fetch(`${baseUrl}/account`, {
      headers: { Authorization: `Bearer ${userApiKey}` },
    });
    assert.equal(oldKeyRes.status, 401);

    // Nova chave funciona
    const newKeyRes = await fetch(`${baseUrl}/account`, {
      headers: { Authorization: `Bearer ${body.data.apiKey}` },
    });
    assert.equal(newKeyRes.status, 200);

    userApiKey = body.data.apiKey;
  });

  test('Usuário comum NÃO pode regenerar a chave de outra conta via POST /api/account/rotate-key', async () => {
    const res = await fetch(`${baseUrl}/account/rotate-key`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountId: adminAccount.accountId }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.message, /Apenas administradores/);
  });

  test('Administrador regenera chave de um usuário via POST /api/account/rotate-key com body { accountId }', async () => {
    const res = await fetch(`${baseUrl}/account/rotate-key`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountId: userAccount.accountId }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.apiKey);
    assert.notEqual(body.data.apiKey, userApiKey);
    assert.equal(body.data.account.accountId, userAccount.accountId);

    // Chave antiga do usuário não funciona mais
    const oldRes = await fetch(`${baseUrl}/account`, {
      headers: { Authorization: `Bearer ${userApiKey}` },
    });
    assert.equal(oldRes.status, 401);

    // Nova chave do usuário funciona
    const newRes = await fetch(`${baseUrl}/account`, {
      headers: { Authorization: `Bearer ${body.data.apiKey}` },
    });
    assert.equal(newRes.status, 200);

    userApiKey = body.data.apiKey;
  });

  test('Administrador regenera chave de um usuário via POST /api/admin/accounts/:accountId/rotate-key', async () => {
    const res = await fetch(`${baseUrl}/admin/accounts/${userAccount.accountId}/rotate-key`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.apiKey);
    assert.notEqual(body.data.apiKey, userApiKey);
    assert.equal(body.data.account.accountId, userAccount.accountId);

    // Nova chave funciona
    const newRes = await fetch(`${baseUrl}/account`, {
      headers: { Authorization: `Bearer ${body.data.apiKey}` },
    });
    assert.equal(newRes.status, 200);

    userApiKey = body.data.apiKey;
  });

  test('Administrador regenera a própria chave via POST /api/account/rotate-key', async () => {
    const res = await fetch(`${baseUrl}/account/rotate-key`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountId: adminAccount.accountId }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.apiKey);
    assert.notEqual(body.data.apiKey, adminApiKey);
    assert.equal(body.data.account.accountId, adminAccount.accountId);

    // Chave antiga não funciona
    const oldRes = await fetch(`${baseUrl}/account`, {
      headers: { Authorization: `Bearer ${adminApiKey}` },
    });
    assert.equal(oldRes.status, 401);

    // Nova chave funciona como admin
    const newRes = await fetch(`${baseUrl}/admin/accounts`, {
      headers: { Authorization: `Bearer ${body.data.apiKey}` },
    });
    assert.equal(newRes.status, 200);

    adminApiKey = body.data.apiKey;
  });
});

