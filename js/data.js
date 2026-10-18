/* 资源说明：
 * 头像/人物插画/任务图标/礼物插画中，标注 [Figma] 的为从 Figma 设计文件导出的原始资产；
 * 琳琳打卡页人物插画为 AI 生成的同风格替代图（Figma 设计稿未提供女孩版）。
 */
const ASSETS = {
  avatarYuanyuan: 'assets/7f6a586da67e68725726b453a7f7e552596926e1.jpg', // [Figma] 渊渊头像
  avatarLinlin: 'assets/e555cf984834258ece9b0d5cc6aaaec6bc5bcb50.jpg',   // [Figma] 琳琳头像
  bannerYuanyuan: 'assets/b46a96378349883a9aeacdd698817ecd6c79328d.png', // [Figma] 渊渊学习插画
  bannerLinlin: 'assets/linlin_study.jpg',                               // [替代] 同风格生成图
  scenicCheckin: 'assets/e15f7aae1dbee6295a68e92cb0e09b66fbc16fc9.jpg',  // [Figma] 晨间山野插画
  scenicRewards: 'assets/9598cc056aa466491ad8de709b863c093db9498e.jpg',  // [Figma] 礼物山野插画
  scenicParent: 'assets/5ba451bc51365da654d52c601bcc3a87936fcb7f.jpg',   // [Figma] 家庭山野插画
  scenicDecor: 'assets/215b807f805e1778758c6b4e16cb89387a2b480f.jpg'     // [Figma] 山野装饰条
};

const CHILDREN = [
  {
    id: 'yuanyuan',
    name: '渊渊',
    gender: 'boy',
    grade: '三年级',
    avatar: ASSETS.avatarYuanyuan,
    banner: ASSETS.bannerYuanyuan
  },
  {
    id: 'linlin',
    name: '琳琳',
    gender: 'girl',
    grade: '四年级',
    avatar: ASSETS.avatarLinlin,
    banner: ASSETS.bannerLinlin
  }
];

/* 公共任务：icon 为 [Figma] 手绘任务图标，iconBg 为设计稿图标底色 */
const COMMON_TASKS = [
  { id: 'study',       name: '学习打卡',   desc: '完成作业 / 课外阅读', points: 10, icon: 'assets/0d0935c19f0b9ccc26e24ee53edc817ff3f3d0b7.png', iconBg: '#E2F2FC' },
  { id: 'interaction', name: '课间互动',   desc: '与同学友好交流',      points: 5,  icon: 'assets/18cf2434a0eca54b1d66736ec78585cc2fc92f27.png', iconBg: '#FFF1C6' },
  { id: 'ask-teacher', name: '向老师提问', desc: '主动请教或整理问题',  points: 5,  icon: 'assets/29a91bc0bab7a6ed1c0089e41d3ed757975cf921.png', iconBg: '#F2F1D2' },
  { id: 'outdoor',     name: '户外运动',   desc: '户外活动 30 分钟',    points: 5,  icon: 'assets/b3e4d64104475d1b8f42b3e597edaf7ec9e40da6.png', iconBg: '#FDE6E4' },
  { id: 'sleep',       name: '晚间作息',   desc: '按计划上床休息',      points: 10, icon: 'assets/f6e296265278284e3e3a27f8466346e342c9ff8c.png', iconBg: '#E7EBFF' }
];

/* 专属任务：Figma 设计稿未提供图标，使用 emoji 放在同款彩色底上（替代资源） */
const YUANYUAN_TASKS = [
  { id: 'yy-math',    name: '数学浅奥',           desc: '浅奥思维训练',  points: 10, icon: '🔢', iconBg: '#E2F2FC' },
  { id: 'yy-reading', name: '语文阅读每日一练',   desc: '每日阅读练习',  points: 10, icon: '📚', iconBg: '#E6F1E0' }
];

const LINLIN_TASKS = [
  { id: 'll-calc',    name: '20分钟30道计算题',       desc: '计算能力训练',   points: 10, icon: '➕', iconBg: '#E2F2FC' },
  { id: 'll-grammar', name: '每日10分钟一节语法',     desc: '语法知识点学习', points: 10, icon: '📝', iconBg: '#E7EBFF' },
  { id: 'll-vocab',   name: '每日20分钟一页高频词汇', desc: '高频词汇积累',   points: 10, icon: '🔤', iconBg: '#FDE9DF' },
  { id: 'll-poetry',  name: '每日10分钟古诗文朗读背诵', desc: '古诗文诵读',   points: 10, icon: '🎋', iconBg: '#E6F1E0' }
];

const GRADE_GOAL_TASK = {
  id: 'grade-goal',
  name: '成绩目标',
  desc: '选择今日成绩目标',
  points: 10,
  icon: '🎯',
  iconBg: '#FDE6E4',
  options: [
    { value: 'top3', label: '满分或前三' },
    { value: 'top5', label: '前五' }
  ]
};

/* 奖励：image 为 [Figma] 礼物插画（设计稿仅 4 张）；无图的保留 emoji 占位。
 * cardBg 为设计稿礼物卡彩色底，循环使用。 */
const REWARDS = [
  { id: 'r1', name: '文具套装',  desc: '笔记本 + 笔 + 贴纸', cost: 300, category: '学习', image: 'assets/f977e0525befd95cb22033662f0f06f02f807ab8.jpg', icon: '📦', cardBg: '#FFF2C9' },
  { id: 'r2', name: '篮球',      desc: '标准 5 号球',        cost: 500, category: '玩乐', image: 'assets/c5426968329e59a6a43fb0dfc59edd6ef7b79d1b.jpg', icon: '🏀', cardBg: '#FFF1CC' },
  { id: 'r3', name: '课外书一本', desc: '可选内容',          cost: 400, category: '学习', image: 'assets/b3e4e2bdae4795047b241929c61735d31b5df0c4.jpg', icon: '📕', cardBg: '#DFF2FC' },
  { id: 'r4', name: '头戴耳机',  desc: '学习 / 听英语',      cost: 800, category: '玩乐', image: 'assets/e76c4a34b453678bcea94c70872b17d18b1cf2d5.jpg', icon: '🎧', cardBg: '#FDE9DF' },
  { id: 'r5', name: '周末观影',  desc: '家庭电影时光',       cost: 600, category: '特权', image: null, icon: '🎬', cardBg: '#E7EBFF' },
  { id: 'r6', name: '冰淇淋',    desc: '任选口味',           cost: 150, category: '生活', image: null, icon: '🍦', cardBg: '#E2F2FC' }
];

const REWARD_CATEGORIES = ['全部', '学习', '生活', '玩乐', '特权'];

/* ---------- 名称 → 图标自动推断 ----------
 * 仅根据用户输入名称做本地关键词匹配，不调用任何网络/AI 接口。
 * 返回值与现有数据结构兼容，未命中时返回安全默认图标。
 */
const TASK_ICON_RULES = [
  // 顺序：更具体的词组在前，宽泛词在后
  { keywords: ['课间', '互动', '交流', '交友', '聊天'], icon: COMMON_TASKS[1].icon, iconBg: COMMON_TASKS[1].iconBg },
  { keywords: ['提问', '老师', '请教', '答疑', '问老师'], icon: COMMON_TASKS[2].icon, iconBg: COMMON_TASKS[2].iconBg },
  { keywords: ['户外', '跑步', '锻炼', '打球', '跳绳', '游泳', '骑车', '健身', '散步', '爬山', '运动'], icon: COMMON_TASKS[3].icon, iconBg: COMMON_TASKS[3].iconBg },
  { keywords: ['睡觉', '睡前', '作息', '早睡', '晚安', '洗漱', '整理书包', '关灯', '起床'], icon: COMMON_TASKS[4].icon, iconBg: COMMON_TASKS[4].iconBg },
  { keywords: ['学习', '阅读', '作业', '背诵', '复习', '写字', '练字', '听写', '口算', '计算', '数学', '语文', '英语', '单词', '词汇', '语法', '古诗', '课文', '预习', '笔记'], icon: COMMON_TASKS[0].icon, iconBg: COMMON_TASKS[0].iconBg }
];
const DEFAULT_TASK_ICON = { icon: '⭐', iconBg: '#F2F2F2' };

function inferTaskIconByName(name) {
  if (!name || typeof name !== 'string') return { ...DEFAULT_TASK_ICON };
  const n = name.trim();
  for (const rule of TASK_ICON_RULES) {
    for (const kw of rule.keywords) {
      if (n.indexOf(kw) !== -1) return { icon: rule.icon, iconBg: rule.iconBg };
    }
  }
  return { ...DEFAULT_TASK_ICON };
}

const REWARD_ICON_RULES = [
  { keywords: ['文具', '铅笔', '橡皮', '尺子', '本子', '笔记本', '文具盒', '笔袋'], icon: REWARDS[0].icon, cardBg: REWARDS[0].cardBg },
  { keywords: ['篮球', '足球', '排球', '羽毛球', '乒乓球', '球拍'], icon: REWARDS[1].icon, cardBg: REWARDS[1].cardBg },
  { keywords: ['课外书', '图书', '绘本', '故事书', '漫画', '杂志', '书籍'], icon: REWARDS[2].icon, cardBg: REWARDS[2].cardBg },
  { keywords: ['耳机', '音乐', '听歌', 'mp3', '音响'], icon: REWARDS[3].icon, cardBg: REWARDS[3].cardBg },
  { keywords: ['电影', '观影', '看电影', '影院', '影片', '剧场', '看戏'], icon: REWARDS[4].icon, cardBg: REWARDS[4].cardBg },
  { keywords: ['冰淇淋', '甜筒', '雪糕', '冷饮', '甜品', '蛋糕'], icon: REWARDS[5].icon, cardBg: REWARDS[5].cardBg },
  { keywords: ['书'], icon: REWARDS[2].icon, cardBg: REWARDS[2].cardBg },
  { keywords: ['球'], icon: REWARDS[1].icon, cardBg: REWARDS[1].cardBg }
];
const DEFAULT_REWARD_ICON = { icon: '🎁', cardBg: '#F2F2F2' };

function inferRewardIconByName(name) {
  if (!name || typeof name !== 'string') return { ...DEFAULT_REWARD_ICON };
  const n = name.trim();
  for (const rule of REWARD_ICON_RULES) {
    for (const kw of rule.keywords) {
      if (n.indexOf(kw) !== -1) return { icon: rule.icon, cardBg: rule.cardBg };
    }
  }
  return { ...DEFAULT_REWARD_ICON };
}

/* 积分有效性共享判定：有限正整数，范围 1-1000。
   data.js 展示层与 store.js 打卡层共用此规则，确保界面积分与实际发放一致。 */
function isValidTaskPoints(p) {
  return typeof p === 'number' && isFinite(p) && Math.floor(p) === p && p >= 1 && p <= 1000;
}

/* 内置任务唯一来源：返回指定孩子的完整内置任务数组（公共 + 专属，不含 grade-goal）。
   返回每个任务对象的浅拷贝，防止调用方修改污染 COMMON_TASKS 等原始定义。
   未知孩子 ID 返回空数组。 */
function getBuiltinTasks(childId) {
  if (typeof getChildProfile !== 'function' || !getChildProfile(childId)) return [];
  /* 琳琳用专属任务；其余孩子（含全部新增孩子）沿用默认孩子渊渊的任务模板 */
  const base = childId === 'linlin'
    ? COMMON_TASKS.concat(LINLIN_TASKS)
    : COMMON_TASKS.concat(YUANYUAN_TASKS);
  return base.map(t => ({ ...t }));
}

/* 新孩子的默认任务模板：与默认孩子“渊渊”一致（公共任务 + 渊渊专属任务）。
   返回浅拷贝元素数组，供新增孩子时一次性注册。 */
function getNewChildTaskTemplate() {
  return COMMON_TASKS.concat(YUANYUAN_TASKS).map(t => ({ ...t }));
}

/* 内置任务 override 白名单：仅 name / desc / points / disabled 可覆盖。
   points 必须通过 isValidTaskPoints 校验，非法时保留基础定义积分。 */
const BUILTIN_OVERRIDE_FIELDS = ['name', 'desc', 'points', 'disabled'];
function _applyBuiltinOverride(baseTask, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return { ...baseTask };
  const result = { ...baseTask };
  BUILTIN_OVERRIDE_FIELDS.forEach(k => {
    if (override[k] === undefined) return;
    if (k === 'points') {
      if (isValidTaskPoints(override.points)) result.points = override.points;
    } else {
      result[k] = override[k];
    }
  });
  return result;
}

/* 按持久化的 ID 顺序排列项目。
   order 中存在的 ID 按其顺序在前；未收录的新/未知项目按原数组顺序追加到末尾。
   不修改入参数组，返回新数组。 */
function _sortByIds(items, order) {
  if (!Array.isArray(order) || order.length === 0) return items.slice();
  const byId = new Map();
  items.forEach(it => { if (it && it.id !== undefined && !byId.has(it.id)) byId.set(it.id, it); });
  const sorted = [];
  const used = new Set();
  order.forEach(id => {
    const it = byId.get(id);
    if (it && !used.has(id)) { sorted.push(it); used.add(id); }
  });
  items.forEach(it => {
    if (it && !used.has(it.id)) sorted.push(it);
  });
  return sorted;
}

function getChildTasks(childId) {
  if (typeof getChildProfile !== 'function' || !getChildProfile(childId)) return [];
  const cs = getChildState(childId);
  const tc = (cs && cs.taskConfig) || { overrides: {}, custom: [] };
  const overrides = (tc.overrides && typeof tc.overrides === 'object' && !Array.isArray(tc.overrides)) ? tc.overrides : {};
  const custom = Array.isArray(tc.custom) ? tc.custom : [];
  let tasks = getBuiltinTasks(childId)
    .map(t => _applyBuiltinOverride(t, overrides[t.id]))
    .filter(t => t.disabled !== true);
  const customEnabled = custom.filter(t => t && t.disabled !== true);
  tasks = tasks.concat(customEnabled.map(t => ({
    ...t,
    points: isValidTaskPoints(t.points) ? t.points : 10
  })));
  /* 家长保存的顺序（内置+自定义统一排序）；成绩目标固定末尾，不参与拖拽 */
  tasks = _sortByIds(tasks, getTaskOrder(childId));
  tasks.push({ ...GRADE_GOAL_TASK });
  return tasks;
}

/* 家长管理用完整任务列表：返回启用 + 停用全部任务，标注 source 与 disabled。
   确保停用任务可见且可恢复。未知孩子 ID 返回空数组。 */
function getAllTasksForManagement(childId) {
  if (typeof getChildProfile !== 'function' || !getChildProfile(childId)) return [];
  const cs = getChildState(childId);
  const tc = (cs && cs.taskConfig) || { overrides: {}, custom: [] };
  const overrides = (tc.overrides && typeof tc.overrides === 'object' && !Array.isArray(tc.overrides)) ? tc.overrides : {};
  const custom = Array.isArray(tc.custom) ? tc.custom : [];
  const result = getBuiltinTasks(childId).map(t => {
    const merged = _applyBuiltinOverride(t, overrides[t.id]);
    return { ...merged, source: 'builtin', disabled: merged.disabled === true };
  });
  custom.forEach(t => {
    if (!t || !t.id) return;
    result.push({
      ...t,
      source: 'custom',
      disabled: t.disabled === true,
      points: isValidTaskPoints(t.points) ? t.points : 10
    });
  });
  /* 管理列表与孩子端共用同一排序；成绩目标行固定末尾 */
  const sortedMgmt = _sortByIds(result, getTaskOrder(childId));
  sortedMgmt.push({ ...GRADE_GOAL_TASK, source: 'grade-goal', disabled: false });
  return sortedMgmt;
}

/* 奖励 override 白名单：name / desc / cost / category / disabled 可覆盖。
   cost 非法时保留基础值。 */
const REWARD_OVERRIDE_FIELDS = ['name', 'desc', 'cost', 'category', 'disabled'];
function _applyRewardOverride(baseReward, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return { ...baseReward };
  const result = { ...baseReward };
  REWARD_OVERRIDE_FIELDS.forEach(k => {
    if (override[k] === undefined) return;
    if (k === 'cost') {
      if (_isValidRewardCost(override.cost)) result.cost = override.cost;
    } else {
      result[k] = override[k];
    }
  });
  return result;
}

/* 返回当前可用奖励（已过滤停用），供兑换页渲染。家庭共享。 */
function getRewards() {
  const rc = _getRewardConfigReadOnly();
  const overrides = (rc.overrides && typeof rc.overrides === 'object' && !Array.isArray(rc.overrides)) ? rc.overrides : {};
  const custom = Array.isArray(rc.custom) ? rc.custom : [];
  let rewards = REWARDS
    .map(r => _applyRewardOverride(r, overrides[r.id]))
    .filter(r => r.disabled !== true);
  const customEnabled = custom.filter(r => r && r.disabled !== true);
  rewards = rewards.concat(customEnabled.map(r => ({
    ...r,
    cost: _isValidRewardCost(r.cost) ? r.cost : 10
  })));
  /* 家长保存的家庭共享排序 */
  return _sortByIds(rewards, getRewardOrder());
}

/* 返回全部奖励（含停用），供家长管理面板。source: builtin / custom。 */
function getAllRewardsForManagement() {
  const rc = _getRewardConfigReadOnly();
  const overrides = (rc.overrides && typeof rc.overrides === 'object' && !Array.isArray(rc.overrides)) ? rc.overrides : {};
  const custom = Array.isArray(rc.custom) ? rc.custom : [];
  const result = REWARDS.map(r => {
    const merged = _applyRewardOverride(r, overrides[r.id]);
    return { ...merged, source: 'builtin', disabled: merged.disabled === true };
  });
  custom.forEach(r => {
    if (!r || !r.id) return;
    result.push({
      ...r,
      source: 'custom',
      disabled: r.disabled === true,
      cost: _isValidRewardCost(r.cost) ? r.cost : 10
    });
  });
  /* 管理列表与兑换页共用同一家庭排序 */
  return _sortByIds(result, getRewardOrder());
}

const CHEER_MESSAGES = ['太棒了！继续加油！', '你做得真好！', '一步一个脚印，真厉害！', '今天又进步了一点点！', '为你点赞！'];
function randomCheer() { return CHEER_MESSAGES[Math.floor(Math.random() * CHEER_MESSAGES.length)]; }

/* 原子初始化内置任务注册表。
   调度策略：脚本位于 <body> 末尾，readyState 为 'interactive' 时，
   DOMContentLoaded 尚未触发，会在所有同步脚本（含 store.js）解析完毕后触发，
   确保 initBuiltinTaskRegistry 已定义。readyState === 'complete' 时用 setTimeout(0) 兜底。
   - 仅当 initBuiltinTaskRegistry 未定义（store.js 加载失败）时才调用 failBuiltinRegistry。
   - initBuiltinTaskRegistry 返回 false 时，由 store.js 内部决定状态转换；
     此处不得无条件调用 failBuiltinRegistry，否则会破坏 ready 状态。 */
function _initBuiltinTaskRegistry() {
  if (typeof initBuiltinTaskRegistry !== 'function') {
    if (typeof failBuiltinRegistry === 'function') failBuiltinRegistry();
    console.error('[task-mgmt] initBuiltinTaskRegistry 未定义，普通任务打卡将被阻止');
    return;
  }
  const registryData = {};
  getChildren().forEach(c => {
    registryData[c.id] = getBuiltinTasks(c.id).map(t => ({ id: t.id, points: t.points }));
  });
  const ok = initBuiltinTaskRegistry(registryData);
  if (!ok) {
    /* 不调用 failBuiltinRegistry：store.js 已正确处理状态转换。 */
    console.error('[task-mgmt] 内置任务注册初始化失败，普通任务打卡将被阻止');
  }
}
function _scheduleRegistryInit() {
  if (document.readyState === 'complete') {
    setTimeout(_initBuiltinTaskRegistry, 0);
  } else {
    document.addEventListener('DOMContentLoaded', _initBuiltinTaskRegistry);
  }
}
_scheduleRegistryInit();
