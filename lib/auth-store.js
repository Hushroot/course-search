'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AuthStore {
  constructor(directory, encodedKey) {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey || '') || Buffer.from(encodedKey, 'base64').length !== 32) {
      throw new Error('INFINITY_AUTH_KEY must be a base64-encoded 32-byte key.');
    }
    this.key = Buffer.from(encodedKey, 'base64');
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }
  file(id) {
    if (!/^(?:[a-f0-9]{64}|admin)$/.test(id)) throw new Error('Invalid authentication identity.');
    return path.join(this.directory, `${id}.json`);
  }
  read(id) {
    const file = this.file(id);
    if (!fs.existsSync(file)) return null;
    try {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (record.version !== 1) throw new Error();
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(record.iv, 'base64'));
      decipher.setAAD(Buffer.from(`course-search:auth:v1:${id}`));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString());
    } catch {
      throw Object.assign(new Error('Saved authentication could not be verified. Contact the administrator.'), { status: 503, code: 'AUTH_STORAGE_INVALID' });
    }
  }
  write(id, value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`course-search:auth:v1:${id}`));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    const file = this.file(id);
    const tmp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, file);
      fs.chmodSync(file, 0o600);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }
  remove(id) { fs.rmSync(this.file(id), { force: true }); }
  cleanup() {
    for (const name of fs.readdirSync(this.directory)) {
      const id = name.replace(/\.json$/, '');
      if (!/^[a-f0-9]{64}$/.test(id)) continue;
      try {
        const value = this.read(id);
        if (value.exp <= Date.now()) this.remove(id);
        else if (value.jar && value.connectedUntil <= Date.now()) this.write(id, { exp: value.exp, generation: value.generation + 1, closed: value.closed });
      } catch { /* Leave unauthenticatable data intact; never accept it. */ }
    }
  }
}
module.exports = { AuthStore };
