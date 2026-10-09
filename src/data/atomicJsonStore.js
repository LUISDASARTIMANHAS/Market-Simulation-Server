import { mkdir, readFile, rename, copyFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Fila de gravação em memória por arquivo para serializar escritas concorrentes.
 * @type {Map<string, Promise<void>>}
 */
const fileWriteQueues = new Map();

/**
 * Espera um intervalo de tempo em milissegundos.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Renomeia um arquivo de forma resiliente contra travas temporárias no Windows (EPERM / EBUSY).
 * @param {string} source
 * @param {string} target
 * @param {number} maxRetries
 * @returns {Promise<void>}
 */
async function resilientRename(source, target, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if ((error.code === 'EPERM' || error.code === 'EBUSY') && attempt < maxRetries) {
        await delay(attempt * 25);
        continue;
      }
      if (attempt === maxRetries) {
        // Fallback para cópia e exclusão se rename falhar persistentemente no Windows
        try {
          await copyFile(source, target);
          await unlink(source).catch(() => {});
          return;
        } catch (copyError) {
          throw error;
        }
      }
      throw error;
    }
  }
}

/**
 * Lê um arquivo JSON do disco com parsing seguro.
 * @template T
 * @param {string} filePath
 * @param {T} fallbackValue
 * @returns {Promise<T>}
 */
export async function readJson(filePath, fallbackValue = null) {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) return fallbackValue;
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallbackValue;
    }
    logger.error('json_store.read_failed', { filePath, message: error.message });
    throw error;
  }
}

/**
 * Grava dados em formato JSON de forma atômica e serializada.
 * @param {string} filePath
 * @param {unknown} data
 * @param {((data: unknown) => boolean | void) | null} [validator]
 * @returns {Promise<void>}
 */
export function writeJson(filePath, data, validator = null) {
  if (validator && typeof validator === 'function') {
    const isValid = validator(data);
    if (isValid === false) {
      const error = new Error(`Validação falhou ao tentar persistir dados em ${filePath}`);
      logger.error('json_store.validation_failed', { filePath, message: error.message });
      return Promise.reject(error);
    }
  }

  const payload = JSON.stringify(data, null, 2);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;

  const previousWrite = fileWriteQueues.get(filePath) || Promise.resolve();

  const currentWrite = previousWrite
    .catch(() => {})
    .then(async () => {
      try {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(tempPath, payload, 'utf8');
        await resilientRename(tempPath, filePath);
        logger.info('json_store.saved', { filePath });
      } catch (error) {
        await unlink(tempPath).catch(() => {});
        logger.error('json_store.save_failed', { filePath, message: error.message });
        throw error;
      }
    });

  fileWriteQueues.set(filePath, currentWrite);
  return currentWrite;
}
