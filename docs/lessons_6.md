# Lesson 6: Preload 安全桥接与 IPC 契约设计

## 本课目标
- 完成 NoteMark 的安全通信层设计
- 让 renderer 只通过 `window.context` 与主进程交互
- 固化共享类型，避免跨层接口失控

## 对应 practice 主线
这一课对应 practice 中的 preload、`contextBridge`、IPC 通信和类型契约设计部分。

## 当前仓库映射
- `src/preload/index.ts`
- `src/main`
- `src/shared`

## 学习重点
- 为什么 Electron 项目必须重视 preload 隔离层
- 什么能力应该暴露给 renderer，什么能力不应该暴露
- 为什么共享类型应该集中在 `src/shared`

## 当前项目应暴露的核心 API
- `getNotes`
- `readNote`
- `writeNote`
- `createNote`
- `deleteNote`
- 窗口控制相关动作

## 可执行实践路线
1. 先写接口清单
   - 为每个 API 明确输入、输出、异常情况
   - 给返回值补足类型定义
2. 在 `src/shared` 固化契约
   - 定义笔记类型
   - 定义 preload 暴露的上下文接口
3. 在 preload 中安全暴露
   - 只暴露最小必要能力
   - 不暴露原始 `ipcRenderer`
   - 不暴露 Node 模块对象
4. 在 main 中注册处理器
   - IPC handler 与业务逻辑解耦
   - handler 只负责参数校验与调用 main/lib
5. 在 renderer 中替换直接依赖
   - 所有数据操作统一经由 `window.context`
   - 组件不直接感知 IPC 细节

## 本课产出
- 一份共享类型定义
- 一份 preload API 说明
- 一个安全边界清晰的跨进程调用层

## 完成标准
- 渲染层没有直接引用 Node API
- 所有跨层调用都有类型约束
- API 名称与职责稳定，不混入 UI 细节

## 功能规划结果
通信层设计坚持三条规则：
- renderer 只表达意图，不处理原生细节
- preload 只做桥接，不承载业务
- main 才是真正的文件与系统入口

## 建议进阶练习
- 为每个 API 补充错误码或错误对象结构
- 增加“能力版本”字段，便于后续扩展
- 为 preload 暴露接口写一份最小使用示例

## 下一课衔接
下一课把这些接口接到真实文件系统上，完成本地 Markdown 笔记的持久化闭环。
