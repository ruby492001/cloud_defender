import {
    createSHA256,
    createSHA512,
    createSHA3,
    createBLAKE2b,
    createBLAKE2s,
} from 'hash-wasm';

/**
 * Нормализуем имя алгоритма.
 */
function normalizeAlg(name) {
    return String(name).replace(/[\s_-]+/g, '').toUpperCase();
}

/**
 * Универсальный потоковый хешер без буферизации входа.
 *
 * Пример:
 *   const h = new Hasher();
 *   await h.init('SHA3-256');
 *   h.update(chunk1);
 *   h.update(chunk2);
 *   const out = await h.finalize(); // Uint8Array
 */
export class Hasher {
    constructor() {
        /** @type {{ init:Function, update:Function, digest:Function } | null} */
        this.ctx = null;
    }

    /**
     * @param {'SHA-256'|'SHA-512'|'SHA3-256'|'SHA3-512'|'BLAKE2b512'|'BLAKE2s256'} algorithm
     */
    async init(algorithm) {
        const alg = normalizeAlg(algorithm);

        switch (alg) {
            case 'SHA256': {
                const h = await createSHA256(); // потоковый
                h.init();
                this.ctx = h;
                break;
            }
            case 'SHA512': {
                const h = await createSHA512(); // потоковый
                h.init();
                this.ctx = h;
                break;
            }
            case 'SHA3256': {
                const h = await createSHA3(256); // потоковый
                h.init();
                this.ctx = h;
                break;
            }
            case 'SHA3512': {
                const h = await createSHA3(512); // потоковый
                h.init();
                this.ctx = h;
                break;
            }
            case 'BLAKE2B512': {
                // 512 бит == 64 байта
                const h = await createBLAKE2b(512); // без ключа (простая хэш-функция)
                h.init();
                this.ctx = h;
                break;
            }
            case 'BLAKE2S256': {
                // 256 бит == 32 байта
                const h = await createBLAKE2s(256); // без ключа
                h.init();
                this.ctx = h;
                break;
            }
            default:
                throw new Error(`Алгоритм не поддержан: ${algorithm}`);
        }
    }

    /**
     * Добавляет следующую порцию данных (без буферизации).
     * @param {Uint8Array} chunk
     */
    update(chunk) {
        if (!this.ctx) throw new Error('Сначала вызовите init(algorithm).');
        if (!(chunk instanceof Uint8Array)) {
            throw new TypeError('update ожидает Uint8Array');
        }
        this.ctx.update(chunk);
    }

    /**
     * Завершает вычисление и возвращает хеш как Uint8Array.
     * Экземпляр после finalize использовать нельзя.
     * @returns {Promise<Uint8Array>}
     */
    async finalize() {
        if (!this.ctx) throw new Error('Сначала вызовите init(algorithm).');
        // digest('binary') -> Uint8Array (без hex/BASE64 строк — без доп. аллокаций)
        const out = this.ctx.digest('binary');
        this.ctx = null;
        return out;
    }
}
