---
name: 韭号出行
description: 默认清爽亮色、支持五套可切换配色的骑行桌面系统
colors:
  route-teal: "#12c7b5"
  route-teal-deep: "#087f76"
  app-ground: "#f5f7f8"
  forest: "#173f35"
  citron: "#def28a"
  chart-green: "#28765a"
  on-forest: "#f8faed"
  on-forest-muted: "#c1d2b9"
  map-ground: "#edf2f3"
  surface: "#ffffff"
  ink: "#172332"
  text-secondary: "#647481"
  divider: "#e3e9eb"
  error: "#9b3038"
typography:
  ride-distance:
    fontSize: "16px"
    fontWeight: 650
    lineHeight: "18px"
  ride-speed:
    fontSize: "28px"
    fontWeight: 400
    lineHeight: 1
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif'
    fontSize: "50px"
    fontWeight: 730
    lineHeight: 1
    letterSpacing: "-0.035em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif'
    fontSize: "19px"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif'
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif'
    fontSize: "12px"
    fontWeight: 650
    lineHeight: 1.35
rounded:
  control: "12px"
  list: "13px"
  surface: "16px"
  dialog: "20px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "#182833"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "42px"
  button-secondary:
    backgroundColor: "#edf1f3"
    textColor: "#536472"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "42px"
  panel-floating:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "22px"
  field:
    backgroundColor: "#f0f3f5"
    textColor: "#182733"
    rounded: "{rounded.control}"
    padding: "0 13px"
    height: "44px"
---

# Design System: 韭号出行

## Overview

**Creative North Star: "城市骑行工作台"**

韭号出行以清爽青绿亮色为默认，顶部「配色」入口允许即时切换五套主题。固定导航、顶部车辆栏、行程列表、地图与底部回放栏的布局不随配色变化，切换时保留所选车辆、行程、回放进度和数据状态。

用户希望能够自行比较和选择配色，不再固定使用松绿撞色。配色只承担界面层级与识别，不修改地图样式、速度区间语义、错误或警告的含义。

## Colors

| 配色             | 使用场景       | 主色              | 页面表现                         |
| ---------------- | -------------- | ----------------- | -------------------------------- |
| 清爽青绿（默认） | 清晰的日常使用 | #087f76           | 冷白内容区、浅灰绿导航           |
| 晴空蓝           | 偏冷色偏好     | #315fba           | 冷白与浅蓝                       |
| 柔雾紫           | 柔和色彩偏好   | #7651ab           | 浅灰与雾紫                       |
| 暖杏橙           | 偏暖色偏好     | #a85926           | 米白与浅杏                       |
| 松绿撞色         | 更强的明暗对比 | #173f35 / #def28a | 深松绿导航与重点数据、酸橙黄强调 |

样式使用语义角色：`--accent` 系列控制主操作与曲线；`--nav-*` 控制导航；`--row-*` 控制当前行程；`--panel-*` 控制指标与电量区的表面和文字。前四套配色的指标面板保持浅色，松绿方案单独设置深色表面的正文、辅助文字、警告与焦点颜色。数字字体统一使用系统字体，不随主题改变字号和布局。

配色选择使用原生单选控件，支持方向键、Escape、点击外部和键盘移出关闭。选择后保留弹层方便继续比较。偏好只保存为本机 `localStorage` 的 `ninebot-desktop.theme`；启动时在 React 挂载前应用。缺失、过期或读取失败的值回退到清爽青绿；保存失败时当前会话仍可使用，并在弹层内说明无法持久保存。

**The Data Color Rule.** 路线和速度区间图例保持蓝、青、黄、橙、红分段；主题只改变普通界面与非分段图表的配色。成功、错误与警告继续保留原有语义。

## Typography

**Display Font:** 系统字体栈（-apple-system、SF Pro Display）；界面正文使用原生系统正文字体栈
**Body Font:** macOS / iOS 系统正文字体栈

**Character:** 字形保持九号 App 与 Apple 平台共有的清晰、紧凑和不抢内容。大字号只用于实际测量值，不用于营销标题。

### Hierarchy

- **Display**（730，50px，1）：极速和当前速度，使用表格数字与轻微紧缩字距。
- **Title**（680，19px，1.2）：品牌名、车辆名与受保护流程标题。
- **Body**（500，14px，1.5）：行程信息、说明与普通操作。
- **Label**（650，12px，1.35）：指标名称、单位、状态与导航。

**The Measured Emphasis Rule.** 只有来自真实或明确标注演示数据的测量值可以进入 Display 层级。

## Layout

应用采用固定桌面工作壳：左侧 88px 导航轨常驻；右侧工作区顶部为 72px 标题栏，车辆选择固定在右侧。轨迹页额外显示 292px 行程栏，1180px 以下收紧至 260px；设备、位置、统计和对比页释放这部分宽度。

标准窗口为 1440×900，最小支持 1080×680。导航、车辆选择和月份入口不随行程列表滚动；列表独立滚动，月份弹层从靠近顶部的月份入口向下展开。数据页在内容区纵向滚动，应用外壳不滚动。

轨迹页底部固定 226px 回放栏，地图填满其上方的连续区域。极速面板在地图右上留出 16px，宽 312px（窄窗口 300px）。地图自动取景为右侧指标、左上图例与控件、底部来源说明留白；底部不再重复预留回放栏高度。刷新、对比和导出使用带可访问名称与提示的图标按钮。

行程列表以真实日期替代装饰路线缩略图。统计页的六项汇总使用一个连续面板，标准尺寸六列，窄窗口三列两行；通过细线与间距区分指标。

**The Continuous Canvas Rule.** 地图或轨迹画布连续铺满回放栏上方的工作区，不能被拆进普通内容卡。

## Elevation & Depth

导航、行程列表和数据页面以底色与细边界分层。极速浮层使用有方向的轻阴影；回放栏、车辆选择和当前行程不使用阴影。受保护弹层继续保留原有遮罩与浮层层级。

### Shadow Vocabulary

- **导航与列表**：不使用阴影，边界为 `1px solid #dde2d5`。
- **极速浮层**（`0 8px 28px rgb(32 49 54 / 10%)`）：用于地图上的读数。
- **当前列表项**：使用主题的 `--row-selected` 背景，不抬高内容。
- **主按钮**（`0 8px 20px rgb(27 46 58 / 18%)`）：只用于登录等受保护主操作。

**The Ambient Depth Rule.** 阴影必须有方向和衰减；青绿色光晕不能替代结构阴影。

## Shapes

控制类组件使用 12px 圆角，列表项使用 13px，主要浮层使用 16px，登录等受保护流程使用 20px。圆形只用于播放、地图图层和关闭等单图标控制；胶囊只用于短状态，不用于普通按钮。

路线必须使用圆形端点与转角。面板依赖阴影形成边界，不叠加一圈可见描边。

## Components

### Buttons

- **Shape:** 紧凑圆角控制（12px），主次按钮高度统一为 42px。
- **Primary:** 深蓝黑底与白字，用于受保护的确认动作。
- **Secondary:** 冷灰底与蓝灰文字，用于账号连接、重新连接等低风险动作。
- **Hover / Focus:** hover 改变底色；键盘焦点统一使用 3px 半透明青绿外环和 2px 偏移。

### Chips

- **Style:** 仅为加载、错误和倍率等短状态使用胶囊；内容保持一行并使用 Label 层级。
- **State:** 成功使用青绿浅底，错误使用低饱和红色浅底。

### Cards / Containers

- **Corner Style:** 浮层 16px，受保护面板 20px。
- **Background:** 数据页面与行程栏使用纯白表面；导航与底层画布由 `--nav-bg`、`--canvas` 决定。
- **Shadow Strategy:** 只有离开地图平面的内容使用浮动面板阴影。
- **Border:** 面板不同时使用描边和阴影；内部层级使用低对比分隔线。

### Inputs / Fields

- **Style:** 44px 高、12px 圆角、冷灰填充，无默认描边。
- **Focus:** 使用全局青绿焦点环，不靠颜色变化隐藏焦点。
- **Error / Disabled:** 错误文本放在低饱和红色浅底中；禁用控件降低透明度并取消可点击暗示。

### Navigation

固定导航轨使用 21px 图标与下方 11px 标签；当前页面使用 `--nav-active-text` 与 `--nav-active-bg`，深浅主题分别保持文字对比度。静态的未来导航项不伪装成交互按钮，只有已实现行为才提供点击状态。

### Month Navigation

骑行记录按本地开始日期倒序分组，日期标题旁保留当天里程与耗时合计，不显示星期；明细不完整时标注“可选合计”，避免将可见明细冒充完整全天数据。卡片使用两列：左侧起止时间及一行里程、min/h 耗时，右侧轨迹峰值是唯一的大号数字；里程数字使用 16px 深色半粗作为第二重点，单位与耗时保持 12px 次要文字。耗电量与平均能耗留在已有详情区；不显示轨迹缩略图及重复箭头。轨迹峰值只使用已读取的速度采样，未读取或无有效采样均显示破折号，状态及接口参考值位于悬停提示。同日时间使用 HH:mm–HH:mm，跨天以“次日”或天数偏移提示。列表自动读取可见区域及上下 140px 内的行程峰值，最多同时读取 2 条，完成一条即更新一条；滚动后尚未开始的离屏请求让位于当前区域。失败不自动重试，可通过“补全未读”重试并补齐本月其余行程，该入口与自动读取共用队列。已读结果在当前账号、车辆的会话中复用。轨迹峰值补全入口收为固定高度的一行，说明默认折叠，读取中和失败状态在原位展示，不插入额外段落推动列表。卡片最小高度为 70px，右侧速度区最小宽度为 66px，让未读取、不可用与有效读数之间保持稳定。分隔点与耗时作为整体换行，长内容允许自然增高。卡片沿用当前主题的表面、选中背景和键盘焦点色。

行程列表上方的年月是可展开控制，而非静态标题。展开后在侧栏原位显示年份切换和 3×4 月份网格：选中月份使用青绿浅底，本月使用一像素青绿内环，未来月份禁用。选择器从月份入口向下锚定，脱离滚动列表，以不透明表面和独立层级覆盖下方内容。

月度列表加载与单条轨迹详情加载使用独立状态。切换行程时保留月度汇总和校验入口的高度及列表滚动位置，不展示“正在读取整月汇总”。

切换月份后立即清除旧行程、旧路线和旧回放位置，再显示加载或空状态；空月份在侧栏列表和连续地图中央同时说明。快速连续选择月份时，只有最后一次请求的响应可以更新车辆、行程和路线，较早返回的响应必须被忽略。

### Synchronized Playback

地图位置点、速度曲线游标、当前速度和时间轴必须共享一个连续回放位置。每段保持约 180ms 的基础回放节奏，通过 `requestAnimationFrame` 在相邻采样点之间插值；后台恢复后的单帧追赶限制为 50ms，避免突然跳跃。路线聚焦只发生一次 780ms 的宽度强调，并遵守减少动态偏好。

### 账号入口与设置

侧边栏只保留「设置」入口，账号管理位于设置面板的首要区域。已保存账号用紧凑列表展示脱敏标识、当前使用状态与重新连接状态，支持添加、切换及移除；隐私与安全信息折叠为次要区域。切换后清空上一账号的展示与位置授权，退出仅影响当前账号。多账号能力取决于运行时支持，页面不展示令牌或上游 UID。

## Do's and Don'ts

### Do:

- **Do** 让地图或轨迹画布保持最大面积，把浮层数量限制在完成当前任务所需的最少集合。
- **Do** 同时展示接口声明极速与轨迹采样极速，让数据来源一眼可辨。
- **Do** 使用 Lucide 或同一笔画体系的 SVG 图标，并为所有图标控制提供可访问名称。
- **Do** 在 1440×900 和 1080×680 两个桌面尺寸检查完整工作区与登录流程。
- **Do** 月份切换期间清除旧轨迹，并对加载、空月份、失败重试和快速连续选择提供明确状态；并发返回时只接纳最后一次月份请求。

### Don't:

- **Don't** 引入黑色赛道仪表、霓虹光效、游戏化徽章或品牌营销横幅。
- **Don't** 把路线、速度曲线和当前点拆成各自管理状态的独立卡片。
- **Don't** 在没有说明数据来源时把演示路线、真实 GPS 或第三方地图混在一起。
- **Don't** 加入鸣笛、开座桶、启动、熄火等车辆控制入口。
