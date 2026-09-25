/* ============================================================
   demo.js — 示範旅（MOCK）資料
   ------------------------------------------------------------
   ★ 純 UI 示範用：全部係假數據，住喺瀏覽器（localStorage），
     唔會、亦唔可能寫入任何真後端。
     真實模式下資料一律由旅 GAS /exec 經同源 /api/proxy 讀寫。
   匯出時會帶 `_exportedFrom: 'mock'`，同真數據分開。
   ============================================================ */

import { addDays, iso, todayISO } from './util.js';

const T = todayISO();
const D = n => addDays(T, n);

export const DEMO_TRAVEL = {
  code: '0082',
  name: '第八十二旅',
  nameEn: '82nd Hong Kong Group',
  district: '沙田區',
  sponsor: '沙田循道衛理中學',
  founded: '1978',
  chief: '陳大文',
  theme: 'green',
  slogan: '旅團同心 · 服務社群',
  publicIntro: '第八十二旅於 1978 年創立，服務沙田區青少年超過四十年，現設小童軍、幼童軍、童軍、深資童軍及樂行童軍五個支部。旅團以「自務自治、服務社群」為本，每年舉辦旅露營、社區服務及海外交流。',
  publicContact: 'info@demo-82.scout.hk',
  motorPool: false
};

/** 支部（＝下游節點）。link 狀態係示範：綠=已接駁且閂口、黃=已登記未閂口、紅=未接駁 */
export const DEMO_BRANCHES = [
  {
    id: 'vs0082', code: '0082', name: '深資童軍團', section: '深資童軍', color: '#7B2233',
    youth: 18, adults: 4, founded: '2012',
    leader: '張偉業', leaderEmail: 'cheung@demo.troop',
    link: { state: 'green', purpose: 'vsbadge-troop-sig-v1', api: 'v1', localLogin: false, registeredAt: '2026-09-18', lastPing: '2026-09-25 07:40', testedAt: '2026-09-25 07:40', backend: 'script.google.com/macros/s/AKfyc…VS/exec', note: '進度 leaf 已接駁，本地入口已閂' },
    progressSource: 'vsbadge', hasPortal: true, publicRank: 2,
    layout: { id: 'vs', name: '深資版（自家設計）', from: 'vs_portal', state: 'copy-pending', note: '支部已設計好；之後照抄入嚟（旅側唔另設）' }
  },
  {
    id: 'sc0082', code: '0082', name: '童軍團', section: '童軍', color: '#1d4e89',
    youth: 42, adults: 6, founded: '1978',
    leader: '李美儀', leaderEmail: 'lee@demo.troop',
    link: { state: 'yellow', purpose: 'scportal-troop-sig-v1', api: 'v1', localLogin: true, registeredAt: '2026-09-22', lastPing: '2026-09-24 21:10', testedAt: '2026-09-24 21:10', backend: 'script.google.com/macros/s/AKfy…SC/exec', note: '已登記，未閂本地入口（等下屬補 sig）' },
    progressSource: 'scoutbadge', hasPortal: true, publicRank: 1,
    layout: { id: 'scout', name: '童軍版（自家設計）', from: 'scout_portal', state: 'copy-pending', note: '支部已設計好；之後照抄入嚟' }
  },
  {
    id: 'cs0082', code: '0082', name: '幼童軍團', section: '幼童軍', color: '#b58b00',
    youth: 36, adults: 5, founded: '1985',
    leader: '黃志強', leaderEmail: 'wong@demo.troop',
    link: { state: 'green', purpose: 'cubsbadge-troop-sig-v1', api: 'v1', localLogin: false, registeredAt: '2026-09-20', lastPing: '2026-09-25 06:05', testedAt: '2026-09-25 06:05', backend: 'script.google.com/macros/s/AKfy…CS/exec', note: '已接駁（cubsbadge 零回打版，待對齊）' },
    progressSource: 'cubsbadge', hasPortal: true, publicRank: 2,
    layout: { id: 'cubs', name: '幼童軍版（自家設計）', from: 'cubs_portal', state: 'copy-pending', note: '照抄；要保留旅側嘅身份／分享插槽' }
  },
  {
    id: 'gs0082', code: '0082', name: '小童軍團', section: '小童軍', color: '#2e8a52',
    youth: 28, adults: 4, founded: '1996',
    leader: '陳小萍', leaderEmail: 'chan@demo.troop',
    link: { state: 'red', purpose: '', api: '', localLogin: true, registeredAt: '', lastPing: '—', testedAt: '', backend: '', note: '未接駁（該團未起支部系統）' },
    progressSource: '', hasPortal: false, publicRank: 1,
    layout: { id: 'generic', name: '通用版面（未設計）', from: '', state: 'generic', note: '未有自家版面 —— 用通用版面，之後換' }
  },
  {
    id: 'rs0082', code: '0082', name: '樂行童軍團', section: '樂行童軍', color: '#a8531f',
    youth: 11, adults: 3, founded: '2019',
    leader: '何家俊', leaderEmail: 'ho@demo.troop',
    link: { state: 'green', purpose: 'roverbadge-troop-sig-v1', api: 'v1', localLogin: false, registeredAt: '2026-09-19', lastPing: '2026-09-25 07:02', backend: 'script.google.com/macros/s/AKfy…RS/exec', note: '已接駁，本地入口已閂' },
    progressSource: 'roverbadge', hasPortal: true, publicRank: 2,
    layout: { id: 'rover', name: '樂行版（自家設計）', from: 'rover_portal', state: 'copy-pending', note: '照抄' }
  }
];

/** 旅員（旅層帳號）。密碼一律唔會出現喺前端：示範用萬用密碼 demo1234。 */
export const DEMO_USERS = [
  {
    id: 'u-chief', role: 'chief', name: '陳大文', email: 'chief@demo.troop', phone: '9123 4567',
    title: '旅長', anchor: '旅 SHEET', ageGroup: 'adult',
    branchAccess: ['*'], status: 'active', mustChangePw: false, at: '2026-08-30 10:00', lastLogin: '2026-09-25 07:30'
  },
  {
    id: 'u-lee', role: 'coach', name: '李美儀', email: 'coach@demo.troop', phone: '9234 5678',
    title: '教練員（跨團）', anchor: '旅 SHEET', ageGroup: 'adult', yearsService: 12,
    branchAccess: ['sc0082', 'cs0082'], status: 'active', mustChangePw: false, at: '2026-09-01 14:20', lastLogin: '2026-09-24 21:05'
  },
  {
    id: 'u-parent', role: 'parent', name: '陳小萍', email: 'parent@demo.troop', phone: '9456 7890',
    title: '家長', anchor: '旅 SHEET', ageGroup: 'adult',
    children: ['YMIS-2001', 'YMIS-2002'], branchAccess: [], status: 'active', mustChangePw: false, at: '2026-09-03 20:00', lastLogin: '2026-09-25 06:50'
  },
  {
    id: 'u-b-leader', role: 'member', name: '鄭美玲', email: 'cs-leader@demo.troop', phone: '9567 1234',
    title: '幼童軍團長', anchor: '幼童軍團 SHEET（cs0082）', ageGroup: 'adult',
    branchId: 'cs0082', ymis: 'YMIS-2010', identity: '團長', branchAccess: ['cs0082'],
    status: 'active', mustChangePw: false, at: '2026-09-02 09:10', lastLogin: '2026-09-24 20:15'
  },
  {
    id: 'u-b-leader2', role: 'member', name: '黃志強', email: 'cs-deputy@demo.troop', phone: '9345 6789',
    title: '幼童軍副團長', anchor: '幼童軍團 SHEET（cs0082）', ageGroup: 'adult',
    branchId: 'cs0082', ymis: 'YMIS-2011', identity: '副團長', branchAccess: ['cs0082'],
    status: 'active', mustChangePw: false, at: '2026-09-02 09:30', lastLogin: '2026-09-23 19:40'
  },
  {
    id: 'u-m-exec', role: 'member', name: '郭嘉敏', email: 'vs-exec@demo.troop', phone: '9678 2345',
    title: '深資童軍執委（主席）', anchor: '深資童軍團 SHEET（vs0082）', ageGroup: 'adult',
    branchId: 'vs0082', ymis: 'YMIS-2006', identity: '執委', memberTitle: '主席',
    branchAccess: ['vs0082'], perms: { note: '職稱「主席」默認跟管委權限；另加「可批准小額支出（$500 以下）」' },
    status: 'active', mustChangePw: false, at: '2026-08-20 11:00', lastLogin: '2026-09-22 18:30'
  },
  {
    id: 'u-m-adult', role: 'member', name: '陳家豪', email: 'vs-team@demo.troop', phone: '9789 3456',
    title: '深資童軍（18+）', anchor: '深資童軍團 SHEET（vs0082）', ageGroup: 'adult',
    branchId: 'vs0082', ymis: 'YMIS-2001', identity: '團隊長', branchAccess: ['vs0082'],
    status: 'active', mustChangePw: false, at: '2026-09-10 16:00', lastLogin: '2026-09-21 17:20'
  },
  {
    id: 'u-m-minor', role: 'member', name: '陳家欣', email: 'sc-cpl@demo.troop', phone: '',
    title: '童軍副隊長（未夠 18）', anchor: '童軍團 SHEET（sc0082）', ageGroup: 'minor',
    branchId: 'sc0082', ymis: 'YMIS-2002', identity: '副隊長', guardian: 'u-parent', guardianName: '陳小萍',
    branchAccess: ['sc0082'], status: 'active', mustChangePw: false, at: '2026-09-12 15:00', lastLogin: '2026-09-20 16:05'
  },
  {
    id: 'u-m-scout', role: 'member', name: '林浩然', email: 'sc-scout@demo.troop', phone: '',
    title: '童軍團員（18+）', anchor: '童軍團 SHEET（sc0082）', ageGroup: 'adult',
    branchId: 'sc0082', ymis: 'YMIS-2003', identity: '團員', consent: true,
    branchAccess: ['sc0082'], status: 'active', mustChangePw: false, at: '2026-09-01 10:00', lastLogin: '2026-09-22 19:40'
  },
  {
    id: 'u-parent2', role: 'parent', name: '林美好', email: 'lam@demo.troop', phone: '9567 8901',
    title: '家長', anchor: '旅 SHEET', ageGroup: 'adult',
    children: ['YMIS-2003'], branchAccess: [], status: 'pending', mustChangePw: true, at: '2026-09-24 18:30', lastLogin: '—',
    pendingNote: '子女綁定待童軍團領袖確認'
  },
  {
    id: 'u-parent3', role: 'parent', name: '何太', email: 'ho@demo.troop', phone: '9111 2222',
    title: '家長（監護人）', anchor: '旅 SHEET', ageGroup: 'adult',
    children: ['YMIS-2004'], branchAccess: [], status: 'active', mustChangePw: false, at: '2026-09-05 20:30', lastLogin: '2026-09-19 21:10'
  },
  {
    id: 'u-super', role: 'super', name: '平台超管', email: 'super@platform.local', phone: '—',
    title: '平台管理員（超管）', anchor: '平台', ageGroup: 'adult', hidden: true,
    branchAccess: ['*'], status: 'active', mustChangePw: false, at: '2026-01-01 00:00', lastLogin: '2026-09-01 03:00'
  }
];

/** 名冊摘要（每支部）＋ 個別成員（示範用少量真名） */
export const DEMO_MEMBERS = [
  { ymis: 'YMIS-2001', name: '陳家豪', branchId: 'vs0082', identity: '團隊長', title: '', patrol: '—', dob: '2007-04-12', joined: '2019-09-01', status: 'ACTIVE', account: 'u-m-adult' },
  { ymis: 'YMIS-2002', name: '陳家欣', branchId: 'sc0082', identity: '副隊長', title: '', patrol: '黑豹小隊', dob: '2012-11-03', joined: '2022-09-01', status: 'ACTIVE', account: 'u-m-minor' },
  { ymis: 'YMIS-2003', name: '林浩然', branchId: 'sc0082', identity: '團員', title: '', patrol: '黑豹小隊', dob: '2011-06-20', joined: '2021-09-01', status: 'ACTIVE', pendingParent: 'u-parent2' },
  { ymis: 'YMIS-2004', name: '何靜文', branchId: 'cs0082', identity: '團員', title: '', patrol: '黃六', dob: '2015-02-09', joined: '2024-09-01', status: 'ACTIVE', guardian: 'u-parent3' },
  { ymis: 'YMIS-2005', name: '梁俊傑', branchId: 'rs0082', identity: '執委', title: '秘書', patrol: '—', dob: '2005-08-15', joined: '2023-09-01', status: 'ACTIVE' },
  { ymis: 'YMIS-2006', name: '郭嘉敏', branchId: 'vs0082', identity: '執委', title: '主席', patrol: '—', dob: '2006-01-30', joined: '2018-09-01', status: 'ACTIVE', account: 'u-m-exec' },
  { ymis: 'YMIS-2007', name: '黃子朗', branchId: 'gs0082', identity: '團員', title: '', patrol: '綠六', dob: '2018-07-07', joined: '2025-09-01', status: 'ACTIVE', guardian: 'u-parent4' },
  { ymis: 'YMIS-2008', name: '鄧小鳳', branchId: 'sc0082', identity: '隊長', title: '', patrol: '黑豹小隊', dob: '2013-03-21', joined: '2023-09-01', status: 'ACTIVE' },
  { ymis: 'YMIS-2009', name: '曾俊宇', branchId: 'sc0082', identity: '團員', title: '', patrol: '—', dob: '2014-12-05', joined: '2024-09-01', status: 'TRANSFERRED_OUT' },
  { ymis: 'YMIS-2010', name: '鄭美玲', branchId: 'cs0082', identity: '團長', title: '', patrol: '—', dob: '1991-05-18', joined: '2020-09-01', status: 'ACTIVE', adult: true, account: 'u-b-leader' },
  { ymis: 'YMIS-2011', name: '黃志強', branchId: 'cs0082', identity: '副團長', title: '', patrol: '—', dob: '1985-09-02', joined: '2015-09-01', status: 'ACTIVE', adult: true, account: 'u-b-leader2' }
];

/** 進度摘要（家長頁／支部卡用）。items：每項 {name, stage, at, by} */
export const DEMO_PROGRESS = {
  'YMIS-2001': {
    source: 'vsbadge', updated: '2026-09-24', award: '深資童軍獎章', awardPct: 72,
    items: [
      { name: '深資童軍章', stage: '已完成', at: '2025-11-20', by: '張偉業' },
      { name: '龍章（Dragon Scout Award）', stage: '進行中', at: '2026-09-10', by: '張偉業', detail: '野外探索 2/3' },
      { name: '服務章', stage: '已完成', at: '2026-06-14', by: '張偉業' },
      { name: '專科章：急救', stage: '待批', at: '2026-09-22', by: '團員申報' }
    ],
    history: [
      { kind: '活動', name: '旅露營 2026', at: '2026-08-01', note: '3 日 2 夜' },
      { kind: '服務', name: '長者中心探訪', at: '2026-06-14', note: '8 小時' }
    ]
  },
  'YMIS-2002': {
    source: 'scoutbadge', updated: '2026-09-23', award: '童軍標準章', awardPct: 45,
    items: [
      { name: '童軍章', stage: '進行中', at: '2026-05-01', by: '李美儀' },
      { name: '小隊露營', stage: '已完成', at: '2026-07-12', by: '李美儀' },
      { name: '專科章：烹飪', stage: '待批', at: '2026-09-20', by: '團員申報' }
    ],
    history: [{ kind: '活動', name: '區大會操', at: '2026-05-18', note: '全團出席' }]
  }
};

/** 通告（旅層 + 支部，含分享設定） */
export const DEMO_NOTICES = [
  {
    id: 'n-1', scope: 'troop', title: '2026 旅露營（全旅）', category: '活動', status: 'published',
    at: D(-6), eventDate: D(21), deadline: D(12), fee: 380, quota: 120, signed: 86,
    vis: 2, shareTo: ['vs0082', 'sc0082', 'cs0082', 'gs0082', 'rs0082'],
    body: '一連三日兩夜旅露營，五個支部聯合進行。營地：西貢創興水上活動中心。費用包括膳食、營具及交通。每位成員須自備睡袋、雨具及個人藥物。\n\n家長可於通告頁直接回覆出席與否，並上載同意書（相片上載 ≤5MB）。',
    attachments: ['旅露營須知.pdf'], library: false, signupFrom: 'member'
  },
  {
    id: 'n-2', scope: 'troop', title: '旅團服務日：沙田公園清潔', category: '服務', status: 'published',
    at: D(-2), eventDate: D(9), deadline: D(5), fee: 0, quota: 60, signed: 41,
    vis: 1, shareTo: ['sc0082', 'vs0082'],
    body: '與沙田區議會合辦社區清潔服務，童軍及深資童軍支部為主力，幼童軍可參加開幕禮。\n服務時數可計入服務章。',
    attachments: [], library: false, signupFrom: 'member'
  },
  {
    id: 'n-3', scope: 'troop', title: '旅務委員會會議（10 月）', category: '會議', status: 'published',
    at: D(-1), eventDate: D(6), deadline: D(4), fee: 0, quota: 20, signed: 9,
    vis: 4, shareTo: [],
    body: '議程：① 旅露營籌備進度 ② 各支部季度報告 ③ 財務整合表 ④ 跨團教練安排。\n只限領袖及旅務委員。',
    attachments: ['議程 10 月.docx'], library: false, signupFrom: 'login'
  },
  {
    id: 'n-4', scope: 'branch', ownerBranch: 'vs0082', title: '深資童軍：龍章野外探索（第 3 次）', category: '訓練', status: 'published',
    at: D(-4), eventDate: D(14), deadline: D(10), fee: 120, quota: 20, signed: 12,
    vis: 2, shareTo: [],
    body: '第 3 次野外探索，主題「夜行與導航」。集合時間 18:00，解散翌日 11:00。',
    attachments: ['裝備清單.pdf'], library: false, signupFrom: 'member'
  },
  {
    id: 'n-5', scope: 'troop', title: '（圖書館）總會通告：青少年活動通告第 20/2026 號', category: '訓練', status: 'published',
    at: D(-1), fee: 0, library: true, libraryId: 'lib-2026-020',
    vis: 2, shareTo: [], signed: 0,
    body: '來源：通告圖書館（scout-circulars）。已按你嘅訂閱（支部 × 分類）推送到呢一頁。附件指返圖書館原頁。',
    attachments: []
  },
  {
    id: 'n-6', scope: 'troop', title: '（待發佈）旅團開放日 2027', category: '活動', status: 'draft',
    at: D(-1), eventDate: D(60), deadline: '', fee: 0, quota: 200, signed: 0,
    vis: 1, shareTo: ['gs0082'],
    body: '草稿：等旅務委員會通過預算先發佈。', attachments: [], library: false
  }
];

/** 行事曆（旅一個 + 每支部一個） */
export const DEMO_CALENDAR = [
  { id: 'c-1', cal: 'troop', title: '旅務委員會會議', date: D(6), time: '19:30', place: '旅部', color: '#14532d' },
  { id: 'c-2', cal: 'troop', title: '旅露營（全旅）', date: D(21), time: '08:00', place: '創興水上活動中心', color: '#14532d' },
  { id: 'c-3', cal: 'troop', title: '旅團服務日', date: D(9), time: '09:00', place: '沙田公園', color: '#14532d' },
  { id: 'c-4', cal: 'vs0082', title: '深資：龍章野外探索', date: D(14), time: '18:00', place: '西貢', color: '#7B2233' },
  { id: 'c-5', cal: 'vs0082', title: '深資：集會', date: D(3), time: '19:00', place: '旅部', color: '#7B2233' },
  { id: 'c-6', cal: 'sc0082', title: '童軍：小隊訓練', date: D(3), time: '14:00', place: '旅部', color: '#1d4e89' },
  { id: 'c-7', cal: 'sc0082', title: '童軍：專科章考核（烹飪）', date: D(17), time: '10:00', place: '旅部', color: '#1d4e89' },
  { id: 'c-8', cal: 'cs0082', title: '幼童軍：六仔活動', date: D(10), time: '14:30', place: '旅部', color: '#b58b00' },
  { id: 'c-9', cal: 'gs0082', title: '小童軍：家長日', date: D(24), time: '10:00', place: '旅部', color: '#2e8a52' },
  { id: 'c-10', cal: 'rs0082', title: '樂行：服務計劃會議', date: D(11), time: '20:00', place: '線上', color: '#a8531f' }
];

/** 財務：各支部提交嘅摘要（旅只存摘要；明細住支部自己張 Sheet） */
export const DEMO_FINANCE_SUBMITS = [
  { id: 'f-1', branchId: 'vs0082', fy: '2026/27', period: '2026-09', income: 4200, expense: 3100, balance: 18450, entries: 12, submittedBy: '張偉業', at: D(-3) + ' 21:10', state: 'accepted', signed: true },
  { id: 'f-2', branchId: 'sc0082', fy: '2026/27', period: '2026-09', income: 8600, expense: 5200, balance: 32100, entries: 26, submittedBy: '李美儀', at: D(-2) + ' 20:45', state: 'pending', signed: true },
  { id: 'f-3', branchId: 'cs0082', fy: '2026/27', period: '2026-09', income: 3100, expense: 2900, balance: 12800, entries: 18, submittedBy: '黃志強', at: D(-4) + ' 19:20', state: 'accepted', signed: true },
  { id: 'f-4', branchId: 'rs0082', fy: '2026/27', period: '2026-09', income: 1500, expense: 2200, balance: 5400, entries: 7, submittedBy: '何家俊', at: D(-5) + ' 22:00', state: 'query', signed: true, query: '支出憑證 3 張未見（$640）' },
  { id: 'f-5', branchId: 'gs0082', fy: '2026/27', period: '2026-09', income: 0, expense: 0, balance: 3600, entries: 0, submittedBy: '', at: '—', state: 'missing', signed: false }
];

/** 旅自己嘅帳（旅層） */
export const DEMO_TROOP_FINANCE = {
  fy: '2026/27',
  opening: 48200,
  entries: [
    { id: 'tf-1', date: D(-20), kind: 'income', cat: '旅費', item: '2026/27 旅費（各支部上繳）', amount: 17400, by: '陳大文' },
    { id: 'tf-2', date: D(-12), kind: 'expense', cat: '行政', item: '旅部水電及維修', amount: 2300, by: '陳大文' },
    { id: 'tf-3', date: D(-6), kind: 'expense', cat: '活動', item: '旅露營訂金', amount: 12000, by: '陳大文' },
    { id: 'tf-4', date: D(-2), kind: 'income', cat: '捐助', item: '校友會捐款', amount: 5000, by: '陳大文' }
  ]
};

/** 物資整合（共享範圍 + 借用路由） */
export const DEMO_INVENTORY = [
  { id: 'i-1', name: '4 人營幕', owner: 'troop', total: 12, out: 4, state: 'shared', scope: 'all', loans: [{ to: 'vs0082', by: '陳家豪', at: D(-8), due: D(2), qty: 2, state: 'approved' }] },
  { id: 'i-2', name: '露營爐具（套）', owner: 'vs0082', total: 6, out: 2, state: 'shared', scope: 'troop', loans: [{ to: 'sc0082', by: '李美儀', at: D(-3), due: D(4), qty: 2, state: 'pending' }] },
  { id: 'i-3', name: '童軍棍（支）', owner: 'sc0082', total: 40, out: 0, state: 'shared', scope: 'all', loans: [] },
  { id: 'i-4', name: '幼童軍六旗（套）', owner: 'cs0082', total: 8, out: 8, state: 'local', scope: 'self', loans: [] },
  { id: 'i-5', name: '投影機', owner: 'troop', total: 2, out: 1, state: 'shared', scope: 'all', loans: [{ to: 'cs0082', by: '黃志強', at: D(-1), due: D(6), qty: 1, state: 'approved' }] },
  { id: 'i-6', name: '急救箱', owner: 'troop', total: 6, out: 0, state: 'shared', scope: 'all', loans: [] },
  { id: 'i-7', name: '獨木舟（艇）', owner: 'rs0082', total: 4, out: 0, state: 'shared', scope: 'troop', loans: [] },
  { id: 'i-8', name: '音響器材', owner: 'troop', total: 1, out: 0, state: 'broken', scope: 'self', loans: [], note: '待維修（報價中）' }
];

/** 公開資料（可設定可見等級：0 公眾 / 1 其他支部 / 2 團員 / 3 執委 / 4 領袖 / 5 旅長） */
export const DEMO_PUBLIC = {
  troop: [
    { id: 'p-1', kind: 'about', title: '旅團簡介', value: '1978 年創立，服務沙田區，五個支部，現役成員約 135 人。', vis: 0 },
    { id: 'p-2', kind: 'social', title: 'Instagram', value: '@hkg82', vis: 0 },
    { id: 'p-3', kind: 'site', title: '旅團網頁', value: 'https://demo-82.scout.hk', vis: 0 },
    { id: 'p-4', kind: 'album', title: '2026 旅露營相簿', value: 'https://photos.app.goo.gl/demo-camp-2026', vis: 1 },
    { id: 'p-5', kind: 'album', title: '旅部裝修相簿', value: 'https://photos.app.goo.gl/demo-reno', vis: 4 },
    { id: 'p-6', kind: 'link', title: '旅團章程（PDF）', value: 'https://demo-82.scout.hk/charter.pdf', vis: 0 },
    { id: 'p-7', kind: 'link', title: '家長通訊群組（WhatsApp）', value: 'https://chat.whatsapp.com/demo', vis: 2 }
  ],
  branches: [
    { id: 'bp-1', branchId: 'vs0082', kind: 'social', title: '深資 Instagram', value: '@82venture', vis: 1 },
    { id: 'bp-2', branchId: 'sc0082', kind: 'album', title: '童軍小隊露營相簿', value: 'https://photos.app.goo.gl/demo-sc', vis: 1 },
    { id: 'bp-3', branchId: 'cs0082', kind: 'about', title: '幼童軍活動簡介', value: '每週六 14:30–16:30 旅部集會。', vis: 1 },
    { id: 'bp-4', branchId: 'gs0082', kind: 'about', title: '小童軍集會時間', value: '隔週日 10:00–11:30。', vis: 1 }
  ]
};

/** 帳號／權限：待批申請、邀請連結、跨團幫手 */
export const DEMO_APPLICATIONS = [
  { id: 'a-1', kind: 'account', name: '林美好', email: 'lam@demo.troop', ymis: '', note: '想綁定子女 YMIS-2003（林浩然，童軍團）', at: D(-1) + ' 18:30', state: 'pending', need: '該團團長確認子女' },
  { id: 'a-2', kind: 'helper', name: '李美儀', email: 'coach@demo.troop', fromBranch: 'cs0082', toBranch: 'gs0082', note: '教練員想兼幫小童軍團（旅層教練員加支部授權 → 目標團批）', at: D(-2) + ' 15:00', state: 'pending', need: '目標團（小童軍團）團長批' },
  { id: 'a-3', kind: 'member', name: '阮小明', ymis: 'YMIS-2099', branchId: 'sc0082', note: '自行申請開戶（成員）', at: D(-3) + ' 09:20', state: 'pending', need: '該團團長對名冊核對' },
  { id: 'a-4', kind: 'account', name: '郭嘉敏', email: '', ymis: 'YMIS-2006', note: '深資童軍執委申請開戶', at: D(-6) + ' 20:10', state: 'approved', need: '', decidedBy: '張偉業', decidedAt: D(-5) + ' 10:00' },
  { id: 'a-5', kind: 'publish', name: '童軍團', branchId: 'sc0082', note: '上報公開項目「小隊露營相簿」俾旅公開頁', at: D(-1) + ' 11:00', state: 'pending', need: '旅長批准對外發佈' }
];

export const DEMO_INVITES = [
  { id: 'iv-1', kind: 'coach', role: '教練員', email: '', token: 'TROOP-COA-7F3A9C2E', branchAccess: ['sc0082'], expires: D(1), used: false, createdBy: '陳大文', at: D(-1) + ' 09:00' },
  { id: 'iv-4', kind: 'member', role: '團員', email: '', token: 'TROOP-MEM-5C7D1F2A', branchId: 'gs0082', identity: '團員', branchAccess: ['gs0082'], expires: D(1), used: false, createdBy: '陳大文', at: D(-1) + ' 10:30' },
  { id: 'iv-2', kind: 'parent', role: '家長', email: 'lam@demo.troop', token: 'TROOP-PAR-2B8D4E6F', branchAccess: [], expires: D(-2), used: false, createdBy: '陳大文', at: D(-3) + ' 18:00' },
  { id: 'iv-3', kind: 'member', role: '副團長', email: 'newdeputy@demo.troop', token: 'TROOP-MEM-9A1C3E5G', branchId: 'cs0082', identity: '副團長', branchAccess: ['cs0082'], expires: D(0), used: true, createdBy: '陳大文', at: D(-2) + ' 10:00', usedAt: D(-1) + ' 14:30' }
];

/** 分享（★ 收件方決定；只做兩樣：通告 ＋ 活動（行事曆））
    規矩：來源支部送出 → 收件支部決定 → 接收先出現 */
export const DEMO_SHARES = [
  { id: 'sh-1', kind: 'notice', title: '深資童軍：「黑夜行」活動通告', from: 'vs0082', to: 'sc0082', level: 2, note: '想邀請童軍團一齊行（名額 8 個）', state: 'pending', at: D(-1) + ' 20:10', by: '郭嘉敏' },
  { id: 'sh-2', kind: 'event', title: '深資童軍：聯合露營（10/24-25）', from: 'vs0082', to: 'sc0082', level: 2, note: '地點：西貢；可以一齊報名', date: D(29), time: '14:00', place: '西貢戶外訓練營', state: 'pending', at: D(-2) + ' 17:45', by: '陳家豪' },
  { id: 'sh-3', kind: 'notice', title: '旅團服務日：沙田公園清潔', from: 'troop', to: 'all', level: 0, state: 'accepted', at: D(-4) + ' 09:00', by: '陳大文', decidedBy: '系統（旅層等級 0 = 自動）', decidedAt: D(-4) + ' 09:00' },
  { id: 'sh-4', kind: 'event', title: '2026 旅露營（全旅）', from: 'troop', to: 'all', level: 2, date: D(21), time: '09:00', place: '西貢戶外訓練營', state: 'accepted', at: D(-6) + ' 14:20', by: '陳大文', decidedBy: '李美儀', decidedAt: D(-6) + ' 15:00' },
  { id: 'sh-5', kind: 'event', title: '童軍：小隊訓練（公開觀摩）', from: 'sc0082', to: 'cs0082', level: 3, date: D(3), time: '14:00', place: '旅部', state: 'accepted', at: D(-8) + ' 11:00', by: '陳家欣', decidedBy: '鄭美玲', decidedAt: D(-7) + ' 09:30' },
  { id: 'sh-6', kind: 'event', title: '童軍：小隊露營（要有家長同意）', from: 'sc0082', to: 'vs0082', level: 3, date: D(17), time: '09:00', place: '大埔', state: 'declined', at: D(-9) + ' 16:00', by: '陳家欣', decidedBy: '郭嘉敏', decidedAt: D(-8) + ' 12:10', decideNote: '該團未收齊家長同意 → 暫不接收' },
  { id: 'sh-7', kind: 'notice', title: '深資童軍：專科章成果展示日', from: 'vs0082', to: 'all', level: 3, state: 'pending', at: D(-1) + ' 21:30', by: '郭嘉敏', note: '想全旅都知（由旅長決定收唔收）' }
];

/** 模組開關（TROOP_MODULES：模組 × 全旅／指定支部） */
export const DEMO_MODULES = {};   // 由 registry 預設填充，state 只存 override

/** 審計／操作紀錄 */
export const DEMO_AUDIT = [
  { id: 'au-1', at: D(0) + ' 07:40', actor: '陳大文', role: '旅長', action: '測試下游連線', target: '深資童軍團（vs0082）', via: 'UI', detail: 'sig 驗證成功 · 12 read / 19 write action' },
  { id: 'au-2', at: D(-1) + ' 21:12', actor: '陳大文', role: '旅長', action: '閂下游直接入口', target: '樂行童軍團（rs0082）', via: 'sig', detail: 'ALLOW_LOCAL_LOGIN=false（下游回報 confirmed）' },
  { id: 'au-3', at: D(-1) + ' 18:31', actor: '（申請人）林美好', role: '家長', action: '提交開戶申請', target: '家長帳號', via: '公開頁', detail: '待該團領袖確認子女綁定' },
  { id: 'au-4', at: D(-2) + ' 15:02', actor: '李美儀', role: 'coach', identity: '', action: '提交跨團幫手申請', target: '小童軍團', via: 'UI', detail: '等目標團領袖批（未生效）' },
  { id: 'au-5', at: D(-3) + ' 21:15', actor: '張偉業', role: '支部領袖', action: '提交財務摘要', target: '深資童軍團 2026-09', via: '支部系統', detail: '旅已收（accepted）' },
  { id: 'au-6', at: D(-5) + ' 10:00', actor: '陳大文', role: '旅長', action: '為下游開戶', target: '深資童軍團（vs0082）郭嘉敏', via: 'sig', detail: '兩邊同一 hash · 首登強制改密碼' },
  { id: 'au-7', at: D(-6) + ' 08:05', actor: 'system', role: '系統', action: '後端實況檢查', target: '全旅', via: 'cron(示範)', detail: '5 個下游：3 綠 1 黃 1 紅' },
  { id: 'au-8', at: D(-8) + ' 12:20', actor: '陳大文', role: '旅長', action: '撤銷前旅司庫權限', target: 'cheng@demo.troop', via: 'UI', detail: 'branch_access 已清、key 已 rotate' }
];

export const DEMO_ACCESS_LOG = [
  { id: 'ac-1', at: D(0) + ' 07:30', sub: 'chief@demo.troop', role: '旅長', event: 'LOGIN_OK', ip: '203.0.113.x' },
  { id: 'ac-2', at: D(0) + ' 06:50', sub: 'parent@demo.troop', role: '家長', event: 'LOGIN_OK', ip: '203.0.113.y' },
  { id: 'ac-3', at: D(0) + ' 06:12', sub: 'scout@demo.troop', role: '—', event: 'LOGIN_FAIL', ip: '198.51.100.z' },
  { id: 'ac-4', at: D(-1) + ' 21:05', sub: 'coach@demo.troop', role: 'coach', event: 'LOGIN_OK', ip: '203.0.113.x' },
  { id: 'ac-5', at: D(-1) + ' 20:44', sub: 'cheung@demo.troop', role: '支部領袖', event: 'RESET', ip: '203.0.113.q' },
  { id: 'ac-6', at: D(-2) + ' 19:58', sub: 'parent@demo.troop', role: '家長', event: 'LOCKOUT', ip: '203.0.113.y' }
];

/** 下游接駁（詳情頁用）：每個下游嘅登記資料（示範用遮罩值） */
export const DEMO_DOWNSTREAM_DETAIL = {
  vs0082: { url: 'https://script.google.com/macros/s/AKfyc…VS/exec', keyMask: 'vs82_••••••••••••7f3a', api: 'v1', purpose: 'vsbadge-troop-sig-v1', readActions: 12, writeActions: 19, superVerify: 'https://vsbadge.vercel.app/api/super', portalOrigin: 'https://vsbadge.vercel.app' },
  sc0082: { url: 'https://script.google.com/macros/s/AKfy…SC/exec', keyMask: 'sc82_••••••••••••2b8d', api: 'v1', purpose: 'scportal-troop-sig-v1', readActions: 11, writeActions: 16, superVerify: '（待補）', portalOrigin: 'https://sc-portal.vercel.app' },
  cs0082: { url: 'https://script.google.com/macros/s/AKfy…CS/exec', keyMask: 'cs82_••••••••••••9a1c', api: 'v1', purpose: 'cubsbadge-troop-sig-v1', readActions: 12, writeActions: 19, superVerify: '（零回打版）', portalOrigin: 'https://cubsbadge.vercel.app' },
  rs0082: { url: 'https://script.google.com/macros/s/AKfy…RS/exec', keyMask: 'rs82_••••••••••••3e5g', api: 'v1', purpose: 'roverbadge-troop-sig-v1', readActions: 12, writeActions: 19, superVerify: 'https://roverbadge.vercel.app/api/super', portalOrigin: 'https://roverbadge.vercel.app' },
  gs0082: { url: '', keyMask: '', api: '', purpose: '', readActions: 0, writeActions: 0, superVerify: '', portalOrigin: '' }
};

/** 用戶訂閱（個人化訂閱 ★）：支部 × 分類，存本機 */
export const DEMO_SUBSCRIPTIONS = {
  branches: ['vs0082', 'sc0082'],
  topics: ['訓練', '活動', '比賽'],
  pushEnabled: true,
  device: '已訂閱此裝置（示範：圖書館 VAPID 公鑰）',
  lastPush: D(-1) + ' 06:00'
};

/** 移交／升降團個案 */
export const DEMO_TRANSFERS = [
  { id: 't-1', scoutId: 'YMIS-2002', name: '陳家欣', from: 'sc0082', to: 'vs0082', reason: '升團（童軍 → 深資）', at: D(-10), state: 'pending', bundle: 'sha256:9f31…c2', note: '等深資團領袖接收；密碼行開戶流程（1234+強制改）' },
  { id: 't-2', scoutId: 'YMIS-2008', name: '鄧小鳳', from: 'cs0082', to: 'sc0082', reason: '升團（幼童軍 → 童軍）', at: D(-20), state: 'done', bundle: 'sha256:4b77…e9', note: '已接收，名冊已建 ACTIVE' },
  { id: 't-3', scoutId: 'YMIS-2009', name: '曾俊宇', from: 'sc0082', to: 'OTHER', reason: '轉旅（搬遷）', at: D(-30), state: 'out', bundle: 'sha256:11ac…77', note: '已移出（tombstone），歷史留來源唯讀' }
];

/** 後端實況（診斷卡用） */
export const DEMO_BACKEND = {
  appVersion: 'v0.1.0-ui',
  backendVersion: '（未接真後端 · 示範模式）',
  mode: 'mock',
  spreadsheet: '（示範旅 · 無真 Sheet）',
  tables: 11, rows: 486, broken: [], syncRows: 42, stagingRows: 0,
  route: '逐表寫（saveTables）＋寫完自證',
  lastWrite: { at: D(-1) + ' 21:12', confirmed: true, tables: 3, ms: 840 }
};

export const DEMO_AUTOMATIONS = [
  { id: 'auto-1', name: '每週備份（Drive）', schedule: '逢日 02:00', last: D(-1) + ' 02:00', next: D(6) + ' 02:00', state: 'ok', stateText: '成功 · 保留 13 份' },
  { id: 'auto-2', name: '推送補漏（7 日 rolling）', schedule: '每日 06:00', last: D(0) + ' 06:00', next: D(1) + ' 06:00', state: 'ok', stateText: '命中 3 條通告' },
  { id: 'auto-3', name: '財務提交提醒（每月 5 號）', schedule: '每月 5 日', last: D(-20) + ' 09:00', next: D(10) + ' 09:00', state: 'warn', stateText: '小童軍團未提交' },
  { id: 'auto-4', name: '離隊資料 purge（12 個月）', schedule: '每月 1 日', last: D(-25) + ' 03:00', next: D(5) + ' 03:00', state: 'ok', stateText: '上次 purge 2 筆' },
  { id: 'auto-5', name: '審計紀錄 purge（24 個月）', schedule: '每季', last: '2026-07-01 03:00', next: '2026-10-01 03:00', state: 'ok', stateText: '—' },
  { id: 'auto-6', name: 'PDPO 家長同意提醒', schedule: '每學期', last: D(-40) + ' 09:00', next: D(50) + ' 09:00', state: 'warn', stateText: '11 位成員未收同意書' }
];

/** 教材（三層）＋ 四角色入口指引 */
export const DEMO_TUTORIALS = [
  { id: 'doc-1', who: '旅長', title: '旅長快速入門（首次登入必見）', mins: 6, steps: ['旅閘 → 揀身份「旅長／教練員」→ 登入', '儀表板：撳開「需要你處理」「接駁狀態」（默認收合，電話好撳）', '「支部」逐個測試連線（未登記下游＝入唔到，紅字講明）', '「用戶與身份」發邀請：教練員／家長（旅層）、團長／副團長／成員（落該團）', '「財務整合」每月審各支部提交（有問題可以退問）', '「系統」睇後端實況、審計、模組開關、key rotate 提醒'] },
  { id: 'doc-2', who: '教練員', title: '教練員快速入門（旅層帳號）', mins: 5, steps: ['旅閘 → 揀身份「旅長／教練員」→ 登入（帳號住旅 SHEET）', '只見到你有 branch_access 嘅支部', '「通告」發旅通告時揀分享俾邊啲支部（要先有該模組）', '「行事曆」加旅活動，記住揀支部標籤', '要幫多一個團（例：深資團長去協助童軍團）→ 跨團幫手申請，等目標團批'] },
  { id: 'doc-3', who: '家長', title: '家長快速入門（監護人）', mins: 3, steps: ['收到邀請連結 → 設定密碼', '「我的子女」睇進度／通告／繳費（跨支部自動併埋）', '子女未夠 18 → 你係監護人：報名、借用、公開亮相都要你同意', '通告頁免登入都可以回覆出席與否（可代子女填）'] },
  { id: 'doc-4', who: '支部人員', title: '團長／副團長／成員（先揀團）', mins: 4, steps: ['旅閘 → 揀身份「支部人員」→ 必須先揀團（旅要對得上該團下游先入得到）', '登入之後：我嘅身份卡、通告、行事曆；團長／副團長多一個「支部」入口', '你嘅密碼由自己團核對 —— 旅唔會、亦唔可以代驗', '成員未夠 18：要監護人（家長帳號）＋家長同意先報名／借物資', '本職團長想兼幫其他團 → 跨團幫手申請，等目標團批'] },
  { id: 'doc-8', who: '支部人員', title: '身份／職稱／年齡組（一次睇清）', mins: 4, steps: ['身份：團長(5)／副團長(4)／管委(4)／執委(3)／隊長·副隊長·團隊長(3)／團員(2)', '職稱：主席／副主席／秘書／財務 —— 默認跟執委或管委，可以按人再微調', '年齡組：18+ 自己管自己；未夠 18 要監護人＋家長同意', '我嘅身份卡（#/mine）會列晒你嘅身份、年齡組、可見等級同做得到嘅事'] },
  { id: 'doc-5', who: '全部', title: '模組說明：通告 + 個人化訂閱 ★', mins: 4, steps: ['訂閱設定喺「通告 → 我嘅訂閱」：揀支部 × 分類', '設定存本機；命中即推，同一通告只推一次', '推送基建＝通告圖書館原有鏈（Supabase + 每日 06:00 notify）', '圖書館數據：知幾多人訂、訂咩，唔知邊個'] },
  { id: 'doc-6', who: '全部', title: '模組說明：財務整合', mins: 4, steps: ['支部用自己 key 簽提交月度摘要（明細留返支部）', '旅長只睇摘要 + 總收支／按支部／按月／按類別', '有疑問可以「退問」，支部改完再提交', '全部動作入 AUDIT_LOG，記 submittedBy'] },
  { id: 'doc-7', who: '全部', title: '開旅 checklist（新旅上線 7 步）', mins: 8, steps: ['建旅 SHEET → 貼 Code.gs → 初始化 → 種第一個旅長', '部署 Web App（執行身分我、存取權任何人）→ 抄 B / D', '填 C（旅名）→ 交 ADMIN 收件匣', 'ADMIN 加 units.json + Vercel env → Redeploy', '逐個支部「登記下游」→「測試連線」', '搬舊數（下游吐 JSON 含 hash → 匯入）→ 核對 → 閂口', '之後開戶一律由旅揀支部開'] }
];

export const DEMO_MOCK_BADGES = {
  m1: 'MOCK +30 成員', m2: 'MOCK 匯出 JSON',
  m3: 'MOCK 通告 6 條', m4: 'MOCK 財務 4 期',
  m5: 'MOCK 行動', m6: 'MOCK 公告',
  m7: 'MOCK 通告',
  badge: 'MOCK 任務',
  extra: 'MOCK 名冊',
  list: ['MOCK 支部', 'MOCK 通告', 'MOCK 推播', 'MOCK 進度']
};

/** 整個示範旅嘅資料（新增資料庫 schema 只需喺度加） */
export function makeDemo() {
  return {
    _mock: true,
    unit: DEMO_TRAVEL,
    branches: JSON.parse(JSON.stringify(DEMO_BRANCHES)),
    users: JSON.parse(JSON.stringify(DEMO_USERS)),
    members: JSON.parse(JSON.stringify(DEMO_MEMBERS)),
    progress: JSON.parse(JSON.stringify(DEMO_PROGRESS)),
    notices: JSON.parse(JSON.stringify(DEMO_NOTICES)),
    calendar: JSON.parse(JSON.stringify(DEMO_CALENDAR)),
    financeSubmits: JSON.parse(JSON.stringify(DEMO_FINANCE_SUBMITS)),
    troopFinance: JSON.parse(JSON.stringify(DEMO_TROOP_FINANCE)),
    inventory: JSON.parse(JSON.stringify(DEMO_INVENTORY)),
    publicProfile: JSON.parse(JSON.stringify(DEMO_PUBLIC)),
    applications: JSON.parse(JSON.stringify(DEMO_APPLICATIONS)),
    invites: JSON.parse(JSON.stringify(DEMO_INVITES)),
    shares: JSON.parse(JSON.stringify(DEMO_SHARES)),
    modules: {},                      // { moduleId: 'all' | 'off' | [branchId,…] }
    audit: JSON.parse(JSON.stringify(DEMO_AUDIT)),
    access: JSON.parse(JSON.stringify(DEMO_ACCESS_LOG)),
    downstream: JSON.parse(JSON.stringify(DEMO_DOWNSTREAM_DETAIL)),
    subscriptions: JSON.parse(JSON.stringify(DEMO_SUBSCRIPTIONS)),
    transfers: JSON.parse(JSON.stringify(DEMO_TRANSFERS)),
    backend: JSON.parse(JSON.stringify(DEMO_BACKEND)),
    automations: JSON.parse(JSON.stringify(DEMO_AUTOMATIONS)),
    tutorials: JSON.parse(JSON.stringify(DEMO_TUTORIALS)),
    settings: {
      troopModulesMode: 'all',            // all | custom
      adminEmail: 'chief@demo.troop',
      noticeDefaultVis: 2,
      financeDueDay: 5,
      publicOpen: true,                   // 有冇開放公開頁（免登入）
      mockWatermark: true
    },
    _exportedFrom: undefined
  };
}
