#!/usr/bin/env node
/**
 * 浏览器端冒烟测试（不依赖真实浏览器 / 真实 DSH）。
 *
 * 用假的 `window.__ModuleLoader__` 加载 client.js，用带最小 React hooks
 * 运行时和假 Cordis 上下文执行 `apply`，断言：模块 id、inject 依赖、
 * locale 字典、工作区 “...” 原生菜单项、对话框渲染，以及“同时按提供商
 * 与模型名称搜索”的过滤结果。
 *
 * 运行：node test/client-smoke.mjs
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const PLUGIN_ID = '@local/dsh-plugin-bind-workspace-model'
const NS = 'dsh-plugin-bind-workspace-model'

/* -------------------------------------------------------------------------- */
/* 最小 React 运行时：支持 state / memo / callback / effect / ref / 外部 store   */
/* -------------------------------------------------------------------------- */

const hooks = {
  slots: [],
  index: 0,
  dirty: false,
  effects: [],
  cleanups: [],
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    const slot = nextSlot()
    if (slot.initialized !== true) {
      slot.value = typeof initial === 'function' ? initial() : initial
      slot.initialized = true
    }
    return [
      slot.value,
      (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next
        if (Object.is(value, slot.value)) return
        slot.value = value
        hooks.dirty = true
      },
    ]
  },
  useMemo(factory, deps) {
    const slot = nextSlot()
    if (slot.initialized !== true || !sameDeps(slot.deps, deps)) {
      slot.value = factory()
      slot.deps = deps
      slot.initialized = true
    }
    return slot.value
  },
  useCallback(callback, deps) {
    const slot = nextSlot()
    if (slot.initialized !== true || !sameDeps(slot.deps, deps)) {
      slot.value = callback
      slot.deps = deps
      slot.initialized = true
    }
    return slot.value
  },
  useEffect(effect, deps) {
    const slot = nextSlot()
    if (slot.initialized !== true || !sameDeps(slot.deps, deps)) {
      slot.deps = deps
      slot.initialized = true
      hooks.effects.push(effect)
    }
  },
  useRef(initial) {
    const slot = nextSlot()
    if (slot.initialized !== true) {
      slot.value = { current: initial ?? null }
      slot.initialized = true
    }
    return slot.value
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
}

function nextSlot() {
  const index = hooks.index++
  if (hooks.slots.length <= index) hooks.slots.push({ initialized: false })
  return hooks.slots[index]
}

function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false
  }
  return true
}

/** 展开一层包装组件，返回最终宿主元素树。 */
function renderChain(component, props) {
  hooks.index = 0
  let node = component(props)
  let depth = 0
  while (node !== null && typeof node === 'object' && typeof node.type === 'function' && depth < 6) {
    node = node.type(node.props)
    depth += 1
  }
  return node
}

/** 跑完所有 effect、等待异步读取结算，直到没有新的 state 更新。 */
async function flush(component, props) {
  let tree = null
  for (let pass = 0; pass < 12; pass += 1) {
    hooks.dirty = false
    tree = renderChain(component, props)
    const effects = hooks.effects
    hooks.effects = []
    for (const effect of effects) {
      const cleanup = effect()
      if (typeof cleanup === 'function') hooks.cleanups.push(cleanup)
    }
    await tick()
    await tick()
    if (!hooks.dirty) return tree
  }
  return tree
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 新挂载一个组件（清空 hooks 槽位）。 */
async function mount(component, props) {
  for (const cleanup of hooks.cleanups) {
    try {
      cleanup()
    } catch {
      /* 忽略清理失败 */
    }
  }
  hooks.slots = []
  hooks.cleanups = []
  hooks.effects = []
  hooks.dirty = true
  return await flush(component, props)
}

/* -------------------------------------------------------------------------- */
/* 假 window / 假上下文                                                       */
/* -------------------------------------------------------------------------- */

let loaded = null
const windowStub = {
  __ModuleLoader__: {
    load(options) {
      loaded = options
    },
  },
}

const registered = {
  dictionaries: new Map(),
  localeRegistrations: [],
  menus: [],
  slots: [],
  components: new Map(),
  notifications: [],
}

function lookup(key) {
  const language = typeof ctx.localizedLanguage === 'string' ? ctx.localizedLanguage : 'zh'
  const dictionary = registered.dictionaries.get(NS)?.[language] ?? {}
  return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key
}

const ctx = {
  localizedLanguage: 'zh',
  locale: {
    register(namespace, dictionaries) {
      registered.dictionaries.set(namespace, dictionaries)
      registered.localeRegistrations.push(namespace)
      return () => registered.dictionaries.delete(namespace)
    },
    bind() {
      return lookup
    },
    getLocale() {
      return 'zh-CN'
    },
  },
  effect(setup) {
    const dispose = setup()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  slots: {
    inject(name, factory) {
      registered.slots.push(name)
      return factory()
    },
    register(options, Component) {
      const key = `${options.name}:${options.id ?? options.key ?? ''}`
      registered.slots.push(key)
      registered.components.set(key, Component)
      return () => {}
    },
  },
  contextMenus: {
    register(contribution) {
      registered.menus.push(contribution)
      return () => {}
    },
    notify(text, success) {
      registered.notifications.push({ text, success })
    },
  },
}

/* -------------------------------------------------------------------------- */
/* 假 Host 路由                                                               */
/* -------------------------------------------------------------------------- */

const stateResponse = {
  ok: true,
  workspace: { id: 'ws-1', path: '/work/demo', title: 'Demo' },
  path: '/work/demo',
  binding: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
  bindingName: 'DeepSeek V4.1 Flash',
  bindingProviderName: 'OpenCode Go',
  defaults: { provider: 'opencode-go', model: 'glm-5.3' },
  defaultsName: 'GLM-5.3',
  catalog: {
    groups: [
      {
        id: 'opencode-go',
        name: 'OpenCode Go',
        models: [
          {
            id: 'deepseek-v4.1-flash',
            name: 'DeepSeek V4.1 Flash',
            reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' },
          },
          { id: 'glm-5.3', name: 'GLM-5.3' },
        ],
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        models: [
          { id: 'deepseek-chat', name: 'DeepSeek Chat' },
          { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
          { id: 'deepseek-coder', name: 'DeepSeek Coder' },
        ],
      },
    ],
    failures: [],
  },
}

const fetchCalls = []
/** 打开时为 true：模拟“该工作区还没有默认模型”。 */
let unbound = false

async function fetchMock(input, init = {}) {
  const url = String(input)
  fetchCalls.push({ url, method: init.method ?? 'GET' })
  const state = unbound
    ? { ...stateResponse, binding: null, bindingName: null, bindingProviderName: null }
    : stateResponse
  const body = url.includes('/binding') ? { ok: true, binding: null, applied: { sessions: 0 } } : state
  return {
    ok: true,
    status: 200,
    async json() {
      return body
    },
  }
}

/* -------------------------------------------------------------------------- */
/* 通用查询                                                                   */
/* -------------------------------------------------------------------------- */

function findNode(node, predicate) {
  if (node === null || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, predicate)
    if (found !== null) return found
  }
  return null
}

function findAll(node, predicate, found = []) {
  if (node === null || typeof node !== 'object') return found
  if (predicate(node)) found.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, found)
  return found
}

function collectText(node, texts = []) {
  if (node === null || node === undefined) return texts
  if (typeof node === 'string') {
    texts.push(node)
    return texts
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, texts)
    return texts
  }
  if (typeof node === 'object') {
    for (const child of node.children ?? []) collectText(child, texts)
  }
  return texts
}

/* -------------------------------------------------------------------------- */
/* 测试                                                                       */
/* -------------------------------------------------------------------------- */

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

// 自包含约束：不 import 任何 Harness 客户端包；颜色只用主题 token。
assert.equal(source.includes('@deepseek-ai/'), false, 'client.js must not import Harness client packages')
assert.equal(/require\(['"](?!react['"])/.test(source), false, 'client.js only requires react')
assert.ok(source.includes('--dsw-alias-'), 'stylesheet uses theme tokens')

// 加载模块。
const execute = new Function('window', 'require', 'fetch', 'console', 'AbortController', source)
execute(
  windowStub,
  (name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  },
  fetchMock,
  console,
  AbortController,
)

assert.ok(loaded !== null, 'module registers through window.__ModuleLoader__')
assert.equal(loaded.id, PLUGIN_ID, 'module id equals the package name')

const api = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})
assert.ok(api !== null && typeof api === 'object', 'factory returns the plugin face')
assert.deepEqual(api.inject, ['slots', 'locale', 'contextMenus'], 'declares the expected services')

api.apply(ctx)

/* 1. locale 字典。 */
assert.deepEqual(registered.localeRegistrations, [NS], 'registers its locale namespace')
assert.ok(registered.dictionaries.get(NS)?.en?.['menu.choose'] === 'Choose default model', 'carries English copy')
assert.ok(registered.dictionaries.get(NS)?.zh?.['menu.choose'] === '选择默认模型', 'carries Chinese copy')
console.log('ok 1 - locale dictionaries registered')

/* 2. 原生菜单动作 / 图标 / 浮层注册。 */
assert.equal(registered.menus.length, 1, 'registers one native workspace menu action')
const menu = registered.menus[0]
assert.equal(menu.id, 'workspace-default-model')
assert.equal(menu.target, 'workspace', 'targets the workspace context menu')
assert.equal(menu.order, 150, 'sits between Rename and Delete')
assert.equal(typeof menu.resolve, 'function')
assert.ok(registered.slots.includes('contextMenu.icon'), 'injects the context menu icon slot')
assert.ok(registered.slots.includes('shell.overlay'), 'injects the shell overlay slot')
assert.ok(registered.slots.includes('contextMenu.icon:workspace.defaultModel'), 'registers the icon by key')
assert.ok(registered.slots.includes('shell.overlay:workspace-default-model'), 'registers the dialog in the overlay')
console.log('ok 2 - workspace menu action, icon and overlay entries registered')

const Dialog = registered.components.get('shell.overlay:workspace-default-model')
assert.equal(typeof Dialog, 'function', 'overlay entry is a component')

/* 3. 关闭状态下对话框不渲染。 */
assert.equal(await mount(Dialog), null, 'closed dialog renders nothing')
console.log('ok 3 - dialog renders nothing while closed')

/* 4. 菜单动作：已绑定时显示“提供商 · 模型”，未绑定时显示“选择默认模型”。 */
const target = { workspaceId: 'ws-1', path: '/work/demo', displayTitle: 'Demo' }
const bound = await menu.resolve(target, new AbortController().signal)
assert.equal(bound.length, 1, 'menu resolves one action')
assert.equal(bound[0].label, 'OpenCode Go · DeepSeek V4.1 Flash', 'bound workspace shows provider · model')
assert.deepEqual(bound[0].icon, { key: 'workspace.defaultModel' })
assert.ok(
  fetchCalls.some((call) => call.url.includes('catalog=0')),
  'menu label fetch skips the full catalog',
)

unbound = true
const unset = await menu.resolve(target, new AbortController().signal)
assert.equal(unset[0].label, '选择默认模型', 'unset workspace shows the action label')
unbound = false
console.log('ok 4 - menu action reads 选择默认模型 / 提供商 · 模型')

/* 5. 打开对话框：官方 Modal 树 + 列表渲染。 */
bound[0].run()
const openTree = await mount(Dialog)
assert.ok(openTree !== null && typeof openTree === 'object', 'open dialog renders a tree')
const dialog = findNode(openTree, (node) => node.props?.role === 'dialog')
assert.ok(dialog !== null, 'open dialog tree carries role="dialog"')
assert.equal(dialog.props['aria-modal'], 'true', 'dialog is modal')
const styleNode = findNode(openTree, (node) => node.type === 'style')
assert.ok(styleNode !== null && String(styleNode.children?.[0] ?? '').includes('--dsw-alias-bg-layer-2'), 'styles use theme tokens')
const selectedRows = findAll(openTree, (node) => typeof node.props?.className === 'string' && node.props.className.includes('wbm-optionSelected'))
assert.equal(selectedRows.length, 1, 'exactly one row is marked as the current default')
const activeRows = findAll(openTree, (node) => typeof node.props?.className === 'string' && node.props.className.includes('wbm-optionActive'))
assert.equal(activeRows.length, 1, 'exactly one row carries the keyboard highlight')
assert.equal(activeRows[0], selectedRows[0], 'the keyboard highlight starts on the current default row')

// 下钻到已保存的推理强度时，高亮同样应落在当前默认强度上，而不是第一行 Auto。
selectedRows[0].props.onClick()
const effortTree = await flush(Dialog)
const selectedEffortRows = findAll(effortTree, (node) => typeof node.props?.className === 'string' && node.props.className.includes('wbm-optionSelected'))
const activeEffortRows = findAll(effortTree, (node) => typeof node.props?.className === 'string' && node.props.className.includes('wbm-optionActive'))
assert.equal(selectedEffortRows.length, 1, 'exactly one effort row is marked as the current default')
assert.equal(activeEffortRows.length, 1, 'exactly one effort row carries the keyboard highlight')
assert.equal(activeEffortRows[0], selectedEffortRows[0], 'the keyboard highlight starts on the current effort row')
const backButton = findNode(effortTree, (node) => typeof node.props?.className === 'string' && node.props.className.includes('wbm-groupAction'))
assert.ok(backButton !== null, 'effort pane has a back button')
backButton.props.onClick()
await flush(Dialog)
console.log('ok 5 - dialog renders the modal tree and aligns keyboard highlight with the default row')

/* 6. 搜索同时匹配提供商与模型名称。 */
{
  const search = findNode(openTree, (node) => node.type === 'input' && node.props?.type === 'search')
  assert.ok(search !== null, 'search field is shown for a catalog above four models')

  const rowsOf = (tree) => findAll(tree, (node) => node.props?.role === 'menuitemradio').length

  // 提供商命中：opencode → 该 provider 的两个模型全部保留。
  search.props.onChange({ target: { value: 'opencode' } })
  let tree = await flush(Dialog)
  assert.equal(rowsOf(tree), 2, 'a provider-name query keeps the whole provider group')

  // 模型命中：glm → 只剩 GLM-5.3。
  const refreshSearch = () =>
    findNode(tree, (node) => node.type === 'input' && node.props?.type === 'search')
  refreshSearch().props.onChange({ target: { value: 'glm' } })
  tree = await flush(Dialog)
  assert.equal(rowsOf(tree), 1, 'a model-name query filters the model rows')

  // 同时命中：deepseek 命中 DeepSeek 分组 + DeepSeek V4.1 Flash。
  refreshSearch().props.onChange({ target: { value: 'deepseek' } })
  tree = await flush(Dialog)
  assert.equal(rowsOf(tree), 4, 'provider and model matches are combined')

  // 无命中：空状态。
  refreshSearch().props.onChange({ target: { value: 'zzzz' } })
  tree = await flush(Dialog)
  assert.equal(rowsOf(tree), 0, 'no match leaves no rows')
  const noMatchText = collectText(tree)
  assert.ok(noMatchText.includes('没有匹配的模型或提供商。'), 'no-match copy is shown')
  assert.equal(noMatchText.includes('暂无可用模型。'), false, 'no-match does not claim the catalog is empty')
}
console.log('ok 6 - search matches provider names and model names')

/* 7. 空 target 时不提供动作（防御式）。 */
assert.deepEqual(await menu.resolve(null, new AbortController().signal), [])
assert.deepEqual(await menu.resolve({ workspaceId: 'ws-1', displayTitle: 'Demo' }, new AbortController().signal), [])
console.log('ok 7 - menu declines malformed targets')

console.log('\nclient-smoke: all checks passed')
