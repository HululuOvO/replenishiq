/**
 * Google Sheets 补货自动计算工具
 *
 * 适配当前工作簿结构：
 * - 汇总页：每周判断快速下单
 * - 汇总页手填：A周一日期、B SKU、C交期、D截单到入库上架天数、L箱规
 * - 汇总页自动输出：E-K、M-P；F断货预警天数固定为21
 * - 审核辅助输出：M-P
 * - SKU明细页：按表头识别日期、控制销量、控制库存
 * - 新SKU：只要新增同名产品页并符合表头结构，即可直接在B列使用
 *
 * 使用前请先确认 CONFIG 中的工作表名称、列号和业务参数。
 */

const CONFIG = Object.freeze({
  SUMMARY_SHEET: '每周判断快速下单',
  HEADER_ROW: 1,
  DATA_START_ROW: 2,
  WARNING_DAYS_FIXED: 21,

  // Mentor规则：补货天数 = 预计入库日 - 断货前X天日期 + 14。
  SAFETY_COVER_DAYS: 14,

  // true：控制日销平均值包含结束日期F，即 S <= 日期 <= F。
  // false：严格取C个日期，即 S <= 日期 < F。
  // 这一项存在一天边界差异，请和mentor确认后再决定是否改成false。
  INCLUDE_COVER_END_DATE_IN_AVERAGE: true,

  SUMMARY_COL: Object.freeze({
    WEEK_MONDAY: 1,       // A 周数/本周周一（手填）
    SKU: 2,               // B SKU（手填，需与SKU工作表名一致）
    PRODUCT_LT: 3,        // C 交期（手填）
    LOGISTICS_LT: 4,      // D 截单到入库上架天数（手填）
    ETA: 5,               // E 预计入库时间（脚本输出）
    WARNING_DAYS: 6,      // F 断货前21天（固定自动）
    WARNING_DATE: 7,      // G 断货前X天日期B（脚本输出）
    NEED_ORDER: 8,        // H 本周是否需要下单（是/否，脚本输出）
    COVER_DAYS: 9,        // I 补货天数C（脚本输出）
    AVG_CONTROL_SALES: 10,// J 平均控制日销D（脚本输出）
    REPLENISH_QTY: 11,    // K 补货数量E（脚本输出）
    CASE_PACK: 12,        // L 箱规（手填）
    STOCKOUT_DATE: 13,    // M 预计断货日期S（审核辅助）
    COVER_END_DATE: 14,   // N 覆盖结束日期F（审核辅助）
    STATUS: 15,           // O 处理状态/错误原因（审核辅助）
    UPDATED_AT: 16        // P 最后计算时间（审核辅助）
  })
});

/** 增加“补货工具”菜单。使用独立函数名，避免和原工作簿的onOpen冲突。 */
function showReplenishmentMenu() {
  SpreadsheetApp.getUi()
    .createMenu('补货工具')
    .addItem('初始化/更新补货工具', 'setupReplenishmentTool')
    .addSeparator()
    .addItem('计算当前选中行', 'calculateSelectedRow')
    .addItem('批量计算全部SKU', 'calculateAllRows')
    .addSeparator()
    .addItem('安装每周一自动计算', 'installMondayTrigger')
    .addItem('删除每周自动计算', 'deleteMondayTriggers')
    .addToUi();
}

/**
 * 首次只需运行一次：
 * 1. 更新汇总表头；2. 安装打开菜单和编辑后自动计算触发器。
 */
function setupReplenishmentTool() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summary = ss.getSheetByName(CONFIG.SUMMARY_SHEET);
  if (!summary) {
    throw new Error('找不到汇总工作表：' + CONFIG.SUMMARY_SHEET);
  }
  ensureSummaryHeaders_(summary);

  deleteTriggersByHandler_('showReplenishmentMenu');
  deleteTriggersByHandler_('handleReplenishmentEdit');
  ScriptApp.newTrigger('showReplenishmentMenu')
    .forSpreadsheet(ss)
    .onOpen()
    .create();
  ScriptApp.newTrigger('handleReplenishmentEdit')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  showReplenishmentMenu();
  SpreadsheetApp.getUi().alert(
    '初始化完成。以后在“' + CONFIG.SUMMARY_SHEET +
    '”填写A周一日期、B SKU、C交期、D截单到入库上架天数、L箱规，脚本会自动计算其余内容。'
  );
}

/** A-D或L列被人工编辑后，自动计算对应行。 */
function handleReplenishmentEdit(event) {
  if (!event || !event.range) {
    return;
  }
  const range = event.range;
  const sheet = range.getSheet();
  if (sheet.getName() !== CONFIG.SUMMARY_SHEET) {
    return;
  }
  if (range.getLastRow() < CONFIG.DATA_START_ROW) {
    return;
  }

  const firstCol = range.getColumn();
  const lastCol = range.getLastColumn();
  const touchesMainInputs = firstCol <= CONFIG.SUMMARY_COL.LOGISTICS_LT &&
    lastCol >= CONFIG.SUMMARY_COL.WEEK_MONDAY;
  const touchesCasePack = firstCol <= CONFIG.SUMMARY_COL.CASE_PACK &&
    lastCol >= CONFIG.SUMMARY_COL.CASE_PACK;
  if (!touchesMainInputs && !touchesCasePack) {
    return;
  }

  const startRow = Math.max(range.getRow(), CONFIG.DATA_START_ROW);
  const numRows = range.getLastRow() - startRow + 1;
  calculateRows_(startRow, numRows);
}

/** 只计算当前选中的一行，适合先测试。 */
function calculateSelectedRow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (sheet.getName() !== CONFIG.SUMMARY_SHEET) {
    SpreadsheetApp.getUi().alert(
      '请先进入“' + CONFIG.SUMMARY_SHEET + '”工作表，再选择需要计算的行。'
    );
    return;
  }

  if (row < CONFIG.DATA_START_ROW) {
    SpreadsheetApp.getUi().alert('请选择第2行或之后的数据行。');
    return;
  }

  const stats = calculateRows_(row, 1);
  ss.toast(buildResultMessage_(stats), '补货工具', 8);
}

/** 批量计算汇总页所有有数据的行。可由菜单或定时触发器调用。 */
function calculateAllRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SUMMARY_SHEET);
  if (!sheet) {
    throw new Error('找不到汇总工作表：' + CONFIG.SUMMARY_SHEET);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) {
    return;
  }

  const stats = calculateRows_(
    CONFIG.DATA_START_ROW,
    lastRow - CONFIG.DATA_START_ROW + 1
  );

  // 手动运行时可以看到提示；定时触发时这行不会影响计算结果。
  try {
    ss.toast(buildResultMessage_(stats), '补货工具', 10);
  } catch (error) {
    console.log(buildResultMessage_(stats));
  }
}

/**
 * 核心批量计算函数。
 * 一次读取、一次批量写入，避免逐个单元格反复访问造成运行缓慢。
 */
function calculateRows_(startRow, numRows) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('当前已有补货计算正在运行，请稍后重试。');
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const summary = ss.getSheetByName(CONFIG.SUMMARY_SHEET);
    if (!summary) {
      throw new Error('找不到汇总工作表：' + CONFIG.SUMMARY_SHEET);
    }

    ensureSummaryHeaders_(summary);

    const input = summary
      .getRange(startRow, 1, numRows, CONFIG.SUMMARY_COL.CASE_PACK)
      .getValues();

    const sheetMap = buildSheetNameMap_(ss);
    const skuDataCache = new Map();

    const etaOutput = [];
    const warningDaysOutput = [];
    const decisionOutput = [];
    const auditOutput = [];

    const stats = { total: 0, success: 0, skipped: 0, error: 0 };

    input.forEach(function(row) {
      const skuText = String(row[CONFIG.SUMMARY_COL.SKU - 1] || '').trim();
      const weekValue = row[CONFIG.SUMMARY_COL.WEEK_MONDAY - 1];
      const productLtValue = row[CONFIG.SUMMARY_COL.PRODUCT_LT - 1];
      const logisticsLtValue = row[CONFIG.SUMMARY_COL.LOGISTICS_LT - 1];
      const casePackValue = row[CONFIG.SUMMARY_COL.CASE_PACK - 1];
      const manualInputs = [
        weekValue,
        skuText,
        productLtValue,
        logisticsLtValue,
        casePackValue
      ];

      // 完全空白行不算错误，也不留下旧结果。
      if (manualInputs.every(isBlankValue_)) {
        etaOutput.push(['']);
        warningDaysOutput.push(['']);
        decisionOutput.push(['', '', '', '', '']);
        auditOutput.push(['', '', '', '']);
        stats.skipped += 1;
        return;
      }

      // 五项手填内容齐全前只提示等待，不把未完成输入算成错误。
      const missingInputs = [];
      if (isBlankValue_(weekValue)) missingInputs.push('周一日期');
      if (isBlankValue_(skuText)) missingInputs.push('SKU');
      if (isBlankValue_(productLtValue)) missingInputs.push('交期');
      if (isBlankValue_(logisticsLtValue)) missingInputs.push('截单到入库上架天数');
      if (isBlankValue_(casePackValue)) missingInputs.push('箱规');
      if (missingInputs.length > 0) {
        etaOutput.push(['']);
        warningDaysOutput.push(['']);
        decisionOutput.push(['', '', '', '', '']);
        auditOutput.push([
          '',
          '',
          '等待输入：' + missingInputs.join('、'),
          new Date()
        ]);
        stats.skipped += 1;
        return;
      }

      stats.total += 1;
      let settings = null;

      try {
        settings = resolveRowSettings_(ss, row, sheetMap);
        const result = calculateOneRow_(
          settings,
          sheetMap,
          skuDataCache
        );

        etaOutput.push([result.eta || '']);
        warningDaysOutput.push([CONFIG.WARNING_DAYS_FIXED]);
        decisionOutput.push([
          result.warningDate || '',
          result.needOrder === 1 ? '是' :
            (result.needOrder === 0 ? '否' : ''),
          result.coverDays === null ? '' : result.coverDays,
          result.avgSales === null ? '' : result.avgSales,
          result.quantity === null ? '' : result.quantity
        ]);
        auditOutput.push([
          result.stockoutDate || '',
          result.coverEndDate || '',
          result.status,
          new Date()
        ]);
        stats.success += 1;
      } catch (error) {
        etaOutput.push(['']);
        warningDaysOutput.push([CONFIG.WARNING_DAYS_FIXED]);
        decisionOutput.push(['', '', '', '', '']);
        auditOutput.push(['', '', '错误：' + error.message, new Date()]);
        stats.error += 1;
      }
    });

    // E列：预计入库日期。
    summary
      .getRange(startRow, CONFIG.SUMMARY_COL.ETA, numRows, 1)
      .setValues(etaOutput);

    // F列：预警天数。
    summary
      .getRange(startRow, CONFIG.SUMMARY_COL.WARNING_DAYS, numRows, 1)
      .setValues(warningDaysOutput);

    // G-K列：预警日期、是否下单、补货天数、平均日销、补货数量。
    summary
      .getRange(startRow, CONFIG.SUMMARY_COL.WARNING_DATE, numRows, 5)
      .setValues(decisionOutput);

    // M-P列：让计算过程可检查、可追踪。
    summary
      .getRange(startRow, CONFIG.SUMMARY_COL.STOCKOUT_DATE, numRows, 4)
      .setValues(auditOutput);

    applyOutputFormats_(summary, startRow, numRows);
    SpreadsheetApp.flush();
    return stats;
  } finally {
    lock.releaseLock();
  }
}

/** 从快速判断表的手填列解析一行计算所需参数。 */
function resolveRowSettings_(ss, row, sheetMap) {
  const c = CONFIG.SUMMARY_COL;
  const spreadsheetTimezone = ss.getSpreadsheetTimeZone();
  const weekMonday = parseSheetDate_(
    row[c.WEEK_MONDAY - 1],
    '本周周一',
    spreadsheetTimezone
  );
  if (weekMonday.getDay() !== 1) {
    throw new Error('周数必须填写星期一日期');
  }
  const currentMonday = getCurrentWeekMonday_(ss);
  if (dayNumber_(weekMonday) < dayNumber_(currentMonday)) {
    throw new Error('周数早于当前周，禁止使用历史周数据');
  }
  const sku = String(row[c.SKU - 1] || '').trim();
  if (!sku) {
    throw new Error('SKU为空');
  }

  const skuSheet = findSkuSheet_(sku, sheetMap);
  if (!skuSheet || !isSkuDataSheet_(skuSheet)) {
    throw new Error(
      '找不到结构正确的SKU工作表：' + sku +
      '。产品页必须包含“识别SKU”“控制销量”“控制库存”，且识别SKU要与工作表名一致'
    );
  }

  const productLt = requireNonnegativeInteger_(
    row[c.PRODUCT_LT - 1],
    '交期'
  );
  const logisticsLt = requirePositiveInteger_(
    row[c.LOGISTICS_LT - 1],
    '截单到入库上架天数'
  );
  const casePack = requirePositiveInteger_(
    row[c.CASE_PACK - 1],
    '箱规'
  );

  return {
    weekMonday: weekMonday,
    sku: sku,
    productLt: productLt,
    logisticsLt: logisticsLt,
    warningDays: CONFIG.WARNING_DAYS_FIXED,
    casePack: casePack,
    logisticsSource: '快速判断表手填'
  };
}

function isSkuDataSheet_(sheet) {
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 3) {
    return false;
  }
  const excluded = [CONFIG.SUMMARY_SHEET.toLowerCase()];
  if (excluded.indexOf(sheet.getName().trim().toLowerCase()) >= 0) {
    return false;
  }
  const width = Math.min(sheet.getLastColumn(), 40);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0]
    .map(function(value) {
      return String(value || '').replace(/\s/g, '').toLowerCase();
    });
  const skuIdCol = headers.indexOf('识别sku');
  if (
    skuIdCol < 0 ||
    headers.indexOf('控制销量') < 0 ||
    headers.indexOf('控制库存') < 0
  ) {
    return false;
  }

  // 不能只看“控制销量/控制库存”表头，否则“利润导出”等汇总页也会被误认。
  // 合格产品页必须在“识别SKU”列中出现与工作表名完全一致的SKU。
  const sampleRows = sheet.getLastRow() - 1;
  const expectedSku = normalizeSku_(sheet.getName());
  return sheet.getRange(2, skuIdCol + 1, sampleRows, 1)
    .getDisplayValues()
    .some(function(row) {
      return normalizeSku_(row[0]) === expectedSku;
    });
}

function normalizeSku_(sku) {
  return String(sku || '').trim().toLowerCase();
}

/** 计算一行补货结果。 */
function calculateOneRow_(settings, sheetMap, skuDataCache) {
  const weekMonday = settings.weekMonday;
  const sku = settings.sku;
  const productLt = settings.productLt;
  const logisticsLt = settings.logisticsLt;
  const warningDays = settings.warningDays;
  const casePack = settings.casePack;

  const eta = addDays_(weekMonday, productLt + logisticsLt);

  const skuSheet = findSkuSheet_(sku, sheetMap);
  if (!skuSheet) {
    throw new Error('找不到与SKU同名的工作表：' + sku);
  }

  const records = getSkuRecords_(skuSheet, skuDataCache);
  const startDay = dayNumber_(weekMonday);
  const futureRecords = records.filter(function(record) {
    return record.day >= startDay;
  });

  if (futureRecords.length === 0) {
    return {
      eta: eta,
      warningDate: null,
      needOrder: null,
      coverDays: null,
      avgSales: null,
      quantity: null,
      stockoutDate: null,
      coverEndDate: null,
      status: '预测范围不足：SKU页没有判断周周一及之后的数据，请先把日期、控制销量和控制库存公式向后延伸'
    };
  }

  if (futureRecords[0].day !== startDay) {
    throw new Error('SKU页缺少判断周周一当天的数据');
  }

  const cycle = findNextStockoutCycle_(futureRecords);

  // 如果判断周库存已≤0，但未来有计划入库使库存恢复为正，不能把判断周
  // 当成“下一次断货”。应从恢复后的新库存周期继续寻找下一次断货。
  if (cycle.persistentShortage) {
    return {
      eta: eta,
      warningDate: '持续缺货',
      needOrder: 1,
      coverDays: null,
      avgSales: null,
      quantity: null,
      stockoutDate: weekMonday,
      coverEndDate: null,
      status: '紧急异常：判断周控制库存已≤0，且预测范围内没有任何未来入库使库存恢复为正；请检查在途入库或人工确认紧急补货'
    };
  }

  const stockoutRecord = cycle.stockoutRecord;
  if (!stockoutRecord) {
    const lastForecastRecord = futureRecords[futureRecords.length - 1];
    const requiredForecastEnd = addDays_(eta, warningDays + 7);
    const recoveryText = cycle.recoveryRecord
      ? '判断周库存≤0，但已识别到' +
        formatDateText_(cycle.recoveryRecord.date) +
        '库存恢复为正；恢复后的预测范围内没有再次断货；'
      : '当前预测范围内控制库存未降至0；';

    // “暂时没找到断货”不等于“无需下单”。只有预测范围足够覆盖
    // 预计入库日+预警期+一周缓冲，才可以安全输出“否”。
    if (lastForecastRecord.day < dayNumber_(requiredForecastEnd)) {
      return {
        eta: eta,
        warningDate: null,
        needOrder: null,
        coverDays: null,
        avgSales: null,
        quantity: null,
        stockoutDate: null,
        coverEndDate: null,
        status: recoveryText + '预测只到' +
          formatDateText_(lastForecastRecord.date) +
          '，不足以判断本周是否下单；请至少延伸到' +
          formatDateText_(requiredForecastEnd)
      };
    }

    return {
      eta: eta,
      warningDate: null,
      needOrder: 0,
      coverDays: null,
      avgSales: null,
      quantity: null,
      stockoutDate: null,
      coverEndDate: null,
      status: recoveryText + '预测已覆盖到' +
        formatDateText_(lastForecastRecord.date) +
        '，范围足以确认本周无需下单'
    };
  }

  const stockoutDate = stockoutRecord.date;
  const warningDate = addDays_(stockoutDate, -warningDays);
  const cycleStatusPrefix = cycle.recoveryRecord
    ? '判断周库存≤0，但' + formatDateText_(cycle.recoveryRecord.date) +
      '因未来入库恢复为正；本次按恢复后的下一轮库存周期判断；'
    : '';

  // 预警日期已经早于本次判断周，代表正常下单窗口已经错过。
  // 标准公式不再适用；为避免产生虚高或错误补货数量，停止自动算量。
  if (dayNumber_(warningDate) < dayNumber_(weekMonday)) {
    const alreadyStockedOut = dayNumber_(stockoutDate) <= dayNumber_(weekMonday);
    return {
      eta: eta,
      warningDate: '已逾期',
      needOrder: 1,
      coverDays: null,
      avgSales: null,
      quantity: null,
      stockoutDate: stockoutDate,
      coverEndDate: null,
      status: cycleStatusPrefix + (alreadyStockedOut
        ? '紧急异常：判断周开始时控制库存已≤0；预警窗口已错过，标准补货公式不适用，请人工确认紧急补货数量'
        : '紧急异常：断货预警窗口已经错过；标准补货公式不适用，请人工确认紧急补货数量')
    };
  }

  const warningWeekSunday = endOfWeekSunday_(warningDate);
  const needOrder = dayNumber_(eta) >= dayNumber_(warningWeekSunday) ? 1 : 0;

  if (!needOrder) {
    return {
      eta: eta,
      warningDate: warningDate,
      needOrder: 0,
      coverDays: null,
      avgSales: null,
      quantity: null,
      stockoutDate: stockoutDate,
      coverEndDate: null,
      status: cycleStatusPrefix + '本周无需下单；物流周期来源：' +
        settings.logisticsSource
    };
  }

  const coverDays = diffDays_(eta, warningDate) + CONFIG.SAFETY_COVER_DAYS;
  if (!Number.isFinite(coverDays) || coverDays <= 0) {
    throw new Error('补货天数计算异常：' + coverDays);
  }

  const coverEndDate = addDays_(stockoutDate, coverDays);
  const salesResult = averageControlSales_(
    records,
    stockoutDate,
    coverEndDate,
    coverDays
  );
  const avgSales = salesResult.average;
  const rawQuantity = coverDays * avgSales;
  const quantity = roundUpToCasePack_(rawQuantity, casePack);

  return {
    eta: eta,
    warningDate: warningDate,
    needOrder: 1,
    coverDays: coverDays,
    avgSales: avgSales,
    quantity: quantity,
    stockoutDate: stockoutDate,
    coverEndDate: coverEndDate,
    status: cycleStatusPrefix +
      '完成；平均日销使用' + salesResult.count +
      '个日期；物流周期来源：' + settings.logisticsSource
  };
}

/**
 * 识别下一轮有效断货：
 * - 判断周库存>0：直接找后续第一次≤0。
 * - 判断周库存≤0、未来会恢复>0：跳过当前缺货段，从恢复后找下一次≤0。
 * - 判断周库存≤0、未来始终不恢复：持续缺货，交给人工紧急处理。
 */
function findNextStockoutCycle_(futureRecords) {
  const first = futureRecords[0];
  validateControlStock_(first);

  let recoveryRecord = null;
  let searchStartIndex = 1;

  if (first.controlStock <= 0) {
    searchStartIndex = futureRecords.length;
    for (let i = 1; i < futureRecords.length; i += 1) {
      validateControlStock_(futureRecords[i]);
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
    validateControlStock_(futureRecords[i]);
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

function validateControlStock_(record) {
  if (!Number.isFinite(record.controlStock)) {
    throw new Error(
      '从判断周开始，“控制库存”存在空值或公式错误；请先修复SKU页'
    );
  }
}

/** 从SKU页按表头识别日期、控制销量和控制库存，并整理成按日期升序的数据。 */
function getSkuRecords_(sheet, cache) {
  const cacheKey = sheet.getSheetId();
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error('SKU工作表没有数据：' + sheet.getName());
  }

  const lastColumn = sheet.getLastColumn();
  const rawHeaders = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const headers = rawHeaders.map(function(value) {
    return String(value || '').replace(/\s/g, '').toLowerCase();
  });
  let dateCol = headers.indexOf('日期');
  if (dateCol < 0) {
    dateCol = 0;
  }
  const controlSalesCol = headers.indexOf('控制销量');
  const controlStockCol = headers.indexOf('控制库存');
  if (controlSalesCol < 0 || controlStockCol < 0) {
    throw new Error(
      'SKU工作表缺少“控制销量”或“控制库存”表头：' + sheet.getName()
    );
  }

  const readWidth = Math.max(dateCol, controlSalesCol, controlStockCol) + 1;
  const timezone = sheet.getParent().getSpreadsheetTimeZone();
  const values = sheet
    .getRange(2, 1, lastRow - 1, readWidth)
    .getValues();

  const records = [];
  values.forEach(function(row) {
    const date = tryParseSheetDate_(row[dateCol], timezone);
    if (!date) {
      return;
    }

    records.push({
      date: date,
      day: dayNumber_(date),
      controlSales: toFiniteNumber_(row[controlSalesCol]),
      controlStock: toFiniteNumber_(row[controlStockCol])
    });
  });

  records.sort(function(a, b) {
    return a.day - b.day;
  });

  if (records.length === 0) {
    throw new Error('SKU工作表没有可识别的日期：' + sheet.getName());
  }

  for (let i = 1; i < records.length; i += 1) {
    if (records[i].day === records[i - 1].day) {
      throw new Error(
        'SKU工作表存在重复日期，无法保证补货计算准确：' + sheet.getName()
      );
    }
  }

  if (!records.some(function(record) {
    return Number.isFinite(record.controlStock);
  })) {
    throw new Error(
      '“控制库存”列没有有效数字，请先修复SKU页公式：' + sheet.getName()
    );
  }

  cache.set(cacheKey, records);
  return records;
}

/** 计算指定未来区间的平均控制日销，并检查每日数据是否完整。 */
function averageControlSales_(records, startDate, endDate, coverDays) {
  const startDay = dayNumber_(startDate);
  const endDay = dayNumber_(endDate);
  const includeEnd = CONFIG.INCLUDE_COVER_END_DATE_IN_AVERAGE;
  const salesByDay = new Map();

  records.forEach(function(record) {
    const inRange = includeEnd
      ? record.day >= startDay && record.day <= endDay
      : record.day >= startDay && record.day < endDay;

    if (inRange && Number.isFinite(record.controlSales)) {
      if (record.controlSales < 0) {
        throw new Error('控制日销不能为负数，请检查SKU页');
      }
      salesByDay.set(record.day, record.controlSales);
    }
  });

  const expectedCount = includeEnd ? coverDays + 1 : coverDays;
  if (salesByDay.size !== expectedCount) {
    throw new Error(
      '控制日销区间不完整：应有' + expectedCount +
      '个日期，实际抓到' + salesByDay.size + '个日期'
    );
  }

  const sales = Array.from(salesByDay.values());
  const sum = sales.reduce(function(total, value) {
    return total + value;
  }, 0);

  return {
    average: sum / sales.length,
    count: sales.length
  };
}

/** 安装每周一上午9点附近运行的定时触发器。先人工测试正确后再使用。 */
function installMondayTrigger() {
  deleteTriggersByHandler_('calculateAllRows');
  ScriptApp.newTrigger('calculateAllRows')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();

  SpreadsheetApp.getUi().alert(
    '已安装每周一自动计算。实际执行时间通常在上午9点至10点之间。'
  );
}

/** 删除本项目中指向批量补货计算的定时触发器。 */
function deleteMondayTriggers() {
  const count = deleteTriggersByHandler_('calculateAllRows');
  SpreadsheetApp.getUi().alert('已删除' + count + '个每周自动计算触发器。');
}

function deleteTriggersByHandler_(handlerName) {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
      count += 1;
    }
  });
  return count;
}

function ensureSummaryHeaders_(sheet) {
  const desired = [
    '交期（手填）',
    '截单到入库上架天数（手填）',
    '预计入库时间（自动）',
    '断货预警天数（固定21）',
    '断货预警日期（自动）',
    '本周是否需要下单（自动）',
    '补货天数（自动）',
    '平均控制日销（自动）',
    '补货数量（自动）',
    '箱规（手填）',
    '预计断货日期',
    '补货覆盖结束日期',
    '处理状态',
    '最后计算时间'
  ];
  sheet.getRange(CONFIG.HEADER_ROW, CONFIG.SUMMARY_COL.PRODUCT_LT, 1, desired.length)
    .setValues([desired]);
}

function applyOutputFormats_(sheet, startRow, numRows) {
  sheet.getRange(startRow, CONFIG.SUMMARY_COL.PRODUCT_LT, numRows, 2)
    .setNumberFormat('0');
  sheet.getRange(startRow, CONFIG.SUMMARY_COL.ETA, numRows, 1)
    .setNumberFormat('yyyy-mm-dd');
  sheet.getRange(startRow, CONFIG.SUMMARY_COL.WARNING_DAYS, numRows, 1)
    .setNumberFormat('0');
  sheet.getRange(startRow, CONFIG.SUMMARY_COL.WARNING_DATE, numRows, 1)
    .setNumberFormat('yyyy-mm-dd');
  sheet.getRange(startRow, CONFIG.SUMMARY_COL.NEED_ORDER, numRows, 1)
    .setNumberFormat('@');
  sheet.getRange(startRow, CONFIG.SUMMARY_COL.COVER_DAYS, numRows, 1)
    .setNumberFormat('0');
  sheet.getRange(startRow, CONFIG.SUMMARY_COL.AVG_CONTROL_SALES, numRows, 1)
    .setNumberFormat('0.00');
  sheet.getRange(startRow, CONFIG.SUMMARY_COL.REPLENISH_QTY, numRows, 1)
    .setNumberFormat('0');
  sheet.getRange(startRow, CONFIG.SUMMARY_COL.CASE_PACK, numRows, 1)
    .setNumberFormat('0');
  sheet.getRange(startRow, CONFIG.SUMMARY_COL.STOCKOUT_DATE, numRows, 2)
    .setNumberFormat('yyyy-mm-dd');
  sheet.getRange(startRow, CONFIG.SUMMARY_COL.UPDATED_AT, numRows, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function buildSheetNameMap_(ss) {
  const map = new Map();
  ss.getSheets().forEach(function(sheet) {
    map.set(sheet.getName().trim().toLowerCase(), sheet);
  });
  return map;
}

function findSkuSheet_(sku, sheetMap) {
  return sheetMap.get(sku.trim().toLowerCase()) || null;
}

function formatDateText_(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + month + '-' + day;
}

function parseSheetDate_(value, label, timezone) {
  const date = tryParseSheetDate_(value, timezone);
  if (!date) {
    throw new Error(label + '不是有效日期');
  }
  return date;
}

/** 支持Google日期值、yyyy/mm/dd、yyyy-mm-dd、m/d/yyyy。 */
function tryParseSheetDate_(value, timezone) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    // Google表格与Apps Script项目时区不一致时，直接使用getDate/getDay
    // 可能把表格中显示的星期一误读成星期日。先按工作簿时区转成日期文本。
    if (timezone) {
      const dateText = Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
      const parts = dateText.split('-').map(Number);
      return makeDate_(parts[0], parts[1], parts[2]);
    }
    return normalizeDate_(value);
  }

  // 兼容日期被保存为Google/Excel序列号的情况。
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const base = new Date(1899, 11, 30, 12, 0, 0, 0);
    return addDays_(base, Math.floor(value));
  }

  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();
  let match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (match) {
    return makeDate_(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    // 截图中的SKU页采用美国日期显示方式：m/d/yyyy。
    return makeDate_(Number(match[3]), Number(match[1]), Number(match[2]));
  }
  return null;
}

function makeDate_(year, month, day) {
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function normalizeDate_(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    12, 0, 0, 0
  );
}

/** 按工作簿时区取得当前周周一，避免服务器时区导致“今天”错一天。 */
function getCurrentWeekMonday_(ss) {
  const timezone = ss && ss.getSpreadsheetTimeZone
    ? ss.getSpreadsheetTimeZone()
    : Session.getScriptTimeZone();
  const todayText = Utilities.formatDate(
    new Date(),
    timezone || 'GMT',
    'yyyy-MM-dd'
  );
  const today = tryParseSheetDate_(todayText);
  const daysSinceMonday = (today.getDay() + 6) % 7;
  return addDays_(today, -daysSinceMonday);
}

function addDays_(date, days) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    12, 0, 0, 0
  );
}

function dayNumber_(date) {
  return Math.round(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  );
}

function diffDays_(laterDate, earlierDate) {
  return dayNumber_(laterDate) - dayNumber_(earlierDate);
}

function endOfWeekSunday_(date) {
  const daysToSunday = (7 - date.getDay()) % 7;
  return addDays_(date, daysToSunday);
}

function isBlankValue_(value) {
  return value === null || value === undefined ||
    (typeof value === 'string' && value.trim() === '');
}

function toFiniteNumber_(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const text = value.replace(/,/g, '').trim();
    if (!text || text.charAt(0) === '#') {
      return null;
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function requireNonnegativeInteger_(value, label) {
  const number = toFiniteNumber_(value);
  if (number === null || number < 0 || !Number.isInteger(number)) {
    throw new Error(label + '必须是大于或等于0的整数天数');
  }
  return number;
}

function requirePositiveInteger_(value, label) {
  const number = toFiniteNumber_(value);
  if (number === null || number <= 0 || !Number.isInteger(number)) {
    throw new Error(label + '必须是大于0的整数');
  }
  return number;
}

function roundUpToCasePack_(quantity, casePack) {
  // 减去极小值，避免浮点误差把本来整箱的数字多进一箱。
  return Math.ceil((quantity - 1e-9) / casePack) * casePack;
}

function buildResultMessage_(stats) {
  return '处理' + stats.total + '行；成功' + stats.success +
    '行；空白跳过' + stats.skipped + '行；错误' + stats.error + '行。';
}
