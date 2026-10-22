# Quiet Tab

极简新标签页 Chrome 扩展。一个**永不跳变**的时钟，配每日高清壁纸、搜索与天气。

参考 [Bonjourr](https://github.com/victrme/Bonjourr) 重写，但技术选型与核心实现完全不同。

---

## 安装

未发布到 Chrome 商店，本地加载：

```bash
npm install
npm run build
```

1. 地址栏打开 `chrome://extensions/`
2. 打开右上角 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择本项目的 **`dist`** 目录（不是项目根目录）
4. 开一个新标签页

改完代码重新 `npm run build` 后，需要在扩展卡片上点**刷新**（↻）—— 产物带内容哈希，不刷新会继续用旧文件。

> Chrome 会为未打包扩展分配一个由安装路径推导的 ID，每台机器不同。

---

## 功能

| 操作 | 方式 |
|---|---|
| 切换壁纸 | `←` / `→`，或右键菜单「上一张 / 下一张」 |
| 切换图源 | 右键 → Unsplash / Bing 每日 |
| 调节背景模糊 | 右键 → 底部滑块（0–40px，默认 8） |
| 显示/隐藏 秒、搜索框、天气 | 右键 → 「显示」分组 |
| 切换搜索引擎 | **搜索框右端**的「Google ⌄」按钮（菜单里不再重复提供） |
| 设置天气城市 | 右键 → 天气位置 → 搜城市名 |
| 搜索 | 直接打字（任意位置敲键即聚焦，类 Spotlight），`↑↓` 选候选，`Enter` 搜索 |
| AI 模式 | `Ctrl/Cmd + Enter`，或点下拉**第一行** |
| 清空搜索历史 | 右键 → 搜索 → 清空搜索历史（也可关闭记录） |
| 输入网址 | 识别为 URL 时直接跳转，不走搜索 |

设置全部持久化在 `chrome.storage.local`。

### 搜索下拉的结构

参照 google.com 的组织方式，视觉沿用本页语言：

```
┌─────────────────────────────────────────┐
│ 🔍  chrome                   ×  Google ⌄│   ← 输入框，右端为引擎选择器
├─────────────────────────────────────────┤   ← 唯一一条发丝分隔线
│ ✦  用 AI 模式搜索「chrome」      Ctrl ↵ │   ← 固定首行
├─────────────────────────────────────────┤
│ 🕐  chrome extension manifest v3        │   ← 本地历史（最多 3 条）
│ 🕐  chrome devtools network             │
│ 🔍  chrome 下载                          │   ← 联想词（最多 6 条）
│ 🌐  https://github.com/                 │   ← 网址类联想
└─────────────────────────────────────────┘
```

三类图标都由**真实数据**驱动，不是装饰：

- 🕐 **本地历史** —— 存在 `chrome.storage.local`，只在本机。Google 的历史是账号级的、无 API，所以这里是自建的，只记录经本扩展发起的搜索。前缀匹配优先于子串匹配，排序在联想词之前（与地址栏一致）。
- 🌐 **网址类** —— 来自 Google `client=chrome` 返回的 `google:suggesttype` 字段（`"NAVIGATION"`）；Bing/DDG 不返回类型，退化为 URL 解析判定。
- 🔍 **搜索词** —— 其余情况。

**截图里的站点缩略图没有复刻**：那来自 Google 的实体数据，建议接口不返回，不伪造。

下拉的 `max-height` 由 JS 实测输入框下方的真实剩余空间决定，而非固定值——满列（1 AI + 3 历史 + 5 联想 = 9 行）在 1440×900 下只剩 7px 余量，固定值在 1280×720 上必然越界。断言覆盖 1440×900 / 1280×720 / 1366×768 三档。

---

## 核心：为什么时钟不跳变

这是本项目唯一真正的技术难点。原始需求是「秒数变化时整个时间跟着跳」。

实测根因：**Inter 字体的数字宽度差异极大**。以 200px 字号实测，`000000` = 724.813px，而 `111111` = 456.453px，**相差 268.4px**。居中布局下，秒数 `09→10` 会让整串宽度骤变，整行左右平移。

修复按六类成因分别处理：

| 成因 | 解法 | 是否无条件成立 |
|---|---|---|
| **① 比例字宽横向抖动** | 防线1：`font-variant-numeric: tabular-nums` + `'tnum' 1`。实测 Inter 的 48KB latin 子集**保留了** tnum 特性，等宽下 `000000` 与 `111111` 均为 775.203px | 依赖字体支持 |
| **① 结构性兜底** | 防线2：每个数字装进 `flex: 0 0 0.68em` 定宽槽位。槽宽只由 `font-size` 决定，与字形宽度、tnum 是否生效、字体是否加载**完全无关** | **✅ 数学上恒为 0** |
| `1ch` 陷阱 | `1ch` = `0` 的宽度 = 0.6309em，比最宽的 `4`（0.646em）还窄 2.3%，用它会溢出。故取 0.68em | ✅ |
| **② 首屏空白再填入（CLS）** | `useState(() => snapshot())` 同步取值，首帧即完整时间；行高宽度显式预留；`newtab.html` 内联底色防白闪 | ✅ |
| **②b 字体 FOUT 换字** | `font-display: block` + `<link rel=preload>`，避免先用系统字体再换字导致的一帧变形 | ✅ |
| **③ 计时器漂移 / 丢秒** | 自校正 `setTimeout`：每轮重算 `1000 - (Date.now() % 1000) + 8`；`visibilitychange`/`focus`/`pageshow` 重同步。每次都 `new Date()`，无累加状态 | ✅ |
| **④ React 无谓重排** | `Digit`/`DigitPair`/`Colon` 全 memo；值未变时返回原引用让 React 整棵跳过；`contain: layout style` | ✅ |
| **⑤ 背景图 reflow** | 双层 `absolute` + `object-fit: cover`，图片尺寸永不参与布局；`decode()` 后再切换 | ✅ |
| **⑥ 可变字体轴 / 亚像素** | `font-optical-sizing: none` 冻结 opsz 轴；`font-kerning: none`；`text-rendering: geometricPrecision` | ✅ |

隐藏秒后行宽从 876.094px 变为 565.344px —— 这是用户主动操作的结果，不是抖动；两种布局下的「运行中不动」保证同样成立，各有独立断言。

---

## 验证

```bash
npm run verify       # 静态模式：像素级几何断言 + 设置 UI（约 30 项）
npm run verify:ext   # 扩展模式：真机加载，CSP / 缓存 / 网络 / 署名（约 30 项）
```

静态模式用 Playwright 的虚拟时钟（`page.clock`）确定性地跳到每个边界秒，不等真实时间：

- **8 个边界用例**：`11:11:11`（全窄 1）、`00:00:00`、`14:44:44`（最宽字形）、`09→10`、`19→20`、分钟进位、小时进位、跨天
- **38 帧断言**：整行 `{x, y, w, h, right, bottom}` 与 8 个槽位的 `{x, w}` 保留 3 位小数，跨所有帧完全相同
- **字体自检**：比例数字下 `000000` 与 `111111` 宽度必须**不等**（证明问题真实存在），等宽下必须**相等**（证明 tnum 生效）
- **模糊扫描**：0/1/8/17/26/33/40px 全程背景几何必须恒定
- **菜单包含性**：枚举所有后代元素，任何一个越出面板边界即失败

扩展模式覆盖静态模式测不了的部分（三个搜索建议端点都无 CORS，只有扩展态能拿到）。

### 验证过程中真实抓到的缺陷

这些都是肉眼看不出、靠断言发现的：

1. **Tailwind preflight 的 `img { max-width: 100% }`** 把背景图层的 `width: calc(100% + 224px)` 夹回了视口宽度 —— 出血只在纵向生效，左右两侧的模糊羽化边会露出来。修法：`max-width: none`。
2. **Lightning CSS 丢弃了标准的 `backdrop-filter`**，只保留我手写的 `-webkit-` 前缀版。去掉手写前缀后工具链正确输出标准属性（5 处，0 个前缀）。
3. **下拉列表被视口底部截断**：搜索框位于居中列底部，下方仅约 190px，装不下 8 行候选。修法：候选上限降到 6 + `.stage:has(.search.is-open)` 聚焦时整列上移 10vh + `max-height` 兜底。
4. **模糊出血量随模糊半径变化**导致背景跟着缩放平移 —— 图层是 `object-fit: cover`，尺寸一变就重新计算覆盖缩放。修法：出血量改为按 `BLUR_MAX` 一次性算定的常量。

---

## 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 框架 | React 19.3.1 + TypeScript 5.9.3 | 新标签页就是普通 HTML 页面，不受 MV3「禁远程代码」限制（那条针对从 CDN 拉脚本）。首屏约 78KB gzip，换来后续加组件时不必自造状态管理 |
| 构建 | Vite 8.3.5 + Tailwind 4.3.3 | Tailwind v4 只需 `@tailwindcss/vite` + 一行 `@import "tailwindcss"`，无需 config 文件 |
| TypeScript | 锁 `~5.9.3` | latest 是刚发布的 7.0.2 原生移植版，不拿新项目试水 |
| 不用 @crxjs | — | v1 只有 1 个页面、0 content script、0 service worker，用不上它的 HMR 价值，却是最大单点故障源。README 记为后续升级路径 |
| 时钟字体 | Inter 可变字体 latin 子集（48,256 B） | 内置真·等宽数字（tnum），有 Light/Thin 字重 |
| 日期字体 | Noto Sans SC 子集化到 21 字形（13,280 B） | `0-9` + `年月日星期` + `一二三四五六`，保留 300–700 可变字重轴。完整字体 17.7MB，压掉 99.925%。数字与汉字同源，Windows/macOS 观感一致 |
| 日期字重 | 500 Medium | 16–24px 下汉字用 300 字重时横笔不足 1 物理像素，Windows ClearType 会发糊 |
| 天气 | Open-Meteo | **无需 API key** —— 任何打进客户端的 key 都能被读出，无 key 直接消除暴露面。且带 CORS 头，`npm run dev` 下也能用 |
| 图标 / 兜底壁纸 | 零依赖手写 PNG 编码器 | `sharp`/`canvas` 要拉几十 MB 平台原生二进制，为几个图形不值得。PNG 容器很简单，`node:zlib` 已完成压缩 |
| 字体子集化 | `subset-font`（harfbuzz WASM） | 本就是 JS 项目，不该为此引入 Python 工具链 |

### 目录

```
quiet-tab/
├─ newtab.html              入口（内联首帧底色 + font/image preload）
├─ vite.config.ts           MV3 CSP 相关构建配置
├─ public/
│  ├─ manifest.json         MV3 清单
│  ├─ fonts/                两个子集字体 + 各自 OFL 许可
│  ├─ images/               程序化生成的兜底壁纸 + 来源说明
│  └─ icons/                16/48/128 PNG
├─ scripts/
│  ├─ lib/png.mjs           PNG 编码器 + 高斯模糊
│  ├─ make-icons.mjs        SDF 绘制图标
│  ├─ make-fallback-bg.mjs  生成雾山兜底图
│  ├─ make-date-font.mjs    Noto Sans SC 子集化
│  ├─ sync-font.mjs         Inter 落盘
│  └─ verify-clock.mjs  ★   1372 行验证脚本
└─ src/
   ├─ components/           Clock Digits Background SearchBox Weather WeatherIcon ContextMenu Credit
   ├─ hooks/                useClock useSettings useWallpaper useWeather useSuggest
   ├─ lib/                  time search weather types env storage imageCache providers/
   └─ styles/main.css       全部样式，含逐条成因注释
```

---

## 权限

```json
"permissions": ["storage"],
"host_permissions": [
  "https://www.bing.com/",              // Bing 每日壁纸
  "https://api.unsplash.com/",          // Unsplash 图片列表
  "https://images.unsplash.com/",       // Unsplash 图片字节
  "https://suggestqueries.google.com/", // Google 搜索建议
  "https://api.bing.com/",              // Bing 搜索建议
  "https://duckduckgo.com/"             // DuckDuckGo 搜索建议
]
```

几个刻意的决定：

- **没有 service worker**。已实测确认：扩展页持有 `host_permissions` 时可直接跨域 fetch，不需要后台脚本中转。少一个文件、少一次唤醒延迟。
- **没有 `content_security_policy`**。MV3 默认策略 `script-src 'self'; object-src 'self'` 已足够，且默认不限制 `img-src`/`connect-src`。
- **没有 `contextMenus` 权限**。右键菜单在页面内实现 —— 原生 API 会把条目加进 Chrome 自己的菜单，还装不了滑块和城市搜索。
- **Open-Meteo 不在列表里**。它返回 `Access-Control-Allow-Origin: *`，靠 CORS 即可访问，无需申明 —— 少一条安装警告。
- 三个搜索建议端点**都没有** CORS 头（已实测），所以必须申明。它们也是未公开的非官方端点，提供方可随时改动或限流，故任何失败都静默降级为「无候选」。

---

## 安全：关于 Unsplash API Key

**Access Key 会被打进 bundle，任何人解压扩展或打开 DevTools 都能读到。** 这是纯前端应用的固有限制，不是配置问题。`.env.local` 被 gitignore 只能防止误提交到仓库，防不住产物泄漏。

要真正隐藏，必须自建代理服务端转发 —— 这也是 Bonjourr 的做法（它有独立的 `bonjourr-apis` 仓库）。

本项目**只使用 Access Key**。Unsplash 的 Secret Key 仅用于 OAuth 用户授权流程（代表用户点赞、上传等），本项目完全不需要，代码中从未出现。

配置方式见 `.env.example`。留空则自动降级到 Bing 图源。

Demo 版配额 **50 请求/小时**。故采用批量拉取（一次 12 张）+ Cache Storage 字节缓存 + 按天作用域，实测第二次开标签页对外请求数为 **0**。

---

## 授权

| 资产 | 授权 | 说明 |
|---|---|---|
| Inter | SIL OFL 1.1 | `public/fonts/Inter-OFL-LICENSE.txt` |
| Noto Sans SC | SIL OFL 1.1 | `public/fonts/NotoSansSC-OFL-LICENSE.txt`，子集同样受 OFL 约束 |
| `fallback-bg.png` | 程序化生成，无第三方权利 | `scripts/make-fallback-bg.mjs`，非衍生于任何照片 |
| Bing 每日图 | **不打包** | Bing 条款限「仅用作桌面壁纸」，打包进软件分发不干净。运行时抓取并缓存在用户本机 |
| Unsplash 图 | Unsplash License，**需署名** | 其 API 条款强制要求可见署名并链回摄影师与 Unsplash，且用图时须 ping `download_location`。两者均已实现；Bing 源下不显示署名（无此要求） |

---

## 开发

```bash
npm run dev        # localhost:5173，改样式最快
npm run build      # typecheck + 产物
npm run verify     # 像素级验证
npm run verify:ext # 扩展态验证
npm run assets     # 重新生成图标 / 兜底图 / 日期字体
npm run typecheck
```

### dev 模式下的已知差异

`npm run dev` 走 `http://localhost`，受 CORS 限制，所以：

- **不会显示 Unsplash / Bing 实拍壁纸** —— 只显示内置雾山兜底图
- **不会有搜索候选** —— 三个端点都无 CORS 头
- **天气正常工作** —— Open-Meteo 有 CORS

这是刻意的环境门禁（见 `src/lib/env.ts`），避免 dev 控制台被失败请求刷屏、也让验证结果确定。要看完整效果请 `npm run build` + 加载扩展。

### 后续升级路径

真要加 service worker、content script 或独立设置页时，再引入 `@crxjs/vite-plugin`（3.0.0 已标注原生支持 Vite 8）换取扩展内 HMR。目前单页面结构下它带来的收益小于风险。

---

## 当前不做

商店发布、12 小时制、模拟时钟表盘、快捷链接 Dock、问候语、农历节气、待办清单、多语言、Firefox/Edge 产物。
