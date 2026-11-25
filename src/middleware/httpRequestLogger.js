import { logger } from '../utils/logger.js';

function getContentLength(value) {
  if (value === null || value === undefined || value === '') return null;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

export function createHttpRequestLogger() {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const logRequest = (event, level = 'info') => {
      const durationMs = Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2));
      const details = {
        method: req.method,
        path: req.path,
        ip: req.ip,
        requestBytes: getContentLength(req.get('content-length')),
        requestContentType: req.get('content-type') || null,
        responseBytes: getContentLength(res.getHeader('content-length')),
        responseContentType: res.getHeader('content-type') || null,
        statusCode: res.statusCode,
        durationMs,
      };
      if (res.statusCode >= 400) {
        logger.error('http.request_failed', details);
        return;
      }
      logger[level](event, details);
    };

    res.once('finish', () => logRequest('http.request'));
    res.once('close', () => {
      if (!res.writableFinished) logRequest('http.request_aborted', 'error');
    });
    next();
  };
}
