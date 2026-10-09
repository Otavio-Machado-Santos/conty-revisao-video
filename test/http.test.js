import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.js';

async function api(t) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + path, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  return { base, request };
}

test('fluxo HTTP: peças faltantes, aprovação, substituição e comentário na versão antiga', async t => {
  const { request } = await api(t);
  const campaign = await request('/campaigns', { requiredPieces: ['video', 'caption'] });
  assert.equal(campaign.status, 201);
  const delivery = (await request('/deliveries', { campaignId: campaign.data.id })).data;
  const path = `/deliveries/${delivery.id}`;
  const blocked = await request(`${path}/approve`, undefined, 'POST');
  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.data.error.details.blockers.map(item => item.piece), ['video', 'caption']);
  const first = (await request(`${path}/pieces/video/versions`, { asset: { type: 'file', value: 'v1.mp4' }, durationSeconds: 30 })).data;
  assert.equal((await request(`${path}/pieces/video/versions/${first.id}/comments`, { second: 12, body: 'Alterar cena.' })).status, 201);
  await request(`${path}/pieces/video/versions/${first.id}/approve`, undefined, 'POST');
  const caption = (await request(`${path}/pieces/caption/versions`, { asset: { type: 'text', value: 'Legenda exigida' } })).data;
  await request(`${path}/pieces/caption/versions/${caption.id}/approve`, undefined, 'POST');
  assert.equal((await request(`${path}/approve`, undefined, 'POST')).data.status, 'approved');
  const second = (await request(`${path}/pieces/video/versions`, { asset: { type: 'url', value: 'https://example.com/v2.mp4' }, durationSeconds: 15 })).data;
  const invalidated = await request(path);
  assert.equal(invalidated.data.status, 'production');
  assert.equal(invalidated.data.approvedAt, null);
  const stale = await request(`${path}/pieces/video/versions/${first.id}/approve`, undefined, 'POST');
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, 'stale_version');
  assert.equal((await request(`${path}/pieces/video/versions/${second.id}/comments`, { second: 16, body: 'Fora do vídeo.' })).status, 400);
  assert.equal((await request(`${path}/pieces/video/versions/${first.id}`)).data.comments.length, 1);
  assert.equal((await request(`${path}/pieces/video/versions/${second.id}`)).data.comments.length, 0);
  assert.equal((await request(`${path}/pieces/video/versions/${second.id}/approve`, undefined, 'POST')).status, 200);
  assert.equal((await request(path)).data.status, 'approved');
});

test('HTTP retorna erros úteis para JSON, tipo de conteúdo, rota e identificador inválidos', async t => {
  const { base, request } = await api(t);
  assert.deepEqual((await request('/health')).data, { status: 'ok' });
  assert.equal((await request('/deliveries/missing')).status, 404);
  assert.equal((await request('/campaigns/missing')).status, 404);
  assert.equal((await request('/unknown')).status, 404);
  assert.equal((await request('/deliveries/%ZZ')).status, 400);
  assert.equal((await request('/campaigns', { requiredPieces: ['video'] }, 'PUT')).status, 404);
  const malformed = await fetch(base + '/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'invalid_json');
  const media = await fetch(base + '/campaigns', { method: 'POST', body: '{}' });
  assert.equal(media.status, 415);
  assert.equal((await request('/campaigns', null)).status, 400);
});

test('HTTP limita corpo antes de criar campanha', async t => {
  const { base } = await api(t);
  const response = await fetch(base + '/campaigns', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requiredPieces: ['video'], ignored: 'x'.repeat(65_536) })
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'body_too_large');
});
