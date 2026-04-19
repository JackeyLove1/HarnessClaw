import skillsHeaderImage from '@/assets/1.png';
import { Button } from '@/components/ui';
import { Download, LoaderCircle, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface SkillHubCnSkill {
  category: string
  created_at: number
  description: string
  description_zh: string
  downloads: number
  homepage: string
  iconUrl: string | null
  installs: number
  name: string
  ownerName: string
  score: number
  slug: string
  source: string
  stars: number
  tags: string[] | null
  updated_at: number
  version: string
}

interface InstalledSkillInfo {
  skillId: string
  name: string
  description: string
  tags: string[]
}

const CATEGORIES = ['全部', 'AI 智能', '开发工具', '效率提升', '数据分析', '内容创作']

const CATEGORY_MAP: Record<string, string | undefined> = {
  '全部': undefined,
  'AI 智能': 'ai-intelligence',
  '开发工具': 'developer-tools',
  '效率提升': 'productivity',
  '数据分析': 'data-analysis',
  '内容创作': 'content-creation',
}

const AVATAR_COLORS = [
  { bg: 'bg-[rgba(0,122,255,0.1)]', text: 'text-[rgb(0,122,255)]' },
  { bg: 'bg-[rgba(175,82,222,0.1)]', text: 'text-[rgb(175,82,222)]' },
  { bg: 'bg-[rgba(52,199,89,0.1)]', text: 'text-[rgb(52,199,89)]' },
  { bg: 'bg-[rgba(255,149,0,0.1)]', text: 'text-[rgb(255,149,0)]' },
  { bg: 'bg-[rgba(255,45,85,0.1)]', text: 'text-[rgb(255,45,85)]' },
  { bg: 'bg-[rgba(90,200,250,0.12)]', text: 'text-[rgb(50,173,230)]' },
]

interface SkillCardProps {
  skill: SkillHubCnSkill
  isInstalled: boolean
  isInstalling: boolean
  onInstall: () => void
}

const SkillCard = ({ skill, isInstalled, isInstalling, onInstall }: SkillCardProps) => {
  const colorIndex = skill.name.charCodeAt(0) % AVATAR_COLORS.length
  const { bg, text } = AVATAR_COLORS[colorIndex]
  const displayDescription = skill.description_zh || skill.description

  return (
    <div className="w-full text-left flex items-start gap-4 py-5 px-4 hover:bg-[#f9f9f9] transition-colors duration-200 cursor-pointer group border-b border-[rgba(0,0,0,0.06)] last:border-b-0">
      <div
        className={`w-12 h-12 rounded-[8px] flex items-center justify-center shrink-0 font-bold text-base ${bg} ${text}`}
      >
        {skill.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[16px] font-medium text-[var(--ink-main)] truncate tracking-tight leading-[1.5]">
            {skill.name}
          </span>
          {skill.category && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f4f4f8] text-[var(--ink-faint)]">
              {skill.category}
            </span>
          )}
        </div>
        <p className="text-[13px] font-light text-[rgba(0,0,0,0.6)] leading-[1.69] line-clamp-1">
          {displayDescription}
        </p>
        <div className="flex items-center gap-4 mt-2 text-[12px] text-[rgba(0,0,0,0.4)]">
          <span className="flex items-center gap-1">
            <span className="text-[10px]">★</span>
            {skill.stars.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <Download className="w-3 h-3" />
            {skill.installs.toLocaleString()}
          </span>
          <span className="text-[11px]">{skill.source}</span>
        </div>
      </div>
      <div className="shrink-0 hidden md:flex items-center pt-[3px]">
        {isInstalled ? (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[rgba(52,199,89,0.1)] text-[12px] font-medium text-[rgb(52,199,89)]">
            已安装
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              onInstall()
            }}
            disabled={isInstalling}
            className="h-8 rounded-full px-4 border-[#e6e9ef] text-[13px] font-medium hover:bg-[#f9f9f9]"
          >
            {isInstalling ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                安装
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

export const SkillsPage = () => {
  const [skills, setSkills] = useState<SkillHubCnSkill[]>([])
  const [installedSkills, setInstalledSkills] = useState<InstalledSkillInfo[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('全部')
  const [isLoading, setIsLoading] = useState(false)
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const skillsCacheRef = useRef<Map<string, { skills: SkillHubCnSkill[]; total: number }>>(new Map())

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)

    return () => {
      window.clearTimeout(timer)
    }
  }, [searchQuery])

  useEffect(() => {
    const loadInstalled = async () => {
      try {
        const installed = await window.context.listInstalledSkills()
        setInstalledSkills(installed)
      } catch (e) {
        console.error('Failed to load installed skills', e)
      }
    }

    void loadInstalled()
  }, [])

  useEffect(() => {
    const loadSkills = async () => {
      const keyword = debouncedSearchQuery.trim()
      const category = CATEGORY_MAP[selectedCategory]
      const cacheKey = JSON.stringify({
        page: 1,
        pageSize: 24,
        keyword,
        category: category ?? 'all',
        sortBy: 'score',
        order: 'desc'
      })

      const cached = skillsCacheRef.current.get(cacheKey)
      if (cached) {
        setError('')
        setSkills(cached.skills)
        setTotal(cached.total)
        return
      }

      setIsLoading(true)
      setError('')
      try {
        const result = await window.context.listSkills(1, 24, {
          keyword,
          category,
          sortBy: 'score',
          order: 'desc'
        })
        skillsCacheRef.current.set(cacheKey, {
          skills: result.skills,
          total: result.total
        })
        setSkills(result.skills)
        setTotal(result.total)
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        setIsLoading(false)
      }
    }

    void loadSkills()
  }, [debouncedSearchQuery, selectedCategory])

  const handleSearch = useCallback((query: string) => {
    // Manual search trigger bypasses waiting for debounce timer.
    setDebouncedSearchQuery(query)
  }, [])

  const handleInstall = async (slug: string) => {
    setInstallingSlug(slug)
    try {
      const result = await window.context.installSkill(slug)
      if (result.success) {
        toast.success(`已安装：${result.slug}`)
        const installed = await window.context.listInstalledSkills()
        setInstalledSkills(installed)
      } else {
        toast.error(`安装失败：${result.error}`)
      }
    } catch (e) {
      toast.error(`安装失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setInstallingSlug(null)
    }
  }

  const isInstalled = (slug: string) =>
    installedSkills.some((s) => s.skillId.toLowerCase() === slug.toLowerCase())

  // Category has already been filtered by backend via listSkills(category),
  // so we should render the returned items directly.
  const filteredSkills = skills

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--content-bg)]">
      {/* Header */}
      <div className="border-b border-[var(--border-soft)] px-6 py-5">
        <div className="flex items-center gap-5 mb-5">
          <div className="flex-1 min-w-0">
            <h1 className="text-[32px] font-medium tracking-tight text-[var(--ink-main)] mb-[12px]">
              全部技能
            </h1>
            <p className="text-[14px] font-medium text-[rgba(0,0,0,0.9)] leading-relaxed">
              快速发现专家技能，让 AI 从通用走向专用
              <span className="text-[rgba(0,0,0,0.4)]"> · 共 {total > 0 ? total.toLocaleString() : skills.length} 个技能</span>
            </p>
          </div>
          <img
            alt=""
            className="hidden md:block shrink-0 w-[206px] h-[134px] object-cover rounded-2xl"
            src={skillsHeaderImage}
          />
        </div>

        {/* Category Pills */}
        <div className="overflow-x-auto scrollbar-none mt-[24px]">
          <div className="flex items-center gap-2 pb-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`whitespace-nowrap px-4 py-2 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                  selectedCategory === cat
                    ? 'bg-[var(--ink-main)] text-white'
                    : 'bg-[#f4f4f8] text-[var(--ink-faint)] hover:bg-[#e8e8f0]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Search Bar */}
        <div className="mt-5 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#636366] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleSearch(searchQuery)
                }
              }}
              placeholder="搜索 skill 名称、描述、标签..."
              className="w-full h-11 pl-10 pr-4 rounded-[8px] bg-white border border-[#e6e9ef] text-sm text-[var(--ink-main)] placeholder:text-[rgba(0,0,0,0.3)] outline-none tracking-tight focus:border-[#d6dae2] transition-all duration-200"
            />
          </div>
          <Button
            onClick={() => void handleSearch(searchQuery)}
            disabled={isLoading}
            className="h-11 px-5 rounded-[8px] bg-[var(--ink-main)] text-white hover:bg-[#2c2c34] transition-colors"
          >
            {isLoading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              '搜索'
            )}
          </Button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mx-6 mt-4 rounded-[8px] border border-[#fecaca] bg-[#fff1f2] px-4 py-3 text-[13px] text-[#b42318]">
          {error}
        </div>
      )}

      {/* Skills List */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {filteredSkills.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--ink-faint)]">
            <Search className="h-12 w-12 opacity-30 mb-3" />
            <p className="text-[15px]">{searchQuery ? '未找到相关技能' : '加载技能列表失败'}</p>
            <p className="text-[13px] mt-1">{searchQuery ? '试试其他关键词' : '请稍后重试'}</p>
          </div>
        )}

        {filteredSkills.length > 0 && (
          <div className="overflow-auto bg-white rounded-[8px] border border-[rgba(0,0,0,0.08)]">
            {filteredSkills.map((skill, index) => (
              <div key={skill.slug}>
                {index > 0 && <div className="h-px bg-[rgba(0,0,0,0.06)]" />}
                <SkillCard
                  skill={skill}
                  isInstalled={isInstalled(skill.slug)}
                  isInstalling={installingSlug === skill.slug}
                  onInstall={() => void handleInstall(skill.slug)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
