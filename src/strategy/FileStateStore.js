/**
 * Simple file-based state store for strategies
 */
const fs = require('fs');
const path = require('path');

class FileStateStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = this._load();
    }

    load() {
        return this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this.filePath)) {
                return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            }
        } catch (e) {
            console.warn(`[FileStateStore] Failed to load ${this.filePath}: ${e.message}`);
        }
        return {};
    }

    save(data) {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error(`[FileStateStore] Failed to save ${this.filePath}: ${e.message}`);
        }
    }

    get(key) {
        return this.data[key];
    }

    set(key, value) {
        this.data[key] = value;
        this.save(this.data);
    }
}

module.exports = FileStateStore;
