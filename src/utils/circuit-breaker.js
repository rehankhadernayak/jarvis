'use strict';

// ─── withRetry ───────────────────────────────────────────────────────────────
/**
 * Retry an async function with exponential back-off.
 *
 * @param {() => Promise<any>} fn     - The async function to call.
 * @param {{ retries?: number, delay?: number, backoff?: number }} opts
 *   retries  – max attempts after the first failure (default 3)
 *   delay    – base delay in ms before first retry (default 500)
 *   backoff  – multiplier applied on each successive retry (default 2)
 * @returns {Promise<any>}
 */
async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? 3;
  const baseDelay = opts.delay ?? 500;
  const backoff = opts.backoff ?? 2;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = baseDelay * Math.pow(backoff, attempt);
        await new Promise((res) => setTimeout(res, wait));
      }
    }
  }
  throw lastErr;
}

// ─── CircuitBreaker ──────────────────────────────────────────────────────────
const STATE = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });

// Registry of all circuit breaker instances (for getAllStates)
const _registry = new Map();

class CircuitBreaker {
  /**
   * @param {string} name             - Human-readable name, e.g. 'google-calendar'
   * @param {{ threshold?: number, timeout?: number, halfOpenTests?: number }} opts
   *   threshold     – number of consecutive failures before opening (default 5)
   *   timeout       – ms to wait in OPEN state before moving to HALF_OPEN (default 30 000)
   *   halfOpenTests – number of test calls allowed in HALF_OPEN before closing (default 1)
   */
  constructor(name, opts = {}) {
    if (!name || typeof name !== 'string') throw new TypeError('CircuitBreaker: name must be a non-empty string');
    this.name = name;
    this._threshold = opts.threshold ?? 5;
    this._timeout = opts.timeout ?? 30_000;
    this._halfOpenTests = opts.halfOpenTests ?? 1;

    this._state = STATE.CLOSED;
    this._failures = 0;
    this._lastFailure = null;   // timestamp (ms)
    this._openedAt = null;      // timestamp when circuit tripped OPEN
    this._halfOpenActive = 0;   // calls currently running in HALF_OPEN

    _registry.set(name, this);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Execute fn through the circuit breaker.
   * @param {() => Promise<any>} fn
   * @returns {Promise<any>}
   */
  async call(fn) {
    this._tick(); // re-evaluate state transitions before each call

    if (this._state === STATE.OPEN) {
      const nextRetry = this._openedAt + this._timeout;
      throw new CircuitBreakerOpenError(
        `Circuit "${this.name}" is OPEN. Retry after ${new Date(nextRetry).toISOString()}.`,
        { name: this.name, nextRetry }
      );
    }

    if (this._state === STATE.HALF_OPEN) {
      if (this._halfOpenActive >= this._halfOpenTests) {
        throw new CircuitBreakerOpenError(
          `Circuit "${this.name}" is HALF_OPEN and test slot is occupied.`,
          { name: this.name }
        );
      }
      this._halfOpenActive++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    } finally {
      if (this._state === STATE.HALF_OPEN) {
        this._halfOpenActive = Math.max(0, this._halfOpenActive - 1);
      }
    }
  }

  /**
   * Returns a plain-object snapshot of this breaker's current state.
   * @returns {{ name: string, state: string, failures: number, lastFailure: number|null, nextRetry: number|null }}
   */
  getState() {
    return {
      name: this.name,
      state: this._state,
      failures: this._failures,
      lastFailure: this._lastFailure,
      nextRetry: this._openedAt != null ? this._openedAt + this._timeout : null,
    };
  }

  /**
   * Returns an array of state snapshots for every registered CircuitBreaker.
   * @returns {Array<ReturnType<CircuitBreaker['getState']>>}
   */
  static getAllStates() {
    return Array.from(_registry.values()).map((cb) => cb.getState());
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /** Re-evaluate whether an OPEN circuit should transition to HALF_OPEN. */
  _tick() {
    if (this._state === STATE.OPEN) {
      const elapsed = Date.now() - this._openedAt;
      if (elapsed >= this._timeout) {
        this._state = STATE.HALF_OPEN;
        this._halfOpenActive = 0;
      }
    }
  }

  _onSuccess() {
    if (this._state === STATE.HALF_OPEN) {
      // Probe succeeded — close the circuit and reset counters
      this._reset();
    } else if (this._state === STATE.CLOSED) {
      // Healthy call — clear any residual failure count
      this._failures = 0;
    }
  }

  _onFailure() {
    this._failures++;
    this._lastFailure = Date.now();

    if (this._state === STATE.HALF_OPEN) {
      // Probe failed — reopen immediately
      this._trip();
    } else if (this._state === STATE.CLOSED && this._failures >= this._threshold) {
      this._trip();
    }
  }

  _trip() {
    this._state = STATE.OPEN;
    this._openedAt = Date.now();
    console.warn(`[CircuitBreaker] "${this.name}" tripped OPEN after ${this._failures} failure(s). Will retry in ${this._timeout}ms.`);
  }

  _reset() {
    this._state = STATE.CLOSED;
    this._failures = 0;
    this._lastFailure = null;
    this._openedAt = null;
    this._halfOpenActive = 0;
  }
}

// ─── Custom error class ──────────────────────────────────────────────────────
class CircuitBreakerOpenError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.meta = meta;
  }
}

module.exports = { withRetry, CircuitBreaker, CircuitBreakerOpenError, STATE };
