import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import express from 'express';
import { apiErrorHandler, createApiResponseMiddleware } from '../src/middleware/apiResponse.js';
import { rejectOversizedJsonRequest } from '../src/middleware/requestSizeLimit.js';
import { MAX_HTTP_TRANSFER_BYTES } from '../src/utils/httpLimits.js';

async function startTestServer(handler) {
  const app = express();
  app.use('/api', createApiResponseMiddleware());
  app.use('/api', rejectOversizedJsonRequest);
  app.use(express.json({ limit: MAX_HTTP_TRANSFER_BYTES }));
  app.use('/api', handler);
  app.use('/api', apiErrorHandler);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/api`,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function makeRequest(baseUrl, pathname, { method = 'GET', headers = {} } = {}) {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('requisições JSON acima de 10 MB são rejeitadas antes da leitura do corpo', () => {
  let forwardedError;
  rejectOversizedJsonRequest(
    {
      is: (contentType) => contentType === 'application/json',
      get: () => String(MAX_HTTP_TRANSFER_BYTES + 1),
    },
    {},
    (error) => { forwardedError = error; },
  );

  assert.equal(forwardedError.status, 413);
  assert.equal(forwardedError.type, 'entity.too.large');
});

test('respostas JSON acima de 10 MB são rejeitadas com 413', async () => {
  const router = express.Router();
  router.get('/download', (req, res) => res.json({ payload: 'x'.repeat(MAX_HTTP_TRANSFER_BYTES) }));
  const server = await startTestServer(router);

  try {
    const response = await makeRequest(server.baseUrl, '/download', { headers: { Connection: 'close' } });
    assert.equal(response.status, 413);
    assert.equal(response.headers['content-disposition'], undefined);
    assert.match(response.body.message, /limite máximo de 10 MB/i);
  } finally {
    await server.close();
  }
});
