import type { ClientSignal, CreatedRoom, PublicConfig, RoomInfo, ServerSignal, Transfer } from '../shared/protocol';
import { Transfers } from './transfers';
import { deviceId, PairHistory } from './history';

export type ConnectionStatus = 'starting' | 'waiting' | 'connecting' | 'connected' | 'recovering' | 'disconnected' | 'expired' | 'error';
type Callbacks = { status: (status: ConnectionStatus) => void; room: (room: RoomInfo) => void; transfers: (items: Transfer[]) => void; error: (message: string) => void; historyWarning?: (message: string) => void; pair?: (id: string | undefined) => void };
export class PeerSession {
  private ws?: WebSocket;
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private candidates: RTCIceCandidateInit[] = [];
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private socketTimer?: ReturnType<typeof setTimeout>;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private repairTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private terminal = false;
  private joined = false;
  private retry = 0;
  private recoveryStarted = 0;
  private repairs = 0;
  private negotiationId?: string;
  private join?: Extract<ClientSignal, { type: 'JOIN' }>;
  private signalChain = Promise.resolve();
  private abort = new AbortController();
  private device = '';
  private pairId?: string;
  private history?: PairHistory;
  private records: Transfer[] = [];
  transfers?: Transfers;
  constructor(private config: PublicConfig, private callbacks: Callbacks) {}

  async start(target?: { roomId?: string; code?: string }) {
    if (this.closed || this.terminal) return;
    this.callbacks.status('starting');
    this.socketTimer = setTimeout(() => this.fail('연결 서버 응답 시간이 초과되었습니다. 다시 시도하세요.'), 15000);
    try {
      if (!globalThis.RTCPeerConnection || !globalThis.crypto?.randomUUID) throw new Error('이 브라우저에서는 연결을 시작할 수 없습니다. HTTPS 주소와 최신 브라우저를 사용하세요.');
      this.device = deviceId();
      if (target) this.join = { type: 'JOIN', ...target, deviceId: this.device };
      else {
        const response = await fetch('/api/rooms', { method: 'POST', signal: this.abort.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '세션을 만들 수 없습니다.');
        const room = result as CreatedRoom;
        this.join = { type: 'JOIN', roomId: room.roomId, ownerToken: room.ownerToken, deviceId: this.device };
      }
      if (!this.closed && !this.terminal) this.openSocket();
    } catch (error) { if (!this.closed) this.fail(error instanceof Error ? error.message : '연결을 시작할 수 없습니다.'); }
  }
  private healthy() { return this.channel?.readyState === 'open' && this.pc?.connectionState !== 'failed'; }
  private openSocket() {
    if (this.closed || this.terminal) return;
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    const url = new URL('/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.joined = false;
    const ws = this.ws = new WebSocket(url);
    ws.onopen = () => { if (this.ws === ws && this.join) ws.send(JSON.stringify(this.join)); };
    ws.onmessage = event => {
      this.signalChain = this.signalChain.then(async () => {
        if (!this.closed && !this.terminal && this.ws === ws) await this.handleSignal(JSON.parse(event.data));
      }).catch(() => this.fail('기기 간 직접 연결에 실패했습니다. 네트워크 환경을 확인하고 다시 시도하세요.'));
    };
    ws.onerror = () => { if (this.ws === ws) ws.close(); };
    ws.onclose = () => {
      if (this.ws !== ws || this.closed || this.terminal) return;
      clearTimeout(this.socketTimer); this.joined = false;
      if (!this.join?.resumeToken) { this.fail('연결 서버에 접속할 수 없습니다. 네트워크를 확인하세요.'); return; }
      if (!this.healthy()) this.callbacks.status('recovering');
      this.scheduleSocketRetry();
    };
    if (this.join?.resumeToken) this.socketTimer = setTimeout(() => { if (!this.joined && this.ws === ws) ws.close(); }, 10000);
  }
  private scheduleSocketRetry() {
    if (this.retryTimer || this.closed || this.terminal) return;
    this.recoveryStarted ||= Date.now();
    if (Date.now() - this.recoveryStarted > 110000) { this.fail('자동 복구 시간이 지났습니다. 네트워크를 확인하고 새 연결을 시작하세요.'); return; }
    const delay = Math.min(10000, 500 * 2 ** Math.min(this.retry++, 5)) + Math.random() * 250;
    this.retryTimer = setTimeout(() => this.openSocket(), delay);
  }
  private signal(message: ClientSignal) {
    if (this.joined && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
  wake() {
    if (this.closed || this.terminal) return;
    if (this.ws?.readyState !== WebSocket.OPEN) {
      if (this.ws?.readyState !== WebSocket.CONNECTING && this.join?.resumeToken) this.openSocket();
    } else if (this.pc && !this.healthy() && ['failed', 'disconnected', 'closed'].includes(this.pc.connectionState)) this.requestRepair();
  }
  private requestRepair() {
    if (this.closed || this.terminal || this.repairTimer) return;
    this.callbacks.status('recovering');
    this.repairTimer = setTimeout(() => {
      this.repairTimer = undefined;
      if (!this.joined || this.ws?.readyState !== WebSocket.OPEN) { this.wake(); return; }
      if (++this.repairs > 3) { this.fail('직접 연결을 복구할 수 없습니다. 네트워크를 확인하고 새 연결을 시작하세요. 일부 네트워크에는 TURN 서버가 필요합니다.'); return; }
      this.signal({ type: 'RECONNECT' });
      // The other browser may still be offline, so the server cannot start a
      // negotiation yet. Bound that wait even if no response arrives.
      clearTimeout(this.connectionTimer);
      this.connectionTimer = setTimeout(() => this.requestRepair(), 30000);
    }, 1500);
  }
  private publish = (items: Transfer[]) => {
    this.records = items; this.history?.save(items); this.callbacks.transfers(items);
  };
  private releaseUrls(items: Transfer[]) { items.forEach(item => { if (item.url) URL.revokeObjectURL(item.url); }); }
  private async selectHistory(peerDeviceId?: string) {
    const pairId = peerDeviceId ? `${this.device}:${peerDeviceId}` : undefined;
    if (pairId === this.pairId) return;
    this.releaseUrls(this.records); this.records = []; this.pairId = pairId;
    this.history = pairId ? new PairHistory(pairId, this.callbacks.historyWarning || this.callbacks.error) : undefined;
    const records = this.history ? await this.history.load() : [];
    if (this.closed || this.terminal) { this.releaseUrls(records); return; }
    this.records = records; this.history?.remember(records); this.callbacks.pair?.(pairId); this.callbacks.transfers(records);
  }
  private async handleSignal(message: ServerSignal) {
    switch (message.type) {
      case 'JOINED':
        clearTimeout(this.socketTimer); this.joined = true; this.retry = 0; this.recoveryStarted = 0;
        this.join = { type: 'JOIN', roomId: message.roomId, deviceId: this.device, resumeToken: message.resumeToken };
        this.callbacks.room(message);
        this.callbacks.status(this.healthy() ? 'connected' : this.pc ? 'recovering' : 'waiting');
        break;
      case 'PEER_RESUMED':
        if (this.healthy()) this.callbacks.status('connected'); else this.requestRepair();
        break;
      case 'PEER_JOINED': {
        const recovering = !!this.pc;
        this.resetConnection(); this.negotiationId = message.negotiationId;
        this.callbacks.status(recovering ? 'recovering' : 'connecting');
        this.connectionTimer = setTimeout(() => {
          if (recovering) this.requestRepair();
          else this.fail('기기 간 직접 연결에 실패했습니다. 네트워크를 확인하고 다시 시도하세요. 일부 네트워크에는 TURN 서버가 필요합니다.');
        }, 30000);
        await this.selectHistory(message.peerDeviceId);
        if (this.config.iceServers.some(server => [server.urls].flat().some(url => /^turns?:/i.test(url)))) {
          const response = await fetch('/api/config', { cache: 'no-store', signal: this.abort.signal });
          if (!response.ok) throw new Error('연결 설정을 새로 불러올 수 없습니다.');
          this.config = await response.json();
        }
        if (this.closed || this.terminal) return;
        const pc = this.pc = new RTCPeerConnection({ iceServers: this.config.iceServers });
        const negotiationId = this.negotiationId;
        pc.onicecandidate = event => { if (event.candidate && this.pc === pc) this.signal({ type: 'ICE_CANDIDATE', negotiationId, candidate: event.candidate.toJSON() as RTCIceCandidateInit & { candidate: string } }); };
        pc.onconnectionstatechange = () => {
          if (this.pc !== pc) return;
          if (pc.connectionState === 'failed') this.connectionLost(pc);
          if (pc.connectionState === 'disconnected') {
            this.callbacks.status('recovering'); clearTimeout(this.disconnectTimer);
            this.disconnectTimer = setTimeout(() => { if (this.pc === pc && pc.connectionState === 'disconnected') this.connectionLost(pc); }, 30000);
          } else {
            clearTimeout(this.disconnectTimer);
            if (pc.connectionState === 'connected' && this.healthy()) this.callbacks.status('connected');
          }
        };
        pc.ondatachannel = event => this.attachChannel(event.channel, pc);
        if (message.initiator) {
          this.attachChannel(pc.createDataChannel('quickdrop', { ordered: true }), pc);
          const offer = await pc.createOffer(); if (this.pc !== pc) return;
          await pc.setLocalDescription(offer);
          if (this.pc === pc) this.signal({ type: 'OFFER', negotiationId, sdp: pc.localDescription!.sdp });
        }
        break;
      }
      case 'OFFER':
      case 'ANSWER': {
        if (message.negotiationId !== this.negotiationId) return;
        const pc = this.pc; if (!pc) return;
        await pc.setRemoteDescription({ type: message.type === 'OFFER' ? 'offer' : 'answer', sdp: message.sdp });
        if (this.pc !== pc) return;
        for (const candidate of this.candidates.splice(0)) { await pc.addIceCandidate(candidate); if (this.pc !== pc) return; }
        if (message.type === 'OFFER') {
          const answer = await pc.createAnswer(); if (this.pc !== pc) return;
          await pc.setLocalDescription(answer);
          if (this.pc === pc) this.signal({ type: 'ANSWER', negotiationId: this.negotiationId, sdp: pc.localDescription!.sdp });
        }
        break;
      }
      case 'ICE_CANDIDATE':
        if (message.negotiationId !== this.negotiationId) return;
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(message.candidate);
        else if (this.candidates.length < 100) this.candidates.push(message.candidate);
        break;
      case 'PEER_LEFT':
        this.resetConnection(); this.repairs = 0; this.callbacks.status('waiting');
        this.callbacks.error('상대 기기가 나갔습니다. 같은 QR 또는 코드로 다시 연결할 수 있습니다.'); break;
      case 'ROOM_EXPIRED': this.fail('연결 대기 시간이 만료되었습니다. 새 연결을 시작하세요.', 'expired'); break;
      case 'ERROR': this.fail(message.message); break;
    }
  }
  private attachChannel(channel: RTCDataChannel, pc: RTCPeerConnection) {
    this.channel = channel;
    channel.onopen = () => {
      if (this.closed || this.pc !== pc) { channel.close(); return; }
      clearTimeout(this.connectionTimer); clearTimeout(this.repairTimer); this.repairTimer = undefined; this.repairs = 0;
      this.transfers = new Transfers(channel, this.config, this.publish, this.callbacks.error, this.records);
      this.callbacks.status('connected');
    };
    channel.onclose = () => this.connectionLost(pc); channel.onerror = () => this.connectionLost(pc);
  }
  private connectionLost(pc: RTCPeerConnection) {
    if (this.closed || this.terminal || this.pc !== pc) return;
    this.transfers?.disconnect(); this.requestRepair();
  }
  private resetConnection() {
    clearTimeout(this.connectionTimer); clearTimeout(this.disconnectTimer); clearTimeout(this.repairTimer); this.repairTimer = undefined;
    const pc = this.pc; this.pc = undefined; this.channel = undefined; pc?.close(); this.candidates = [];
    if (this.transfers) { this.records = this.transfers.takeHistory(); this.transfers = undefined; }
  }
  clearHistory() {
    if (this.transfers) this.transfers.clearHistory(); else { this.releaseUrls(this.records); this.publish([]); }
  }
  private fail(message: string, status: ConnectionStatus = 'error') {
    if (this.closed || this.terminal) return;
    this.signal({ type: 'LEAVE' }); this.terminal = true; this.abort.abort();
    clearTimeout(this.socketTimer); clearTimeout(this.retryTimer); this.resetConnection(); this.ws?.close();
    this.callbacks.status(status); this.callbacks.error(message);
  }
  destroy() {
    if (this.closed) return;
    this.signal({ type: 'LEAVE' }); this.closed = true; this.abort.abort();
    clearTimeout(this.socketTimer); clearTimeout(this.retryTimer); this.resetConnection(); this.ws?.close();
    this.releaseUrls(this.records); this.records = [];
  }
}
