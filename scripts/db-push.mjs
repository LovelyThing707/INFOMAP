/**
 * supabase/migrations/ をリモートへ適用する。
 *
 *   npm run db:push
 *
 * 経路は2つあり、使えるほうを自動で選ぶ。
 *
 *   1. link 済みなら `--linked`。データベースのパスワードは要らない。
 *      CLI が管理APIで一時的なログインロールを作って繋ぐため
 *      （実行すると "Initialising login role..." と出る）。
 *      事前に `npx supabase login` と
 *      `npx supabase link --project-ref <ref>` が済んでいること。
 *
 *   2. link できないときは .env.local の SUPABASE_DB_URL を使う。
 *      名前に EXPO_PUBLIC_ を付けないのは、付けると Expo が
 *      バンドルへ焼き込み、パスワードがアプリを配った相手に渡るため。
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const DB_SETTINGS_URL = 'https://supabase.com/dashboard/project/_/settings/database';

async function readEnvLocal() {
  try {
    return await readFile('.env.local', 'utf8');
  } catch {
    return '';
  }
}

async function isLinked() {
  try {
    const ref = await readFile('supabase/.temp/project-ref', 'utf8');
    return ref.trim().length > 0;
  } catch {
    return false;
  }
}

const raw = await readEnvLocal();
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (match) env[match[1]] = match[2].trim();
}

// バンドルへ焼き込まれる名前で置かれていたら、黙って使わずに止める
if (env.EXPO_PUBLIC_SUPABASE_DB_URL) {
  console.error(
    'EXPO_PUBLIC_SUPABASE_DB_URL という名前で置かれています。\n' +
      'EXPO_PUBLIC_ で始まる変数はアプリのバンドルに焼き込まれるので、\n' +
      'データベースのパスワードがアプリを配った相手に渡ります。\n' +
      'SUPABASE_DB_URL に名前を変えてください。'
  );
  process.exit(2);
}

const dbUrl = process.env.SUPABASE_DB_URL ?? env.SUPABASE_DB_URL;
const linked = await isLinked();

let args;
if (linked) {
  args = ['supabase', 'db', 'push', '--linked', '--yes'];
  console.log('link 済みのプロジェクトへ適用します（パスワード不要）。');
} else if (dbUrl) {
  if (dbUrl.includes('[YOUR-PASSWORD]')) {
    console.error('SUPABASE_DB_URL のパスワード部分が置き換えられていません。');
    process.exit(2);
  }
  if (/:6543\//.test(dbUrl)) {
    console.error(
      'ポート 6543 は transaction モードで、マイグレーションには使えません。\n' +
        'Session pooler（ポート 5432）の接続文字列に変えてください。'
    );
    process.exit(2);
  }
  console.log(`適用先: ${dbUrl.replace(/:\/\/([^:]+):[^@]*@/, '://$1:****@')}`);
  args = ['supabase', 'db', 'push', '--db-url', dbUrl, '--yes'];
} else {
  console.error(
    'どちらの経路も使えません。次のどちらかを済ませてください。\n\n' +
      '  A. link する（推奨。パスワードが要らない）\n' +
      '       npx supabase login\n' +
      '       npx supabase link --project-ref <ref>\n\n' +
      '  B. .env.local に接続文字列を置く\n' +
      `       取得元: ${DB_SETTINGS_URL}\n` +
      '       Session pooler（ポート 5432）のものを使う\n' +
      '       SUPABASE_DB_URL=postgresql://postgres.<ref>:<パスワード>@aws-N-<region>.pooler.supabase.com:5432/postgres\n'
  );
  process.exit(2);
}

const cli = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(cli, args, { stdio: 'inherit', shell: false });
child.on('exit', (code) => {
  if (code === 0) {
    console.log('\n適用できました。続けて権限を実測します: npm run verify:remote');
  }
  process.exitCode = code ?? 1;
});
