import { Eye, EyeOff, LoaderCircle, Save, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type SaveState = 'idle' | 'saved' | 'error'
type TestState = 'idle' | 'success' | 'error'

export const SettingsPage = () => {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [showApiKey, setShowApiKey] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadSettings = async () => {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const settings = await window.context.getAnthropicSettings()
        if (!isMounted) return

        setBaseUrl(settings.baseUrl ?? '')
        setApiKey(settings.apiKey ?? '')
        setModel(settings.model ?? 'claude-sonnet-4-20250514')
      } catch (error) {
        if (!isMounted) return
        setErrorMessage(error instanceof Error ? error.message : '读取配置失败，请稍后再试。')
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadSettings()

    return () => {
      isMounted = false
    }
  }, [])

  const canSave = useMemo(() => {
    return Boolean(baseUrl.trim()) && Boolean(apiKey.trim()) && Boolean(model.trim()) && !isSaving && !isLoading
  }, [apiKey, baseUrl, model, isLoading, isSaving])

  const canTest = useMemo(() => {
    return (
      Boolean(baseUrl.trim()) &&
      Boolean(apiKey.trim()) &&
      Boolean(model.trim()) &&
      !isTesting &&
      !isLoading
    )
  }, [apiKey, baseUrl, model, isLoading, isTesting])

  const handleSave = async () => {
    if (!canSave) return

    setIsSaving(true)
    setSaveState('idle')
    setErrorMessage('')

    try {
      await window.context.saveAnthropicSettings({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim()
      })
      setSaveState('saved')
    } catch (error) {
      setSaveState('error')
      setErrorMessage(error instanceof Error ? error.message : '保存失败，请检查配置后重试。')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTestConnection = async () => {
    if (!canTest) return

    setIsTesting(true)
    setTestState('idle')
    setTestMessage('')
    setErrorMessage('')

    try {
      const result = await window.context.testAnthropicConnection({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim()
      })
      setTestState('success')
      setTestMessage(
        `连接成功：${result.provider}/${result.model} · ${result.latencyMs}ms${
          result.baseUrl ? ` · ${result.baseUrl}` : ''
        }`
      )
    } catch (error) {
      setTestState('error')
      setTestMessage(error instanceof Error ? error.message : '连接测试失败，请检查 Base URL 与 API Key。')
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--content-bg)]">
      <aside className="w-[220px] border-r border-[var(--border-soft)] px-4 py-6">
        <p className="text-[22px] font-semibold text-[var(--ink-main)]">设置</p>
        <div className="mt-5 rounded-2xl border border-[var(--border-soft)] bg-white p-2 shadow-[0_8px_24px_rgba(15,15,20,0.04)]">
          <div className="flex items-center gap-2 rounded-xl bg-[#f5f5fa] px-3 py-2 text-[14px] font-medium text-[var(--ink-main)]">
            <Settings2 className="h-4 w-4" />
            <span>通用设置</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 justify-center overflow-auto px-8 py-8">
        <div className="w-full max-w-[860px]">
          <div className="rounded-3xl border border-[var(--border-soft)] bg-white px-8 py-7 shadow-[0_14px_38px_rgba(15,15,20,0.05)]">
            <h1 className="text-[28px] font-semibold text-[var(--ink-main)]">通用设置</h1>
            <p className="mt-2 text-[14px] text-[var(--ink-faint)]">
              配置 Anthropic 兼容接口与模型名。保存后会同步写入本地 `~/.deepclaw/.env` 并立即生效。
            </p>

            <div className="mt-8 space-y-5">
              <div>
                <label
                  htmlFor="anthropic-base-url"
                  className="mb-2 block text-[15px] font-semibold text-[var(--ink-main)]"
                >
                  Base URL
                </label>
                <input
                  id="anthropic-base-url"
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value)
                    setTestState('idle')
                    setTestMessage('')
                  }}
                  placeholder="例如: https://api.anthropic.com"
                  className="h-11 w-full rounded-xl border border-[var(--border-soft)] bg-[#fbfbfe] px-3 text-[14px] text-[var(--ink-main)] outline-none transition-all focus:border-[#b9b9ca] focus:bg-white"
                />
              </div>

              <div>
                <label
                  htmlFor="anthropic-api-key"
                  className="mb-2 block text-[15px] font-semibold text-[var(--ink-main)]"
                >
                  API Key
                </label>
                <div className="flex h-11 items-center rounded-xl border border-[var(--border-soft)] bg-[#fbfbfe] pr-2 transition-all focus-within:border-[#b9b9ca] focus-within:bg-white">
                  <input
                    id="anthropic-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value)
                      setTestState('idle')
                      setTestMessage('')
                    }}
                    placeholder="输入 Anthropic API Key"
                    className="h-full min-w-0 flex-1 rounded-l-xl bg-transparent px-3 text-[14px] text-[var(--ink-main)] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((value) => !value)}
                    aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-subtle)] transition-colors hover:bg-[#efeff5] hover:text-[var(--ink-main)]"
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="anthropic-model-name"
                  className="mb-2 block text-[15px] font-semibold text-[var(--ink-main)]"
                >
                  Model Name
                </label>
                <input
                  id="anthropic-model-name"
                  value={model}
                  onChange={(event) => {
                    setModel(event.target.value)
                    setTestState('idle')
                    setTestMessage('')
                  }}
                  placeholder="例如: claude-sonnet-4-20250514"
                  className="h-11 w-full rounded-xl border border-[var(--border-soft)] bg-[#fbfbfe] px-3 text-[14px] text-[var(--ink-main)] outline-none transition-all focus:border-[#b9b9ca] focus:bg-white"
                />
              </div>
            </div>

            {errorMessage && (
              <div className="mt-5 rounded-xl border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[13px] text-[#b91c1c]">
                {errorMessage}
              </div>
            )}

            {saveState === 'saved' && !errorMessage && (
              <div className="mt-5 rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-[13px] text-[#166534]">
                配置已保存，新的对话请求将使用最新设置。
              </div>
            )}

            {testState !== 'idle' && testMessage && (
              <div
                className={`mt-5 rounded-xl border px-3 py-2 text-[13px] ${
                  testState === 'success'
                    ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
                    : 'border-[#fecaca] bg-[#fff1f2] text-[#b91c1c]'
                }`}
              >
                {testMessage}
              </div>
            )}

            <div className="mt-7 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={!canTest}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border-soft)] bg-white px-4 text-[14px] font-medium text-[var(--ink-main)] transition-all hover:bg-[#f6f6fb] disabled:cursor-not-allowed disabled:bg-[#f4f4f7] disabled:text-[#9ca0ad]"
              >
                {isTesting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                <span>{isTesting ? '测试中...' : '测试连接'}</span>
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--ink-main)] px-5 text-[14px] font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[#c3c3cf]"
              >
                {isSaving ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>{isSaving ? '保存中...' : '保存配置'}</span>
              </button>
            </div>
          </div>

          {isLoading && (
            <div className="mt-4 text-[13px] text-[var(--ink-faint)]">正在读取已保存配置...</div>
          )}
        </div>
      </div>
    </section>
  )
}
