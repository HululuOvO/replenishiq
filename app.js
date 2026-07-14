'use strict';

/* 发布前只需要替换这两个地址；留空时网站其他计算功能不受影响。 */
const PUBLIC_LINKS = {
  githubRepository: 'https://github.com/HululuOvO/replenishiq',
  googleSheetCopy: ''
};

const Core = window.ReplenishmentCore;
const dataset = Core.createDemoDataset();
let lastCalculation = null;

const elements = {
  form: document.querySelector('#calculator-form'),
  weekMonday: document.querySelector('#week-monday'),
  sku: document.querySelector('#sku'),
  productLt: document.querySelector('#product-lt'),
  logisticsLt: document.querySelector('#logistics-lt'),
  casePack: document.querySelector('#case-pack'),
  resetButton: document.querySelector('#reset-button'),
  copyResult: document.querySelector('#copy-result'),
  datasetSummary: document.querySelector('#dataset-summary'),
  csvFile: document.querySelector('#csv-file'),
  downloadTemplate: document.querySelector('#download-template'),
  importStatus: document.querySelector('#import-status'),
  banner: document.querySelector('#decision-banner'),
  decisionKicker: document.querySelector('#decision-kicker'),
  decisionValue: document.querySelector('#decision-value'),
  decisionSummary: document.querySelector('#decision-summary'),
  resultEta: document.querySelector('#result-eta'),
  resultStockout: document.querySelector('#result-stockout'),
  resultWarning: document.querySelector('#result-warning'),
  resultWarningSunday: document.querySelector('#result-warning-sunday'),
  resultCoverDays: document.querySelector('#result-cover-days'),
  resultAvgSales: document.querySelector('#result-avg-sales'),
  resultQuantity: document.querySelector('#result-quantity'),
  resultCoverEnd: document.querySelector('#result-cover-end'),
  auditText: document.querySelector('#audit-text')
};

function configurePublicLinks() {
  const links = [
    ['#repo-link-top', PUBLIC_LINKS.githubRepository],
    ['#repo-link-bottom', PUBLIC_LINKS.githubRepository],
    ['#sheet-copy-link', PUBLIC_LINKS.googleSheetCopy],
    ['#sheet-copy-link-bottom', PUBLIC_LINKS.googleSheetCopy]
  ];
  links.forEach(function (entry) {
    const link = document.querySelector(entry[0]);
    const url = entry[1];
    if (link && url) {
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.classList.remove('is-placeholder');
    }
  });
}

function refreshSkuOptions(preferredSku) {
  const current = preferredSku || elements.sku.value || 'DEMO-FAST';
  elements.sku.innerHTML = '';
  Array.from(dataset.entries())
    .sort(function (a, b) { return a[0].localeCompare(b[0]); })
    .forEach(function (entry) {
      const sku = entry[0];
      const meta = entry[1];
      const option = document.createElement('option');
      option.value = sku;
      option.textContent = sku + ' · ' + meta.label;
      elements.sku.appendChild(option);
    });
  if (dataset.has(current)) elements.sku.value = current;
  updateDatasetSummary();
}

function updateDatasetSummary() {
  const selected = dataset.get(elements.sku.value);
  if (!selected) {
    elements.datasetSummary.textContent = '未找到SKU数据。';
    return;
  }
  const records = selected.records;
  elements.datasetSummary.textContent =
    (selected.source === 'csv' ? 'CSV导入' : '演示数据') + ' · ' +
    records[0].date + ' 至 ' + records[records.length - 1].date +
    ' · ' + records.length.toLocaleString('zh-CN') + '天';
}

function getSettings() {
  return {
    weekMonday: elements.weekMonday.value,
    sku: elements.sku.value,
    productLt: elements.productLt.value,
    logisticsLt: elements.logisticsLt.value,
    casePack: elements.casePack.value
  };
}

function displayValue(value, formatter) {
  if (value === null || value === undefined || value === '') return '—';
  return formatter ? formatter(value) : String(value);
}

function numberText(value, maximumFractionDigits) {
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: maximumFractionDigits,
    maximumFractionDigits: maximumFractionDigits
  });
}

function renderResult(result) {
  lastCalculation = result;
  const bannerClass = result.needOrder === true
    ? 'decision-yes'
    : result.needOrder === false
      ? 'decision-no'
      : 'decision-pending';
  elements.banner.className = 'decision-banner ' + bannerClass;

  if (result.needOrder === true) {
    elements.decisionKicker.textContent = result.quantity === null ? '需要人工介入' : '本周决策';
    elements.decisionValue.textContent = result.quantity === null ? '需要补货' : '需要下单';
  } else if (result.needOrder === false) {
    elements.decisionKicker.textContent = '本周决策';
    elements.decisionValue.textContent = '无需下单';
  } else {
    elements.decisionKicker.textContent = '暂不下结论';
    elements.decisionValue.textContent = '需要更多数据';
  }
  elements.decisionSummary.textContent = result.status;

  elements.resultEta.textContent = displayValue(result.eta);
  elements.resultStockout.textContent = displayValue(result.stockoutDate);
  elements.resultWarning.textContent = displayValue(result.warningDate);
  elements.resultWarningSunday.textContent = displayValue(result.warningWeekSunday);
  elements.resultCoverDays.textContent = displayValue(result.coverDays, function (value) {
    return numberText(value, 0) + '天';
  });
  elements.resultAvgSales.textContent = displayValue(result.avgSales, function (value) {
    return numberText(value, 2);
  });
  elements.resultQuantity.textContent = displayValue(result.quantity, function (value) {
    return numberText(value, 0) + '件';
  });
  elements.resultCoverEnd.textContent = displayValue(result.coverEndDate);

  if (result.statusCode === 'order') {
    elements.auditText.textContent =
      '预计到仓日期已经晚于安全下单时间，所以本周需要下单。' +
      '这批货需要覆盖' + result.coverDays + '天；预计每天卖多少件，使用了' +
      result.averageCount + '天的数据。' + result.status;
  } else {
    elements.auditText.textContent = result.status;
  }
}

function renderError(error) {
  lastCalculation = null;
  elements.banner.className = 'decision-banner decision-error';
  elements.decisionKicker.textContent = '输入或数据错误';
  elements.decisionValue.textContent = '无法计算';
  elements.decisionSummary.textContent = error.message || String(error);
  [
    elements.resultEta,
    elements.resultStockout,
    elements.resultWarning,
    elements.resultWarningSunday,
    elements.resultCoverDays,
    elements.resultAvgSales,
    elements.resultQuantity,
    elements.resultCoverEnd
  ].forEach(function (element) { element.textContent = '—'; });
  elements.auditText.textContent = '系统已停止输出，避免使用不完整数据形成错误补货建议。';
}

function runCalculation() {
  const settings = getSettings();
  const selected = dataset.get(settings.sku);
  if (!selected) {
    renderError(new Error('找不到SKU数据：' + settings.sku));
    return;
  }
  try {
    renderResult(Core.calculate(settings, selected.records));
  } catch (error) {
    renderError(error);
  }
}

function resetDemo() {
  elements.weekMonday.value = '2026-07-13';
  elements.sku.value = 'DEMO-FAST';
  elements.productLt.value = '20';
  elements.logisticsLt.value = '50';
  elements.casePack.value = '8';
  updateDatasetSummary();
  runCalculation();
}

function resultAsText() {
  if (!lastCalculation) return '';
  const result = lastCalculation;
  const decision = result.needOrder === true ? '是' : result.needOrder === false ? '否' : '待确认';
  return [
      '每周补货判断结果',
    'SKU：' + elements.sku.value,
    '判断周：' + elements.weekMonday.value,
    '本周是否需要下单：' + decision,
    '预计入库日期A：' + displayValue(result.eta),
    '预计断货日期S：' + displayValue(result.stockoutDate),
    '断货预警日期B：' + displayValue(result.warningDate),
    '补货天数C：' + displayValue(result.coverDays),
    '平均控制日销D：' + displayValue(result.avgSales, function (value) { return numberText(value, 2); }),
    '建议补货数量E：' + displayValue(result.quantity, function (value) { return numberText(value, 0); }),
    '状态：' + result.status
  ].join('\n');
}

async function copyResult() {
  const text = resultAsText();
  if (!text) {
    elements.copyResult.textContent = '请先计算';
    setTimeout(function () { elements.copyResult.textContent = '复制结果'; }, 1400);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    elements.copyResult.textContent = '已复制';
  } catch (error) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    elements.copyResult.textContent = '已复制';
  }
  setTimeout(function () { elements.copyResult.textContent = '复制结果'; }, 1400);
}

function setImportStatus(message, type) {
  elements.importStatus.textContent = message;
  elements.importStatus.className = 'import-status' + (type ? ' ' + type : '');
}

function handleCsvFile(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    setImportStatus('文件超过8MB。请保留计算所需的日期、SKU、控制销量和控制库存四列。', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const imported = Core.parseCsvDataset(reader.result);
      imported.forEach(function (value, sku) { dataset.set(sku, value); });
      const firstSku = imported.keys().next().value;
      refreshSkuOptions(firstSku);
      setImportStatus(
        '导入成功：识别到' + imported.size + '个SKU。已选择' + firstSku + '，现在可以计算。',
        'success'
      );
      document.querySelector('#calculator').scrollIntoView({ behavior: 'smooth' });
      runCalculation();
    } catch (error) {
      setImportStatus('导入失败：' + (error.message || String(error)), 'error');
    } finally {
      elements.csvFile.value = '';
    }
  };
  reader.onerror = function () {
    setImportStatus('浏览器无法读取这个文件，请重新导出为UTF-8 CSV。', 'error');
  };
  reader.readAsText(file, 'utf-8');
}

function downloadCsvTemplate() {
  const csv = '\uFEFF' + Core.createCsvTemplate();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'new_sku_template.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

elements.form.addEventListener('submit', function (event) {
  event.preventDefault();
  runCalculation();
});
elements.resetButton.addEventListener('click', resetDemo);
elements.copyResult.addEventListener('click', copyResult);
elements.sku.addEventListener('change', updateDatasetSummary);
elements.csvFile.addEventListener('change', function (event) {
  handleCsvFile(event.target.files[0]);
});
elements.downloadTemplate.addEventListener('click', downloadCsvTemplate);

configurePublicLinks();
refreshSkuOptions('DEMO-FAST');
runCalculation();
