---
title: 02 MacBookでの実行基盤：3種類のエージェントと隔離
date: 2026-11-10
description: Claude Code、Codex、ローカルLLMをMacBookで動かすときの、隔離の仕組みとモデルの接続方法
tag.opinion: 考察 | 出典の事実をもとにした推論・整理（一次情報そのものではない）
---

# 02 MacBookでの実行基盤

> [!TIP] このページのポイント
> - macOSでは、Claude CodeもCodexも**Seatbelt**（OS標準のサンドボックス）でコマンドを隔離します。Linuxのような追加パッケージは要りません
> - ローカルLLMは**Ollama**経由にすると、Claude Code（Anthropic互換API）とCodex（組み込みの `ollama` プロバイダ）の両方から同じモデルを使えます
> - プロセス全体を閉じ込めたいときの選択肢は、sandbox runtime、Docker、Appleの `container`（macOS 26以降、コンテナ1つが軽量VM1つ）です
> - Linuxのmini PCで問題だった「dockerグループ＝root相当」は、Macでは形が違います（下の考察）

## 1. 3種類のエージェントの隔離の仕組み

| | Claude Code | Codex | ローカルLLM（Ollama） |
|---|---|---|---|
| コマンドの隔離（macOS） | Seatbelt[^r1] | Seatbelt（`sandbox-exec` にモードに応じたプロファイルを渡す）[^r2] | なし（モデルを提供するサーバー。コマンドは実行しない） |
| 追加パッケージ | 不要（macOSでは追加不要）[^r10] | — | — |
| 権限の段階 | permission mode（`default`、`acceptEdits`、`auto`、`dontAsk`、`bypassPermissions`など）[^r4] | sandbox mode（`read-only`、`workspace-write`、`danger-full-access`）× approval policy[^r2] | — |
| 非対話の実行 | `claude -p`（推奨は `--bare`）[^r5] | `codex exec`（デフォルトは読み取り専用のサンドボックス）[^r6] | HTTP API |
| 出力の形式指定 | `--json-schema`[^r5] | `--output-schema`[^r6] | structured outputs[^r7] |
| 指示ファイル | CLAUDE.md（AGENTS.mdも読める）[^r8] | AGENTS.md（合計32KiBまで）[^r9] | なし（呼ぶ側が渡す） |

### 1.1 Codexの書き込み保護

Codexの `workspace-write` では、書き込み可能な場所の中でも次のものが**読み取り専用**として保護されます。[^r2]

- `.git`（ポインタファイルの場合は、その先のGitディレクトリも）
- `.agents`、`.codex`、`.aws`（ディレクトリとして存在する場合）

Claude Code側の保護パス（`.claude` の設定、`.mcp.json`、`.git/hooks` など）は、[21](../?doc=21_agent_claude_code.md) を参照してください。

### 1.2 確認なしで動かすときの公式の注意

- Codexは `-a never` で確認を止められます。sandbox modeとは独立なので、**サンドボックスを保ったまま確認だけ止める**ことができます。[^r2]
- `danger-full-access`（または `--dangerously-bypass-approvals-and-sandbox`）は、サンドボックス自体を外します。Docker内などで外側に隔離を用意したときのためのものです。[^r2]
- Claude Codeの `--dangerously-skip-permissions` は、コンテナ・VM・sandbox runtimeの中で使うよう公式が指示しています。[^r10]

## 2. ローカルLLMをつなぐ

### 2.1 Ollamaを共通の窓口にする

- Ollamaは**Anthropic Messages APIのサブセット**をサポートしています。Claude Codeから使うには、`ANTHROPIC_BASE_URL=http://localhost:11434` と `ANTHROPIC_AUTH_TOKEN=ollama`（必須だが値は無視される）を設定します。[^r11]
- 対応モデルは、メッセージ、ストリーミング、関数呼び出しをサポートします。**tool choiceの制御、deferred tools、ホスト型のWeb検索は完全にはサポートされていません**。[^r11]
- Codexは `ollama` と `lmstudio` を組み込みのプロバイダとして予約しています。独自のプロバイダとして `base_url = "http://localhost:11434/v1"` を定義する例も公式にあります。[^r12]

{{opinion}}

> [!WARNING] 考察：Claude Codeをローカルモデルで動かすことの限界
> Claude Codeは多くのツールを持ち、システムプロンプトも長いエージェントです。小さなローカルモデルにそのまま載せると、[01](?doc=01_principles.md) で見た「長いコンテキスト」と「複雑な道具」の両方の問題を抱えます。ローカルLLMは**Claude Codeの中身として使うより、小さく決まった仕事（分類、要約、形式変換、チェック）を直接HTTPで頼む**ほうが向いていると考えます。この役割分担は [03](?doc=03_cycle_design.md) で設計します。

### 2.2 形式を縛る

- Ollamaのstructured outputsは、JSON Schemaで出力を制約します。公式は用途として、文書からのデータ抽出や、すべての応答の構造化を挙げ、「JSON modeより信頼性と一貫性が高い」としています。[^r7]
- llama.cppを直接使う場合は、GBNFの文法で出力を縛れます。[^r13]

## 3. プロセスごと閉じ込める選択肢（Mac）

| 方式 | 内容 | メモ |
|---|---|---|
| sandbox runtime（`srt`） | Claude Codeのプロセス全体をSeatbeltで包む。ベータ版[^r10] | macOSでは書き込み時に拒否を判定するので、セッション中に作られた入れ子のリポジトリも保護される[^r10] |
| Docker | dev container（デフォルト拒否のファイアウォール付き）[^r14] | Codexは、コンテナ内でサンドボックスが動かない場合、コンテナ自体で隔離したうえで `danger-full-access` を使うよう案内している[^r2] |
| Appleの `container` | LinuxコンテナをMac上の**軽量VM**として動かす。OCIイメージ互換。Apple silicon専用で、macOS 26をサポート[^r15] | コンテナごとにVMが分かれる |
| 専用VM | 最も強い分離[^r10] | — |

{{opinion}}

> [!NOTE] 考察：Macでの「dockerグループ問題」
> Linuxでは、dockerグループのユーザーはホストのrootに相当しました（[22](../?doc=22_agent_setup_plan.md)）。Macの場合、コンテナはLinux VMの中で動くので、`docker run -v /:/host` でホストのmacOSのrootを取る、という形にはなりません。それでも、**Dockerを操作できるエージェントは、自分を閉じ込めている箱の外側に手が届く**という構造は同じです。エージェントにDockerやcontainerのコマンドを使わせない、という原則は変えません。
> なお、MacでのDockerの内部構成は、今回は一次資料で確認していません。

## 4. このページで決めたこと

{{opinion}}

| 用途 | 使う仕組み |
|---|---|
| 日常の対話的な作業 | Claude Code（auto mode＋Seatbeltのサンドボックス）または Codex（`workspace-write`＋`on-request`） |
| 決まった工程の自動実行 | `claude --bare -p ... --json-schema` / `codex exec --output-schema`。どちらもサンドボックス内で |
| 小さな定型の仕事 | Ollamaに直接HTTPで頼む。structured outputsで形式を縛る |
| 寝ている間の放置運用 | 上をsandbox runtimeかコンテナの中で動かす |

## 出典

[^r1]: Claude Code Docs. "Configure the sandboxed Bash tool." <https://code.claude.com/docs/en/sandboxing>
[^r2]: OpenAI. "Agent approvals & security." Codex docs. <https://learn.chatgpt.com/docs/agent-approvals-security.md>
[^r4]: Claude Code Docs. "Choose a permission mode." <https://code.claude.com/docs/en/permission-modes>
[^r5]: Claude Code Docs. "Run Claude Code programmatically." <https://code.claude.com/docs/en/headless>
[^r6]: OpenAI. "Non-interactive mode." Codex docs. <https://learn.chatgpt.com/docs/non-interactive-mode.md>
[^r7]: Ollama. "Structured outputs." 2024-12-06. <https://ollama.com/blog/structured-outputs>
[^r8]: Claude Code Docs. "How Claude remembers your project." <https://code.claude.com/docs/en/memory>
[^r9]: OpenAI. "Custom instructions with AGENTS.md." Codex docs. <https://learn.chatgpt.com/docs/agent-configuration/agents-md.md>
[^r10]: Claude Code Docs. "Choose a sandbox environment." <https://code.claude.com/docs/en/sandbox-environments>
[^r11]: Ollama docs. "Anthropic compatibility." <https://github.com/ollama/ollama/blob/main/docs/api/anthropic-compatibility.mdx>
[^r12]: OpenAI. "Advanced Configuration." Codex docs. <https://learn.chatgpt.com/docs/config-file/config-advanced.md>
[^r13]: ggml-org/llama.cpp. "GBNF Guide." <https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md>
[^r14]: Claude Code Docs. "Development containers." <https://code.claude.com/docs/en/devcontainer>
[^r15]: apple/container README. <https://github.com/apple/container>
