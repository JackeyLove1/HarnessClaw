# 主进程新增函数并在渲染进程调用（NoteMark 实战）

## 适用场景
- 你想在 Electron 主进程新增一个能力（例如弹窗、文件读写、系统调用）
- 然后在 React 渲染进程里安全调用这个能力

本项目采用的标准链路是：
- `src/shared/types.ts`：定义跨进程函数类型
- `src/main/lib/index.ts`：实现主进程业务函数
- `src/main/index.ts`：注册 `ipcMain.handle`
- `src/preload/index.ts`：通过 `contextBridge` 暴露到 `window.context`
- `src/preload/index.d.ts`：补全 `window.context` 类型
- `src/renderer/src/*`：在组件或 store 中调用

---

## 一、整体流程（记忆版）
1. 在 `shared` 先定义函数签名（输入/输出）
2. 在 `main/lib` 写函数实现
3. 在 `main/index.ts` 注册 IPC 通道
4. 在 `preload/index.ts` 暴露桥接函数
5. 在 `preload/index.d.ts` 声明 `window.context` 类型
6. 在 renderer 里 `await window.context.xxx(...)` 调用

---

## 二、示例：新增 `showDialog(message)`

下面用一个最小示例演示完整新增过程。

### 1) shared：定义类型契约
文件：`src/shared/types.ts`

```ts
export type ShowDialog = (message: string) => Promise<void>
```

说明：  
`shared` 是主进程和渲染进程共同依赖的“协议层”，先定义这里可以保证两端类型一致。

### 2) main/lib：实现主进程函数
文件：`src/main/lib/index.ts`

```ts
import { dialog } from 'electron'
import { ShowDialog } from '@shared/types'

export const showDialog: ShowDialog = async (message) => {
  await dialog.showMessageBox({
    type: 'info',
    title: 'Message',
    message
  })
}
```

说明：  
这里只做业务能力本身，不处理 IPC 细节。

### 3) main：注册 IPC handler
文件：`src/main/index.ts`

```ts
import { showDialog } from '@/lib'
import { ShowDialog } from '@shared/types'

ipcMain.handle('showDialog', (_, ...args: Parameters<ShowDialog>) => showDialog(...args))
```

说明：  
- `'showDialog'` 是通道名（channel）
- 推荐用 `Parameters<ShowDialog>`，可复用类型，避免参数漂移

### 4) preload：暴露给渲染进程
文件：`src/preload/index.ts`

```ts
import { ShowDialog } from '@shared/types'

contextBridge.exposeInMainWorld('context', {
  // ...已有 API
  showDialog: (...args: Parameters<ShowDialog>) => ipcRenderer.invoke('showDialog', ...args)
})
```

说明：  
renderer 不应直接接触 `ipcRenderer`，统一通过 `window.context`。

### 5) preload 类型声明：让 TS 识别
文件：`src/preload/index.d.ts`

```ts
import { ShowDialog } from '@shared/types'

declare global {
  interface Window {
    context: {
      // ...已有字段
      showDialog: ShowDialog
    }
  }
}
```

说明：  
不补这里会出现 `Property 'showDialog' does not exist on type ...` 的类型错误。

### 6) renderer：实际调用
例如在 React 组件事件中：

```ts
await window.context.showDialog('来自渲染进程的消息')
```

---

## 三、常见问题排查
- 调用没反应：
  - 检查 `ipcMain.handle('showDialog', ...)` 是否注册成功
  - 检查 channel 名称是否前后一致（`showDialog`）
- TS 报错 `window.context.xxx` 不存在：
  - 检查 `src/preload/index.d.ts` 是否补充了字段类型
- 渲染进程访问不到 `window.context`：
  - 检查 `BrowserWindow` 是否启用了 `contextIsolation`
  - 检查 preload 脚本路径是否正确
- 参数类型对不上：
  - 统一从 `src/shared/types.ts` 导出类型，并在 main/preload 复用

---

## 四、推荐约定（项目长期维护）
- 统一命名：`getNotes/readNote/...` 这种动词开头方式
- 一个 channel 对应一个明确能力，不混合 UI 状态
- IPC 层只做转发，业务逻辑尽量放在 `src/main/lib`
- 所有跨层函数都在 `shared` 定义类型，不在两端“各写一份”

按这个模板，你可以很稳定地持续扩展主进程能力，并保持类型安全与安全边界。
