const STORAGE_KEY = 'student_growth_app_v1';
/* 损坏数据备份键：JSON 无法解析时，原始串先备份到这里，绝不静默覆盖 */
const BACKUP_KEY = STORAGE_KEY + '_backup';

function defaultChildState() {
  return { points: 0, pointsHistory: [], checkins: {}, redemptions: [], taskConfig: { overrides: {}, custom: [] } };
}

function defaultState() {
  const state = { currentChildId: 'yuanyuan', parentVerified: false, parentVerifyUntil: 0, children: {}, childrenList: [] };
  CHILDREN.forEach(c => { state.children[c.id] = defaultChildState(); state.childrenList.push({ ...c }); });
  return state;
}

/* ---------- 字段级规范化（P4）----------
   只修复类型错误、补齐确实缺失的字段；不改已有有效值（含 0/false/空数组）；
   未知字段原样保留；幂等，重复执行不会重复加分。 */
function normalizeChild(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const child = { ...src };
  if (typeof child.points !== 'number' || !isFinite(child.points)) {
    /* 数字字符串（如旧版 "30"）可安全推导；其余非法类型归 0 */
    const n = (typeof child.points === 'string') ? Number(child.points) : NaN;
    child.points = isFinite(n) ? n : 0;
  }
  if (!Array.isArray(child.pointsHistory)) child.pointsHistory = [];
  if (!child.checkins || typeof child.checkins !== 'object' || Array.isArray(child.checkins)) child.checkins = {};
  if (!Array.isArray(child.redemptions)) child.redemptions = [];
  /* taskConfig：任务配置层，为后续编辑/停用/自定义任务预留。
     旧数据缺失时补默认；已有合法配置原样保留，不重置。 */
  if (!child.taskConfig || typeof child.taskConfig !== 'object' || Array.isArray(child.taskConfig)) {
    child.taskConfig = { overrides: {}, custom: [] };
  } else {
    if (!child.taskConfig.overrides || typeof child.taskConfig.overrides !== 'object' || Array.isArray(child.taskConfig.overrides)) child.taskConfig.overrides = {};
    if (!Array.isArray(child.taskConfig.custom)) child.taskConfig.custom = [];
  }
  return child;
}

/* 孩子资料基础校验：id 合法且姓名非空。用于 childrenList 持久化数据过滤。 */
function _isValidChildProfile(p) {
  return !!(p && typeof p === 'object' && !Array.isArray(p)
    && typeof p.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(p.id)
    && typeof p.name === 'string' && p.name.trim());
}

function normalizeState(parsed) {
  const src = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  const state = { ...src };
  /* 孩子列表：唯一权威来源。旧数据无 childrenList 时从内置 CHILDREN 生成；
     过滤非法资料并按 id 去重（保留首个）。 */
  let list = Array.isArray(state.childrenList) ? state.childrenList.filter(_isValidChildProfile).map(p => ({ ...p })) : null;
  if (!list) list = CHILDREN.map(c => ({ ...c }));
  const seenIds = new Set();
  list = list.filter(p => { if (seenIds.has(p.id)) return false; seenIds.add(p.id); return true; });
  state.childrenList = list;
  if (!list.some(c => c.id === state.currentChildId)) state.currentChildId = list.length ? list[0].id : '';
  state.parentVerified = state.parentVerified === true;
  if (typeof state.parentVerifyUntil !== 'number' || !isFinite(state.parentVerifyUntil)) state.parentVerifyUntil = 0;
  const rawChildren = (state.children && typeof state.children === 'object' && !Array.isArray(state.children)) ? state.children : {};
  const children = { ...rawChildren }; /* 保留未知孩子 id，不擅自丢弃 */
  list.forEach(c => { children[c.id] = normalizeChild(rawChildren[c.id]); });
  state.children = children;
  return state;
}

function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
  if (!raw) return defaultState(); /* 首次启动：正常初始化 */
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    /* JSON 损坏或根类型异常（P3）：备份原始串并移出主键后返回默认态；
       原始数据保留在 BACKUP_KEY 中，不会被默认状态静默覆盖。 */
    try {
      if (localStorage.getItem(BACKUP_KEY) === null) localStorage.setItem(BACKUP_KEY, raw);
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    return defaultState();
  }
  return normalizeState(parsed);
}

function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

let _state = loadState();

/* 云同步层专用：返回当前状态对象的引用（sync.js 读取/合并用）。
   业务写入仍必须走 store 各函数，保证校验与流水一致性。 */
function getAppState() { return _state; }

/* ---------- 本地积分校验（不依赖 data.js）----------
   若 data.js 加载失败，isValidTaskPoints 不存在，store.js 不能因此抛 ReferenceError。
   注意：仅此函数有 fallback；CHILDREN 等 data.js 依赖仍会导致系统不可用。 */
function _isValidPoints(p) {
  return typeof p === 'number' && isFinite(p) && Math.floor(p) === p && p >= 1 && p <= 1000;
}

/* ---------- 任务 ID 格式校验（统一安全策略）----------
   合法 ID：1-100 位字母、数字、下划线、连字符。
   额外拒绝 Object.prototype 上的危险属性名（__proto__、constructor 等），
   即使它们匹配字符格式，也禁止作为对象键使用，避免原型污染。
   现有内置 ID（study, ask-teacher, yy-math, grade-goal 等）和自定义 ID
   （custom_<ts>_<rand>）均符合此规则。 */
const TASK_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const DANGEROUS_TASK_IDS = new Set([
  '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty',
  'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
  '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
]);
function _isValidTaskId(id) {
  return typeof id === 'string' && TASK_ID_RE.test(id) && !DANGEROUS_TASK_IDS.has(id);
}

/* ---------- 内置任务注册状态机 ----------
   store.js 不引用 data.js 的 COMMON_TASKS 等常量。
   data.js 通过 initBuiltinTaskRegistry({ childId: [{id, points}, ...] }) 一次性提交。
   状态：pending | ready | failed
   _builtinTaskRegistry: childId -> Object.create(null) 映射 { taskId: basePoints }
   _allBuiltinIds: 全部内置任务 ID 并集。
   所有注册表映射均为 Object.create(null)，规避 __proto__/constructor 等原型键。 */
let _builtinRegistryState = 'pending';
let _registryFailed = false;
const _builtinTaskRegistry = Object.create(null);
const _allBuiltinIds = new Set();

function _getKnownChildIds() {
  if (_state && Array.isArray(_state.childrenList)) return _state.childrenList.map(c => c.id);
  if (typeof CHILDREN !== 'undefined' && Array.isArray(CHILDREN)) return CHILDREN.map(c => c.id);
  if (_state && _state.children) return Object.keys(_state.children);
  return [];
}

/* 比较两个 { taskId: points } 映射（均为 Object.create(null)） */
function _mapsEqualContent(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const id of ka) {
    if (b[id] === undefined) return false;
    if (a[id] !== b[id]) return false;
  }
  return true;
}

/* 统一校验注册数据：首次初始化与 ready 重复初始化共用此规则。
   - 对象结构合法；孩子集合与已知孩子完全一致
   - 同孩子内 ID 唯一；公共任务 ID 可跨孩子共享
   - 每个 ID 必须通过 _isValidTaskId 校验
   - points 通过 _isValidPoints 校验
   返回 { ok, built, allIds } 或 { ok: false }。
   built 及其内部 localMap 均为 Object.create(null)。 */
function _validateRegistryData(registryData) {
  if (!registryData || typeof registryData !== 'object' || Array.isArray(registryData)) return { ok: false };
  const known = _getKnownChildIds();
  const keys = Object.keys(registryData);
  /* 无孩子时允许空注册表直接就绪（后续新增孩子再逐个注册） */
  if (known.length === 0) return keys.length === 0 ? { ok: true, built: Object.create(null), allIds: new Set() } : { ok: false };
  if (keys.length !== known.length || !known.every(k => keys.includes(k))) return { ok: false };
  const built = Object.create(null);
  const allIds = new Set();
  for (const cid of known) {
    const arr = registryData[cid];
    if (!Array.isArray(arr) || arr.length === 0) return { ok: false };
    const localMap = Object.create(null);
    for (const item of arr) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false };
      if (!_isValidTaskId(item.id)) return { ok: false };
      if (!_isValidPoints(item.points)) return { ok: false };
      if (localMap[item.id] !== undefined) return { ok: false };
      localMap[item.id] = item.points;
      allIds.add(item.id);
    }
    built[cid] = localMap;
  }
  return { ok: true, built, allIds };
}

/* 原子初始化内置任务注册表。
   pending + 校验失败 -> failed（不可恢复）
   pending + 校验通过 -> 一次性提交 -> ready
   ready + 相同内容 -> true（幂等）
   ready + 不同内容/校验失败 -> false（不破坏已有注册表，不设 failed）
   failed -> false */
function initBuiltinTaskRegistry(registryData) {
  if (_registryFailed) return false;
  const result = _validateRegistryData(registryData);
  if (!result.ok) {
    if (_builtinRegistryState === 'pending') {
      _registryFailed = true;
      _builtinRegistryState = 'failed';
    }
    return false;
  }
  if (_builtinRegistryState === 'ready') {
    for (const cid of Object.keys(result.built)) {
      if (!_mapsEqualContent(_builtinTaskRegistry[cid] || Object.create(null), result.built[cid])) return false;
    }
    return true;
  }
  for (const cid of Object.keys(result.built)) _builtinTaskRegistry[cid] = result.built[cid];
  for (const id of result.allIds) _allBuiltinIds.add(id);
  _builtinRegistryState = 'ready';
  return true;
}

function failBuiltinRegistry() {
  _registryFailed = true;
  _builtinRegistryState = 'failed';
}

/* 为新增孩子注册内置任务模板（仅在注册表 ready 时可用）。
   校验规则与初始化一致；全部通过才提交，失败不改动注册表。 */
function registerChildBuiltinTasks(childId, tasks) {
  if (_builtinRegistryState !== 'ready' || _registryFailed) return false;
  if (!_isValidTaskId(childId) || _builtinTaskRegistry[childId]) return false;
  if (!Array.isArray(tasks) || tasks.length === 0) return false;
  const localMap = Object.create(null);
  for (const item of tasks) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    if (!_isValidTaskId(item.id)) return false;
    if (!_isValidPoints(item.points)) return false;
    if (localMap[item.id] !== undefined) return false;
    localMap[item.id] = item.points;
  }
  _builtinTaskRegistry[childId] = localMap;
  Object.keys(localMap).forEach(id => _allBuiltinIds.add(id));
  return true;
}

/* 移除孩子的内置任务注册（删除孩子时调用），并重建 ID 并集。 */
function _unregisterChildBuiltinTasks(childId) {
  if (_builtinTaskRegistry[childId]) delete _builtinTaskRegistry[childId];
  _allBuiltinIds.clear();
  Object.keys(_builtinTaskRegistry).forEach(cid => {
    const reg = _builtinTaskRegistry[cid];
    if (reg) Object.keys(reg).forEach(id => _allBuiltinIds.add(id));
  });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* 孩子列表（资料）读取：返回浅拷贝数组，调用方修改不影响存储。 */
function getChildren() {
  const list = (_state && Array.isArray(_state.childrenList)) ? _state.childrenList : [];
  return list.map(c => ({ ...c }));
}

function getChildProfile(childId) {
  const list = (_state && Array.isArray(_state.childrenList)) ? _state.childrenList : [];
  const found = list.filter(c => c.id === childId)[0];
  return found ? { ...found } : null;
}

function getCurrentChild() {
  const list = (_state && Array.isArray(_state.childrenList)) ? _state.childrenList : [];
  if (!list.length) return null;
  const found = list.filter(c => c.id === _state.currentChildId)[0];
  return found || list[0];
}
function setCurrentChild(childId) {
  const list = (_state && Array.isArray(_state.childrenList)) ? _state.childrenList : [];
  if (list.some(c => c.id === childId)) { _state.currentChildId = childId; saveState(_state); }
}
function getChildState(childId) { return _state.children[childId]; }

/* ---------- 孩子管理（新增 / 删除 / 姓名查重）----------
   孩子资料存 _state.childrenList，个人数据存 _state.children[id]。
   新增孩子原子完成：资料与任务模板全部校验通过后才写入；
   删除孩子按 ID 清理其全部个人数据与内置任务注册，不影响其他孩子与家庭共享配置。 */

function _normalizeChildName(name) {
  return (typeof name === 'string') ? name.trim() : '';
}

/* 姓名是否已被占用：去首尾空格、不区分英文大小写。数据层唯一性防线。 */
function isChildNameTaken(name, excludeChildId) {
  const n = _normalizeChildName(name).toLowerCase();
  if (!n) return false;
  const list = (_state && Array.isArray(_state.childrenList)) ? _state.childrenList : [];
  return list.some(c => c.id !== excludeChildId && _normalizeChildName(c.name).toLowerCase() === n);
}

function _childIdExists(id) {
  const list = (_state && Array.isArray(_state.childrenList)) ? _state.childrenList : [];
  if (list.some(c => c.id === id)) return true;
  return !!(_state.children && Object.prototype.hasOwnProperty.call(_state.children, id));
}

/* 新增孩子。builtinTasks 为新孩子的默认任务模板（由 data.js 提供，与渊渊一致）；
   initialPoints 仅在建档时计入一次（>0 生成 type:'initial' 流水）。
   姓名规则：去空格后非空、≤20 字、不含 <>&"'、不与现有孩子重名。
   校验全部通过后才修改状态，失败路径无副作用。 */
function addChild(profile, builtinTasks, initialPoints) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return { success: false, reason: 'invalid_profile' };
  const name = _normalizeChildName(profile.name);
  if (!name || name.length > 20 || /[<>&"']/.test(name)) return { success: false, reason: 'invalid_name' };
  if (isChildNameTaken(name)) return { success: false, reason: 'duplicate_name' };
  if (!Array.isArray(builtinTasks) || builtinTasks.length === 0) return { success: false, reason: 'invalid_tasks' };
  const seenTask = new Set();
  for (const t of builtinTasks) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return { success: false, reason: 'invalid_tasks' };
    if (!_isValidTaskId(t.id) || !_isValidPoints(t.points)) return { success: false, reason: 'invalid_tasks' };
    if (seenTask.has(t.id)) return { success: false, reason: 'invalid_tasks' };
    seenTask.add(t.id);
  }
  if (_builtinRegistryState !== 'ready') return { success: false, reason: 'registry_not_ready' };
  const initAmount = (initialPoints === undefined || initialPoints === null) ? 0 : initialPoints;
  if (!_isValidInitialAmount(initAmount)) return { success: false, reason: 'invalid_initial_points' };
  const grade = (typeof profile.grade === 'string' && profile.grade.trim()) ? profile.grade.trim().slice(0, 10) : '未设置';
  const defAvatar = (typeof ASSETS !== 'undefined') ? ASSETS.avatarYuanyuan : '';
  const defBanner = (typeof ASSETS !== 'undefined') ? ASSETS.bannerYuanyuan : '';
  const avatar = (typeof profile.avatar === 'string' && profile.avatar) ? profile.avatar : defAvatar;
  const banner = (typeof profile.banner === 'string' && profile.banner) ? profile.banner : defBanner;
  const gender = (profile.gender === 'girl') ? 'girl' : 'boy';
  let id = null;
  for (let i = 0; i < 100; i++) {
    const candidate = 'child_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    if (!_childIdExists(candidate)) { id = candidate; break; }
  }
  if (!id) return { success: false, reason: 'id_collision' };
  /* 全部校验通过，现在才修改状态 */
  const newProfile = { id: id, name: name, gender: gender, grade: grade, avatar: avatar, banner: banner };
  _state.childrenList.push(newProfile);
  _state.children[id] = defaultChildState();
  registerChildBuiltinTasks(id, builtinTasks.map(t => ({ id: t.id, points: t.points })));
  if (initAmount > 0) {
    _state.children[id].initialPointsGranted = true;
    addPoints(id, initAmount, '初始积分', { type: 'initial' });
  }
  saveState(_state);
  return { success: true, child: { ...newProfile }, points: _state.children[id].points };
}

/* 删除孩子及其全部个人数据（按 ID，非姓名）。
   清理：资料、积分、打卡、流水、兑换、taskConfig（含排序与成绩目标配置）、内置任务注册。
   保留：其他孩子全部数据、家庭共享奖励配置、全局任务模板、家长密码与全局配置。
   删除当前选中孩子时安全切换到剩余第一个孩子；无剩余时置空。 */
function deleteChild(childId) {
  if (typeof childId !== 'string' || !childId) return { success: false, reason: 'invalid_child' };
  const list = (_state && Array.isArray(_state.childrenList)) ? _state.childrenList : [];
  if (!list.some(c => c.id === childId)) return { success: false, reason: 'not_found' };
  _state.childrenList = list.filter(c => c.id !== childId);
  if (_state.children && Object.prototype.hasOwnProperty.call(_state.children, childId)) {
    delete _state.children[childId];
  }
  _unregisterChildBuiltinTasks(childId);
  if (_state.currentChildId === childId) {
    _state.currentChildId = _state.childrenList.length ? _state.childrenList[0].id : '';
  }
  saveState(_state);
  return { success: true, removedId: childId, remaining: _state.childrenList.length };
}

function getTodayCheckins(childId) {
  const cs = getChildState(childId);
  const today = todayStr();
  /* 日记录使用 Object.create(null)，确保 __proto__/constructor 等特殊 ID
     作为自有属性读写，不触发原型链访问或原型污染。 */
  if (!cs.checkins[today]) cs.checkins[today] = Object.create(null);
  return cs.checkins[today];
}

/* 只读获取当日打卡记录，不创建空的当日对象。用于失败路径前置检查。 */
function _getTodayCheckinsReadOnly(childId) {
  const cs = getChildState(childId);
  if (!cs) return undefined;
  return cs.checkins[todayStr()];
}

function isTaskDone(childId, taskId) {
  const rec = _getTodayCheckinsReadOnly(childId);
  return !!(rec && Object.prototype.hasOwnProperty.call(rec, taskId) && rec[taskId].completed);
}

/* 只读获取 taskConfig 安全视图，不修改 cs，不写入 localStorage。 */
function _getTaskConfigReadOnly(cs) {
  if (!cs || !cs.taskConfig || typeof cs.taskConfig !== 'object' || Array.isArray(cs.taskConfig)) {
    return { overrides: {}, custom: [] };
  }
  const tc = cs.taskConfig;
  const overrides = (tc.overrides && typeof tc.overrides === 'object' && !Array.isArray(tc.overrides)) ? tc.overrides : {};
  const custom = Array.isArray(tc.custom) ? tc.custom : [];
  return { overrides, custom };
}

/* 安全读取 overrides，规避 __proto__/constructor 等原型键。
   overrides 为普通对象（来自 localStorage），必须用 hasOwnProperty。 */
function _getOverride(tc, taskId) {
  if (!tc || !tc.overrides) return undefined;
  return Object.prototype.hasOwnProperty.call(tc.overrides, taskId) ? tc.overrides[taskId] : undefined;
}

function isTaskDisabled(childId, taskId) {
  if (taskId === 'grade-goal') return false;
  if (!_isValidTaskId(taskId)) return false;
  const cs = getChildState(childId);
  if (!cs) return false;
  const tc = _getTaskConfigReadOnly(cs);
  const custom = tc.custom.find(t => t && t.id === taskId);
  if (custom) return custom.disabled === true;
  const ov = _getOverride(tc, taskId);
  return !!(ov && ov.disabled === true);
}

/* 判断 taskId 是否为该孩子的已知任务。
   注册表为 Object.create(null)，reg[taskId] 安全；
   custom 为数组遍历，非对象键访问，安全。 */
function _isKnownTask(childId, taskId) {
  if (taskId === 'grade-goal') return true;
  if (!_isValidTaskId(taskId)) return false;
  const cs = getChildState(childId);
  if (cs) {
    const tc = _getTaskConfigReadOnly(cs);
    if (tc.custom.some(t => t && t.id === taskId)) return true;
  }
  const reg = _builtinTaskRegistry[childId];
  return !!(reg && reg[taskId] !== undefined);
}

/* 从可信来源查询任务最终有效积分。
   - 自定义任务：custom.points 合法则用，否则 fallback 10（与 data.js 展示一致，不修改存储）
   - 内置任务：override.points 合法则用，否则注册表基础积分
   grade-goal 不在此处理。 */
function _getTaskPoints(childId, taskId) {
  const cs = getChildState(childId);
  if (cs) {
    const tc = _getTaskConfigReadOnly(cs);
    const custom = tc.custom.find(t => t && t.id === taskId);
    if (custom) return _isValidPoints(custom.points) ? custom.points : 10;
    const ov = _getOverride(tc, taskId);
    if (ov && _isValidPoints(ov.points)) {
      return ov.points;
    }
  }
  const reg = _builtinTaskRegistry[childId];
  if (reg && reg[taskId] !== undefined) return reg[taskId];
  return null;
}

function completeTask(childId, taskId, points, desc) {
  /* 所有校验在修改状态前完成，失败路径无副作用。
     grade-goal 走 completeGradeGoal 独立流程。 */
  if (taskId === 'grade-goal') return { success: false, reason: 'use_complete_grade_goal' };
  if (!_isValidTaskId(taskId)) return { success: false, reason: 'invalid_task_id' };
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  if (_builtinRegistryState !== 'ready') return { success: false, reason: 'registry_not_ready' };
  if (!_isKnownTask(childId, taskId)) return { success: false, reason: 'unknown_task' };
  if (isTaskDisabled(childId, taskId)) return { success: false, reason: 'task_disabled' };
  const trustedPoints = _getTaskPoints(childId, taskId);
  if (!_isValidPoints(trustedPoints)) return { success: false, reason: 'invalid_points' };
  /* 只读 already_done 检查，不创建当日对象，不修改状态 */
  const todayRec = _getTodayCheckinsReadOnly(childId);
  if (todayRec && Object.prototype.hasOwnProperty.call(todayRec, taskId) && todayRec[taskId].completed) {
    return { success: false, reason: 'already_done' };
  }
  /* 全部校验通过，现在才修改状态。
     rec 为 Object.create(null)，rec[taskId] = {...} 对 __proto__ 等特殊 ID 也安全创建自有属性。 */
  const rec = getTodayCheckins(childId);
  const hist = addPoints(childId, trustedPoints, desc || '打卡奖励');
  rec[taskId] = { completed: true, time: Math.max(Date.now(), ((rec[taskId] && Number(rec[taskId].time)) || 0) + 1), points: trustedPoints, historyId: hist.id };
  saveState(_state);
  return { success: true };
}

function isTodayTs(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === todayStr();
}

/* 撤销当天普通任务打卡：保存未完成记录 + 按原发放积分扣回 + 负向流水，三步原子完成。
   应扣积分优先取打卡快照；旧记录无快照时，仅在当天流水可唯一匹配时回退；
   金额不确定或余额不足时不改动任何数据。 */
function undoTask(childId, taskId, taskName) {
  if (taskId === 'grade-goal') return { success: false, reason: 'not_undoable' };
  if (!_isValidTaskId(taskId)) return { success: false, reason: 'invalid_task_id' };
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  /* 只读获取打卡条目，用 hasOwnProperty 规避普通对象原型键（兼容旧数据）。 */
  const rec = _getTodayCheckinsReadOnly(childId);
  const entry = (rec && Object.prototype.hasOwnProperty.call(rec, taskId)) ? rec[taskId] : undefined;
  if (!entry || !entry.completed) return { success: false, reason: 'not_done' };
  let amount = null;
  /* 使用打卡快照中的原始发放积分，不按当前任务配置重新计算 */
  if (typeof entry.points === 'number' && isFinite(entry.points)) amount = entry.points;
  else {
    const history = Array.isArray(cs.pointsHistory) ? cs.pointsHistory : [];
    const matches = history.filter(h => h && h.type === 'earn' && h.desc === taskName && isTodayTs(h.time));
    if (matches.length === 1) amount = matches[0].amount;
  }
  if (amount === null) return { success: false, reason: 'no_snapshot' };
  if (typeof cs.points !== 'number' || !isFinite(cs.points) || cs.points < amount) {
    return { success: false, reason: 'insufficient_for_revoke', amount };
  }
  /* 保留带新时间的撤销状态，供云端 upsert，防止旧的已完成记录被重新拉回。
     同一毫秒内打卡/撤销/重打卡仍须有严格递增的版本时间。 */
  rec[taskId] = { ...entry, completed: false, time: Math.max(Date.now(), (Number(entry.time) || 0) + 1) };
  cs.points -= amount;
  cs.pointsHistory.unshift({ id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), type: 'revoke', amount, desc: `撤销打卡：${taskName}`, time: Date.now() });
  saveState(_state);
  return { success: true, amount };
}

/* ---------- 成绩目标：两个选项独立积分（按孩子隔离，存于 taskConfig.gradeGoal）----------
   结构：taskConfig.gradeGoal = { top3: number, top5: number }，缺省均为 10（兼容旧数据）。
   一次操作只能选一个选项；实际发放积分在完成时写入当日记录快照，撤销按快照扣回。 */
const GRADE_GOAL_OPTION_IDS = ['top3', 'top5'];
const DEFAULT_GRADE_GOAL_POINTS = { top3: 10, top5: 10 };

/* 只读获取两个选项当前有效积分，非法/缺失回退默认值，不修改状态。 */
function getGradeGoalPointsConfig(childId) {
  const cs = getChildState(childId);
  const raw = cs && cs.taskConfig ? cs.taskConfig.gradeGoal : undefined;
  const cfg = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const out = { top3: DEFAULT_GRADE_GOAL_POINTS.top3, top5: DEFAULT_GRADE_GOAL_POINTS.top5 };
  GRADE_GOAL_OPTION_IDS.forEach(k => {
    if (_isValidPoints(cfg[k])) out[k] = cfg[k];
  });
  return out;
}

/* 独立保存两个选项的积分。必须都合法，任一非法不写入任何数据。 */
function setGradeGoalPointsConfig(childId, cfg) {
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { success: false, reason: 'invalid_config' };
  const next = {};
  for (const k of GRADE_GOAL_OPTION_IDS) {
    if (!_isValidPoints(cfg[k])) return { success: false, reason: 'invalid_points_' + k };
    next[k] = cfg[k];
  }
  const tc = _ensureTaskConfig(cs);
  tc.gradeGoal = next;
  saveState(_state);
  return { success: true, config: { ...next } };
}

/* 仅保存未完成状态下的选项（未完成打卡前可切换目标；完成后不可改）。 */
function setGradeGoalOption(childId, optionValue) {
  if (!GRADE_GOAL_OPTION_IDS.includes(optionValue)) return { success: false, reason: 'invalid_option' };
  const rec = getTodayCheckins(childId);
  if (rec['grade-goal'] && rec['grade-goal'].completed) return { success: false, reason: 'already_done' };
  if (!rec['grade-goal']) rec['grade-goal'] = { option: optionValue };
  else rec['grade-goal'].option = optionValue;
  saveState(_state);
  return { success: true };
}

/* 完成成绩目标：积分由存储层按所选选项的当前配置解析，不信任外部传入。
   记录写入 points + historyId 快照，撤销时按实际发放值扣回。 */
function completeGradeGoal(childId, optionValue) {
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  if (!GRADE_GOAL_OPTION_IDS.includes(optionValue)) return { success: false, reason: 'invalid_option' };
  const rec = getTodayCheckins(childId);
  const gg = rec['grade-goal'];
  if (gg && gg.completed) return { success: false, reason: 'already_done' };
  const cfg = getGradeGoalPointsConfig(childId);
  const points = cfg[optionValue];
  if (!_isValidPoints(points)) return { success: false, reason: 'invalid_points' };
  const label = optionValue === 'top3' ? '满分或前三' : '前五';
  const hist = addPoints(childId, points, '成绩目标：' + label);
  rec['grade-goal'] = { option: optionValue, completed: true, time: Math.max(Date.now(), ((gg && Number(gg.time)) || 0) + 1), points, historyId: hist.id };
  saveState(_state);
  return { success: true, points, historyId: hist.id };
}

/* 撤销当天成绩目标：按当日记录快照中的原始积分扣回。
   旧记录无快照时，仅在当天流水可唯一匹配时回退；金额不确定或余额不足不改动数据。
   撤销后当日记录被删除，可再次打卡；重复撤销返回 not_done，绝不重复扣分。 */
function undoGradeGoal(childId) {
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  const rec = _getTodayCheckinsReadOnly(childId);
  const entry = (rec && Object.prototype.hasOwnProperty.call(rec, 'grade-goal')) ? rec['grade-goal'] : undefined;
  if (!entry || !entry.completed) return { success: false, reason: 'not_done' };
  let amount = null;
  if (typeof entry.points === 'number' && isFinite(entry.points) && entry.points > 0) {
    amount = entry.points;
  } else {
    /* 旧数据兜底：当日唯一一条成绩目标流水 */
    const history = Array.isArray(cs.pointsHistory) ? cs.pointsHistory : [];
    const matches = history.filter(h => h && h.type === 'earn' && typeof h.desc === 'string' && h.desc.indexOf('成绩目标') === 0 && isTodayTs(h.time));
    if (matches.length === 1 && typeof matches[0].amount === 'number') amount = matches[0].amount;
  }
  if (amount === null) return { success: false, reason: 'no_snapshot' };
  if (typeof cs.points !== 'number' || !isFinite(cs.points) || cs.points < amount) {
    return { success: false, reason: 'insufficient_for_revoke', amount };
  }
  rec['grade-goal'] = { ...entry, completed: false, time: Math.max(Date.now(), (Number(entry.time) || 0) + 1) };
  cs.points -= amount;
  cs.pointsHistory.unshift({ id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), type: 'revoke', amount, desc: '撤销成绩目标打卡', time: Date.now() });
  saveState(_state);
  return { success: true, amount };
}

function getGradeGoalOption(childId) {
  const rec = _getTodayCheckinsReadOnly(childId);
  return (rec && Object.prototype.hasOwnProperty.call(rec, 'grade-goal')) ? rec['grade-goal'].option : null;
}

/* ---------- 任务配置管理 ----------
   只操作 taskConfig，不触碰 checkins / points / pointsHistory / redemptions。
   grade-goal 受保护。未知 taskId 拒绝。所有入口校验 taskId 格式。 */

/* 严格字段校验。每字段独立校验，允许单字段更新。
   points: 真正的整数数值，范围 1-1000。
   icon: 字符串 1-200；不含 < > ' \"；不含 javascript: / onxxx= / data:。 */
function _validateTaskFields(fields, allowedKeys) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { error: 'invalid_fields' };
  const out = {};
  const keys = Object.keys(fields);
  for (const k of keys) {
    if (!allowedKeys.includes(k)) return { error: 'unknown_field' };
  }
  if (fields.name !== undefined) {
    if (typeof fields.name !== 'string' || !fields.name.trim() || fields.name.length > 20) return { error: 'invalid_name' };
    out.name = fields.name.trim();
  }
  if (fields.desc !== undefined) {
    if (typeof fields.desc !== 'string' || fields.desc.length > 50) return { error: 'invalid_desc' };
    out.desc = fields.desc;
  }
  if (fields.points !== undefined) {
    if (!_isValidPoints(fields.points)) return { error: 'invalid_points' };
    out.points = fields.points;
  }
  if (fields.icon !== undefined) {
    if (typeof fields.icon !== 'string' || fields.icon.length < 1 || fields.icon.length > 200) return { error: 'invalid_icon' };
    if (/[<>'"]/.test(fields.icon)) return { error: 'invalid_icon' };
    const lower = fields.icon.toLowerCase();
    if (lower.includes('javascript:') || /\bon\w+\s*=/.test(lower) || lower.startsWith('data:')) return { error: 'invalid_icon' };
    out.icon = fields.icon;
  }
  if (fields.iconBg !== undefined) {
    if (typeof fields.iconBg !== 'string' || !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(fields.iconBg)) return { error: 'invalid_icon_bg' };
    out.iconBg = fields.iconBg;
  }
  return { value: out };
}

/* 自定义任务 ID 是否已存在于任一孩子中（遍历所有孩子的 custom 数组） */
function _customIdExistsAnywhere(id) {
  if (!_state || !_state.children) return false;
  return Object.values(_state.children).some(cs => {
    const tc = _getTaskConfigReadOnly(cs);
    return tc.custom.some(t => t && t.id === id);
  });
}

/* 写入时确保 taskConfig 结构合法。仅在校验通过后调用。 */
function _ensureTaskConfig(cs) {
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return { overrides: {}, custom: [] };
  if (!cs.taskConfig || typeof cs.taskConfig !== 'object' || Array.isArray(cs.taskConfig)) {
    cs.taskConfig = { overrides: {}, custom: [] };
  }
  if (!cs.taskConfig.overrides || typeof cs.taskConfig.overrides !== 'object' || Array.isArray(cs.taskConfig.overrides)) {
    cs.taskConfig.overrides = {};
  }
  if (!Array.isArray(cs.taskConfig.custom)) cs.taskConfig.custom = [];
  return cs.taskConfig;
}

/* 新增自定义任务。ID 由存储层生成，不接受外部指定。
   返回 { ...customTask } 浅拷贝。 */
function addCustomTask(childId, task) {
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  const v = _validateTaskFields(task, ['name', 'desc', 'points', 'icon', 'iconBg']);
  if (v.error) return { success: false, reason: v.error };
  const fields = v.value;
  if (fields.name === undefined) return { success: false, reason: 'invalid_name' };
  if (fields.points === undefined) fields.points = 10;
  if (fields.icon === undefined) fields.icon = '📝';
  if (fields.iconBg === undefined) fields.iconBg = '#E2F2FC';
  if (fields.desc === undefined) fields.desc = '';
  /* 生成 ID：custom_<ts>_<rand>，冲突重试上限 100 次 */
  let id = null;
  for (let i = 0; i < 100; i++) {
    const candidate = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    if (!_customIdExistsAnywhere(candidate)) { id = candidate; break; }
  }
  if (!id) return { success: false, reason: 'id_collision' };
  const tc = _ensureTaskConfig(cs);
  const customTask = { id: id, name: fields.name, desc: fields.desc, points: fields.points, icon: fields.icon, iconBg: fields.iconBg, disabled: false };
  tc.custom.push(customTask);
  saveState(_state);
  return { success: true, task: { ...customTask } };
}

/* 编辑任务。内置任务仅 name/desc/points；自定义任务额外支持 icon/iconBg。
   先纯校验再修改；校验失败不改动任何状态。 */
function updateTask(childId, taskId, updates) {
  if (taskId === 'grade-goal') return { success: false, reason: 'protected' };
  if (!_isValidTaskId(taskId)) return { success: false, reason: 'invalid_task_id' };
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  const tc = _getTaskConfigReadOnly(cs);
  const isCustom = tc.custom.some(t => t && t.id === taskId);
  const isBuiltin = !!_builtinTaskRegistry[childId] && _builtinTaskRegistry[childId][taskId] !== undefined;
  if (!isCustom && !isBuiltin) return { success: false, reason: 'unknown_task' };
  const allowedKeys = isCustom ? ['name', 'desc', 'points', 'icon', 'iconBg'] : ['name', 'desc', 'points'];
  const v = _validateTaskFields(updates, allowedKeys);
  if (v.error) return { success: false, reason: v.error };
  const fields = v.value;
  if (Object.keys(fields).length === 0) return { success: false, reason: 'no_changes' };
  /* 校验通过，现在才修改 taskConfig */
  const writableTc = _ensureTaskConfig(cs);
  if (isCustom) {
    const idx = writableTc.custom.findIndex(t => t && t.id === taskId);
    if (idx === -1) return { success: false, reason: 'unknown_task' };
    Object.assign(writableTc.custom[idx], fields);
  } else {
    const ov = _getOverride(writableTc, taskId) || {};
    ['name', 'desc', 'points'].forEach(k => { if (fields[k] !== undefined) ov[k] = fields[k]; });
    writableTc.overrides[taskId] = ov;
  }
  saveState(_state);
  return { success: true };
}

/* 启用/停用任务。只切 disabled，不删除任务。grade-goal 受保护。 */
function toggleTaskDisabled(childId, taskId) {
  if (taskId === 'grade-goal') return { success: false, reason: 'protected' };
  if (!_isValidTaskId(taskId)) return { success: false, reason: 'invalid_task_id' };
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  const tc = _getTaskConfigReadOnly(cs);
  const isCustom = tc.custom.some(t => t && t.id === taskId);
  const isBuiltin = !!_builtinTaskRegistry[childId] && _builtinTaskRegistry[childId][taskId] !== undefined;
  if (!isCustom && !isBuiltin) return { success: false, reason: 'unknown_task' };
  const writableTc = _ensureTaskConfig(cs);
  if (isCustom) {
    const idx = writableTc.custom.findIndex(t => t && t.id === taskId);
    if (idx === -1) return { success: false, reason: 'unknown_task' };
    writableTc.custom[idx].disabled = !writableTc.custom[idx].disabled;
    saveState(_state);
    return { success: true, disabled: writableTc.custom[idx].disabled };
  }
  const ov = _getOverride(writableTc, taskId) || {};
  ov.disabled = !ov.disabled;
  writableTc.overrides[taskId] = ov;
  saveState(_state);
  return { success: true, disabled: ov.disabled };
}

/* ==================== 奖励管理数据层 ====================
   奖励为家庭共享（非按孩子隔离），配置存于 _state.rewardConfig。
   结构：{ overrides: { [rewardId]: {name,desc,cost,category,disabled} }, custom: [ {id,name,desc,cost,icon,cardBg,category,disabled} ] }
   历史兑换记录已存 name/cost 快照，编辑/停用不影响历史。 */

function _isValidRewardCost(c) {
  return typeof c === 'number' && isFinite(c) && Math.floor(c) === c && c >= 1 && c <= 100000;
}

function _getRewardConfigReadOnly() {
  if (!_state || !_state.rewardConfig || typeof _state.rewardConfig !== 'object' || Array.isArray(_state.rewardConfig)) {
    return { overrides: {}, custom: [] };
  }
  return _state.rewardConfig;
}

function _ensureRewardConfig() {
  if (!_state.rewardConfig || typeof _state.rewardConfig !== 'object' || Array.isArray(_state.rewardConfig)) {
    _state.rewardConfig = { overrides: {}, custom: [] };
  }
  if (!_state.rewardConfig.overrides || typeof _state.rewardConfig.overrides !== 'object' || Array.isArray(_state.rewardConfig.overrides)) {
    _state.rewardConfig.overrides = {};
  }
  if (!Array.isArray(_state.rewardConfig.custom)) _state.rewardConfig.custom = [];
  return _state.rewardConfig;
}

/* 奖励字段校验。allowedKeys 控制可修改字段（内置 vs 自定义）。 */
function _validateRewardFields(fields, allowedKeys) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { error: 'invalid_fields' };
  const keys = Object.keys(fields);
  for (const k of keys) {
    if (!allowedKeys.includes(k)) return { error: 'unknown_field' };
  }
  const out = {};
  if (fields.name !== undefined) {
    if (typeof fields.name !== 'string' || !fields.name.trim() || fields.name.length > 20) return { error: 'invalid_name' };
    out.name = fields.name.trim();
  }
  if (fields.desc !== undefined) {
    if (typeof fields.desc !== 'string' || fields.desc.length > 50) return { error: 'invalid_desc' };
    out.desc = fields.desc;
  }
  if (fields.cost !== undefined) {
    if (!_isValidRewardCost(fields.cost)) return { error: 'invalid_cost' };
    out.cost = fields.cost;
  }
  if (fields.category !== undefined) {
    if (typeof fields.category !== 'string') return { error: 'invalid_category' };
    if (!REWARD_CATEGORIES.includes(fields.category) || fields.category === '全部') return { error: 'invalid_category' };
    out.category = fields.category;
  }
  if (fields.icon !== undefined) {
    if (typeof fields.icon !== 'string' || fields.icon.length < 1 || fields.icon.length > 200) return { error: 'invalid_icon' };
    if (/[<>'"]/.test(fields.icon)) return { error: 'invalid_icon' };
    const lower = fields.icon.toLowerCase();
    if (lower.includes('javascript:') || /\bon\w+\s*=/.test(lower) || lower.startsWith('data:')) return { error: 'invalid_icon' };
    out.icon = fields.icon;
  }
  if (fields.cardBg !== undefined) {
    if (typeof fields.cardBg !== 'string' || !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(fields.cardBg)) return { error: 'invalid_card_bg' };
    out.cardBg = fields.cardBg;
  }
  return { value: out };
}

/* 自定义奖励 ID 是否已存在 */
function _customRewardIdExists(id) {
  const rc = _getRewardConfigReadOnly();
  return rc.custom.some(r => r && r.id === id);
}

/* 新增自定义奖励。ID 由存储层生成。 */
function addCustomReward(reward) {
  const v = _validateRewardFields(reward, ['name', 'desc', 'cost', 'category', 'icon', 'cardBg']);
  if (v.error) return { success: false, reason: v.error };
  const f = v.value;
  if (f.name === undefined) return { success: false, reason: 'invalid_name' };
  if (f.cost === undefined) return { success: false, reason: 'invalid_cost' };
  if (f.category === undefined) f.category = '生活';
  if (f.icon === undefined) f.icon = '🎁';
  if (f.cardBg === undefined) f.cardBg = '#E2F2FC';
  if (f.desc === undefined) f.desc = '';
  let id = null;
  for (let i = 0; i < 100; i++) {
    const candidate = 'rw_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    if (!_customRewardIdExists(candidate)) { id = candidate; break; }
  }
  if (!id) return { success: false, reason: 'id_collision' };
  const rc = _ensureRewardConfig();
  const customReward = { id, name: f.name, desc: f.desc, cost: f.cost, category: f.category, icon: f.icon, cardBg: f.cardBg, disabled: false };
  rc.custom.push(customReward);
  saveState(_state);
  return { success: true, reward: { ...customReward } };
}

/* 编辑奖励。内置奖励仅 name/desc/cost/category；自定义奖励额外支持 icon/cardBg。 */
function updateReward(rewardId, updates) {
  if (!_isValidTaskId(rewardId)) return { success: false, reason: 'invalid_reward_id' };
  const rc = _getRewardConfigReadOnly();
  const isCustom = rc.custom.some(r => r && r.id === rewardId);
  const isBuiltin = REWARDS.some(r => r.id === rewardId);
  if (!isCustom && !isBuiltin) return { success: false, reason: 'unknown_reward' };
  const allowedKeys = isCustom ? ['name', 'desc', 'cost', 'category', 'icon', 'cardBg'] : ['name', 'desc', 'cost', 'category'];
  const v = _validateRewardFields(updates, allowedKeys);
  if (v.error) return { success: false, reason: v.error };
  const f = v.value;
  if (Object.keys(f).length === 0) return { success: false, reason: 'no_changes' };
  const writableRc = _ensureRewardConfig();
  if (isCustom) {
    const idx = writableRc.custom.findIndex(r => r && r.id === rewardId);
    if (idx === -1) return { success: false, reason: 'unknown_reward' };
    Object.assign(writableRc.custom[idx], f);
  } else {
    const ov = writableRc.overrides[rewardId] || {};
    ['name', 'desc', 'cost', 'category'].forEach(k => { if (f[k] !== undefined) ov[k] = f[k]; });
    writableRc.overrides[rewardId] = ov;
  }
  saveState(_state);
  return { success: true };
}

/* 启用/停用奖励。只切 disabled，不删除。停用后 redeemReward 数据层拦截。 */
function toggleRewardDisabled(rewardId) {
  if (!_isValidTaskId(rewardId)) return { success: false, reason: 'invalid_reward_id' };
  const rc = _getRewardConfigReadOnly();
  const isCustom = rc.custom.some(r => r && r.id === rewardId);
  const isBuiltin = REWARDS.some(r => r.id === rewardId);
  if (!isCustom && !isBuiltin) return { success: false, reason: 'unknown_reward' };
  const writableRc = _ensureRewardConfig();
  if (isCustom) {
    const idx = writableRc.custom.findIndex(r => r && r.id === rewardId);
    if (idx === -1) return { success: false, reason: 'unknown_reward' };
    writableRc.custom[idx].disabled = !writableRc.custom[idx].disabled;
    saveState(_state);
    return { success: true, disabled: writableRc.custom[idx].disabled };
  }
  const ov = writableRc.overrides[rewardId] || {};
  ov.disabled = !ov.disabled;
  writableRc.overrides[rewardId] = ov;
  saveState(_state);
  return { success: true, disabled: ov.disabled };
}

/* 判断奖励是否已停用（供 redeemReward 数据层校验） */
function _isRewardDisabled(rewardId) {
  const rc = _getRewardConfigReadOnly();
  const custom = rc.custom.find(r => r && r.id === rewardId);
  if (custom) return custom.disabled === true;
  const ov = rc.overrides[rewardId];
  return ov ? ov.disabled === true : false;
}

/* ==================== 排序（任务按孩子隔离，奖励家庭共享）====================
   只保存稳定 ID 顺序，不按名称识别。grade-goal 不参与排序（孩子端固定末尾）。
   未知/新增 ID 不在数组中，getter 会自动追加到末尾，旧排序不会丢失。 */

function _isValidIdArray(ids) {
  return Array.isArray(ids) && ids.every(id => typeof id === 'string' && _isValidTaskId(id));
}

function getTaskOrder(childId) {
  const cs = getChildState(childId);
  if (!cs) return [];
  /* 注意：不能经 _getTaskConfigReadOnly 读取——该安全视图只含 overrides/custom，
     会丢掉 order；这里直接读真实 taskConfig（只做类型校验，不修改状态）。 */
  const tc = cs.taskConfig;
  const order = (tc && typeof tc === 'object' && !Array.isArray(tc) && Array.isArray(tc.order)) ? tc.order : [];
  return order.filter(id => typeof id === 'string');
}

/* 保存任务排序：仅接受该孩子已知任务（内置注册 + 自定义），去重过滤。
   grade-goal 永远排除。未出现在 ids 中的已知项目由展示层追加到末尾。 */
function setTaskOrder(childId, ids) {
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  if (!_isValidIdArray(ids)) return { success: false, reason: 'invalid_order' };
  const known = new Set();
  const reg = _builtinTaskRegistry[childId];
  if (reg) Object.keys(reg).forEach(id => known.add(id));
  _getTaskConfigReadOnly(cs).custom.forEach(t => { if (t && t.id) known.add(t.id); });
  const seen = new Set();
  const clean = [];
  ids.forEach(id => {
    if (id !== 'grade-goal' && known.has(id) && !seen.has(id)) { seen.add(id); clean.push(id); }
  });
  const tc = _ensureTaskConfig(cs);
  tc.order = clean;
  saveState(_state);
  return { success: true, order: clean };
}

function getRewardOrder() {
  const rc = _getRewardConfigReadOnly();
  const order = Array.isArray(rc.order) ? rc.order : [];
  return order.filter(id => typeof id === 'string');
}

/* 保存奖励排序：仅接受已知奖励（内置 + 自定义），家庭共享。 */
function setRewardOrder(ids) {
  if (!_isValidIdArray(ids)) return { success: false, reason: 'invalid_order' };
  const known = new Set(REWARDS.map(r => r.id));
  _getRewardConfigReadOnly().custom.forEach(r => { if (r && r.id) known.add(r.id); });
  const seen = new Set();
  const clean = [];
  ids.forEach(id => { if (known.has(id) && !seen.has(id)) { seen.add(id); clean.push(id); } });
  const rc = _ensureRewardConfig();
  rc.order = clean;
  saveState(_state);
  return { success: true, order: clean };
}

function addPoints(childId, amount, desc, extra) {
  const cs = getChildState(childId);
  cs.points += amount;
  const entry = { id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), type: 'earn', amount, desc, time: Date.now() };
  /* extra 可覆盖类型/附加字段（如 type:'bonus'|'initial'、reason）。
     普通打卡调用不传 extra，行为与原来完全一致。 */
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(entry, extra);
  cs.pointsHistory.unshift(entry);
  return entry; /* 返回流水条目，供打卡记录关联 */
}

/* ---------- 其他奖励（家长直接加分，不关联每日任务）----------
   写 type:'bonus' 流水 + reason；不写 checkins，不影响今日完成数。
   撤销按流水条目快照扣回，refId 关联 + revoked 标记双保险，防重复扣分。 */
function _isValidBonusAmount(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 1 && v <= 100000;
}

function grantOtherReward(childId, reason, amount) {
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 50) return { success: false, reason: 'invalid_reason' };
  if (!_isValidBonusAmount(amount)) return { success: false, reason: 'invalid_amount' };
  const cleanReason = reason.trim();
  const entry = addPoints(childId, amount, '其他奖励：' + cleanReason, { type: 'bonus', reason: cleanReason });
  saveState(_state);
  return { success: true, entry, points: cs.points };
}

function undoOtherReward(childId, historyId) {
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  if (typeof historyId !== 'string' || !historyId) return { success: false, reason: 'invalid_id' };
  const entry = (Array.isArray(cs.pointsHistory) ? cs.pointsHistory : []).find(h => h && h.id === historyId);
  if (!entry || entry.type !== 'bonus') return { success: false, reason: 'not_found' };
  if (entry.revoked === true) return { success: false, reason: 'already_revoked' };
  const already = cs.pointsHistory.some(h => h && h.type === 'revoke' && h.refId === historyId);
  if (already) return { success: false, reason: 'already_revoked' };
  const amount = entry.amount;
  if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) return { success: false, reason: 'invalid_amount' };
  if (cs.points < amount) return { success: false, reason: 'insufficient_for_revoke', amount };
  /* 全部校验通过后才修改状态 */
  entry.revoked = true;
  cs.points -= amount;
  cs.pointsHistory.unshift({
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type: 'revoke', amount, desc: '撤销其他奖励：' + (entry.reason || ''), refId: historyId, time: Date.now()
  });
  saveState(_state);
  return { success: true, amount, points: cs.points };
}

/* ---------- 初始积分（设为指定值，多次设置不累计）----------
   语义：把孩子当前积分余额直接设为 amount，以当次设置值为准。
   实现：按"目标值 - 当前余额"的差额写一条流水——
   差额>0 写 type:'initial'（正类，加分）；差额<0 写 type:'revoke'（负类，减分）；
   差额=0 不写流水。本地与云端触发器的余额都按流水重算，因此覆盖语义天然成立。
   注意：差额基于本机当前余额，多设备场景请先同步再设置。 */
function _isValidInitialAmount(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= 1000000;
}

/* 初始积分状态：points 为当前余额（供表单预填）；total/count 为历史 initial 流水统计，仅作参考。 */
function getInitialPointsStatus(childId) {
  const cs = getChildState(childId);
  if (!cs) return null;
  const entries = (Array.isArray(cs.pointsHistory) ? cs.pointsHistory : []).filter(h => h && h.type === 'initial' && typeof h.amount === 'number');
  const total = entries.reduce((s, h) => s + h.amount, 0);
  return { granted: entries.length > 0 || cs.initialPointsGranted === true, total, count: entries.length, points: cs.points };
}

function grantInitialPoints(childId, amount) {
  const cs = getChildState(childId);
  if (!cs) return { success: false, reason: 'invalid_child' };
  if (!_isValidInitialAmount(amount)) return { success: false, reason: 'invalid_amount' };
  cs.initialPointsGranted = true;
  const delta = amount - cs.points;
  if (delta > 0) {
    const entry = addPoints(childId, delta, '初始积分', { type: 'initial' });
    saveState(_state);
    return { success: true, amount, points: cs.points, delta, historyId: entry.id };
  }
  if (delta < 0) {
    const reduce = -delta;
    cs.points -= reduce;
    cs.pointsHistory.unshift({
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: 'revoke', amount: reduce, desc: '初始积分调整', time: Date.now()
    });
    saveState(_state);
    return { success: true, amount, points: cs.points, delta };
  }
  saveState(_state);
  return { success: true, amount, points: cs.points, delta: 0 };
}

function redeemReward(childId, reward) {
  const cs = getChildState(childId);
  if (_isRewardDisabled(reward.id)) return { success: false, reason: 'reward_disabled' };
  if (cs.points < reward.cost) return { success: false, reason: 'insufficient' };
  cs.points -= reward.cost;
  cs.pointsHistory.unshift({ id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), type: 'spend', amount: reward.cost, desc: `兑换：${reward.name}`, time: Date.now() });
  cs.redemptions.unshift({ id: 'r_' + Date.now(), rewardId: reward.id, name: reward.name, cost: reward.cost, time: Date.now(), status: 'done' });
  saveState(_state);
  return { success: true };
}

/* ---------- 家长密码 ----------
   默认密码 4499；家长可在“密码设置”中自定义（4 位数字），存 _state.parentPin。
   旧数据无 parentPin 字段时回退默认密码；已保存的自定义密码永远优先，不被默认值覆盖。
   本应用为本地 PWA，密码门仅用于防误操作，不具备服务端级安全性。 */
const DEFAULT_PARENT_PIN = '4499';
const PARENT_PIN_RE = /^\d{4}$/;

function _getParentPin() {
  const p = _state && _state.parentPin;
  return (typeof p === 'string' && PARENT_PIN_RE.test(p)) ? p : DEFAULT_PARENT_PIN;
}

/* 修改家长密码：必须先验证当前密码；新密码须为 4 位数字。
   校验全部通过后才写入，失败保留原密码，不产生半完成状态。 */
function setParentPin(currentPin, newPin) {
  if (currentPin !== _getParentPin()) return { success: false, reason: 'wrong_current' };
  if (typeof newPin !== 'string' || !PARENT_PIN_RE.test(newPin)) return { success: false, reason: 'invalid_new' };
  _state.parentPin = newPin;
  saveState(_state);
  return { success: true };
}

function verifyParent(code) {
  if (code === _getParentPin()) {
    _state.parentVerified = true;
    _state.parentVerifyUntil = Date.now() + 10 * 60 * 1000;
    saveState(_state);
    return true;
  }
  return false;
}

function isParentVerified() {
  if (!_state.parentVerified) return false;
  if (Date.now() > _state.parentVerifyUntil) { _state.parentVerified = false; saveState(_state); return false; }
  return true;
}

function logoutParent() { _state.parentVerified = false; saveState(_state); }
