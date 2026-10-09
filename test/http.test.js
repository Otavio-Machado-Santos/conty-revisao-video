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

test('HTTP: opcional antes ou depois da aprovação dá o mesmo estado, inclusive após substituição', async t => {
  const { request } = await api(t);
  const campaign = (await request('/campaigns', { requiredPieces: ['video'] })).data;
  const states = [];
  for (const before of [true, false]) {
    const delivery = (await request('/deliveries', { campaignId: campaign.id })).data;
    const path = `/deliveries/${delivery.id}`;
    const addScript = () => request(`${path}/pieces/script/versions`, { asset: { type: 'text', value: 'Roteiro não contratado.' } });
    if (before) assert.equal((await addScript()).status, 201);
    const video = (await request(`${path}/pieces/video/versions`, {
      asset: { type: 'file', value: 'clip.mp4' }, durationSeconds: 30
    })).data;
    assert.equal((await request(`${path}/pieces/video/versions/${video.id}/approve`, undefined, 'POST')).status, 200);
    const approved = await request(`${path}/approve`, undefined, 'POST');
    assert.equal(approved.status, 200);
    assert.equal(approved.data.status, 'approved');
    if (!before) assert.equal((await addScript()).status, 201);
    const result = await request(path);
    assert.equal(result.status, 200);
    assert.equal(result.data.approvedAt, approved.data.approvedAt);
    assert.equal(result.data.history.filter(event => event.type === 'delivery_approval_invalidated').length, 0);
    const shape = state => ({
      requiredPieces: state.requiredPieces, status: state.status, canApprove: state.canApprove,
      blockers: state.blockers,
      pieces: Object.fromEntries(Object.entries(state.pieces).map(([piece, versions]) => [piece, versions.map(version => ({
        number: version.number, asset: version.asset, approved: version.approvedAt !== null,
        durationSeconds: version.durationSeconds, comments: version.comments
      }))]))
    });
    states.push(shape(result.data));
    const oldScript = result.data.currentVersionIds.script;
    assert.equal((await addScript()).status, 201);
    const replaced = (await request(path)).data;
    assert.equal(replaced.status, 'approved');
    assert.equal(replaced.canApprove, true);
    assert.deepEqual(replaced.blockers, []);
    assert.equal(replaced.approvedAt, approved.data.approvedAt);
    const stale = await request(`${path}/pieces/script/versions/${oldScript}/approve`, undefined, 'POST');
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error.code, 'stale_version');
    assert.equal((await request(`${path}/approve`, undefined, 'POST')).data.status, 'approved');
    assert.ok(replaced.pieces.script.every(version => version.approvedAt === null));
  }
  assert.deepEqual(states[0], states[1]);
  assert.equal(states[1].status, 'approved');
  assert.equal(states[1].canApprove, true);
});

test('HTTP: mudanças obrigatórias durante suspensão não passam a exigir opcionais nem migram comentários', async t => {
  const { request } = await api(t);
  const campaign = (await request('/campaigns', { requiredPieces: ['video', 'caption'] })).data;
  const delivery = (await request('/deliveries', { campaignId: campaign.id })).data;
  const path = `/deliveries/${delivery.id}`;
  const addVideo = durationSeconds => request(`${path}/pieces/video/versions`, {
    asset: { type: 'file', value: 'clip.mp4' }, durationSeconds
  });
  const addText = piece => request(`${path}/pieces/${piece}/versions`, { asset: { type: 'text', value: `Conteúdo ${piece}` } });
  const approve = (piece, id) => request(`${path}/pieces/${piece}/versions/${id}/approve`, undefined, 'POST');
  const firstVideo = (await addVideo(30)).data;
  const firstCaption = (await addText('caption')).data;
  assert.equal((await approve('video', firstVideo.id)).status, 200);
  assert.equal((await approve('caption', firstCaption.id)).status, 200);
  assert.equal((await request(`${path}/approve`, undefined, 'POST')).data.status, 'approved');
  const oldReplacement = (await addVideo(20)).data;
  const currentCaption = (await addText('caption')).data;
  assert.equal((await addText('cover')).status, 201);
  assert.equal((await addText('cover')).status, 201);
  const currentVideo = (await addVideo(10)).data;
  const blocked = await request(`${path}/approve`, undefined, 'POST');
  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.data.error.details.blockers, [
    { piece: 'video', reason: 'required_version_unapproved', versionId: currentVideo.id },
    { piece: 'caption', reason: 'required_version_unapproved', versionId: currentCaption.id }
  ]);
  const stale = await approve('video', oldReplacement.id);
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, 'stale_version');
  assert.equal((await approve('video', currentVideo.id)).status, 200);
  const suspended = (await request(path)).data;
  assert.equal(suspended.status, 'production');
  assert.deepEqual(suspended.blockers, [
    { piece: 'caption', reason: 'required_version_unapproved', versionId: currentCaption.id }
  ]);
  assert.equal((await approve('caption', currentCaption.id)).status, 200);
  const restored = (await request(path)).data;
  assert.equal(restored.status, 'approved');
  assert.deepEqual(restored.blockers, []);
  assert.ok(restored.pieces.cover.every(version => version.approvedAt === null));
  assert.equal(restored.history.filter(event => event.type === 'delivery_approval_invalidated').length, 1);
  assert.equal(restored.history.filter(event => event.type === 'delivery_approval_restored').length, 1);
  assert.equal((await request(`${path}/pieces/video/versions/${firstVideo.id}/comments`, { second: 22, body: 'Versão original.' })).status, 201);
  assert.equal((await request(`${path}/pieces/video/versions/${currentVideo.id}/comments`, { second: 11, body: 'Fora da atual.' })).status, 400);
  const oldVersion = (await request(`${path}/pieces/video/versions/${firstVideo.id}`)).data;
  const newVersion = (await request(`${path}/pieces/video/versions/${currentVideo.id}`)).data;
  assert.equal(oldVersion.comments.length, 1);
  assert.equal(oldVersion.comments[0].versionId, firstVideo.id);
  assert.equal(oldVersion.comments[0].second, 22);
  assert.deepEqual(newVersion.comments, []);
  assert.deepEqual(restored.pieces.video.map(version => version.number), [1, 2, 3]);
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
