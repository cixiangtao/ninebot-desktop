---
name: 韭号出行
description: 以 iOS/macOS 原生层级回放九号骑行轨迹与速度的清爽桌面系统
colors:
  route-teal: "#12c7b5"
  route-teal-deep: "#087f76"
  app-ground: "#edf1f5"
  map-ground: "#edf2f3"
  surface: "#ffffff"
  ink: "#172332"
  text-secondary: "#647481"
  divider: "#d8e0e4"
  error: "#9b3038"
typography:
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

**Creative North Star: "随行轨迹回放"**

韭号出行把九号 App 的浅色动态卡片放进 macOS 工作窗口，但不把桌面空间变成传统数据后台。地图是持续存在的环境，侧栏、极速卡和回放面板像 iOS 导航层一样浮在其上；青绿色只负责表达路线、选中和进度。

系统强调长时间查看时的清晰、安静与可信。它拒绝黑色仪表台、霓虹速度感和大面积品牌装饰，也不伪装成九号官方产品。

**Key Characteristics:**

- 冷灰蓝地图场承载整个窗口，白色浮层只出现在需要操作或读数的位置。
- 路线、图表、游标和选择统一使用稀少的青绿色。
- 大数字使用表格数字与紧凑字距，但普通正文保持系统级可读性。
- 圆角和半透明服务于导航层级，不作为装饰堆叠。

## Colors

一套克制的 Primary + Neutral 配色：路线青绿承担交互语义，冷灰蓝和白色承担空间层级。

### Primary

- **路线青绿**：用于实际轨迹、速度曲线、时间轴已播放区、选中状态和成功连接点。
- **深路线青绿**：用于青绿浅底上的文字与图标，确保小字号仍有足够对比。

### Neutral

- **应用冷灰**：窗口和侧栏之外的底层环境。
- **地图雾灰**：地图画布与道路之外的连续场。
- **浮层白**：极速卡、回放面板和登录面板。
- **深蓝黑**：数字、标题和主要操作文字。
- **次级蓝灰**：说明、单位和非当前导航。
- **分隔雾线**：图表网格、分割线和时间轴未播放区。

**The One Route Rule.** 同一屏只有一套青绿路线语义；不要为不同数据区再发明第二强调色。

## Typography

**Display Font:** macOS / iOS 系统显示字体栈
**Body Font:** macOS / iOS 系统正文字体栈

**Character:** 字形保持九号 App 与 Apple 平台共有的清晰、紧凑和不抢内容。大字号只用于实际测量值，不用于营销标题。

### Hierarchy

- **Display**（730，50px，1）：极速和当前速度，使用表格数字与轻微紧缩字距。
- **Title**（680，19px，1.2）：品牌名、车辆名与受保护流程标题。
- **Body**（500，14px，1.5）：行程信息、说明与普通操作。
- **Label**（650，12px，1.35）：指标名称、单位、状态与导航。

**The Measured Emphasis Rule.** 只有来自真实或明确标注演示数据的测量值可以进入 Display 层级。

## Layout

应用采用固定桌面工作壳：标准窗口左侧栏为 304px，1180px 以下收紧至 270px；主区域由 50px 标题栏与全幅轨迹画布构成。指标面板固定在右上 24px，回放面板在主画布底部留出 28px，并以 `clamp(26px, 6vw, 88px)` 控制两侧边距。

标准窗口为 1440×900，最小支持 1080×680。窗口缩小时不压缩主地图和回放控件到不可用宽度；行程列表在侧栏内部滚动，浮层宽度收紧，页面本身始终不滚动。窗口高度不超过 760px 时，月份选择器从侧栏底部向上锚定，并切换为不透明白色表面，避免透出下方行程内容。

**The Continuous Canvas Rule.** 地图或轨迹画布必须连续铺满主区域，不能被拆进一张普通内容卡。

## Elevation & Depth

系统使用环境阴影与材质模糊组合。侧栏通过右向柔和阴影与地图分层；极速卡和回放面板使用向下偏移的宽阴影；普通列表默认无阴影，只有当前行程或车辆摘要被轻微抬起。

### Shadow Vocabulary

- **导航侧栏**（`10px 0 34px rgb(67 84 96 / 7%)`）：只用于侧栏与连续地图的分离。
- **浮动面板**（`0 14px 36px rgb(47 64 76 / 14%)`）：用于极速卡和回放面板。
- **当前列表项**（`0 6px 20px rgb(47 64 76 / 9%)`）：只标识当前选择。
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
- **Background:** 白色或高不透明白色材质；侧栏可使用 88% 冷白与 28px 模糊。
- **Shadow Strategy:** 只有离开地图平面的内容使用浮动面板阴影。
- **Border:** 面板不同时使用描边和阴影；内部层级使用低对比分隔线。

### Inputs / Fields

- **Style:** 44px 高、12px 圆角、冷灰填充，无默认描边。
- **Focus:** 使用全局青绿焦点环，不靠颜色变化隐藏焦点。
- **Error / Disabled:** 错误文本放在低饱和红色浅底中；禁用控件降低透明度并取消可点击暗示。

### Navigation

侧栏导航默认使用蓝灰图标和 14px 半粗文字；当前页面使用青绿文字与 10% 青绿浅底。静态的未来导航项不伪装成交互按钮，只有已实现行为才提供点击状态。

### Month Navigation

行程列表上方的年月是可展开控制，而非静态标题。展开后在侧栏原位显示年份切换和 3×4 月份网格：选中月份使用青绿浅底，本月使用一像素青绿内环，未来月份禁用。窗口高度不超过 760px 时，选择器向上锚定并使用不透明白底，保证月份按钮与下方内容清晰分层。

切换月份后立即清除旧行程、旧路线和旧回放位置，再显示加载或空状态；空月份在侧栏列表和连续地图中央同时说明。快速连续选择月份时，只有最后一次请求的响应可以更新车辆、行程和路线，较早返回的响应必须被忽略。

### Synchronized Playback

地图位置点、速度曲线游标、当前速度和时间轴必须共享一个连续回放位置。每段保持约 180ms 的基础回放节奏，通过 `requestAnimationFrame` 在相邻采样点之间插值；后台恢复后的单帧追赶限制为 50ms，避免突然跳跃。路线聚焦只发生一次 780ms 的宽度强调，并遵守减少动态偏好。

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
