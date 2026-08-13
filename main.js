"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const DEFAULTS = { bridgeUrl: "", pairingToken: "", vaultId: "", approvedPrefix: "", lastSynced: {} };
class UniversalKnowledgeBridge extends obsidian_1.Plugin {
    async onload() {
        this.settings = { ...DEFAULTS, ...(await this.loadData()) };
        this.addSettingTab(new BridgeSettings(this.app, this));
        this.addCommand({ id: "sync-approved-notes", name: "Sync approved notes", callback: () => void this.sync() });
    }
    async sync() {
        if (!this.settings.bridgeUrl || !this.settings.pairingToken) {
            new obsidian_1.Notice("Configure the knowledge bridge first.");
            return;
        }
        if (!this.settings.vaultId) {
            new obsidian_1.Notice("Set the registered vault ID first.");
            return;
        }
        const files = this.app.vault.getMarkdownFiles().filter((f) => !this.settings.approvedPrefix || f.path.startsWith((0, obsidian_1.normalizePath)(this.settings.approvedPrefix)));
        let pushed = 0;
        const local = new Map(files.map((file) => [file.path, file]));
        const remote = await this.listRemote();
        for (const note of remote) {
            const file = local.get(note.path);
            if (!file) {
                await this.app.vault.create(note.path, note.content);
                this.settings.lastSynced[note.path] = { version: note.version, hash: note.hash };
                continue;
            }
            const localContent = await this.app.vault.read(file);
            const mark = this.settings.lastSynced[note.path];
            if ((mark === null || mark === void 0 ? void 0 : mark.hash) === note.hash)
                continue;
            if (mark && await digest(localContent) !== mark.hash) {
                new obsidian_1.Notice(`Conflict not overwritten: ${note.path}`);
                continue;
            }
            await this.app.vault.process(file, () => note.content);
            this.settings.lastSynced[note.path] = { version: note.version, hash: note.hash };
        }
        for (const file of files) {
            const content = await this.app.vault.read(file);
            const mark = this.settings.lastSynced[file.path];
            if (!mark || await digest(content) !== mark.hash) {
                const note = await this.push(file, content, mark === null || mark === void 0 ? void 0 : mark.version);
                this.settings.lastSynced[file.path] = { version: note.version, hash: note.hash };
                pushed++;
            }
        }
        await this.saveData(this.settings);
        new obsidian_1.Notice(`Knowledge bridge sync complete: ${pushed} note(s) pushed.`);
    }
    async listRemote() {
        const prefix = this.settings.approvedPrefix && this.settings.approvedPrefix !== "/" ? (0, obsidian_1.normalizePath)(this.settings.approvedPrefix) : "";
        const response = await (0, obsidian_1.requestUrl)({ url: `${this.settings.bridgeUrl.replace(/\/$/, "")}/v1/notes/list`, method: "POST", headers: { Authorization: `Bearer ${this.settings.pairingToken}`, "content-type": "application/json" }, body: JSON.stringify({ vaultId: this.settings.vaultId, prefix }) });
        if (response.status >= 400)
            throw new Error(`Bridge list rejected: ${response.status}`);
        return response.json.data.notes;
    }
    async push(file, content, expectedVersion) {
        const response = await (0, obsidian_1.requestUrl)({ url: `${this.settings.bridgeUrl.replace(/\/$/, "")}/v1/notes/write`, method: "POST", headers: { Authorization: `Bearer ${this.settings.pairingToken}`, "content-type": "application/json" }, body: JSON.stringify({ vaultId: this.settings.vaultId, path: file.path, content, expectedVersion, mode: "replace", source: "obsidian-companion" }) });
        if (response.status >= 400)
            throw new Error(`Bridge rejected ${file.path}: ${response.status}`);
        return response.json.data.note;
    }
}
exports.default = UniversalKnowledgeBridge;
class BridgeSettings extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Universal Knowledge Bridge" });
        new obsidian_1.Setting(containerEl).setName("Bridge URL").setDesc("HTTPS URL for the isolated bridge service.").addText((t) => t.setValue(this.plugin.settings.bridgeUrl).onChange(async (v) => { this.plugin.settings.bridgeUrl = v.trim(); await this.plugin.saveData(this.plugin.settings); }));
        new obsidian_1.Setting(containerEl).setName("Registered vault ID").setDesc("Stable bridge vault ID; it is not the device filesystem path.").addText((t) => t.setValue(this.plugin.settings.vaultId).onChange(async (v) => { this.plugin.settings.vaultId = v.trim(); await this.plugin.saveData(this.plugin.settings); }));
        new obsidian_1.Setting(containerEl).setName("Pairing token").setDesc("Stored in plugin data, never in a note.").addText((t) => t.setValue(this.plugin.settings.pairingToken).onChange(async (v) => { this.plugin.settings.pairingToken = v; await this.plugin.saveData(this.plugin.settings); }));
        new obsidian_1.Setting(containerEl).setName("Approved folder prefix").setDesc("Optional folder boundary; blank means all Markdown notes.").addText((t) => t.setValue(this.plugin.settings.approvedPrefix).onChange(async (v) => { this.plugin.settings.approvedPrefix = (0, obsidian_1.normalizePath)(v.trim()); await this.plugin.saveData(this.plugin.settings); }));
    }
}
async function digest(value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
