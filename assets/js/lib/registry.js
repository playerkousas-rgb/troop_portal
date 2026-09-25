/* ============================================================
   registry.js — 模組註冊表 ＋ 角色／身份／職稱／年齡組（唯一入口）
   ------------------------------------------------------------
   規矩（照真理倉 AGENTS.md §3）：
     · 每個功能 = 一個模組（名、入口位置、所需權限、開關、說明頁）
     · 導航由註冊表自動生成，最多兩層；未登記不得直接加導航／改 UI
     · 分享前設 = 接收方都有該模組（分享清單由註冊表過濾）

   角色（role，決定帳號住邊張 Sheet）：
     chief 旅長        → 旅 SHEET
     coach 教練員      → 旅 SHEET（可跨團，按 branch_access）
     parent 家長       → 旅 SHEET
     member 支部人員   → 該團支部 SHEET（團長／副團長／成員全部係呢個 role）
     super 平台超管    → 平台（隱藏，唔喺任何名單出現）
   ★ 冇「旅層領袖」呢個角色：旅層只有旅長同教練員；其餘（團長、副團長、成員）都係支部人員。

   身份（identity，支部層）：
     團長／副團長（帶團）｜管委／執委（治理）｜隊長／副隊長／團隊長（小隊）｜團員
   職稱（title）：主席／副主席／秘書／財務 —— 默認權限跟執委／管委，可按人微調。
   年齡組（ageGroup）：adult 18+ ／ minor 未夠 18（自動由出生日期計，可人手覆核）。
   ============================================================ */

export const GROUPS = {
  me: '我的',
  troop: '旅團',
  comms: '通訊',
  integ: '整合',
  account: '帳號與對外',
  sys: '系統',
  platform: '平台（隱藏）'
};

export const MODULES = [
  {
    id: 'mine', label: '我的支部', icon: 'child', group: 'me', tier: 'P0', order: 5,
    roles: ['chief', 'coach', 'member'], defaultOn: true,
    desc: '我嘅身份卡（身份／職稱／年齡組／權限）、我嘅通告活動、入自己支部系統、未成年監護與家長同意狀態。'
  },
  {
    id: 'children', label: '我的子女', icon: 'users', group: 'me', tier: 'P1', order: 6,
    roles: ['parent'], defaultOn: true,
    desc: '家長專頁：子女跨支部自動併埋（進度、通告、活動、繳費），子女編號由該團領袖確認。'
  },
  {
    id: 'dashboard', label: '儀表板', icon: 'home', group: 'me', tier: 'P0', order: 10,
    roles: ['chief', 'coach', 'parent', 'member'], defaultOn: true,
    desc: '一頁睇齊（可收合）：支部／連結狀態／待辦／財務／活動。所有區塊默認收合，電話都撳得順。'
  },
  {
    id: 'pending', label: '待辦與批核', icon: 'check', group: 'troop', tier: 'P0', order: 20,
    roles: ['chief', 'coach'], defaultOn: true, badge: s => s.pendingCount,
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
    roles: ['chief', 'coach', 'parent', 'member'],
    identities: ['團長', '副團長'],            // 支部人員只放行團長／副團長
    defaultOn: true,
    desc: '每個支部一張卡（顯示名／支部別／接駁狀態／人數／公開資料）。未登記下游＝入唔到支部系統，會紅字講明。',
    subs: [
      { id: 'branches-list', label: '支部一覽' },
      { id: 'branches-link', label: '下游接駁與登記' }
    ]
  },
  {
    id: 'notices', label: '通告', icon: 'megaphone', group: 'comms', tier: 'P1', order: 40,
    roles: ['chief', 'coach', 'parent', 'member'], defaultOn: true, badge: s => s.noticeDrafts,
    desc: '旅通告發佈、分享俾指定支部（要先有該模組）、公開頁報名、附件指返來源；同頁顯示已訂閱嘅圖書館通告。',
    subs: [
      { id: 'notices-list', label: '全部通告' },
      { id: 'notices-signup', label: '報名與出席' },
      { id: 'notices-subs', label: '我嘅訂閱 ★' }
    ]
  },
  {
    id: 'calendar', label: '行事曆', icon: 'calendar', group: 'comms', tier: 'P1', order: 50,
    roles: ['chief', 'coach', 'parent', 'member'], defaultOn: true,
    desc: '旅一個日曆、每支部一個（各自一色），可以勾選顯示、按標籤過濾、匯出 ICS。',
    subs: [
      { id: 'calendar-month', label: '月曆' },
      { id: 'calendar-list', label: '列表' }
    ]
  },
  {
    id: 'finance', label: '財務整合', icon: 'wallet', group: 'integ', tier: 'P2', order: 60,
    roles: ['chief', 'coach'], defaultOn: true, badge: s => s.financeDue,
    desc: '獨立分頁：各支部用自己 key 簽提交月度摘要（明細留返支部），旅長睇總收支／按支部／按月／按類別，可以退問。',
    subs: [
      { id: 'finance-overview', label: '整合總覽' },
      { id: 'finance-branch', label: '逐支部' },
      { id: 'finance-troop', label: '旅本身帳目' }
    ]
  },
  {
    id: 'inventory', label: '物資整合', icon: 'box', group: 'integ', tier: 'P2', order: 70,
    roles: ['chief', 'coach', 'member'],
    identities: ['團長', '副團長', '管委', '執委', '隊長', '副隊長', '團隊長', '團員'],
    defaultOn: true, badge: s => s.loanPending,
    desc: '獨立分頁：共享範圍（全旅／旅內／本支部）、借用申請路由去 owner 批核、紀錄雙邊可見、庫存自動加減。',
    subs: [
      { id: 'inventory-list', label: '物資清單' },
      { id: 'inventory-loans', label: '借用與歸還' },
      { id: 'inventory-share', label: '共享設定' }
    ]
  },
  {
    id: 'transfers', label: '移交與升降團', icon: 'arrowR', group: 'integ', tier: 'P2', order: 80,
    roles: ['chief', 'coach'], defaultOn: true, badge: s => s.transferPending,
    desc: '升團季批量、跨支部／轉旅／調區同一套：移出 tombstone → 移交套裝 JSON（sha256）→ 目標接收；transferId 冪等、撞號阻擋。',
    subs: [
      { id: 'transfers-pending', label: '待接收' },
      { id: 'transfers-batch', label: '升團季批量' },
      { id: 'transfers-history', label: '歷史' }
    ]
  },
  {
    id: 'users', label: '用戶與身份', icon: 'settings', group: 'account', tier: 'P0', order: 90,
    roles: ['chief', 'coach'], defaultOn: true, badge: s => s.usersPending,
    desc: '帳號（旅長／教練員／家長／支部人員）、邀請連結、身份與職稱、逐人權限微調、branch_access、停用與復原。超管唔會喺呢度出現。',
    subs: [
      { id: 'users-list', label: '帳號名單' },
      { id: 'users-identities', label: '身份與職稱' },
      { id: 'users-invites', label: '邀請連結' },
      { id: 'users-perms', label: '權限總表' }
    ]
  },
  {
    id: 'public', label: '公開資料', icon: 'globe', group: 'account', tier: 'P0', order: 100,
    roles: ['chief', 'coach', 'parent', 'member'], defaultOn: true,
    desc: '決定開放咩畀未有登入嘅人（等級 0），同各支部嘅公開資料（等級 1–5）。有分享連結／QR／海報。',
    subs: [
      { id: 'public-troop', label: '旅公開資料' },
      { id: 'public-branches', label: '支部公開資料' },
      { id: 'public-share', label: '分享連結與 QR' }
    ]
  },
  {
    id: 'system', label: '系統', icon: 'shield', group: 'sys', tier: 'P0', order: 110,
    roles: ['chief'], defaultOn: true, badge: s => s.systemAlerts,
    desc: '旅團設定、模組開關（TROOP_MODULES）、後端實況（逐表寫自證）、審計與操作紀錄、自動化、資料備份、PDPO 清單、接駁與金鑰。',
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
    id: 'platform', label: '平台', icon: 'sparkle', group: 'platform', tier: 'P3', order: 900,
    roles: ['super'], defaultOn: true, hidden: true,
    desc: '超管專用（隱藏）：新旅／新下游接入收件匣、units registry、金鑰輪換提醒、跨旅一覽。呢個模組唔會喺任何名單或導航出現（除咗超管自己）。',
    subs: [
      { id: 'platform-inbox', label: '接入收件匣' },
      { id: 'platform-units', label: '旅登記（units）' },
      { id: 'platform-keys', label: '金鑰與輪換' }
    ]
  },
  {
    id: 'shares', label: '分享中心', icon: 'share', group: 'integ', tier: 'P1', order: 105,
    roles: ['chief', 'coach', 'member'], defaultOn: true, badge: s => s.sharesPending,
    desc: '★ 收件方決定：其他支部 share 嚟嘅嘢，要你哋接收先會出現喺你嘅清單；未接收只喺「待接收」。',
    subs: [
      { id: 'shares-inbox', label: '待接收' },
      { id: 'shares-accepted', label: '已接收' },
      { id: 'shares-sent', label: '我哋發出' },
      { id: 'shares-rules', label: '分享規矩' }
    ]
  },
  {
    id: 'docs', label: '教學', icon: 'book', group: 'sys', tier: 'P3', order: 120,
    roles: ['chief', 'coach', 'parent', 'member'], defaultOn: true,
    desc: '三層教材：每角色快速入門、每模組說明、開旅 checklist；加「功能藍圖」。成個系統只有呢一個「教學」入口。'
  }
];

export const moduleList = () => MODULES.slice().sort((a, b) => a.order - b.order);
export const moduleById = id => MODULES.find(m => m.id === id);
export const groupOf = id => GROUPS[moduleById(id)?.group] || '';

/** 角色 ＋（支部人員）身份 都夾得入先算可用 */
export function moduleAllowed(mod, session) {
  if (!mod) return false;
  const role = session?.role || 'guest';
  if (!mod.roles.includes(role)) return false;
  if (mod.identities && role === 'member') return mod.identities.includes(session?.identity || '');
  return true;
}
export const modulesForSession = session => moduleList().filter(m => moduleAllowed(m, session));
export const modulesForRole = role => moduleList().filter(m => m.roles.includes(role || 'guest'));

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

/* ============================================================
   角色
   ============================================================ */
export const ROLE_LABEL = {
  chief: '旅長', coach: '教練員', parent: '家長', member: '支部人員', super: '平台超管', guest: '訪客'
};
export const ROLE_DESC = {
  chief: '全旅最高權限：開戶、接駁、權限、財務確認、公開資料、審計',
  coach: '旅層只有旅長同教練員。教練員按 branch_access 睇指定支部（例：深資團長去協助童軍團）',
  parent: '帳號住旅：子女跨支部自動併埋（進度／通告／繳費）',
  member: '帳號住自己團支部 SHEET（團長、副團長、成員都係呢個角色）',
  super: '平台超管（隱藏）：開旅、接入、金鑰；唔喺任何人嘅名單出現',
  guest: '未登入：只睇等級 0 公開資料'
};
/** 帳號錨點：身份＝SCOUT_ID + 所在 SHEET */
export const ROLE_ANCHOR = {
  chief: '旅 SHEET', coach: '旅 SHEET', parent: '旅 SHEET',
  member: '該團支部 SHEET', super: '平台', guest: '—'
};

/* ============================================================
   支部身份（identity）＋ 職稱（title）
   ------------------------------------------------------------
   rank = 可見等級上限；leader/exec/youthLeader 係默認權限群組
   ============================================================ */
export const BRANCH_IDENTITIES = [
  { id: '團長', rank: 5, leader: true, desc: '支部最高負責人（該團 Sheet 落筆；旅只經 sig 讀）' },
  { id: '副團長', rank: 4, leader: true, desc: '協助團長；團長唔喺度時頂上' },
  { id: '管委', rank: 4, exec: true, desc: '管理委員會成員（同執委，但睇高一級）' },
  { id: '執委', rank: 3, exec: true, desc: '執行委員會成員：支部內部資料、表決、財務摘要' },
  { id: '隊長', rank: 3, youthLeader: true, desc: '小隊隊長：隊務、點名、帶活動' },
  { id: '副隊長', rank: 3, youthLeader: true, desc: '小隊副隊長' },
  { id: '團隊長', rank: 3, youthLeader: true, desc: '團隊長（團層青少年領袖）' },
  { id: '團員', rank: 2, desc: '一般成員' }
];
export const IDENTITY_IDS = BRANCH_IDENTITIES.map(i => i.id);
export const identityMeta = id => BRANCH_IDENTITIES.find(i => i.id === id) || { id, rank: 2, desc: '' };

export const TITLES = ['主席', '副主席', '秘書', '財務'];
export const TITLE_META = {
  主席: { follows: '管委', rank: 4, desc: '默認跟「管委」權限；可按人微調' },
  副主席: { follows: '執委', rank: 3, desc: '默認跟「執委」權限；可按人微調' },
  秘書: { follows: '執委', rank: 3, desc: '默認跟「執委」權限；文書、通告、名冊' },
  財務: { follows: '管委', rank: 4, desc: '默認跟「管委」權限；財務摘要、單據' }
};
export const titleMeta = t => TITLE_META[t] || null;

/** 職稱默認權限＝跟執委／管委；可按人微調（member.perms） */
export function defaultRankFor(identity, title) {
  const t = titleMeta(title);
  const i = identityMeta(identity);
  return Math.max(t ? t.rank : 2, i.rank || 2);
}

/* ============================================================
   年齡組：18+ ／ 未夠 18
   ============================================================ */
export const AGE_GROUPS = [
  { id: 'adult', label: '18 + （成年）', desc: '自己管帳號、自己簽同意、可以做教練員、可自行報名' },
  { id: 'minor', label: '未夠 18（未成年）', desc: '要監護人（家長帳號）＋家長同意；報名、借用、公開亮相要家長同意' }
];
export const ageGroupLabel = id => AGE_GROUPS.find(a => a.id === id)?.label || '未夠 18（未成年）';
export function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(String(dob).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}
export const ageGroupOf = dob => {
  const a = ageFromDob(dob);
  return a === null ? 'minor' : (a >= 18 ? 'adult' : 'minor');
};

/* ============================================================
   權限（前端只係提示；真正授權永遠喺 server-side）
   ============================================================ */
const PERMS = {
  chief: ['view_all', 'branch_view', 'share_decide', 'share_send', 'branch_link_edit', 'open_account_downstream', 'notice_publish', 'calendar_edit',
    'finance_view', 'finance_confirm', 'inventory_all', 'transfer_all', 'user_manage', 'identity_manage',
    'invite_create', 'public_edit', 'module_toggle', 'system_all', 'audit_view', 'enter_any_branch'],
  coach: ['branch_view', 'enter_granted_branch', 'share_decide', 'share_send', 'notice_publish', 'calendar_edit', 'finance_view', 'finance_submit_troop',
    'inventory_all', 'transfer_view', 'user_view', 'public_edit', 'audit_view'],
  parent: ['children_view', 'notice_view', 'calendar_view', 'share_send'],
  member: ['self_view', 'notice_view', 'calendar_view', 'branch_own', 'share_decide', 'share_send'],
  super: ['platform_all', 'enter_any_branch', 'audit_view'],
  guest: ['public_view']
};
export const can = (role, perm) => (PERMS[role] || []).includes(perm);
/** ★ 分享嘅接收／退回：該支部執委或以上（rank ≥ 3）；旅長／教練員可以代勞 */
export const canDecideShare = (role, rank = 0) => ['chief', 'coach'].includes(role) || Number(rank) >= 3;

/** ★ 分享種類：只做兩樣（2026-09-25 用戶定案）—— 通告 ＋ 活動（行事曆）
    其他種類（物資／進度／相簿／教材）留住個 kind 欄，但 UI 唔開，之後先加。 */
export const SHARE_KINDS = [
  { id: 'notice', label: '通告', to: '通告頁', icon: 'megaphone' },
  { id: 'event', label: '活動（行事曆）', to: '行事曆', icon: 'calendar' }
];
export const shareKind = id => SHARE_KINDS.find(k => k.id === id) || null;
export const PERMS_OF = role => (PERMS[role] || []).slice();
/** 權限總表用：角色欄 ＋ 權限清單（中文標籤） */
export const MODULE_ROLE_COLS = ['chief', 'coach', 'parent', 'member'];
export const PERM_LABELS_OF = [
  ['view_all', '睇全旅'], ['branch_view', '睇支部'], ['branch_link_edit', '改接駁'],
  ['open_account_downstream', '為下游開戶'], ['notice_publish', '發通告'], ['calendar_edit', '改日曆'],
  ['finance_view', '睇財務'], ['finance_confirm', '確認財務'], ['inventory_all', '物資管理'],
  ['transfer_all', '移交'], ['user_manage', '管帳號'], ['identity_manage', '改身份／職稱'],
  ['invite_create', '發邀請'], ['public_edit', '改公開資料'], ['module_toggle', '模組開關'],
  ['system_all', '系統'], ['audit_view', '睇審計'], ['branch_own', '自己支部'], ['self_view', '自己紀錄']
];
/** 身份組（權限總表用） */
export const IDENTITY_GROUPS = [
  ['團長級', ['團長', '副團長']],
  ['執委／管委', ['執委', '管委']],
  ['青少年領袖', ['隊長', '副隊長', '團隊長']],
  ['團員', ['團員']]
];
