# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Family Ledger (家庭记账) — a full-stack PWA for family expense tracking. Chinese-language UI. The primary user is non-technical.

- **Frontend**: React 19 + TypeScript + Vite 8, custom CSS (no component library)
- **Backend**: Python FastAPI (async) + SQLAlchemy 2.0 + aiosqlite
- **Database**: SQLite at `backend/family_ledger.db`, auto-created on startup
- **Python**: 3.14+ (venv at `backend/venv/`)

## Commands

### Backend
```bash
cd backend
# Activate venv (Windows Git Bash)
source venv/Scripts/activate
# Start server (port 8000)
PYTHONIOENCODING=utf-8 python -m uvicorn main:app --host 127.0.0.1 --port 8000 --app-dir .
# Or with auto-reload for development
PYTHONIOENCODING=utf-8 python -m uvicorn main:app --reload --port 8000
# Install dependencies
pip install -r requirements.txt
```

### Frontend
```bash
cd frontend
npm run dev      # Dev server on port 5173
npm run build    # TypeScript check + Vite production build
npm run lint     # ESLint
```

### Important notes
- `PYTHONIOENCODING=utf-8` is required on Windows to avoid cp1252 encoding errors with Chinese text
- Backend entry point is `main:app` (file is `backend/main.py`, NOT `app/main.py`)
- After adding new Python modules (routers, parsers), uvicorn `--reload` may not pick them up; kill the process and restart fresh
- Use `taskkill //F //PID <pid>` on Windows to kill stuck processes on port 8000
- Vite proxies `/api/*` to `http://localhost:8000` — frontend and backend run on separate ports

## Architecture

### Backend structure
```
backend/
  main.py                  # FastAPI app, lifespan (init_db + seed), router registration
  app/
    database.py            # Engine, async_session, init_db (creates tables + migration + member→tag migration)
                           #   init_db 步骤②兜底表含 payment_method_mappings
    models.py              # SQLAlchemy ORM: TagCategory, Tag, transaction_tags/account_tags/holding_tags,
                           #   FamilyMember(保留备用), Category, Transaction, Account, Holding,
                           #   ReimbursementRecord, reimbursement_items, PaymentMethodMapping,
                           #   RecurringRule, RecurringExecution,
                           #   AccountSnapshot(每月1日快照), HoldingSnapshot(持仓快照+risk_class字段)
    schemas.py             # Pydantic v2 request/response models（含 TagCategoryOut/TagOut/TagBrief/
                           #   RecurringRuleCreate/Update/Out/RecurringExecutionOut）
                           #   ⚠️ 字段名与类型名同名冲突：用 `from datetime import date as Date` alias 规避
                           #      例：ReimbursementItemOut.date 字段 type 写 Optional[Date] 而非 Optional[date]
    seed.py                # 默认分类（两层树：14 个支出父类 + 6 个收入父类，按用户自定义结构）
                           #   父分类 keywords 留空；子分类带关键词，仅服务支付宝/微信/PDF/通用 CSV
                           #   钱迹按分类名直接匹配，不依赖关键词
                           #   兜底：其他支出（顶层叶子）/ 其他收入（"退款报销"子分类）
    price_service.py       # Fund prices (eastmoney f10/lsjz), A-share prices (Tencent qt.gtimg.cn)
                           #   新增：fetch_fund_nav_on(code, date) 查历史净值（7 天窗口兜底非交易日）
                           #         search_fund_by_name(query) 按名称反查基金代码（Eastmoney fundsuggest）
    routers/
      tags.py              # /api/tags/categories CRUD + /api/tags/ CRUD + /archive /unarchive /move /delete
      categories.py        # /api/categories/ flat + /tree endpoint, supports parent_id
      transactions.py      # /api/transactions/ list + GET/{id}（编辑页用）+ POST + PATCH + DELETE
                           #   /summary/monthly, /summary/category（支持 tag_id 筛选）
      accounts.py          # /api/accounts/ CRUD, current_balance computed from linked transactions + holdings
                           #   ⚠️ 投资理财账户特殊处理：current_balance = sum(holdings.current_value)，
                           #   银行理财账户：余额逻辑同资金账户（balance + delta），不走持仓模型
                           #   不加 balance + delta，防止 transfer 流水与持仓市值双计
      holdings.py          # /api/holdings/ CRUD + /refresh, /refresh-all, /summary
                           #   新增 POST /{id}/redeem：拆出 transfer(成本) + income/expense(盈亏) 两笔交易，
                           #   减少对应份额；盈亏分类由调用方传 pnl_category_id
      imports.py           # /api/imports/parse (file upload), /save (batch insert, save 时才创建新标签)
                           #   parse 末尾聚合 distinct payment_method，查 payment_method_mappings 历史映射，
                           #   返回 account_mappings 列表（raw_name + account_id）并预填 ParsedTxnOut.account_id
                           #   parse 投资后处理：本地 holdings 名称 substring 匹配 → 未命中时 Eastmoney 反查候选
                           #   save 末尾 upsert payment_method_mappings（account_id=None 的项跳过不写）
                           #   save 同时接收 reimbursements 列表，按 external_id 跨批次关联原账单
                           #   save 投资买入：fetch_fund_nav_on 查账单日净值 → 更新 shares/cost_price（加权平均）
                           #   save 当场建仓：target_holding_id 为空但 new_holding_code 非空时先建 Holding
      reimbursements.py    # /api/reimbursements/ CRUD：pending list / create / delete(revoke)
      stats.py             # /api/stats/ 统一统计路由（核心模块）
                           #   GET /monthly-summary — 月度摘要（收入/支出/结余 + 环比/同比）
                           #   GET /category-breakdown — 分类汇总（支持 member_id，含子分类）
                           #   GET /member-breakdown — 成员排行（保留给首页等场景）
                           #   GET /tag-breakdown — 标签分组汇总
                           #   GET /top-merchants — TOP 商户
                           #   GET /annual — 年度报表（月度趋势 + 分类汇总 + 成员汇总）
                           #   GET /daily-report — 日报（每日收支 + 转账笔数，不含无交易天）
                           #   GET /drill-down — 下钻账单（支持 category_id/tag_id/counterparty/member_id/day，
                           #     month 可选=年度下钻，type 可选=不限类型）
                           #   GET /allocation — 资产配置（按 risk_class 汇总）
                           #   POST /snapshots/take — 手动触发快照
                           #   GET /networth-trend — 净资产趋势（基于快照表）
                           #   ⚠️ 所有端点均支持 member_id 过滤（None=全部，-1=未指定，>0=指定成员）
                           #   ⚠️ 有效金额：expense 类型自动扣除已报销部分
      recurring.py         # /api/recurring-rules/ CRUD + executions 查询
                           #   POST/PATCH 创建/修改规则后立即检查今天是否匹配，匹配则当场生成首笔交易
    parsers/
      base.py              # ParsedTransaction dataclass（含 payment_method/tags/source_category_name/
                           #   source_parent_category_name），BaseParser ABC。Transaction 已无 note 字段
                           #   新增投资字段：detected_action("buy"/"sell"/""）、detected_asset_type、
                           #   detected_name（基金名）、detected_code、target_holding_id
      alipay.py            # Alipay CSV (GBK encoding), extracts 收/付款方式
                           #   解析后调用 apply_detection(t, "alipay")：蚂蚁财富买入/赎回 → type=transfer
      wechat.py            # WeChat xlsx (openpyxl, header at row 16), extracts 支付方式
      bank_pdf.py          # CMB bank PDF (pdfplumber word-level coordinate extraction)
                           #   解析后调用 apply_detection(t, "bank_pdf")：基金申购/赎回关键词识别
      qianji.py            # Qianji app CSV (UTF-8 BOM)；description=备注列（首页直接显示），
                           #   分类名走 source_category_name/source_parent_category_name 由 categorizer 直接按名匹配
                           #   类型=报销 → expense+is_reimbursable；类型=报销记录 → ParsedReimbursement
      generic_csv.py       # Fallback CSV parser
      categorizer.py       # 优先级：source_category_name 直接按名匹配 → Category.keywords 关键词 → 兜底其他支出/收入
      investment_detector.py  # 识别投资买入/赎回：detect_investment() 各 source 各自规则；
                           #   apply_detection() 原地修改 ParsedTransaction（type→transfer，写 detected_* 字段）
                           #   支付宝规则：counterparty/description 含"蚂蚁财富" + regex 提取基金名+动作
                           #   ⚠️ A/C 类后缀必须保留（"联接C" ≠ "联接A"，不同基金代码）
```

### Frontend structure
```
frontend/src/
  api.ts                   # Axios client, all TypeScript interfaces, all API call functions
                           #   含 TagCategory / Tag / TagBrief；tagApi 完整 CRUD
  App.tsx                  # React Router routes + TabBar (5 tabs: 首页/统计/+/投资/设置)
                           #   /recurring 等二级页面隐藏 TabBar
  pages/
    HomePage.tsx           # Monthly summary + transaction list + detail bottom sheet
                           #   列表：左 icon | 中（分类名 / 备注·成员）| 右（金额 / 账户）
                           #   详情页底部三个按钮：关闭 / 编辑（跳 /add?id=） / 删除
    AddPage.tsx            # 记账 + 编辑（同一页面，?id= 参数进入编辑模式，加载交易→预填→PATCH）
                           #   备注→description，无独立 note 字段，标签多选
                           #   账户选择器按成员分组展示，避免大量账户堆积
    StatsPage.tsx          # 统计驾驶舱 — 四 tab：月度 / 年度 / 资产 / 配置
                           #   月度：环形图 + 分类(下钻子分类)/日报(MM-DD 每日明细)/标签/TOP商户 四 sub-tab
                           #   年度：环形图 + 柱状图(图例 toggle) + 分类汇总(下钻) + 月报表
                           #   资产：净资产卡片 + 资产构成饼图 + 资产/负债账户列表
                           #   配置：净资产趋势 + 资产配置现状饼图 + 手动快照按钮
                           #   全局成员筛选 chip 栏：全部/各成员/未指定，月度/年度/资产全部联动
                           #   全视图下钻：分类→子分类→账单列表→详情弹窗(编辑/删除)
                           #   子组件 memo 优化，防止下钻时图表重渲染
    InvestPage.tsx         # Investment holdings, price refresh, add/edit modal（持仓支持标签）
                           #   每张持仓卡增加「赎回」按钮（shares=0 时点击弹提示，不 disabled）
                           #   RedeemModal：输入到账日期/账户/金额/份额，实时显示成本基础和盈亏，
                           #   勾选"记盈亏"时选对应收入/支出分类（默认"基金收益"/"基金亏损"等）
                           #   新建持仓时隐藏「理财」资产类型（编辑已有理财持仓时仍显示）
    SettingsPage.tsx       # 标签管理（TagCategory/Tag CRUD）+ 账户管理（Logo 图标 + 成员分组 + 标签）+ 分类管理
                           #   + 导入账单入口 + 报销管理入口 + 分类管理入口 + 周期记账入口
                           #   账户按大类→成员二级分组展示；图标支持 PNG Logo（招行/工行/建行/中信/银河/支付宝/微信/雪球）
    ImportPage.tsx         # 三步流程：select（上传）→ mapping（账户映射）→ preview（预览确认）→ save
                           #   mapping step：列出账单 distinct payment_method，每行选对应 APP 账户；
                           #     后端已记忆的项显示"已记忆"徽标，首次出现显示"新"；
                           #     全部已记忆时自动跳过 mapping 直接进 preview；
                           #     updateMapping() 副作用：同步更新所有同 payment_method 的非转账交易 account_id
                           #   preview 顶部小横幅显示映射覆盖率，点"修改映射"可回到 mapping step
                           #   批量标签：选中即实时显示，取消即实时移除（虚拟叠加模式）
                           #   钱迹标签：绿色 tag_names 字符串展示，save 时后端才落库
                           #   钱迹报销：预览页底部独立分组显示"报销到账记录"，save 时一并提交
                           #   投资交易：detected_action 非空时显示橙色"📈/📉"badge + 持仓选择器
                           #     三种状态：本地命中（绿色 chip）/ Eastmoney 候选（黄色下拉）/ 无候选（红色警告）
                           #     保存前校验：有未关联持仓的投资交易时弹 confirm 提示
                           #     保存后 alert 显示 holdings_updated/holdings_created/holdings_warnings
    ReimbursementPage.tsx  # 报销管理（/reimbursements）：未报/已报/全部 三 tab
                           #   未报：勾选多笔 → 批量提交弹层（日期/账户/实收金额/备注）→ 创建 ReimbursementRecord
                           #   已报：列表 + 点开详情 → 显示关联原账单 + 撤销按钮
    RecurringPage.tsx     # 周期记账（/recurring）：规则列表卡片 + 新增/编辑底部弹窗
                           #   字段：类型/分类/账户/金额/周期(每周/每月)/开始日期/结束方式/成员/标签
                           #   样式：form-page + page-header + back-btn，对齐 CategoryPage
```

### Key patterns

#### 标签系统
- **两层结构**：`TagCategory`（分组）→ `Tag`（标签），Tag.name 全局唯一
- **多对多关联表**：`transaction_tags / account_tags / holding_tags`（均带 CASCADE DELETE）
- **标签状态**：正常 / 归档（选择器不显示，但历史关联保留）/ 删除（从所有关联摘除）
- **⚠️ 关键：async SQLAlchemy 中禁止用 `obj.tags = [...]` 赋值**，会触发 lazy-load 导致 `MissingGreenlet` 500 错误。所有标签写入必须直接操作关联表：
  ```python
  await db.execute(sa_delete(transaction_tags).where(...))
  await db.execute(sa_insert(transaction_tags).values(...))
  ```

#### 导入流程（含标签 + 账户映射）
- **parse 阶段**：不创建任何标签，只返回 `tag_names: list[str]`（钱迹原始字符串）；同时查 `payment_method_mappings` 返回历史账户映射并预填 `account_id`
- **mapping 阶段**（前端独立 step）：用户为每个 payment_method 选对应 APP 账户；全部已记忆时自动跳过
- **preview 阶段**：钱迹标签显示为绿色字符串 pill；其他来源支持批量标签（虚拟叠加）+ 单条追加
- **save 阶段**：`_resolve_tag_names()` 在此时才真正建库（已存在→直接用，归档状态不变；不存在→创建到"导入标签"分类）；同时 upsert `payment_method_mappings`（account_id=None 的条目跳过）
- 批量标签在保存时与单条 tag_ids 合并去重后提交

#### 账户映射记忆（PaymentMethodMapping）
- 表 `payment_method_mappings`：字段 `source`（alipay/wechat/bank_pdf/qianji/generic） + `raw_name`（原始账户名，bank_pdf 用空字符串 `""`）+ `account_id`，UNIQUE(source, raw_name)
- **按 source 区分**：同名字符串在不同来源语义可能不同（如"零钱"在微信 vs 钱迹），独立映射避免污染
- **空 payment_method**：bank_pdf 等无支付方式的账单，统一用 `""` 作 key，前端渲染为"📄 整本账单（未标注支付方式）"
- **普通转账**：type='transfer' 且 detected_action 为空时跳过映射（双账户由启发式处理）
- **投资转账**：type='transfer' 且 detected_action 非空时**纳入映射**（FROM 端是资金账户，需要 payment_method→account_id 映射）
- **账户删除**：`ON DELETE SET NULL`，下次 parse 时该 raw_name 的映射 account_id 返回 None，显示"未关联"

#### 投资账户模型
- **投资理财账户 current_balance**：`= sum(绑定持仓的 current_value)`，**不**加 `balance + 流水 delta`。原因：transfer 买入后资金逻辑上立刻变成持仓成本，由持仓市值接管，两者叠加会双计。
- **买入**：`type=transfer`，资金账户 → 投资理财账户；save 时查账单日历史净值自动算份额（加权平均 cost_price）
- **赎回/卖出**：`type=transfer`，投资理财账户 → 资金账户（成本部分）+ 盈亏记 income/expense
- **基金代码识别**：账单（支付宝）只有名称，无代码。流程：① 本地 holdings 名称 substring 匹配；② 未命中则 Eastmoney fundsuggest 反查候选（最多 5 条）；③ 用户在预览页确认后当场建仓（new_holding_code 传给 save 端）
- **股票份额**：本轮不自动算（腾讯接口无法查历史价）；识别为 transfer 但份额由用户事后手动调整
- **seed 分类**：income 新增「基金收益」「股票收益」「理财产品收益」；expense 新增「基金亏损」「股票亏损」「投资亏损」

#### 其他模式
- **Categories are hierarchical**: `parent_id` enables two-level nesting. `/api/categories/tree` returns tree structure; flat `/api/categories/` used for dropdowns.
- **Transaction types**: `expense` / `income` / `transfer`. Transfer records both `account_id` (from) and `to_account_id` (to).
- **Account balance**: `Account.balance` is the user-set initial balance. `AccountOut.current_balance` 动态计算，分两种情况：普通账户 = `balance + 流水 delta + 报销到账`；**投资理财账户** = `sum(绑定持仓市值)`（不加流水 delta，见"投资账户模型"章节）。
- **AddPage 记账/编辑**：只有一个"备注（可选）"输入，映射到 `description` 字段（用于列表显示）。**Transaction.note 字段已删除**，所有账单备注统一存 `description`（手动 + 导入）。Account/Holding/ReimbursementRecord 的 `note` 字段保留（设置页/投资页/报销页仍在用）。
- **Smart categorization**：分三级优先：(1) ParsedTransaction 的 `source_category_name` / `source_parent_category_name` 在 Category 表里按 type+name 直接查（钱迹走这条）；(2) `Category.keywords` 关键词匹配 description + counterparty；(3) 兜底"其他支出"/"其他收入"。导入时如果 ParsedTransaction.category_id 已被解析阶段设过，categorizer 不会覆盖。
- **DB migration**: `database.py:init_db()` 分三步：① `Base.metadata.create_all`（新表）→ ② `CREATE TABLE IF NOT EXISTS` 显式兜底（防止旧 DB 漏建新表，目前含 `reimbursement_records` / `reimbursement_items` / `payment_method_mappings`）→ ③ `ALTER TABLE ADD COLUMN` + try/except 增量加列。`_migrate_members_to_tags()` 将旧 FamilyMember 数据迁移到 TagCategory/Tag（幂等，tag_categories 表非空时跳过）。
- **Price service**: Synchronous HTTP calls wrapped in `asyncio.run_in_executor`. Fund: eastmoney f10/lsjz；Stock: Tencent qt.gtimg.cn（600xxx→sh, 000xxx/300xxx→sz）。
- **Async relationship loading**: READ 时用 `selectinload()`；WRITE 时直接操作关联表（见上方标签系统说明）。

#### 账户图标系统（BankIcon）

- **Account.icon 字段**：`String(10)`，支持两类值：
  - **Logo key**：`cmb`/`icbc`/`ccb`/`citic`/`galaxy`/`alipay`/`wechat`/`xueqiu` → 渲染对应 PNG 图片（`/logos/{key}.png`）
  - **Emoji**：直接作为文本渲染（向后兼容已有账户）
- **BankIcon 组件** (`frontend/src/components/BankIcon.tsx`)：
  - `<BankIcon icon={a.icon} size={24} />` — JSX 渲染（SVG 已替换为真实 PNG）
  - `getIconText(icon)` — 返回纯文本表示（logo → 中文缩写，emoji → 自身），用于 `<option>` 等不能放 `<img>` 的场景
  - `LOGO_ICONS` — 导出 logo key 数组供图标选择器使用
- **Logo 图片**：存放在 `frontend/public/logos/`，Vite 构建时直接复制到 `dist/`
- **图标选择器**（SettingsPage 弹窗）：Logo 区（8 个 PNG 预览按钮）+ Emoji 区（13 个通用图标）

#### 周期记账系统
- **RecurringRule**：循环交易规则，字段含 `recurrence_type`（weekly/monthly）、`recurrence_day`（1-7 或 1-31）、`start_date`、`end_type`（never/date/count）、`end_date`、`max_count`、`executed_count`、`is_active`，以及交易模板字段（type/category_id/account_id/to_account_id/amount/member_id/description/tag_ids_json）
- **RecurringExecution**：记录每次循环生成的交易（rule_id + target_date + transaction_id），UNIQUE(rule_id, date) 防重复
- **调度**：每天 00:05（Asia/Shanghai）`process_recurring_rules()` 扫描活跃规则 → 匹配 `_matches_today()` → 去重 → 创建 Transaction（source="recurring"）+ RecurringExecution → 更新 executed_count
- **即时执行**：POST/PATCH 创建/修改规则时，如果当天满足条件，**立即生成**首笔交易（不等调度器）
- **开机补漏**：`startup_backfill_recurring()` 在 lifespan 中 `asyncio.create_task` 后台运行
- **修改只影响未来**：已生成的 Transaction 是独立记录，修改规则不会回溯修改历史账单
- **月底短月处理**：monthly recurrence_day=31 在 2/4/6/9/11 月自动跳过（`calendar.monthrange` 判断）
- **生成交易与手动无区别**：均可编辑、删除、参与统计，仅 `source="recurring"` 标记来源

#### 报销系统
- **Transaction 新增字段**：`is_reimbursable: bool`、`reimbursable_amount: float`、`reimbursement_status: str`（none/pending/done）、`external_id: str`（钱迹行 ID，跨次导入去重 + 关联）
- **ReimbursementRecord**：报销到账记录，字段 date/to_account_id/total_amount/note/source/external_id
- **reimbursement_items**：多对多关联表（record_id + transaction_id + amount），一条报销记录可关联 N 笔原支出
- **统计口径**：可报销支出按 `max(0, amount - reimbursable_amount)` 计入报表（过报销记 0），非可报销按 amount 全额计入
- **账户余额**：报销到账金额计入 `to_account_id` 的 `current_balance`（在 accounts 路由聚合）
- **⚠️ reimbursement_items 写入**：与 transaction_tags 同理，直接用 `sa_insert(reimbursement_items).values(...)` 操作关联表，禁止 ORM relationship 赋值

### Data model relationships
- PaymentMethodMapping → Account (FK via account_id, ON DELETE SET NULL)
- Transaction → Category (FK), Transaction → Account (FK via account_id), Transaction → Account (FK via to_account_id)
- Transaction ↔ Tag (many-to-many via transaction_tags)
- Transaction ↔ ReimbursementRecord (many-to-many via reimbursement_items)
- Account ↔ Tag (many-to-many via account_tags)
- Holding ↔ Tag (many-to-many via holding_tags)
- Holding → Account (FK via account_id，投资理财账户绑定)
- ReimbursementRecord → Account (FK via to_account_id，到账账户)
- Tag → TagCategory (FK)
- Category → Category (self-referential via parent_id, no ORM relationship — tree built in router)
- RecurringRule → Category (FK), RecurringRule → Account (FK via account_id), RecurringRule → Account (FK via to_account_id), RecurringRule → FamilyMember (FK)
- RecurringRule → RecurringExecution (one-to-many, CASCADE DELETE)
- RecurringExecution → Transaction (FK via transaction_id, ON DELETE SET NULL)
- **FamilyMember 已恢复为一等模型**：`/api/members/` CRUD 可用；Transaction/Account/Holding 通过 `member_id` 直接关联（不走标签系统）；HomePage 列表显示家庭成员就读 `txn.member`。`database.py:_migrate_members_to_tags()` 仅作历史调试用，已不再调用

## 部署前提（影响设计决策）

- **目标部署形态**：云端（非本机）。家庭成员共享账本，手机 PWA 可访问
- **必须长期考虑**：
  - 后端进程 7×24 常驻 → APScheduler 等应用内定时器可用
  - 多用户：后续标签/账户/交易等都需要 `user_id` 或 `family_id` 维度做权限隔离（现有单用户模型要逐步改造）
  - 手机访问：所有新页面设计必须移动端优先
  - 数据库：SQLite 单文件只适合 demo，上线前考虑迁移到 PostgreSQL

## Pending Requirements (需求池)

### 已完成

- ~~**分类体系重置 + Transaction.note 删除 + 编辑功能 + 列表布局调整**~~ —
  (1) [seed.py](backend/app/seed.py) 重写：14 支出父类 + 6 收入父类（按用户自定义结构，去前缀去待定），父类无关键词，子类带关键词；顶层 "其他支出" 兜底，"退款报销→其他收入" 作为收入兜底；
  (2) Transaction.note 从 model/schemas/api.ts/解析器/导入路由全部删除，备注统一走 description；
  (3) 钱迹解析器：description=备注列；新增 `source_category_name`/`source_parent_category_name` 字段；categorizer 优先级：source_category_name → 关键词 → 兜底；
  (4) HomePage 列表布局：左 icon | 中（分类名 / 备注·成员）| 右（金额 / 账户）；详情移除 source 行；新增「编辑」按钮跳 `/add?id=`；
  (5) AddPage 接受 `?id=` 进入编辑模式，加载交易→预填→PATCH；新增 `GET /api/transactions/{id}` 端点；
  (6) 数据库已删除（用户确认无业务数据），下次启动后端时按新 seed 重建

- ~~**需求7：多级标签系统**~~ — TagCategory/Tag/关联表；旧FamilyMember自动迁移；记账/导入/账户/持仓/设置全部接入；钱迹标签parse时原样返回、save时才落库；批量标签虚拟叠加模式；归档/移动/删除；统计接口预留tag_id筛选口
- ~~**需求4：资产账户体系**~~ — Account 模型（资金账户/信用卡/充值账户/债务/投资理财）、CRUD API、设置页管理UI、动态余额计算
- ~~**需求3：转账类型**~~ — Transaction.type 新增 transfer，AddPage 支持转出/转入账户选择，bank_pdf 自动识别"信用卡还款"→transfer，HomePage 转账专属显示（🔄图标、紫色金额、从→到）
- ~~**需求5：交易关联账户**~~ — 手动记账可选账户，转账选转出+转入，导入账单支持 payment_method 提取 + 逐条账户选择
- ~~**需求1：导入账单去重**~~ — 金额相同+日期±1天+收支方向相同，预览页黄色高亮+默认取消勾选，可手动勾回
- ~~**需求6a：Tab 改名**~~ — 底部导航「资产」改为「投资」
- ~~**需求12：投资-账户绑定**~~ — 新增「投资理财」账户大类；Holding.account_id（可选）；账户 current_balance = 初始余额 ± 交易流水 + 绑定持仓市值之和（方案A）；持仓刷新行情后账户余额自动联动
- ~~**Bug 修复**~~ — (1) 基金行情接口切换到 f10/lsjz；(2) SettingsPage 账户余额显示去掉 Math.abs；(3) async SQLAlchemy MissingGreenlet（改用直接操作关联表）；(4) 导入 save 500 错误；(5) AddPage 去掉多余"描述"字段
- ~~**B1 修 bug + 回滚总资产净值卡**~~ — 单个刷新按钮加 refreshingId 加载状态+成功提示；绿色净值卡已移除
- ~~**需求10：基金行情定时自动更新**~~ — APScheduler 3.x，每天 22:30 + 10:30 自动刷新；开机补漏（今日未刷则后台更新）；失败静默记日志
- ~~**需求9.1：钱迹备注列**~~ — 钱迹 CSV 的备注列正确保存到 `Transaction.note`
- ~~**需求8：报销管理模块**~~ — Transaction 新增报销字段；ReimbursementRecord + reimbursement_items 表；/api/reimbursements/ CRUD；统计剔除可报销支出；账户余额联动到账金额；钱迹 CSV 解析报销/报销记录类型；导入预览页显示报销类账单 + 报销到账记录；AddPage 可报销开关；ReimbursementPage（未报/已报/批量提交/撤销）；SettingsPage 入口；HomePage 状态 pill + 详情卡
- ~~**需求9 导入完善**~~ — 9.3 支付宝商品说明已存 description（无需改动）；9.4 微信 description="交易对方，商品" 智能拼接；9.5 支付宝不计收支三档：交易关闭/退款跳过、含"余额宝"→income、其他→expense+`default_unchecked`默认不勾选；9.6 微信收/支="/" 且含"零钱通"→type=transfer，方向按"存入/转入"vs"转出"判断；ImportPage transfer 行渲染双账户选择器（紫色→分隔）+ 自动匹配零钱通账户；ParsedTransaction 新增 `default_unchecked` 字段，前端初始勾选时排除并加"需确认"徽标
- ~~**导入账户映射记忆**~~ — 新增 `payment_method_mappings` 表（source+raw_name 唯一）；导入流程扩展为三步：上传→账户映射→预览；parse 返回历史映射并预填 account_id；mapping step 列出 distinct payment_method，已记忆项自动预选（全部已记忆时跳过此步）；save 时 upsert 映射；updateMapping() 批量同步同支付方式的所有非转账交易
- ~~**投资转账模型 + 自动算份额 + 赎回**~~ — 投资理财账户 current_balance 公式修复（仅取持仓市值）；investment_detector 识别蚂蚁财富买入/赎回→type=transfer；parse 后处理本地名称匹配+Eastmoney反查；save 查账单日历史净值算份额（加权均价）；holdings 新增 redeem 端点；ImportPage 橙色 badge + 持仓选择器 + 保存前校验 + 保存后反馈；InvestPage 赎回按钮 + RedeemModal；seed 新增投资盈亏分类
- ~~**周期记账规则**~~ — RecurringRule + RecurringExecution 模型；每周/每月循环 + 永不/日期/次数结束方式；每天 00:05 定时生成 Transaction（source="recurring"）；创建/修改时当天匹配立即执行；SettingsPage 导航卡片 → /recurring 独立页（RecurringPage.tsx）；修改规则只影响未来生成的账单
- ~~**统计模块重构（Phase 1-4）~~** — 月度消费报表（R1-R3）+ 年度报表（R4）+ 资产负债表（R5）+ 快照机制（R6）+ 资产配置视图（R8）
  - Phase 1：月度环形图 + 分类/标签/TOP商户 + 环比/同比
  - Phase 2：年度柱状图（图例 toggle）+ 分类汇总 + 月报表
  - Phase 3：净资产卡片 + 资产构成饼图 + 账户列表
  - Phase 4：AccountSnapshot/HoldingSnapshot 表 + 每月1日00:30自动快照 + 净资产趋势 + 资产配置环形图
  - **后续增强**：全局成员筛选 chip 栏 + 日报表 + 全视图下钻（分类→账单→详情→编辑/删除）+ 环形图标签线 + 年度环形图 + memo 性能优化

- ~~**账户管理增强**~~ — (1) 新增「银行理财」账户大类，余额逻辑同资金账户（balance + delta）；(2) 账户图标系统：支持真实 PNG Logo（招行/工行/建行/中信银行/银河证券/支付宝/微信/雪球），创建 `BankIcon` 组件 + `getIconText` 辅助函数；(3) 账户列表按大类→成员二级分组展示；(4) AddPage 记账页账户选择器按成员分组；(5) InvestPage 新建持仓时隐藏「理财」资产类型

### 🔙 回滚

- ~~**需求6b：家庭总资产净值卡**~~ — InvestPage 里的绿色净值卡先拿掉，等整体 UI 设计时再决定放哪里（底层方案A 计算逻辑保留）

### 🐛 待修 Bug

- **B2：投资模块单个基金刷新行情无反应** — 点击单个持仓的"刷新行情"按钮无反馈，待排查前端 handleRefreshOne 或后端 /holdings/{id}/refresh endpoint

### 待实施

#### 需求2：智能分类优化（商户记忆层）
- **底层保留**：`Category.keywords` 作为初始兜底
- **新增上层**：`MerchantCategory` 表（counterparty → category_id），记录用户导入时手动修改的分类
- **优先级**：商户记忆 > 关键词匹配 > 默认"其他"

#### ~~需求13：理财产品账户大类~~（已完成）
- ~~**已实现**~~：新增「银行理财」账户大类（AccountCategory），余额逻辑同资金账户（balance + 流水 delta），不依赖持仓模型
- Holding 模型的 `asset_type='wealth'` 保留但前端已隐藏（新建时不显示，编辑已有理财持仓时仍可见）

#### 需求14：月度盈亏报表（快照机制已上线）
- ~~AccountSnapshot + HoldingSnapshot 表已创建~~ — 每月 1 号 00:30 自动写快照；设置页可手动触发
- **待做**：月度盈亏 = 本月末市值 - 上月末市值 - 本月净流入，需等快照积累 2+ 个月

### 待定方案

#### 需求11：账单搜索
支持按分类、备注、标签、金额搜索账单。可能被 AI 搜索替代，暂放需求池不动。

#### 导入账单智能识别（分类 + 账户）
当前导入流程的分类和账户匹配基于关键词规则。考虑用 LLM：
- 分类识别：根据商户名/描述直接判断分类
- 账户识别：根据 payment_method 匹配已有账户
- 待评估成本/延迟/准确率

### 待做优化

### 实施建议顺序

1. **B2 修 bug** — 单个基金刷新无反应
2. **需求2 商户记忆** — 独立，提升分类准确率
3. **需求14 月度盈亏报表** — 快照表已建，等数据积累 2+ 月后可做
4. **需求11 账单搜索 + AI** — 锦上添花
