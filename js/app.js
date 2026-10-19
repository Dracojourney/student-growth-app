const pageContent = document.getElementById('page-content');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');
const navItems = document.querySelectorAll('.nav-item');

let currentPage = 'checkin';
let currentCategory = '全部';

function navigate(page) {
  currentPage = page;
  navItems.forEach(n => n.classList.toggle('is-active', n.dataset.page === page));
  render();
  window.scrollTo(0, 0);
}
navItems.forEach(n => n.addEventListener('click', () => navigate(n.dataset.page)));

function render() {
  if (currentPage === 'checkin') renderCheckin();
  else if (currentPage === 'rewards') renderRewards();
  else if (currentPage === 'parent') renderParent();
}

/* ---------- 内联 SVG 图标 ---------- */
const SVG = {
  coin: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.85 6.1 6.65.6-5 4.4 1.45 6.5L12 16.9 6.05 20.1 7.5 13.6l-5-4.4 6.65-.6z"/></svg>',
  chevronDown: '<svg class="cc-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>',
  repeat: '<svg class="sc-icon" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" width="13" height="13" style="stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><polyline points="9 18 15 12 9 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
  logout: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M17.5 18a4.5 4.5 0 0 0 .38-8.98 6 6 0 0 0-11.5-1.4A4.5 4.5 0 0 0 7 18h10.5z"/></svg>'
};

/* 任务/奖励图标：assets 路径渲染为图片，否则渲染 emoji（替代资源） */
function iconInner(icon) {
  return icon.startsWith('assets/') ? `<img src="${icon}" alt="">` : icon;
}

/* ---------- 今天打卡 ---------- */
function renderCheckin() {
  const child = getCurrentChild();
  if (!child) { renderEmptyChildren(); return; }
  const others = getChildren().filter(c => c.id !== child.id);
  const other = others.length ? others[0] : null;
  const cs = getChildState(child.id);
  const tasks = getChildTasks(child.id);
  const today = todayStr();
  const checkins = cs.checkins[today] || {};
  const doneCount = tasks.filter(t => checkins[t.id] && checkins[t.id].completed).length;
  const totalCount = tasks.length;

  pageContent.innerHTML = `
    <header class="scenic-header checkin-hero">
      <img class="scenic-img" src="${ASSETS.scenicCheckin}" alt="">
      <img class="hero-child" src="${child.banner}" alt="${child.name}">
      <div class="hero-greeting">
        <h1>${greetingText()}，<br>${child.name}</h1>
        <div class="date-line">${formatDate(new Date())}</div>
      </div>
      <div class="child-capsules">
        <button class="current-child-pill" id="child-switcher" type="button" aria-label="切换孩子">
          <img class="cc-avatar" src="${child.avatar}" alt="${child.name}">
          <span>
            <div class="cc-name">${child.name}</div>
            <div class="cc-grade">${child.grade}</div>
          </span>
          ${SVG.chevronDown}
        </button>
        ${other ? `<button class="switch-child-pill" id="quick-switch" type="button" aria-label="切换到${other.name}">
          <img class="sc-avatar" src="${other.avatar}" alt="${other.name}">
          <span class="sc-name">${other.name}</span>
          ${SVG.repeat}
        </button>` : ''}
      </div>
    </header>
    <div class="progress-card">
      <img class="decor-strip" src="${ASSETS.scenicDecor}" alt="">
      <div class="p-title">今日完成进度</div>
      <div class="progress-body">
        <div class="ring-wrap">
          <svg viewBox="0 0 100 100" width="110" height="110">
            <circle class="ring-bg" cx="50" cy="50" r="42"></circle>
            <circle class="ring-fg" cx="50" cy="50" r="42"
              stroke-dasharray="${2 * Math.PI * 42}"
              stroke-dashoffset="${2 * Math.PI * 42 * (1 - (totalCount ? doneCount / totalCount : 0))}"
              transform="rotate(-90 50 50)"></circle>
          </svg>
          <div class="ring-text">
            <span class="num">${doneCount}/${totalCount}</span>
            <span class="sub">已完成</span>
          </div>
        </div>
        <div class="points-now">
          <div class="coin">${SVG.coin}</div>
          <div>
            <div class="p-num">${cs.points}</div>
            <div class="p-label">当前积分</div>
          </div>
        </div>
      </div>
      <div class="progress-desc">${doneCount === totalCount ? '今天的任务都完成啦！' : `还有 ${totalCount - doneCount} 项待完成`}</div>
    </div>
    <div class="section-title">今日任务</div>
    ${doneCount === totalCount ? emptyState() : taskListHTML(tasks, checkins, child)}
  `;

  document.getElementById('child-switcher').addEventListener('click', openChildPicker);
  if (other) document.getElementById('quick-switch').addEventListener('click', () => {
    setCurrentChild(other.id);
    render();
  });
  document.querySelectorAll('[data-task-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const taskId = btn.dataset.taskId;
      const task = tasks.find(t => t.id === taskId);
      handleTaskCheckin(task);
    });
  });
  document.querySelectorAll('[data-undo-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const task = tasks.find(t => t.id === btn.dataset.undoId);
      openUndoConfirm(task);
    });
  });
  document.querySelectorAll('.grade-option').forEach(opt => {
    opt.addEventListener('click', () => handleGradeOption(opt.dataset.value));
  });
  document.querySelectorAll('[data-grade-undo]').forEach(btn => {
    btn.addEventListener('click', openGradeUndoConfirm);
  });
}

function taskListHTML(tasks, checkins, child) {
  let html = '<div class="task-list">';
  tasks.forEach(t => {
    if (t.id === 'grade-goal') html += gradeGoalRowHTML(t, checkins['grade-goal'], child);
    else {
      const done = !!(checkins[t.id] && checkins[t.id].completed);
      html += `<div class="task-row ${done ? 'is-completed' : ''}">
        <div class="task-icon" style="background:${t.iconBg};">${iconInner(t.icon)}</div>
        <div class="task-main"><div class="task-name">${t.name}</div><div class="task-desc">${t.desc}</div></div>
        <div class="task-meta"><span class="points-tag">+${t.points}</span>
          ${done ? `<button class="undo-btn" data-undo-id="${t.id}" type="button" aria-label="撤销打卡">撤销</button>` : ''}
          <button class="check-btn" data-task-id="${t.id}" type="button" aria-label="${done ? '已完成' : '打卡'}">
            ${done ? SVG.check : ''}
          </button></div></div>`;
    }
  });
  return html + '</div>';
}

function gradeGoalRowHTML(task, ggRec, child) {
  const done = !!(ggRec && ggRec.completed);
  const selected = ggRec ? ggRec.option : null;
  /* 两个选项各自显示独立积分；积分配置按孩子读取 */
  const cfg = child ? getGradeGoalPointsConfig(child.id) : { top3: task.points, top5: task.points };
  let optsHTML = '';
  task.options.forEach(opt => {
    const isSel = selected === opt.value;
    const cls = done && isSel ? 'is-selected-and-done' : (isSel ? 'is-selected' : '');
    optsHTML += `<button class="grade-option ${cls}" data-value="${opt.value}" type="button" ${done ? 'disabled' : ''}><span class="grade-opt-label">${opt.label}</span><span class="grade-opt-pts">+${cfg[opt.value]}</span></button>`;
  });
  const selectedLabel = selected === 'top3' ? '满分或前三' : (selected === 'top5' ? '前五' : '');
  /* 已发放积分优先显示当日快照，旧记录无快照时回退当前配置 */
  const awarded = (ggRec && typeof ggRec.points === 'number') ? ggRec.points : (selected ? cfg[selected] : '');
  return `<div class="task-row grade-goal-row ${done ? 'is-completed' : ''}">
    <div class="task-head">
      <div class="task-icon" style="background:${task.iconBg};">${iconInner(task.icon)}</div>
      <div class="task-main"><div class="task-name">${task.name}</div><div class="task-desc">${task.desc}</div></div>
    </div>
    <div class="grade-options">${optsHTML}</div>
    ${done ? `<div class="grade-done-row"><span class="grade-done-tip">✓ 已按「${selectedLabel}」打卡 +${awarded}</span><button class="undo-btn" data-grade-undo="1" type="button">撤销</button></div>` : ''}
  </div>`;
}

function emptyState() {
  return `<div class="empty-state">
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="50" fill="#E6F1E0"/><path d="M40 60 L55 75 L85 45" stroke="#59AB7F" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 30 L27 36 L21 36 L26 40 L24 46 L30 42 L36 46 L34 40 L39 36 L33 36 Z" fill="#FFC458" opacity="0.7"/></svg>
    <div class="empty-text">今天的任务都完成啦！</div><div class="empty-sub">你真棒，明天继续加油～</div></div>`;
}

function handleTaskCheckin(task) {
  const childId = getCurrentChild().id;
  if (isTaskDone(childId, task.id)) { showToast('该任务今日已打卡'); return; }
  const res = completeTask(childId, task.id, task.points, task.name);
  if (res.success) showCelebrate(task.points, randomCheer());
  render();
}

function openUndoConfirm(task) {
  const child = getCurrentChild();
  showSheet(`<div class="sheet-title">撤销打卡</div><div class="sheet-body">确定撤销 <strong>${task.name}</strong> 今天的打卡吗？<br/>将同时扣回本次打卡获得的积分。</div>
    <div class="sheet-actions"><button class="btn btn-secondary" id="cancel-undo" type="button">取消</button><button class="btn btn-primary" id="confirm-undo" type="button">确认撤销</button></div>`);
  document.getElementById('cancel-undo').addEventListener('click', closeModal);
  document.getElementById('confirm-undo').addEventListener('click', () => {
    const res = undoTask(child.id, task.id, task.name);
    closeModal();
    if (res.success) showToast(`已撤销打卡，扣回 ${res.amount} 积分`);
    else if (res.reason === 'insufficient_for_revoke') showToast('积分已被使用，余额不足以扣回，本次无法撤销');
    else if (res.reason === 'no_snapshot') showToast('无法确定本次打卡所得积分，已阻止撤销');
    else showToast('撤销失败，请重试');
    render();
  });
}

function handleGradeOption(optionValue) {
  const childId = getCurrentChild().id;
  if (isTaskDone(childId, 'grade-goal')) { showToast('今日成绩目标已完成，无法修改'); return; }
  /* 所选选项的积分由存储层按当前配置解析并写入快照，一次只发一项 */
  const res = completeGradeGoal(childId, optionValue);
  if (res.success) showCelebrate(res.points, '成绩目标已设定，加油！');
  else if (res.reason === 'already_done') showToast('今日成绩目标已完成，无法修改');
  else showToast('操作失败，请重试');
  render();
}

/* 撤销当天成绩目标：按当时实际发放积分扣回（存储层快照），可再次打卡。 */
function openGradeUndoConfirm() {
  const child = getCurrentChild();
  showSheet(`<div class="sheet-title">撤销成绩目标</div><div class="sheet-body">确定撤销今天的成绩目标打卡吗？<br/>将按本次实际获得的积分扣回。</div>
    <div class="sheet-actions"><button class="btn btn-secondary" id="cancel-undo" type="button">取消</button><button class="btn btn-primary" id="confirm-undo" type="button">确认撤销</button></div>`);
  document.getElementById('cancel-undo').addEventListener('click', closeModal);
  document.getElementById('confirm-undo').addEventListener('click', () => {
    const res = undoGradeGoal(child.id);
    closeModal();
    if (res.success) showToast(`已撤销成绩目标，扣回 ${res.amount} 积分`);
    else if (res.reason === 'insufficient_for_revoke') showToast('积分已被使用，余额不足以扣回，本次无法撤销');
    else if (res.reason === 'no_snapshot') showToast('无法确定本次获得的积分，已阻止撤销');
    else if (res.reason === 'not_done') showToast('今日成绩目标未打卡或已撤销');
    else showToast('撤销失败，请重试');
    render();
  });
}

function openChildPicker() {
  const current = getCurrentChild();
  const items = getChildren().map(c => `<button class="child-picker-item ${c.id === current.id ? 'is-current' : ''}" data-child-id="${c.id}" type="button">
    <img class="cp-avatar" src="${c.avatar}" alt="${c.name}">
    <span class="cp-info"><span class="cp-name">${c.name}</span><span class="cp-sub">${c.grade} · ${getChildTasks(c.id).length} 项任务</span></span>
    ${c.id === current.id ? '<span class="cp-dot">●</span>' : ''}</button>`).join('');
  showSheet(`<div class="sheet-title">切换孩子</div><div class="child-picker-list">${items}</div>`);
  modalRoot.querySelectorAll('.child-picker-item').forEach(btn => {
    btn.addEventListener('click', () => { setCurrentChild(btn.dataset.childId); closeModal(); render(); });
  });
}

/* ---------- 积分兑换 ---------- */
function renderRewards() {
  const child = getCurrentChild();
  if (!child) { renderEmptyChildren(); return; }
  const cs = getChildState(child.id);
  const rewards = getRewards();
  const filtered = currentCategory === '全部' ? rewards : rewards.filter(r => r.category === currentCategory);
  const tabs = REWARD_CATEGORIES.map(cat => `<button class="cat-tab ${cat === currentCategory ? 'is-active' : ''}" data-cat="${cat}" type="button">${cat}</button>`).join('');
  const cards = filtered.map(r => {
    const enough = cs.points >= r.cost;
    return `<div class="gift-card" style="background:${r.cardBg};">
      <div class="gift-img-wrap">${r.image ? `<img src="${r.image}" alt="${r.name}">` : `<span class="gift-emoji">${r.icon}</span>`}</div>
      <div class="gift-info">
        <div class="gift-name">${r.name}</div>
        <div class="gift-desc">${r.desc}</div>
        <div class="gift-cost">${r.cost}<small>积分</small></div>
        <button class="redeem-btn" data-reward-id="${r.id}" type="button" ${enough ? '' : 'disabled'}>${enough ? '兑换' : '积分不足'}</button>
      </div></div>`;
  }).join('');
  const records = (cs.redemptions || []).slice(0, 5).map(rd => recordRowHTML(rd)).join('') || '<div class="record-empty">暂无兑换记录</div>';

  pageContent.innerHTML = `
    <header class="scenic-header rewards-hero">
      <img class="scenic-img" src="${ASSETS.scenicRewards}" alt="">
      <div class="rewards-points">
        <div class="rp-title">我的积分</div>
        <div class="rp-row"><div class="coin">${SVG.coin}</div><div class="rp-num">${cs.points}</div></div>
      </div>
    </header>
    <div class="category-tabs">${tabs}</div>
    <div class="rewards-grid">${cards}</div>
    <div class="records-section">
      <div class="section-head"><h3>兑换记录</h3><button class="view-all" id="view-all-records" type="button">查看全部 ${SVG.chevronRight}</button></div>
      <div class="record-card">${records}</div>
    </div>`;

  document.querySelectorAll('.cat-tab').forEach(t => t.addEventListener('click', () => { currentCategory = t.dataset.cat; render(); }));
  document.querySelectorAll('.redeem-btn').forEach(btn => btn.addEventListener('click', () => {
    const reward = rewards.find(r => r.id === btn.dataset.rewardId);
    openRedeemConfirm(reward);
  }));
  document.getElementById('view-all-records').addEventListener('click', () => {
    const all = (cs.redemptions || []).map(rd => recordRowHTML(rd)).join('') || '<div class="record-empty">暂无兑换记录</div>';
    showSheet(`<div class="sheet-title">全部兑换记录</div><div style="max-height:50vh;overflow-y:auto;">${all}</div>`);
  });
}

function recordRowHTML(rd) {
  const reward = getAllRewardsForManagement().find(r => r.id === rd.rewardId);
  const iconHTML = reward && reward.image ? `<img src="${reward.image}" alt="">` : (reward ? reward.icon : '🎁');
  return `<div class="record-row"><div class="record-icon">${iconHTML}</div>
    <div class="record-info"><div class="r-name">${rd.name}</div><div class="r-time">${formatTime(rd.time)}</div></div>
    <div class="record-status">已兑换</div></div>`;
}

function openRedeemConfirm(reward) {
  const child = getCurrentChild();
  const cs = getChildState(child.id);
  if (cs.points < reward.cost) { showToast('积分不足，无法兑换'); return; }
  showSheet(`<div class="sheet-title">确认兑换</div><div class="sheet-body">确定用 <strong>${reward.cost} 积分</strong> 兑换<br/><strong>${reward.icon} ${reward.name}</strong> 吗？</div>
    <div class="sheet-actions"><button class="btn btn-secondary" id="cancel-redeem" type="button">取消</button><button class="btn btn-primary" id="confirm-redeem" type="button">确认兑换</button></div>`);
  document.getElementById('cancel-redeem').addEventListener('click', closeModal);
  document.getElementById('confirm-redeem').addEventListener('click', () => {
    const res = redeemReward(child.id, reward);
    closeModal();
    showToast(res.success ? '兑换成功！' : '兑换失败，请重试');
    render();
  });
}

/* ---------- 家长管理 ---------- */
function renderParent() {
  if (!isParentVerified()) { renderParentGate(); return; }
  const allChildren = getChildren();
  const childCards = allChildren.map(c => childCardHTML(c)).join('')
    || '<div class="record-empty">暂无孩子，请点击下方按钮添加</div>';
  const curChild = getCurrentChild();
  const curTasks = curChild ? getChildTasks(curChild.id) : [];
  const curTaskPoints = curTasks.reduce((s, t) => s + t.points, 0);

  pageContent.innerHTML = `
    <header class="scenic-header parent-hero">
      <img class="scenic-img" src="${ASSETS.scenicParent}" alt="">
      <div class="parent-title-block">
        <h1>家长管理</h1>
        <div class="pt-sub">陪伴每一天，让好习惯慢慢长大</div>
      </div>
    </header>
    <div class="parent-section-head"><h3>我的孩子</h3><span class="ps-note">点击卡片查看详情</span></div>
    ${childCards}
    <button class="btn btn-primary add-child-btn" id="add-child-btn" type="button">＋ 添加孩子</button>
    <div class="parent-section-head"><h3>家庭习惯</h3><span class="ps-note">一起养成好习惯</span></div>
    <div class="menu-list">
      <button class="menu-item" data-action="tasks" type="button">
        <div class="menu-icon" style="background:#E8F0DE;color:#34845C;">${SVG.clipboard}</div>
        <div class="menu-main"><div class="m-title">习惯任务设置</div><div class="m-desc">${curTasks.length} 个每日任务 · 共 ${curTaskPoints} 积分</div></div>
        <span class="menu-arrow">›</span></button>
      <button class="menu-item" data-action="rewards" type="button">
        <div class="menu-icon" style="background:#FFF1CD;color:#B8860B;">${SVG.gift}</div>
        <div class="menu-main"><div class="m-title">兑换奖励管理</div><div class="m-desc">${getAllRewardsForManagement().length} 个奖励 · 查看兑换积分</div></div>
        <span class="menu-arrow">›</span></button>
      <button class="menu-item" data-action="points" type="button">
        <div class="menu-icon" style="background:#E2F1FA;color:#3E7CB8;">${SVG.chart}</div>
        <div class="menu-main"><div class="m-title">成长记录</div><div class="m-desc">查看打卡与积分明细</div></div>
        <span class="menu-arrow">›</span></button>
      <button class="menu-item" data-action="pin" type="button">
        <div class="menu-icon" style="background:#E7EBFF;color:#5B6BB8;">${SVG.lock}</div>
        <div class="menu-main"><div class="m-title">密码设置</div><div class="m-desc">修改家长管理密码</div></div>
        <span class="menu-arrow">›</span></button>
      <button class="menu-item" data-action="sync" type="button">
        <div class="menu-icon" style="background:#E4F3F7;color:#2E8FA8;">${SVG.cloud}</div>
        <div class="menu-main"><div class="m-title">云同步</div><div class="m-desc">${syncMenuDesc()}</div></div>
        <span class="menu-arrow">›</span></button>
      <button class="menu-item" data-action="logout" type="button">
        <div class="menu-icon" style="background:#FDE6E4;color:#C45050;">${SVG.logout}</div>
        <div class="menu-main"><div class="m-title">退出家长模式</div><div class="m-desc">锁定家长管理</div></div>
        <span class="menu-arrow">›</span></button>
    </div>
    <div class="remind-card">
      <div class="remind-icon">${SVG.bell}</div>
      <div class="remind-main">
        <div class="remind-title">每日打卡提醒</div>
        <div class="remind-sub">提醒功能开发中，敬请期待</div>
      </div>
      <span class="remind-off">未启用</span>
    </div>`;

  document.querySelectorAll('.menu-item').forEach(item => item.addEventListener('click', () => handleParentAction(item.dataset.action)));
  document.querySelectorAll('.child-card').forEach(card => card.addEventListener('click', () => openChildDetail(card.dataset.childId)));
  document.getElementById('add-child-btn').addEventListener('click', openAddChildForm);
}

function childCardHTML(c) {
  const tasks = getChildTasks(c.id);
  const checkins = getTodayCheckins(c.id);
  const done = tasks.filter(t => checkins[t.id] && checkins[t.id].completed).length;
  const total = tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="child-card" data-child-id="${c.id}" role="button" tabindex="0">
    <div class="cc-top">
      <img class="cc-avatar" src="${c.avatar}" alt="${c.name}">
      <div class="cc-info"><div class="cc-name">${c.name}</div><div class="cc-sub">${c.grade} · 当前积分 ${getChildState(c.id).points}</div></div>
      <span class="cc-detail">详情 ${SVG.chevronRight}</span>
    </div>
    <div class="cc-progress-row">
      <span class="cc-progress-text">今日完成 ${done}/${total}</span>
      <div class="cc-bar"><div class="cc-bar-fill" style="width:${pct}%;"></div></div>
      ${done === total ? '<span class="cc-done-tip">全完成啦</span>' : ''}
    </div>
  </div>`;
}

function openChildDetail(childId) {
  const c = getChildProfile(childId);
  if (!c) return;
  const cs = getChildState(childId);
  const tasks = getChildTasks(childId);
  showSheet(`<div class="sheet-title">${c.name} 的信息</div>
    <div class="record-row"><img class="record-icon" src="${c.avatar}" alt="" style="border-radius:12px;"><div class="record-info"><div class="r-name">${c.name}（${c.grade}）</div><div class="r-time">当前积分：${cs.points} · 今日任务 ${tasks.length} 项</div></div></div>
    <div style="max-height:38vh;overflow-y:auto;margin-top:8px;">
      ${tasks.map(t => `<div class="record-row"><div class="record-icon" style="background:${t.iconBg};font-size:16px;">${iconInner(t.icon)}</div><div class="record-info"><div class="r-name">${t.name}</div><div class="r-time">${t.desc} · +${t.points}分</div></div></div>`).join('')}
    </div>
    <div class="child-detail-actions">
      <button class="btn btn-primary" id="other-reward-btn" type="button">🎁 其他奖励（直接加分）</button>
      <button class="btn btn-secondary" id="init-points-btn" type="button">设置初始积分</button>
      <button class="btn btn-danger" id="delete-child-btn" type="button">删除孩子</button>
    </div>`);
  const otherBtn = document.getElementById('other-reward-btn');
  if (otherBtn) otherBtn.addEventListener('click', () => openOtherRewardForm(childId));
  const initBtn = document.getElementById('init-points-btn');
  if (initBtn) initBtn.addEventListener('click', () => openInitialPointsForm(childId));
  const delBtn = document.getElementById('delete-child-btn');
  if (delBtn) delBtn.addEventListener('click', () => openDeleteChildConfirm(childId));
}

/* 删除孩子二次确认：明确显示孩子姓名；取消返回详情弹窗，不产生任何数据变化。 */
function openDeleteChildConfirm(childId) {
  const c = getChildProfile(childId);
  if (!c) return;
  showSheet(`<div class="sheet-title">删除孩子</div>
    <div class="sheet-body">确定删除孩子「${c.name}」吗？<br/>此操作将删除该孩子的打卡记录、积分、积分流水、兑换记录及个人配置，且无法自动恢复。</div>
    <div class="sheet-actions"><button class="btn btn-secondary" id="cancel-del-child" type="button">取消</button><button class="btn btn-danger" id="confirm-del-child" type="button">确认删除</button></div>`);
  document.getElementById('cancel-del-child').addEventListener('click', () => { closeModal(); openChildDetail(childId); });
  document.getElementById('confirm-del-child').addEventListener('click', () => {
    const res = deleteChild(childId);
    closeModal();
    if (res.success) showToast('已删除孩子「' + c.name + '」');
    else showToast('删除失败，请重试');
    render();
  });
}

/* “其他奖励”：家长无需创建每日任务，直接给指定孩子加积分。
   事由必填、积分须为正整数；提交期间防重复点击；写入 pointsHistory（type:'bonus'）。 */
function openOtherRewardForm(childId) {
  const child = getChildProfile(childId);
  if (!child) return;

  const sheet = document.createElement('div');
  sheet.className = 'modal-mask';
  const panel = document.createElement('div');
  panel.className = 'modal-sheet is-card';
  panel.setAttribute('role', 'dialog');
  sheet.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = '其他奖励 · 发放给 ' + child.name;
  panel.appendChild(title);

  const form = document.createElement('div');
  form.className = 'tm-form';
  const reasonField = tmCreateField('奖励事由（必填，不超过 50 字）', 'text', '', 50);
  const amountField = tmCreateField('奖励积分（正整数 1-100000）', 'number', '');
  form.appendChild(reasonField.wrap);
  form.appendChild(amountField.wrap);
  const note = document.createElement('div');
  note.className = 'tm-form-note';
  note.textContent = '确认后直接增加 ' + child.name + ' 的可用积分，不计入每日打卡与任务完成数。';
  form.appendChild(note);
  panel.appendChild(form);

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', closeModal);
  actions.appendChild(cancelBtn);

  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn btn-primary';
  submitBtn.type = 'button';
  submitBtn.textContent = '确认发放';
  let submitting = false;
  submitBtn.addEventListener('click', () => {
    if (submitting) return; /* 防重复提交 */
    const reason = reasonField.input.value;
    const amount = parseInt(amountField.input.value, 10);
    const res = grantOtherReward(childId, reason, amount);
    if (!res.success) {
      if (res.reason === 'invalid_reason') showToast('请填写奖励事由（不超过 50 字）');
      else if (res.reason === 'invalid_amount') showToast('请输入 1-100000 的整数积分');
      else showToast('发放失败，请重试');
      return;
    }
    submitting = true;
    submitBtn.disabled = true;
    closeModal();
    showToast('已给 ' + child.name + ' 发放 +' + amount + ' 分，当前 ' + res.points + ' 积分');
    render();
  });
  actions.appendChild(submitBtn);
  panel.appendChild(actions);

  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(); });
  modalRoot.hidden = false;
  modalRoot.innerHTML = '';
  modalRoot.classList.add('is-centered');
  modalRoot.appendChild(sheet);
}

/* 初始积分：把孩子当前积分余额直接设为所填数值（不累计，以当次设置值为准）。
   差额>0 自动补足、差额<0 自动扣减，各生成一条对应流水。 */
function openInitialPointsForm(childId) {
  const child = getChildProfile(childId);
  if (!child) return;
  const status = getInitialPointsStatus(childId);

  const sheet = document.createElement('div');
  sheet.className = 'modal-mask';
  const panel = document.createElement('div');
  panel.className = 'modal-sheet is-card';
  panel.setAttribute('role', 'dialog');
  sheet.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = '设置初始积分 · ' + child.name;
  panel.appendChild(title);

  const form = document.createElement('div');
  form.className = 'tm-form';
  const curPoints = status && typeof status.points === 'number' ? status.points : 0;
  const amountField = tmCreateField('设为积分值（0-1000000 的非负整数）', 'number', String(curPoints));
  form.appendChild(amountField.wrap);
  const note = document.createElement('div');
  note.className = 'tm-form-note';
  note.textContent = '当前余额 ' + curPoints + ' 分。保存后余额将直接设为所填数值：高于余额自动补足差额，低于余额自动扣减差额；多次设置不累计，以当次设置值为准。';
  form.appendChild(note);
  panel.appendChild(form);

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', closeModal);
  actions.appendChild(cancelBtn);
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.type = 'button';
  saveBtn.textContent = '确认保存';
  let submitting = false;
  saveBtn.addEventListener('click', () => {
    if (submitting) return;
    const amount = parseInt(amountField.input.value, 10);
    const res = grantInitialPoints(childId, amount);
    if (!res.success) {
      showToast('请输入 0-1000000 的非负整数');
      return;
    }
    submitting = true;
    saveBtn.disabled = true;
    closeModal();
    const deltaText = res.delta > 0 ? '（补入 +' + res.delta + '）' : res.delta < 0 ? '（扣减 ' + res.delta + '）' : '（余额未变）';
    showToast('已设为 ' + res.points + ' 积分' + deltaText);
    openChildDetail(childId);
    render();
  });
  actions.appendChild(saveBtn);
  panel.appendChild(actions);

  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(); });
  modalRoot.hidden = false;
  modalRoot.innerHTML = '';
  modalRoot.classList.add('is-centered');
  modalRoot.appendChild(sheet);
}

/* 无孩子时的空状态：打卡/兑换页共用，引导去家长管理添加孩子。 */
function renderEmptyChildren() {
  pageContent.innerHTML = `<div class="record-empty" style="padding:70px 24px 18px;">还没有孩子信息<br/>请先添加一个孩子开始打卡</div>
    <div style="padding:0 24px;"><button class="btn btn-primary" id="empty-add-child" type="button" style="width:100%;min-height:50px;border-radius:28px;font-size:16px;font-weight:600;">＋ 添加孩子</button></div>`;
  document.getElementById('empty-add-child').addEventListener('click', () => navigate('parent'));
}

/* 新增孩子：姓名必填且全局唯一；头像复用现有男孩/女孩资源；
   初始积分仅建档时计入一次；新孩子默认任务与渊渊一致，个人数据完全独立。 */
function openAddChildForm() {
  const AVATAR_OPTIONS = [
    { gender: 'boy', label: '男孩', avatar: ASSETS.avatarYuanyuan, banner: ASSETS.bannerYuanyuan },
    { gender: 'girl', label: '女孩', avatar: ASSETS.avatarLinlin, banner: ASSETS.bannerLinlin }
  ];
  let picked = AVATAR_OPTIONS[0];

  const sheet = document.createElement('div');
  sheet.className = 'modal-mask';
  const panel = document.createElement('div');
  panel.className = 'modal-sheet is-card';
  panel.setAttribute('role', 'dialog');
  sheet.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = '添加孩子';
  panel.appendChild(title);

  const form = document.createElement('div');
  form.className = 'tm-form';
  const nameField = tmCreateField('孩子姓名（必填，不超过 20 字）', 'text', '', 20);
  form.appendChild(nameField.wrap);
  const gradeField = tmCreateField('年级（选填，如：三年级）', 'text', '', 10);
  form.appendChild(gradeField.wrap);

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'tm-field';
  const avatarLabel = document.createElement('div');
  avatarLabel.className = 'tm-field-label';
  avatarLabel.textContent = '头像';
  avatarWrap.appendChild(avatarLabel);
  const avatarRow = document.createElement('div');
  avatarRow.className = 'avatar-pick-row';
  const avatarBtns = AVATAR_OPTIONS.map(opt => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-pick' + (opt === picked ? ' is-selected' : '');
    const img = document.createElement('img');
    img.src = opt.avatar;
    img.alt = opt.label;
    const span = document.createElement('span');
    span.textContent = opt.label;
    b.appendChild(img);
    b.appendChild(span);
    b.addEventListener('click', () => {
      picked = opt;
      avatarBtns.forEach(x => x.classList.remove('is-selected'));
      b.classList.add('is-selected');
    });
    avatarRow.appendChild(b);
    return b;
  });
  avatarWrap.appendChild(avatarRow);
  form.appendChild(avatarWrap);

  const pointsField = tmCreateField('初始积分（0-1000000 的非负整数）', 'number', '0');
  form.appendChild(pointsField.wrap);
  const note = document.createElement('div');
  note.className = 'tm-form-note';
  note.textContent = '新孩子的默认打卡任务与渊渊一致，个人积分、打卡与兑换记录完全独立；初始积分用于录入历史积分，仅建档时计入一次。';
  form.appendChild(note);
  panel.appendChild(form);

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', closeModal);
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.type = 'button';
  saveBtn.textContent = '确认添加';
  let submitting = false;
  saveBtn.addEventListener('click', () => {
    if (submitting) return; /* 防重复点击 */
    const name = nameField.input.value.trim();
    const grade = gradeField.input.value.trim();
    const points = parseInt(pointsField.input.value, 10);
    const res = addChild(
      { name: name, grade: grade, gender: picked.gender, avatar: picked.avatar, banner: picked.banner },
      getNewChildTaskTemplate(),
      points
    );
    if (!res.success) {
      if (res.reason === 'duplicate_name') showToast('已存在同名孩子信息，请更换一个名字后再添加。');
      else if (res.reason === 'invalid_name') showToast('请输入有效的孩子姓名（不含特殊字符）');
      else if (res.reason === 'invalid_initial_points') showToast('初始积分需为 0-1000000 的非负整数');
      else if (res.reason === 'registry_not_ready') showToast('系统未就绪，请刷新后重试');
      else showToast('添加失败，请重试');
      return;
    }
    submitting = true;
    saveBtn.disabled = true;
    closeModal();
    showToast('已添加 ' + res.child.name + '，当前积分 ' + res.points);
    render();
  });
  actions.appendChild(saveBtn);
  panel.appendChild(actions);

  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(); });
  modalRoot.hidden = false;
  modalRoot.innerHTML = '';
  modalRoot.classList.add('is-centered');
  modalRoot.appendChild(sheet);
  nameField.input.focus();
}

/* 密码设置：先验证当前密码再修改；全部输入框为密码类型（掩码）；规则为 4 位数字。 */
function openPinSettingsForm() {
  const sheet = document.createElement('div');
  sheet.className = 'modal-mask';
  const panel = document.createElement('div');
  panel.className = 'modal-sheet is-card';
  panel.setAttribute('role', 'dialog');
  sheet.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = '密码设置';
  panel.appendChild(title);

  const form = document.createElement('div');
  form.className = 'tm-form';
  const curField = tmCreateField('当前密码', 'password', '', 4);
  const newField = tmCreateField('新密码（4 位数字）', 'password', '', 4);
  const confirmField = tmCreateField('确认新密码', 'password', '', 4);
  form.appendChild(curField.wrap);
  form.appendChild(newField.wrap);
  form.appendChild(confirmField.wrap);
  [curField, newField, confirmField].forEach(f => {
    f.input.setAttribute('inputmode', 'numeric');
    f.input.setAttribute('autocomplete', 'off');
  });
  const note = document.createElement('div');
  note.className = 'tm-form-note';
  note.textContent = '密码为 4 位数字，用于进入家长管理；保存成功后，下次进入家长管理需使用新密码。';
  form.appendChild(note);
  panel.appendChild(form);

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', closeModal);
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.type = 'button';
  saveBtn.textContent = '保存密码';
  saveBtn.addEventListener('click', () => {
    const cur = curField.input.value;
    const nw = newField.input.value;
    const cf = confirmField.input.value;
    if (nw !== cf) { showToast('两次输入的新密码不一致'); return; }
    const res = setParentPin(cur, nw);
    if (!res.success) {
      if (res.reason === 'wrong_current') showToast('当前密码错误');
      else showToast('新密码需为 4 位数字');
      return;
    }
    closeModal();
    showToast('密码已更新');
  });
  actions.appendChild(saveBtn);
  panel.appendChild(actions);

  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(); });
  modalRoot.hidden = false;
  modalRoot.innerHTML = '';
  modalRoot.classList.add('is-centered');
  modalRoot.appendChild(sheet);
}

/* ---------- 云同步面板（阶段2）----------
   未登录：邮箱注册/登录，登录后自动绑定家庭并迁移本地数据上云。
   已登录：显示同步状态，支持手动立即同步与退出登录。
   未登录时应用完整走本地模式，本面板不阻塞任何本地功能。 */
function syncMenuDesc() {
  if (!(window.SGASync && SGASync.available())) return '未启用';
  const st = SGASync.status();
  return st.signedIn ? ('已登录 · ' + (st.email || '')) : '登录后多设备同步数据';
}

/* ---------- 云同步面板 · 家庭区块（阶段3C）----------
   已登录态扩展：展示家庭邀请码（可复制、创建者可重置）、家庭成员列表，
   以及"加入其他家庭"入口。加入 = 本机数据被目标家庭云端数据整体替换，
   表单内明示不可逆后果，确认按钮即二次确认。 */
function syncCopyText(text, okMsg) {
  const done = () => showToast(okMsg || '已复制');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => {
      syncCopyFallback(text); done();
    });
  } else {
    syncCopyFallback(text); done();
  }
}
function syncCopyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}

function renderSyncFamilyInfo(box, fam) {
  const codeLbl = document.createElement('div');
  codeLbl.className = 'tm-field-label';
  codeLbl.textContent = '家庭邀请码（发给家人，对方登录后输入即可加入）';
  box.appendChild(codeLbl);

  const codeRow = document.createElement('div');
  codeRow.className = 'sync-invite-row';
  const codeTxt = document.createElement('div');
  codeTxt.className = 'sync-invite-code';
  codeTxt.textContent = fam.inviteCode || '------';
  codeRow.appendChild(codeTxt);
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-secondary sync-mini-btn';
  copyBtn.type = 'button';
  copyBtn.textContent = '复制';
  copyBtn.addEventListener('click', () => {
    if (!fam.inviteCode) return;
    syncCopyText(fam.inviteCode, '邀请码已复制');
  });
  codeRow.appendChild(copyBtn);
  box.appendChild(codeRow);

  if (fam.isOwner) {
    const regenBtn = document.createElement('button');
    regenBtn.className = 'btn btn-secondary sync-mini-btn sync-regen-btn';
    regenBtn.type = 'button';
    regenBtn.textContent = '重置邀请码（旧码将失效）';
    regenBtn.addEventListener('click', () => {
      regenBtn.disabled = true;
      SGASync.regenerateInviteCode().then(code => {
        codeTxt.textContent = code;
        fam.inviteCode = code;
        regenBtn.disabled = false;
        showToast('邀请码已重置，旧码已失效');
      }).catch(err => {
        regenBtn.disabled = false;
        showToast('重置失败：' + (err && err.message ? err.message : '未知错误'));
      });
    });
    box.appendChild(regenBtn);
  }

  const memLbl = document.createElement('div');
  memLbl.className = 'tm-field-label';
  memLbl.style.marginTop = '6px';
  memLbl.textContent = '家庭成员';
  box.appendChild(memLbl);
  const memList = document.createElement('div');
  memList.className = 'sync-member-list';
  (fam.members || []).forEach(m => {
    const row = document.createElement('div');
    row.className = 'sync-member-row';
    row.textContent = (m.email || '未知账号') + (m.isMe ? '（我）' : '');
    memList.appendChild(row);
  });
  box.appendChild(memList);
}

function renderSyncJoinEntry(joinBox) {
  joinBox.innerHTML = '';
  const toggle = document.createElement('button');
  toggle.className = 'btn btn-secondary sync-join-toggle';
  toggle.type = 'button';
  toggle.textContent = '加入其他家庭';
  toggle.addEventListener('click', () => renderSyncJoinForm(joinBox));
  joinBox.appendChild(toggle);
}

function renderSyncJoinForm(joinBox) {
  joinBox.innerHTML = '';
  const field = tmCreateField('请输入 6 位家庭邀请码', 'text', '', 6);
  field.input.setAttribute('autocapitalize', 'characters');
  field.input.setAttribute('autocomplete', 'off');
  joinBox.appendChild(field.wrap);

  const warn = document.createElement('div');
  warn.className = 'tm-form-note sync-warn';
  warn.textContent = '注意：加入后本机当前数据将被该家庭的云端数据整体替换，您当前账号下的家庭数据将被删除，不可恢复。请确认邀请码来自您的家人。';
  joinBox.appendChild(warn);

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', () => renderSyncJoinEntry(joinBox));
  actions.appendChild(cancelBtn);

  const okBtn = document.createElement('button');
  okBtn.className = 'btn btn-primary';
  okBtn.type = 'button';
  okBtn.textContent = '确认加入';
  okBtn.addEventListener('click', () => {
    const code = field.input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) { showToast('请输入 6 位邀请码'); return; }
    okBtn.disabled = true;
    okBtn.textContent = '加入中…';
    SGASync.joinFamily(code).then(() => {
      showToast('已加入家庭，正在载入家庭数据…');
      setTimeout(() => {
        try { closeModal(); } catch (e) {}
        location.reload();
      }, 900);
    }).catch(err => {
      okBtn.disabled = false;
      okBtn.textContent = '确认加入';
      showToast('加入失败：' + (err && err.message ? err.message : '未知错误'));
    });
  });
  actions.appendChild(okBtn);
  joinBox.appendChild(actions);
}

function openSyncSheet() {
  const sheet = document.createElement('div');
  sheet.className = 'modal-mask';
  const panel = document.createElement('div');
  panel.className = 'modal-sheet is-card';
  panel.setAttribute('role', 'dialog');
  sheet.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = '云同步';
  panel.appendChild(title);

  const form = document.createElement('div');
  form.className = 'tm-form';

  /* 组件未加载（vendor 脚本缺失或加载失败）：明确提示，不阻塞本地功能 */
  if (!(window.SGASync && SGASync.available())) {
    const note = document.createElement('div');
    note.className = 'tm-form-note';
    note.textContent = '云同步组件未加载，当前为纯本地模式，打卡与积分功能不受影响。';
    form.appendChild(note);
    panel.appendChild(form);
    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-secondary';
    closeBtn.type = 'button';
    closeBtn.textContent = '我知道了';
    closeBtn.addEventListener('click', closeModal);
    actions.appendChild(closeBtn);
    panel.appendChild(actions);
    sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(); });
    modalRoot.hidden = false;
    modalRoot.innerHTML = '';
    modalRoot.classList.add('is-centered');
    modalRoot.appendChild(sheet);
    return;
  }

  const st = SGASync.status();

  if (!st.signedIn) {
    const emailField = tmCreateField('邮箱', 'email', '', 100);
    const pwdField = tmCreateField('密码（至少 6 位）', 'password', '', 30);
    emailField.input.setAttribute('autocomplete', 'email');
    pwdField.input.setAttribute('autocomplete', 'current-password');
    form.appendChild(emailField.wrap);
    form.appendChild(pwdField.wrap);
    const note = document.createElement('div');
    note.className = 'tm-form-note';
    note.textContent = '用于家庭数据云端备份与多设备同步；未登录时应用完整运行在本地模式。';
    form.appendChild(note);
    panel.appendChild(form);

    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.type = 'button';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', closeModal);
    actions.appendChild(cancelBtn);

    const regBtn = document.createElement('button');
    regBtn.className = 'btn btn-secondary';
    regBtn.type = 'button';
    regBtn.textContent = '注册';
    const loginBtn = document.createElement('button');
    loginBtn.className = 'btn btn-primary';
    loginBtn.type = 'button';
    loginBtn.textContent = '登录';

    loginBtn.addEventListener('click', () => {
      const email = emailField.input.value.trim();
      const pwd = pwdField.input.value;
      if (!email || !pwd) { showToast('请输入邮箱和密码'); return; }
      loginBtn.disabled = true;
      loginBtn.textContent = '请稍候…';
      SGASync.signIn(email, pwd).then(() => {
        closeModal();
        showToast('登录成功，正在同步数据…');
      }).catch(err => {
        loginBtn.disabled = false;
        loginBtn.textContent = '登录';
        var msg = (err && err.message) ? String(err.message) : '未知错误';
        /* Supabase 常见英文错误 → 中文提示，避免用户看不懂卡住 */
        if (/email not confirmed/i.test(msg)) {
          showToast('邮箱尚未确认，请先查收邮件（含垃圾邮件）点击确认链接，或重发确认邮件');
        } else if (/invalid login credentials/i.test(msg)) {
          showToast('邮箱或密码错误，请重试');
        } else if (/user not found/i.test(msg)) {
          showToast('该邮箱尚未注册，请先注册');
        } else {
          showToast('登录失败：' + msg);
        }
      });
    });

    regBtn.addEventListener('click', () => {
      const email = emailField.input.value.trim();
      const pwd = pwdField.input.value;
      if (!email || !pwd) { showToast('请输入邮箱和密码'); return; }
      if (pwd.length < 6) { showToast('密码至少 6 位'); return; }
      regBtn.disabled = true;
      regBtn.textContent = '请稍候…';
      SGASync.signUp(email, pwd).then(res => {
        if (res && res.data && res.data.session) {
          closeModal();
          showToast('注册成功，正在同步数据…');
        } else {
          regBtn.disabled = false;
          regBtn.textContent = '注册';
          showToast('注册成功，请查收邮箱（含垃圾邮件）点击确认链接后再登录');
        }
      }).catch(err => {
        regBtn.disabled = false;
        regBtn.textContent = '注册';
        showToast('注册失败：' + (err && err.message ? err.message : '未知错误'));
      });
    });

    actions.appendChild(regBtn);
    actions.appendChild(loginBtn);
    panel.appendChild(actions);
  } else {
    const info = document.createElement('div');
    info.className = 'tm-form-note';
    const lastSync = st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString('zh-CN') : '本次会话尚未同步';
    let lines = '登录账号：' + (st.email || '-') + '\n最近同步：' + lastSync;
    if (st.lastError) lines += '\n上次错误：' + st.lastError;
    info.style.whiteSpace = 'pre-line';
    info.textContent = lines;
    form.appendChild(info);

    /* 孩子设备接入引导：家长在此设备登录一次即可，孩子无需知道邮箱密码 */
    const kidHint = document.createElement('div');
    kidHint.className = 'tm-form-note';
    kidHint.style.cssText = 'background:#eef7ff;border-left:3px solid #4a9eff;padding:10px 12px;margin-top:10px;line-height:1.6;';
    kidHint.innerHTML = '📱 <b>孩子设备设置</b><br>' +
      '家长在本设备登录一次后，孩子以后打开应用可<b>直接打卡/兑换</b>，无需重复登录。<br>' +
      '退出登录需家长密码，孩子无法误操作登出。';
    form.appendChild(kidHint);

    /* 阶段3C：家庭信息（邀请码/成员列表，异步填充）+ 加入其他家庭入口 */
    const famBox = document.createElement('div');
    famBox.className = 'sync-family';
    const famLoading = document.createElement('div');
    famLoading.className = 'tm-form-note';
    famLoading.textContent = '家庭信息加载中…';
    famBox.appendChild(famLoading);
    form.appendChild(famBox);

    const joinBox = document.createElement('div');
    joinBox.className = 'sync-join';
    form.appendChild(joinBox);
    renderSyncJoinEntry(joinBox);

    panel.appendChild(form);

    SGASync.getFamilyInfo().then(fam => {
      if (!fam) { famLoading.textContent = '未获取到家庭信息'; return; }
      famBox.innerHTML = '';
      renderSyncFamilyInfo(famBox, fam);
    }).catch(() => {
      famLoading.textContent = '家庭信息加载失败，请稍后重试';
    });

    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    const outBtn = document.createElement('button');
    outBtn.className = 'btn btn-secondary';
    outBtn.type = 'button';
    outBtn.textContent = '退出登录';
    outBtn.addEventListener('click', () => {
      showParentPinModal('退出登录需家长验证', () => {
        outBtn.disabled = true;
        SGASync.signOut().then(() => {
          closeModal();
          showToast('已退出登录，数据保留在本机');
        }).catch(err => {
          outBtn.disabled = false;
          showToast('退出失败：' + (err && err.message ? err.message : '未知错误'));
        });
      });
    });
    actions.appendChild(outBtn);

    const syncBtn = document.createElement('button');
    syncBtn.className = 'btn btn-primary';
    syncBtn.type = 'button';
    syncBtn.textContent = '立即同步';
    syncBtn.addEventListener('click', () => {
      syncBtn.disabled = true;
      syncBtn.textContent = '同步中…';
      /* syncAll 失败时 resolve(false) 并把错误写入 status().lastError，不会 reject */
      SGASync.syncAll().then(ok => {
        if (ok) {
          closeModal();
          showToast('同步完成');
        } else {
          syncBtn.disabled = false;
          syncBtn.textContent = '立即同步';
          showToast('同步失败：' + (SGASync.status().lastError || '未知错误'));
        }
      });
    });
    actions.appendChild(syncBtn);
    panel.appendChild(actions);
  }

  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(); });
  modalRoot.hidden = false;
  modalRoot.innerHTML = '';
  modalRoot.classList.add('is-centered');
  modalRoot.appendChild(sheet);
}

function renderParentGate() {
  pageContent.innerHTML = `<div class="parent-gate"><div class="gate-lock">${SVG.lock}</div><div class="gate-title">家长验证</div><div class="gate-sub">请输入 4 位家长密码</div>
    <div class="gate-dots" id="gate-dots">${[0,1,2,3].map(() => '<div class="gate-dot"></div>').join('')}</div>
    <div class="gate-pad" id="gate-pad">
      ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="gate-key" data-key="${n}" type="button">${n}</button>`).join('')}
      <button class="gate-key" data-key="clear" type="button" style="font-size:16px;">清除</button>
      <button class="gate-key" data-key="0" type="button">0</button>
      <button class="gate-key" data-key="del" type="button" style="font-size:16px;">⌫</button></div></div>`;
  let code = '';
  const dots = document.querySelectorAll('.gate-dot');
  const updateDots = () => dots.forEach((d, i) => d.classList.toggle('is-filled', i < code.length));
  document.querySelectorAll('.gate-key').forEach(k => k.addEventListener('click', () => {
    const v = k.dataset.key;
    if (v === 'clear') code = '';
    else if (v === 'del') code = code.slice(0, -1);
    else if (code.length < 4) code += v;
    updateDots();
    if (code.length === 4) {
      if (verifyParent(code)) { showToast('验证成功'); render(); }
      else { showToast('密码错误，请重试'); code = ''; updateDots(); }
    }
  }));
}

/* 家长 PIN 弹窗：用于保护退出登录等敏感操作，防止孩子误操作 */
function showParentPinModal(title, onSuccess) {
  const sheet = document.createElement('div');
  sheet.className = 'tm-modal';
  sheet.innerHTML = `<div class="tm-modal-card" style="width:300px;">
    <div class="parent-gate" style="padding:20px 0;">
      <div class="gate-lock">${SVG.lock}</div>
      <div class="gate-title">${title}</div>
      <div class="gate-sub">请输入 4 位家长密码</div>
      <div class="gate-dots">${[0,1,2,3].map(() => '<div class="gate-dot"></div>').join('')}</div>
      <div class="gate-pad">
        ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="gate-key" data-key="${n}" type="button">${n}</button>`).join('')}
        <button class="gate-key" data-key="clear" type="button" style="font-size:16px;">清除</button>
        <button class="gate-key" data-key="0" type="button">0</button>
        <button class="gate-key" data-key="del" type="button" style="font-size:16px;">⌫</button>
      </div>
    </div>
  </div>`;
  modalRoot.hidden = false;
  modalRoot.innerHTML = '';
  modalRoot.classList.add('is-centered');
  modalRoot.appendChild(sheet);
  let code = '';
  const dots = sheet.querySelectorAll('.gate-dot');
  const updateDots = () => dots.forEach((d, i) => d.classList.toggle('is-filled', i < code.length));
  sheet.querySelectorAll('.gate-key').forEach(k => k.addEventListener('click', () => {
    const v = k.dataset.key;
    if (v === 'clear') code = '';
    else if (v === 'del') code = code.slice(0, -1);
    else if (code.length < 4) code += v;
    updateDots();
    if (code.length === 4) {
      if (verifyParent(code)) {
        closeModal();
        onSuccess && onSuccess();
      } else {
        showToast('密码错误，请重试');
        code = ''; updateDots();
      }
    }
  }));
}

function handleParentAction(action) {
  if (action === 'logout') { logoutParent(); showToast('已退出家长模式'); render(); return; }
  if (action === 'pin') { openPinSettingsForm(); return; }
  if (action === 'sync') { openSyncSheet(); return; }
  if (action === 'tasks') {
    const cur = getCurrentChild();
    if (!cur) { showToast('请先添加孩子'); return; }
    openTaskManagementSheet(cur.id);
    return;
  }
  if (action === 'rewards') {
    openRewardManagementSheet();
    return;
  }
  if (action === 'points') {
    const cur = getCurrentChild();
    if (!cur) { showToast('请先添加孩子'); return; }
    openPointsSheet(cur.id);
    return;
  }
}

/* 积分流水面板：兼容 earn / bonus / initial / revoke / spend 等类型；
   其他奖励（bonus）未撤销时提供撤销入口，撤销按原始流水金额回滚。 */
function openPointsSheet(childId) {
  const cs = getChildState(childId);
  const POSITIVE_TYPES = { earn: true, bonus: true, initial: true };
  const list = cs.pointsHistory.slice(0, 30).map(h => {
    const positive = !!POSITIVE_TYPES[h.type];
    const revokedTag = (h.type === 'bonus' && h.revoked === true) ? '<span class="r-time">（已撤销）</span>' : '';
    let icon = positive ? '↓' : '↑';
    if (h.type === 'initial') icon = '★';
    else if (h.type === 'bonus') icon = '🎁';
    const bg = positive ? 'var(--color-primary-soft)' : '#FDE6E4';
    const color = positive ? 'var(--color-primary-dark)' : '#C45050';
    const undoBtn = (h.type === 'bonus' && h.revoked !== true)
      ? `<button class="btn btn-secondary tm-btn-sm" data-bonus-undo="${h.id}" type="button">撤销</button>`
      : '';
    return `<div class="record-row"><div class="record-icon" style="background:${bg}">${icon}</div><div class="record-info"><div class="r-name">${h.desc}</div><div class="r-time">${formatTime(h.time)}${revokedTag}</div></div><div class="record-status" style="color:${color};background:${bg}">${positive ? '+' : '-'}${h.amount}</div>${undoBtn}</div>`;
  }).join('') || '<div class="record-empty">暂无流水</div>';
  showSheet(`<div class="sheet-title">积分流水</div><div style="max-height:50vh;overflow-y:auto;">${list}</div>`);
  document.querySelectorAll('[data-bonus-undo]').forEach(btn => {
    btn.addEventListener('click', () => openBonusUndoConfirm(childId, btn.dataset.bonusUndo));
  });
}

/* 撤销一次“其他奖励”：按该流水实际金额扣回；已撤销/余额不足均由存储层拒绝。 */
function openBonusUndoConfirm(childId, historyId) {
  const child = getChildProfile(childId);
  const cs = getChildState(childId);
  const entry = (cs && Array.isArray(cs.pointsHistory) ? cs.pointsHistory : []).find(h => h && h.id === historyId);
  if (!entry) { showToast('未找到该奖励记录'); return; }
  showSheet(`<div class="sheet-title">撤销其他奖励</div><div class="sheet-body">确定撤销给 ${child ? child.name : '孩子'} 的「${entry.reason || ''}」奖励吗？<br/>将扣回本次实际增加的 ${entry.amount} 积分。</div>
    <div class="sheet-actions"><button class="btn btn-secondary" id="cancel-bonus-undo" type="button">取消</button><button class="btn btn-primary" id="confirm-bonus-undo" type="button">确认撤销</button></div>`);
  document.getElementById('cancel-bonus-undo').addEventListener('click', closeModal);
  document.getElementById('confirm-bonus-undo').addEventListener('click', () => {
    const res = undoOtherReward(childId, historyId);
    closeModal();
    if (res.success) showToast(`已撤销奖励，扣回 ${res.amount} 积分`);
    else if (res.reason === 'already_revoked') showToast('该奖励已撤销，不能重复扣分');
    else if (res.reason === 'insufficient_for_revoke') showToast('积分余额不足以扣回，本次无法撤销');
    else if (res.reason === 'not_found') showToast('未找到该奖励记录');
    else showToast('撤销失败，请重试');
    openPointsSheet(childId);
  });
}

/* ---------- 任务管理 UI ---------- */
/* 打开任务管理面板：展示当前孩子的全部任务（含停用），支持新增/编辑/停用。
   全程使用 DOM API 构建，用户输入一律走 textContent，杜绝 innerHTML 拼接造成的 XSS。 */
function openTaskManagementSheet(childId) {
  const child = getChildProfile(childId);
  if (!child) return;
  const tasks = getAllTasksForManagement(childId);

  const sheet = document.createElement('div');
  sheet.className = 'modal-mask';
  const panel = document.createElement('div');
  panel.className = 'modal-sheet is-card';
  panel.setAttribute('role', 'dialog');
  sheet.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = '任务管理 · ' + child.name;
  panel.appendChild(title);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary tm-add-btn';
  addBtn.type = 'button';
  addBtn.textContent = '+ 新增自定义任务';
  addBtn.addEventListener('click', () => openTaskForm(childId, null));
  panel.appendChild(addBtn);

  const list = document.createElement('div');
  list.className = 'tm-list';

  if (!tasks.length) {
    const empty = document.createElement('div');
    empty.className = 'record-empty';
    empty.textContent = '暂无任务';
    list.appendChild(empty);
  }

  tasks.forEach(t => {
    const row = document.createElement('div');
    row.className = 'record-row tm-task-row' + (t.disabled ? ' is-disabled' : '');
    if (t.source !== 'grade-goal') row.dataset.dragId = t.id;

    /* 拖动手柄：仅手柄可发起拖动，避免误触编辑/停用/打卡 */
    if (t.source !== 'grade-goal') {
      const handle = document.createElement('span');
      handle.className = 'tm-drag-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.textContent = '⠿';
      handle.title = '按住拖动排序';
      row.appendChild(handle);
    }

    const iconWrap = document.createElement('div');
    iconWrap.className = 'record-icon';
    iconWrap.style.background = t.iconBg || '#E2F2FC';
    iconWrap.style.fontSize = '16px';
    if (t.icon && String(t.icon).startsWith('assets/')) {
      const img = document.createElement('img');
      img.src = t.icon;
      img.alt = '';
      iconWrap.appendChild(img);
    } else {
      iconWrap.textContent = t.icon || '📝';
    }
    row.appendChild(iconWrap);

    const info = document.createElement('div');
    info.className = 'record-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'r-name';
    nameEl.textContent = t.name || '(未命名)';
    const descEl = document.createElement('div');
    descEl.className = 'r-time';
    descEl.textContent = (t.desc || '') + ' · +' + t.points + '分';
    info.appendChild(nameEl);
    info.appendChild(descEl);
    row.appendChild(info);

    const badge = document.createElement('span');
    badge.className = 'tm-status' + (t.disabled ? ' is-off' : '');
    badge.textContent = t.disabled ? '已停用' : '启用中';
    row.appendChild(badge);

    const actions = document.createElement('div');
    actions.className = 'tm-actions';

    if (t.source === 'grade-goal') {
      const pointsBtn = document.createElement('button');
      pointsBtn.className = 'btn btn-secondary tm-btn-sm';
      pointsBtn.type = 'button';
      pointsBtn.textContent = '积分设置';
      pointsBtn.addEventListener('click', () => openGradeGoalPointsForm(childId));
      actions.appendChild(pointsBtn);
    } else {
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-secondary tm-btn-sm';
      editBtn.type = 'button';
      editBtn.textContent = '编辑';
      editBtn.addEventListener('click', () => openTaskForm(childId, t));
      actions.appendChild(editBtn);

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'btn tm-btn-sm ' + (t.disabled ? 'btn-primary' : 'btn-secondary');
      toggleBtn.type = 'button';
      toggleBtn.textContent = t.disabled ? '启用' : '停用';
      toggleBtn.addEventListener('click', () => toggleTaskStatus(childId, t.id));
      actions.appendChild(toggleBtn);
    }
    row.appendChild(actions);
    list.appendChild(row);
  });
  panel.appendChild(list);

  /* 拖动排序：松手即按新顺序持久化（按孩子隔离）；成绩目标行固定在末尾不可拖动 */
  tmAttachDragReorder(list, ids => {
    const res = setTaskOrder(childId, ids);
    if (res.success) showToast('任务顺序已保存');
  });

  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(); });
  modalRoot.hidden = false;
  modalRoot.innerHTML = '';
  modalRoot.classList.add('is-centered');
  modalRoot.appendChild(sheet);
}

/* 成绩目标两个选项的独立积分设置弹窗（按孩子独立）。
   保存只影响今后打卡；撤销未保存修改即恢复为上次已保存值。 */
function openGradeGoalPointsForm(childId) {
  const child = getChildProfile(childId);
  if (!child) return;
  const saved = getGradeGoalPointsConfig(childId);

  const sheet = document.createElement('div');
  sheet.className = 'modal-mask';
  const panel = document.createElement('div');
  panel.className = 'modal-sheet is-card';
  panel.setAttribute('role', 'dialog');
  sheet.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = '成绩目标积分设置 · ' + child.name;
  panel.appendChild(title);

  const form = document.createElement('div');
  form.className = 'tm-form';
  const top3Field = tmCreateField('「满分或前三」积分（1-1000）', 'number', String(saved.top3));
  const top5Field = tmCreateField('「前五」积分（1-1000）', 'number', String(saved.top5));
  form.appendChild(top3Field.wrap);
  form.appendChild(top5Field.wrap);
  const note = document.createElement('div');
  note.className = 'tm-form-note';
  note.textContent = '两个选项独立计分、互斥打卡；修改只影响今后的打卡，不改变历史已发积分与撤销。';
  form.appendChild(note);
  panel.appendChild(form);

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = '返回';
  cancelBtn.addEventListener('click', closeModal);
  actions.appendChild(cancelBtn);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn btn-secondary';
  resetBtn.type = 'button';
  resetBtn.textContent = '撤销修改';
  resetBtn.addEventListener('click', () => {
    top3Field.input.value = String(saved.top3);
    top5Field.input.value = String(saved.top5);
    showToast('已恢复为上次保存的积分');
  });
  actions.appendChild(resetBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.type = 'button';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', () => {
    const top3 = parseInt(top3Field.input.value, 10);
    const top5 = parseInt(top5Field.input.value, 10);
    const res = setGradeGoalPointsConfig(childId, { top3, top5 });
    if (!res.success) {
      if (res.reason === 'invalid_child') showToast('孩子不存在');
      else showToast('请输入 1-1000 的整数积分');
      return;
    }
    closeModal();
    showToast('成绩目标积分已保存');
    openTaskManagementSheet(childId);
  });
  actions.appendChild(saveBtn);
  panel.appendChild(actions);

  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(); });
  modalRoot.hidden = false;
  modalRoot.innerHTML = '';
  modalRoot.classList.add('is-centered');
  modalRoot.appendChild(sheet);
}

/* 原生 Pointer Events 拖动手柄排序（鼠标+触屏，无需第三方依赖）。
   - 只有带 data-drag-id 的行可拖动；行内其他按钮不受影响。
   - 不带 data-drag-id 的尾部行（成绩目标）始终保持在可拖动行之后。
   - 移动仅改变 DOM 顺序，松手后一次性把 ID 顺序交给 onCommit 持久化。 */
function tmAttachDragReorder(listEl, onCommit) {
  const handles = listEl.querySelectorAll('.tm-drag-handle');
  let drag = null;

  const onMove = (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientY - drag.startY) < 8) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.row.classList.add('is-dragging');
    }
    const rows = Array.from(listEl.querySelectorAll('[data-drag-id]'));
    let target = null;
    for (const r of rows) {
      if (r === drag.row) continue;
      const rect = r.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) { target = r; break; }
    }
    /* 找到第一个不可拖动的尾部行（如成绩目标），拖动行不得越过它 */
    const tail = Array.from(listEl.children).find(el => !el.dataset || !el.dataset.dragId);
    if (target) listEl.insertBefore(drag.row, target);
    else if (tail) listEl.insertBefore(drag.row, tail);
    else listEl.appendChild(drag.row);
  };
  const finish = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    if (!drag) return;
    drag.row.classList.remove('is-dragging');
    const cur = drag;
    drag = null;
    if (cur.moved) {
      const ids = Array.from(listEl.querySelectorAll('[data-drag-id]')).map(r => r.dataset.dragId);
      onCommit(ids);
    }
  };

  handles.forEach(h => {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const row = h.closest('[data-drag-id]');
      if (!row) return;
      drag = { row, startY: e.clientY, moved: false };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    });
  });
}
function openTaskForm(childId, task) {
  const isEdit = !!task;
  const isCustom = isEdit && task.source === 'custom';

  const sheet = document.createElement('div');
  sheet.className = 'modal-mask';
  const panel = document.createElement('div');
  panel.className = 'modal-sheet is-card';
  panel.setAttribute('role', 'dialog');
  sheet.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = isEdit ? '编辑任务' : '新增自定义任务';
  panel.appendChild(title);

  const form = document.createElement('div');
  form.className = 'tm-form';

  const nameField = tmCreateField('任务名称', 'text', isEdit ? task.name : '', 20);
  form.appendChild(nameField.wrap);

  const descField = tmCreateField('任务说明', 'text', isEdit ? (task.desc || '') : '', 50);
  form.appendChild(descField.wrap);

  const pointsField = tmCreateField('积分（1-1000）', 'number', isEdit ? String(task.points) : '10');
  form.appendChild(pointsField.wrap);

  let iconField = null, bgField = null;
  if (!isEdit || isCustom) {
    iconField = tmCreateField('图标（emoji 或 assets 路径）', 'text', isEdit ? (task.icon || '') : '📝', 200);
    form.appendChild(iconField.wrap);
    bgField = tmCreateField('图标底色（如 #E2F2FC）', 'text', isEdit ? (task.iconBg || '') : '#E2F2FC', 20);
    form.appendChild(bgField.wrap);
  }
  // 名称变化时自动推断图标；用户手动编辑图标后不再覆盖
  let iconManuallyEdited = false;
  if (iconField) {
    const markManual = () => { iconManuallyEdited = true; };
    iconField.input.addEventListener('input', markManual);
    iconField.input.addEventListener('focus', markManual);
    nameField.input.addEventListener('input', () => {
      if (iconManuallyEdited) return;
      const inferred = inferTaskIconByName(nameField.input.value);
      iconField.input.value = inferred.icon;
      if (bgField) bgField.input.value = inferred.iconBg;
    });
  }
  panel.appendChild(form);

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', closeModal);
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.type = 'button';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', () => {
    const name = nameField.input.value.trim();
    const desc = descField.input.value.trim();
    const points = parseInt(pointsField.input.value, 10);
    const payload = { name, desc, points };
    if (iconField) payload.icon = iconField.input.value.trim();
    if (bgField) payload.iconBg = bgField.input.value.trim();

    const res = isEdit ? updateTask(childId, task.id, payload) : addCustomTask(childId, payload);
    if (res.success) {
      showToast(isEdit ? '已保存' : '已新增');
      openTaskManagementSheet(childId);
      if (currentPage === 'checkin') render();
    } else {
      showToast('保存失败：' + (res.reason || '未知错误'));
    }
  });
  actions.appendChild(saveBtn);
  panel.appendChild(actions);

  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(); });
  modalRoot.hidden = false;
  modalRoot.innerHTML = '';
  modalRoot.classList.add('is-centered');
  modalRoot.appendChild(sheet);
  nameField.input.focus();
}

function tmCreateField(label, type, value, maxLength) {
  const wrap = document.createElement('div');
  wrap.className = 'tm-field';
  const lbl = document.createElement('label');
  lbl.className = 'tm-field-label';
  lbl.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.className = 'tm-input';
  if (value !== undefined) input.value = value;
  if (maxLength) input.maxLength = maxLength;
  wrap.appendChild(lbl);
  wrap.appendChild(input);
  return { wrap, input };
}

function toggleTaskStatus(childId, taskId) {
  const res = toggleTaskDisabled(childId, taskId);
  if (res.success) {
    showToast(res.disabled ? '已停用' : '已启用');
    openTaskManagementSheet(childId);
    if (currentPage === 'checkin') render();
  } else {
    showToast('操作失败：' + (res.reason || '未知错误'));
  }
}

/* ---------- 奖励管理 UI（复用任务管理布局与表单构建） ---------- */
/* 奖励为家庭共享，无 childId 参数。结构、样式、事件与任务管理完全一致。 */
function openRewardManagementSheet() {
  const rewards = getAllRewardsForManagement();

  const sheet = document.createElement('div');
  sheet.className = 'modal-mask';
  const panel = document.createElement('div');
  panel.className = 'modal-sheet is-card';
  panel.setAttribute('role', 'dialog');
  sheet.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = '奖励管理';
  panel.appendChild(title);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary tm-add-btn';
  addBtn.type = 'button';
  addBtn.textContent = '+ 新增自定义奖励';
  addBtn.addEventListener('click', () => openRewardForm(null));
  panel.appendChild(addBtn);

  const list = document.createElement('div');
  list.className = 'tm-list';

  if (!rewards.length) {
    const empty = document.createElement('div');
    empty.className = 'record-empty';
    empty.textContent = '暂无奖励';
    list.appendChild(empty);
  }

  rewards.forEach(r => {
    const row = document.createElement('div');
    row.className = 'record-row tm-task-row' + (r.disabled ? ' is-disabled' : '');
    row.dataset.dragId = r.id;

    /* 拖动手柄：奖励为家庭共享配置，顺序对所有孩子一致 */
    const handle = document.createElement('span');
    handle.className = 'tm-drag-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = '⠿';
    handle.title = '按住拖动排序';
    row.appendChild(handle);

    const iconWrap = document.createElement('div');
    iconWrap.className = 'record-icon';
    iconWrap.style.background = r.cardBg || '#E2F2FC';
    iconWrap.style.fontSize = '16px';
    if (r.image) {
      const img = document.createElement('img');
      img.src = r.image;
      img.alt = '';
      iconWrap.appendChild(img);
    } else {
      iconWrap.textContent = r.icon || '🎁';
    }
    row.appendChild(iconWrap);

    const info = document.createElement('div');
    info.className = 'record-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'r-name';
    nameEl.textContent = r.name || '(未命名)';
    const descEl = document.createElement('div');
    descEl.className = 'r-time';
    descEl.textContent = (r.desc || '') + ' · ' + (r.category || '') + ' · ' + r.cost + '积分';
    info.appendChild(nameEl);
    info.appendChild(descEl);
    row.appendChild(info);

    const badge = document.createElement('span');
    badge.className = 'tm-status' + (r.disabled ? ' is-off' : '');
    badge.textContent = r.disabled ? '已停用' : '启用中';
    row.appendChild(badge);

    const actions = document.createElement('div');
    actions.className = 'tm-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary tm-btn-sm';
    editBtn.type = 'button';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => openRewardForm(r));
    actions.appendChild(editBtn);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn tm-btn-sm ' + (r.disabled ? 'btn-primary' : 'btn-secondary');
    toggleBtn.type = 'button';
    toggleBtn.textContent = r.disabled ? '启用' : '停用';
    toggleBtn.addEventListener('click', () => toggleRewardStatus(r.id));
    actions.appendChild(toggleBtn);

    row.appendChild(actions);
    list.appendChild(row);
  });
  panel.appendChild(list);

  /* 拖动排序：松手即按新顺序持久化（家庭共享） */
  tmAttachDragReorder(list, ids => {
    const res = setRewardOrder(ids);
    if (res.success) showToast('奖励顺序已保存');
  });

  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(); });
  modalRoot.hidden = false;
  modalRoot.innerHTML = '';
  modalRoot.classList.add('is-centered');
  modalRoot.appendChild(sheet);
}

/* 新增/编辑奖励表单。reward 为 null 表示新增；自定义奖励可编辑 icon/cardBg，内置奖励不可。 */
function openRewardForm(reward) {
  const isEdit = !!reward;
  const isCustom = isEdit && reward.source === 'custom';

  const sheet = document.createElement('div');
  sheet.className = 'modal-mask';
  const panel = document.createElement('div');
  panel.className = 'modal-sheet is-card';
  panel.setAttribute('role', 'dialog');
  sheet.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = isEdit ? '编辑奖励' : '新增自定义奖励';
  panel.appendChild(title);

  const form = document.createElement('div');
  form.className = 'tm-form';

  const nameField = tmCreateField('奖励名称', 'text', isEdit ? reward.name : '', 20);
  form.appendChild(nameField.wrap);

  const descField = tmCreateField('奖励说明', 'text', isEdit ? (reward.desc || '') : '', 50);
  form.appendChild(descField.wrap);

  const costField = tmCreateField('积分消耗（正整数）', 'number', isEdit ? String(reward.cost) : '100');
  form.appendChild(costField.wrap);

  const categoryField = tmCreateField('分类（学习/生活/玩乐/特权）', 'text', isEdit ? (reward.category || '') : '生活', 10);
  form.appendChild(categoryField.wrap);

  let iconField = null, bgField = null;
  if (!isEdit || isCustom) {
    iconField = tmCreateField('图标（emoji）', 'text', isEdit ? (reward.icon || '') : '🎁', 200);
    form.appendChild(iconField.wrap);
    bgField = tmCreateField('卡片底色（如 #E2F2FC）', 'text', isEdit ? (reward.cardBg || '') : '#E2F2FC', 20);
    form.appendChild(bgField.wrap);
  }
  // 名称变化时自动推断图标；用户手动编辑图标后不再覆盖
  let iconManuallyEdited = false;
  if (iconField) {
    const markManual = () => { iconManuallyEdited = true; };
    iconField.input.addEventListener('input', markManual);
    iconField.input.addEventListener('focus', markManual);
    nameField.input.addEventListener('input', () => {
      if (iconManuallyEdited) return;
      const inferred = inferRewardIconByName(nameField.input.value);
      iconField.input.value = inferred.icon;
      if (bgField) bgField.input.value = inferred.cardBg;
    });
  }
  panel.appendChild(form);

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', closeModal);
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.type = 'button';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', () => {
    const name = nameField.input.value.trim();
    const desc = descField.input.value.trim();
    const cost = parseInt(costField.input.value, 10);
    const category = categoryField.input.value.trim();
    const payload = { name, desc, cost, category };
    if (iconField) payload.icon = iconField.input.value.trim();
    if (bgField) payload.cardBg = bgField.input.value.trim();

    const res = isEdit ? updateReward(reward.id, payload) : addCustomReward(payload);
    if (res.success) {
      showToast(isEdit ? '已保存' : '已新增');
      openRewardManagementSheet();
      if (currentPage === 'rewards') render();
    } else {
      showToast('保存失败：' + (res.reason || '未知错误'));
    }
  });
  actions.appendChild(saveBtn);
  panel.appendChild(actions);

  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(); });
  modalRoot.hidden = false;
  modalRoot.innerHTML = '';
  modalRoot.classList.add('is-centered');
  modalRoot.appendChild(sheet);
  nameField.input.focus();
}

function toggleRewardStatus(rewardId) {
  const res = toggleRewardDisabled(rewardId);
  if (res.success) {
    showToast(res.disabled ? '已停用' : '已启用');
    openRewardManagementSheet();
    if (currentPage === 'rewards') render();
  } else {
    showToast('操作失败：' + (res.reason || '未知错误'));
  }
}

/* ---------- 通用 UI ---------- */
function showSheet(content) {
  modalRoot.hidden = false;
  modalRoot.innerHTML = `<div class="modal-mask" id="modal-mask"></div><div class="modal-sheet" role="dialog">${content}</div>`;
  document.getElementById('modal-mask').addEventListener('click', closeModal);
}
function closeModal() { modalRoot.hidden = true; modalRoot.innerHTML = ''; modalRoot.classList.remove('is-centered'); }
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  toastRoot.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, 1800);
  setTimeout(() => t.remove(), 2200);
}
function showCelebrate(points, msg) {
  showSheet(`<div class="celebrate-box"><div class="stars">🎉🌟</div><div class="c-title">打卡成功！</div><div class="c-points">+${points} 积分</div><div class="c-msg">${msg}</div></div><div class="sheet-actions"><button class="btn btn-primary" id="celebrate-ok" type="button" style="flex:1;">好的</button></div>`);
  document.getElementById('celebrate-ok').addEventListener('click', closeModal);
}

/* ---------- 工具函数 ---------- */
function greetingText() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}
function formatDate(d) {
  const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weeks[d.getDay()]}`;
}
function formatTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

render();
