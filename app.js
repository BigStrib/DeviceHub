/* ========================================
   DeviceHub - Host/Guest with Login Page
   Main user (host) controls all sources
======================================== */

// ---------- Global Config ----------
const CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ],
    resolutions: {
        '480': { width: 854, height: 480 },
        '720': { width: 1280, height: 720 },
        '1080': { width: 1920, height: 1080 }
    },
    defaultSize: { width: 400, height: 225 },
    minSize: { width: 120, height: 68 }
};

// ---------- App State ----------
const State = {
    peer: null,
    peerId: null,
    roomId: null,
    isHost: false,
    hostPeerId: null,
    hostConnection: null,
    connections: new Map(),   // host: guestId -> { data, info }, guest: just hostConnection
    pendingSources: new Map(),// host: sourceId -> {stream, type, peerId, deviceInfo, call}
    localSources: new Map(),  // guest: sourceId -> {stream, type, status}
    videoBoxes: new Map(),    // boxId -> {el, video, stream, sourceId, peerId, opts}
    boxCounter: 0,
    settings: {
        resolution: '720',
        frameRate: 30,
        showLabels: true,
        showBorders: true,
        roundedCorners: true,
        lockRatio: true,
        bgColor: '#0a0a0a'
    },
    interaction: null         // drag/resize state
};

// ---------- Helpers ----------
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const Utils = {
    genId(len = 6) {
        const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let r = '';
        for (let i = 0; i < len; i++) r += c[Math.floor(Math.random() * c.length)];
        return r;
    },
    // Room code: 6 chars, shown as XXX-XXX
    genRoomId() {
        return this.genId(3) + this.genId(3);
    },
    cleanRoomId(id) {
        return id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    },
    formatRoomId(id) {
        const clean = this.cleanRoomId(id);
        if (clean.length <= 3) return clean;
        return clean.slice(0, 3) + '-' + clean.slice(3);
    },
    roomToPeerId(roomId) {
        return 'devhub-' + this.cleanRoomId(roomId);
    },
    shareUrl(roomId) {
        const code = this.formatRoomId(roomId);
        return `${location.origin}${location.pathname}?room=${code}`;
    },
    async copy(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            const t = document.createElement('textarea');
            t.value = text;
            t.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(t);
            t.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(t);
            return ok;
        }
    },
    deviceInfo() {
        const ua = navigator.userAgent;
        if (/iPad/i.test(ua)) return { type: 'iPad', icon: 'fa-tablet-alt' };
        if (/iPhone/i.test(ua)) return { type: 'iPhone', icon: 'fa-mobile-alt' };
        if (/Android.*Mobile/i.test(ua)) return { type: 'Android Phone', icon: 'fa-mobile-alt' };
        if (/Android/i.test(ua)) return { type: 'Android Tablet', icon: 'fa-tablet-alt' };
        if (/Mac/i.test(ua)) return { type: 'Mac', icon: 'fa-desktop' };
        if (/Windows/i.test(ua)) return { type: 'Windows', icon: 'fa-desktop' };
        return { type: 'Device', icon: 'fa-desktop' };
    },
    getPointer(e) {
        return {
            x: e.clientX ?? e.touches?.[0]?.clientX ?? 0,
            y: e.clientY ?? e.touches?.[0]?.clientY ?? 0
        };
    },
    clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }
};

// ---------- Inject Extra CSS (login, host panel, guest UI) ----------
function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* Login Screen */
        .login-screen {
            position: fixed;
            inset: 0;
            background: var(--bg-color);
            z-index: 500;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .login-card {
            width: 100%;
            max-width: 520px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            padding: 24px 24px 20px;
        }
        .login-header {
            text-align: center;
            margin-bottom: 20px;
        }
        .login-logo {
            width: 60px;
            height: 60px;
            margin: 0 auto 12px;
            border-radius: 50%;
            background: var(--accent-light);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--accent);
            font-size: 26px;
        }
        .login-header h1 {
            font-size: 20px;
            margin-bottom: 4px;
        }
        .login-header p {
            font-size: 13px;
            color: var(--text-secondary);
        }
        .login-body {
            display: grid;
            grid-template-columns: 1.1fr 0.2fr 1fr;
            gap: 12px;
            align-items: flex-start;
        }
        .login-col {
            padding: 8px 0;
        }
        .login-col h2 {
            font-size: 14px;
            margin-bottom: 4px;
        }
        .login-col p {
            font-size: 12px;
            color: var(--text-secondary);
            margin-bottom: 10px;
        }
        .login-divider {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            color: var(--text-muted);
        }
        .login-divider::before,
        .login-divider::after {
            content: "";
            flex: 1;
            height: 1px;
            background: var(--border);
            margin: 0 6px;
        }
        .login-input-row {
            display: flex;
            gap: 6px;
            margin-bottom: 10px;
        }
        .login-input {
            flex: 1;
            padding: 10px 12px;
            background: var(--bg-color);
            border: 2px solid var(--border);
            border-radius: var(--radius);
            color: var(--text);
            font-size: 15px;
            font-weight: 600;
            letter-spacing: 3px;
            text-transform: uppercase;
            text-align: center;
        }
        .login-input::placeholder {
            font-weight: 400;
            letter-spacing: normal;
        }
        .login-input:focus {
            outline: none;
            border-color: var(--accent);
        }
        .login-gen-btn {
            width: 44px;
            border: none;
            border-radius: var(--radius);
            background: var(--surface-hover);
            color: var(--text-secondary);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all var(--transition);
        }
        .login-gen-btn:hover {
            background: var(--surface-active);
            color: var(--text);
        }
        .login-btn {
            width: 100%;
            border: none;
            border-radius: var(--radius);
            padding: 10px 14px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: all var(--transition);
        }
        .login-btn.primary {
            background: var(--accent);
            color: #fff;
        }
        .login-btn.primary:hover {
            background: var(--accent-hover);
        }
        .login-btn.secondary {
            background: var(--surface-hover);
            color: var(--text);
        }
        .login-btn.secondary:hover {
            background: var(--surface-active);
        }
        .login-error {
            margin-top: 10px;
            padding: 8px 10px;
            border-radius: var(--radius);
            font-size: 12px;
            color: var(--danger);
            border: 1px solid var(--danger);
            background: rgba(220, 38, 38, 0.1);
            display: none;
        }
        .login-error.show { display: block; }
        
        @media (max-width: 600px) {
            .login-card {
                max-width: 360px;
                padding: 20px 16px 16px;
            }
            .login-body {
                grid-template-columns: 1fr;
                gap: 16px;
            }
            .login-divider {
                order: 2;
            }
        }

        /* Host panel & guest UI styles (simplified) */
        .host-panel.hidden { display: none; }
        .host-panel {
            position: fixed;
            top: 64px;
            left: 16px;
            width: 320px;
            max-width: calc(100vw - 32px);
            max-height: calc(100vh - 120px);
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            z-index: 250;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .host-panel .panel-header,
        .host-panel .panel-tabs,
        .host-panel .panel-body {
            /* already defined above */
        }
        .tab-content { display: none; }
        .tab-content.active { display: block; }

        .empty-state {
            text-align: center;
            padding: 24px 12px;
            color: var(--text-muted);
        }
        .empty-state i {
            font-size: 28px;
            margin-bottom: 8px;
            opacity: 0.4;
        }
        .empty-state p {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 4px;
        }
        .empty-state span {
            font-size: 11px;
        }

        /* Guest overlay */
        .guest-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.8);
            backdrop-filter: blur(4px);
            z-index: 450;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .guest-overlay.hidden { display: none; }
        .guest-card {
            width: 100%;
            max-width: 380px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            overflow: hidden;
        }
        .guest-header {
            padding: 18px 20px;
            border-bottom: 1px solid var(--border);
            text-align: center;
        }
        .guest-header h2 {
            font-size: 16px;
            margin-bottom: 4px;
        }
        .guest-header p {
            font-size: 13px;
            color: var(--text-secondary);
        }
        .guest-room-info {
            margin-top: 8px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 999px;
            background: var(--surface-hover);
            font-size: 12px;
        }
        .guest-room-info i {
            color: var(--success);
        }
        .guest-room-id {
            font-family: monospace;
            font-weight: 700;
            letter-spacing: 1px;
            color: var(--accent);
        }
        .guest-body {
            padding: 16px 18px 18px;
        }
        #guest-status {
            text-align: center;
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 12px;
        }
        #guest-status.hidden { display: none; }
        #guest-status i {
            display: block;
            margin-bottom: 6px;
        }
        .guest-options {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 10px;
        }
        .guest-option-btn {
            padding: 18px 12px;
            border-radius: var(--radius);
            border: 2px solid var(--border);
            background: var(--surface-hover);
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            font-weight: 600;
            color: var(--text);
            transition: all var(--transition);
        }
        .guest-option-btn i {
            font-size: 20px;
            color: var(--accent);
        }
        .guest-option-btn:hover {
            border-color: var(--accent);
            background: var(--accent-light);
        }
        .guest-option-btn:disabled {
            opacity: 0.5;
            pointer-events: none;
        }
        .my-sources-title {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-muted);
            margin-top: 10px;
            margin-bottom: 8px;
        }
        .my-source {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            border-radius: var(--radius);
            background: var(--surface-hover);
            margin-bottom: 6px;
        }
        .my-source-icon {
            width: 26px;
            height: 26px;
            border-radius: 50%;
            background: var(--accent-light);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--accent);
            font-size: 12px;
        }
        .my-source-info { flex: 1; }
        .my-source-name {
            font-size: 12px;
            font-weight: 600;
        }
        .my-source-status {
            font-size: 10px;
            color: var(--text-secondary);
        }
        .my-source-status.live {
            color: var(--success);
        }
        .my-source-stop {
            width: 24px;
            height: 24px;
            border-radius: 6px;
            border: none;
            background: var(--danger);
            color: #fff;
            font-size: 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all var(--transition);
        }
        .my-source-stop:hover {
            background: var(--danger-hover);
            transform: scale(1.05);
        }

        /* Guest mode: hide host UI */
        body.guest-mode .toolbar,
        body.guest-mode .room-badge,
        body.guest-mode .status-badge,
        body.guest-mode #source-modal,
        body.guest-mode #connect-modal,
        body.guest-mode #settings-modal {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
}

// ---------- Toast ----------
const Toast = {
    show(msg, type = 'info', dur = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-times-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `
            <span class="toast-icon"><i class="fas ${icons[type]}"></i></span>
            <span class="toast-text">${msg}</span>
            <button class="toast-close"><i class="fas fa-times"></i></button>
        `;
        container.appendChild(t);
        t.querySelector('.toast-close').onclick = () => this.dismiss(t);
        if (dur > 0) setTimeout(() => this.dismiss(t), dur);
    },
    dismiss(t) {
        if (!t?.parentNode) return;
        t.classList.add('fade-out');
        setTimeout(() => t.remove(), 250);
    },
    success(m) { this.show(m, 'success'); },
    error(m)   { this.show(m, 'error'); },
    warning(m) { this.show(m, 'warning'); },
    info(m)    { this.show(m, 'info'); }
};

// ---------- Login UI ----------
const LoginUI = {
    el: null,
    init() {
        this.el = document.createElement('div');
        this.el.className = 'login-screen';
        this.el.innerHTML = `
            <div class="login-card">
                <div class="login-header">
                    <div class="login-logo">
                        <i class="fas fa-broadcast-tower"></i>
                    </div>
                    <h1>DeviceHub</h1>
                    <p>Host controls the wall, devices submit sources</p>
                </div>
                <div class="login-body">
                    <div class="login-col">
                        <h2>Host</h2>
                        <p>Create a room and control all sources</p>
                        <div class="login-input-row">
                            <input id="host-room-input" class="login-input" placeholder="ROOM ID" autocomplete="off">
                            <button id="gen-room-btn" class="login-gen-btn" title="Generate">
                                <i class="fas fa-sync"></i>
                            </button>
                        </div>
                        <button id="start-host-btn" class="login-btn primary">
                            <i class="fas fa-play"></i>
                            Start Session
                        </button>
                    </div>
                    <div class="login-divider">or</div>
                    <div class="login-col">
                        <h2>Join</h2>
                        <p>Connect this device to a host</p>
                        <input id="guest-room-input" class="login-input" placeholder="ROOM ID" autocomplete="off">
                        <button id="join-guest-btn" class="login-btn secondary">
                            <i class="fas fa-sign-in-alt"></i>
                            Join Room
                        </button>
                    </div>
                </div>
                <div id="login-error" class="login-error"></div>
            </div>
        `;
        document.body.appendChild(this.el);
        this.bindEvents();
    },
    bindEvents() {
        const hostInput  = $('host-room-input');
        const guestInput = $('guest-room-input');
        const genBtn     = $('gen-room-btn');
        const hostBtn    = $('start-host-btn');
        const guestBtn   = $('join-guest-btn');
        const errorEl    = $('login-error');

        const formatInput = (input) => {
            let val = Utils.cleanRoomId(input.value);
            input.value = Utils.formatRoomId(val);
        };

        hostInput.addEventListener('input', () => formatInput(hostInput));
        guestInput.addEventListener('input', () => formatInput(guestInput));

        genBtn.onclick = () => {
            const id = Utils.genRoomId();
            hostInput.value = Utils.formatRoomId(id);
        };

        hostBtn.onclick = () => {
            errorEl.classList.remove('show');
            let id = hostInput.value.trim();
            if (!id) id = Utils.genRoomId();
            const clean = Utils.cleanRoomId(id);
            if (clean.length < 6) {
                errorEl.textContent = 'Room ID must be 6 characters (letters/numbers)';
                errorEl.classList.add('show');
                return;
            }
            State.roomId = clean;
            this.hide();
            App.startAsHost();
        };

        guestBtn.onclick = () => {
            errorEl.classList.remove('show');
            const id = guestInput.value.trim();
            const clean = Utils.cleanRoomId(id);
            if (clean.length < 6) {
                errorEl.textContent = 'Enter the 6‑character room ID from the host';
                errorEl.classList.add('show');
                return;
            }
            State.roomId = clean;
            this.hide();
            App.startAsGuest();
        };

        guestInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') guestBtn.click();
        });
        hostInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') hostBtn.click();
        });
    },
    hide() {
        this.el.style.display = 'none';
    },
    showError(msg) {
        const errorEl = $('login-error');
        errorEl.textContent = msg;
        errorEl.classList.add('show');
    }
};

// ---------- Media ----------
const Media = {
    async getCamera() {
        const res = CONFIG.resolutions[State.settings.resolution] || CONFIG.resolutions['720'];
        try {
            return await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: res.width },
                    height: { ideal: res.height },
                    frameRate: { ideal: State.settings.frameRate }
                },
                audio: true
            });
        } catch (err) {
            console.error('getUserMedia error:', err);
            Toast.error('Cannot access camera/microphone');
            return null;
        }
    },
    async getWindow() {
        try {
            return await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: false
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('getDisplayMedia error:', err);
                Toast.error('Cannot share window');
            }
            return null;
        }
    }
};

// ---------- Connection ----------
const Connection = {
    async initHost() {
        return new Promise((resolve, reject) => {
            const hostId = Utils.roomToPeerId(State.roomId);
            console.log('Host PeerID:', hostId);

            State.peer = new Peer(hostId, {
                debug: 2,
                config: { iceServers: CONFIG.iceServers }
            });

            const timer = setTimeout(() => reject(new Error('Timeout')), 15000);

            State.peer.on('open', id => {
                clearTimeout(timer);
                State.peerId = id;
                console.log('Host ready', id);
                resolve(id);
            });

            State.peer.on('error', err => {
                clearTimeout(timer);
                console.error('Host peer error:', err);
                if (err.type === 'unavailable-id') {
                    reject(new Error('This room is already in use'));
                } else {
                    reject(err);
                }
            });

            State.peer.on('connection', conn => this.handleGuestConnection(conn));
            State.peer.on('call', call => this.handleGuestCall(call));
        });
    },

    async initGuest() {
        return new Promise((resolve, reject) => {
            State.peer = new Peer({
                debug: 2,
                config: { iceServers: CONFIG.iceServers }
            });

            const timer = setTimeout(() => reject(new Error('Timeout')), 15000);

            State.peer.on('open', id => {
                clearTimeout(timer);
                State.peerId = id;
                console.log('Guest peer ready', id);
                resolve(id);
            });

            State.peer.on('error', err => {
                clearTimeout(timer);
                console.error('Guest peer error:', err);
                reject(err);
            });

            State.peer.on('call', call => {
                // Guests do not receive streams; host is display side
                call.answer(); // answer with no stream
                call.close();
            });
        });
    },

    async connectToHost() {
        return new Promise((resolve, reject) => {
            const hostId = Utils.roomToPeerId(State.roomId);
            State.hostPeerId = hostId;
            console.log('Connecting to host:', hostId);

            const conn = State.peer.connect(hostId, {
                reliable: true,
                metadata: { deviceInfo: Utils.deviceInfo() }
            });

            const timer = setTimeout(() => reject(new Error('Host not found')), 15000);

            conn.on('open', () => {
                clearTimeout(timer);
                State.hostConnection = conn;
                console.log('Connected to host');

                conn.send({
                    type: 'guest-info',
                    deviceInfo: Utils.deviceInfo()
                });

                conn.on('data', data => this.handleHostMessage(data));
                conn.on('close', () => {
                    console.log('Disconnected from host');
                    Toast.warning('Disconnected from host');
                });

                resolve();
            });

            conn.on('error', err => {
                clearTimeout(timer);
                console.error('Host connection error:', err);
                reject(new Error('Host not found or offline'));
            });
        });
    },

    // Host: new guest
    handleGuestConnection(conn) {
        const pid = conn.peer;
        console.log('Guest connected:', pid);

        conn.on('open', () => {
            State.connections.set(pid, {
                data: conn,
                info: conn.metadata?.deviceInfo || Utils.deviceInfo()
            });
            this.updateCount();
            HostPanel.render();
            Toast.success('Device connected');
        });

        conn.on('data', data => this.handleGuestMessage(pid, data));
        conn.on('close', () => this.removePeer(pid));
        conn.on('error', err => {
            console.error('Guest conn error:', err);
            this.removePeer(pid);
        });
    },

    // Host: incoming media from guest (submitted source)
    handleGuestCall(call) {
        console.log('Incoming source from:', call.peer);
        call.answer(); // Host doesn't send stream back

        call.on('stream', stream => {
            const meta = call.metadata || {};
            const sourceId = meta.sourceId || 'SRC-' + Utils.genId(6);

            State.pendingSources.set(sourceId, {
                stream,
                type: meta.type || 'camera',
                peerId: call.peer,
                deviceInfo: meta.deviceInfo || Utils.deviceInfo(),
                call
            });

            HostPanel.render();
            Toast.info('New source submitted');
        });

        call.on('close', () => {
            console.log('Guest call closed');
        });
    },

    // Host: messages from guest (data channel)
    handleGuestMessage(peerId, data) {
        if (!data || !data.type) return;
        console.log('Guest message:', peerId, data.type);

        switch (data.type) {
            case 'guest-info':
                {
                    const conn = State.connections.get(peerId);
                    if (conn) {
                        conn.info = data.deviceInfo;
                        HostPanel.render();
                    }
                }
                break;

            case 'source-ended':
                {
                    const sourceId = data.sourceId;
                    const source = State.pendingSources.get(sourceId);
                    if (source) {
                        source.call?.close();
                        State.pendingSources.delete(sourceId);
                    }
                    // remove any displayed boxes
                    State.videoBoxes.forEach((box, boxId) => {
                        if (box.sourceId === sourceId) VideoBox.remove(boxId);
                    });
                    HostPanel.render();
                }
                break;
        }
    },

    // Guest: messages from host
    handleHostMessage(data) {
        if (!data || !data.type) return;
        console.log('Host message:', data.type);

        switch (data.type) {
            case 'source-status':
                // status update for our submitted source
                GuestUI.updateStatus(data.sourceId, data.status);
                break;

            case 'kick':
                Toast.warning('Disconnected by host');
                setTimeout(() => location.reload(), 2000);
                break;
        }
    },

    sendToGuest(peerId, msg) {
        const conn = State.connections.get(peerId);
        if (conn?.data?.open) conn.data.send(msg);
    },

    sendToHost(msg) {
        if (State.hostConnection?.open) {
            State.hostConnection.send(msg);
        }
    },

    kickPeer(peerId) {
        this.sendToGuest(peerId, { type: 'kick' });
        setTimeout(() => this.removePeer(peerId), 500);
    },

    removePeer(peerId) {
        const conn = State.connections.get(peerId);
        if (conn) conn.data?.close();

        // remove their sources
        State.pendingSources.forEach((source, sourceId) => {
            if (source.peerId === peerId) {
                source.call?.close();
                State.pendingSources.delete(sourceId);
                State.videoBoxes.forEach((box, boxId) => {
                    if (box.sourceId === sourceId) VideoBox.remove(boxId);
                });
            }
        });

        State.connections.delete(peerId);
        this.updateCount();
        HostPanel.render();
        Toast.info('Device disconnected');
    },

    updateCount() {
        const el = document.getElementById('connection-count');
        if (el) el.textContent = State.connections.size;
    }
};

// ---------- Video Boxes (draggable/resizable) ----------
const VideoBox = {
    create(stream, opts = {}) {
        const id = 'box-' + (++State.boxCounter);
        const box = document.createElement('div');
        box.className = 'video-box';
        box.dataset.id = id;

        if (opts.mirror) box.classList.add('mirror');
        if (State.settings.showLabels) box.classList.add('show-label');
        if (!State.settings.showBorders) box.classList.add('no-border');
        if (!State.settings.roundedCorners) box.classList.add('no-radius');

        const label = opts.label || 'Video';
        const icon  = opts.icon || 'fa-video';
        const hasAudio = stream.getAudioTracks().length > 0;

        box.innerHTML = `
            <video autoplay playsinline ${opts.muted ? 'muted' : ''}></video>
            <div class="video-label"><i class="fas ${icon}"></i><span>${label}</span></div>
            <div class="video-controls">
              <button class="video-control-btn" data-action="mute"><i class="fas fa-volume-up"></i></button>
              <button class="video-control-btn" data-action="pip"><i class="fas fa-external-link-alt"></i></button>
              <button class="video-control-btn" data-action="close"><i class="fas fa-times"></i></button>
            </div>
            <div class="audio-indicator ${hasAudio ? '' : 'hidden'}"><i class="fas fa-microphone"></i></div>
            <div class="move-handle"><i class="fas fa-arrows-alt"></i></div>
            <div class="resize-handle corner nw"></div>
            <div class="resize-handle corner ne"></div>
            <div class="resize-handle corner sw"></div>
            <div class="resize-handle corner se"></div>
            <div class="resize-handle edge n"></div>
            <div class="resize-handle edge s"></div>
            <div class="resize-handle edge e"></div>
            <div class="resize-handle edge w"></div>
        `;

        const video = box.querySelector('video');
        video.srcObject = stream;

        const canvas = document.getElementById('canvas');
        const rect   = canvas.getBoundingClientRect();
        const w = opts.width  || CONFIG.defaultSize.width;
        const h = opts.height || CONFIG.defaultSize.height;
        const x = opts.x ?? Math.max(10, (rect.width  - w) / 2);
        const y = opts.y ?? Math.max(10, (rect.height - h) / 2);

        box.style.left   = x + 'px';
        box.style.top    = y + 'px';
        box.style.width  = w + 'px';
        box.style.height = h + 'px';

        canvas.appendChild(box);

        State.videoBoxes.set(id, {
            el: box,
            video,
            stream,
            sourceId: opts.sourceId,
            peerId: opts.peerId,
            opts,
            muted: !!opts.muted
        });

        this.bindEvents(box, id);
        return id;
    },

    bindEvents(box, id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;

        // Controls
        box.querySelectorAll('.video-control-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const act = btn.dataset.action;
                if (act === 'mute') this.toggleMute(id);
                if (act === 'pip')  this.togglePip(id);
                if (act === 'close') this.remove(id);
            });
        });

        // Move
        const moveHandle = box.querySelector('.move-handle');
        const startMove = (e) => {
            e.preventDefault();
            this.activate(id);
            data.el.classList.add('dragging');
            const r = data.el.getBoundingClientRect();
            const p = Utils.getPointer(e);
            State.interaction = {
                type: 'move',
                id,
                startX: p.x,
                startY: p.y,
                origLeft: r.left,
                origTop: r.top
            };
            document.addEventListener('mousemove', this.onMove);
            document.addEventListener('mouseup', this.endMove);
            document.addEventListener('touchmove', this.onMove, { passive: false });
            document.addEventListener('touchend', this.endMove);
        };
        moveHandle.addEventListener('mousedown', startMove);
        moveHandle.addEventListener('touchstart', startMove, { passive: false });

        // Also allow dragging from box (not controls/resize)
        box.addEventListener('mousedown', e => {
            if (!e.target.closest('.video-control-btn') && !e.target.closest('.resize-handle') && !e.target.closest('.move-handle')) {
                startMove(e);
            }
        });
        box.addEventListener('touchstart', e => {
            if (!e.target.closest('.video-control-btn') && !e.target.closest('.resize-handle') && !e.target.closest('.move-handle')) {
                startMove(e);
            }
        }, { passive: false });

        // Resize
        box.querySelectorAll('.resize-handle').forEach(handle => {
            const startResize = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.activate(id);
                data.el.classList.add('resizing');

                const r = data.el.getBoundingClientRect();
                const p = Utils.getPointer(e);
                let dir = '';
                const cls = handle.className;
                if (cls.includes('nw')) dir = 'nw';
                else if (cls.includes('ne')) dir = 'ne';
                else if (cls.includes('sw')) dir = 'sw';
                else if (cls.includes('se')) dir = 'se';
                else if (cls.includes(' n')) dir = 'n';
                else if (cls.includes(' s')) dir = 's';
                else if (cls.includes(' e')) dir = 'e';
                else if (cls.includes(' w')) dir = 'w';

                State.interaction = {
                    type: 'resize',
                    id,
                    dir,
                    startX: p.x,
                    startY: p.y,
                    origLeft: r.left,
                    origTop: r.top,
                    origW: r.width,
                    origH: r.height,
                    ratio: r.width / r.height
                };

                document.addEventListener('mousemove', this.onResize);
                document.addEventListener('mouseup', this.endResize);
                document.addEventListener('touchmove', this.onResize, { passive: false });
                document.addEventListener('touchend', this.endResize);
            };
            handle.addEventListener('mousedown', startResize);
            handle.addEventListener('touchstart', startResize, { passive: false });
        });

        // Context menu
        box.addEventListener('contextmenu', e => {
            e.preventDefault();
            const menu = document.getElementById('context-menu');
            if (!menu) return;
            menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
            menu.style.top  = Math.min(e.clientY, window.innerHeight - 300) + 'px';
            menu.classList.remove('hidden');
            this.activate(id);
        });
    },

    activate(id) {
        State.videoBoxes.forEach(box => box.el.classList.remove('active'));
        const data = State.videoBoxes.get(id);
        if (data) {
            data.el.classList.add('active');
        }
    },

    onMove(e) {
        const int = State.interaction;
        if (!int || int.type !== 'move') return;
        e.preventDefault();
        const data = State.videoBoxes.get(int.id);
        if (!data) return;

        const p = Utils.getPointer(e);
        const canvasRect = document.getElementById('canvas').getBoundingClientRect();
        const boxW = data.el.offsetWidth;
        const boxH = data.el.offsetHeight;

        let x = int.origLeft + (p.x - int.startX);
        let y = int.origTop  + (p.y - int.startY);

        x = Utils.clamp(x, 0, canvasRect.width  - boxW);
        y = Utils.clamp(y, 0, canvasRect.height - boxH);

        data.el.style.left = x + 'px';
        data.el.style.top  = y + 'px';
    },

    endMove() {
        const int = State.interaction;
        if (int?.type === 'move') {
            const data = State.videoBoxes.get(int.id);
            if (data) data.el.classList.remove('dragging');
        }
        State.interaction = null;
        document.removeEventListener('mousemove', VideoBox.onMove);
        document.removeEventListener('mouseup', VideoBox.endMove);
        document.removeEventListener('touchmove', VideoBox.onMove);
        document.removeEventListener('touchend',   VideoBox.endMove);
    },

    onResize(e) {
        const int = State.interaction;
        if (!int || int.type !== 'resize') return;
        e.preventDefault();

        const data = State.videoBoxes.get(int.id);
        if (!data) return;

        const p = Utils.getPointer(e);
        const dx = p.x - int.startX;
        const dy = p.y - int.startY;

        let { origLeft: left, origTop: top, origW: w, origH: h, ratio, dir } = int;
        const minW = CONFIG.minSize.width;
        const minH = CONFIG.minSize.height;
        const lock = State.settings.lockRatio;

        switch (dir) {
            case 'se': w = Math.max(minW, int.origW + dx); h = lock ? w / ratio : Math.max(minH, int.origH + dy); break;
            case 'sw': w = Math.max(minW, int.origW - dx); left = int.origLeft + int.origW - w; h = lock ? w / ratio : Math.max(minH, int.origH + dy); break;
            case 'ne': w = Math.max(minW, int.origW + dx); h = lock ? w / ratio : Math.max(minH, int.origH - dy); top = int.origTop + int.origH - h; break;
            case 'nw': w = Math.max(minW, int.origW - dx); left = int.origLeft + int.origW - w; h = lock ? w / ratio : Math.max(minH, int.origH - dy); top = int.origTop + int.origH - h; break;
            case 'e':  w = Math.max(minW, int.origW + dx); if (lock) h = w / ratio; break;
            case 'w':  w = Math.max(minW, int.origW - dx); left = int.origLeft + int.origW - w; if (lock) h = w / ratio; break;
            case 's':  h = Math.max(minH, int.origH + dy); if (lock) w = h * ratio; break;
            case 'n':  h = Math.max(minH, int.origH - dy); top = int.origTop + int.origH - h; if (lock) w = h * ratio; break;
        }

        const canvasRect = document.getElementById('canvas').getBoundingClientRect();
        left = Utils.clamp(left, 0, canvasRect.width  - w);
        top  = Utils.clamp(top,  0, canvasRect.height - h);

        data.el.style.left   = left + 'px';
        data.el.style.top    = top  + 'px';
        data.el.style.width  = w    + 'px';
        data.el.style.height = h    + 'px';
    },

    endResize() {
        const int = State.interaction;
        if (int?.type === 'resize') {
            const data = State.videoBoxes.get(int.id);
            if (data) data.el.classList.remove('resizing');
        }
        State.interaction = null;
        document.removeEventListener('mousemove', VideoBox.onResize);
        document.removeEventListener('mouseup', VideoBox.endResize);
        document.removeEventListener('touchmove', VideoBox.onResize);
        document.removeEventListener('touchend',  VideoBox.endResize);
    },

    toggleMute(id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;
        data.video.muted = !data.video.muted;
        const btn = data.el.querySelector('[data-action="mute"]');
        const ind = data.el.querySelector('.audio-indicator');
        if (btn) {
            btn.classList.toggle('active', data.video.muted);
            btn.querySelector('i').className = data.video.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
        }
        if (ind) ind.classList.toggle('muted', data.video.muted);
    },

    async togglePip(id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;
        try {
            if (document.pictureInPictureElement === data.video) {
                await document.exitPictureInPicture();
            } else {
                await data.video.requestPictureInPicture();
            }
        } catch {
            Toast.warning('Picture‑in‑Picture not available');
        }
    },

    remove(id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;
        data.el.remove();
        State.videoBoxes.delete(id);
    }
};

// ---------- Guest UI ----------
const GuestUI = {
    el: null,
    init() {
        this.el = createGuestOverlay();
        document.body.classList.add('guest-mode');
        $('share-camera-btn').onclick = () => this.share('camera');
        $('share-window-btn').onclick = () => this.share('window');
    },
    show() {
        this.el.classList.remove('hidden');
        $('guest-room-code').textContent = Utils.formatRoomId(State.roomId);
        this.setConnecting();
    },
    setConnecting() {
        $('guest-status').classList.remove('hidden');
        $('guest-status').innerHTML = `
            <i class="fas fa-spinner fa-spin"></i>
            <span>Connecting to host...</span>
        `;
        $('guest-controls').style.display = 'none';
    },
    setConnected() {
        $('guest-status').classList.add('hidden');
        $('guest-controls').style.display = 'block';
    },
    setError(msg) {
        $('guest-status').classList.remove('hidden');
        $('guest-status').innerHTML = `
            <i class="fas fa-exclamation-circle" style="color:var(--danger);"></i>
            <span>${msg}</span>
        `;
        $('guest-controls').style.display = 'none';
    },
    async share(type) {
        let stream;
        if (type === 'camera') stream = await Media.getCamera();
        else stream = await Media.getWindow();
        if (!stream) return;
        const sourceId = 'SRC-' + Utils.genId(6);
        State.localSources.set(sourceId, { stream, type, status: 'pending' });

        // Call host with this stream
        const call = State.peer.call(Utils.roomToPeerId(State.roomId), stream, {
            metadata: { sourceId, type, deviceInfo: Utils.deviceInfo() }
        });

        // Notify host via data
        Connection.sendToHost({
            type: 'source-submitted',
            sourceId,
            sourceType: type,
            deviceInfo: Utils.deviceInfo()
        });

        stream.getTracks().forEach(t => {
            t.onended = () => this.stop(sourceId);
        });

        this.render();
        Toast.success(`${type === 'camera' ? 'Camera' : 'Window'} sent to host`);
    },
    stop(sourceId) {
        const src = State.localSources.get(sourceId);
        if (!src) return;
        src.stream.getTracks().forEach(t => t.stop());
        Connection.sendToHost({ type: 'source-ended', sourceId });
        State.localSources.delete(sourceId);
        this.render();
    },
    updateStatus(sourceId, status) {
        const src = State.localSources.get(sourceId);
        if (src) {
            src.status = status;
            this.render();
        }
    },
    render() {
        const cont = $('guest-my-sources');
        cont.innerHTML = '';
        if (State.localSources.size === 0) return;
        const title = document.createElement('div');
        title.className = 'my-sources-title';
        title.textContent = 'Your shared sources';
        cont.appendChild(title);

        State.localSources.forEach((s, id) => {
            const div = document.createElement('div');
            div.className = 'my-source';
            div.innerHTML = `
                <div class="my-source-icon">
                    <i class="fas ${s.type === 'camera' ? 'fa-video' : 'fa-window-maximize'}"></i>
                </div>
                <div class="my-source-info">
                    <div class="my-source-name">${s.type === 'camera' ? 'Camera' : 'Window'}</div>
                    <div class="my-source-status ${s.status === 'live' ? 'live' : ''}">
                        ${s.status === 'live'   ? '● Live on host screen'
                          : s.status === 'hidden' ? 'Hidden by host'
                          : 'Waiting for host...'}
                    </div>
                </div>
                <button class="my-source-stop"><i class="fas fa-stop"></i></button>
            `;
            div.querySelector('.my-source-stop').onclick = () => this.stop(id);
            cont.appendChild(div);
        });
    }
};

function createGuestOverlay() {
    const div = document.createElement('div');
    div.className = 'guest-overlay hidden';
    div.innerHTML = `
        <div class="guest-card">
            <div class="guest-header">
                <h2>Connected to Room</h2>
                <p>Share your camera or window with the host</p>
                <div class="guest-room-info">
                    <i class="fas fa-check-circle"></i>
                    <span>Room:</span>
                    <span id="guest-room-code" class="guest-room-id">---</span>
                </div>
            </div>
            <div class="guest-body">
                <div id="guest-status"></div>
                <div id="guest-controls" style="display:none;">
                    <div class="guest-options">
                        <button id="share-camera-btn" class="guest-option-btn">
                            <i class="fas fa-video"></i>
                            <span>Share Camera</span>
                        </button>
                        <button id="share-window-btn" class="guest-option-btn">
                            <i class="fas fa-window-maximize"></i>
                            <span>Share Window</span>
                        </button>
                    </div>
                    <div id="guest-my-sources"></div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(div);
    return div;
}

// ---------- Host Panel ----------
const HostPanel = {
    el: null,
    init() {
        this.el = document.createElement('div');
        this.el.id = 'host-panel';
        this.el.className = 'host-panel hidden';
        this.el.innerHTML = `
            <div class="panel-header">
                <h3><i class="fas fa-tv"></i> Sources & Devices</h3>
                <button id="host-panel-close" class="panel-close"><i class="fas fa-times"></i></button>
            </div>
            <div class="panel-tabs">
                <button class="panel-tab active" data-tab="sources">
                    Sources <span id="sources-badge" class="badge">0</span>
                </button>
                <button class="panel-tab" data-tab="devices">
                    Devices <span id="devices-badge" class="badge">0</span>
                </button>
            </div>
            <div class="panel-body">
                <div id="tab-sources" class="tab-content active"></div>
                <div id="tab-devices" class="tab-content"></div>
            </div>
        `;
        document.body.appendChild(this.el);

        $('host-panel-close').onclick = () => this.hide();

        this.el.querySelectorAll('.panel-tab').forEach(tab => {
            tab.onclick = () => {
                this.el.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
                this.el.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                $('tab-' + tab.dataset.tab).classList.add('active');
            };
        });

        // Click status badge to toggle panel
        const status = document.getElementById('status-badge');
        if (status) {
            status.style.cursor = 'pointer';
            status.onclick = () => this.toggle();
        }
    },
    show() {
        this.el.classList.remove('hidden');
        this.render();
    },
    hide() {
        this.el.classList.add('hidden');
    },
    toggle() {
        this.el.classList.contains('hidden') ? this.show() : this.hide();
    },
    render() {
        this.renderSources();
        this.renderDevices();
        this.updateBadges();
    },
    updateBadges() {
        const sBadge = $('sources-badge');
        const dBadge = $('devices-badge');
        if (sBadge) sBadge.textContent = State.pendingSources.size;
        if (dBadge) dBadge.textContent = State.connections.size;
    },
    renderSources() {
        const cont = $('tab-sources');
        if (!cont) return;

        if (State.pendingSources.size === 0) {
            cont.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-video-slash"></i>
                    <p>No sources available</p>
                    <span>Waiting for devices to share...</span>
                </div>
            `;
            return;
        }

        cont.innerHTML = '';
        State.pendingSources.forEach((src, id) => {
            const card = document.createElement('div');
            card.className = 'source-card';
            const isDisplayed = [...State.videoBoxes.values()].some(b => b.sourceId === id);

            card.innerHTML = `
                <div class="source-card-header">
                    <div class="source-icon">
                        <i class="fas ${src.type === 'camera' ? 'fa-video' : 'fa-window-maximize'}"></i>
                    </div>
                    <div class="source-info">
                        <div class="source-name">${src.type === 'camera' ? 'Camera' : 'Window'}</div>
                        <div class="source-device">
                            <i class="fas ${src.deviceInfo?.icon || 'fa-desktop'}"></i>
                            ${src.deviceInfo?.type || 'Device'}
                        </div>
                    </div>
                    ${isDisplayed ? '<span class="source-badge"><i class="fas fa-eye"></i> Live</span>' : ''}
                </div>
                <div class="source-preview">
                    <video autoplay muted playsinline></video>
                </div>
                <div class="source-actions">
                    ${isDisplayed
                        ? `<button class="source-btn danger" data-action="remove" data-id="${id}">
                               <i class="fas fa-eye-slash"></i> Remove from canvas
                           </button>`
                        : `<button class="source-btn primary" data-action="display" data-id="${id}">
                               <i class="fas fa-plus"></i> Add to canvas
                           </button>`
                    }
                </div>
            `;

            card.querySelector('video').srcObject = src.stream;

            card.querySelector('[data-action]').onclick = (e) => {
                const act = e.currentTarget.dataset.action;
                if (act === 'display') {
                    VideoBox.create(src.stream, {
                        label: `${src.deviceInfo?.type || 'Device'} - ${src.type === 'camera' ? 'Camera' : 'Window'}`,
                        icon: src.type === 'camera' ? 'fa-video' : 'fa-window-maximize',
                        sourceId: id,
                        peerId: src.peerId,
                        mirror: src.type === 'camera'
                    });
                    Connection.sendToGuest(src.peerId, { type: 'source-status', sourceId: id, status: 'live' });
                } else {
                    // remove
                    State.videoBoxes.forEach((box, boxId) => {
                        if (box.sourceId === id) VideoBox.remove(boxId);
                    });
                    Connection.sendToGuest(src.peerId, { type: 'source-status', sourceId: id, status: 'hidden' });
                }
                this.render();
            };

            cont.appendChild(card);
        });
    },
    renderDevices() {
        const cont = $('tab-devices');
        if (!cont) return;
        if (State.connections.size === 0) {
            cont.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-plug"></i>
                    <p>No devices connected</p>
                    <span>Share your room code</span>
                </div>
            `;
            return;
        }
        cont.innerHTML = '';
        State.connections.forEach((c, pid) => {
            const card = document.createElement('div');
            card.className = 'device-card';
            card.innerHTML = `
                <div class="device-icon">
                    <i class="fas ${c.info?.icon || 'fa-desktop'}"></i>
                </div>
                <div class="device-info">
                    <div class="device-name">${c.info?.type || 'Device'}</div>
                    <div class="device-status">Connected</div>
                </div>
                <button class="device-kick" title="Disconnect">
                    <i class="fas fa-times"></i>
                </button>
            `;
            card.querySelector('.device-kick').onclick = () => Connection.kickPeer(pid);
            cont.appendChild(card);
        });
    }
};

// ---------- App ----------
const App = {
    async startAsHost() {
        try {
            await Connection.initHost();
            DOM.roomId.textContent = Utils.formatRoomId(State.roomId);
            UI.initHost();
            HostPanel.init();
            Toast.success('Room created: ' + Utils.formatRoomId(State.roomId));
        } catch (err) {
            console.error('Host start error:', err);
            LoginUI.showError(err.message || 'Failed to create room');
        }
    },
    async startAsGuest() {
        try {
            GuestUI.init();
            GuestUI.show();
            await Connection.initGuest();
            await Connection.connectToHost();
            GuestUI.setConnected();
        } catch (err) {
            console.error('Guest start error:', err);
            GuestUI.setError(err.message || 'Could not connect to host');
        }
    }
};

// ---------- Init ----------
function mainInit() {
    injectStyles();
    LoginUI.init();

    // Use URL param to prefill join input
    const params = new URLSearchParams(location.search);
    const roomParam = params.get('room');
    if (roomParam) {
        const clean = Utils.cleanRoomId(roomParam);
        if (clean) {
            $('guest-room-input').value = Utils.formatRoomId(clean);
        }
    }

    // Basic UI settings (for local video behaviour)
    if (document.getElementById('bg-color')) {
        // If old settings modal exists we can hook it, otherwise ignore
    }
}

document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', mainInit)
    : mainInit();