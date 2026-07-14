# 每周补货判断工具

这是一个可以直接放在 GitHub Pages 上使用的公开补货工具。

用户无需登录、无需安装软件、无需授权 Google 账号，即可在浏览器中：

- 选择判断周和 SKU；
- 输入交期、入库上架天数和箱规；
- 识别预计断货日期和断货前 21 天预警日期；
- 判断本周是否需要下单；
- 计算平均控制日销；
- 生成按箱规向上取整的补货数量；
- 上传包含新 SKU 数据的 CSV 并立即计算。

> 当前公开版本内置的 SKU、销量和库存全部为虚构演示数据。

## 在线地址

部署后填写：

- Product: `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`
- Source: `https://github.com/YOUR_USERNAME/YOUR_REPOSITORY`
- Google Sheets template: `YOUR_PUBLIC_COPY_LINK`

## 可以做什么

打开网页就能计算，不是Google表格截图，也不需要先注册账号。

- 不依赖后端服务；
- 不需要 Google OAuth；
- 不需要 API Key；
- GitHub Pages 可以直接托管；
- 上传 CSV 时，数据只保留在使用者当前浏览器内存；
- 刷新页面后，导入的数据自动清除。

## 效率说明

公开版使用可以直接核对的工作量数据，不填写没有实际测试依据的“效率提升百分比”：

- 每个 SKU 手工填写 5 项，自动得到 8 项补货结果；
- 原来需要跨表完成的预计入库、断货预警、下单判断、覆盖天数、平均日销和箱规取整 6 个步骤，合并成一次计算；
- 2026—2030 共约 1,826 天，单个 SKU 可以一次读取约 1,826 条日级预测记录；
- 一次判断 20 个 SKU 时，相当于读取约 36,520 条日级记录。

如果以后有真实的人工处理时间和工具处理时间，可以再增加“从多少分钟减少到多少秒”的实际测试结果。

## 计算规则

### 1. 预计入库日期 A

```text
A = 判断周周一 + 交期 + 截单到入库上架天数
```

### 2. 断货预警日期 B

系统从判断周开始识别下一轮有效断货日期 S：

- 判断周库存大于 0：寻找后续第一次控制库存小于或等于 0 的日期；
- 判断周库存小于或等于 0，但未来会恢复：跳过当前缺货段，从恢复后的库存周期继续寻找；
- 判断周库存小于或等于 0，且未来始终不恢复：停止标准算量，要求人工紧急处理。

```text
B = S - 21天
```

### 3. 是否需要下单

```text
如果 A >= B 所在周的周日，则本周需要下单。
```

### 4. 补货数量

```text
补货天数 C = A - B + 14
覆盖结束日期 F = S + C
控制日销 D = S 至 F 的平均控制日销
原始补货量 = C × D
建议补货量 E = 原始补货量按箱规向上取整
```

当前平均控制日销包含覆盖结束日期 F，因此使用日期数为 `C + 1`。这一边界与 Google Sheets 生产版保持一致。

## 可靠性保护

以下情况不会生成一个看起来精确、实际不可靠的补货数量：

- 判断周不是星期一；
- 日期重复或不连续；
- 交期、物流天数或箱规无效；
- 判断周在 SKU 预测数据中不存在；
- 控制销量缺失或小于 0；
- 控制库存不是数字；
- 预测范围不足；
- 当前持续缺货且没有未来入库；
- 正常断货预警窗口已经错过；
- 平均控制日销区间不完整。

## 上传自己的 SKU

网页支持 UTF-8 CSV，字段如下：

```csv
date,sku,control_sales,control_inventory
2026-07-13,NEW-SKU,32,2100
2026-07-14,NEW-SKU,35,2065
2026-07-15,NEW-SKU,31,2034
```

也支持中文表头：

```csv
日期,识别SKU,控制销量,控制库存
2026-07-13,NEW-SKU,32,2100
```

要求：

- 每个 SKU 每天一行；
- 日期格式为 `yyyy-mm-dd`；
- 日期必须逐日连续；
- 同一个 SKU 不能存在重复日期；
- CSV 建议只保留计算需要的四列；
- 单个文件最大 8 MB。

CSV 不会上传到服务器。所有解析和计算都发生在使用者自己的浏览器中。

## 本地运行

这个项目不需要安装依赖。

最简单的方式是直接打开 `index.html`。如果浏览器限制本地文件，可以在项目目录运行：

```bash
python -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

## 自动化测试

需要 Node.js 18 或更高版本：

```bash
node tests/calculator.test.js
```

测试覆盖：

- 星期一日期校验；
- 2028 闰年；
- 是否下单；
- 平均控制日销；
- 箱规向上取整；
- 预测范围不足；
- 持续缺货；
- 缺货后的库存恢复；
- 中英文 CSV；
- 日期重复与日期缺口；
- 2026—2030 数据范围。

## 发布到 GitHub Pages

完整小白步骤见 [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)。

最简流程：

1. 创建一个 Public GitHub repository；
2. 上传本项目全部文件；
3. 进入 `Settings → Pages`；
4. Source 选择 `Deploy from a branch`；
5. Branch 选择 `main` 和 `/(root)`；
6. 保存并等待 GitHub Pages 地址生成。

## 填写公开链接

打开 `app.js`，修改文件最上方：

```javascript
const PUBLIC_LINKS = {
  githubRepository: 'https://github.com/YOUR_USERNAME/YOUR_REPOSITORY',
  googleSheetCopy: 'https://docs.google.com/spreadsheets/d/YOUR_FILE_ID/copy'
};
```

如果暂时没有公开 Google Sheets 模板，可以保持空字符串。网页计算功能不会受到影响。

## 项目结构

```text
.
├── index.html                  # 产品界面
├── styles.css                 # 响应式样式
├── calculator.js              # 可独立测试的补货计算核心
├── app.js                     # 页面交互、CSV导入和结果展示
├── apps-script/
│   └── replenishment_apps_script.gs
│                               # Google Sheets生产版本
├── tests/
│   └── calculator.test.js      # 无依赖测试
├── DEPLOYMENT_GUIDE.md         # GitHub Pages发布教程
├── LICENSE
└── README.md
```

## Google Sheets 生产版

`apps-script/replenishment_apps_script.gs` 是绑定到 Google Sheets 的生产实现，包含：

- 编辑后自动计算；
- 批量计算全部 SKU；
- 每周一定时计算；
- 动态识别与 SKU 同名的新产品工作表；
- 预测范围不足保护；
- 跨年、闰年和工作簿时区处理。

公开网站和 Google Sheets 版使用相同的核心业务规则，但运行环境不同：

- 网站版：公开、免登录、浏览器本地计算；
- Google Sheets 版：适合运营团队长期维护日级库存预测。

## 数据隐私

请不要把真实商业数据提交到公开 GitHub 仓库，包括：

- 真实 SKU 与供应商信息；
- 订单号、邮箱和姓名；
- 成本、利润、广告和采购数据；
- 真实 Google Spreadsheet ID；
- API Key、Token、密码或 OAuth 凭证；
- 含真实数据的截图。

公开演示数据请使用 `DEMO-*` 或 `SAMPLE-*` 等虚构标识。

## License

MIT License。任何人都可以查看、使用和修改代码，但需要保留许可证声明。
