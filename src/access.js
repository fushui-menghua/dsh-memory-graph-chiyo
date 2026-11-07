/**
 * access.js —— 记忆库的权限模型
 *
 * 为什么需要：群里的人和主人不该看到同一批记忆。
 * 这一层只管"谁能在哪个 scope 上读/写"，不管具体是哪个框架。
 *
 * 规则按顺序匹配，第一条命中的生效：
 *   { principal: 'owner',  scopes: ['private:*', 'group:*'], read: true,  write: true  }
 *   { principal: 'group',  scopes: ['group:*'],              read: true,  write: false }
 *   { principal: '*',      scopes: ['*'],                    read: false, write: false }
 */
export const DEFAULT_RULES = [
  { principal: 'owner', scopes: ['*'], read: true, write: true },
  { principal: 'agent', scopes: ['agent:*', 'shared:*'], read: true, write: true },
  { principal: 'group', scopes: ['group:*', 'shared:*'], read: true, write: false },
];

function scopeMatches(pattern, scope) {
  if (pattern === '*') return true;
  if (pattern.endsWith(':*')) return String(scope).startsWith(pattern.slice(0, -1));
  return pattern === scope;
}

export function createAccess({ rules = DEFAULT_RULES } = {}) {
  function resolve({ principal = 'agent', scope = '', action = 'read' } = {}) {
    for (const r of rules) {
      const principalOk = r.principal === '*' || r.principal === principal;
      if (!principalOk) continue;
      if (!(r.scopes || []).some((p) => scopeMatches(p, scope))) continue;
      return r[action] === true;
    }
    return false;
  }
  return {
    rules,
    can: resolve,
    assert({ principal, scope, action }) {
      if (!resolve({ principal, scope, action })) {
        const err = new Error(`没有权限：${principal} 不能 ${action} ${scope}`);
        err.code = 'ACCESS_DENIED';
        throw err;
      }
      return true;
    },
    /** 包一层只读视图：读不到的 scope 直接抛错 */
    guard(memory, { principal = 'agent' } = {}) {
      return {
        read: (scope, opts) => {
          resolve({ principal, scope, action: 'read' }) || (() => { throw Object.assign(new Error(`没有权限：${principal} 不能读 ${scope}`), { code: 'ACCESS_DENIED' }); })();
          return memory.recall(scope, opts);
        },
        write: (scope, payload) => {
          resolve({ principal, scope, action: 'write' }) || (() => { throw Object.assign(new Error(`没有权限：${principal} 不能写 ${scope}`), { code: 'ACCESS_DENIED' }); })();
          return memory.write(scope, payload);
        },
      };
    },
  };
}
