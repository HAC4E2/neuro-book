import {describe, expect, it} from "vitest";
import {assertTextToImageProviderUrl} from "nbook/server/text-to-image/provider-url-policy";

describe("text-to-image provider URL policy", () => {
    it("accepts a public HTTPS provider URL", () => {
        const url = assertTextToImageProviderUrl("https://api.example.com/v1/", {
            allowPrivateNetwork: false,
        });

        expect(url.href).toBe("https://api.example.com/v1/");
    });

    it.each([
        "ftp://api.example.com/v1",
        "https://token@example.com/v1",
        "https://api.example.com/v1#fragment",
        "http://localhost/v1",
        "http://localhost./v1",
        "http://gateway.localhost/v1",
        "http://gateway.localhost./v1",
        "http://127.0.0.1/v1",
        "http://169.254.10.1/v1",
        "http://192.168.1.20/v1",
        "http://[::1]/v1",
        "http://[fd00::1]/v1",
        "http://[fe80::1]/v1",
    ])("rejects unsafe provider URL %s", (value) => {
        expect(() => assertTextToImageProviderUrl(value, {
            allowPrivateNetwork: false,
        })).toThrow();
    });

    it("allows a private provider URL only when explicitly enabled", () => {
        const url = assertTextToImageProviderUrl("http://192.168.1.20/v1", {
            allowPrivateNetwork: true,
        });

        expect(url.hostname).toBe("192.168.1.20");
    });
});
