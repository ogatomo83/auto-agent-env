# agent-env

Claude Code、Codex、ローカルLLMを、**確認で止まらず、安全に、少ないトークンで**動かすための環境の設計と実装。

## 方針

- **プロンプトではなく構造で回す**：判断は決まった工程（スクリプト）に持たせ、LLMには小さなタスクを1つずつ、決まった形式で返させる。
- **合否は機械で判定する**：テスト、lint、JSON Schema、引用の照合。
- **モデルは段で使い分ける**：スクリプト → ローカルLLM → Codex / Claude → 人。
- **安全は境界で守る**：サンドボックス・コンテナ。秘密・信頼できない入力・外部送信を1つの工程に同時に持たせない。
- **skillや長い指示に頼らない**：指示は `AGENTS.md` の1ファイルだけ（`CLAUDE.md` はそれを読み込むだけ）。

## 対象環境

MacBook（Apple silicon、macOS）。Linuxでも動くことを目標にする。

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/01_principles.md](docs/01_principles.md) | 設計原則と根拠（Agentless、SWE-agent、Lost in the Middle、structured outputs） |
| [docs/02_macos_runtime.md](docs/02_macos_runtime.md) | MacBookでの隔離とモデルの接続（Seatbelt、Ollama、Codex、Claude Code） |
| [docs/03_cycle_design.md](docs/03_cycle_design.md) | サイクルの設計（工程表、タスクファイル、検証ゲート、モデルの段） |

ブラウザで読む場合は、このディレクトリで `python3 -m http.server` を起動して `index.html` を開く。

## 状態

設計段階。実装はまだない。
