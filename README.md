# DeepSeek Harness 按工作区默认模型插件

一个 DeepSeek Harness 插件 bundle：给**每个工作区**记住默认的 provider / 模型 / 推理强度
（reasoning effort）。之后在这个工作区里**新建**的会话会直接以该默认模型开始，不用每次手动切换。

- 绑定是**按工作区**的，工作区之间互不影响，可以为不同工作区配不同的默认模型。
- 主要作用于**新会话**；有对话历史的会话不会被追溯修改。
- 在某个会话里临时切换模型只影响那个会话，**不会**改写工作区默认值。
- 清空某工作区的默认值后，之后新建的会话回到**全局默认模型**。

包名：`@local/dsh-plugin-bind-workspace-model`。`@local/` 是本地占位 scope（不发布到 npm
registry），安装走下面的 Release `.tgz` 或 GitHub 仓库两种方式。

## 使用

1. 按下面任一方式安装并启用；**刷新一次 Web GUI 页面**（新的浏览器端 bundle 在下次页面加载时生效）。
2. 在左侧**工作区**列表里找到目标工作区，打开该行尾部的 **...** 菜单 → **默认模型**。
3. 选择 provider、模型与推理强度，保存。

之后该工作区新建的会话就会以这个选择开始。具体语义：

- **生效时机是会话创建时**：新会话在发出第一轮请求前套用工作区默认值；有对话历史的会话不受影响。
- **保存时同步空白会话**：该工作区里已经打开、但还没开始对话且没手动切过模型的空白会话，会一并
  切到新默认值；手动切过模型的空白会话保持不动。
- **会话内切换只影响该会话**：在会话里换模型不会回写工作区默认值，也不会影响同工作区的其它会话。
- **清空绑定**：在工作区菜单里清空默认模型后，之后新建的会话恢复使用全局默认模型；已经打开的
  空白会话不会被强制改回。
- **删除/重建工作区**：删除工作区后，它的默认模型不再生效，并在下一次保存绑定或清空时从数据文件里
  清理掉；重新创建同一个目录的工作区会被当作新工作区，需要重新选一次默认模型。
- **候选列表**来自当前挂载的 provider 与模型目录；某个 provider 无法列出模型时会在目录里单独
  标为失败，不影响其它 provider。

## 安装

### 方式 A：从 Release 里的 .tgz 安装（推荐）

每次 push 到 `main` / `master`，仓库自带的 GitHub Action 会为这次提交打包并发布一个
`build-<提交短SHA>` 的 GitHub Release，资产是：

```
dsh-plugin-bind-workspace-model-<version>-<短SHA>.tgz
dsh-plugin-bind-workspace-model-<version>-<短SHA>.tgz.sha256
```

每个 Release 里同时有两套资产：

- `dsh-plugin-bind-workspace-model-<version>-<短SHA>.tgz`：这次提交的确定版本（带版本号与提交
  短 SHA，可追溯，适合固定版本安装）；
- `dsh-plugin-bind-workspace-model.tgz`：固定文件名的“最新构建”副本，用于下面这个**稳定地址**。

#### 稳定安装地址（推荐长期使用）

```text
https://github.com/<owner>/<repo>/releases/latest/download/dsh-plugin-bind-workspace-model.tgz
```

GitHub 的 `releases/latest/download/<文件名>` 会重定向到**最新一个 Release** 里同名资产，所以这个
地址长期不用改：以后每次 push，安装同一个地址拿到的就是最新构建。把它粘贴进 Web GUI 的
**Plugins → Add plugin** 输入框，或命令行安装：

```bash
dsh plugin --profile web add https://github.com/<owner>/<repo>/releases/latest/download/dsh-plugin-bind-workspace-model.tgz
```

#### 安装某一次确定的构建

打开仓库的 **Releases** 页面，找对应的 `build-*` Release（资产名里带版本号与提交短 SHA，据此
确认它对应哪次提交），复制该 `.tgz` 资产的下载地址，然后：

```bash
dsh plugin --profile web add <release 里 .tgz 的下载地址>
```

也可以把同一个 `.tgz` 下载地址粘贴进 Web GUI 的 **Plugins → Add plugin** 安装框。安装前可选核对：

```bash
sha256sum -c dsh-plugin-bind-workspace-model-<version>-<短SHA>.tgz.sha256
```

> 说明：GitHub Actions 自动发布的 Release 没有“升级”语义；从 tarball 安装的插件不会出现在
> “Versions”更新列表里，升级方式是卸载后重新用同一个稳定地址安装。

### 方式 B：直接安装 GitHub 仓库

仓库根目录就是插件包根目录（仓库地址由你自己的 GitHub 仓库决定，下面的 `<owner>/<repo>` 是占位符）（`package.json`、`index.js`、`client.js` 都在根上，没有构建步骤）：

```bash
dsh plugin --profile web add github:<owner>/<repo>
```

等价的写法是 `https://github.com/<owner>/<repo>`（建好仓库后把 `<owner>/<repo>` 换成实际地址），或把它填进
Plugins 页面的安装框。代价是每次安装/升级都走 git 拉取，版本与校验和不如 Release 包可追溯。

### 安装之后

- **刷新一次 Web 页面**：新增的“默认模型”菜单项由新的浏览器端 bundle 提供，要等页面下次加载
  才出现。
- Host 半在安装后会即时加载，不需要重启 Host。
- 安装目标必须满足包内声明的 `engines.dsh` 版本要求，否则 DSH 会拒绝安装。

## 数据保存在哪

- 绑定数据由 Host 半保存在 `$DSH_HOME/workspace-default-model/bindings.json`，是一个很小的
  JSON 文件。每条记录按**工作区 id** 保存（同时记录规范化路径，便于迁移）；未注册的目录退化为
  按路径保存（`$DSH_HOME` 由 Host 决定，默认通常是 `~/.dsh`）。
- 旧版本（按路径保存）的数据在首次读取时会自动迁移到工作区 id，无需手工处理。
- 删除这个文件等于清空**所有**工作区的默认模型绑定（之后新建会话都回到全局默认）。
- **卸载插件不会删除这个文件**；如需彻底清理，卸载后手动删除该文件（或整个
  `workspace-default-model/` 目录）。

## 已知限制 / Known limits

- 绑定在**会话创建时**应用；有对话历史的会话不会被追溯修改（空白会话的同步规则见上面的“保存时
  同步空白会话”）。
- 只对普通顶层会话生效，智能体团队/子代理等派生会话不使用工作区默认值。
- 会话内切换模型只对那个会话有效，不会同步到工作区默认值——这是有意为之。
- “默认模型”列表里的候选来自**当前挂载的 provider 与模型目录**（不检查凭据）；运行中增删
  provider / 模型后列表随之变化；无法列出模型的 provider 会作为目录里的失败项单独标出，不影响
  其它 provider。
- 存储是 Host 本地磁盘上的一个很小的 JSON 文件，没有多 Host 同步或迁移机制。
- 本插件只设置会话的模型选择，不修改全局默认模型，也不影响其它工作区的绑定。

## 开发 / Development

纯 JS、无构建步骤。冒烟测试自带伪造的 Host / Client 上下文，不需要真实的 Harness 实例：

```bash
node --check index.js
node --check client.js
node test/host-smoke.mjs
node test/client-smoke.mjs
```

本地开发安装（把当前 checkout 直接链进 `web` profile）：

```bash
dsh plugin --profile web add /abs/path/to/dsh-plugin-bind-workspace-model
```

改动 Host 半通常会在 profile 重载时生效；改动 Client 半需要刷新页面。

CI：[`.github/workflows/ci-release.yml`](.github/workflows/ci-release.yml) —— push 到
`main` / `master` 或手动触发时跑检查、`npm pack` 打包并发布 per-commit Release；pull request
只跑检查。重跑同一提交会复用已有 Release 并覆盖资产。

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：按工作区读写绑定、模型候选，并在新会话创建时应用默认模型。 |
| `client.js` | 浏览器端：工作区 **...** 菜单里的 **默认模型** 入口与选择对话框。 |
| `cordis.patch.yml` | bundle patch，让 Host 与 Client 两半被加载。 |
| `locale/*.json` | Plugin Manager 的显示元数据（标题/描述）。 |
| `icon.svg` | 插件图标。 |
| `test/*.mjs` | 不依赖真实 Harness 的冒烟测试。 |
| `.github/workflows/ci-release.yml` | CI：跑检查，并为每次提交打包发布 GitHub Release。 |

---

## English

A DeepSeek Harness plugin bundle that gives each **workspace** its own default provider / model /
reasoning effort. New sessions created in that workspace start on that selection; sessions with
history are left untouched.

- Set it from the workspace row's **...** menu → **默认模型 / Default model**.
- Switching the model inside a session only affects that session; it never overwrites the workspace
  default. Clearing the workspace default restores the global default for sessions created afterwards.
- Bindings live in `$DSH_HOME/workspace-default-model/bindings.json` on the Host. Deleting that file
  clears all bindings; uninstalling the plugin does **not** remove it.

Install from the per-commit `.tgz` on the latest `build-*` release page, or straight from the repo:

```bash
dsh plugin --profile web add <release .tgz URL>
dsh plugin --profile web add github:<owner>/<repo>
```

Refresh the Web page once after installing so the new client bundle loads (the Host half loads
live). Known limits: the binding is applied at session creation (saving a new default also retargets
not-yet-started sessions of that workspace), the model catalog reflects currently mounted providers
(a provider that cannot list models is reported as a catalog failure), and storage is a single small
JSON file on the Host.

Development:

```bash
node --check index.js && node --check client.js
node test/host-smoke.mjs
node test/client-smoke.mjs
dsh plugin --profile web add /abs/path/to/repo   # install the local checkout
```
