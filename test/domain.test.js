import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, ReviewService } from '../src/domain.js';

function fixture(requiredPieces = ['video']) {
  let next = 0;
  let time = new Date('2026-10-09T12:00:00Z');
  const service = new ReviewService({ id: () => String(++next), clock: () => new Date(time) });
  const campaign = service.createCampaign({ requiredPieces });
  const delivery = service.createDelivery({ campaignId: campaign.id });
  const add = piece => service.addVersion(delivery.id, piece, {
    asset: { type: piece === 'video' ? 'file' : 'text', value: piece === 'video' ? 'fake-video.mp4' : `Conteúdo ${piece}` },
    ...(piece === 'video' ? { durationSeconds: 60 } : {})
  });
  return { service, campaign, delivery, add, advance: seconds => { time = new Date(+time + seconds * 1000); } };
}

const failsWith = (fn, code, status = 400) => assert.throws(fn, error => error.code === code && error.status === status);

test('as 15 combinações de peças exigidas usam o dado da campanha e a versão atual', () => {
  for (let mask = 1; mask < 16; mask++) {
    const required = PIECES.filter((_, index) => mask & (1 << index));
    const { service, delivery, add } = fixture(required);
    assert.equal(service.getDelivery(delivery.id).status, 'production');
    failsWith(() => service.approveDelivery(delivery.id), 'approval_blocked', 409);
    for (const piece of required) {
      const version = add(piece);
      assert.equal(service.getDelivery(delivery.id).canApprove, false);
      service.approveVersion(delivery.id, piece, version.id);
    }
    assert.equal(service.getDelivery(delivery.id).canApprove, true);
    assert.equal(service.getDelivery(delivery.id).status, 'production');
    assert.equal(service.approveDelivery(delivery.id).status, 'approved');
  }
});

test('campanha só de vídeo aprova sem roteiro, capa ou legenda', () => {
  const { service, delivery, add } = fixture();
  const version = add('video');
  service.approveVersion(delivery.id, 'video', version.id);
  const result = service.approveDelivery(delivery.id);
  assert.equal(result.status, 'approved');
  assert.equal(result.pieces.script.length, 0);
  assert.equal(result.pieces.cover.length, 0);
  assert.equal(result.pieces.caption.length, 0);
});

test('erro de aprovação identifica cada peça ausente ou versão pendente', () => {
  const { service, delivery, add } = fixture(['video', 'caption', 'cover']);
  const video = add('video');
  assert.throws(() => service.approveDelivery(delivery.id), error => {
    assert.equal(error.status, 409);
    assert.deepEqual(error.details.blockers, [
      { piece: 'video', reason: 'required_version_unapproved', versionId: video.id },
      { piece: 'caption', reason: 'required_piece_missing' },
      { piece: 'cover', reason: 'required_piece_missing' }
    ]);
    assert.match(error.message, /não pode ser aprovada/);
    return true;
  });
});

test('inclusão e substituição opcionais pendentes não bloqueiam antes da primeira aprovação', () => {
  const { service, delivery, add } = fixture();
  for (const piece of ['script', 'cover', 'caption']) {
    add(piece);
    add(piece);
  }
  const video = add('video');
  service.approveVersion(delivery.id, 'video', video.id);
  const ready = service.getDelivery(delivery.id);
  assert.equal(ready.status, 'production');
  assert.equal(ready.canApprove, true);
  assert.deepEqual(ready.blockers, []);
  const approved = service.approveDelivery(delivery.id);
  assert.equal(approved.status, 'approved');
  for (const piece of ['script', 'cover', 'caption']) {
    assert.equal(approved.pieces[piece].length, 2);
    assert.ok(approved.pieces[piece].every(version => version.approvedAt === null));
  }
});

test('versão nova de peça obrigatória invalida aprovação até ser aprovada', () => {
  const { service, delivery, add, advance } = fixture(['video', 'cover']);
  for (const piece of ['video', 'cover']) service.approveVersion(delivery.id, piece, add(piece).id);
  const approved = service.approveDelivery(delivery.id);
  advance(60);
  const replacement = add('video');
  const pending = service.getDelivery(delivery.id);
  assert.equal(pending.status, 'production');
  assert.equal(pending.approvedAt, null);
  assert.equal(pending.lastApprovedAt, approved.approvedAt);
  failsWith(() => service.approveDelivery(delivery.id), 'approval_blocked', 409);
  service.approveVersion(delivery.id, 'video', replacement.id);
  const restored = service.getDelivery(delivery.id);
  assert.equal(restored.status, 'approved');
  assert.equal(restored.approvedAt, '2026-10-09T12:01:00.000Z');
  assert.equal(restored.pieces.video.length, 2);
  assert.deepEqual(restored.history.slice(-3).map(event => event.type), [
    'delivery_approval_invalidated', 'version_approved', 'delivery_approval_restored'
  ]);
});

test('substituição opcional depois da aprovação permanece livre e não gera invalidação', () => {
  const { service, delivery, add, advance } = fixture();
  const caption = add('caption');
  const video = add('video');
  service.approveVersion(delivery.id, 'video', video.id);
  const approved = service.approveDelivery(delivery.id);
  advance(60);
  const newCaption = add('caption');
  const after = service.getDelivery(delivery.id);
  assert.equal(after.status, 'approved');
  assert.equal(after.canApprove, true);
  assert.deepEqual(after.blockers, []);
  assert.equal(after.approvedAt, approved.approvedAt);
  assert.equal(after.lastApprovedAt, approved.lastApprovedAt);
  assert.equal(after.currentVersionIds.caption, newCaption.id);
  assert.equal(after.pieces.caption.at(-1).approvedAt, null);
  assert.equal(after.history.filter(event => event.type === 'delivery_approval_invalidated').length, 0);
  failsWith(() => service.approveVersion(delivery.id, 'caption', caption.id), 'stale_version', 409);
  service.approveVersion(delivery.id, 'caption', newCaption.id);
  const reviewed = service.getDelivery(delivery.id);
  assert.equal(reviewed.status, 'approved');
  assert.equal(reviewed.approvedAt, approved.approvedAt);
  assert.equal(reviewed.history.filter(event => event.type === 'delivery_approval_restored').length, 0);
});

test('primeira inclusão de peças opcionais após aprovação não suspende a aprovação', () => {
  const { service, delivery, add } = fixture();
  service.approveVersion(delivery.id, 'video', add('video').id);
  const approved = service.approveDelivery(delivery.id);
  for (const piece of ['script', 'cover', 'caption']) {
    const optional = add(piece);
    const state = service.getDelivery(delivery.id);
    assert.equal(state.status, 'approved');
    assert.equal(state.canApprove, true);
    assert.deepEqual(state.blockers, []);
    assert.equal(state.approvedAt, approved.approvedAt);
    assert.equal(state.currentVersionIds[piece], optional.id);
    assert.equal(state.pieces[piece].at(-1).approvedAt, null);
    assert.equal(service.approveDelivery(delivery.id).status, 'approved');
  }
  assert.equal(service.getDelivery(delivery.id).history.filter(event => event.type === 'delivery_approval_invalidated').length, 0);
});

test('várias substituições obrigatórias durante suspensão exigem somente suas versões atuais', () => {
  const { service, delivery, add } = fixture(['video', 'cover']);
  for (const piece of ['video', 'cover']) service.approveVersion(delivery.id, piece, add(piece).id);
  service.approveDelivery(delivery.id);
  const oldReplacement = add('video');
  const cover = add('cover');
  add('caption');
  const currentVideo = add('video');
  add('caption');
  assert.deepEqual(service.getDelivery(delivery.id).blockers, [
    { piece: 'video', reason: 'required_version_unapproved', versionId: currentVideo.id },
    { piece: 'cover', reason: 'required_version_unapproved', versionId: cover.id }
  ]);
  failsWith(() => service.approveVersion(delivery.id, 'video', oldReplacement.id), 'stale_version', 409);
  service.approveVersion(delivery.id, 'video', currentVideo.id);
  assert.equal(service.getDelivery(delivery.id).status, 'production');
  assert.deepEqual(service.getDelivery(delivery.id).blockers, [
    { piece: 'cover', reason: 'required_version_unapproved', versionId: cover.id }
  ]);
  failsWith(() => service.approveDelivery(delivery.id), 'approval_blocked', 409);
  service.approveVersion(delivery.id, 'cover', cover.id);
  assert.equal(service.getDelivery(delivery.id).status, 'approved');
  assert.ok(service.getDelivery(delivery.id).pieces.caption.every(version => version.approvedAt === null));
  assert.equal(service.getDelivery(delivery.id).history.filter(event => event.type === 'delivery_approval_invalidated').length, 1);
});

test('mesmo estado de peças dá a mesma aprovação com opcional enviada antes ou depois', () => {
  const states = [true, false].map(before => {
    const { service, delivery, add } = fixture();
    if (before) add('script');
    service.approveVersion(delivery.id, 'video', add('video').id);
    service.approveDelivery(delivery.id);
    if (!before) add('script');
    const state = service.getDelivery(delivery.id);
    return {
      requiredPieces: state.requiredPieces, status: state.status, canApprove: state.canApprove,
      blockers: state.blockers,
      pieces: Object.fromEntries(PIECES.map(piece => [piece, state.pieces[piece].map(version => ({
        number: version.number, asset: version.asset, approved: version.approvedAt !== null,
        durationSeconds: version.durationSeconds, comments: version.comments
      }))]))
    };
  });
  assert.deepEqual(states[0], states[1]);
  assert.equal(states[1].status, 'approved');
  assert.equal(states[1].canApprove, true);
});

test('todas as combinações da campanha ignoram inclusão e substituição das peças não exigidas', () => {
  for (let mask = 1; mask < 16; mask++) {
    const required = PIECES.filter((_, index) => mask & (1 << index));
    const optional = PIECES.filter(piece => !required.includes(piece));
    const { service, delivery, add } = fixture(required);
    for (const piece of required) service.approveVersion(delivery.id, piece, add(piece).id);
    const approved = service.approveDelivery(delivery.id);
    for (const piece of optional) {
      add(piece);
      add(piece);
      const state = service.getDelivery(delivery.id);
      assert.equal(state.status, 'approved', `${required}: opcional ${piece}`);
      assert.equal(state.canApprove, true);
      assert.deepEqual(state.blockers, []);
      assert.equal(state.approvedAt, approved.approvedAt);
      assert.ok(state.pieces[piece].every(version => version.approvedAt === null));
      assert.equal(state.history.filter(event => event.type === 'delivery_approval_invalidated').length, 0);
    }
  }
});

test('vídeo opcional substituído não bloqueia e seus comentários continuam na versão de origem', () => {
  const { service, delivery, add } = fixture(['script']);
  service.approveVersion(delivery.id, 'script', add('script').id);
  service.approveDelivery(delivery.id);
  const old = add('video');
  const comment = service.addComment(delivery.id, 'video', old.id, { second: 50, body: 'Cena da versão antiga.' });
  const current = service.addVersion(delivery.id, 'video', {
    asset: { type: 'file', value: 'short-optional.mp4' }, durationSeconds: 10
  });
  assert.equal(service.getDelivery(delivery.id).status, 'approved');
  assert.deepEqual(service.getDelivery(delivery.id).blockers, []);
  failsWith(() => service.approveVersion(delivery.id, 'video', old.id), 'stale_version', 409);
  assert.deepEqual(service.getVersion(delivery.id, 'video', old.id).comments, [comment]);
  assert.deepEqual(service.getVersion(delivery.id, 'video', current.id).comments, []);
  failsWith(() => service.addComment(delivery.id, 'video', current.id, { second: 50, body: 'Fora desta versão.' }), 'invalid_second');
  service.addComment(delivery.id, 'video', current.id, { second: 10, body: 'Fim da versão atual.' });
  assert.equal(service.getVersion(delivery.id, 'video', old.id).comments.length, 1);
  assert.equal(service.getDelivery(delivery.id).status, 'approved');
});

test('versão anterior aprovada não aprova automaticamente substituta antes da primeira aprovação', () => {
  const { service, delivery, add } = fixture();
  const old = add('video');
  service.approveVersion(delivery.id, 'video', old.id);
  const current = add('video');
  failsWith(() => service.approveDelivery(delivery.id), 'approval_blocked', 409);
  failsWith(() => service.approveVersion(delivery.id, 'video', old.id), 'stale_version', 409);
  assert.equal(service.getDelivery(delivery.id).currentVersionIds.video, current.id);
});

test('aprovações repetidas são idempotentes e não duplicam histórico', () => {
  const { service, delivery, add } = fixture();
  const version = add('video');
  service.approveVersion(delivery.id, 'video', version.id);
  service.approveVersion(delivery.id, 'video', version.id);
  service.approveDelivery(delivery.id);
  service.approveDelivery(delivery.id);
  const types = service.getDelivery(delivery.id).history.map(event => event.type);
  assert.equal(types.filter(type => type === 'version_approved').length, 1);
  assert.equal(types.filter(type => type === 'delivery_approved').length, 1);
});

test('comentários pertencem à versão de origem, inclusive após a substituição', () => {
  const { service, delivery, add } = fixture();
  const first = add('video');
  const comment = service.addComment(delivery.id, 'video', first.id, { second: 12.5, body: 'Ajustar o enquadramento.' });
  const second = add('video');
  const later = service.addComment(delivery.id, 'video', first.id, { second: 20, body: 'Registro ainda na primeira versão.' });
  assert.equal(comment.versionId, first.id);
  assert.deepEqual(service.getVersion(delivery.id, 'video', first.id).comments, [comment, later]);
  assert.deepEqual(service.getVersion(delivery.id, 'video', second.id).comments, []);
  assert.deepEqual(service.getDelivery(delivery.id).pieces.video.map(version => version.number), [1, 2]);
});

test('segundos fracionários e limites inclusivos válidos; fora do vídeo é rejeitado', () => {
  const { service, delivery, add } = fixture();
  const version = add('video');
  for (const second of [0, 12.125, 60]) {
    assert.equal(service.addComment(delivery.id, 'video', version.id, { second, body: 'Comentário' }).second, second);
  }
  for (const second of [-1, 60.001, NaN, Infinity, '12', null, undefined]) {
    failsWith(() => service.addComment(delivery.id, 'video', version.id, { second, body: 'Comentário' }), 'invalid_second');
  }
  assert.equal(service.getVersion(delivery.id, 'video', version.id).comments.length, 3);
});

test('comentário valida duração da sua versão, não da versão mais recente', () => {
  const { service, delivery, add } = fixture();
  const old = add('video');
  const current = service.addVersion(delivery.id, 'video', { asset: { type: 'file', value: 'short.mp4' }, durationSeconds: 10 });
  service.addComment(delivery.id, 'video', old.id, { second: 50, body: 'Longo anterior' });
  failsWith(() => service.addComment(delivery.id, 'video', current.id, { second: 50, body: 'Vídeo curto' }), 'invalid_second');
});

test('dados retornados e objetos recebidos não permitem mudar o estado armazenado', () => {
  const service = new ReviewService();
  const input = { requiredPieces: ['video'] };
  const campaign = service.createCampaign(input);
  input.requiredPieces.push('cover');
  campaign.requiredPieces.push('caption');
  const delivery = service.createDelivery({ campaignId: campaign.id });
  const versionInput = { asset: { type: 'file', value: 'clip.mp4' }, durationSeconds: 12 };
  const version = service.addVersion(delivery.id, 'video', versionInput);
  versionInput.asset.value = 'alterado.mp4';
  version.approvedAt = 'forjado';
  delivery.pieces.video.push(version);
  assert.deepEqual(service.getCampaign(campaign.id).requiredPieces, ['video']);
  assert.equal(service.getVersion(delivery.id, 'video', version.id).asset.value, 'clip.mp4');
  assert.equal(service.getVersion(delivery.id, 'video', version.id).approvedAt, null);
});

test('identificadores isolam campanhas, entregas, peças e versões', () => {
  const { service, campaign, delivery, add } = fixture();
  const second = service.createDelivery({ campaignId: campaign.id });
  const video = add('video');
  failsWith(() => service.approveVersion(second.id, 'video', video.id), 'version_not_found', 404);
  failsWith(() => service.approveVersion(delivery.id, 'cover', video.id), 'version_not_found', 404);
  failsWith(() => service.getDelivery('missing'), 'delivery_not_found', 404);
  failsWith(() => service.createDelivery({ campaignId: 'missing' }), 'campaign_not_found', 404);
  failsWith(() => service.addVersion(delivery.id, '__proto__', {}), 'invalid_piece');
});

test('campanha exige lista não vazia, sem nomes inválidos ou duplicados', () => {
  const service = new ReviewService();
  for (const requiredPieces of [[], null, 'video', ['video', 'video'], ['unsupported'], ['video', 'script', 'cover', 'caption', 'video']]) {
    assert.throws(() => service.createCampaign({ requiredPieces }));
  }
  for (const input of [null, [], 'invalid']) failsWith(() => service.createCampaign(input), 'invalid_input');
});

test('assets e durações inválidos não criam versões nem invalidam aprovação', () => {
  const { service, delivery, add } = fixture();
  service.approveVersion(delivery.id, 'video', add('video').id);
  service.approveDelivery(delivery.id);
  const invalid = [
    null, {}, { asset: { type: 'file', value: '' }, durationSeconds: 10 },
    { asset: { type: 'text', value: 'Não é vídeo' }, durationSeconds: 10 },
    { asset: { type: 'url', value: 'javascript:alert(1)' }, durationSeconds: 10 },
    { asset: { type: 'url', value: 'https://user:password@example.com/clip' }, durationSeconds: 10 },
    { asset: { type: 'url', value: 'not-a-url' }, durationSeconds: 10 },
    ...[0, -1, NaN, Infinity, '10', null, undefined].map(durationSeconds => ({ asset: { type: 'file', value: 'clip.mp4' }, durationSeconds }))
  ];
  const before = service.getDelivery(delivery.id);
  for (const input of invalid) assert.throws(() => service.addVersion(delivery.id, 'video', input));
  assert.deepEqual(service.getDelivery(delivery.id), before);
  failsWith(() => service.addVersion(delivery.id, 'cover', { asset: { type: 'file', value: 'cover.jpg' }, durationSeconds: 10 }), 'invalid_duration');
});

test('URL é um asset aceito sem requisição externa ou upload real', () => {
  const { service, delivery } = fixture();
  const version = service.addVersion(delivery.id, 'video', {
    asset: { type: 'url', value: 'https://example.com/clip.mp4' }, durationSeconds: 90
  });
  assert.equal(version.asset.value, 'https://example.com/clip.mp4');
  service.approveVersion(delivery.id, 'video', version.id);
  assert.equal(service.approveDelivery(delivery.id).status, 'approved');
});

test('comentários precisam de texto e de peça vídeo e não alteram aprovação', () => {
  const { service, delivery, add } = fixture();
  const video = add('video');
  const cover = add('cover');
  service.approveVersion(delivery.id, 'video', video.id);
  service.approveDelivery(delivery.id);
  failsWith(() => service.addComment(delivery.id, 'cover', cover.id, { second: 0, body: 'Texto' }), 'invalid_comment_piece');
  for (const body of ['', '   ', null, 123, 'x'.repeat(4001)]) {
    failsWith(() => service.addComment(delivery.id, 'video', video.id, { second: 0, body }), 'invalid_input');
  }
  service.addComment(delivery.id, 'video', video.id, { second: 1, body: 'Observação após aprovação' });
  assert.equal(service.getDelivery(delivery.id).status, 'approved');
});
