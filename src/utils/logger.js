function writeLog(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  };
  const output = JSON.stringify(entry);

  if (level === 'ERROR') {
    console.error(output);
  } else if (level === 'WARN') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  info: (event, details) => writeLog('INFO', event, details),
  warn: (event, details) => writeLog('WARN', event, details),
  error: (event, details) => writeLog('ERROR', event, details),
};