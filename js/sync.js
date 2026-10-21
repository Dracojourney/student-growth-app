/* ============================================================
 * 云同步层（local-first）
 * - localStorage 始终是工作副本：未登录时应用完整运行于本地模式；
 *   登录后云端作为持久备份与多设备同步通道。
 * - 幂等：流水/兑换按 client_id 唯一约束 upsert；打卡按主键
 *   (family_id, child_id, day, task_id) upsert；配置按内容哈希门控
 *   推送 + 云端 updated_at 条件采纳（本地已改则保留并推送覆盖）。
 * - 首登迁移：云端家庭为空时全量上传本地数据，并写
 *   family_settings.migration_state={status:'done'} 标记。
 * - 删除传播：推送时对比上次已同步的孩子集合，缺失者从云端删除
 *   （数据库级联清理其流水/打卡/兑换/配置）；拉取时若迁移已完成，
 *   云端缺失的孩子同样从本地删除。
 * - 余额：云端 children.points 由触发器按流水重算（0002 迁移），
 *   本地合并后按同样符号规则重算，两端最终一致。
 * - 家庭邀请（0004 迁移）：joinFamily 经 RPC 排他切换成员关系后，
 *   adoptCloudOnce 游标禁止一切推送，首拉以云端为准（资料/配置无条件
 *   采纳），成功后才恢复正常同步——本机种子/旧数据绝不回写云端。
 * ============================================================ */
var SGASync = (function () {
  'use strict';

  var REQUEST_TIMEOUT_MS = 15000;
  var _restoreMode = typeof location !== 'undefined' && /(?:\?|&)restore=cloud(?:&|$)/.test(location.search || '');
  var _restoreRequested = false, _restoreComplete = false, _restoreBackupKey = '', _restorePending = null;

  function withDeadline(start, controller) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        controller.abort();
        finish(reject, new Error('云同步请求超时，请检查网络后点击立即同步重试'));
      }, REQUEST_TIMEOUT_MS);
      function finish(done, value) {
        if (settled) return;
        settled = true; clearTimeout(timer); done(value);
      }
      try {
        Promise.resolve(start()).then(function (value) { finish(resolve, value); },
          function (error) { finish(reject, error); });
      } catch (error) { finish(reject, error); }
    });
  }
  function request(query) {
    var controller = new AbortController();
    if (query && typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal);
    return withDeadline(function () { return query; }, controller);
  }
  function fetchWithTimeout(input, options) {
    options = options || {};
    var controller = new AbortController(), upstream = options.signal || (input && input.signal);
    var abort = function () { controller.abort(); };
    if (upstream) {
      if (upstream.aborted) controller.abort();
      else upstream.addEventListener('abort', abort, { once: true });
    }
    function cleanup() { if (upstream) upstream.removeEventListener('abort', abort); }
    return withDeadline(function () {
      // Keep the Supabase client URL/session identity; change only the network destination.
      var original = typeof input === 'string' ? input : (input && input.url);
      if (typeof SGA_SUPABASE_GATEWAY === 'string' && SGA_SUPABASE_GATEWAY &&
          original && original.indexOf(SGA_SUPABASE_URL + '/') === 0) {
        var destination = SGA_SUPABASE_GATEWAY + original.slice(SGA_SUPABASE_URL.length);
        input = typeof input === 'string' ? destination : new Request(destination, input);
      }
      return fetch(input, Object.assign({}, options, { signal: controller.signal }));
    }, controller).then(function (response) { cleanup(); return response; },
      function (error) { cleanup(); throw error; });
  }

  var client = null;
  try {
    if (typeof SGA_SUPABASE_URL === 'string' && SGA_SUPABASE_URL &&
        typeof SGA_SUPABASE_ANON_KEY === 'string' && SGA_SUPABASE_ANON_KEY &&
        typeof window.supabase !== 'undefined' && window.supabase &&
        typeof window.supabase.createClient === 'function') {
      client = window.supabase.createClient(SGA_SUPABASE_URL, SGA_SUPABASE_ANON_KEY, { global: { fetch: fetchWithTimeout } });
    }
  } catch (e) { client = null; }

  var SYNC_KEY = 'sga_cloud_sync_state'; /* 本设备同步游标（非应用业务数据） */
  /* 应用业务数据键：与 store.js 的 STORAGE_KEY 同源，只读引用，绝不修改其定义 */
  var BIZ_KEY = (typeof STORAGE_KEY !== 'undefined' && STORAGE_KEY) ? STORAGE_KEY : 'student_growth_app_v1';
  var VALID_LEDGER_TYPES = { earn: 1, bonus: 1, initial: 1, spend: 1, revoke: 1 };
  var POSITIVE_LEDGER_TYPES = { earn: 1, bonus: 1, initial: 1 };

  var _user = null;
  var _familyId = null;
  /* 拆分守卫：pullAndMerge 用 _pulling、pushNow 用 _pushing。
     原 _syncing 共用标志会导致"用户改项目→后台 schedulePush 还没跑完时
     手动点立即同步→syncAll 里 pull 被后台 push 拦住、push 又被同一个
     标志拦住，整条 syncAll 静默以 lastError='' 结束"（用户实际报"未知错误"
     根因，2026-10-21 修复）。 */
  var _pulling = false;
  var _pendingPull = null; /* 正在进行的 pullAndMerge Promise */
  var _pushing = false;
  var _pendingPush = null; /* 正在进行的 pushNow Promise，用于合并并发调用 */
  var _lastError = '';
  var _lastSyncAt = 0;
  var _listeners = [];
  var _pushTimer = 0;
  var _initializing = false;
  var _initializationPromise = null;
  var _familyUserId = null; /* 当前 _familyId 归属的用户 id，用于识别重复 auth 事件 */

  function _loadLocal() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; }
  }
  function _saveLocal(s) {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function available() { return !!client; }
  function status() {
    return {
      available: available(),
      signedIn: !!_user,
      email: _user ? (_user.email || '') : '',
      familyId: _familyId,
      syncing: _pulling || _pushing,
      lastError: _lastError,
      lastSyncAt: _lastSyncAt,
      restoreMode: _restoreMode, restoreComplete: _restoreComplete, restoreBackupKey: _restoreBackupKey
    };
  }
  function onChange(fn) { _listeners.push(fn); }
  function _notify() { _listeners.forEach(function (fn) { try { fn(status()); } catch (e) {} }); }

  function authResult(result) {
    if (result && result.error) throw result.error;
    return result;
  }

  function bindFamily(fid) {
    var cursor = _loadLocal();
    if (cursor.familyId && cursor.familyId !== fid) {
      var state = typeof getAppState === 'function' ? getAppState() : null;
      if (state) {
        localStorage.setItem(BIZ_KEY + '_account_backup_' + cursor.familyId, JSON.stringify(state));
        Object.keys(state).forEach(function (key) { delete state[key]; });
        state.childrenList = []; state.children = {}; state.currentChildId = '';
        state.parentVerified = false; state.parentVerifyUntil = 0;
        if (typeof saveState === 'function') saveState(state);
      }
      cursor = {};
    }
    cursor.familyId = fid;
    _saveLocal(cursor);
  }

  /* ---------- 认证 ---------- */
  function signUp(email, password) {
    if (!available()) return Promise.reject(new Error('云同步组件未加载'));
    return client.auth.signUp({ email: email, password: password }).then(authResult);
  }
  function signIn(email, password) {
    if (!available()) return Promise.reject(new Error('云同步组件未加载'));
    return client.auth.signInWithPassword({ email: email, password: password }).then(authResult);
  }
  function signOut() {
    if (!available()) return Promise.reject(new Error('云同步组件未加载'));
    return Promise.all([_initializationPromise, _pendingPull, _pendingPush]).then(function () { return client.auth.signOut({ scope: 'local' }); }).then(authResult);
  }
  /* 重发邮箱确认邮件（当前项目已关闭邮箱确认，此接口为防御性保留，
     将来若重新开启验证时可直接调用，无需改 sync.js 结构） */
  function resendConfirmationEmail(email) {
    if (!available()) return Promise.reject(new Error('云同步组件未加载'));
    return client.auth.resend({ type: 'signup', email: email }).then(authResult);
  }

  /* ---------- 家庭绑定 ----------
     使用 0003 迁移的 ensure_my_family() RPC：advisory lock 原子化，
     避免多标签页/多设备同时首登时重复建家（前端两步查+建有竞态）。 */
  function ensureFamily() {
    return request(client.rpc('ensure_my_family')).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  /* ---------- 家庭成员邀请（阶段 3C）----------
     加入家庭铁律：目标家庭云端数据整体替换本机数据，绝不反向推送本机数据。
     - joinFamily：RPC 原子切换成员关系（调用者原自建孤儿家庭级联删除），
       然后清除本机业务数据与同步游标，写入 adoptCloudOnce 标记；
       由调用方刷新页面，重启后 ensureFamily 返回新家庭并执行首拉。
     - adoptCloudOnce 标记存在期间：pushNow 一律拒绝（防止本地种子数据
       回写云端覆盖家庭真实数据）；pullAndMerge 以云端为准——已存在孩子
       的资料/任务配置无条件采纳云端，拉取成功后清除标记恢复正常同步。 */

  function getFamilyInfo() {
    if (!_user || !_familyId) return Promise.resolve(null);
    return Promise.all([
      request(client.from('families').select('id,owner_id,invite_code').eq('id', _familyId).maybeSingle()),
      request(client.from('family_members').select('user_id,email,joined_at').eq('family_id', _familyId)
        .order('joined_at', { ascending: true }))
    ]).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      if (rs[1].error) throw rs[1].error;
      var fam = rs[0].data;
      if (!fam) return null;
      return {
        familyId: fam.id,
        inviteCode: fam.invite_code || '',
        isOwner: fam.owner_id === _user.id,
        members: (rs[1].data || []).map(function (m) {
          return { email: m.email || '', isMe: m.user_id === _user.id };
        })
      };
    });
  }

  function regenerateInviteCode() {
    if (!_user) return Promise.reject(new Error('请先登录'));
    return request(client.rpc('regenerate_my_invite_code')).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  function joinFamily(code) {
    if (!_user) return Promise.reject(new Error('请先登录'));
    var c = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(c)) return Promise.reject(new Error('请输入 6 位邀请码'));
    if (_pushTimer) { clearTimeout(_pushTimer); _pushTimer = 0; }
    return Promise.all([_pendingPull, _pendingPush]).then(function () {
      return request(client.rpc('join_family_by_code', { p_code: c }));
    }).then(function (res) {
      if (res.error) throw res.error;
      var fid = res.data;
      if (!fid) throw new Error('加入失败：服务器未返回家庭标识');
      _familyId = fid;
      /* 整体替换：本机业务数据与游标作废；写入 adopt 标记供重启后首拉使用。
         清除前先把本机业务数据备份到 sga_pre_adopt_backup_v1（一次性保险） */
      try {
        var prevBiz = localStorage.getItem(BIZ_KEY);
        if (prevBiz && !localStorage.getItem('sga_pre_adopt_backup_v1')) {
          localStorage.setItem('sga_pre_adopt_backup_v1', prevBiz);
        }
        localStorage.removeItem(BIZ_KEY);
      } catch (e) {}
      _saveLocal({ adoptCloudOnce: fid, familyId: fid });
      return fid;
    });
  }

  function _iso(t) {
    var n = (typeof t === 'number') ? t : (Date.parse(t) || Date.now());
    return new Date(n).toISOString();
  }

  /* ---------- 配置变更检测（键序无关稳定序列化 + djb2 哈希）----------
     同步游标为每个配置记录 {h: 内容哈希, cloud: 云端 updated_at}：
     - 推送：哈希与上次一致 → 跳过（避免无变更推送刷新云端 updated_at）
     - 拉取：云端 updated_at 前进且本地哈希与上次同步一致（本地未改）
       → 采纳云端；本地已改 → 保留本地，随后推送覆盖（推送侧 LWW 收敛） */
  function _stableStr(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(_stableStr).join(',') + ']';
    var keys = Object.keys(v).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + _stableStr(v[k]); }).join(',') + '}';
  }
  function _hashCfg(obj) {
    var s = _stableStr(obj) || '';
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }
  function _cfgMeta(syncSt) { if (!syncSt.cfg) syncSt.cfg = {}; return syncSt.cfg; }
  /* 孩子资料哈希对象（不含 points/sort_order：余额常变、排序暂不参与同步） */
  function _profObj(p) {
    return { name: p.name || '', gender: p.gender || '', grade: p.grade || '',
             avatar: p.avatar || '', banner: p.banner || '' };
  }

  /* ---------- 推送（增量：流水/打卡/兑换按时间游标，配置按内容哈希门控）---------- */
  function pushNow() {
    if (_restoreMode) return Promise.resolve(false); /* Recovery must never write business data upstream. */
    if (!_user || !_familyId) { _lastError = '未登录或无家庭'; _notify(); return Promise.resolve(false); }
    /* 重入守卫改为"合并到同一个 Promise"而不是拒绝：
       syncAll → pullAndMerge 正在跑（几百毫秒）期间，后台 schedulePush 的 2s
       定时器可能抢先启动 pushNow，随后 syncAll pull 完调 pushNow 会被旧的硬拦
       返回 false + "推送正在进行中"，用户看到同步失败。合并模式下，两次调用
       等同一个 Promise 跑完就行，不报错、不丢数据。 */
    if (_pushing) return _pendingPush;
    if (_pulling) return _pendingPull.then(function () { return _lastError ? false : pushNow(); });
    /* 加入家庭后的首拉完成前禁止一切推送：本机仍是种子/旧数据，
       回写会覆盖家庭云端真实数据（adoptCloudOnce 游标由 pullAndMerge 清除） */
    if (_loadLocal().adoptCloudOnce) { _lastError = '首次云端拉取未完成，暂时不推送'; _notify(); return Promise.resolve(false); }
    var st = (typeof getAppState === 'function') ? getAppState() : null;
    if (!st || !Array.isArray(st.childrenList)) { _lastError = '本地状态不可用'; _notify(); return Promise.resolve(false); }
    st = JSON.parse(JSON.stringify(st)); /* Stable upload snapshot; later edits are retried. */
    _pushing = true; _lastError = ''; _notify();
    var fid = _familyId;
    var nowIso = new Date().toISOString();
    var syncSt = _loadLocal();
    var prevIds = Array.isArray(syncSt.childIds) ? syncSt.childIds : null;
    var curIds = st.childrenList.map(function (c) { return c.id; });
    var lastAt = syncSt.lastPushAt || 0;
    var minTime = lastAt ? (lastAt - 60000) : 0; /* 60 秒时钟偏差缓冲 */

    /* 1) 删除传播：上次已同步、现在本地不存在 → 云端删除（级联） */
    var removed = prevIds ? prevIds.filter(function (id) { return curIds.indexOf(id) === -1; }) : [];
    var delJob = removed.length
      ? client.from('children').delete().eq('family_id', fid).in('child_id', removed)
      : Promise.resolve({ error: null });

    /* 2) 孩子资料（含余额快照；云端最终以触发器重算为准）
       资料哈希门控：与任务配置同规则——资料未变不推送，避免
       每台设备用自己的资料反复覆盖云端（否则资料永不互相同步） */
    var profMetaUpdates = [];
    var childrenRows = [];
    st.childrenList.forEach(function (c, i) {
      var cs = st.children[c.id] || {};
      var pH = _hashCfg(_profObj(c));
      var pKey = 'prof:' + c.id;
      var pM = _cfgMeta(syncSt)[pKey];
      if (!pM || pM.h !== pH) {
        childrenRows.push({
          family_id: fid, child_id: c.id, name: c.name,
          gender: c.gender || null, grade: c.grade || null,
          avatar: c.avatar || null, banner: c.banner || null,
          sort_order: i, updated_at: nowIso
        });
        profMetaUpdates.push({ key: pKey, h: pH });
      }
    });
    var childrenJob = childrenRows.length
      ? client.from('children').upsert(childrenRows)
      : Promise.resolve({ error: null });

    /* 把整条 push 链存进 _pendingPush，让后续重入调用能等到同一个 Promise 完成 */
    var chain = request(delJob).then(function (r) { if (r.error) throw r.error; return request(childrenJob); })
      .then(function (r) {
        if (r.error) throw r.error;
        var jobs = [];
        var cfgMetaUpdates = []; /* 推送成功后才落游标，失败下轮重试 */
        st.childrenList.forEach(function (c) {
          var cs = st.children[c.id];
          if (!cs) return;
          /* 积分流水（追加式，按游标增量） */
          var led = (cs.pointsHistory || []).filter(function (e) {
            return e && e.id && VALID_LEDGER_TYPES[e.type] && (e.revoked === true || !minTime || (e.time || 0) > minTime);
          }).map(function (e) {
            return {
              family_id: fid, child_id: c.id, client_id: String(e.id), type: e.type,
              amount: Math.abs(e.amount || 0), description: e.desc || null,
              reason: e.reason || null, ref_id: e.refId || null,
              revoked: e.revoked === true, occurred_at: _iso(e.time)
            };
          });
          /* onConflict 必须显式指向幂等键 (family_id,child_id,client_id)：
             默认冲突目标是主键 id（自动 uuid），游标丢失后全量重推会违反唯一约束 */
          if (led.length) jobs.push(client.from('points_ledger')
            .upsert(led, { onConflict: 'family_id,child_id,client_id' }));
          /* 打卡（按 day+task 主键 upsert） */
          var ckRows = [];
          Object.keys(cs.checkins || {}).forEach(function (day) {
            var dm = cs.checkins[day];
            Object.keys(dm).forEach(function (tid) {
              var e = dm[tid];
              if (!e) return;
              if (minTime && (e.time || 0) <= minTime) return;
              ckRows.push({
                family_id: fid, child_id: c.id, day: day, task_id: String(tid),
                completed: e.completed !== false, points: e.points || 0,
                option: e.option || null, history_client_id: e.historyId || null,
                client_updated_at: _iso(e.time)
              });
            });
          });
          if (ckRows.length) jobs.push(client.from('checkins').upsert(ckRows));
          /* 兑换记录 */
          var reds = (cs.redemptions || []).filter(function (r) {
            return r && r.id && r.name && (!minTime || (r.time || 0) > minTime);
          }).map(function (r) {
            return {
              family_id: fid, child_id: c.id, client_id: String(r.id),
              reward_id: r.rewardId || null, name: r.name,
              cost: Math.abs(r.cost || 0), status: r.status || 'done',
              occurred_at: _iso(r.time)
            };
          });
          if (reds.length) jobs.push(client.from('redemptions')
            .upsert(reds, { onConflict: 'family_id,child_id,client_id' }));
          /* 每孩子任务配置：内容哈希变化才推送（哈希门控 LWW） */
          if (cs.taskConfig) {
            var tKey = 'task:' + c.id;
            var tH = _hashCfg(cs.taskConfig);
            var tM = _cfgMeta(syncSt)[tKey];
            if (!tM || tM.h !== tH) {
              jobs.push(client.from('child_task_config')
                .upsert({ family_id: fid, child_id: c.id, data: cs.taskConfig, updated_at: nowIso }));
              cfgMetaUpdates.push({ key: tKey, h: tH });
            }
          }
        });
        /* 家庭共享奖励配置：同样按哈希门控 */
        if (st.rewardConfig) {
          var rH = _hashCfg(st.rewardConfig);
          var rM = _cfgMeta(syncSt).reward;
          if (!rM || rM.h !== rH) {
            jobs.push(client.from('family_reward_config')
              .upsert({ family_id: fid, data: st.rewardConfig, updated_at: nowIso }));
            cfgMetaUpdates.push({ key: 'reward', h: rH });
          }
        }
        /* 首次全量上传完成标记（拉取侧据此执行"云端缺失=已删除"规则） */
        /* Mark migration complete only after every business write succeeds. */
        return Promise.all(jobs.map(function (j) {
          return request(j).then(function (r) { if (r && r.error) throw r.error; });
        })).then(function () {
          return request(client.from('family_settings').upsert({ family_id: fid, migration_state: { status: 'done' } }));
        }).then(function (r) { if (r.error) throw r.error; return cfgMetaUpdates; });
      })
      .then(function (metaUpdates) {
        return metaUpdates.concat(profMetaUpdates);
      })
      .then(function (metaUpdates) {
        metaUpdates.forEach(function (u) { _cfgMeta(syncSt)[u.key] = { h: u.h, cloud: nowIso }; });
        /* 清理已删除孩子的配置/资料游标 */
        if (syncSt.cfg) {
          Object.keys(syncSt.cfg).forEach(function (k) {
            if ((k.indexOf('task:') === 0 || k.indexOf('prof:') === 0) && curIds.indexOf(k.slice(5)) === -1) delete syncSt.cfg[k];
          });
        }
        syncSt.childIds = curIds;
        syncSt.lastPushAt = Date.parse(nowIso);
        _saveLocal(syncSt);
        _lastSyncAt = Date.now();
        return true;
      })
      .catch(function (err) {
        _lastError = String((err && err.message) || err);
        return false;
      })
      .then(function (ok) { _pushing = false; _pendingPush = null; _notify(); return ok; });
    _pendingPush = chain;
    return chain;
  }

  function schedulePush() {
    if (_restoreMode) return;
    if (!_user || !_familyId || _initializing) return;
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(function () { _pushTimer = 0; syncAll(); }, 2000);
  }

  /* ---------- 拉取合并 ---------- */
  function recomputePoints(cs) {
    var sum = 0;
    (cs.pointsHistory || []).forEach(function (e) {
      if (!e) return;
      var a = Math.abs(e.amount || 0);
      if (POSITIVE_LEDGER_TYPES[e.type]) sum += a;
      else if (e.type === 'spend' || e.type === 'revoke') sum -= a;
    });
    cs.points = sum > 0 ? sum : 0;
  }

  /* Read deterministic pages instead of silently truncating at the API row limit. */
  function readRows(table, cid) {
    var rows = [], offset = 0, size = 500;
    var fid = _familyId;
    function next() {
      var query = client.from(table).select('*').eq('family_id', fid);
      if (cid != null) query = query.eq('child_id', cid);
      if (table === 'checkins') query = query.order('day').order('task_id');
      else query = query.order(table === 'children' ? 'child_id' : 'client_id');
      return request(query.range(offset, offset + size - 1)).then(function (r) {
        if (r.error) throw r.error;
        var page = r.data || [];
        rows = rows.concat(page);
        if (page.length < size) return { data: rows, error: null };
        offset += page.length;
        return next();
      });
    }
    return next();
  }

  /* 云端孩子 → 本地新记录（新设备场景） */
  function buildChildFromCloud(ck) {
    var cid = ck.child_id;
    return Promise.all([
      readRows('points_ledger', cid),
      readRows('checkins', cid),
      readRows('redemptions', cid),
      request(client.from('child_task_config').select('data,updated_at').eq('family_id', _familyId).eq('child_id', cid).maybeSingle())
    ]).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      if (rs[1].error) throw rs[1].error;
      if (rs[2].error) throw rs[2].error;
      if (rs[3].error) throw rs[3].error;
      var ledger = rs[0].data || [], cks = rs[1].data || [], reds = rs[2].data || [], cfg = rs[3].data;
      var pointsHistory = ledger.map(function (l) {
        return {
          id: l.client_id, type: l.type, amount: Math.abs(l.amount || 0),
          desc: l.description || '', time: Date.parse(l.occurred_at) || Date.now(),
          reason: l.reason || undefined, refId: l.ref_id || undefined,
          revoked: l.revoked === true ? true : undefined
        };
      });
      var checkins = {};
      cks.forEach(function (r) {
        checkins[r.day] = checkins[r.day] || {};
        checkins[r.day][r.task_id] = {
          completed: r.completed !== false, time: Date.parse(r.client_updated_at) || Date.now(),
          points: r.points || 0, option: r.option || undefined,
          historyId: r.history_client_id || undefined
        };
      });
      var redemptions = reds.map(function (r) {
        return {
          id: r.client_id, rewardId: r.reward_id || '', name: r.name,
          cost: r.cost || 0, time: Date.parse(r.occurred_at) || Date.now(),
          status: r.status || 'done'
        };
      });
      return {
        profile: {
          id: cid, name: ck.name, gender: ck.gender || '', grade: ck.grade || '',
          avatar: ck.avatar || '', banner: ck.banner || ''
        },
        cs: {
          points: Math.max(0, ck.points || 0), pointsHistory: pointsHistory,
          checkins: checkins, redemptions: redemptions,
          taskConfig: (cfg && cfg.data) ? cfg.data : { overrides: {}, custom: [] }
        },
        cfgUpdatedAt: (cfg && cfg.updated_at) ? cfg.updated_at : null
      };
    });
  }

  /* 已存在孩子：云端流水/打卡/兑换按幂等键并入本地，余额按符号规则重算；
     任务配置按哈希门控规则：云端更新且本地自上次同步后未改 → 采纳云端 */
  function mergeChildFromCloud(cid, cb, syncSt) {
    return Promise.all([
      readRows('points_ledger', cid),
      readRows('checkins', cid),
      readRows('redemptions', cid),
      request(client.from('child_task_config').select('data,updated_at').eq('family_id', _familyId).eq('child_id', cid).maybeSingle())
    ]).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      if (rs[1].error) throw rs[1].error;
      if (rs[2].error) throw rs[2].error;
      if (rs[3].error) throw rs[3].error;
      var changed = false;
      var cs = cb;
      /* 流水并集（client_id 幂等） */
      var known = {};
      (cs.pointsHistory || []).forEach(function (e) { if (e && e.id) known[String(e.id)] = e; });
      (rs[0].data || []).forEach(function (l) {
        var existing = known[String(l.client_id)];
        if (existing) {
          if (l.revoked === true && existing.revoked !== true) { existing.revoked = true; changed = true; }
          return;
        }
        cs.pointsHistory.push({
          id: l.client_id, type: l.type, amount: Math.abs(l.amount || 0),
          desc: l.description || '', time: Date.parse(l.occurred_at) || Date.now(),
          reason: l.reason || undefined, refId: l.ref_id || undefined,
          revoked: l.revoked === true ? true : undefined
        });
        changed = true;
      });
      cs.pointsHistory.forEach(function (e) {
        if (e.type === 'revoke' && e.refId && known[String(e.refId)] && !known[String(e.refId)].revoked) {
          known[String(e.refId)].revoked = true; changed = true;
        }
      });
      if (changed) cs.pointsHistory.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
      /* 打卡：云端较新则采纳 */
      (rs[1].data || []).forEach(function (r) {
        cs.checkins[r.day] = cs.checkins[r.day] || {};
        var local = cs.checkins[r.day][r.task_id];
        var cloudT = Date.parse(r.client_updated_at) || 0;
        if (!local || cloudT > (local.time || 0)) {
          cs.checkins[r.day][r.task_id] = {
            completed: r.completed !== false, time: cloudT || Date.now(),
            points: r.points || 0, option: r.option || undefined,
            historyId: r.history_client_id || undefined
          };
          changed = true;
        }
      });
      /* 兑换并集 */
      var knownR = {};
      (cs.redemptions || []).forEach(function (r) { if (r && r.id) knownR[String(r.id)] = 1; });
      (rs[2].data || []).forEach(function (r) {
        if (knownR[String(r.client_id)]) return;
        cs.redemptions.push({
          id: r.client_id, rewardId: r.reward_id || '', name: r.name,
          cost: r.cost || 0, time: Date.parse(r.occurred_at) || Date.now(),
          status: r.status || 'done'
        });
        changed = true;
      });
      if (changed) recomputePoints(cs);
      /* 任务配置采纳：云端 updated_at 前进且本地自上次同步后未改（哈希一致） */
      var cfgRow = rs[3].data;
      if (cfgRow && cfgRow.data && syncSt) {
        var key = 'task:' + cid;
        var meta = _cfgMeta(syncSt)[key];
        if (meta && meta.h === _hashCfg(cb.taskConfig || {}) &&
            (Date.parse(cfgRow.updated_at) || 0) > (Date.parse(meta.cloud) || 0)) {
          cb.taskConfig = cfgRow.data;
          _cfgMeta(syncSt)[key] = { h: _hashCfg(cfgRow.data), cloud: cfgRow.updated_at };
          changed = true;
        }
      }
      return changed;
    });
  }

  function pullAndMerge() {
    if (_restoreMode && !_restoreRequested) return Promise.resolve(false);
    if (!_user || !_familyId) { _lastError = '未登录或无家庭'; _notify(); return Promise.resolve(false); }
    if (_pulling) return _pendingPull; /* 合并到同一个 pending Pull */
    if (_pushing) return _pendingPush.then(function () { return _lastError ? false : pullAndMerge(); });
    var st = (typeof getAppState === 'function') ? getAppState() : null;
    if (!st) { _lastError = '本地状态不可用'; _notify(); return Promise.resolve(false); }
    var workingState = st;
    if (_restoreMode) {
      st = JSON.parse(JSON.stringify(st));
      st.rewardConfig = { overrides: {}, custom: [] };
    }
    _pulling = true; _lastError = ''; _notify();
    var fid = _familyId;
    var changedAny = false;
    var syncSt = _loadLocal();
    /* 加入家庭后的首次拉取：一切以云端为准（资料/配置无条件采纳），
       拉取成功后清除该标记恢复正常同步 */
    var adoptFid = (syncSt.adoptCloudOnce === fid) ? fid : null;
    /* 首次同步引导：本设备从未同步过（无游标）且云端家庭已有数据时，
       说明是"后来加入的设备"——登录后第一次拉取以云端为准（资料/配置
       无条件采纳，流水/打卡/兑换并集合并），避免本机旧种子数据反向
       覆盖云端。云端为空则走既有迁移路径（首台设备上传本地数据）。 */
    var bootAdopt = !adoptFid && !syncSt.initialized;

    var chain = request(client.from('family_settings').select('migration_state').eq('family_id', fid).maybeSingle())
      .then(function (r0) {
        if (r0.error) throw r0.error;
        var done = !!(r0.data && r0.data.migration_state && r0.data.migration_state.status === 'done');
        return readRows('children').then(function (r1) {
          if (r1.error) throw r1.error;
          var cloudKids = r1.data || [];
          if (_restoreMode && !cloudKids.length) throw new Error('云端没有孩子数据，已停止恢复，本机数据未更改');
          var cloudIds = {};
          cloudKids.forEach(function (ck) { cloudIds[ck.child_id] = 1; });

          var effAdopt = adoptFid || (bootAdopt && (done || cloudKids.length > 0));
          if (effAdopt && !adoptFid) {
            /* 首登采纳前备份本机业务数据（一次性保险，不覆盖已有备份；
               全新设备无业务数据时不写空备份——键缺失=无需恢复） */
            try {
              var rawBiz = localStorage.getItem(BIZ_KEY);
              if (rawBiz && !localStorage.getItem('sga_pre_adopt_backup_v1')) {
                localStorage.setItem('sga_pre_adopt_backup_v1', rawBiz);
              }
            } catch (e) {}
          }

          var jobs = cloudKids.map(function (ck) {
            var cid = ck.child_id;
            /* A previously synced child missing locally is a pending local deletion. */
            if (!effAdopt && Array.isArray(syncSt.childIds) &&
                syncSt.childIds.indexOf(cid) !== -1 && !st.children[cid]) return Promise.resolve();
            if (effAdopt) {
              return buildChildFromCloud(ck).then(function (built) {
                st.children[cid] = built.cs;
                st.childrenList = st.childrenList.filter(function (c) { return c.id !== cid; });
                st.childrenList.push(built.profile);
                _cfgMeta(syncSt)['task:' + cid] = { h: _hashCfg(built.cs.taskConfig), cloud: built.cfgUpdatedAt };
                _cfgMeta(syncSt)['prof:' + cid] = { h: _hashCfg(_profObj(built.profile)), cloud: ck.updated_at || null };
                changedAny = true;
              });
            }
            if (st.children[cid]) {
              var prof = null;
              for (var pi = 0; pi < st.childrenList.length; pi++) {
                if (st.childrenList[pi] && st.childrenList[pi].id === cid) { prof = st.childrenList[pi]; break; }
              }
              if (prof) {
                var pKey = 'prof:' + cid;
                if (effAdopt) {
                  /* 加入家庭/首登引导：孩子资料无条件采纳云端 */
                  var changedProf = false;
                  if (prof.name !== ck.name) { prof.name = ck.name; changedProf = true; }
                  if ((prof.gender || '') !== (ck.gender || '')) { prof.gender = ck.gender || ''; changedProf = true; }
                  if ((prof.grade || '') !== (ck.grade || '')) { prof.grade = ck.grade || ''; changedAny = changedProf = true; }
                  if ((prof.avatar || '') !== (ck.avatar || '')) { prof.avatar = ck.avatar || ''; changedProf = true; }
                  if ((prof.banner || '') !== (ck.banner || '')) { prof.banner = ck.banner || ''; changedProf = true; }
                  if (changedProf) changedAny = true;
                  _cfgMeta(syncSt)[pKey] = { h: _hashCfg(_profObj(ck)), cloud: ck.updated_at || null };
                } else {
                  /* 常规路径：云端更新且本地自上次同步后未改（哈希一致）→ 采纳云端资料 */
                  var pM = _cfgMeta(syncSt)[pKey];
                  if (pM && pM.h === _hashCfg(_profObj(prof)) &&
                      (Date.parse(ck.updated_at) || 0) > (Date.parse(pM.cloud) || 0)) {
                    prof.name = ck.name;
                    prof.gender = ck.gender || '';
                    prof.grade = ck.grade || '';
                    prof.avatar = ck.avatar || '';
                    prof.banner = ck.banner || '';
                    _cfgMeta(syncSt)[pKey] = { h: _hashCfg(_profObj(ck)), cloud: ck.updated_at };
                    changedAny = true;
                  }
                }
              }
              if (effAdopt) {
                /* 预置游标：本地配置视为"自上次同步未改且云端较新"，强制采纳云端 */
                _cfgMeta(syncSt)['task:' + cid] = {
                  h: _hashCfg(st.children[cid].taskConfig || {}),
                  cloud: '1970-01-01T00:00:00.000Z'
                };
              }
              return mergeChildFromCloud(cid, st.children[cid], syncSt).then(function (changed) {
                if (changed) changedAny = true;
              });
            }
            return buildChildFromCloud(ck).then(function (built) {
              if (st.children[cid]) return; /* 合并期间出现，跳过 */
              st.children[cid] = built.cs;
              st.childrenList.push(built.profile);
              _cfgMeta(syncSt)['task:' + cid] = { h: _hashCfg(built.cs.taskConfig), cloud: built.cfgUpdatedAt };
              _cfgMeta(syncSt)['prof:' + cid] = { h: _hashCfg(_profObj(built.profile)), cloud: ck.updated_at || null };
              changedAny = true;
            });
          });

          return Promise.all(jobs).then(function () {
            if (effAdopt) {
              st.childrenList = st.childrenList.filter(function (c) { return cloudIds[c.id]; });
              Object.keys(st.children).forEach(function (id) { if (!cloudIds[id]) delete st.children[id]; });
              if (!cloudIds[st.currentChildId]) st.currentChildId = st.childrenList.length ? st.childrenList[0].id : '';
              st.parentVerified = false; st.parentVerifyUntil = 0;
              changedAny = true;
            }
            /* 迁移已完成时，云端缺失的孩子视为已在其他设备删除。
               但只删除"上次已推送过"的孩子：本地新建尚未推送的孩子
               （不在 childIds 里）不能当作他人删除，否则 syncAll 先拉后推
               时，刚建好的孩子会被自己的拉取删掉（E2E 已复现该数据丢失）。 */
            if (done && Array.isArray(st.childrenList)) {
              var knownIds = Array.isArray(syncSt.childIds) ? syncSt.childIds : [];
              var known = {};
              knownIds.forEach(function (kid) { known[kid] = 1; });
              var toDelete = st.childrenList.filter(function (c) {
                if (cloudIds[c.id]) return false;
                return known[c.id] === 1;
              }).map(function (c) { return c.id; });
              if (toDelete.length && typeof deleteChild === 'function') {
                toDelete.forEach(function (cid) { deleteChild(cid); });
                changedAny = true;
              }
            }
            /* 家庭共享奖励配置：本地缺失 → 取云端；
               云端更新且本地自上次同步后未改 → 采纳云端 */
            return request(client.from('family_reward_config').select('data,updated_at').eq('family_id', fid).maybeSingle())
              .then(function (r2) {
                if (r2.error) throw r2.error;
                var row = r2.data;
                if (!row || !row.data) return;
                /* 加入家庭/首登引导：家庭共享奖励配置同样无条件采纳云端 */
                if (effAdopt) {
                  _cfgMeta(syncSt).reward = {
                    h: _hashCfg(st.rewardConfig || {}),
                    cloud: '1970-01-01T00:00:00.000Z'
                  };
                }
                if (!st.rewardConfig) {
                  st.rewardConfig = row.data;
                  _cfgMeta(syncSt).reward = { h: _hashCfg(row.data), cloud: row.updated_at };
                  changedAny = true;
                  return;
                }
                var meta = _cfgMeta(syncSt).reward;
                if (meta && meta.h === _hashCfg(st.rewardConfig) &&
                    (Date.parse(row.updated_at) || 0) > (Date.parse(meta.cloud) || 0)) {
                  st.rewardConfig = row.data;
                  _cfgMeta(syncSt).reward = { h: _hashCfg(row.data), cloud: row.updated_at };
                  changedAny = true;
                }
              });
          });
        });
      })
      .then(function () {
        if (_restoreMode) {
          var restoredData = JSON.stringify(st);
          localStorage.setItem(BIZ_KEY, restoredData);
          if (localStorage.getItem(BIZ_KEY) !== restoredData) throw new Error('恢复数据未能保存到本机，已停止恢复');
        }
        /* 加入家庭首拉完成：清除 adopt 标记，本设备恢复正常推送。
           失败路径保留标记，下次拉取继续以云端为准，期间推送保持禁止 */
        if (syncSt.adoptCloudOnce === fid) {
          syncSt.familyId = fid;
          delete syncSt.adoptCloudOnce;
          _saveLocal(syncSt);
        }
        /* 拉取成功即标记"已初始化"：此后本设备走常规哈希门控双向同步 */
        if (!syncSt.initialized) {
          syncSt.initialized = true;
          _saveLocal(syncSt);
        }
        if (changedAny) {
          if (_restoreMode) {
            Object.keys(workingState).forEach(function (key) { delete workingState[key]; });
            Object.keys(st).forEach(function (key) { workingState[key] = st[key]; });
            st = workingState;
          }
          /* Register cloud-only children so their normal task buttons work immediately. */
          if (typeof registerChildBuiltinTasks === 'function' && typeof getBuiltinTasks === 'function') {
            st.childrenList.forEach(function (c) {
              registerChildBuiltinTasks(c.id, getBuiltinTasks(c.id).map(function (t) { return { id: t.id, points: t.points }; }));
            });
          }
          if (typeof saveState === 'function') saveState(st);
          _saveLocal(syncSt);
          _lastSyncAt = Date.now();
          if (typeof render === 'function') { try { render(); } catch (e) {} }
        }
        return changedAny;
      })
      .catch(function (err) {
        _lastError = String((err && err.message) || err);
        return false;
      })
      .then(function (ok) { _pulling = false; _pendingPull = null; _notify(); return ok; });
    _pendingPull = chain;
    return chain;
  }

  function syncAll() {
    if (_restoreMode) return Promise.resolve(_restoreComplete);
    if (!_user) { _lastError = '请先登录'; _notify(); return Promise.resolve(false); }
    if (_initializing && _initializationPromise) return _initializationPromise;
    if (!_familyId) return initializeFamily();
    return pullAndMerge().then(function () {
      /* 拉取失败（_lastError 非空）时不推送，防止本机旧数据覆盖云端 */
      return _lastError ? false : pushNow();
    });
  }

  function restoreCloudToLocal() {
    if (!_restoreMode) return Promise.resolve(false);
    if (_restorePending) return _restorePending;
    if (!_user || !_familyId || _initializing) { _lastError = '请先登录并等待账号准备完成'; _notify(); return Promise.resolve(false); }
    var previousCursor = _loadLocal();
    try {
      if (!_restoreBackupKey) {
        var raw = JSON.stringify(getAppState());
        var backupKey = BIZ_KEY + '_before_cloud_restore_' + Date.now();
        localStorage.setItem(backupKey, raw);
        if (localStorage.getItem(backupKey) !== raw) throw new Error('本机备份保存失败，已停止恢复');
        _restoreBackupKey = backupKey;
      }
      var cursor = _loadLocal(); cursor.adoptCloudOnce = _familyId;
      localStorage.setItem(SYNC_KEY, JSON.stringify(cursor));
    } catch (error) { _lastError = String(error.message || error); _notify(); return Promise.resolve(false); }
    _restoreRequested = true; _restoreComplete = false;
    _restorePending = pullAndMerge().then(function () {
      _restoreComplete = !_lastError;
      if (!_restoreComplete) _saveLocal(previousCursor);
      return _restoreComplete;
    }).finally(function () {
      _restoreRequested = false; _restorePending = null; _notify();
      if (typeof render === 'function') render();
    });
    return _restorePending;
  }

  /* Leave the SDK auth callback before a query can acquire its session lock. */
  function initializeFamily() {
    if (_initializing && _initializationPromise) return _initializationPromise;
    if (!_user) return Promise.resolve(false);
    var userId = _user.id;
    _initializing = true; _familyUserId = userId; _lastError = '';
    var pending = new Promise(function (resolve) { setTimeout(resolve, 0); })
      .then(function () {
        if (!_restoreMode) return ensureFamily();
        return request(client.from('family_members').select('family_id').eq('user_id', userId).maybeSingle()).then(function (result) {
          if (result.error) throw result.error;
          if (!result.data || !result.data.family_id) throw new Error('此账号没有现有云端家庭，请核对登录账号');
          return result.data.family_id;
        });
      })
      .then(function (fid) {
        if (!_user || _user.id !== userId) throw new Error('登录状态已变化，请重试');
        if (_restoreMode) { _familyId = fid; return false; }
        bindFamily(fid); _familyId = fid;
        return pullAndMerge();
      }).then(function () {
        return _restoreMode ? !_lastError : (_lastError ? false : pushNow());
      }).catch(function (error) {
        if (_user && _user.id === userId) _lastError = String((error && error.message) || error);
        return false;
      }).then(function (ok) {
        if (_initializationPromise === pending) {
          _initializing = false; _initializationPromise = null; _notify();
        }
        return ok;
      });
    _initializationPromise = pending;
    return pending;
  }

  /* ---------- 事件接线 ---------- */
  if (client) {
    client.auth.onAuthStateChange(function (event, session) {
      _user = (session && session.user) ? { id: session.user.id, email: session.user.email } : null;
      if (!_user) {
        _familyId = null; _familyUserId = null; _initializing = false;
        _lastError = ''; _notify();
        return;
      }
      /* 重复事件（SIGNED_IN 回声 / TOKEN_REFRESHED）不得清空 _familyId：
         若先置空再因 _initializing 提前返回，familyId 会被永久留在 null，
         设备停留在"已登录但静默失联"状态，推送与拉取全部空转
         （多设备同步失效的第二个根因，已在 E2E 中实际复现） */
      if (_familyId && _familyUserId === _user.id) return;
      if (_initializing) { _familyUserId = _user.id; return; }
      initializeFamily();
    });
    /* 每次本地保存 → 防抖推送 */
    if (typeof window.saveState === 'function') {
      var _origSaveState = window.saveState;
      window.saveState = function (state) {
        var r = _origSaveState(state);
        schedulePush();
        return r;
      };
    }
    /* 回到前台 → 先拉后推（多设备同步窗口）。
       切到后台/关闭页面 → 立即冲刷待推送改动：Chrome 对后台标签页的
       setTimeout 强力节流（可延迟到分钟级），防抖定时器在后台不可靠，
       不冲刷的话用户"改完信息切走"的改动会一直滞留本机不上云，
       另一台设备就永远看不到（多设备同步失效的主要根因）。 */
    function _flushPendingPush() {
      if (_pushTimer) {
        clearTimeout(_pushTimer);
        _pushTimer = 0;
        syncAll();
      }
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { _flushPendingPush(); return; }
      if (_user && _familyId) syncAll();
    });
    window.addEventListener('pagehide', _flushPendingPush);
  }

  return {
    available: available,
    status: status,
    onChange: onChange,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    resendConfirmationEmail: resendConfirmationEmail,
    pushNow: pushNow,
    pullAndMerge: pullAndMerge,
    syncAll: syncAll,
    restoreCloudToLocal: restoreCloudToLocal,
    getFamilyInfo: getFamilyInfo,
    regenerateInviteCode: regenerateInviteCode,
    joinFamily: joinFamily
  };
})();
