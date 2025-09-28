import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

type LoggerFn = (message: string) => void;

interface RateLimitedHttpClientOptions {
    baseURL?: string;
    headers?: Record<string, string>;
    minDelayMs?: number;
    randomJitterMs?: number;
    maxRetries?: number;
    backoffFactor?: number;
    maxBackoffMs?: number;
    requestTimeoutMs?: number;
    usePlaywright?: boolean;
    cookieRefreshUrl?: string;
    playwrightWaitMs?: number;
    playwrightNavigationTimeoutMs?: number;
    logger?: LoggerFn;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class RateLimitedHttpClient {
    private readonly axiosInstance: AxiosInstance;
    private readonly options: Required<Omit<RateLimitedHttpClientOptions, 'baseURL' | 'headers' | 'logger'>> & Pick<RateLimitedHttpClientOptions, 'baseURL' | 'headers' | 'logger'>;
    private readonly log: LoggerFn;
    private queue: Promise<void> = Promise.resolve();
    private lastRequestTimestamp = 0;
    private refreshPromise: Promise<void> | null = null;
    private cookieHeader?: string;
    private cookieExpiryMs?: number;

    constructor(options: RateLimitedHttpClientOptions = {}) {
        const {
            baseURL,
            headers = {},
            minDelayMs = 1200,
            randomJitterMs = 350,
            maxRetries = 4,
            backoffFactor = 1.8,
            maxBackoffMs = 20000,
            requestTimeoutMs = 15000,
            usePlaywright = process.env.SAKUGA_USE_PLAYWRIGHT === 'true',
            cookieRefreshUrl,
            playwrightWaitMs = 4500,
            playwrightNavigationTimeoutMs = 30000,
            logger = (message: string) => console.log(`[HttpClient] ${message}`)
        } = options;

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
            cookieRefreshUrl: cookieRefreshUrl ?? baseURL ?? 'https://www.sakugabooru.com/',
            playwrightWaitMs,
            playwrightNavigationTimeoutMs,
            logger
        };
        this.log = logger;

        const defaultHeaders = {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            Connection: 'keep-alive',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
            ...headers
        };

        this.axiosInstance = axios.create({
            baseURL,
            timeout: requestTimeoutMs,
            headers: defaultHeaders
        });
    }

    async primeSession(): Promise<void> {
        if (!this.options.usePlaywright) {
            return;
        }
        try {
            await this.ensureCookies(false);
        } catch (error) {
            this.log(`Unable to prime HTTP session: ${this.stringifyError(error)}`);
        }
    }

    async request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        const run = async () => this.executeWithBackoff<T>(config);
        const pending = this.queue.then(run, run);
        this.queue = pending.then(() => undefined, () => undefined);
        return pending;
    }

    private async executeWithBackoff<T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        let attempt = 0;
        let delayMs = this.options.minDelayMs;

        while (true) {
            await this.applyRateLimit();
            try {
                const effectiveConfig: AxiosRequestConfig = { ...config };
                if (this.cookieHeader && !effectiveConfig.headers?.Cookie) {
                    effectiveConfig.headers = {
                        ...effectiveConfig.headers,
                        Cookie: this.cookieHeader
                    };
                }
                return await this.axiosInstance.request<T>(effectiveConfig);
            } catch (error) {
                const status = (error as any)?.response?.status as number | undefined;
                if (!this.shouldRetry(status, attempt)) {
                    throw error;
                }

                if ((status === 403 || status === 429) && this.options.usePlaywright) {
                    this.log(`Received status ${status}. Attempting to refresh session cookies via Playwright.`);
                    try {
                        await this.ensureCookies(true);
                    } catch (refreshError) {
                        this.log(`Failed to refresh cookies: ${this.stringifyError(refreshError)}`);
                    }
                }

                const jitter = this.options.randomJitterMs > 0
                    ? Math.floor(Math.random() * this.options.randomJitterMs)
                    : 0;
                const backoffDelay = Math.min(delayMs, this.options.maxBackoffMs) + jitter;
                this.log(`Retrying request (attempt ${attempt + 1}/${this.options.maxRetries}) after ${backoffDelay}ms delay.`);
                await sleep(backoffDelay);
                delayMs = Math.min(delayMs * this.options.backoffFactor, this.options.maxBackoffMs);
                attempt += 1;
            }
        }
    }

    private shouldRetry(status: number | undefined, attempt: number): boolean {
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

    private async applyRateLimit(): Promise<void> {
        const now = Date.now();
        const elapsed = now - this.lastRequestTimestamp;
        const requiredDelay = Math.max(0, this.options.minDelayMs - elapsed);
        const jitter = this.options.randomJitterMs > 0
            ? Math.floor(Math.random() * this.options.randomJitterMs)
            : 0;
        const waitMs = requiredDelay + jitter;
        if (waitMs > 0) {
            await sleep(waitMs);
        }
        this.lastRequestTimestamp = Date.now();
    }

    private async ensureCookies(force: boolean): Promise<void> {
        if (!this.options.usePlaywright) {
            return;
        }
        const now = Date.now();
        if (!force && this.cookieExpiryMs && this.cookieHeader && now < this.cookieExpiryMs - 5000) {
            return;
        }
        if (this.refreshPromise) {
            await this.refreshPromise;
            return;
        }
        this.refreshPromise = this.acquireCookiesWithPlaywright().finally(() => {
            this.refreshPromise = null;
        });
        await this.refreshPromise;
    }

    private async acquireCookiesWithPlaywright(): Promise<void> {
        let playwrightModule: any;
        const moduleName: string = 'playwright';
        try {
            playwrightModule = await import(moduleName);
        } catch (error) {
            this.log('Playwright module not found. Install it to enable automatic cookie retrieval (npm install playwright).');
            throw error;
        }

        const browser = await (playwrightModule as any).chromium.launch({ headless: true });
        try {
            const context = await browser.newContext();
            const page = await context.newPage();
            const targetUrl = this.options.cookieRefreshUrl ?? 'https://www.sakugabooru.com/';
            await page.goto(targetUrl, {
                waitUntil: 'domcontentloaded',
                timeout: this.options.playwrightNavigationTimeoutMs
            });
            await page.waitForTimeout(this.options.playwrightWaitMs);
            const cookies: any[] = await context.cookies();
            await context.close();

            if (!cookies.length) {
                throw new Error('Playwright did not return any cookies.');
            }

            const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
            this.cookieHeader = cookieHeader;
            this.axiosInstance.defaults.headers.Cookie = cookieHeader;

            const expiries = cookies
                .map(cookie => typeof cookie.expires === 'number' ? cookie.expires : undefined)
                .filter((value): value is number => typeof value === 'number' && value > 0)
                .map(value => value * 1000);
            this.cookieExpiryMs = expiries.length ? Math.min(...expiries) : Date.now() + 30 * 60 * 1000;

            this.log(`Obtained ${cookies.length} cookies via Playwright. Session valid until ${new Date(this.cookieExpiryMs).toISOString()}.`);
        } finally {
            await browser.close().catch(() => undefined);
        }
    }

    private stringifyError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
