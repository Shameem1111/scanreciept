export const LOCK_DELAYS = [0, 30, 60, 300] as const;
export type LockSettings = { enabled: boolean; backgroundSeconds: number };
export type LockState = LockSettings & { ready: boolean; locked: boolean; active: boolean; busy: boolean; error: string | null; sessionStarted: boolean };
export type LockAdapters = {
  read(): Promise<LockSettings>;
  write(settings: LockSettings): Promise<void>;
  authenticate(): Promise<boolean>;
  now(): number;
};

export function parseLockSettings(raw: string | null): LockSettings {
  if (raw === null) return { enabled: false, backgroundSeconds: 60 };
  const value = JSON.parse(raw);
  if (!value || typeof value.enabled !== 'boolean' || !LOCK_DELAYS.some(delay => delay === value.backgroundSeconds)) throw new Error('Invalid lock settings');
  return { enabled: value.enabled, backgroundSeconds: value.backgroundSeconds };
}

// Independent of receipt encryption: this gates UI access, not encryption keys.
export class AppLock {
  state: LockState = { enabled: true, backgroundSeconds: 60, ready: false, locked: true, active: false, busy: false, error: null, sessionStarted: false };
  private backgroundAt: number | null = null;
  private generation = 0;
  constructor(private adapters: LockAdapters, private publish: (state: LockState) => void) {}
  private update(patch: Partial<LockState>) { this.state = { ...this.state, ...patch }; this.publish(this.state); }
  async load() {
    if (this.state.busy) return;
    this.update({ busy: true, error: null });
    try {
      const settings = await this.adapters.read();
      this.update({ ...settings, ready: true, locked: settings.enabled, sessionStarted: this.state.sessionStarted || !settings.enabled });
    } catch { this.update({ ready: false, locked: true, error: 'App security settings could not be read. Unlock your device and retry. Nothing has been reset.' }); }
    finally { this.update({ busy: false }); }
  }
  activity(next: string) {
    if (next === 'background') {
      if (this.backgroundAt === null) this.backgroundAt = this.adapters.now();
      this.generation++; // A prompt that spans a real background transition cannot unlock.
    }
    const elapsed = this.backgroundAt === null ? 0 : this.adapters.now() - this.backgroundAt;
    const expired = this.backgroundAt !== null && (elapsed < 0 || elapsed >= this.state.backgroundSeconds * 1000);
    const locked = this.state.locked || (this.state.enabled && expired);
    if (next === 'active') this.backgroundAt = null;
    // Inactive (including system dialogs) always covers content but does not start
    // the background timer. Native authentication commonly produces inactive events.
    this.update({ active: next === 'active', locked });
  }
  lockNow() { this.generation++; this.update({ locked: true, error: null }); }
  async unlock() {
    if (!this.state.ready || !this.state.active || this.state.busy) return;
    this.update({ busy: true, error: null });
    const generation = this.generation;
    try {
      if (await this.adapters.authenticate() && generation === this.generation && this.backgroundAt === null) {
        this.update({ locked: false, sessionStarted: true });
      } else this.update({ error: 'Authentication did not finish. Use your biometrics or device passcode and try again.' });
    } catch { this.update({ error: 'Device authentication is unavailable. Unlock your device and try again.' }); }
    finally { this.update({ busy: false }); }
  }
  async configure(settings: LockSettings) {
    if (!this.state.ready || this.state.locked || !this.state.active || this.state.busy) return;
    parseLockSettings(JSON.stringify(settings));
    this.update({ busy: true, error: null });
    const generation = this.generation;
    try {
      if (!await this.adapters.authenticate() || generation !== this.generation || this.backgroundAt !== null) {
        throw new Error();
      }
      // Persist before applying. Failed writes never silently disable an existing lock.
      await this.adapters.write(settings);
      this.update({ ...settings, locked: settings.enabled && (generation !== this.generation), error: null });
    } catch { this.update({ error: 'Security settings were not changed. Complete device authentication and retry.' }); }
    finally { this.update({ busy: false }); }
  }
}
