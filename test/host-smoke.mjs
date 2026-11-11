#!/usr/bin/env node
/**
 * 宿主半侧冒烟测试（不依赖真实 DSH，只用假的 ctx 服务）。
 *
 * 覆盖：
 * - 插件能加载、注册两条 fetch 路由与 `agent/created` 钩子；
 * - `GET /state` 返回工作区、绑定、部署默认值与模型目录（含推理强度）；
 * - `POST /binding` 校验 provider/model/effort、原子落盘、可清除；
 * - 新会话按工作区默认值记录 `model/selection`；
 * - 已有选择、用户切换过、显式路由的会话不被覆盖；
 * - 改默认值时只重定向“空会话且携带上一份默认值”的会话。
 *
 * 运行：node test/host-smoke.mjs
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

/* -------------------------------------------------------------------------- */
/* 测试环境                                                                   */
/* -------------------------------------------------------------------------- */

const root = await mkdtemp(join(tmpdir(), 'dsh-wbm-'))
process.env.DSH_HOME = root

const workspacePath = '/work/demo'
const legacyPath = '/work/legacy'
const workspaces = new Map([
  [
    workspacePath,
    {
      id: 'ws-1',
      path: workspacePath,
      title: 'Demo',
      sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  [
    legacyPath,
    {
      id: 'ws-legacy',
      path: legacyPath,
      title: 'Legacy',
      sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
])

// 插件升级前的数据格式：v1 以“规范化路径”为键。用于验证读取时迁移到工作区 id。
await mkdir(join(root, 'workspace-default-model'), { recursive: true })
await writeFile(
  join(root, 'workspace-default-model', 'bindings.json'),
  JSON.stringify({ version: 1, bindings: { [legacyPath]: { provider: 'opencode-go', model: 'glm-5.3' } } }, null, 2),
  'utf8',
)

/** 部署默认值：测试里“未显式指定路由”的会话都用它。 */
const deploymentDefault = { provider: 'opencode-go', model: 'glm-5.3' }
/** 被测的绑定选择。 */
const binding = { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' }

/** 活 Agent 列表；`agent/created` 与重定向测试都读它。 */
const liveAgents = []
/** 路由登记表。 */
const routes = []

const services = {
  connection: {
    fetch: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  },
  workspaceRegistry: {
    async resolveByPath(path) {
      return workspaces.get(path)
    },
    list() {
      return [...workspaces.values()]
    },
  },
  llm: {
    listProviders() {
      return [
        { id: 'opencode-go', name: 'OpenCode Go' },
        { id: 'broken-provider', name: 'Broken' },
      ]
    },
    async listModels(provider) {
      if (provider === 'broken-provider') throw new Error('provider offline')
      return [
        { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
        { id: 'glm-5.3', name: 'GLM-5.3' },
      ]
    },
    async resolveModelInfo(provider, model) {
      if (provider === 'opencode-go' && model === 'deepseek-v4.1-flash') {
        return {
          reasoning: {
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
            ],
            defaultEffort: 'low',
          },
        }
      }
      return {}
    },
  },
  agents: {
    turnBoundaryOf(session) {
      return session.boundary ?? { openTurnStartSeq: null, lastTurn: 0 }
    },
    list() {
      return liveAgents
    },
  },
  sessionProjections: {
    snapshot(session) {
      return { values: { modelSelection: { lastUsed: null, next: session.recorded ?? null } } }
    },
  },
  agentDefaultModel: {
    currentSelection() {
      return { ...deploymentDefault }
    },
  },
}

/** 极简 Cordis 上下文替身：效果、事件和按名字取服务。 */
function createContext(tools) {
  const disposers = []
  const handlers = new Map()
  const ctx = {
    effect(setup) {
      const dispose = setup()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    inject(_deps, callback) {
      const child = { effect: ctx.effect }
      return callback(child)
    },
    on(event, listener) {
      handlers.set(event, listener)
      return () => handlers.delete(event)
    },
    get(name) {
      return tools[name]
    },
  }
  return { ctx, handlers, disposers }
}

/** 造一个假 Agent；`recorded` 是该会话已记录的模型选择。 */
function makeAgent(options = {}) {
  const session = {
    header: { cwd: options.cwd ?? workspacePath, isSeeded: options.seeded === true },
    recorded: options.recorded ?? null,
    boundary: options.boundary ?? { openTurnStartSeq: null, lastTurn: 0 },
  }
  const agent = {
    session,
    model: {
      current: () => options.current ?? { ...deploymentDefault },
      select(selection) {
        agent.selected.push(selection)
        session.recorded = selection
      },
    },
    selected: [],
  }
  return agent
}

/** 调用一条已登记路由。 */
function call(routePath, init) {
  const basePath = routePath.split('?')[0]
  const route = routes.find((item) => item.path === basePath)
  assert.ok(route, `route ${basePath} is registered`)
  assert.equal(typeof route.fetch, 'function', `route ${basePath} carries a fetch handler`)
  return route.fetch(new Request(`http://127.0.0.1${routePath}`, init))
}

/** GET 状态。 */
async function getState(path) {
  const response = await call(`/api/dsh-plugin-bind-workspace-model/state?path=${encodeURIComponent(path)}`, {
    method: 'GET',
  })
  return { status: response.status, body: await response.json() }
}

/** POST 绑定。 */
async function postBinding(body) {
  const response = await call('/api/dsh-plugin-bind-workspace-model/binding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

/** 读取落盘文件。 */
async function readBindingsFile() {
  const file = join(root, 'workspace-default-model', 'bindings.json')
  const text = await readFile(file, 'utf8')
  return JSON.parse(text)
}

/* -------------------------------------------------------------------------- */
/* 测试                                                                       */
/* -------------------------------------------------------------------------- */

try {
  /* 1. 加载：两条路由 + 会话钩子。 */
  const { ctx, handlers } = createContext(services)
  apply(ctx, {})
  assert.equal(routes.length, 2, 'registers two fetch routes')
  assert.deepEqual(
    routes.map((route) => route.path).sort(),
    ['/api/dsh-plugin-bind-workspace-model/binding', '/api/dsh-plugin-bind-workspace-model/state'],
    'registers the expected route paths',
  )
  const handleCreated = handlers.get('agent/created')
  assert.equal(typeof handleCreated, 'function', 'registers agent/created hook')
  console.log('ok 1 - plugin loads and registers routes + agent hook')

  /* 2. 空绑定下的 state：目录分组、推理强度、失败提供方都被标出。 */
  {
    const { status, body } = await getState(workspacePath)
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.workspace.id, 'ws-1')
    assert.equal(body.binding, null)
    assert.deepEqual(body.defaults, deploymentDefault)
    assert.equal(body.defaultsName, 'GLM-5.3', 'deployment default display name is exposed')
    const provider = body.catalog.groups.find((group) => group.id === 'opencode-go')
    assert.ok(provider, 'catalog contains the live provider')
    const model = provider.models.find((item) => item.id === 'deepseek-v4.1-flash')
    assert.ok(model, 'catalog contains the model')
    assert.equal(model.name, 'DeepSeek V4.1 Flash')
    assert.deepEqual(
      model.reasoning.efforts.map((effort) => effort.id),
      ['low', 'high'],
      'reasoning efforts are exposed',
    )
    assert.equal(model.reasoning.defaultEffort, 'low')
    assert.equal(body.catalog.failures.length, 1, 'failing provider is isolated')
    assert.equal(body.catalog.failures[0].id, 'broken-provider')
  }
  console.log('ok 2 - GET /state returns workspace, binding, defaults and catalog')

  /* 2b. 旧版“按路径”绑定在读取时迁移到工作区 id。 */
  {
    const legacy = await getState(legacyPath)
    assert.deepEqual(
      legacy.body.binding,
      { provider: 'opencode-go', model: 'glm-5.3' },
      'a v1 path-keyed binding is migrated on read',
    )
    assert.equal(legacy.body.workspace.id, 'ws-legacy')
  }
  console.log('ok 2b - legacy path-keyed bindings migrate to the workspace id')

  /* 3. 非法路径 / 非法请求体。 */
  {
    const badPath = await getState('relative/path')
    assert.equal(badPath.status, 400)
    assert.equal(badPath.body.error, 'invalid-path')

    const badBody = await call('/api/dsh-plugin-bind-workspace-model/binding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    assert.equal(badBody.status, 400)
    assert.equal((await badBody.json()).error, 'invalid-body')
  }
  console.log('ok 3 - invalid path and body are rejected')

  /* 4. 保存绑定：校验、落盘、返回。 */
  {
    const { status, body } = await postBinding({ path: workspacePath, selection: binding })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.deepEqual(body.binding, binding)
    const file = await readBindingsFile()
    assert.equal(file.version, 2, 'file carries the format version')
    assert.deepEqual(
      file.bindings['ws-1'],
      { path: workspacePath, ...binding },
      'binding is persisted under the workspace id with its canonical path',
    )
    assert.deepEqual(
      file.bindings['ws-legacy'],
      { path: legacyPath, provider: 'opencode-go', model: 'glm-5.3' },
      'the migrated legacy binding is rewritten under its workspace id',
    )

    const state = await getState(workspacePath)
    assert.deepEqual(state.body.binding, binding, 'state reflects the saved binding')
    assert.equal(state.body.bindingName, 'DeepSeek V4.1 Flash', 'binding display name is exposed')
    assert.equal(state.body.bindingProviderName, 'OpenCode Go', 'bound provider display name is exposed')

    // 菜单标签只需要绑定和显示名，`catalog=0` 跳过一次完整模型目录解析。
    const lightResponse = await call(
      `/api/dsh-plugin-bind-workspace-model/state?path=${encodeURIComponent(workspacePath)}&catalog=0`,
      { method: 'GET' },
    )
    const light = await lightResponse.json()
    assert.deepEqual(light.binding, binding)
    assert.equal(light.catalog.groups.length, 0, 'catalog=0 skips the model catalog')
  }
  console.log('ok 4 - POST /binding validates and persists the selection')

  /* 5. 校验失败：未知模型、未知推理强度、未知提供方。 */
  {
    const unknownModel = await postBinding({
      path: workspacePath,
      selection: { provider: 'opencode-go', model: 'nope' },
    })
    assert.equal(unknownModel.status, 400)
    assert.equal(unknownModel.body.error, 'model-unavailable')

    const unknownEffort = await postBinding({
      path: workspacePath,
      selection: { provider: 'opencode-go', model: 'glm-5.3', reasoningEffort: 'high' },
    })
    assert.equal(unknownEffort.status, 400)
    assert.equal(unknownEffort.body.error, 'effort-unavailable')

    const unknownProvider = await postBinding({
      path: workspacePath,
      selection: { provider: 'nope', model: 'glm-5.3' },
    })
    assert.equal(unknownProvider.status, 400)
    assert.equal(unknownProvider.body.error, 'provider-unavailable')
  }
  console.log('ok 5 - model, effort and provider validation rejects unknown values')

  /* 6. 新会话：套用工作区默认值。 */
  {
    const fresh = makeAgent()
    await handleCreated({ agent: fresh })
    assert.deepEqual(fresh.selected, [binding], 'fresh blank session receives the workspace default')
  }
  console.log('ok 6 - a new blank session receives the workspace default')

  /* 7. 不覆盖：已有选择 / 用户切换 / 显式路由 / 非空会话 / subagent / fork。 */
  {
    const alreadySelected = makeAgent({ recorded: { provider: 'deepseek', model: 'deepseek-chat' } })
    await handleCreated({ agent: alreadySelected })
    assert.equal(alreadySelected.selected.length, 0, 'a session with a recorded selection is untouched')

    const explicitRoute = makeAgent({ current: { provider: 'deepseek', model: 'deepseek-chat' } })
    await handleCreated({ agent: explicitRoute })
    assert.equal(explicitRoute.selected.length, 0, 'an explicit creation route is respected')

    const started = makeAgent({ boundary: { openTurnStartSeq: 3, lastTurn: 3 } })
    await handleCreated({ agent: started })
    assert.equal(started.selected.length, 0, 'a started session is never retargeted')

    const freshWithHistory = makeAgent({ boundary: { openTurnStartSeq: null, lastTurn: 2 } })
    await handleCreated({ agent: freshWithHistory })
    assert.equal(freshWithHistory.selected.length, 0, 'a session with finished turns is never retargeted')

    const child = makeAgent()
    child.session.header.parentSession = 'parent'
    await handleCreated({ agent: child })
    assert.equal(child.selected.length, 0, 'subagent sessions are skipped')

    const forked = makeAgent({ seeded: true })
    await handleCreated({ agent: forked })
    assert.equal(forked.selected.length, 0, 'forked sessions are skipped')

    const otherWorkspace = makeAgent({ cwd: '/work/other' })
    await handleCreated({ agent: otherWorkspace })
    assert.equal(otherWorkspace.selected.length, 0, 'sessions in other workspaces are skipped')
  }
  console.log('ok 7 - existing, switched, explicit, started, subagent and fork sessions are preserved')

  /* 8. 改默认值：只重定向携带上一份默认值的空会话。 */
  {
    const carried = makeAgent({ recorded: { ...binding } })
    const switched = makeAgent({ recorded: { provider: 'deepseek', model: 'deepseek-chat' } })
    const started = makeAgent({
      recorded: { ...binding },
      boundary: { openTurnStartSeq: 5, lastTurn: 5 },
    })
    liveAgents.push(carried, switched, started)

    const next = { provider: 'opencode-go', model: 'glm-5.3' }
    const { status, body } = await postBinding({ path: workspacePath, selection: next })
    assert.equal(status, 200)
    assert.deepEqual(body.binding, next)
    assert.equal(body.applied.sessions, 1, 'exactly one blank session is retargeted')
    assert.deepEqual(carried.selected, [next], 'the session carrying the previous default moves to the new one')
    assert.equal(switched.selected.length, 0, 'a user-switched session keeps its choice')
    assert.equal(started.selected.length, 0, 'a started session keeps its choice')
    liveAgents.length = 0
  }
  console.log('ok 8 - changing the default retargets only blank sessions carrying the previous default')

  /* 9. 清除绑定：删除记录并落盘。 */
  {
    const { status, body } = await postBinding({ path: workspacePath, selection: null })
    assert.equal(status, 200)
    assert.equal(body.binding, null)
    assert.equal(body.applied.sessions, 0)
    const file = await readBindingsFile()
    assert.equal(file.bindings['ws-1'], undefined, 'clearing removes the workspace record')
    assert.ok(file.bindings['ws-legacy'] !== undefined, 'other workspaces keep their bindings')
    const state = await getState(workspacePath)
    assert.equal(state.body.binding, null)
  }
  console.log('ok 9 - POST /binding with selection null clears the binding')

  /* 10. 未注册目录也能写入并读回（以规范化路径为键）。 */
  {
    const unregistered = '/work/not-registered'
    const saved = await postBinding({ path: unregistered, selection: binding })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.path, unregistered)
    const state = await getState(unregistered)
    assert.equal(state.body.workspace, null)
    assert.deepEqual(state.body.binding, binding)
  }
  console.log('ok 10 - unregistered directories round-trip by normalized path')

  /* 11. 删除工作区后重建同一目录：默认模型不会沿用，旧记录在下次写入时清理。 */
  {
    const saved = await postBinding({ path: workspacePath, selection: binding })
    assert.equal(saved.status, 200)

    // 模拟 UI 删除工作区，再以新 id 重建同一个目录。
    workspaces.delete(workspacePath)
    workspaces.set(workspacePath, {
      id: 'ws-2',
      path: workspacePath,
      title: 'Demo',
      sessionIds: [],
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })

    const fresh = await getState(workspacePath)
    assert.equal(fresh.body.workspace.id, 'ws-2')
    assert.equal(fresh.body.binding, null, 'a re-created workspace starts without a default model')

    const reselected = { provider: 'opencode-go', model: 'glm-5.3' }
    const next = await postBinding({ path: workspacePath, selection: reselected })
    assert.equal(next.status, 200)
    assert.deepEqual(next.body.binding, reselected)

    const file = await readBindingsFile()
    assert.equal(file.bindings['ws-1'], undefined, 'the deleted workspace record is pruned on the next write')
    assert.deepEqual(file.bindings['ws-2'], { path: workspacePath, ...reselected })
  }
  console.log('ok 11 - deleting and re-creating a workspace requires choosing the default again')

  console.log('\nhost-smoke: all checks passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
