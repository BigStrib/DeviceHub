/* ========================================
   DeviceHub - Host Controls All Sources
   External users submit, Host displays
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
    hostPeerId: null,
    connections: new Map(),
    videoBoxes: new Map(),
    localStreams: new Map(),
    submittedSources: new Map(), // Sources submitted by guests
    pendingSources: new Map(), // Sources waiting for host to display
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
    interaction: null
};

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ========================================
// Dynamic UI Creation
// ========================================
function createHostPanel() {
    const panel = document.createElement('div');
    panel.id = 'host-panel';
    panel.className = 'host-panel hidden';
    panel.innerHTML = `
        <div class="panel-header">
            <h3><i class="fas fa-tv"></i> Source Manager</h3>
            <button class="panel-close" id="close-host-panel"><i class="fas fa-times"></i></button>
        </div>
        <div class="panel-tabs">
            <button class="panel-tab active" data-tab="available">Available Sources</button>
            <button class="panel-tab" data-tab="devices">Devices</button>
        </div>
        <div class="panel-body">
            <div class="tab-content active" id="tab-available">
                <div id="available-sources" class="source-list">
                    <div class="empty-state">
                        <i class="fas fa-broadcast-tower"></i>
                        <p>No sources submitted</p>
                        <span>Waiting for devices to submit sources...</span>
                    </div>
                </div>
            </div>
            <div class="tab-content" id="tab-devices">
                <div id="device-list" class="device-list">
                    <div class="empty-state">
                        <i class="fas fa-plug"></i>
                        <p>No devices connected</p>
                        <span>Share your Room ID</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);
    return panel;
}

function createGuestPanel() {
    const panel = document.createElement('div');
    panel.id = 'guest-panel';
    panel.className = 'guest-panel hidden';
    panel.innerHTML = `
        <div class="panel-header">
            <h3><i class="fas fa-share-alt"></i> Submit Source</h3>
            <button class="panel-close" id="close-guest-panel"><i class="fas fa-times"></i></button>
        </div>
        <div class="panel-body">
            <p class="panel-desc">Share your camera or window with the host</p>
            <div class="guest-options">
                <button class="guest-source-btn" id="submit-camera">
                    <i class="fas fa-video"></i>
                    <span>Share Camera</span>
                </button>
                <button class="guest-source-btn" id="submit-window">
                    <i class="fas fa-window-maximize"></i>
                    <span>Share Window</span>
                </button>
            </div>
            <div class="submitted-sources" id="my-sources">
                <!-- User's submitted sources shown here -->
            </div>
        </div>
    `;
    document.body.appendChild(panel);
    return panel;
}

function createGuestToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = 'guest-toolbar';
    toolbar.className = 'guest-toolbar';
    toolbar.innerHTML = `
        <div class="guest-status">
            <span class="status-dot connected"></span>
            <span>Connected to Host</span>
        </div>
        <button id="open-guest-panel" class="guest-toolbar-btn">
            <i class="fas fa-share-alt"></i>
            Submit Source
        </button>
    `;
    document.body.appendChild(toolbar);
    return toolbar;
}

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* ========================================
           Host Panel Styles
        ======================================== */
        .host-panel {
            position: fixed;
            top: 60px;
            left: 16px;
            width: 340px;
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
        
        .host-panel.hidden, .guest-panel.hidden {
            display: none;
        }
        
        .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            border-bottom: 1px solid var(--border);
            background: var(--surface-hover);
        }
        
        .panel-header h3 {
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .panel-header h3 i {
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
        
        .panel-tabs {
            display: flex;
            border-bottom: 1px solid var(--border);
        }
        
        .panel-tab {
            flex: 1;
            padding: 12px;
            border: none;
            background: transparent;
            color: var(--text-secondary);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all var(--transition);
            position: relative;
        }
        
        .panel-tab:hover {
            color: var(--text);
            background: var(--surface-hover);
        }
        
        .panel-tab.active {
            color: var(--accent);
        }
        
        .panel-tab.active::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: var(--accent);
        }
        
        .panel-body {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
        }
        
        .empty-state {
            text-align: center;
            padding: 32px 16px;
            color: var(--text-muted);
        }
        
        .empty-state i {
            font-size: 32px;
            margin-bottom: 12px;
            opacity: 0.4;
        }
        
        .empty-state p {
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 4px;
        }
        
        .empty-state span {
            font-size: 12px;
        }
        
        /* Source Cards */
        .source-card {
            background: var(--surface-hover);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 12px;
            margin-bottom: 10px;
            animation: slideIn 0.2s ease;
        }
        
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .source-card-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }
        
        .source-icon {
            width: 36px;
            height: 36px;
            background: var(--accent-light);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--accent);
            font-size: 14px;
        }
        
        .source-info {
            flex: 1;
            min-width: 0;
        }
        
        .source-name {
            font-size: 13px;
            font-weight: 600;
            color: var(--text);
        }
        
        .source-device {
            font-size: 11px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .source-preview {
            width: 100%;
            aspect-ratio: 16/9;
            background: #000;
            border-radius: 6px;
            overflow: hidden;
            margin-bottom: 10px;
        }
        
        .source-preview video {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        
        .source-actions {
            display: flex;
            gap: 8px;
        }
        
        .source-action-btn {
            flex: 1;
            padding: 8px 12px;
            border: none;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all var(--transition);
        }
        
        .source-action-btn.primary {
            background: var(--accent);
            color: #fff;
        }
        
        .source-action-btn.primary:hover {
            background: var(--accent-hover);
        }
        
        .source-action-btn.secondary {
            background: var(--surface-active);
            color: var(--text);
        }
        
        .source-action-btn.secondary:hover {
            background: var(--border);
        }
        
        .source-action-btn.danger {
            background: transparent;
            border: 1px solid var(--danger);
            color: var(--danger);
        }
        
        .source-action-btn.danger:hover {
            background: var(--danger);
            color: #fff;
        }
        
        .source-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            background: var(--success);
            color: #fff;
            font-size: 10px;
            font-weight: 600;
            border-radius: 4px;
            margin-left: auto;
        }
        
        .source-badge.pending {
            background: var(--warning);
        }
        
        /* Device Cards */
        .device-card {
            background: var(--surface-hover);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 12px;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 12px;
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
        }
        
        .device-info {
            flex: 1;
        }
        
        .device-name {
            font-size: 14px;
            font-weight: 600;
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
        
        .device-sources-count {
            font-size: 11px;
            color: var(--text-muted);
        }
        
        .device-kick {
            width: 28px;
            height: 28px;
            border: none;
            background: transparent;
            color: var(--text-muted);
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all var(--transition);
        }
        
        .device-kick:hover {
            background: var(--danger);
            color: #fff;
        }
        
        /* ========================================
           Guest Panel & Toolbar Styles
        ======================================== */
        .guest-panel {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            width: 320px;
            max-width: calc(100vw - 32px);
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            z-index: 250;
            overflow: hidden;
        }
        
        .panel-desc {
            font-size: 13px;
            color: var(--text-secondary);
            text-align: center;
            margin-bottom: 16px;
        }
        
        .guest-options {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 16px;
        }
        
        .guest-source-btn {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 20px 16px;
            background: var(--surface-hover);
            border: 2px solid var(--border);
            border-radius: var(--radius);
            color: var(--text);
            cursor: pointer;
            transition: all var(--transition);
        }
        
        .guest-source-btn:hover {
            border-color: var(--accent);
            background: var(--accent-light);
        }
        
        .guest-source-btn:active {
            transform: scale(0.97);
        }
        
        .guest-source-btn i {
            font-size: 24px;
            color: var(--accent);
        }
        
        .guest-source-btn span {
            font-size: 12px;
            font-weight: 600;
        }
        
        .guest-source-btn:disabled {
            opacity: 0.5;
            pointer-events: none;
        }
        
        .submitted-sources {
            border-top: 1px solid var(--border);
            padding-top: 12px;
            margin-top: 8px;
        }
        
        .submitted-source {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px;
            background: var(--surface-hover);
            border-radius: var(--radius);
            margin-bottom: 8px;
        }
        
        .submitted-source-icon {
            width: 32px;
            height: 32px;
            background: var(--accent-light);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--accent);
            font-size: 12px;
        }
        
        .submitted-source-info {
            flex: 1;
        }
        
        .submitted-source-name {
            font-size: 12px;
            font-weight: 600;
        }
        
        .submitted-source-status {
            font-size: 10px;
            color: var(--text-secondary);
        }
        
        .submitted-source-status.live {
            color: var(--success);
        }
        
        .submitted-source-stop {
            width: 26px;
            height: 26px;
            border: none;
            background: var(--danger);
            color: #fff;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            transition: all var(--transition);
        }
        
        .submitted-source-stop:hover {
            background: var(--danger-hover);
        }
        
        /* Guest Toolbar */
        .guest-toolbar {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 12px 20px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 50px;
            box-shadow: var(--shadow-lg);
            z-index: 200;
        }
        
        .guest-status {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--text-secondary);
        }
        
        .guest-status .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--text-muted);
        }
        
        .guest-status .status-dot.connected {
            background: var(--success);
            box-shadow: 0 0 8px var(--success);
        }
        
        .guest-toolbar-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 18px;
            background: var(--accent);
            border: none;
            border-radius: 50px;
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all var(--transition);
        }
        
        .guest-toolbar-btn:hover {
            background: var(--accent-hover);
        }
        
        /* Hide host elements for guests */
        body.guest-mode .toolbar {
            display: none;
        }
        
        body.guest-mode .room-badge {
            display: none;
        }
        
        body.guest-mode .status-badge {
            display: none;
        }
        
        /* Notification Badge */
        .notif-badge {
            position: absolute;
            top: -4px;
            right: -4px;
            min-width: 18px;
            height: 18px;
            background: var(--danger);
            color: #fff;
            font-size: 10px;
            font-weight: 700;
            border-radius: 9px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0 5px;
            animation: pulse 1.5s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }
        
        .notif-badge.hidden {
            display: none;
        }
        
        /* Responsive */
        @media (max-width: 600px) {
            .host-panel {
                top: auto;
                bottom: 80px;
                left: 10px;
                right: 10px;
                width: auto;
                max-height: 60vh;
            }
            
            .guest-panel {
                bottom: 70px;
                width: calc(100% - 20px);
            }
            
            .guest-toolbar {
                bottom: 12px;
                padding: 10px 16px;
            }
        }
    `;
    document.head.appendChild(style);
}

let hostPanel, guestPanel, guestToolbar;

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
// Host Panel Manager
// ========================================
const HostPanel = {
    init() {
        hostPanel = createHostPanel();
        
        $('close-host-panel').onclick = () => this.hide();
        
        // Tab switching
        hostPanel.querySelectorAll('.panel-tab').forEach(tab => {
            tab.onclick = () => {
                hostPanel.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
                hostPanel.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                $('tab-' + tab.dataset.tab).classList.add('active');
            };
        });
        
        // Make status badge clickable to open panel
        DOM.statusBadge.style.cursor = 'pointer';
        DOM.statusBadge.onclick = () => this.toggle();
        
        // Add notification badge to status
        const badge = document.createElement('span');
        badge.className = 'notif-badge hidden';
        badge.id = 'source-notif';
        badge.textContent = '0';
        DOM.statusBadge.style.position = 'relative';
        DOM.statusBadge.appendChild(badge);
    },
    
    show() {
        hostPanel.classList.remove('hidden');
        this.render();
    },
    
    hide() {
        hostPanel.classList.add('hidden');
    },
    
    toggle() {
        if (hostPanel.classList.contains('hidden')) {
            this.show();
        } else {
            this.hide();
        }
    },
    
    updateNotification() {
        const badge = $('source-notif');
        const count = State.pendingSources.size;
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
    },
    
    render() {
        this.renderSources();
        this.renderDevices();
        this.updateNotification();
    },
    
    renderSources() {
        const container = $('available-sources');
        
        if (State.pendingSources.size === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-broadcast-tower"></i>
                    <p>No sources available</p>
                    <span>Waiting for devices to submit sources...</span>
                </div>
            `;
            return;
        }
        
        container.innerHTML = '';
        
        State.pendingSources.forEach((source, sourceId) => {
            const card = document.createElement('div');
            card.className = 'source-card';
            card.dataset.sourceId = sourceId;
            
            const isDisplayed = this.isSourceDisplayed(sourceId);
            
            card.innerHTML = `
                <div class="source-card-header">
                    <div class="source-icon">
                        <i class="fas ${source.type === 'camera' ? 'fa-video' : 'fa-window-maximize'}"></i>
                    </div>
                    <div class="source-info">
                        <div class="source-name">${source.type === 'camera' ? 'Camera' : 'Window'}</div>
                        <div class="source-device">
                            <i class="fas ${source.deviceInfo?.icon || 'fa-desktop'}"></i>
                            ${source.deviceInfo?.type || 'Device'}
                        </div>
                    </div>
                    ${isDisplayed ? '<span class="source-badge"><i class="fas fa-eye"></i> Live</span>' : ''}
                </div>
                <div class="source-preview">
                    <video autoplay playsinline muted></video>
                </div>
                <div class="source-actions">
                    ${isDisplayed ? `
                        <button class="source-action-btn danger" data-action="hide" data-source-id="${sourceId}">
                            <i class="fas fa-eye-slash"></i> Remove
                        </button>
                    ` : `
                        <button class="source-action-btn primary" data-action="display" data-source-id="${sourceId}">
                            <i class="fas fa-plus"></i> Add to Canvas
                        </button>
                    `}
                </div>
            `;
            
            // Set video source
            const video = card.querySelector('video');
            video.srcObject = source.stream;
            
            // Action buttons
            card.querySelector('[data-action]').onclick = (e) => {
                const action = e.currentTarget.dataset.action;
                const sid = e.currentTarget.dataset.sourceId;
                
                if (action === 'display') {
                    this.displaySource(sid);
                } else if (action === 'hide') {
                    this.hideSource(sid);
                }
            };
            
            container.appendChild(card);
        });
    },
    
    renderDevices() {
        const container = $('device-list');
        
        if (State.connections.size === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-plug"></i>
                    <p>No devices connected</p>
                    <span>Share your Room ID</span>
                </div>
            `;
            return;
        }
        
        container.innerHTML = '';
        
        State.connections.forEach((conn, peerId) => {
            const card = document.createElement('div');
            card.className = 'device-card';
            
            const sourceCount = this.countSourcesFromPeer(peerId);
            
            card.innerHTML = `
                <div class="device-icon">
                    <i class="fas ${conn.info?.icon || 'fa-desktop'}"></i>
                </div>
                <div class="device-info">
                    <div class="device-name">${conn.info?.type || 'Device'}</div>
                    <div class="device-status">Connected</div>
                    <div class="device-sources-count">${sourceCount} source${sourceCount !== 1 ? 's' : ''} shared</div>
                </div>
                <button class="device-kick" data-peer-id="${peerId}" title="Disconnect">
                    <i class="fas fa-times"></i>
                </button>
            `;
            
            card.querySelector('.device-kick').onclick = () => {
                Connection.removePeer(peerId);
            };
            
            container.appendChild(card);
        });
    },
    
    isSourceDisplayed(sourceId) {
        for (const [id, box] of State.videoBoxes) {
            if (box.sourceId === sourceId) return true;
        }
        return false;
    },
    
    countSourcesFromPeer(peerId) {
        let count = 0;
        State.pendingSources.forEach(source => {
            if (source.peerId === peerId) count++;
        });
        return count;
    },
    
    displaySource(sourceId) {
        const source = State.pendingSources.get(sourceId);
        if (!source) return;
        
        const boxId = VideoBox.create(source.stream, {
            label: `${source.deviceInfo?.type || 'Remote'} - ${source.type === 'camera' ? 'Camera' : 'Window'}`,
            icon: source.type === 'camera' ? 'fa-video' : 'fa-window-maximize',
            type: 'remote',
            sourceId: sourceId,
            peerId: source.peerId,
            mirror: source.type === 'camera'
        });
        
        // Notify guest that source is now live
        Connection.send(source.peerId, {
            type: 'source-status',
            sourceId: sourceId,
            status: 'live'
        });
        
        this.render();
        Toast.success('Source added to canvas');
    },
    
    hideSource(sourceId) {
        // Find and remove the video box
        State.videoBoxes.forEach((box, boxId) => {
            if (box.sourceId === sourceId) {
                VideoBox.remove(boxId);
            }
        });
        
        const source = State.pendingSources.get(sourceId);
        if (source) {
            // Notify guest that source is hidden
            Connection.send(source.peerId, {
                type: 'source-status',
                sourceId: sourceId,
                status: 'hidden'
            });
        }
        
        this.render();
    }
};

// ========================================
// Guest Panel Manager
// ========================================
const GuestPanel = {
    init() {
        guestPanel = createGuestPanel();
        guestToolbar = createGuestToolbar();
        
        $('close-guest-panel').onclick = () => this.hide();
        $('open-guest-panel').onclick = () => this.show();
        
        $('submit-camera').onclick = () => this.submitSource('camera');
        $('submit-window').onclick = () => this.submitSource('window');
    },
    
    show() {
        guestPanel.classList.remove('hidden');
        this.render();
    },
    
    hide() {
        guestPanel.classList.add('hidden');
    },
    
    async submitSource(type) {
        let stream;
        
        try {
            if (type === 'camera') {
                stream = await Media.getCamera({ audio: true });
            } else {
                stream = await Media.getWindow(false);
            }
            
            if (!stream) return;
            
            const sourceId = 'src-' + Utils.genId(8);
            
            // Store locally
            State.localStreams.set(sourceId, {
                stream,
                type,
                status: 'pending'
            });
            
            // Send stream to host
            const call = State.peer.call(State.hostPeerId, stream, {
                metadata: {
                    sourceId,
                    type,
                    deviceInfo: Utils.deviceInfo()
                }
            });
            
            // Notify host about new source
            Connection.send(State.hostPeerId, {
                type: 'source-submitted',
                sourceId,
                sourceType: type,
                deviceInfo: Utils.deviceInfo()
            });
            
            // Handle stream end
            stream.getTracks().forEach(track => {
                track.onended = () => {
                    this.stopSource(sourceId);
                };
            });
            
            this.render();
            Toast.success(`${type === 'camera' ? 'Camera' : 'Window'} shared with host`);
            
        } catch (err) {
            console.error('Submit source error:', err);
            Toast.error('Failed to share ' + type);
        }
    },
    
    stopSource(sourceId) {
        const source = State.localStreams.get(sourceId);
        if (!source) return;
        
        // Stop tracks
        source.stream.getTracks().forEach(t => t.stop());
        
        // Notify host
        if (State.hostPeerId) {
            Connection.send(State.hostPeerId, {
                type: 'source-stopped',
                sourceId
            });
        }
        
        State.localStreams.delete(sourceId);
        this.render();
        
        Toast.info('Source stopped');
    },
    
    updateSourceStatus(sourceId, status) {
        const source = State.localStreams.get(sourceId);
        if (source) {
            source.status = status;
            this.render();
        }
    },
    
    render() {
        const container = $('my-sources');
        
        if (State.localStreams.size === 0) {
            container.innerHTML = '';
            return;
        }
        
        container.innerHTML = '<div class="source-label" style="margin-top:0;">Your Shared Sources</div>';
        
        State.localStreams.forEach((source, sourceId) => {
            const item = document.createElement('div');
            item.className = 'submitted-source';
            item.innerHTML = `
                <div class="submitted-source-icon">
                    <i class="fas ${source.type === 'camera' ? 'fa-video' : 'fa-window-maximize'}"></i>
                </div>
                <div class="submitted-source-info">
                    <div class="submitted-source-name">${source.type === 'camera' ? 'Camera' : 'Window'}</div>
                    <div class="submitted-source-status ${source.status === 'live' ? 'live' : ''}">
                        ${source.status === 'live' ? '● Live on host screen' : 
                          source.status === 'hidden' ? 'Hidden by host' : 'Waiting for host...'}
                    </div>
                </div>
                <button class="submitted-source-stop" data-source-id="${sourceId}" title="Stop sharing">
                    <i class="fas fa-stop"></i>
                </button>
            `;
            
            item.querySelector('.submitted-source-stop').onclick = () => {
                this.stopSource(sourceId);
            };
            
            container.appendChild(item);
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
            sourceId: opts.sourceId,
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

        // If this is a displayed remote source, update host panel
        if (data.sourceId) {
            const source = State.pendingSources.get(data.sourceId);
            if (source) {
                Connection.send(source.peerId, {
                    type: 'source-status',
                    sourceId: data.sourceId,
                    status: 'hidden'
                });
            }
        }

        // If local stream, stop it
        if (data.opts.isLocal) {
            data.stream.getTracks().forEach(t => t.stop());
            State.localStreams.delete(data.opts.streamId);
        }

        data.el.remove();
        State.videoBoxes.delete(id);
        if (State.activeBox === id) State.activeBox = null;
        
        if (State.isHost) {
            HostPanel.render();
        }
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
// Connection Manager
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
                
                if (err.type === 'peer-unavailable') {
                    Toast.error('Host not found');
                } else {
                    Toast.error('Connection error');
                }
            });

            State.peer.on('connection', conn => this.handleData(conn));
            State.peer.on('call', call => this.handleCall(call));

            State.peer.on('disconnected', () => {
                DOM.statusBadge.classList.remove('connected');
                setTimeout(() => State.peer?.reconnect?.(), 3000);
            });
        });
    },

    connectToHost(hostPeerId) {
        if (!State.peer) return;
        
        State.hostPeerId = hostPeerId;
        
        const conn = State.peer.connect(hostPeerId, {
            reliable: true,
            metadata: { 
                info: Utils.deviceInfo(), 
                room: State.roomId,
                isGuest: true
            }
        });
        
        this.handleData(conn);
    },

    handleData(conn) {
        const pid = conn.peer;

        conn.on('open', () => {
            const isGuest = conn.metadata?.isGuest;
            
            State.connections.set(pid, { 
                data: conn, 
                info: conn.metadata?.info || {},
                isGuest: isGuest
            });
            
            this.updateCount();
            
            if (State.isHost) {
                // Host: send welcome
                conn.send({ 
                    type: 'welcome',
                    hostId: State.peerId
                });
                
                Toast.success(`${conn.metadata?.info?.type || 'Device'} connected`);
                HostPanel.render();
            }
        });

        conn.on('data', data => this.handleMessage(pid, data));
        conn.on('close', () => this.removePeer(pid));
    },

    handleCall(call) {
        if (!State.isHost) return; // Only host receives calls
        
        call.answer(); // Host automatically answers
        
        call.on('stream', stream => {
            const meta = call.metadata || {};
            const sourceId = meta.sourceId;
            
            // Store as pending source for host to display
            State.pendingSources.set(sourceId, {
                stream,
                type: meta.type,
                peerId: call.peer,
                deviceInfo: meta.deviceInfo,
                mediaConn: call
            });
            
            Toast.info('New source available');
            HostPanel.render();
        });
    },

    handleMessage(pid, data) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'welcome':
                // Guest received welcome from host
                State.hostPeerId = data.hostId;
                Toast.success('Connected to host');
                break;

            case 'source-submitted':
                // Host: guest submitted a new source (notification only, stream comes via call)
                Toast.info(`New ${data.sourceType} from ${data.deviceInfo?.type || 'device'}`);
                break;

            case 'source-stopped':
                // Host: guest stopped a source
                this.handleSourceStopped(pid, data.sourceId);
                break;

            case 'source-status':
                // Guest: host updated source status
                if (!State.isHost) {
                    GuestPanel.updateSourceStatus(data.sourceId, data.status);
                }
                break;

            case 'kick':
                // Guest: kicked by host
                Toast.warning('Disconnected by host');
                setTimeout(() => location.reload(), 2000);
                break;
        }
    },

    handleSourceStopped(peerId, sourceId) {
        // Remove from pending sources
        const source = State.pendingSources.get(sourceId);
        if (source) {
            source.mediaConn?.close();
            State.pendingSources.delete(sourceId);
        }
        
        // Remove video box if displayed
        State.videoBoxes.forEach((box, boxId) => {
            if (box.sourceId === sourceId) {
                VideoBox.remove(boxId);
            }
        });
        
        HostPanel.render();
        Toast.info('Source stopped');
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
        }
        
        // Remove all sources from this peer
        State.pendingSources.forEach((source, sourceId) => {
            if (source.peerId === pid) {
                source.mediaConn?.close();
                State.pendingSources.delete(sourceId);
                
                // Remove displayed video box
                State.videoBoxes.forEach((box, boxId) => {
                    if (box.sourceId === sourceId) {
                        box.el.remove();
                        State.videoBoxes.delete(boxId);
                    }
                });
            }
        });
        
        State.connections.delete(pid);
        this.updateCount();
        
        if (State.isHost) {
            HostPanel.render();
        }

        Toast.info('Device disconnected');
    },

    kickPeer(peerId) {
        this.send(peerId, { type: 'kick' });
        setTimeout(() => this.removePeer(peerId), 500);
    },

    updateCount() {
        DOM.connectionCount.textContent = State.connections.size;
    }
};

// ========================================
// UI Setup
// ========================================
const UI = {
    init() {
        injectStyles();
        
        if (State.isHost) {
            HostPanel.init();
        } else {
            GuestPanel.init();
            document.body.classList.add('guest-mode');
        }
        
        this.bindToolbar();
        this.bindModals();
        this.bindSettings();
        this.loadSettings();
    },

    bindToolbar() {
        if (!State.isHost) return; // Guests don't have the main toolbar
        
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
                Modal.confirm('Remove all sources from canvas?', () => VideoBox.removeAll());
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

        // Host's local source creation
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
                    label: 'My Camera',
                    icon: 'fa-video',
                    type: 'camera',
                    mirror: DOM.mirrorVideo.checked,
                    muted: true,
                    isLocal: true,
                    streamId
                });

                Modal.close(DOM.sourceModal);
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
                    label: 'My Window',
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
                if (State.isHost) HostPanel.hide();
                else GuestPanel.hide();
            }
            if (e.key === 'Delete' && State.activeBox && !e.target.closest('input') && State.isHost) {
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

// ========================================
// Initialize
// ========================================
async function init() {
    const params = new URLSearchParams(location.search);
    const roomParam = params.get('room')?.toUpperCase();
    
    // Determine if this is host or guest
    if (roomParam) {
        // Joining existing room = Guest
        State.roomId = roomParam;
        State.isHost = false;
    } else {
        // Creating new room = Host
        State.roomId = Utils.genRoomId();
        State.isHost = true;
        
        const url = new URL(location);
        url.searchParams.set('room', State.roomId);
        history.replaceState({}, '', url);
    }

    DOM.roomId.textContent = State.roomId;

    UI.init();

    try {
        await Connection.init();
        
        if (State.isHost) {
            // Host uses their peer ID as the "room host"
            // Store hostPeerId in URL or use room-based lookup
            console.log('Host ready. Peer ID:', State.peerId);
            Toast.success('Room created');
            
            DOM.toolbar.classList.add('visible');
            setTimeout(() => DOM.toolbar.classList.remove('visible'), 2500);
        } else {
            // Guest needs to connect to host
            // For simplicity, we encode host peer ID in the room somehow
            // Or guests connect using a known pattern
            const hostPeerId = 'dh-host-' + State.roomId.replace('-', '');
            
            // Wait a moment then try connecting
            setTimeout(() => {
                Connection.connectToHost(hostPeerId);
            }, 1000);
            
            Toast.info('Connecting to host...');
        }
        
    } catch (err) {
        console.error('Init error:', err);
        Toast.error('Connection failed');
    }
}

// For hosts, create with a predictable ID based on room
async function initAsHost() {
    return new Promise((resolve, reject) => {
        const hostId = 'dh-host-' + State.roomId.replace('-', '');

        State.peer = new Peer(hostId, {
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
            
            if (err.type === 'unavailable-id') {
                // Room already exists, join as guest instead
                State.isHost = false;
                document.body.classList.add('guest-mode');
                Connection.init().then(() => {
                    const hostPeerId = 'dh-host-' + State.roomId.replace('-', '');
                    Connection.connectToHost(hostPeerId);
                });
            } else {
                Toast.error('Connection error');
            }
        });

        State.peer.on('connection', conn => Connection.handleData(conn));
        State.peer.on('call', call => Connection.handleCall(call));

        State.peer.on('disconnected', () => {
            DOM.statusBadge.classList.remove('connected');
            setTimeout(() => State.peer?.reconnect?.(), 3000);
        });
    });
}

async function start() {
    const params = new URLSearchParams(location.search);
    const roomParam = params.get('room')?.toUpperCase();
    
    if (roomParam) {
        State.roomId = roomParam;
        State.isHost = false;
    } else {
        State.roomId = Utils.genRoomId();
        State.isHost = true;
        
        const url = new URL(location);
        url.searchParams.set('room', State.roomId);
        history.replaceState({}, '', url);
    }

    DOM.roomId.textContent = State.roomId;

    UI.init();

    try {
        if (State.isHost) {
            await initAsHost();
            Toast.success('Room created');
            
            DOM.toolbar.classList.add('visible');
            setTimeout(() => DOM.toolbar.classList.remove('visible'), 2500);
        } else {
            await Connection.init();
            
            const hostPeerId = 'dh-host-' + State.roomId.replace('-', '');
            setTimeout(() => {
                Connection.connectToHost(hostPeerId);
            }, 500);
            
            Toast.info('Connecting to host...');
        }
    } catch (err) {
        console.error('Init error:', err);
        Toast.error('Connection failed');
    }
}

document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', start)
    : start();