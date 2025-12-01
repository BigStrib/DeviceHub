/* ========================================
   DeviceHub - Dark Red Theme
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
    connections: new Map(),
    videoBoxes: new Map(),
    activeBox: null,
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
    interaction: null
};

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

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

        State.videoBoxes.set(id, { el: box, video, stream, opts, muted: !!opts.muted });

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

        if (data.opts.isLocal) {
            data.stream.getTracks().forEach(t => t.stop());
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
            State.connections.set(pid, { data: conn, info: conn.metadata?.info || {} });
            this.updateCount();

            conn.send({ type: 'info', info: Utils.deviceInfo(), room: State.roomId });

            State.videoBoxes.forEach(d => {
                if (d.opts.isLocal && d.stream) {
                    this.callPeer(pid, d.stream, d.opts);
                }
            });
        });

        conn.on('data', data => {
            if (data.type === 'info') {
                const c = State.connections.get(pid);
                if (c) c.info = data.info;
            }
        });

        conn.on('close', () => this.removePeer(pid));
    },

    handleCall(call) {
        call.answer();
        call.on('stream', stream => {
            const info = call.metadata?.info || {};
            VideoBox.create(stream, {
                label: info.type || 'Remote',
                icon: info.icon || 'fa-desktop',
                type: 'remote',
                peerId: call.peer
            });
        });
    },

    callPeer(pid, stream, opts = {}) {
        const call = State.peer.call(pid, stream, { metadata: { info: Utils.deviceInfo(), ...opts } });
        const c = State.connections.get(pid);
        if (c) c.media = call;
    },

    removePeer(pid) {
        const c = State.connections.get(pid);
        if (c) {
            c.data?.close();
            c.media?.close();
        }
        State.connections.delete(pid);
        this.updateCount();

        State.videoBoxes.forEach((d, id) => {
            if (d.opts.peerId === pid) VideoBox.remove(id);
        });

        Toast.info('Device disconnected');
    },

    updateCount() {
        DOM.connectionCount.textContent = State.connections.size;
    }
};

const UI = {
    init() {
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
                VideoBox.create(stream, {
                    label: 'Camera',
                    icon: 'fa-video',
                    type: 'camera',
                    mirror: DOM.mirrorVideo.checked,
                    muted: true,
                    isLocal: true
                });

                Modal.close(DOM.sourceModal);

                State.connections.forEach((_, pid) => {
                    Connection.callPeer(pid, stream, { type: 'camera' });
                });
            }
        };

        DOM.startWindowBtn.onclick = async () => {
            const stream = await Media.getWindow(DOM.windowAudio.checked);

            if (stream) {
                VideoBox.create(stream, {
                    label: 'Window',
                    icon: 'fa-window-maximize',
                    type: 'window',
                    muted: true,
                    isLocal: true
                });

                stream.getVideoTracks()[0].onended = () => {
                    State.videoBoxes.forEach((d, id) => {
                        if (d.stream === stream) VideoBox.remove(id);
                    });
                };

                Modal.close(DOM.sourceModal);

                State.connections.forEach((_, pid) => {
                    Connection.callPeer(pid, stream, { type: 'window' });
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