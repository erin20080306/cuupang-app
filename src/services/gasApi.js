// Google Apps Script API 服務
// 連接到現有的 coupang-admin-dashboard 後端

// 統一使用 coupang-admin-dashboard 的 GAS API URL（ContentService，可直接回傳 JSON）
// 此 API 支援 wh 參數來指定倉庫
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwqsMJ5NAwpWg6mE_KbpBG3BBolD7O9YMaUosu2DUm3qPJeQhzNWPOCReBDDA-IWAkW/exec';

// 為了向後相容，保留 GAS_URLS 結構（全部指向同一個 API）
const GAS_URLS = {
  TAO1: GAS_API_URL,
  TAO3: GAS_API_URL,
  TAO4: GAS_API_URL,
  TAO5: GAS_API_URL,
  TAO6: GAS_API_URL,
  TAO7: GAS_API_URL,
  TAO10: GAS_API_URL,
};

// 預設使用 TAO1
const DEFAULT_WAREHOUSE = 'TAO1';

/**
 * 取得倉庫的 GAS URL
 */
function getGasUrl(warehouse) {
  const wh = String(warehouse || '').trim().toUpperCase();
  return GAS_URLS[wh] || GAS_URLS[DEFAULT_WAREHOUSE] || '';
}

// 快取設定
const cache = {
  sheetId: new Map(),      // 倉庫 -> Sheet ID
  sheetNames: new Map(),   // 倉庫 -> 分頁名稱列表
  sheetData: new Map(),    // 倉庫|分頁|姓名 -> 資料
  verifyLogin: new Map(),  // 姓名|生日 -> 驗證結果
};

const CACHE_TTL = {
  sheetId: 10 * 60 * 1000,    // 10 分鐘
  sheetNames: 2 * 60 * 1000,  // 2 分鐘
  sheetData: 1 * 60 * 1000,   // 1 分鐘
};

const FETCH_TIMEOUT = 10000; // 10 秒超時
const BATCH_SIZE = 6; // 每批同時請求 6 個分頁

/**
 * 建立 API URL
 */
function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) {
      const v = String(value).trim();
      if (v) url.searchParams.set(key, v);
    }
  });
  return url.toString();
}

function decodeHexEscapes(input) {
  return String(input || '').replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractGasUserHtmlPayload(htmlText) {
  const m = String(htmlText || '').match(/goog\.script\.init\(\"([^\"]*)\"/);
  if (!m) return null;
  const decoded = decodeHexEscapes(m[1]);
  // 注意：decoded 並不一定是合法 JSON（內含大量轉義字元），不要直接 JSON.parse 整段。
  // 只抽出 userHtml 字串即可。
  const m2 = decoded.match(/\"userHtml\":(\"(?:\\\\.|[^\"\\\\])*\")/);
  if (!m2) return null;
  try {
    return JSON.parse(m2[1]);
  } catch {
    return null;
  }
}

/**
 * 發送 API 請求 (處理 GAS 的重定向和 CORS)
 * GAS Web App 需要使用 no-cors 模式或 JSONP
 */
async function fetchApi(url) {
  try {
    // 使用 fetch 並跟隨重定向（加入超時）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      mode: 'cors',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const text = await response.text();

    const json = tryParseJson(text);
    if (json != null) return json;

    if (text.includes('<!doctype html') || text.includes('<!DOCTYPE html') || text.includes('<html')) {
      const userHtml = extractGasUserHtmlPayload(text);
      if (userHtml && typeof userHtml === 'object') return userHtml;
      if (typeof userHtml === 'string') {
        const trimmed = userHtml.trim();
        const userJson = tryParseJson(trimmed);
        if (userJson != null) return userJson;
        throw new Error(trimmed || 'GAS 回傳 HTML，且無法解析資料');
      }
      throw new Error('GAS 回傳 HTML，且無法解析資料');
    }

    console.error('API 返回非 JSON 格式:', text.substring(0, 200));
    throw new Error('API 返回格式錯誤');
  } catch (error) {
    console.error('API 請求失敗:', error);
    throw error;
  }
}

/**
 * 取得所有可用的倉庫列表
 */
export function getAvailableWarehouses() {
  return Object.keys(GAS_URLS);
}

/**
 * 檢查 GAS URL 是否已設定
 */
export function isGasConfigured(warehouse) {
  return !!getGasUrl(warehouse);
}

/**
 * 驗證登入 (姓名 + 生日) - 在指定倉庫驗證
 * @param {string} name - 姓名
 * @param {string} birthday - 生日 (格式: MMDD 或 YYMMDD)
 * @param {string} warehouse - 倉庫代碼
 * @returns {Promise<Object>} 驗證結果
 */
export async function verifyLoginInWarehouse(name, birthday, warehouse) {
  const gasUrl = getGasUrl(warehouse);
  if (!gasUrl) {
    return { ok: false, error: `倉庫 ${warehouse} 尚未設定` };
  }

  const cacheKey = `${warehouse}|${name}|${birthday}`;
  const cached = cache.verifyLogin.get(cacheKey);
  if (cached) return { ...cached, warehouse };

  try {
    const url = buildUrl(gasUrl, {
      mode: 'verifyLogin',
      name: name,
      birthday: birthday,
      t: String(Date.now())
    });

    const result = await fetchApi(url);
    
    if (result) {
      cache.verifyLogin.set(cacheKey, result);
      return { ...result, warehouse };
    }
    
    return { ok: false, error: '驗證失敗', warehouse };
  } catch (error) {
    return { ok: false, error: error.message, warehouse };
  }
}

/**
 * 本地測試用戶資料（當 GAS API 無法連線時使用）
 * 生日格式：YYMMDD（6位數）
 */
const LOCAL_TEST_USERS = [
  { name: '酷澎', birthday: '0000', warehouse: 'TAO1', isAdmin: true },
  { name: '蔡博文', birthday: '640308', warehouse: 'TAO1', isAdmin: false },
  { name: '王鈴楓', birthday: '850918', warehouse: 'TAO1', isAdmin: false },
  { name: '陳振文', birthday: '741003', warehouse: 'TAO1', isAdmin: false },
  { name: '曾宥霖', birthday: '660615', warehouse: 'TAO1', isAdmin: false },
  { name: '吳尚容', birthday: '851129', warehouse: 'TAO1', isAdmin: false },
  { name: '黃麗梅', birthday: '571002', warehouse: 'TAO1', isAdmin: false },
  { name: '朱逸勛', birthday: '830527', warehouse: 'TAO1', isAdmin: false },
  { name: '高玉靜', birthday: '700729', warehouse: 'TAO1', isAdmin: false },
  { name: '陳芬妮', birthday: '650130', warehouse: 'TAO1', isAdmin: false },
  { name: '白麗秋', birthday: '631214', warehouse: 'TAO1', isAdmin: false },
  { name: '賴伊湘', birthday: '811120', warehouse: 'TAO1', isAdmin: false },
  { name: '潘品權', birthday: '780806', warehouse: 'TAO1', isAdmin: false },
  { name: '施宗佑', birthday: '810429', warehouse: 'TAO1', isAdmin: false },
  { name: '謝興武', birthday: '630924', warehouse: 'TAO1', isAdmin: false },
  { name: '陳采翎', birthday: '750816', warehouse: 'TAO1', isAdmin: false },
  { name: '邱鈺惠', birthday: '760913', warehouse: 'TAO1', isAdmin: false },
  { name: '郭淑美', birthday: '570503', warehouse: 'TAO1', isAdmin: false },
  { name: '余秋萍', birthday: '810125', warehouse: 'TAO1', isAdmin: false },
  { name: '費立萱', birthday: '780605', warehouse: 'TAO1', isAdmin: false },
  { name: '潘玉純', birthday: '890313', warehouse: 'TAO1', isAdmin: false },
  { name: '余品嫻', birthday: '880924', warehouse: 'TAO1', isAdmin: false },
  { name: '吳振豪', birthday: '790517', warehouse: 'TAO1', isAdmin: false },
  { name: '林昱宏', birthday: '820731', warehouse: 'TAO1', isAdmin: false },
  { name: '馬筱玲', birthday: '720407', warehouse: 'TAO1', isAdmin: false },
  { name: '陳玉梅', birthday: '660415', warehouse: 'TAO1', isAdmin: false },
];

/**
 * 本地驗證（備用方案）
 */
function localVerify(name, birthday) {
  const user = LOCAL_TEST_USERS.find(u => 
    u.name === name && u.birthday === birthday
  );
  
  if (user) {
    return {
      ok: true,
      name: user.name,
      warehouse: user.warehouse,
      warehouseKey: user.warehouse,
      isAdmin: user.isAdmin,
      msg: `本地驗證成功 (${user.warehouse})`
    };
  }
  
  return null;
}

/**
 * 自動辨識倉別並驗證登入
 * GAS API 會自動辨識所有倉別人員
 * @param {string} name - 姓名
 * @param {string} birthday - 生日
 * @param {boolean} isAdminSearch - 是否為管理員查詢模式（只用姓名查詢）
 * @returns {Promise<Object>} 驗證結果（包含 warehouse）
 */
export async function verifyLogin(name, birthday, isAdminSearch = false) {
  // 管理員查詢模式：只用姓名查詢，不需要生日
  if (isAdminSearch) {
    // 先嘗試本地查詢
    const localUser = LOCAL_TEST_USERS.find(u => u.name === name);
    if (localUser) {
      return {
        ok: true,
        name: localUser.name,
        warehouse: localUser.warehouse,
        warehouseKey: localUser.warehouse,
        isAdmin: true,
        msg: `管理員查詢成功 (${localUser.warehouse})`
      };
    }
    
    // 呼叫 GAS API 查詢（使用 findWarehouseByName 模式）
    try {
      const url = buildUrl(GAS_API_URL, {
        mode: 'findWarehouseByName',
        name: String(name || '').trim(),
        t: String(Date.now())
      });
      
      const result = await fetchApi(url);
      
      if (result && result.ok !== false) {
        const warehouse = String(result.warehouse || result.warehouseKey || result.wh || result.key || '').trim().toUpperCase();
        if (warehouse) {
          return {
            ok: true,
            name: result.name || name,
            warehouse: warehouse,
            warehouseKey: warehouse,
            isAdmin: true,
            msg: `管理員查詢成功 (${warehouse})`
          };
        }
      }
      
      return {
        ok: false,
        error: result?.error || result?.msg || '找不到此人員，請確認姓名'
      };
    } catch (error) {
      console.error('Admin search error:', error);
      return {
        ok: false,
        error: error.message || '查詢失敗，請稍後再試'
      };
    }
  }
  
  // 先嘗試本地驗證（測試用）
  const localResult = localVerify(name, birthday);
  if (localResult) {
    console.log('使用本地驗證:', localResult);
    return localResult;
  }
  
  try {
    // 直接呼叫 GAS API，讓它自動辨識倉別
    const url = buildUrl(GAS_API_URL, {
      mode: 'verifyLogin',
      name: String(name || '').trim(),
      birthday: String(birthday || '').trim(),
      t: String(Date.now())
    });
    
    const result = await fetchApi(url);
    
    // 如果驗證成功，API 會回傳倉別
    if (result && result.ok !== false && (result.name || result.ok === true)) {
      const warehouse = String(result.warehouse || result.warehouseKey || result.wh || '').trim().toUpperCase();
      return {
        ok: true,
        name: result.name || name,
        warehouse: warehouse,
        warehouseKey: warehouse,
        isAdmin: !!result.isAdmin,
        msg: result.msg || `已在 ${warehouse} 找到您的資料`
      };
    }
    
    // 驗證失敗
    return {
      ok: false,
      error: result?.error || result?.msg || '姓名或生日不正確，請確認後重試'
    };
  } catch (error) {
    console.error('verifyLogin error:', error);
    return {
      ok: false,
      error: error.message || '驗證失敗，請稍後再試'
    };
  }
}

/**
 * 根據姓名查找所屬倉庫
 * @param {string} name - 姓名
 * @returns {Promise<string>} 倉庫代碼
 */
export async function findWarehouseByName(name) {
  // 嘗試在所有倉庫中查找姓名
  const warehouses = getAvailableWarehouses();
  
  for (const warehouse of warehouses) {
    const gasUrl = getGasUrl(warehouse);
    if (!gasUrl) continue;
    
    try {
      const url = buildUrl(gasUrl, {
        mode: 'verifyLogin',
        name: name.trim(),
        birthday: '',  // 只驗證姓名存在
        t: String(Date.now())
      });
      
      const result = await fetchApi(url);
      if (result && result.ok !== false && result.name) {
        return warehouse;
      }
    } catch {
      // 繼續嘗試下一個倉庫
    }
  }
  
  throw new Error('找不到該姓名所屬的倉庫');
}

/**
 * 在指定倉庫中查找姓名
 */
export async function findNameInWarehouse(name, warehouse) {
  const gasUrl = getGasUrl(warehouse);
  if (!gasUrl) {
    throw new Error(`倉庫 ${warehouse} 尚未設定 GAS URL`);
  }

  const url = buildUrl(gasUrl, {
    mode: 'findWarehouseByName',
    name: name.trim(),
    t: String(Date.now())
  });

  const result = await fetchApi(url);
  
  if (!result || result.ok === false) {
    throw new Error(String(result?.error || result?.msg || '查詢失敗'));
  }

  const foundWarehouse = String(
    result.warehouseKey ?? result.warehouse ?? result.whKey ?? result.key ?? ''
  ).trim().toUpperCase();

  if (!foundWarehouse) {
    throw new Error(String(result?.error || result?.msg || '查詢失敗'));
  }

  return foundWarehouse;
}

/**
 * 取得倉庫的 Google Sheet ID
 * @param {string} warehouse - 倉庫代碼
 * @returns {Promise<string>} Sheet ID
 */
export async function getWarehouseSheetId(warehouse) {
  const gasUrl = getGasUrl(warehouse);
  if (!gasUrl) {
    throw new Error(`倉庫 ${warehouse} 尚未設定 GAS URL`);
  }

  const cacheKey = warehouse;
  const cached = cache.sheetId.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL.sheetId) {
    return cached.value;
  }

  const url = buildUrl(gasUrl, {
    mode: 'getWarehouseId',
    wh: warehouse,
    t: String(Date.now())
  });

  const result = await fetchApi(url);
  
  if (!result || result.ok === false) {
    throw new Error(result?.error || '取得試算表 ID 失敗');
  }

  cache.sheetId.set(cacheKey, { ts: Date.now(), value: result.spreadsheetId });
  return result.spreadsheetId;
}

/**
 * 取得倉庫的所有分頁名稱
 * @param {string} warehouse - 倉庫代碼
 * @returns {Promise<string[]>} 分頁名稱列表
 */
export async function getSheetNames(warehouse) {
  const gasUrl = getGasUrl(warehouse);
  if (!gasUrl) {
    throw new Error(`倉庫 ${warehouse} 尚未設定 GAS URL`);
  }

  const cacheKey = warehouse;
  const cached = cache.sheetNames.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL.sheetNames) {
    return cached.value;
  }

  const url = buildUrl(gasUrl, {
    mode: 'getSheets',
    wh: warehouse,
    t: String(Date.now())
  });

  const result = await fetchApi(url);

  if (result && typeof result === 'object' && !Array.isArray(result) && result.error) {
    throw new Error(result.error);
  }

  const sheetNames = Array.isArray(result)
    ? result
    : Array.isArray(result?.sheetNames)
      ? result.sheetNames
      : [];
  cache.sheetNames.set(cacheKey, { ts: Date.now(), value: sheetNames });
  return sheetNames;
}

/**
 * 讀取分頁資料
 * @param {string} warehouse - 倉庫代碼
 * @param {string} sheetName - 分頁名稱
 * @param {string} name - 姓名 (可選，用於過濾)
 * @param {Object} options - 選項
 * @returns {Promise<Object>} 分頁資料
 */
export async function getSheetData(warehouse, sheetName, name = '', options = {}) {
  const gasUrl = getGasUrl(warehouse);
  if (!gasUrl) {
    throw new Error(`倉庫 ${warehouse} 尚未設定 GAS URL`);
  }

  const cacheKey = `${warehouse}|${sheetName}|${(name || '').trim()}`;
  const noCache = !!options.noCache;
  
  if (!noCache) {
    const cached = cache.sheetData.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL.sheetData) {
      return cached.value;
    }
  }

  const url = buildUrl(gasUrl, {
    mode: 'api',
    wh: warehouse,
    sheet: sheetName,
    name: (name || '').trim(),
    birthday: (options?.birthday || '').trim(),
    t: String(Date.now())
  });

  const result = await fetchApi(url);
  
  if (result.error) {
    throw new Error(String(result.error));
  }

  if (!noCache) {
    cache.sheetData.set(cacheKey, { ts: Date.now(), value: result });
  }
  
  return result;
}

/**
 * 批量讀取多個分頁資料（一次請求）
 * @param {string} warehouse - 倉庫代碼
 * @param {string[]} sheetNames - 分頁名稱列表
 * @param {Object} options - 選項
 * @returns {Promise<Object>} 分頁資料 Map
 */
export async function getBatchSheetData(warehouse, sheetNames, options = {}) {
  const gasUrl = getGasUrl(warehouse);
  if (!gasUrl) {
    throw new Error(`倉庫 ${warehouse} 尚未設定 GAS URL`);
  }

  const userName = (options?.name || '').trim();

  // 檢查快取，過濾出需要請求的分頁
  const results = {};
  const sheetsToFetch = [];
  
  for (const sheetName of sheetNames) {
    const cacheKey = `${warehouse}|${sheetName}|${userName}`;
    const cached = cache.sheetData.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL.sheetData) {
      results[sheetName] = cached.value;
    } else {
      sheetsToFetch.push(sheetName);
    }
  }

  // 如果所有分頁都有快取，直接返回
  if (sheetsToFetch.length === 0) {
    return results;
  }

  // 分批並行請求（每批 BATCH_SIZE 個，避免 GAS 過載）
  const fetchOne = async (sheetName) => {
    try {
      const url = buildUrl(gasUrl, {
        mode: 'api',
        wh: warehouse,
        sheet: sheetName,
        name: userName,
        birthday: (options?.birthday || '').trim(),
        t: String(Date.now())
      });
      const result = await fetchApi(url);
      if (!result.error) {
        const cacheKey = `${warehouse}|${sheetName}|${userName}`;
        cache.sheetData.set(cacheKey, { ts: Date.now(), value: result });
      }
      return { sheetName, result, error: result.error || null };
    } catch (e) {
      return { sheetName, result: null, error: e.message };
    }
  };

  const fetchResults = [];
  for (let i = 0; i < sheetsToFetch.length; i += BATCH_SIZE) {
    const batch = sheetsToFetch.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(fetchOne));
    fetchResults.push(...batchResults);
  }
  
  for (const { sheetName, result, error } of fetchResults) {
    if (!error && result) {
      results[sheetName] = result;
    }
  }

  return results;
}

/**
 * 解析分頁資料為標準格式
 * @param {Object} rawData - 原始 API 回傳資料
 * @param {Object} options - 選項
 * @returns {Object} 標準化資料
 */
export function parseSheetData(rawData, options = {}) {
  const headers = (rawData.headers ?? []).map(h => String(h ?? ''));
  
  // 找出姓名欄位索引
  const nameColIndex = findNameColumnIndex(headers);
  
  // 清理空白行
  function isEmptyRow(row) {
    const values = row?.v || [];
    for (let i = 0; i < headers.length; i++) {
      if (cleanText(values[i])) return false;
    }
    return true;
  }
  
  const rows = (rawData.rows ?? [])
    .filter(row => !isEmptyRow(row))
    .map((row, idx) => {
      const rowData = { id: `row_${idx}` };
      
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i] || `col_${i + 1}`;
        rowData[header] = row.v?.[i] ?? '';
      }
      
      // 背景色和文字色
      if (Array.isArray(row.bg)) rowData._bg = row.bg;
      if (Array.isArray(row.fc)) rowData._fc = row.fc;
      if (Array.isArray(row.att)) rowData._att = row.att;
      
      // 確保姓名欄位
      if (nameColIndex >= 0) {
        rowData.姓名 = row.v?.[nameColIndex] ?? rowData.姓名;
      }
      
      return rowData;
    });

  return {
    headers,
    rows,
    dateCols: rawData.dateCols || [],
    headersISO: rawData.headersISO || [],
    frozenLeft: rawData.frozenLeft || 0
  };
}

/**
 * 找出姓名欄位索引
 */
function findNameColumnIndex(headers) {
  const nameKeywords = ['姓名', 'Name', 'name', '員工姓名', '中文姓名'];
  
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? '').trim();
    if (h && nameKeywords.includes(h)) return i;
  }
  
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? '').trim();
    if (h && (h.includes('姓名') || /^name$/i.test(h))) return i;
  }
  
  return -1;
}

/**
 * 清理文字
 */
function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u00A0\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, '')
    .trim();
}

export function normalizeName(value) {
  return cleanText(value);
}

/**
 * 清除所有快取（用於強制重新載入最新資料）
 */
export function clearAllCache() {
  cache.sheetId.clear();
  cache.sheetNames.clear();
  cache.sheetData.clear();
  cache.verifyLogin.clear();
  console.log('[快取] 已清除所有快取');
}

/**
 * 從資料列中取得姓名
 */
export function getRowName(row) {
  const candidates = [
    row.name, row.姓名, row.員工姓名, row.中文姓名,
    row['姓名(中文)'], row['姓名 ']
  ];
  
  for (const c of candidates) {
    const name = String(c ?? '').trim();
    if (name) return name;
  }
  
  for (const [key, value] of Object.entries(row)) {
    if (!key || !String(key).includes('姓名')) continue;
    const name = String(value ?? '').trim();
    if (name) return name;
  }
  
  return '';
}

/**
 * 根據分頁名稱判斷分頁類型
 */
export function getSheetType(sheetName) {
  const name = String(sheetName || '').toLowerCase();
  
  if (name.includes('班表') || name.includes('排班')) return 'schedule';
  if (name.includes('出勤時數') || name.includes('工時')) return 'attendance';
  if (name.includes('出勤記錄') || name.includes('出勤紀律')) return 'records';
  if (name.includes('生日') || name.includes('人員')) return 'employees';
  if (name.includes('調假')) return 'adjustment';
  
  return 'unknown';
}

/**
 * 自動選擇預設分頁
 */
export function getDefaultSheet(warehouse, sheetNames) {
  const wh = String(warehouse || '').trim().toUpperCase();
  const sheets = Array.isArray(sheetNames) ? sheetNames : [];
  
  const find = (predicate) => sheets.find(s => predicate(String(s || '').trim())) || '';
  
  // TAO1 優先使用班表或出勤紀律
  if (wh === 'TAO1' || wh === 'TA01') {
    return find(s => s.includes('班表')) ||
           find(s => s.includes('出勤紀律')) ||
           find(s => s.includes('出勤記錄')) ||
           find(s => s.includes('出勤')) ||
           sheets[0] || '';
  }
  
  // 其他倉庫
  return find(s => s.includes('班表')) ||
         find(s => s.includes('出勤記錄')) ||
         find(s => s.includes('出勤')) ||
         sheets[0] || '';
}

export default {
  getAvailableWarehouses,
  isGasConfigured,
  verifyLogin,
  findWarehouseByName,
  findNameInWarehouse,
  getWarehouseSheetId,
  getSheetNames,
  getSheetData,
  getBatchSheetData,
  parseSheetData,
  getRowName,
  getSheetType,
  getDefaultSheet,
  clearAllCache
};
