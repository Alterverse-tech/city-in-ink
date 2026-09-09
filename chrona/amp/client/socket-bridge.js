import { io } from "../../socket.io.esm.min.js";
export class SocketIoBridge {
    socket;
    serverClockOffsetMs = 0;
    requestTimeoutMs;
    sessionStore;
    sessionActive = false;
    resumeAfterReconnect = false;
    resumeInFlight;
    rememberedSession;
    authorityUrl;
    ticketRefresh;
    ticketRefreshTimer;
    ticketRefreshInFlight;
    ticketReconnectRequested = false;
    networkTelemetry;
    networkTelemetryTimer;
    networkTelemetryInFlight;
    latestNetworkStats;
    manuallyDisconnected = false;
    disposed = false;
    onlineListener = () => {
        if (this.disposed || this.manuallyDisconnected || !this.sessionActive)
            return;
        const reconnect = !this.socket.connected;
        if (reconnect)
            this.socket.disconnect();
        void this.refreshSessionTicket(reconnect).catch(() => undefined);
    };
    constructor(url, options = {}) {
        this.authorityUrl = url;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
        this.sessionStore = options.sessionStore;
        if (options.networkTelemetry !== false) {
            const intervalMs = options.networkTelemetry?.intervalMs ?? 5_000;
            const samples = options.networkTelemetry?.samples ?? 3;
            if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000) {
                throw new Error("networkTelemetry.intervalMs must be an integer between 1000 and 60000");
            }
            if (!Number.isSafeInteger(samples) || samples < 1 || samples > 10) {
                throw new Error("networkTelemetry.samples must be an integer between 1 and 10");
            }
            this.networkTelemetry = { intervalMs, samples };
        }
        if (options.ticketRefresh) {
            const refreshLeadTimeMs = positiveDuration(options.ticketRefresh.refreshLeadTimeMs ?? 60_000, "refreshLeadTimeMs");
            const retryDelayMs = positiveDuration(options.ticketRefresh.retryDelayMs ?? 1_000, "retryDelayMs");
            this.ticketRefresh = {
                source: options.ticketRefresh.source,
                refreshLeadTimeMs,
                retryDelayMs,
                onlineEventTarget: options.ticketRefresh.onlineEventTarget ?? defaultOnlineEventTarget()
            };
            assertAllocationTargetsUrl(this.ticketRefresh.source.current.authorityUrl, url);
        }
        const initialTicket = this.ticketRefresh?.source.current.sessionTicket;
        const socketOptions = {
            autoConnect: false,
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionDelay: 300,
            reconnectionDelayMax: 3_000,
            ...options.socket
        };
        if (initialTicket) {
            const auth = typeof socketOptions.auth === "object" && socketOptions.auth !== null
                ? socketOptions.auth
                : {};
            socketOptions.auth = { ...auth, sessionTicket: initialTicket };
        }
        this.socket = io(url, {
            ...socketOptions
        });
        this.socket.on("room:error", (error) => {
            if (error.code === "KICKED" || error.code === "ROOM_CLOSED" || error.code === "HOST_DISSOLVED" || error.code === "SESSION_REPLACED") {
                this.sessionStore?.clear();
                this.rememberedSession = undefined;
                this.sessionActive = false;
                this.stopNetworkTelemetry();
            }
        });
        this.socket.on("room:state", ({ state }) => {
            if (state === "CLOSED") {
                this.sessionStore?.clear();
                this.rememberedSession = undefined;
                this.sessionActive = false;
                this.stopNetworkTelemetry();
            }
        });
        this.socket.on("disconnect", () => {
            this.stopNetworkTelemetry();
            if (this.sessionActive)
                this.resumeAfterReconnect = true;
        });
        this.socket.on("connect", () => {
            if (!this.resumeAfterReconnect)
                return;
            this.resumeAfterReconnect = false;
            this.resumeInFlight = this.resumeStoredRoom()
                .then(() => undefined)
                .catch(() => {
                this.sessionActive = false;
                this.sessionStore?.clear();
                this.rememberedSession = undefined;
                this.stopNetworkTelemetry();
            })
                .finally(() => {
                this.resumeInFlight = undefined;
            });
        });
        this.socket.on("connect_error", (error) => {
            if (!this.ticketRefresh || this.manuallyDisconnected || this.disposed)
                return;
            if (!isTicketAdmissionError(error) && Date.now() < this.ticketRefresh.source.current.expiresAtMs)
                return;
            // socket.disconnect() disables Socket.IO's retry loop while the control
            // plane is issuing a new credential. The successful refresh explicitly
            // reconnects and then the normal connect listener resumes the room.
            this.socket.disconnect();
            void this.refreshSessionTicket(true).catch(() => undefined);
        });
        this.ticketRefresh?.onlineEventTarget?.addEventListener("online", this.onlineListener);
        if (this.ticketRefresh)
            this.scheduleTicketRefresh(this.ticketRefresh.source.current.expiresAtMs);
    }
    async connect() {
        if (this.disposed)
            throw new Error("SocketIoBridge is closed");
        this.manuallyDisconnected = false;
        if (this.socket.connected)
            return;
        await this.connectSocket();
    }
    connectSocket() {
        if (this.socket.connected)
            return Promise.resolve();
        return new Promise((resolve, reject) => {
            const onConnect = () => {
                cleanup();
                resolve();
            };
            const onError = (error) => {
                cleanup();
                reject(error);
            };
            const cleanup = () => {
                this.socket.off("connect", onConnect);
                this.socket.off("connect_error", onError);
            };
            this.socket.on("connect", onConnect);
            this.socket.on("connect_error", onError);
            this.socket.connect();
        });
    }
    disconnect() {
        this.manuallyDisconnected = true;
        this.stopNetworkTelemetry();
        this.socket.disconnect();
    }
    /** Permanently releases timers/listeners in addition to disconnecting. */
    close() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.manuallyDisconnected = true;
        if (this.ticketRefreshTimer)
            clearTimeout(this.ticketRefreshTimer);
        this.ticketRefreshTimer = undefined;
        this.stopNetworkTelemetry();
        this.ticketRefresh?.onlineEventTarget?.removeEventListener("online", this.onlineListener);
        this.socket.disconnect();
    }
    /**
     * Rotates the short-lived admission ticket used by the next Socket.IO
     * handshake. The current connection remains alive; a later reconnect uses
     * this ticket together with the room reconnect token.
     */
    updateSessionTicket(sessionTicket) {
        if (typeof sessionTicket !== "string" || sessionTicket.length === 0 || sessionTicket.length > 16_384) {
            throw new Error("sessionTicket must be a non-empty bounded string");
        }
        const existing = typeof this.socket.auth === "object" && this.socket.auth !== null
            ? this.socket.auth
            : {};
        this.socket.auth = { ...existing, sessionTicket };
    }
    /**
     * Forces a ticket renewal. Concurrent timer/online/connect-error calls share
     * one control-plane allocation and, when requested, one reconnect/resume.
     */
    refreshTicket(options = {}) {
        return this.refreshSessionTicket(options.reconnectIfDisconnected ?? false);
    }
    async createRoom(request) {
        const session = await this.request((ack) => this.socket.emit("room:create", request, ack));
        this.remember(session);
        return session;
    }
    async joinRoom(request) {
        const session = await this.request((ack) => this.socket.emit("room:join", request, ack));
        this.remember(session);
        return session;
    }
    async resumeStoredRoom() {
        const saved = this.sessionStore?.load() ?? this.rememberedSession;
        if (!saved)
            return undefined;
        const session = await this.request((ack) => this.socket.emit("room:resume", {
            roomCode: saved.roomCode,
            playerId: saved.playerId,
            reconnectToken: saved.reconnectToken
        }, ack));
        this.remember(session);
        return session;
    }
    async recoverRoom(roomCode) {
        const session = await this.request((ack) => this.socket.emit("room:recover", { roomCode }, ack));
        this.remember(session);
        return session;
    }
    async leaveRoom() {
        await this.awaitSessionResume();
        const result = await this.request((ack) => this.socket.emit("room:leave", ack));
        this.sessionStore?.clear();
        this.rememberedSession = undefined;
        this.sessionActive = false;
        this.stopNetworkTelemetry();
        return result;
    }
    async startRoom() {
        await this.awaitSessionResume();
        return this.request((ack) => this.socket.emit("room:start", ack));
    }
    async finishRoom() {
        await this.awaitSessionResume();
        return this.request((ack) => this.socket.emit("room:finish", ack));
    }
    async dissolveRoom() {
        await this.awaitSessionResume();
        return this.request((ack) => this.socket.emit("room:dissolve", ack));
    }
    async kickPlayer(playerId) {
        await this.awaitSessionResume();
        return this.request((ack) => this.socket.emit("room:kick", { playerId }, ack));
    }
    async voteToKick(playerId) {
        await this.awaitSessionResume();
        return this.request((ack) => this.socket.emit("room:kick-vote", { playerId }, ack));
    }
    async sendInput(input) {
        await this.awaitSessionResume();
        return this.request((ack) => this.socket.emit("player:input", input, ack));
    }
    async submitAction(request) {
        await this.awaitSessionResume();
        const synchronized = {
            ...request,
            estimatedServerTimeMs: request.estimatedServerTimeMs ?? this.estimatedServerTime(request.clientTimeMs)
        };
        return this.request((ack) => this.socket.emit("action:submit", synchronized, ack));
    }
    async synchronizeClock(samples = 3) {
        const offsets = [];
        const roundTrips = [];
        for (let index = 0; index < Math.max(1, samples); index += 1) {
            const startedAt = Date.now();
            const response = await this.request((ack) => {
                this.socket.emit("clock:ping", { clientTimeMs: startedAt }, ack);
            });
            const finishedAt = Date.now();
            offsets.push(response.serverTimeMs - (startedAt + finishedAt) / 2);
            roundTrips.push(finishedAt - startedAt);
        }
        offsets.sort((a, b) => a - b);
        this.serverClockOffsetMs = offsets[Math.floor(offsets.length / 2)];
        roundTrips.sort((a, b) => a - b);
        const rttMs = median(roundTrips);
        const deviations = roundTrips.map((roundTrip) => Math.abs(roundTrip - rttMs)).sort((a, b) => a - b);
        this.latestNetworkStats = {
            rttMs: Math.round(rttMs),
            jitterMs: Math.round(median(deviations)),
            updatedAtMs: Date.now()
        };
        if (this.sessionActive) {
            try {
                this.latestNetworkStats = await this.request((ack) => this.socket.emit("network:report", {
                    rttMs: this.latestNetworkStats.rttMs,
                    jitterMs: this.latestNetworkStats.jitterMs
                }, ack));
            }
            catch {
                // Clock sync remains useful while a room is concurrently closing or resuming.
            }
        }
        return this.serverClockOffsetMs;
    }
    networkStats() {
        return this.latestNetworkStats ? { ...this.latestNetworkStats } : undefined;
    }
    estimatedServerTime(localTimeMs = Date.now()) {
        return localTimeMs + this.serverClockOffsetMs;
    }
    onSnapshot(listener) {
        this.socket.on("room:snapshot", listener);
        return () => this.socket.off("room:snapshot", listener);
    }
    onError(listener) {
        this.socket.on("room:error", listener);
        return () => this.socket.off("room:error", listener);
    }
    onPresence(listener) {
        this.socket.on("player:presence", listener);
        return () => this.socket.off("player:presence", listener);
    }
    onPlayerLeft(listener) {
        this.socket.on("player:left", listener);
        return () => this.socket.off("player:left", listener);
    }
    onRoomState(listener) {
        this.socket.on("room:state", listener);
        return () => this.socket.off("room:state", listener);
    }
    onKickVote(listener) {
        this.socket.on("room:kick-vote", listener);
        return () => this.socket.off("room:kick-vote", listener);
    }
    remember(session) {
        this.sessionActive = true;
        this.rememberedSession = {
            roomCode: session.roomCode,
            gameId: session.gameId,
            gameVersion: session.gameVersion,
            protocolVersion: session.protocolVersion,
            playerId: session.playerId,
            reconnectToken: session.reconnectToken
        };
        this.sessionStore?.save(this.rememberedSession);
        this.scheduleNetworkTelemetry(0);
    }
    scheduleNetworkTelemetry(delayMs = this.networkTelemetry?.intervalMs) {
        if (delayMs === undefined || !this.networkTelemetry || !this.sessionActive || !this.socket.connected || this.disposed)
            return;
        if (this.networkTelemetryTimer)
            clearTimeout(this.networkTelemetryTimer);
        this.networkTelemetryTimer = setTimeout(() => {
            this.networkTelemetryTimer = undefined;
            if (!this.socket.connected || this.resumeInFlight) {
                this.scheduleNetworkTelemetry();
                return;
            }
            if (this.networkTelemetryInFlight)
                return;
            this.networkTelemetryInFlight = this.synchronizeClock(this.networkTelemetry.samples)
                .then(() => undefined)
                .catch(() => undefined)
                .finally(() => {
                this.networkTelemetryInFlight = undefined;
                this.scheduleNetworkTelemetry();
            });
        }, delayMs);
    }
    stopNetworkTelemetry() {
        if (this.networkTelemetryTimer)
            clearTimeout(this.networkTelemetryTimer);
        this.networkTelemetryTimer = undefined;
    }
    async awaitSessionResume() {
        if (this.resumeInFlight)
            await this.resumeInFlight;
    }
    refreshSessionTicket(reconnectIfDisconnected) {
        if (!this.ticketRefresh)
            return Promise.reject(new Error("Automatic ticket refresh is not configured"));
        if (this.disposed)
            return Promise.reject(new Error("SocketIoBridge is closed"));
        if (reconnectIfDisconnected)
            this.ticketReconnectRequested = true;
        if (this.ticketRefreshInFlight)
            return this.ticketRefreshInFlight;
        const operation = (async () => {
            const allocation = await this.ticketRefresh.source.refresh();
            assertAllocationTargetsUrl(allocation.authorityUrl, this.authorityUrl);
            this.updateSessionTicket(allocation.sessionTicket);
            this.scheduleTicketRefresh(allocation.expiresAtMs);
            if (this.ticketReconnectRequested && !this.socket.connected && !this.manuallyDisconnected) {
                this.ticketReconnectRequested = false;
                await this.connectSocket();
                await this.awaitSessionResume();
            }
            else if (this.socket.connected) {
                this.ticketReconnectRequested = false;
            }
        })();
        this.ticketRefreshInFlight = operation.catch((error) => {
            this.scheduleTicketRetry();
            throw error;
        }).finally(() => {
            this.ticketRefreshInFlight = undefined;
        });
        return this.ticketRefreshInFlight;
    }
    scheduleTicketRefresh(expiresAtMs) {
        if (!this.ticketRefresh || this.disposed)
            return;
        if (this.ticketRefreshTimer)
            clearTimeout(this.ticketRefreshTimer);
        const remainingMs = Math.max(0, expiresAtMs - Date.now());
        // For a 30 second ticket this refreshes about 10 seconds before expiry;
        // long-lived tickets use the configured lead time.
        const leadTimeMs = Math.min(this.ticketRefresh.refreshLeadTimeMs, Math.max(1_000, Math.floor(remainingMs / 3)));
        const delayMs = Math.max(0, remainingMs - leadTimeMs);
        this.ticketRefreshTimer = setTimeout(() => {
            this.ticketRefreshTimer = undefined;
            void this.refreshSessionTicket(false).catch(() => undefined);
        }, delayMs);
    }
    scheduleTicketRetry() {
        if (!this.ticketRefresh || this.disposed || this.ticketRefreshTimer)
            return;
        this.ticketRefreshTimer = setTimeout(() => {
            this.ticketRefreshTimer = undefined;
            void this.refreshSessionTicket(this.ticketReconnectRequested).catch(() => undefined);
        }, this.ticketRefresh.retryDelayMs);
    }
    request(emit) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Multiplayer request timed out")), this.requestTimeoutMs);
            emit((result) => {
                clearTimeout(timeout);
                if (result.ok)
                    resolve(result.data);
                else
                    reject(Object.assign(new Error(result.error.message), { protocolError: result.error }));
            });
        });
    }
}
function defaultOnlineEventTarget() {
    const target = globalThis;
    return typeof target.addEventListener === "function" && typeof target.removeEventListener === "function"
        ? target
        : undefined;
}
function positiveDuration(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(`${label} must be a positive integer`);
    return value;
}
function assertAllocationTargetsUrl(allocationUrl, bridgeUrl) {
    let allocation;
    let bridge;
    try {
        allocation = new URL(allocationUrl);
        bridge = new URL(bridgeUrl);
    }
    catch {
        throw new Error("Authority URL is invalid");
    }
    const normalize = (url) => `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
    if (normalize(allocation) !== normalize(bridge)) {
        throw new Error("Control-plane ticket refresh targets a different authority URL");
    }
}
function isTicketAdmissionError(error) {
    if (!error || typeof error !== "object")
        return false;
    const data = "data" in error ? error.data : undefined;
    if (!data || typeof data !== "object" || !("code" in data))
        return false;
    const code = data.code;
    return code === "SESSION_TICKET_REQUIRED" || code === "SESSION_TICKET_REJECTED";
}
function median(values) {
    if (!values.length)
        return 0;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 0
        ? (values[middle - 1] + values[middle]) / 2
        : values[middle];
}
//# sourceMappingURL=socket-bridge.js.map
