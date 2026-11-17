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
//   mget(keys): Promise<(string | null)[]>

/**
 * `namespace` is prepended to every key (e.g. "tessera:" or "switchboard:", from apps.js), so one database can serve several products.
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
    async mget(/** @type {string[]} */ keys) {
      if (keys.length === 0) return [];
      const values = /** @type {unknown[]} */ (await run(["MGET", ...keys.map(k)])) ?? [];
      return keys.map((_, i) => (values[i] == null ? null : String(values[i])));
    },
  };
}

/**
 * In-memory fake with the same behaviour, for tests. `ttls` records expiries that were requested.
 * `namespace` is prepended to every key like createRedisStore's, so the maps hold the real (prefixed) keys; pass
 * `shared` (another memory store) to get a second app's view of the same database.
 * @param {{ namespace?: string, shared?: { strings: Map<string, string>, sets: Map<string, Set<string>>, ttls: Map<string, number> } }} [opts]
 */
export function createMemoryStore({ namespace = "", shared } = {}) {
  const strings = shared?.strings ?? new Map();
  const sets = shared?.sets ?? new Map();
  const ttls = shared?.ttls ?? new Map();
  const k = (/** @type {string} */ key) => namespace + key;
  return {
    strings,
    sets,
    ttls,
    async get(key) {
      return strings.has(k(key)) ? /** @type {string} */ (strings.get(k(key))) : null;
    },
    async set(key, value, { ex, nx } = {}) {
      if (nx && strings.has(k(key))) return false;
      strings.set(k(key), String(value));
      if (ex) ttls.set(k(key), ex);
      return true;
    },
    async del(key) {
      strings.delete(k(key));
      sets.delete(k(key));
    },
    async incr(key) {
      const n = Number(strings.get(k(key)) ?? 0) + 1;
      strings.set(k(key), String(n));
      return n;
    },
    async incrWithExpiry(key, seconds) {
      const n = Number(strings.get(k(key)) ?? 0) + 1;
      strings.set(k(key), String(n));
      if (!ttls.has(k(key))) ttls.set(k(key), seconds);
      return n;
    },
    async sadd(key, member) {
      const s = sets.get(k(key)) ?? new Set();
      const had = s.has(member);
      s.add(member);
      sets.set(k(key), s);
      return had ? 0 : 1;
    },
    async srem(key, member) {
      return sets.get(k(key))?.delete(member) ? 1 : 0;
    },
    async smembers(key) {
      return [...(sets.get(k(key)) ?? [])];
    },
    async mget(/** @type {string[]} */ keys) {
      return keys.map((key) => strings.get(k(key)) ?? null);
    },
  };
}
