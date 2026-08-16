# dsh-session-caption

[English](README.md)

为 DeepSeek Harness（dsh）提供**两阶段会话题词**（自动命名）：会话进行中先用关键词即时生成标题，空闲后再调用最经济的模型精修。全程后台运行，不打断主流程，不为标题多花一分冤枉钱。

```
用户发消息 ──► [阶段一] 关键词即时题词（零成本、毫秒级）
                   │
                   └─► 会话空闲 5 秒 ──► [阶段二] 预算模型精修 + 一句话摘要
                                              │
                                              └─► 写入 session/title（可追溯）
```

## 解决的问题

Harness 的新会话默认只有时间戳编号，长会话列表中难以分辨。已有方案要么只做「等空闲再生成」（用户等待期间没有标题），要么每轮都调用模型（成本高）。本插件把两个思路拆成互补的两段：

- **阶段一 · 即时题词**：用户消息一落地，立即从最新消息提取关键词，标题几乎零延迟出现，**不调用任何模型**；
- **阶段二 · 空闲精修**：会话安静下来后，用一次辅助调用把标题从「关键词串」升级为通顺的短语，并顺带产出**一句话会话摘要**（同一请求内完成，不额外计费）；
- **成本护栏**：精修默认只使用注册模型中最便宜的一档（`flash`/`haiku`/`mini` 等），可显式指定模型，也可完全关闭阶段二。

## 功能特性

- **两阶段流水线**：即时关键词题词 → 空闲预算模型精修，标题随会话演进；
- **成本控制**：预算路由按名称模式从已注册模型目录中挑选最便宜模型并缓存，模型拓扑变化自动失效；
- **原创关键词算法**：噪声剥离（代码块/URL/Markdown）→ 脚本检测（拉丁/CJK）→ 停用词与虚词过滤 → 词序保持/字符预算截断，中英日韩均可用；
- **多语言**：标题语言跟随消息语言，拉丁标题按词数、CJK 标题按字符数控制长度；
- **标题去重**：同一标题不重复写入；跨会话重名时自动追加编号后缀（`Fix Login Bug (2)`）；
- **摘要联动**：精修时顺带生成一行会话摘要，以 `session/caption-note` 事件写入会话日志，供列表 UI、导出工具等消费；
- **尊重人工标题**：用户手动改名后自动生成完全停止，绝不覆盖（包括精修调用进行中的改名，也不会被回写）；
- **零配置可用**：默认值即可运行，全部行为可调。

## 安装

### 在 DSH 中安装（从 GitHub）

从 GitHub 安装最新版本到 profile：

```sh
dsh plugin --profile demo add github:JohnXu22786/session-titler
```

移除：

```sh
dsh plugin --profile demo remove dsh-session-caption
```

本插件是一个标准 dsh **bundle**（配置层 + 插件代码），通过 `dsh plugin` 安装到 profile：

```sh
# 从本地目录安装（开发/自用）
dsh plugin --profile web add /path/to/dsh-session-caption

# 或打包后安装（tarball / git 引用同理）
npm pack
dsh plugin --profile web add ./dsh-session-caption-0.1.0.tgz
```

安装时 pnpm 会把包链入 profile 的 `node_modules`，`dsh` 识别 `package.json` 中的 `dsh.bundle` 声明，将 `cordis.patch.yml` 层加入 `dsh.profile.bundles`。重启后生效：

```sh
dsh --profile web --dump-config   # 应能看到 "session-caption" 行
dsh web
```

### 加载原理（给 harness 开发者）

1. **Bundle 清单**：`package.json` 中 `dsh.bundle.patch` 指向 `cordis.patch.yml`——这是 bundle 唯一必需的元数据；
2. **配置层**：`cordis.patch.yml` 先按行 id 停用内置的单阶段标题提供方（会话标题服务同一时刻只接受一个提供方），再插入本插件的配置行；
3. **入口文件**：`lib/src/index.js` 导出标准 Cordis 插件契约——`name`（`session-caption`）、`inject`（`['sessionTitle', 'sessions', 'llm']`）、`Config`（schemastery 校验 schema）、`apply(ctx, config)`；
4. **能力注册**：`apply` 中把两阶段流程注册为 `ctx.sessionTitle` 的**唯一提供方**（`automatic: 'all-user-messages'`），同时监听 `session/event` 与 `llm/adapters-updated`；所有监听器、定时器、注册项随插件卸载自动回收。

> 注意：`session-title` 服务是单提供方设计。若其他插件也注册了标题提供方，二者会互相取代；本插件的 bundle 层默认已停用内置的 `session-title-llm` 行。

## 配置

所有字段可选，默认值见下。全局配置写入 `$DSH_HOME/cordis.patch.yml`，按行 id 覆盖：

```yaml
# $DSH_HOME/cordis.patch.yml（home 级，作用于所有 profile）
- id: session-caption
  config:
    instant:
      enabled: true        # 阶段一开关
      prefix: ''           # 即时题词前缀，如 '⚡ '
      maxWords: 6          # 拉丁标题最大词数
      maxCjkChars: 14      # CJK 标题最大字符数
    refine:
      enabled: true        # 阶段二开关
      maxWords: 5          # 精修标题目标词数（拉丁）
      maxCjkChars: 10      # 精修标题目标字符数（CJK）
      maxInputBytes: 4096  # 精修输入消息字节上限（JSON 框架后）
      maxOutputTokens: 64  # 精修输出 token 上限
      timeoutMs: 60000     # 精修单次调用超时
    budget:
      preferCheap: true    # 只从低成本模型目录挑选
      # patterns: [...]    # 低成本模型名称模式（按性价比排序）
    summary:
      enabled: true        # 摘要联动开关
      maxChars: 120        # 摘要最大字符数
    timing:
      idleDelayMs: 5000    # 空闲判定延迟（精修触发点）
      activityWindowMs: 1500  # 事件后的活跃窗口
      modelCacheMs: 120000    # 预算路由缓存时长
    model:
      provider: ''         # 显式精修路由（与 model 成对）
      model: ''            # 如 deepseek-official / deepseek-v4-flash
    dedup:
      enabled: true        # 标题去重（同标题跳过 + 跨会话编号）
      suffix: '({n})'      # 编号后缀模板，必须含 {n} 占位符（从 2 起）
    debug: false           # 调试日志
```

> 关闭 `instant.enabled` 后，阶段一不再产出关键词标题，但阶段二依然只在**空闲窗口**运行（忙碌期间的自动生成请求被跳过，标题等会话安静后由定时器驱动生成），不会变成「每条消息都调用模型」。

### 模型选择优先级（阶段二）

1. `model.provider` + `model.model` 显式配置；
2. `budget.preferCheap` 开启时，扫描所有可配置提供方的模型目录，按 `budget.patterns` 中的模式名匹配并取最优（默认顺序：`flash` → `haiku` → `lite` → `mini` → `nano` → `fast` → …，同档取名字最短者），结果缓存 `timing.modelCacheMs`；
3. 会话自身的模型路由（`request.route`）；
4. 都不可用时跳过精修，保留即时题词。

## 接口

### 提供方（Provider）

注册于 `ctx.sessionTitle`，`id` 为 `session-caption`，自动模式 `all-user-messages`：

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `id` | `session-caption` | 写入 `session/title` 事件的来源标识 |
| `automatic` | `all-user-messages` | 每条新用户消息触发一次生成 |
| `generate(request)` | — | 活跃 → 即时题词；空闲 → 精修 |

`generate` 输入 `{ session, messages, route?, signal }`，输出 `{ title, messageSeqs, model? }`。以下情况抛 `CaptionSkippedError`（服务端保留现有标题，不视为故障）：

- 用户已手动改名（`source.kind === 'user'`）；
- 即时阶段无可提取的关键词；
- 精修结果与当前标题相同（去重，同时标记会话为稳定，避免反复生成）；
- 无可用的模型路由。

### 事件

| 事件 | 类型 | 说明 |
| --- | --- | --- |
| `session/title` | log-only（Harness 自带） | 每次接受的标题快照，含来源与消息 seq |
| `session/caption-note` | log-only（本插件贡献） | 精修时的一句话摘要：`{ title, note, messageSeqs }` |

`caption-note` 与 `title` 一样不进入模型上下文；不识别该事件的回放器可安全跳过（信息性记录）。

### 目录结构

```
src/
├── index.ts       # 插件入口：name / inject / Config / apply
├── config.ts      # 配置 schema 与运行时校验
├── context.ts     # 结构化 Harness 上下文类型
├── flow.ts        # 两阶段编排（generate / 事件喂入 / 去重 / 摘要）
├── keywords.ts    # 阶段一：关键词题词引擎
├── refine.ts      # 阶段二：预算模型精修 + 摘要
├── budget.ts      # 成本路由：最便宜模型选择与缓存
├── pacemaker.ts   # 空闲节拍器：活动感知 + 精修定时
├── normalizer.ts  # 标题清洗、限长、比较
├── language.ts    # 拉丁/CJK 脚本检测
├── events.ts      # 自定义事件声明
└── errors.ts      # CaptionSkippedError：跳过的修订
```

## 开发

```sh
npm install     # 开发依赖（含 dev/pkgs 下三个转发包，file: 引用，可重装）
npm run typecheck   # tsc 类型检查
npm test            # vitest 单元与流程测试（86 例）
npm run build       # 编译到 lib/src/
```

> **运行时依赖说明**：插件在运行期使用 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-session-title`，它们由 dsh 安装本身提供，**未在 manifest 中声明为 dependencies/peerDependencies**——这三个包的 npm 传递依赖链目前不完整（一个传递包未发布），声明会导致安装失败；若装入不含这些包的自定义 profile，加载时会报 `ERR_MODULE_NOT_FOUND`，把包装进 profile 的 `node_modules` 即可。
>
> **本地开发镜像**：`stubs/` 目录是这三个包的最小 API 镜像（与发布版 rc.1 的已消费成员逐一核对）；`dev/pkgs/` 下是三个薄转发包（`file:` 依赖），供 tsc 解析与本地测试，不随插件发布（`files` 只含 `lib/src`、配置层与文档）。

## 许可

MIT — 见 [LICENSE](LICENSE)。
