import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('requisições HTTP com erro aparecem no terminal e no arquivo', async () => {
  const logDirectory = await mkdtemp(path.join(tmpdir(), 'market-http-logger-'));
  const previousLogDirectory = process.env.MARKET_LOG_DIRECTORY;
  process.env.MARKET_LOG_DIRECTORY = logDirectory;
  const terminalErrors = [];
  const originalConsoleError = console.error;
  console.error = (message) => terminalErrors.push(message);

  try {
    const { createHttpRequestLogger } = await import('../src/middleware/httpRequestLogger.js');
    const middleware = createHttpRequestLogger();
    const req = {
      method: 'PUT',
      path: '/api/sync/snapshot',
      ip: '192.0.2.10',
      get: (name) => name === 'content-type' ? 'application/json' : '123',
    };
    const res = new EventEmitter();
    res.statusCode = 413;
    res.writableFinished = true;
    res.getHeader = (name) => name === 'content-length' ? '123' : 'application/json';
    middleware(req, res, () => {});
    res.emit('finish');

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
    assert.match(terminalErrors[0], /path\s+\|\s+\/api\/sync\/snapshot/);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].event, 'http.request_failed');
    assert.equal(entries[0].path, '/api/sync/snapshot');
    assert.equal(entries[0].ip, '192.0.2.10');
    assert.equal(entries[0].statusCode, 413);
  } finally {
    console.error = originalConsoleError;
    if (previousLogDirectory === undefined) delete process.env.MARKET_LOG_DIRECTORY;
    else process.env.MARKET_LOG_DIRECTORY = previousLogDirectory;
    await rm(logDirectory, { recursive: true, force: true });
  }
});
