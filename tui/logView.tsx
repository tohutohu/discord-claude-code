// ログビューコンポーネント（ink版）
import { Box, React, Text, useInput } from '../deps.ts';
import { Config } from '../config.ts';

/**
 * ログエントリ
 */
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  sessionId?: string;
}

interface LogViewProps {
  logLevel: Config['logging']['level'];
}

/**
 * ログビューコンポーネント
 */
export const LogView: React.FC<LogViewProps> = ({ logLevel: initialLevel }: LogViewProps) => {
  const [currentLevel, setCurrentLevel] = React.useState(initialLevel);

  // デモ用のログデータ
  const logs: LogEntry[] = [
    {
      timestamp: '12:01:23',
      level: 'INFO',
      message: 'Clone core-api completed',
    },
    {
      timestamp: '12:02:45',
      level: 'INFO',
      message: 'Starting devcontainer...',
      sessionId: '123',
    },
    {
      timestamp: '12:03:12',
      level: 'DEBUG',
      message: 'Container ID: abc123def',
      sessionId: '123',
    },
    {
      timestamp: '12:03:15',
      level: 'INFO',
      message: 'Claude generating diff...',
      sessionId: '123',
    },
    {
      timestamp: '12:03:45',
      level: 'ERROR',
      message: 'Exit code 1: syntax error',
      sessionId: '456',
    },
  ];

  // キーボード入力のハンドリング
  useInput((input) => {
    if (input === 'l') {
      // ログレベルを循環切り替え
      const levels: Config['logging']['level'][] = [
        'TRACE',
        'DEBUG',
        'INFO',
        'WARN',
        'ERROR',
        'FATAL',
      ];
      const currentIndex = levels.indexOf(currentLevel);
      setCurrentLevel(levels[(currentIndex + 1) % levels.length] || 'INFO');
    }
  });

  // ログレベルの色を取得
  const getLevelColor = (level: string): string => {
    switch (level) {
      case 'TRACE':
        return 'gray';
      case 'DEBUG':
        return 'blue';
      case 'INFO':
        return 'green';
      case 'WARN':
        return 'yellow';
      case 'ERROR':
        return 'red';
      case 'FATAL':
        return 'magenta';
      default:
        return 'white';
    }
  };

  return (
    <Box flexDirection='column' paddingX={1}>
      <Box justifyContent='space-between'>
        <Text bold color='green'>
          📜 ログビュー
        </Text>
        <Text dimColor>
          レベル: {currentLevel} (L キーで切替)
        </Text>
      </Box>
      <Box flexDirection='column' marginTop={1}>
        {logs.map((log, index) => (
          <Box key={index}>
            <Text dimColor>{log.timestamp}</Text>
            <Text color={getLevelColor(log.level)}>[{log.level}]</Text>
            {log.sessionId && <Text dimColor>[{log.sessionId}]</Text>}
            <Text>{log.message}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
