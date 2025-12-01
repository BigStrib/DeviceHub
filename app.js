/* ========================================
   DeviceHub - Remote Source Selection
======================================== */

const CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ],
    resolutions: {
        '480': { width: 854, height: 480 },
        '720': { width: 1280, height: 720 },
        '1080': { width: 1920, height: 1080 },
        '1440': { width: 2560, height: 1440 },
        '2160': { width: 3840, height: 2160 }
    },
    defaultSize: { width: 400, height: 225 },
    minSize: { width: 100, height: 56 }
};

const State = {
    peer: null,
    peerId: null,
    roomId: null,
    isHost: false,
    connections: new Map(), // peerId -> { data, media, info, sources, streams }
    videoBoxes: new Map(),
    localStreams: new Map(), // streamId -> { stream, type, boxId }
    activeBox: null,
    boxCounter: 0,
    streamCounter: 0,
    settings: {
        resolution: '720',
        frameRate: 30,
        showLabels: true,
        showBorders: true,
        roundedCorners: true,
        lockRatio: true,
        bgColor: '#0a0a0a'
    },
    interaction: null,
    pendingRequests: new Map() // requestId -> { type, resolve, reject }
};

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ========================================
// Create Device Panel HTML dynamically
// ========================================
function createDevicePanel() {
    const panel = document.createElement('div');
    panel.id = 'device-panel';
    panel.className = 'device-panel hidden';
    panel.innerHTML = `
        <div class="device-panel-header">
            <h3><i class="fas fa-devices"></i> Connected Devices</h3>
            <button class="panel-close" id="close-device-panel"><i class="fas fa-times"></i></button>
        </div>
        <div class="device-panel-body" id="device-list">
            <div class="no-devices">
                <i class="fas fa-plug"></i>
                <p>No devices connected</p>
                <span>Share your Room ID to connect devices</span>
            </div>
        </div>
    `;
    document.body.appendChild(panel);
    
    // Add panel styles
    const style = document.createElement('style');
    style.textContent = `
        .device-panel {
            position: fixed;
            top: 60px;
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
            animation: panelSlideIn 0.2s ease;
        }
        
        .device-panel.hidden {
            display: none;
        }
        
        @keyframes panelSlideIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .device-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            border-bottom: 1px solid var(--border);
            background: var(--surface-hover);
        }
        
        .device-panel-header h3 {
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--text);
        }
        
        .device-panel-header h3 i {
            color: var(--accent);
        }
        
        .panel-close {
            width: 28px;
            height: 28px;
            border: none;
            background: transparent;
            color: var(--text-secondary);
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all var(--transition);
        }
        
        .panel-close:hover {
            background: var(--surface-active);
            color: var(--text);
        }
        
        .device-panel-body {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }
        
        .no-devices {
            text-align: center;
            padding: 32px 16px;
            color: var(--text-muted);
        }
        
        .no-devices i {
            font-size: 32px;
            margin-bottom: 12px;
            opacity: 0.5;
        }
        
        .no-devices p {
            font-size: 14px;
            font-weight: 500;
            color: var(--text-secondary);
            margin-bottom: 4px;
        }
        
        .no-devices span {
            font-size: 12px;
        }
        
        .device-card {
            background: var(--surface-hover);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            margin-bottom: 10px;
            overflow: hidden;
        }
        
        .device-card:last-child {
            margin-bottom: 0;
        }
        
        .device-card-header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            cursor: pointer;
            transition: background var(--transition);
        }
        
        .device-card-header:hover {
            background: var(--surface-active);
        }
        
        .device-icon {
            width: 40px;
            height: 40px;
            background: var(--accent-light);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--accent);
            font-size: 16px;
            flex-shrink: 0;
        }
        
        .device-info {
            flex: 1;
            min-width: 0;
        }
        
        .device-name {
            font-size: 14px;
            font-weight: 600;
            color: var(--text);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        .device-status {
            font-size: 11px;
            color: var(--success);
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .device-status::before {
            content: '';
            width: 6px;
            height: 6px;
            background: var(--success);
            border-radius: 50%;
        }
        
        .device-expand {
            color: var(--text-muted);
            font-size: 12px;
            transition: transform var(--transition);
        }
        
        .device-card.expanded .device-expand {
            transform: rotate(180deg);
        }
        
        .device-sources {
            display: none;
            padding: 0 12px 12px;
            border-top: 1px solid var(--border);
        }
        
        .device-card.expanded .device-sources {
            display: block;
        }
        
        .source-label {
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-muted);
            margin: 12px 0 8px;
        }
        
        .source-btn {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            padding: 10px 12px;
            background: var(--bg-color);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            color: var(--text);
            font-size: 13px;
            cursor: pointer;
            transition: all var(--transition);
            margin-bottom: 6px;
        }
        
        .source-btn:last-child {
            margin-bottom: 0;
        }
        
        .source-btn:hover {
            background: var(--surface-active);
            border-color: var(--accent);
        }
        
        .source-btn:active {
            transform: scale(0.98);
        }
        
        .source-btn.active {
            background: var(--accent-light);
            border-color: var(--accent);
        }
        
        .source-btn.loading {
            opacity: 0.7;
            pointer-events: none;
        }
        
        .source-btn i {
            font-size: 14px;
            color: var(--accent);
            width: 20px;
            text-align: center;
        }
        
        .source-btn .spinner {
            width: 14px;
            height: 14px;
            border: 2px solid var(--border);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .device-disconnect {
            width: 100%;
            padding: 10px;
            background: transparent;
            border: 1px solid var(--danger);
            border-radius: var(--radius);
            color: var(--danger);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all var(--transition);
            margin-top: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        
        .device-disconnect:hover {
            background: var(--danger);
            color: #fff;
        }
        
        .active-streams {
            margin-top: 8px;
        }
        
        .active-stream {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 10px;
            background: var(--accent-light);
            border-radius: var(--radius);
            margin-bottom: 6px;
            font-size: 12px;
        }
        
        .active-stream-info {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--text);
        }
        
        .active-stream-info i {
            color: var(--accent);
        }
        
        .stream-stop {
            width: 22px;
            height: 22px;
            border: none;
            background: rgba(255,255,255,0.1);
            color: var(--text-secondary);
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            transition: all var(--transition);
        }
        
        .stream-stop:hover {
            background: var(--danger);
            color: #fff;
        }
        
        /* Request notification */
        .request-modal {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 400;
            padding: 20px;
        }
        
        .request-content {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 24px;
            max-width: 360px;
            width: 100%;
            text-align: center;
        }
        
        .request-icon {
            width: 64px;
            height: 64px;
            background: var(--accent-light);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 16px;
            font-size: 28px;
            color: var(--accent);
        }
        
        .request-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .request-desc {
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 20px;
        }
        
        .request-buttons {
            display: flex;
            gap: 10px;
        }
        
        .request-btn {
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: var(--radius);
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all var(--transition);
        }
        
        .request-btn.accept {
            background: var(--accent);
            color: #fff;
        }
        
        .request-btn.accept:hover {
            background: var(--accent-hover);
        }
        
        .request-btn.deny {
            background: var(--surface-hover);
            color: var(--text);
        }
        
        .request-btn.deny:hover {
            background: var(--surface-active);
        }
        
        @media (max-width: 600px) {
            .device-panel {
                top: auto;
                bottom: 80px;
                left: 10px;
                right: 10px;
                width: auto;
                max-height: 60vh;
            }
        }
    `;
    document.head.appendChild(style);
    
    return panel;
}

// Create panel on load
let devicePanel;

const DOM = {
    canvas: $('canvas'),
    toolbar: $('toolbar'),
    roomId: $('room-id'),
    statusBadge: $('status-badge'),
    connectionCount: $('connection-count'),
    toastContainer: $('toast-container'),
    contextMenu: $('context-menu'),
    addSourceBtn: $('add-source-btn'),
    addDeviceBtn: $('add-device-btn'),
    clearAllBtn: $('clear-all-btn'),
    fullscreenBtn: $('fullscreen-btn'),
    settingsBtn: $('settings-btn'),
    copyRoomBtn: $('copy-room-btn'),
    sourceModal: $('source-modal'),
    connectModal: $('connect-modal'),
    settingsModal: $('settings-modal'),
    confirmModal: $('confirm-modal'),
    cameraSelect: $('camera-select'),
    audioSelect: $('audio-select'),
    includeAudio: $('include-audio'),
    mirrorVideo: $('mirror-video'),
    startCameraBtn: $('start-camera-btn'),
    windowAudio: $('window-audio'),
    startWindowBtn: $('start-window-btn'),
    cameraOptions: $('camera-options'),
    windowOptions: $('window-options'),
    qrContainer: $('qr-container'),
    shareLink: $('share-link'),
    copyLinkBtn: $('copy-link-btn'),
    joinInput: $('join-input'),
    joinBtn: $('join-btn'),
    bgColor: $('bg-color'),
    showLabels: $('show-labels'),
    showBorders: $('show-borders'),
    roundedCorners: $('rounded-corners'),
    resolutionSelect: $('resolution-select'),
    framerateSelect: $('framerate-select'),
    lockRatio: $('lock-ratio'),
    confirmMessage: $('confirm-message'),
    confirmBtn: $('confirm-btn')
};

const Utils = {
    genId: (len = 6) => {
        const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let r = '';
        for (let i = 0; i < len; i++) r += c[Math.floor(Math.random() * c.length)];
        return r;
    },
    genRoomId: () => Utils.genId(3) + '-' + Utils.genId(3),
    shareUrl: id => `${location.origin}${location.pathname}?room=${id}`,
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    
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
    
    deviceInfo: () => {
        const ua = navigator.userAgent;
        if (/iPad/i.test(ua)) return { type: 'iPad', icon: 'fa-tablet-alt' };
        if (/iPhone/i.test(ua)) return { type: 'iPhone', icon: 'fa-mobile-alt' };
        if (/Android.*Mobile/i.test(ua)) return { type: 'Android', icon: 'fa-mobile-alt' };
        if (/Android/i.test(ua)) return { type: 'Tablet', icon: 'fa-tablet-alt' };
        if (/Mac/i.test(ua)) return { type: 'Mac', icon: 'fa-desktop' };
        if (/Windows/i.test(ua)) return { type: 'Windows', icon: 'fa-desktop' };
        return { type: 'Device', icon: 'fa-desktop' };
    },

    getPointer: e => ({
        x: e.clientX ?? e.touches?.[0]?.clientX ?? 0,
        y: e.clientY ?? e.touches?.[0]?.clientY ?? 0
    })
};

const Toast = {
    show(msg, type = 'info', dur = 3000) {
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
        DOM.toastContainer.appendChild(t);
        t.querySelector('.toast-close').onclick = () => this.dismiss(t);
        if (dur > 0) setTimeout(() => this.dismiss(t), dur);
    },
    dismiss(t) {
        if (!t?.parentNode) return;
        t.classList.add('fade-out');
        setTimeout(() => t.remove(), 250);
    },
    success: m => Toast.show(m, 'success'),
    error: m => Toast.show(m, 'error'),
    warning: m => Toast.show(m, 'warning'),
    info: m => Toast.show(m, 'info')
};

const Modal = {
    open(m) { (typeof m === 'string' ? $(m) : m)?.classList.add('active'); },
    close(m) { (typeof m === 'string' ? $(m) : m)?.classList.remove('active'); },
    closeAll() { $$('.modal.active').forEach(m => m.classList.remove('active')); },
    confirm(msg, cb) {
        DOM.confirmMessage.textContent = msg;
        DOM.confirmBtn.onclick = () => { cb(); this.close(DOM.confirmModal); };
        this.open(DOM.confirmModal);
    }
};

// ========================================
// Request Modal for incoming source requests
// ========================================
const RequestModal = {
    show(type, fromDevice, onAccept, onDeny) {
        const modal = document.createElement('div');
        modal.className = 'request-modal';
        modal.innerHTML = `
            <div class="request-content">
                <div class="request-icon">
                    <i class="fas ${type === 'camera' ? 'fa-video' : 'fa-window-maximize'}"></i>
                </div>
                <div class="request-title">${type === 'camera' ? 'Camera' : 'Window'} Request</div>
                <div class="request-desc">
                    The host is requesting access to your ${type === 'camera' ? 'camera' : 'window/screen'}.
                </div>
                <div class="request-buttons">
                    <button class="request-btn deny">Deny</button>
                    <button class="request-btn accept">Allow</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        modal.querySelector('.accept').onclick = () => {
            modal.remove();
            onAccept();
        };
        
        modal.querySelector('.deny').onclick = () => {
            modal.remove();
            onDeny();
        };
    }
};

// ========================================
// Device Panel
// ========================================
const DevicePanel = {
    init() {
        devicePanel = createDevicePanel();
        
        $('close-device-panel').onclick = () => this.hide();
        
        // Update status badge to open panel
        DOM.statusBadge.style.cursor = 'pointer';
        DOM.statusBadge.onclick = () => this.toggle();
    },
    
    show() {
        devicePanel.classList.remove('hidden');
        this.render();
    },
    
    hide() {
        devicePanel.classList.add('hidden');
    },
    
    toggle() {
        if (devicePanel.classList.contains('hidden')) {
            this.show();
        } else {
            this.hide();
        }
    },
    
    render() {
        const list = $('device-list');
        
        if (State.connections.size === 0) {
            list.innerHTML = `
                <div class="no-devices">
                    <i class="fas fa-plug"></i>
                    <p>No devices connected</p>
                    <span>Share your Room ID to connect devices</span>
                </div>
            `;
            return;
        }
        
        list.innerHTML = '';
        
        State.connections.forEach((conn, peerId) => {
            const card = document.createElement('div');
            card.className = 'device-card';
            card.dataset.peerId = peerId;
            
            const info = conn.info || {};
            const activeStreams = conn.activeStreams || [];
            
            card.innerHTML = `
                <div class="device-card-header">
                    <div class="device-icon">
                        <i class="fas ${info.icon || 'fa-desktop'}"></i>
                    </div>
                    <div class="device-info">
                        <div class="device-name">${info.type || 'Device'}</div>
                        <div class="device-status">Connected</div>
                    </div>
                    <div class="device-expand">
                        <i class="fas fa-chevron-down"></i>
                    </div>
                </div>
                <div class="device-sources">
                    ${activeStreams.length > 0 ? `
                        <div class="source-label">Active Streams</div>
                        <div class="active-streams">
                            ${activeStreams.map(s => `
                                <div class="active-stream" data-stream-id="${s.id}">
                                    <div class="active-stream-info">
                                        <i class="fas ${s.type === 'camera' ? 'fa-video' : 'fa-window-maximize'}"></i>
                                        <span>${s.type === 'camera' ? 'Camera' : 'Window'}</span>
                                    </div>
                                    <button class="stream-stop" data-stream-id="${s.id}" data-peer-id="${peerId}">
                                        <i class="fas fa-times"></i>
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    <div class="source-label">Request Source</div>
                    <button class="source-btn" data-type="camera" data-peer-id="${peerId}">
                        <i class="fas fa-video"></i>
                        <span>Request Camera</span>
                    </button>
                    <button class="source-btn" data-type="window" data-peer-id="${peerId}">
                        <i class="fas fa-window-maximize"></i>
                        <span>Request Window</span>
                    </button>
                    <button class="device-disconnect" data-peer-id="${peerId}">
                        <i class="fas fa-plug"></i>
                        Disconnect
                    </button>
                </div>
            `;
            
            // Toggle expand
            card.querySelector('.device-card-header').onclick = () => {
                card.classList.toggle('expanded');
            };
            
            // Source request buttons
            card.querySelectorAll('.source-btn').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const type = btn.dataset.type;
                    const pid = btn.dataset.peerId;
                    
                    btn.classList.add('loading');
                    btn.innerHTML = `<div class="spinner"></div><span>Requesting...</span>`;
                    
                    try {
                        await Connection.requestSource(pid, type);
                    } catch (err) {
                        Toast.error('Request denied or failed');
                    }
                    
                    btn.classList.remove('loading');
                    btn.innerHTML = `<i class="fas ${type === 'camera' ? 'fa-video' : 'fa-window-maximize'}"></i><span>Request ${type === 'camera' ? 'Camera' : 'Window'}</span>`;
                };
            });
            
            // Stop stream buttons
            card.querySelectorAll('.stream-stop').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const streamId = btn.dataset.streamId;
                    const pid = btn.dataset.peerId;
                    Connection.stopRemoteStream(pid, streamId);
                };
            });
            
            // Disconnect button
            card.querySelector('.device-disconnect').onclick = (e) => {
                e.stopPropagation();
                Connection.removePeer(peerId);
            };
            
            list.appendChild(card);
        });
    }
};

// ========================================
// VideoBox
// ========================================
const VideoBox = {
    create(stream, opts = {}) {
        const id = 'vbox-' + (++State.boxCounter);
        const box = document.createElement('div');
        box.className = 'video-box';
        box.id = id;
        box.dataset.id = id;

        if (opts.mirror) box.classList.add('mirror');
        if (State.settings.showLabels) box.classList.add('show-label');
        if (!State.settings.showBorders) box.classList.add('no-border');
        if (!State.settings.roundedCorners) box.classList.add('no-radius');

        const label = opts.label || 'Video';
        const icon = opts.icon || 'fa-video';
        const hasAudio = stream.getAudioTracks().length > 0;

        box.innerHTML = `
            <video autoplay playsinline ${opts.muted ? 'muted' : ''}></video>
            <div class="video-label"><i class="fas ${icon}"></i><span>${label}</span></div>
            <div class="video-controls">
                <button class="video-ctrl-btn" data-action="mute" title="Toggle Audio">
                    <i class="fas fa-volume-up"></i>
                </button>
                <button class="video-ctrl-btn" data-action="pip" title="PiP">
                    <i class="fas fa-external-link-alt"></i>
                </button>
                <button class="video-ctrl-btn" data-action="close" title="Remove">
                    <i class="fas fa-times"></i>
                </button>
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

        const rect = DOM.canvas.getBoundingClientRect();
        const w = opts.width || CONFIG.defaultSize.width;
        const h = opts.height || CONFIG.defaultSize.height;
        const x = opts.x ?? Math.max(10, (rect.width - w) / 2);
        const y = opts.y ?? Math.max(10, (rect.height - h) / 2);

        box.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;

        DOM.canvas.appendChild(box);

        State.videoBoxes.set(id, { 
            el: box, 
            video, 
            stream, 
            opts, 
            muted: !!opts.muted,
            streamId: opts.streamId,
            peerId: opts.peerId
        });

        this.bindEvents(box, id);
        return id;
    },

    bindEvents(box, id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;

        box.querySelectorAll('.video-ctrl-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'mute') this.toggleMute(id);
                else if (action === 'pip') this.togglePip(id);
                else if (action === 'close') this.remove(id);
            });
        });

        const moveHandle = box.querySelector('.move-handle');
        moveHandle.addEventListener('mousedown', e => this.startMove(e, id));
        moveHandle.addEventListener('touchstart', e => this.startMove(e, id), { passive: false });

        box.addEventListener('mousedown', e => {
            if (!e.target.closest('.resize-handle') && 
                !e.target.closest('.video-ctrl-btn') && 
                !e.target.closest('.move-handle')) {
                this.startMove(e, id);
            }
        });
        box.addEventListener('touchstart', e => {
            if (!e.target.closest('.resize-handle') && 
                !e.target.closest('.video-ctrl-btn') && 
                !e.target.closest('.move-handle')) {
                this.startMove(e, id);
            }
        }, { passive: false });

        box.querySelectorAll('.resize-handle').forEach(h => {
            h.addEventListener('mousedown', e => this.startResize(e, id, h));
            h.addEventListener('touchstart', e => this.startResize(e, id, h), { passive: false });
        });

        box.addEventListener('contextmenu', e => {
            e.preventDefault();
            ContextMenu.show(e.clientX, e.clientY, id);
        });

        box.addEventListener('mousedown', () => this.activate(id));
        box.addEventListener('touchstart', () => this.activate(id), { passive: true });
    },

    activate(id) {
        $$('.video-box.active').forEach(b => b.classList.remove('active'));
        const data = State.videoBoxes.get(id);
        if (data) {
            data.el.classList.add('active');
            State.activeBox = id;
        }
    },

    startMove(e, id) {
        e.preventDefault();
        const data = State.videoBoxes.get(id);
        if (!data) return;

        this.activate(id);
        data.el.classList.add('dragging');

        const rect = data.el.getBoundingClientRect();
        const pointer = Utils.getPointer(e);

        State.interaction = {
            type: 'move',
            id,
            startX: pointer.x,
            startY: pointer.y,
            origLeft: rect.left,
            origTop: rect.top
        };

        document.addEventListener('mousemove', this.onMove);
        document.addEventListener('mouseup', this.endMove);
        document.addEventListener('touchmove', this.onMove, { passive: false });
        document.addEventListener('touchend', this.endMove);
    },

    onMove: e => {
        const int = State.interaction;
        if (!int || int.type !== 'move') return;
        e.preventDefault();

        const data = State.videoBoxes.get(int.id);
        if (!data) return;

        const pointer = Utils.getPointer(e);
        const canvasRect = DOM.canvas.getBoundingClientRect();
        const boxW = data.el.offsetWidth;
        const boxH = data.el.offsetHeight;

        let newX = int.origLeft + (pointer.x - int.startX);
        let newY = int.origTop + (pointer.y - int.startY);

        newX = Utils.clamp(newX, 0, canvasRect.width - boxW);
        newY = Utils.clamp(newY, 0, canvasRect.height - boxH);

        data.el.style.left = newX + 'px';
        data.el.style.top = newY + 'px';
    },

    endMove: () => {
        const int = State.interaction;
        if (int?.type === 'move') {
            const data = State.videoBoxes.get(int.id);
            if (data) data.el.classList.remove('dragging');
        }
        State.interaction = null;
        document.removeEventListener('mousemove', VideoBox.onMove);
        document.removeEventListener('mouseup', VideoBox.endMove);
        document.removeEventListener('touchmove', VideoBox.onMove);
        document.removeEventListener('touchend', VideoBox.endMove);
    },

    startResize(e, id, handle) {
        e.preventDefault();
        e.stopPropagation();

        const data = State.videoBoxes.get(id);
        if (!data) return;

        this.activate(id);
        data.el.classList.add('resizing');

        const rect = data.el.getBoundingClientRect();
        const pointer = Utils.getPointer(e);

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
            startX: pointer.x,
            startY: pointer.y,
            origLeft: rect.left,
            origTop: rect.top,
            origW: rect.width,
            origH: rect.height,
            ratio: rect.width / rect.height
        };

        document.addEventListener('mousemove', this.onResize);
        document.addEventListener('mouseup', this.endResize);
        document.addEventListener('touchmove', this.onResize, { passive: false });
        document.addEventListener('touchend', this.endResize);
    },

    onResize: e => {
        const int = State.interaction;
        if (!int || int.type !== 'resize') return;
        e.preventDefault();

        const data = State.videoBoxes.get(int.id);
        if (!data) return;

        const pointer = Utils.getPointer(e);
        const dx = pointer.x - int.startX;
        const dy = pointer.y - int.startY;

        let { origLeft: left, origTop: top, origW: w, origH: h, ratio, dir } = int;
        const minW = CONFIG.minSize.width;
        const minH = CONFIG.minSize.height;
        const lock = State.settings.lockRatio;

        switch (dir) {
            case 'se':
                w = Math.max(minW, int.origW + dx);
                h = lock ? w / ratio : Math.max(minH, int.origH + dy);
                break;
            case 'sw':
                w = Math.max(minW, int.origW - dx);
                left = int.origLeft + int.origW - w;
                h = lock ? w / ratio : Math.max(minH, int.origH + dy);
                break;
            case 'ne':
                w = Math.max(minW, int.origW + dx);
                h = lock ? w / ratio : Math.max(minH, int.origH - dy);
                top = int.origTop + int.origH - h;
                break;
            case 'nw':
                w = Math.max(minW, int.origW - dx);
                left = int.origLeft + int.origW - w;
                h = lock ? w / ratio : Math.max(minH, int.origH - dy);
                top = int.origTop + int.origH - h;
                break;
            case 'e':
                w = Math.max(minW, int.origW + dx);
                if (lock) h = w / ratio;
                break;
            case 'w':
                w = Math.max(minW, int.origW - dx);
                left = int.origLeft + int.origW - w;
                if (lock) h = w / ratio;
                break;
            case 's':
                h = Math.max(minH, int.origH + dy);
                if (lock) w = h * ratio;
                break;
            case 'n':
                h = Math.max(minH, int.origH - dy);
                top = int.origTop + int.origH - h;
                if (lock) w = h * ratio;
                break;
        }

        const canvasRect = DOM.canvas.getBoundingClientRect();
        left = Utils.clamp(left, 0, canvasRect.width - w);
        top = Utils.clamp(top, 0, canvasRect.height - h);

        data.el.style.left = left + 'px';
        data.el.style.top = top + 'px';
        data.el.style.width = w + 'px';
        data.el.style.height = h + 'px';
    },

    endResize: () => {
        const int = State.interaction;
        if (int?.type === 'resize') {
            const data = State.videoBoxes.get(int.id);
            if (data) data.el.classList.remove('resizing');
        }
        State.interaction = null;
        document.removeEventListener('mousemove', VideoBox.onResize);
        document.removeEventListener('mouseup', VideoBox.endResize);
        document.removeEventListener('touchmove', VideoBox.onResize);
        document.removeEventListener('touchend', VideoBox.endResize);
    },

    toggleMute(id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;

        data.video.muted = !data.video.muted;
        data.muted = data.video.muted;

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
            Toast.warning('Picture in Picture unavailable');
        }
    },

    toggleMirror(id) {
        const data = State.videoBoxes.get(id);
        if (data) data.el.classList.toggle('mirror');
    },

    duplicate(id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;

        const rect = data.el.getBoundingClientRect();
        this.create(data.stream, {
            ...data.opts,
            x: Math.min(rect.left + 30, window.innerWidth - rect.width - 10),
            y: Math.min(rect.top + 30, window.innerHeight - rect.height - 10),
            width: rect.width,
            height: rect.height
        });
    },

    fitContent(id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;

        const v = data.video;
        if (v.videoWidth && v.videoHeight) {
            const maxW = window.innerWidth * 0.9;
            const maxH = window.innerHeight * 0.9;
            let w = v.videoWidth;
            let h = v.videoHeight;

            if (w > maxW) { h *= maxW / w; w = maxW; }
            if (h > maxH) { w *= maxH / h; h = maxH; }

            data.el.style.width = w + 'px';
            data.el.style.height = h + 'px';
        }
    },

    resetSize(id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;
        data.el.style.width = CONFIG.defaultSize.width + 'px';
        data.el.style.height = CONFIG.defaultSize.height + 'px';
    },

    bringFront(id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;

        let maxZ = 10;
        State.videoBoxes.forEach(d => {
            const z = parseInt(d.el.style.zIndex || 10);
            if (z > maxZ) maxZ = z;
        });
        data.el.style.zIndex = maxZ + 1;
    },

    fullscreen(id) {
        const data = State.videoBoxes.get(id);
        data?.el.requestFullscreen?.();
    },

    remove(id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;

        // If local stream, stop it
        if (data.opts.isLocal) {
            data.stream.getTracks().forEach(t => t.stop());
            State.localStreams.delete(data.streamId);
        }
        
        // If remote stream, notify
        if (data.peerId && data.streamId) {
            Connection.send(data.peerId, {
                type: 'stream-stopped',
                streamId: data.streamId
            });
            
            // Update connection's active streams
            const conn = State.connections.get(data.peerId);
            if (conn && conn.activeStreams) {
                conn.activeStreams = conn.activeStreams.filter(s => s.id !== data.streamId);
                DevicePanel.render();
            }
        }

        data.el.remove();
        State.videoBoxes.delete(id);
        if (State.activeBox === id) State.activeBox = null;
    },

    removeAll() {
        State.videoBoxes.forEach((_, id) => this.remove(id));
    },

    applySettings() {
        State.videoBoxes.forEach(data => {
            data.el.classList.toggle('show-label', State.settings.showLabels);
            data.el.classList.toggle('no-border', !State.settings.showBorders);
            data.el.classList.toggle('no-radius', !State.settings.roundedCorners);
        });
    },
    
    findByStream(stream) {
        for (const [id, data] of State.videoBoxes) {
            if (data.stream === stream) return id;
        }
        return null;
    },
    
    findByStreamId(streamId) {
        for (const [id, data] of State.videoBoxes) {
            if (data.streamId === streamId) return id;
        }
        return null;
    }
};

const ContextMenu = {
    boxId: null,

    show(x, y, id) {
        this.boxId = id;
        const m = DOM.contextMenu;
        const mw = 180;
        const mh = 320;
        m.style.left = Math.min(x, window.innerWidth - mw - 10) + 'px';
        m.style.top = Math.min(y, window.innerHeight - mh - 10) + 'px';
        m.classList.remove('hidden');
        VideoBox.activate(id);
    },

    hide() {
        DOM.contextMenu.classList.add('hidden');
        this.boxId = null;
    },

    handle(action) {
        if (!this.boxId) return;
        const id = this.boxId;

        switch (action) {
            case 'fullscreen': VideoBox.fullscreen(id); break;
            case 'pip': VideoBox.togglePip(id); break;
            case 'duplicate': VideoBox.duplicate(id); break;
            case 'mute': VideoBox.toggleMute(id); break;
            case 'mirror': VideoBox.toggleMirror(id); break;
            case 'fit': VideoBox.fitContent(id); break;
            case 'reset': VideoBox.resetSize(id); break;
            case 'front': VideoBox.bringFront(id); break;
            case 'remove': VideoBox.remove(id); break;
        }

        this.hide();
    }
};

const Media = {
    async getCamera(opts = {}) {
        const res = CONFIG.resolutions[State.settings.resolution] || CONFIG.resolutions['720'];
        const constraints = {
            video: {
                width: { ideal: res.width },
                height: { ideal: res.height },
                frameRate: { ideal: State.settings.frameRate },
                deviceId: opts.videoId ? { exact: opts.videoId } : undefined
            },
            audio: opts.audio ? {
                deviceId: opts.audioId ? { exact: opts.audioId } : undefined,
                echoCancellation: true,
                noiseSuppression: true
            } : false
        };

        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
            console.error('Camera error:', err);
            Toast.error('Could not access camera');
            return null;
        }
    },

    async getWindow(audio = false) {
        try {
            return await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio
            });
        } catch (err) {
            if (err.name !== 'AbortError') Toast.error('Could not share window');
            return null;
        }
    },

    async enumerate() {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
                .then(s => s.getTracks().forEach(t => t.stop()))
                .catch(() => {});

            const devs = await navigator.mediaDevices.enumerateDevices();
            return {
                video: devs.filter(d => d.kind === 'videoinput'),
                audio: devs.filter(d => d.kind === 'audioinput')
            };
        } catch {
            return { video: [], audio: [] };
        }
    },

    async populateSelects() {
        const { video, audio } = await this.enumerate();

        DOM.cameraSelect.innerHTML = video.map((d, i) =>
            `<option value="${d.deviceId}">${d.label || 'Camera ' + (i + 1)}</option>`
        ).join('') || '<option value="">No cameras</option>';

        DOM.audioSelect.innerHTML = audio.map((d, i) =>
            `<option value="${d.deviceId}">${d.label || 'Mic ' + (i + 1)}</option>`
        ).join('') || '<option value="">No microphones</option>';
    }
};

// ========================================
// Connection Manager with Source Requests
// ========================================
const Connection = {
    async init() {
        return new Promise((resolve, reject) => {
            const id = 'dh-' + Utils.genId(10);

            State.peer = new Peer(id, {
                debug: 1,
                config: { iceServers: CONFIG.iceServers }
            });

            const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);

            State.peer.on('open', pid => {
                clearTimeout(timeout);
                State.peerId = pid;
                DOM.statusBadge.classList.add('connected');
                resolve(pid);
            });

            State.peer.on('error', err => {
                clearTimeout(timeout);
                console.error('Peer error:', err);
                Toast.error('Connection error');
            });

            State.peer.on('connection', conn => this.handleData(conn));
            State.peer.on('call', call => this.handleCall(call));

            State.peer.on('disconnected', () => {
                DOM.statusBadge.classList.remove('connected');
                setTimeout(() => State.peer?.reconnect?.(), 3000);
            });
        });
    },

    connect(remoteId) {
        if (!State.peer || remoteId === State.peerId) return;
        if (State.connections.has(remoteId)) return Toast.info('Already connected');

        const conn = State.peer.connect(remoteId, {
            reliable: true,
            metadata: { info: Utils.deviceInfo(), room: State.roomId }
        });
        this.handleData(conn);
    },

    handleData(conn) {
        const pid = conn.peer;

        conn.on('open', () => {
            State.connections.set(pid, { 
                data: conn, 
                info: conn.metadata?.info || {},
                mediaConnections: new Map(),
                activeStreams: []
            });
            this.updateCount();
            DevicePanel.render();

            conn.send({ 
                type: 'info', 
                info: Utils.deviceInfo(), 
                room: State.roomId,
                isHost: State.isHost
            });
            
            Toast.success(`${conn.metadata?.info?.type || 'Device'} connected`);
        });

        conn.on('data', data => this.handleMessage(pid, data));
        conn.on('close', () => this.removePeer(pid));
    },

    handleCall(call) {
        call.answer();
        
        call.on('stream', stream => {
            const meta = call.metadata || {};
            const streamId = meta.streamId || 'stream-' + Date.now();
            
            // Create video box for incoming stream
            const boxId = VideoBox.create(stream, {
                label: `${meta.info?.type || 'Remote'} - ${meta.sourceType === 'camera' ? 'Camera' : 'Window'}`,
                icon: meta.sourceType === 'camera' ? 'fa-video' : 'fa-window-maximize',
                type: 'remote',
                peerId: call.peer,
                streamId: streamId
            });
            
            // Track active stream
            const conn = State.connections.get(call.peer);
            if (conn) {
                if (!conn.activeStreams) conn.activeStreams = [];
                conn.activeStreams.push({
                    id: streamId,
                    type: meta.sourceType || 'unknown',
                    boxId
                });
                conn.mediaConnections.set(streamId, call);
                DevicePanel.render();
            }
        });
    },

    async handleMessage(pid, data) {
        const conn = State.connections.get(pid);
        if (!data || !data.type) return;

        switch (data.type) {
            case 'info':
                if (conn) {
                    conn.info = data.info;
                    DevicePanel.render();
                }
                break;

            case 'request-source':
                // Remote host is requesting a source from us
                await this.handleSourceRequest(pid, data);
                break;

            case 'source-response':
                // Response to our source request
                this.handleSourceResponse(pid, data);
                break;

            case 'stream-stopped':
                // Remote stopped a stream
                this.handleStreamStopped(pid, data);
                break;

            case 'stop-stream':
                // Host wants us to stop a stream
                this.handleStopStreamRequest(pid, data);
                break;
        }
    },

    async handleSourceRequest(pid, data) {
        const { requestId, sourceType } = data;
        
        // Show request modal to user
        RequestModal.show(
            sourceType,
            State.connections.get(pid)?.info?.type || 'Host',
            async () => {
                // User accepted
                let stream;
                try {
                    if (sourceType === 'camera') {
                        stream = await Media.getCamera({ audio: true });
                    } else {
                        stream = await Media.getWindow(false);
                    }
                    
                    if (stream) {
                        const streamId = 'stream-' + (++State.streamCounter);
                        
                        // Store locally
                        State.localStreams.set(streamId, {
                            stream,
                            type: sourceType,
                            forPeer: pid
                        });
                        
                        // Send stream to requester
                        const call = State.peer.call(pid, stream, {
                            metadata: {
                                streamId,
                                sourceType,
                                info: Utils.deviceInfo()
                            }
                        });
                        
                        // Handle stream end
                        stream.getTracks().forEach(track => {
                            track.onended = () => {
                                this.send(pid, {
                                    type: 'stream-stopped',
                                    streamId
                                });
                                State.localStreams.delete(streamId);
                            };
                        });
                        
                        // Send success response
                        this.send(pid, {
                            type: 'source-response',
                            requestId,
                            success: true,
                            streamId
                        });
                        
                        Toast.success(`Sharing ${sourceType}`);
                    } else {
                        this.send(pid, {
                            type: 'source-response',
                            requestId,
                            success: false,
                            error: 'Failed to get media'
                        });
                    }
                } catch (err) {
                    this.send(pid, {
                        type: 'source-response',
                        requestId,
                        success: false,
                        error: err.message
                    });
                }
            },
            () => {
                // User denied
                this.send(pid, {
                    type: 'source-response',
                    requestId,
                    success: false,
                    error: 'User denied request'
                });
            }
        );
    },

    handleSourceResponse(pid, data) {
        const { requestId, success, error } = data;
        const pending = State.pendingRequests.get(requestId);
        
        if (pending) {
            if (success) {
                pending.resolve(data);
            } else {
                pending.reject(new Error(error || 'Request failed'));
            }
            State.pendingRequests.delete(requestId);
        }
    },

    handleStreamStopped(pid, data) {
        const { streamId } = data;
        
        // Find and remove the video box
        const boxId = VideoBox.findByStreamId(streamId);
        if (boxId) {
            VideoBox.remove(boxId);
        }
        
        // Update connection's active streams
        const conn = State.connections.get(pid);
        if (conn && conn.activeStreams) {
            conn.activeStreams = conn.activeStreams.filter(s => s.id !== streamId);
            DevicePanel.render();
        }
        
        Toast.info('Remote stream ended');
    },

    handleStopStreamRequest(pid, data) {
        const { streamId } = data;
        const localStream = State.localStreams.get(streamId);
        
        if (localStream) {
            localStream.stream.getTracks().forEach(t => t.stop());
            State.localStreams.delete(streamId);
            Toast.info('Stream stopped by host');
        }
    },

    async requestSource(peerId, sourceType) {
        return new Promise((resolve, reject) => {
            const requestId = 'req-' + Utils.genId(8);
            
            State.pendingRequests.set(requestId, { resolve, reject });
            
            this.send(peerId, {
                type: 'request-source',
                requestId,
                sourceType
            });
            
            // Timeout after 60 seconds
            setTimeout(() => {
                if (State.pendingRequests.has(requestId)) {
                    State.pendingRequests.delete(requestId);
                    reject(new Error('Request timeout'));
                }
            }, 60000);
        });
    },

    stopRemoteStream(peerId, streamId) {
        // Notify remote to stop the stream
        this.send(peerId, {
            type: 'stop-stream',
            streamId
        });
        
        // Find and remove local video box
        const boxId = VideoBox.findByStreamId(streamId);
        if (boxId) {
            const data = State.videoBoxes.get(boxId);
            if (data) {
                data.el.remove();
                State.videoBoxes.delete(boxId);
            }
        }
        
        // Update connection's active streams
        const conn = State.connections.get(peerId);
        if (conn) {
            const mc = conn.mediaConnections.get(streamId);
            if (mc) mc.close();
            conn.mediaConnections.delete(streamId);
            
            if (conn.activeStreams) {
                conn.activeStreams = conn.activeStreams.filter(s => s.id !== streamId);
            }
            DevicePanel.render();
        }
    },

    send(peerId, data) {
        const conn = State.connections.get(peerId);
        if (conn?.data?.open) {
            conn.data.send(data);
        }
    },

    broadcast(data) {
        State.connections.forEach((conn, pid) => {
            this.send(pid, data);
        });
    },

    removePeer(pid) {
        const conn = State.connections.get(pid);
        if (conn) {
            conn.data?.close();
            conn.mediaConnections?.forEach(mc => mc.close());
            
            // Remove all video boxes from this peer
            State.videoBoxes.forEach((data, id) => {
                if (data.peerId === pid) {
                    data.el.remove();
                    State.videoBoxes.delete(id);
                }
            });
        }
        
        State.connections.delete(pid);
        this.updateCount();
        DevicePanel.render();

        Toast.info('Device disconnected');
    },

    updateCount() {
        DOM.connectionCount.textContent = State.connections.size;
    }
};

const UI = {
    init() {
        DevicePanel.init();
        this.bindToolbar();
        this.bindModals();
        this.bindSettings();
        this.loadSettings();
    },

    bindToolbar() {
        DOM.addSourceBtn.onclick = () => {
            this.resetSourceModal();
            Modal.open(DOM.sourceModal);
            Media.populateSelects();
        };

        DOM.addDeviceBtn.onclick = () => {
            this.updateConnectModal();
            Modal.open(DOM.connectModal);
        };

        DOM.clearAllBtn.onclick = () => {
            if (State.videoBoxes.size) {
                Modal.confirm('Remove all sources?', () => VideoBox.removeAll());
            }
        };

        DOM.fullscreenBtn.onclick = () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.();
                DOM.fullscreenBtn.querySelector('i').className = 'fas fa-compress';
            } else {
                document.exitFullscreen?.();
                DOM.fullscreenBtn.querySelector('i').className = 'fas fa-expand';
            }
        };

        DOM.settingsBtn.onclick = () => Modal.open(DOM.settingsModal);

        DOM.copyRoomBtn.onclick = async () => {
            await Utils.copy(State.roomId);
            Toast.success('Room ID copied');
        };
    },

    bindModals() {
        $$('[data-close]').forEach(btn => {
            btn.onclick = () => Modal.close(btn.dataset.close);
        });

        $$('.modal').forEach(m => {
            m.onclick = e => { if (e.target === m) Modal.close(m); };
        });

        $$('.source-option').forEach(btn => {
            btn.onclick = () => {
                $$('.source-option').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');

                const src = btn.dataset.source;
                DOM.cameraOptions.classList.toggle('hidden', src !== 'camera');
                DOM.windowOptions.classList.toggle('hidden', src !== 'window');
            };
        });

        DOM.startCameraBtn.onclick = async () => {
            const stream = await Media.getCamera({
                videoId: DOM.cameraSelect.value,
                audioId: DOM.audioSelect.value,
                audio: DOM.includeAudio.checked
            });

            if (stream) {
                const streamId = 'local-' + (++State.streamCounter);
                
                State.localStreams.set(streamId, {
                    stream,
                    type: 'camera',
                    isLocal: true
                });
                
                VideoBox.create(stream, {
                    label: 'Camera',
                    icon: 'fa-video',
                    type: 'camera',
                    mirror: DOM.mirrorVideo.checked,
                    muted: true,
                    isLocal: true,
                    streamId
                });

                Modal.close(DOM.sourceModal);

                // Share with connected peers
                State.connections.forEach((conn, pid) => {
                    const call = State.peer.call(pid, stream, {
                        metadata: {
                            streamId,
                            sourceType: 'camera',
                            info: Utils.deviceInfo()
                        }
                    });
                    conn.mediaConnections.set(streamId, call);
                });
            }
        };

        DOM.startWindowBtn.onclick = async () => {
            const stream = await Media.getWindow(DOM.windowAudio.checked);

            if (stream) {
                const streamId = 'local-' + (++State.streamCounter);
                
                State.localStreams.set(streamId, {
                    stream,
                    type: 'window',
                    isLocal: true
                });
                
                const boxId = VideoBox.create(stream, {
                    label: 'Window',
                    icon: 'fa-window-maximize',
                    type: 'window',
                    muted: true,
                    isLocal: true,
                    streamId
                });

                stream.getVideoTracks()[0].onended = () => {
                    VideoBox.remove(boxId);
                    State.localStreams.delete(streamId);
                };

                Modal.close(DOM.sourceModal);

                // Share with connected peers
                State.connections.forEach((conn, pid) => {
                    const call = State.peer.call(pid, stream, {
                        metadata: {
                            streamId,
                            sourceType: 'window',
                            info: Utils.deviceInfo()
                        }
                    });
                    conn.mediaConnections.set(streamId, call);
                });
            }
        };

        DOM.copyLinkBtn.onclick = async () => {
            await Utils.copy(DOM.shareLink.value);
            Toast.success('Link copied');
        };

        DOM.joinBtn.onclick = () => {
            const id = DOM.joinInput.value.trim().toUpperCase();
            if (id && id.length >= 5) {
                window.location.href = `${location.pathname}?room=${id}`;
            } else {
                Toast.warning('Enter a valid Room ID');
            }
        };

        DOM.joinInput.onkeypress = e => {
            if (e.key === 'Enter') DOM.joinBtn.click();
        };

        DOM.contextMenu.querySelectorAll('li[data-action]').forEach(item => {
            item.onclick = () => ContextMenu.handle(item.dataset.action);
        });

        document.addEventListener('click', e => {
            if (!e.target.closest('.context-menu')) {
                ContextMenu.hide();
            }
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                Modal.closeAll();
                ContextMenu.hide();
                DevicePanel.hide();
            }
            if (e.key === 'Delete' && State.activeBox && !e.target.closest('input')) {
                VideoBox.remove(State.activeBox);
            }
        });
    },

    bindSettings() {
        DOM.bgColor.onchange = () => {
            State.settings.bgColor = DOM.bgColor.value;
            document.documentElement.style.setProperty('--bg-color', DOM.bgColor.value);
            DOM.canvas.style.background = DOM.bgColor.value;
            this.saveSettings();
        };

        DOM.showLabels.onchange = () => {
            State.settings.showLabels = DOM.showLabels.checked;
            VideoBox.applySettings();
            this.saveSettings();
        };

        DOM.showBorders.onchange = () => {
            State.settings.showBorders = DOM.showBorders.checked;
            VideoBox.applySettings();
            this.saveSettings();
        };

        DOM.roundedCorners.onchange = () => {
            State.settings.roundedCorners = DOM.roundedCorners.checked;
            VideoBox.applySettings();
            this.saveSettings();
        };

        DOM.resolutionSelect.onchange = () => {
            State.settings.resolution = DOM.resolutionSelect.value;
            this.saveSettings();
        };

        DOM.framerateSelect.onchange = () => {
            State.settings.frameRate = parseInt(DOM.framerateSelect.value);
            this.saveSettings();
        };

        DOM.lockRatio.onchange = () => {
            State.settings.lockRatio = DOM.lockRatio.checked;
            this.saveSettings();
        };
    },

    loadSettings() {
        try {
            const s = localStorage.getItem('dh-settings');
            if (s) State.settings = { ...State.settings, ...JSON.parse(s) };
        } catch {}

        DOM.bgColor.value = State.settings.bgColor;
        DOM.showLabels.checked = State.settings.showLabels;
        DOM.showBorders.checked = State.settings.showBorders;
        DOM.roundedCorners.checked = State.settings.roundedCorners;
        DOM.resolutionSelect.value = State.settings.resolution;
        DOM.framerateSelect.value = State.settings.frameRate;
        DOM.lockRatio.checked = State.settings.lockRatio;

        document.documentElement.style.setProperty('--bg-color', State.settings.bgColor);
        DOM.canvas.style.background = State.settings.bgColor;
    },

    saveSettings() {
        try {
            localStorage.setItem('dh-settings', JSON.stringify(State.settings));
        } catch {}
    },

    resetSourceModal() {
        $$('.source-option').forEach(b => b.classList.remove('selected'));
        DOM.cameraOptions.classList.add('hidden');
        DOM.windowOptions.classList.add('hidden');
    },

    updateConnectModal() {
        DOM.shareLink.value = Utils.shareUrl(State.roomId);
        DOM.qrContainer.innerHTML = '';
        if (typeof QRCode !== 'undefined') {
            new QRCode(DOM.qrContainer, {
                text: DOM.shareLink.value,
                width: 150,
                height: 150,
                colorDark: '#000',
                colorLight: '#fff'
            });
        }
    }
};

async function init() {
    const params = new URLSearchParams(location.search);
    State.roomId = params.get('room')?.toUpperCase() || Utils.genRoomId();
    State.isHost = !params.get('room');

    if (!params.get('room')) {
        const url = new URL(location);
        url.searchParams.set('room', State.roomId);
        history.replaceState({}, '', url);
    }

    DOM.roomId.textContent = State.roomId;

    UI.init();

    try {
        await Connection.init();
        Toast.success('Connected');
    } catch (err) {
        console.error('Init error:', err);
        Toast.error('Connection failed');
    }

    DOM.toolbar.classList.add('visible');
    setTimeout(() => DOM.toolbar.classList.remove('visible'), 2500);
}

document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();