# ReplenishIQ GitHub Pages 小白发布教程

本教程的目标是把整个项目发布成一个任何人都能直接打开和计算的公开网站。

发布完成后会有两个不同链接：

```text
产品网站：https://你的用户名.github.io/仓库名/
代码仓库：https://github.com/你的用户名/仓库名
```

AdventureX 材料中应优先填写“产品网站”，同时附上“代码仓库”。

## 一、发布前必须检查脱敏

在项目文件夹中搜索并删除：

- 真实姓名；
- 个人邮箱；
- 公司名称；
- 真实 SKU；
- 供应商和订单号；
- Google Spreadsheet ID；
- API Key、Token 和密码；
- 含头像、邮箱或真实业务数据的截图。

这个网站默认自带的 `DEMO-FAST`、`DEMO-LONG` 和 `DEMO-RECOVERY` 都是自动生成的虚构数据，可以公开。

## 二、创建 GitHub 账号

1. 打开 <https://github.com/>。
2. 点击 `Sign up`。
3. 填写邮箱、密码和用户名。
4. 完成邮箱验证。

建议用户名简短、专业。网站地址会包含用户名。

## 三、创建公开仓库

1. 登录 GitHub。
2. 点击右上角 `+`。
3. 点击 `New repository`。
4. `Repository name` 建议填写：

```text
replenishiq
```

5. `Description` 填写：

```text
An auditable SKU replenishment decision tool built for real supply-chain planning.
```

6. 选择 `Public`。
7. 点击 `Create repository`。

公开仓库意味着所有代码都能被看到，因此不能上传真实业务数据或密钥。

## 四、上传网站文件

1. 进入新创建的仓库。
2. 点击 `uploading an existing file`；如果看不到，点击 `Add file → Upload files`。
3. 打开本项目文件夹。
4. 选中项目中的全部文件和文件夹。
5. 拖到 GitHub 上传区域。
6. 等待文件上传完成。
7. 在 `Commit changes` 说明中填写：

```text
Initial public release for AdventureX 2026
```

8. 点击绿色 `Commit changes`。

上传后仓库根目录必须直接看到：

```text
index.html
styles.css
calculator.js
app.js
README.md
```

不能把它们多套在另一个文件夹中。例如下面是错误结构：

```text
replenishiq/
  adventurex-replenishment-tool/
    index.html
```

GitHub 仓库根目录应该直接就是 `index.html`。

## 五、开启 GitHub Pages

1. 在仓库顶部点击 `Settings`。
2. 左侧找到 `Pages`。
3. 在 `Build and deployment` 中：
   - Source：选择 `Deploy from a branch`；
   - Branch：选择 `main`；
   - Folder：选择 `/(root)`。
4. 点击 `Save`。
5. 等待 GitHub 完成部署。
6. 刷新 `Settings → Pages`。

页面会显示类似地址：

```text
https://你的用户名.github.io/replenishiq/
```

点击该地址，应该直接看到 ReplenishIQ 页面，并自动得到默认示例的计算结果。

## 六、第一次验收

打开网站后按顺序检查：

1. 首屏显示 `ReplenishIQ`。
2. 点击“立即在线体验”能跳到计算区域。
3. 默认选择 `DEMO-FAST`。
4. 默认日期为 `2026-07-13`。
5. 页面自动输出“需要下单”。
6. 预计入库日期为 `2026-09-21`。
7. 预计断货日期为 `2026-10-09`。
8. 断货预警日期为 `2026-09-18`。
9. 建议补货数量为 `720件`。
10. 切换 `DEMO-LONG` 后重新计算，输出“无需下单”。
11. 点击“下载CSV模板”，浏览器可以下载CSV。
12. 再把CSV上传，页面识别 `NEW-SKU`。

然后使用手机打开网站，再检查一次按钮、输入框和结果是否正常。

## 七、添加 GitHub 和 Google Sheets 按钮

在 GitHub 仓库中点击 `app.js`，然后点击铅笔图标编辑。

找到：

```javascript
const PUBLIC_LINKS = {
  githubRepository: '',
  googleSheetCopy: ''
};
```

修改为：

```javascript
const PUBLIC_LINKS = {
  githubRepository: 'https://github.com/你的用户名/replenishiq',
  googleSheetCopy: 'https://docs.google.com/spreadsheets/d/脱敏文件ID/copy'
};
```

点击 `Commit changes` 保存。

几分钟后刷新产品网站，按钮就会跳转到正确地址。

如果还没有 Google Sheets 公开脱敏模板，`googleSheetCopy` 可以暂时保留空字符串。

## 八、制作 Google Sheets 脱敏模板

1. 打开原始 Google 表格。
2. 点击 `文件 → 创建副本`。
3. 命名为：

```text
ReplenishIQ Public Template
```

4. 在副本中删除全部真实数据。
5. 不要只隐藏真实工作表，因为复制者可以重新显示。
6. 只保留：
   - 每周判断快速下单；
   - 2—3 个虚构 SKU 产品页；
   - 正常运行需要的公式；
   - Apps Script 代码。
7. 把 SKU 改成 `DEMO-001`、`DEMO-002`。
8. 把订单、备注和库存信息改成虚构内容。
9. 点击右上角 `共享`。
10. 设置成“任何知道链接的人可以查看”。
11. 复制链接。

原始链接通常类似：

```text
https://docs.google.com/spreadsheets/d/FILE_ID/edit?usp=sharing
```

把 `/edit?usp=sharing` 改成 `/copy`：

```text
https://docs.google.com/spreadsheets/d/FILE_ID/copy
```

在无痕窗口打开这个地址，确认只看到脱敏后的模板。

## 九、网站更新方法

以后修改网站，不需要重新创建仓库。

在 GitHub 中：

1. 打开需要修改的文件；
2. 点击铅笔图标；
3. 修改内容；
4. 点击 `Commit changes`；
5. 等待 GitHub Pages 自动更新。

如果一次修改多个文件，可以重新使用 `Add file → Upload files` 上传同名文件。

## 十、常见问题

### 网站出现 404

检查：

- 是否已开启 `Settings → Pages`；
- 是否选择 `main` 和 `/(root)`；
- 仓库根目录是否直接存在 `index.html`；
- 仓库是否为 Public。

### 页面能打开，但是没有样式

确认根目录中存在 `styles.css`，并且 `index.html` 使用：

```html
<link rel="stylesheet" href="./styles.css">
```

### CSV 无法导入

检查：

- 文件是否为 CSV，不是 XLSX；
- 是否使用 UTF-8；
- 是否有四个必需表头；
- 日期是否为 `yyyy-mm-dd`；
- 日期是否每天连续；
- 是否存在重复日期。

### Google Sheets 按钮不能使用

检查 `app.js` 中 `googleSheetCopy` 是否已经填写，地址是否以 `/copy` 结束。

### 修改后网站没有立即变化

GitHub Pages需要重新部署。稍等后强制刷新浏览器：

- Windows：`Ctrl + F5`
- Mac：`Command + Shift + R`

## 十一、AdventureX 提交建议

材料中按照这个顺序放链接：

1. **Live Product**：GitHub Pages网站；
2. **Source Code**：GitHub公开仓库；
3. **Full Operations Template**：Google Sheets复制模板；
4. **Demo Video**：30—60秒操作视频。

演示视频只需要展示：

1. 打开网站；
2. 填写五项输入；
3. 输出是否下单和补货数量；
4. 切换SKU；
5. 上传新SKU CSV；
6. 展示预测范围不足时不会乱给结论。

这样审核者看到的不是说明材料，而是可以立即操作、可以检查源码、可以导入新数据的完整公开工具。
