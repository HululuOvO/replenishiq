(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ReplenishmentCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const WARNING_DAYS = 21;
  const SAFETY_COVER_DAYS = 14;
  const NO_STOCKOUT_BUFFER_DAYS = 7;
  const INCLUDE_COVER_END_DATE = true;

  function parseISODate(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return Math.floor(date.getTime() / DAY_MS);
  }

  function formatDay(dayNumber) {
    if (!Number.isFinite(dayNumber)) return null;
    return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
  }

  function addDays(dayNumber, days) {
    return dayNumber + days;
  }

  function diffDays(laterDay, earlierDay) {
    return laterDay - earlierDay;
  }

  function isMonday(dayNumber) {
    return new Date(dayNumber * DAY_MS).getUTCDay() === 1;
  }

  function endOfWeekSunday(dayNumber) {
    const jsDay = new Date(dayNumber * DAY_MS).getUTCDay();
    const daysSinceMonday = (jsDay + 6) % 7;
    return dayNumber - daysSinceMonday + 6;
  }

  function normalizeSku(value) {
    return String(value || '').trim().toUpperCase();
  }

  function toFiniteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value == null ? '' : value).trim().replace(/,/g, '');
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function requireInteger(value, label, minimum) {
    const number = toFiniteNumber(value);
    if (!Number.isInteger(number) || number < minimum) {
      throw new Error(label + '必须是大于或等于' + minimum + '的整数');
    }
    return number;
  }

  function normalizeRecords(rawRecords, expectedSku) {
    if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
      throw new Error('SKU没有可用的预测数据');
    }

    const sku = normalizeSku(expectedSku);
    const records = rawRecords.map(function (record, index) {
      const day = parseISODate(record.date);
      const controlSales = toFiniteNumber(record.controlSales);
      const controlStock = toFiniteNumber(record.controlStock);
      if (day === null) {
        throw new Error('第' + (index + 2) + '行日期无效，应使用yyyy-mm-dd');
      }
      if (controlSales === null || controlSales < 0) {
        throw new Error('第' + (index + 2) + '行控制销量无效或小于0');
      }
      if (controlStock === null) {
        throw new Error('第' + (index + 2) + '行控制库存不是有效数字');
      }
      return {
        sku: sku,
        day: day,
        date: formatDay(day),
        controlSales: controlSales,
        controlStock: controlStock
      };
    }).sort(function (a, b) {
      return a.day - b.day;
    });

    for (let i = 1; i < records.length; i += 1) {
      const gap = records[i].day - records[i - 1].day;
      if (gap === 0) {
        throw new Error('SKU存在重复日期：' + records[i].date);
      }
      if (gap !== 1) {
        throw new Error(
          'SKU日期不连续：' + records[i - 1].date +
          '之后直接跳到' + records[i].date
        );
      }
    }
    return records;
  }

  function findNextStockoutCycle(futureRecords) {
    const first = futureRecords[0];
    let recoveryRecord = null;
    let searchStartIndex = 1;

    if (first.controlStock <= 0) {
      searchStartIndex = futureRecords.length;
      for (let i = 1; i < futureRecords.length; i += 1) {
        if (futureRecords[i].controlStock > 0) {
          recoveryRecord = futureRecords[i];
          searchStartIndex = i + 1;
          break;
        }
      }
      if (!recoveryRecord) {
        return {
          recoveryRecord: null,
          stockoutRecord: null,
          persistentShortage: true
        };
      }
    }

    for (let i = searchStartIndex; i < futureRecords.length; i += 1) {
      if (futureRecords[i].controlStock <= 0) {
        return {
          recoveryRecord: recoveryRecord,
          stockoutRecord: futureRecords[i],
          persistentShortage: false
        };
      }
    }

    return {
      recoveryRecord: recoveryRecord,
      stockoutRecord: null,
      persistentShortage: false
    };
  }

  function averageControlSales(records, startDay, endDay, coverDays) {
    const values = records.filter(function (record) {
      return INCLUDE_COVER_END_DATE
        ? record.day >= startDay && record.day <= endDay
        : record.day >= startDay && record.day < endDay;
    });
    const expected = INCLUDE_COVER_END_DATE ? coverDays + 1 : coverDays;
    if (values.length !== expected) {
      throw new Error(
        '平均控制日销区间数据不足：应有' + expected +
        '天，实际只有' + values.length + '天'
      );
    }
    const total = values.reduce(function (sum, record) {
      return sum + record.controlSales;
    }, 0);
    return { average: total / values.length, count: values.length };
  }

  function roundUpToCasePack(quantity, casePack) {
    return Math.ceil(quantity / casePack) * casePack;
  }

  function baseResult(eta) {
    return {
      eta: formatDay(eta),
      stockoutDate: null,
      warningDate: null,
      warningWeekSunday: null,
      needOrder: null,
      coverDays: null,
      avgSales: null,
      quantity: null,
      coverEndDate: null,
      averageCount: null,
      statusCode: 'pending',
      status: ''
    };
  }

  function calculate(settings, rawRecords) {
    const weekMonday = parseISODate(settings.weekMonday);
    if (weekMonday === null) {
      throw new Error('判断周不是有效日期');
    }
    if (!isMonday(weekMonday)) {
      throw new Error('判断周必须填写星期一日期');
    }

    const sku = normalizeSku(settings.sku);
    if (!sku) throw new Error('请选择或输入SKU');
    const productLt = requireInteger(settings.productLt, '交期', 0);
    const logisticsLt = requireInteger(settings.logisticsLt, '入库上架天数', 1);
    const casePack = requireInteger(settings.casePack, '箱规', 1);
    const records = normalizeRecords(rawRecords, sku);
    const eta = addDays(weekMonday, productLt + logisticsLt);
    const result = baseResult(eta);

    const startIndex = records.findIndex(function (record) {
      return record.day === weekMonday;
    });
    if (startIndex < 0) {
      const first = records[0].date;
      const last = records[records.length - 1].date;
      throw new Error(
        'SKU预测中缺少判断周周一' + formatDay(weekMonday) +
        '；当前数据范围为' + first + '至' + last
      );
    }

    const futureRecords = records.slice(startIndex);
    const cycle = findNextStockoutCycle(futureRecords);

    if (cycle.persistentShortage) {
      result.stockoutDate = formatDay(weekMonday);
      result.needOrder = true;
      result.statusCode = 'persistent-shortage';
      result.status = '判断周库存已小于或等于0，且预测范围内没有未来入库使库存恢复；标准补货公式停止，请人工确认紧急补货。';
      return result;
    }

    if (!cycle.stockoutRecord) {
      const lastForecastDay = futureRecords[futureRecords.length - 1].day;
      const requiredForecastEnd = addDays(
        eta,
        WARNING_DAYS + NO_STOCKOUT_BUFFER_DAYS
      );
      const prefix = cycle.recoveryRecord
        ? '已识别到' + cycle.recoveryRecord.date + '库存恢复，恢复后暂未再次断货。'
        : '当前预测范围内控制库存未降至0。';

      if (lastForecastDay < requiredForecastEnd) {
        result.statusCode = 'insufficient-horizon';
        result.status = prefix + '预测只到' + formatDay(lastForecastDay) +
          '，至少需要延伸到' + formatDay(requiredForecastEnd) + '才能安全判断。';
        return result;
      }

      result.needOrder = false;
      result.statusCode = 'no-stockout';
      result.status = prefix + '预测已覆盖到' + formatDay(lastForecastDay) +
        '，范围足以确认本周无需下单。';
      return result;
    }

    const stockoutDay = cycle.stockoutRecord.day;
    const warningDay = addDays(stockoutDay, -WARNING_DAYS);
    result.stockoutDate = formatDay(stockoutDay);

    if (warningDay < weekMonday) {
      result.needOrder = true;
      result.statusCode = 'overdue';
      result.status = '断货预警窗口已经错过，标准补货公式不再适用；请人工确认紧急补货数量。';
      return result;
    }

    const warningSunday = endOfWeekSunday(warningDay);
    const needOrder = eta >= warningSunday;
    result.warningDate = formatDay(warningDay);
    result.warningWeekSunday = formatDay(warningSunday);
    result.needOrder = needOrder;

    const recoveryPrefix = cycle.recoveryRecord
      ? '判断周库存已缺货，但' + cycle.recoveryRecord.date +
        '因未来入库恢复；本次按恢复后的下一轮库存周期判断。'
      : '';

    if (!needOrder) {
      result.statusCode = 'not-needed';
      result.status = recoveryPrefix + '预计入库日早于断货预警周周日，本周无需下单。';
      return result;
    }

    const coverDays = diffDays(eta, warningDay) + SAFETY_COVER_DAYS;
    if (!Number.isFinite(coverDays) || coverDays <= 0) {
      throw new Error('补货天数计算异常：' + coverDays);
    }
    const coverEndDay = addDays(stockoutDay, coverDays);
    const salesResult = averageControlSales(
      records,
      stockoutDay,
      coverEndDay,
      coverDays
    );
    const rawQuantity = coverDays * salesResult.average;

    result.coverDays = coverDays;
    result.avgSales = salesResult.average;
    result.quantity = roundUpToCasePack(rawQuantity, casePack);
    result.coverEndDate = formatDay(coverEndDay);
    result.averageCount = salesResult.count;
    result.statusCode = 'order';
    result.status = recoveryPrefix + '需要下单；平均日销使用' +
      salesResult.count + '个连续日期，原始需求' +
      rawQuantity.toFixed(2) + '件，已按' + casePack + '件/箱向上取整。';
    return result;
  }

  function dayOfYear(dayNumber) {
    const date = new Date(dayNumber * DAY_MS);
    const start = Date.UTC(date.getUTCFullYear(), 0, 1) / DAY_MS;
    return dayNumber - start + 1;
  }

  function buildReceiptMap(entries) {
    const map = new Map();
    entries.forEach(function (entry) {
      map.set(parseISODate(entry[0]), entry[1]);
    });
    return map;
  }

  function generateSkuRecords(config) {
    const start = parseISODate('2026-01-01');
    const end = parseISODate('2030-12-31');
    const receipts = buildReceiptMap(config.receipts);
    const records = [];
    let stock = config.initialStock;

    for (let day = start; day <= end; day += 1) {
      const date = new Date(day * DAY_MS);
      const doy = dayOfYear(day);
      const seasonal = config.amplitude * Math.sin((2 * Math.PI * doy) / 365.25);
      const weekdayBoost = [0, 3, 2, 1, 0, 4, -2][date.getUTCDay()];
      const sales = Math.max(1, Math.round(config.baseSales + seasonal + weekdayBoost));
      stock += receipts.get(day) || 0;
      stock -= sales;
      records.push({
        sku: config.sku,
        date: formatDay(day),
        controlSales: sales,
        controlStock: stock
      });
    }
    return records;
  }

  function recurringReceipts(monthDays, amount) {
    const result = [];
    for (let year = 2026; year <= 2030; year += 1) {
      monthDays.forEach(function (monthDay) {
        result.push([year + '-' + monthDay, amount]);
      });
    }
    return result;
  }

  function createDemoDataset() {
    const configs = [
      {
        sku: 'DEMO-FAST',
        label: '高周转产品',
        baseSales: 48,
        amplitude: 7,
        initialStock: 8000,
        receipts: recurringReceipts(['06-01', '11-15'], 6200)
      },
      {
        sku: 'DEMO-LONG',
        label: '长库存产品',
        baseSales: 18,
        amplitude: 4,
        initialStock: 30000,
        receipts: recurringReceipts(['03-01'], 7000)
      },
      {
        sku: 'DEMO-RECOVERY',
        label: '缺货后恢复产品',
        baseSales: 28,
        amplitude: 5,
        initialStock: 2400,
        receipts: [
          ['2026-08-01', 12000],
          ['2027-09-01', 12000],
          ['2028-10-01', 12000],
          ['2029-11-01', 12000]
        ]
      }
    ];
    const data = new Map();
    configs.forEach(function (config) {
      data.set(config.sku, {
        label: config.label,
        source: 'demo',
        records: generateSkuRecords(config)
      });
    });
    return data;
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const content = String(text || '').replace(/^\uFEFF/, '');

    for (let i = 0; i < content.length; i += 1) {
      const char = content[i];
      const next = content[i + 1];
      if (char === '"' && quoted && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        row.push(field);
        field = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(field);
        if (row.some(function (value) { return value.trim() !== ''; })) rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }
    if (field !== '' || row.length > 0) {
      row.push(field);
      if (row.some(function (value) { return value.trim() !== ''; })) rows.push(row);
    }
    if (quoted) throw new Error('CSV存在未闭合的双引号');
    return rows;
  }

  function normalizeHeader(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s_-]/g, '');
  }

  function findHeaderIndex(headers, aliases) {
    const normalizedAliases = aliases.map(normalizeHeader);
    return headers.findIndex(function (header) {
      return normalizedAliases.includes(normalizeHeader(header));
    });
  }

  function parseCsvDataset(text) {
    const rows = parseCsvRows(text);
    if (rows.length < 2) throw new Error('CSV至少需要表头和一行数据');
    const headers = rows[0];
    const dateCol = findHeaderIndex(headers, ['date', '日期']);
    const skuCol = findHeaderIndex(headers, ['sku', '识别SKU']);
    const salesCol = findHeaderIndex(headers, ['control_sales', 'controlSales', '控制销量']);
    const stockCol = findHeaderIndex(headers, ['control_inventory', 'controlStock', '控制库存']);
    if ([dateCol, skuCol, salesCol, stockCol].some(function (index) { return index < 0; })) {
      throw new Error('CSV必须包含日期、SKU、控制销量和控制库存四个字段');
    }

    const grouped = new Map();
    rows.slice(1).forEach(function (row, index) {
      const sku = normalizeSku(row[skuCol]);
      if (!sku) throw new Error('CSV第' + (index + 2) + '行SKU为空');
      if (!grouped.has(sku)) grouped.set(sku, []);
      grouped.get(sku).push({
        date: String(row[dateCol] || '').trim(),
        sku: sku,
        controlSales: row[salesCol],
        controlStock: row[stockCol]
      });
    });

    const result = new Map();
    grouped.forEach(function (records, sku) {
      const normalized = normalizeRecords(records, sku).map(function (record) {
        return {
          sku: sku,
          date: record.date,
          controlSales: record.controlSales,
          controlStock: record.controlStock
        };
      });
      result.set(sku, { label: 'CSV导入', source: 'csv', records: normalized });
    });
    return result;
  }

  function createCsvTemplate() {
    const start = parseISODate('2026-07-13');
    const lines = ['date,sku,control_sales,control_inventory'];
    let stock = 2400;
    for (let offset = 0; offset < 120; offset += 1) {
      const sales = 30 + (offset % 7);
      stock -= sales;
      lines.push([
        formatDay(start + offset),
        'NEW-SKU',
        sales,
        stock
      ].join(','));
    }
    return lines.join('\n');
  }

  return {
    constants: {
      WARNING_DAYS: WARNING_DAYS,
      SAFETY_COVER_DAYS: SAFETY_COVER_DAYS,
      INCLUDE_COVER_END_DATE: INCLUDE_COVER_END_DATE
    },
    calculate: calculate,
    createDemoDataset: createDemoDataset,
    parseCsvDataset: parseCsvDataset,
    createCsvTemplate: createCsvTemplate,
    normalizeRecords: normalizeRecords,
    parseISODate: parseISODate,
    formatDay: formatDay,
    isMonday: isMonday,
    endOfWeekSunday: endOfWeekSunday,
    roundUpToCasePack: roundUpToCasePack
  };
});
