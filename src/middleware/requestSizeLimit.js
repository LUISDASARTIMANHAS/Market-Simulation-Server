import { MAX_HTTP_TRANSFER_BYTES } from '../utils/httpLimits.js';

export function rejectOversizedJsonRequest(req, res, next) {
  const contentLength = Number(req.get('content-length'));
  if (
    req.is('application/json') &&
    Number.isSafeInteger(contentLength) &&
    contentLength > MAX_HTTP_TRANSFER_BYTES
  ) {
    const error = new Error('O corpo da requisição excede o limite máximo de 10 MB.');
    error.status = 413;
    error.type = 'entity.too.large';
    return next(error);
  }
  return next();
}
