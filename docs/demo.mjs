import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.API_URL ?? 'http://127.0.0.1:3008';
const steps = [];

async function call(label, method, path, body, expected = 200) {
  const response = await fetch(base + path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  });
  const result = await response.json();
  steps.push({ label, request: { method, path, ...(body === undefined ? {} : { body }) }, status: response.status, response: result });
  assert.equal(response.status, expected, label);
  console.log(`${response.status} ${label}`);
  return result;
}

const campaign = await call('Campanha exige vídeo e legenda', 'POST', '/campaigns', { requiredPieces: ['video', 'caption'] }, 201);
const delivery = await call('Entrega em produção', 'POST', '/deliveries', { campaignId: campaign.id }, 201);
const path = `/deliveries/${delivery.id}`;
const blocked = await call('Aprovação bloqueada pelas peças ausentes', 'POST', `${path}/approve`, undefined, 409);
assert.equal(blocked.error.details.blockers.length, 2);
const first = await call('Vídeo versão 1', 'POST', `${path}/pieces/video/versions`, {
  asset: { type: 'file', value: 'video-v1.mp4' }, durationSeconds: 30
}, 201);
await call('Comentário no segundo 12.5 da versão 1', 'POST', `${path}/pieces/video/versions/${first.id}/comments`, { second: 12.5, body: 'Trocar o enquadramento desta cena.' }, 201);
await call('Aprovar versão 1 do vídeo', 'POST', `${path}/pieces/video/versions/${first.id}/approve`);
const caption = await call('Legenda versão 1', 'POST', `${path}/pieces/caption/versions`, { asset: { type: 'text', value: 'Legenda solicitada pela campanha.' } }, 201);
await call('Aprovar legenda', 'POST', `${path}/pieces/caption/versions/${caption.id}/approve`);
assert.equal((await call('Entrega aprovada', 'POST', `${path}/approve`)).status, 'approved');
const second = await call('Vídeo versão 2 substitui a primeira', 'POST', `${path}/pieces/video/versions`, {
  asset: { type: 'url', value: 'https://example.com/video-v2.mp4' }, durationSeconds: 15
}, 201);
assert.equal((await call('Aprovação suspensa automaticamente', 'GET', path)).status, 'production');
await call('Aprovação antiga não aprova a versão atual', 'POST', `${path}/pieces/video/versions/${first.id}/approve`, undefined, 409);
assert.equal((await call('Comentário permanece na versão 1', 'GET', `${path}/pieces/video/versions/${first.id}`)).comments.length, 1);
assert.equal((await call('Versão 2 não herda comentários', 'GET', `${path}/pieces/video/versions/${second.id}`)).comments.length, 0);
await call('Aprovar versão 2', 'POST', `${path}/pieces/video/versions/${second.id}/approve`);
const final = await call('Aprovação restaurada e histórico preservado', 'GET', path);
assert.equal(final.status, 'approved');
assert.equal(final.pieces.video.length, 2);

const output = new URL('./evidence/http-flow.json', import.meta.url);
await mkdir(new URL('./evidence/', import.meta.url), { recursive: true });
await writeFile(output, JSON.stringify({ executedAt: new Date().toISOString(), runtime: process.version, base, deliveryUrl: base + path, passed: true, steps }, null, 2) + '\n');
console.log(`Evidência real: ${fileURLToPath(output)}`);
console.log(`Entrega: ${base + path}`);
