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
    localSources: new Map(),    // guest: sourceId -> {stream, type, status}
    videoBoxes: new Map(),      // host: boxId -> {el, video, stream, sourceId, peerId}
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
    genRoomId() {
        return this.genId(3) + this.genId(3);
    },
    cleanRoomId(id) {
        return id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    },
    formatRoomId(id) {
        const c = this.cleanRoomId(id);
        if (c.length <= 3) return c;
        return c.slice(0,3) + '-' + c.slice(3);
    },
    roomToPeerId(roomId) {
        return 'devhub-' + this.cleanRoomId(roomId);
    },
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
            console.error('Camera error:', err);
            Toast.error('Cannot access camera/mic');
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
                console.error('Window error:', err);
                Toast.error('Cannot share window');
            }
            return null;
        }
    }
};

// -------------------- Settings UI --------------------
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
        try {
            localStorage.setItem('dh-settings', JSON.stringify(State.settings));
        } catch {}
    },
    init() {
        const p = $('settings-panel');
        const open = $('host-settings-btn');
        const close = $('settings-close-btn');
        if (!p || !open || !close) return;

        const s = State.settings;

        const showBorders = $('set-show-borders');
        const showLabels  = $('set-show-labels');
        const rounded     = $('set-rounded-corners');
        const lockRatio   = $('set-lock-ratio');
        const bgColor     = $('set-bg-color');

        showBorders.checked = s.showBorders;
        showLabels.checked  = s.showLabels;
        rounded.checked     = s.roundedCorners;
        lockRatio.checked   = s.lockRatio;
        bgColor.value       = s.bgColor;

        open.onclick = () => p.classList.toggle('hidden');
        close.onclick = () => p.classList.add('hidden');

        showBorders.onchange = () => {
            s.showBorders = showBorders.checked;
            this.apply();
            this.save();
        };
        showLabels.onchange = () => {
            s.showLabels = showLabels.checked;
            this.apply();
            this.save();
        };
        rounded.onchange = () => {
            s.roundedCorners = rounded.checked;
            this.apply();
            this.save();
        };
        lockRatio.onchange = () => {
            s.lockRatio = lockRatio.checked;
            this.save();
        };
        bgColor.oninput = () => {
            s.bgColor = bgColor.value;
            document.documentElement.style.setProperty('--bg-color', s.bgColor);
            const canvas = $('canvas');
            if (canvas) canvas.style.background = 'var(--bg-color)';
            this.save();
        };

        this.apply();
    },
    apply() {
        State.videoBoxes.forEach(box => {
            const el = box.el;
            if (!State.settings.showBorders) el.classList.add('no-border');
            else el.classList.remove('no-border');

            if (!State.settings.roundedCorners) el.classList.add('no-radius');
            else el.classList.remove('no-radius');

            if (!State.settings.showLabels) el.classList.add('hide-labels');
            else el.classList.remove('hide-labels');
        });
    },
    applyToBox(el) {
        if (!State.settings.showBorders) el.classList.add('no-border');
        if (!State.settings.roundedCorners) el.classList.add('no-radius');
        if (!State.settings.showLabels) el.classList.add('hide-labels');
    }
};

// -------------------- VideoBox (Host canvas tiles) --------------------
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

        const canvas = $('canvas');
        const rect = canvas.getBoundingClientRect();
        const w = opts.width || CONFIG.defaultSize.width;
        const h = opts.height || CONFIG.defaultSize.height;
        const x = opts.x ?? Math.max(10, (rect.width  - w) / 2);
        const y = opts.y ?? Math.max(10, (rect.height - h) / 2);

        box.style.left = x + 'px';
        box.style.top = y + 'px';
        box.style.width = w + 'px';
        box.style.height = h + 'px';

        canvas.appendChild(box);

        State.videoBoxes.set(id, {
            el: box,
            video,
            stream,
            sourceId: opts.sourceId,
            peerId: opts.peerId
        });

        this.bindEvents(box, id);
        return id;
    },

    bindEvents(box, id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;

        // Controls
        box.querySelectorAll('.video-control-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'mute') this.toggleMute(id);
                if (action === 'pip') this.togglePip(id);
                if (action === 'close') this.remove(id);
            };
        });

        // Move
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
        box.querySelector('.move-handle').addEventListener('mousedown', startMove);
        box.querySelector('.move-handle').addEventListener('touchstart', startMove, { passive: false });

        // Drag from video area
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
            const menu = $('context-menu');
            if (!menu) return;
            menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
            menu.style.top  = Math.min(e.clientY, window.innerHeight - 250) + 'px';
            menu.classList.remove('hidden');
            this.activate(id);
            ContextMenu.boxId = id;
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
        const canvasRect = $('canvas').getBoundingClientRect();
        const w = data.el.offsetWidth;
        const h = data.el.offsetHeight;
        let x = int.origLeft + (p.x - int.startX);
        let y = int.origTop  + (p.y - int.startY);
        x = Utils.clamp(x, 0, canvasRect.width  - w);
        y = Utils.clamp(y, 0, canvasRect.height - h);
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
        const minW = CONFIG.minSize.width;
        const minH = CONFIG.minSize.height;
        const lock = State.settings.lockRatio;
        let { origLeft: left, origTop: top, origW: w, origH: h, ratio, dir } = int;

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

        const canvasRect = $('canvas').getBoundingClientRect();
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
            Toast.warning('Picture-in-Picture not supported here');
        }
    },

    remove(id) {
        const data = State.videoBoxes.get(id);
        if (!data) return;
        data.el.remove();
        State.videoBoxes.delete(id);
    }
};

// -------------------- Context Menu --------------------
const ContextMenu = { boxId: null };

function bindContextMenu() {
    const menu = $('context-menu');
    document.addEventListener('click', e => {
        if (!e.target.closest('#context-menu')) {
            menu.classList.add('hidden');
        }
    });
    menu.querySelectorAll('[data-action]').forEach(item => {
        item.onclick = () => {
            const id = ContextMenu.boxId;
            if (!id) {
                menu.classList.add('hidden');
                return;
            }
            const act = item.dataset.action;
            if (act === 'fullscreen') VideoBox.fullscreen?.(id);
            if (act === 'pip')        VideoBox.togglePip(id);
            if (act === 'duplicate')  VideoBox.duplicate?.(id);
            if (act === 'mute')       VideoBox.toggleMute(id);
            if (act === 'mirror')     VideoBox.toggleMirror?.(id);
            if (act === 'reset')      VideoBox.resetSize?.(id);
            if (act === 'front')      VideoBox.bringFront?.(id);
            if (act === 'remove')     VideoBox.remove(id);
            menu.classList.add('hidden');
        };
    });
}

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
                console.log('Host ready:', id);
                resolve();
            });

            State.peer.on('error', err => {
                clearTimeout(timer);
                console.error('Host error:', err);
                if (err.type === 'unavailable-id') {
                    reject(new Error('This room code is already in use'));
                } else {
                    reject(new Error('Unable to start host'));
                }
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
                call.on('close', () => {});
            });
        });
    },

    async startGuest() {
        State.peer = new Peer({
            debug: 2,
            config: { iceServers: CONFIG.iceServers }
        });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout')), 15000);
            State.peer.on('open', id => {
                clearTimeout(timer);
                State.peerId = id;
                console.log('Guest ready:', id);
                resolve();
            });
            State.peer.on('error', err => {
                clearTimeout(timer);
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
            const timer = setTimeout(() => reject(new Error('Host not found')), 15000);

            conn.on('open', () => {
                clearTimeout(timer);
                State.hostConnection = conn;
                conn.on('data', data => this.handleHostMessage(data));
                conn.on('close', () => {
                    Toast.warning('Disconnected from host');
                });
                resolve();
            });

            conn.on('error', err => {
                clearTimeout(timer);
                console.error('Connect error:', err);
                reject(new Error('Host not found or offline'));
            });
        });
    },

    handleGuestMessage(peerId, data) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'guest-info': {
                const conn = State.connections.get(peerId);
                if (conn) {
                    conn.info = data.deviceInfo;
                    HostPanelUI.render();
                }
                break;
            }
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
        if (data.type === 'source-status') {
            const src = State.localSources.get(data.sourceId);
            if (src) {
                src.status = data.status;
                GuestUI.render();
            }
        }
        if (data.type === 'kick') {
            Toast.warning('Disconnected by host');
            setTimeout(() => location.reload(), 2000);
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
    }
};

// -------------------- Host Panel UI --------------------
const HostPanelUI = {
    init() {
        const panel  = $('host-panel');
        const open1  = $('open-host-panel-btn');
        const open2  = $('open-host-panel-btn-2');
        const close  = $('host-panel-close');

        const toggle = () => {
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) this.render();
        };

        open1.onclick = toggle;
        if (open2) open2.onclick = toggle;
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
        const sBadge = $('sources-badge');
        const dBadge = $('devices-badge');
        if (sBadge) sBadge.textContent = State.pendingSources.size;
        if (dBadge) dBadge.textContent = State.connections.size;
        const cc = $('connection-count');
        if (cc) cc.textContent = State.connections.size;
    },
    renderSources() {
        const cont = $('tab-sources');
        if (!cont) return;

        if (State.pendingSources.size === 0) {
            cont.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-video-slash"></i>
                    <p>No sources available</p>
                    <span>Ask devices to join and share camera/window.</span>
                </div>
            `;
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
                        <i class="fas ${src.type === 'camera' ? 'fa-video' : 'fa-window-maximize'}"></i>
                    </div>
                    <div class="source-info">
                        <div class="source-name">${src.type === 'camera' ? 'Camera' : 'Window'}</div>
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
                    ${displayed
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
            card.querySelector('.source-btn').onclick = (e) => {
                const act = e.currentTarget.dataset.action;
                if (act === 'display') {
                    VideoBox.create(src.stream, {
                        label: `${src.deviceInfo?.type || 'Device'} - ${src.type === 'camera' ? 'Camera' : 'Window'}`,
                        icon: src.type === 'camera' ? 'fa-video' : 'fa-window-maximize',
                        sourceId: id,
                        peerId: src.peerId,
                        mirror: src.type === 'camera'
                    });
                    ConnectionManager.sendToGuest(src.peerId, {
                        type: 'source-status',
                        sourceId: id,
                        status: 'live'
                    });
                } else {
                    State.videoBoxes.forEach((box, boxId) => {
                        if (box.sourceId === id) VideoBox.remove(boxId);
                    });
                    ConnectionManager.sendToGuest(src.peerId, {
                        type: 'source-status',
                        sourceId: id,
                        status: 'hidden'
                    });
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
                    <span>Share your room code with other devices.</span>
                </div>
            `;
            return;
        }
        cont.innerHTML = '';
        State.connections.forEach((conn, peerId) => {
            const card = document.createElement('div');
            card.className = 'device-card';
            card.innerHTML = `
                <div class="device-icon">
                    <i class="fas ${conn.info?.icon || 'fa-desktop'}"></i>
                </div>
                <div class="device-info">
                    <div class="device-name">${conn.info?.type || 'Device'}</div>
                    <div class="device-meta">${peerId}</div>
                </div>
                <button class="device-kick" title="Disconnect"><i class="fas fa-times"></i></button>
            `;
            card.querySelector('.device-kick').onclick = () => ConnectionManager.kickPeer(peerId);
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
        $('share-camera-btn').onclick = () => this.share('camera');
        $('share-window-btn').onclick = () => this.share('window');
        $('share-both-btn').onclick   = () => this.shareBoth();
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
    async share(type) {
        let stream = null;
        if (type === 'camera') stream = await Media.getCamera();
        else stream = await Media.getWindow();
        if (!stream) return;

        const sourceId = 'SRC-' + Utils.genId(6);
        State.localSources.set(sourceId, { stream, type, status: 'pending' });

        const hostId = Utils.roomToPeerId(State.roomId);
        State.peer.call(hostId, stream, {
            metadata: { sourceId, type, deviceInfo: Utils.deviceInfo() }
        });

        ConnectionManager.sendToHost({
            type: 'guest-info',
            deviceInfo: Utils.deviceInfo()
        });
        ConnectionManager.sendToHost({
            type: 'source-submitted',
            sourceId,
            sourceType: type
        });

        stream.getTracks().forEach(t => {
            t.onended = () => this.stop(sourceId);
        });

        this.render();
        Toast.success(`${type === 'camera' ? 'Camera' : 'Window'} shared`);
    },
    async shareBoth() {
        await this.share('camera');
        await this.share('window');
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
                        ${s.status === 'live'
                          ? '● Live on host screen'
                          : s.status === 'hidden'
                          ? 'Hidden by host'
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

// -------------------- Login UI --------------------
const LoginUI = {
    init() {
        const hostInput  = $('host-room-input');
        const guestInput = $('guest-room-input');
        const genBtn     = $('gen-room-btn');
        const hostBtn    = $('start-host-btn');
        const guestBtn   = $('join-guest-btn');
        const errorEl    = $('login-error');

        const format = (input) => {
            const clean = Utils.cleanRoomId(input.value);
            input.value = Utils.formatRoomId(clean);
        };

        hostInput.addEventListener('input', () => format(hostInput));
        guestInput.addEventListener('input', () => format(guestInput));

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
            $('host-room-display').textContent = Utils.formatRoomId(clean);

            try {
                await ConnectionManager.startHost();
                HostPanelUI.init();
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
            $('guest-screen').classList.remove('hidden');
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

// -------------------- Host UI Extras --------------------
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
                fullBtn.innerHTML = '<i class="fas fa-compress"></i>';
            } else {
                document.exitFullscreen?.();
                fullBtn.innerHTML = '<i class="fas fa-expand"></i>';
            }
        };
    }

    if (addCam) {
        addCam.onclick = async () => {
            const stream = await Media.getCamera();
            if (stream) {
                VideoBox.create(stream, {
                    label: 'My Camera',
                    icon: 'fa-video',
                    muted: true,
                    mirror: true
                });
            }
        };
    }

    if (addWin) {
        addWin.onclick = async () => {
            const stream = await Media.getWindow();
            if (stream) {
                const id = VideoBox.create(stream, {
                    label: 'My Window',
                    icon: 'fa-window-maximize',
                    muted: true
                });
                stream.getTracks().forEach(t => {
                    t.onended = () => VideoBox.remove(id);
                });
            }
        };
    }

    if (endBtn) {
        endBtn.onclick = () => location.reload();
    }
}

// -------------------- Init --------------------
function init() {
    // Load saved settings & apply background
    SettingsUI.load();
    const canvas = $('canvas');
    if (canvas) canvas.style.background = 'var(--bg-color)';

    LoginUI.init();
    bindHostUI();
    bindContextMenu();
    SettingsUI.init();

    // If room provided in URL, prefill join field
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