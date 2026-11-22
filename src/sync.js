export function normalizeEndpoint(value) {
  const url = new URL(value);
  const local = ['127.0.0.1','localhost'].includes(url.hostname) && url.protocol === 'http:';
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('共有サーバーのURLを確認してください。');
  return url.origin;
}

export function readRoom() {
  if (!location.hash || location.hash === '#') return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const key = params.get('project');
  if (!/^[a-f0-9]{64}$/.test(key || '')) throw Error('編集リンクが不完全です。発行元からリンク全体をコピーしてください。');
  return { key, api: normalizeEndpoint(params.get('server')) };
}

export function newRoom(api) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return { api:normalizeEndpoint(api), key:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('') };
}

export function roomURL(room) {
  const url = new URL(location.href);
  url.hash = new URLSearchParams({project:room.key,server:room.api}).toString();
  return url.href;
}

export async function requestRoom(room, revision, model) {
  const url = new URL('/v1/project', room.api);
  const options = { headers:{ Authorization:'Bearer '+room.key }, cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer', redirect:'error', signal:AbortSignal.timeout(12000) };
  if (model) {
    options.method = 'PUT';
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify({expected:revision,model});
  } else url.searchParams.set('since', revision);
  const response = await fetch(url,options);
  if (response.status === 204) return null;
  if (response.status === 404) throw Error('共有モデルが見つかりません。リンクを確認してください。');
  if (!response.ok && response.status !== 409) throw Error('共有サーバーに接続できません（'+response.status+'）。');
  return { ...(await response.json()), conflict:response.status===409 };
}
