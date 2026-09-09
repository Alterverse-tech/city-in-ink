# 协作手册 · SF TECH WEEK CITY

给用 Claude Code 开发这个仓库的人。**每节给一段可以直接粘贴的 prompt**，你不需要自己敲命令。英文的完整技术说明在 [README.md](README.md)。

仓库根目录有 `CLAUDE.md`，Claude Code 开会话时自动读取，里面写着构建方式、编辑规则、哪些报错是正常的、以及"推 main = 上线"。所以下面的 prompt 可以写得很短——约束已经在那里了。

---

## ⚠️ 你必须知道的一件事（Claude 不会替你承担的判断）

**push 到 `main`，约 30 秒后线上游戏就变了，没有任何人审核。** 实测：12:54:25 push，12:54:55 线上版本从 rev 6 跳到 rev 7。

`CLAUDE.md` 已经要求 Claude：除非你在当前这句话里明确说了要上线，否则不许推 `main`。但**"要不要让玩家现在看到这个改动"这个判断是你的**，不是 Claude 的。所以：

- 平时说"改个 xxx"、"提交一下" → Claude 会提交到分支，不会上线。
- 只有你说"发布 / 上线 / 推到 main"时，才会真的动线上。

---

## 0. 第一次上手

```
克隆 git@github.com:Alterverse-tech/city-in-ink.git 到本地，读 CLAUDE.md，
按里面写的方式把本地开发版跑起来，起一个静态服务器，在浏览器里打开，
确认城市能渲染、能点进城、小鸟能飞。

控制台会有一批报错，先对照 CLAUDE.md 判断哪些是预期现象，不要去"修"它们。
跑通后告诉我端口号，以及哪些报错是预期的、有没有意料之外的。
```

## 1. 改一个功能

把 `<>` 换成你的需求。

```
在新分支上做这件事：<你的需求，比如"把海鸥飞行路线的颜色改成暖色调">

要求：
- 改完重新构建，在浏览器里实际打开验证效果，不要只看构建成功就说完成
- 确认没有新增控制台报错（CLAUDE.md 里列的那几个预期报错除外）
- 验证通过后提交到分支，先不要推 main
- 告诉我你具体改了哪些文件、验证时看到了什么
```

## 2. 上线

确认改动没问题之后：

```
把当前分支合并到 main 并推送，我要让这个改动上线。

推完之后盯着 GitHub Actions 里的 Chrona release 跑完，然后向 Chrona 确认线上
revision 确实变了（不要只看 Actions 绿了就说成功），把新的 revision 号告诉我。
```

**为什么要强调"向 Chrona 确认"**：Actions 成功只代表流水线跑完，真正的证据是线上版本号变化。让 Claude 去查这个，你才知道是真上线了。

## 3. 只给人看效果，不上线

```
我要把当前分支的效果发给别人看，但绝对不能影响线上游戏。

按 README 的 "Automatic release from GitHub (CI)" 一节，在本地用
CHRONA_SUBMIT_STOP_AT=preview 跑 .github/chrona-release.mjs，把预览链接给我。

不要 push main，也不要用 gh workflow run 在我的分支上触发 chrona-release。
```

最后那句是**必须**保留的——在非 main 分支触发那个 workflow 会把你的分支直接发到线上，而且下次任何人推 main 时你的改动会被静默回滚。

## 4. 改原始城市本身

游戏主体是一个 24 MB 的单文件 HTML，被切成 49 片存在 `source/part-*.txt`。改它有额外规则：

```
我要改原始城市本身（source/part-*.txt）里的：<具体内容>

按 CLAUDE.md 的规则处理哈希清单，构建通过后在浏览器里验证，再提交。

如果构建报 "patch target changed"，先把是哪个补丁、你打算怎么改告诉我，
不要自己跳过检查或注释掉校验。
```

## 5. 上线后发现线上没变 / 发布失败

```
我刚才推了 main，但线上好像没更新。

看 GitHub Actions 最近一次 Chrona release 的日志，判断卡在哪一步
（checkout / diff / push / build / preview / submit / review / merge / publish），
把结论和日志证据告诉我。

如果日志显示 merge 成功但 publish 失败，说明 Chrona main 已经推进但线上没更新，
直接告诉我，这种情况需要有发布权限的人手动处理。
```

## 6. 线上出问题要回滚

你没有 Chrona 的发布权限，回滚要找 ppeng。但可以让 Claude 先把信息整理好：

```
线上游戏出问题了。帮我查清楚：
1. 线上当前是哪个 revision、对应哪个 Chrona commit、什么时候发布的
2. 上一个正常的 revision 是哪个
3. 最近几次 Chrona release 的 Actions 记录，对应哪些 GitHub 提交

整理成一段可以直接发给别人的说明，让他执行回滚。
```

Chrona 保留完整版本历史，`chrona.mjs restore --commit <sha>` 几分钟能恢复到任意历史版本。

## 7. Claude 说它没有推送权限

如果 Claude 报 `not in this session's authorized repository set`、或说"只有匿名读取权限"、"git 代理拒绝注入凭据"——**这不是 GitHub 权限问题**（你在这个仓库是 `admin`，什么都能做），是 claude.ai 云端会话没绑定你的 GitHub 账号。

两个解法：

1. **在本机终端跑 Claude Code**，用你自己的 SSH key 或 `gh auth login`，最省事；
2. 或者去 claude.ai → Settings → Claude Code 连接 GitHub，授权账号选 **`brucehuang1`**，然后**新开一个会话**——旧会话的授权范围在创建时就定死了，不会自动扩展。

应急：让 Claude 跑 `git format-patch main --stdout` 把改动导成补丁贴给你，在本机 `git am` 之后自己推。

---

## 写 prompt 的三个习惯

1. **要求验证，而不是要求完成。** 说"在浏览器里打开确认效果"，比说"改好告诉我"可靠得多。CLAUDE.md 里已经写了"构建成功不算验证"，但你在 prompt 里再说一次更保险。
2. **明确说要不要上线。** 不说 = 不上线。要上线就说"我要让这个改动上线"。
3. **报错先问再改。** 这个项目有一批预期报错，也有精确字符串匹配的构建校验。让 Claude 遇到异常先解释再动手，别让它"顺手修好"。

## 手动命令备查

极少数时候你想自己敲（Claude 也会用这些）：

```bash
npm run build:local                                  # → dist-local/，本地开发版
python3 -m http.server 8790 --directory dist-local   # 打开 http://localhost:8790
npm run build                                        # → dist/，Chrona 托管版（本地打开必白屏，正常）
node build-hosted.mjs --accept-source-update         # 改过 source/ 之后刷新哈希清单
```

没有 `npm install`——这个项目零依赖，构建只用 Node 内置模块（Node ≥ 20）。

## 速查

| | |
|---|---|
| 仓库 | https://github.com/Alterverse-tech/city-in-ink （私有） |
| 线上游戏 | https://chrona.world/play/e9ef2f62-a6e0-47f2-8795-c2941cbc433a/ （需登录） |
| CI | https://github.com/Alterverse-tech/city-in-ink/actions |
| 你的权限 | GitHub `admin`（可直接推 main）；Chrona 无权限（不能发布/回滚） |
| 上线延迟 | push 到 main 后约 30 秒 |
| 发布凭据到期 | 2026-12-08（CI 会提前 14 天警告，到期后由 ppeng 重新签发） |
