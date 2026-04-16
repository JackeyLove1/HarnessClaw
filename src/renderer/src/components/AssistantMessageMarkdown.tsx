import 'highlight.js/styles/atom-one-light.css';
import 'katex/dist/katex.min.css';

import { Check, Copy } from 'lucide-react';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { cn } from '@/utils';

const getCodeText = (node: ReactNode): string => {
  if (typeof node === 'string') return node
  if (!node) return ''
  if (Array.isArray(node)) return node.map(getCodeText).join('')
  if (typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<{ children?: ReactNode }>
    return getCodeText(element.props.children)
  }
  return ''
}

const extractCodeBlock = (children: ReactNode) => {
  if (!children) return null

  const nodes = Array.isArray(children) ? children : [children]
  const codeNode = nodes.find(
    (node): node is ReactElement<{ className?: string; children?: ReactNode }> =>
      typeof node === 'object' && node !== null && 'props' in node
  )

  if (!codeNode) return null

  const className = codeNode.props.className ?? ''
  const languageMatch = /language-([\w-]+)/.exec(className)
  const language = languageMatch?.[1] ?? 'text'
  const code = getCodeText(codeNode.props.children).replace(/\n$/, '')

  return { language, code, codeNode }
}

const CodeBlock = ({ children }: { children?: ReactNode }) => {
  const [copied, setCopied] = useState(false)
  const codeBlock = extractCodeBlock(children)

  if (!codeBlock) {
    return <pre>{children}</pre>
  }

  const handleCopy = async () => {
    if (!codeBlock.code) return
    try {
      await navigator.clipboard.writeText(codeBlock.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <figure className="my-5 overflow-hidden rounded-2xl border border-[#e6e8ef] bg-white shadow-[0_1px_0_rgba(16,24,40,0.03)]">
      <figcaption className="flex items-center justify-between border-b border-[#eceff5] bg-[#f7f8fb] px-4 py-2.5">
        <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-[#556070]">
          {codeBlock.language}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-[#6b7280] transition hover:bg-[#eceff4] hover:text-[#1f2937]"
          aria-label="复制代码"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? '已复制' : '复制'}
        </button>
      </figcaption>
      <pre className="m-0 overflow-x-auto bg-white px-4 py-3.5 text-[13px] leading-6 text-[#1f2430]">
        {codeBlock.codeNode}
      </pre>
    </figure>
  )
}

const markdownComponents: Components = {
  a: ({ href, children, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
      {children}
    </a>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
}

export interface AssistantMessageMarkdownProps {
  content: string
  className?: string
}

export function AssistantMessageMarkdown({ content, className }: AssistantMessageMarkdownProps) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], [])
  const rehypePlugins = useMemo(() => [rehypeHighlight, rehypeKatex], [])

  return (
    <div
      className={cn(
        'prose prose-sm max-w-none text-[var(--ink-main)]',
        'prose-headings:font-semibold prose-headings:text-[var(--ink-main)]',
        'prose-p:my-2.5 prose-p:font-normal prose-p:leading-8',
        'prose-a:font-medium prose-a:text-[#2563eb] prose-a:underline prose-a:decoration-[#93c5fd] prose-a:underline-offset-2',
        'prose-code:rounded-md prose-code:bg-[#f3f4f6] prose-code:px-1.5 prose-code:py-0.5 prose-code:font-normal prose-code:text-[0.9em] prose-code:text-[#1f2937] prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:my-0 prose-pre:border-0 prose-pre:bg-transparent prose-pre:p-0 prose-pre:shadow-none',
        'prose-pre:text-[13px] prose-pre:leading-relaxed',
        '[&_pre_code]:block [&_pre_code]:bg-transparent [&_pre_code]:p-0',
        'prose-strong:font-semibold prose-strong:text-[var(--ink-main)]',
        'prose-blockquote:border-l-[var(--border-soft)] prose-blockquote:text-[var(--ink-soft)] prose-blockquote:not-italic',
        'prose-ol:my-4 prose-ol:pl-6 prose-ol:[&>li]:my-2',
        'prose-ul:my-4 prose-ul:pl-6 prose-ul:[&>li]:my-1.5',
        'prose-li:leading-8',
        'prose-table:my-4 prose-table:text-[13px]',
        '[&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto',
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
