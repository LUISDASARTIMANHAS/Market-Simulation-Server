import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_LOG_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/logs',
);
const LOG_DIRECTORY = path.resolve(
  process.env.MARKET_LOG_DIRECTORY || DEFAULT_LOG_DIRECTORY,
);

let writeQueue = Promise.resolve();
let writeFailureReported = false;

function writeLog(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  };
  const output = JSON.stringify(entry);

  writeQueue = writeQueue.then(async () => {
    const logFile = path.join(
      LOG_DIRECTORY,
      `market-${entry.timestamp.slice(0, 10)}.log`,
    );
    await mkdir(LOG_DIRECTORY, { recursive: true });
    await appendFile(logFile, `${output}\n`, 'utf8');
  }).catch((error) => {
    if (writeFailureReported) return;
    writeFailureReported = true;
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      event: 'logger.write_failed',
      message: error.message,
    }));
  });
}

export const logger = {
  info: (event, details) => writeLog('INFO', event, details),
  warn: (event, details) => writeLog('WARN', event, details),
  error: (event, details) => writeLog('ERROR', event, details),
};