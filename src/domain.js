import { randomUUID } from 'node:crypto';

export const PIECES = Object.freeze(['script', 'video', 'cover', 'caption']);

export class DomainError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const copy = value => structuredClone(value);

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('invalid_input', `${name} deve ser um objeto.`);
  }
  return value;
}

function text(value, name, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new DomainError('invalid_input', `${name} deve ter de 1 a ${maximum} caracteres.`);
  }
  return value;
}

function pieceName(piece) {
  if (!PIECES.includes(piece)) {
    throw new DomainError('invalid_piece', 'Peça inválida; use script, video, cover ou caption.');
  }
}

function assetSnapshot(input, piece) {
  object(input, 'asset');
  if (!['url', 'file', 'text'].includes(input.type)) {
    throw new DomainError('invalid_asset', 'asset.type deve ser url, file ou text.');
  }
  const value = text(input.value, 'asset.value', 20_000);
  if (input.type === 'url') {
    let url;
    try { url = new URL(value); } catch {
      throw new DomainError('invalid_asset', 'URL inválida.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new DomainError('invalid_asset', 'Use uma URL HTTP(S) sem credenciais.');
    }
  }
  if (piece === 'video' && input.type === 'text') {
    throw new DomainError('invalid_asset', 'Vídeo deve apontar para URL ou arquivo fictício.');
  }
  return { type: input.type, value };
}

// A campanha é dado: uma única política cobre todas as combinações de peças.
export function approvalBlockers(delivery, campaign) {
  const blockers = [];
  const required = new Set(campaign.requiredPieces);
  for (const piece of campaign.requiredPieces) {
    const version = delivery.pieces[piece].at(-1);
    if (!version) blockers.push({ piece, reason: 'required_piece_missing' });
    else if (!version.approvedAt) blockers.push({ piece, reason: 'required_version_unapproved', versionId: version.id });
  }
  // Depois da primeira aprovação, toda substituição precisa ser revisada,
  // incluindo uma peça opcional: é a exceção explícita descrita no README.
  for (const piece of delivery.reviewRequiredAfterApproval) {
    if (required.has(piece)) continue;
    const version = delivery.pieces[piece].at(-1);
    if (!version?.approvedAt) blockers.push({ piece, reason: 'replacement_unapproved', versionId: version?.id });
  }
  return blockers;
}

export class ReviewService {
  #campaigns = new Map();
  #deliveries = new Map();
  #clock;
  #id;

  constructor({ clock = () => new Date(), id = randomUUID } = {}) {
    this.#clock = clock;
    this.#id = id;
  }

  #now() {
    const date = this.#clock();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('Relógio inválido.');
    return date.toISOString();
  }

  #campaign(id) {
    const campaign = this.#campaigns.get(id);
    if (!campaign) throw new DomainError('campaign_not_found', 'Campanha não encontrada.', 404);
    return campaign;
  }

  #delivery(id) {
    const delivery = this.#deliveries.get(id);
    if (!delivery) throw new DomainError('delivery_not_found', 'Entrega não encontrada.', 404);
    return delivery;
  }

  #version(delivery, piece, versionId, currentOnly = false) {
    pieceName(piece);
    const versions = delivery.pieces[piece];
    const version = versions.find(item => item.id === versionId);
    if (!version) throw new DomainError('version_not_found', 'Versão não encontrada nesta peça e entrega.', 404);
    if (currentOnly && version !== versions.at(-1)) {
      throw new DomainError('stale_version', 'Só a versão atual pode ser aprovada.', 409, { currentVersionId: versions.at(-1).id });
    }
    return version;
  }

  #status(delivery) {
    return delivery.approvalGranted && approvalBlockers(delivery, this.#campaign(delivery.campaignId)).length === 0
      ? 'approved' : 'production';
  }

  #event(delivery, type, at, fields = {}) {
    delivery.history.push({ id: `event-${this.#id()}`, type, at, ...fields });
  }

  createCampaign(input) {
    object(input, 'Corpo');
    const { requiredPieces } = input;
    if (!Array.isArray(requiredPieces) || requiredPieces.length === 0 || requiredPieces.length > PIECES.length) {
      throw new DomainError('invalid_required_pieces', 'requiredPieces deve conter de 1 a 4 peças.');
    }
    requiredPieces.forEach(pieceName);
    if (new Set(requiredPieces).size !== requiredPieces.length) {
      throw new DomainError('invalid_required_pieces', 'requiredPieces não pode repetir peças.');
    }
    const campaign = { id: `campaign-${this.#id()}`, requiredPieces: [...requiredPieces], createdAt: this.#now() };
    this.#campaigns.set(campaign.id, campaign);
    return copy(campaign);
  }

  getCampaign(id) { return copy(this.#campaign(id)); }

  createDelivery(input) {
    object(input, 'Corpo');
    const campaignId = text(input.campaignId, 'campaignId', 200);
    this.#campaign(campaignId);
    const at = this.#now();
    const delivery = {
      id: `delivery-${this.#id()}`, campaignId, createdAt: at,
      approvalGranted: false, lastApprovedAt: null,
      reviewRequiredAfterApproval: new Set(),
      pieces: Object.fromEntries(PIECES.map(piece => [piece, []])), history: []
    };
    this.#event(delivery, 'delivery_created', at);
    this.#deliveries.set(delivery.id, delivery);
    return this.getDelivery(delivery.id);
  }

  getDelivery(id) {
    const delivery = this.#delivery(id);
    const blockers = approvalBlockers(delivery, this.#campaign(delivery.campaignId));
    const status = this.#status(delivery);
    return copy({
      id: delivery.id, campaignId: delivery.campaignId, createdAt: delivery.createdAt,
      requiredPieces: this.#campaign(delivery.campaignId).requiredPieces,
      status, approvedAt: status === 'approved' ? delivery.lastApprovedAt : null,
      lastApprovedAt: delivery.lastApprovedAt, canApprove: blockers.length === 0,
      blockers, pieces: delivery.pieces,
      currentVersionIds: Object.fromEntries(PIECES.map(piece => [piece, delivery.pieces[piece].at(-1)?.id ?? null])),
      history: delivery.history
    });
  }

  addVersion(deliveryId, piece, input) {
    const delivery = this.#delivery(deliveryId);
    pieceName(piece);
    object(input, 'Corpo');
    const asset = assetSnapshot(input.asset, piece);
    if (piece === 'video' && (typeof input.durationSeconds !== 'number' || !Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0)) {
      throw new DomainError('invalid_duration', 'durationSeconds deve ser um número finito maior que zero para vídeo.');
    }
    if (piece !== 'video' && input.durationSeconds !== undefined) {
      throw new DomainError('invalid_duration', 'durationSeconds só se aplica à peça video.');
    }
    const at = this.#now();
    const before = this.#status(delivery);
    const version = {
      id: `version-${this.#id()}`, number: delivery.pieces[piece].length + 1,
      asset, createdAt: at, approvedAt: null, comments: [],
      ...(piece === 'video' ? { durationSeconds: input.durationSeconds } : {})
    };
    delivery.pieces[piece].push(version);
    if (delivery.approvalGranted) delivery.reviewRequiredAfterApproval.add(piece);
    this.#event(delivery, 'version_submitted', at, { piece, versionId: version.id });
    if (before === 'approved') this.#event(delivery, 'delivery_approval_invalidated', at, { piece, versionId: version.id });
    return copy(version);
  }

  getVersion(deliveryId, piece, versionId) {
    return copy(this.#version(this.#delivery(deliveryId), piece, versionId));
  }

  approveVersion(deliveryId, piece, versionId) {
    const delivery = this.#delivery(deliveryId);
    const version = this.#version(delivery, piece, versionId, true);
    if (version.approvedAt) return copy(version);
    const at = this.#now();
    const before = this.#status(delivery);
    version.approvedAt = at;
    this.#event(delivery, 'version_approved', at, { piece, versionId });
    if (before !== 'approved' && this.#status(delivery) === 'approved') {
      delivery.lastApprovedAt = at;
      this.#event(delivery, 'delivery_approval_restored', at);
    }
    return copy(version);
  }

  approveDelivery(id) {
    const delivery = this.#delivery(id);
    const blockers = approvalBlockers(delivery, this.#campaign(delivery.campaignId));
    if (blockers.length) {
      throw new DomainError('approval_blocked', 'Entrega não pode ser aprovada: há peças obrigatórias ausentes ou versões aguardando aprovação.', 409, { blockers });
    }
    if (this.#status(delivery) !== 'approved') {
      const at = this.#now();
      delivery.approvalGranted = true;
      delivery.lastApprovedAt = at;
      this.#event(delivery, 'delivery_approved', at);
    }
    return this.getDelivery(id);
  }

  addComment(deliveryId, piece, versionId, input) {
    const delivery = this.#delivery(deliveryId);
    if (piece !== 'video') throw new DomainError('invalid_comment_piece', 'Comentários em segundos só se aplicam à peça video.');
    const version = this.#version(delivery, piece, versionId);
    object(input, 'Corpo');
    if (typeof input.second !== 'number' || !Number.isFinite(input.second) || input.second < 0 || input.second > version.durationSeconds) {
      throw new DomainError('invalid_second', `second deve estar entre 0 e ${version.durationSeconds}, inclusive.`);
    }
    const body = text(input.body, 'body', 4000);
    const at = this.#now();
    const comment = { id: `comment-${this.#id()}`, versionId, second: input.second, body, createdAt: at };
    version.comments.push(comment);
    this.#event(delivery, 'comment_added', at, { piece, versionId, commentId: comment.id });
    return copy(comment);
  }
}
