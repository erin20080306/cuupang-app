// Google Sheets 資料讀取服務
// 使用 Google Sheets API v4 公開讀取方式

// 各倉庫 Google Sheet IDs
export const SHEET_IDS = {
  TAO1: "1bpcp1dbC_n4xLj82CR2FmhhLfyIjb6EpM90IIkF0wHo",  // 測試用試算表
  TAO3: "1cffI2jIVZA1uSiAyaLLXXgPzDByhy87xznaN85O7wEE",
  TAO4: "1tVxQbV0298fn2OXWAF0UqZa7FLbypsatciatxs4YVTU",
  TAO5: "1jzVXC6gt36hJtlUHoxtTzZLMNj4EtTsd4k8eNB1bdiA",
  TAO6: "1wwPLSLjl2abfM_OMdTNI9PoiPKo3waCV_y0wmx2DxAE",
  TAO7: "16nGCqRO8DYDm0PbXFbdt-fiEFZCXxXjlOWjKU67p4LY",
  TAO10: "1y0w49xdFlHvcVtgtG8fq6zdrF26y8j7HMFh5ujzUyR4"
};

// 分頁名稱配置 (根據實際 Google Sheet 分頁名稱)
export const SHEET_TABS = {
  SCHEDULE: "班表",           // 班表 → 班表月曆功能區
  ATTENDANCE: "出勤時數",     // 出勤時數 → 工時功能區
  RECORDS: "出勤記錄",        // 出勤記錄 → 記錄功能區
  ADJUSTMENT: "調假名單",
  EMPLOYEES: "人員資料"
};

// 分頁名稱關鍵字對照 (用於自動識別分頁類型)
const TAB_KEYWORDS = {
  schedule: ["排班", "班表", "schedule", "排休"],
  attendance: ["工時", "出勤", "明細", "attendance", "打卡"],
  adjustment: ["調假", "換假", "adjustment", "請假"],
  employees: ["人員", "員工", "employee", "名單", "資料"]
};

/**
 * 建立 Google Sheet 公開讀取 URL (CSV 格式)
 */
export const buildSheetUrl = (sheetId, tabName) => {
  const encodedTabName = encodeURIComponent(tabName);
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodedTabName}`;
};

/**
 * 建立 Google Sheet 公開讀取 URL (使用 gid)
 */
export const buildSheetUrlByGid = (sheetId, gid = 0) => {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
};

/**
 * 建立 Google Sheet 直接連結 URL
 */
export const buildSheetDirectUrl = (sheetId) => {
  return `https://docs.google.com/spreadsheets/d/${sheetId}`;
};

/**
 * 解析 CSV 字串為陣列
 */
export const parseCSV = (csvText) => {
  const lines = csvText.split('\n');
  return lines.map(line => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }).filter(row => row.some(cell => cell !== ''));
};

/**
 * 從 Google Sheet HTML 頁面解析所有分頁名稱和 gid
 */
export const fetchSheetTabs = async (sheetId) => {
  try {
    // 使用 Google Sheets 的公開 HTML 頁面來獲取分頁資訊
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?usp=sharing`;
    const response = await fetch(url);
    const html = await response.text();
    
    // 嘗試從 HTML 中解析分頁資訊
    const tabMatches = html.matchAll(/\{"name":"([^"]+)","index":(\d+),"id":(\d+)/g);
    const tabs = [];
    for (const match of tabMatches) {
      tabs.push({
        name: match[1],
        index: parseInt(match[2]),
        gid: parseInt(match[3])
      });
    }
    
    if (tabs.length > 0) {
      return tabs;
    }
    
    // 備用方法：嘗試常見分頁名稱
    return null;
  } catch (error) {
    console.error('無法獲取分頁列表:', error);
    return null;
  }
};

/**
 * 根據分頁名稱識別分頁類型
 */
export const identifyTabType = (tabName) => {
  const lowerName = tabName.toLowerCase();
  for (const [type, keywords] of Object.entries(TAB_KEYWORDS)) {
    if (keywords.some(kw => lowerName.includes(kw.toLowerCase()))) {
      return type;
    }
  }
  return 'unknown';
};

/**
 * 從 Google Sheet 讀取單一分頁資料 (使用分頁名稱)
 */
export const fetchSheetData = async (warehouse, tabName) => {
  const sheetId = SHEET_IDS[warehouse];
  if (!sheetId) {
    throw new Error(`找不到倉庫 ${warehouse} 的 Sheet ID`);
  }

  const url = buildSheetUrl(sheetId, tabName);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const csvText = await response.text();
    return parseCSV(csvText);
  } catch (error) {
    console.error(`讀取 ${warehouse} ${tabName} 失敗:`, error);
    throw error;
  }
};

/**
 * 從 Google Sheet 讀取單一分頁資料 (使用 gid)
 */
export const fetchSheetDataByGid = async (sheetId, gid) => {
  const url = buildSheetUrlByGid(sheetId, gid);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const csvText = await response.text();
    return parseCSV(csvText);
  } catch (error) {
    console.error(`讀取 gid=${gid} 失敗:`, error);
    throw error;
  }
};

/**
 * 自動讀取 Google Sheet 所有分頁
 */
export const fetchAllSheetTabs = async (warehouse) => {
  const sheetId = SHEET_IDS[warehouse];
  if (!sheetId) {
    throw new Error(`找不到倉庫 ${warehouse} 的 Sheet ID`);
  }

  const result = {
    tabs: [],
    rawData: {}
  };

  // 嘗試讀取常見分頁名稱
  const commonTabNames = [
    // 主要分頁 (根據用戶提供的分頁名稱)
    "班表", "出勤時數", "出勤記錄",
    // 備用分頁名稱
    "排班表", "工時明細", "調假名單", "人員資料",
    "1月", "2月", "3月", "4月", "5月", "6月", 
    "7月", "8月", "9月", "10月", "11月", "12月",
    "Sheet1", "工作表1"
  ];

  for (const tabName of commonTabNames) {
    try {
      const data = await fetchSheetData(warehouse, tabName);
      if (data && data.length > 0) {
        const tabType = identifyTabType(tabName);
        result.tabs.push({
          name: tabName,
          type: tabType,
          rowCount: data.length
        });
        result.rawData[tabName] = data;
      }
    } catch (error) {
      // 分頁不存在，跳過
    }
  }

  // 嘗試使用 gid 讀取前幾個分頁
  for (let gid = 0; gid <= 5; gid++) {
    try {
      const data = await fetchSheetDataByGid(sheetId, gid);
      if (data && data.length > 0) {
        const tabKey = `gid_${gid}`;
        if (!result.rawData[tabKey]) {
          result.tabs.push({
            name: `分頁 ${gid + 1}`,
            gid: gid,
            type: 'unknown',
            rowCount: data.length
          });
          result.rawData[tabKey] = data;
        }
      }
    } catch (error) {
      // gid 不存在，跳過
    }
  }

  return result;
};

/**
 * 讀取排班表資料
 * @param {string} warehouse - 倉庫代碼
 * @returns {Promise<Object>} 排班表資料物件
 */
export const fetchScheduleData = async (warehouse) => {
  const rawData = await fetchSheetData(warehouse, SHEET_TABS.SCHEDULE);
  
  if (rawData.length < 2) return { headers: [], rows: [] };
  
  const headers = rawData[0]; // 第一列為表頭 (日期)
  const rows = rawData.slice(1).map(row => ({
    dept: row[0] || '',      // 組別
    shift: row[1] || '',     // 班別
    name: row[2] || '',      // 姓名
    schedule: row.slice(3)   // 每日排班狀態
  }));

  return { headers, rows };
};

/**
 * 讀取工時明細資料
 * @param {string} warehouse - 倉庫代碼
 * @returns {Promise<Array<Object>>} 工時明細陣列
 */
export const fetchAttendanceData = async (warehouse) => {
  const rawData = await fetchSheetData(warehouse, SHEET_TABS.ATTENDANCE);
  
  if (rawData.length < 2) return [];
  
  // 跳過表頭，解析每一列
  return rawData.slice(1).map(row => ({
    date: row[0] || '',      // 日期
    dept: row[1] || '',      // 組別
    shift: row[2] || '',     // 班別
    name: row[3] || '',      // 姓名
    uid: row[4] || '',       // 使用者 ID
    corp: row[5] || '',      // 公司
    start: row[6] || '',     // 上班時間
    end: row[7] || '',       // 下班時間
    workH: row[8] || '',     // 計薪工時
    otH: row[9] || '',       // 加班工時
    note: row[10] || ''      // 備註
  }));
};

/**
 * 讀取出勤記錄資料 (用於記錄功能區)
 * @param {string} warehouse - 倉庫代碼
 * @returns {Promise<Object>} 出勤記錄資料物件
 */
export const fetchRecordsData = async (warehouse) => {
  const rawData = await fetchSheetData(warehouse, SHEET_TABS.RECORDS);
  
  if (rawData.length < 2) return { headers: [], rows: [] };
  
  const headers = rawData[0];
  const rows = rawData.slice(1).map(row => ({
    dept: row[0] || '',      // 組別
    shift: row[1] || '',     // 班別
    name: row[2] || '',      // 姓名
    records: row.slice(3)    // 每日出勤記錄
  }));

  return { headers, rows };
};

/**
 * 讀取調假名單資料
 * @param {string} warehouse - 倉庫代碼
 * @returns {Promise<Array<Object>>} 調假名單陣列
 */
export const fetchAdjustmentData = async (warehouse) => {
  const rawData = await fetchSheetData(warehouse, SHEET_TABS.ADJUSTMENT);
  
  if (rawData.length < 2) return [];
  
  return rawData.slice(1).map((row, idx) => ({
    id: `T${idx + 1}`,
    date: row[0] || '',      // 日期
    from: row[1] || '',      // 原狀態
    to: row[2] || '',        // 調整後狀態
    status: row[3] || '',    // 狀態 (已核准/待處理)
    type: row[4] || ''       // 類型 (換假/異常/加班)
  }));
};

/**
 * 讀取人員資料
 * @param {string} warehouse - 倉庫代碼
 * @returns {Promise<Array<Object>>} 人員資料陣列
 */
export const fetchEmployeesData = async (warehouse) => {
  const rawData = await fetchSheetData(warehouse, SHEET_TABS.EMPLOYEES);
  
  if (rawData.length < 2) return [];
  
  return rawData.slice(1).map(row => ({
    name: row[0] || '',        // 姓名
    birthday: row[1] || '',    // 生日 (MMDD)
    id: row[2] || '',          // 身分證/員工ID
    mayoId: row[3] || '',      // Mayo ID
    warehouse: row[4] || warehouse, // 倉庫
    dept: row[5] || '',        // 組別
    shift: row[6] || '',       // 班別
    onboard: row[7] || ''      // 到職日
  }));
};

/**
 * 批次讀取所有分頁資料
 * @param {string} warehouse - 倉庫代碼
 * @returns {Promise<Object>} 所有資料物件
 */
export const fetchAllData = async (warehouse) => {
  try {
    const [schedule, attendance, records, adjustment, employees] = await Promise.all([
      fetchScheduleData(warehouse).catch(() => ({ headers: [], rows: [] })),
      fetchAttendanceData(warehouse).catch(() => []),
      fetchRecordsData(warehouse).catch(() => ({ headers: [], rows: [] })),
      fetchAdjustmentData(warehouse).catch(() => []),
      fetchEmployeesData(warehouse).catch(() => [])
    ]);

    return {
      schedule,      // 班表 → 班表月曆功能區
      attendance,    // 出勤時數 → 工時功能區
      records,       // 出勤記錄 → 記錄功能區
      adjustment,
      employees,
      loaded: true,
      error: null
    };
  } catch (error) {
    return {
      schedule: { headers: [], rows: [] },
      attendance: [],
      records: { headers: [], rows: [] },
      adjustment: [],
      employees: [],
      loaded: false,
      error: error.message
    };
  }
};

export default {
  SHEET_IDS,
  SHEET_TABS,
  buildSheetUrl,
  buildSheetDirectUrl,
  fetchSheetData,
  fetchScheduleData,
  fetchAttendanceData,
  fetchRecordsData,
  fetchAdjustmentData,
  fetchEmployeesData,
  fetchAllData
};
