# Fish 前端附加交付

本目录是 Fish 前端源码包之外的 DSH 配套改动与现场集成参考。未发布 GitHub，未清理工作树；本轮没有执行构建、重启或修改生产配置。

## 版本与内容

- DSH 基线：`d93de44f525a538d0368bc655d0030eee5da7e3f`。
- DSH 最终前端提交：`ec5b2c17611d03b0c808ae9ac1caa2ef0cb451f7`。
- `dsh-companion.patch`：以上两提交间 `git diff --binary`，排除整个 `packages/client/ui-fish`；保留 `packages/client/ui-primitives`、`packages/client/ui-chat` 与 `pnpm-lock.yaml`，共 15 个路径。包含统计原语提取、原 DSH chat 消费者及相关样式/格式化调整。
- `ui-fish` 本身需由主交付源码提供，版本应与上述最终提交匹配。本补丁不包含它，也不包含任何已构建 lib/dist、运行资料、模型凭据或 QQ 会话。
- `integration/fish-workspace/package.json` 与 `cordis.patch.yml`：仅这两份从生产现场原样复制的无 token 文件。保留了现场 E 盘路径、端口和宿主根，用于说明实际接通组成；其他机器应在自己的部署副本中改为本机安装路径，不能照搬绝对路径。未复制 node_modules、锁文件、账号或环境变量文件。

在相应 DSH 基线工作树中应用附加补丁：

```powershell
git apply --check '/交付目录/dsh-companion.patch'
git apply '/交付目录/dsh-companion.patch'
```

对应的补丁生成命令如下；排除项是目录级 Git pathspec：

```powershell
git diff --binary d93de44f525a538d0368bc655d0030eee5da7e3f ec5b2c17611d03b0c808ae9ac1caa2ef0cb451f7 -- . ':(exclude)packages/client/ui-fish'
```

## 三包与 Web 构建

以下命令供接收者重建，并未在本次打包中执行。在 DSH 仓库根运行，先准备该版本要求的 Node、pnpm 与依赖；不要把本文命令当作本轮新增通过证据。完整首建应优先使用仓库维护的 `pnpm run build`，它负责前置生成、Host/Client 产物和 Web。

已有完整依赖与生成元数据时，可按现场范围定向重建三个包及静态 Web：

```powershell
# solution 配置编译三包及所需项目引用；ui-fish 的 Host、Client 都需要。
pnpm exec tsc -b packages/client/ui-primitives/tsconfig.json packages/client/ui-chat/tsconfig.json packages/client/ui-fish/tsconfig.json

# 公共原语、原 DSH chat 消费者、Fish Host 和 Fish Client。
pnpm --dir packages/client/ui-primitives exec tsdown --config tsdown.config.ts --config-loader native --env.DSH_BUILD_FACE=client
pnpm --dir packages/client/ui-chat exec tsdown --config tsdown.config.ts --config-loader native --env.DSH_BUILD_FACE=client
pnpm --dir packages/client/ui-fish exec tsdown --config tsdown.config.ts --config-loader native --env.DSH_BUILD_FACE=host
pnpm --dir packages/client/ui-fish exec tsdown --config tsdown.config.ts --config-loader native --env.DSH_BUILD_FACE=client

# 必须使用 apps/web 自己的构建脚本和 Vite 依赖。
pnpm --dir apps/web run build
```

`ui-primitives` 使用 `staticLinked`，属于 Web 静态 shell；修改公共统计导出后只更新 Fish 的 `client.js` 不够，必须重建 Web。现场曾误用仓库根的 Vite 8，触发 `getWatchFiles` 不兼容；使用 `apps/web` 自身 Vite 6.4.3 后完成，不需要改业务源码。

Fish 原生桥的 Host 类型/Typert 元数据和 Host `index.js`、Client `client.js` 必须来自同一版本；首次接入不要只拷贝 `client.js`。最后 `ec5b2c` 仅是 Client scoped 注入补正，其单独热修无需重建 Host 元数据，但完整源码交付仍应保持版本一致。

## 实际 fish-workspace 依赖缺失教训

现场最初已启用 `fish-workspace` 和 `ui-fish`，但 `fish-workspace/package.json` 只有 bundle patch，没有 dependencies。以真实 profile 为锚点解析 `@deepseek-ai/dsh-client-ui-fish` 时得到 `MODULE_NOT_FOUND`；从 DSH 源码根能绝对导入，并不能证明 profile 能解析它。

DSH 的 `dependencyClosure` / `collectProfileScopePackages` 只把安装范围及所选 bundle 的 dependencies、peerDependencies 闭包纳入运行解析。现在复制的 manifest 已声明 `@deepseek-ai/dsh-client-ui-fish` 为现场 `link:` 依赖；bundle 的 node_modules 也必须能够解析到相应包。仅写一行 Cordis `name` 或复制产物不构成完整安装关系。

入口出现后的最后错误是 Client 命名空间未显式注入。最终提交在 `$mount` 成功后通过 `ctx.inject(['remote.fishWorkbench'], scoped => ...)` 注册面板并捕获 scoped namespace；不能把自身 mount 前尚不存在的命名空间加入顶层 inject，令它等待自己。

## 后端公开交付排除清单（只读检查）

已检查后端整合 tracked 文件；检查时源为 `303a452d0184866d88c9f6556e8598a3f5697cd2`，随后按主控要求仅快进到统计读面修复 `328561df68b2360e264cc7c64c5cf305a31762b2`。该修复只追加读面与对应离线断言，不改变下述现场文件清单。未改后端源码或任何运行配置。

公开源码包至少排除以下已 tracked 路径，不应依赖“没有加进这次 diff”来放行：

```text
outputs/验收/迁移后本机任务.json
outputs/验收/迁移后聊天接续.json
harness/chat-expression-examples.json
harness/context-settings.json
harness/conversations.json
harness/delegation.json
harness/integration.json
harness/network.json
harness/vision-identification.json
```

前两项是本机验收执行引用。顶层 JSON 包含现场示例资料、场所/偏好、本机路径和运行参数；本次交付不把它们作为公共默认配置。公开默认值应另从 `packaging/defaults` 等受维护模板准备，不能回填第二份生产配置。

密钥格式扫描只输出文件名，没有输出命中值。未发现 tracked 私钥块；部分测试文件使用明确 synthetic/test 字面量。以下三个测试文件的字面量仍应由发布负责人复核或在发布副本中脱敏，不能凭正则命中直接称为生产密钥，也不能宣称整个仓库已获保密审计通过：

```text
channels/fish_qq/tests/test_contract.py
tools/test_web_knowledge.py
tools/test_web_tools.py
```

原场所编号也出现在部分说明、现场脚本和历史测试中；仅凭编号相同不能区分真实资料与合成 fixture。发布负责人还应复核 `FISH-QUICKSTART.md`、`RESULT.md`、`docs/Fish-*.md`、`harness/agents/*.md`、`harness/global/AGENTS.md` 及 `tools/` 下现场 demo/probe/replay 脚本，保留通用模板时清除主人身份、本机位置及真实聊天片段。本次没有输出这些具体值，也没有对源码作发布清理。
