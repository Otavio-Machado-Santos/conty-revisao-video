import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [archive, evidencePath] = process.argv.slice(2);
assert.ok(archive && evidencePath);
const { ReviewService, PIECES } = await import(pathToFileURL(join(archive, 'src/domain.js')).href);
const { createServer } = await import(pathToFileURL(join(archive, 'src/server.js')).href);
let now = new Date('2026-10-09T20:00:00.000Z');
let idCalls = 0;
const service = new ReviewService({ clock: () => new Date(now), id: () => String(++idCalls) });
const server = createServer(service);
const report = { reviewed_sha: '7cf5c6343987f501f45f760984dbc2e126adb06e', requests: [], scenarios: [], nonmutating_errors: [] };
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;

function advance() { now = new Date(now.getTime() + 1000); }
async function call(path, payload, method = payload === undefined ? 'GET' : 'POST') {
  const requestAt = now.toISOString();
  const response = await fetch(origin + path, { method, ...(payload === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }) });
  const data = await response.json();
  report.requests.push({ at: requestAt, path, method, payload, status: response.status, response: data });
  return { status: response.status, data };
}
const path = id => '/deliveries/' + id;
const versionPath = (id, piece, version) => path(id) + '/pieces/' + piece + '/versions' + (version ? '/' + version : '');
const events = (state, type) => state.history.filter(event => event.type === type);

// Independent policy oracle: no application policy helper is called.
function checkPolicy(state) {
  const expected = state.requiredPieces.flatMap(piece => {
    const current = state.pieces[piece].at(-1);
    if (!current) return [{ piece, reason: 'required_piece_missing' }];
    return current.approvedAt === null ? [{ piece, reason: 'required_version_unapproved', versionId: current.id }] : [];
  });
  assert.deepEqual(state.blockers, expected);
  assert.equal(state.canApprove, expected.length === 0);
  const granted = events(state, 'delivery_approved').length > 0;
  assert.equal(state.status, granted && expected.length === 0 ? 'approved' : 'production');
  assert.equal(state.approvedAt, state.status === 'approved' ? state.lastApprovedAt : null);
  for (const blocker of state.blockers) assert.ok(state.requiredPieces.includes(blocker.piece));
  return state;
}
async function get(id) {
  const result = await call(path(id));
  assert.equal(result.status, 200);
  return checkPolicy(result.data);
}
async function campaign(requiredPieces) {
  const response = await call('/campaigns', { requiredPieces });
  assert.equal(response.status, 201);
  return response.data;
}
async function delivery(campaignId) {
  const response = await call('/deliveries', { campaignId });
  assert.equal(response.status, 201);
  return checkPolicy(response.data);
}
async function add(id, piece, label = 'same-content', durationSeconds = 12.5) {
  advance();
  const body = { asset: { type: piece === 'video' ? 'file' : 'text', value: label + '-' + piece }, ...(piece === 'video' ? { durationSeconds } : {}) };
  const result = await call(versionPath(id, piece), body);
  assert.equal(result.status, 201);
  assert.equal(result.data.createdAt, now.toISOString());
  return result.data;
}
async function approveVersion(id, piece, version) {
  advance();
  const result = await call(versionPath(id, piece, version) + '/approve', undefined, 'POST');
  assert.equal(result.status, 200);
  return result.data;
}
async function approveDelivery(id) {
  advance();
  const result = await call(path(id) + '/approve', undefined, 'POST');
  assert.equal(result.status, 200);
  return checkPolicy(result.data);
}
async function rejectUnchanged(id, endpoint, payload, status, code, method = payload === undefined ? 'POST' : 'POST') {
  const before = service.getDelivery(id);
  const beforeIds = idCalls;
  advance();
  const result = await call(endpoint, payload, method);
  assert.equal(result.status, status);
  assert.equal(result.data.error.code, code);
  assert.deepEqual(service.getDelivery(id), before);
  assert.equal(idCalls, beforeIds);
  report.nonmutating_errors.push({ endpoint, code, status });
  return result.data.error;
}
function normalized(state) {
  return { requiredPieces: state.requiredPieces, status: state.status, canApprove: state.canApprove, blockers: state.blockers,
    pieces: Object.fromEntries(PIECES.map(piece => [piece, state.pieces[piece].map(version => ({ number: version.number, asset: version.asset, approved: version.approvedAt !== null, durationSeconds: version.durationSeconds, comments: version.comments.map(comment => ({ second: comment.second, body: comment.body })) }))])) };
}

try {
  // Same current piece/approval state, different order of optional inclusion.
  const onlyVideo = await campaign(['video']);
  const equivalent = [];
  const pairs = [];
  for (const beforeApproval of [true, false]) {
    const d = await delivery(onlyVideo.id);
    const optional = ['script', 'cover', 'caption'];
    const oldOptional = {};
    if (beforeApproval) for (const piece of optional) oldOptional[piece] = await add(d.id, piece);
    const required = await add(d.id, 'video');
    await approveVersion(d.id, 'video', required.id);
    const approved = await approveDelivery(d.id);
    if (!beforeApproval) for (const piece of optional) oldOptional[piece] = await add(d.id, piece);
    const included = await get(d.id);
    assert.equal(included.status, 'approved');
    assert.equal(included.approvedAt, approved.approvedAt);
    assert.equal(events(included, 'delivery_approval_invalidated').length, 0);
    equivalent.push(normalized(included));
    for (const piece of optional) {
      const replacement = await add(d.id, piece, 'replacement');
      const pending = await get(d.id);
      assert.equal(pending.status, 'approved');
      assert.equal(pending.approvedAt, approved.approvedAt);
      assert.equal(pending.pieces[piece].at(-1).approvedAt, null);
      assert.equal(events(pending, 'delivery_approval_invalidated').length, 0);
      await rejectUnchanged(d.id, versionPath(d.id, piece, oldOptional[piece].id) + '/approve', undefined, 409, 'stale_version');
      await approveVersion(d.id, piece, replacement.id);
      const reviewed = await get(d.id);
      assert.equal(reviewed.status, 'approved');
      assert.equal(reviewed.approvedAt, approved.approvedAt);
      assert.equal(events(reviewed, 'delivery_approval_restored').length, 0);
    }
    const retryBefore = service.getDelivery(d.id);
    const retry = await approveDelivery(d.id);
    assert.deepEqual(retry, retryBefore);
    pairs.push({ id: d.id, required });
  }
  assert.deepEqual(equivalent[0], equivalent[1]);
  report.scenarios.push({ name: 'same_piece_state_different_history', policies: ['video'], optional_inclusion_and_replacement: ['script', 'cover', 'caption'], equivalent_current_approval: true, false_invalidation_events: 0, false_restoration_events: 0, timestamps_preserved: true });

  // Different delivery version IDs cannot be accepted by this delivery.
  const isolatedBefore = service.getDelivery(pairs[1].id);
  await rejectUnchanged(pairs[0].id, versionPath(pairs[0].id, 'video', pairs[1].required.id) + '/approve', undefined, 404, 'version_not_found');
  assert.deepEqual(service.getDelivery(pairs[1].id), isolatedBefore);
  const dto = service.getDelivery(pairs[0].id);
  const original = service.getDelivery(pairs[0].id);
  dto.requiredPieces.length = 0;
  dto.pieces.video[0].approvedAt = null;
  dto.history.length = 0;
  assert.deepEqual(service.getDelivery(pairs[0].id), original);
  const campaignDto = service.getCampaign(onlyVideo.id);
  campaignDto.requiredPieces.push('caption');
  assert.deepEqual(service.getCampaign(onlyVideo.id), onlyVideo);
  report.scenarios.push({ name: 'delivery_isolation_and_defensive_copies', foreign_version_rejected: true, other_delivery_unchanged: true, campaign_immutable: true });

  // Three required pieces: replace two, replace again during suspension, and
  // include/review optional script while required pieces remain pending.
  const three = await campaign(['video', 'caption', 'cover']);
  const d = await delivery(three.id);
  const first = {};
  for (const piece of three.requiredPieces) {
    first[piece] = await add(d.id, piece);
    await approveVersion(d.id, piece, first[piece].id);
  }
  const initial = await approveDelivery(d.id);
  const video2 = await add(d.id, 'video', 'short-second', 0.625);
  const caption2 = await add(d.id, 'caption', 'caption-second');
  const script1 = await add(d.id, 'script', 'optional-first');
  const script2 = await add(d.id, 'script', 'optional-second');
  const video3 = await add(d.id, 'video', 'short-third', 0.125);
  let suspended = await get(d.id);
  assert.equal(suspended.status, 'production');
  assert.deepEqual(suspended.blockers.map(blocker => blocker.piece), ['video', 'caption']);
  assert.equal(suspended.currentVersionIds.video, video3.id);
  assert.equal(suspended.currentVersionIds.caption, caption2.id);
  assert.equal(events(suspended, 'delivery_approval_invalidated').length, 1);
  assert.equal(suspended.lastApprovedAt, initial.lastApprovedAt);
  await rejectUnchanged(d.id, versionPath(d.id, 'video', video2.id) + '/approve', undefined, 409, 'stale_version');
  await rejectUnchanged(d.id, versionPath(d.id, 'caption', first.caption.id) + '/approve', undefined, 409, 'stale_version');
  await rejectUnchanged(d.id, versionPath(d.id, 'script', script1.id) + '/approve', undefined, 409, 'stale_version');
  await approveVersion(d.id, 'script', script2.id);
  const optionalReviewed = await get(d.id);
  assert.deepEqual(optionalReviewed.blockers, suspended.blockers);
  assert.equal(optionalReviewed.status, 'production');
  assert.equal(optionalReviewed.lastApprovedAt, initial.lastApprovedAt);
  assert.equal(events(optionalReviewed, 'delivery_approval_restored').length, 0);
  await approveVersion(d.id, 'video', video3.id);
  suspended = await get(d.id);
  assert.deepEqual(suspended.blockers, [{ piece: 'caption', reason: 'required_version_unapproved', versionId: caption2.id }]);
  const error = await rejectUnchanged(d.id, path(d.id) + '/approve', undefined, 409, 'approval_blocked');
  assert.deepEqual(error.details.blockers, suspended.blockers);
  await approveVersion(d.id, 'caption', caption2.id);
  const restored = await get(d.id);
  assert.equal(restored.status, 'approved');
  assert.equal(restored.approvedAt, now.toISOString());
  assert.equal(events(restored, 'delivery_approval_invalidated').length, 1);
  assert.equal(events(restored, 'delivery_approval_restored').length, 1);
  const stable = service.getDelivery(d.id);
  await approveVersion(d.id, 'caption', caption2.id);
  await approveDelivery(d.id);
  assert.deepEqual(service.getDelivery(d.id), stable);
  report.scenarios.push({ name: 'multiple_required_versions_during_suspension', required: three.requiredPieces, version_numbers_video: restored.pieces.video.map(version => version.number), stale_rejections: 3, invalidations: 1, restorations: 1, optional_did_not_restore: true });

  // Optional video is not a special case: first inclusion/replacement remains
  // approved, while comment bounds refer to the exact version and clock.
  const scriptCampaign = await campaign(['script']);
  const optionalVideoDelivery = await delivery(scriptCampaign.id);
  const requiredScript = await add(optionalVideoDelivery.id, 'script');
  await approveVersion(optionalVideoDelivery.id, 'script', requiredScript.id);
  const originalApproval = await approveDelivery(optionalVideoDelivery.id);
  const oldVideo = await add(optionalVideoDelivery.id, 'video', 'optional-long', 17.25);
  advance();
  const comment = await call(versionPath(optionalVideoDelivery.id, 'video', oldVideo.id) + '/comments', { second: 15.875, body: 'Comentário na versão longa.' });
  assert.equal(comment.status, 201);
  assert.equal(comment.data.createdAt, now.toISOString());
  assert.equal(comment.data.versionId, oldVideo.id);
  const newVideo = await add(optionalVideoDelivery.id, 'video', 'optional-short', 0.25);
  assert.equal((await get(optionalVideoDelivery.id)).approvedAt, originalApproval.approvedAt);
  await rejectUnchanged(optionalVideoDelivery.id, versionPath(optionalVideoDelivery.id, 'video', oldVideo.id) + '/approve', undefined, 409, 'stale_version');
  await rejectUnchanged(optionalVideoDelivery.id, versionPath(optionalVideoDelivery.id, 'video', newVideo.id) + '/comments', { second: 15.875, body: 'Não cabe no vídeo atual.' }, 400, 'invalid_second');
  await rejectUnchanged(optionalVideoDelivery.id, versionPath(optionalVideoDelivery.id, 'script', requiredScript.id) + '/comments', { second: 0, body: 'Peça sem timeline.' }, 400, 'invalid_comment_piece');
  advance();
  const oldEndpointComment = await call(versionPath(optionalVideoDelivery.id, 'video', oldVideo.id) + '/comments', { second: 17.25, body: 'Fim da versão antiga.' });
  assert.equal(oldEndpointComment.status, 201);
  assert.equal(oldEndpointComment.data.createdAt, now.toISOString());
  advance();
  const newEndpointComment = await call(versionPath(optionalVideoDelivery.id, 'video', newVideo.id) + '/comments', { second: 0.25, body: 'Fim da versão nova.' });
  assert.equal(newEndpointComment.status, 201);
  assert.equal(newEndpointComment.data.versionId, newVideo.id);
  assert.equal(newEndpointComment.data.createdAt, now.toISOString());
  const oldRead = await call(versionPath(optionalVideoDelivery.id, 'video', oldVideo.id));
  const newRead = await call(versionPath(optionalVideoDelivery.id, 'video', newVideo.id));
  assert.deepEqual(oldRead.data.comments, [comment.data, oldEndpointComment.data]);
  assert.deepEqual(newRead.data.comments, [newEndpointComment.data]);
  await approveVersion(optionalVideoDelivery.id, 'video', newVideo.id);
  const finalOptional = await get(optionalVideoDelivery.id);
  assert.equal(finalOptional.status, 'approved');
  assert.equal(finalOptional.approvedAt, originalApproval.approvedAt);
  assert.equal(events(finalOptional, 'delivery_approval_invalidated').length, 0);
  assert.equal(events(finalOptional, 'delivery_approval_restored').length, 0);
  report.scenarios.push({ name: 'optional_video_comments_and_timestamps', old_duration: 17.25, new_duration: 0.25, old_comments: oldRead.data.comments.length, new_comments: newRead.data.comments.length, version_references_and_created_at_match: true, no_false_approval_events: true });
  report.passed = true;
} finally {
  const closed = once(server, 'close');
  server.close();
  await closed;
}

writeFileSync(evidencePath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ reviewed_sha: report.reviewed_sha, http_requests: report.requests.length, scenarios: report.scenarios.length, nonmutating_errors: report.nonmutating_errors.length, passed: report.passed, network: 'loopback, ephemeral port', cleanup: 'own server close only' }));
