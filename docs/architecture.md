# Claude Bot アーキテクチャ概要

## 🏗️ システム全体図

```mermaid
graph TB
    subgraph "Discord"
        D[Discord Bot]
        U[Users]
    end
    
    subgraph "Claude Bot Core"
        CLI[CLI Interface]
        TUI[TUI Dashboard]
        SM[Session Manager]
        PC[Parallel Controller]
        CR[Claude Runner]
        DM[DevContainer Manager]
    end
    
    subgraph "Storage & Config"
        FS[File System]
        CONF[Config Files]
        LOGS[Log Files]
    end
    
    subgraph "External Services"
        CLAUDE[Claude API]
        DOCKER[Docker Engine]
        GIT[Git Repositories]
    end
    
    subgraph "Monitoring"
        MON[Monitoring System]
        HC[Health Check]
        PROM[Prometheus Metrics]
    end
    
    U --> D
    D --> CLI
    CLI --> TUI
    CLI --> SM
    SM --> PC
    PC --> CR
    CR --> DM
    DM --> DOCKER
    CR --> CLAUDE
    SM --> FS
    CLI --> CONF
    MON --> LOGS
    HC --> PROM
    
    classDef discord fill:#5865F2,stroke:#fff,color:#fff
    classDef core fill:#00D4AA,stroke:#fff,color:#fff
    classDef external fill:#FF6B6B,stroke:#fff,color:#fff
    classDef storage fill:#4ECDC4,stroke:#fff,color:#fff
    classDef monitoring fill:#45B7D1,stroke:#fff,color:#fff
    
    class D,U discord
    class CLI,TUI,SM,PC,CR,DM core
    class CLAUDE,DOCKER,GIT external
    class FS,CONF,LOGS storage
    class MON,HC,PROM monitoring
```

## 🔄 セッションライフサイクル

```mermaid
stateDiagram-v2
    [*] --> INITIALIZING : /claude start
    INITIALIZING --> STARTING : Repository ready
    INITIALIZING --> ERROR : Clone failed
    STARTING --> READY : Container started
    STARTING --> ERROR : Container failed
    READY --> RUNNING : Execution begins
    READY --> WAITING : Queue full
    WAITING --> RUNNING : Queue available
    RUNNING --> COMPLETED : Success
    RUNNING --> ERROR : Execution failed
    RUNNING --> CANCELLED : User cancelled
    ERROR --> READY : Retry
    ERROR --> CANCELLED : Give up
    COMPLETED --> [*]
    CANCELLED --> [*]
```

## 🧩 コンポーネント詳細

### 1. Discord インターフェース

- **役割**: ユーザーとの対話窓口
- **技術**: Discordeno ライブラリ
- **機能**:
  - Slash コマンド処理
  - リアルタイム状態更新
  - インタラクティブUI（ボタン・モーダル）

### 2. セッション管理 (SessionManager)

- **役割**: セッションのライフサイクル管理
- **技術**: TypeScript、JSON永続化
- **機能**:
  - セッション作成・更新・削除
  - 状態遷移管理
  - イベント発火

### 3. 並列制御 (ParallelController)

- **役割**: 同時実行制限とキューイング
- **技術**: Semaphore パターン
- **機能**:
  - 最大同時実行数制御
  - 優先度付きキュー
  - デッドロック検出

### 4. Claude Runner

- **役割**: Claude Code CLI のラッパー
- **技術**: プロセス実行、ストリーミング
- **機能**:
  - 継続・プロンプトモード対応
  - 出力解析（diff、ファイル変更検出）
  - プロンプトテンプレート

### 5. DevContainer 管理

- **役割**: 隔離された実行環境の提供
- **技術**: devcontainer CLI、Docker
- **機能**:
  - コンテナライフサイクル管理
  - ヘルスチェック
  - リソース制限

## 🔧 データフロー

### セッション作成フロー

```mermaid
sequenceDiagram
    participant U as User
    participant D as Discord
    participant SM as SessionManager
    participant PC as ParallelController
    participant RS as RepoScanner
    participant WM as WorktreeManager
    
    U->>D: /claude start repo:test-app
    D->>SM: createSession()
    SM->>RS: ensureRepo()
    RS->>WM: createWorktree()
    WM-->>RS: worktree path
    RS-->>SM: repository ready
    SM->>PC: requestExecution()
    PC-->>SM: queued/started
    SM->>D: session created
    D->>U: Session started 🚀
```

### Claude実行フロー

```mermaid
sequenceDiagram
    participant PC as ParallelController
    participant CR as ClaudeRunner
    participant DM as DevContainer
    participant C as Claude API
    participant D as Discord
    
    PC->>CR: run(prompt)
    CR->>DM: up()
    DM-->>CR: container ready
    CR->>DM: exec(claude command)
    DM->>C: API request
    C-->>DM: response
    DM-->>CR: output
    CR->>CR: parseOutput()
    CR-->>PC: result
    PC->>D: updateMessage()
```

## 🗄️ データ構造

### セッションデータ

```typescript
interface SessionData {
  id: string; // 一意識別子
  threadId: string; // Discord thread ID
  repository: string; // リポジトリ名
  branch?: string; // ブランチ名
  worktreePath?: string; // worktree パス
  containerId?: string; // container ID
  state: SessionState; // 現在の状態
  metadata: {
    userId: string; // Discord user ID
    guildId: string; // Discord guild ID
    createdAt: Date; // 作成時刻
    updatedAt: Date; // 更新時刻
    priority?: number; // 優先度
  };
}
```

### 設定ファイル構造

```yaml
rootDir: ~/claude-work/repos
parallel:
  maxSessions: 3
  queueTimeout: 300
discord:
  guildIds: []
  commandPrefix: /claude
claude:
  model: claude-opus-4-20250514
  timeout: 600
logging:
  level: INFO
  retentionDays: 7
  maxFileSize: 10MB
```

## 🔒 セキュリティアーキテクチャ

### 暗号化レイヤー

```mermaid
graph LR
    subgraph "データ保護"
        API[API Keys] --> ENC[AES-GCM暗号化]
        CONF[Config Files] --> MASK[センシティブ情報マスキング]
        LOGS[Log Output] --> MASK
    end
    
    subgraph "アクセス制御"
        USER[User Input] --> SANITIZE[入力サニタイゼーション]
        DISC[Discord API] --> RATELIMIT[Rate Limiting]
        EXEC[Code Execution] --> SANDBOX[DevContainer サンドボックス]
    end
```

### 認証・認可フロー

```mermaid
sequenceDiagram
    participant U as User
    participant D as Discord
    participant SEC as SecurityManager
    participant RL as RateLimiter
    participant SM as SessionManager
    
    U->>D: Discord command
    D->>SEC: checkPermissions()
    SEC->>RL: checkRateLimit(userId)
    RL-->>SEC: allowed/denied
    SEC-->>D: authorized
    D->>SM: createSession()
    SM->>SEC: sanitizeInput()
    SEC-->>SM: safe input
```

## 🚀 デプロイメント

### コンテナ化アーキテクチャ

```mermaid
graph TB
    subgraph "Production Environment"
        LB[Load Balancer]
        
        subgraph "Claude Bot Cluster"
            CB1[Claude Bot 1]
            CB2[Claude Bot 2]
            CB3[Claude Bot 3]
        end
        
        subgraph "Shared Services"
            REDIS[Redis Cache]
            PROM[Prometheus]
            GRAF[Grafana]
        end
        
        subgraph "Storage"
            LOGS[Log Storage]
            CONFIG[Config Storage]
            REPO[Repository Cache]
        end
    end
    
    LB --> CB1
    LB --> CB2  
    LB --> CB3
    CB1 --> REDIS
    CB2 --> REDIS
    CB3 --> REDIS
    CB1 --> LOGS
    CB2 --> LOGS
    CB3 --> LOGS
    PROM --> GRAF
```

### Kubernetes マニフェスト例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: claude-bot
spec:
  replicas: 3
  selector:
    matchLabels:
      app: claude-bot
  template:
    metadata:
      labels:
        app: claude-bot
    spec:
      containers:
        - name: claude-bot
          image: claude-bot:latest
          ports:
            - containerPort: 3000
          env:
            - name: ANTHROPIC_API_KEY
              valueFrom:
                secretKeyRef:
                  name: claude-secrets
                  key: api-key
          livenessProbe:
            httpGet:
              path: /health/liveness
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health/readiness
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
```

## 📊 監視・可観測性

### メトリクス階層

```mermaid
graph TD
    subgraph "Application Metrics"
        SESS[Sessions Created/Completed]
        EXEC[Execution Success Rate]
        QUEUE[Queue Length/Wait Time]
        ERR[Error Rate by Type]
    end
    
    subgraph "Infrastructure Metrics"
        CPU[CPU Usage]
        MEM[Memory Usage]
        DISK[Disk I/O]
        NET[Network]
    end
    
    subgraph "Business Metrics"
        USER[Active Users]
        REPO[Repository Usage]
        COST[API Cost Tracking]
        PERF[Performance SLA]
    end
    
    SESS --> PROM[Prometheus]
    EXEC --> PROM
    QUEUE --> PROM
    ERR --> PROM
    CPU --> PROM
    MEM --> PROM
    DISK --> PROM
    NET --> PROM
    USER --> PROM
    REPO --> PROM
    COST --> PROM
    PERF --> PROM
    
    PROM --> GRAF[Grafana Dashboard]
    PROM --> ALERT[AlertManager]
```

## 🔄 スケーラビリティ戦略

### 水平スケーリング

- **ステートレス設計**: セッション状態は外部ストレージに保存
- **負荷分散**: Discord guild 単位での分散
- **キューイング**: Redis ベースの分散キュー

### 垂直スケーリング

- **リソース制限**: DevContainer のリソース制限
- **並列度調整**: 動的な maxSessions 調整
- **キャッシュ戦略**: Repository キャッシュとworktree再利用

## 🔧 運用・保守

### ログ管理

```mermaid
graph LR
    APP[Application] --> STRUCT[Structured Logs]
    STRUCT --> MASK[Sensitive Data Masking]
    MASK --> ROTATE[Log Rotation]
    ROTATE --> STORAGE[Centralized Storage]
    STORAGE --> SEARCH[Log Search/Analysis]
```

### バックアップ戦略

- **設定ファイル**: 定期的な設定バックアップ
- **セッション状態**: 永続化とスナップショット
- **リポジトリキャッシュ**: 増分バックアップ

### 災害復旧

- **RTO**: 5分以内の復旧
- **RPO**: 1分以内のデータ損失
- **冗長化**: マルチリージョン展開
