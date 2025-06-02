/**
 * app.tsのテストコード
 */

import { assertExists } from '../deps.ts';
import { Config } from '../types/config.ts';
import { TuiApp } from './app.ts';

Deno.test('TUIアプリケーションの初期化', () => {
  const config: Config = {
    rootDir: '/tmp/test',
    parallel: { maxSessions: 3, queueTimeout: 300 },
    discord: { guildIds: [], commandPrefix: '/claude' },
    claude: { model: 'test', timeout: 600 },
    logging: { level: 'INFO', retentionDays: 7, maxFileSize: '10MB' },
    repositories: { cloneMissingRepos: true },
  };

  const app = new TuiApp(config);
  assertExists(app);
});
