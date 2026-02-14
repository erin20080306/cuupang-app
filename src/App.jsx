import React, { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  User, 
  LogOut,
  X,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Fingerprint,
  Table as TableIcon,
  Maximize2,
  GitPullRequest,
  CheckCircle2,
  Timer,
  FileEdit,
  Loader2,
  ExternalLink,
  RefreshCw,
  Download
} from 'lucide-react';
import { 
  verifyLogin,
  getSheetNames,
  getSheetData,
  getBatchSheetData,
  parseSheetData,
  getRowName,
  normalizeName,
  clearAllCache,
  getWarehouseSheetId
} from './services/gasApi';

// --- NavBtn 元件 ---
const NavBtn = ({ active, onClick, icon, label }) => (
  <button onClick={onClick} className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${active ? 'text-blue-600 scale-105' : 'text-slate-400'}`}>
    <div className={`${active ? 'bg-blue-50 p-2.5 rounded-xl shadow-inner' : 'p-1'}`}>{icon}</div>
    <span className={`text-xs tracking-tight whitespace-nowrap ${active ? 'font-black' : 'font-semibold'}`}>{label}</span>
  </button>
);

// --- 全域顏色配置 ---
const COLOR_CONFIG = {
  "國出": { bg: "bg-yellow-100", text: "text-amber-700", border: "border-amber-200" },
  "國": { bg: "bg-yellow-50", text: "text-amber-600", border: "border-amber-200" },
  "例": { bg: "bg-red-50", text: "text-red-600", border: "border-red-200" },
  "例休": { bg: "bg-red-100", text: "text-red-700", border: "border-red-300" },
  "例假日": { bg: "bg-red-100", text: "text-red-700", border: "border-red-300" },
  "休": { bg: "bg-slate-100", text: "text-slate-500", border: "border-slate-200" },
  "休假": { bg: "bg-slate-100", text: "text-slate-500", border: "border-slate-200" },
  "休假日": { bg: "bg-slate-100", text: "text-slate-500", border: "border-slate-200" },
  "休加": { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" },
  "未": { bg: "bg-gray-100", text: "text-gray-500", border: "border-gray-200" },
  "調倉": { bg: "bg-indigo-50", text: "text-indigo-600", border: "border-indigo-200" },
  "調任": { bg: "bg-indigo-50", text: "text-indigo-600", border: "border-indigo-200" },
  "病": { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-300" },
  "上休(曠)": { bg: "bg-pink-100", text: "text-pink-700", border: "border-pink-300" },
  "下休(曠)": { bg: "bg-rose-100", text: "text-rose-700", border: "border-rose-300" },
  "特休": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  "事": { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  "生理": { bg: "bg-pink-50", text: "text-pink-600", border: "border-pink-200" },
  "上班": { bg: "bg-white", text: "text-blue-600", border: "border-slate-100" }
};

// 登入過期時間（一天，單位：毫秒）
const LOGIN_EXPIRY_MS = 24 * 60 * 60 * 1000;

const App = () => {
  const [view, setView] = useState('login'); 
  const [activeTab, setActiveTab] = useState('calendar'); 
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [user, setUser] = useState(null);
  const [loginData, setLoginData] = useState({ name: '', birthday: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [modalType, setModalType] = useState('schedule');
  const [isDownloading, setIsDownloading] = useState(false);
  
  // 月曆區域的 ref（用於下載 PNG）
  const calendarRef = useRef(null);
  const recordsCalendarRef = useRef(null);
  const leaveStatsRef = useRef(null);
  const attendanceRef = useRef(null);
  
  // 管理員模式狀態
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminSearchName, setAdminSearchName] = useState('');
  
    
  // 檢測是否為手機 PWA 模式（手機安裝後開啟）
  const [isPWA, setIsPWA] = useState(false);
  useEffect(() => {
    // 檢測 PWA standalone 模式
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches 
      || window.navigator.standalone === true
      || document.referrer.includes('android-app://');
    // 檢測是否為手機（螢幕寬度小於 768px）
    const isMobile = window.innerWidth < 768;
    // 只有手機 PWA 才設為 true
    setIsPWA(isStandalone && isMobile);
  }, []);
  
  // 檢查登入是否過期（一般員工超過一天自動登出）
  useEffect(() => {
    const checkLoginExpiry = () => {
      const loginTime = localStorage.getItem('loginTime');
      const savedUser = localStorage.getItem('user');
      
      if (loginTime && savedUser) {
        const elapsed = Date.now() - parseInt(loginTime, 10);
        const parsedUser = JSON.parse(savedUser);
        
        // 管理員不受時間限制，一般員工超過一天自動登出
        if (!parsedUser.isAdmin && elapsed > LOGIN_EXPIRY_MS) {
          // 登入已過期，清除資料
          localStorage.removeItem('loginTime');
          localStorage.removeItem('user');
          setUser(null);
          setView('login');
        } else {
          // 登入未過期，恢復登入狀態
          setUser(parsedUser);
          setView('dashboard');
        }
      }
    };
    
    checkLoginExpiry();
  }, []);
  
  // Google Sheet 資料狀態
  const [loading, setLoading] = useState(false);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [sheetNames, setSheetNames] = useState([]);
  const [resolvedSheets, setResolvedSheets] = useState({ schedule: '', attendance: '', records: '', adjustment: '' });
  const [sheetData, setSheetData] = useState({
    schedule: { headers: [], rows: [], dateCols: [], headersISO: [] },
    attendance: { headers: [], rows: [], dateCols: [], headersISO: [] },
    records: { headers: [], rows: [], dateCols: [], headersISO: [] },
    adjustment: { headers: [], rows: [], dateCols: [], headersISO: [] },
  });
  const [loadedResults, setLoadedResults] = useState(null);
  const [dataError, setDataError] = useState(null);
  const loadTokenRef = useRef(0);

  const leaveKeywords = ["生理", "事", "特休", "病", "上休(曠)", "下休(曠)", "例休", "國出", "(上休)事", "(下休)事", "(上休)病", "(下休)病", "(上休)生理", "(下休)生理", "(上休)曠", "(下休)曠"];
  const excludeKeywords = ["未", "調倉", "離", "轉正", "調任", "休", "休假", "休假日", "例", "例假", "例假日"];

  const resolveTargetSheets = (names, month) => {
    // 班表：優先找含月份的，否則找任何班表
    const monthStr = String(month || '');
    const schedule = 
      names.find(n => String(n || '').includes('班表') && String(n || '').includes(`${monthStr}月`)) ||
      names.find(n => String(n || '').includes('班表')) || 
      names.find(n => String(n || '').includes('排班')) || '';
    
    // 出勤時數：優先找含月份的，否則找「本月」，否則找任何出勤時數
    const attendance =
      names.find(n => String(n || '').includes('出勤時數') && String(n || '').includes(`${monthStr}月`)) ||
      names.find(n => String(n || '').includes('本月出勤時數')) ||
      names.find(n => String(n || '').includes('出勤時數')) ||
      names.find(n => String(n || '').includes('出勤時間')) ||
      '';
    
    // 出勤記錄：優先找含月份的，否則找任何出勤記錄
    const records =
      names.find(n => String(n || '').includes('出勤記錄') && String(n || '').includes(`${monthStr}月`)) ||
      names.find(n => String(n || '').includes('出勤記錄')) ||
      names.find(n => String(n || '').includes('出勤紀律')) ||
      names.find(n => String(n || '').includes('打卡記錄')) ||
      '';
    
    // 調假名單
    const adjustment = names.find(n => String(n || '').includes('調假名單')) || '';
    
    return { schedule, attendance, records, adjustment };
  };

  const loadAllSheets = async (warehouse, userName) => {
    if (!warehouse) return;

    const currentToken = ++loadTokenRef.current;

    setLoading(true);
    setBackgroundLoading(false);
    setDataError(null);

    try {
      const names = await getSheetNames(warehouse);
      if (currentToken !== loadTokenRef.current) return;
      setSheetNames(names);

      const userBirthday = String(user?.birthday || '').trim();
      const targetN = normalizeName(String(userName || '').trim());
      const monthStr = String(selectedMonth);

      // 分類分頁類型的函數
      const classifySheet = (sheetName) => {
        const n = String(sheetName || '');
        if (n.includes('調假名單')) return 'adjustment';
        if (n.includes('出勤時數') || n.includes('出勤時間')) return 'attendance';
        if (n.includes('出勤記錄') || n.includes('出勤紀律') || n.includes('打卡記錄')) return 'records';
        if (n.includes('班表') || n.includes('排班')) return 'schedule';
        return null;
      };

      // 從資料列中提取月份（根據日期欄位）
      const extractMonthFromRow = (row, headers) => {
        // 常見的日期欄位名稱
        const dateFields = ['日期', '出勤日期', '打卡日期', 'Date', 'date'];
        for (const field of dateFields) {
          const value = row[field];
          if (value) {
            // 嘗試解析日期格式：YYYY/MM/DD, YYYY-MM-DD, MM/DD, M/D 等
            const dateStr = String(value);
            const match = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/) || 
                          dateStr.match(/(\d{1,2})[\/\-](\d{1,2})/);
            if (match) {
              const month = match.length === 4 ? parseInt(match[2], 10) : parseInt(match[1], 10);
              if (month >= 1 && month <= 12) return month;
            }
          }
        }
        return null;
      };

      // 篩選分頁
      const attendanceSheets = names.filter(n => classifySheet(n) === 'attendance');
      const scheduleSheets = names.filter(n => classifySheet(n) === 'schedule');
      const recordSheets = names.filter(n => classifySheet(n) === 'records');
      const adjustmentSheets = names.filter(n => classifySheet(n) === 'adjustment');

      // 合併所有需要載入的分頁名稱
      const allSheetNames = [
        ...scheduleSheets,
        ...recordSheets,
        ...attendanceSheets,
        ...adjustmentSheets
      ];

      // 所有分頁同時並行抓取
      const batchData = await getBatchSheetData(warehouse, allSheetNames, { birthday: userBirthday, name: userName });
      if (currentToken !== loadTokenRef.current) return;

      const otherResults = [];
      const attendanceResults = [];

      for (const sheetName of allSheetNames) {
        const raw = batchData[sheetName];
        if (!raw) continue;

        const type = classifySheet(sheetName);
        const parsed = parseSheetData(raw);
        const matched = parsed.rows.filter(r => normalizeName(getRowName(r)) === targetN);
        const hasUserData = matched.length > 0;

        if (type === 'attendance') {
          attendanceResults.push({ sheetName, parsed, matched, hasUserData });
        } else if (type === 'schedule' || type === 'records' || type === 'adjustment') {
          otherResults.push({ type, sheetName, parsed, matched, hasUserData });
        }
      }

      setLoadedResults({
        warehouse,
        userName,
        otherResults,
        attendanceResults,
      });
    } catch (error) {
      console.error('載入資料失敗:', error);
      setDataError(error.message);
      setSheetNames([]);
      setResolvedSheets({ schedule: '', attendance: '', records: '', adjustment: '' });
      setSheetData({
        schedule: { headers: [], rows: [], dateCols: [], headersISO: [] },
        attendance: { headers: [], rows: [], dateCols: [], headersISO: [] },
        records: { headers: [], rows: [], dateCols: [], headersISO: [] },
        adjustment: { headers: [], rows: [], dateCols: [], headersISO: [] },
      });
      setLoadedResults(null);
      setBackgroundLoading(false);
    } finally {
      if (currentToken === loadTokenRef.current) {
        setLoading(false);
      }
    }
  };

  // 當用戶登入後或月份變更時載入資料
  useEffect(() => {
    if (user && user.warehouse) {
      loadAllSheets(user.warehouse, user.name);
    }
  }, [user]);

  useEffect(() => {
    if (!loadedResults) return;

    const monthStr = String(selectedMonth);
    const targetMonth = parseInt(monthStr, 10);
    const { otherResults, attendanceResults } = loadedResults;

    const extractMonthFromRow = (row, headers) => {
      const dateFields = ['日期', '出勤日期', '打卡日期', 'Date', 'date'];
      for (const field of dateFields) {
        const value = row[field];
        if (value) {
          const dateStr = String(value);
          const match = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/) ||
                        dateStr.match(/(\d{1,2})[\/\-](\d{1,2})/);
          if (match) {
            const month = match.length === 4 ? parseInt(match[2], 10) : parseInt(match[1], 10);
            if (month >= 1 && month <= 12) return month;
          }
        }
      }
      return null;
    };

    const parseMonthFromISO = (iso) => {
      const s = String(iso || '').trim();
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const month = parseInt(m[2], 10);
      if (month >= 1 && month <= 12) return month;
      return null;
    };

    const parseMonthFromHeaderText = (header) => {
      const h = String(header || '').trim();
      const m1 = h.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (m1) {
        const month = parseInt(m1[2], 10);
        if (month >= 1 && month <= 12) return month;
      }
      const m2 = h.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
      if (m2) {
        const month = parseInt(m2[1], 10);
        if (month >= 1 && month <= 12) return month;
      }
      return null;
    };

    const hasSelectedMonthInColumns = (parsed) => {
      const headersISO = Array.isArray(parsed?.headersISO) ? parsed.headersISO : [];
      const headers = Array.isArray(parsed?.headers) ? parsed.headers : [];

      let foundAnyDate = false;
      for (let idx = 0; idx < headersISO.length; idx++) {
        const monthFromISO = parseMonthFromISO(headersISO[idx]);
        if (monthFromISO !== null) {
          foundAnyDate = true;
          if (monthFromISO === targetMonth) return true;
        }
      }
      if (foundAnyDate) return false;

      for (let idx = 0; idx < headers.length; idx++) {
        const month = parseMonthFromHeaderText(headers[idx]);
        if (month !== null) {
          foundAnyDate = true;
          if (month === targetMonth) return true;
        }
      }

      return false;
    };

    const hasDataForSelectedMonth = (parsed, type) => {
      if (!parsed) return false;

      if (type === 'schedule') {
        return hasSelectedMonthInColumns(parsed);
      }

      if (type === 'records') {
        if (hasSelectedMonthInColumns(parsed)) return true;
        for (const row of (parsed.rows || [])) {
          const rowMonth = extractMonthFromRow(row, parsed.headers || []);
          if (rowMonth === targetMonth) return true;
        }
        return false;
      }

      return true;
    };

    const sortByMonthPriority = (results) => {
      return [...results].sort((a, b) => {
        const aHasMonth = String(a?.sheetName || '').includes(`${monthStr}月`);
        const bHasMonth = String(b?.sheetName || '').includes(`${monthStr}月`);
        if (aHasMonth && !bHasMonth) return -1;
        if (!aHasMonth && bHasMonth) return 1;
        return 0;
      });
    };

    const resolvedNames = { schedule: '', attendance: '', records: '', adjustment: '' };
    const sheetsWithUserData = {};

    const scheduleCandidates = sortByMonthPriority(
      otherResults.filter(r => r.type === 'schedule' && r.parsed && r.hasUserData && hasDataForSelectedMonth(r.parsed, 'schedule'))
    );
    const recordsCandidates = sortByMonthPriority(
      otherResults.filter(r => r.type === 'records' && r.parsed && r.hasUserData && hasDataForSelectedMonth(r.parsed, 'records'))
    );
    const adjustmentCandidates = otherResults.filter(r => r.type === 'adjustment' && r.parsed);
    const adjustmentCandidate = adjustmentCandidates.length > 0 ? adjustmentCandidates[0] : null;

    if (scheduleCandidates.length > 0) {
      const { sheetName, parsed, matched } = scheduleCandidates[0];
      resolvedNames.schedule = sheetName;
      sheetsWithUserData.schedule = { ...parsed, rows: matched };
    }

    if (recordsCandidates.length > 0) {
      const { sheetName, parsed, matched } = recordsCandidates[0];
      resolvedNames.records = sheetName;
      sheetsWithUserData.records = { ...parsed, rows: matched };
    }

    if (adjustmentCandidate) {
      const { sheetName, parsed, matched } = adjustmentCandidate;
      resolvedNames.adjustment = sheetName;
      sheetsWithUserData.adjustment = { ...parsed, rows: matched };
    }

    let attendanceHeaders = [];
    const attendanceRows = [];
    const attendanceSheetNames = [];

    for (const { sheetName, parsed, matched } of attendanceResults) {
      if (!parsed) continue;

      const rowsToCheck = matched;
      if (attendanceHeaders.length === 0 && parsed.headers.length > 0) {
        attendanceHeaders = parsed.headers;
      }

      for (const row of rowsToCheck) {
        const rowMonth = extractMonthFromRow(row, parsed.headers);
        if (rowMonth === null || rowMonth === targetMonth) {
          attendanceRows.push(row);
          if (!attendanceSheetNames.includes(sheetName)) {
            attendanceSheetNames.push(sheetName);
          }
        }
      }
    }

    if (attendanceRows.length > 0) {
      resolvedNames.attendance = attendanceSheetNames.join(', ');
      sheetsWithUserData.attendance = {
        headers: attendanceHeaders,
        rows: attendanceRows,
        dateCols: [],
        headersISO: []
      };
    }

    setResolvedSheets(resolvedNames);
    setSheetData({
      schedule: sheetsWithUserData.schedule || { headers: [], rows: [], dateCols: [], headersISO: [] },
      attendance: sheetsWithUserData.attendance || { headers: [], rows: [], dateCols: [], headersISO: [] },
      records: sheetsWithUserData.records || { headers: [], rows: [], dateCols: [], headersISO: [] },
      adjustment: sheetsWithUserData.adjustment || { headers: [], rows: [], dateCols: [], headersISO: [] },
    });
  }, [loadedResults, selectedMonth]);

  // 開啟 Google Sheet 原始連結
  const openGoogleSheet = async () => {
    if (!user) return;
    try {
      const sheetId = await getWarehouseSheetId(user.warehouse);
      window.open(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`, '_blank');
    } catch (error) {
      console.error('無法開啟 Google Sheet:', error);
    }
  };

  const pickYearFromISO = (isoList) => {
    const first = Array.isArray(isoList) ? isoList.find(x => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ''))) : '';
    if (!first) return new Date().getFullYear();
    return Number(String(first).slice(0, 4)) || new Date().getFullYear();
  };

  const getDailyStatusFrom = (data, name, day) => {
    if (!data?.rows?.length || !data?.headers?.length) return "上班";

    const userRow = data.rows.find(row => getRowName(row) === name);
    if (!userRow) return "上班";

    const year = pickYearFromISO(data.headersISO);
    const monthStr = String(selectedMonth).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const targetDate = `${year}-${monthStr}-${dayStr}`;

    const colIndex = Array.isArray(data.headersISO) ? data.headersISO.findIndex(iso => iso === targetDate) : -1;
    if (colIndex >= 0 && data.headers[colIndex]) {
      const header = data.headers[colIndex];
      const value = String(userRow[header] || '').trim();
      if (value) return value;
    }

    if (Array.isArray(data.dateCols) && data.dateCols.length) {
      for (const colIdx of data.dateCols) {
        const header = data.headers[colIdx];
        if (!header) continue;
        if (
          header.includes(`${selectedMonth}/${day}`) ||
          (Array.isArray(data.headersISO) && data.headersISO[colIdx] === targetDate)
        ) {
          const value = String(userRow[header] || '').trim();
          if (value) return value;
        }
      }
    }

    return "上班";
  };

  const getDailyStatus = (name, day) => getDailyStatusFrom(sheetData.schedule, name, day);
  const getDailyRecord = (name, day) => {
    const v = getDailyStatusFrom(sheetData.records, name, day);
    if (v !== "上班") return v;
    return getDailyStatus(name, day);
  };

  // 處理登入 (自動辨識倉別)
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    
    try {
      const { name, birthday } = loginData;
      
      if (!name.trim() || !birthday.trim()) {
        setLoginError('請輸入姓名和生日');
        setLoginLoading(false);
        return;
      }
      
      // 檢查是否為管理員登入（姓名：酷澎，生日：0000）
      if (name.trim() === '酷澎' && birthday.trim() === '0000') {
        setIsAdminMode(true);
        setLoginLoading(false);
        return;
      }
      
      // 呼叫 GAS API 驗證登入 (自動辨識倉別)
      const result = await verifyLogin(name.trim(), birthday.trim());
      
      console.log('登入驗證結果:', result);
      
      if (result && result.ok === true) {
        // 登入成功
        const userData = {
          name: result.name || name.trim(),
          warehouse: result.warehouse || result.warehouseKey,
          birthday: birthday.trim(),
          isAdmin: false
        };
        setUser(userData);
        setView('dashboard');
        // 儲存登入時間和用戶資料到 localStorage
        localStorage.setItem('loginTime', String(Date.now()));
        localStorage.setItem('user', JSON.stringify(userData));
      } else {
        setLoginError(result?.error || result?.msg || '姓名或生日不正確，請確認後重試');
      }
    } catch (error) {
      console.error('登入失敗:', error);
      setLoginError(error.message || '登入失敗，請稍後再試');
    } finally {
      setLoginLoading(false);
    }
  };
  
  // 管理員查詢人員
  const handleAdminSearch = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    
    try {
      const searchName = adminSearchName.trim();
      if (!searchName) {
        setLoginError('請輸入要查詢的人員姓名');
        setLoginLoading(false);
        return;
      }
      
      // 使用管理員身份查詢人員（生日設為空，讓 API 自動查找）
      const result = await verifyLogin(searchName, '', true);
      
      console.log('管理員查詢結果:', result);
      
      if (result && result.ok === true) {
        const userData = {
          name: result.name || searchName,
          warehouse: result.warehouse || result.warehouseKey,
          birthday: '',
          isAdmin: true
        };
        setUser(userData);
        setView('dashboard');
        setIsAdminMode(false);
        setAdminSearchName('');
        // 管理員也儲存登入資料（但不受時間限制）
        localStorage.setItem('loginTime', String(Date.now()));
        localStorage.setItem('user', JSON.stringify(userData));
      } else {
        setLoginError(result?.error || result?.msg || '找不到此人員，請確認姓名');
      }
    } catch (error) {
      console.error('查詢失敗:', error);
      setLoginError(error.message || '查詢失敗，請稍後再試');
    } finally {
      setLoginLoading(false);
    }
  };

  // 登出
  const handleLogout = () => {
    setUser(null);
    setView('login');
    loadTokenRef.current += 1;
    setLoadedResults(null);
    setBackgroundLoading(false);
    setSheetData({
      schedule: { headers: [], rows: [], dateCols: [], headersISO: [] },
      attendance: { headers: [], rows: [], dateCols: [], headersISO: [] },
      records: { headers: [], rows: [], dateCols: [], headersISO: [] },
      adjustment: { headers: [], rows: [], dateCols: [], headersISO: [] },
    });
    setSheetNames([]);
    setResolvedSheets({ schedule: '', attendance: '', records: '', adjustment: '' });
    // 清除 localStorage 中的登入資料
    localStorage.removeItem('loginTime');
    localStorage.removeItem('user');
    // 重置登入表單和管理員模式
    setLoginData({ name: '', birthday: '' });
    setLoginError('');
    setIsAdminMode(false);
    setAdminSearchName('');
  };
  
  // 圖片預覽狀態
  const [previewImage, setPreviewImage] = useState(null);
  const [previewFilename, setPreviewFilename] = useState('');

  // 下載月曆為 PNG（在當前頁面顯示圖片預覽，讓用戶長按保存）
  const downloadCalendarAsPng = async (refElement, filename) => {
    if (!refElement.current) return;
    
    setIsDownloading(true);
    try {
      const element = refElement.current;
      
      // 暫時移除 overflow 限制，確保完整捕獲
      const originalOverflow = element.style.overflow;
      const originalWidth = element.style.width;
      element.style.overflow = 'visible';
      element.style.width = 'max-content';
      
      // 使用 html2canvas 將元素轉換為 canvas
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: 2, // 提高解析度
        useCORS: true,
        logging: false,
        allowTaint: true,
        foreignObjectRendering: false,
        imageTimeout: 15000,
        removeContainer: true,
        // 確保完整區域都被捕獲
        scrollX: 0,
        scrollY: 0,
        width: element.scrollWidth + 48,
        height: element.scrollHeight + 48,
        x: -24,
        y: -24,
      });
      
      // 還原樣式
      element.style.overflow = originalOverflow;
      element.style.width = originalWidth;
      
      // 使用 data URL
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      
      // 電腦自動下載，手機顯示預覽
      if (!isPWA && !(/Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))) {
        // 電腦：自動觸發下載
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // 手機/PWA：顯示預覽讓用戶長按保存
        setPreviewImage(dataUrl);
        setPreviewFilename(filename);
      }
      
      setIsDownloading(false);
    } catch (error) {
      console.error('下載失敗:', error);
      alert('下載失敗，請重試。如果問題持續，請截圖保存。');
      setIsDownloading(false);
    }
  };

  const renderDashboard = () => {
    const isoForYear = (sheetData.schedule?.headersISO?.length ? sheetData.schedule.headersISO : sheetData.records?.headersISO);
    const year = pickYearFromISO(isoForYear);
    const daysInMonth = new Date(year, selectedMonth, 0).getDate();
    const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const firstDayOfWeek = new Date(year, selectedMonth - 1, 1).getDay();
    
    // 計算上個月和下個月的跨月日期
    const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
    const nextMonth = selectedMonth === 12 ? 1 : selectedMonth + 1;
    const prevMonthDays = new Date(year, selectedMonth - 1, 0).getDate();
    const prevMonthDates = Array.from({ length: firstDayOfWeek }, (_, i) => prevMonthDays - firstDayOfWeek + 1 + i);
    const totalCells = firstDayOfWeek + daysInMonth;
    const nextMonthDates = Array.from({ length: (7 - (totalCells % 7)) % 7 }, (_, i) => i + 1);

    // 假別統計（TAO1 用出勤記錄，其他倉用班表）
    // 排除：未/調倉/離/轉正/調任/休/休假/休假日/例/例假/例假日/上班/空白
    const leaveMap = {};
    const getLeaveStatus = user.warehouse === 'TAO1' ? getDailyRecord : getDailyStatus;
    
    // 判斷是否應該排除假別統計的函數
    // 排除：國/未/離/調倉/調任/轉正 + 休/休假/休假日/例/例假/例假日/例休
    const shouldExclude = (status) => {
      // 完全匹配排除
      const exactExclude = ["國", "未", "休", "休假", "休假日", "例", "例假", "例假日", "例休", "休加"];
      if (exactExclude.includes(status)) return true;
      // 包含關鍵字排除
      const containsExclude = ["調倉", "離", "轉正", "調任"];
      if (containsExclude.some(k => status.includes(k))) return true;
      return false;
    };
    
    daysArray.forEach(d => {
      const status = getLeaveStatus(user.name, d);
      const trimmed = String(status || '').trim();
      // 排除空白和上班
      if (!trimmed || trimmed === '上班') return;
      // 排除特定關鍵字
      if (shouldExclude(trimmed)) return;
      // 其他都統計
      if (!leaveMap[trimmed]) leaveMap[trimmed] = [];
      leaveMap[trimmed].push(d);
    });

    return (
      <div className="min-h-screen bg-[#F1F5F9] pb-36 font-sans">
        {/* Header */}
        <header className="bg-white px-6 py-6 border-b border-slate-200 sticky top-0 z-40 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black shadow-lg text-xl">
                {user.name.charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black text-blue-700 tracking-tighter">{user.warehouse}</span>
                  {loading && <Loader2 size={16} className="animate-spin text-blue-500" />}
                  {!loading && backgroundLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}
                </div>
                <h2 className="text-base font-bold text-slate-800">{user.name}</h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { 
                clearAllCache();
                loadTokenRef.current += 1;
                setLoadedResults(null);
                setSheetNames([]);
                setResolvedSheets({ schedule: '', attendance: '', records: '', adjustment: '' });
                setBackgroundLoading(false);
                setSheetData({
                  schedule: { headers: [], rows: [], dateCols: [], headersISO: [] },
                  attendance: { headers: [], rows: [], dateCols: [], headersISO: [] },
                  records: { headers: [], rows: [], dateCols: [], headersISO: [] },
                  adjustment: { headers: [], rows: [], dateCols: [], headersISO: [] },
                });
                loadAllSheets(user.warehouse, user.name);
              }} 
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl transition-all text-sm font-bold shadow-sm" 
                title="重新載入（清除快取）">
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                <span>重整</span>
              </button>
              {user.isAdmin && (
                <button onClick={openGoogleSheet} 
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-50 text-green-600 hover:bg-green-100 rounded-xl transition-all text-sm font-bold shadow-sm" 
                  title="開啟 Google Sheet">
                  <ExternalLink size={16} />
                  <span>表單</span>
                </button>
              )}
              <button onClick={handleLogout} 
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all text-sm font-bold shadow-sm">
                <LogOut size={16}/>
                <span>登出</span>
              </button>
            </div>
          </div>
          
          {loading && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-sm font-bold flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              資料載入中...
            </div>
          )}
          
                    
          {/* 管理員查詢人員區 */}
          {user.isAdmin && (
            <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                <User size={18} className="text-purple-600" />
                <span className="text-sm font-bold text-purple-700">查詢其他人員</span>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const searchName = e.target.searchName.value.trim();
                if (!searchName) return;
                setLoginLoading(true);
                setLoginError('');
                try {
                  const result = await verifyLogin(searchName, '', true);
                  if (result.ok) {
                    const userData = {
                      name: result.name || searchName,
                      warehouse: result.warehouse || result.warehouseKey,
                      birthday: '',
                      isAdmin: true
                    };
                    // 先清空舊資料和快取，避免混合
                    clearAllCache();
                    loadTokenRef.current += 1;
                    setLoadedResults(null);
                    setBackgroundLoading(false);
                    setSheetData({
                      schedule: { headers: [], rows: [], dateCols: [], headersISO: [] },
                      attendance: { headers: [], rows: [], dateCols: [], headersISO: [] },
                      records: { headers: [], rows: [], dateCols: [], headersISO: [] },
                      adjustment: { headers: [], rows: [], dateCols: [], headersISO: [] },
                    });
                    setResolvedSheets({ schedule: '', attendance: '', records: '', adjustment: '' });
                    setSheetNames([]);
                    e.target.searchName.value = '';
                    // 設定新用戶，useEffect 會自動觸發 loadAllSheets
                    setUser(userData);
                    localStorage.setItem('loginTime', String(Date.now()));
                    localStorage.setItem('user', JSON.stringify(userData));
                  } else {
                    setLoginError(result.error || '找不到此人員');
                  }
                } catch (err) {
                  setLoginError(err.message || '查詢失敗');
                } finally {
                  setLoginLoading(false);
                }
              }} className="flex gap-2">
                <input
                  type="text"
                  name="searchName"
                  placeholder="輸入人員姓名"
                  className="flex-1 px-4 py-2 border border-purple-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {loginLoading ? <Loader2 size={16} className="animate-spin" /> : <User size={16} />}
                  查詢
                </button>
              </form>
              {loginError && (
                <div className="mt-2 text-red-500 text-xs font-bold">{loginError}</div>
              )}
            </div>
          )}

          {/* 資料狀態提示 */}
          {dataError && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-xs font-bold">
              ⚠️ {dataError}
            </div>
          )}
          
          {(sheetData.schedule.rows.length > 0 || sheetData.attendance.rows.length > 0 || sheetData.records.rows.length > 0) && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-xs font-bold">
              ✅ 已載入
              <span className="ml-2">班表 {sheetData.schedule.rows.length} 列</span>
              <span className="ml-2">出勤時數 {sheetData.attendance.rows.length} 列</span>
              <span className="ml-2">出勤記錄 {sheetData.records.rows.length} 列</span>
            </div>
          )}
          
          {/* 月份選擇器 - 始終顯示 */}
          <div className="flex items-center justify-between bg-slate-200/50 p-1.5 rounded-xl">
            <button onClick={() => setSelectedMonth(m => m > 1 ? m - 1 : 12)} className="p-2 bg-white rounded-lg shadow-sm">
              <ChevronLeft size={18}/>
            </button>
            <span className="text-base font-black text-slate-900">{year} 年 {selectedMonth} 月</span>
            <button onClick={() => setSelectedMonth(m => m < 12 ? m + 1 : 1)} className="p-2 bg-white rounded-lg shadow-sm">
              <ChevronRight size={18}/>
            </button>
          </div>
        </header>

        <main className="p-4 space-y-6">
          
          {/* 1. 班表月曆 */}
          {activeTab === 'calendar' && (
            sheetData.schedule.rows.length === 0 ? (
              <div className="bg-slate-100 border border-slate-200 rounded-2xl p-8 text-center">
                <p className="text-slate-500 font-bold text-lg">📅 {selectedMonth}月本月系統無資料或已清除</p>
              </div>
            ) : (
            <section className="bg-white rounded-3xl shadow-sm border border-slate-200 p-5 overflow-hidden">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <CalendarIcon size={20} className="text-blue-600" /> 班表
                </h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => downloadCalendarAsPng(calendarRef, `班表_${user.name}_${year}年${selectedMonth}月.png`)}
                    disabled={isDownloading}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                    {isDownloading ? <Loader2 size={12} className="animate-spin"/> : <Download size={12}/>} 下載
                  </button>
                  <button onClick={() => {setModalType('schedule'); setShowSheetModal(true);}} 
                    className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1">
                    <Maximize2 size={12}/> 原始表格
                  </button>
                </div>
              </div>
              <div ref={calendarRef} className="bg-white p-6">
                <div className="text-center mb-3 text-sm font-bold text-slate-600">{user.name} - {year}年{selectedMonth}月 班表</div>
                <div className="grid grid-cols-7 gap-2">
                  {['日','一','二','三','四','五','六'].map(w => (
                    <div key={w} className="text-center text-xs font-bold text-slate-400 py-1">{w}</div>
                  ))}
                  {/* 上個月跨月日期 */}
                  {prevMonthDates.map((d) => (
                    <div key={`prev-${d}`} className="aspect-square rounded-xl flex flex-col items-center justify-center border border-slate-50 bg-slate-50/50 shadow-sm" style={{aspectRatio: '1/1'}}>
                      <span className="text-[10px] font-bold text-slate-300">{prevMonth}月</span>
                      <span className={`${isPWA ? 'text-lg' : 'text-2xl'} font-bold leading-none text-slate-300`}>{d}</span>
                    </div>
                  ))}
                  {/* 當月日期 */}
                  {daysArray.map((d) => {
                    const status = getDailyStatus(user.name, d);
                    const trimmedStatus = String(status || '').trim();
                    const isLeave = trimmedStatus && trimmedStatus !== '上班';
                    // 判斷是否為假別統計中的假（用底色顯示）
                    const isInLeaveMap = Object.keys(leaveMap).find(type => leaveMap[type].includes(d));
                    const config = COLOR_CONFIG[status] || (isLeave ? COLOR_CONFIG["事"] : COLOR_CONFIG["上班"]);
                    
                    // TAO1 班表：顯示所有非上班狀態（例/例休/例假日/休/休假/休假日/國/國出/休加/未/調倉/調任等）
                    if (user.warehouse === 'TAO1') {
                      const displayStatus = isLeave ? status : '';
                      const hasStatus = isLeave && displayStatus;
                      return (
                        <div key={d} className={`aspect-square rounded-xl flex flex-col items-center justify-center border ${hasStatus ? `${config.border} ${config.bg}` : 'border-slate-100 bg-white'} shadow-sm`} style={{aspectRatio: '1/1'}}>
                          <span className={`${isPWA ? 'text-xl' : 'text-4xl'} font-black leading-none ${hasStatus ? config.text : 'text-slate-950'}`}>{d}</span>
                          {displayStatus && <span className={`${isPWA ? 'text-[10px]' : 'text-base'} font-bold ${isPWA ? 'mt-0.5' : 'mt-1'} ${config.text}`}>{displayStatus}</span>}
                        </div>
                      );
                    }
                    
                    // 其他倉：顯示所有非「上班」和非空白的狀態
                    const displayStatus = isLeave ? status : '';
                    return (
                      <div key={d} className={`aspect-square rounded-xl flex flex-col items-center justify-center border ${isInLeaveMap ? `${config.border} ${config.bg}` : 'border-slate-100 bg-white'} shadow-sm`} style={{aspectRatio: '1/1'}}>
                        <span className={`${isPWA ? 'text-xl' : 'text-4xl'} font-black leading-none ${isInLeaveMap ? config.text : 'text-slate-950'}`}>{d}</span>
                        {displayStatus && <span className={`${isPWA ? 'text-[10px]' : 'text-base'} font-bold ${isPWA ? 'mt-0.5' : 'mt-1'} ${isInLeaveMap ? config.text : 'text-slate-600'}`}>{displayStatus}</span>}
                      </div>
                    );
                  })}
                  {/* 下個月跨月日期 */}
                  {nextMonthDates.map((d) => (
                    <div key={`next-${d}`} className="aspect-square rounded-xl flex flex-col items-center justify-center border border-slate-50 bg-slate-50/50 shadow-sm" style={{aspectRatio: '1/1'}}>
                      <span className="text-[10px] font-bold text-slate-300">{nextMonth}月</span>
                      <span className={`${isPWA ? 'text-lg' : 'text-2xl'} font-bold leading-none text-slate-300`}>{d}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}

          {/* 2. 工時明細 */}
          {activeTab === 'attendance' && (
            sheetData.attendance.rows.length === 0 ? (
              <div className="bg-slate-100 border border-slate-200 rounded-2xl p-8 text-center">
                <p className="text-slate-500 font-bold text-lg">⏰ {selectedMonth}月本月系統無資料或已刪除</p>
              </div>
            ) : (
            <section className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-900">出勤查詢明細</h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => downloadCalendarAsPng(attendanceRef, `工時明細_${user.name}_${year}年${selectedMonth}月.png`)}
                    disabled={isDownloading}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                    {isDownloading ? <Loader2 size={12} className="animate-spin"/> : <Download size={12}/>} 下載
                  </button>
                  <button
                    onClick={() => {
                      setModalType('attendance');
                      setShowSheetModal(true);
                    }}
                    className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1"
                  >
                    <Maximize2 size={14}/> 原始樣式
                  </button>
                </div>
              </div>
              <div ref={attendanceRef} className="bg-white overflow-x-auto">
                <div className="text-center py-3 text-sm font-bold text-slate-600">{user.name} - {year}年{selectedMonth}月 工時明細</div>
                {(
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-slate-500 font-bold border-b border-slate-200 text-center">
                        {sheetData.attendance.headers.slice(0, 11).map((header, idx) => (
                          <th key={idx} className="px-4 py-4 whitespace-nowrap text-base">{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sheetData.attendance.rows.slice(0, 20).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 text-center">
                          {sheetData.attendance.headers.slice(0, 11).map((header, colIdx) => (
                            <td key={colIdx} className="px-4 py-4 whitespace-nowrap text-base">
                              {String(row[header] || '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          ))}

          {/* 3. 假別統計 */}
          {activeTab === 'leaves' && (
            <section className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <ClipboardList size={24} className="text-blue-600" />
                  <h3 className="text-xl font-black text-slate-900">假別統計</h3>
                </div>
                <button 
                  onClick={() => downloadCalendarAsPng(leaveStatsRef, `假別統計_${user.name}_${year}年${selectedMonth}月.png`)}
                  disabled={isDownloading || Object.keys(leaveMap).length === 0}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                  {isDownloading ? <Loader2 size={12} className="animate-spin"/> : <Download size={12}/>} 下載
                </button>
              </div>
              <div ref={leaveStatsRef} className="p-5 bg-white">
                <div className="text-center mb-3 text-sm font-bold text-slate-600">{user.name} - {year}年{selectedMonth}月 假別統計</div>
                {Object.keys(leaveMap).length === 0 ? (
                  <div className="text-center text-slate-400 py-10">本月無請假記錄</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 font-bold text-left border-b border-slate-100">
                        <th className="pb-3">假別</th>
                        <th className="pb-3">日期明細</th>
                        <th className="pb-3 text-center">總計</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(leaveMap).map(([type, days]) => {
                        const config = COLOR_CONFIG[type] || COLOR_CONFIG["上班"];
                        return (
                          <tr key={type}>
                            <td className={`py-6 font-black text-xl ${config.text}`}>{type}</td>
                            <td className="py-6">
                              <div className="flex flex-wrap gap-1">
                                {days.map(d => (
                                  <span key={d} className={`${config.bg} ${config.text} font-bold px-3 py-1.5 rounded-lg text-sm border ${config.border}`}>
                                    {selectedMonth}/{d}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-6 text-center text-3xl font-black text-slate-950">{days.length}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          {/* 4. 出勤記錄 - 只有 TAO1 倉顯示 */}
          {activeTab === 'logs' && user.warehouse === 'TAO1' && (
            sheetData.records.rows.length === 0 ? (
              <div className="bg-slate-100 border border-slate-200 rounded-2xl p-8 text-center">
                <p className="text-slate-500 font-bold text-lg">📋 {selectedMonth}月本月系統無請假記錄或已刪除</p>
              </div>
            ) : (
            <section className="bg-white rounded-3xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                    <Fingerprint size={24} />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">出勤記錄表</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => downloadCalendarAsPng(recordsCalendarRef, `出勤記錄_${user.name}_${year}年${selectedMonth}月.png`)}
                    disabled={isDownloading}
                    className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                    {isDownloading ? <Loader2 size={12} className="animate-spin"/> : <Download size={12}/>} 下載
                  </button>
                  <button onClick={() => {setModalType('records'); setShowSheetModal(true);}} 
                    className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1">
                    <Maximize2 size={14}/> 原始樣式
                  </button>
                </div>
              </div>
              <div ref={recordsCalendarRef} className="bg-white p-2">
                <div className="text-center mb-3 text-sm font-bold text-slate-600">{user.name} - {year}年{selectedMonth}月 出勤記錄</div>
                <div className="grid grid-cols-7 gap-2">
                {['日','一','二','三','四','五','六'].map(w => (
                  <div key={w} className="text-center text-xs font-bold text-slate-400 py-1">{w}</div>
                ))}
                {/* 上個月跨月日期 */}
                {prevMonthDates.map((d) => (
                  <div key={`prev-log-${d}`} className="aspect-square rounded-xl flex flex-col items-center justify-center border border-slate-50 bg-slate-50/50 shadow-sm">
                    <span className="text-[10px] font-bold text-slate-300">{prevMonth}月</span>
                    <span className={`${isPWA ? 'text-lg' : 'text-2xl'} font-bold leading-none text-slate-300`}>{d}</span>
                  </div>
                ))}
                {/* 當月日期 */}
                {daysArray.map((d) => {
                  const status = getDailyRecord(user.name, d);
                  const trimmedStatus = String(status || '').trim();
                  const isLeave = trimmedStatus && trimmedStatus !== '上班';
                  // 假別統計中的假別才有底色，其他假別顯示但不用底色
                  const isInLeaveMap = Object.keys(leaveMap).find(type => leaveMap[type].includes(d));
                  const config = COLOR_CONFIG[status] || (isLeave ? COLOR_CONFIG["事"] : COLOR_CONFIG["上班"]);
                  const displayStatus = isLeave ? status : '';
                  return (
                    <div key={d} className={`aspect-square rounded-xl flex flex-col items-center justify-center border transition-all ${isInLeaveMap ? `${config.bg} ${config.border} shadow-md` : 'bg-white border-slate-100'}`}>
                      <span className={`${isPWA ? 'text-xl' : 'text-5xl'} font-black leading-none ${isInLeaveMap ? config.text : 'text-slate-950'}`}>{d}</span>
                      {displayStatus && <span className={`${isPWA ? 'text-[10px]' : 'text-base'} font-bold ${isPWA ? 'mt-0.5' : 'mt-1'} ${isInLeaveMap ? config.text : 'text-slate-500'}`}>{status}</span>}
                    </div>
                  );
                })}
                {/* 下個月跨月日期 */}
                {nextMonthDates.map((d) => (
                  <div key={`next-log-${d}`} className="aspect-square rounded-xl flex flex-col items-center justify-center border border-slate-50 bg-slate-50/50 shadow-sm">
                    <span className="text-[10px] font-bold text-slate-300">{nextMonth}月</span>
                    <span className={`${isPWA ? 'text-lg' : 'text-2xl'} font-bold leading-none text-slate-300`}>{d}</span>
                  </div>
                ))}
                </div>
              </div>
            </section>
          ))}

          {/* 5. 調假名單 - 只有 TAO1 倉顯示，沒有資料時不顯示 */}
          {activeTab === 'adjustment' && user.warehouse === 'TAO1' && sheetData.adjustment.rows.length > 0 && (
            <section className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-800">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-md shadow-lg">
                    <FileEdit size={28} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black tracking-tighter text-white">調假名單</h3>
                    <p className="text-xs text-blue-200 font-bold mt-1">{resolvedSheets.adjustment || '未找到分頁'}</p>
                  </div>
                </div>
                <button onClick={() => {setModalType('adjustment'); setShowSheetModal(true);}} 
                  className="bg-white/20 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1 backdrop-blur-md">
                  <Maximize2 size={14}/> 原始樣式
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-500 font-bold border-b border-slate-200 text-center">
                      {sheetData.adjustment.headers.slice(0, 10).map((header, idx) => (
                        <th key={idx} className="px-4 py-4 whitespace-nowrap text-base">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sheetData.adjustment.rows.slice(0, 30).map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 text-center">
                        {sheetData.adjustment.headers.slice(0, 10).map((header, colIdx) => (
                          <td key={colIdx} className="px-4 py-4 whitespace-nowrap text-base">
                            {String(row[header] || '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>

        {/* 底部導覽 */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-slate-200 flex justify-around py-6 shadow-xl z-50 px-4">
          <NavBtn active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} icon={<CalendarIcon size={22}/>} label="班表" />
          <NavBtn active={activeTab === 'attendance'} onClick={() => setActiveTab('attendance')} icon={<Clock size={22}/>} label="工時" />
          <NavBtn active={activeTab === 'leaves'} onClick={() => setActiveTab('leaves')} icon={<TableIcon size={22}/>} label="統計" />
          {user.warehouse === 'TAO1' && <NavBtn active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon={<Fingerprint size={22}/>} label="出勤記錄表" />}
          {user.warehouse === 'TAO1' && <NavBtn active={activeTab === 'adjustment'} onClick={() => setActiveTab('adjustment')} icon={<FileEdit size={22}/>} label="調假" />}
        </nav>

        {/* 原始 Sheet 彈窗 */}
        {/* 圖片預覽模態框 - 讓用戶長按保存或點擊下載 */}
        {previewImage && (
          <div className="fixed inset-0 z-[200] bg-slate-950/95 backdrop-blur-lg flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-lg bg-white rounded-3xl overflow-hidden shadow-2xl">
              <div className="p-4 bg-slate-50 border-b flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-900">📱 長按圖片保存</h3>
                <button onClick={() => setPreviewImage(null)} className="p-2 bg-white shadow border border-slate-200 rounded-xl text-slate-400 hover:text-red-500">
                  <X size={20}/>
                </button>
              </div>
              <div className="p-4 bg-slate-100 overflow-auto max-h-[60vh]">
                <img src={previewImage} alt={previewFilename} className="w-full rounded-xl shadow-lg" />
              </div>
              <div className="p-4 bg-slate-50 space-y-3">
                <p className="text-slate-500 text-sm font-bold text-center">長按上方圖片 → 選擇「儲存圖片」或「加入照片」</p>
                <button 
                  onClick={() => {
                    // 建立隱藏的 a 標籤來觸發下載
                    const link = document.createElement('a');
                    link.href = previewImage;
                    link.download = previewFilename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  className="block w-full py-3 bg-blue-600 text-white text-center rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors"
                >
                  <Download size={16} className="inline mr-2" />
                  點擊直接下載（舊手機適用）
                </button>
              </div>
            </div>
          </div>
        )}

        {showSheetModal && (
          <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-lg flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-6xl h-[80vh] rounded-3xl overflow-hidden flex flex-col shadow-2xl">
              <div className="px-8 py-6 bg-slate-50 border-b flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-slate-900">
                    {user.warehouse} - {modalType === 'schedule' ? (resolvedSheets.schedule || '班表') : modalType === 'attendance' ? (resolvedSheets.attendance || '出勤時數') : modalType === 'adjustment' ? (resolvedSheets.adjustment || '調假名單') : (resolvedSheets.records || '出勤記錄')}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">資料來源：Google Sheet</p>
                </div>
                <button onClick={() => setShowSheetModal(false)} className="p-3 bg-white shadow-lg border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500">
                  <X size={28}/>
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 bg-[#F8FAFC]">
                {(() => {
                  const headers = (modalType === 'schedule' ? sheetData.schedule.headers : modalType === 'attendance' ? sheetData.attendance.headers : modalType === 'adjustment' ? sheetData.adjustment.headers : sheetData.records.headers);
                  const rows = (modalType === 'schedule' ? sheetData.schedule.rows : modalType === 'attendance' ? sheetData.attendance.rows : modalType === 'adjustment' ? sheetData.adjustment.rows : sheetData.records.rows);
                  
                  // 找出最後一個有內容的欄位索引，但最多只到第 46 欄（AT 欄）
                  const maxCol = 46;
                  let lastColWithData = 0;
                  headers.slice(0, maxCol).forEach((h, idx) => {
                    if (String(h || '').trim()) lastColWithData = idx;
                  });
                  rows.forEach(row => {
                    headers.slice(0, maxCol).forEach((h, idx) => {
                      if (String(row[h] || '').trim()) lastColWithData = Math.max(lastColWithData, idx);
                    });
                  });
                  // 確保不超過 maxCol
                  lastColWithData = Math.min(lastColWithData, maxCol - 1);
                  const displayHeaders = headers.slice(0, lastColWithData + 1);
                  
                  return (
                    <div className="inline-block bg-white shadow-lg rounded-xl overflow-hidden border border-slate-300">
                      <table className="border-collapse text-xs font-bold">
                        <thead>
                          <tr className="bg-[#EFEFEF] text-slate-500 text-center">
                            {displayHeaders.map((header, idx) => {
                              const isEmpty = !String(header || '').trim();
                              return (
                                <th key={idx} className={`px-4 py-3 whitespace-nowrap ${isEmpty ? '' : 'border border-slate-300 bg-[#EFEFEF]'}`}>{header}</th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, rowIdx) => (
                            <tr key={rowIdx} className="bg-white hover:bg-slate-50">
                              {displayHeaders.map((header, colIdx) => {
                                const value = String(row[header] || '');
                                const bgColor = row._bg?.[colIdx] || '';
                                const textColor = row._fc?.[colIdx] || '';
                                const isEmpty = !value.trim();
                                return (
                                  <td key={colIdx} 
                                    className={`px-4 py-3 text-center whitespace-nowrap ${isEmpty ? '' : 'border border-slate-300'}`}
                                    style={{ 
                                      backgroundColor: isEmpty ? 'transparent' : (bgColor || undefined),
                                      color: textColor || undefined
                                    }}>
                                    {value}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLogin = () => {
    // 管理員模式介面
    if (isAdminMode) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-10 border border-slate-100 text-center">
            <div className="bg-amber-500 w-20 h-20 rounded-2xl flex items-center justify-center mb-8 shadow-xl mx-auto font-black text-white text-4xl">
              👑
            </div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tighter mb-2">管理員模式</h1>
            <p className="text-sm text-slate-400 mb-8">請輸入要查詢的人員姓名</p>
            
            <form onSubmit={handleAdminSearch} className="space-y-4">
              {/* 人員姓名輸入 */}
              <input 
                type="text" 
                className="w-full p-4 bg-slate-100 border-none rounded-2xl outline-none font-bold text-slate-800 text-center text-lg placeholder:text-slate-300" 
                placeholder="輸入人員姓名" 
                value={adminSearchName} 
                onChange={(e) => setAdminSearchName(e.target.value)}
                autoFocus
              />
              
              {/* 錯誤訊息 */}
              {loginError && (
                <div className="text-red-500 text-sm font-bold bg-red-50 p-3 rounded-xl">
                  {loginError}
                </div>
              )}
              
              {/* 查詢按鈕 */}
              <button 
                type="submit"
                disabled={loginLoading}
                className="w-full bg-amber-500 text-white py-4 rounded-2xl font-black text-xl shadow-lg shadow-amber-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loginLoading ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    查詢中...
                  </>
                ) : (
                  '查詢人員'
                )}
              </button>
              
              {/* 返回按鈕 */}
              <button 
                type="button"
                onClick={() => {
                  setIsAdminMode(false);
                  setAdminSearchName('');
                  setLoginError('');
                  setLoginData({ name: '', birthday: '' });
                }}
                className="w-full bg-slate-200 text-slate-600 py-3 rounded-2xl font-bold text-base transition-all active:scale-95"
              >
                返回登入
              </button>
            </form>
          </div>
        </div>
      );
    }
    
    // 一般登入介面
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-10 border border-slate-100 text-center">
          <div className="bg-blue-600 w-20 h-20 rounded-2xl flex items-center justify-center mb-8 shadow-xl mx-auto font-black text-white text-4xl">
            H
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter mb-2">宏盛查詢系統</h1>
          <p className="text-sm text-slate-400 mb-8">請輸入姓名和生日登入</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            {/* 姓名輸入 */}
            <input 
              type="text" 
              className="w-full p-4 bg-slate-100 border-none rounded-2xl outline-none font-bold text-slate-800 text-center text-lg placeholder:text-slate-500" 
              placeholder="姓名" 
              value={loginData.name} 
              onChange={(e) => setLoginData({...loginData, name: e.target.value})}
            />
            
            {/* 生日輸入 */}
            <input 
              type="text" 
              className="w-full p-4 bg-slate-100 border-none rounded-2xl outline-none font-bold text-slate-800 text-center text-lg placeholder:text-slate-500" 
              placeholder="生日 (例如 810101)" 
              value={loginData.birthday} 
              onChange={(e) => setLoginData({...loginData, birthday: e.target.value})
            }/>
            
            {/* 錯誤訊息 */}
            {loginError && (
              <div className="text-red-500 text-sm font-bold bg-red-50 p-3 rounded-xl">
                {loginError}
              </div>
            )}
            
            {/* 登入按鈕 */}
            <button 
              type="submit"
              disabled={loginLoading}
              className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-xl shadow-lg shadow-blue-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loginLoading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  驗證中...
                </>
              ) : (
                '登入系統'
              )}
            </button>
          </form>
          
          <p className="text-xs text-slate-300 mt-6">
            系統會自動辨識您所屬的倉別
          </p>
        </div>
      </div>
    );
  };

  return view === 'login' ? renderLogin() : renderDashboard();
};

export default App;
