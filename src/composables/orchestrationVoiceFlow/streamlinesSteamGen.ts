/**
 * ### 流式接口：
 * /game/streamlines
 * /game/streamlines/introduction
 * ## 效果
 * 有累积，无渐显。 具体表现：
 * ✅ 实时接收：前端用 ReadableStream 读取，能边收边累积 delta 数据
 * 有问题的地方：
 * 【】 直接覆盖：渲染时直接用累积值覆盖 content，没有逐字追加
 * 【】 无打字机动画：代码中没有 typewriter / typing effect / requestAnimationFrame 逐字渲染
 * 【】 无光标闪烁：没有打字机光标 CSS 效果
 *
 * 记录是否整个台词都已经播放语音完毕。
 * 生成过程中：
 * 。-》. -》。
 * 尾部圆点指示器	✅ 有（金黄色脉冲点 + loading 时圆点数切换）
 *
 */