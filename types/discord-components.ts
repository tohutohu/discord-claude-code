// Discord コンポーネントの型定義
// Discord APIのコンポーネント構造を定義

/**
 * Discord のアクションロウ型
 */
export interface ActionRow {
  type: 1;
  components: unknown[];
}

/**
 * Discord のボタンコンポーネント型
 */
export interface ButtonComponent {
  type: 2;
  style: ButtonStyle;
  label: string;
  emoji?: {
    name: string;
    id?: string;
  };
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

/**
 * ボタンのスタイル
 */
export enum ButtonStyle {
  Primary = 1,
  Secondary = 2,
  Success = 3,
  Danger = 4,
  Link = 5,
}

/**
 * セレクトメニューコンポーネント型
 */
export interface SelectMenuComponent {
  type: 3;
  custom_id: string;
  options: SelectOption[];
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  disabled?: boolean;
}

/**
 * セレクトオプション型
 */
export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: {
    name: string;
    id?: string;
  };
  default?: boolean;
}

/**
 * Discord の Embed 型
 */
export interface DiscordEmbed {
  title?: string;
  type?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: {
    text: string;
    icon_url?: string;
    proxy_icon_url?: string;
  };
  image?: {
    url: string;
    proxy_url?: string;
    height?: number;
    width?: number;
  };
  thumbnail?: {
    url: string;
    proxy_url?: string;
    height?: number;
    width?: number;
  };
  video?: {
    url: string;
    proxy_url?: string;
    height?: number;
    width?: number;
  };
  provider?: {
    name?: string;
    url?: string;
  };
  author?: {
    name: string;
    url?: string;
    icon_url?: string;
    proxy_icon_url?: string;
  };
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
}

/**
 * Modal コンポーネント型
 */
export interface ModalComponent {
  title: string;
  custom_id: string;
  components: TextInputRow[];
}

/**
 * テキスト入力行型
 */
export interface TextInputRow {
  type: 1;
  components: TextInput[];
}

/**
 * テキスト入力コンポーネント型
 */
export interface TextInput {
  type: 4;
  custom_id: string;
  label: string;
  style: TextInputStyle;
  min_length?: number;
  max_length?: number;
  required?: boolean;
  value?: string;
  placeholder?: string;
}

/**
 * テキスト入力のスタイル
 */
export enum TextInputStyle {
  Short = 1,
  Paragraph = 2,
}

/**
 * インタラクションコンポーネントデータ型
 */
export interface ComponentRow {
  components: Array<{
    custom_id: string;
    value: string;
  }>;
}

/**
 * 設定オブジェクトの型
 */
export interface ConfigData {
  rootDir: string;
  parallel: {
    maxSessions: number;
    queueTimeout: number;
  };
  discord: {
    guildIds: string[];
    commandPrefix: string;
  };
  claude: {
    model: string;
    timeout: number;
  };
  logging: {
    level: string;
    retentionDays: number;
    maxFileSize: string;
  };
  repositories?: Record<string, string>;
}
