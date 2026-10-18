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
 * ============================================================ */
var SGASync = (function () {
  'use strict';

  var client = null;
  try {
    if (typeof SGA_SUPABASE_URL === 'string' && SGA_SUPABASE_URL &&
        typeof SGA_SUPABASE_ANON_KEY === 'string' && SGA_SUPABASE_ANON_KEY &&
        typeof window.supabase !== 'undefined' && window.supabase &&
        typeof window.supabase.createClient === 'function') {
      client = window.supabase.createClient(SGA_SUPABASE_URL, SGA_SUPABASE_ANON_KEY);
    }
  } catch (e) { client = null; }

  var SYNC_KEY = 'sga_cloud_sync_state'; /* 本设备同步游标（非应用业务数据） */
  /* 应用业务数据键：与 store.js 的 STORAGE_KEY 同源，只读引用，绝不修改其定义 */
  var BIZ_KEY = (typeof STORAGE_KEY !== 'undefined' && STORAGE_KEY) ? STORAGE_KEY : 'student_growth_app_v1';
  var VALID_LEDGER_TYPES = { earn: 1, bonus: 1, initial: 1, spend: 1, revoke: 1 };
  var POSITIVE_LEDGER_TYPES = { earn: 1, bonus: 1, initial: 1 };

  var _user = null;
  var _familyId = null;
  var _syncing = false;
  var _lastError = '';
  var _lastSyncAt = 0;
  var _listeners = [];
  var _pushTimer = 0;
  var _initializing = false;

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
      syncing: _syncing,
      lastError: _lastError,
      lastSyncAt: _lastSyncAt
    };
  }
  function onChange(fn) { _listeners.push(fn); }
  function _notify() { _listeners.forEach(function (fn) { try { fn(status()); } catch (e) {} }); }

  /* ---------- 认证 ---------- */
  function signUp(email, password) {
    if (!available()) return Promise.reject(new Error('云同步组件未加载'));
    return client.auth.signUp({ email: email, password: password });
  }
  function signIn(email, password) {
    if (!available()) return Promise.reject(new Error('云同步组件未加载'));
    return client.auth.signInWithPassword({ email: email, password: password });
  }
  function signOut() {
    if (!available()) return Promise.reject(new Error('云同步组件未加载'));
    return client.auth.signOut();
  }

  /* ---------- 家庭绑定 ----------
     使用 0003 迁移的 ensure_my_family() RPC：advisory lock 原子化，
     避免多标签页/多设备同时首登时重复建家（前端两步查+建有竞态）。 */
  function ensureFamily() {
    return client.rpc('ensure_my_family').then(function (res) {
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
      client.from('families').select('id,owner_id,invite_code').eq('id', _familyId).maybeSingle(),
      client.from('family_members').select('user_id,email,joined_at').eq('family_id', _familyId)
        .order('joined_at', { ascending: true })
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
    return client.rpc('regenerate_my_invite_code').then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  function joinFamily(code) {
    if (!_user) return Promise.reject(new Error('请先登录'));
    var c = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(c)) return Promise.reject(new Error('请输入 6 位邀请码'));
    return client.rpc('join_family_by_code', { p_code: c }).then(function (res) {
      if (res.error) throw res.error;
      var fid = res.data;
      if (!fid) throw new Error('加入失败：服务器未返回家庭标识');
      _familyId = fid;
      /* 整体替换：本机业务数据与游标作废；写入 adopt 标记供重启后首拉使用 */
      try { localStorage.removeItem(BIZ_KEY); } catch (e) {}
      _saveLocal({ adoptCloudOnce: fid });
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

  /* ---------- 推送（增量：流水/打卡/兑换按时间游标，配置按内容哈希门控）---------- */
  function pushNow() {
    if (!_user || !_familyId || _syncing) return Promise.resolve(false);
    /* 加入家庭后的首拉完成前禁止一切推送：本机仍是种子/旧数据，
       回写会覆盖家庭云端真实数据（adoptCloudOnce 游标由 pullAndMerge 清除） */
    if (_loadLocal().adoptCloudOnce) return Promise.resolve(false);
    var st = (typeof getAppState === 'function') ? getAppState() : null;
    if (!st || !Array.isArray(st.childrenList)) return Promise.resolve(false);
    _syncing = true; _lastError = ''; _notify();
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

    /* 2) 孩子资料（含余额快照；云端最终以触发器重算为准） */
    var childrenRows = st.childrenList.map(function (c, i) {
      var cs = st.children[c.id] || {};
      return {
        family_id: fid, child_id: c.id, name: c.name,
        gender: c.gender || null, grade: c.grade || null,
        avatar: c.avatar || null, banner: c.banner || null,
        sort_order: i, points: cs.points || 0, updated_at: nowIso
      };
    });
    var childrenJob = childrenRows.length
      ? client.from('children').upsert(childrenRows)
      : Promise.resolve({ error: null });

    return delJob.then(function (r) { if (r.error) throw r.error; return childrenJob; })
      .then(function (r) {
        if (r.error) throw r.error;
        var jobs = [];
        var cfgMetaUpdates = []; /* 推送成功后才落游标，失败下轮重试 */
        st.childrenList.forEach(function (c) {
          var cs = st.children[c.id];
          if (!cs) return;
          /* 积分流水（追加式，按游标增量） */
          var led = (cs.pointsHistory || []).filter(function (e) {
            return e && e.id && VALID_LEDGER_TYPES[e.type] && (!minTime || (e.time || 0) > minTime);
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
        jobs.push(client.from('family_settings').upsert({ family_id: fid, migration_state: { status: 'done' } }));
        return Promise.all(jobs.map(function (j) {
          return j.then(function (r) { if (r && r.error) throw r.error; });
        })).then(function () { return cfgMetaUpdates; });
      })
      .then(function (cfgMetaUpdates) {
        cfgMetaUpdates.forEach(function (u) { _cfgMeta(syncSt)[u.key] = { h: u.h, cloud: nowIso }; });
        /* 清理已删除孩子的配置游标 */
        if (syncSt.cfg) {
          Object.keys(syncSt.cfg).forEach(function (k) {
            if (k.indexOf('task:') === 0 && curIds.indexOf(k.slice(5)) === -1) delete syncSt.cfg[k];
          });
        }
        syncSt.childIds = curIds;
        syncSt.lastPushAt = Date.now();
        _saveLocal(syncSt);
        _lastSyncAt = Date.now();
        return true;
      })
      .catch(function (err) {
        _lastError = String((err && err.message) || err);
        return false;
      })
      .then(function (ok) { _syncing = false; _notify(); return ok; });
  }

  function schedulePush() {
    if (!_user || !_familyId) return;
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(function () { _pushTimer = 0; pushNow(); }, 2000);
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

  /* 云端孩子 → 本地新记录（新设备场景） */
  function buildChildFromCloud(ck) {
    var cid = ck.child_id;
    return Promise.all([
      client.from('points_ledger').select('*').eq('family_id', _familyId).eq('child_id', cid)
        .order('occurred_at', { ascending: false }),
      client.from('checkins').select('*').eq('family_id', _familyId).eq('child_id', cid),
      client.from('redemptions').select('*').eq('family_id', _familyId).eq('child_id', cid)
        .order('occurred_at', { ascending: false }),
      client.from('child_task_config').select('data,updated_at').eq('family_id', _familyId).eq('child_id', cid).maybeSingle()
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
      client.from('points_ledger').select('*').eq('family_id', _familyId).eq('child_id', cid)
        .order('occurred_at', { ascending: false }),
      client.from('checkins').select('*').eq('family_id', _familyId).eq('child_id', cid),
      client.from('redemptions').select('*').eq('family_id', _familyId).eq('child_id', cid)
        .order('occurred_at', { ascending: false }),
      client.from('child_task_config').select('data,updated_at').eq('family_id', _familyId).eq('child_id', cid).maybeSingle()
    ]).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      if (rs[1].error) throw rs[1].error;
      if (rs[2].error) throw rs[2].error;
      if (rs[3].error) throw rs[3].error;
      var changed = false;
      var cs = cb;
      /* 流水并集（client_id 幂等） */
      var known = {};
      (cs.pointsHistory || []).forEach(function (e) { if (e && e.id) known[String(e.id)] = 1; });
      (rs[0].data || []).forEach(function (l) {
        if (known[String(l.client_id)]) return;
        cs.pointsHistory.push({
          id: l.client_id, type: l.type, amount: Math.abs(l.amount || 0),
          desc: l.description || '', time: Date.parse(l.occurred_at) || Date.now(),
          reason: l.reason || undefined, refId: l.ref_id || undefined,
          revoked: l.revoked === true ? true : undefined
        });
        changed = true;
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
    if (!_user || !_familyId || _syncing) return Promise.resolve(false);
    var st = (typeof getAppState === 'function') ? getAppState() : null;
    if (!st) return Promise.resolve(false);
    _syncing = true; _notify();
    var fid = _familyId;
    var changedAny = false;
    var syncSt = _loadLocal();
    /* 加入家庭后的首次拉取：一切以云端为准（资料/配置无条件采纳），
       拉取成功后清除该标记恢复正常同步 */
    var adoptFid = (syncSt.adoptCloudOnce === fid) ? fid : null;

    return client.from('family_settings').select('migration_state').eq('family_id', fid).maybeSingle()
      .then(function (r0) {
        if (r0.error) throw r0.error;
        var done = !!(r0.data && r0.data.migration_state && r0.data.migration_state.status === 'done');
        return client.from('children').select('*').eq('family_id', fid).then(function (r1) {
          if (r1.error) throw r1.error;
          var cloudKids = r1.data || [];
          var cloudIds = {};
          cloudKids.forEach(function (ck) { cloudIds[ck.child_id] = 1; });

          var jobs = cloudKids.map(function (ck) {
            var cid = ck.child_id;
            if (st.children[cid]) {
              if (adoptFid) {
                /* 加入家庭首拉：孩子资料无条件采纳云端 */
                var prof = null;
                for (var pi = 0; pi < st.childrenList.length; pi++) {
                  if (st.childrenList[pi] && st.childrenList[pi].id === cid) { prof = st.childrenList[pi]; break; }
                }
                if (prof) {
                  if (prof.name !== ck.name) { prof.name = ck.name; changedAny = true; }
                  if ((prof.gender || '') !== (ck.gender || '')) { prof.gender = ck.gender || ''; changedAny = true; }
                  if ((prof.grade || '') !== (ck.grade || '')) { prof.grade = ck.grade || ''; changedAny = true; }
                  if ((prof.avatar || '') !== (ck.avatar || '')) { prof.avatar = ck.avatar || ''; changedAny = true; }
                  if ((prof.banner || '') !== (ck.banner || '')) { prof.banner = ck.banner || ''; changedAny = true; }
                }
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
              changedAny = true;
            });
          });

          return Promise.all(jobs).then(function () {
            /* 迁移已完成时，云端缺失的孩子视为已在其他设备删除 */
            if (done && Array.isArray(st.childrenList)) {
              var toDelete = st.childrenList.filter(function (c) { return !cloudIds[c.id]; })
                .map(function (c) { return c.id; });
              if (toDelete.length && typeof deleteChild === 'function') {
                toDelete.forEach(function (cid) { deleteChild(cid); });
                changedAny = true;
              }
            }
            /* 家庭共享奖励配置：本地缺失 → 取云端；
               云端更新且本地自上次同步后未改 → 采纳云端 */
            return client.from('family_reward_config').select('data,updated_at').eq('family_id', fid).maybeSingle()
              .then(function (r2) {
                if (r2.error) throw r2.error;
                var row = r2.data;
                if (!row || !row.data) return;
                /* 加入家庭首拉：家庭共享奖励配置同样无条件采纳云端 */
                if (adoptFid) {
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
        /* 加入家庭首拉完成：清除 adopt 标记，本设备恢复正常推送。
           失败路径保留标记，下次拉取继续以云端为准，期间推送保持禁止 */
        if (syncSt.adoptCloudOnce === fid) {
          delete syncSt.adoptCloudOnce;
          _saveLocal(syncSt);
        }
        if (changedAny) {
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
      .then(function (ok) { _syncing = false; _notify(); return ok; });
  }

  function syncAll() {
    if (!_user || !_familyId) return Promise.resolve(false);
    return pullAndMerge().then(function () { return pushNow(); });
  }

  /* ---------- 事件接线 ---------- */
  if (client) {
    client.auth.onAuthStateChange(function (event, session) {
      _user = (session && session.user) ? { id: session.user.id, email: session.user.email } : null;
      _familyId = null;
      _lastError = '';
      if (_user) {
        if (_initializing) return;
        _initializing = true;
        ensureFamily().then(function (fid) {
          _familyId = fid;
          return pullAndMerge();
        }).then(function () {
          /* 登录后立即推送一次：首登把本地数据迁移上云；后续登录为空增量，幂等 */
          return pushNow();
        }).then(function () {
          _initializing = false;
          _notify();
        }).catch(function (err) {
          _initializing = false;
          _lastError = String((err && err.message) || err);
          _notify();
        });
      } else {
        _notify();
      }
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
    /* 回到前台 → 先拉后推（多设备同步窗口） */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && _user && _familyId) syncAll();
    });
  }

  return {
    available: available,
    status: status,
    onChange: onChange,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    pushNow: pushNow,
    pullAndMerge: pullAndMerge,
    syncAll: syncAll,
    getFamilyInfo: getFamilyInfo,
    regenerateInviteCode: regenerateInviteCode,
    joinFamily: joinFamily
  };
})();
