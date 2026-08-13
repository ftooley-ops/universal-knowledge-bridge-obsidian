"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const DEFAULTS = { bridgeUrl: "", pairingToken: "", vaultId: "", approvedPrefix: "", lastSynced: {} };
class UniversalKnowledgeBridge extends obsidian_1.Plugin {
    async onload() {
        this.settings = { ...DEFAULTS, ...(await this.loadData()) };
        this.addSettingTab(new BridgeSettings(this.app, this));
        this.addCommand({ id: "sync-approved-notes", name: "Sync approved notes", callback: () => void this.sync() });
        this.addCommand({ id: "pull-remote-test-note", name: "Pull remote test note", callback: () => void this.pullRemoteTest() });
    }
    async sync() {
        new obsidian_1.Notice("Knowledge bridge sync started.", 5000);
        try {
            if (!this.settings.bridgeUrl || !this.settings.pairingToken) {
                new obsidian_1.Notice("Configure the knowledge bridge first.");
                return;
            }
            if (!this.settings.vaultId) {
                new obsidian_1.Notice("Set the registered vault ID first.");
                return;
            }
            const prefix = this.settings.approvedPrefix && this.settings.approvedPrefix !== "/" ? (0, obsidian_1.normalizePath)(this.settings.approvedPrefix) : "";
            const files = this.app.vault.getMarkdownFiles().filter((f) => !prefix || f.path.startsWith(prefix));
            let pushed = 0;
            const local = new Map(files.map((file) => [file.path, file]));
            const remote = await this.listRemote();
            for (const note of remote) {
                const file = local.get(note.path);
                if (!file) {
                    await this.ensureParentFolders(note.path);
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
        catch (error) {
            new obsidian_1.Notice(`Knowledge bridge sync failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
            console.error("Universal Knowledge Bridge sync failed", error);
        }
    }
    async pullRemoteTest() {
        try {
            new obsidian_1.Notice("Knowledge bridge test pull started.", 5000);
            const notes = await this.listRemote();
            const note = notes.find((item) => item.path === "Bridge-Test.md");
            if (!note) {
                new obsidian_1.Notice("Bridge-Test.md was not found in the remote vault.", 10000);
                return;
            }
            const existing = this.app.vault.getAbstractFileByPath(note.path);
            if (existing instanceof obsidian_1.TFile)
                await this.app.vault.process(existing, () => note.content);
            else {
                await this.ensureParentFolders(note.path);
                await this.app.vault.create(note.path, note.content);
            }
            this.settings.lastSynced[note.path] = { version: note.version, hash: note.hash };
            await this.saveData(this.settings);
            new obsidian_1.Notice("Bridge-Test.md downloaded successfully.", 10000);
        }
        catch (error) {
            new obsidian_1.Notice(`Bridge test failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
            console.error("Universal Knowledge Bridge test pull failed", error);
        }
    }
    async ensureParentFolders(path) { const parts = path.split("/"); parts.pop(); let current = ""; for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!this.app.vault.getAbstractFileByPath(current))
            await this.app.vault.createFolder(current);
    } }
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
        new obsidian_1.Setting(containerEl).setName("Test connection").setDesc("Check that this vault can reach the bridge.").addButton((b) => b.setButtonText("Test").onClick(async () => { try {
            await this.plugin.listRemote();
            new obsidian_1.Notice("Knowledge bridge connection successful.", 8000);
        }
        catch (error) {
            new obsidian_1.Notice(`Connection failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
        } }));
        new obsidian_1.Setting(containerEl).setName("Pull remote test note").setDesc("Download Bridge-Test.md from the bridge.").addButton((b) => b.setButtonText("Pull test note").onClick(() => void this.plugin.pullRemoteTest()));
        new obsidian_1.Setting(containerEl).setName("Sync approved notes").setDesc("Synchronize notes using the configured folder boundary.").addButton((b) => b.setButtonText("Sync now").onClick(() => void this.plugin.sync()));
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
