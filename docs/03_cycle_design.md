---
title: 03 サイクル設計：工程表・タスクファイル・検証ゲート
date: 2026-11-10
description: 01の原則と02の実行基盤をもとに、プロンプトを最小にして構造的なルールで作業を回す仕組みを設計する
tag.opinion: 提案 | 筆者（Claude）の設計案。まだ実装・測定していない
---

# 03 サイクル設計

> [!TIP] このページのポイント
> - 判断の大半を**決まった工程（スクリプト）**に持たせます。LLMの仕事は「1つの小さなタスクを、決まった形式で返す」ことだけです
> - 工程の合否は**機械で判定**します（テスト、lint、スキーマ、引用の照合）。LLMに「できましたか？」とは聞きません
> - モデルは**段階（tier）**で使い分けます：スクリプト → ローカルLLM → Codex / Claude → 人。失敗したときだけ上の段に上げます
> - 工程ごとに**必要な権限だけ**を渡すので、安全の原則（3つを同時に持たせない）も構造で守れます

{{opinion}} このページはすべて設計案です。実装も測定もまだしていません。

## 1. 全体の形

```
           ┌────────────── 人（最初の目標と、最後の承認）
           ▼
  PLAN ─▶ tasks/*.json ─▶ ┌─ CONTEXT ─▶ ACT ─▶ CHECK ─┐ ─▶ DONE ─▶ 人のレビュー
 （大きいモデル、1回）      │  スクリプト   LLM    スクリプト │
                           └──── 不合格：エラーだけ渡して再試行 ┘
                                  上限超え：上の段のモデルへ
                                  最上段も失敗：BLOCKED（人へ）
```

Agentlessの「場所の特定 → 修正 → 検証」という固定の3段階[^r1]と、Anthropicのいう「あらかじめ決めたコードの経路」のワークフロー[^r2]を、ここでの基本の形にします。

## 2. タスクファイル：LLMに渡す「仕事の単位」

1つのタスクは、1つの小さなJSONファイルです。**プロンプトの代わりに、このファイルの項目がLLMの仕事を決めます。**

```json
{
  "id": "T-0042",
  "goal": "parse_date() が ISO 8601 の週番号形式を受け付けるようにする",
  "inputs": ["src/date.py", "tests/test_date.py"],
  "writable": ["src/date.py"],
  "check": "pytest tests/test_date.py -q",
  "tier": 1,
  "max_attempts": 3,
  "status": "todo"
}
```

| 項目 | 役割 | 構造で守るもの |
|---|---|---|
| `goal` | 1〜2文の目的 | プロンプトが長くならない |
| `inputs` | LLMに見せるファイル（スクリプトが集める） | コンテキストを最小にする。LLMにファイル探しをさせない |
| `writable` | 書き換えてよいファイル | これ以外の変更は、CHECKの前に機械的に**却下** |
| `check` | 合否を決めるコマンド | 合否をLLMの自己申告にしない |
| `tier` | 最初に使うモデルの段 | 安いモデルから試す |
| `max_attempts` | 再試行の上限 | 無限ループとトークンの浪費を防ぐ |
| `status` | `todo` → `doing` → `done` / `blocked` | 進み具合をファイルで管理し、会話の記憶に頼らない |

## 3. 各工程

### 3.1 PLAN（1回だけ、大きいモデル）

- 人が書いた目標から、タスクファイルの配列を作らせます。
- 出力は `--json-schema`（Claude Code）や `--output-schema`（Codex）で**タスクファイルの形式に縛ります**。[^r3][^r4]
- 大きいモデルを使うのはここが中心です。考える量の多い仕事を1回にまとめ、あとは小さな仕事に分けます。

### 3.2 CONTEXT（スクリプト。LLMを使わない）

- `inputs` のファイルを読み、決まった順で並べます。
- 再試行のときは、**前回のCHECKのエラー出力だけ**を末尾に足します。前回の会話全体は渡しません。
- 長いコンテキストの真ん中は使われにくいので[^r5]、目的を最初、エラーを最後に置きます。

### 3.3 ACT（LLM。1回の呼び出し）

- 固定の短いテンプレート＋CONTEXTの結果だけを渡します。
- 出力は「ファイルごとの新しい内容」か「差分」を、スキーマで縛ります。ローカルLLMにはstructured outputsを使います。[^r6]
- LLMにはコマンドを実行させません。**ファイルの書き換えはスクリプトが行い**、その前に `writable` 以外への変更を捨てます。

### 3.4 CHECK（スクリプト。LLMを使わない）

- `check` のコマンドを、サンドボックスの中で実行します。
- 終了コード0なら合格です。合格したら、スクリプトが作業ブランチにcommitします（pushはしません）。

### 3.5 失敗したとき

| 状況 | 動き |
|---|---|
| 不合格で、試行回数が上限未満 | エラー出力だけを足して、同じ段で再試行 |
| 同じエラーが2回続いた | 進んでいないと判断して、上の段のモデルへ |
| 上限に達した | 上の段のモデルへ |
| 最上段も失敗 | `blocked` にして、人に回す |

## 4. モデルの段（tier）

| 段 | 担当 | 向いている仕事 |
|---|---|---|
| 0 | スクリプト（LLMなし） | ファイル集め、テスト、lint、スキーマ検証、引用の照合、commit |
| 1 | ローカルLLM（Ollama） | 分類、要約、抽出、形式変換、小さく範囲の決まった修正、commitメッセージ |
| 2 | Codex / Claude Code（`exec` / `-p --bare`） | 複数ファイルにまたがる修正、tier 1で失敗したタスク |
| 3 | 人 | `blocked` のタスク、PLANの承認、mainへのマージ |

ローカルLLMをClaude Codeの中身として使うのではなく、**tier 1の決まった仕事に直接HTTPで頼む**のは、[02](?doc=02_macos_runtime.md) で見た理由（長いシステムプロンプトと多くのツールが、小さなモデルには重い）からです。

## 5. 情報収集のサイクル

このディレクトリの親（WASI・WALIの調査）で実際にやった手順は、そのままこの形に当てはまります。

| 工程 | 担当 | 親の調査での実例 |
|---|---|---|
| 取得 | tier 0（curl） | 一次資料のHTML・PDFをキャッシュに保存 |
| 抽出 | tier 1 | ページから「主張」と「英文の引用」をJSONで抜き出す |
| 照合 | tier 0 | 引用が原文に**そのまま**あるかを機械で確認（親の調査で使った照合スクリプトと同じ考え方） |
| 執筆 | tier 2 | 照合済みの主張だけを使ってmdを書く |
| 検査 | tier 0 | `viewer/lint.js` で、未定義・未使用の出典を検出 |

親の調査では、照合の工程で**Fableの誤り（rrの記録は別のマシンに持ち出せない、という主張）**や、引用の大文字・小文字の違いを見つけられました。LLMの自己チェックではなく、**機械の照合**が効いた例です。

## 6. 安全：工程ごとに権限を分ける

| 工程 | 信頼できない入力 | 秘密 | 外への送信・状態変更 |
|---|---|---|---|
| 取得（情報収集） | ある | なし | なし（キャッシュに書くだけ） |
| 抽出・執筆 | ある（取得した内容） | なし | なし（mdに書くだけ） |
| ACT（開発） | 少ない（リポジトリ内のファイル） | なし | `writable` のファイルだけ |
| CHECK | — | なし | サンドボックス内でテストを実行するだけ |
| push・公開 | — | トークン | **人が行う** |

どの工程も、lethal trifectaの3つ（秘密、信頼できない入力、外部送信）を同時には持ちません。[^r7] これは各工程の権限を構造で決めているからで、プロンプトで頼んでいるからではありません。

## 7. 次にやること

1. 工程を動かすスクリプト（runner）を書く。言語は未定（MacとLinuxの両方で動くもの）。
2. まずtier 0とtier 1だけで、情報収集のサイクルを1本通す。
3. 測るもの：タスクあたりのトークン数、tierごとの合格率、`blocked` になる割合。
4. 測った結果で、テンプレートの長さとtierの振り分けを調整する。

## 出典

[^r1]: C. S. Xia, Y. Deng, S. Dunn, L. Zhang. "Agentless: Demystifying LLM-based Software Engineering Agents." arXiv:2407.01489, 2024. <https://arxiv.org/abs/2407.01489>
[^r2]: Anthropic. "Building effective agents." 2024-12-19. <https://www.anthropic.com/engineering/building-effective-agents>
[^r3]: Claude Code Docs. "Run Claude Code programmatically." <https://code.claude.com/docs/en/headless>
[^r4]: OpenAI. "Non-interactive mode." Codex docs. <https://learn.chatgpt.com/docs/non-interactive-mode.md>
[^r5]: N. F. Liu ほか. "Lost in the Middle: How Language Models Use Long Contexts." TACL, 2023. <https://arxiv.org/abs/2307.03172>
[^r6]: Ollama. "Structured outputs." 2024-12-06. <https://ollama.com/blog/structured-outputs>
[^r7]: S. Willison. "The lethal trifecta for AI agents: private data, untrusted content, and external communication." 2025-06-16. <https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/>
