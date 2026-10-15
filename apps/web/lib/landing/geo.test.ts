import { describe, expect, it } from "vitest";
import { clientIp, countryDbCandidates, countryOfIp, normalizeIp } from "./geo";

describe("pays des visiteurs (base locale)", () => {
  it("normalise les adresses (port, crochets, IPv4 mappée) et refuse le reste", () => {
    expect(normalizeIp(" 90.84.1.1 ")).toBe("90.84.1.1");
    expect(normalizeIp("90.84.1.1:5544")).toBe("90.84.1.1");
    expect(normalizeIp("[2A01:CB00::1]:443")).toBe("2a01:cb00::1");
    expect(normalizeIp("::ffff:90.84.1.1")).toBe("90.84.1.1");
    expect(normalizeIp("fe80::1%en0")).toBe("fe80::1");
    expect(normalizeIp("999.1.1.1")).toBeNull();
    expect(normalizeIp("unknown")).toBeNull();
    expect(normalizeIp("")).toBeNull();
  });

  it("prend la première adresse de x-forwarded-for, sinon x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "90.84.1.1, 10.0.0.2" }))).toBe("90.84.1.1");
    expect(clientIp(new Headers({ "x-real-ip": "81.240.1.1" }))).toBe("81.240.1.1");
    expect(clientIp(new Headers())).toBeNull();
  });

  it("trouve le pays en IPv4 et en IPv6 sans service extérieur ; adresses privées inconnues", async () => {
    expect(countryDbCandidates("/app/apps/web")[0]).toBe(
      "/app/apps/web/node_modules/@ip-location-db/dbip-country-mmdb/dbip-country.mmdb",
    );
    expect(await countryOfIp("90.84.1.1")).toBe("FR"); // Orange France
    expect(await countryOfIp("2a01:cb00::1")).toBe("FR");
    expect(await countryOfIp("81.240.1.1")).toBe("BE"); // Proximus
    expect(await countryOfIp("::ffff:90.84.1.1")).toBe("FR");
    expect(await countryOfIp("10.0.0.1")).toBeNull();
    expect(await countryOfIp("127.0.0.1")).toBeNull();
    expect(await countryOfIp(null)).toBeNull();
  });
});
