import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('todos os erros e todas as requisições sync aparecem no terminal e no arquivo', async () => {
  const logDirectory = await mkdtemp(path.join(tmpdir(), 'market-http-logger-'));
  const previousLogDirectory = process.env.MARKET_LOG_DIRECTORY;
  process.env.MARKET_LOG_DIRECTORY = logDirectory;
  const terminalErrors = [];
  const terminalInfo = [];
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  console.error = (message) => terminalErrors.push(message);
  console.log = (message) => terminalInfo.push(message);

  try {
    const { createHttpRequestLogger } = await import('../src/middleware/httpRequestLogger.js');
    const middleware = createHttpRequestLogger();
    const req = {
      method: 'PUT',
      path: '/api/accounts',
      ip: '192.0.2.10',
      get: (name) => name === 'content-type' ? 'application/json' : '123',
    };
    const res = new EventEmitter();
    res.statusCode = 413;
    res.writableFinished = true;
    res.getHeader = (name) => name === 'content-length' ? '123' : 'application/json';
    middleware(req, res, () => {});
    res.emit('finish');

    const syncReq = {
      ...req,
      method: 'GET',
      path: '/api/sync/status',
    };
    const syncRes = new EventEmitter();
    syncRes.statusCode = 200;
    syncRes.writableFinished = true;
    syncRes.getHeader = (name) => name === 'content-length' ? '42' : 'application/json';
    middleware(syncReq, syncRes, () => {});
    syncRes.emit('finish');

    const marketReq = {
      ...req,
      method: 'GET',
      path: '/api/market/status',
    };
    const marketRes = new EventEmitter();
    marketRes.statusCode = 200;
    marketRes.writableFinished = true;
    marketRes.getHeader = (name) => name === 'content-length' ? '42' : 'application/json';
    middleware(marketReq, marketRes, () => {});
    marketRes.emit('finish');

    await new Promise((resolve) => setTimeout(resolve, 100));
    const logFiles = await readdir(logDirectory);
    const entries = (await readFile(path.join(logDirectory, logFiles[0]), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    assert.equal(terminalErrors.length, 1);
    assert.match(terminalErrors[0], /^\[ERROR\] http\.request_failed/);
    assert.ok(terminalErrors[0].endsWith('\n'));
    assert.match(terminalErrors[0], /method\s+\|\s+PUT/);
    assert.match(terminalErrors[0], /path\s+\|\s+\/api\/accounts/);
    assert.equal(terminalInfo.length, 1);
    assert.match(terminalInfo[0], /^\[INFO\] http\.request/);
    assert.match(terminalInfo[0], /path\s+\|\s+\/api\/sync\/status/);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].event, 'http.request_failed');
    assert.equal(entries[0].path, '/api/accounts');
    assert.equal(entries[0].ip, '192.0.2.10');
    assert.equal(entries[0].statusCode, 413);
    assert.equal(entries[1].event, 'http.request');
    assert.equal(entries[1].path, '/api/sync/status');
    assert.equal(entries[1].statusCode, 200);
    assert.equal(entries[2].event, 'http.request');
    assert.equal(entries[2].path, '/api/market/status');
    assert.equal(entries[2].statusCode, 200);
  } finally {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    if (previousLogDirectory === undefined) delete process.env.MARKET_LOG_DIRECTORY;
    else process.env.MARKET_LOG_DIRECTORY = previousLogDirectory;
    await rm(logDirectory, { recursive: true, force: true });
  }
});
