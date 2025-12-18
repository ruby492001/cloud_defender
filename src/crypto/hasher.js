import {
    createSHA256,
    createSHA512,
    createSHA3,
    createBLAKE2b,
    createBLAKE2s,
} from 'hash-wasm';

function normalizeAlg(name) {
    return String(name).replace(/[\s_-]+/g, '').toUpperCase();
}

export class Hasher {
    constructor() {
        this.ctx = null;
    }

    async init(algorithm) {
        const alg = normalizeAlg(algorithm);

        switch (alg) {
            case 'SHA256': {
                const h = await createSHA256();
                h.init();
                this.ctx = h;
                break;
            }
            case 'SHA512': {
                const h = await createSHA512();
                h.init();
                this.ctx = h;
                break;
            }
            case 'SHA3256': {
                const h = await createSHA3(256);
                h.init();
                this.ctx = h;
                break;
            }
            case 'SHA3512': {
                const h = await createSHA3(512);
                h.init();
                this.ctx = h;
                break;
            }
            case 'BLAKE2B512': {
                const h = await createBLAKE2b(512);
                h.init();
                this.ctx = h;
                break;
            }
            case 'BLAKE2S256': {
                const h = await createBLAKE2s(256);
                h.init();
                this.ctx = h;
                break;
            }
            default:
                throw new Error(`Алгоритм не поддержан: ${algorithm}`);
        }
    }

    update(chunk) {
        if (!this.ctx) throw new Error('Сначала вызовите init(algorithm).');
        if (!(chunk instanceof Uint8Array)) {
            throw new TypeError('update ожидает Uint8Array');
        }
        this.ctx.update(chunk);
    }

    async finalize() {
        if (!this.ctx) throw new Error('Сначала вызовите init(algorithm).');
        const out = this.ctx.digest('binary');
        this.ctx = null;
        return out;
    }
}
