export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function releaseLock(client, lockKey, lockValue) {
  const luaScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
    else
        return 0
    end
  `;

  return await client.eval(luaScript, {
    keys: [lockKey],
    arguments: [lockValue],
  });
}
