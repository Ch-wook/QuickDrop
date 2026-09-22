import type { ClientSignal, CreatedRoom, PublicConfig, RoomInfo, ServerSignal, Transfer } from '../shared/protocol';
import { Transfers } from './transfers';

export type ConnectionStatus = 'starting' | 'waiting' | 'connecting' | 'connected' | 'disconnected' | 'expired' | 'error';
type Callbacks = {
  status: (status: ConnectionStatus) => void;
  room: (room: RoomInfo) => void;
  transfers: (items: Transfer[]) => void;
  error: (message: string) => void;
};
export class PeerSession {
  private ws?: WebSocket;
  private pc?: RTCPeerConnection;
  private candidates: RTCIceCandidateInit[] = [];
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private socketTimer?: ReturnType<typeof setTimeout>;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private channelLossTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private terminal = false;
  private signalChain = Promise.resolve();
  private abort = new AbortController();
  transfers?: Transfers;
  constructor(private config: PublicConfig, private callbacks: Callbacks) {}

  async start(target?: { roomId?: string; code?: string }) {
    this.callbacks.status('starting');
    try {
      if (!globalThis.RTCPeerConnection || !globalThis.crypto?.randomUUID) throw new Error('이 브라우저에서는 연결을 시작할 수 없습니다. HTTPS 주소와 최신 브라우저를 사용하세요.');
      let join: Extract<ClientSignal, { type: 'JOIN' }>;
      if (target) join = { type: 'JOIN', ...target };
      else {
        const response = await fetch('/api/rooms', { method: 'POST', signal: this.abort.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '세션을 만들 수 없습니다.');
        const room = result as CreatedRoom;
        join = { type: 'JOIN', roomId: room.roomId, ownerToken: room.ownerToken };
      }
      if (this.closed) return;
      const url = new URL('/ws', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = this.ws = new WebSocket(url);
      this.socketTimer = setTimeout(() => this.fail('연결 서버 응답 시간이 초과되었습니다. 다시 시도하세요.'), 15000);
      ws.onopen = () => this.signal(join);
      ws.onmessage = event => {
        this.signalChain = this.signalChain.then(async () => {
          if (!this.closed && !this.terminal) await this.handleSignal(JSON.parse(event.data));
        }).catch(() => this.fail('기기 간 직접 연결에 실패했습니다. 네트워크 환경을 확인하고 다시 시도하세요.'));
      };
      ws.onerror = () => this.fail('연결 서버에 접속할 수 없습니다. 네트워크를 확인하세요.');
      ws.onclose = () => {
        clearTimeout(this.socketTimer);
        if (this.closed || this.terminal) return;
        this.resetConnection(); this.callbacks.status('disconnected');
        this.callbacks.error('서버 연결이 끊겼습니다. 새 연결을 시작하세요.');
      };
    } catch (error) {
      if (!this.closed) this.fail(error instanceof Error ? error.message : '연결을 시작할 수 없습니다.');
    }
  }
  private signal(message: ClientSignal) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
  private async handleSignal(message: ServerSignal) {
    switch (message.type) {
      case 'JOINED':
        clearTimeout(this.socketTimer); this.callbacks.room(message); this.callbacks.status('waiting'); break;
      case 'PEER_JOINED': {
        this.resetConnection();
        this.callbacks.status('connecting');
        const pc = this.pc = new RTCPeerConnection({ iceServers: this.config.iceServers });
        this.connectionTimer = setTimeout(() => this.fail('기기 간 직접 연결에 실패했습니다. 네트워크를 확인하고 다시 시도하세요. 일부 네트워크에는 TURN 서버가 필요합니다.'), 30000);
        pc.onicecandidate = event => { if (event.candidate && this.pc === pc) this.signal({ type: 'ICE_CANDIDATE', candidate: event.candidate.toJSON() as RTCIceCandidateInit & { candidate: string } }); };
        pc.onconnectionstatechange = () => {
          if (this.pc !== pc) return;
          if (pc.connectionState === 'failed') this.connectionLost(pc);
          if (pc.connectionState === 'disconnected') {
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = setTimeout(() => { if (pc.connectionState === 'disconnected') this.fail('상대 기기의 연결이 끊겼습니다.'); }, 8000);
          } else clearTimeout(this.disconnectTimer);
        };
        pc.ondatachannel = event => this.attachChannel(event.channel, pc);
        if (message.initiator) {
          this.attachChannel(pc.createDataChannel('quickdrop', { ordered: true }), pc);
          await pc.setLocalDescription(await pc.createOffer());
          if (this.pc === pc) this.signal({ type: 'OFFER', sdp: pc.localDescription!.sdp });
        }
        break;
      }
      case 'OFFER':
      case 'ANSWER': {
        const pc = this.pc;
        if (!pc) throw new Error('No connection');
        await pc.setRemoteDescription({ type: message.type === 'OFFER' ? 'offer' : 'answer', sdp: message.sdp });
        for (const candidate of this.candidates.splice(0)) await pc.addIceCandidate(candidate);
        if (message.type === 'OFFER') {
          await pc.setLocalDescription(await pc.createAnswer());
          if (this.pc === pc) this.signal({ type: 'ANSWER', sdp: pc.localDescription!.sdp });
        }
        break;
      }
      case 'ICE_CANDIDATE':
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(message.candidate);
        else if (this.candidates.length < 100) this.candidates.push(message.candidate);
        break;
      case 'PEER_LEFT':
        this.resetConnection(); this.callbacks.status('waiting');
        this.callbacks.error('상대 기기가 나갔습니다. 같은 QR 또는 코드로 다시 연결할 수 있습니다.'); break;
      case 'ROOM_EXPIRED':
        this.terminal = true; this.resetConnection(); this.callbacks.status('expired');
        this.callbacks.error('연결 대기 시간이 만료되었습니다. 새 연결을 시작하세요.'); break;
      case 'ERROR': this.fail(message.message); break;
    }
  }
  private attachChannel(channel: RTCDataChannel, pc: RTCPeerConnection) {
    channel.onopen = () => {
      if (this.closed || this.pc !== pc) { channel.close(); return; }
      clearTimeout(this.connectionTimer);
      this.transfers?.destroy();
      this.transfers = new Transfers(channel, this.config, this.callbacks.transfers, this.callbacks.error);
      this.callbacks.status('connected');
    };
    channel.onclose = () => this.connectionLost(pc);
    channel.onerror = () => this.connectionLost(pc);
  }
  private connectionLost(pc: RTCPeerConnection) {
    if (this.closed || this.pc !== pc || this.channelLossTimer) return;
    this.transfers?.disconnect();
    this.callbacks.status('disconnected');
    // Browsers may report SCTP closure before signaling delivers PEER_LEFT.
    // Keep the room alive briefly so a normal departure returns to waiting.
    this.channelLossTimer = setTimeout(() => {
      this.channelLossTimer = undefined;
      if (this.pc === pc) this.fail('상대 기기와의 전송 연결이 종료되었습니다. 새 연결을 시작하세요.');
    }, 1500);
  }
  private resetConnection() {
    clearTimeout(this.connectionTimer); clearTimeout(this.disconnectTimer);
    clearTimeout(this.channelLossTimer); this.channelLossTimer = undefined;
    const pc = this.pc; this.pc = undefined; pc?.close();
    this.candidates = []; this.transfers?.disconnect();
  }
  private fail(message: string) {
    if (this.closed || this.terminal) return;
    this.terminal = true; clearTimeout(this.socketTimer);
    this.resetConnection(); this.ws?.close();
    this.callbacks.status('error'); this.callbacks.error(message);
  }
  destroy() {
    this.closed = true; this.abort.abort(); clearTimeout(this.socketTimer);
    this.resetConnection(); this.ws?.close(); this.transfers?.destroy();
  }
}
