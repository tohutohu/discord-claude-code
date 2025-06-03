// ヘルプバーコンポーネント（ink版）
import { Box, React, Text, useInput } from '../deps.ts';

/**
 * ヘルプバーコンポーネント
 */
export const HelpBar: React.FC = () => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  // キーボード入力のハンドリング
  useInput((input) => {
    if (input === '?') {
      setIsExpanded(!isExpanded);
    }
  });

  if (isExpanded) {
    return (
      <Box flexDirection='column' paddingX={1}>
        <Text bold color='yellow'>
          ⌨️ キーボードショートカット
        </Text>
        <Box flexDirection='column' marginTop={1}>
          <Text>q: 終了 ↑/↓: セッション選択 Enter: セッション詳細</Text>
          <Text>l: ログレベル切替 f: フィルタ /: 検索 ?: ヘルプを閉じる</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box paddingX={1}>
      <Text color='yellow'>
        q: 終了 ↑/↓: 移動 l: ログレベル ?: ヘルプ
      </Text>
    </Box>
  );
};
