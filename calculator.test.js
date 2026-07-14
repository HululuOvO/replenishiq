'use strict';

const assert = require('node:assert/strict');
const Core = require('./calculator.js');

function dailyRecords(startDate, days, sales, initialStock, receiptByDate) {
  const start = Core.parseISODate(startDate);
  const records = [];
  let stock = initialStock;
  for (let offset = 0; offset < days; offset += 1) {
    const date = Core.formatDay(start + offset);
    stock += (receiptByDate && receiptByDate[date]) || 0;
    stock -= sales;
    records.push({
      date: date,
      sku: 'TEST-SKU',
      controlSales: sales,
      controlStock: stock
    });
  }
  return records;
}

function test(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (error) {
    console.error('FAIL', name);
    throw error;
  }
}

test('2028 leap-year Monday is recognized', function () {
  assert.equal(Core.isMonday(Core.parseISODate('2028-02-28')), true);
  assert.equal(Core.formatDay(Core.parseISODate('2028-02-28') + 1), '2028-02-29');
});

test('non-Monday input is rejected', function () {
  const records = dailyRecords('2026-07-01', 200, 10, 2000);
  assert.throws(function () {
    Core.calculate({
      weekMonday: '2026-07-14',
      sku: 'TEST-SKU',
      productLt: 20,
      logisticsLt: 30,
      casePack: 8
    }, records);
  }, /星期一/);
});

test('need-order quantity uses inclusive average and case-pack rounding', function () {
  const records = dailyRecords('2026-07-13', 200, 10, 710);
  const result = Core.calculate({
    weekMonday: '2026-07-13',
    sku: 'TEST-SKU',
    productLt: 20,
    logisticsLt: 50,
    casePack: 8
  }, records);
  assert.equal(result.stockoutDate, '2026-09-21');
  assert.equal(result.warningDate, '2026-08-31');
  assert.equal(result.warningWeekSunday, '2026-09-06');
  assert.equal(result.eta, '2026-09-21');
  assert.equal(result.needOrder, true);
  assert.equal(result.coverDays, 35);
  assert.equal(result.averageCount, 36);
  assert.equal(result.avgSales, 10);
  assert.equal(result.quantity, 352);
  assert.equal(result.coverEndDate, '2026-10-26');
});

test('earlier ETA returns no order', function () {
  const records = dailyRecords('2026-07-13', 200, 10, 710);
  const result = Core.calculate({
    weekMonday: '2026-07-13',
    sku: 'TEST-SKU',
    productLt: 20,
    logisticsLt: 30,
    casePack: 8
  }, records);
  assert.equal(result.eta, '2026-09-01');
  assert.equal(result.needOrder, false);
  assert.equal(result.quantity, null);
});

test('insufficient forecast does not pretend no order is needed', function () {
  const records = dailyRecords('2026-07-13', 45, 1, 10000);
  const result = Core.calculate({
    weekMonday: '2026-07-13',
    sku: 'TEST-SKU',
    productLt: 20,
    logisticsLt: 50,
    casePack: 8
  }, records);
  assert.equal(result.needOrder, null);
  assert.equal(result.statusCode, 'insufficient-horizon');
});

test('persistent shortage requires manual intervention', function () {
  const records = dailyRecords('2026-07-13', 200, 10, -100);
  const result = Core.calculate({
    weekMonday: '2026-07-13',
    sku: 'TEST-SKU',
    productLt: 20,
    logisticsLt: 50,
    casePack: 8
  }, records);
  assert.equal(result.needOrder, true);
  assert.equal(result.quantity, null);
  assert.equal(result.statusCode, 'persistent-shortage');
});

test('current shortage with future recovery uses the next inventory cycle', function () {
  const records = dailyRecords('2026-07-13', 500, 10, -100, {
    '2026-08-01': 2500
  });
  const result = Core.calculate({
    weekMonday: '2026-07-13',
    sku: 'TEST-SKU',
    productLt: 20,
    logisticsLt: 50,
    casePack: 8
  }, records);
  assert.equal(result.stockoutDate, '2027-03-09');
  assert.equal(result.status.includes('恢复'), true);
});

test('CSV recognizes a new SKU with English headers', function () {
  const csv = Core.createCsvTemplate();
  const imported = Core.parseCsvDataset(csv);
  assert.equal(imported.has('NEW-SKU'), true);
  assert.equal(imported.get('NEW-SKU').records.length, 120);
});

test('CSV recognizes Chinese headers', function () {
  const csv = [
    '日期,识别SKU,控制销量,控制库存',
    '2030-01-01,FUTURE-1,12,1200',
    '2030-01-02,FUTURE-1,12,1188'
  ].join('\n');
  const imported = Core.parseCsvDataset(csv);
  assert.equal(imported.has('FUTURE-1'), true);
});

test('duplicate and missing dates are rejected', function () {
  assert.throws(function () {
    Core.normalizeRecords([
      { date: '2026-07-13', controlSales: 10, controlStock: 100 },
      { date: '2026-07-15', controlSales: 10, controlStock: 80 }
    ], 'TEST-SKU');
  }, /不连续/);
});

test('demo dataset spans through 2030', function () {
  const demo = Core.createDemoDataset();
  assert.equal(demo.size, 3);
  demo.forEach(function (item) {
    assert.equal(item.records[0].date, '2026-01-01');
    assert.equal(item.records[item.records.length - 1].date, '2030-12-31');
  });
});

console.log('All calculator tests passed.');
