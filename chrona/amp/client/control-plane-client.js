/**
 * Low-frequency control-plane client. The returned authority URL is used to
 * create a direct Socket.IO connection; realtime input never traverses this
 * HTTP service.
 */
export class ControlPlaneClient {
    baseUrl;
    fetchImpl;
    identityStore;
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl;
        const fetchImpl = options.fetch ?? globalThis.fetch;
        if (typeof fetchImpl !== "function")
            throw new Error("ControlPlaneClient requires fetch");
        // Safari/WebKit brand-checks native fetch's receiver. Keeping window.fetch
        // as a class field and later invoking it as this.fetchImpl(...) changes the
        // receiver to this ControlPlaneClient and throws `Illegal invocation`.
        this.fetchImpl = fetchImpl.bind(globalThis);
        this.identityStore = options.identityStore;
    }
    async allocate(request) {
        const response = await this.fetchImpl(new URL("/v1/allocate", this.baseUrl), {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                ...request,
                ...(this.identityStore?.load() ? { identityToken: this.identityStore.load() } : {})
            })
        });
        const value = await response.json().catch(() => undefined);
        if (!response.ok) {
            const message = isRecord(value) && typeof value.message === "string"
                ? value.message
                : `Control-plane allocation failed with HTTP ${response.status}`;
            throw new Error(message);
        }
        const payload = validateAllocation(value);
        if (payload.identityToken)
            this.identityStore?.save(payload.identityToken);
        const { identityToken: _identityToken, ...allocation } = payload;
        return allocation;
    }
    /**
     * Creates a single-flight ticket source pinned to an initial allocation.
     * SocketIoBridge can consume this source to renew an expired ticket before
     * reconnecting and resuming a room session.
     */
    createAllocationSource(request, initialAllocation) {
        assertAllocationMatchesRequest(request, initialAllocation);
        return new PinnedControlPlaneAllocationSource(this, request, initialAllocation);
    }
}
class PinnedControlPlaneAllocationSource {
    client;
    allocation;
    refreshInFlight;
    request;
    constructor(client, request, initialAllocation) {
        this.client = client;
        // Once a release has been selected, keep all renewals on that exact
        // release even when the caller originally requested "latest".
        this.request = {
            gameId: request.gameId,
            gameVersion: initialAllocation.gameVersion
        };
        this.allocation = { ...initialAllocation };
    }
    get current() {
        return this.allocation;
    }
    refresh() {
        if (this.refreshInFlight)
            return this.refreshInFlight;
        const operation = this.client.allocate(this.request).then((next) => {
            assertSameAuthorityAllocation(this.allocation, next);
            this.allocation = { ...next };
            return this.allocation;
        });
        this.refreshInFlight = operation.finally(() => {
            this.refreshInFlight = undefined;
        });
        return this.refreshInFlight;
    }
}
/** Per-tab storage prevents guest tabs from accidentally sharing one identity. */
export class BrowserControlPlaneIdentityStore {
    storage;
    key;
    constructor(storage, key = "authoritative-multiplayer-control-identity") {
        this.storage = storage;
        this.key = key;
    }
    load() {
        return this.storage.getItem(this.key) ?? undefined;
    }
    save(identityToken) {
        this.storage.setItem(this.key, identityToken);
    }
    clear() {
        this.storage.removeItem(this.key);
    }
}
function validateAllocation(value) {
    if (!isRecord(value))
        throw new Error("Control plane returned an invalid allocation");
    const fields = ["authorityId", "authorityUrl", "gameId", "gameVersion", "sessionTicket"];
    for (const field of fields) {
        if (typeof value[field] !== "string" || value[field].length === 0) {
            throw new Error(`Control plane allocation is missing ${field}`);
        }
    }
    if (!Number.isSafeInteger(value.protocolVersion) || Number(value.protocolVersion) < 1) {
        throw new Error("Control plane allocation has an invalid protocolVersion");
    }
    if (!Number.isSafeInteger(value.expiresAtMs) || Number(value.expiresAtMs) <= Date.now()) {
        throw new Error("Control plane allocation is already expired");
    }
    try {
        const authorityUrl = new URL(String(value.authorityUrl));
        if (authorityUrl.protocol !== "http:" && authorityUrl.protocol !== "https:")
            throw new Error();
    }
    catch {
        throw new Error("Control plane allocation has an invalid authorityUrl");
    }
    if (value.identityToken !== undefined && (typeof value.identityToken !== "string" || !value.identityToken)) {
        throw new Error("Control plane allocation has an invalid identityToken");
    }
    return value;
}
function assertAllocationMatchesRequest(request, allocation) {
    if (allocation.gameId !== request.gameId) {
        throw new Error("Initial control-plane allocation targets a different game");
    }
    if (request.gameVersion !== undefined && allocation.gameVersion !== request.gameVersion) {
        throw new Error("Initial control-plane allocation targets a different game version");
    }
}
function assertSameAuthorityAllocation(previous, next) {
    const stableFields = ["authorityId", "authorityUrl", "gameId", "gameVersion", "protocolVersion"];
    for (const field of stableFields) {
        if (next[field] !== previous[field]) {
            throw new Error(`Control-plane ticket refresh changed ${field}`);
        }
    }
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=control-plane-client.js.map