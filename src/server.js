import { createServer as nodeServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { DomainError, ReviewService } from './domain.js';

const MAX_BODY_BYTES = 64 * 1024;

async function jsonBody(request) {
  if ((request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new DomainError('unsupported_media_type', 'Use Content-Type: application/json.', 415);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      request.resume();
      throw new DomainError('body_too_large', 'Corpo maior que 64 KiB.', 413);
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
    throw new DomainError('invalid_json', 'Corpo JSON inválido.');
  }
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value, null, 2));
}

export function createServer(service = new ReviewService()) {
  return nodeServer({ requestTimeout: 30_000, headersTimeout: 15_000 }, async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const parts = pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
      const [root, deliveryId, pieces, piece, versions, versionId, action] = parts;
      if (request.method === 'GET' && pathname === '/health') return send(response, 200, { status: 'ok' });
      if (root === 'campaigns' && parts.length === 1 && request.method === 'POST') {
        return send(response, 201, service.createCampaign(await jsonBody(request)));
      }
      if (root === 'campaigns' && parts.length === 2 && request.method === 'GET') {
        return send(response, 200, service.getCampaign(deliveryId));
      }
      if (root === 'deliveries' && parts.length === 1 && request.method === 'POST') {
        return send(response, 201, service.createDelivery(await jsonBody(request)));
      }
      if (root === 'deliveries' && parts.length === 2 && request.method === 'GET') {
        return send(response, 200, service.getDelivery(deliveryId));
      }
      if (root === 'deliveries' && parts.length === 3 && pieces === 'approve' && request.method === 'POST') {
        return send(response, 200, service.approveDelivery(deliveryId));
      }
      if (root === 'deliveries' && pieces === 'pieces' && versions === 'versions') {
        if (parts.length === 5 && request.method === 'POST') {
          return send(response, 201, service.addVersion(deliveryId, piece, await jsonBody(request)));
        }
        if (parts.length === 6 && request.method === 'GET') {
          return send(response, 200, service.getVersion(deliveryId, piece, versionId));
        }
        if (parts.length === 7 && action === 'approve' && request.method === 'POST') {
          return send(response, 200, service.approveVersion(deliveryId, piece, versionId));
        }
        if (parts.length === 7 && action === 'comments' && request.method === 'POST') {
          return send(response, 201, service.addComment(deliveryId, piece, versionId, await jsonBody(request)));
        }
      }
      throw new DomainError('route_not_found', 'Rota não encontrada.', 404);
    } catch (error) {
      if (error instanceof URIError) return send(response, 400, { error: { code: 'invalid_path', message: 'Caminho inválido.' } });
      if (error instanceof DomainError) {
        return send(response, error.status, { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
      }
      console.error('Falha interna na API:', error.message);
      return send(response, 500, { error: { code: 'internal_error', message: 'Erro interno.' } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3008);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT inválida.');
  const server = createServer();
  server.listen(port, '127.0.0.1', () => console.log(`API em http://127.0.0.1:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
