import { emptyState, clone, same, mergeStates } from './sync-core.mjs';

const LOGIN_STORE = 'jtqx-cloud-login-v1';
export class TripCloudSync {
  constructor({ apiBase, tripId, onChange, onStatus, onEditable }) {
    this.apiBase = apiBase.replace(/\/$/, '');
    this.url = `${this.apiBase}/v1/trips/${tripId}`;
    this.cacheKey = `jtqx-cloud-draft-v1:${this.apiBase}:${tripId}`;
    this.onChange = onChange;
    this.onStatus = onStatus;
    this.onEditable = onEditable;
    this.current = emptyState();
    this.base = emptyState();
    this.revision = 0;
    this.ready = false;
    this.busy = false;
    this.key = '';
    this.conflicts = [];
    this.imported = false;
  }
  get dirty() { return !same(this.current, this.base); }
  status(kind, message) {
    this.onStatus({ kind, message, loggedIn: Boolean(this.key && this.ready), conflicts: this.conflicts, imported: this.imported });
  }
  cache() {
    try {
      localStorage.setItem(this.cacheKey, JSON.stringify({ base: this.base, current: this.current, revision: this.revision, imported: this.imported }));
      this.cacheFailed = false;
    } catch { this.cacheFailed = true; }
  }
  restoreCache() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.cacheKey) || 'null');
      if (saved && Number.isSafeInteger(saved.revision) && saved.revision >= 0 && saved.base && saved.current) {
        this.base = saved.base;
        this.current = saved.current;
        this.revision = saved.revision;
        this.imported = saved.imported === true;
        this.ready = true;
      }
    } catch { /* The server remains authoritative if the cache is unavailable. */ }
  }
  async start() {
    this.onEditable(false);
    if (!this.apiBase) { this.status('disabled', '云端同步正在配置'); return; }
    let key = '';
    try { key = sessionStorage.getItem(LOGIN_STORE) || localStorage.getItem(LOGIN_STORE) || ''; } catch { /* Login still works without browser persistence. */ }
    if (key) {
      this.key = key;
      this.restoreCache();
      if (this.ready) { this.onChange(clone(this.current)); this.onEditable(true); }
      await this.sync();
    } else this.status('signedout', '登录后可编辑并跨设备保存');
    this.interval = setInterval(() => {
      if (document.visibilityState === 'visible' && this.key && !this.conflicts.length) this.sync();
    }, 30000);
    window.addEventListener('online', () => { if (this.key) this.sync(); });
    window.addEventListener('focus', () => { if (this.key && !this.conflicts.length) this.sync(); });
    window.addEventListener('beforeunload', event => {
      if (this.key && (this.dirty || this.busy)) { event.preventDefault(); event.returnValue = ''; }
    });
  }
  async login(key, remember) {
    if (this.busy) return;
    key = key.trim();
    if (!/^jt_[A-Za-z0-9_-]{43}$/.test(key)) { this.status('signedout', '请填写完整的旅行登录码'); return; }
    this.key = key;
    this.restoreCache();
    if (this.ready) this.onChange(clone(this.current));
    const ok = await this.sync();
    if (ok) {
      try {
        localStorage.removeItem(LOGIN_STORE);
        sessionStorage.removeItem(LOGIN_STORE);
        (remember ? localStorage : sessionStorage).setItem(LOGIN_STORE, key);
      } catch { this.status('saved', '已连接云端；浏览器无法记住登录，下次需重新输入'); }
    }
    return ok;
  }
  logout() {
    if (this.busy) return;
    clearTimeout(this.timer);
    this.cache();
    try { localStorage.removeItem(LOGIN_STORE); sessionStorage.removeItem(LOGIN_STORE); } catch { /* No saved credential. */ }
    this.key = '';
    this.ready = false;
    this.conflicts = [];
    this.onEditable(false);
    this.onChange(emptyState());
    this.status('signedout', '已退出；登录后可继续编辑');
  }
  async request(method, body) {
    const response = await fetch(this.url, {
      method, cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${this.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'request_failed');
      error.status = response.status;
      error.latest = data.latest;
      throw error;
    }
    return data;
  }
  edit(group, key, value) {
    if (!this.key || !this.ready) return;
    this.current[group][key] = value;
    this.cache();
    if (this.conflicts.length) { this.status('conflict', '其他设备也修改了同一项，请选择保留的内容'); return; }
    this.status('pending', this.cacheFailed ? '等待上传；本机暂存不可用，请保持页面打开' : '等待保存…');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), 650);
  }
  reconcile(remote) {
    const { merged, conflicts } = mergeStates(this.base, this.current, remote.state);
    this.current = merged;
    // Keep the old base until a conflict is resolved, including across reloads.
    if (conflicts.length) this.conflictRemote = remote;
    else { this.base = clone(remote.state); this.revision = remote.revision; }
    this.updatedAt = remote.updatedAt;
    this.ready = true;
    this.conflicts = conflicts;
    this.cache();
    this.onChange(clone(this.current));
    this.onEditable(true);
    if (conflicts.length) this.status('conflict', '其他设备也修改了同一项，请选择保留的内容');
    return conflicts.length === 0;
  }
  async sync() {
    if (!this.key || this.busy || this.conflicts.length) return false;
    clearTimeout(this.timer);
    this.busy = true;
    this.status(this.dirty ? 'saving' : 'loading', this.dirty ? '正在保存到云端…' : '正在同步…');
    let success = false;
    try {
      const remote = await this.request('GET');
      if (!this.reconcile(remote)) return true;
      if (this.dirty) {
        const sent = clone(this.current);
        const saved = await this.request('PUT', { revision: this.revision, state: sent });
        // Edits made while PUT was in flight stay pending against the acknowledged snapshot.
        this.current = mergeStates(sent, this.current, saved.state).merged;
        this.base = clone(saved.state);
        this.revision = saved.revision;
        this.updatedAt = saved.updatedAt;
        this.cache();
        this.onChange(clone(this.current));
      }
      success = true;
      this.status(this.dirty ? 'pending' : 'saved', this.dirty ? '继续保存最新修改…' : `已保存到云端 · ${new Date(this.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
      return true;
    } catch (error) {
      if (error.status === 409 && error.latest) {
        success = this.reconcile(error.latest);
        if (success) this.status('pending', '正在合并其他设备的修改…');
      } else if (error.status === 401) {
        this.key = '';
        this.onEditable(false);
        try { localStorage.removeItem(LOGIN_STORE); sessionStorage.removeItem(LOGIN_STORE); } catch { /* Retain the draft. */ }
        this.status('signedout', '登录码无效或已更换，请重新登录；未上传修改仍保留');
      } else {
        this.status('error', this.dirty ? '尚未保存到云端；修改已留在本机，请重试' : '暂时无法连接云端，请重试');
      }
      return false;
    } finally {
      this.busy = false;
      if (success && this.dirty && !this.conflicts.length) this.timer = setTimeout(() => this.sync(), 100);
    }
  }
  resolveConflicts(useRemote) {
    if (!this.conflicts.length || !this.conflictRemote) return;
    if (useRemote) {
      for (const { group, key } of this.conflicts) {
        if (Object.hasOwn(this.conflictRemote.state[group], key)) this.current[group][key] = this.conflictRemote.state[group][key];
        else delete this.current[group][key];
      }
    }
    this.base = clone(this.conflictRemote.state);
    this.revision = this.conflictRemote.revision;
    this.conflictRemote = null;
    this.conflicts = [];
    this.cache();
    this.onChange(clone(this.current));
    this.sync();
  }
  importLegacy(patch) {
    if (!this.key || !this.ready || this.busy || this.conflicts.length) return false;
    for (const group of Object.keys(patch)) Object.assign(this.current[group], patch[group]);
    this.imported = true;
    this.cache();
    this.onChange(clone(this.current));
    this.sync();
    return true;
  }
}
