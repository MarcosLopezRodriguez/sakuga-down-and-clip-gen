"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitedHttpClient = void 0;
const axios_1 = __importDefault(require("axios"));
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
class RateLimitedHttpClient {
    constructor(options = {}) {
        var _a;
        this.queue = Promise.resolve();
        this.lastRequestTimestamp = 0;
        this.refreshPromise = null;
        const { baseURL, headers = {}, minDelayMs = 1200, randomJitterMs = 350, maxRetries = 4, backoffFactor = 1.8, maxBackoffMs = 20000, requestTimeoutMs = 15000, usePlaywright = process.env.SAKUGA_USE_PLAYWRIGHT === 'true', cookieRefreshUrl, playwrightWaitMs = 4500, playwrightNavigationTimeoutMs = 30000, logger = (message) => console.log(`[HttpClient] ${message}`) } = options;
        this.options = {
            baseURL,
            headers,
            minDelayMs,
            randomJitterMs,
            maxRetries,
            backoffFactor,
            maxBackoffMs,
            requestTimeoutMs,
            usePlaywright,
            cookieRefreshUrl: (_a = cookieRefreshUrl !== null && cookieRefreshUrl !== void 0 ? cookieRefreshUrl : baseURL) !== null && _a !== void 0 ? _a : 'https://www.sakugabooru.com/',
            playwrightWaitMs,
            playwrightNavigationTimeoutMs,
            logger
        };
        this.log = logger;
        const defaultHeaders = Object.assign({ Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', Connection: 'keep-alive', 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, headers);
        this.axiosInstance = axios_1.default.create({
            baseURL,
            timeout: requestTimeoutMs,
            headers: defaultHeaders
        });
    }
    primeSession() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.options.usePlaywright) {
                return;
            }
            try {
                yield this.ensureCookies(false);
            }
            catch (error) {
                this.log(`Unable to prime HTTP session: ${this.stringifyError(error)}`);
            }
        });
    }
    request(config) {
        return __awaiter(this, void 0, void 0, function* () {
            const run = () => __awaiter(this, void 0, void 0, function* () { return this.executeWithBackoff(config); });
            const pending = this.queue.then(run, run);
            this.queue = pending.then(() => undefined, () => undefined);
            return pending;
        });
    }
    executeWithBackoff(config) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            let attempt = 0;
            let delayMs = this.options.minDelayMs;
            while (true) {
                yield this.applyRateLimit();
                try {
                    const effectiveConfig = Object.assign({}, config);
                    if (this.cookieHeader && !((_a = effectiveConfig.headers) === null || _a === void 0 ? void 0 : _a.Cookie)) {
                        effectiveConfig.headers = Object.assign(Object.assign({}, effectiveConfig.headers), { Cookie: this.cookieHeader });
                    }
                    return yield this.axiosInstance.request(effectiveConfig);
                }
                catch (error) {
                    const status = (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.status;
                    if (!this.shouldRetry(status, attempt)) {
                        throw error;
                    }
                    if ((status === 403 || status === 429) && this.options.usePlaywright) {
                        this.log(`Received status ${status}. Attempting to refresh session cookies via Playwright.`);
                        try {
                            yield this.ensureCookies(true);
                        }
                        catch (refreshError) {
                            this.log(`Failed to refresh cookies: ${this.stringifyError(refreshError)}`);
                        }
                    }
                    const jitter = this.options.randomJitterMs > 0
                        ? Math.floor(Math.random() * this.options.randomJitterMs)
                        : 0;
                    const backoffDelay = Math.min(delayMs, this.options.maxBackoffMs) + jitter;
                    this.log(`Retrying request (attempt ${attempt + 1}/${this.options.maxRetries}) after ${backoffDelay}ms delay.`);
                    yield sleep(backoffDelay);
                    delayMs = Math.min(delayMs * this.options.backoffFactor, this.options.maxBackoffMs);
                    attempt += 1;
                }
            }
        });
    }
    shouldRetry(status, attempt) {
        if (attempt >= this.options.maxRetries) {
            return false;
        }
        if (status === undefined) {
            return true;
        }
        if ([403, 408, 409, 425, 429].includes(status)) {
            return true;
        }
        if (status >= 500 && status < 600) {
            return true;
        }
        return false;
    }
    applyRateLimit() {
        return __awaiter(this, void 0, void 0, function* () {
            const now = Date.now();
            const elapsed = now - this.lastRequestTimestamp;
            const requiredDelay = Math.max(0, this.options.minDelayMs - elapsed);
            const jitter = this.options.randomJitterMs > 0
                ? Math.floor(Math.random() * this.options.randomJitterMs)
                : 0;
            const waitMs = requiredDelay + jitter;
            if (waitMs > 0) {
                yield sleep(waitMs);
            }
            this.lastRequestTimestamp = Date.now();
        });
    }
    ensureCookies(force) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.options.usePlaywright) {
                return;
            }
            const now = Date.now();
            if (!force && this.cookieExpiryMs && this.cookieHeader && now < this.cookieExpiryMs - 5000) {
                return;
            }
            if (this.refreshPromise) {
                yield this.refreshPromise;
                return;
            }
            this.refreshPromise = this.acquireCookiesWithPlaywright().finally(() => {
                this.refreshPromise = null;
            });
            yield this.refreshPromise;
        });
    }
    acquireCookiesWithPlaywright() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            let playwrightModule;
            const moduleName = 'playwright';
            try {
                playwrightModule = yield Promise.resolve(`${moduleName}`).then(s => __importStar(require(s)));
            }
            catch (error) {
                this.log('Playwright module not found. Install it to enable automatic cookie retrieval (npm install playwright).');
                throw error;
            }
            const browser = yield playwrightModule.chromium.launch({ headless: true });
            try {
                const context = yield browser.newContext();
                const page = yield context.newPage();
                const targetUrl = (_a = this.options.cookieRefreshUrl) !== null && _a !== void 0 ? _a : 'https://www.sakugabooru.com/';
                yield page.goto(targetUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: this.options.playwrightNavigationTimeoutMs
                });
                yield page.waitForTimeout(this.options.playwrightWaitMs);
                const cookies = yield context.cookies();
                yield context.close();
                if (!cookies.length) {
                    throw new Error('Playwright did not return any cookies.');
                }
                const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
                this.cookieHeader = cookieHeader;
                this.axiosInstance.defaults.headers.Cookie = cookieHeader;
                const expiries = cookies
                    .map(cookie => typeof cookie.expires === 'number' ? cookie.expires : undefined)
                    .filter((value) => typeof value === 'number' && value > 0)
                    .map(value => value * 1000);
                this.cookieExpiryMs = expiries.length ? Math.min(...expiries) : Date.now() + 30 * 60 * 1000;
                this.log(`Obtained ${cookies.length} cookies via Playwright. Session valid until ${new Date(this.cookieExpiryMs).toISOString()}.`);
            }
            finally {
                yield browser.close().catch(() => undefined);
            }
        });
    }
    stringifyError(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
exports.RateLimitedHttpClient = RateLimitedHttpClient;
