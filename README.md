# dsh-agent-plugin-bridge

[![CI](https://img.shields.io/badge/tested_with-dsh_0.1.0--rc.6-blue.svg)](#dependency-strategy-read-this)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](#english) · [中文](#中文)

A generic **Agent Plugins 1.0 → DeepSeek Harness bridge**. Drop it into any
DSH profile and it will scan a list of plugin roots and plugin directories,
pick up every package that has a `plugin.json`, and wire its `skills/` and
`mcp.json` into the host. No per-business branching — same code path works
for `tm-dagu-adapt`, `agenthandoff`, or any future `agent-plugins.org`
package.

> Forked from [zoahdev/dsh-plugin-template](https://github.com/zoahdev/dsh-plugin-template):
> carries the template's runtime peer-version guard, the bundled `cordis.patch.yml`,
> the unit + packaged integration + DSH-boot smoke posture, and the bilingual README.
>
> Tested with: `dsh` 0.1.0-rc.6 · Node 24 · pnpm 11

## What's inside

```text
├── package.json              # dsh.bundle manifest + build scripts (prepare = git-install build)
├── cordis.patch.yml          # plugin row: id, package name, default config
├── src/
│   ├── index.ts              # plugin entry: name / inject / Config / apply + bridge_summary tool + peer guard
│   ├── version.ts            # dependency-free caret-range matcher used by the runtime guard
│   ├── discover.ts           # plugin.json + skills/ + mcp.json discovery
│   ├── expand.ts             # ${VAR} placeholder expansion
│   ├── mcp.ts                # Agent Plugin MCP + standalone mcp.json registration
│   ├── skills.ts             # SKILL.md discovery and host-skills registration
│   └── types.ts              # shared wire types
├── tests/
│   ├── index.spec.ts         # plugin registration, runBridge end-to-end (mocked ctx)
│   ├── version.spec.ts       # prerelease range behavior matrix
│   ├── discover.spec.ts      # plugin.json scanning, dedup
│   ├── expand.spec.ts        # ${VAR} expansion rules
│   └── skills.spec.ts        # SKILL.md → host skills service mapping
├── scripts/
│   ├── integration-test.mjs  # installs the PACKED tarball → real apply() → real tool execution
│   ├── local-skill.mjs       # loads the packed plugin into a real cordis context, registers a real Agent Plugin (default: tm-dagu-adapt), asserts bridge_summary
│   └── dsh-smoke.sh          # fresh DSH profile install + config check + web boot (bounded retry)
├── .github/workflows/ci.yml  # doctor → test → pack → integration → DSH boot smoke (windows-latest)
└── README.md                 # bilingual
```

## What the bridge actually does

1. On startup, `apply()` runs `assertPeerCompatible()` and refuses to load if
   the resolved `@deepseek-ai/dsh-tools` does not satisfy `^0.1.0-rc.6`. This
   turns pnpm's silent older-RC linking into a loud, actionable error.
2. It then calls `discoverPlugins(pluginRoots, pluginsDirs)`. Each
   candidate directory must contain a `plugin.json` with a `name` field;
   optional `skills/` and `mcp.json` are picked up if present.
3. For every discovered plugin it registers each `skills/<folder>/SKILL.md`
   into the host `skills` service (frontmatter is parsed with a tiny
   dependency-free parser). If `loadPluginMcp` is on it also registers the
   plugin's `mcp.json` against the host MCP client.
4. It then iterates `mcpJsonPaths` and registers every standalone mcp.json
   (typical: `~/.cursor/mcp.json`) the same way — same wire format, same
   `${VAR}` expansion semantics.
5. It registers a `bridge_summary` tool so the agent can introspect what was
   actually loaded.

## Two kinds of `mcp.json`

Agent Plugins 1.0 bundles an `mcp.json` per package. Those often use
`${SOME_ENV}` placeholders that only resolve when the host has the right
secrets — until then they fail with `empty command after env expansion`.
The bridge exposes two knobs:

- `loadPluginMcp` (default `true`) — load the per-plugin `mcp.json`.
- `mcpJsonPaths` — extra standalone `mcp.json` files outside any package.
  Typical: `~/.cursor/mcp.json`, which is the user-level MCP config and
  does not depend on plugin env vars.

Set `loadPluginMcp: false` while the env vars are missing and the bridge
will still pick up the standalone file.

## Configuration

`cordis.patch.yml` ships these defaults — override them in your profile
config:

```yaml
- id: dsh-agent-plugin-bridge
  name: dsh-agent-plugin-bridge
  config:
    pluginRoots: []               # explicit Agent Plugin package roots
    pluginsDirs:                  # directories whose children are scanned
      - '~/.cursor/plugins/local'
    mcpJsonPaths:                 # extra standalone mcp.json files
      - '~/.cursor/mcp.json'
    loadPluginMcp: false          # load each plugin's own mcp.json (default off, plugin mcp.json usually needs host env vars)
    failOnMcpError: false         # keep going when an MCP server fails to start
    skillProviderLabel: agent-plugin
```

Use `~` in paths; the bridge expands it against `homedir()`.

## Dependency strategy (read this)

- **Tested with**: `@deepseek-ai/dsh-tools` **0.1.0-rc.6** and `@deepseek-ai/cordis` **^4.0.1**.
- `peerDependencies` declares `"@deepseek-ai/dsh-tools": "^0.1.0-rc.6"`. This is a **caret range, not a pin**:
  - It currently matches `0.1.0-rc.6`, later RCs of `0.1.x` (`rc.7`, `rc.10`, ...), and `0.1.0` stable once published.
  - It does **not** match `0.1.0-rc.5`/older RCs, nor the `0.0.1-rc.*` train.
- `devDependencies` uses the same range; the committed `pnpm-lock.yaml` pins the exact tested version for development and CI.
- **Empirically verified with pnpm 11**: if the host already contains an older RC (e.g. `0.1.0-rc.3`), pnpm's default config links that older version into the plugin's peer slot with only a generic warning — **no error, no auto-upgrade**. npm fails loudly with `ERESOLVE` instead. Neither tool auto-upgrades the host.

The plugin refuses to load when the resolved `@deepseek-ai/dsh-tools` does
not satisfy `^0.1.0-rc.6` (runtime guard in `apply()`, backed by
`src/version.ts`). A silent mismatch becomes a clear, actionable error.

## Use it

The bridge is bundled for the standard `dsh plugin add` flow:

```sh
pnpm install
pnpm build
pnpm test
pnpm pack
dsh plugin --profile web add ./dsh-agent-plugin-bridge-0.1.0.tgz
dsh web --port 4099
```

Then ask the agent: "Use the bridge_summary tool to tell me what was loaded."

## CI

`.github/workflows/ci.yml` mirrors the template pipeline:

1. clean checkout
2. `pnpm install --frozen-lockfile`
3. `pnpm typecheck`
4. `pnpm run build`
5. `pnpm test` (unit)
6. `pnpm pack`
7. **packaged integration + real tool invocation** — `scripts/integration-test.mjs` installs the actual tarball into a fresh project, loads the installed bundle, registers `bridge_summary` through the real `apply()` / `ctx.tools.register` path, executes the real handler, and asserts the canonical result.
8. `dsh-smoke` job (windows-latest): `scripts/dsh-smoke.sh` installs the tarball into a brand-new `DSH_HOME`, verifies the plugin row in `--dump-config`, boots `dsh web` with a 30s bounded retry, and cleans up the background process.

For local end-to-end without `dsh web` (when C: is full or you cannot install `@deepseek-ai/dsh`):

```sh
pnpm pack
node scripts/local-skill.mjs D:/AgentRepo/GitRepo/GitRepo/tm-dagu-adapt
```

This loads the packed tarball into a real cordis `Context`, registers the first `plugin.json` it finds, registers its `SKILL.md` into the host `skills` service, and asserts `bridge_summary.execute()` returns the right counts.

## Publishing checklist

- [ ] `pnpm typecheck` and `pnpm build` pass
- [ ] `pnpm test` passes
- [ ] `pnpm pack` produces a tarball
- [ ] **packaged plugin loads in a fresh profile** (integration + smoke scripts pass)
- [ ] **`bridge_summary` runtime invocation passes with an asserted result** (integration script)
- [ ] README bilingual, with install, config, examples, and troubleshooting
- [ ] Repo topic: `dsh-plugin`
- [ ] Tag a release (e.g. `v0.1.0`) with the packed tarball
- [ ] Optional: `pnpm publish` to npm

## Troubleshooting

### npm: `ERESOLVE` peer dependency conflict

The host already has an older RC that does not satisfy `^0.1.0-rc.6`.

1. Upgrade the host to the tested version or newer:

   ```sh
   pnpm dlx @deepseek-ai/dsh --version   # must print 0.1.0-rc.6 or later
   ```

2. Reinstall the plugin so it links against the upgraded host:

   ```sh
   pnpm dlx @deepseek-ai/dsh plugin --profile web add <this-plugin>
   ```

3. Do **not** reach for `--legacy-peer-deps` to silence the error — the plugin's runtime guard will refuse to load if an incompatible version is linked anyway.

### pnpm: install succeeds but the plugin later fails to load

pnpm's default config can silently link an older RC into the plugin's peer slot. The plugin then refuses to load with:

```text
dsh-agent-plugin-bridge: resolved @deepseek-ai/dsh-tools 0.1.0-rc.3, but this plugin is tested with ^0.1.0-rc.6. ...
```

1. Upgrade the host to `0.1.0-rc.6` or later and reinstall.
2. Optional hardening: enable `strict-peer-dependencies=true` in your project/profile `.npmrc`.

### `mcp ${server}: empty command after env expansion`

A plugin's `mcp.json` uses a `${SOME_ENV}` placeholder that the host does not have. Two options:

- Set the env vars so the bridge can expand the command.
- Or temporarily set `loadPluginMcp: false` in `cordis.patch.yml` and rely on a standalone `mcp.json` (e.g. `~/.cursor/mcp.json`) instead.

### Agent skills don't show up

- Make sure the package actually has `plugin.json` with a `name` field — the bridge silently skips invalid manifests.
- Check `pluginsDirs` and `pluginRoots`; paths starting with `~` are expanded against `homedir()`.
- The host must expose the `skills` service (this plugin declares `inject = ['skills']`).

### You verified a newer RC and want to move the plugin forward

Bump `TESTED_PEER_RANGE` in `src/index.ts`, update `package.json` (peer + dev), regenerate `pnpm-lock.yaml` (`pnpm install`), and update the "Tested with" line in this README — all four together.

## License

MIT

---

## 中文

**dsh-agent-plugin-bridge** 是通用 Agent Plugins 1.0 → DeepSeek Harness 桥接插件：把它装进任何 DSH profile，
它就会扫描一组 plugin 根目录与 plugin 目录，挑出所有带 `plugin.json` 的包，把 `skills/` 和 `mcp.json`
挂到宿主上。不按业务分叉——`tm-dagu-adapt`、`agenthandoff` 或任何未来符合 `agent-plugins.org` 规范的包都走同一条代码路径。

> Fork 自 [zoahdev/dsh-plugin-template](https://github.com/zoahdev/dsh-plugin-template)：
> 沿用了模板的运行时 peer 版本守卫、捆绑的 `cordis.patch.yml`、单元 + 打包集成 + DSH 启动冒烟流程、双语 README。
>
> 已验证版本：`dsh` 0.1.0-rc.6 · Node 24 · pnpm 11

## 包含内容

```text
├── package.json              # dsh.bundle 清单 + 构建脚本（prepare 支持 git 安装）
├── cordis.patch.yml          # 插件行：id、包名、默认 config
├── src/
│   ├── index.ts              # 插件入口 + bridge_summary 工具 + 运行时版本守卫
│   ├── version.ts            # 无依赖的 caret 范围匹配器（守卫使用）
│   ├── discover.ts           # plugin.json + skills/ + mcp.json 发现
│   ├── expand.ts             # ${VAR} 占位符展开
│   ├── mcp.ts                # Agent Plugin MCP 与独立 mcp.json 注册
│   ├── skills.ts             # SKILL.md 发现并写入宿主 skills 服务
│   └── types.ts              # 共享线协议类型
├── tests/                    # vitest：注册、行为、取消、解析
├── scripts/
│   ├── integration-test.mjs  # 安装打包产物 → apply() → 执行真实 bridge_summary → 断言
│   ├── local-skill.mjs       # 真 cordis 上下文里加载打包插件，加载真实 Agent Plugin（默认 tm-dagu-adapt），断言 bridge_summary
│   └── dsh-smoke.sh          # 全新 DSH profile 安装 + 配置校验 + web 启动（限时重试）
├── .github/workflows/ci.yml  # doctor → test → pack → integration → DSH 启动冒烟（windows-latest）
└── README.md                 # 双语
```

## 桥接到底做了什么

1. 启动时 `apply()` 先跑 `assertPeerCompatible()`，解析到的 `@deepseek-ai/dsh-tools`
   不满足 `^0.1.0-rc.6` 就直接拒绝加载。把 pnpm 静默链接老 RC 变成响亮、可操作的报错。
2. 调 `discoverPlugins(pluginRoots, pluginsDirs)`。每个候选目录必须含 `plugin.json` 与 `name` 字段；
   有 `skills/` 与 `mcp.json` 就一并收下。
3. 对每个发现的插件，把 `skills/<folder>/SKILL.md` 注册进宿主 `skills` 服务
   （frontmatter 用一个免依赖的小解析器处理）。`loadPluginMcp` 为开时再把它自己的 `mcp.json` 注册到宿主 MCP 客户端。
4. 遍历 `mcpJsonPaths`，把每个独立的 `mcp.json`（典型：`~/.cursor/mcp.json`）也按同样规则注册——同样的线协议、同样的 `${VAR}` 展开语义。
5. 注册一个 `bridge_summary` 工具，agent 可以随时回头查"这一轮到底加载了什么"。

## 两类 `mcp.json`

Agent Plugins 1.0 的包内 `mcp.json` 经常使用 `${SOME_ENV}` 占位符，需要宿主里准备好对应变量；
在变量到位之前，启动时会报 `empty command after env expansion`。桥接给了两个旋钮：

- `loadPluginMcp`（默认 `true`）——加载每个插件自己的 `mcp.json`。
- `mcpJsonPaths`——额外、独立于任何包的 `mcp.json` 文件。典型：`~/.cursor/mcp.json`，是用户级 MCP 配置，不依赖插件环境变量。

环境变量没到位的时候，把 `loadPluginMcp: false`，桥接仍然能加载独立的那份。

## 配置

`cordis.patch.yml` 自带默认值，需要在 profile config 里覆盖就覆盖：

```yaml
- id: dsh-agent-plugin-bridge
  name: dsh-agent-plugin-bridge
  config:
    pluginRoots: []               # 显式 Agent Plugin 包根
    pluginsDirs:                  # 子目录会被扫描
      - '~/.cursor/plugins/local'
    mcpJsonPaths:                 # 额外的独立 mcp.json 文件
      - '~/.cursor/mcp.json'
    loadPluginMcp: false          # 是否加载插件自己的 mcp.json（默认关：插件 mcp.json 经常依赖宿主环境变量）
    failOnMcpError: false         # MCP 启动失败时是否中止整桥
    skillProviderLabel: agent-plugin
```

路径里的 `~` 会按 `homedir()` 展开。

## 依赖策略（请读这一段）

- **已验证**：`@deepseek-ai/dsh-tools` **0.1.0-rc.6**、`@deepseek-ai/cordis` **^4.0.1**。
- `peerDependencies` 声明 `"@deepseek-ai/dsh-tools": "^0.1.0-rc.6"`。这是 **caret 范围，不是 pin**：
  - 目前匹配 `0.1.0-rc.6`、后续 `0.1.x` 的 RC（`rc.7`、`rc.10`…），以及未来发布的 `0.1.0` 稳定版。
  - **不匹配** `0.1.0-rc.5` 及更早 RC，也不匹配 `0.0.1-rc.*` 版本线。
- `devDependencies` 使用同一范围；提交的 `pnpm-lock.yaml` 把开发与 CI 固定到已验证的确切版本。
- **pnpm 11 实测**：宿主已存在旧 RC（如 `0.1.0-rc.3`）时，pnpm 默认配置会把旧版本链进插件的 peer 槽，只给一条泛泛的警告。
  npm 则会以 `ERESOLVE` 响亮失败。两个工具都不会自动帮你升级宿主。

插件在 `apply()` 里加了**运行时版本守卫**（`src/version.ts` 支撑），把静默不兼容变成清晰、可操作的报错。

## 使用

按 `dsh plugin add` 标准流程安装：

```sh
pnpm install
pnpm build
pnpm test
pnpm pack
dsh plugin --profile web add ./dsh-agent-plugin-bridge-0.1.0.tgz
dsh web --port 4099
```

然后让 agent："用 bridge_summary 工具告诉我加载了什么。"

## CI

`.github/workflows/ci.yml` 复刻模板流水线：

1. clean checkout
2. `pnpm install --frozen-lockfile`
3. `pnpm typecheck`
4. `pnpm run build`
5. `pnpm test`（单元）
6. `pnpm pack`
7. **打包产物集成 + 真实工具调用**——`scripts/integration-test.mjs` 把实际 tarball 装进全新项目，加载已安装产物，
   通过真实的 `apply()` / `ctx.tools.register` 注册 `bridge_summary`，执行真实 handler，断言返回结果。
8. `dsh-smoke` job（windows-latest）：`scripts/dsh-smoke.sh` 在全新 `DSH_HOME` 安装 tarball，
   校验 `--dump-config` 里的插件行，30 秒限时重试启动 `dsh web`，并清理后台进程。

本地端到端（不需要 `dsh web`、C: 盘满或者装不了 `@deepseek-ai/dsh` 时用）：

```sh
pnpm pack
node scripts/local-skill.mjs D:/AgentRepo/GitRepo/GitRepo/tm-dagu-adapt
```

——把打包好的 tarball 装进一个真 cordis `Context`，加载第一个 `plugin.json`，把 `SKILL.md` 写入宿主 `skills` 服务，断言 `bridge_summary.execute()` 返回的计数。

## 发布清单

- [ ] `pnpm typecheck` 与 `pnpm build` 通过
- [ ] `pnpm test` 通过
- [ ] `pnpm pack` 产出 tarball
- [ ] **打包产物能在全新 profile 加载**（集成 + 冒烟脚本通过）
- [ ] **`bridge_summary` 运行时调用通过并有明确断言**（集成脚本）
- [ ] README 双语：安装、配置、示例、故障排查
- [ ] 仓库话题 `dsh-plugin`
- [ ] 打 Release（如 `v0.1.0`）并附 tarball
- [ ] 可选：`pnpm publish` 发 npm

## 故障排查

### npm：`ERESOLVE` peer 依赖冲突

宿主已有不满足 `^0.1.0-rc.6` 的旧 RC。

1. 把宿主升到已验证版本或更新：

   ```sh
   pnpm dlx @deepseek-ai/dsh --version   # 必须打印 0.1.0-rc.6 或更新
   ```

2. 重新安装插件，让它链接到升级后的宿主：

   ```sh
   pnpm dlx @deepseek-ai/dsh plugin --profile web add <本插件>
   ```

3. **不要**用 `--legacy-peer-deps` 压掉错误——压掉以后运行时守卫照样会在版本不对时拒绝加载。

### pnpm：安装成功但插件加载失败

pnpm 默认配置可能把旧 RC 静默链进插件的 peer 槽。插件随后拒绝加载，报错形如：

```text
dsh-agent-plugin-bridge: resolved @deepseek-ai/dsh-tools 0.1.0-rc.3, but this plugin is tested with ^0.1.0-rc.6. ...
```

1. 把宿主升到 `0.1.0-rc.6` 或更新，然后重装。
2. 可选加固：在项目/profile 的 `.npmrc` 里加 `strict-peer-dependencies=true`，让 pnpm 响亮失败。

### `mcp ${server}: empty command after env expansion`

插件 `mcp.json` 用了 `${SOME_ENV}` 占位符，宿主里没设环境变量。两种修法：

- 把环境变量补齐，让桥接能正确展开命令。
- 临时在 `cordis.patch.yml` 里把 `loadPluginMcp: false`，并依赖独立的 `mcp.json`（如 `~/.cursor/mcp.json`）。

### Agent skills 没出现

- 先确认包确实有 `plugin.json` 且带 `name` 字段——桥接对非法清单会静默跳过。
- 检查 `pluginsDirs` 与 `pluginRoots`；以 `~` 开头的路径会按 `homedir()` 展开。
- 宿主必须暴露 `skills` 服务（本插件声明 `inject = ['skills']`）。

### 你验证了更新的 RC，想把插件推进

同步改四处：`src/index.ts` 的 `TESTED_PEER_RANGE`、`package.json`（peer + dev）、
`pnpm-lock.yaml`（重新 `pnpm install`）、README 的"已验证版本"行。

## 许可证

MIT
