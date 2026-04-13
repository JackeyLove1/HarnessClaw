# Lesson 1: 项目认知、环境搭建与架构总览

## 本课目标
- 建立对 NoteMark 代码结构和运行链路的整体认知
- 能独立跑起开发环境，并说清楚 Electron 主进程、Preload、Renderer 的职责边界
- 为后续每一课建立统一的文件定位方式和验证方式

## 对应 practice 主线
这一课对应 practice 中的项目初始化、目录结构理解、开发命令和首轮运行部分。

## 当前仓库映射
- `src/main`：Electron 生命周期、窗口创建、IPC 注册
- `src/main/lib`：笔记 CRUD 与文件系统能力
- `src/preload`：通过 `contextBridge` 暴露安全 API
- `src/renderer/src`：React 界面、状态管理、编辑器交互
- `src/shared`：主进程与渲染进程共享的类型契约
- `resources`：打包资源
- `out`：构建产物

## 学习重点
- Electron 多进程架构为什么必须分层
- `electron-vite` 如何同时驱动 main、preload、renderer
- 为什么渲染层不能直接调用 Node API
- NoteMark 的最小功能闭环是什么

## 可执行实践路线
1. 安装依赖并运行开发环境
   - 使用 `pnpm install`
   - 使用 `pnpm dev`
   - 观察是否出现桌面窗口、顶部栏、左侧笔记区域和编辑区
2. 画出运行链路
   - 从应用启动开始，写出 BrowserWindow 创建流程
   - 标记 preload 何时注入 `window.context`
   - 标记 renderer 在何处读取笔记列表并渲染
3. 建立目录索引笔记
   - 为 `src/main`、`src/preload`、`src/renderer/src`、`src/shared` 各写一句职责说明
   - 记录每个目录的输入、输出、依赖对象
4. 跑通基础命令
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm build`
5. 明确数据流
   - 写出“读取笔记列表 -> 选中笔记 -> 编辑内容 -> 自动保存 -> 重启后恢复”的完整链路

## 本课产出
- 一张三层架构图
- 一份项目目录职责清单
- 一份本地运行与构建记录

## 完成标准
- 能说明 `src/main`、`src/preload`、`src/renderer/src` 的边界
- 能说明为什么 `window.context` 是本项目唯一合法的跨层入口
- 能独立运行开发、检查、构建命令

## 功能规划结果
本课结束后，只规划不扩展功能，先冻结当前边界：
- 核心目标：稳定实现本地 Markdown 笔记应用
- 核心流程：启动、读取、编辑、保存、删除、重启恢复
- 非本阶段目标：云同步、多人协作、富数据库检索

## 建议提交物
- `docs/architecture-notes.md` 或个人学习记录
- 一份“启动链路 + 数据流”简图

## 下一课衔接
下一课进入桌面应用壳层，聚焦窗口、顶栏、布局骨架和桌面交互体验。
