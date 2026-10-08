import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerSession } from '../client/peer';
import type { PublicConfig, ServerSignal } from '../shared/protocol';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = Socket.OPEN;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
  constructor(readonly url: URL) { Socket.instances.push(this); }
  receive(message: ServerSignal) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

class Connection {
  static instances: Connection[] = [];
  connectionState = 'new';
  localDescription?: RTCSessionDescriptionInit;
  remoteDescription?: RTCSessionDescriptionInit;
  channel = { readyState: 'open', binaryType: 'arraybuffer', bufferedAmountLowThreshold: 0, onopen: undefined as (() => void) | undefined, onclose: undefined as (() => void) | undefined, send: vi.fn(), close: vi.fn() };
  createDataChannel = vi.fn(() => this.channel);
  createOffer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({ type: 'offer', sdp: 'offer' }));
  createAnswer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({ type: 'answer', sdp: 'answer' }));
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => { this.localDescription = description; });
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => { this.remoteDescription = description; });
  addIceCandidate = vi.fn(async () => {});
  close = vi.fn();
  constructor(readonly configuration: RTCConfiguration) { Connection.instances.push(this); }
}

const config: PublicConfig = { publicUrl: '', maxFileSize: 100000, maxSessionBytes: 200000, iceServers: [] };
const relay: PublicConfig = { ...config, iceServers: [{ urls: ['turns:relay.example:5349'], username: 'old', credential: 'expired' }] };
const room = { type: 'JOINED' as const, roomId: 'a'.repeat(32), code: '123456', peerId: 'peer', expiresAt: 100000 };
const sessions: PeerSession[] = [];
const response = (settings: PublicConfig) => Response.json(settings);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(settings = config) {
  const callbacks = { status: vi.fn(), room: vi.fn(), transfers: vi.fn(), error: vi.fn() };
  const session = new PeerSession(settings, callbacks);
  sessions.push(session);
  return { session, callbacks };
}
async function join(session: PeerSession) {
  await session.start({ code: '123456' });
  const socket = Socket.instances.at(-1)!;
  socket.onopen?.();
  socket.receive(room);
  await Promise.resolve();
  return socket;
}
async function drain() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

beforeEach(() => {
  Socket.instances = []; Connection.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('RTCPeerConnection', Connection);
  vi.stubGlobal('location', { href: 'https://quickdrop.example/', protocol: 'https:' });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  sessions.splice(0).forEach(session => session.destroy());
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('peer connection lifecycle', () => {
  it('preserves a healthy data channel and reclaims signaling with its secret resume token', async () => {
    vi.useFakeTimers();
    const app = setup(); const socket = await join(app.session);
    const resumeToken = crypto.randomUUID();
    socket.receive({ ...room, resumeToken });
    socket.receive({ type: 'PEER_JOINED', initiator: true }); await drain();
    const connection = Connection.instances[0]; connection.channel.onopen?.();
    expect(app.callbacks.status).toHaveBeenLastCalledWith('connected');
    const transfers = app.session.transfers;
    socket.close();
    expect(connection.close).not.toHaveBeenCalled();
    transfers!.sendText('survives signaling failure');
    expect(connection.channel.send).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    const resumed = Socket.instances.at(-1)!; expect(resumed).not.toBe(socket);
    resumed.onopen?.();
    expect(resumed.send).toHaveBeenCalledWith(expect.stringContaining(resumeToken));
    resumed.receive({ ...room, resumeToken, resumed: true });
    resumed.receive({ type: 'PEER_RESUMED', initiator: true }); await drain();
    expect(app.session.transfers).toBe(transfers);
    expect(Connection.instances).toHaveLength(1);
    expect(app.callbacks.status).toHaveBeenLastCalledWith('connected');
    expect(app.callbacks.error).not.toHaveBeenCalled();
  });

  it('ignores offers from an earlier negotiation epoch', async () => {
    const app = setup(); const socket = await join(app.session);
    const current = crypto.randomUUID();
    socket.receive({ type: 'PEER_JOINED', initiator: false, negotiationId: current }); await drain();
    socket.receive({ type: 'OFFER', negotiationId: crypto.randomUUID(), sdp: 'old-offer' }); await drain();
    expect(Connection.instances[0].setRemoteDescription).not.toHaveBeenCalled();
    socket.receive({ type: 'OFFER', negotiationId: current, sdp: 'current-offer' }); await drain();
    expect(Connection.instances[0].setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'current-offer' });
  });

  it('bounds repair attempts when the remote browser stays offline and the server cannot negotiate', async () => {
    vi.useFakeTimers();
    const app = setup(); const socket = await join(app.session);
    socket.receive({ ...room, resumeToken: crypto.randomUUID() });
    socket.receive({ type: 'PEER_JOINED', initiator: true }); await drain();
    const channel = Connection.instances[0].channel; channel.onopen?.();
    channel.readyState = 'closed'; channel.onclose?.();
    await vi.advanceTimersByTimeAsync(100000);
    expect(socket.send.mock.calls.filter(([message]) => JSON.parse(message).type === 'RECONNECT')).toHaveLength(3);
    expect(app.callbacks.status).toHaveBeenLastCalledWith('error');
    expect(app.callbacks.error).toHaveBeenCalledTimes(1);
  });
  it('renews temporary TURN credentials before every new peer negotiation', async () => {
    const fresh = { ...relay, iceServers: [{ urls: 'turns:relay.example:5349', username: 'fresh', credential: 'new-secret' }] };
    const refreshed = { ...fresh, iceServers: [{ ...fresh.iceServers[0], username: 'refreshed' }] };
    const request = vi.mocked(fetch).mockResolvedValueOnce(response(fresh)).mockResolvedValueOnce(response(refreshed));
    const app = setup(relay); const socket = await join(app.session);
    socket.receive({ type: 'PEER_JOINED', initiator: false });
    await vi.waitFor(() => expect(Connection.instances).toHaveLength(1));
    expect(Connection.instances[0].configuration.iceServers).toEqual(fresh.iceServers);
    socket.receive({ type: 'PEER_LEFT' });
    socket.receive({ type: 'PEER_JOINED', initiator: false });
    await vi.waitFor(() => expect(Connection.instances).toHaveLength(2));
    expect(Connection.instances[1].configuration.iceServers).toEqual(refreshed.iceServers);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('/api/config', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
    expect(app.callbacks.error.mock.calls).toHaveLength(1); // The expected PEER_LEFT notice.
  });

  it('negotiates without an extra HTTP request when only STUN is configured', async () => {
    const app = setup({ ...config, iceServers: [{ urls: 'stun:stun.example:3478' }] });
    const socket = await join(app.session);
    socket.receive({ type: 'PEER_JOINED', initiator: true });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'OFFER', sdp: 'offer' })));
    expect(fetch).not.toHaveBeenCalled();
    expect(app.callbacks.error).not.toHaveBeenCalled();
  });

  it('times out stalled room creation and ignores a late HTTP response', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const request = vi.mocked(fetch).mockReturnValue(pending.promise);
    const app = setup(); const start = app.session.start();
    await vi.advanceTimersByTimeAsync(15000);
    expect(app.callbacks.status).toHaveBeenLastCalledWith('error');
    expect((request.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    pending.resolve(Response.json({ ...room, ownerToken: 'owner' })); await start;
    expect(Socket.instances).toHaveLength(0);
    expect(app.callbacks.error).toHaveBeenCalledTimes(1);
  });

  it('does not create a connection when destroyed during a TURN refresh', async () => {
    const pending = deferred<Response>(); vi.mocked(fetch).mockReturnValue(pending.promise);
    const app = setup(relay); const socket = await join(app.session);
    socket.receive({ type: 'PEER_JOINED', initiator: false });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    app.session.destroy(); pending.resolve(response(relay)); await drain();
    expect(Connection.instances).toHaveLength(0);
    expect(app.callbacks.error).not.toHaveBeenCalled();
  });

  it('bounds TURN credential renewal by the negotiation timeout', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>(); const request = vi.mocked(fetch).mockReturnValue(pending.promise);
    const app = setup(relay); const socket = await join(app.session);
    socket.receive({ type: 'PEER_JOINED', initiator: false }); await drain();
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(app.callbacks.status).toHaveBeenLastCalledWith('error');
    expect((request.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    pending.resolve(response(relay)); await drain();
    expect(Connection.instances).toHaveLength(0);
  });

  it('stops pending negotiation when signaling fails before a resume token is issued', async () => {
    const pending = deferred<Response>(); vi.mocked(fetch).mockReturnValue(pending.promise);
    const app = setup(relay); const socket = await join(app.session);
    socket.receive({ type: 'PEER_JOINED', initiator: false });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    socket.receive(room); socket.close();
    pending.resolve(response(relay)); await drain();
    expect(Connection.instances).toHaveLength(0);
    expect(app.callbacks.status).toHaveBeenLastCalledWith('error');
    expect(app.callbacks.error).toHaveBeenCalledTimes(1);
  });

  it('fails cleanly when renewed TURN configuration is unavailable', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Unavailable', { status: 503 }));
    const app = setup(relay); const socket = await join(app.session);
    socket.receive({ type: 'PEER_JOINED', initiator: false });
    await vi.waitFor(() => expect(app.callbacks.status).toHaveBeenLastCalledWith('error'));
    expect(Connection.instances).toHaveLength(0);
    expect(socket.close).toHaveBeenCalled();
  });

  it('stops processing a pending offer when the session is destroyed', async () => {
    const app = setup(); const socket = await join(app.session);
    socket.receive({ type: 'PEER_JOINED', initiator: false });
    await vi.waitFor(() => expect(Connection.instances).toHaveLength(1));
    const connection = Connection.instances[0];
    const pending = deferred<void>();
    connection.setRemoteDescription.mockReturnValue(pending.promise);
    socket.receive({ type: 'OFFER', sdp: 'remote-offer' });
    await vi.waitFor(() => expect(connection.setRemoteDescription).toHaveBeenCalled());
    app.session.destroy(); pending.resolve(); await drain();
    expect(connection.createAnswer).not.toHaveBeenCalled();
    expect(connection.setLocalDescription).not.toHaveBeenCalled();
    expect(app.callbacks.error).not.toHaveBeenCalled();
  });
});
