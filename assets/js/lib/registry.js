/* ============================================================
   registry.js — 模組註冊表（管理層新功能嘅唯一入口）
   ------------------------------------------------------------
   規矩（照真理倉 AGENTS.md §3）：
     · 每個功能 = 一個模組（名、入口位置、所需權限、開關、說明頁）
     · 導航由註冊表自動生成，最多兩層
     · 未登記不得直接加導航／改 UI
     · 分享前設 = 接收方都有該模組（分享清單由註冊表過濾）
   tier：P0/P1/P2/P3 = 施工分期（見 docs/旅系統建構計劃.md §7）
   ============================================================ */

export const GROUPS = {
  troop: '旅團',
  comms: '通訊',
  integ: '整合',
  account: '帳號與對外',
  sys: '系統'
};

export const MODULES = [
  {
    id: 'dashboard', label: '儀表板', icon: 'home', group: 'troop', tier: 'P0', order: 10,
    roles: ['chief', 'leader', 'parent', 'member', 'guest'], defaultOn: true,
    desc: '旅一目了然：五格總覽（支部／連結狀態／待辦／財務／活動）、需要你處理嘅事、最新動態。'
  },
  {
    id: 'pending', label: '待辦與批核', icon: 'check', group: 'troop', tier: 'P0', order: 20,
    roles: ['chief', 'leader'], defaultOn: true, badge: s => s.pendingCount,
    desc: '所有等你拍板嘅事集中一頁：開戶申請、跨團幫手、財務提問、公開項目上報、移交接收。',
    subs: [
      { id: 'pending-account', label: '帳號申請' },
      { id: 'pending-helper', label: '跨團幫手' },
      { id: 'pending-finance', label: '財務提交' },
      { id: 'pending-publish', label: '公開上報' },
      { id: 'pending-transfer', label: '移交接收' }
    ]
  },
  {
    id: 'branches', label: '支部', icon: 'branch', group: 'troop', tier: 'P0', order: 30,
    roles: ['chief', 'leader', 'parent'], defaultOn: true,
    desc: '每個支部一張卡（顯示名／支部別／連結狀態／人數／公開資料），撳入去可以進入該支部系統、睇接駁詳情、為下游開戶。',
    subs: [
      { id: 'branches-list', label: '支部一覽' },
      { id: 'branches-link', label: '下游接駁與登記' }
    ]
  },
  {
    id: 'notices', label: '通告', icon: 'megaphone', group: 'comms', tier: 'P1', order: 40,
    roles: ['chief', 'leader', 'parent', 'member'], defaultOn: true, badge: s => s.noticeDrafts,
    desc: '旅通告發佈、分享俾指定支部（要先有該模組）、公開頁報名、附件指返來源；同頁顯示已訂閱嘅圖書館通告。',
    subs: [
      { id: 'notices-list', label: '全部通告' },
      { id: 'notices-signup', label: '報名與出席' },
      { id: 'notices-subs', label: '我嘅訂閱 ★' }
    ]
  },
  {
    id: 'calendar', label: '行事曆', icon: 'calendar', group: 'comms', tier: 'P1', order: 50,
    roles: ['chief', 'leader', 'parent', 'member'], defaultOn: true,
    desc: '旅一個日曆、每支部一個（各自一色），可以勾選顯示、按標籤過濾、匯出 ICS。',
    subs: [
      { id: 'calendar-month', label: '月曆' },
      { id: 'calendar-list', label: '列表' }
    ]
  },
  {
    id: 'finance', label: '財務整合', icon: 'wallet', group: 'integ', tier: 'P2', order: 60,
    roles: ['chief', 'leader'], defaultOn: true, badge: s => s.financeDue,
    desc: '獨立分頁：各支部用自己 key 簽提交月度摘要（明細留返支部），旅長睇總收支／按支部／按月／按類別，可以退問。',
    subs: [
      { id: 'finance-overview', label: '整合總覽' },
      { id: 'finance-branch', label: '逐支部' },
      { id: 'finance-troop', label: '旅本身帳目' }
    ]
  },
  {
    id: 'inventory', label: '物資整合', icon: 'box', group: 'integ', tier: 'P2', order: 70,
    roles: ['chief', 'leader'], defaultOn: true, badge: s => s.loanPending,
    desc: '獨立分頁：共享範圍（全旅／旅內／本支部）、借用申請路由去 owner 批核、紀錄雙邊可見、庫存自動加減。',
    subs: [
      { id: 'inventory-list', label: '物資清單' },
      { id: 'inventory-loans', label: '借用與歸還' },
      { id: 'inventory-share', label: '共享設定' }
    ]
  },
  {
    id: 'transfers', label: '移交與升降團', icon: 'arrowR', group: 'integ', tier: 'P2', order: 80,
    roles: ['chief', 'leader'], defaultOn: true, badge: s => s.transferPending,
    desc: '升團季批量、跨支部／轉旅／調區同一套：移出 tombstone → 移交套裝 JSON（sha256）→ 目標接收；transferId 冪等、撞號阻擋。',
    subs: [
      { id: 'transfers-pending', label: '待接收' },
      { id: 'transfers-batch', label: '升團季批量' },
      { id: 'transfers-history', label: '歷史' }
    ]
  },
  {
    id: 'users', label: '用戶與身份', icon: 'users', group: 'account', tier: 'P0', order: 90,
    roles: ['chief', 'leader'], defaultOn: true, badge: s => s.usersPending,
    desc: '旅層帳號（旅長／旅層領袖／家長）、邀請連結、跨團權限 branch_access、權限總表、停用與復原。',
    subs: [
      { id: 'users-list', label: '旅員名單' },
      { id: 'users-invites', label: '邀請連結' },
      { id: 'users-perms', label: '權限總表' }
    ]
  },
  {
    id: 'public', label: '公開資料', icon: 'globe', group: 'account', tier: 'P0', order: 100,
    roles: ['chief', 'leader', 'parent'], defaultOn: true,
    desc: '決定開放咩畀未有登入嘅人（等級 0），同各支部嘅公開資料（等級 1–5）。有分享連結／QR／海報。',
    subs: [
      { id: 'public-troop', label: '旅公開資料' },
      { id: 'public-branches', label: '支部公開資料' },
      { id: 'public-share', label: '分享連結與 QR' }
    ]
  },
  {
    id: 'children', label: '我的子女', icon: 'child', group: 'troop', tier: 'P1', order: 15,
    roles: ['parent'], defaultOn: true,
    desc: '家長專頁：子女跨支部自動併埋（進度、通告、活動、繳費），子女編號由該團領袖確認。'
  },
  {
    id: 'system', label: '系統', icon: 'shield', group: 'sys', tier: 'P0', order: 110,
    roles: ['chief'], defaultOn: true, badge: s => s.systemAlerts,
    desc: '旅團設定、模組開關（TROOP_MODULES）、後端實況（逐表寫自證）、審計與操作紀錄、自動化、資料備份、PDPO 清單。',
    subs: [
      { id: 'system-troop', label: '旅團設定' },
      { id: 'system-modules', label: '模組開關' },
      { id: 'system-backend', label: '後端實況' },
      { id: 'system-audit', label: '審計與操作紀錄' },
      { id: 'system-automation', label: '自動化' },
      { id: 'system-data', label: '資料與備份' },
      { id: 'system-privacy', label: 'PDPO 與私隱' },
      { id: 'system-keys', label: '接駁與金鑰' }
    ]
  },
  {
    id: 'docs', label: '教學', icon: 'book', group: 'sys', tier: 'P3', order: 120,
    roles: ['chief', 'leader', 'parent', 'member', 'guest'], defaultOn: true,
    desc: '三層教材：每角色快速入門、每模組說明、示範旅引導任務；加「開旅 checklist」。'
  }
];

export const moduleList = () => MODULES.slice().sort((a, b) => a.order - b.order);
export const moduleById = id => MODULES.find(m => m.id === id);
export const modulesForRole = role => moduleList().filter(m => m.roles.includes(role || 'guest'));
export const groupOf = id => GROUPS[moduleById(id)?.group] || '';

/** 旅層模組開關：'all' = 全旅開；'off' = 全旅閂；陣列 = 只有指定支部開 */
export function moduleEnabled(data, moduleId, branchId = null) {
  const set = data?.modules?.[moduleId];
  if (set === undefined || set === 'all') return true;
  if (set === 'off') return false;
  if (Array.isArray(set)) return branchId ? set.includes(branchId) : set.length > 0;
  return true;
}

/** 分享前設：接收方要有該模組，先分享得到 */
export function shareableTargets(data, moduleId, excludeId = '') {
  return (data?.branches || []).filter(b => b.id !== excludeId && moduleEnabled(data, moduleId, b.id));
}

export const VIS_LEVELS = [
  { id: 0, name: '公眾', desc: '免登入都睇到（公開頁／分享連結）' },
  { id: 1, name: '其他支部', desc: '已登記嘅其他支部用戶先睇到' },
  { id: 2, name: '團員', desc: '本支部團員或以上' },
  { id: 3, name: '執委', desc: '執委或以上' },
  { id: 4, name: '領袖', desc: '領袖或以上' },
  { id: 5, name: '旅長／團長', desc: '最高權限' }
];
export const visName = n => VIS_LEVELS.find(v => v.id === Number(n))?.name || '團員';
export const visClass = n => 'vis-' + Math.max(0, Math.min(5, Number(n) || 0));

export const ROLE_LABEL = {
  chief: '旅長', leader: '旅層領袖', parent: '家長', member: '成員', guest: '訪客', super: '平台超管'
};

/** 角色可以做嘅動作（前端只係提示；真正授權喺 server-side） */
const PERMS = {
  chief: ['view_all', 'branch_view', 'branch_link_edit', 'open_account_downstream', 'notice_publish', 'calendar_edit', 'finance_view', 'finance_confirm', 'inventory_all', 'transfer_all', 'user_manage', 'invite_create', 'public_edit', 'module_toggle', 'system_all', 'audit_view'],
  leader: ['branch_view', 'notice_publish', 'calendar_edit', 'finance_view', 'finance_submit_troop', 'inventory_all', 'transfer_view', 'user_view', 'public_edit', 'audit_view'],
  parent: ['children_view', 'notice_view', 'calendar_view'],
  member: ['notice_view', 'calendar_view'],
  guest: ['public_view']
};
export const can = (role, perm) => (PERMS[role] || []).includes(perm);
