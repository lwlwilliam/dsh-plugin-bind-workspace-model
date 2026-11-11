window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-bind-workspace-model',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 模块加载器 id，与 package.json 里的包名 / dsh.client 条目一致。 */
    const PLUGIN_ID = '@local/dsh-plugin-bind-workspace-model'
    /** 本插件可见文案所属的 locale 命名空间。 */
    const NS = 'dsh-plugin-bind-workspace-model'
    /** Host 精确路由（相对文档，无前导斜杠）。 */
    const ROUTE_STATE = 'api/dsh-plugin-bind-workspace-model/state'
    const ROUTE_BINDING = 'api/dsh-plugin-bind-workspace-model/binding'
    /** 对话框在 shell.overlay 里的注册 id。 */
    const OVERLAY_ID = 'workspace-default-model'
    /** 上下文菜单图标 key。 */
    const ICON_KEY = 'workspace.defaultModel'
    /** provider 排序：DeepSeek 账号、DeepSeek、其余保持目录顺序。 */
    const PROVIDER_ORDER = { 'deepseek-account': 0, deepseek: 1 }

    // ---------------------------------------------------------------------
    // 本地化文案。扁平键，所有可见字符串都经过 `t`。
    // ---------------------------------------------------------------------
    const en = {
      'menu.label': 'Default model',
      'dialog.title': 'Workspace default model',
      'dialog.description': 'New sessions in this workspace start on this model.',
      'dialog.following': 'No workspace default; new sessions follow the global default ({model}).',
      'dialog.loading': 'Loading models…',
      'dialog.empty': 'No models available. Add a provider or its credentials in Settings → Models.',
      'dialog.failures': '{count} provider(s) could not list models.',
      'dialog.search': 'Search models',
      'dialog.clearSearch': 'Clear search',
      'dialog.effort.title': 'Reasoning effort for {model}',
      'dialog.effort.auto': 'Auto (provider default)',
      'dialog.effort.autoShort': 'Auto',
      'dialog.effort.back': 'Back',
      'dialog.clear': 'Clear',
      'dialog.close': 'Close',
      'dialog.pending': 'Saving…',
      'toast.saved': 'Workspace default model saved',
      'toast.cleared': 'Workspace default model cleared',
      'error.load': 'Could not load the model catalog. Is the plugin host half loaded?',
      'error.save': 'Could not save the workspace default model.',
      'error.unavailable': 'The workspace default model service is unavailable.',
      'provider.account': 'DeepSeek Account',
    }
    const zh = {
      'menu.label': '默认模型',
      'dialog.title': '工作区默认模型',
      'dialog.description': '该工作区里新建的会话默认使用这个模型。',
      'dialog.following': '未设置工作区默认模型；新建会话跟随全局默认（{model}）。',
      'dialog.loading': '正在加载模型…',
      'dialog.empty': '暂无可用模型。请在 设置 → 模型 中添加提供方或凭据。',
      'dialog.failures': '有 {count} 个提供方无法列出模型。',
      'dialog.search': '搜索模型',
      'dialog.clearSearch': '清除搜索',
      'dialog.effort.title': '推理强度：{model}',
      'dialog.effort.auto': 'Auto（跟随提供方默认）',
      'dialog.effort.autoShort': 'Auto',
      'dialog.effort.back': '返回',
      'dialog.clear': '清除',
      'dialog.close': '关闭',
      'dialog.pending': '正在保存…',
      'toast.saved': '已保存工作区默认模型',
      'toast.cleared': '已清除工作区默认模型',
      'error.load': '无法加载模型目录，请确认插件的 Host 半已加载。',
      'error.save': '保存工作区默认模型失败。',
      'error.unavailable': '工作区默认模型服务不可用。',
      'provider.account': 'DeepSeek 账号',
    }

    // ---------------------------------------------------------------------
    // 样式。
    //
    // 取值来自宿主自己的设计语言：Modal 壳、Menu 列表项、Button、Tag 的
    // CSS 规则（从装好的 DSH 前端产物里抄来后仅改前缀），因此颜色、圆角、
    // 阴影、字号、间距、hover 反馈与官方对话框完全同源；颜色一律走
    // `--dsw-*` / `--dsh-*` 主题变量，不写死色值。
    // ---------------------------------------------------------------------
    const CSS = `
/* 官方 Modal 壳（ui-primitives Modal） */
.wbm-root{pointer-events:auto;position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top, 24px)) 24px}
.wbm-mask{position:absolute;inset:var(--dsh-frame-chrome-top, 0px) 0 0;backdrop-filter:var(--dsw-mask-blur)}
.wbm-mask:after{content:"";position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);animation:wbm-modal-enter var(--ds-transition-duration) var(--ds-ease-in-out)}
@keyframes wbm-modal-enter{0%{opacity:0}to{opacity:1}}
.wbm-dialog{box-sizing:border-box;position:relative;z-index:1;display:flex;flex-direction:column;width:min(440px,100%);max-height:100%;overflow:hidden;border:0;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);animation:wbm-modal-enter var(--ds-transition-duration) var(--ds-ease-in-out);outline:none}
.wbm-dialog:focus{outline:none}
.wbm-content{display:flex;flex-direction:column;width:100%;min-height:0}
.wbm-header{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px}
.wbm-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
.wbm-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary);padding:0}
@media(hover:hover){.wbm-close:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.wbm-close:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}
.wbm-description{margin:0;padding:0 24px;font-size:14px;line-height:22px;font-weight:400;color:var(--dsw-alias-label-primary)}
.wbm-path{margin-top:2px;padding:0 24px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbm-body{display:flex;flex:1 1 auto;flex-direction:column;min-width:0;min-height:0;margin-top:20px;padding:0 24px}
/* 官方模型菜单的搜索行 */
.wbm-searchRow{flex:none;position:relative;margin:2px 0 3px}
.wbm-search{box-sizing:border-box;width:100%;border-radius:var(--dsw-radius-md);background:0 0;border:0 solid #0000;height:auto;padding:5px 7px;display:flex;color:inherit;font:inherit;font-size:12px;line-height:normal;outline:none}
.wbm-search::placeholder{color:var(--dsw-alias-label-caption)}
.wbm-searchWithQuery{padding-right:34px}
.wbm-searchClear{corner-shape:round;width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:50%;justify-content:center;align-items:center;padding:0;display:inline-flex;position:absolute;top:50%;right:4px;transform:translateY(-50%)}
.wbm-searchClear:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
@media(hover:hover){.wbm-searchClear:hover{background:var(--dsw-alias-interactive-bg-hover)}}
/* 官方 Menu 列表 */
.wbm-list{display:flex;flex:0 1 auto;flex-direction:column;min-height:0;overflow-y:auto;padding:4px 0;overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.wbm-group{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
.wbm-groupTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbm-groupAction{flex:none;height:22px;padding:0 6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;gap:3px;font:inherit;font-size:11px;line-height:15px}
@media(hover:hover){.wbm-groupAction:hover{background:var(--dsw-alias-interactive-bg-hover)}}
/* 官方模型菜单的选项行 */
.wbm-option{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;min-height:34px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:5px 7px;display:flex}
.wbm-option:focus-visible,.wbm-optionActive:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
@media(hover:hover){.wbm-option:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}
.wbm-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.wbm-optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}
.wbm-modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400;line-height:18px;overflow:hidden}
.wbm-badgedName{vertical-align:baseline;white-space:nowrap;align-items:center;gap:4px;max-width:100%;display:inline-flex}
.wbm-badgedNameText{text-overflow:ellipsis;min-width:0;overflow:hidden}
.wbm-badge{flex:none}
.wbm-effort{flex:none;max-width:40%;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbm-check{color:var(--dsw-alias-label-primary);flex:0 0 14px;place-items:center;display:grid}
.wbm-check svg{width:14px;height:14px}
.wbm-chevron{width:14px;height:14px;color:var(--dsw-alias-menu-icon);flex:none}
/* 官方 Tag 角标 */
.wbm-tag{display:inline-flex;align-items:center;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}
.wbm-tag[data-tone=neutral]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.wbm-tag[data-tone=quiet]{color:var(--dsw-alias-label-tertiary)}
.wbm-tag[data-tone=info]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}
.wbm-tag[data-tone=success]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
.wbm-tag[data-tone=warning]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}
.wbm-tag[data-tone=danger]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
/* 状态与错误 */
.wbm-status,.wbm-empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:12px;line-height:18px}
.wbm-status{display:flex;align-items:center;gap:8px}
.wbm-error{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);align-items:flex-start;gap:6px;margin:4px 0;padding:6px 7px;font-size:11px;line-height:16px;display:flex}
/* 官方 Button */
.wbm-footer{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:20px 24px 24px}
.wbm-footerNote{flex:1;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbm-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:none;border-radius:var(--dsw-radius-sm);cursor:pointer;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);background:transparent;height:28px;padding:0 10px;font-family:inherit}
.wbm-button:disabled{cursor:not-allowed;opacity:.4}
.wbm-buttonPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
@media(hover:hover){.wbm-buttonPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}}
.wbm-buttonGhost:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
@media(hover:hover){.wbm-buttonGhost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}
.wbm-buttonDanger{color:var(--dsw-alias-state-error-primary)}
@media(hover:hover){.wbm-buttonDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}}
.wbm-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-brand-primary);animation:wbm-spin .8s linear infinite}
@keyframes wbm-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.wbm-mask:after,.wbm-dialog{animation:none}.wbm-spinner{animation:none}}
`

    // ---------------------------------------------------------------------
    // 小工具
    // ---------------------------------------------------------------------

    /** 读取宿主当前语言（'zh' / 'en'）。 */
    function currentLanguage(ctx) {
      try {
        const raw = typeof ctx.locale?.getLocale === 'function' ? ctx.locale.getLocale() : undefined
        const text = typeof raw === 'string' ? raw.toLowerCase() : ''
        return text.indexOf('zh') === 0 ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    }

    /** 生成插值翻译函数。 */
    function makeInterpolate(t) {
      return function translate(key, params) {
        const template = t(key)
        if (params === undefined || params === null) return template
        return template.replace(/\{(\w+)\}/g, (match, name) => {
          const value = params[name]
          return value === undefined || value === null ? match : String(value)
        })
      }
    }

    /** 模糊匹配：忽略大小写与空格，按顺序匹配字符。 */
    function fuzzyMatch(name, query) {
      const needle = query.trim().toLowerCase()
      if (needle === '') return true
      const haystack = name.toLowerCase()
      let index = 0
      for (const char of haystack) {
        if (char === needle[index]) index += 1
        if (index === needle.length) return true
      }
      return false
    }

    /** 搜索排序：前缀命中优先，其余保持目录顺序。 */
    function rankModels(models, query) {
      const needle = query.trim().toLowerCase()
      if (needle === '') return models
      const matched = []
      for (let index = 0; index < models.length; index += 1) {
        const model = models[index]
        if (!fuzzyMatch(model.name, needle)) continue
        matched.push({ model, index, prefix: model.name.toLowerCase().indexOf(needle) === 0 ? 0 : 1 })
      }
      matched.sort((left, right) => left.prefix - right.prefix || left.index - right.index)
      return matched.map((item) => item.model)
    }

    /** provider 分组排序：DeepSeek 账号、DeepSeek、其余保持目录顺序。 */
    function orderGroups(groups) {
      return groups
        .map((group, index) => ({ group, index }))
        .sort((left, right) => {
          const leftRank = PROVIDER_ORDER[left.group.id] ?? 2
          const rightRank = PROVIDER_ORDER[right.group.id] ?? 2
          return leftRank - rightRank || left.index - right.index
        })
        .map((item) => item.group)
    }

    /** 选择某个模型的默认值（catalog 里带默认推理强度时一并带上）。 */
    function selectionOf(group, model) {
      const selection = { provider: group.id, model: model.id }
      const defaultEffort = model.reasoning?.defaultEffort
      if (defaultEffort !== undefined) selection.reasoningEffort = defaultEffort
      return selection
    }

    /** 当前绑定是否就是这个模型。 */
    function sameModel(left, provider, model) {
      return left !== null && left !== undefined && left.provider === provider && left.model === model
    }

    /** 角标文字按当前语言解析。 */
    function badgeLabel(badge, lang) {
      if (badge === null || badge === undefined) return ''
      const text = badge.text
      if (typeof text === 'string') return text
      if (text !== null && typeof text === 'object') {
        const localized = text[lang] ?? text.en
        return typeof localized === 'string' ? localized : ''
      }
      return ''
    }

    /** 角标色调 → 官方 Tag 的 data-tone。 */
    function badgeTone(tone) {
      if (tone === 'success') return 'success'
      if (tone === 'warning') return 'warning'
      if (tone === 'danger' || tone === 'error') return 'danger'
      if (tone === 'info' || tone === 'brand') return 'info'
      if (tone === 'neutral') return 'neutral'
      return 'quiet'
    }

    /** 勾选图标。 */
    function CheckIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
        h('path', {
          d: 'M3.5 8.5 6.5 11.5 12.5 4.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** 下钻箭头。 */
    function ChevronIcon() {
      return h(
        'svg',
        { className: 'wbm-chevron', viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
        h('path', {
          d: 'm6 3.5 4.5 4.5L6 12.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** 返回箭头。 */
    function BackIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true },
        h('path', {
          d: 'M10 3.5 5.5 8l4.5 4.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** 关闭图标。 */
    function CloseIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true },
        h('path', {
          d: 'm4 4 8 8M12 4l-8 8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      )
    }

    /** 工作区行“...”菜单里的图标：滑杆 + 会话气泡。 */
    function WorkspaceDefaultModelIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M3 4.5h10M3 8h10M3 11.5h6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 6, cy: 4.5, r: 1.6, fill: 'currentColor' }),
        h('circle', { cx: 10, cy: 8, r: 1.6, fill: 'currentColor' }),
        h('circle', { cx: 12, cy: 11.5, r: 1.6, fill: 'currentColor' }),
      )
    }

    /** 极简外部 store：菜单动作打开对话框，overlay 组件订阅它。 */
    function createDialogStore() {
      let snapshot = { open: false, target: null }
      const listeners = new Set()
      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        get() {
          return snapshot
        },
        open(target) {
          snapshot = { open: true, target }
          for (const listener of listeners) listener()
        },
        close() {
          if (snapshot.open === false) return
          snapshot = { open: false, target: null }
          for (const listener of listeners) listener()
        },
      }
    }

    // ---------------------------------------------------------------------
    // 对话框
    // ---------------------------------------------------------------------

    /**
     * 工作区默认模型选择对话框。
     *
     * 视觉与官方 Modal（ui-primitives Modal）+ 模型菜单（ui-model-selection）
     * 同一套规则：Modal 壳负责遮罩/圆角/阴影/标题/页脚，列表复用官方 Menu
     * 的 34px 选项行、11px 分组标题、Tag 角标与搜索行。选中即保存。
     */
    function DialogView(props) {
      const { store, t, notify } = props
      const snapshot = React.useSyncExternalStore(store.subscribe, store.get, store.get)
      const open = snapshot.open === true && snapshot.target !== null
      const target = snapshot.target

      const [state, setState] = React.useState({ status: 'idle', data: null, error: null })
      const [pane, setPane] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [pending, setPending] = React.useState(false)
      const [activeIndex, setActiveIndex] = React.useState(0)
      const panelRef = React.useRef(null)
      const listRef = React.useRef(null)
      const searchRef = React.useRef(null)
      const lang = currentLanguage(props.ctx)

      // 打开时加载状态；关闭时取消在途请求。
      React.useEffect(() => {
        if (!open || target === null) {
          setState({ status: 'idle', data: null, error: null })
          setPane(null)
          setQuery('')
          setPending(false)
          setActiveIndex(0)
          return undefined
        }
        const controller = new AbortController()
        setState({ status: 'loading', data: null, error: null })
        setPane(null)
        setQuery('')
        setPending(false)
        setActiveIndex(0)
        fetch(`${ROUTE_STATE}?path=${encodeURIComponent(target.path)}`, {
          method: 'GET',
          credentials: 'same-origin',
          signal: controller.signal,
        })
          .then(async (response) => {
            const body = await response.json().catch(() => null)
            if (controller.signal.aborted) return
            if (!response.ok || body === null || body.ok !== true) {
              setState({ status: 'error', data: null, error: t('error.unavailable') })
              return
            }
            setState({ status: 'ready', data: body, error: null })
          })
          .catch((error) => {
            if (controller.signal.aborted || error?.name === 'AbortError') return
            setState({ status: 'error', data: null, error: t('error.load') })
          })
        return () => {
          controller.abort()
        }
      }, [open, target === null ? '' : target.path, t])

      const data = state.data
      const groups = React.useMemo(() => {
        if (data === null || data.catalog === null || !Array.isArray(data.catalog.groups)) return []
        return orderGroups(data.catalog.groups)
          .map((group) => ({
            ...group,
            models: rankModels(Array.isArray(group.models) ? group.models : [], query),
          }))
          .filter((group) => group.models.length > 0)
      }, [data, query])

      const choices = React.useMemo(() => {
        const list = []
        for (const group of groups) {
          for (const model of group.models) list.push({ group, model })
        }
        return list
      }, [groups])

      const totalModels = React.useMemo(() => {
        if (data === null || data.catalog === null || !Array.isArray(data.catalog.groups)) return 0
        let count = 0
        for (const group of data.catalog.groups) count += Array.isArray(group.models) ? group.models.length : 0
        return count
      }, [data])

      const showSearch = totalModels > 4
      const binding = data !== null ? data.binding : null
      const defaults = data !== null ? data.defaults : null
      const effortChoices = React.useMemo(() => {
        if (pane === null) return []
        const efforts = Array.isArray(pane.model.reasoning?.efforts) ? pane.model.reasoning.efforts : []
        const rows = [{ key: 'auto', effort: undefined, label: t('dialog.effort.auto') }]
        for (const effort of efforts) rows.push({ key: `effort:${effort.id}`, effort: effort.id, label: effort.name })
        return rows
      }, [pane, t])

      // 打开后把焦点放进面板；显示搜索框时优先聚焦搜索。
      React.useEffect(() => {
        if (!open) return
        const search = searchRef.current
        if (search !== null && typeof search.focus === 'function') {
          search.focus()
          return
        }
        if (state.status !== 'ready') return
        const panel = panelRef.current
        if (panel !== null && typeof panel.focus === 'function') panel.focus()
      }, [open, state.status, showSearch])

      /** 关闭对话框。 */
      const close = React.useCallback(() => {
        store.close()
      }, [store])

      /** 保存一份选择（null 表示清除）。 */
      const save = React.useCallback(
        async (selection) => {
          if (pending) return
          setPending(true)
          try {
            const response = await fetch(ROUTE_BINDING, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ path: target.path, selection }),
            })
            const body = await response.json().catch(() => null)
            if (!response.ok || body === null || body.ok !== true) {
              setState((previous) => ({
                ...previous,
                error:
                  body !== null && typeof body.message === 'string' && body.message !== ''
                    ? body.message
                    : t('error.save'),
              }))
              setPending(false)
              return
            }
            setPending(false)
            notify(selection === null ? t('toast.cleared') : t('toast.saved'), true)
            close()
          } catch {
            setState((previous) => ({ ...previous, error: t('error.save') }))
            setPending(false)
          }
        },
        [pending, target, t, notify, close],
      )

      /** 点击模型行：有推理强度则下钻，否则直接保存。 */
      const chooseModel = React.useCallback(
        (group, model) => {
          if (pending) return
          const efforts = Array.isArray(model.reasoning?.efforts) ? model.reasoning.efforts : []
          if (efforts.length === 0) {
            void save(selectionOf(group, model))
            return
          }
          setPane({ group, model })
          setActiveIndex(0)
        },
        [pending, save],
      )

      /** 当前推理强度行是否即为已保存选择。 */
      const effortSelected = React.useCallback(
        (effort) => {
          if (binding === null || pane === null) return false
          if (!sameModel(binding, pane.group.id, pane.model.id)) return false
          const current = binding.reasoningEffort
          if (effort === undefined) return current === undefined
          return current === effort
        },
        [binding, pane],
      )

      /** 把推理强度行转换成选择。 */
      const rowSelection = (row) => {
        const selection = { provider: pane.group.id, model: pane.model.id }
        if (row.effort !== undefined) selection.reasoningEffort = row.effort
        return selection
      }

      /** 键盘：上下移动高亮，Enter 激活，Escape/退格退回或关闭。 */
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          if (pane !== null) {
            setPane(null)
            setActiveIndex(0)
          } else {
            close()
          }
          return
        }
        if (pane !== null && event.key === 'Backspace' && query === '') {
          setPane(null)
          setActiveIndex(0)
          return
        }
        const rows = pane === null ? choices : effortChoices
        if (rows.length === 0) return
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActiveIndex((index) => (index + 1) % rows.length)
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActiveIndex((index) => (index - 1 + rows.length) % rows.length)
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const index = Math.max(0, Math.min(activeIndex, rows.length - 1))
          if (pane === null) {
            const choice = rows[index]
            if (choice !== undefined) chooseModel(choice.group, choice.model)
          } else {
            const row = rows[index]
            if (row !== undefined) void save(rowSelection(row))
          }
        }
      }

      // 高亮行滚动进视野。
      React.useEffect(() => {
        const list = listRef.current
        if (list === null) return
        const row = list.querySelector(`[data-wbm-index="${activeIndex}"]`)
        if (row !== null && typeof row.scrollIntoView === 'function') {
          row.scrollIntoView({ block: 'nearest' })
        }
      }, [activeIndex, pane, groups.length])

      if (!open) return null

      /** 顶部标题、说明与工作区路径。 */
      const header = h(
        'div',
        { className: 'wbm-header' },
        h('h2', { className: 'wbm-title' }, t('dialog.title')),
        h(
          'button',
          { type: 'button', className: 'wbm-close', 'aria-label': t('dialog.close'), title: t('dialog.close'), onClick: close },
          h(CloseIcon, null),
        ),
      )
      const subtitle =
        target.displayTitle !== undefined && target.displayTitle !== ''
          ? target.displayTitle
          : target.path
      const description = h('div', { className: 'wbm-description' }, t('dialog.description'))
      const pathLine = h('div', { className: 'wbm-path', title: target.path }, subtitle)

      /** 列表区。 */
      let index = -1
      let list = null
      let toolbar = null
      if (state.status === 'loading') {
        list = h(
          'div',
          { className: 'wbm-status' },
          h('span', { className: 'wbm-spinner' }),
          h('span', null, t('dialog.loading')),
        )
      } else if (state.status === 'error') {
        list = h('div', { className: 'wbm-empty' }, state.error ?? t('error.load'))
      } else if (data !== null && totalModels === 0) {
        list = h('div', { className: 'wbm-empty' }, t('dialog.empty'))
      } else if (pane !== null) {
        const efforts = effortChoices.map((row, rowIndex) => {
          const selected = effortSelected(row.effort)
          return h(
            'button',
            {
              key: row.key,
              type: 'button',
              role: 'menuitemradio',
              'aria-checked': selected,
              'data-wbm-index': rowIndex,
              className: 'wbm-option' + (rowIndex === activeIndex ? ' wbm-optionActive' : ''),
              disabled: pending,
              onClick: () => {
                void save(rowSelection(row))
              },
            },
            h(
              'span',
              { className: 'wbm-optionCopy' },
              h('span', { className: 'wbm-modelName' }, row.label),
            ),
            selected ? h(CheckIcon, null) : null,
          )
        })
        list = h(
          'div',
          { className: 'wbm-list', ref: listRef, role: 'menu', 'aria-label': t('dialog.effort.title', { model: pane.model.name }) },
          ...efforts,
        )
        toolbar = h(
          'div',
          { className: 'wbm-group' },
          h(
            'button',
            {
              type: 'button',
              className: 'wbm-groupAction',
              disabled: pending,
              onClick: () => {
                setPane(null)
                setActiveIndex(0)
              },
            },
            h(BackIcon, null),
            t('dialog.effort.back'),
          ),
          h('span', { className: 'wbm-groupTitle' }, t('dialog.effort.title', { model: pane.model.name })),
        )
      } else {
        list = h(
          'div',
          { className: 'wbm-list', ref: listRef, role: 'menu', 'aria-label': t('dialog.title') },
          ...groups.flatMap((group) => {
            const heading = h(
              'div',
              { className: 'wbm-group', key: `group:${group.id}` },
              h('span', { className: 'wbm-groupTitle' }, group.id === 'deepseek-account' ? t('provider.account') : group.name),
            )
            const optionRows = group.models.map((model) => {
              index += 1
              const rowIndex = index
              const selected = sameModel(binding, group.id, model.id)
              const efforts = Array.isArray(model.reasoning?.efforts) ? model.reasoning.efforts : []
              const currentEffort =
                selected && binding.reasoningEffort !== undefined
                  ? efforts.find((effort) => effort.id === binding.reasoningEffort)?.name
                  : undefined
              const badge = badgeLabel(model.badge, lang)
              return h(
                'button',
                {
                  key: `model:${group.id}:${model.id}`,
                  type: 'button',
                  role: 'menuitemradio',
                  'aria-checked': selected,
                  'data-wbm-index': rowIndex,
                  className: 'wbm-option' + (rowIndex === activeIndex ? ' wbm-optionActive' : ''),
                  disabled: pending,
                  onClick: () => chooseModel(group, model),
                },
                h(
                  'span',
                  { className: 'wbm-optionCopy' },
                  h(
                    'span',
                    { className: 'wbm-modelName' },
                    h(
                      'span',
                      { className: 'wbm-badgedName' },
                      h('span', { className: 'wbm-badgedNameText' }, model.name),
                      badge === ''
                        ? null
                        : h('span', { className: 'wbm-tag', 'data-tone': badgeTone(model.badge?.tone) }, badge),
                    ),
                  ),
                ),
                efforts.length === 0
                  ? null
                  : h('span', { className: 'wbm-effort' }, currentEffort ?? t('dialog.effort.autoShort')),
                selected ? h(CheckIcon, null) : h(ChevronIcon, null),
              )
            })
            return [heading, ...optionRows]
          }),
        )
      }

      /** 搜索行（只有模型多时才出现，与官方模型菜单一致）。 */
      const searchRow =
        state.status === 'ready' && showSearch && pane === null
          ? h(
              'div',
              { className: 'wbm-searchRow' },
              h('input', {
                className: 'wbm-search' + (query === '' ? '' : ' wbm-searchWithQuery'),
                type: 'search',
                value: query,
                placeholder: t('dialog.search'),
                'aria-label': t('dialog.search'),
                ref: searchRef,
                onChange: (event) => {
                  setQuery(event.target.value)
                  setActiveIndex(0)
                },
              }),
              query === ''
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'wbm-searchClear',
                      'aria-label': t('dialog.clearSearch'),
                      title: t('dialog.clearSearch'),
                      onClick: () => {
                        setQuery('')
                        setActiveIndex(0)
                      },
                    },
                    h(CloseIcon, null),
                  ),
            )
          : null

      /** 错误与提供方失败提示。 */
      const errors = []
      if (state.status === 'ready' && data !== null && Array.isArray(data.catalog.failures) && data.catalog.failures.length > 0) {
        errors.push(
          h('div', { className: 'wbm-error', key: 'catalog-failures' }, t('dialog.failures', { count: data.catalog.failures.length })),
        )
      }
      if (state.status === 'ready' && state.error !== null) {
        errors.push(h('div', { className: 'wbm-error', key: 'save-error' }, state.error))
      }

      /** 页脚：跟随全局默认的说明 + 清除 + 关闭。 */
      let footerNote = null
      if (defaults !== null && binding === null) {
        footerNote = t('dialog.following', { model: findModelName(data, defaults.provider, defaults.model) })
      }
      const footer = h(
        'div',
        { className: 'wbm-footer' },
        footerNote === null ? h('span', { className: 'wbm-footerNote' }) : h('span', { className: 'wbm-footerNote' }, footerNote),
        binding !== null
          ? h(
              'button',
              {
                type: 'button',
                className: 'wbm-button wbm-buttonGhost wbm-buttonDanger',
                disabled: pending,
                onClick: () => {
                  void save(null)
                },
              },
              t('dialog.clear'),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'wbm-button wbm-buttonPrimary',
            disabled: pending,
            onClick: close,
          },
          pending
            ? h(
                'span',
                { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                h('span', { className: 'wbm-spinner' }),
                t('dialog.pending'),
              )
            : t('dialog.close'),
        ),
      )

      return h(
        'div',
        { className: 'wbm-root', role: 'presentation' },
        h('style', null, CSS),
        h('div', { className: 'wbm-mask', 'aria-hidden': 'true', onClick: close }),
        h(
          'div',
          {
            className: 'wbm-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('dialog.title'),
            tabIndex: -1,
            ref: panelRef,
            onKeyDown,
          },
          h(
            'div',
            { className: 'wbm-content' },
            header,
            description,
            pathLine,
            h(
              'div',
              { className: 'wbm-body' },
              searchRow,
              toolbar,
              list,
              ...errors,
            ),
            footer,
          ),
        ),
      )
    }

    /** 在目录里按 provider/model 找显示名，找不到时退回 id。 */
    function findModelName(data, provider, model) {
      try {
        for (const group of data.catalog.groups) {
          if (group.id !== provider) continue
          for (const item of group.models) {
            if (item.id === model) return item.name
          }
        }
      } catch {
        /* 目录异常时退回 id */
      }
      return `${provider}/${model}`
    }

    // ---------------------------------------------------------------------
    // 插件入口。工厂阶段保持无副作用，所有注册都在 apply 内完成。
    // ---------------------------------------------------------------------
    return {
      inject: ['slots', 'locale', 'contextMenus'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        const translate = makeInterpolate(t)
        const store = createDialogStore()

        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-plugin-bind-workspace-model: dictionaries')

        // “...” 菜单里的图标。
        ctx.slots.inject('contextMenu.icon', () =>
          ctx.slots.register({ name: 'contextMenu.icon', key: ICON_KEY }, WorkspaceDefaultModelIcon),
        )

        // 工作区 “...” 菜单项。标签带上当前绑定的模型名，便于一眼确认。
        ctx.effect(
          () =>
            ctx.contextMenus.register({
              id: 'workspace-default-model',
              target: 'workspace',
              order: 150,
              resolve: async (target, signal) => {
                if (target === null || typeof target.path !== 'string' || target.path === '') return []
                let label = translate('menu.label')
                try {
                  const response = await fetch(
                    `${ROUTE_STATE}?path=${encodeURIComponent(target.path)}&catalog=0`,
                    { method: 'GET', credentials: 'same-origin', signal },
                  )
                  const body = await response.json().catch(() => null)
                  const binding = body !== null && body.ok === true ? body.binding : null
                  if (binding !== null && binding !== undefined) {
                    const name =
                      typeof body.bindingName === 'string' && body.bindingName !== ''
                        ? body.bindingName
                        : binding.model
                    label = `${label} · ${name}`
                  }
                } catch {
                  /* 标签降级为纯文字，不影响菜单打开 */
                }
                return [
                  {
                    id: 'workspace-default-model',
                    label,
                    icon: { key: ICON_KEY },
                    run: () => {
                      store.open({
                        workspaceId: typeof target.workspaceId === 'string' ? target.workspaceId : '',
                        path: target.path,
                        displayTitle: typeof target.displayTitle === 'string' ? target.displayTitle : '',
                      })
                    },
                  },
                ]
              },
            }),
          'dsh-plugin-bind-workspace-model: workspace menu',
        )

        // 对话框挂在 frame 级浮层里，只在打开时渲染。
        const Dialog = function WorkspaceDefaultModelDialog() {
          return h(DialogView, {
            store,
            t: translate,
            notify: (text, success) => {
              try {
                if (ctx.contextMenus !== undefined && typeof ctx.contextMenus.notify === 'function') {
                  ctx.contextMenus.notify(text, success)
                }
              } catch {
                /* 通知失败不影响保存结果 */
              }
            },
            ctx,
          })
        }
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: OVERLAY_ID, order: 40, locale: NS }, Dialog),
        )
      },
    }
  },
})
