---
title: 01 設計原則：プロンプトではなく構造で回す
date: 2026-11-10
description: skillや長いプロンプトに頼らず、構造的なルールでエージェントを回すという方針の根拠
tag.opinion: 考察 | 出典の事実をもとにした推論・整理（一次情報そのものではない）
tag.unproven: 実験結果 | ベンチマークや条件に依存する結果
---

# 01 設計原則：プロンプトではなく構造で回す

> [!TIP] このページのポイント
> - 「LLMに次の手を決めさせない」固定の工程（ワークフロー）は、複雑な自律エージェントより**安く、同等以上の成績**を出した例があります（Agentless）
> - LLMが使う**道具の形（インターフェース）**を変えるだけで、成績が大きく変わります（SWE-agent）
> - 長いコンテキストの**真ん中**にある情報は使われにくい、という測定結果があります。プロンプトとルールは短く保つべきです
> - 出力をJSON Schemaで**機械的に縛る**機能は、Claude Code、Codex、Ollama、llama.cppのすべてにあります。頭の弱いモデルでも、形式は守らせられます

## 1. 方針

この環境は、次の方針で作ります。{{opinion}}

1. **判断は工程（コード）に持たせ、LLMには小さな仕事だけを渡す**
2. **ルールは短く、1か所に**。skillや長い指示文を前提にしない
3. **出力は形式で縛り、機械で検証する**。読んで判断するのは最後の手段
4. **安全は境界で守る**。プロンプトで「〜しないで」と頼むことには頼らない

以下は、その根拠です。

## 2. 根拠

### 2.1 固定の工程は、自律エージェントに負けない

{{unproven:ベンチマーク結果}}

Agentless（2024）は、問題を **localization（場所の特定）→ repair（修正）→ patch validation（パッチの検証）** の3段階に固定し、LLMに次の行動を決めさせない方式です。[^r1]

> "Agentless employs a simplistic three-phase process of localization, repair, and patch validation, without letting the LLM decide future actions or operate with complex tools." [^r1]

- SWE-bench Liteで、当時のオープンソースのソフトウェアエージェントの中で最高の性能（32.00%、96件の正しい修正）を、低いコスト（$0.70）で達成しました。[^r1]
- 著者らは、複雑な自律エージェントが本当に必要なのか、という問いを立てています。[^r1]

Anthropicも、エージェントを作る際の指針として、同じ方向のことを書いています。[^r2]

> "When building applications with LLMs, we recommend finding the simplest solution possible, and only increasing complexity when needed." [^r2]

- **ワークフロー**は「あらかじめ決めたコードの経路でLLMとツールを動かす」もの、**エージェント**は「LLMが自分で手順とツールの使い方を決める」ものと区別しています。[^r2]
- ワークフローは、よく定義されたタスクで予測可能性と一貫性をもたらす、としています。[^r2]

### 2.2 道具の形が成績を決める

{{unproven:ベンチマーク結果}}

SWE-agent（2024）は、LMエージェントを「専用のインターフェースを必要とする新しい種類のユーザー」と捉えました。[^r3]

- エージェント向けに作ったインターフェース（ACI：Agent-Computer Interface）によって、ファイルの作成・編集、リポジトリの移動、テストの実行が大きく改善したと報告しています。[^r3]
- SWE-benchでpass@1 12.5%、HumanEvalFixで87.7%と、当時の最高性能でした。[^r3]

{{opinion}}

> [!NOTE] 考察：頭の弱いモデルには「プロンプト」より「道具」
> ローカルLLMに長い説明を読ませるより、**間違えにくい道具**（入力が少なく、結果が短く、失敗がはっきり分かるコマンド）を渡すほうが効く、というのがSWE-agentの示唆です。この環境では、エージェントが使うコマンドを少数の決まったスクリプトに絞ります。

### 2.3 長いコンテキストは使いこなせない

{{unproven:測定結果}}

Lost in the Middle（TACL）は、関連する情報が入力の**どこにあるか**で性能が大きく変わることを示しました。[^r4]

- 情報が入力の**最初か最後**にあると性能が高く、**真ん中**にあると大きく下がります。[^r4]
- 長いコンテキストを売りにするモデルでも同じ傾向でした。[^r4]

Claude Codeの公式ドキュメントも、CLAUDE.mdは1ファイル200行未満を目安にし、長いほどコンテキストを消費して**指示が守られにくくなる**、と書いています。[^r5]

### 2.4 形式は機械で縛れる

ここが「頭の弱いモデルでも使える」ための鍵です。主要なツールは、どれも出力をJSON Schemaに合わせる機能を持っています。

| ツール | 機能 |
|---|---|
| Claude Code | `claude -p ... --output-format json --json-schema '<schema>'`[^r6] |
| Codex | `codex exec --output-schema ./schema.json`[^r7] |
| Ollama | JSON Schemaで出力の形式を制約するstructured outputs（2024-12-06〜）[^r8] |
| llama.cpp | GBNF（形式文法）で出力を制約。JSONを強制できる[^r9] |

- Claude Codeの `--bare` は、フック、skill、カスタムコマンド、サブエージェント、プラグイン、MCPサーバー、auto memory、CLAUDE.mdの自動読み込みを**すべて飛ばします**。公式は、スクリプトやSDKからの呼び出しにはこれを推奨しています。[^r6]

{{opinion}}

> [!IMPORTANT] 考察：「skillに頼らない」を実装すると `--bare` になる
> `--bare` で起動し、必要なルールと入力だけをコマンドラインで渡し、出力をスキーマで縛る。こうすると、**毎回同じ、最小のコンテキスト**でモデルを呼べます。ローカルの設定やskillの有無で挙動が変わらず、トークンも減ります。これを、この環境の基本の呼び出し方にします。

## 3. 安全の原則（前の調査から）

このディレクトリの外の調査ページ（[20 脅威モデル](../?doc=20_agent_threats.md)、[21 Claude Codeの安全装置](../?doc=21_agent_claude_code.md)）の結論を引き継ぎます。{{opinion}}

- **確認ダイアログではなく境界で守る**：ファイルとネットワークの両方を絞る。
- **秘密・信頼できない入力・外部送信の3つを、1つのエージェントに同時に持たせない**（lethal trifecta / Rule of Two）。
- **モデルの判断（分類器を含む）は最後の砦にしない**。

構造で回す設計は、安全にも効きます。工程が固定されていれば、各工程に**必要な権限だけ**を渡せるからです（[03](?doc=03_cycle_design.md)）。

## 出典

[^r1]: C. S. Xia, Y. Deng, S. Dunn, L. Zhang. "Agentless: Demystifying LLM-based Software Engineering Agents." arXiv:2407.01489, 2024. <https://arxiv.org/abs/2407.01489>
[^r2]: Anthropic. "Building effective agents." 2024-12-19. <https://www.anthropic.com/engineering/building-effective-agents>
[^r3]: J. Yang, C. E. Jimenez, A. Wettig, K. Lieret, S. Yao, K. Narasimhan, O. Press. "SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering." arXiv:2405.15793, 2024. <https://arxiv.org/abs/2405.15793>
[^r4]: N. F. Liu, K. Lin, J. Hewitt, A. Paranjape, M. Bevilacqua, F. Petroni, P. Liang. "Lost in the Middle: How Language Models Use Long Contexts." TACL, 2023（arXiv:2307.03172）. <https://arxiv.org/abs/2307.03172>
[^r5]: Claude Code Docs. "How Claude remembers your project." <https://code.claude.com/docs/en/memory>
[^r6]: Claude Code Docs. "Run Claude Code programmatically." <https://code.claude.com/docs/en/headless>
[^r7]: OpenAI. "Non-interactive mode." Codex docs. <https://learn.chatgpt.com/docs/non-interactive-mode.md>
[^r8]: Ollama. "Structured outputs." 2024-12-06. <https://ollama.com/blog/structured-outputs>
[^r9]: ggml-org/llama.cpp. "GBNF Guide." <https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md>
