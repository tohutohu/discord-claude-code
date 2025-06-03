// セッションテーブルコンポーネント（ink版）
import { Box, React, Text, useInput } from '../deps.ts';

/**
 * セッション情報
 */
export interface SessionInfo {
  id: string;
  threadId: string;
  repository: string;
  status: '🟢 Run' | '⏸️ Wait' | '❌ Err' | '✅ Done';
  uptime: string;
}

/**
 * セッションテーブルコンポーネント
 */
export const SessionTable: React.FC = () => {
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  // デモ用のセッションデータ
  const sessions: SessionInfo[] = [
    {
      id: '1',
      threadId: '123..7890',
      repository: 'core-api',
      status: '🟢 Run',
      uptime: '00:12:34',
    },
    {
      id: '2',
      threadId: '987..3210',
      repository: 'web-admin',
      status: '⏸️ Wait',
      uptime: '00:03:10',
    },
    {
      id: '3',
      threadId: '456..1234',
      repository: 'auth-svc',
      status: '❌ Err',
      uptime: '00:45:23',
    },
  ];

  // キーボード入力のハンドリング
  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev: number) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev: number) => Math.min(sessions.length - 1, prev + 1));
    }
  });

  return (
    <Box flexDirection='column' paddingX={1}>
      <Text bold color='cyan'>
        📋 アクティブセッション
      </Text>
      <Box marginTop={1}>
        <Text dimColor>
          ID Thread Repository Status Uptime
        </Text>
      </Box>
      {sessions.map((session, index) => (
        <Box key={session.id} marginTop={0}>
          {selectedIndex === index
            ? (
              <Text color='cyan' backgroundColor='#1a1a1a'>
                {session.id.padEnd(9)}
                {session.threadId.padEnd(9)}
                {session.repository.padEnd(13)}
                {session.status.padEnd(9)}
                {session.uptime}
              </Text>
            )
            : (
              <Text>
                {session.id.padEnd(9)}
                {session.threadId.padEnd(9)}
                {session.repository.padEnd(13)}
                {session.status.padEnd(9)}
                {session.uptime}
              </Text>
            )}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>
          アクティブ:{' '}
          {sessions.filter((s) => s.status === '🟢 Run' || s.status === '⏸️ Wait').length} / 合計:
          {' '}
          {sessions.length}
        </Text>
      </Box>
    </Box>
  );
};
