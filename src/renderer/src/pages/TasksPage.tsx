export const TasksPage = () => {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--content-bg)]">
      <header className="border-b border-[var(--border-soft)] px-8 py-6">
        <h1 className="text-[24px] font-semibold text-[var(--ink-main)]">任务</h1>
        <p className="mt-2 text-[14px] text-[var(--ink-faint)]">任务页首版骨架已就绪，后续可在这里接入任务列表、状态流转与执行日志。</p>
      </header>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-[720px] rounded-3xl border border-[var(--border-soft)] bg-white px-8 py-10 shadow-[0_10px_30px_rgba(15,15,20,0.04)]">
          <h2 className="text-[18px] font-semibold text-[var(--ink-main)]">任务能力开发中</h2>
          <p className="mt-3 text-[14px] leading-7 text-[var(--ink-soft)]">
            当前页面已完成路由隔离和独立落位。下一步可以按模块接入任务创建、任务分派、执行进度追踪等业务能力。
          </p>
        </div>
      </div>
    </section>
  )
}
