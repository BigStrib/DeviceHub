/* ========================================
   DeviceHub - Host/Guest with Login
   Host controls all sources; guests submit
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
        '1080': { width: 1920, height: 1080 }
    },
    defaultSize: { width: 400, height: 225 },
    minSize: { width: 120, height: 68 }
};

const State = {
    peer: null,
    peerId: null,
    roomId: null,
    isHost: false,
    hostPeerId: null,
    hostConnection: null,
    connections: new Map(),     // host: guestId -> { data, info }
    pendingSources: new Map(),  // host: sourceId -> {stream, type, peerId, deviceInfo, call}
    localSources: new Map(),    // guest: sourceId -> {stream, type, facing, status}
    videoBoxes: new Map(),      // host: boxId -> {el, video, stream, sourceId, peerId, hostType}
    boxCounter: 0,
    interaction: null,
    settings: {
        resolution: '720',
        frameRate: 30,
        showLabels: true,
        showBorders: true,
        roundedCorners: true,
        lockRatio: true,
        bgColor: '#050509'
    },
    guestCameras: {
        frontId: null,
        backId: null,
        anyId: null
    }
};

const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const Utils = {
    genId(len = 6) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let r = '';
        for (let i = 0; i < len; i++) r += chars[Math.floor(Math.random() * chars.length)];
        return r;
    },
    genRoomId() { return this.genId(3) + this.genId(3); },
    cleanRoomId(id) {
        return id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    },
    formatRoomId(id) {
        const c = this.cleanRoomId(id);
        if (c.length <= 3) return c;
        return c.slice(0, 3) + '-' + c.slice(3);
    },
    roomToPeerId(roomId) { return 'devhub-' + this.cleanRoomId(roomId); },
    async copy(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const t = document.createElement('textarea');
            t.value = text;
            t.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(t);
            t.select();
            document.execCommand('copy');
            document.body.removeChild(t);
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

// -------------------- Toasts --------------------
const Toast = {
    show(msg, type = 'info', dur = 3000) {
        const cont = $('toast-container');
        if (!cont) return;
        const icons = {
            success: 'fa-check-circle',
            error:   'fa-times-circle',
            warning: 'fa-exclamation-triangle',
            info:    'fa-info-circle'
        };
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `
            <span class="toast-icon"><i class="fas ${icons[type]}"></i></span>
            <span class="toast-text">${msg}</span>
            <button class="toast-close"><i class="fas fa-times"></i></button>
        `;
        cont.appendChild(el);
        el.querySelector('.toast-close').onclick = () => this.dismiss(el);
        if (dur > 0) setTimeout(() => this.dismiss(el), dur);
    },
    dismiss(el) {
        if (!el) return;
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 250);
    },
    success(m) { this.show(m, 'success'); },
    error(m)   { this.show(m, 'error'); },
    warning(m) { this.show(m, 'warning'); },
    info(m)    { this.show(m, 'info'); }
};

// -------------------- Media --------------------
const Media = {
    async getCamera(constraints = {}) {
        const res = CONFIG.resolutions[State.settings.resolution] || CONFIG.resolutions['720'];
        const base = {
            video: {
                width: { ideal: res.width },
                height: { ideal: res.height },
                frameRate: { ideal: State.settings.frameRate }
            },
            audio: true
        };
        const merged = { ...base };
        if (constraints.video) merged.video = { ...base.video, ...constraints.video };
        if (constraints.audio !== undefined) merged.audio = constraints.audio;

        try {
            return await navigator.mediaDevices.getUserMedia(merged);
        } catch (err) {
            console.error('Camera error:', err);
            Toast.error('Cannot access camera/mic');
            return null;
        }
    },
    async getWindow() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            Toast.warning('Window/screen sharing not supported on this device');
            return null;
        }
        try {
            return await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: false
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Display error:', err);
                Toast.error('Cannot share window');
            }
            return null;
        }
    },
    async enumerateDevices() {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            s.getTracks().forEach(t => t.stop());
        } catch {}
        try {
            return await navigator.mediaDevices.enumerateDevices();
        } catch {
            return [];
        }
    }
};

// -------------------- Settings --------------------
const SettingsUI = {
    load() {
        try {
            const s = localStorage.getItem('dh-settings');
            if (s) Object.assign(State.settings, JSON.parse(s));
        } catch {}
        document.documentElement.style.setProperty('--bg-color', State.settings.bgColor);
        const canvas = $('canvas');
        if (canvas) canvas.style.background = 'var(--bg-color)';
    },
    save() {
        try { localStorage.setItem('dh-settings', JSON.stringify(State.settings)); } catch {}
    },
    applyToBox(el) {
        el.classList.toggle('no-border', !State.settings.showBorders);
        el.classList.toggle('no-radius', !State.settings.roundedCorners);
        el.classList.toggle('hide-labels', !State.settings.showLabels);
    },
    applyAll() {
        State.videoBoxes.forEach(b => this.applyToBox(b.el));
    },
    init() {
        const panel = $('settings-panel');
        const open  = $('host-settings-btn');
        const close = $('settings-close-btn');
        if (!panel || !open || !close) return;

        const sb = $('set-show-borders');
        const sl = $('set-show-labels');
        const rc = $('set-rounded-corners');
        const lr = $('set-lock-ratio');
        const bg = $('set-bg-color');

        const s = State.settings;
        sb.checked = s.showBorders;
        sl.checked = s.showLabels;
        rc.checked = s.roundedCorners;
        lr.checked = s.lockRatio;
        bg.value   = s.bgColor;

        open.onclick  = () => panel.classList.toggle('hidden');
        close.onclick = () => panel.classList.add('hidden');

        sb.onchange = () => { s.showBorders = sb.checked; this.applyAll(); this.save(); };
        sl.onchange = () => { s.showLabels  = sl.checked; this.applyAll(); this.save(); };
        rc.onchange = () => { s.roundedCorners = rc.checked; this.applyAll(); this.save(); };
        lr.onchange = () => { s.lockRatio = lr.checked; this.save(); };
        bg.oninput  = () => {
            s.bgColor = bg.value;
            document.documentElement.style.setProperty('--bg-color', s.bgColor);
            const canvas = $('canvas');
            if (canvas) canvas.style.background = 'var(--bg-color)';
            this.save();
        };
    }
};

// -------------------- Video Boxes (host canvas) --------------------
const VideoBox = {
    create(stream, opts = {}) {
        const id = 'box-' + (++State.boxCounter);
        const box = document.createElement('div');
        box.className = 'video-box';
        box.dataset.id = id;

        if (opts.mirror) box.classList.add('mirror');
        SettingsUI.applyToBox(box);

        const label = opts.label || 'Video';
        const icon  = opts.icon || 'fa-video';
        const hasAudio = stream.getAudioTracks().length > 0;

        box.innerHTML = `
            <video autoplay playsinline ${opts.muted ? 'muted' : ''}></video>
            <div class="video-label"><i class="fas ${icon}"></i><span>${label}</span></div>
            <div class="video-controls">
                <button class="video-control-btn" data-action="mute"><i class="fas fa-volume-up"></i></button>
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

        // For host window sharing, show entire captured screen without cropping
        if (opts.hostType === 'host-window') {
            video.style.objectFit = 'contain';
        }

        const canvas = $('canvas');
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
            sourceId: opts.sourceId || null,
            peerId: opts.peerId || null,
            hostType: opts.hostType || null   // 'host-camera' or 'host-window'
        });

        this.bindEvents(box, id);
        return id;
    },

    bindEvents(box, id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;

        box.querySelectorAll('.video-control-btn').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const act = btn.dataset.action;
                if (act === 'mute') this.toggleMute(id);
                if (act === 'close') this.remove(id);
            };
        });

        const startMove = e => {
            e.preventDefault();
            this.activate(id);
            data.el.classList.add('dragging');
            const r = data.el.getBoundingClientRect();
            const p = Utils.getPointer(e);
            const canvasRect = $('canvas').getBoundingClientRect();
            State.interaction = {
                type: 'move',
                id,
                startX: p.x,
                startY: p.y,
                origLeft: r.left,
                origTop: r.top,
                canvasRect
            };
            document.addEventListener('mousemove', this.onMove);
            document.addEventListener('mouseup', this.endMove);
            document.addEventListener('touchmove', this.onMove, { passive: false });
            document.addEventListener('touchend', this.endMove);
        };

        box.querySelector('.move-handle').addEventListener('mousedown', startMove);
        box.querySelector('.move-handle').addEventListener('touchstart', startMove, { passive: false });

        box.addEventListener('mousedown', e => {
            if (!e.target.closest('.video-control-btn') &&
                !e.target.closest('.resize-handle') &&
                !e.target.closest('.move-handle')) {
                startMove(e);
            }
        });
        box.addEventListener('touchstart', e => {
            if (!e.target.closest('.video-control-btn') &&
                !e.target.closest('.resize-handle') &&
                !e.target.closest('.move-handle')) {
                startMove(e);
            }
        }, { passive: false });

        box.querySelectorAll('.resize-handle').forEach(handle => {
            const startResize = e => {
                e.preventDefault();
                e.stopPropagation();
                this.activate(id);
                data.el.classList.add('resizing');
                const r = data.el.getBoundingClientRect();
                const p = Utils.getPointer(e);
                const canvasRect = $('canvas').getBoundingClientRect();
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
                    ratio: r.width / r.height,
                    canvasRect
                };
                document.addEventListener('mousemove', this.onResize);
                document.addEventListener('mouseup', this.endResize);
                document.addEventListener('touchmove', this.onResize, { passive: false });
                document.addEventListener('touchend', this.endResize);
            };

            handle.addEventListener('mousedown', startResize);
            handle.addEventListener('touchstart', startResize, { passive: false });
        });
    },

    activate(id) {
        State.videoBoxes.forEach(b => b.el.classList.remove('active'));
        const data = State.videoBoxes.get(id);
        if (data) data.el.classList.add('active');
    },

    onMove(e) {
        const int = State.interaction;
        if (!int || int.type !== 'move') return;
        e.preventDefault();
        const data = State.videoBoxes.get(int.id);
        if (!data) return;
        const p = Utils.getPointer(e);
        const rect = int.canvasRect;
        const w = data.el.offsetWidth;
        const h = data.el.offsetHeight;

        let x = int.origLeft + (p.x - int.startX) - rect.left;
        let y = int.origTop  + (p.y - int.startY) - rect.top;

        x = Utils.clamp(x, 0, rect.width  - w);
        y = Utils.clamp(y, 0, rect.height - h);

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
        document.removeEventListener('touchend', VideoBox.endMove);
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

        let { origLeft: left, origTop: top, origW: w, origH: h, ratio, dir, canvasRect } = int;
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

        left -= canvasRect.left;
        top  -= canvasRect.top;

        left = Utils.clamp(left, 0, canvasRect.width  - w);
        top  = Utils.clamp(top, 0, canvasRect.height - h);

        data.el.style.left = left + 'px';
        data.el.style.top  = top  + 'px';
        data.el.style.width  = w  + 'px';
        data.el.style.height = h  + 'px';
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
        document.removeEventListener('touchend', VideoBox.endResize);
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

    remove(id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;

        // If this tile is host's own camera or window, stop the stream
        if (data.hostType === 'host-camera' || data.hostType === 'host-window') {
            if (data.stream) {
                data.stream.getTracks().forEach(t => t.stop());
            }
        }

        data.el.remove();
        State.videoBoxes.delete(id);
    }
};

// -------------------- Connection Manager --------------------
const ConnectionManager = {
    async startHost() {
        const hostId = Utils.roomToPeerId(State.roomId);
        State.peer = new Peer(hostId, {
            debug: 2,
            config: { iceServers: CONFIG.iceServers }
        });

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout')), 15000);

            State.peer.on('open', id => {
                clearTimeout(timer);
                State.peerId = id;
                resolve();
            });

            State.peer.on('error', err => {
                clearTimeout(timer);
                console.error('Host error:', err);
                if (err.type === 'unavailable-id') reject(new Error('This room code is already in use'));
                else reject(new Error('Unable to start host'));
            });

            State.peer.on('connection', conn => {
                const pid = conn.peer;
                conn.on('open', () => {
                    State.connections.set(pid, { data: conn, info: conn.metadata?.deviceInfo || Utils.deviceInfo() });
                    conn.on('data', data => this.handleGuestMessage(pid, data));
                    conn.on('close', () => this.removePeer(pid));
                    conn.on('error', () => this.removePeer(pid));
                    HostPanelUI.render();
                    Toast.success('Device connected');
                });
            });

            State.peer.on('call', call => {
                call.answer();
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
                    HostPanelUI.render();
                    Toast.info('New source submitted');
                });
            });
        });
    },

    async startGuest() {
        State.peer = new Peer({
            debug: 2,
            config: { iceServers: CONFIG.iceServers }
        });
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('Timeout')), 15000);
            State.peer.on('open', id => {
                clearTimeout(t);
                State.peerId = id;
                resolve();
            });
            State.peer.on('error', err => {
                clearTimeout(t);
                console.error('Guest error:', err);
                reject(new Error('Unable to initialize guest connection'));
            });
        });
    },

    async connectToHost() {
        return new Promise((resolve, reject) => {
            const hostId = Utils.roomToPeerId(State.roomId);
            State.hostPeerId = hostId;
            const conn = State.peer.connect(hostId, {
                reliable: true,
                metadata: { deviceInfo: Utils.deviceInfo() }
            });
            const t = setTimeout(() => reject(new Error('Host not found')), 15000);

            conn.on('open', () => {
                clearTimeout(t);
                State.hostConnection = conn;
                conn.on('data', data => this.handleHostMessage(data));
                conn.on('close', () => Toast.warning('Disconnected from host'));
                resolve();
            });

            conn.on('error', err => {
                clearTimeout(t);
                console.error('Connect error:', err);
                reject(new Error('Host not found or offline'));
            });
        });
    },

    handleGuestMessage(peerId, data) {
        if (!data || !data.type) return;
        const conn = State.connections.get(peerId);
        switch (data.type) {
            case 'guest-info':
                if (conn) {
                    conn.info = data.deviceInfo;
                    HostPanelUI.render();
                }
                break;
            case 'source-ended': {
                const srcId = data.sourceId;
                const src = State.pendingSources.get(srcId);
                if (src) {
                    src.call?.close();
                    State.pendingSources.delete(srcId);
                    State.videoBoxes.forEach((box, boxId) => {
                        if (box.sourceId === srcId) VideoBox.remove(boxId);
                    });
                    HostPanelUI.render();
                }
                break;
            }
        }
    },

    handleHostMessage(data) {
        if (!data || !data.type) return;
        switch (data.type) {
            case 'source-status': {
                const src = State.localSources.get(data.sourceId);
                if (src) {
                    src.status = data.status;
                    GuestUI.render();
                }
                break;
            }
            case 'kick':
                Toast.warning('Disconnected by host');
                setTimeout(() => location.reload(), 2000);
                break;
            case 'host-remove-source': {
                const src = State.localSources.get(data.sourceId);
                if (src) {
                    src.stream.getTracks().forEach(t => t.stop());
                    State.localSources.delete(data.sourceId);
                    GuestUI.render();
                }
                break;
            }
        }
    },

    sendToGuest(peerId, msg) {
        const conn = State.connections.get(peerId);
        if (conn?.data?.open) conn.data.send(msg);
    },

    sendToHost(msg) {
        if (State.hostConnection?.open) State.hostConnection.send(msg);
    },

    removePeer(peerId) {
        const conn = State.connections.get(peerId);
        if (conn) conn.data?.close();
        State.pendingSources.forEach((src, id) => {
            if (src.peerId === peerId) {
                src.call?.close();
                State.pendingSources.delete(id);
                State.videoBoxes.forEach((box, boxId) => {
                    if (box.sourceId === id) VideoBox.remove(boxId);
                });
            }
        });
        State.connections.delete(peerId);
        HostPanelUI.render();
        Toast.info('Device disconnected');
    },

    kickPeer(peerId) {
        this.sendToGuest(peerId, { type: 'kick' });
        setTimeout(() => this.removePeer(peerId), 300);
    },

    // Host fully removes/rejects a source
    removeSource(sourceId) {
        const src = State.pendingSources.get(sourceId);
        if (!src) return;

        // Remove any tiles using this source
        State.videoBoxes.forEach((box, boxId) => {
            if (box.sourceId === sourceId) VideoBox.remove(boxId);
        });

        // Close call, stop stream
        try { src.call?.close(); } catch {}
        if (src.stream) src.stream.getTracks().forEach(t => t.stop());

        // Tell guest that host removed this source
        this.sendToGuest(src.peerId, {
            type: 'host-remove-source',
            sourceId
        });

        State.pendingSources.delete(sourceId);
        HostPanelUI.render();
        Toast.info('Source removed');
    }
};

// -------------------- Host Panel UI --------------------
const HostPanelUI = {
    init() {
        const panel = $('host-panel');
        const open  = $('open-host-panel-btn');
        const close = $('host-panel-close');
        if (!panel || !open || !close) return;

        const toggle = () => {
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) this.render();
        };

        open.onclick  = toggle;
        close.onclick = () => panel.classList.add('hidden');

        panel.querySelectorAll('.panel-tab').forEach(tab => {
            tab.onclick = () => {
                panel.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
                panel.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                $('tab-' + tab.dataset.tab).classList.add('active');
            };
        });
    },
    render() {
        this.renderSources();
        this.renderDevices();
        this.updateBadges();
    },
    updateBadges() {
        const s = $('sources-badge');
        const d = $('devices-badge');
        if (s) s.textContent = State.pendingSources.size;
        if (d) d.textContent = State.connections.size;
    },
    renderSources() {
        const cont = $('tab-sources');
        if (!cont) return;
        if (State.pendingSources.size === 0) {
            cont.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-video-slash"></i>
                    <p>No sources available</p>
                    <span>Ask devices to join and share camera.</span>
                </div>`;
            return;
        }
        cont.innerHTML = '';
        State.pendingSources.forEach((src, id) => {
            const displayed = [...State.videoBoxes.values()].some(b => b.sourceId === id);
            const card = document.createElement('div');
            card.className = 'source-card';
            card.innerHTML = `
                <div class="source-card-header">
                    <div class="source-icon">
                        <i class="fas fa-video"></i>
                    </div>
                    <div class="source-info">
                        <div class="source-name">Camera</div>
                        <div class="source-device">
                            <i class="fas ${src.deviceInfo?.icon || 'fa-desktop'}"></i>
                            ${src.deviceInfo?.type || 'Device'}
                        </div>
                    </div>
                    ${displayed ? '<span class="source-badge"><i class="fas fa-eye"></i> Live</span>' : ''}
                </div>
                <div class="source-preview">
                    <video autoplay muted playsinline></video>
                </div>
                <div class="source-actions">
                    <button class="source-btn ${displayed ? 'danger' : 'primary'}"
                            data-action="${displayed ? 'remove' : 'display'}"
                            data-id="${id}">
                        <i class="fas ${displayed ? 'fa-eye-slash' : 'fa-plus'}"></i>
                        ${displayed ? 'Remove from canvas' : 'Add to canvas'}
                    </button>
                    <button class="source-btn subtle"
                            data-action="delete"
                            data-id="${id}">
                        <i class="fas fa-trash-alt"></i>
                        Remove source
                    </button>
                </div>
            `;
            card.querySelector('video').srcObject = src.stream;

            card.querySelectorAll('.source-btn').forEach(btn => {
                btn.onclick = () => {
                    const act = btn.dataset.action;
                    const sid = btn.dataset.id;
                    if (act === 'display') {
                        VideoBox.create(src.stream, {
                            label: `${src.deviceInfo?.type || 'Device'} - Camera`,
                            icon: 'fa-video',
                            sourceId: sid,
                            peerId: src.peerId
                        });
                        ConnectionManager.sendToGuest(src.peerId, {
                            type: 'source-status',
                            sourceId: sid,
                            status: 'live'
                        });
                    } else if (act === 'remove') {
                        State.videoBoxes.forEach((box, boxId) => {
                            if (box.sourceId === sid) VideoBox.remove(boxId);
                        });
                        ConnectionManager.sendToGuest(src.peerId, {
                            type: 'source-status',
                            sourceId: sid,
                            status: 'hidden'
                        });
                    } else if (act === 'delete') {
                        ConnectionManager.removeSource(sid);
                    }
                    this.render();
                };
            });

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
                    <span>Share your room code with other devices.</span>
                </div>`;
            return;
        }
        cont.innerHTML = '';
        State.connections.forEach((conn, pid) => {
            const card = document.createElement('div');
            card.className = 'device-card';
            card.innerHTML = `
                <div class="device-icon">
                    <i class="fas ${conn.info?.icon || 'fa-desktop'}"></i>
                </div>
                <div class="device-info">
                    <div class="device-name">${conn.info?.type || 'Device'}</div>
                    <div class="device-meta">${pid}</div>
                </div>
                <button class="device-kick" title="Disconnect">
                    <i class="fas fa-times"></i>
                </button>
            `;
            card.querySelector('.device-kick').onclick = () => ConnectionManager.kickPeer(pid);
            cont.appendChild(card);
        });
    }
};

// -------------------- Guest UI --------------------
const GuestUI = {
    init() {
        document.body.classList.add('guest-mode');
        $('guest-screen').classList.remove('hidden');
        $('guest-room-code').textContent = Utils.formatRoomId(State.roomId);

        const frontBtn = $('share-camera-btn');
        const backBtn  = $('share-window-btn'); // back camera only
        const bothBtn  = null; // removed

        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            backBtn.style.display = 'none';
            frontBtn.innerHTML = '<i class="fas fa-video"></i><span>Share Camera</span>';
            frontBtn.onclick = () => this.shareCamera('any');
            return;
        }

        Media.enumerateDevices().then(devs => {
            const videos = devs.filter(d => d.kind === 'videoinput');
            if (videos.length === 0) {
                frontBtn.disabled = true;
                backBtn.style.display = 'none';
                Toast.error('No cameras found on this device');
                return;
            }

            let front = videos.find(d => /front/i.test(d.label));
            let back  = videos.find(d => /back|rear|environment/i.test(d.label));
            if (!front && videos[0]) front = videos[0];
            if (!back && videos[1])  back  = videos[1];

            State.guestCameras.anyId   = videos[0].deviceId;
            State.guestCameras.frontId = front ? front.deviceId : videos[0].deviceId;
            State.guestCameras.backId  = back && back.deviceId !== State.guestCameras.frontId
                ? back.deviceId
                : (videos[1]?.deviceId || null);

            if (!State.guestCameras.backId) {
                backBtn.style.display  = 'none';
                frontBtn.innerHTML = '<i class="fas fa-video"></i><span>Share Camera</span>';
                frontBtn.onclick = () => this.shareCamera('any');
            } else {
                frontBtn.innerHTML = '<i class="fas fa-video"></i><span>Front Camera</span>';
                backBtn.innerHTML  = '<i class="fas fa-camera-rotate"></i><span>Back Camera</span>';

                frontBtn.onclick = () => this.shareCamera('front');
                backBtn.onclick  = () => this.shareCamera('back');
            }
        }).catch(() => {
            backBtn.style.display  = 'none';
            frontBtn.innerHTML = '<i class="fas fa-video"></i><span>Share Camera</span>';
            frontBtn.onclick = () => this.shareCamera('any');
        });
    },
    setConnecting() {
        $('guest-status').classList.remove('hidden');
        $('guest-status').innerHTML = `
            <i class="fas fa-spinner fa-spin"></i>
            <span>Connecting to host...</span>
        `;
        $('guest-controls').classList.add('hidden');
    },
    setConnected() {
        $('guest-status').classList.add('hidden');
        $('guest-controls').classList.remove('hidden');
    },
    setError(msg) {
        $('guest-status').classList.remove('hidden');
        $('guest-status').innerHTML = `
            <i class="fas fa-exclamation-circle" style="color:var(--danger);"></i>
            <span>${msg}</span>
        `;
        $('guest-controls').classList.add('hidden');
    },
    async shareCamera(facing) {
        const existsSame = [...State.localSources.values()].some(
            s => s.type === 'camera' && (s.facing || 'any') === (facing || 'any')
        );
        if (existsSame) {
            Toast.warning(`${facing === 'back' ? 'Back' : facing === 'front' ? 'Front' : 'This'} camera already shared`);
            return;
        }

        let deviceId = null;
        if (facing === 'front') deviceId = State.guestCameras.frontId;
        else if (facing === 'back') deviceId = State.guestCameras.backId;
        else deviceId = State.guestCameras.anyId;

        const videoConstraints = deviceId
            ? { deviceId: { exact: deviceId } }
            : facing === 'back'
                ? { facingMode: { ideal: 'environment' } }
                : { facingMode: { ideal: 'user' } };

        const stream = await Media.getCamera({ video: videoConstraints });
        if (!stream) return;

        const sourceId = 'SRC-' + Utils.genId(6);
        State.localSources.set(sourceId, {
            stream,
            type: 'camera',
            facing: facing || 'any',
            status: 'pending'
        });

        const hostId = Utils.roomToPeerId(State.roomId);
        State.peer.call(hostId, stream, {
            metadata: { sourceId, type: 'camera', deviceInfo: Utils.deviceInfo() }
        });

        ConnectionManager.sendToHost({
            type: 'guest-info',
            deviceInfo: Utils.deviceInfo()
        });
        ConnectionManager.sendToHost({
            type: 'source-submitted',
            sourceId,
            sourceType: 'camera'
        });

        stream.getTracks().forEach(t => {
            t.onended = () => this.stop(sourceId);
        });

        this.render();
        Toast.success(`${facing === 'back' ? 'Back' : facing === 'front' ? 'Front' : 'Camera'} shared`);
    },
    stop(sourceId) {
        const src = State.localSources.get(sourceId);
        if (!src) return;
        src.stream.getTracks().forEach(t => t.stop());
        ConnectionManager.sendToHost({ type: 'source-ended', sourceId });
        State.localSources.delete(sourceId);
        this.render();
    },
    render() {
        const cont = $('guest-my-sources');
        if (!cont) return;
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
                <div class="my-source-video">
                    <video autoplay muted playsinline></video>
                </div>
                <div class="my-source-info">
                    <div class="my-source-name">
                        ${s.facing === 'back' ? 'Back Camera' : s.facing === 'front' ? 'Front Camera' : 'Camera'}
                    </div>
                    <div class="my-source-status ${s.status === 'live' ? 'live' : ''}">
                        ${s.status === 'live'
                            ? '● Live on host screen'
                            : s.status === 'hidden'
                            ? 'Hidden by host'
                            : 'Waiting for host...'}
                    </div>
                </div>
                <button class="my-source-stop"><i class="fas fa-stop"></i></button>
            `;
            const vid = div.querySelector('video');
            vid.srcObject = s.stream;
            div.querySelector('.my-source-stop').onclick = () => this.stop(id);
            cont.appendChild(div);
        });
    }
};

// -------------------- Login UI --------------------
const LoginUI = {
    init() {
        const hostInput  = $('host-room-input');
        const guestInput = $('guest-room-input');
        const genBtn     = $('gen-room-btn');
        const hostBtn    = $('start-host-btn');
        const guestBtn   = $('join-guest-btn');
        const errorEl    = $('login-error');

        const format = input => {
            const clean = Utils.cleanRoomId(input.value);
            input.value = Utils.formatRoomId(clean);
        };

        hostInput.oninput  = () => format(hostInput);
        guestInput.oninput = () => format(guestInput);

        // Enter to create/join
        hostInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                hostBtn.click();
            }
        });
        guestInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                guestBtn.click();
            }
        });

        genBtn.onclick = () => {
            const id = Utils.genRoomId();
            hostInput.value = Utils.formatRoomId(id);
        };

        hostBtn.onclick = async () => {
            errorEl.classList.remove('show');
            let code = hostInput.value.trim();
            if (!code) code = Utils.genRoomId();
            const clean = Utils.cleanRoomId(code);
            if (clean.length < 6) {
                errorEl.textContent = 'Room code must be 6 characters (letters & numbers).';
                errorEl.classList.add('show');
                return;
            }
            State.roomId = clean;
            State.isHost = true;

            $('login-screen').classList.add('hidden');
            $('host-screen').classList.remove('hidden');

            try {
                await ConnectionManager.startHost();
                HostPanelUI.init();
                const hostRoomEl = $('host-room-display');
                if (hostRoomEl) hostRoomEl.textContent = Utils.formatRoomId(clean);
                Toast.success('Room created: ' + Utils.formatRoomId(clean));
            } catch (err) {
                console.error(err);
                errorEl.textContent = err.message || 'Failed to create room';
                errorEl.classList.add('show');
                $('login-screen').classList.remove('hidden');
                $('host-screen').classList.add('hidden');
            }
        };

        guestBtn.onclick = async () => {
            errorEl.classList.remove('show');
            const code = guestInput.value.trim();
            const clean = Utils.cleanRoomId(code);
            if (clean.length < 6) {
                errorEl.textContent = 'Enter the 6‑character room code from the host.';
                errorEl.classList.add('show');
                return;
            }
            State.roomId = clean;
            State.isHost = false;

            $('login-screen').classList.add('hidden');
            GuestUI.init();
            GuestUI.setConnecting();

            try {
                await ConnectionManager.startGuest();
                await ConnectionManager.connectToHost();
                GuestUI.setConnected();
                Toast.success('Connected to host');
            } catch (err) {
                console.error(err);
                GuestUI.setError(err.message || 'Unable to connect to host');
            }
        };
    }
};

// -------------------- Host Toolbar --------------------
function bindHostUI() {
    const copyBtn = $('copy-room-btn');
    const fullBtn = $('host-fullscreen-btn');
    const addCam  = $('host-add-camera-btn');
    const addWin  = $('host-add-window-btn');
    const endBtn  = $('host-end-btn');

    if (copyBtn) {
        copyBtn.onclick = async () => {
            await Utils.copy(Utils.formatRoomId(State.roomId));
            Toast.success('Room code copied');
        };
    }

    if (fullBtn) {
        fullBtn.onclick = () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.();
                fullBtn.innerHTML = '<i class="fas fa-compress"></i><span>Fullscreen</span>';
            } else {
                document.exitFullscreen?.();
                fullBtn.innerHTML = '<i class="fas fa-expand"></i><span>Fullscreen</span>';
            }
        };
    }

    if (addCam) {
        addCam.onclick = async () => {
            const exists = [...State.videoBoxes.values()].some(
                b => b.hostType === 'host-camera'
            );
            if (exists) {
                Toast.warning('Your camera is already on the wall');
                return;
            }
            const stream = await Media.getCamera();
            if (stream) {
                VideoBox.create(stream, {
                    label: 'My Camera',
                    icon: 'fa-video',
                    muted: true,
                    mirror: true,
                    hostType: 'host-camera'
                });
            }
        };
    }

    if (addWin) {
        const canShareWindow = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
        if (!canShareWindow) {
            addWin.style.display = 'none';
        } else {
            addWin.onclick = async () => {
                const exists = [...State.videoBoxes.values()].some(
                    b => b.hostType === 'host-window'
                );
                if (exists) {
                    Toast.warning('Your window is already on the wall');
                    return;
                }
                const stream = await Media.getWindow();
                if (stream) {
                    const canvas = $('canvas');
                    const rect = canvas.getBoundingClientRect();

                    const id = VideoBox.create(stream, {
                        label: 'My Window',
                        icon: 'fa-window-maximize',
                        muted: true,
                        hostType: 'host-window',
                        x: 0,
                        y: 0,
                        width: rect.width,
                        height: rect.height
                    });

                    stream.getTracks().forEach(t => {
                        t.onended = () => VideoBox.remove(id);
                    });
                }
            };
        }
    }

    if (endBtn) {
        endBtn.onclick = () => location.reload();
    }
}

// -------------------- Global click to close panels --------------------
function bindGlobalPanelClose() {
    document.addEventListener('mousedown', e => {
        if (!State.isHost) return;
        const hostPanel = $('host-panel');
        const settingsPanel = $('settings-panel');
        if (!hostPanel && !settingsPanel) return;

        if (e.target.closest('#host-panel') ||
            e.target.closest('#settings-panel') ||
            e.target.closest('.toolbar') ||
            e.target.closest('#open-host-panel-btn') ||
            e.target.closest('#host-settings-btn')) {
            return;
        }

        if (hostPanel) hostPanel.classList.add('hidden');
        if (settingsPanel) settingsPanel.classList.add('hidden');
    });
}

// -------------------- Mouse in/out to show/hide UI --------------------
const InactivityUI = {
    init() {
        const hostScreen = $('host-screen');
        if (!hostScreen) return;

        const show = () => {
            if (!State.isHost || hostScreen.classList.contains('hidden')) return;
            document.body.classList.remove('ui-hidden');
        };

        const hide = () => {
            if (!State.isHost || hostScreen.classList.contains('hidden')) return;
            document.body.classList.add('ui-hidden');
        };

        hostScreen.addEventListener('mouseenter', show);
        hostScreen.addEventListener('mousemove', show);
        hostScreen.addEventListener('mouseleave', hide);
        window.addEventListener('blur', hide);
        window.addEventListener('focus', show);
    }
};

// -------------------- Init --------------------
function init() {
    SettingsUI.load();
    SettingsUI.init();
    LoginUI.init();
    bindHostUI();
    bindGlobalPanelClose();
    InactivityUI.init();

    // Pre-fill join from URL if ?room= present
    const params = new URLSearchParams(location.search);
    const roomParam = params.get('room');
    if (roomParam) {
        const clean = Utils.cleanRoomId(roomParam);
        if (clean) $('guest-room-input').value = Utils.formatRoomId(clean);
    }
}

document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();