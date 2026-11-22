/**
 * Phone storage. Channel files mirror channel.json and flicks/<id>/flick.json.
 * Capacitor is imported by a runtime specifier so a desktop typecheck does not
 * need @capacitor/core, @capacitor/filesystem, or @capacitor/preferences.
 * If those packages and the native bridge are both missing, the memory store is used.
 */

export type PhoneDisk = {
  kind: "memory" | "capacitor";
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | null>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  nativeUrl(path: string): Promise<string | null>;
};

type FsPlugin = {
  readFile(options: Record<string, unknown>): Promise<{ data: string | Blob }>;
  writeFile(options: Record<string, unknown>): Promise<unknown>;
  deleteFile(options: Record<string, unknown>): Promise<unknown>;
  mkdir(options: Record<string, unknown>): Promise<unknown>;
  rmdir(options: Record<string, unknown>): Promise<unknown>;
  getUri(options: Record<string, unknown>): Promise<{ uri?: string }>;
};

type FsBundle = {
  Filesystem: FsPlugin;
  Directory: { Data: string };
  Encoding: { UTF8: string };
  convertFileSrc: ((path: string) => string) | null;
};

type Prefs = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
  keys?: () => Promise<{ keys: string[] }>;
};

const PREFERENCE_FILES = new Set(["go7/connections.json", "go7/secrets.json"]);

let pending: Promise<PhoneDisk> | null = null;

export function disk(): Promise<PhoneDisk> {
  pending ??= openDisk();
  return pending;
}

export async function phoneStoreKind(): Promise<PhoneDisk["kind"]> {
  return (await disk()).kind;
}

export async function openDisk(): Promise<PhoneDisk> {
  if (memoryRequested()) return memoryDisk();
  try {
    const loaded = await loadCapacitorDisk();
    if (loaded) return loaded;
  } catch {
    /* The packages are optional until the phone shell is installed. */
  }
  return memoryDisk();
}

function memoryRequested(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.GO7_PHONE_DISK === "memory";
}

function memoryDisk(): PhoneDisk {
  const text = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  return {
    kind: "memory",
    async readText(path) {
      return text.get(path) ?? null;
    },
    async writeText(path, value) {
      text.set(path, value);
    },
    async readBytes(path) {
      const found = bytes.get(path);
      return found ? found.slice() : null;
    },
    async writeBytes(path, value) {
      bytes.set(path, value.slice());
    },
    async remove(path) {
      for (const key of [...text.keys()]) if (under(path, key)) text.delete(key);
      for (const key of [...bytes.keys()]) if (under(path, key)) bytes.delete(key);
    },
    async nativeUrl() {
      return null;
    },
  };
}

async function loadCapacitorDisk(): Promise<PhoneDisk | null> {
  const [core, filesystem, preferences] = await Promise.all([
    loadOptional("@capacitor/core"),
    loadOptional("@capacitor/filesystem"),
    loadOptional("@capacitor/preferences"),
  ]);
  let bundle = asFilesystem(filesystem, convertFrom(core));
  let prefs = asPreferences(preferences);
  if (!bundle || !prefs) {
    const native = nativePlugins();
    bundle = bundle ?? native?.bundle ?? null;
    prefs = prefs ?? native?.prefs ?? null;
  }
  if (!bundle && !prefs) return null;
  const ready = await bounded(probe(bundle, prefs), 3000).catch(() => false);
  if (!ready) return null;
  return capacitorDisk(bundle, prefs);
}

async function loadOptional(specifier: string): Promise<Record<string, unknown> | null> {
  try {
    const loaded: unknown = await import(/* @vite-ignore */ specifier);
    return loaded && typeof loaded === "object" ? (loaded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asFilesystem(mod: Record<string, unknown> | null, convertFileSrc: ((path: string) => string) | null): FsBundle | null {
  if (!mod) return null;
  const Directory = mod.Directory as { Data?: string } | undefined;
  const Encoding = mod.Encoding as { UTF8?: string } | undefined;
  const Filesystem = mod.Filesystem as FsPlugin | undefined;
  if (!Filesystem || !Directory?.Data || !Encoding?.UTF8) return null;
  return { Filesystem, Directory: { Data: Directory.Data }, Encoding: { UTF8: Encoding.UTF8 }, convertFileSrc };
}

function asPreferences(mod: Record<string, unknown> | null): Prefs | null {
  const Preferences = mod?.Preferences as Prefs | undefined;
  if (!Preferences || typeof Preferences.get !== "function" || typeof Preferences.set !== "function") return null;
  return Preferences;
}

function convertFrom(mod: Record<string, unknown> | null): ((path: string) => string) | null {
  const Capacitor = mod?.Capacitor as { convertFileSrc?: (path: string) => string } | undefined;
  return typeof Capacitor?.convertFileSrc === "function" ? Capacitor.convertFileSrc.bind(Capacitor) : null;
}

type NativeCap = {
  convertFileSrc?: (path: string) => string;
  nativePromise?: (plugin: string, method: string, options?: Record<string, unknown>) => Promise<unknown>;
};

function nativePlugins(): { bundle: FsBundle; prefs: Prefs } | null {
  const scoped = (globalThis as { window?: { Capacitor?: NativeCap }; Capacitor?: NativeCap }).window?.Capacitor
    ?? (globalThis as { Capacitor?: NativeCap }).Capacitor;
  if (!scoped?.nativePromise) return null;
  const call = scoped.nativePromise.bind(scoped);
  const plugin = (name: string) =>
    new Proxy({} as Record<string, (options: Record<string, unknown>) => Promise<unknown>>, {
      get(_target, method) {
        if (typeof method !== "string") return undefined;
        return (options: Record<string, unknown>) => call(name, method, options);
      },
    });
  const Filesystem = plugin("Filesystem") as unknown as FsPlugin;
  const Preferences = plugin("Preferences") as unknown as Prefs;
  return {
    bundle: {
      Filesystem,
      Directory: { Data: "DATA" },
      Encoding: { UTF8: "utf8" },
      convertFileSrc: typeof scoped.convertFileSrc === "function" ? scoped.convertFileSrc.bind(scoped) : null,
    },
    prefs: Preferences,
  };
}

async function probe(bundle: FsBundle | null, prefs: Prefs | null): Promise<boolean> {
  let filesOk = false;
  let prefsOk = false;
  if (bundle) {
    try {
      await bundle.Filesystem.writeFile({
        path: "go7/.ready",
        data: "1",
        directory: bundle.Directory.Data,
        encoding: bundle.Encoding.UTF8,
        recursive: true,
      });
      await bundle.Filesystem.deleteFile({ path: "go7/.ready", directory: bundle.Directory.Data });
      filesOk = true;
    } catch {
      filesOk = false;
    }
  }
  if (prefs) {
    try {
      await prefs.get({ key: "go7.ready" });
      prefsOk = true;
    } catch {
      prefsOk = false;
    }
  }
  return filesOk || prefsOk;
}

function capacitorDisk(bundle: FsBundle | null, prefs: Prefs | null): PhoneDisk {
  const files = bundle;
  const preferences = prefs;
  return {
    kind: "capacitor",
    readText,
    writeText,
    readBytes,
    writeBytes,
    remove,
    nativeUrl,
  };

  async function readText(path: string): Promise<string | null> {
    if (files) {
      try {
        const result = await files.Filesystem.readFile({
          path,
          directory: files.Directory.Data,
          encoding: files.Encoding.UTF8,
        });
        if (typeof result.data === "string") return result.data;
      } catch {
        /* Fall through to Preferences for rows that were mirrored there. */
      }
    }
    if (preferences && (!files || PREFERENCE_FILES.has(path))) {
      try {
        const result = await preferences.get({ key: path });
        return result.value ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }

  async function writeText(path: string, text: string): Promise<void> {
    if (files) {
      await files.Filesystem.writeFile({
        path,
        data: text,
        directory: files.Directory.Data,
        encoding: files.Encoding.UTF8,
        recursive: true,
      });
    }
    if (preferences && (!files || PREFERENCE_FILES.has(path))) {
      await preferences.set({ key: path, value: text });
    }
    if (!files && !preferences) throw new Error("The phone store is not open.");
  }

  async function readBytes(path: string): Promise<Uint8Array | null> {
    if (!files) return null;
    try {
      const result = await files.Filesystem.readFile({ path, directory: files.Directory.Data });
      if (typeof result.data === "string") return decodeBase64(result.data);
      if (typeof Blob !== "undefined" && result.data instanceof Blob) return new Uint8Array(await result.data.arrayBuffer());
      return null;
    } catch {
      return null;
    }
  }

  async function writeBytes(path: string, data: Uint8Array): Promise<void> {
    if (!files) throw new Error("The phone cannot store that file yet.");
    await files.Filesystem.writeFile({
      path,
      data: encodeBase64(data),
      directory: files.Directory.Data,
      recursive: true,
    });
  }

  async function remove(path: string): Promise<void> {
    if (files) {
      try {
        await files.Filesystem.rmdir({ path, directory: files.Directory.Data, recursive: true });
      } catch {
        try {
          await files.Filesystem.deleteFile({ path, directory: files.Directory.Data });
        } catch {
          /* Already gone. */
        }
      }
    }
    if (!preferences) return;
    try {
      if (preferences.keys) {
        const listed = await preferences.keys();
        await Promise.all(
          listed.keys.filter((key) => under(path, key)).map((key) => preferences.remove({ key })),
        );
      } else if (PREFERENCE_FILES.has(path)) {
        await preferences.remove({ key: path });
      }
    } catch {
      /* A missing key is already removed. */
    }
  }

  async function nativeUrl(path: string): Promise<string | null> {
    if (!files) return null;
    try {
      const result = await files.Filesystem.getUri({ path, directory: files.Directory.Data });
      if (!result.uri) return null;
      return files.convertFileSrc ? files.convertFileSrc(result.uri) : result.uri;
    } catch {
      return null;
    }
  }
}

function under(root: string, key: string): boolean {
  return key === root || key.startsWith(root.endsWith("/") ? root : `${root}/`);
}

function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function encodeBase64(bytes: Uint8Array): string {
  const buffer = (globalThis as { Buffer?: { from(data: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (buffer) return buffer.from(bytes).toString("base64");
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    const slice = bytes.subarray(index, index + size);
    let chunk = "";
    for (let inner = 0; inner < slice.length; inner += 1) chunk += String.fromCharCode(slice[inner]);
    binary += chunk;
  }
  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/\s/g, "");
  const buffer = (globalThis as { Buffer?: { from(data: string, enc: string): Uint8Array } }).Buffer;
  if (buffer) return new Uint8Array(buffer.from(clean, "base64"));
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
