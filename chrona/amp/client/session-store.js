export class MemorySessionStore {
    session;
    load() {
        return this.session ? structuredClone(this.session) : undefined;
    }
    save(session) {
        this.session = structuredClone(session);
    }
    clear() {
        this.session = undefined;
    }
}
export class BrowserSessionStore {
    storage;
    key;
    constructor(storage, key = "authoritative-multiplayer-session") {
        this.storage = storage;
        this.key = key;
    }
    load() {
        const value = this.storage.getItem(this.key);
        if (!value)
            return undefined;
        try {
            return JSON.parse(value);
        }
        catch {
            this.clear();
            return undefined;
        }
    }
    save(session) {
        this.storage.setItem(this.key, JSON.stringify(session));
    }
    clear() {
        this.storage.removeItem(this.key);
    }
}
//# sourceMappingURL=session-store.js.map