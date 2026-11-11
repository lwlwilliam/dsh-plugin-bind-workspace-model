#!/usr/bin/env node
/**
 * 浏览器端冒烟测试（不依赖真实浏览器 / 真实 DSH）。
 *
 * 用假的 `window.__ModuleLoader__` 加载 client.js，再用假的 React 与 Cordis
 * 上下文执行 `apply`，断言：模块 id、inject 依赖、locale 字典、工作区 “...”
 * 菜单项、`contextMenu.icon` 与 `shell.overlay` 注册，以及菜单动作确实能打开
 * 对话框、对话框组件能渲染出 `role="dialog"` 的树。
 *
 * 运行：node test/client-smoke.mjs
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const PLUGIN_ID = '@local/dsh-plugin-bind-workspace-model'
const NS = 'dsh-plugin-bind-workspace-model'

/* -------------------------------------------------------------------------- */
/* React 替身                                                                 */
/* -------------------------------------------------------------------------- */

const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useMemo(factory) {
    return factory()
  },
  useCallback(callback) {
    return callback
  },
  useEffect() {},
  useRef(initial) {
    return { current: initial ?? null }
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
}

/* -------------------------------------------------------------------------- */
/* 假 window / 假上下文                                                       */
/* -------------------------------------------------------------------------- */

/** 捕获模块加载器注册的 factory。 */
let loaded = null
const windowStub = {
  __ModuleLoader__: {
    load(options) {
      loaded = options
    },
  },
}

/** 记录注册结果的假 Cordis 上下文。 */
const registered = {
  dictionaries: new Map(),
  slots: [],
  localeRegistrations: [],
  menus: [],
  notifications: [],
}

function lookup(key) {
  const language = typeof ctx.locale.getLocale === 'function' && ctx.locale.getLocale().startsWith('zh') ? 'zh' : 'en'
  const dictionary = registered.dictionaries.get(NS)?.[language] ?? {}
  return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key
}

const ctx = {
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
      registered.slots.push(`${options.name}:${options.id ?? options.key ?? ''}`)
      registered.components = registered.components ?? new Map()
      registered.components.set(`${options.name}:${options.id ?? options.key ?? ''}`, Component)
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

/** 工作区状态响应。 */
const stateResponse = {
  ok: true,
  workspace: { id: 'ws-1', path: '/work/demo', title: 'Demo' },
  path: '/work/demo',
  binding: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
  bindingName: 'DeepSeek V4.1 Flash',
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
    ],
    failures: [],
  },
}

const fetchCalls = []
async function fetchMock(input, init = {}) {
  const url = String(input)
  fetchCalls.push({ url, method: init.method ?? 'GET' })
  const body = url.includes('/binding') ? { ok: true, binding: null, applied: { sessions: 0 } } : stateResponse
  return {
    ok: true,
    status: 200,
    async json() {
      return body
    },
  }
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
execute(windowStub, (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
}, fetchMock, console, AbortController)

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
assert.ok(registered.dictionaries.get(NS)?.en?.['menu.label'] === 'Default model', 'carries English copy')
assert.ok(registered.dictionaries.get(NS)?.zh?.['menu.label'] === '默认模型', 'carries Chinese copy')
console.log('ok 1 - locale dictionaries registered')

/* 2. 菜单 / 图标 / 浮层注册。 */
assert.equal(registered.menus.length, 1, 'registers one workspace menu contribution')
const menu = registered.menus[0]
assert.equal(menu.id, 'workspace-default-model')
assert.equal(menu.target, 'workspace', 'targets the workspace context menu')
assert.equal(typeof menu.resolve, 'function')
assert.ok(registered.slots.includes('contextMenu.icon'), 'injects the context menu icon slot')
assert.ok(registered.slots.includes('shell.overlay'), 'injects the shell overlay slot')
assert.ok(registered.slots.includes('contextMenu.icon:workspace.defaultModel'), 'registers the icon by key')
assert.ok(registered.slots.includes('shell.overlay:workspace-default-model'), 'registers the dialog in the overlay')
console.log('ok 2 - workspace menu, icon and overlay entries registered')

/* 3. 关闭状态下对话框不渲染。 */
const Dialog = registered.components.get('shell.overlay:workspace-default-model')
assert.equal(typeof Dialog, 'function', 'overlay entry is a component')
/** 依次展开外层包装组件，直到得到宿主元素或 null。 */
function renderRoot(component) {
  let node = component()
  let depth = 0
  while (node !== null && typeof node === 'object' && typeof node.type === 'function' && depth < 6) {
    node = node.type(node.props)
    depth += 1
  }
  return node
}
const closed = renderRoot(Dialog)
assert.equal(closed, null, 'closed dialog renders nothing')
console.log('ok 3 - dialog renders nothing while closed')

/* 4. 菜单动作：标签带当前模型名，运行后打开对话框。 */
const target = { workspaceId: 'ws-1', path: '/work/demo', displayTitle: 'Demo' }
const actions = await menu.resolve(target, new AbortController().signal)
assert.equal(actions.length, 1, 'menu resolves one action')
assert.ok(actions[0].label.includes('默认模型'), 'label is localized')
assert.ok(actions[0].label.includes('DeepSeek V4.1 Flash'), 'label shows the bound model name')
assert.deepEqual(actions[0].icon, { key: 'workspace.defaultModel' })
const labelCall = fetchCalls.find((call) => call.url.includes('catalog=0'))
assert.ok(labelCall !== undefined, 'menu label fetch skips the full catalog')
actions[0].run()
console.log('ok 4 - menu action resolves and opens the dialog')

/* 5. 打开后渲染出 role="dialog" 的树。 */
const openTree = renderRoot(Dialog)
assert.ok(openTree !== null && typeof openTree === 'object', 'open dialog renders a tree')
function findDialog(node) {
  if (node === null || typeof node !== 'object') return null
  if (node.props !== undefined && node.props.role === 'dialog') return node
  for (const child of node.children ?? []) {
    const found = findDialog(child)
    if (found !== null) return found
  }
  return null
}
const dialog = findDialog(openTree)
assert.ok(dialog !== null, 'open dialog tree carries role="dialog"')
assert.equal(dialog.props['aria-modal'], 'true', 'dialog is modal')
const styleNode = findStyle(openTree)
assert.ok(styleNode !== null && styleNode.includes('--dsw-alias-bg-layer-2'), 'dialog carries its stylesheet')
function findStyle(node) {
  if (node === null || typeof node !== 'object') return null
  if (node.type === 'style') return node.children?.[0] ?? null
  for (const child of node.children ?? []) {
    const found = findStyle(child)
    if (found !== null) return found
  }
  return null
}
console.log('ok 5 - open dialog renders the modal tree with its stylesheet')

/* 6. 空上下文/缺路径时不提供动作（防御式）。 */
const noPath = await menu.resolve({ workspaceId: 'ws-1', displayTitle: 'Demo' }, new AbortController().signal)
assert.deepEqual(noPath, [], 'menu declines when the target has no path')
console.log('ok 6 - menu declines malformed targets')

console.log('\nclient-smoke: all checks passed')
