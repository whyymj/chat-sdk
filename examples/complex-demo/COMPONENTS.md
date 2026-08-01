# complex-demo 组件手册

complex-demo 用一份 JSON 驱动整个页面(`window.page`),由 **30 种组件类型**按顺序拼装。本文档是全部组件的**业务说明 + 参数参考**,供 agent / 集成方查阅。

> 组件的「示例实例数据」见 `defs/<type>.ts`(每组件一份样板 `defaultProps`);「业务说明」即本文档来源。schema 集中定义在 `pageSchema.ts`。

---

## 页面结构

```
PageData = {
  title: string              // 页面标题
  components: Component[]    // 组件数组,按顺序拼装
}
```

每个 `Component` 的统一形状:

```
{
  type: '<组件类型>',         // 必填,决定渲染哪个组件(见下表)
  ...通用配置(baseProps),    // 可选,所有组件共享(id/style/布局/动画/主题...)
  props: { ...业务字段 }      // 各组件特有的业务字段(见各组件参数表)
}
```

## 通用配置 baseProps(所有组件共享)

下列字段**每个组件都可设**(写在组件根,与 `type`/`props` 同级),无需在业务字段里重复。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 组件唯一 id(可选,用于锚点/调试) |
| `visible` | boolean | 是否显示,默认 `true`;设 `false` 隐藏组件 |
| `className` | string | 附加 class 名(可选) |
| `style` | Record<string,string> | 自定义内联样式对象,键值对,如 `{ color: "red", padding: "8px" }` |
| `margin` | string | 外边距,如 `"8px 16px"` |
| `padding` | string | 内边距,如 `"8px"` |
| `width` | string | 宽度,如 `"100%"` / `"320px"` |
| `height` | string | 高度,如 `"auto"` / `"200px"` |
| `maxWidth` | string | 最大宽度,如 `"1200px"`,限制内容居中范围 |
| `hideOnMobile` | boolean | 移动端隐藏(<768px) |
| `hideOnDesktop` | boolean | 桌面端隐藏(≥768px) |
| `animated` | boolean | 是否启用入场动画,默认 `false` |
| `animation` | `fade`/`slide`/`zoom`/`none` | 动画类型,默认 `none` |
| `animationDuration` | number(0-5000) | 动画时长 ms,默认 `300` |
| `hoverEffect` | `scale`/`lift`/`highlight`/`none` | 悬停效果,默认 `none` |
| `cursor` | string | 光标样式,如 `pointer`/`help` |
| `dataSource` | string | 数据源标识(绑定后端接口/状态) |
| `theme` | `light`/`dark`/`custom` | 主题色系 |
| `ariaLabel` | string | 无障碍标签(读屏用) |
| `tooltip` | string | 悬浮提示文字 |

> 布局字段(`margin`/`padding`/`width`/`height`/`maxWidth`/`cursor`)会被渲染器合并进 `style`;动画/响应式/主题字段会被转成 class(`anim-*`/`hover-*`/`hide-on-*`/`theme-*`)。

## 容器与嵌套

`container` / `section` / `grid` / `tabs` 四个**容器组件**支持 `children` 嵌套任意子组件(递归,可多层)。`children` 是组件数组,用 `jsonPath` 增量操作(如 `props.children.0.props.text`)。

---

## 组件清单(按分类)

共 30 种,分 6 类:**基础内容**(11)/ **布局**(2)/ **容器**(4)/ **商品营销**(6)/ **导航**(4)/ **表单交互**(3)。

### 基础内容(11)

#### 标题 `heading`

页面或区块标题,支持 1-6 级层级。用于分区标题、商品分类标题、活动主题等需要文字强调的位置。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | ✓ | 标题文本 |
| `level` | number(1-6) | | 层级 1-6,默认 2 |

#### 富文本 `richText`

支持 HTML 的富文本内容,可含 `<b>`/`<i>`/`<a>`/`<p>`/`<ul>`/`<li>` 等标签。用于活动规则、商品详情说明、图文混排段落。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `html` | string | ✓ | 富文本 HTML 内容(支持基础标签) |

#### 图片 `image`

单张图片展示。用于商品配图、活动头图、Banner 静态图、装饰性插图等。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `src` | string | ✓ | 图片地址 |
| `alt` | string | | 替代文字 |
| `width` | string | | 宽度,如 `"100%"`/`"320px"`,默认 100% |

#### 按钮 `button`

可点击的操作按钮,支持四种样式。用于「立即购买」「领取」「查看更多」等行动入口。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `label` | string | ✓ | 按钮文字 |
| `variant` | `primary`/`secondary`/`ghost`/`danger` | | 样式,默认 `primary` |
| `action` | string | | 点击动作描述(仅展示,不实际跳转) |

#### 列表 `list`

文本列表(有序/无序)。用于活动步骤、功能要点、商品卖点罗列等条目化文本。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `items` | string[] | ✓ | 列表项 |
| `ordered` | boolean | | 是否有序号(ol),默认 `false`(ul) |

#### 卡片 `card`

信息卡片,含标题、正文、可选配图与链接。用于商品简介、权益说明、功能介绍等块状信息聚合。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | ✓ | 卡片标题 |
| `text` | string | ✓ | 卡片正文 |
| `image` | string | | 卡片配图(可选) |
| `link` | string | | 跳转链接(可选,仅展示) |

#### 轮播 `carousel`

多图轮播组件,支持自动播放与切换间隔。用于首页焦点图、多活动 Banner 轮播、商品橱窗展示。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `autoplay` | boolean | | 是否自动播放,默认 `false` |
| `interval` | number(1000-20000) | | 切换间隔 ms,默认 `3000` |
| `slides` | object[] | ✓ | 轮播项列表 |
| `slides[].image` | string | ✓ | 轮播图地址 |
| `slides[].caption` | string | | 说明文字(可选) |

#### 手风琴 `accordion`

可折叠的问答/条目列表,默认可展开第一项。用于常见问题 FAQ、帮助中心、多条目折叠展示。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `items` | object[] | ✓ | 折叠项列表 |
| `items[].title` | string | ✓ | 项标题 |
| `items[].content` | string | ✓ | 项内容(文本) |
| `expandFirst` | boolean | | 默认展开第一项,默认 `true` |

#### 时间线 `timeline`

按时间点排列的事件列表。用于活动流程节点、订单进度、版本更新记录、物流轨迹等带时间属性的叙事。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `items` | object[] | ✓ | 时间线项 |
| `items[].time` | string | ✓ | 时间点,如 `"2026-08-01"` |
| `items[].text` | string | ✓ | 事件描述 |

#### 视频 `video`

视频播放组件,支持封面图、自动播放、控制条。用于商品视频介绍、活动宣传片、教程演示。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `src` | string | ✓ | 视频地址 |
| `poster` | string | | 封面图(可选) |
| `autoplay` | boolean | | 自动播放,默认 `false` |
| `controls` | boolean | | 显示控制条,默认 `true` |

#### 公告栏 `noticeBar`

顶部滚动公告条。用于促销通知、活动提醒、系统公告等单行强调信息(常配滚动动效)。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | ✓ | 公告文字 |
| `scrollable` | boolean | | 是否滚动,默认 `true` |

### 布局(2)

#### 间距 `spacer`

纯空白占位,按像素撑开垂直高度。用于组件间的呼吸感调节、模块分区间隔。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `height` | number(0-500) | ✓ | 间距高度 px |

#### 分割线 `divider`

水平分割线,可带中间文字(如「活动说明」)。用于内容区块的视觉分隔、章节过渡。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `label` | string | | 分割线中间文字(可选,无则纯线) |

### 容器(4)

> 以下四个容器组件的 `children` 是**组件数组**,可嵌套任意 type(含自身,递归多层)。详见前文「容器与嵌套」。

#### 通用容器 `container`

可嵌套任意子组件的通用容器,支持内边距。用于把多个组件编组、统一加边距/背景的场景。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `padding` | number(0-100) | | 内边距 px,默认 `0` |
| `children` | Component[] | ✓ | 子组件数组(任意 type,递归嵌套) |

#### 带标题区块 `section`

带标题的区块容器,标题下嵌套任意子组件。用于「领券中心」「精选好物」等模块化分区,是最常用的内容编排容器。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | ✓ | 区块标题 |
| `children` | Component[] | ✓ | 子组件数组 |

#### 网格布局 `grid`

多列网格容器,子组件按列排布,支持列数(1-6)与间距。用于卡片/优惠券/权益图标的等距网格排列。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `columns` | number(1-6) | ✓ | 列数 1-6 |
| `gap` | number(0-60) | | 列间距 px,默认 `12` |
| `children` | Component[] | ✓ | 子组件数组(按列排布) |

#### 标签页 `tabs`

多标签切换容器,每个标签下嵌套各自的子组件。用于「手机/电脑/配件」分类切换、商品多维度展示等同区域内容切换。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tabs` | object[] | ✓ | 标签项(label + 各自内容) |
| `tabs[].label` | string | ✓ | 标签文字 |
| `tabs[].children` | Component[] | ✓ | 该标签下的子组件数组 |

### 商品营销(6)

#### 商品瀑布流 `productGrid`

商品多列网格,含商品标题/价格/主图/标签。电商专题页核心组件,用于商品列表、热销榜、推荐位展示。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `columns` | number(1-6) | ✓ | 列数 1-6 |
| `gap` | number(0-60) | | 卡片间距 px,默认 `16` |
| `products` | object[] | ✓ | 商品列表 |
| `products[].id` | string | ✓ | 商品 id |
| `products[].title` | string | ✓ | 商品标题 |
| `products[].price` | number | ✓ | 价格(元) |
| `products[].image` | string | ✓ | 商品主图地址 |
| `products[].tag` | string | | 标签,如「新品」/「促销」(可选) |

#### 横幅 `banner`

静态横幅图(区别于 carousel 轮播),可叠加文字与跳转链接。用于活动主视觉、单张促销海报、品类入口图。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | string | ✓ | 横幅图片地址 |
| `link` | string | | 点击跳转链接(可选) |
| `text` | string | | 叠加文字(可选) |

#### 倒计时 `countdown`

距目标结束时间的倒计时(天/时/分/秒)。用于秒杀、限时折扣、活动截止提醒等营造紧迫感的营销场景。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `targetTime` | string | ✓ | 目标结束时间,如 `"2026-08-15 23:59:59"` |
| `labels` | object | | 各段标签(默认 天/时/分/秒) |
| `labels.days`/`hours`/`minutes`/`seconds` | string | | 自定义各段标签文字 |

#### 优惠券 `coupon`

单张优惠券,含面额/门槛/券名/状态。用于领券中心、新人福利、满减券展示。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `amount` | number | ✓ | 面额(元) |
| `threshold` | number | | 使用门槛(满 N 元,可选) |
| `label` | string | | 券名,如「新人券」(可选) |
| `status` | `available`/`claimed`/`used`/`expired` | | 状态,默认 `available` |

#### 统计数据 `stat`

关键指标统计展示(数字 + 说明)。用于「10万+ 参与用户」「5000万 成交额」等营造活动规模感的数字陈列。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `items` | object[] | ✓ | 统计项 |
| `items[].number` | string | ✓ | 数字(允许带单位,如「10万+」) |
| `items[].label` | string | ✓ | 说明文字 |

#### 评分 `rating`

五星评分(0-5 分)与评价人数。用于商品/店铺综合评分展示、用户口碑摘要。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `score` | number(0-5) | ✓ | 评分 0-5 |
| `count` | number | | 评价人数(可选) |

### 导航(4)

#### 导航栏 `navbar`

页面顶部导航栏,含 logo、站点标题、菜单项。用于全站主导航、品类入口、品牌区展示。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `logo` | string | ✓ | logo 图片地址 |
| `title` | string | | 站点标题(可选) |
| `menu` | object[] | ✓ | 菜单项列表 |
| `menu[].label` | string | ✓ | 菜单项文字 |
| `menu[].link` | string | | 跳转链接(可选) |

#### 页脚 `footer`

页面底部页脚,含链接组、版权信息、联系方式。用于法律声明、帮助链接、客服入口等页面收尾。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `links` | object[] | | 页脚链接组(可选) |
| `links[].label` | string | ✓ | 链接文字 |
| `links[].link` | string | | 链接地址(可选) |
| `copyright` | string | | 版权信息,如「© 2026 XX」(可选) |
| `contact` | string | | 联系方式(可选) |

#### 步骤条 `stepper`

横向步骤进度条,标注当前步骤。用于下单流程、开通引导、任务进度等线性流程的可视化。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `steps` | object[] | ✓ | 步骤列表 |
| `steps[].title` | string | ✓ | 步骤标题 |
| `steps[].description` | string | | 步骤描述(可选) |
| `current` | number(≥0) | | 当前步骤(从 0,默认 `0`) |

#### 面包屑 `breadcrumb`

层级路径导航(首页 > 分类 > 当前)。用于表明当前页面在站点层级中的位置,辅助返回上级。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `items` | object[] | ✓ | 面包屑项 |
| `items[].label` | string | ✓ | 项文字 |
| `items[].link` | string | | 链接(可选,末项通常无) |

### 表单交互(3)

#### 表单 `form`

多字段表单,支持多种字段类型与必填标记。用于预约、调研、订阅、反馈等信息采集。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | string | | 提交动作描述(仅展示,可选) |
| `fields` | object[] | ✓ | 表单字段 |
| `fields[].name` | string | ✓ | 字段名 |
| `fields[].label` | string | ✓ | 字段标签 |
| `fields[].type` | `text`/`textarea`/`number`/`select`/`checkbox` | ✓ | 字段类型 |
| `fields[].required` | boolean | | 是否必填,默认 `false` |
| `fields[].placeholder` | string | | 占位提示(可选) |

#### 输入框 `input`

单行输入框,支持多种类型。用于搜索、订阅邮箱、手机号、留言等单项信息输入。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `label` | string | ✓ | 标签 |
| `placeholder` | string | | 占位提示 |
| `inputType` | `text`/`number`/`email`/`password`/`tel` | | 输入类型,默认 `text` |

#### 下拉选择 `select`

下拉选择框,从可选项中选一个。用于品类筛选、数量选择、偏好设置等枚举值选取。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `label` | string | ✓ | 标签 |
| `options` | string[] | ✓ | 可选项 |
| `value` | string | | 当前选中值(可选) |

---

## 附:agent 操作要点

- **改单个组件优先增量 patch**(只发改动字段),避免整体重传大数组;容器内改 `props.children`
- **调样式**用根级 `style` 对象(如 `{ color: "red" }`)或 baseProps 布局字段,不要写 CSS 字符串
- **改业务字段**用 `props` 子对象(如 `write({ patch:{ op:'set', jsonPath:'props.text' } })`)
- **`id` 无需手动传**:append 新组件时若不传 id,拦截器自动补 `cmp-<时间戳>-<序号>`
- 校验失败返回具体错误,按提示修正 `type`/字段后重试
