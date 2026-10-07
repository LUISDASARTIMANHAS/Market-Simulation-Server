import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/market-state.json'
);
const LEGACY_STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/market-state.json'
);

/**
 * Persiste o estado do mercado em JSON usando substituição atômica.
 */
export class JsonStateStore {
  constructor(filePath = process.env.MARKET_STATE_FILE || DEFAULT_STATE_FILE) {
    this.filePath = filePath;
    this.legacyFilePath = process.env.MARKET_STATE_FILE ? null : LEGACY_STATE_FILE;
    this.state = {};
    this.writeQueue = Promise.resolve();
  }

  /**
   * Carrega o estado persistido do mercado.
   * @returns {Promise<Record<string, unknown>>}
   */
  async load() {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const state = JSON.parse(contents);
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new Error('O estado do mercado precisa ser um objeto JSON.');
      }
      this.state = state;
      return { ...state };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    if (!this.legacyFilePath || this.filePath !== DEFAULT_STATE_FILE) {
      this.state = {};
      return {};
    }

    try {
      const contents = await readFile(this.legacyFilePath, 'utf8');
      const state = JSON.parse(contents);
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new Error('O estado antigo do mercado precisa ser um objeto JSON.');
      }
      this.state = state;
      await this.save({});
      console.log('[SERVIDOR DE MERCADO] Histórico antigo migrado para market-server/data.');
      return { ...state };
    } catch (legacyError) {
      if (legacyError.code === 'ENOENT') {
        this.state = {};
        return {};
      }
      throw legacyError;
    }
  }

  /**
   * Grava uma cópia consistente do estado em disco.
   * @param {Record<string, unknown>} updates
   * @returns {Promise<void>}
   */
  save(updates) {
    this.state = { ...this.state, ...updates };
    const snapshot = JSON.stringify(this.state, null, 2);
    const temporaryFile = `${this.filePath}.${process.pid}.tmp`;

    const write = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(temporaryFile, snapshot, 'utf8');
      await rename(temporaryFile, this.filePath);
    });

    this.writeQueue = write;
    return write;
  }
}

export const marketStateStore = new JsonStateStore();
