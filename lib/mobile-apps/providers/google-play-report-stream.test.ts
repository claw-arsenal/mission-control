import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import type { GoogleConfig } from "../config";

const storage = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@google-cloud/storage", () => ({ Storage: class {
  bucket() { return { file: () => ({ createReadStream: storage.read }) }; }
} }));
vi.mock("./google-play-client", () => ({ loadServiceAccount: () => ({ project_id: "test" }) }));
import { streamCsvRows } from "./google-play-reports";

const cfg = { reportsBucket: "test", reportsMaxFileBytes: 1024 } as GoogleConfig;
async function collect(config = cfg) {
  const rows = [];
  for await (const row of streamCsvRows(config, "report.csv")) rows.push(row);
  return rows;
}
afterEach(() => vi.clearAllMocks());

describe("streamCsvRows", () => {
  it("decodes UTF-16 even when the BOM and characters cross chunk boundaries", async () => {
    const bytes = Buffer.from("\ufeffCountry,Name\nNL,\u00e9\n", "utf16le");
    storage.read.mockReturnValue(Readable.from([...bytes].map(byte => Buffer.from([byte]))));
    expect(await collect()).toEqual([{ Country: "NL", Name: "\u00e9" }]);
  });

  it("enforces the byte limit while reading even without reliable object metadata", async () => {
    const read = Readable.from([Buffer.from("Country,Name\nNL,test\n")]);
    storage.read.mockReturnValue(read);
    await expect(collect({ ...cfg, reportsMaxFileBytes: 8 })).rejects.toThrow(/limit/i);
    expect(read.destroyed).toBe(true);
  });

  it("maps storage errors and closes the stream", async () => {
    const read = new Readable({ read() { this.destroy(Object.assign(new Error("denied"), { code: 403 })); } });
    storage.read.mockReturnValue(read);
    await expect(collect()).rejects.toMatchObject({ kind: "permission" });
    expect(read.destroyed).toBe(true);
  });

  it("closes the download when the consumer stops early", async () => {
    let sent = false;
    const read = new Readable({ read() {
      if (!sent) { sent = true; this.push(Buffer.from("Country,Name\nNL,test\nUS,")); }
    } });
    storage.read.mockReturnValue(read);
    for await (const row of streamCsvRows(cfg, "report.csv")) {
      expect(row.Country).toBe("NL");
      break;
    }
    expect(read.destroyed).toBe(true);
  });

  it("rejects invalid encoded bytes instead of silently storing replacement characters", async () => {
    storage.read.mockReturnValue(Readable.from([Buffer.from([0xff])]));
    await expect(collect()).rejects.toThrow(/encoded data/i);
  });
});
