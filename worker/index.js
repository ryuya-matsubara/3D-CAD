import { DurableObject } from 'cloudflare:workers';
import { validate } from '../src/model.js';

export class Project extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, model TEXT NOT NULL)');
  }
  read(since) {
    const [row] = this.sql.exec('SELECT revision,model FROM project WHERE id=1').toArray();
    if (!row) return { status: 404 };
    if (row.revision === since) return { status: 204 };
    return { status: 200, revision: row.revision, model: JSON.parse(row.model) };
  }
  write(expected, model) {
    const [row] = this.sql.exec('SELECT revision FROM project WHERE id=1').toArray();
    const revision = row?.revision ?? 0;
    if (expected !== revision) return row ? { ...this.read(-1), status: 409 } : { status: 404 };
    this.sql.exec('INSERT OR REPLACE INTO project VALUES (1,?,?)', revision+1, JSON.stringify(model));
    return { status: 200, revision: revision+1, model };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (origin && origin !== env.APP_ORIGIN && !(local && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) return new Response(null,{status:403});
    const headers = { 'Access-Control-Allow-Origin': origin || env.APP_ORIGIN, 'Access-Control-Allow-Methods':'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers':'Authorization, Content-Type', 'Cache-Control':'no-store', 'Vary':'Origin' };
    const respond = (status, data) => data ? Response.json(data,{status,headers}) : new Response(null,{status,headers});
    if (url.pathname !== '/v1/project') return respond(404);
    if (request.method === 'OPTIONS') return respond(204);
    const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') || '')?.[1];
    if (!token) return respond(401);
    const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    const id = Array.from(new Uint8Array(hash), b=>b.toString(16).padStart(2,'0')).join('');
    const project = env.PROJECTS.getByName(id);
    let result;
    if (request.method === 'GET') result = await project.read(Number(url.searchParams.get('since') || -1));
    else if (request.method === 'PUT') {
      if (!request.headers.get('content-type')?.startsWith('application/json')) return respond(415);
      const reader = request.body?.getReader();
      if (!reader) return respond(400);
      const chunks = [];
      let size = 0;
      for (;;) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) { await reader.cancel(); return respond(413); }
        chunks.push(value);
      }
      let body;
      try {
        body = JSON.parse(await new Blob(chunks).text());
        if (!Number.isSafeInteger(body.expected) || body.expected < 0) return respond(400);
        validate(body.model);
      } catch { return respond(400); }
      result = await project.write(body.expected, body.model);
    } else return respond(405);
    return respond(result.status, result.model ? { revision:result.revision, model:result.model } : null);
  }
};
