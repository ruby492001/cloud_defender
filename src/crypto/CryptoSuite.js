// src/crypto/CryptoSuite.js
// Utility to work with multiple crypto suites (cfb/ctr/cbc/...) via OpenSSL-WASM built with Emscripten.

// -----------------------------
// (РЅРµРѕР±СЏР·Р°С‚РµР»СЊРЅРѕ) enum РґР»СЏ CFB
// -----------------------------
export const ALG = {
    AES_128_CFB128: 1,
    AES_256_CFB128: 2,
    CAMELLIA_128_CFB128: 3,
    CAMELLIA_256_CFB128: 4,
    ARIA_128_CFB128: 5,
    ARIA_256_CFB128: 6,
};

// -----------------------------
// HMR-СѓСЃС‚РѕР№С‡РёРІС‹Р№ РіР»РѕР±Р°Р»СЊРЅС‹Р№ СЂРµРµСЃС‚СЂ
// -----------------------------
const REGKEY = '__wasm_crypto_suites__';
const registry =
    (globalThis[REGKEY] ||= new Map());
// registry: suite -> {
//   createModule, locateFile,
//   rec: { promise, Module, api, listeners:Set<function> }
// }

// Р‘РµР·РѕРїР°СЃРЅС‹Р№ РґРѕСЃС‚СѓРї Рє heap (СЂР°Р±РѕС‚Р°РµС‚ Рё Р±РµР· Module.HEAPU8)
function getHeapU8(M) {
    // 1) РєР»Р°СЃСЃРёС‡РµСЃРєРёР№ СЂР°РЅС‚Р°Р№Рј вЂ” РїСЂРѕСЃС‚Рѕ РёСЃРїРѕР»СЊР·СѓРµРј
    if (M.HEAPU8) return M.HEAPU8;

    // 2) РїС‹С‚Р°РµРјСЃСЏ РЅР°Р№С‚Рё Р±СѓС„РµСЂ РїР°РјСЏС‚Рё РІ СЂР°Р·РЅС‹С… РјРµСЃС‚Р°С…
    const buf =
        (M.wasmMemory && M.wasmMemory.buffer) ||           // РјРёРЅРёРјР°Р»СЊРЅС‹Р№ СЂР°РЅС‚Р°Р№Рј
        (M.asm && M.asm.memory && M.asm.memory.buffer) ||  // РєР»Р°СЃСЃРёС‡РµСЃРєРёР№ СЂР°РЅС‚Р°Р№Рј (С‡Р°СЃС‚Рѕ С‚СѓС‚)
        (M.memory && M.memory.buffer) ||                   // РЅРµРєРѕС‚РѕСЂС‹Рµ СЃР±РѕСЂРєРё
        null;

    if (!buf) {
        throw new Error('WASM memory is not ready (no memory buffer on Module)');
    }

    // 3) РєСЌС€РёСЂСѓРµРј view Рё РїРµСЂРµСЃРѕР·РґР°С‘Рј РїСЂРё СЂРѕСЃС‚Рµ РїР°РјСЏС‚Рё
    if (!M.__heapU8 || M.__heapU8.buffer !== buf) {
        M.__heapU8 = new Uint8Array(buf);
    }
    return M.__heapU8;
}

// РЎРѕР±РёСЂР°РµРј JS-API РЅР°Рґ C-С€РёРјРѕРј РїРѕ РїСЂРµС„РёРєСЃСѓ
function buildApi(Module, suite) {
    const p = (name) => `${suite}_${name}`;
    const api = {
        initGlobal: Module.cwrap(p('global_init'), 'number', []),
        cleanup:    Module.cwrap(p('global_cleanup'), null, []),
        ivLength:   Module.cwrap(p('iv_length'), 'number', ['number']),
        blockSize:  Module.cwrap(p('block_size'), 'number', ['number']),
        initCtx:    Module.cwrap(p('init'),     'number', ['number','number','number','number','number','number']),
        update:     Module.cwrap(p('update'),   'number', ['number','number','number','number']),
        finalize:   Module.cwrap(p('finalize'), 'number', ['number','number']),
        freeCtx:    Module.cwrap(p('free'),     null,     ['number']),
    };
    return api;
}

// РЎРёРЅС…СЂРѕРЅРЅС‹Р№ "РґСЂР°Р№РІРµСЂ" РїРѕРІРµСЂС… РєРѕРЅРєСЂРµС‚РЅРѕРіРѕ СЃСѓРёС‚Р°
function makeSuiteDriver(suite) {
    return {
        ivLength(alg) {
            return CryptoSuite._getApi(suite).ivLength(alg);
        },
        blockSize(alg) {
            return CryptoSuite._getApi(suite).blockSize(alg);
        },
        createContext(alg, keyU8, ivU8, encrypt = true) {
            const api = CryptoSuite._getApi(suite);
            const M   = CryptoSuite._getModule(suite);
            const heap = getHeapU8(M);

            if (!(keyU8 instanceof Uint8Array) || !(ivU8 instanceof Uint8Array)) {
                throw new TypeError('key/iv must be Uint8Array');
            }
            const needIv = api.ivLength(alg);
            if (needIv > 0 && ivU8.length !== needIv) {
                throw new Error(`[${suite}] IV ${ivU8.length}B в‰  ${needIv}B`);
            }

            const kptr = M._malloc(keyU8.length || 1);
            const iptr = M._malloc(ivU8.length  || 1);
            heap.set(keyU8, kptr);
            heap.set(ivU8,  iptr);

            const ctx = api.initCtx(alg, encrypt ? 1 : 0, kptr, keyU8.length, iptr, ivU8.length);
            M._free(kptr); M._free(iptr);
            if (!ctx) throw new Error(`[${suite}] initCtx failed`);

            return {
                update(chunkU8) {
                    if (!(chunkU8 instanceof Uint8Array)) throw new TypeError('chunk must be Uint8Array');
                    const inlen = chunkU8.length || 1;
                    const inptr = M._malloc(inlen);
                    heap.set(chunkU8, inptr);

                    // РІ РїРѕС‚РѕРєРѕРІС‹С… СЂРµР¶РёРјР°С…, РєР°Рє РїСЂР°РІРёР»Рѕ, outlen == inlen, РЅРѕ РґР°РґРёРј РЅРµР±РѕР»СЊС€РѕР№ Р·Р°РїР°СЃ
                    const outptr = M._malloc(inlen + 32);
                    const wrote  = api.update(ctx, inptr, inlen, outptr);
                    M._free(inptr);
                    if (wrote < 0) { M._free(outptr); throw new Error(`[${suite}] update failed`); }
                    const out = heap.slice(outptr, outptr + wrote);
                    M._free(outptr);
                    return out;
                },
                finalize() {
                    const outptr = M._malloc(64);
                    const wrote  = api.finalize(ctx, outptr);
                    const out = wrote > 0 ? heap.slice(outptr, outptr + wrote) : new Uint8Array(0);
                    M._free(outptr);
                    return out;
                },
                free() { api.freeCtx(ctx); },
            };
        },
        encrypt(alg, key, iv, data) {
            const c = this.createContext(alg, key, iv, true);
            try { const a=c.update(data); const b=c.finalize(); return CryptoSuite._concat(a,b); }
            finally { c.free(); }
        },
        decrypt(alg, key, iv, data) {
            const c = this.createContext(alg, key, iv, false);
            try { const a=c.update(data); const b=c.finalize(); return CryptoSuite._concat(a,b); }
            finally { c.free(); }
        },
    };
}

export class CryptoSuite {
    // ---- РїСѓР±Р»РёС‡РЅС‹Р№ API ----

    /**
     * Р РµРіРёСЃС‚СЂРёСЂСѓРµС‚ СЃСѓРёС‚.
     * @param {string} suite         РёРјСЏ (e.g. 'cfb', 'ctr', 'cbc')
     * @param {function} createModule РґРµС„РѕР»С‚РЅС‹Р№ СЌРєСЃРїРѕСЂС‚ РёР· <suite>_wasm.js
     * @param {function} locateFile   (p:string)=>string вЂ” РїСѓС‚СЊ Рє .wasm
     */
    static registerSuite(suite, createModule, locateFile) {
        if (registry.has(suite)) return;
        registry.set(suite, {
            createModule,
            locateFile,
            rec: { promise: null, Module: null, api: null, listeners: new Set() },
        });
    }

    /**
     * Р”РѕР¶РґР°С‚СЊСЃСЏ РёРЅРёС†РёР°Р»РёР·Р°С†РёРё: Р»РёР±Рѕ РєРѕРЅРєСЂРµС‚РЅРѕРіРѕ СЃСѓРёС‚Р°,
     * Р»РёР±Рѕ РІСЃРµС… Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРЅС‹С… (РµСЃР»Рё suite РЅРµ СѓРєР°Р·Р°РЅ).
     */
    static async ready(suite) {
        if (suite) {
            await CryptoSuite._ensureReady(suite);
            return;
        }
        // РІСЃРµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРЅС‹Рµ
        const keys = [...registry.keys()];
        for (const k of keys) await CryptoSuite._ensureReady(k);
    }

    /** РџРѕР»СѓС‡РёС‚СЊ СЃРёРЅС…СЂРѕРЅРЅС‹Р№ РґСЂР°Р№РІРµСЂ РєРѕРЅРєСЂРµС‚РЅРѕРіРѕ СЃСѓРёС‚Р° */
    static getSuite(suite) {
        // РїСЂРѕРІРµСЂРєР° РЅР°Р»РёС‡РёСЏ API (Р±СЂРѕСЃРёС‚, РµСЃР»Рё РЅРµ РіРѕС‚РѕРІ)
        CryptoSuite._getApi(suite);
        // РєРµС€РёСЂРѕРІР°С‚СЊ РЅРµ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ вЂ” РґСЂР°Р№РІРµСЂ Р±РµР· СЃРѕСЃС‚РѕСЏРЅРёСЏ
        return makeSuiteDriver(suite);
    }

    /** РЈРґРѕР±РЅС‹Р№ Р°Р»РёР°СЃ РґР»СЏ СЃС‚Р°СЂРѕРіРѕ РєРѕРґР°: CryptoSuite.cfb() */
    static cfb() { return CryptoSuite.getSuite('cfb'); }

    /** РҐСѓРєРё РґР»СЏ РЅРµ-async РєРѕРґР° */
    static isReady(suite) {
        const slot = registry.get(suite);
        return !!(slot && slot.rec.api);
    }
    static onReady(suite, cb) {
        const slot = registry.get(suite);
        if (!slot) throw new Error(`Suite "${suite}" is not registered`);
        if (slot.rec.api) { cb(); return; }
        slot.rec.listeners.add(cb);
    }

    /** РћС‚Р»Р°РґРєР° */
    static debugGetModule(suite) {
        return registry.get(suite)?.rec?.Module ?? null;
    }
    static debugGetApi(suite) {
        return registry.get(suite)?.rec?.api ?? null;
    }

    // ---- РїСЂРёРІР°С‚РЅС‹Рµ/РІСЃРїРѕРјРѕРіР°С‚РµР»СЊРЅС‹Рµ ----

    static async _ensureReady(suite) {
        const slot = registry.get(suite);
        if (!slot) throw new Error(`Suite "${suite}" is not registered`);
        const rec = slot.rec;
        if (rec.api) return;

        if (!rec.promise) {
            rec.promise = (async () => {
                const Module = await slot.createModule({ locateFile: slot.locateFile });

                if (!Module || typeof Module !== 'object') {
                    throw new Error(`[${suite}] createModule returned invalid instance`);
                }
                if (typeof Module._malloc !== 'function' || typeof Module._free !== 'function') {
                    throw new Error(`[${suite}] _malloc/_free are not exported (check EXPORTED_FUNCTIONS)`);
                }

                const api = buildApi(Module, suite);

                if (api.initGlobal && api.initGlobal() !== 1) {
                    throw new Error(`[${suite}] OpenSSL providers init failed`);
                }

                rec.Module = Module;
                rec.api = api;

                // РЅРѕС‚РёС„РёС†РёСЂСѓРµРј РїРѕРґРїРёСЃС‡РёРєРѕРІ (РЅРµ-async РєРѕРґ)
                for (const cb of rec.listeners) { try { cb(); } catch {} }
                rec.listeners.clear();
            })();
        }
        return rec.promise;
    }

    static _getApi(suite) {
        const slot = registry.get(suite);
        if (!slot || !slot.rec.api) {
            throw new Error(`Suite "${suite}" is not initialized yet. Call await CryptoSuite.ready("${suite}") first.`);
        }
        return slot.rec.api;
    }

    static _getModule(suite) {
        const slot = registry.get(suite);
        if (!slot || !slot.rec.Module) {
            throw new Error(`Suite "${suite}" is not initialized yet. Call await CryptoSuite.ready("${suite}") first.`);
        }
        return slot.rec.Module;
    }

    static _concat(a, b) {
        if (!b || b.length === 0) return a;
        const r = new Uint8Array(a.length + b.length);
        r.set(a, 0); r.set(b, a.length);
        return r;
    }
}

