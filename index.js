/**
 * 工作区默认模型 —— 宿主半侧。
 *
 * 为每个已注册工作区（Workspace）记录一份默认模型选择
 * （provider + model + 可选 reasoningEffort）。当该工作区里新建会话时，
 * 在 Agent 创建完成、首次请求之前把这份选择写入该会话的
 * `model/selection`，于是新会话默认使用它。
 *
 * 语义边界：
 * - 只影响“新建的、还没有任何模型选择的、未开始的会话”；
 *   已有历史或用户已主动切换过模型的会话一律不动。
 * - 在会话里切换模型只作用于该会话，永远不会回写工作区默认值。
 *
 * 本模块必须保持自包含：从已安装的 bundle 位置只能解析 Node 内置模块，
 * 因此这里不得出现任何 `@deepseek-ai/*` 导入；宿主服务一律通过
 * `ctx.get('...')` 按名字取得并做防御式校验。
 *
 * 路由（全部经过宿主连接层的身份校验，仅属主浏览器可达）：
 *   GET  /api/dsh-plugin-bind-workspace-model/state?path=<abs dir>
 *   POST /api/dsh-plugin-bind-workspace-model/binding  { path, selection|null }
 *
 * @module @local/dsh-plugin-bind-workspace-model
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'

/* -------------------------------------------------------------------------- */
/* 常量                                                                       */
/* -------------------------------------------------------------------------- */

/** 插件包名；客户端模块加载器 id 与 `dsh.client` 条目名一致。 */
const PLUGIN_ID = '@local/dsh-plugin-bind-workspace-model'
/** 默认数据目录名。保持稳定，不随插件改名迁移，避免已有绑定丢失。 */
const DATA_DIR_NAME = 'workspace-default-model'
/** 绑定文件名。 */
const DATA_FILE_NAME = 'bindings.json'
/** 绑定文件格式版本。 */
const FILE_VERSION = 1
/** 客户端读取/写入的精确 fetch 路由。 */
const ROUTE_STATE = '/api/dsh-plugin-bind-workspace-model/state'
const ROUTE_BINDING = '/api/dsh-plugin-bind-workspace-model/binding'
/** POST 请求体上限：一份选择只有几十字节，64 KiB 足够。 */
const MAX_BODY_BYTES = 64 * 1024

/* -------------------------------------------------------------------------- */
/* 插件入口                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 安装“工作区默认模型”的会话钩子与两条浏览器路由。
 *
 * `connection` 不是必需注入：没有 Web 连接的组合（例如纯 CLI）里
 * 会话创建钩子依然生效，只是浏览器路由不注册。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主插件上下文。
 * @param {object} [config] - patch 行配置，按防御式读取。
 */
export function apply(ctx, config = {}) {
  const runtime = createRuntime(ctx, resolveConfig(config))
  ctx.effect(() => runtime.installAgentHook(), `${PLUGIN_ID}: workspace default model`)
  ctx.inject(['connection'], (child) => {
    for (const route of runtime.routes) {
      child.effect(() => runtime.registerRoute(route), `${PLUGIN_ID}: ${route.path}`)
    }
  })
  // 数据目录说明文件是尽力而为的副产物：失败只记日志，绝不影响激活。
  runtime.writeDirectoryMarker()
}

/* -------------------------------------------------------------------------- */
/* 配置                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 规范化 patch 行配置，补全默认值且不抛异常。
 * @param {unknown} raw - Loader 提供的配置值。
 * @returns {{ dataDir: string }}
 */
function resolveConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const dataDir = typeof input.dataDir === 'string' ? input.dataDir.trim() : ''
  return { dataDir: dataDir !== '' ? dataDir : defaultDataDir() }
}

/**
 * 默认数据目录：`$DSH_HOME/workspace-default-model`，其次 `~/.dsh/...`。
 * @returns {string}
 */
function defaultDataDir() {
  const dshHome = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (dshHome !== '') return join(dshHome, DATA_DIR_NAME)
  try {
    return join(homedir(), '.dsh', DATA_DIR_NAME)
  } catch {
    return join(process.cwd(), DATA_DIR_NAME)
  }
}

/* -------------------------------------------------------------------------- */
/* 运行时                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 构造运行时：绑定表读写、工作区解析、模型目录、会话应用和路由。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主插件上下文。
 * @param {{ dataDir: string }} config - 规范化后的配置。
 */
function createRuntime(ctx, config) {
  /** 规范化工作区路径 → 选择。null 表示尚未从磁盘加载。 */
  let bindings = null
  let loadPromise = null
  /** 串行化“改内存 + 落盘”的写链。 */
  let writeChain = Promise.resolve()
  /** 同一类内部错误只告警一次，避免刷屏。 */
  const reported = new Set()

  /** 记录一次被包含的内部失败。 */
  function report(key, error) {
    if (reported.has(key)) return
    reported.add(key)
    try {
      console.warn(`[${PLUGIN_ID}] ${key}: ${errorMessage(error)}`)
    } catch {
      /* 日志失败不影响宿主 */
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 绑定表                                                                 */
  /* ---------------------------------------------------------------------- */

  /** 绑定文件绝对路径。 */
  function dataFile() {
    return join(config.dataDir, DATA_FILE_NAME)
  }

  /**
   * 在数据目录放一份说明文件，告诉用户这个目录是什么、能不能删。
   * 只是尽力而为的副产物：失败只告警，不阻断插件。
   */
  function writeDirectoryMarker() {
    const file = join(config.dataDir, 'README.txt')
    const text = [
      '这是 DeepSeek Harness 插件 @local/dsh-plugin-bind-workspace-model 的数据目录。',
      '',
      `bindings.json 保存每个工作区（按规范化绝对路径）的默认模型选择：provider、model、可选 reasoningEffort。`,
      '删除 bindings.json 等于清空所有工作区的默认模型；之后新建的会话回到全局默认模型。',
      '卸载插件不会删除本目录，如需彻底清理请手动删除。',
      '',
    ].join('\n')
    Promise.resolve()
      .then(async () => {
        await mkdir(config.dataDir, { recursive: true })
        await writeFile(file, text, 'utf8')
      })
      .catch((error) => report('marker', error))
  }

  /** 懒加载绑定表，首次读取后常驻内存。 */
  async function ensureLoaded() {
    if (bindings !== null) return bindings
    if (loadPromise === null) loadPromise = loadBindings()
    bindings = await loadPromise
    return bindings
  }

  /** 从磁盘读取并校验绑定表；坏文件只告警，不阻断插件。 */
  async function loadBindings() {
    let text
    try {
      text = await readFile(dataFile(), 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return new Map()
      report('load', error)
      return new Map()
    }
    try {
      const parsed = JSON.parse(text)
      const raw =
        parsed !== null && typeof parsed === 'object' && parsed.bindings !== null && typeof parsed.bindings === 'object'
          ? parsed.bindings
          : {}
      const map = new Map()
      for (const [path, value] of Object.entries(raw)) {
        if (typeof path !== 'string' || path === '' || !isAbsolute(path)) continue
        const selection = normalizeSelection(value)
        if (selection !== null) map.set(path, selection)
      }
      return map
    } catch (error) {
      report('parse', error)
      return new Map()
    }
  }

  /**
   * 原子写入整张绑定表：先写临时文件再 rename，避免半截 JSON。
   * @param {Map<string, object>} next - 写入后的完整绑定表。
   */
  async function writeBindings(next) {
    const payload = {
      version: FILE_VERSION,
      bindings: Object.fromEntries([...next.entries()].sort(([a], [b]) => a.localeCompare(b))),
    }
    const file = dataFile()
    const text = `${JSON.stringify(payload, null, 2)}\n`
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, file)
  }

  /**
   * 保存或清除一份绑定。整段改动排在同一条写链上，读-改-写不会互相覆盖。
   * @param {string} path - 规范化工作区路径。
   * @param {object|null} selection - 选择，null 表示清除。
   * @returns {Promise<object|null>} 落盘后的选择。
   */
  function mutateBinding(path, selection) {
    const task = writeChain.then(async () => {
      const current = await ensureLoaded()
      const next = new Map(current)
      if (selection === null) next.delete(path)
      else next.set(path, selection)
      await writeBindings(next)
      bindings = next
      return selection
    })
    writeChain = task.catch(() => {})
    return task
  }

  /* ---------------------------------------------------------------------- */
  /* 工作区与选择                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * 把用户给出的目录解析为已注册工作区；解析失败时返回 undefined。
   * @param {string} path - 目录路径。
   * @returns {Promise<object|undefined>}
   */
  async function resolveWorkspace(path) {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined || typeof registry?.resolveByPath !== 'function') return undefined
    try {
      const workspace = await registry.resolveByPath(path)
      return workspace !== null && typeof workspace === 'object' ? workspace : undefined
    } catch (error) {
      report('workspace-resolve', error)
      return undefined
    }
  }

  /**
   * 规范化查询/写入用路径：优先使用工作区注册表里的 canonical 路径。
   * @param {string} requested - 调用方给出的绝对路径。
   * @returns {Promise<string>}
   */
  async function canonicalWorkspacePath(requested) {
    const workspace = await resolveWorkspace(requested)
    return workspace?.path ?? resolvePath(requested)
  }

  /** 部署级默认选择（新会话在没有任何选择时实际会用的模型）。 */
  function globalDefaultSelection() {
    const service = ctx.get('agentDefaultModel')
    if (service === undefined || typeof service?.currentSelection !== 'function') return null
    try {
      return normalizeSelection(service.currentSelection())
    } catch (error) {
      report('default-selection', error)
      return null
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 模型目录                                                               */
  /* ---------------------------------------------------------------------- */

  /** 读取当前挂载的全部提供方与模型（含推理强度），供选择器展示。 */
  async function buildCatalog() {
    const llm = ctx.get('llm')
    const empty = { groups: [], failures: [] }
    if (llm === undefined || typeof llm?.listProviders !== 'function' || typeof llm?.listModels !== 'function') {
      return empty
    }
    let providers
    try {
      providers = llm.listProviders()
    } catch (error) {
      report('catalog-providers', error)
      return empty
    }
    const groups = []
    const failures = []
    for (const provider of Array.isArray(providers) ? providers : []) {
      const providerId = typeof provider?.id === 'string' ? provider.id : ''
      if (providerId === '') continue
      const providerName =
        typeof provider?.name === 'string' && provider.name !== '' ? provider.name : providerId
      try {
        const models = await llm.listModels(providerId)
        const entries = []
        for (const model of Array.isArray(models) ? models : []) {
          const entry = await catalogModel(llm, providerId, model)
          if (entry !== null) entries.push(entry)
        }
        if (entries.length > 0) groups.push({ id: providerId, name: providerName, models: entries })
      } catch (error) {
        failures.push({ id: providerId, name: providerName, message: errorMessage(error) })
      }
    }
    return { groups, failures }
  }

  /**
   * 把一个适配器模型整理成浏览器可用的条目；解析失败时保留无推理强度的条目。
   * @param {object} llm - 宿主 LLM 服务。
   * @param {string} providerId - 提供方路由。
   * @param {object} model - 适配器返回的模型信息。
   * @returns {Promise<object|null>}
   */
  async function catalogModel(llm, providerId, model) {
    const modelId = typeof model?.id === 'string' ? model.id : ''
    if (modelId === '') return null
    const entry = {
      id: modelId,
      name: typeof model?.name === 'string' && model.name !== '' ? model.name : modelId,
    }
    if (typeof model?.description === 'string' && model.description !== '') entry.description = model.description
    if (model?.badge !== undefined) {
      const badge = detachedBadge(model.badge)
      if (badge !== undefined) entry.badge = badge
    }
    if (typeof llm.resolveModelInfo !== 'function') return entry
    try {
      const resolved = await llm.resolveModelInfo(providerId, modelId)
      const reasoning = normalizeReasoning(resolved?.reasoning)
      if (reasoning !== null) entry.reasoning = reasoning
    } catch (error) {
      // 单模型元数据解析失败只影响它自己的推理强度，目录继续展示。
      report('model-info', error)
    }
    return entry
  }

  /**
   * 规范化推理强度元数据。
   * @param {object|undefined} reasoning - 适配器返回值。
   * @returns {{efforts: Array<{id: string, name: string, description?: string}>, defaultEffort?: string}|null}
   */
  function normalizeReasoning(reasoning) {
    if (reasoning === null || typeof reasoning !== 'object') return null
    const efforts = []
    for (const effort of Array.isArray(reasoning.efforts) ? reasoning.efforts : []) {
      const id = effort?.id === undefined || effort?.id === null ? '' : String(effort.id)
      if (id === '') continue
      const item = {
        id,
        name: typeof effort?.name === 'string' && effort.name !== '' ? effort.name : id,
      }
      if (typeof effort?.description === 'string' && effort.description !== '') {
        item.description = effort.description
      }
      efforts.push(item)
    }
    if (efforts.length === 0) return null
    const item = { efforts }
    if (reasoning.defaultEffort !== undefined && reasoning.defaultEffort !== null) {
      const defaultEffort = String(reasoning.defaultEffort)
      if (efforts.some((effort) => effort.id === defaultEffort)) item.defaultEffort = defaultEffort
    }
    return item
  }

  /** 选择器角标是契约数据，只保留纯 JSON 字段。 */
  function detachedBadge(badge) {
    if (badge === null || typeof badge !== 'object') return undefined
    if (badge.text === undefined) return undefined
    return { text: badge.text, tone: badge.tone === undefined ? 'neutral' : badge.tone }
  }

  /* ---------------------------------------------------------------------- */
  /* 选择校验                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * 校验一份选择当前是否可选：提供方已挂载、模型在目录中、推理强度被该模型支持。
   * @param {unknown} input - 请求里的选择。
   * @returns {Promise<{kind: 'ok', selection: object} | {kind: string, message?: string}>}
   */
  async function validateSelection(input) {
    const selection = normalizeSelection(input)
    if (selection === null) return { kind: 'invalid-selection' }
    const llm = ctx.get('llm')
    if (llm === undefined || typeof llm?.listProviders !== 'function' || typeof llm?.listModels !== 'function') {
      return { kind: 'catalog-unavailable' }
    }
    let providers
    try {
      providers = llm.listProviders()
    } catch (error) {
      report('validate-providers', error)
      return { kind: 'catalog-unavailable' }
    }
    if (!(Array.isArray(providers) ? providers : []).some((provider) => provider?.id === selection.provider)) {
      return { kind: 'provider-unavailable' }
    }
    let models
    try {
      models = await llm.listModels(selection.provider)
    } catch (error) {
      report('validate-models', error)
      return { kind: 'catalog-unavailable', message: errorMessage(error) }
    }
    if (!(Array.isArray(models) ? models : []).some((model) => model?.id === selection.model)) {
      return { kind: 'model-unavailable' }
    }
    if (selection.reasoningEffort === undefined) return { kind: 'ok', selection }
    if (typeof llm.resolveModelInfo !== 'function') return { kind: 'catalog-unavailable' }
    let resolved
    try {
      resolved = await llm.resolveModelInfo(selection.provider, selection.model)
    } catch (error) {
      report('validate-model-info', error)
      return { kind: 'catalog-unavailable', message: errorMessage(error) }
    }
    const reasoning = normalizeReasoning(resolved?.reasoning)
    if (reasoning === null) return { kind: 'effort-unavailable' }
    if (!reasoning.efforts.some((effort) => effort.id === selection.reasoningEffort)) {
      return { kind: 'effort-unavailable' }
    }
    return { kind: 'ok', selection }
  }

  /* ---------------------------------------------------------------------- */
  /* 会话应用                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * 读取会话的模型选择投影视图：`next` 为 null 表示从未记录过选择/请求。
   * @param {object} session - 会话。
   * @returns {{next?: object|null, known: boolean}}
   */
  function recordedSelection(session) {
    const projections = ctx.get('sessionProjections')
    if (projections === undefined || typeof projections?.snapshot !== 'function') return { known: false }
    try {
      const snapshot = projections.snapshot(session)
      const state = snapshot?.values?.modelSelection
      if (state === undefined || state === null || typeof state !== 'object') return { known: false }
      return { known: true, next: state.next === undefined ? null : state.next }
    } catch (error) {
      report('projection', error)
      return { known: false }
    }
  }

  /** 会话是否还没有开始任何一轮（空会话）。 */
  function isBlankSession(session) {
    const agents = ctx.get('agents')
    if (agents === undefined || typeof agents?.turnBoundaryOf !== 'function') return true
    try {
      const boundary = agents.turnBoundaryOf(session)
      if (boundary === null || typeof boundary !== 'object') return true
      if (boundary.openTurnStartSeq !== null && boundary.openTurnStartSeq !== undefined) return false
      return !(typeof boundary.lastTurn === 'number' && boundary.lastTurn !== 0)
    } catch (error) {
      report('turn-boundary', error)
      return true
    }
  }

  /** 只处理顶层普通会话：跳过 subagent、fork、嵌套会话。 */
  function isOrdinaryTopLevelSession(session) {
    const header = session?.header
    if (header === undefined || header === null) return false
    if (header.parentSession !== undefined) return false
    if (header.origin === 'subagent') return false
    if (header.isSeeded === true) return false
    return true
  }

  /**
   * 创建入口是否显式指定了路由：若会话当前可用选择与部署默认不同，
   * 说明创建方显式给了模型，应尊重它而不是套用工作区默认值。
   * @param {object} agent - Agent。
   */
  function hasExplicitRoute(agent) {
    const model = agent?.model
    if (model === undefined || typeof model?.current !== 'function') return false
    let current
    try {
      current = model.current()
    } catch {
      return false
    }
    if (current === undefined || current === null) return false
    const defaults = globalDefaultSelection()
    if (defaults === null) return false
    return !sameSelection(current, defaults)
  }

  /**
   * 刚创建的会话是否应该套用工作区默认值。
   * @param {object} agent - Agent。
   * @returns {boolean}
   */
  function shouldApplyOnCreate(agent) {
    const session = agent?.session
    if (!isOrdinaryTopLevelSession(session)) return false
    if (!isBlankSession(session)) return false
    if (hasExplicitRoute(agent)) return false
    const recorded = recordedSelection(session)
    if (recorded.known && recorded.next !== null) return false
    return true
  }

  /**
   * 保存新默认值时，是否应该把还没开始的会话一并改到新默认值。
   * 只改“空会话，且其已记录的选择为空或正是上一份工作区默认值”的会话，
   * 用户自己切换过的空会话保持不动。
   * @param {object} agent - Agent。
   * @param {object|null} previous - 保存前的绑定。
   * @returns {boolean}
   */
  function shouldRetargetLiveSession(agent, previous) {
    const session = agent?.session
    if (!isOrdinaryTopLevelSession(session)) return false
    if (!isBlankSession(session)) return false
    if (hasExplicitRoute(agent)) return false
    const recorded = recordedSelection(session)
    if (!recorded.known) return true
    if (recorded.next === null || recorded.next === undefined) return true
    return previous !== null && sameSelection(recorded.next, previous)
  }

  /** 对指定工作区的活 Agent 应用一份选择。 */
  async function applyToLiveSessions(path, selection, previous, mode) {
    const registry = ctx.get('agents')
    if (registry === undefined || typeof registry.list !== 'function') return 0
    let applied = 0
    for (const agent of registry.list()) {
      try {
        const session = agent?.session
        const cwd = session?.header?.cwd
        if (typeof cwd !== 'string' || cwd === '') continue
        const workspace = await resolveWorkspace(cwd)
        const canonical = workspace?.path ?? cwd
        if (canonical !== path) continue
        const eligible = mode === 'create' ? shouldApplyOnCreate(agent) : shouldRetargetLiveSession(agent, previous)
        if (!eligible) continue
        const model = agent.model
        if (model === undefined || typeof model?.select !== 'function') continue
        model.select(selection)
        applied += 1
      } catch (error) {
        report('apply-live', error)
      }
    }
    return applied
  }

  /**
   * `agent/created` 钩子：新会话在首次请求前套用工作区默认值。
   * 该监听是 serial 模式，宿主会等待我们完成，因此选择一定早于首轮准备。
   * @param {{ agent: object, source: string }} payload - 事件负载。
   */
  async function handleAgentCreated(payload) {
    try {
      const agent = payload?.agent
      if (agent === undefined || agent === null) return
      if (!shouldApplyOnCreate(agent)) return
      const cwd = agent.session?.header?.cwd
      if (typeof cwd !== 'string' || cwd === '') return
      const workspace = await resolveWorkspace(cwd)
      if (workspace === undefined) return
      const map = await ensureLoaded()
      const selection = map.get(workspace.path)
      if (selection === undefined) return
      const model = agent.model
      if (model === undefined || typeof model?.select !== 'function') return
      model.select(selection)
    } catch (error) {
      report('agent-created', error)
    }
  }

  /** 注册会话创建钩子。 */
  function installAgentHook() {
    const dispose = ctx.on('agent/created', (payload) => handleAgentCreated(payload))
    return () => {
      try {
        const result = dispose?.()
        if (result !== null && typeof result?.then === 'function') result.catch(() => {})
      } catch {
        /* 卸载期释放失败不影响宿主 */
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 路由                                                                   */
  /* ---------------------------------------------------------------------- */

  /** 注册一条精确 fetch 路由，返回清理函数。 */
  function registerRoute(route) {
    let dispose
    try {
      const connection = ctx.get('connection')
      const registry = connection?.fetch
      if (registry === undefined || typeof registry.register !== 'function') {
        throw new Error('connection fetch registry is unavailable')
      }
      dispose = registry.register({
        path: route.path,
        methods: route.methods,
        requestBody: 'buffered',
        fetch: guardRoute(route.handler),
      })
    } catch (error) {
      report(`route:${route.path}`, error)
      return () => {}
    }
    return () => {
      try {
        const result = dispose?.()
        if (result !== null && typeof result?.then === 'function') result.catch(() => {})
      } catch (error) {
        report(`route-dispose:${route.path}`, error)
      }
    }
  }

  /** 把处理器失败收敛成 500，并让 HEAD 不返回响应体。 */
  function guardRoute(handler) {
    return async (request) => {
      try {
        const response = await handler(request)
        if (request.method !== 'HEAD') return response
        try {
          await response.body?.cancel()
        } catch {
          /* 响应体已被消费 */
        }
        return new Response(null, { status: response.status, headers: response.headers })
      } catch (error) {
        report('route-handler', error)
        return errorResponse(500, 'internal-error', errorMessage(error))
      }
    }
  }

  /**
   * `GET /state?path=`：返回工作区、当前绑定、部署默认值和实时模型目录。
   * @param {Request} request - 路由请求。
   * @returns {Promise<Response>}
   */
  async function handleStateRequest(request) {
    const url = new URL(request.url)
    const requested = url.searchParams.get('path') ?? ''
    const path = requested.trim()
    if (path === '' || !isAbsolute(path)) {
      return errorResponse(400, 'invalid-path', 'path must be an absolute directory path')
    }
    const workspace = await resolveWorkspace(path)
    const canonical = workspace?.path ?? resolvePath(path)
    const map = await ensureLoaded()
    const binding = map.get(canonical) ?? null
    const defaults = globalDefaultSelection()
    return jsonResponse({
      ok: true,
      workspace:
        workspace === undefined
          ? null
          : { id: String(workspace.id ?? ''), path: String(workspace.path ?? canonical), title: String(workspace.title ?? '') },
      path: canonical,
      binding,
      bindingName: await selectionDisplayName(binding),
      defaults,
      defaultsName: await selectionDisplayName(defaults),
      catalog: url.searchParams.get('catalog') === '0' ? { groups: [], failures: [] } : await buildCatalog(),
    })
  }

  /**
   * 选择在目录里的显示名（只查 listModels，不解析推理强度）；查不到时退回 id。
   * @param {object|null} selection - 选择。
   * @returns {Promise<string|null>}
   */
  async function selectionDisplayName(selection) {
    if (selection === null || selection === undefined) return null
    const llm = ctx.get('llm')
    if (llm === undefined || typeof llm?.listModels !== 'function') return selection.model
    try {
      const models = await llm.listModels(selection.provider)
      const found = (Array.isArray(models) ? models : []).find((model) => model?.id === selection.model)
      return typeof found?.name === 'string' && found.name !== '' ? found.name : selection.model
    } catch {
      return selection.model
    }
  }

  /**
   * `POST /binding`：保存或清除一份工作区默认模型，并把新默认值同步给
   * 尚未开始的空会话（用户自己切换过的会话保持不动）。
   * @param {Request} request - 路由请求。
   * @returns {Promise<Response>}
   */
  async function handleBindingRequest(request) {
    const body = await readJsonBody(request)
    if (body === null) return errorResponse(400, 'invalid-body', 'request body must be a JSON object')
    const requested = typeof body.path === 'string' ? body.path.trim() : ''
    if (requested === '' || !isAbsolute(requested)) {
      return errorResponse(400, 'invalid-path', 'path must be an absolute directory path')
    }
    const path = await canonicalWorkspacePath(requested)
    const map = await ensureLoaded()
    const previous = map.get(path) ?? null
    let selection = null
    if (body.selection !== null && body.selection !== undefined) {
      const verdict = await validateSelection(body.selection)
      if (verdict.kind !== 'ok') {
        return errorResponse(400, verdict.kind, verdict.message ?? verdict.kind)
      }
      selection = verdict.selection
    }
    try {
      await mutateBinding(path, selection)
    } catch (error) {
      report('persist', error)
      return errorResponse(500, 'persist-failed', errorMessage(error))
    }
    let applied = 0
    if (selection !== null) {
      applied = await applyToLiveSessions(path, selection, previous, 'retarget')
    }
    return jsonResponse({ ok: true, path, binding: selection, applied: { sessions: applied } })
  }

  return {
    routes: [
      { path: ROUTE_STATE, methods: ['GET', 'HEAD'], handler: handleStateRequest },
      { path: ROUTE_BINDING, methods: ['POST'], handler: handleBindingRequest },
    ],
    registerRoute,
    installAgentHook,
    handleAgentCreated,
    writeDirectoryMarker,
  }
}

/* -------------------------------------------------------------------------- */
/* 纯工具                                                                     */
/* -------------------------------------------------------------------------- */

/** 把任意输入规范化为选择；非法输入返回 null。 */
function normalizeSelection(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (provider === '' || model === '') return null
  const selection = { provider, model }
  const effort = typeof value.reasoningEffort === 'string' ? value.reasoningEffort.trim() : ''
  if (effort !== '') selection.reasoningEffort = effort
  return selection
}

/** 两份选择是否完全一致（含推理强度缺省语义）。 */
function sameSelection(left, right) {
  if (left === null || right === null || left === undefined || right === undefined) return left === right
  if (left.provider !== right.provider || left.model !== right.model) return false
  const leftEffort = left.reasoningEffort === undefined ? '' : String(left.reasoningEffort)
  const rightEffort = right.reasoningEffort === undefined ? '' : String(right.reasoningEffort)
  return leftEffort === rightEffort
}

/** 读取 JSON 请求体；非对象、非 JSON、超限都返回 null。 */
async function readJsonBody(request) {
  let text
  try {
    text = await request.text()
  } catch {
    return null
  }
  if (typeof text !== 'string' || text.length > MAX_BODY_BYTES) return null
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** JSON 成功应答。 */
function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  })
}

/** JSON 失败应答。 */
function errorResponse(status, code, message) {
  return jsonResponse({ ok: false, error: code, message: message === undefined ? code : String(message) }, status)
}

/** 统一错误文本。 */
function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 读取 Node 错误码。 */
function errorCode(error) {
  if (error !== null && typeof error === 'object' && typeof error.code === 'string') return error.code
  return ''
}
