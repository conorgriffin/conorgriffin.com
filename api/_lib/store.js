// Tiny key-value interface over Upstash Redis (REST). Everything else depends only on this shape,
// so tests use createMemoryStore().
//
// @typedef {object} Store
//   get(key): Promise<string | null>
//   set(key, value, opts?: { ex?: number, nx?: boolean }): Promise<boolean>   (false when nx and the key exists)
//   del(key): Promise<void>
//   incr(key): Promise<number>
//   incrWithExpiry(key, seconds): Promise<number>   (sets the expiry when the counter is created)
//   sadd(key, member): Promise<number>   (1 if added)
//   srem(key, member): Promise<number>   (1 if removed)
//   smembers(key): Promise<string[]>

/**
 * `namespace` is prepended to every key (e.g. "tessera:"), so one database can serve several products.
 * @param {{ url: string | undefined, token: string | undefined, namespace?: string, fetch?: typeof fetch }} cfg
 */
export function createRedisStore({ url, token, namespace = "", fetch: fetchImpl = fetch }) {
  if (!url || !token) throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN are required");
  const k = (/** @type {string} */ key) => namespace + key;
  const base = url.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  /** @param {(string | number)[]} command */
  async function run(command) {
    const res = await fetchImpl(base, { method: "POST", headers, body: JSON.stringify(command) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`redis ${command[0]} failed (${res.status})`);
    return body.result;
  }

  /** @param {(string | number)[][]} commands */
  async function pipeline(commands) {
    const res = await fetchImpl(`${base}/pipeline`, { method: "POST", headers, body: JSON.stringify(commands) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body)) throw new Error(`redis pipeline failed (${res.status})`);
    for (const item of body) if (item && item.error) throw new Error("redis pipeline command failed");
    return body.map((item) => item.result);
  }

  return {
    async get(key) {
      const v = await run(["GET", k(key)]);
      return v == null ? null : String(v);
    },
    async set(key, value, { ex, nx } = {}) {
      /** @type {(string | number)[]} */
      const cmd = ["SET", k(key), value];
      if (ex) cmd.push("EX", ex);
      if (nx) cmd.push("NX");
      return (await run(cmd)) === "OK";
    },
    async del(key) {
      await run(["DEL", k(key)]);
    },
    async incr(key) {
      return Number(await run(["INCR", k(key)]));
    },
    async incrWithExpiry(key, seconds) {
      const [count] = await pipeline([["INCR", k(key)], ["EXPIRE", k(key), seconds, "NX"]]);
      return Number(count);
    },
    async sadd(key, member) {
      return Number(await run(["SADD", k(key), member]));
    },
    async srem(key, member) {
      return Number(await run(["SREM", k(key), member]));
    },
    async smembers(key) {
      return /** @type {string[]} */ (await run(["SMEMBERS", k(key)])) ?? [];
    },
  };
}

/** In-memory fake with the same behaviour, for tests. `ttls` records expiries that were requested. */
export function createMemoryStore() {
  /** @type {Map<string, string>} */ const strings = new Map();
  /** @type {Map<string, Set<string>>} */ const sets = new Map();
  /** @type {Map<string, number>} */ const ttls = new Map();
  return {
    strings,
    sets,
    ttls,
    async get(key) {
      return strings.has(key) ? /** @type {string} */ (strings.get(key)) : null;
    },
    async set(key, value, { ex, nx } = {}) {
      if (nx && strings.has(key)) return false;
      strings.set(key, String(value));
      if (ex) ttls.set(key, ex);
      return true;
    },
    async del(key) {
      strings.delete(key);
      sets.delete(key);
    },
    async incr(key) {
      const n = Number(strings.get(key) ?? 0) + 1;
      strings.set(key, String(n));
      return n;
    },
    async incrWithExpiry(key, seconds) {
      const n = Number(strings.get(key) ?? 0) + 1;
      strings.set(key, String(n));
      if (!ttls.has(key)) ttls.set(key, seconds);
      return n;
    },
    async sadd(key, member) {
      const s = sets.get(key) ?? new Set();
      const had = s.has(member);
      s.add(member);
      sets.set(key, s);
      return had ? 0 : 1;
    },
    async srem(key, member) {
      return sets.get(key)?.delete(member) ? 1 : 0;
    },
    async smembers(key) {
      return [...(sets.get(key) ?? [])];
    },
  };
}
