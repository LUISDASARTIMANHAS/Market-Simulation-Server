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

function formatConsoleEntry(entry) {
  const fields = Object.entries(entry)
    .filter(([key]) => key !== 'level' && key !== 'event');
  const keyWidth = Math.max(...fields.map(([key]) => key.length));
  const rows = fields.map(([key, value]) => {
    const formattedValue = typeof value === 'string'
      ? value.replace(/[\r\n]/g, '\\n')
      : JSON.stringify(value);
    return `${key.padEnd(keyWidth)} | ${formattedValue}`;
  });
  return `${[`[${entry.level}] ${entry.event}`, ...rows].join('\n')}\n`;
}

function writeLog(level, event, details = {}, options = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  };
  const output = JSON.stringify(entry);

  if (level === 'ERROR' || options.terminal === true) {
    const writeToConsole = level === 'ERROR'
      ? console.error
      : level === 'WARN'
        ? console.warn
        : console.log;
    writeToConsole(formatConsoleEntry(entry));
  }

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
  info: (event, details, options) => writeLog('INFO', event, details, options),
  warn: (event, details, options) => writeLog('WARN', event, details, options),
  error: (event, details, options) => writeLog('ERROR', event, details, options),
};